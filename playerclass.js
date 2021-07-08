import { pixelmatch } from "./dependencies/pixelmatch.js"
const PNG = png.PNG;
const Buffer = buffer.Buffer; // pngjs uses Buffer
import { Tab } from "./tab.js"
import { sleep } from "./utilities.js";
import {status, Step} from "./ui/card.js";

export class Player {
    /** The currently executing step. */
    actionStep;

    /** The last actual screenshot taken. It will hold the error state when an 
    * actions expectedScreenshot doesn't match the actualScreenshot
    */
    actualScreenshotBuffer;

    _playbackComplete = false;

    constructor() {
        /**
         * The tab we are playing on.
         * @type {Tab}
         */
        this.tab = null;
    }

    async continue() {
        return this.play(this.actions, this.actionStep.index);
    }

    /** 
     * Play the current set of actions. This allows actions to be played one
     * at a time or in chunks. */
    async play(actions, startIndex = 0) {
        this._actions = actions;
        this._playbackComplete = false;
        this.mouseLocation = {x: -1, y:-1}; // off the viewport I guess

        // start timer
        let start;
        let stop;
        for (let i = startIndex; !this._playbackComplete && (i < actions.length - 1); ++i) {
            let action = actions[i];
            action.status = status.INPUT;
            let next = actions[i+1];
            next.status = status.WAITING;

            if (this.onBeforePlay) {
                await this.onBeforePlay(action);
            }

            delete action.actualScreenshot; // we are replaying this step, drop any previous results
            console.log(`[${action.index}] : ${action.description}`);

            try {
                start = performance.now();

                await this[action.type](action); // really perform this in the browser
                // remember any mousemoving operation, implicit or explicit
                switch (action.type) {
                    case 'click':
                    case 'dblclick':
                    case 'contextmenu':
                    case 'mousemove':
                        this.mouseLocation = {x: action.x, y: action.y};
                        break;
                }


                await this.verifyScreenshot(next);
                stop = performance.now();
                console.log(`\t\tscreenshot verified in ${stop - start}ms`);
                action.status = status.INPUT;
                next.status = status.INPUT;
                if (this.onAfterPlay) {
                    await this.onAfterPlay(action);
                }
            }
            catch (e) {
                stop = performance.now();
                console.log(`\t\tscreenshots still unmatched after ${stop - start}ms`);
                this._playbackComplete = true;
                action.status = status.INPUT;
                if (this.onAfterPlay) {
                    await this.onAfterPlay(action);
                }
                throw e;
            }
            // end timer
        }

        this._playbackComplete = true;
    }

    stop() {
        this._playbackComplete = true;
    }

