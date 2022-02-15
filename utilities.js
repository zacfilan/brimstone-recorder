export async function sleep(ms) {
    console.debug(`sleeping for ${ms}ms`);
    return new Promise(resolve => setTimeout(resolve, ms));
};

export function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// we can reuse this
var _arrayBuffer = new ArrayBuffer(16); // 1 bytes for each char, need 3 words
var _dataView = new DataView(_arrayBuffer);

// credit where due https://stackoverflow.com/a/30800715
export function downloadObjectAsJson(exportObj, exportName){
    var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2)); // zac likes readable json
    var downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", exportName + ".json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  /**
   * Grab the size from the data url w/o a complete PNG conversion,
   * for speed.
   * 
   * PNG header: https://stackoverflow.com/a/16725066
   * PNG Specification: http://www.libpng.org/pub/png/spec/1.2/png-1.2.pdf
   * 
   * @param {string} base64 
   */
  export function extractPngSize(base64) {
    // 6 bytes of base64 encode 4 bytes of real data
    // so sequential 16 bytes of base64 encode sequential 12 bytes of real data

    // read out 24 real bytes that contain words [3], [4], [5] from the base64
    let binaryString = atob(base64.substring(16, 16+16));
    let dv = binaryStringToDataView(binaryString);

    // the width and height are in (bigendian) words [1] and [2] from the words pulled out
    return {
        width: dv.getInt32(4), // byte offset of word1
        height: dv.getInt32(8) // byte offest of word2
    };
  }

function binaryStringToDataView(str) {
    for (var i=0, strLen=str.length; i < strLen; i++) {
        _dataView.setUint8(i, str.charCodeAt(i));
    }
    return _dataView;
}

/**
 * Make a deep clone of any object, via JSON magic.
 * @param {any} obj 
 * @returns 
 */
export function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

export async function focusWorkspaceWindow() {
    /** @type {chrome.windows.Window} */
    let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
    await chrome.windows.update(w.id, { focused: true }); // you must be focused to see the alert
    return w;
}

export var brimstone = {
    window: {
        alert: async (...args) => {
            let ww = await focusWorkspaceWindow();
            window.alert('🙋❗ ' + args[0], ...args.slice(1));
            return ww;
        },
        confirm: async (...args) => {
            await focusWorkspaceWindow();
            return window.confirm('🙋❓ ' + args[0], ...args.slice(1));
        },
        prompt: async (...args) => {
            await focusWorkspaceWindow();
            return window.prompt('🙋 ' + args[0], ...args.slice(1));
        },
        error: async (e) => {
            await focusWorkspaceWindow();
            await navigator.clipboard.writeText(e.stack);
            return window.alert(`🐞 You found a bug, thanks! Details were copied into the copy-buffer. You can CTRL-V (paste) them when you report the error. Errors can be reported via menu "Help"➜"Search/Report Issues".\n\nYou may or may not be able to continue this session.\n\nDetails:\n${e.stack}`);
        }
    }
}