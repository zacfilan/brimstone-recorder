'use strict';

import { Player } from '../player.js';
import { Tab } from '../tab.js';
import * as iconState from '../iconState.js';
import { BoundingBox, Correction, Rectangle } from '../rectangle.js';
import {
  sleep,
  downloadObjectAsJson,
  downloadHtmlContent,
  clone,
  brimstone,
} from '../utilities.js';
import { disableConsole, enableConsole } from './console.js';
import {
  Test,
  PlayTree,
  TestAction,
  getCard,
  constants,
  Step,
} from '../test.js';
import { Screenshot } from './screenshot.js';
import { loadOptions, saveOptions, options } from '../options.js';
import * as Errors from '../error.js';
import { MenuController } from './menu_controller.js';
import * as BDS from './brimstoneDataService.js';
import { infobar } from './infobar/infobar.js';
import { ActionGutter } from './actionGutter/actionGutter.js';
import * as extensionInfo from './extensionInfo.js';

/** used by the action gutter callbacks to keep it clean */
let seqNum = 0;
// instantiate some components
let actionGutter = new ActionGutter({
  element: '#actionGutter',
  click: async function gotoStepFromThumb(e) {
    let index = parseInt($(e.currentTarget).attr('index'));
    let action = Test.current.steps[index];
    let step = new Step({ curr: action, test: Test.current });
    await setStepContent(step);
  },
  mouseenter: async function showThumbnail(e) {
    let id = ++seqNum;
    $('#thumbNail').remove();
    let $button = $(e.currentTarget);
    let index = parseInt($button.attr('index'));
    let action = Test.current.steps[index];

    if (
      action.expectedScreenshot &&
      !action.expectedScreenshot.dataUrl &&
      action.expectedScreenshot.zipEntry
    ) {
      await action.expectedScreenshot.loadDataUrlFromZip();
    }
    if (id !== seqNum) {
      return; // this was reentered before this instance got here
    }
    let $thumb = $(action.toThumb());
    $thumb.css({
      left: $button[0].offsetLeft - this.actionGutter[0].scrollLeft + 'px',
    });
    this.thumbGutter.append($thumb[0]);
  },
  mouseleave: () => {
    $('#thumbNail').remove();
  },
});

const ALT_KEYCODE = 18;
const META_KEYCODE = 91;
const CTRL_KEYCODE = 17;
const SHIFT_KEYCODE = 16;

const keycode2modifier = {};
keycode2modifier[ALT_KEYCODE] = 1;
keycode2modifier[CTRL_KEYCODE] = 2;
keycode2modifier[META_KEYCODE] = 4;
keycode2modifier[SHIFT_KEYCODE] = 8;
const PNG = png.PNG;

/**
 * Used to remember what tabs are open, and the order they opened.
 * Then when a tab is closed, I can re-attach the debugger to the previous tab.
 */
Tab.reset();

/**
 * The current test in memory.
 * @type {Test}
 */
Test.current = new Test();
window.document.title = `Brimstone - ${Test.current._playTree.path()}`;

const player = new Player();
/** used to *not* record pre-requisite screenshots when in the shadowDOM. */
var shadowDOMScreenshot = 0;

async function focusOrCreateTab(url) {
  let [tab] = await chrome.tabs.query({ url });
  if (!tab) {
    tab = await chrome.tabs.create({ url });
  } else {
    await chrome.tabs.update(tab.id, { active: true });
  }
  await chrome.windows.update(tab.windowId, { focused: true });
}

/**
 * Controller for the workspace.
 * Container for all the things
 * the user can do in the UI
 */
class Workspace {
  _modalClosed; // function to resolve a promise externally

  /** lastAction executed */
  nameOfLastMethodExecuted;

  /**
   * last user action executed
   */
  nameOfLastUserActionExecuted;

  async clearAllowedDifferences() {
    let correctedActions = Test.current.steps.filter(
      (s) => s.acceptablePixelDifferences
    );
    if (correctedActions.length) {
      let ok = await brimstone.window.confirm(
        `Clear acceptable pixel dfference corrections made from ${correctedActions.length} action(s) in test '${Test.current.filename}'?`
      );
      if (ok) {
        for (let i = 0; i < correctedActions.length; ++i) {
          let action = correctedActions[i];
          delete action.acceptablePixelDifferences;
          action.dirty = true;
        }
        delete PlayTree.complete.uniqueZipFilenames[Test.current.filename];
      }
    }
  }

  /**
   * load every different test in the suite and
   * then clear the data from it.
   */
  async clearAllowedSuiteDifferences() {
    // create a unique list of zipnode filenames
    PlayTree.complete.uniqueZipFilenames = {};
    for (let i = 0; i < zipNodes.length; ++i) {
      let zipNode = zipNodes[i];
      PlayTree.complete.uniqueZipFilenames[zipNode._fileHandle.name] = true;
    }
    await this.clearAllowedDifferences(); // clear the one we are on right now
  }

  /** go to the first zip in the list */
  async gotoFirstZip() {
    await loadTest(1);
  }

  /** go to the previous zip in the list */
  async gotoPrevZip() {
    await loadTest(currentTestNumber - 1);
  }

  /** goto the next zip in the list */
  async gotoNextZip() {
    await loadTest(currentTestNumber + 1);
  }

  /** goto the last zip in the test */
  async gotoLastZip() {
    await loadTest(zipNodes.length);
  }

  /**
   * Pass in another method of this class.
   * Track it as being called from a user gesture.
   * @param {function} method
   * @returns
   */
  async callMethodByUser(method, ...args) {
    this.nameOfLastUserActionExecuted = method.name;
    return await method.call(this, ...args);
  }

  async callMethodNameByUser(methodName, ...args) {
    this.nameOfLastUserActionExecuted = methodName;
    return await this[methodName](...args);
  }

  /**
   * Pass in another method of this class.
   * Track it as being executed.
   * @param {function} method
   * @returns
   */
  async callMethod(method) {
    this.nameOfLastMethodExecuted = method.name;
    return await method.call(this);
  }

  async openOptions() {
    await focusOrCreateTab(chrome.runtime.getURL('options_ui.html'));
  }

  /** try to record without specifying a URL */
  async recordActiveTab() {
    if (options.clearWorkspaceBeforeRecordingActiveTab) {
      await this.clearWorkspace();
    }
    await recordSomething(false); // this can start a new recording of the the active tab (no initial goto url)
  }

  async exit() {
    try {
      let w = await new Promise((resolve) =>
        chrome.windows.getCurrent(null, resolve)
      ); // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
      await chrome.windows.remove(w.id);
    } catch (e) {
      console.log(e);
    }
  }

  async about() {
    await focusOrCreateTab(
      'https://github.com/zacfilan/brimstone-recorder/wiki'
    );
  }

  async openWiki() {
    await focusOrCreateTab(
      'https://github.com/zacfilan/brimstone-recorder/wiki/User-Guide'
    );
  }

  async openIssues() {
    await focusOrCreateTab(
      'https://github.com/zacfilan/brimstone-recorder/issues'
    );
  }

  async togglePageOrientation() {
    let c = $('.card')[1]?.getBoundingClientRect();
    if (!c) {
      return;
    }
    // console.log('----\nBEGIN');
    // console.log(`card is ${c.width}x${c.height}`);
    // console.log(`window is ${window.outerWidth}x${window.outerHeight}`);
    // //c.height += (1 + 12) * 2; // border and padding
    //c.width += (1 + 12) * 2; // border and padding

    if ($('body').hasClass('vertical')) {
      // we are vertical but the user thinks it might look better to go horizontal
      // we need to increase the width by the current cardsize
      //      console.log('vertical -> horizontal');
      window.resizeTo(
        window.outerWidth + c.width,
        window.outerHeight - c.height
      );
      $('body').removeClass('vertical');
      await saveOptions({
        verticalLayout: false,
      });
    } else {
      console.log('horizontal -> vertical');
      window.resizeTo(
        window.outerWidth - c.width,
        window.outerHeight + c.height
      );
      $('body').addClass('vertical');
      await saveOptions({
        verticalLayout: true,
      });
    }
    // setTimeout(() => {
    //   c = $('.card.waiting .screenshot')[0].getBoundingClientRect();
    //   console.log('END');
    //   console.log(`card is ${c.width}x${c.height}`);
    //   console.log(`window is ${window.outerWidth}x${window.outerHeight}`);
    // }, 10);
  }

  /**
   * Prompt the user to select tests from the filesystem.
   * This will build, among other data structures {@link zipNodes}. */
  async loadTests() {
    zipNodes = [];
    currentTestNumber = 0;
    try {
      let tempFileHandles = await Test.loadFileHandles();
      if (!tempFileHandles?.length > 0) {
        return; // user changed mind.
      }
      PlayTree.complete = await new PlayTree().fromFileHandles(
        ...tempFileHandles
      );
      PlayTree.complete.depthFirstTraversal(zipNodes); // FIXME: add cycle check

      if (zipNodes.length) {
        PlayTree.stepsInZipNodes = 0;
        let indexOffset = 0;
        for (let i = 0; i < zipNodes.length; ++i) {
          zipNodes[i]._stepBaseIndex = indexOffset;
          indexOffset += zipNodes[i]._stepsInZipTest;
        }
        PlayTree.stepsInZipNodes = indexOffset;
        await loadTest(1);
      }
    } catch (e) {
      if (e instanceof Errors.TestLoadError) {
        await brimstone.window.alert(e);
      } else {
        throw e;
      }
    }
  }

  /** Let the user specify a directory under which all recordings/tests/playlists will be accessible */
  async loadLibrary() {
    await PlayTree.loadLibrary();
  }

  async downloadLastRunMetrics() {
    downloadObjectAsJson(lastRunMetrics, 'last_run_metrics');
  }

  async downloadLastRunReport() {
    // basically I just want to copy out the html of the step and stick it in a new container
    //let stepHtml = $('#step')[0].outerHTML;
    let response = await fetch(chrome.runtime.getURL(`ui/workspace.css`));
    let css = await response.text();
    let index = currentStepIndex();

    let actionView = Test.current.steps[index].toHtml({
      view: constants.view.ACTION,
    });

    let expectedView = Test.current.steps[index + 1].toHtml({
      view: constants.view.EXPECTED,
    });
    let actualView = Test.current.steps[index + 1].toHtml({
      view: constants.view.ACTUAL,
    });
    let editView = Test.current.steps[index + 1].toHtml({
      view: constants.view.EDIT,
    });

    let run = lastRunMetrics[lastRunMetrics.length - 1];
    let html = `
    <html>
      <head>
      <style>
        ${css}
      </style>
      </head>
      <body id="actionReport">
        <div id="title">Brimstone Run Report: Test '${Test.current._playTree.path()}'</div>
        <div class="cards">
          ${actionView}
          <div class="cardContainer">
            ${expectedView}
            ${actualView}
          </div>
          ${editView}
        </div>
      </body>
    </html>`;
    downloadHtmlContent(html, 'last_run_report');
  }

  /**
   * Report the results of the PlayTree (root node) played.
   * If the toplevel is a suite, a report for each child will be reported.
   * Else a single report will be reported.
   *
   * @param {boolean?} autoPostMetrics If true we will only post if the matching postMetricsOn* option is enabled.
   * If false we will blindly post the metrics.
   */
  async postLastRunMetrics(autoPostMetrics) {
    await loadOptions();

    // (re)-generate the results in the playtree
    let reports = lastRunMetrics;
    for (let i = 0; i < reports.length; ++i) {
      let report = reports[i];
      if (
        !autoPostMetrics ||
        (options.postMetricsOnFail && report.status === constants.match.FAIL) ||
        (options.postMetricsOnPass && report.status === constants.match.PASS)
      ) {
        $.ajax({
          type: 'POST',
          url: options.postMetricsEndpoint,
          data: JSON.stringify(report),
          contentType: 'application/json',
          success: function (result) {
            infobar.setText(
              `✅ results posted to ${options.postMetricsEndpoint}`
            );
            console.log(result);
          },
          error: function (jqXHR, textStatus, errorThrown) {
            brimstone.window.alert(
              `There was a problem posting last run's metrics.\n\nMore information may be available in devtools.`
            );
          },
        });
      }
      // else not run or some other crap
    }
  }

  /**
   * User clicked a button to apply their corrections that are
   * pending on the EDIT view.
   * @param {Event} e - the button clicked is avaiable in here
   * */
  async applyCorrections(e) {
    const { action, view } = getCard(
      $('#content .card:nth-of-type(2)')[0],
      Test.current
    );
    await action.applyCorrections(view, e);
    await updateStepInView(Test.current.steps[action.index - 1]);
    // autoplay if the user wants to and they took care of all the pixels.
    if (enableAutoPlayCheckbox.checked && action.numDiffPixels === 0) {
      this.callMethod(this.playSomething);
    } else {
      addVolatileRegions();
    }
  }

  /**
   * Called when we want to "start over".
   * All acceptable pixel differences are removed, and we recalculate the
   * pixel differences.
   *  */
  async undo() {
    // first click removes rectangles if they exist
    let rectangles = $('.rectangle');
    if (rectangles.length) {
      rectangles.remove();
      return;
    }

    // we need to purge the acceptablePixelDifferences (and all rectangles that might be drawn presently)
    const { view, action } = getCard('#content .waiting', Test.current);
    action.acceptablePixelDifferences = new Screenshot({
      png: new PNG({
        width: action.pixelDiffScreenshot.png.width,
        height: action.pixelDiffScreenshot.png.height,
      }),
      fileName: `step${action.index}_acceptablePixelDifferences.png`,
    }); // chuck whatever we got out.
    action.calculatePixelDiff();
    await updateStepInView(Test.current.steps[action.index - 1]);

    addVolatileRegions();
  }

