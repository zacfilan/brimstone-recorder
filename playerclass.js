import { pixelmatch } from "./pixelmatch.js"
const PNG = png.PNG;
const Buffer = buffer.Buffer; // pngjs uses Buffer

export class Player {
    /** The currently executing step. */
    actionStep;

    /** The last actual screenshot taken. It will hold the error state when an 
    * actions expectedScreenshot doesn't match the actualScreenshot
    */
    actualScreenshotBuffer;

    constructor(windowId, tabId) {
        this.windowId = windowId;
        this.tabId = tabId;
    }

    /** 
     * Play the current set of actions. This allows actions to be played one
     * at a time or in chunks. */
    async play(steps) {
        try {
            this.tab = await chrome.tabs.get(this.tabId);
        }
        catch (e) {
            this.tab = await chrome.tabs.create({ windowId: this.windowId });
        }
        this.tabId = this.tab.id;

        // // https://developer.chrome.com/docs/extensions/reference/windows/#method-create
        // this.window = await chrome.windows.create({
        //     focused: true,
        //     url: steps[0].url,
        //     height: steps[0].tabHeight,
        //     width: steps[0].tabWidth
        // });

        // this.tab = this.window.tabs[0];
        // this.tabId = this.tab.id;

        // start timer
        let start;
        let stop;
        for (let i = 0; i < steps.length - 1; ++i) {
            this.actionStep = steps[i];
            delete this.actionStep.actualScreenshot; // we are replaying this step, drop any previous results
            console.log(`[${this.actionStep.index}] : ${this.actionStep.description}`);

            // preload the state that we expect when the current action completes.
            // don't include this in the performance measurement.
            this.nextStep = steps[i + 1];

            try {
                start = performance.now();
                await this[this.actionStep.type](); // execute this guy
                await this.verifyScreenshot(this.nextStep);
                stop = performance.now();
                console.log(`\t\tscreenshot verified in ${stop - start}ms`);
            }
            catch (e) {
                stop = performance.now();
                console.log(`\t\tscreenshots still unmatched after ${stop - start}ms`);
                throw e;
            }
            // end timer
        }
    }

    async start() {
        // If we just recorded it and want to play it back, we can reuse the window we recorded it from
        // We can reuse the tab we launched the UI from.
        await chrome.tabs.update(this.tab.id, {
            highlighted: true,
            active: true,
            url: this.actionStep.url
        });

        await chrome.debugger.attach({ tabId: this.tab.id }, "1.3"); // FIXME: tbd
        await Player.sleep(3000);
        await this.setViewport(this.actionStep.tabWidth, this.actionStep.tabHeight); // that debug banner needs to be figured into the size too.
    }

