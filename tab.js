import { sleep } from './utilities.js';
import * as Errors from './error.js';
import { loadOptions } from './options.js';

/**
 * Resolves promise _chromeTabStatusResolved when the tab transitions to complete
 * @param {*} tabId
 * @param {*} changeInfo
 * @param {*} tab
 */
function tabsOnUpdatedHandler(tabId, changeInfo, tab) {
  console.debug(
    `tab ${this.id} tab update handler called: w/tab tabId:${tabId} winId:${tab.windowId} is updated.`,
    changeInfo
  );
  if (tabId === this.chromeTab.id && changeInfo.status === 'complete') {
    console.debug('resolved');
    this._chromeTabStatusResolved(changeInfo.status);
  }
}

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

    /**
     * external promise resolution
     */
    this._chromeTabStatusResolved = null;
    /**
     * external promise rejection
     */
    this._chromeTabStatusReject = null;

    /** bound to this instance */
    this.tabsOnUpdatedHandler = tabsOnUpdatedHandler.bind(this);
  }

  toJSON() {
    return {
      height: this.height,
      width: this.width,
      url: this.url,
      virtualId: this.virtualId,
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
   * Will attempt to get the distance structure from the active tab.
   * Checks for pixel scaling and zoom issues, corrects what it can.
   * @returns the distance structure
   * @throws ZoomError or PixleScalingError
   */
  async measureViewport() {
    // empirically, it needs to be visible/focused to work
    await chrome.windows.update(this.chromeTab.windowId, { focused: true });

    let viewPort;
    if (options.autoZoomTo100) {
      console.debug(`tab:${this.id} set zoom to 1`);
      // set the _chrome_ tab zoom to 1
      await chrome.tabs.setZoom(this.chromeTab.id, 1); // reset the zoom to 1, in the tab we are recording. // FIXME: at somepoint in the future MAYBE I will support record and playback in a certain zoom, but right now it's a hassle because of windows display scaling.
    }
    if (1 != (await chrome.tabs.getZoom(this.chromeTab.id))) {
      // option was off and chrome zoom is in effect, or the option was on an reset chrome zoom failed. Either way we quit.
      throw new Errors.ZoomError();
    }

    viewPort = await this.getViewport(); // get viewport data
    if (viewPort.devicePixelRatio !== 1) {
      // this must be window manager device/monitor scaling, I cannot reset that from javascript.
      throw new Errors.PixelScalingError();
    }
    return viewPort;
  }

  /**
   * Resize the viewport of this tab to match its width and height properties.
   * Will throw ResizeViewportError, ZoomError or PixleScaling Error
   * */
  async resizeViewport() {
    let distance = await this.measureViewport();
    if (!this.height || !this.width) {
      return;
    }

    let options = await loadOptions();

    console.debug(
      `tab:${this.id} resize viewport to ${this.width}x${this.height} requested`
    );
    let lastError = new Errors.ResizeViewportError();

    let i = 0;
    let matched = 0;
    for (i = 0; i < 10; i++) {
      try {
        if (
          distance.innerHeight != this.height ||
          distance.innerWidth != this.width
        ) {
          // it's wrong
          await chrome.windows.update(this.chromeTab.windowId, {
            width: distance.borderWidth + this.width,
            height: distance.borderHeight + this.height,
          });
          console.debug(
            `resize viewport from ${distance.innerWidth}x${distance.innerHeight} to ${this.width}x${this.height} was required`
          );
        } else {
          // measure twice cut once? It seems that I may be getting a stale measurement the first time.
          if (++matched > 1) {
            break;
          }
        }
        if (i) {
          await sleep(options.resizeViewportRetryTimeout); // we get once chance to be fast
        }
        distance = await this.getViewport();
      } catch (e) {
        lastError = e;
        console.warn(e);
        continue;
      }
    }

    if (i == 10) {
      throw lastError;
    }

    console.debug(
      `viewport now measured to be ${distance.innerWidth}x${distance.innerHeight} `
    );
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
        devicePixelRatio: window.devicePixelRatio,
      };
    }

    let frames = await chrome.scripting.executeScript({
      target: { tabId: this.chromeTab.id },
      function: measureScript,
    });

    let distance = frames[0].result;
    distance.borderWidth = distance.outerWidth - distance.innerWidth;
    distance.borderHeight = distance.outerHeight - distance.innerHeight;
    return distance;
  }

  /**
   * Wait until
   */
  chromeTabStatusIsCompleted() {
    return new Promise((resolve, reject) => {
      this._chromeTabStatusResolved = resolve;
      this._chromeTabStatusReject = reject;
    });
  }

  /**
   * remove the window if it exists and (re)create it
   */
  async create({ url, incognito }) {
    console.debug(`creating ${incognito ? 'incognito' : 'normal'} window`);
    let options = await loadOptions();
    // I will always try to reuse before create.
    // So the only time I can be leaving windows around
    // is if we go from non-inconito to incognito or vice versa.
    let removedWindow;
    if (options.closeOldTestWindowOnCreate) {
      removedWindow = await this.remove();
    }

    let createParms = {
      type: 'normal',
      focused: false, // keep focus off omni bar when we open a new incognito window
      incognito: incognito, // if true this will create the window "You've gone Incognito"
      url: url, // this better be an URL I can attach a debugger to!
      height: this.height,
      width: this.width,
    };

    if (removedWindow) {
      createParms.top = removedWindow.top;
      createParms.left = removedWindow.left;
      // console.log(
      //   `create window postion:(${window.top},${window.left} size:${window.width}x${window.height})`
      // );
    }

    let chromeWindow = await chrome.windows.create(createParms);
    [this.chromeTab] = await chrome.tabs.query({
      active: true,
      windowId: chromeWindow.id,
    });

    if (this.chromeTab.status === 'loading') {
      // we need to wait for it
      /*  
         creating the chrome window only starts the tab navigation
         to the url. I can't leave here until that navigation completes.                
         set up some handlers and promise scaffolding to detect when that happens
        */
      chrome.tabs.onUpdated.removeListener(this.tabsOnUpdatedHandler);
      chrome.tabs.onUpdated.addListener(this.tabsOnUpdatedHandler);
      await this.chromeTabStatusIsCompleted();
    }

    this.url = url;
  }

  async fromTabId(id) {
    try {
      this.chromeTab = await chrome.tabs.get(id);
      return await this.reuse({
        incognito: this.chromeTab.incognito,
        focused: false,
      });
    } catch (e) {
      return false;
    }
  }

  /** configure this from a windowId. returns true on success false on failure. */
  async fromWindowId(id) {
    try {
      let chromeWindow = await chrome.windows.get(id); // if it fails we can't connect - ok.
      return await this.reuse({
        incognito: chromeWindow.incognito,
        focused: false,
      });
    } catch (e) {
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
      let chromeWindow = await chrome.windows.get(this.chromeTab.windowId); // if it fails we can't connect - ok.

      if (incognito !== chromeWindow.incognito) {
        throw new Error('wrong mode'); // and create one
      }

      // i guess they could have maximized it on their own
      if (chromeWindow.state !== 'normal') {
        window.alert(
          `The window state of the tab you want to record or playback is '${chromeWindow.state}'. It will be set to 'normal' to continue.`
        );
        await chrome.windows.update(chromeWindow.id, { state: 'normal' });
      }
      if (focused) {
        await chrome.windows.update(chromeWindow.id, { focused: true });
      }
      [this.chromeTab] = await chrome.tabs.query({
        active: true,
        windowId: chromeWindow.id,
      });

      if (url) {
        this.url = url;
        // this better be a URL that I can attach a debugger to !
        var resolveNavigationPromise;
        let navPromise = new Promise((resolve) => {
          resolveNavigationPromise = resolve;
        });
        chrome.webNavigation.onCompleted.addListener(function navCommit(
          details
        ) {
          chrome.webNavigation.onCompleted.removeListener(navCommit);
          resolveNavigationPromise(details);
        });
        await chrome.tabs.update(this.chromeTab.id, {
          url: url,
          height: this.height,
          width: this.width,
        });
        await navPromise; // the above nav is really done.
      } else if (this.chromeTab.url.startsWith('chrome://')) {
        // e.g. chrome://newtab
        return null; // force a create
      }

      // give these sane defaults.
      this.height = this.chromeTab.height;
      this.width = this.chromeTab.width;

      return this;
    } catch (e) {
      return null;
    }
  }

  /** Remove the currently configured window (if it exists) */
  async remove() {
    try {
      let w = await chrome.windows.get(this.chromeTab.windowId);
      await chrome.windows.remove(this.chromeTab.windowId);
      return w;
    } catch (e) {}
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
    Tab._open = Tab._open.filter((tab) => tab.virtualId !== this.virtualId);
  }
}

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
  return Tab._open.find((tab) => tab.virtualId === vid);
};

/**
 * Get the still open Tab with the given real ID
 * @param {number} rid
 */
Tab.getByRealId = function (rid) {
  return Tab._open.find((tab) => tab.chromeTab.id === rid);
};

Tab.reset = function () {
  Tab._open = [];
  Tab._tabsCreated = 0;
};

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
    throw new Error('The currently active tab is not tracked!');
  }
  console.log(`switched active tab to ${Tab.active.id}`);
};
