import { sleep } from "./utilities.js";
import * as Errors from "./error.js";
import { loadOptions } from "./options.js";

/**
 * Wrapper for chromeTab.
 * 
 * Facilitates resizing a tab to the desired size.
 * 
 * Also provides methods for *creating* a chromeWindow
 * and chromeTab for required incognito'ness.
 * 
 * The native height, and width
 * properties are the *desired* height and width which 
 * can differ from the associated chromeTab properties. 
 */
export class Tab {
    /**
     * 
     * @param {Tab} otherTab 
     */
    constructor(otherTab) {
        /** The associated chrome tab 
         * @type {chrome.tabs.Tab}
        */
        this.chromeTab = otherTab?.chromeTab;

        /** The desired height of the tab. May differ from the associated chromeTab property. */
        this.height = otherTab?.height || 0;
        /** The desired width of the tab. May differ from the associated chromeTab property. */
        this.width = otherTab?.width || 0;
        /** @type {boolean} if the size has been blessed implicity by the user.
         * this happens when the user has seen the expected screenshot during
         * recording and done any subsequent action. This locks in the dimensions
         * of the screenshot as correct (blessed) by the user. 
         * 
         * When true, a screenshot grabbed on this tab with a different
         * size will throw an exception.
         */
        this.blessed = otherTab?.blessed;

        /** The chrome tab url, or perhaps the original that redirected to the chrome tab url. May differ from the associated chromeTab property */
        this.url = otherTab?.url;


        /**
         *  A unique id for this tab in this recording. The real ones are not persistant, so assign a "virtual" tab identifier 
        * (starting from 0) to each tab in the order they are created (during the recording or playback).
        */
        this.virtualId = otherTab?.virtualId;
    }

    toJSON() {
        return {
            height: this.height,
            width: this.width,
            url: this.url,
            virtualId: this.virtualId
        };
    }

    /** 
     * Re-populates this instance from the chrome tab id.
     * @param {chrome.tabs.Tab} chromeTab
     */
    fromChromeTab(chromeTab) {
        this.chromeTab = chromeTab;

        // give these defaults.
        this.height = this.chromeTab.height;
        this.width = this.chromeTab.width;
        this.url = this.chromeTab.url;

        return this;
    }

    /**
     * an identifier for debugging
     */
    get id() {
        return `${this.virtualId ?? '?'}:${this.chromeTab?.id ?? '???'}`;
    }

    /** 
     * Resize the viewport of this tab to match its width and height properties.
     * */
    async resizeViewport() {
        if (!this.height || !this.width) {
            return;
        }

        let options = await loadOptions();
        // empirically, it needs to be visible to work
        await chrome.windows.update(this.chromeTab.windowId, { focused: true });

        console.debug(`tab:${this.id} resize viewport to ${this.width}x${this.height} requested`);
        let lastError = new Errors.ResizeViewportError();

        let i = 0; let distance;
        let matched = 0;
        for (i = 0; i < 10; i++) {
            if (i) {
                await sleep(137); // we get once chance to be fast
            }

            try {
                if (options.autoZoomTo100) {
                    console.debug(`tab:${this.id} set zoom to 1`);
                    await chrome.tabs.setZoom(this.chromeTab.id, 1); // reset the zoom to 1, in the tab we are recording. // FIXME: at somepoint in the future MAYBE I will support record and playback in a certain zoom, but right now it's a hassle because of windows display scaling.
                }
                distance = await this.getViewport(); // get viewport data

                if (1 != await chrome.tabs.getZoom(this.chromeTab.id)) {
                    throw lastError = new Errors.ZoomError(); // this must be windows scaling, I cannot reset that.
                }

                if (distance.devicePixelRatio !== 1) {
                    throw lastError = new Errors.PixelScalingError();
                }

                if (distance.innerHeight != this.height || distance.innerWidth != this.width) {
                    // it's wrong
                    await chrome.windows.update(this.chromeTab.windowId, {
                        width: distance.borderWidth + this.width,
                        height: distance.borderHeight + this.height
                    });
                    console.debug(`resize viewport from ${distance.innerWidth}x${distance.innerHeight} to ${this.width}x${this.height} was required`);
                }
                else {
                    // measure twice cut once? It seems that I may be getting a stale measurement the first time.
                    if (++matched > 1) {
                        break;
                    }
                }
            }
            catch (e) {
                console.warn(e);
                continue;
            }
        }

        if (i == 10) {
            throw lastError;
        }

        console.debug(`viewport now measured to be ${distance.innerWidth}x${distance.innerHeight} `);
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
            await this.remove();
        }