  /**
   * Discard *everything* in the current workspace.
   * Nothing is retained.
   * */
  async clearWorkspace() {
    zipNodes = [];
    currentTestNumber = 0;
    await this.clearTest();
    Correction.availableInstances = [];
    delete PlayTree.complete;
  }

  /**
   * Test.current is removed from the workspace.
   *
   * This will prompt to save the test if it is dirty
   * */
  async clearTest() {
    if (Test.current.dirty) {
      let blobError;
      try {
        Test._saveBlob = await Test.current.createZipBlob();
      } catch (e) {
        blobError = e;
      }
      let result = await this.confirmModal(
        `File '${Test.current.filename}' has unsaved changes.`,
        'Save Changes',
        'Discard Changes'
      );
      if (result) {
        if (blobError) {
          throw blobError; // now we actually care if that failed
        }
        await Test.current.saveZipFile(Test._saveBlob);
      }
      // else don't care if there is an error or not
    }

    // The test instance is still linked to by the playtree, for reporting stuff, so free up what memory I can.
    Test.current.removeScreenshots();
    delete Test.current.actionCache;

    // be very careful here about deleting zipNode stuff.
    // if i delete the _zipTest then I lose the reporting info I built
    // if I delete the whole zipnode something else breaks
    // if I don't delete the zipNode I leak memory for something, but i forget what!
    // delete zipNodes[currentTestNumber - 1]?._zipTest; // remove this link to memory

    delete Test._saveBlob;
    ////

    // remove the cards
    // FIXME abstract this away in a Test instance
    Test.current = new Test();
    Tab.reset();
    lastRunMetrics = undefined;
    player.lastAutoCorrectedStepNumber = 0;

    setToolbarState();
    infobar.setText();
    window.document.title = `Brimstone - ${Test.current._playTree.path()}`;

    actionGutter.clean();

    $('#step').html(`<div id="content">
    <div class='card empty'></div>
    <div class='card empty'></div>
    </div>`);
    if (options.forgetCorrectionsWhenTestIsCleared) {
      Correction.availableInstances = [];
    }
  }

  /**
   * user gesture save the current test as a zip file */
  async saveZip() {
    Test._saveBlob = await Test.current.createZipBlob();
    let fileHandle = await Test.current.saveZipFile(Test._saveBlob);

    // the name may have changed
    if (fileHandle) {
      Test.current.filename = fileHandle.name;
      Test.current._playTree._fileHandle = fileHandle;
      window.document.title = `Brimstone - ${Test.current._playTree.path()}`;

      actionGutter.draw(Test.current.steps); // dirty and inserted tags are removed
      actionGutter.setCurrent(currentStepIndex());
    }
  }

  editActionJson() {
    const { action } = getCard(
      $('#content .card:first-of-type')[0],
      Test.current
    );
    var copy = clone(action); // pass a copy

    // don't allow edit of these
    delete copy.expectedScreenshot;
    delete copy.acceptablePixelDifferences;
    delete copy.actualScreenshot;

    var modalContentContainer = $('#modal-content').html('');
    var wrapper = $('<div class="content-wrapper"></div>');
    modalContentContainer.append(wrapper);
    var jsonEditorContainer = $("<div id='json-editor'></div>");
    wrapper.append(jsonEditorContainer);
    jsonEditor = new JSONEditor(jsonEditorContainer[0], {
      mode: 'form',
      onChangeJSON: (json) => {
        Object.assign(action, json);
        updateStepInView(action);
      },
    });
    jsonEditor.set(copy);
    modalContentContainer.modal();
  }

  viewTestJson() {
    var test = clone(Test.current); // pass a copy
    var modalContentContainer = $('#modal-content').html('');
    var wrapper = $('<div class="content-wrapper"></div>');
    modalContentContainer.append(wrapper);
    var jsonEditorContainer = $("<div id='json-editor'></div>");
    wrapper.append(jsonEditorContainer);
    jsonEditor = new JSONEditor(jsonEditorContainer[0], {
      mode: 'view',
    });
    jsonEditor.set(test);
    modalContentContainer.modal();
  }

  async chartMetrics() {
    let latencyValues = [];
    let memoryUsedValues = [];
    let labels = [];

    let index = 0;
    for (let ri = 0; ri < lastRunMetrics.length; ++ri) {
      let recording = lastRunMetrics[ri];
      for (let si = 0; si < recording.steps.length; ++si) {
        let step = recording.steps[si];
        labels.push(step.index + 1);
        memoryUsedValues.push(step.clientMemory);
        latencyValues.push(step.userLatency);
      }
    }

    let chartDescriptor = JSON.stringify({
      type: 'line',
      data: {
        labels: labels, // x-axis labels
        datasets: [
          {
            label: 'Latency (secs.)',
            borderColor: 'red',
            backgroundColor: 'white',
            fill: false,
            data: latencyValues,
            yAxisID: 'y',
          },
          {
            label: 'Memory (MBs)',
            borderColor: 'blue',
            backgroundColor: 'white',
            fill: false,
            data: memoryUsedValues,
            yAxisID: 'y1',
          },
        ],
      },
    });
    let window = await chrome.windows.create({
      url: chrome.runtime.getURL(`ui/chart.html?c=${chartDescriptor}`),
      type: 'popup',
    });
  }

  /** Delete the currently displayed user action */
  async deleteAction() {
    const { action } = getCard(
      $('#content .card:first-of-type')[0],
      Test.current
    );
    if (await Test.current.deleteAction(action)) {
      PlayTree.stepsInZipNodes--;
      // every zipNode past here needs it's offset decrements;

      let i = Math.min(action.index, Test.current.steps.length - 1);

      actionGutter.draw(Test.current.steps);
      actionGutter.setCurrent(currentStepIndex());

      await updateStepInView(Test.current.steps[i]);
    }
  }

  /** Delete all actions before this one. This one becomes index 0. */
  async deleteActionsBefore() {
    const { action } = getCard(
      $('#content .card:first-of-type')[0],
      Test.current
    );
    let i = action.index;
    if (await Test.current.deleteActionsBefore(action)) {
      PlayTree.stepsInZipNodes -= i;

      actionGutter.draw(Test.current.steps);
      actionGutter.setCurrent(currentStepIndex());

      await updateStepInView(Test.current.steps[0]);
    }
  }

  /** Delete all actions after this one. We keep one past this since it is the ending action.*/
  async deleteActionsAfter() {
    const { action } = getCard(
      $('#content .card:first-of-type')[0],
      Test.current
    );
    if (await Test.current.deleteActionsAfter(action)) {
      PlayTree.stepsInZipNodes -= Test.current.steps.length - action.index;

      actionGutter.draw(Test.current.steps);
      actionGutter.setCurrent(currentStepIndex());

      await updateStepInView(Test.current.steps[action.index]);
    }
  }

  /**
   * Insert a blank action before the current one. This along with recording over actions,
   * allows the user to insert newly recorded actions.
   */
  async insertActionAfter() {
    const { action } = getCard(
      $('#content .card:first-of-type')[0],
      Test.current
    );
    let next = Test.current.steps[action.index + 1];
    let newAction = await userEventToAction(
      {
        type: 'wait',
        sender: action.sender,
        tab: action.tab,
        expectedScreenshot:
          next?.expectedScreenshot && new Screenshot(next.expectedScreenshot),
        actualScreenshot:
          next?.actualScreenshot && new Screenshot(next.actualScreenshot),
        acceptablePixelDifferences:
          next?.acceptablePixelDifferences &&
          new Screenshot(next.acceptablePixelDifferences),
        test: Test.current,
        index: action.index + 1,
      },
      false
    );
    if (newAction.acceptablePixelDifferences) {
      newAction._match === constants.match.ALLOW;
    }
    await Test.current.insertAction(newAction);

    actionGutter.draw(Test.current.steps);
    actionGutter.setCurrent(currentStepIndex());

    await updateStepInView(newAction);
  }

  /** When clicking on an editable action, cycle through expected and actual views. */
  async cycleEditStates(e) {
    // flip the cards
    const { view, action } = getCard(e.currentTarget, Test.current);
    let index;
    switch (action._view) {
      case constants.view.EXPECTED: // expected -> actual
        action._view = constants.view.ACTUAL;
        if (!action.actualScreenshot) {
          action.actualScreenshot = new Screenshot(action.expectedScreenshot);
          action.actualScreenshot.fileName = '';
          if (action.acceptablePixelDifferences) {
            await action.acceptablePixelDifferences.hydrate(
              Test.current.zip?.folder('screenshots')
            );
          }
        } else {
          await action.actualScreenshot.hydrate(
            Test.current.zip?.folder('screenshots')
          );
        }
        await updateStepInView(Test.current.steps[action.index - 1]);
        break;
      case constants.view.ACTUAL: // actual -> expected
        action._view = constants.view.EXPECTED;
        await updateStepInView(Test.current.steps[action.index - 1]);
        break;
      case constants.view.EDIT: // edit -> expected
        action._view = constants.view.EXPECTED;
        await updateStepInView(Test.current.steps[action.index - 1]);
        break;
    }
  }

  /**
   * try to play
   */
  async playSomething() {
    await _playSomething();
  }

  /**
   * stop playing
   */
  async stopPlaying() {
    await _stopPlaying();
  }

  async alertModal(message, okText = 'OK') {
    let userButtonPress = new Promise((resolve) => {
      this._modalClosed = resolve;
    });

    let cs = $('#alertModal');
    cs.find('#message').text('🙋❗ ' + message);
    cs.find('.ok')
      .off('click')
      .on('click', () => {
        this._modalClosed(true);
      })
      .text(okText);

    cs.modal();
    return userButtonPress;
  }

  async confirmModal(message, okText = 'OK', cancelText = 'Cancel') {
    let userButtonPress = new Promise((resolve) => {
      this._modalClosed = resolve;
    });

    let cs = $('#confirmModal');
    cs.find('#message').text('🙋❓ ' + message);
    cs.find('.ok')
      .off('click')
      .on('click', () => {
        this._modalClosed(true);
      })
      .text(okText);

    cs.find('.cancel')
      .off('click')
      .on('click', () => {
        this._modalClosed(false);
      })
      .text(cancelText);

    cs.modal();
    return userButtonPress;
  }

  async promptModal(
    message,
    defaultValue,
    okText = 'OK',
    cancelText = 'Cancel'
  ) {
    let userButtonPress = new Promise((resolve) => {
      this._modalClosed = resolve;
    });

    let cs = $('#promptModal');
    cs.find('#message').text('🙋 ' + message);
    cs.find('input:text').val(defaultValue);

    cs.find('.ok')
      .off('click')
      .on('click', () => {
        this._modalClosed(cs.find('input:text').val());
      })
      .text(okText);

    cs.find('.cancel')
      .off('click')
      .on('click', () => {
        this._modalClosed('');
      })
      .text(cancelText);

    cs.modal();
    cs.find('input').focus().select();
    return userButtonPress;
  }

  async enableAutoPlayCheckbox(e) {
    $('.card.edit')
      .find('button[autoplay]')
      .each((index, button) => {
        button.setAttribute(
          'autoplay',
          enableAutoPlayCheckbox.checked ? 'true' : 'false'
        );
        let title = button.getAttribute('title');
        title = title.replace(' Autoplay.', '');
        if (enableAutoPlayCheckbox.checked) {
          title += ' Autoplay.';
        }

        button.setAttribute('title', title);
      }); // .attr() didn't work for me
    await saveOptions({ autoPlay: enableAutoPlayCheckbox.checked });
  }

  async enableAutoCorrectCheckbox(e) {
    $('#possibleCorrections').toggleClass(
      'hide',
      !!enableAutoCorrectCheckbox.checked
    );
    await saveOptions({ autoCorrect: !!enableAutoCorrectCheckbox.checked });
  }
  //#endregion workspace
}

const workspace = new Workspace();
const menuController = new MenuController(workspace);

