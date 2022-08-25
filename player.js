'use strict';

import { Screenshot } from './ui/screenshot.js';

const PNG = png.PNG;
import { Tab } from './tab.js';
import { sleep, brimstone, progressIndicator, pollFor } from './utilities.js';
import { options, loadOptions, Options } from './options.js';
import { Test, constants, TestAction } from './test.js';
import * as Errors from './error.js';
import * as BDS from './ui/brimstoneDataService.js';
import { Correction } from './rectangle.js';
import { infobar } from './ui/infobar/infobar.js';
/**
 * This function is injected and run in the app
 *
 * Scroll the element that matches the css to the given value
 */
function _scroll(x, y, top, left) {
  var elem = document.elementFromPoint(x, y); // will this work in a frame ?
  if (top !== null) {
    elem.scrollTop = top;
  }
  if (left !== null) {
    elem.scrollLeft = left;
  }
}

/**
 * This function is injected and run in the app
 *
 * Measure the heap memory
 */
var getMemory = function (clearFirst) {
  try {
    if (clearFirst) {
      console.clear(); // lots of memory leaks come from console messages
    }
    window.gc(); // if chrome is started with --js-flags=--expose_gc we can force a GC
  } catch (e) {}
  let m = window.performance.memory;
  console.log(`used ${m.usedJSHeapSize} bytes`);
  return {
    jsHeapSizeLimit: m.jsHeapSizeLimit,
    totalJSHeapSize: m.totalJSHeapSize,
    usedJSHeapSize: m.usedJSHeapSize,
  };
};

/**
 * This function is injected and run in the app
 * @param {number} x the x coordinate of the select element
 * @param {*} y  the y coordinate of the select element
 * @param {*} value the vaue to set the select element to
 * @returns {string} an error message on error
 */
function _changeSelectValue(x, y, value) {
  try {
    var select = document.elementFromPoint(x, y);
    if (select.tagName !== 'SELECT') {
      return `attempt to change non-select element: ${select.outerHTML}`;
    }
    if (select.value === value) {
      return;
    }
    select.value = value;
    select.dispatchEvent(new Event('change'));

    select.focus(); // used in conjunction with the keypres escape to close the shadow DOM
  } catch (e) {
    return e.message;
  }
}

/**
 * This function is injected and run in the app.
 * It returns true if css DOES NOT match any element in the DOM.
 * Returns false if css matches an element in the DOM.
 */
function elementsNotExist(css) {
  try {
    return !document.querySelector(css); // as boolean
  } catch (e) {
    return `bad css to look for overlays: ${css}`;
  }
}

// This is not needed, but it took me forever to figure out how to get these events so I leave it here
// function handleDebuggerEvents(source, method, params) {
//     console.log('Debugger EVENT!!', source, method, params);
// }
// async function monitorPageEvents() {
//     await (new Promise(_resolve => chrome.debugger.sendCommand({ tabId: tab.chromeTab.id }, "Page.enable", {}, _resolve)));
//     if (chrome.runtime.lastError?.message) {
//         throw new Error(chrome.runtime.lastError.message); // not sure how to handle that.
//     }
//     chrome.debugger.onEvent.removeListener(handleDebuggerEvents);
//     chrome.debugger.onEvent.addListener(handleDebuggerEvents);
// }

export class Player {
  /** The currently executing step. */
  actionStep;

  /** mode switch either 'playing' or 'recording', something of a hack. */
  usedFor;

  /** Know if there are navigations in flight. */
  _navigationsInFlight = 0;

  /** asynchronously injectable switch to stop the player from playing */
  _stopPlaying = false;

  /**
   * @type {Promise<any>} way to block a debugger cmd until the debugger is (re)attached.
   */
  _debuggerAttached = null;

  /**
   * The number of steps played successfully. Used to calulate ETA.
   *
   * See {@link _expectedActionPlayTime}
   */
  _playStreak = 0;

  /**
   * The current weighted expected time to play an action,
   * in ms. This is e_n = x_1/n + x_2/n +...+ x_n/n for
   * n actions. Then to calcuate the next action
   *
   * do e = ((e * n) + x_n+1)/n+1
   *
   * see {@link _playStreak}
   */
  _expectedActionPlayTime = 0;

  /** The stepnumber index+1
   * of the last step that
   * was autocorrected
   */
  lastAutoCorrectedStepNumber;

