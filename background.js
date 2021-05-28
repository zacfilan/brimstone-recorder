//let color = '#3aa757';

chrome.runtime.onInstalled.addListener(() => {
  //chrome.storage.sync.set({ color });
  //console.log('Default background color set to %cgreen', `color: ${color}`);
});

chrome.action.onClicked.addListener(async function(tab) {
  // open or give focus to the window if it already is open
  // I want it to have access to this tab id.
  let currentWindow = await chrome.windows.getCurrent();
  console.log(`The parent window id is: ${currentWindow.id}`);
  let childWindow = await chrome.windows.create({
     url: chrome.runtime.getURL(`popup.html?parent=${currentWindow.id}`),
     type: "popup",
     focused: true,
     width: Math.floor(currentWindow.width*.75),
     height: Math.floor(currentWindow.height*.75) + 30, // leave a little more space for the horizontal scrollbar

   });
   console.log(`The child window id is: ${childWindow.id}`);
});