async function errorHandler(e) {
  let workspaceWindow;
  switch (e.constructor) {
    case Errors.PixelScalingError:
      workspaceWindow = await brimstone.window.alert(
        `Pixel scaling detected. Brimstone cannot reliably compare scaled pixels. The Chrome window being recorded must be in an unscaled display, for the entire recording.\n\nSet your windows monitor display scale to 100%, or put Chrome in an unscaled display. Restart Chrome, try again.\n\nWorkspace will close when you hit [OK].`
      );
      try {
        await chrome.windows.remove(workspaceWindow.id);
      } catch (e) {
        console.log(e);
      }

      break;
    case Errors.ZoomError:
      workspaceWindow = await brimstone.window.alert(
        `Invalid chrome zoom factor detected. Brimstone cannot reliably compare zoomed pixels. Please insure that the Chrome "Settings"➜"Appearance"➜"Page zoom" is set to 100%.\n\nWorkspace will close when you hit [OK].`
      );
      try {
        await chrome.windows.remove(workspaceWindow.id);
      } catch (e) {
        console.log(e);
      }
      break;
    case Errors.ReuseTestWindow:
      await brimstone.window.alert(
        `You are trying to record into, or play from, the middle of an existing test, but there is no current Chrome test window that matches your current test requirements.`
      );
      break;
    case Errors.InvalidVersion:
      await brimstone.window.alert(e.message);
      break;
    case Errors.DebuggerAttachError:
      if (e.message === 'Cannot access a chrome:// URL') {
        await brimstone.window.alert(
          `Brimstone can't attach to chrome:// URLs by default. See chrome://flags/#extensions-on-chrome-urls if you really want to try.\n\nLast operation was cancelled.`
        );
        break;
      }
    case Errors.TestSaveError:
      await brimstone.window.alert(e.stack);
      break;
    case Errors.ConnectionError:
      await brimstone.window.alert(
        `Brimstone can't connect to a frame in the current tab. This can happen if there are advertisement frames in the tab. If this is the case use a strong ad blocker!\n\nYou may also need to configure your ad blocker to block everything, including "acceptable ads".`
      );
      break;
    default:
      await brimstone.window.error(e);
      break;
  }
}

// catch all unhandled promise rejections and report them. i.e. any throws that occur within a promise chain.
window.addEventListener(
  'unhandledrejection',
  async function (promiseRejectionEvent) {
    let reason = promiseRejectionEvent.reason;
    if (!reason.stack) {
      reason = new Error(reason); // the stack is useless :(
    }
    await errorHandler(reason);
    return false;
  }
);

window.addEventListener('error', async function (errorEvent) {
  await errorHandler(errorEvent.error);
  return false;
});

/** the jsoneditor instance used in the modal
 * https://github.com/josdejong/jsoneditor
 */
let jsonEditor;

/**
 * @type {string}
/**********************************************************************************************
 * Main entry point. - allow this extension in incognito please. it increases the likelyhood that a test
 * recorded by person user can be replayed by another, since they will use common localstorage,
 * and probably have less conflicting extensions.
 */
(
  async function main() {
    await loadOptions();
    if (options.verticalLayout) {
      $('body').addClass('vertical');
    }
    if (options.developerMode) {
      window.alert(
        `🐞🔨 Developer mode enabled. I suggest you attach the debugger with ctrl+shift+i. Then hit [OK] once devtools is open.`
      );
      await sleep(1000); // not sure why i wait here.
      let dbg = console.debug;
      // this mreserves the caller file/line, and appends a few spaces to the message
      console.debug = Function.prototype.bind.call(dbg, console, '  ');
      debugger;
    } else {
      disableConsole(); // can be reenabled in the debugger later
    }

    await extensionInfo.initialize();

    console.log(
      `created workspace window:(x:${window.screenX}, y:${window.screenY} size:${window.outerWidth}x${window.outerHeight})`
    );

    enableAutoCorrectCheckbox.checked = options.autoCorrect;
    enableAutoPlayCheckbox.checked = options.autoPlay;

    for (let i = 0; i < 3 && !options.installedOnAlias; ++i) {
      let installedOnAlias = await brimstone.window.prompt(
        'Please provide an identifier for this computer. It can be the real computer name or something else, e.g. "Zac\'s Laptop"'
      );
      await saveOptions({ installedOnAlias: installedOnAlias });
    }

    /** The id of the window that the user clicked the brimstone extension icon to launch this workspace. */
    // grab the parent window id from the query parameter
    const urlParams = new URLSearchParams(window.location.search);
    let _windowId = parseInt(urlParams.get('parent'), 10);

    let allowedIncognitoAccess = await new Promise((resolve) =>
      chrome.extension.isAllowedIncognitoAccess(resolve)
    );
    if (!allowedIncognitoAccess) {
      await brimstone.window
        .alert(`Extension requires manual user intervention to allow incognito. 
        
When you hit [OK] I'll try to navigate you to the correct page (chrome://extensions/?id=${chrome.runtime.id}).

On that page please flip the switch, "Allow in Incognito" so it\'s blue, and reopen this workspace.`);
      let w = await new Promise((resolve) =>
        chrome.windows.getCurrent(null, resolve)
      ); // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually

      let [activeChromeTab] = await chrome.tabs.query({
        active: true,
        windowId: _windowId,
      });
      await chrome.tabs.update(activeChromeTab.id, {
        url: `chrome://extensions/?id=${chrome.runtime.id}`,
        active: true,
        highlighted: true,
      });
      await chrome.windows.update(activeChromeTab.windowId, { focused: true });
      await chrome.windows.remove(w.id);
    }
    setToolbarState();
    infobar.setText();
    /**
     * We cannot use anything here that is asynchronous, because, "whatever". :(
     * Yet I wanna save data off that can only be saved with
     * an asynchronous api. What's a dude to do? I need to make a call synchronously
     * that under the covers can do some async things. This can be done with a
     * synchronous XMLHttpRequest(), as long as that request can do the async part.
     *
     * @param {*} event
     * @returns
     */
    const beforeUnloadListener = (event) => {
      if (Test.current.dirty) {
        // well crap... https://chromestatus.com/feature/5349061406228480
        event.returnValue = `🙋❓ File '${Test.current.filename}' has unsaved changes.\n\nExit without saving?`;

        event.preventDefault();
        return event.returnValue; // the confirm will be displayed
      }
      return false; // the confirm will not be displayed
    };

    window.addEventListener('beforeunload', beforeUnloadListener, {
      capture: true,
    });

    // reflect changes in the the options immediately
    chrome.runtime.onMessage.addListener(async function (
      request,
      sender,
      sendResponse
    ) {
      console.log(
        sender.tab
          ? 'message from a content script:' + sender.tab.url
          : 'message from the extension'
      );
      if (request.optionsChanged) {
        for (const [option, value] of Object.entries(request.optionsChanged)) {
          switch (option) {
            case 'windowLeft':
              window.moveTo(value, window.screenTop);
              break;
            case 'windowTop':
              window.moveTo(window.screenLeft, value);
              break;
            case 'windowWidth':
              window.resizeTo(value, window.outerHeight);
              break;
            case 'windowHeight':
              window.resizeTo(window.outerWidth, value);
              break;
            case 'developerMode':
              if (value) {
                enableConsole();
              } else {
                disableConsole();
              }
              break;
            case 'autoCorrect':
              enableAutoCorrectCheckbox.checked = value;
              break;
            case 'autoPlay':
              enableAutoPlayCheckbox.checked = value;
              break;
            case 'MAX_VERIFY_TIMEOUT':
              let i = currentStepIndex();
              if (i >= 0) {
                await updateStepInView(Test.current.steps[i]);
              }
              break;
          }
        }
      }
      sendResponse(true);
    });

    const trigger = 2;
    function checkAspect() {
      let r = window.outerWidth / window.outerHeight;
      let verticalLayout = options.verticalLayout;
      if (verticalLayout) {
        if (r > trigger) {
          // 4 times wider than tall, is "real horizontal", and currently vertical
          verticalLayout = false;
          $('body').removeClass('vertical');
        }
      } else {
        if (r < 1 / trigger) {
          // 4 times taller than wide and we are currently horizontal
          verticalLayout = true;
          $('body').addClass('vertical');
        }
      }
      return verticalLayout;
      // when the user makes it "real vertical" go vertical if it isn't yet
      // when the user makes it "real horizontal" go horzontail if it isn't yet
    }

    let throttled = false; // we are ignoring requests
    let locked = false; // we are processing a request currently
    let lastEventReceived = 0; // time stamp of the most recent time we got an event
    let lastEventCompleted = 0; // time stamp of the event we completed
    function handleResizeEvent() {
      if (!throttled && !locked) {
        locked = true;
        throttled = true;
        lastEventCompleted = lastEventReceived;
        let verticalLayout = checkAspect(); // might toggle the aspect ratio (which would generate another resize event)
        let options = {
          windowTop: window.screenY,
          windowLeft: window.screenX,
          windowWidth: window.outerWidth,
          windowHeight: window.outerHeight,
          verticalLayout: verticalLayout,
        };
        console.log(
          `windows resize: ${options.windowWidth}x${options.windowHeight} @ ${options.windowLeft},${options.windowTop}\n`
        );

        (async () => {
          await saveOptions(options);
          locked = false;

          if (lastEventCompleted !== lastEventReceived) {
            lastEventReceived = performance.now(); // assign it a new sequence number
            // an event came in after this one, so let's handle it in a moment
            throttled = false;
            setTimeout(handleResizeEvent, 100);
          } else {
            // set a timeout to un-throttle
            setTimeout(() => {
              throttled = false;
              if (lastEventCompleted !== lastEventReceived) {
                lastEventReceived = performance.now(); // assign it a new sequence number
                // an event came in after this one, so let's handle it in a moment
                handleResizeEvent();
              }
            }, 100);
          }
        })();
      } else {
        lastEventReceived = performance.now(); // a resize happened this timestamp that we didn't handle
      }
    }

    window.addEventListener('resize', handleResizeEvent);
  }
)();

async function countDown(seconds, action) {
  for (let i = seconds; i; --i) {
    action.overlay.html = i;
    await updateStepInView(Test.current.steps[action.index - 1]);
    await sleep(1000);
  }
  delete action.overlay;
  await updateStepInView(Test.current.steps[action.index - 1]);
}

/** The index of the first card showing in big step area */
function currentStepIndex() {
  let index = $('#content .card:first-of-type').attr('data-index');
  if (index) {
    return index - 0; // convert to number
  }
  return -1; // not found
}
/** Are we in the recording state? */
function isRecording() {
  return $('#recordButton').hasClass('active');
}

/** Are we in the playing state? */
function isPlaying() {
  return $('#playButton').hasClass('active');
}

/**
 * asynchronously updated "latest" view of the app
 * @type {Screenshot}
 * */
var _lastScreenshot;

/**
 * lock down the screen state at a point in time
 * @type {Screenshot}
 */
var _lastSavedScreenshot;

/**
 * Click on any correction button
 */
$('#step').on(
  'click',
  '#correctAsUnpredictable, #correctAsAntiAlias, #correctAsActual, #replaceExpectedWithActual',
  async (e) => {
    e.stopPropagation();
    await workspace.callMethodByUser(workspace.applyCorrections, e);
  }
);

$('#step').on('mouseenter', '#possibleCorrections', function (e) {
  const { action } = getCard(e.currentTarget, Test.current);
  // when the user hovers over the stamp it should show/reveal the last set of used rectangles
  // We must see which ones are in fact applicable. This would've/could've have been done during the last play of this action.
  Correction.applicableInstances = Correction.availableInstances.filter((c) =>
    c.matches(action)
  );
  if (!Correction.applicableInstances?.length) {
    possibleCorrections.disabled = true;
    possibleCorrections.parentNode.setAttribute(
      'title',
      'None of the available corrections\nmatch this screen.'
    );
  }

  let screenshot = $(this).closest('.card').find('.screenshot'); // FIXME: screenshot size != img size ??
  screenshot.addClass('relative-position');
  let image = screenshot.find('img')[0].getBoundingClientRect();
  let xscale = image.width / action.expectedScreenshot.png.width;
  let yscale = image.height / action.expectedScreenshot.png.height;

  Correction.applicableInstances.forEach((c) => {
    /**
     * append this rectangle into the given container
     */
    new Rectangle({
      x0: c.condition.x0 * xscale,
      y0: c.condition.y0 * yscale,
      x1: c.condition.x1 * xscale,
      y1: c.condition.y1 * yscale,
      container: screenshot[0],
      type: c.constructor.name,
      classes: 'possible',
    });
  });
});

let suggestionUsedTitleMsg = 'A suggested rectangle is shown.\n\n';

$('#step').on('mouseleave', '#correctionButtons', function (e) {
  $(this).closest('.card').find('.rectangle.suggestion').remove();
  $(this)
    .find('button')
    .each((index, e) => {
      e.title = e.title.replace(suggestionUsedTitleMsg, '');
    });
  $('.rectangle').removeAttr('type'); // manual rectangles are untyped until they hover over a correction type button again
});