        let chromeWindow = await chrome.windows.create({
            type: "normal",
            focused: false, // keep focus off omni bar when we open a new incognito window
            incognito: incognito // if true this will create the window "You've gone Incognito" 
        });

        [this.chromeTab] = await chrome.tabs.query({ active: true, windowId: chromeWindow.id });

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
        // I don't want to do this when recording from non-incognito to incognito. I want to preserve the original non-incognito size that I removed.
        //this.height = this.chromeTab.height;
        //this.width = this.chromeTab.width;
    }

    async fromTabId(id) {
        try {
            this.chromeTab = await chrome.tabs.get(id);
            return await this.reuse({ incognito: this.chromeTab.incognito, focused: false });
        }
        catch (e) {
            return false;
        }
    }

    /** configure this from a windowId. returns true on success false on failure. */
    async fromWindowId(id) {
        try {
            let chromeWindow = await chrome.windows.get(id);  // if it fails we can't connect - ok.
            return await this.reuse({ incognito: chromeWindow.incognito, focused: false });
        }
        catch (e) {
            return false;
        }
    }

    /** 
     * In order to play or record I need a tab with the correct incongito'ness'.
     * 
     * This will attempt to re-use a pre-existing Tab to see if it is sufficient.  
     * */
    async reuse({ url = null, incognito, focused = true }) {
        try {
            // make sure it is still there.
            let chromeWindow = await chrome.windows.get(this.chromeTab.windowId);  // if it fails we can't connect - ok.

            if (incognito !== chromeWindow.incognito) {
                throw new Error('wrong mode'); // and create one
            }

            // i guess they could have maximized it on their own
            if (chromeWindow.state !== 'normal') {
                window.alert(`The window state of the tab you want to record or playback is '${chromeWindow.state}'. It will be set to 'normal' to continue.`);
                await chrome.windows.update(chromeWindow.id, { state: 'normal' });
            }
            if (focused) {
                await chrome.windows.update(chromeWindow.id, { focused: true });
            }
            [this.chromeTab] = await chrome.tabs.query({ active: true, windowId: chromeWindow.id });
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

            return this;

        }
        catch (e) {
            return null;
        }
    }

    /** Remove the currently configured window (if it exists) */
    async remove() {
        try {
            await chrome.windows.remove(this.chromeTab.windowId);
        }
        catch (e) { }
    }

    /**
     * Add a virtualId for this Tab. A virtual id is assigned
     * in the order the tab was created during a recording (or
     * during playback).
     */
    trackCreated() {
        if (!Tab.getByVirtualId(this.virtualId)) {
            this.virtualId = Tab._tabsCreated++;
            Tab._open.push(this);
            console.debug(`tracking tab:${this.id}`, this);
        }
    }

    /**
     * Remove this Tab (by virtualId) from those being tracked.
     */
    trackRemoved() {
        Tab._open = Tab._open.filter(tab => tab.virtualId !== this.virtualId);
    }
};

/** 
 * Dring playback or recording as tabs are created
 * they are assigned a sequntial virtual id.
* @type {Tab[]}
*/
Tab._tabsCreated = 0;

/**
 * @type {Tab[]} the tabs that tracked as currently open.
 */
Tab._open = [];

/** The tab we believe is active. 
 * @type {Tab} the tab we believe is active tab.
*/
Tab.active = null;

/**
 * Get the still open Tab with the given virtual ID
 * @param {number} vid 
 */
Tab.getByVirtualId = function (vid) {
    return Tab._open.find(tab => tab.virtualId === vid);
}

/**
 * Get the still open Tab with the given real ID
 * @param {number} rid 
 */
Tab.getByRealId = function (rid) {
    return Tab._open.find(tab => tab.chromeTab.id === rid);
}

Tab.reset = function () {
    Tab._open = [];
    Tab._tabsCreated = 0;
}

/** 
 * figure out the active tab again
 */
Tab.reaquireActiveTab = async function () {
    Tab.active = undefined;
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: false }); // the current window is the brimstone workspace
    if (!tab) {
        throw new Error('cannot determine active application tab!');
    }
    Tab.active = Tab.getByRealId(tab.id);
    if (!Tab.active) {
        throw new Error("The currently active tab is not tracked!");
    }
    console.log(`switched active tab to ${Tab.active.id}`);
}

