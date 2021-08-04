/**
 * Get the Brimstone workspace windowId and tabId, if it is open.
 * @returns {Promise<{windowId:number, tabId:number}>}
 */
 async function getWorkspaceInfo() {
  let result = await (new Promise(resolve => chrome.storage.local.get("workspace", resolve)));
  let workspace = result?.workspace;
  return workspace;
}

/** 
 * Pay attention to when the active tab changes.
 * https://developer.chrome.com/docs/extensions/reference/tabs/#event-onActivated
 */
async function tabsOnActivatedHandler(activeInfo) {
  let tab = await chrome.tabs.get(activeInfo.tabId);
  // tab.pendingUrl would be the identifier we will use eventually
  console.debug('active tab changed', activeInfo, tab);
}

/** 
 * Pay attention to tabs being removed.
 * */
async function tabsOnRemovedHandler(tabId, removeInfo) {
  // If it was the tab we used to open the workspace, then we need to close the workspace window.
  console.debug('tab removed ', tabId, removeInfo);
  let workspace = await getWorkspaceInfo();
  if (tabId === workspace?.tabId) {
    chrome.windows.remove(workspace.windowId);
  }
}

/** 
* Pay attention to windows being removed.
* */
async function windowsOnRemovedHandler(windowId) {
  // was it the workspace window that was removed?
  let workspace = await getWorkspaceInfo();
  if (windowId === workspace.windowId) {

    chrome.storage.local.remove('workspace');
    // update the extension icon
    // FIXME: not sure how to import iconState module into here so, also is this a race condition?
    await chrome.action.setTitle({ title: 'Brimstone is not active.' });
    await chrome.action.setIcon({ path: 'images/grey_b_32.png' });

    // disconnect the handlers
    chrome.windows.onBoundsChanged.removeListener(windowsOnBoundsChangedHandler);
    chrome.windows.onCreated.removeListener(windowsOnCreatedHandler);
    chrome.tabs.onCreated.removeListener(tabsOnCreatedHandler);
    chrome.windows.onRemoved.removeListener(windowsOnRemovedHandler);
    chrome.tabs.onRemoved.removeListener(tabsOnRemovedHandler);
    chrome.tabs.onActivated.removeListener(tabsOnActivatedHandler);
  }

}

/** 
* Pay attention to tabs being created 
* */
function tabsOnCreatedHandler(tab) {
  console.debug('a tab was created', tab);
}

/** 
* Pay attention to windows being created.
* */
function windowsOnCreatedHandler(window) {
  console.debug('window was created', window);
}

/** 
* Pay attention to window move/resize events, so we can preserve
* the bounds of the workspace window.
* */
async function windowsOnBoundsChangedHandler(window) {
  let workspace = await getWorkspaceInfo();
  if (window.id === workspace.windowId) {
    // If I resize it remember where it is/was/will be next time
    chrome.storage.local.set({
      'window': {
        top: window.top,
        left: window.left,
        width: window.width,
        height: window.height
      }
    });
  }
}

/**
 * Pay attention to when the extension icon is clicked in a tab.
 */
async function actionOnClickedHandler(tab) {
  let workspace = await getWorkspaceInfo();
  if (workspace) {
    // focus an existing brimstone window, and return
    try {
      let window = await chrome.windows.get(workspace.windowId);
      if (window) {
        await chrome.windows.update(workspace.windowId, { focused: true });
        // also switch back to the original tab in case we are off it
        await chrome.tabs.update(workspace.tabId, { active: true });
        return;
      }
    }
    catch (e) {
      console.error(e); // at least report it in the extension details area
    }
  }

  // else, create the brimstone workspace window, with remembered size/position data, or defaults
  let currentWindow = await chrome.windows.getCurrent();
  let result = await (new Promise(resolve => chrome.storage.local.get("window", resolve)));
  let height = result?.window?.height ?? Math.floor(currentWindow.height * .75);
  let width = result?.window?.width ?? Math.floor(currentWindow.width * .75);
  let left = result?.window?.left ?? currentWindow.left + 100;
  let top = result?.window?.top ?? currentWindow.top + 100;
  let window = await chrome.windows.create({
    url: chrome.runtime.getURL(`ui/workspace.html?parent=${currentWindow.id}&tab=${tab.id}`),
    type: "popup",
    focused: false,
    width,
    height,
    top,
    left
  });

  // keep track of the brimstone window id between invocations of this worker (i.e. multiple clicks of icon)
  chrome.storage.local.set({ workspace: { windowId: window.id, tabId: tab.id } });

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
