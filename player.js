import { pixelmatch } from "./dependencies/pixelmatch.js";
import { Screenshot } from "./ui/screenshot.js";

const PNG = png.PNG;
const Buffer = buffer.Buffer; // pngjs uses Buffer
import { Tab } from "./tab.js"
import { sleep, extractPngSize } from "./utilities.js";
import { constants, TestAction } from "./ui/card.js";
import { loadOptions } from "./options.js";
import { Test } from "./test.js";
import * as Errors from "./error.js";

var options;

/**
 * This function is injected and run in the app
 * 
 * Scroll the element that matches the css to the given value
 */
function _scroll(x, y, top, left) {
    // https://stackoverflow.com/questions/35939886/find-first-scrollable-parent
    // function getScrollParent(element, includeHidden) {
    //     var style = getComputedStyle(element);
    //     var excludeStaticParent = style.position === "absolute";
    //     var overflowRegex = includeHidden ? /(auto|scroll|hidden)/ : /(auto|scroll)/;

    //     if (style.position === "fixed") return document.body;
    //     for (var parent = element; (parent = parent.parentElement);) {
    //         style = getComputedStyle(parent);
    //         if (excludeStaticParent && style.position === "static") {
    //             continue;
    //         }
    //         if (overflowRegex.test(style.overflow + style.overflowY + style.overflowX)) return parent;
    //     }

    //     return document.body;
    // }
    // debugger;
    //var elem = getScrollParent(document.elementFromPoint(x, y)); // will this work in a frame ?

    // This is sufficient if you perform the scroll over the scrollbars.
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
* @param {number} x the x coordinate of the select element
* @param {*} y  the y coordinate of the select element
* @param {*} value the vaue to set the select element to
* @returns {string} an error message on error
*/
function _changeSelectValue(x, y, value) {
    try {
        var select = document.elementFromPoint(x, y);
        if (select.tagName !== 'SELECT') {
            return 'not a select element';
        }
        if (select.value === value) {
            return;
        }
        select.value = value;
        select.dispatchEvent(new Event('change'));

        select.focus(); // used in conjunction with the keypres escape to close the shadow DOM
    }
    catch (e) {
        return e.message;
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

    /** The last actual screenshot taken. It will hold the error state when an 
    * actions expectedScreenshot doesn't match the actualScreenshot
    */
    actualScreenshotBuffer;

    /** mode switch either 'playing' or 'recording', something of a hack. */
    usedFor;

    /** Know if there are navigations in flight. */
    _navigationsInFlight = 0;

    /** sensatively parameter to pixelmatch, lower is stricter */
    pixelMatchThreshhold = .1;

    /**
     * control the speed at which typing multiple back to back characters occurs.
     * used to simuate slower human typers.
     */
    interKeypressDelay = 0;

    /** 
     * The last known mouselocation during playback. This is used during a resume
     * playback operation to put the mouse back to where it was prior to 
     * rechecking the screenshots. 
     */
    // mouseLocation = {
    //     x: -1,
    //     y: -1
    // };

    /** asynchronously injectable switch to stop the player from playing */
    _stopPlaying = false;

    /**
     * @type {Promise<any>} way to block a debugger cmd until the debugger is (re)attached.
     */
    _debuggerAttached = null;

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
        console.debug(`begin (try) switch to tab:${action.tab.id} w/url ${action.tab.url}`);
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
            console.warn("we may be hiding an application bug where the app is resizing a tab/window differently than before");

            await this.tab.resizeViewport();
        }
        // else it is on the same tab, so we don't need to switch.
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
     * */
    async play(test, startIndex = 0, resume = false) {
        this._actions = test.steps;
        this._stopPlaying = false;

        options = await loadOptions();
        document.documentElement.style.setProperty('--screenshot-timeout', `${options.MAX_VERIFY_TIMEOUT}s`);
        this.pixelMatchThreshhold = options.pixelMatchThreshhold;
        this.interKeypressDelay = options.interKeypressDelay;
        let actions = this._actions;

        // start timer
        let start;
        let stop;
        let next;
        for (let i = startIndex; i < actions.length - 1; ++i) {
            let action = actions[i];
            this.currentAction = action;
            action._view = constants.view.EXPECTED;

            next = actions[i + 1];
            next._match = constants.match.PLAY;
            if (this.onBeforePlay) {
                await this.onBeforePlay(action);
            }

            // if we are resume(ing) the first action, we are picking up from an error state, meaning we already
            // performed this action, we just need to put the mouse in the correct spot and
            // do the screen verification again
            if (resume && i === startIndex) {
                // not needed? it is already in the right spot?
                //await this.mousemove(this.mouseLocation); 
            }
            else {
                action.tab.chromeTab = this.tab.chromeTab; // just for debugging
                if(action.waitBeforePlaying) {
                    console.log(`[step:${action.index + 1} tab:${action.tab.id}] wait ${action.waitBeforePlaying}ms before playing`);
                    await sleep(action.waitBeforePlaying);
                }
                console.log(`[step:${action.index + 1} tab:${action.tab.id}] begin play "${action.description}"`);
                await this[action.type](action); // really perform this in the browser (this action may start some navigations)
                console.log(`[step:${action.index + 1} tab:${action.tab.id}] end   play "${action.description}"`);
            }

            // grep for FOCUS ISSUE for details
            if (i === startIndex && action.type === 'goto') {
                await this.mousemove({ x: 0, y: 0 });
                await this.mousemove({ x: -1, y: -1 });
            }

            start = performance.now();
            if (!next.expectedScreenshot || next.shadowDOMAction) { // i don't record an image for shandowdom 
                next._match = constants.view.PASS;
            }
            else {
                await this.verifyScreenshot(next);
            }
            stop = performance.now();

            next.latency = ((stop - start) / 1000).toFixed(1);

            action._view = constants.view.EXPECTED;
            switch (next._match) {
                case constants.match.PASS:
                case constants.match.ALLOW:
                    console.debug(`\t\tscreenshot verified in ${stop - start}ms`);
                    next._view = constants.view.EXPECTED;
                    next.memoryUsed = await this.getClientMemoryByChromeApi();
                    break;// keep on chugging
                case constants.match.FAIL:
                    console.debug(`\t\tscreenshots still unmatched after ${stop - start}ms`);
                    return next._match; // bail early
                    break;
                case constants.match.CANCEL:
                    this._stopPlaying = false;
                    return next._match; // bail early
            }

            if (this.onAfterPlay) {
                await this.onAfterPlay(action);
            }
        }

        return next._match; // should be pass!
    }

    async goto(action) {
        console.debug("player: goto");
        if (action.url.startsWith('active tab')) {
            return; // we aren't realy navigating anywhere
        }

        // I want the navigation done before I exit here
        var resolveNavigationPromise;
        let navPromise = new Promise(resolve => { resolveNavigationPromise = resolve; });
        chrome.webNavigation.onCommitted.addListener(function playerGotoNavCommit(details) {
            chrome.webNavigation.onCommitted.removeListener(playerGotoNavCommit);
            resolveNavigationPromise(details);
        });
        await chrome.tabs.update(this.tab.chromeTab.id, {
            highlighted: true,
            active: true,
            url: action.url
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

    async keypress(action) {
        // simulate a keypress https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-dispatchKeyEvent
        let keycode = action.event.keyCode;

        await this.debuggerSendCommand('Input.dispatchKeyEvent', {
            type: 'keyDown',
            code: action.event.code,
            key: action.event.key,
            windowsVirtualKeyCode: keycode,
            nativeVirtualKeyCode: keycode

        });
        // FIXME: Verify that [ENTER] prints correctly when in a textarea
        // https://stackoverflow.com/questions/1367700/whats-the-difference-between-keydown-and-keypress-in-net
        var printable =
            (keycode > 47 && keycode < 58) || // number keys
            keycode == 32 || keycode == 13 || // spacebar & return key(s) (if you want to allow carriage returns)
            (keycode > 64 && keycode < 91) || // letter keys
            (keycode > 95 && keycode < 112) || // numpad keys
            (keycode > 185 && keycode < 193) || // ;=,-./` (in order)
            (keycode > 218 && keycode < 223);   // [\]' (in order)
        if (printable) {
            let msg = {
                type: 'char',
                code: action.event.code,
                key: action.event.key,
                text: keycode == 13 ? '\r' : action.event.key,
                unmodifiedtext: action.event.key,
                windowsVirtualKeyCode: keycode,
                nativeVirtualKeyCode: keycode
            };
            await this.debuggerSendCommand('Input.dispatchKeyEvent', msg);
        }
        await this.debuggerSendCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            code: action.event.code,
            key: action.event.key,
            windowsVirtualKeyCode: action.event.keyCode,
            nativeVirtualKeyCode: action.event.keyCode
        });
    }

    wait(action) {
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
            pointerType: 'mouse'
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
            modifiers: modifiers
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
            nativeVirtualKeyCode: event.keyCode
        });
    }

    /**
     * Simulate the a change of a select dropdown.
     */
    async change(action) {
        // FIXME: I need to run this in the correct frame!
        let frames = await chrome.scripting.executeScript({
            target: { tabId: this.tab.chromeTab.id /*, frameIds: frameIds*/ },
            function: _changeSelectValue,
            args: [action.x, action.y, action.event.value]
        });
        let errorMessage = frames[0].result;

        if (errorMessage) {
            throw new Error(errorMessage); // I'd want to know that.
        }

        // used in conjustion with the inscript focus to hit escape on the SELECT.
        await this.keypress({
            event: {
                keyCode: 27,
                code: 'Escape',
                key: 'Escape',
            }
        });
    }

    async scroll(action) {
        // FIXME: I need to run this in the correct frame!
        let frames = await chrome.scripting.executeScript({
            target: { tabId: this.tab.chromeTab.id/*, frameIds: frameIds*/ },
            function: _scroll,
            args: [action.x, action.y, action.event.scrollTop, action.event.scrollLeft]
        });
        let errorMessage = frames[0].result;

        if (errorMessage) {
            throw new Error(errorMessage); // I'd want to know that.
        }
    }

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
            nativeVirtualKeyCode: keycode
        });

        if (modifiers === 0 || modifiers === 8) {

            // FIXME: Verify that [ENTER] prints correctly when in a textarea
            // https://stackoverflow.com/questions/1367700/whats-the-difference-between-keydown-and-keypress-in-net
            var printable =
                (keycode > 47 && keycode < 58) || // number keys
                (keycode == 32 || keycode == 13) || // spacebar & return key(s) (if you want to allow carriage returns)
                (keycode > 64 && keycode < 91) || // letter keys
                (keycode > 95 && keycode < 112) || // numpad keys
                (keycode > 185 && keycode < 193) || // ;=,-./` (in order)
                (keycode > 218 && keycode < 223);   // [\]' (in order)
            if (printable) {
                let msg = {
                    type: 'char',
                    code: event.code,
                    key: event.key,
                    text: keycode == 13 ? '\r' : event.key,
                    unmodifiedtext: event.key,
                    windowsVirtualKeyCode: keycode,
                    nativeVirtualKeyCode: keycode
                };
                await this.debuggerSendCommand('Input.dispatchKeyEvent', msg);
            }
        }
    }

    async keys(action) {
        for (let i = 0; i < action.event.length; ++i) {
            let event = action.event[i];
            await this[event.type]({ event }); // pretend it is a distinct action
            // simulate slower typing
            if (this.interKeypressDelay) {
                await sleep(this.interKeypressDelay);
            }
        }
    }

    /**
     * Called after we play the current action.
     * 
     * Repeatedly check the expected screenshot required to start the next action
     * against the actual screenshot. 
     * 
     * @param {TestAction} nextStep the next action. modified.
     * @returns {string} _match property in the nextStep parameter passed in
     */
    async verifyScreenshot(nextStep) {
        let start = performance.now();

        /** Used to display the results of applying the acceptableDifferences to the actual image. */
        let differencesPng = false;
        let i = 0;
        let badTab = false;

        // If the next action is on a different tab, then we need to switch to that tab to 
        // take the screenshot.

        // this loop will run even if the app is in the process of navigating to the next page.
        while (((performance.now() - start) / 1000) < options.MAX_VERIFY_TIMEOUT) {
            if (this._stopPlaying) { // asyncronously injected
                nextStep._view = constants.view.EXPECTED;
                nextStep._match = constants.match.CANCEL;
                return nextStep._match;
            }
            ++i;

            differencesPng = false; // if the last time through we were able to take a screenshot or not

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
                // this is a little weird, I can check for the correct tab + tab size before hand, but it's more efficient to 
                // assume that it will work, than to check every time. make the common case fast.
                if (nextStep.tab.virtualId !== this.tab.virtualId) {
                    await this.configureForAction(nextStep);
                }
                if (badTab) {
                    badTab = false;
                    await this.tab.resizeViewport();
                }
                nextStep.actualScreenshot = await this._takeScreenshot();
            }
            catch (e) {
                console.debug(e.message + '. try again.');
                badTab = true;
                // give other async'ed control paths a chance to run. configureForAction above can be trying to wait for a different tab to become active.
                await sleep(137);
                continue;
            }

            nextStep.actualScreenshot.fileName = `step${nextStep.index}_actual.png`;
            let { numUnusedMaskedPixels, numDiffPixels, numMaskedPixels, diffPng }
                = Player.pngDiff(
                    nextStep.expectedScreenshot.png,
                    nextStep.actualScreenshot.png,
                    nextStep.acceptablePixelDifferences?.png,
                    this.pixelMatchThreshhold
                );

            // FIXME: this should be factored into the card I think
            nextStep.numDiffPixels = numDiffPixels;
            let UiPercentDelta = (numDiffPixels * 100) / (nextStep.expectedScreenshot.png.width * nextStep.expectedScreenshot.png.height);
            nextStep.percentDiffPixels = UiPercentDelta.toFixed(2);

            nextStep.numMaskedPixels = numMaskedPixels;

            differencesPng = diffPng;
            if (numDiffPixels === 0) { // it matched
                nextStep._match = constants.match.PASS;

                nextStep.lastVerifyScreenshotDiffDataUrl = 'data:image/png;base64,' + PNG.sync.write(differencesPng).toString('base64');
                nextStep.editViewDataUrl = nextStep.lastVerifyScreenshotDiffDataUrl;

                if (numMaskedPixels || numUnusedMaskedPixels) { // it matched only because of the masking we allowed
                    nextStep._view = constants.view.EXPECTED;
                    nextStep._match = constants.match.ALLOW;
                }
                let doneIn = ((performance.now() - start) / 1000).toFixed(1);
                let avgIteration = (doneIn / i).toFixed(1);
                console.log(`\tstep done in ${doneIn} seconds. ${i} iteration(s), average time per iteration ${avgIteration}`);
                return nextStep._match;
            }
        }

        // The screenshots don't match
        nextStep._match = constants.match.FAIL;
        nextStep._view = constants.view.EDIT;

        // we can get out of the above loop without actually doing the comparison, if taking the screenshot keeps failing. 
        if (differencesPng) {
            nextStep.lastVerifyScreenshotDiffDataUrl = 'data:image/png;base64,' + PNG.sync.write(differencesPng).toString('base64');
            nextStep.editViewDataUrl = nextStep.lastVerifyScreenshotDiffDataUrl;
        }
        else {
            // else we can't update the actual nor the diff
            delete nextStep.actualScreenshot;
            delete nextStep.lastVerifyScreenshotDiffDataUrl;
            delete nextStep.editViewDataUrl;
            throw new Error('Unable to create screenshot');
        }

        return nextStep._match;
    }

    /** 
     * Uses the debugger API to capture a screenshot.
     * Returns the dataurl on success. Most calls are 
     * to update the expected screen during recording,
     * but is also called in one path for playback inside
     * of verifyScreenshot. 
     * 
     * @throws {DebuggerDetached} on debugger detach errors that can't be fixed with a single attach
     * @throws {IncorrectScreenshotSize} on failure.
     * @throws {Error} on unknown errors
     */
    async captureScreenshotAsDataUrl() {
        let result = await this.debuggerSendCommand('Page.captureScreenshot', {
            format: 'png'
        });
        // result can come back undefined/null. (e.g. debugger not attached, or can detach while the command is in flight)
        let dataUrl = 'data:image/png;base64,' + result.data; // in which case this will throw.

        // else we got *some* dataUrl back
        let size = extractPngSize(result.data);

        if (this.tab.blessed) {
            // since the tab size was blessed by the user we need to check the screenshot size
            let expectedWidth = this.tab.width;
            let expectedHeight = this.tab.height;
            if (expectedWidth && (expectedWidth !== size.width || expectedHeight !== size.height)) {
                throw new Errors.IncorrectScreenshotSize(`wrong screenshot size taken. required ${expectedWidth}x${expectedHeight} got ${size.width}x${size.height}.`);
            }
        }

        // else we got a screenshot of the size we require (or we don't care about the size)
        return new Screenshot({
            dataUrl: dataUrl,
            tab: this.tab,
            dataUrlWidth: size.width,
            dataUrlHeight: size.height
        });
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
        let partialSS = await this.captureScreenshotAsDataUrl();
        let png = await Player.dataUrlToPNG(partialSS.dataUrl);
        console.debug(`took screenshot ${png.width}x${png.height}`);

        return new Screenshot({
            png: png,
            dataUrl: partialSS.dataUrl,
            tab: partialSS.tab
        });
    }

    /** 
     * Send the command to the debugger on the current tab.
     * Returns command result on success.
     * @throws {DebuggerDetached} on debugger detch errors
     * @throws {Error} on unknown errors
     */
    async _debuggerSendCommandRaw(method, commandParams) {
        await this._debuggerAttached;
        console.debug(`begin debugger send command tabId:${this.tab.id} ${method}`, commandParams);
        let result = await (new Promise(resolve => chrome.debugger.sendCommand({ tabId: this.tab.chromeTab.id }, method, commandParams, resolve)));
        let message = chrome.runtime.lastError?.message;
        if (message) {
            if (message.includes('Detached while') || message.includes('Debugger is not attached')) {
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

        for (i = 0; i < 2; ++i) { // at most twice 
            try {
                return await this._debuggerSendCommandRaw(method, commandParams); // the debugger method may be a getter of some kind.
            }
            catch (e) {
                lastException = e;
                if (lastException instanceof Errors.DebuggerDetached) {
                    console.warn(`got exception while running debugger cmd ${method}:`, commandParams, e);
                    if (await this.attachDebugger({ tab: this.tab })) {
                        await this.tab.resizeViewport();
                    }

                    if (this.usedFor === 'playing') {
                        await sleep(2000);
                    }
                }
                else {
                    console.warn(`got exception while running debugger cmd ${method}:`, commandParams, e);
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
        return this._debuggerAttached = new Promise(async (resolve, reject) => {
            await (new Promise(_resolve => chrome.debugger.attach({ tabId: tab.chromeTab.id }, "1.3", _resolve)));
            if (chrome.runtime.lastError?.message) {
                if (!chrome.runtime.lastError.message.startsWith('Another debugger is already attached')) {
                    reject(chrome.runtime.lastError.message); // not sure how to handle that.
                    return;
                }
                // else we can ignore that, that's what we want, we are already attached
                console.debug(`debugger already attached to tabId:${tab.chromeTab.id}`);
                this.tab = tab;
                resolve(false); // an attach was not required 
                return;
            }
            else {
                // else no error - implies that we actually needed to attach the debugger
                console.debug(`debugger was attached to tab:${tab.id}`);
                this.tab = tab;
                resolve(true); // an attach was required
                return;
            }
        });
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
        var getMemory = function () {
            let m = window.performance.memory;
            console.log(`used ${m.usedJSHeapSize} bytes`);
            return {
                jsHeapSizeLimit: m.jsHeapSizeLimit,
                totalJSHeapSize: m.totalJSHeapSize,
                usedJSHeapSize: m.usedJSHeapSize
            };

        }
        let frames = await chrome.scripting.executeScript({
            target: { tabId: this.tab.chromeTab.id },
            function: getMemory
        });

        let memory = frames[0].result;
        return Math.ceil(memory.usedJSHeapSize / Math.pow(2, 20));  // MB
    }
}

/** 
 * Given a data URL we return a PNG from it.
 */
Player.dataUrlToPNG = async function dataUrlToPNG(dataUrl) {
    if (!dataUrl) {
        throw new Error('cannot create a png from a null dataUrl');
    }
    let response = await fetch(dataUrl);
    let buffer = Buffer.from(await response.arrayBuffer());
    let png = PNG.sync.read(buffer); // FIXME: slower than a string compare on the base64
    return png;
}

Player.pngDiff = function pngDiff(expectedPng, actualPng, maskPng, pixelMatchThreshhold) {
    const { width, height } = expectedPng;

    if (actualPng.width !== width || actualPng.height !== height) {
        actualPng = new PNG({ width, height });
    }

    const diffPng = new PNG({ width, height }); // new 
    var { numDiffPixels, numMaskedPixels, numUnusedMaskedPixels } =
        pixelmatch(
            expectedPng.data,
            actualPng.data,
            diffPng.data,
            width,
            height,
            {
                threshold: pixelMatchThreshhold,
                ignoreMask: maskPng?.data
            }
        );

    return {
        numUnusedMaskedPixels,
        numDiffPixels,
        numMaskedPixels,
        diffPng
    };
};

/**
 * This is how i distiguish sythetic events from user events in the recorder.
 * And only 0 works?!
 */
Player.SYNTHETIC_EVENT_TIMESTAMP = 0;