function buildSuggestionRectangle(e, constructorName) {
  // when the user hovers over the iron it should help find the next cluster of red pixels and
  // put a smallish rectangle around it to help the user.
  const { action } = getCard(e.currentTarget, Test.current);
  if (
    !action.numDiffPixels ||
    $(this).closest('.card').find('.rectangle.manual').length
  ) {
    return;
  }

  let delta = action.pixelDiffScreenshot.png.data;
  let width = action.pixelDiffScreenshot.png.width;
  let height = action.pixelDiffScreenshot.png.height;

  let boundingBox = new BoundingBox();

  /** temp one, to see if the pixel will fit or not */
  let nextBoundingBox = new BoundingBox();

  if (!this.title.startsWith(suggestionUsedTitleMsg)) {
    this.title = suggestionUsedTitleMsg + this.title;
  }
  // scan for red pixels and buid up a rectangle that will cover (some of) them
  // the rectangle size is bounded.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      var idx = (action.pixelDiffScreenshot.png.width * y + x) << 2;

      let pixelIsRed =
        delta[idx + 1] === 0 && // trying to be clever (faster for no real need)
        delta[idx + 0] == 255 &&
        delta[idx + 2] === 0 &&
        delta[idx + 3] === 255;
      if (pixelIsRed) {
        nextBoundingBox = new BoundingBox(boundingBox);
        nextBoundingBox.accomodate({ x, y });

        if (nextBoundingBox.width > options.autoRectangleMaxWidth) {
          width = x; // we can't go any wider than that from now on.
        }
        if (nextBoundingBox.height > options.autoRectangleMaxHeight) {
          height = y; // we can't go any taller than that from now on.
          break; // quit this row
        }

        if (width !== x && height !== y) {
          // we accept that one
          boundingBox = nextBoundingBox;
        }
        // else we keep the old one and keep looking
      }
    }
  }

  boundingBox.addMargin(5);
  // the margin can cause the boundingbox to exceed the pixelDiffScreenshot boundary
  if (boundingBox.x1 >= action.pixelDiffScreenshot.png.width) {
    boundingBox.width = action.pixelDiffScreenshot.png.width - boundingBox.x0;
  }
  if (boundingBox.y1 >= action.pixelDiffScreenshot.png.height) {
    boundingBox.height = action.pixelDiffScreenshot.png.height - boundingBox.y0;
  }
  // (but the pixel itself must fit in there - since we found it in there :) )

  let screenshot = $(this).closest('.card').find('.screenshot'); // FIXME: screenshot size != img size ??
  screenshot.addClass('relative-position');
  let image = screenshot.find('img')[0].getBoundingClientRect();
  let xscale = image.width / action.expectedScreenshot.png.width;
  let yscale = image.height / action.expectedScreenshot.png.height;

  /**
   * append this rectangle into the given container
   */
  new Rectangle({
    x0: boundingBox.x0 * xscale,
    y0: boundingBox.y0 * yscale,
    x1: boundingBox.x1 * xscale,
    y1: boundingBox.y1 * yscale,
    container: screenshot[0],
    type: $(this).attr('data-constructor'),
    classes: 'suggestion',
  });
}

$('#step').on(
  'mouseenter',
  '#correctAsUnpredictable,#correctAsAntiAlias,#correctAsActual',
  function (e) {
    let rectangles = $('.rectangle');
    if (rectangles.length) {
      rectangles.attr('type', $(this).attr('data-constructor'));
      if (rectangles.hasClass('suggestion')) {
        if (!this.title.startsWith(suggestionUsedTitleMsg)) {
          this.title = suggestionUsedTitleMsg + this.title;
        }
      }
    } else {
      buildSuggestionRectangle.call(this, e);
    }
  }
);

$('#step').on('mouseleave', '#possibleCorrections', function (e) {
  // when the user hovers over the stamp it should remove/hide the last set of
  if (!Correction.availableInstances.length) {
    return;
  }
  let screenshot = $(this).closest('.card').find('.screenshot');
  screenshot.removeClass('relative-position');
  screenshot.find('.rectangle').remove();
});

$('#autoPlaySwitch').on('click', async (e) => {
  e.stopPropagation();
  await workspace.callMethodByUser(workspace.enableAutoPlayCheckbox, e);
});

$('#autoCorrectSwitch').on('click', async (e) => {
  e.stopPropagation();
  await workspace.callMethodByUser(workspace.enableAutoCorrectCheckbox, e);
});

$('#step').on('click', '#undo', async (e) => {
  e.stopPropagation();
  await workspace.callMethodByUser(workspace.undo);
});

$('#step').on('click', '.stopPropagation', async (e) => {
  e.stopPropagation();
});

$('#step').on('click', '[data-action="deleteAction"]', (e) => {
  e.stopPropagation();
  workspace.callMethodByUser(workspace.deleteAction);
});

// stop the image drag behavior
$('#step').on('mousedown', '.card.edit img', () => false);

let diffPromise = false;

/**
 * (Try to)
 * enable the ability to draw rectangles on the screenshot. */
function addVolatileRegions() {
  const { view, action } = getCard(
    $('#content .card.waiting')[0],
    Test.current
  );

  // can't add rectangles unless there are red pixels
  if (!action.numDiffPixels) {
    return;
  }

  let screenshot = view.find('.screenshot');
  // you can only draw rectangles if there are red pixels.

  Rectangle.setContainer(
    screenshot[0],
    () => {
      // if control gets here, we added an untyped rectangle, which can only happen if there are red pixels.
      // so, there are red pixels and an untyped rectangle is showing.
      $('#possibleCorrections').attr('disabled', true); // wand
      $('#correctAsUnpredictable').attr('disabled', false); // question mark
      $('#correctAsAntiAlias').attr('disabled', false); // iron
    },
    () => {
      console.debug('rectangle deleted');
    }
  );
  // adds to DOM temporarily
}

$('#step').on('change', '#actionMatchTimeout', (e) => {
  const { action } = getCard($('#content .card.waiting')[0], Test.current);
  action.maxVerifyTimeout = parseInt(e.target.value);
  action.dirty = true;
});

$('#step').on('click', '#editDifferencesButton', async (e) => {
  e.stopPropagation();
  const { action } = getCard($('#content .card.waiting')[0], Test.current);

  if (!action.actualScreenshot) {
    action.actualScreenshot = new Screenshot(action.expectedScreenshot);
    action.actualScreenshot.fileName = '';
    if (action.acceptablePixelDifferences) {
      await action.acceptablePixelDifferences.hydrate(
        Test.current.zip?.folder('screenshots')
      );
    }
  } else {
    await action.actualScreenshot.hydrate(
      Test.current.zip?.folder('screenshots')
    );
  }

  action._view = constants.view.EDIT;
  if (action.acceptablePixelDifferences) {
    await action.acceptablePixelDifferences.hydrate(
      Test.current.zip?.folder('screenshots')
    );
  }
  action.calculatePixelDiff();
  await updateStepInView(Test.current.steps[action.index - 1]);
  /** Add rectangles where we don't care about pixel differences. */
  addVolatileRegions();
});

/** change the name of the currently displayed action */
$('#step').on('change', '#editActionName', (e) => {
  const { action } = getCard($('#content .card.action')[0], Test.current);
  action.name = e.target.value;
  action.dirty = true;
});

$('#step').on('click', '.waiting .click-to-change-view', (...args) => {
  workspace.callMethodByUser(workspace.cycleEditStates, ...args);
});

function setToolbarState() {
  let clapperBoardButton = $('#recordActiveTab svg.emblem');
  if (options.clearWorkspaceBeforeRecordingActiveTab) {
    clapperBoardButton.addClass('delete');
    $('#recordActiveTab').prop(
      'title',
      'Clear workspace and record active tab right now'
    );
  } else {
    clapperBoardButton.removeClass('delete');
    $('#recordActiveTab').prop('title', 'Record active tab right now');
  }

  $('[data-action]').attr('disabled', true);
  $('.help.option [data-action]').attr('disabled', false);
  $('[data-action="openOptions"]').attr('disabled', false);
  $('[data-action="exit"]').attr('disabled', false);
  $('#togglePageOrientation').attr('disabled', false);

  $('[data-action="gotoFirstZip"]').attr('disabled', currentTestNumber <= 1);
  $('[data-action="gotoPrevZip"]').attr('disabled', currentTestNumber <= 1);
  $('[data-action="gotoNextZip"]').attr(
    'disabled',
    currentTestNumber === zipNodes.length
  );
  $('[data-action="gotoLastZip"]').attr(
    'disabled',
    currentTestNumber === zipNodes.length
  );

  let rb = $('#recordButton');
  if (rb.hasClass('active')) {
    // recording?
    $('#menu>.option').attr('disabled', true);
    rb.attr('disabled', false);
    rb.attr('title', 'Brimstone is recording.\nClick to stop.');
    iconState.Record();
    document.documentElement.style.setProperty('--action-color', 'red');
  } else {
    //not recording.
    rb.prop('title', 'Click to record.');
    let pb = $('#playButton');
    if ($('#playButton').hasClass('active')) {
      $('#menu>.option').attr('disabled', true);
      pb.attr('disabled', false);
      pb.prop('title', 'Brimstone is playing.\nClick to stop.');
      iconState.Play();
      document.documentElement.style.setProperty('--action-color', 'green');
    } else {
      pb.prop('title', 'Click to play.');
      // not playing, not recoding

      $('[data-action="loadTests"]').attr('disabled', false);
      $('[data-action="loadLibrary"]').attr('disabled', false);
      $('[data-action="recordActiveTab"]').attr('disabled', false);
      $('#menu>.option').attr('disabled', false);

      rb.attr('disabled', false);
      document.documentElement.style.setProperty('--action-color', 'blue');

      if (lastRunMetrics?.length) {
        $('.metrics.option [data-action]').attr('disabled', false); // everything under metrics
      }

      if (Test.current.steps.length) {
        $('[data-action="saveZip"]').attr('disabled', false);
        $('[data-action="clearWorkspace"]').attr('disabled', false);
        $('[data-action="clearAllowedDifferences"]').attr('disabled', false);
        $('[data-action="clearAllowedSuiteDifferences"]').attr(
          'disabled',
          false
        );

        $('.edit.option [data-action]').attr('disabled', false); // everything under edit
        $('[data-action="deleteAction"]').attr('disabled', false); // delete action icon on card

        let index = currentStepIndex();
        if (index > 0 || currentTestNumber > 1) {
          $('#previous').attr('disabled', false);
          $('#first').attr('disabled', false);
        }
        if (currentTestNumber > 1) {
          $('#gotoFirstZip').attr('disabled', false);
        }

        $('#playButton').attr('disabled', false);
        if (
          index < Test.current.steps.length - 1 ||
          currentTestNumber < zipNodes.length
        ) {
          $('#next').attr('disabled', false);
          $('#last').attr('disabled', false);
        }
        if (currentTestNumber < zipNodes.length) {
          $('#gotoLastZip').attr('disabled', false);
        }
      }

      iconState.Ready();
    }
  }
}

$('#togglePageOrientation').on('click', workspace.togglePageOrientation);

$('[data-action="openOptions"]').on('click', workspace.openOptions);

$('#gotoFirstZip').on('click', async function (e) {
  await loadTest(1);
  await updateStepInView(Test.current.steps[0]);
});

$('#first').on('click', async function (e) {
  let index = currentStepIndex();
  if (index > 0) {
    await updateStepInView(Test.current.steps[0]);
  } else if (currentTestNumber > 1) {
    // go back to first step of previous zip
    await loadTest(currentTestNumber - 1);
    await updateStepInView(Test.current.steps[0]);
  }
});

$('#previous').on('click', async function (e) {
  playMatchStatus = constants.match.PASS;
  let index = currentStepIndex();
  if (index > 0) {
    await updateStepInView(Test.current.steps[index - 1]);
  } else if (currentTestNumber > 1) {
    // go to last step of previous zip
    await loadTest(currentTestNumber - 1);
    await updateStepInView(Test.current.steps[Test.current.steps.length - 1]);
  }
});

/** Remember the state of the last play, so I can resume correctly. */
var playMatchStatus = constants.match.PASS;

$('#playButton').on('click', function (e) {
  // I use "this". So no lambda.
  let button = $(this);
  if (button.hasClass('active')) {
    workspace.callMethodByUser(workspace.stopPlaying);
    return;
  }
  workspace.callMethodByUser(workspace.playSomething);
});

/**
 * The metrics from the last run.
 * @type {BDS.Test[]}
 */
var lastRunMetrics;

