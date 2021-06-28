chrome.action.onClicked.addListener(async function (tab) {
  try {

    // focus an existing brimstone window, and return
    let result = await (new Promise(resolve => chrome.storage.local.get("session", resolve)));
    let session = result?.session;
    if (session) {
      try {
        let brimstoneWindow = await chrome.windows.get(session.brimstoneWindowId);
        if (brimstoneWindow) {
          await chrome.windows.update(session.brimstoneWindowId, { focused: true });
          // also switch back to the original tab in case we are off it
          await chrome.tabs.update(session.tabId, { active: true });
          return;
        }
      }
      catch(e) {
        console.error(e); // at least report it in the extension details area
      }
    }

    // else, create the brimstone window, with any remembered size/position data, or defaults
    let currentWindow = await chrome.windows.getCurrent();
    result = await (new Promise(resolve => chrome.storage.local.get("window", resolve)));
    let height = result?.window?.height ?? Math.floor(currentWindow.height * .75);
    let width = result?.window?.width ?? Math.floor(currentWindow.width * .75);
    let left = result?.window?.left ?? currentWindow.left + 100;
    let top = result?.window?.top ?? currentWindow.top + 100;
    let brimstoneWindow = await chrome.windows.create({
      url: chrome.runtime.getURL(`ui/workspace.html?parent=${currentWindow.id}&tab=${tab.id}`),
      type: "popup",
      focused: false,
      width,
      height,
      top,
      left
    });

    // keep track of the brimstone window id between invocations of this worker (multiple clicks of icon)
    chrome.storage.local.set({ session: { brimstoneWindowId: brimstoneWindow.id, tabId: tab.id }});

    // clean up when the brimstone window is closed
    chrome.windows.onRemoved.addListener(async (windowId) => {
      if (windowId === brimstoneWindow.id) {
        chrome.storage.local.remove('session');
        // FIXME: not sure how to import iconState module into here so...
        await chrome.action.setTitle({title: 'Brimstone is not active.'});
        await chrome.action.setIcon({path: 'images/grey_b_32.png' });
      }
    });

    // when the brimstone window closes remember position and size for next time.
    chrome.windows.onBoundsChanged.addListener(window => {
      if (window.id === brimstoneWindow.id) { // FIXME: should I use sessionId?
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
    });

    // when the tab that the user launched the brimstone window from closes, close the brimstone window too
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      if (tabId === tab.id) {
        chrome.windows.remove(brimstoneWindow.id);
      }
    });

  }
  catch (e) {
    console.error(e);
  }
});




