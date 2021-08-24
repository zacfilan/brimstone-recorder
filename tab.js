import {sleep} from "./utilities.js";

export class Tab {
    constructor() {
        /** The associated chrome tab */
        this.chromeTab = null;

        /** The actual (or desired) height of the tab, may differ from the associated chromeTab property */
        this.height = 0;
        /** The actual (or desired) width of the tab, may differ from the associated chromeTab property */
        this.width = 0;
        /** The actual (or desired) zoomFactor of the tab, may differ from the associated chromeTab property */
        this.zoomFactor = 1;

        /** The chrome tab url, or perhaps the original that redirected to the chrome tab url. */
        this.url = null;
    }

    /** The number of pixels in the width when a zoomFactor is applied. */
    get zoomWidth() {
        return Math.round(this.width * this.zoomFactor);
    }

    /** The number of pixels in the height when zoomFactor is applied. */
    get zoomHeight() {
        return Math.round(this.height * this.zoomFactor);
    }

    async fromChromeTabId(id) {
        this.chromeTab = await chrome.tabs.get(id);
        this.zoomFactor = await chrome.tabs.getZoom(id);
        if (this.zoomFactor !== 1) {
            throw "BOOM!";
        }
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

    /** Resize the viewport of this tab to match its width, height and zoom properties.
     * */
    async resizeViewport() {
        // empirically, it needs to be visible to work
        await chrome.windows.update(this.windowId, { focused: true });

        //console.debug(`resize viewport to ${this.width}x${this.height} requested`);
 
        let i = 0; let distance;
        let matched = 0;
        for (i = 0; i < 10; i++) {
            distance = await this.getViewport();
            if(distance.innerHeight != this.zoomHeight || distance.innerWidth != this.zoomWidth) {
                // it's wrong
                await chrome.windows.update(this.windowId, {
                    width: distance.borderWidth + this.zoomWidth,
                    height: distance.borderHeight + this.zoomHeight
                });
                //console.debug(`  resize viewport from ${distance.innerWidth}x${distance.innerHeight} to ${this.width}x${this.height} was required`);
            }
            else {
                // measure twice cut once? It seems that I may be getting a stale measurement the first time.
                if(++matched>1) {
                    break;
                }
                await sleep(137); // snooze ad do it again for good measure
            }
        }

        //console.debug(`  viewport now measured to be ${distance.innerWidth}x${distance.innerHeight}`);
        if (i == 10) {
            throw "cannot_set_desired_viewport";
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
                clientHeight: document.documentElement.clientHeight
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