/** play the current playnode */
async function _playSomething() {
  await loadOptions();
  try {
    let nextTest = true;
    let startingTab = await getActiveApplicationTab();

    for (let testPlayed = 0; nextTest; ++testPlayed) {
      nextTest = false;
      $('#playButton').addClass('active');
      setToolbarState();
      Test.current.lastRun = new BDS.Test();
      Test.current.lastRun.startDate = Date.now();
      Test.current.lastRun.name = Test.current.filename;
      Test.current.lastRun.startingServer =
        Test.current.startingServer || Test.current.steps[0].url;
      Test.current.lastRun.brimstoneVersion = extensionInfo.version;
      Test.current.lastRun.chromeVersion = extensionInfo.chromeVersion;

      let testActions = Test.current.steps;
      player.onBeforePlay = updateStepInView;
      player.onAfterPlay = updateStepInView;

      let playFrom = currentStepIndex(); // we will start on the step showing in the workspace.

      // we can resume a failed step, which means we don't drive the action just check the screenshot results of it.
      // this is used when the user fixes a failed step and wants to play from there.
      let resume =
        (playMatchStatus === constants.match.FAIL ||
          playMatchStatus === constants.match.CANCEL) &&
        playFrom > 0;

      addEventHandlers(); // for debug
      if (
        playFrom === 0 &&
        Test.current.steps[0].type === 'goto' &&
        !Test.current.steps[0].url.startsWith('active tab')
      ) {
        // we are on the first step of some test in the suite and the first step is a goto some url (common case)
        // tear down and rebuild the window
        try {
          chrome.debugger.onDetach.removeListener(debuggerOnDetach);
          await detachDebugger(startingTab);
        } catch (e) {
          console.log(e.message);
        }
        chrome.debugger.onDetach.addListener(debuggerOnDetach);

        await startingTab.create({
          url: 'about:blank',
          incognito: Test.current.incognito,
        });

        Tab.reset(); // FIXME: how do i deal with multi-recording tests with multiple tabs?!
        startingTab.trackCreated();
      } else {
        // do not change the active tab at all, we are resuming play from current state

        // we are resuming play in the middle of some test in the suite. The startingTab needs to already
        // be up (and in the right state) to resume
        if (!(await startingTab.reuse({ incognito: Test.current.incognito }))) {
          // reuse if you can
          throw new Errors.ReuseTestWindow(); // if you can't then there is no way to resume
        }

        // if we never played anything but start in the middle I guess the
        // best we can do is assume one tab exists.
        if (!Tab.getByVirtualId(0)) {
          Tab.reset(); // FIXME: how do i deal with multi-recording tests with multiple tabs?!
          startingTab.trackCreated();
        }
      }

      startingTab.width = testActions[0].tab.width;
      startingTab.height = testActions[0].tab.height;
      startingTab.blessed = true;

      Tab.active = startingTab;

      if (await player.attachDebugger({ tab: Tab.active })) {
        if (Tab.active.url !== 'about:blank') {
          // it will not let me inject the script to tell the size into this - yet.
          await Tab.active.resizeViewport();
        }
      }
      await playTab();
      await hideCursor();
      actionGutter.clearFail();
      /************** PLAYING ****/
      let indexOfNext = await player.play(
        Test.current,
        playFrom,
        resume,
        testPlayed === 0
      ); // players gotta play...
      /***************************/

      let nextAction = Test.current.steps[indexOfNext];
      playMatchStatus = nextAction._match;

      Test.current.lastRun.endDate = Date.now();
      Test.current.lastRun.status = playMatchStatus;
      Test.current.lastRun.steps = Test.current.steps.map((testAction) => {
        let step = new BDS.Step();
        step.index = testAction.index;
        step.clientMemory = testAction.memoryUsed;
        step.userLatency = testAction.latency;
        step.name = testAction.name || testAction.description;
        // FIXME: can add full path here as a separate field.
        return step;
      });

      $('#playButton').removeClass('active');
      setToolbarState();

      await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, {
        focused: true,
      });
      switch (playMatchStatus) {
        case constants.match.PASS:
        case constants.match.ALLOW:
          nextTest = await loadTest(currentTestNumber + 1);
          if (!nextTest) {
            infobar.setText('✅ last run passed');
            await workspace.alertModal('✅ Test passed.');
          }
          break;
        case constants.match.FAIL:
          addVolatileRegions(); // you can draw right away
          Test.current.lastRun.errorMessage = `action ${indexOfNext}'s result did not match in time`;
          actionGutter.setFail(indexOfNext - 1);
          Test.current.lastRun.failingStep = indexOfNext;
          infobar.setText(`❌ ${Test.current.lastRun.errorMessage}`);
          break;
        case constants.match.CANCEL:
          infobar.setText(
            `✋ last run canceled after user action ${indexOfNext}`
          );
          break;
        case constants.match.BREAKPOINT:
          infobar.setText(
            `✋ user defined breakpoint hit, step ${indexOfNext} not executed`
          );
        case constants.match.WRONG_ELEMENT:
          infobar.setText(
            `❌ The wrong element would receive the action, step ${indexOfNext} not executed`
          );
          await brimstone.window.alert(
            `You have configured that elements matching CSS '${
              options.waitForCssElementsToNotExistBeforeDriving
            }' must NOT be in the DOM as a precondition to play an action. But a matching element still exists in the DOM after ${(
              options.maxTimeToWaitForOverlaysToBeRemoved / 1000
            ).toFixed(
              1
            )} seconds.\n\nYou can either increase the timeout, alter the CSS, or disable the check.`
          );
          break;
        default:
          infobar.setText(`💀 unnown status reported '${playMatchStatus}'`);
          break;
      }
    }
    workspace.callMethod(workspace.stopPlaying);
    lastRunMetrics = PlayTree.complete.buildReports();
    setToolbarState(); // enable the metrics menu
    if (options.postMetricsOnFail || options.postMetricsOnPass) {
      await workspace.postLastRunMetrics(true);
    }
  } catch (e) {
    let msg = e?.message ?? e ?? '';
    workspace.callMethod(workspace.stopPlaying);
    if (e instanceof Errors.NoActiveTab) {
      infobar.setText(`❌ play canceled - ${msg}`);
    } else {
      infobar.setText('💀 aborted! ' + msg);
      throw e;
    }
  }
}

$('#next').on('click', async function (e) {
  playMatchStatus = constants.match.PASS;
  let index = currentStepIndex();
  if (index < Test.current.steps.length - 1) {
    await updateStepInView(Test.current.steps[index + 1]);
  } else if (currentTestNumber < zipNodes.length) {
    await loadTest(currentTestNumber + 1);
    await updateStepInView(Test.current.steps[0]);
  }
});

$('#last').on('click', async function (e) {
  playMatchStatus = constants.match.PASS;
  let index = currentStepIndex();
  if (index < Test.current.steps.length - 1) {
    await updateStepInView(Test.current.steps[Test.current.steps.length - 1]);
  } else if (currentTestNumber < zipNodes.length) {
    await loadTest(currentTestNumber + 1);
    await updateStepInView(Test.current.steps[Test.current.steps.length - 1]);
  }
});

$('#gotoLastZip').on('click', async function (e) {
  await loadTest(zipNodes.length);
  await updateStepInView(Test.current.steps[Test.current.steps.length - 1]);
});

// we have a handler for when the debugger detaches, if there was a command in flight when the debugger deattached
// it may be ok to ignore it, the only one I can think of is during *playback* while we are waiting to verify by reading screenshots
// and the debugger is detached because playback is in the middle of a navigation. that closes the debugger, which should reattach,
// the verify loop should pick up where it was just fine.
// if we are recording and taking a screenshot with the debugger and it's detached we are sort of hosed.

// if the user manually closes the debugger and then tries to record or play we need the debugger to reattach inorder for that to happen
// which means we need to wait and re-issue this command
/**
 *
 * @param {TestActionSourceId} source
 * @param {*} reason
 * @returns
 */
async function debuggerOnDetach(debuggee, reason) {
  console.debug('The debugger was detached.', debuggee, reason);

  if (isRecording()) {
    if (debuggee.tabId !== Tab.active.chromeTab.id) {
      console.debug(
        `ignoring detached tabId:${debuggee.tabId} during recording.`
      );
      return;
    }

    // else the tab we were recording had the debugger detach. reasons:
    // 1. user manually closed this tab.
    // 2. user manually closed a different tab in this window group. :(
    // 3. a navigation occurred in the tab.

    // if 1 or 2 then we need to figure out what is the active tab before we start recording again
    // if it is 3, it's fine to call this anyway.
    await Tab.reaquireActiveTab();

    // keep on trucking.
    await recordTab();
  } else if (isPlaying()) {
    await Tab.reaquireActiveTab();

    // the reattach will happen in the player itself
    // to the tab in the next played action
  } else {
    // the user somehow detached the debugger
    //await sleep(500); // why do I wait here you ask. It's to give the banner a chance to disappear, so that the resize below works.

    // This is to shrink it back
    // if the window is still open then we should resize it
    let windowOpen = false;
    try {
      await chrome.windows.get(Tab.active.chromeTab.windowId);
      let windowOpen = true;
    } catch {}

    if (windowOpen) {
      // I know I could put this directly in the try block, but I want
      // to dofferentiate between a the window not open at all and
      // the resize failing for another reason.
      await Tab.active.resizeViewport();
    }
  }
}

chrome.debugger.onDetach.addListener(debuggerOnDetach);

/**
 * detach the debugger
 */
async function detachDebugger(tab) {
  console.debug(`schedule deattach debugger`);
  if (typeof tab?.chromeTab?.id !== 'number') {
    return;
  }
  return new Promise(async (resolve, reject) => {
    await new Promise((_resolve) =>
      chrome.debugger.detach({ tabId: tab.chromeTab.id }, _resolve)
    );
    if (chrome.runtime.lastError?.message) {
      reject(new Errors.DebuggerAttachError(chrome.runtime.lastError.message));
      return;
    } else {
      // else no error - we detached it.
      console.debug(`debugger was deattached from tab:${tab.chromeTab.id}`);
      resolve(); // an attach was required
      return;
    }
  });
}

/**
 * Hide the cursor in all frames. If this test is so specified.
 */
async function hideCursor() {
  if (Test.current.hideCursor) {
    try {
      await chrome.tabs.sendMessage(Tab.active.chromeTab.id, {
        func: 'hideCursor',
      });
    } catch (e) {
      // i can't sendmessage to about:blank which makes no sense
      // since i inject my recorder into it
      // i.e. "match_about_blank": true is manifest
      // trying to be clever enough to detect this isn't worth it
      console.warn('unable to send a hideCursor message to active tab');
    }
  }
}

/**
 * Show the cursor in all frames. If this test is so specified.
 */
async function showCursor() {
  if (Test.current.hideCursor) {
    try {
      await chrome.tabs.sendMessage(Tab.active.chromeTab.id, {
        func: 'showCursor',
      });
    } catch (e) {
      // i can't sendmessage to about:blank which makes no sense
      // since i inject my recorder into it
      // i.e. "match_about_blank": true is manifest
      // trying to be clever enough to detect this isn't worth it
      console.warn('unable to send a showCursor message to active tab');
    }
  }
}

/**
 * this is called (at least once) for *every* frame in details.tabId.
 *
 * every navigation in the main frame of the tab will result in any previously
 * attached debugger getting detached. which is why i do so much in here.
 *  */
async function webNavigationOnCompleteHandler(details) {
  // some frame, in some tab, in some window, just completed navigation
  console.log(`tab ${details.tabId} navigation completed.`, details);

  try {
    if (isRecording()) {
      if (Tab.active.chromeTab.id !== details.tabId) {
        // tell all the other frames in the previous tab to stop recording. i.e. disable the event handlers if possible.
        // FIXME: this should be a pause with a "not allowed" type pointer, maybe even an overlay to prevent user interaction, or block all user events.
        // https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-setIgnoreInputEvents
        try {
          postMessage({ type: 'stop', broadcast: true });
          port.disconnect();
        } catch (e) {
          console.warn(e);
        }
        Tab.active = Tab.getByRealId(details.tabId);
        if (!Tab.active) {
          throw new Error('Active tab is not tracked!');
        }
      }

      await recordTab();
    } else if (isPlaying()) {
      // don't really need to call all of playTab(), just hideCursor should do it.
      await hideCursor();
    } else {
      throw new Error('Navigation callbacks need to be removed.');
    }
  } catch (e) {
    if (
      e instanceof Errors.PixelScalingError ||
      e instanceof Errors.ZoomError
    ) {
      throw e;
    }
    // FIXME: do these EVER occur anymore?
    console.error('swallowed navigation completion exception.', e);
  }
}

/**
 * Establish the recording communication channel between the tab being recorded and the brimstone workspace window.
 * This is in the global variable: port.
 */
async function startRecorders() {
  // establish the recording communication channel between the tab being recorded and the brimstone workspace window
  await loadOptions();
  // connect to all frames in the the active tab in this window.
  // the recorder is injected in all pages, all frames, and will respond to onconnect by starting the event handlers.
  // https://developer.chrome.com/docs/extensions/reference/tabs/#method-connect
  console.debug('connect: creating port.');
  let recordingTab = Tab.active;
  port = chrome.tabs.connect(recordingTab.chromeTab.id, {
    name: 'brimstone-recorder',
  });

  // if the active tab navigates away or is closed the port will be disconected
  // FIXME: is this needed?
  port.onDisconnect.addListener(
    /**
     * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
     * https://developer.chrome.com/docs/extensions/mv3/messaging/#port-lifetime
     * @param {*} _port
     */
    function (_port) {
      console.debug('port was disconnected', _port, chrome.runtime.lastError);
      port?.onMessage?.removeListener(onMessageHandler); // this particular port is no good anymore so, kill the listener on it. needed?
      port = false;
    }
  );

  port.onMessage.addListener(onMessageHandler);
  infobar.setText();
  await captureScreenshotAsDataUrlForRecording(); // grab the first screenshot
}

/**
 * tell all the content scripts what frame they are in via chrome.tab.sendMessage
 */
async function tellRecordersTheirFrameIds() {
  let tab = Tab.active;
  let tabId = tab.chromeTab.id;
  console.debug(`connect: tell each recorder in tab:${tab.id} their frame id`);
  let frames = await new Promise((response) =>
    chrome.webNavigation.getAllFrames({ tabId: tabId }, response)
  ); // get all frames
  for (let i = 0; i < frames.length; ++i) {
    let frame = frames[i];
    await chrome.tabs.sendMessage(
      tabId,
      { func: 'setIds', args: { tabId: tabId, frameId: frame.frameId } },
      { frameId: frame.frameId }
    );
  }
}

/** Fired when a tab is closed.  */
async function tabsOnRemovedHandler(tabId, removeInfo) {
  let tab = Tab.getByRealId(tabId);
  if (!tab) {
    console.log(
      `untracked tab tabId:${tabId} winId:${removeInfo.windowId} is removed.`,
      removeInfo
    );
    return;
  }

  console.log(
    `tracked tab tab:${tab.id} winId:${removeInfo.windowId} is removed.`,
    removeInfo
  );
  tab.trackRemoved();

  if (isRecording()) {
    await recordUserAction({
      type: 'close',
      url: tab.chromeTab.url,
      sender: {
        href: tab.chromeTab.url,
      },
    });

    if (Tab._open.length === 0) {
      // we closed the only active tab, we should end the recording.
      console.log('stopping recording since there are no tracked tabs!');
      await stopRecording();
    }
  }
}

