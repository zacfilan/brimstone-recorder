
chrome.action.onClicked.addListener(async function (tab) {
  try {
    // create the Recording Window
    let currentWindow = await chrome.windows.getCurrent();
    let result = await (new Promise(resolve => chrome.storage.sync.get("window", resolve)));
    
    let height = result?.window?.height ?? Math.floor(currentWindow.height * .75);
    let width = result?.window?.width ?? Math.floor(currentWindow.width * .75);
    let left = result?.window?.left ?? currentWindow.left + 100;
    let top = result?.window?.top ?? currentWindow.top + 100;

    let childWindow = await chrome.windows.create({
      url: chrome.runtime.getURL(`ui.html?parent=${currentWindow.id}&tab=${tab.id}`),
      type: "popup",
      focused: false,
      width,
      height, 
      top,
      left
    });

    chrome.windows.onBoundsChanged.addListener(window => {
      if(window.id === childWindow.id) { // FIXME: should I use sessionId?
        // If I resize it remember where it is
        chrome.storage.sync.set({'window' : {
          top: window.top,
          left: window.left,
          width: window.width,
          height: window.height
        }});
      }
    });

  }
  catch (e) {
    console.error(e);
  }
});




