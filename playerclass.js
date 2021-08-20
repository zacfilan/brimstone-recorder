import { pixelmatch } from "./dependencies/pixelmatch.js";
import { Screenshot } from "./ui/screenshot.js";

const PNG = png.PNG;
const Buffer = buffer.Buffer; // pngjs uses Buffer
import { Tab } from "./tab.js"
import { sleep } from "./utilities.js";
import { constants, TestAction } from "./ui/card.js";
import { loadOptions } from "./options.js";
import { getHydratedForPlayPromise } from "./ui/loader.js";

var options;

export class Player {
    /** The currently executing step. */
    actionStep;

    /** The last actual screenshot taken. It will hold the error state when an 
    * actions expectedScreenshot doesn't match the actualScreenshot
    */
    actualScreenshotBuffer;

    _playbackComplete = false;

    /** resolved when the last scheduled debugger detach is done. */
    _debuggerDetachPromise;

    /** resolved when the last scheduled debugger attached is done. */
    _debuggerAttachPromise;

    /** Know if there are navigations in flight. */
    _navigationsInFlight = 0;

    constructor() {
        /**
         * The tab we are playing on.
         * @type {Tab}
         */
        this.tab = null;
    }

    /** 
     * Play the current set of actions. This allows actions to be played one
     * at a time or in chunks. 
     * 
     * Returns a deferred boolean that reflects the success of playing all the steps:
     * true if they all played successfully, false if one failed.
     * @param {TestAction[]} actions the actions to play
     * */
    async play(actions, startIndex = 0, resume = false) {
        this._actions = actions;
        this._stopPlaying = false;

        options = await loadOptions();
        document.documentElement.style.setProperty('--screenshot-timeout', `${options.MAX_VERIFY_TIMEOUT}s`);

        let v = await getHydratedForPlayPromise();

        this._actions = actions;
        this.mouseLocation = { x: -1, y: -1 }; // off the viewport I guess

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
            console.log(`[${action.index}] : ${action.description}`);
            start = performance.now();

            // if we are resume(ing) we are picking up from an error state, meaning we already
            // performed the action, we just need to do the verification again for the first action.
            if (!resume || i !== startIndex) {
                await this[action.type](action); // really perform this in the browser (this action may start some navigations)
            }

            // remember any mousemoving operation, implicit or explicit
            switch (action.type) {
                case 'click':
                case 'dblclick':
                case 'contextmenu':
                case 'mousemove':
                case 'wheel':
                    /** Remember any mousemoving operation played, implicit or explicit */
                    this.mouseLocation = { x: action.x, y: action.y };
                    break;
            }

            await this.verifyScreenshot(next);
            stop = performance.now();
            action._view = constants.view.EXPECTED;
            switch (next._match) {
                case constants.match.PASS:
                case constants.match.ALLOW:
                    console.debug(`\t\tscreenshot verified in ${stop - start}ms`);
                    next._view = constants.view.EXPECTED;
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

    async start(action) {
        console.debug("player: start");
        // If we just recorded it and want to play it back, we can reuse the window we recorded it from
        // We can reuse the tab we launched the UI from.
        await chrome.tabs.update(this.tab.id, {
            highlighted: true,
            active: true,
            url: action.url
        });
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
    }

    async wheel(action) {
        console.debug(`player: dispatch mouseWheel from ${action.x}, ${action.y}`);
        await this.debuggerSendCommand('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: action.x,
            y: action.y,
            deltaX: action.deltaX,
            deltaY: action.deltaY,
            pointerType: 'mouse'
        });
    }

    /** Chords must start with Alt, Ctrl, Meta/Command, or Shift */
    async chord(action) {
        let Alt = 1;
        let Ctrl = 2;
        let Meta = 4;
        let Shift = 8;
        for (let i = 0; i < action.keysDown.length; ++i) {
            let key = action.keysDown[i];
            let args = {
                type: 'keyDown',
                modifiers: Ctrl,
                code: key.code,
                key: key.key,
                windowsVirtualKeyCode: key.keyCode,
                nativeVirtualKeyCode: key.keyCode
            };
            if (i > 0) {
                args.modifiers = Ctrl; // FIXME:!
            }
            await this.debuggerSendCommand('Input.dispatchKeyEvent', args);
        }

        for (let i = 0; i < action.keysUp.length; ++i) {
            let key = action.keysUp[i];
            let args = {
                type: 'keyUp',
                modifiers: Ctrl,
                code: key.code,
                key: key.key,
                windowsVirtualKeyCode: key.keyCode,
                nativeVirtualKeyCode: key.keyCode
            };
            if (i > 0) {
                args.modifiers = Ctrl; // FIXME:!
            }
            await this.debuggerSendCommand('Input.dispatchKeyEvent', args);
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
        let differencesPng;
        let i = 0;

        // this loop will run even if the app is in the process of navigating to the next page.
        while (((performance.now() - start) / 1000) < options.MAX_VERIFY_TIMEOUT) {
            if (this._stopPlaying) { // asyncronously injected
                nextStep._view = constants.view.EXPECTED;
                nextStep._match = constants.match.CANCEL;
                return nextStep._match;
            }
            ++i;
            // await this.tab.resizeViewport(); // this just shouldn't be needed but it is! // FIXME: figure this out eventually

            // There is an IMPLICIT mousemove before any *click* action. I don't make it explicit (don't record it) because I might need to do it several times to get to the correct state.
            switch (nextStep.type) {
                case 'stop':
                case 'click':
                case 'dblclick':
                case 'contextmenu':
                case 'wheel':
                    // if the next step is any implicit mouse operation, we want to mousein into the next location, so as to change the screen correctly with hover effect.
                    // this requires moving (back) to the current location first, then into the next location 
                    await this.mousemove(this.mouseLocation);
                    await this.mousemove(nextStep);
                    if (nextStep.hoverTime) {
                        await sleep(nextStep.hoverTime);
                    }
                    break;
            }

            nextStep.actualScreenshot = await this.takeScreenshot(nextStep.expectedScreenshot.png.width, nextStep.expectedScreenshot.png.height);
            if (!nextStep.actualScreenshot) {
                console.debug('unable to obtain screenshot!');
                continue; // couldn't get screenshot for some reason - well it didn't match then. loop.
            }
            nextStep.actualScreenshot.fileName = `step${nextStep.index}_actual.png`;

            let { numUnusedMaskedPixels, numDiffPixels, numMaskedPixels, diffPng } = Player.pngDiff(nextStep.expectedScreenshot.png, nextStep.actualScreenshot.png, nextStep.acceptablePixelDifferences?.png);

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
        nextStep._view = constants.view.EXPECTED;

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
        }

        return nextStep._match;
    }

    /**
    * Take a screenshot of an expected size.
    */
    async takeScreenshot(expectedWidth, expectedHeight) {
        try {
            // unthrottled. 
            let result = await this.debuggerSendCommand('Page.captureScreenshot', {
                format: 'png'
            });
            // result can come back undefined/null. (debugger not attached?)
            let dataUrl = 'data:image/png;base64,' + result.data;
            let png = await Player.dataUrlToPNG(dataUrl);
            if (expectedWidth && (expectedWidth !== png.width || expectedHeight !== png.height)) {
                console.debug(`require ${expectedWidth}x${expectedHeight} got ${png.width}x${png.height}`);
                await this.tab.resizeViewport();
                throw 'resize and try again'; // try one more time after a resize?
            }
            return new Screenshot({
                png,
                dataUrl
            });
        }
        catch (e) {
            console.warn(`unable to obtain screenshot: `, e);
        }
    }

    async debuggerSendCommand(method, commandParams) {
        try {
            await this._debuggerDetachPromise;
            await this._debuggerAttachPromise;
            return await (new Promise(resolve => chrome.debugger.sendCommand({ tabId: this.tab.id }, method, commandParams, resolve)));
        }
        catch (e) {
            if (e.message === 'detached while') {
                return; // we have a handler for when the debugger detaches, if there was something in flight ignore it.
            }
            throw e;
        }
    }

    /** Schedule detaching the debugger from the current tab.*/
    async detachDebugger() {
        console.debug("schedule detaching debugger");
        //await this._attachDebuggerPromise; // if there is one in flight wait for it.

        this._debugger_detatch_requested = true;
        if (!this.tab) {
            this._debuggerDetachPromise = Promise.resolve();
        }
        else {
            this._debuggerDetachPromise = new Promise(resolve => {
                chrome.debugger.detach({ tabId: this.tab.id }, () => {
                    resolve(chrome.runtime.lastError);
                });
            });
        }
        await this._debuggerDetachPromise;
        console.debug("debugger detached");
    }

    /** Schedule attaching the debugger to the given tab.
    * @param {Tab} tab The tab to attach to
    */
    async attachDebugger({ tab }) {
        console.debug(`schedule attach debugger`);
        await this._debuggerDetachPromise; // if there is one in flight wait for it.
        this._debugger_detatch_requested = false;
        this.tab = tab;

        await (new Promise(async (resolve, reject) => {
            let p = new Promise(resolve => chrome.debugger.getTargets(resolve));
            let targets = await p;
            if (!targets.find(target => target.tabId === tab.id && target.attached)) {
                chrome.debugger.attach({ tabId: tab.id }, "1.3", resolve);
            }
            else {
                // As long as the user didn't manually attach a debugger to this tab, then we are ok to reuse it, which is a better experience for the user
                // However if, the user (or me as a dev) attach the devtools manually to page being recorded that will confuse this logic, 
                // and we might not be able control the browser. FIXME: I can't yet tell the difference programatically.
                console.debug(`a debugger is already attached to tab ${tab.id}`);
                resolve('the debugger is already attached');
            }
        }));

        // when you attach a debugger you need to wait a moment for the ["Brimstone" started debugging in this browser] banner to 
        // start animating and changing the size of the window&viewport, before fixing the viewport area lost.
        await sleep(500); // the animation should practically be done after this, but even if it isn't we can deal with it
        this._debuggerAttachPromise = this.tab.resizeViewport();  // reset the viewport - I wish chrome did this.

        await this._debuggerAttachPromise;
        console.debug(`debugger attached`);
        return this._debuggerAttachPromise;
    };

    async stopPlaying() {
        /** used to async cancel a playing test */
        this._stopPlaying = true;
    }

}

/** 
 * Given a data URL we return a PNG of from it.
 */
Player.dataUrlToPNG = async function dataUrlToPNG(dataUrl) {
    if (!dataUrl) {
        throw 'oh dear!';
    }
    let response = await fetch(dataUrl);
    let buffer = Buffer.from(await response.arrayBuffer());
    let png = PNG.sync.read(buffer); // FIXME: slower than a string compare on the base64
    return png;
}

Player.pngDiff = function pngDiff(expectedPng, actualPng, maskPng) {
    const { width, height } = expectedPng;

    if (actualPng.width !== width || actualPng.height !== height) {
        actualPng = new PNG({ width, height });
    }

    const diffPng = new PNG({ width, height }); // new 
    var { numDiffPixels, numMaskedPixels, numUnusedMaskedPixels } = pixelmatch(expectedPng.data, actualPng.data, diffPng.data, width, height, { threshold: .1, ignoreMask: maskPng?.data });
    return {
        numUnusedMaskedPixels,
        numDiffPixels,
        numMaskedPixels,
        diffPng
    };
};