/** async event handlers, that contain awaits relinquish control. so other control paths cannot assume
 * that a started async event handler actually "completes" from an async point of view.
 */
async function tabsOnActivatedHandler(activeInfo) {
  /* 
        Fires when the active tab in a window changes. 
        Note that the tab's URL may not be set at the time this event fired, 
        but you can listen to onUpdated events so as to be notified when a URL is set.
    */
  Tab.active = Tab.getByRealId(activeInfo.tabId);
  if (!Tab.active) {
    throw new Error('active tab is not tracked.');
  }
  console.log(`chromeTab tabId:${Tab.active.id} is active.`, activeInfo);

  if (isRecording()) {
    // we only record one tab at a time: the active tab
    if (await player.attachDebugger({ tab: Tab.active })) {
      // if the debugger needed to be attached we fall in here.
      // and try to resice the viewport.
      try {
        await Tab.active.resizeViewport(); // FIXME: resize can fail. not sure why.
      } catch (e) {
        console.warn(e);
      }
    }
    await recordTab();
  }
  // else playing and we will attach to the expected tab, at the expected size
}

/**
 * This is called when recording or playing, whenever a new tab is created.
 * In both cases whenever a tab is created, it should already have the debugger attached.
 
 * This means it will be created with the debugger banner already smashed in there and visible
 * (pretty soon - like after the navigations in here are all complete)
 * 
 * @param {chrome.tabs.Tab} chromeTab 
 */
function tabsOnCreatedHandler(chromeTab) {
  console.debug(
    `tab tabId:${chromeTab.id} winId:${chromeTab.windowId} is created.`
  );

  // the user performed an action that opened a new tab in *some* window.
  // should this be considered the tab we are recording now? does it matter?
  // an action will be recorded from *any* tab and placed in the workspace.

  // the screenshot poller should always be polling the 1 active focused tab+window.
  // like the highlander: "there can only be one".

  // the url for the tab may not be settled yet, but I can handle onUpdated and set the url property then...
  // but the ID is supposed to be all I need.

  // recording or playing we assume that the debugger is properly attached
  let newTab = new Tab().fromChromeTab(chromeTab);
  newTab.height -= 46; // If it already has the 46 px border on it, then we need to subtract it from the desired viewport height.
  newTab.trackCreated();

  // this is also assuming that the debugger is attached!
  // since this is what will be stored in the recording.
}

/**
 *
 * @param {chrome.tabs.Tab} tab
 */
async function tabsOnUpdatedHandler(tabId, changeInfo, tab) {
  console.debug(
    `tab tabId:${tabId} winId:${tab.windowId} is updated.`,
    changeInfo
  );
}

/**
 *
 * @param {chrome.windows.Window} window
 */
async function windowsOnCreatedHandler(window) {
  console.debug(`winId:${window.id} is created.`);
}

async function windowsOnFocusChangedHandler(window) {
  // first on created, is this
  console.debug(`focus changed to winId:${window.id}.`);
}

async function windowsOnRemovedHandler(windowId) {
  console.debug(`winId:${windowId} is removed.`);
}

// function debugEvent(debugee, method, params) {
//     console.log("EVENT! ", debugee, method, params);
// }

/**
 * idempotent. remove then add all the window
 * and tab lifecycle eventhandlers.
 */
function addEventHandlers() {
  chrome.webNavigation.onCompleted.removeListener(
    webNavigationOnCompleteHandler
  );
  chrome.webNavigation.onCompleted.addListener(webNavigationOnCompleteHandler);

  chrome.tabs.onActivated.removeListener(tabsOnActivatedHandler);
  chrome.tabs.onActivated.addListener(tabsOnActivatedHandler);

  chrome.tabs.onRemoved.removeListener(tabsOnRemovedHandler);
  chrome.tabs.onRemoved.addListener(tabsOnRemovedHandler);

  chrome.tabs.onCreated.removeListener(tabsOnCreatedHandler);
  chrome.tabs.onCreated.addListener(tabsOnCreatedHandler);

  chrome.tabs.onUpdated.removeListener(tabsOnUpdatedHandler);
  chrome.tabs.onUpdated.addListener(tabsOnUpdatedHandler);

  chrome.windows.onCreated.removeListener(windowsOnCreatedHandler);
  chrome.windows.onCreated.addListener(windowsOnCreatedHandler);

  chrome.windows.onFocusChanged.removeListener(windowsOnFocusChangedHandler);
  chrome.windows.onCreated.addListener(windowsOnFocusChangedHandler);

  chrome.windows.onRemoved.removeListener(windowsOnRemovedHandler);
  chrome.windows.onRemoved.addListener(windowsOnRemovedHandler);
}

function removeEventHandlers() {
  chrome.webNavigation.onCompleted.removeListener(
    webNavigationOnCompleteHandler
  );

  chrome.tabs.onActivated.removeListener(tabsOnActivatedHandler);

  chrome.tabs.onRemoved.removeListener(tabsOnRemovedHandler);

  chrome.tabs.onCreated.removeListener(tabsOnCreatedHandler);

  chrome.tabs.onUpdated.removeListener(tabsOnUpdatedHandler);

  chrome.windows.onCreated.removeListener(windowsOnCreatedHandler);

  chrome.windows.onFocusChanged.removeListener(windowsOnFocusChangedHandler);

  chrome.windows.onRemoved.removeListener(windowsOnRemovedHandler);
}

/**
 * Set up navigation listener, which refires this function when a nav completes.
 * Tell recorders their frameids.
 * Hide the cursor.
 * @param {Tab} tab
 */
async function prepareToRecord() {
  let tab = Tab.active;
  player.usedFor = 'recording';

  console.debug(
    `connect: begin - preparing to record tab:${tab.id} ${tab.url}`
  );
  console.debug(`connect:       -  tab is ${tab.width}x${tab.height}`);

  addEventHandlers();
  await tellRecordersTheirFrameIds();
  await hideCursor();
  // else don't resize a popup
  console.debug(
    `connect: end   - preparing to record tab ${tab.chromeTab.id} ${tab.url}`
  );
}

/**
 * If we are making a recording to insert into the current test
 * this holds the "current test".
 * @type {Test} */
let testToInsertRecordingInto = null;
/**
 * The index we will insert into.
 */
let insertIndex = 0;

async function stopRecording() {
  removeEventHandlers();

  $('#recordButton').removeClass('active');
  setToolbarState();
  // tell all frames to stop recording. i.e. disable the event handlers if possible.
  try {
    postMessage({ type: 'stop', broadcast: true });
    port.disconnect();
  } catch (e) {
    console.warn(e);
  }

  let newIndex;
  if (testToInsertRecordingInto) {
    // always remove the first step in the insert - that is there just because it made the record path easier.
    Test.current.steps.splice(0, 1);
    // what about the last step, the one that has no action? Safeest to leave it and let the user delet it manually.

    newIndex = Test.current.steps.length - 1 + insertIndex;
    testToInsertRecordingInto.insertActions(insertIndex, Test.current.steps);
    Test.current = testToInsertRecordingInto;
    updateStepInView(Test.current.steps[newIndex]); // will refresh the cards with there new indexes show in them
  } else {
    newIndex = currentStepIndex();
  }
  testToInsertRecordingInto = null;
  infobar.setText();

  actionGutter.draw(Test.current.steps);
  actionGutter.setCurrent(newIndex);
}

async function focusTab() {
  await chrome.windows.update(Tab.active.chromeTab.windowId, { focused: true });
  await chrome.tabs.update(Tab.active.chromeTab.id, {
    highlighted: true,
    active: true,
  });
}

/**
 * Get *the* application Tab that we intend to attch the debugger to.
 * i.e. the Tab we will starting playing or recording on.
 *
 * This can return a Tab without a virtualId and chromeTab property
 * when there is no application tab available at all.
 * i.e. there are no open windows except the brimstone workspace itself.
 *
 */
async function getActiveApplicationTab() {
  let tabs = await chrome.tabs.query({});
  if (tabs.length > 2) {
    let ok = await brimstone.window.confirm(
      'There are multiple application tabs. Brimstone will use the active tab as the initial target.'
    );
    if (!ok) {
      throw new Errors.NoActiveTab();
    }
  }

  let w = await new Promise((resolve) =>
    chrome.windows.getCurrent(null, resolve)
  ); // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
  let recordChromeTab = tabs.find((tab) => tab.windowId !== w.id);
  let tab = new Tab();
  if (recordChromeTab) {
    await tab.fromChromeTab(recordChromeTab);
  }
  return tab;
}

/**
 * Let's record something!
 * @param {boolean} attachActiveTab Splice record or URL record
 * @returns
 */
async function recordSomething(promptForUrl) {
  try {
    let button = $('#recordButton');
    if (button.hasClass('active')) {
      // before I take the last screenshot the window must have focus again.
      //await focusTab();
      let last = Test.current.steps[Test.current.steps.length - 1];
      last.addExpectedScreenshot(last.expectedScreenshot); // build the final png
      await stopRecording();
      return;
    }

    let url = '';
    await loadOptions();
    /** cached the current step index */
    let index = currentStepIndex(); // there are two cards visible in the workspace now. (normally - unless the user is showing the last only!)

    let startingTab = await getActiveApplicationTab();
    // are we doing an incognito recording - this is determined by the option only now.
    Test.current.incognito = options.recordIncognito;

    // A completely fresh recording will prompt for the URL, else prompt for splice record.
    // If the attachActiveTab is true we splice record, else it is a fresh (new URL) recording.

    if (promptForUrl) {
      let defaultUrl = options?.url ?? '';
      url = await workspace.promptModal(
        'Where to? Type or paste URL to start recording from.',
        defaultUrl
      );
      if (!url) {
        return; // they bailed
      }
      if (url.startsWith('chrome')) {
        alert(
          'Recording chrome:// urls is not currently supported.\n\nTo record first navigate to where you want to start recording from. Then hit the record button.'
        );
        return false;
      }
      await saveOptions({ url: url });
      let created = false;
      // recording from beginning
      if (
        !(await startingTab.reuse({
          url: url,
          incognito: Test.current.incognito,
        }))
      ) {
        await startingTab.create({
          url: url,
          incognito: Test.current.incognito,
        });
        created = true;
      }

      Tab.reset(); // FIXME: multi-tab multi-recording tests
      startingTab.trackCreated();
      Tab.active = startingTab;

      if (await player.attachDebugger({ tab: Tab.active })) {
        await Tab.active.resizeViewport();
      }

      await prepareToRecord();
      button.addClass('active');
      setToolbarState();

      // update the UI: insert the first text card in the ui
      await recordUserAction({
        type: 'goto',
        url: Tab.active.url,
      });

      // FOCUS ISSUE. when we create a window (because we need to record incognito for example),
      // and then navigate the active tab, the focus/active tabs styles aren't automatically placed
      // on the document.activeElement. i don't know why this is the case.
      // so the initial screen is recorded without "focus".
      //
      // to work around this i do this preamble on record (when first action is goto) and play when first action is goto.
      await player.mousemove({ x: 0, y: 0 });
      await player.mousemove({ x: -1, y: -1 });
      infobar.setText();
    } else {
      // we are going to start recording *the* active tab at the current url.
      if (!startingTab.chromeTab) {
        throw new Errors.ReuseTestWindow();
      }

      if (Test.current.steps.length) {
        startingTab.trackCreated();
        // we are going to record over some steps in the existing test in memory
        Tab.active = startingTab;

        let action = Test.current.steps[index + 1];
        let old = {
          overlay: action.overlay,
        };
        action.overlay = {
          height: 100,
          width: 100,
          top: 0,
          left: 0,
          html: '&nbsp;',
        };

        await updateStepInView(Test.current.steps[index]);
        await sleep(10); // update the ui please

        if (
          !(await workspace.confirmModal(
            `Recording from here will INSERT new actions starting at action ${
              index + 2
            }, until you stop.`
          ))
        ) {
          action.overlay = old.overlay;
          await updateStepInView(Test.current.steps[index]);
          return;
        }

        // see if we are tracking the tab of the action we are recording over
        Tab.active = Tab.getByVirtualId(action.tab.virtualId);
        if (!Tab.active) {
          throw new Error(`Not currently tracking tab:${action.tab.virtualId}`);
        }

        // overwriting actions in an existing test
        if (!(await Tab.active.reuse({ incognito: Test.current.incognito }))) {
          throw new Errors.ReuseTestWindow();
        }

        if (await player.attachDebugger({ tab: Tab.active })) {
          await Tab.active.resizeViewport();
        }

        await prepareToRecord();
        button.addClass('active');
        setToolbarState();
        await countDown(3, action);

        action.overlay = old.overlay;
        testToInsertRecordingInto = Test.current; // hang onto it
        insertIndex = index + 1;
        startingTab.virtualId = Test.current.steps[insertIndex].tab.virtualId;
        actionGutter.clean();
        infobar.setText();
      } else {
        infobar.setText();
      }

      // we are recording a fresh test starting with the active tab.
      // there is no test loaded in memory. recording starts at
      // step 1 (index 0)

      Test.current = new Test();
      startingTab.trackCreated();
      Tab.active = startingTab;

      // If you "Record the Active Tab" you will make a recording in incognito or not based on the Active Tab state, not any external preferences!
      Test.current.incognito = Tab.active.chromeTab.incognito;

      let reuse = await Tab.active.reuse({
        incognito: Test.current.incognito,
      });
      if (Tab?.active?.chromeTab?.url?.startsWith('chrome:')) {
        await workspace.alertModal(
          "We don't currently allow recording in a chrome:// url. If you want this feature please upvote the issue.\n\nPlease specify a non chrome:// URL in the tab to record."
        );
        return;
      }
      if (!reuse) {
        throw new Errors.ReuseTestWindow();
      }

      if (await player.attachDebugger({ tab: Tab.active })) {
        await Tab.active.resizeViewport();
      }

      await prepareToRecord();
      button.addClass('active');
      setToolbarState();

      // update the UI: insert the first text card in the ui
      await recordUserAction({
        type: 'goto',
        url: 'active tab',
      });

      // FOCUS ISSUE. when we create a window (because we need to record incognito for example),
      // and then navigate the active tab, the focus/active tabs styles aren't automatically placed
      // on the document.activeElement. i don't know why this is the case.
      // so the initial screen is recorded without "focus".
      //
      // to work around this i do this preamble on record (when first action is goto) and play when first action is goto.
      await player.mousemove({ x: 0, y: 0 });
      await player.mousemove({ x: -1, y: -1 });
    }

    if (!PlayTree.complete) {
      // pretend it is suite which is the general case I need to handle.
      PlayTree.complete = await new PlayTree();
      PlayTree.complete._zipTest = Test.current;
      Test.current._playTree = PlayTree.complete;
    }
    await startRecorders(); // this REALLY activates the recorder, by connecting the port, which the recorder interprets as a request to start event listening.

    // last thing we do is give the focus back to the window and tab we want to record, so the user doesn't have to.
    await focusTab();
  } catch (e) {
    await stopRecording();
    if (e instanceof Errors.NoActiveTab) {
      infobar.setText(`❌ recording canceled - ${e?.message ?? ''}`);
    } else {
      if (
        e.message ===
        'Could not establish connection. Receiving end does not exist.'
      ) {
        throw new Errors.ConnectionError();
      }
      throw e;
    }
  }
}

