import { Options, loadOptions, saveOptions } from './options.js';

/**
 * Get the Brimstone workspace windowId and tabId, if it is open.
 * @returns {Promise<{windowId:number, tabId:number}>}
 */
async function getWorkspaceInfo() {
  let result = await new Promise((resolve) =>
    chrome.storage.local.get('workspace', resolve)
  );
  let workspace = result?.workspace || {};
  return workspace;
}

/**
 * Pay attention to when the active tab changes.
 * https://developer.chrome.com/docs/extensions/reference/tabs/#event-onActivated
 */
async function tabsOnActivatedHandler(activeInfo) {
  //let tab = await chrome.tabs.get(activeInfo.tabId); NO NO NO cN'T GET IT IF IT IS BEING CREATED
  // tab.pendingUrl would be the identifier we will use eventually
  //console.debug('active tab changed', activeInfo, tab);
}

/**
 * Pay attention to tabs being removed.
 * */
async function tabsOnRemovedHandler(tabId, removeInfo) {
  // If it was the brimstone workspace that the user closed we should clean up.
  // 1) If we are playing we should close the app window too.
  // 2) If we are recording we should close the app window too.
  // 3) else we should reset the extension icon to the inactive state
  //console.debug('tab removed ', tabId, removeInfo);

  if (removeInfo.isWindowClosing) {
    let workspace = await getWorkspaceInfo();
    if (tabId === workspace?.tabId) {
      await Promise.all([
        chrome.action.setIcon({ path: 'images/grey_b_32.png' }),
        chrome.action.setTitle({ title: 'Brimstone is not active.' }),
      ]);

      // disconnect the handlers
      chrome.windows.onRemoved.removeListener(windowsOnRemovedHandler);
      chrome.windows.onBoundsChanged.removeListener(
        windowsOnBoundsChangedHandler
      );
      chrome.windows.onCreated.removeListener(windowsOnCreatedHandler);
      chrome.tabs.onCreated.removeListener(tabsOnCreatedHandler);
      chrome.tabs.onRemoved.removeListener(tabsOnRemovedHandler);
      chrome.tabs.onActivated.removeListener(tabsOnActivatedHandler);
    }
  }
}

/**
 * Pay attention to windows being removed.
 * */
async function windowsOnRemovedHandler(windowId) {
  //console.log(`window ${windowId} closed`);
}

/**
 * Pay attention to tabs being created
 * */
function tabsOnCreatedHandler(tab) {
  //console.debug('a tab was created', tab);
}

/**
 * Pay attention to windows being created.
 * */
function windowsOnCreatedHandler(window) {
  //console.debug('window was created', window);
}

/**
 * Pay attention to window move/resize events, so we can preserve
 * the bounds of the workspace window.
 * */
async function windowsOnBoundsChangedHandler(window) {
  let workspace = await getWorkspaceInfo();
  if (window.id === workspace.windowId) {
    // If I resize it remember where it is/was/will be next time
    await chrome.storage.local.set({
      window: {
        top: window.top,
        left: window.left,
        width: window.width,
        height: window.height,
      },
    });
    // console.log(
    //   `saved window postion:(${window.top},${window.left} size:${window.width}x${window.height}`
    // );
  }
}

/**
 * Pay attention to when the extension icon is clicked in a tab.
 */
async function actionOnClickedHandler(tab) {
  let workspace = await getWorkspaceInfo();
  if (workspace?.windowId) {
    // focus an existing brimstone window, and return
    try {
      let window = await chrome.windows.get(workspace.windowId);
      if (window) {
        await chrome.windows.update(workspace.windowId, { focused: true });
        // also switch back to the original tab in case we are off it
        await chrome.tabs.update(workspace.tabId, { active: true });
        return;
      }
    } catch (e) {
      console.debug('cannot find an open brimstone workspace window');
    }
  }

  // else, create the brimstone workspace window, with remembered size/position data, or defaults
  let currentWindow = await chrome.windows.getCurrent();
  let result = await new Promise((resolve) =>
    chrome.storage.local.get('window', resolve)
  );
  let height = result?.window?.height ?? 480;
  let width = result?.window?.width ?? 640;
  let left = result?.window?.left;
  let top = result?.window?.top;
  let window;
  try {
    window = await chrome.windows.create({
      url: chrome.runtime.getURL(
        `ui/workspace.html?parent=${currentWindow.id}&tab=${tab.id}`
      ),
      type: 'popup',
      focused: true,
      width,
      height,
      top,
      left,
    });
  } catch (e) {
    // if the last location was on some other monitor you docked with then undocked you might not be able to position it there.
    window = await chrome.windows.create({
      url: chrome.runtime.getURL(
        `ui/workspace.html?parent=${currentWindow.id}&tab=${tab.id}`
      ),
      type: 'popup',
      focused: true,
    });
    await windowsOnBoundsChangedHandler(window);
  }
  // keep track of the brimstone window id, and the tab in it between invocations of this worker (i.e. multiple clicks of icon)
  await chrome.storage.local.set({
    workspace: { windowId: window.id, tabId: window.tabs[0].id },
  });

  /* register handlers */
  chrome.windows.onBoundsChanged.addListener(windowsOnBoundsChangedHandler);
  chrome.windows.onCreated.addListener(windowsOnCreatedHandler);
  chrome.tabs.onCreated.addListener(tabsOnCreatedHandler);
  chrome.windows.onRemoved.addListener(windowsOnRemovedHandler);
  chrome.tabs.onRemoved.addListener(tabsOnRemovedHandler);
  chrome.tabs.onActivated.addListener(tabsOnActivatedHandler);
}

// /* It all starts with the click of the extension icon. */
chrome.action.onClicked.addListener(actionOnClickedHandler);

// https://developer.chrome.com/docs/extensions/reference/runtime/#event-onInstalled
chrome.runtime.onInstalled.addListener(async function (details) {
  let version;
  switch (details.reason) {
    case 'install':
    case 'update':
      version = chrome.runtime.getManifest().version;
      await Promise.all([
        chrome.action.setIcon({ path: 'images/grey_b_32.png' }),
        chrome.action.setTitle({
          title: `Brimstone updated to ${version}.`,
        }),
        chrome.action.setBadgeText({ text: '✓' }),
        chrome.action.setBadgeBackgroundColor({ color: 'green' }),
      ]);

      // on some rare updates we change the default for an option and push it into the users options.
      // users are lazy and may miss changes that improve their use experience.
      if (version === '1.23.2') {
        let def = new Options();
        let options = await loadOptions(); // users options
        options.mouseWheelTimeout = def.mouseWheelTimeout;
        options.autoPlay = def.autoPlay;
        await saveOptions(options, false);
      }

      break;
    case 'chrome_update':
    case 'shared_module_update':
    default:
      break;
  }
});
