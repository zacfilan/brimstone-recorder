import { sleep } from "./utilities.js";
import * as Errors from "./error.js";
import { loadOptions } from "./options.js";

export class Tab {
    constructor() {
        /** The associated chrome tab */
        this.chromeTab = null;

        /** The actual (or desired) height of the tab, may differ from the associated chromeTab property */
        this.height = 0;
        /** The actual (or desired) width of the tab, may differ from the associated chromeTab property */
        this.width = 0;

        /** The chrome tab url, or perhaps the original that redirected to the chrome tab url. */
        this.url = null;
    }

    /** 
     * Re-populates this instance from the chrome tab id.
     */
    async fromChromeTabId(id) {
        this.chromeTab = await chrome.tabs.get(id);
        this.height = this.chromeTab.height;
        this.width = this.chromeTab.width;
        this.url = this.chromeTab.url;
        return this;
    }

    /** The chrome tab id
     * @type {number}
     */
    get id() {
        return this.chromeTab.id;
    }

    /** The chrome tab window id
     * @type {number}
     */
    get windowId() {
        return this.chromeTab.windowId;
    }

    /** 
     * Resize the viewport of this tab to match its width and height properties.
     * */
    async resizeViewport() {
        let options = await loadOptions();
        // empirically, it needs to be visible to work
        await chrome.windows.update(this.windowId, { focused: true });

        console.debug(`resize viewport to ${this.width}x${this.height} requested`);

        let i = 0; let distance;
        let matched = 0;
        for (i = 0; i < 10; i++) {
            if (i) {
                await sleep(137); // we get once chance to be fast
            }

            await chrome.tabs.setZoom(this.id, 1); // reset the zoom to 1, in the tab we are recording. // FIXME: at somepoint in the future MAYBE I will support record and playback in a certain zoom, but right now it's a hassle because of windows display scaling.
            distance = await this.getViewport(); // get viewport data
            if(options.experimentalFeatures) {
                if(distance.devicePixelRatio !== 1) {
                    throw new Errors.PixelScalingError(); // this must be windows scaling, I cannot reset that.
                }
            }

            if (distance.innerHeight != this.height || distance.innerWidth != this.width) {
                // it's wrong
                await chrome.windows.update(this.windowId, {
                    width: distance.borderWidth + this.width,
                    height: distance.borderHeight + this.height
                });
                console.debug(`  resize viewport from ${distance.innerWidth}x${distance.innerHeight} to ${this.width}x${this.height} was required`);
            }
            else {
                // measure twice cut once? It seems that I may be getting a stale measurement the first time.
                if (++matched > 1) {
                    break;
                }
            }
        }

        console.debug(`  viewport now measured to be ${distance.innerWidth}x${distance.innerHeight} `);
        if (i == 10) {
            throw new Errors.ResizeViewportError();
        }
    }

    /** Inject a script into the current tab to measure the browser and viewport dimensions. */
    async getViewport() {
        function measureScript() {
            return {
                outerWidth: top.outerWidth,
                outerHeight: top.outerHeight,

                innerWidth: top.innerWidth,
                innerHeight: top.innerHeight,

                clientWidth: document.documentElement.clientWidth,
                clientHeight: document.documentElement.clientHeight,
                devicePixelRatio: window.devicePixelRatio
            };
        }

        let frames = await chrome.scripting.executeScript({
            target: { tabId: this.id },
            function: measureScript
        });

        let distance = frames[0].result;

        distance.borderWidth = distance.outerWidth - distance.innerWidth;
        distance.borderHeight = distance.outerHeight - distance.innerHeight;

        return distance;
    };

};