  constructor() {
    /**
     * The tab we are playing on.
     * @type {Tab}
     */
    this.tab = null;
  }

  /**
   * In order to _play_ an action, this player
   * must be configured to drive the tab that
   * the action occurs on, and the debugger needs
   * to be attached to that tab (if it is not already)
   * @param {TestAction} action the action
   */
  async configureForAction(action) {
    // this action might be on a different tab
    // and/or have a different size
    // the next action we want to drive is to a different tab/frame so switch over to it.
    console.debug(
      `begin (try) switch to tab:${action.tab.id} w/url ${action.tab.url}`
    );
    let tab = Tab.getByVirtualId(action.tab.virtualId);
    if (!tab) {
      throw new Error(`no tab:${action.tab.id} registered (yet)`);
    }
    this.tab = new Tab(tab);

    // the expected PNG height/width that the user blessed is the source of truth
    // for what the tab viewport size should be.
    if (action.expectedScreenshot?.png?.height) {
      action.tab.height = action.expectedScreenshot.png.height;
    }
    if (action.expectedScreenshot?.png?.width) {
      action.tab.width = action.expectedScreenshot.png.width;
    }

    this.tab.height = action.tab.height;
    this.tab.width = action.tab.width;
    this.tab.blessed = true;

    console.debug(`end switched to tab:${this.tab.id}`, this.tab);

    if (await this.attachDebugger({ tab: this.tab })) {
      // FIXME: if we actually need to resize we may be hiding an application bug where the app is resizing a tab/window differently than before.
      // yet my current logic counts on this mechanism (mismatched sizes) to wait long enough for a navigation to settle for example. That should be reworked.
      console.warn(
        'we may be hiding an application bug where the app is resizing a tab/window differently than before'
      );

      await this.tab.resizeViewport();
    }
    // else it is on the same tab, so we don't need to switch.
  }

  /**
   * Prepare the PNGs for use starting from this index
   * bounded by {@link Options.maxNumberOfActionsToPrehydrate}.
   * @param {TestAction[]} actions the test actions
   * @param {number} startIndex the index we are playing from
   * @param {number} endIndex one past the last index to include
   */
  async _hydrate(actions, startIndex, endIndex) {
    await progressIndicator({
      progressCallback: infobar.setProgress.bind(
        infobar,
        'load actions',
        'actions loaded'
      ),
      items: actions,
      startIndex: startIndex,
      endIndex: endIndex,
      itemProcessor: new TestAction().hydrateScreenshots,
    });
  }

  /**
   * Wait until some elements are NOT in the DOM.
   * @param {string} css
   * @returns true when the elements are NOT present, false when they are present
   */
  async waitForElementsToNotExist(css) {
    let tabId = this.tab.chromeTab.id;

    /**
     * The polling function. This will return true if the CSS does NOT
     * match any element in the DOM.
     *
     * False if the CSS does match an element in the DOM.
     * @returns
     */
    async function executeElementsNotExistScript() {
      let frames = await chrome.scripting.executeScript({
        target: { tabId: tabId /*, frameIds: frameIds*/ },
        function: elementsNotExist,
        args: [css],
      });
      let result = frames[0].result;
      if (typeof result === 'string') {
        throw new Errors.CssError(result);
      }
      return result;
    }

    return await pollFor(
      true,
      executeElementsNotExistScript,
      options.maxTimeToWaitForOverlaysToBeRemoved,
      options.pollPeriodForOverlayToBeRemoved
    );
  }

