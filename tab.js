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

        /** The chrome tab url
     * @type {string}
     */
    get url() {
        return this.chromeTab.url;
    }

    /** Resize the viewport of this tab to match its width, height and zoom properties.
     * */
    async resizeViewport() {
        // empirically, it needs to be visible to work
        await chrome.windows.update(this.windowId, { focused: true });

        console.debug(`resize viewport to ${this.width}x${this.height} requested`);
 
        let i = 0; let distance;
        let matched = 0;
        for (i = 0; i < 10; i++) {
            await sleep(137); // stupid animation
            distance = await this.getViewport();
            if(distance.innerHeight != this.zoomHeight || distance.innerWidth != this.zoomWidth) {
                // it's wrong
                console.debug(`window resize was performed to contain desired viewport`);
                await chrome.windows.update(this.windowId, {
                    width: distance.borderWidth + this.zoomWidth,
                    height: distance.borderHeight + this.zoomHeight
                });
            }
            else {
                // measure twice cut once? It seems that I may be getting a stale measurement the first time.
                if(++matched>1) {
                    break;
                }
            }
        }

        console.debug(`viewport is measured to be ${distance.innerWidth}x${distance.innerHeight}`);
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