$('#recordButton').on('click', (e) => {
  // if there are steps we interpret the button as splice record
  // if no we prompt for URL to record a fresh one

  // if the user wants to start a new (from blank) recording w/o a url
  // they can use the "Record Active Tab" option in the menu, and not use this button at all.
  let testInMemory = Test.current.steps.length;
  let promptForUrl = !testInMemory;
  recordSomething(promptForUrl);
});

async function _stopPlaying() {
  $('#playButton').removeClass('active');
  player.stopPlaying();
  removeEventHandlers();
  await showCursor();
}

/**
 * Send a msg back to the bristone workspace over the recording channel port.
 * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
 * Note this automatically sends the Sender info.
 */
function postMessage(msg) {
  console.debug('TX', msg);
  try {
    port.postMessage(msg);
  } catch (e) {
    // it is possible that we are in the process of navigating, either by synthetic or real user event (e.g. passive recording)
    // the port can be down.
    console.log('post message failed.', e);
  }
}

$('#loadButton').on('click', workspace.loadTests.bind(workspace));
$('#saveButton').on('click', workspace.saveZip);
$('#clearButton').on('click', workspace.clearWorkspace.bind(workspace));
$('#recordActiveTab').on('click', workspace.recordActiveTab.bind(workspace));

/**
 * Load the test specified into the workspace
 * @param {number} testNumber The 1-based index of the test to load. This -1 is the index into zipNodes
 * @returns
 */
async function loadTest(testNumber) {
  try {
    let numberOfTestsInSuite = zipNodes.length;
    if (testNumber > numberOfTestsInSuite || testNumber < 1) {
      return false;
    }
    await workspace.clearTest(); // any previous test is cleared out
    currentTestNumber = testNumber;

    await loadOptions();
    let suite =
      numberOfTestsInSuite > 1
        ? ` (test ${currentTestNumber}/${numberOfTestsInSuite})`
        : '';
    //let lastStep = Test.current.steps.length >= 1 ? Test.current.steps.length - 1 : 0;

    // This load is just super fast.
    Test.current = await new Test().fromPlayTree(
      zipNodes[currentTestNumber - 1]
    );

    actionGutter.draw(Test.current.steps);
    actionGutter.setCurrent(currentStepIndex());

    if (currentTestNumber === 1) {
      Test.current.startingServer =
        Test.current.steps[0].url ||
        zipNodes[0]._zipTest.startingServer ||
        null;
    }

    window.document.title = `Brimstone - ${Test.current._playTree.path()}${suite}`;
    await updateStepInView(Test.current.steps[0]);
    setToolbarState();
    if (PlayTree.complete.uniqueZipFilenames[Test.current.filename]) {
      await workspace.clearAllowedDifferences();
    }
    return true;
  } catch (e) {
    if (e instanceof Errors.InvalidVersion) {
      throw e;
    } else {
      throw new Errors.TestLoadError(
        e.stack,
        zipNodes[currentTestNumber - 1]._fileHandle.name
      );
    }
  }
}

/** The filehandles of the tests the user loaded. Used for playing back 1 or more tests.
 * This flat list may be larger than 1 if the user multiselected tests and/or selected
 * a playlist. This flattens that all into a sequence of zips that are to be played.
 * The current zipNode being played is in {@link currentTestNumber}-1.
 * @type {PlayTree[]}
 */
let zipNodes = [];

/** The 1-based index of the current test. This -1 is the
 * index into {@link zipNodes}.
 */
let currentTestNumber = 0;

async function updateStepInView(action) {
  // immediately show if there is nothing pending
  let step = new Step({ curr: action, test: Test.current });
  await setStepContent(step);
}

/** The recording channel port. This port connects to (broadcasts to)
 * every frame in the tab.
 */
var port = false;

/**
 * convert millseconds into something
 * more friendly
 * @param {number} ms
 * @returns
 */
function eta(ms) {
  let seconds = Math.floor(ms / 1000);
  let minutes = Math.ceil(seconds / 60);
  if (minutes > 1) {
    return `${minutes} minutes`;
  } else {
    if (seconds > 30) {
      return '1 minute';
    }
    if (seconds > 10) {
      return 'less than 30 seconds';
    }
    return 'less than 10 seconds';
  }
}

/**
 *
 * @param {Step} step the step
 */
async function setStepContent(step) {
  await Promise.all([
    loadOptions(),
    step.curr.hydrateScreenshots(),
    step?.next?.hydrateScreenshots(),
  ]);

  $('#step').html(step.toHtml({ isRecording: isRecording() })); // two cards in a step
  setToolbarState();

  // update the thumb gutter
  actionGutter.setCurrentNoScroll(step.curr.index);

  if (isPlaying()) {
    let end, current;
    if (step.curr.test._playTree._stepBaseIndex !== undefined) {
      end = PlayTree.stepsInZipNodes;
      current = step.curr.index + 1 + step.curr.test._playTree._stepBaseIndex;
    } else {
      end = step.curr.test.steps.length;
      current = step.curr.index + 1;
    }
    let text = '🟢 playing';
    if (player._playStreak > 5) {
      // get a few under our belt
      text += ` ETA ${eta((end - current) * player._expectedActionPlayTime)}`;
    }
    if (player.lastAutoCorrectedStepNumber) {
      text += `. step ${player.lastAutoCorrectedStepNumber} auto-corrected.`;
    }
    infobar.setText(text);
  }
}

/**
 * Try to capture a screenshot of the expected size
 * while making a recording.
 *
 * The debugger attaches and detaches during the
 * normal course of tab opening, closing, and navigating.
 *
 * The debugger banner affects viewport size, hence
 * we need to make sure we grab a screenshot of the expected
 * size.
 *
 * @throws {Exception} on failure.
 */
