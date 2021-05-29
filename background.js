// a content script that runs in the context of the application webpage we want to record
chrome.runtime.onInstalled.addListener(() => {
});

chrome.action.onClicked.addListener(async function(tab) {
  try {
    // open or give focus to the window if it already is open
    // I want it to have access to this tab id.
    let currentWindow = await chrome.windows.getCurrent();
    let childWindow = await chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?parent=${currentWindow.id}&tab=${tab.id}`),
      type: "popup",
      focused: true,
      width: Math.floor(currentWindow.width*.75),
      height: Math.floor(currentWindow.height*.75) + 30, // leave a little more space for the horizontal scrollbar
    });
  }
  catch(e) {
    console.error('ugh');
    console.error(e);
  }
});