  /**
   * Play the current set of actions. This allows actions to be played one
   * at a time or in chunks.
   *
   * Returns a deferred boolean that reflects the success of playing all the steps:
   * true if they all played successfully, false if one failed.
   * @param {Test} test the test to play
   * @param {number} startIndex the index we start playing from
   * @param {boolean} resume if true we do not drive this step, just check it
   * @param {boolean} firstTest if true this is the first test in the play loop
   * */
  async play(test, startIndex = 0, resume = false, firstTest = false) {
    this._stopPlaying = false;

    await loadOptions();
    let actions = test.steps; // short alias

    if (options.maxNumberOfActionsToPrehydrate) {
      await this._hydrate(
        actions,
        startIndex,
        startIndex + options.maxNumberOfActionsToPrehydrate
      );
    }

    // start timer
    let start;
    let stop;
    let next;
    /**
     * the wallclock time of the current action
     */
    let eta;
    let action;
    let i = startIndex;
    for (i = startIndex; i < actions.length - 1; ++i) {
      eta = performance.now();

      action = actions[i];
      action._view = constants.view.EXPECTED;

      // free up memory from clean steps we've played.
      if (i > 0 && !actions[i - 1].dirty) {
        actions[i - 1].dehydrateScreenshots();
      }

      next = actions[i + 1];
      next._match = constants.match.PLAY;
      let mustVerifyScreenshot =
        next.expectedScreenshot && !next.shadowDOMAction;
      if (mustVerifyScreenshot) {
        next._lastTimeout = next.maxVerifyTimeout || options.MAX_VERIFY_TIMEOUT;
        document.documentElement.style.setProperty(
          '--screenshot-timeout',
          `${next._lastTimeout}s`
        ); // how long the waiting animation runs for this action
      }
      if (this.onBeforePlay) {
        await this.onBeforePlay(action); // this shows the correct step (and will start the waiting animation)
      }

      // if the action has a breakpoint, we want to bail immediately, unless
      // this is the very first action of the firstTest in the loop.
      if (action.breakPoint && !(i === startIndex && firstTest)) {
        // the action has a breakpoint we do nothing and leave immediately
        next._match = constants.match.BREAKPOINT;
        next._view = constants.view.EXPECTED;
        break;
      }

      // if we are resume(ing) the first action, we are picking up from an error state, meaning we already
      // performed this action, we just need to put the mouse in the correct spot and
      // do the screen verification again
      if (resume && i === startIndex && action.type !== 'mousemove') {
        // not needed? it is already in the right spot?
        //await this.mousemove(this.mouseLocation);
      } else {
        // drive the action
        action.tab.chromeTab = this.tab.chromeTab; // just for debugging
        if (action != 'keys' && options.userMouseDelay) {
          console.log(
            `[step:${action.index + 1} tab:${action.tab.id}] wait ${
              options.userMouseDelay
            }ms before playing`
          );
          await sleep(options.userMouseDelay);
        }

        if (
          // optionally wait for overlays (and such) to _NOT_ be in the DOM
          action.type !== 'goto' &&
          options.waitForCssElementsToNotExistBeforeDriving &&
          !(await this.waitForElementsToNotExist(
            options.waitForCssElementsToNotExistBeforeDriving
          ))
        ) {
          next._match = constants.match.WRONG_ELEMENT;
          next._view = constants.view.EXPECTED;
          break;
        }

        console.log(
          `[step:${action.index + 1} tab:${action.tab.id}] begin play "${
            action.description
          }"`
        );
        await this[action.type](action); // really perform this in the browser (this action may start some navigations)
        console.log(
          `[step:${action.index + 1} tab:${action.tab.id}] end   play "${
            action.description
          }"`
        );
      }
      delete action.pixelDiffScreenshot; // save a lttle memory. I don't need to hang onto calculatable previous step data

      // grep for FOCUS ISSUE for details
      if (i === startIndex && action.type === 'goto') {
        await this.mousemove({ x: 0, y: 0 });
        await this.mousemove({ x: -1, y: -1 });
      }

      start = performance.now();
      if (!mustVerifyScreenshot) {
        next._match = constants.view.PASS;
      } else {
        await this.verifyScreenshot({ step: next });
      }
      stop = performance.now();

      action.latency = Math.round(stop - start); // in ms

      // clear out old data
      next.latency = 0;
      next.memoryUsed = 0;
      action._view = constants.view.EXPECTED;

      if (next._match === constants.match.FAIL) {
        console.debug(
          `\t\tscreenshots still unmatched after ${stop - start}ms`
        );
        if (
          next.actualScreenshot.png.height !==
            next.expectedScreenshot.png.height ||
          next.actualScreenshot.png.width !== next.expectedScreenshot.png.width
        ) {
          await brimstone.window.alert(
            'Heads up, the expected viewport size does not match the actual viewport size.\n\nThis normally should not occur. Your recording may be corrupted.'
          );
        }
        next._view = constants.view.EDIT;
        break;
      }
      if (next._match === constants.match.CANCEL) {
        next._view = constants.view.EXPECTED;
        break;
      }

      console.debug(`\t\tscreenshot verified in ${stop - start}ms`);
      next._view = constants.view.EXPECTED;
      action.memoryUsed = await this.getClientMemoryByChromeApi();

      if (this.onAfterPlay) {
        await this.onAfterPlay(action);
      }
      eta = performance.now() - eta;
      this._expectedActionPlayTime = Math.floor(
        (this._expectedActionPlayTime * this._playStreak + eta) /
          (this._playStreak + 1)
      );
      ++this._playStreak;
    } // end of for loop

    if (i < actions.length - 1) {
      // we broke out of the loop early
      action._view = constants.view.EXPECTED;
      this._stopPlaying = false;
      if (this.onAfterPlay) {
        await this.onAfterPlay(action);
      }
    }

    return next.index;
  }