async function captureScreenshotAsDataUrlForRecording() {
  // how long should we wait during recording to be able to
  // screenshot of the correct size?
  let start = performance.now();
  let lastError;
  // max time to wait for a screenshot of the correct size to be taken during recording
  let startingActiveTabId = Tab.active.virtualId;
  while (
    performance.now() - start <
    options.captureScreenshotAsDataUrlForRecordingTimeout
  ) {
    try {
      _lastScreenshot = await player.captureScreenshot();
      return _lastScreenshot;
    } catch (e) {
      lastError = e;

      // if the tab we want to take the picture on has closed/is not the active tab then swallow error and don't take the screenshot.
      if (!Tab.active || Tab.active.virtualId !== startingActiveTabId) {
        console.info(
          'active tab changed while waiting for a screenshot',
          lastError
        );
        return;
      }
      console.warn(lastError);

      if (lastError instanceof Errors.IncorrectScreenshotSize) {
        // this can only happen during recording if the debugger banner is volatile
        await player.tab.resizeViewport();
        await sleep(options.captureScreenshotAsDataUrlForRecordingRetryTimeout);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

/**
 * Add the _lastScavedScreenshot to the testAction if that screenshot wasn't of
 * an open shadowDOM
 *  @param {TestAction} testAction The action to add the screenshot to
 */
function addExpectedScreenshot(testAction, ss = _lastScreenshot) {
  if (shadowDOMScreenshot) {
    --shadowDOMScreenshot;
    testAction.shadowDOMAction = true;
  }
  testAction.addExpectedScreenshot(ss);
}

/**
 * This is normally only used during recording.
 *
 * Process a user event received from the content script (during recording)
 * screenshot, annotate event and convert to TestAction;
 *
 */
async function userEventToAction(userEvent, insert = true) {
  let frameId = userEvent?.sender?.frameId;
  let frameOffset =
    userEvent.type === 'close'
      ? { left: 0, top: 0 }
      : await getFrameOffset(frameId);

  let testAction = new TestAction(userEvent);
  testAction.tab = new Tab(Tab.active);
  // FIXME: remove this. This is here currently because addExpectedScreenshot has a dependency on the index
  // which has a dependency on this call because it can set the index
  if (insert) {
    Test.current.updateOrAppendAction(testAction);
    testAction.dirty = true; // only during recording would we set this to true
  }
  let element = userEvent.boundingClientRect;

  testAction.x += frameOffset.left;
  testAction.y += frameOffset.top;

  if (element) {
    /** During recording we know the tab height and width, this will be the size of the screenshots captured.
     * We can convert the element positions in pixels into percentages. The overlay represents the location
     * of the overlay in percentages of the aspect-ratio preserved image.
     */
    testAction.overlay = {
      height: (element.height * 100) / testAction.tab.height, // height of target element as a percent of screenshot height
      width: (element.width * 100) / testAction.tab.width, // width of target element as a percent screenshot width

      /** absolute y coordinate of the TARGET ELEMENT as a percent of screenshot */
      top: ((element.top + frameOffset.top) * 100) / testAction.tab.height,
      /** absolute x coordinate of the TARGET ELEMENT as a percent of screenshot */
      left: ((element.left + frameOffset.left) * 100) / testAction.tab.width,

      /** absolute x coordinate of the mouse position as a percent of screenshot */
      x: (testAction.x * 100) / testAction.tab.width,
      /** absolute y coordinate of the mouse position as a percent of screenshot */
      y: (testAction.y * 100) / testAction.tab.height,
    };
  }

  let dataUrl = '';
  switch (userEvent.type) {
    case 'wait':
      if (!testAction.event) {
        testAction.event = {};
      }
      if (testAction.event.milliseconds === undefined) {
        testAction.event.milliseconds = 0;
      }
      testAction.description = `wait ${testAction.event.milliseconds}ms.`;
      testAction.overlay = {
        height: 0,
        width: 0,
        top: 0,
        left: 0,
      };
      testAction._view = constants.view.EXPECTED;
      //addExpectedScreenshot(testAction, _lastScreenshot);
      break;
    case 'pollscreen':
      testAction.description = 'no action performed.'; // do I even need a message?
      testAction.overlay = {
        height: 0,
        width: 0,
        top: 0,
        left: 0,
      };
      testAction._view = constants.view.EXPECTED;
      break;
    case 'mouseover':
      // this is sort of an error case!
      testAction.description = 'orphaned mouseover observed here';
      addExpectedScreenshot(testAction, _lastScreenshot);
      break;
    case 'mousemove':
      testAction.description = 'move mouse';
      addExpectedScreenshot(testAction, _lastSavedScreenshot);
      break;
    case 'wheels':
      // rebase the individual wheel events position to their frame offsets
      testAction.event.forEach((wheelEvent) => {
        wheelEvent.x += frameOffset.left;
        wheelEvent.y += frameOffset.top;
      });
      addExpectedScreenshot(testAction, _lastSavedScreenshot);
      break;
    case 'keys':
      testAction.description = 'type ';

      for (let i = 0; i < userEvent.event.length; ++i) {
        let event = userEvent.event[i];

        if (event.type === 'keydown') {
          let keyName = event.key;
          if (i === userEvent.event.length - 1) {
            keyName += '🠯';
          }

          let isModifierKey = keycode2modifier[event.keyCode] || 0;
          let modifiers = 0;
          modifiers |= event.altKey ? 1 : 0;
          modifiers |= event.ctrlKey ? 2 : 0;
          modifiers |= event.metaKey ? 4 : 0;
          modifiers |= event.shiftKey ? 8 : 0;

          let chord = modifiers & ~isModifierKey;
          if (chord) {
            testAction.description += `<span class='modifier'>+</span>`;
          }
          if (chord || event.key.length > 1) {
            // these are button looking thangs
            testAction.description += `<span class='modifier'>${keyName}</span>`;
          } else {
            testAction.description += keyName;
          }
        } else if (i === 0) {
          // we are starting on a keyup
          testAction.description += `<span class='modifier'>${event.key}🠭</span>`;
        }
      }
      addExpectedScreenshot(testAction);
      break;
    case 'keydown':
    case 'keypress':
      testAction.description = 'type ';
      if (userEvent.event.key.length > 1) {
        testAction.description += `<span class='modifier'>${userEvent.event.key}</span>`;
      } else {
        testAction.description += userEvent.event.key;
      }
      addExpectedScreenshot(testAction);
      break;
    case 'click':
      testAction.description = 'click';
      addExpectedScreenshot(testAction);
      break;
    case 'getVersion':
      testAction.description = 'get text as application version';
      addExpectedScreenshot(testAction);
      break;
    case 'contextmenu':
      testAction.description = 'right click';
      addExpectedScreenshot(testAction);
      break;
    case 'dblclick':
      testAction.description = 'double click';
      addExpectedScreenshot(testAction);
      break;
    case 'goto': {
      testAction.description = `goto tab:${testAction.tab.virtualId} ${testAction.url}`;
      testAction.overlay = {
        height: 0,
        width: 0,
        top: 0,
        left: 0,
      };
      testAction._view = constants.view.EXPECTED;
      break;
    }
    case 'close':
      testAction.description = `close tab:${testAction.tab.virtualId} ${testAction.url}`;
      testAction.overlay = {
        height: 0,
        width: 0,
        top: 0,
        left: 0,
      };
      testAction._view = constants.view.EXPECTED;
      addExpectedScreenshot(testAction);
      break;
    case 'change':
      // change is not a direct UI action. it is only sent on SELECTs that change their value, which happens *after* the user interacts with the shadowDOM.
      // recorder can't detect when the shadowdom is opened (or interacted with at all), so it can't detect the start of a change action. it can't turn off
      // the auto screenshot updating mechanism (don't know we are in the shadow DOM), so it keeps clicking away while the user interacts with the shadow dom.
      // (hence the _lastScreenshot contains the state where the shadowDOM options are open and the user has clicked the new one, which is not the correct pre-requisite)
      // it only knows when the action is done by getting the change event.
      // so there is no pre-requisite starting state for await change operation, it's not a directly observable UI action.
      // +1 shadowDOMScreenshot

      // furthur, during record, after the change event occurs, the shadowDOM is closed and the mouse may be somewhere new, without an observed mousemove.
      // i.e. there was a mousemove that started in the shadow DOM (which can't be seen) and ended somewhere else that can be seen. in order to record this mousemove it would
      // need the pre-requiste state of the mousemove, which occurs when the shadowDOM is open.
      // i decided that, the recorder won't use shadowDOM screenshots at all, so this (next) pre-requisite one too should be ignored.
      // +1 shadowDOMScreenshot

      testAction.description = `change value to ${testAction.event.value}`;
      shadowDOMScreenshot += 2;
      addExpectedScreenshot(testAction);
      break;
    default:
      testAction.description = 'Unknown!';
      break;
  }

  let stream = testAction.type === 'pollscreen' ? 'debug' : 'log';
  console[stream](
    `[step:${testAction.index} tab:${testAction.tab.id}] record "${testAction.description}"`
  );
  return testAction;
}

/**
 * set up the step and start refreshing the next expected screen */
async function recordUserAction(userEvent) {
  let action = await userEventToAction(userEvent); // convert userEvent to testaction, insert at given index
  action.tab.blessed = true;

  // show the latest screenshot in the expected card to give quick feedbak
  let wait = await userEventToAction({ type: 'pollscreen' }); // create a new waiting action
  // use the lower cost option: just the dataUrl not the PNG. the PNG is generated when we create a userAction
  wait.expectedScreenshot = new Screenshot(_lastScreenshot); // something to show immediately
  wait._view = constants.view.DYNAMIC;
  wait.sender = {
    href: _lastScreenshot?.tab?.url,
  };
  if (_lastScreenshot) {
    wait.tab = _lastScreenshot.tab;
  }
  // else we assigned Tab.active to wait.tab.

  await updateStepInView(action); // update the UI
  return action;
}

/**
 * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
 */
async function onMessageHandler(message, _port) {
  let userEvent = message;
  console.debug(`RX: ${userEvent.type} ${userEvent.sender.href}`, userEvent);

  userEvent._view = constants.view.EXPECTED;
  // the last one contains the screenshot the user was looking at in the expected when they recorded this action
  let action;
  switch (userEvent.type) {
    case 'frameOffset':
      if (userEvent.sender.frameId === _waitForFrameOffsetMessageFromFrameId) {
        console.log(
          `connect: using frameOffset for frameId ${userEvent.sender.frameId}`
        );
        _resolvePostMessageResponsePromise(userEvent.args);
      } else {
        console.log(
          `connect: ignoring frameOffset for frameId ${userEvent.sender.frameId}`
        );
      }
      break;
    case 'save-lastscreenshot':
      _lastSavedScreenshot = _lastScreenshot;
      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    // the user is actively waiting for the screen to change
    case 'pollscreen':
      // this is expecting to be called with at least 2 actions already in the test
      await captureScreenshotAsDataUrlForRecording(); // grab latest image

      // only one time ever
      if (!_lastSavedScreenshot) {
        _lastSavedScreenshot = _lastScreenshot;
      }

      let ci = currentStepIndex();
      let lastAction = Test.current.steps[ci + 1];

      // refresh the expected action placeholder the user sees.
      // use the lower cost option, just the dataurl don't make into a PNG
      // that will come later when we create the next user action.
      lastAction.expectedScreenshot = new Screenshot(_lastScreenshot);
      lastAction._view = constants.view.DYNAMIC;
      lastAction.sender = {
        href: _lastScreenshot.tab.url,
      };
      lastAction.tab = _lastScreenshot.tab; // this is only for the case where the last action is a close of a tab and we need to show some other active screenshot.

      await updateStepInView(Test.current.steps[ci]);
      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    case 'mouseover':
    case 'mousemove':
    case 'click':
    case 'contextmenu':
    case 'dblclick':
    case 'getVersion':
      // it takes a mouse move to get here. if it wasn't allowed to end (fast user) we want to grab and reuse the pre-requisite screenshot of the mousemove.
      // (this is user error, if they want the right state they must wait and check, so acceptable.)
      // if it is allowed to end, then still, we want to grab and reuse the pre-requisite screenshot of the mousemove

      // but we CANNOT take a SS here for the start state, because of :hover and :active issues on mouseover and mousedown respectively.
      action = await recordUserAction(userEvent);

      // these need to be simulated because I do double click detection in the recorder itself, which intercepts click.
      // FIXME: why must I simulate these?
      // Could recorder passively monitor, and propagate them? i need to record *something*. is it a single click or a double click that I want to record?
      // I am using an old start state anyway...
      if (userEvent.handler?.simulate) {
        await player[action.type](action); // this can result in a navigation to another page.
      }

      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    case 'wheel':
      let frameId = userEvent?.sender?.frameId;
      let frameOffset = await getFrameOffset(frameId);
      userEvent.x += frameOffset.left;
      userEvent.y += frameOffset.top;

      if (userEvent.handler?.saveScreenshot) {
        _lastSavedScreenshot = _lastScreenshot;
      }

      // in this case the userEvent is essentially shaped like an action
      // by the recorder
      if (userEvent.handler?.simulate) {
        await player[userEvent.type](userEvent); // this can result in a navigation to another page.
      }

      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    case 'wheels':
      await recordUserAction(userEvent);
      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    // keyevents should work almost the same as mousemove except, i want more/faster visual feedback for the user, which is
    // why i simulate them. this lets the browser update the screen, even though I don't take a screenshot everytime.
    case 'keys':
      // i just don't know how to record in the shadowDOM very well!!
      await recordUserAction(userEvent);
      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    case 'change':
      //await (userEvent);
      action = await userEventToAction(userEvent); // convert userEvent to testaction, insert at given index
      action.tab.blessed = true;
      // show the latest screenshot in the expected card and start polling it
      await captureScreenshotAsDataUrlForRecording();

      let wait = await userEventToAction({ type: 'pollscreen' }); // create a new waiting action
      // use the lower cost option: just the dataUrl not the PNG. the PNG is generated when we create a userAction
      wait.expectedScreenshot = new Screenshot(_lastScreenshot); // something to show immediately
      wait._view = constants.view.DYNAMIC;
      wait.shadowDOMAction = true;

      await updateStepInView(action); // update the UI

      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    case 'keydown':
    case 'keyup':
      if (userEvent.handler?.simulate) {
        await player[userEvent.type](userEvent); // this can result in a navigation to another page.
      }
      if (userEvent.handler?.record) {
        await recordUserAction(userEvent);
      }

      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      break;
    case 'connect':
      console.debug(
        `connect: connection established from frame ${userEvent.sender.frameId} ${userEvent.sender.href}`
      );

      // FIXME: the recorder didn't know its frameID when it asked to connect, so I can't really
      // use the 'to' correctly here. I'd ike to sendback the correct frameID right away.
      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      }); // ack
      await tellRecordersTheirFrameIds(); // the recorder doesn't know it's frameId when it is connected, so tell it (them all)
      break;
    default: // ack
      console.warn(`unexpected userEvent received <${userEvent.type}>`);
      postMessage({
        type: 'complete',
        args: userEvent.type,
        to: userEvent.sender.frameId,
      });
      break;
  }
}

/** state to know if we are already in the midde of the recordTab function,
 * to prevent doing it twice.
 */
let recordTabFunctionExecuting = false;

/**
 * Record the Tab.active tab. This should be the top level
 * safe/idempotent call to establish recording of the given tab.
 * @param {Tab} tab
 */
async function recordTab() {
  let tab = Tab.active;
  console.log(`record tab:${tab.id}`);

  if (recordTabFunctionExecuting) {
    console.warn('the recordTabFunction is already in progress');
    return;
  }
  recordTabFunctionExecuting = true;

  // FIXME: what happens if we spawn a "real window"?
  player.tab = tab; // at this point the debugger is already attached, to the popup (which is like a tab to the mainwindow, but in its own browser window?)

  await prepareToRecord();

  // FIXME: I don't want to ignore the "native" size secondary tabs or popups that are recorded. need to be a little careful here.
  // need these e.g. when a redirect nav occurs on the current tab. like in login.
  await Tab.active.resizeViewport();

  await startRecorders();
  recordTabFunctionExecuting = false;
}

/**
 * Change the active tab that the player instance
 * is currently playing.
 * @param {Tab} tab
 */
async function playTab() {
  let tab = Tab.active;
  console.log(`play tab:${tab.chromeTab.id}`);

  // FIXME: what happens if we spawn a "real window"?
  player.tab = tab; // at this point the debugger is already attached, to the popup (which is like a tab to the mainwindow, but in its own browser window?)

  player.usedFor = 'playing';
  addEventHandlers();
}

/** Used to wait for all frameoffsets to be reported */
var _waitForFrameOffsetMessageFromFrameId;

/** used to resolve a promise via external function */
var _resolvePostMessageResponsePromise;

/** used to reject a promise via external function */
var _rejectPostMessageResponsePromise;

/**
 * Return a frame offset structure for this frame.
 * @param {number} frameId 0 is main frame, positive is a child frame.
 *
 * FIXME: consider using https://chromedevtools.github.io/devtools-protocol/tot/Page/#event-frameAttached
 * to keep frame info in sync.
 */
async function getFrameOffset(frameId) {
  let frameOffset = {
    left: 0,
    top: 0,
  };

  if (!frameId) {
    return frameOffset; // main frame
  }
  // else - a child frame made this request

  /** Array of frames in the current tab
   * https://developer.chrome.com/docs/extensions/reference/webNavigation/#method-getAllFrames
   */
  let frames = await new Promise((resolve) =>
    chrome.webNavigation.getAllFrames(
      { tabId: Tab.active.chromeTab.id },
      resolve
    )
  ); // get all frames

  // find my offset and all my ancestors offsets too
  for (
    let frame = frames.find((f) => f.frameId === frameId);
    frame.parentFrameId >= 0;
    frame = frames.find((f) => f.frameId === frame.parentFrameId)
  ) {
    /** https://developer.chrome.com/docs/extensions/reference/tabs/#method-sendMessage */
    _waitForFrameOffsetMessageFromFrameId = frame.frameId; // I am waiting for my own offset to be broadcast from my parent

    // create 'externally' resolved promise
    let p = new Promise((resolve, reject) => {
      _resolvePostMessageResponsePromise = resolve;
      _rejectPostMessageResponsePromise = reject;
    });

    // tell this frames parent to broadcast down into his kids (including this frame) their offsets
    await chrome.tabs.sendMessage(
      Tab.active.chromeTab.id,
      { func: 'postMessageOffsetIntoIframes' },
      { frameId: frame.parentFrameId }
    );
    // it's posted, but that doesn't mean much

    let response = await p; // eventually some 'frameOffset' messages come in, and when I see mie (this frame) this promise is resolved with my offset.

    frameOffset.left += response.left;
    frameOffset.top += response.top;
  }

  return frameOffset;
}
