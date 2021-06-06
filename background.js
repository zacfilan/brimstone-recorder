
chrome.action.onClicked.addListener(async function (tab) {
  try {
    // create the Recording Window
    let currentWindow = await chrome.windows.getCurrent();
    let childWindow = await chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?parent=${currentWindow.id}&tab=${tab.id}`),
      type: "popup",
      focused: false,
      width: Math.floor(currentWindow.width * .75),
      height: Math.floor(currentWindow.height * .75) + 30, // leave a little more space for the horizontal scrollbar
    });
  }
  catch (e) {
    console.error(e);
  }
});