  async goto(action) {
    console.debug('player: goto');
    if (action.url.startsWith('active tab')) {
      return; // we aren't realy navigating anywhere
    }

    // I want the navigation done before I exit here
    var resolveNavigationPromise;
    let navPromise = new Promise((resolve) => {
      resolveNavigationPromise = resolve;
    });
    chrome.webNavigation.onCompleted.addListener(function playerGotoNavCommit(
      details
    ) {
      chrome.webNavigation.onCompleted.removeListener(playerGotoNavCommit);
      resolveNavigationPromise(details);
    });
    await chrome.tabs.update(this.tab.chromeTab.id, {
      highlighted: true,
      active: true,
      url: action.url,
    });
    await navPromise; // the above nav is really done.
  }

  /** close the tab with the given url */
  async close(action) {
    // find the tab with the given url and close it
    let tab = Tab.getByVirtualId(action.tab.virtualId);
    if (tab) {
      await chrome.tabs.remove(tab.chromeTab.id);
    }
  }

  /**
   * Perform a user char action. this will produce
   * a keypress event back in the DOM.
   * @param {*} action
   */
  async keypress(action) {
    // simulate a keypress https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-dispatchKeyEvent
    let modifiers = 0;
    let event = action.event;
    let keycode = event.keyCode;

    modifiers |= event.altKey ? 1 : 0;
    modifiers |= event.ctrlKey ? 2 : 0;
    modifiers |= event.metaKey ? 4 : 0;
    modifiers |= event.shiftKey ? 8 : 0;

    if (modifiers === 0 || modifiers === 8) {
      // FIXME: Verify that [ENTER] prints correctly when in a textarea
      // https://stackoverflow.com/questions/1367700/whats-the-difference-between-keydown-and-keypress-in-net
      var printable =
        (keycode > 47 && keycode < 58) || // number keys
        keycode == 32 || // spacebar
        keycode == 13 || // return key(s) (if you want to allow carriage returns)
        (keycode > 64 && keycode < 91) || // letter keys
        (keycode > 95 && keycode < 112) || // numpad keys
        (keycode > 185 && keycode < 193) || // ;=,-./` (in order)
        (keycode > 218 && keycode < 223); // [\]' (in order)
      if (printable) {
        let msg = {
          type: 'char',
          code: action.event.code,
          key: action.event.key,
          text: keycode == 13 ? '\r' : action.event.key,
          unmodifiedtext: action.event.key,
          windowsVirtualKeyCode: keycode,
          nativeVirtualKeyCode: keycode,
        };
        await this.debuggerSendCommand('Input.dispatchKeyEvent', msg);
      }
    }
  }

  async wait(action) {
    if (action.event.milliseconds) {
      await sleep(action.event.milliseconds);
    }
  }

  pollscreen(action) {
    return; // 'nuff said
  }