    async start(action) {
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
        console.log(`\t\tmousemove ${action.x},${action.y}`);
        await this.debuggerSendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: action.x,
            y: action.y,
            pointerType: 'mouse'
        });
    }

    /**
     * Called after we play the current action.
     * 
     * Repeatedly check the expected screenshot required to start the next action
     * against the actual screenshot. 
     * 
     * Return when they match, throw if they do not match within given time.
     * 
     * @returns 
     */
    async verifyScreenshot(nextStep) {
        let start = performance.now();

        const { png: expectedPng } = await Player.dataUrlToPNG(nextStep.expectedScreenshot.dataUrl);
        let acceptableErrorsPng = undefined;
        if (nextStep.acceptablePixelDifferences?.dataUrl) {
            acceptableErrorsPng = (await Player.dataUrlToPNG(nextStep.acceptablePixelDifferences.dataUrl)).png;
        }

        let max_verify_timout = 15; // seconds

        let actualScreenshot;
        let differencesPng;
        while (((performance.now() - start) / 1000) < max_verify_timout) {
            await this.tab.resizeViewport(); // this just shouldn't be needed but it is! // FIXME: figure this out eventually

            // There is an IMPLICIT mousemove before any *click* action. I don't make it explicit because I might need to do it several times to get to the correct state.
            switch (nextStep.type) {
                case 'click':
                case 'dblclick':
                case 'contextmenu':
                    // if the next step is any implicit mouse operation, we want to mousein into the next location, so as to change the screen correctly with hover effect.
                    // this requires moving (back) to the current location first, then into the next location 
                    await this.mousemove(this.mouseLocation);
                    await this.mousemove(nextStep);
                    break;
            }

            actualScreenshot = await this.takeScreenshot();
            let actualPng = actualScreenshot.png;
            let { numDiffPixels, numMaskedPixels, diffPng } = Player.pngDiff(expectedPng, actualPng, acceptableErrorsPng);
            differencesPng = diffPng;
            if (numDiffPixels === 0) {
                if (numMaskedPixels) {
                    nextStep.actualScreenshot = {
                        dataUrl: actualScreenshot.dataUrl,
                        fileName: `step${nextStep.index}_actual.png`
                    };
                    nextStep.status = status.ALLOWED;
                }
                let doneIn = ((performance.now() - start) / 1000).toFixed(1);
                console.log(`step done in ${doneIn} seconds`);
                return;
            }
        }

        // The screenshots don't match
        nextStep.status = status.EXPECTED;
        nextStep.actualScreenshot = { 
            dataUrl: actualScreenshot.dataUrl,
            fileName: `step${nextStep.index}_actual.png`
        };
        // and the editable image.
        nextStep.diffDataUrl = 'data:image/png;base64,' + PNG.sync.write(differencesPng).toString('base64');
        
        throw {
            message: 'screenshots do not match',
        };
    }

    /**
    * Take a screenshot convert it to a PNG objec and return it.
    * @returns {{dataUrl, actualScreenshot: PNG}}
    */
    async takeScreenshot() {
        let dataUrl = await chrome.tabs.captureVisibleTab(this.tab.windowId, {
            format: 'png'
        });
        return await Player.dataUrlToPNG(dataUrl);
    }

    async debuggerSendCommand(method, commandParams) {
        return new Promise(resolve => chrome.debugger.sendCommand({ tabId: this.tab.id }, method, commandParams, resolve));
    }

    /** I don't think you should call this. It takes too long for chrome to remove the banner after the debugger is detached.
     * 
     */
    async detachDebugger() {
        return;
        try {
            this._detachExpected = true;
            console.log("detaching debugger");

            // This is a crazy slow operation. Several seconds before the banner is removed.
            await (new Promise(resolve => {
                chrome.debugger.detach({ tabId: this.tab.id }, () => {
                    resolve(chrome.runtime.lastError);
                });
            }));

            await sleep(1000); // the animation should practically be done after this, but even if it isn't we can deal with it
            await this.tab.resizeViewport();  // reset the viewport - I wish chrome did this.

        }
        catch (e) {
            console.error(e);
        }
    }

    /** Attach the debugger to the given tab, and set the viewport size appropriately.
    * @param {Tab} tab The tab to attach to
    */
    async attachDebugger({ tab, canceled_by_user, debugger_already_attached }) {
        this._detachExpected = false;
        let targets = await (new Promise(resolve => chrome.debugger.getTargets(resolve)));
        if (targets.find(target => target.tabId === tab.id && target.attached)) {
            debugger_already_attached();
        }
        else {
            await new Promise(resolve => chrome.debugger.attach({ tabId: tab.id }, "1.3", resolve));
            // when you attach a debugger you need to wait a moment for the ["Brimstone" started debugging in this browser] banner to 
            // start animating and changing the size of the window&viewport, before fixing the viewport area lost.
            console.log(`debugger attached to ${tab.id}`);
            this.tab = tab;
            let player = this;
            await sleep(500); // the animation should practically be done aftre this, but even if it isn't we can deal with it

            await tab.resizeViewport();
            /** Automatically reattach the debugger if the recording navigated away from the page */
            chrome.debugger.onDetach.addListener(async (source, reason) => {
                console.log("The debugger was detached!!");
                if (reason === 'canceled_by_user') {
                    await sleep(500);
                    await tab.resizeViewport();
                    canceled_by_user();
                }
                else if (this._detachExpected) {
                }
                else {
                    // https://developer.chrome.com/docs/extensions/reference/debugger/#type-DetachReason
                    console.warn('try: re-attaching the debugger!');
                    await player.attachDebugger({ tab, canceled_by_user, debugger_already_attached });
                    console.warn('end: re-attaching the debugger!');
                }
            });
        }
    };
}

Player.dataUrlToPNG = async function dataUrlToPNG(dataUrl) {
    let response = await fetch(dataUrl);
    let buffer = Buffer.from(await response.arrayBuffer());
    let png = PNG.sync.read(buffer); // FIXME: slower than a string compare on the base64

    return {
        dataUrl,
        png
    };
}

Player.pngDiff = function pngDiff(expectedPng, actualPng, maskPng) {
    const { width, height } = expectedPng;

    if (actualPng.width !== width || actualPng.height !== height) {
        actualPng = new PNG({ width, height });
    }

    const diffPng = new PNG({ width, height });
    var { numDiffPixels, numMaskedPixels } = pixelmatch(expectedPng.data, actualPng.data, diffPng.data, width, height, { threshold: .1, ignoreMask: maskPng?.data });
    return {
        numDiffPixels,
        numMaskedPixels,
        diffPng
    };
};