    async keydown() {
        // simulate a keypress https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-dispatchKeyEvent
        let keycode = this.actionStep.event.keyCode;

        chrome.debugger.sendCommand({tabId: this.tab.id}, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            code: this.actionStep.event.code,
            key: this.actionStep.event.key,
            windowsVirtualKeyCode: keycode,
            nativeVirtualKeyCode: keycode
        });
        var printable = 
            (keycode > 47 && keycode < 58)   || // number keys
            keycode == 32 || keycode == 13   || // spacebar & return key(s) (if you want to allow carriage returns)
            (keycode > 64 && keycode < 91)   || // letter keys
            (keycode > 95 && keycode < 112)  || // numpad keys
            (keycode > 185 && keycode < 193) || // ;=,-./` (in order)
            (keycode > 218 && keycode < 223);   // [\]' (in order)
        if(printable) {
            chrome.debugger.sendCommand({tabId: this.tab.id}, 'Input.dispatchKeyEvent', {
                type: 'char',
                code: this.actionStep.event.code,
                key: this.actionStep.event.key,
                text: this.actionStep.event.key,
                unmodifiedtext: this.actionStep.event.key,
                windowsVirtualKeyCode: keycode,
                nativeVirtualKeyCode: keycode
            });
        }
        chrome.debugger.sendCommand({tabId: this.tab.id}, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            code: this.actionStep.event.code,
            key: this.actionStep.event.key,
            windowsVirtualKeyCode: this.actionStep.event.keyCode,
            nativeVirtualKeyCode: this.actionStep.event.keyCode
        });
    }

    async mousedown() {
        // simulate a click https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-dispatchMouseEvent
        chrome.debugger.sendCommand({tabId: this.tab.id}, 'Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: this.actionStep.x,
            y: this.actionStep.y,
            button: 'left',
            buttons: 1,
            clickCount: 1,
            pointerType: 'mouse'
        });
        chrome.debugger.sendCommand({tabId: this.tab.id}, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: this.actionStep.x,
            y: this.actionStep.y,
            button: 'left',
            buttons: 1,
            clickCount: 1,
            pointerType: 'mouse'
        });
    }

    async move(x, y) {
        chrome.debugger.sendCommand({tabId: this.tab.id}, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
            pointerType: 'mouse'
        });
        return;
    }

    /**
     * Repeatedly check the expected screenshot against the actual screenshot.
     * Return when the match, throw if they do not within given time.
     * 
     * @returns 
     */
    async verifyScreenshot(nextStep) {
        const { png: expectedPng } = await Player.dataUrlToPNG(nextStep.expectedScreenshot.dataUrl);

        let max_verify_timout = 5; // seconds
        let sleepMs = 500;
        let MaxCheckForEqualityCount = Math.floor((max_verify_timout * 1000) / sleepMs);
        let actualScreenshot;
        for (let checkForEqualityCount = 0; checkForEqualityCount < MaxCheckForEqualityCount; ++checkForEqualityCount) {
            try {
                if (this.actionStep.type === 'mousedown') {
                    // for a click, we first mouseover the location, so as to change the screen correctly with hover effect
                    //console.log(`move mouse to (500,500), and then to (${this.actionStep.clientX}, ${this.actionStep.clientY})`)
                    await this.move(500, 500);
                    await this.move(this.actionStep.clientX, this.actionStep.clientY);
                    await Player.sleep(sleepMs);
                }

                actualScreenshot = await this.takeScreenshot();
                let actualPng = actualScreenshot.png;

                let { numDiffPixels, diffPng } = Player.pngDiff(expectedPng, actualPng);
                if (numDiffPixels === 0) {
                    return;
                }
            }
            catch (e) {
                console.warn(e);
            }
            if (this.actionStep.type !== 'mousedown') {
                await Player.sleep(sleepMs);
            }
        }

        // The screenshots don't match
        nextStep.actualScreenshot = { // the presence of this indicates a failure of the action on the previous step to result in the required screenshot for the next step
            dataUrl: actualScreenshot.dataUrl,
            fileName: `step${nextStep.index}_actual.png`
        };
        throw {
            message: 'screenshots do not match',
            failingStep: nextStep // technicaly the current step executing the action (the actionStep) failed but, the error is visible on the step.
        };
    }

    /** Turn the tab we were launched from into the initial state 
    * of the recording we are playing back. Set url, viewport, and focus.
    */
    async setViewport(width, height) {
        function getBorder() {
            return {
                width: window.outerWidth - window.innerWidth,
                height: window.outerHeight - window.innerHeight
            };
        }

        let frames = await chrome.scripting.executeScript({
            target: { tabId: this.tab.id },
            function: getBorder,
        });
        let border = frames[0].result;

        await chrome.windows.update(this.tab.windowId, {
            focused: true,
            width: width + border.width,
            height: height + border.height
        });
    };

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

}

Player.sleep = async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

Player.dataUrlToPNG = async function dataUrlToPNG(dataUrl) {
    let response = await fetch(dataUrl);
    let buffer = Buffer.from(await response.arrayBuffer());
    let png = PNG.sync.read(buffer); // FIXME: slower than a string compare on the base64

    return {
        dataUrl,
        png
    };
}

Player.pngDiff = function pngDiff(expectedPng, actualPng) {
    const { width, height } = expectedPng;

    if (actualPng.width !== width || actualPng.height !== height) {
        actualPng = new PNG({ width, height });
    }

    const diffPng = new PNG({ width, height });
    var numDiffPixels = pixelmatch(expectedPng.data, actualPng.data, diffPng.data, width, height, { threshold: 0.5 });
    return {
        numDiffPixels,
        diffPng
    };
};



