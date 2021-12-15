import { sleep } from "./utilities.js";
import * as Errors from "./error.js";
import { loadOptions } from "./options.js";

export class Tab {
    constructor() {
        /** The associated chrome tab 
         * @type {chrome.tabs.Tab}
        */
        this.chromeTab = null;

        /** The chrome window this tab is in.
         * @type {chrome.windows.Window}
         */
        this.chromeWindow = null;

        /** The desired height of the tab. May differ from the associated chromeTab property. */
        this.height = 0;

        /** The desired width of the tab. May differ from the associated chromeTab property. */
        this.width = 0;

        /** The chrome tab url, or perhaps the original that redirected to the chrome tab url. May differ from the associated chromeTab property */
        this.url = null;
    }

    /** 
     * Re-populates this instance from the chrome tab id.
     * @param {chrome.tabs.Tab} tab
     */
    async fromChromeTab(tab) {
        this.chromeTab = tab;
        this.chromeWindow = await chrome.windows.get(tab.windowId);

        // give these sane defaults.
        this.height = this.chromeTab.height;
        this.width = this.chromeTab.width;
        this.url = this.chromeTab.url;

        return this;
    }

    /** 
     * Resize the viewport of this tab to match its width and height properties.
     * */
    async resizeViewport() {
        let options = await loadOptions();
        // empirically, it needs to be visible to work
        await chrome.windows.update(this.chromeWindow.id, { focused: true });

        console.debug(`resize viewport to ${this.width}x${this.height} requested`);

        let i = 0; let distance;
        let matched = 0;
        for (i = 0; i < 10; i++) {
            if (i) {
                await sleep(137); // we get once chance to be fast
            }

            await chrome.tabs.setZoom(this.chromeTab.id, 1); // reset the zoom to 1, in the tab we are recording. // FIXME: at somepoint in the future MAYBE I will support record and playback in a certain zoom, but right now it's a hassle because of windows display scaling.
            distance = await this.getViewport(); // get viewport data
            if (distance.devicePixelRatio !== 1) {
                throw new Errors.PixelScalingError(); // this must be windows scaling, I cannot reset that.
            }

            if (distance.innerHeight != this.height || distance.innerWidth != this.width) {
                // it's wrong
                await chrome.windows.update(this.chromeWindow.id, {
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
            target: { tabId: this.chromeTab.id },
            function: measureScript
        });

        let distance = frames[0].result;

        distance.borderWidth = distance.outerWidth - distance.innerWidth;
        distance.borderHeight = distance.outerHeight - distance.innerHeight;

        return distance;
    };

    /**
     * remove the window if it exists and (re)create it 
     */
    async create({ url, incognito }) {
        let options = await loadOptions();
        // I will always try to reuse before create.
        // So the only time I can be leaving windows around
        // is if we go from non-inconito to incognito or vice versa.
        if (options.closeOldTestWindowOnCreate) {
            this.remove();
        }

        this.chromeWindow = await chrome.windows.create({
            type: "normal",
            focused: false, // keep focus off omni bar when we open a new incognito window
            incognito: incognito
        });

        [this.chromeTab] = await chrome.tabs.query({ active: true, windowId: this.chromeWindow.id });

        this.url = url;
        // this better be a URL that I can attach a debugger to !
        var resolveNavigationPromise;
        let navPromise = new Promise(resolve => { resolveNavigationPromise = resolve; });
        chrome.webNavigation.onCommitted.addListener(function navCommit(details) {
            chrome.webNavigation.onCommitted.removeListener(navCommit);
            resolveNavigationPromise(details);
        });
        await chrome.tabs.update(this.chromeTab.id, { url: url });
        await navPromise; // the above nav is really done.

        // give these sane defaults.
        this.height = this.chromeTab.height;
        this.width = this.chromeTab.width;
    }

    /** configure this from a windowId. returns true on success false on failure. */
    async fromWindowId(id) {
        try {
            this.chromeWindow = await chrome.windows.get(id);  // if it fails we can't connect - ok.
            return await this.reuse({ incognito: this.chromeWindow.incognito, focused: false });
        }
        catch (e) {
            return false;
        }
    }

    /** resuse the currently configured window if you can */
    async reuse({ url = null, incognito, focused = true }) {
        try {
            // make sure it is still there.
            this.chromeWindow = await chrome.windows.get(this.chromeWindow?.id);  // if it fails we can't connect - ok.

            if (incognito !== this.chromeWindow.incognito) {
                throw new Error('wrong mode'); // and create one
            }

            // i guess they could have maximized it on their own
            if (this.chromeWindow.state !== 'normal') {
                window.alert(`The window state of the tab you want to record or playback is '${this.chromeWindow.state}'. It will be set to 'normal' to continue.`);
                await chrome.windows.update(this.chromeWindow.id, { state: 'normal' });
            }
            if (focused) {
                await chrome.windows.update(this.chromeWindow.id, { focused: true });
            }
            [this.chromeTab] = await chrome.tabs.query({ active: true, windowId: this.chromeWindow.id });
            if (url) {
                this.url = url;
                // this better be a URL that I can attach a debugger to !
                var resolveNavigationPromise;
                let navPromise = new Promise(resolve => { resolveNavigationPromise = resolve; });
                chrome.webNavigation.onCommitted.addListener(function navCommit(details) {
                    chrome.webNavigation.onCommitted.removeListener(navCommit);
                    resolveNavigationPromise(details);
                });
                await chrome.tabs.update(this.chromeTab.id, { url: url });
                await navPromise; // the above nav is really done.
            }

            // give these sane defaults.
            this.height = this.chromeTab.height;
            this.width = this.chromeTab.width;

            return true;

        }
        catch (e) {
            return false;
        }
    }

    /** Remove the currently configured window (if it exists) */
    async remove() {
        try {
            await chrome.windows.remove(this.chromeWindow.id);
        }
        catch (e) { }
    }

};