  async dblclick(action) {
    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: action.x,
      y: action.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'mouse',
    });
    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: action.x,
      y: action.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'mouse',
    });
    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: action.x,
      y: action.y,
      button: 'left',
      buttons: 1,
      clickCount: 2,
      pointerType: 'mouse',
    });
    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: action.x,
      y: action.y,
      button: 'left',
      buttons: 1,
      clickCount: 2,
      pointerType: 'mouse',
    });
  }

  async _mouseclick(action, args) {
    // simulate a click https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-dispatchMouseEvent
    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: action.x,
      y: action.y,
      button: args.button,
      buttons: args.buttons,
      clickCount: 1,
      pointerType: 'mouse',
    });
    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: action.x,
      y: action.y,
      button: args.button,
      buttons: args.buttons,
      clickCount: 1,
      pointerType: 'mouse',
    });
  }

  async contextmenu(action) {
    return this._mouseclick(action, { button: 'right', buttons: 2 });
  }

  async click(action) {
    return this._mouseclick(action, { button: 'left', buttons: 1 });
  }

  async mousemove(action) {
    // console.debug(`player: dispatch mouseMoved (${action.x},${action.y})`);
    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: action.x,
      y: action.y,
      pointerType: 'mouse',
    });

    // remember the last known mouse location
    // this.mouseLocation = {
    //     x: action.x,
    //     y: action.y
    // };
  }

  async mouseover(action) {
    return await this.mousemove(action);
  }

  async wheel(action) {
    console.debug(`player: dispatch mouseWheel from ${action.x}, ${action.y}`);
    let modifiers = 0;
    let event = action.event;

    modifiers |= event.altKey ? 1 : 0;
    modifiers |= event.ctrlKey ? 2 : 0;
    modifiers |= event.metaKey ? 4 : 0;
    modifiers |= event.shiftKey ? 8 : 0;

    await this.debuggerSendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: action.x,
      y: action.y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      pointerType: 'mouse',
      modifiers: modifiers,
    });
  }

  async wheels(action) {
    for (let i = 0; i < action.event.length; ++i) {
      let wheelAction = action.event[i];
      await this[wheelAction.type](wheelAction);
    }

    // FIXME: why does the wheel event kill these?
    // try to get the the last location the mouse is over to register for hover effects
    // await this.mousemove({
    //     x:-1,
    //     y:-1
    // });
    // let last = action.event[action.event.length-1];
    // await this.mousemove({
    //     x: last.clientX,
    //     y: last.clientY
    // });
  }

  async keyup(action) {
    let modifiers = 0;
    let event = action.event;

    modifiers |= event.altKey ? 1 : 0;
    modifiers |= event.ctrlKey ? 2 : 0;
    modifiers |= event.metaKey ? 4 : 0;
    modifiers |= event.shiftKey ? 8 : 0;

    await this.debuggerSendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: modifiers,
      code: event.code,
      key: event.key,
      windowsVirtualKeyCode: event.keyCode,
      nativeVirtualKeyCode: event.keyCode,
    });
  }

  /**
   * Simulate the a change of a select dropdown.
   */
  async change(action) {
    // FIXME: I need to run this in the correct frame!
    let frames;
    let errorMessage;
    frames = await chrome.scripting.executeScript({
      target: { tabId: this.tab.chromeTab.id /*, frameIds: frameIds*/ },
      function: _changeSelectValue,
      args: [action.x, action.y, action.event.value],
    });
    errorMessage = frames[0].result;

    while (errorMessage) {
      if (errorMessage.startsWith('attempt to change non-select element')) {
        let retry = await brimstone.window.confirm(
          `${errorMessage}\n\nTranslation: The screen looks right, but the wrong DOM element received the last action. This can happen if the app uses a transparent blocking element for example. \n\nRetry?`
        );
        if (retry) {
          frames = await chrome.scripting.executeScript({
            target: { tabId: this.tab.chromeTab.id /*, frameIds: frameIds*/ },
            function: _changeSelectValue,
            args: [action.x, action.y, action.event.value],
          });
          errorMessage = frames[0].result;
          continue;
        }
      }
      await brimstone.window.error(new Error(errorMessage)); // I'd want to know that.
    }

    // used in conjustion with the inscript focus to hit escape on the SELECT.
    let escapeKey = {
      event: {
        keyCode: 27,
        code: 'Escape',
        key: 'Escape',
      },
    };

    await this.keydown(escapeKey);
    await this.keyup(escapeKey);
  }

  // FIXME: I don't think I ever record this event, so no need to play it
  async scroll(action) {
    // FIXME: I need to run this in the correct frame!
    let frames = await chrome.scripting.executeScript({
      target: { tabId: this.tab.chromeTab.id /*, frameIds: frameIds*/ },
      function: _scroll,
      args: [
        action.x,
        action.y,
        action.event.scrollTop,
        action.event.scrollLeft,
      ],
    });
    let errorMessage = frames[0].result;

    if (errorMessage) {
      throw new Error(errorMessage); // I'd want to know that.
    }
  }

  /**
   * will perform a keydown action and a keypress(char) action for any printable key other than Enter.
   * @param {*} action
   */
  async keydown(action) {
    let modifiers = 0;
    let event = action.event;
    let keycode = event.keyCode;

    modifiers |= event.altKey ? 1 : 0;
    modifiers |= event.ctrlKey ? 2 : 0;
    modifiers |= event.metaKey ? 4 : 0;
    modifiers |= event.shiftKey ? 8 : 0;

    await this.debuggerSendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers: modifiers,
      code: event.code,
      key: event.key,
      windowsVirtualKeyCode: keycode,
      nativeVirtualKeyCode: keycode,
    });
    if (event.key !== 'Enter' && (modifiers === 0 || modifiers === 8)) {
      this.keypress(action);
    }
  }

  /**
   * For each keyevent (keydown, keyup, and possibly keypress only for 'Enter')
   * in the array generate the corresponding user action.
   * @param {*} action
   */
  async keys(action) {
    for (let i = 0; i < action.event.length; ++i) {
      let event = action.event[i];
      // simulate slower typing
      if (options.userKeypressDelay && event.type === 'keydown') {
        await sleep(options.userKeypressDelay);
      }
      await this[event.type]({ event }); // pretend it is a distinct action
    }
  }

  /**
   * Get the version of this application under test by
   * getting all text under the pointed to element.
   * I wish I could defer this to a user supplied script, but
   * that's not an option with MV3. :(
   * @param {TestAction} action
   */
  async getVersion(action) {
    function _getText(x, y) {
      try {
        var element = document.elementFromPoint(x, y);
        return { textContent: element.textContent };
      } catch (e) {
        return e.message;
      }
    }

    let frames = await chrome.scripting.executeScript({
      target: { tabId: this.tab.chromeTab.id /*, frameIds: frameIds*/ },
      function: _getText,
      args: [action.x, action.y],
    });
    let result = frames[0].result;
    if (!result) {
      throw new Error('Nothing returned from getVersion');
    }
    if (result.textContent) {
      BDS.Test.applicationVersion = result.textContent;
    } else {
      throw new Error(JSON.stringify(result));
    }
  }

  /**
   * Called after we play the current action.
   *
   * Repeatedly check the expected screenshot required to start the next action
   * against the actual screenshot.
   *
   * @param {object} args Destructured arguments
   * @param {TestAction} args.step The step
   * @param {number} args.max_attempts The max number of iterations to check the screenshot
   * @param {boolean} args.fastFail Should the pixelmatch fail on the first mismatching pixel?
   */
  async verifyScreenshot({ step, max_attempts = 100000000 }) {
    let nextStep = step;
    let start = performance.now();

    let i = 0;
    let badTab = false;

    let attemptAutocorrect =
      Correction.availableInstances.length && options.autoCorrect;

    // this loop will run even if the app is in the process of navigating to the next page.
    while (
      (performance.now() - start) / 1000 < nextStep._lastTimeout &&
      i < max_attempts
    ) {
      if (this._stopPlaying) {
        // asyncronously injected by user clicking the play button again
        nextStep._match = constants.match.CANCEL;
        return;
      }
      ++i;

      delete step.actualScreenshot; // if the last time through we were able to take a screenshot or not

      // FIXME: why can this.tab.height != nextStep.expectedScreenshot.png.height ??
      // 1. The debugger attach banner is in flux during a navigation. expected to be handled this way.
      // 2. The original resize to accomodate the debug banner didn't work. I think this is occurring on my laptop
      //    because the window snap-to function is re-snapping and making the window smaller again after I do increase its size.
      // warn on this case better? Eventually this is detectable.

      // If I move it out of the snap region the resize does happen, but then the screenshot taken is too big! Because I am
      // using REAL tab height which already includes the debug banner.

      // these parameters are here to resize the friggin screen in the first place - so png height is right? why did I ever switch the
      // tab sizes in the first place??
      try {
        // If the next action is on a different tab, then we need to switch to that tab to
        // take the screenshot.
        if (nextStep.tab.virtualId !== this.tab.virtualId) {
          await this.configureForAction(nextStep);
        }
        // this is a little weird, I can check for the correct tab + tab size before hand, but it's more efficient to
        // assume that it will work, than to check every time. make the common case fast.
        if (badTab) {
          badTab = false;
          await this.tab.resizeViewport();
        }
        nextStep.actualScreenshot = await this._takeScreenshot();
      } catch (e) {
        console.debug(e);
        badTab = true;
        // give other async'ed control paths a chance to run. configureForAction above can be trying to wait for a different tab to become active.
        await sleep(options.verifyScreenshotTakeScreenshotRetryTimeout);
        continue;
      }

      nextStep.calculatePixelDiff({ fastFail: !attemptAutocorrect }); // can't fast fail if auto correct because we use the whole diffPng in checking applicability of the correction
      if (nextStep._match !== constants.match.FAIL) {
        return;
      }

      // if it failed and auto correct is on - auto correct it right now if possible.
      if (attemptAutocorrect) {
        let correctionApplied = false;
        Correction.availableInstances.forEach((correction) => {
          if (options.autoCorrect && correction.matches(nextStep)) {
            // console.log('autocorrect', correction.condition.screenshot.dataUrl); // great for seeing the correction applied
            correction.apply(nextStep);
            nextStep.dirty = true;
            correctionApplied = true;
          }
        });
        if (correctionApplied) {
          nextStep.calculatePixelDiff({ fastFail: false });
          if (nextStep._match !== constants.match.FAIL) {
            this.lastAutoCorrectedStepNumber = nextStep.index + 1;
            return; // auto correct fixed it for us
          }
          // else - it didn't fix it all.
        }
      }

      // it didn't match so we loop. I should be able to throttle the rate at which I take screenshots, but do I NEED to?
      await sleep(options.verifyScreenshotRetryComparisonTimeout);
    }

    // The screenshots apparently don't match
    if (!attemptAutocorrect) {
      // do a final (complete) check to get all different data, i.e. don't fastFail out of the diff
      nextStep.calculatePixelDiff({ fastFail: false });
      if (nextStep._match !== constants.match.FAIL) {
        // the loop timed out just as the screen got in the correct state.
        return;
      }
    }

    // The screenshots really don't match.
    nextStep._match = constants.match.FAIL;

    // we can get out of the above loop without actually doing the comparison, if taking the screenshot keeps failing.
    if (!nextStep.actualScreenshot) {
      throw new Error('Unable to create screenshot');
    }
  }

  /**
   * Uses the debugger API to capture a screenshot.
   * Returns a Screenshot on success. Most calls are
   * to update the expected screen during recording,
   * but is also called in one path for playback inside
   * of verifyScreenshot.
   *
   * @throws {DebuggerDetached} on debugger detach errors that can't be fixed with a single attach
   * @throws {IncorrectScreenshotSize} on failure.
   * @throws {Error} on unknown errors
   */
  async captureScreenshot() {
    let result = await this.debuggerSendCommand('Page.captureScreenshot', {
      format: 'png',
    });
    // result can come back undefined/null. (e.g. debugger not attached, or can detach while the command is in flight)
    let ss = new Screenshot({
      dataUrl: 'data:image/png;base64,' + result.data,
      tab: this.tab,
    });

    if (this.tab.blessed) {
      // since the tab size was blessed by the user we need to check the screenshot size
      let expectedWidth = this.tab.width;
      let expectedHeight = this.tab.height;
      if (
        expectedWidth &&
        (expectedWidth !== ss.dataUrlWidth ||
          expectedHeight !== ss.dataUrlHeight)
      ) {
        throw new Errors.IncorrectScreenshotSize(
          `wrong screenshot size taken. required ${expectedWidth}x${expectedHeight} got ${ss.dataUrlWidth}x${ss.dataUrlHeight}.`
        );
      }
    }

    // else we got a screenshot of the size we require (or we don't care about the size)
    return ss;
  }

  /**
   * Take a screenshot of an expected size. May attempt to resize the viewport as well.
   * This is a private method that is only expected to be called by verifyScreenshot (during playback).
   * Throws exception if the size of the png doesn't match the expected size,
   * allows caller to resize then.
   *
   * @param {number} expectedWidth expected width of screenshot
   * @param {number} expectedHeight expected height of screenshot
   * @returns Screenshot on success
   * @throws {Error} on unknwon errors
   * @throws {DebuggerDetached} on deached debugger that wasn't fixed with a reattach
   * @throws {IncorrectScreenshotSize} when a blessed tab captures the wrong screensize
   */
  async _takeScreenshot() {
    // unthrottled.
    let ss = await this.captureScreenshot();
    ss.png; // build the PNG too in this case, right now.
    console.debug(`took screenshot ${ss.dataUrlWidth}x${ss.dataUrlHeight}`);
    return ss;
  }

  /**
   * Send the command to the debugger on the current tab.
   * Returns command result on success.
   * @throws {DebuggerDetached} on debugger detch errors
   * @throws {Error} on unknown errors
   */
  async _debuggerSendCommandRaw(method, commandParams) {
    await this._debuggerAttached;
    console.debug(
      `begin debugger send command tabId:${this.tab.id} ${method}`,
      commandParams
    );
    let result = await new Promise((resolve) =>
      chrome.debugger.sendCommand(
        { tabId: this.tab.chromeTab.id },
        method,
        commandParams,
        resolve
      )
    );
    let message = chrome.runtime.lastError?.message;
    if (message) {
      if (
        message.includes('Detached while') ||
        message.includes('Debugger is not attached')
      ) {
        throw new Errors.DebuggerDetached(message);
      }
      throw new Error(message);
    }
    console.debug(`end   debugger send command ${method}`, commandParams);
    return result; // the debugger method may be a getter of some kind.
  }

  /**
   * Force (re)attach the debugger (if necessary) and send the command.
   * Returns command result on success.
   * @throws {DebuggerDetached} on debugger detach errors that cannot be fixed with an attach
   * @throws {Error} on unknown errors.
   */
  async debuggerSendCommand(method, commandParams) {
    let i = 0;
    var lastException;
    if (this.usedFor === 'recording') {
      commandParams.timestamp = Player.SYNTHETIC_EVENT_TIMESTAMP;
    }
    // when playing, there is no user input.

    for (i = 0; i < 2; ++i) {
      // at most twice
      try {
        return await this._debuggerSendCommandRaw(method, commandParams); // the debugger method may be a getter of some kind.
      } catch (e) {
        lastException = e;
        if (lastException instanceof Errors.DebuggerDetached) {
          console.warn(
            `got exception while running debugger cmd ${method}:`,
            commandParams,
            e
          );
          if (await this.attachDebugger({ tab: this.tab })) {
            await this.tab.resizeViewport();
          }

          if (this.usedFor === 'playing') {
            await sleep(options.debuggerSendCommandOnPlayRetryTimeout);
          }
        } else {
          console.warn(
            `got exception while running debugger cmd ${method}:`,
            commandParams,
            e
          );
          throw lastException;
        }
      }
    }
    if (i == 2) {
      throw lastException;
    }
  }

  /**
   * Schedule attaching the debugger to the given tab.
   * Returns if an attach was atually performed.
   * @param {{tab: Tab}}
   */
  async attachDebugger({ tab }) {
    console.debug(`schedule attach debugger`);
    return (this._debuggerAttached = new Promise(async (resolve, reject) => {
      await new Promise((_resolve) =>
        chrome.debugger.attach({ tabId: tab.chromeTab.id }, '1.3', _resolve)
      );
      if (chrome.runtime.lastError?.message) {
        if (
          !chrome.runtime.lastError.message.startsWith(
            'Another debugger is already attached'
          )
        ) {
          reject(
            new Errors.DebuggerAttachError(chrome.runtime.lastError.message)
          ); // not sure how to handle that.
          return;
        }
        // else we can ignore that, that's what we want, we are already attached
        console.debug(`debugger already attached to tabId:${tab.chromeTab.id}`);
        this.tab = tab;
        resolve(false); // an attach was not required
        return;
      } else {
        // else no error - implies that we actually needed to attach the debugger
        console.debug(`debugger was attached to tab:${tab.chromeTab.id}`);
        this.tab = tab;
        resolve(true); // an attach was required
        return;
      }
    }));
  }

  /** stop the player from playing. any control after an awaited instruction will
   * check this and return control.
   */
  stopPlaying() {
    /** used to async cancel a playing test */
    this._stopPlaying = true;
  }

  /**
   *
   * @returns {number} MBs used in the heap
   */
  async getClientMemoryByChromeApi() {
    let frames = await chrome.scripting.executeScript({
      target: { tabId: this.tab.chromeTab.id },
      function: getMemory,
      args: [options.clearConsoleBeforeMeasuringMemory],
    });

    let memory = frames[0].result;
    return Math.ceil(memory.usedJSHeapSize / Math.pow(2, 20)); // MB
  }
}

/**
 * This is how i distiguish sythetic events from user events in the recorder.
 * And only 0 works?!
 */
Player.SYNTHETIC_EVENT_TIMESTAMP = 0;
