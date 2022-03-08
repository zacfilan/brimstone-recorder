'use strict';

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

/**
 * Process a list asynchronously and get a callback 
 * every second with a percent done.
 * @param {object} args destructured arguments
 * @param {function} args.progressCallback 
 * @param {[]} args.items 
 * @param {function} args.itemProcessor 
 * @param {number?} startIndex start index defaults to 0
 * @param {number?} endIndex (not included. defaults to items.length)
 * @returns 
 */
export function progressIndicator({
    progressCallback, 
    items, 
    startIndex = undefined,
    endIndex = undefined,
    itemProcessor
    }) {
    if(startIndex === undefined) {
        startIndex = 0;
    }
    if(startIndex < 0) {
        startIndex = 0;
    }
    if(endIndex === undefined) {
        endIndex = items.length;
    }
    if(endIndex > items.length) {
        endIndex = items.length;
    }
    return new Promise(async (resolve) => {
        let i = startIndex;
        let id;
        if (progressCallback) {
            id = setInterval(
                () => {
                    progressCallback(i + 1, endIndex);
                },
                1000);
        }
        for (i = startIndex; i < endIndex; ++i) {
            let item = items[i];
            await itemProcessor.call(item, item);
        }
        if (progressCallback) {
            clearInterval(id);
            progressCallback(endIndex, endIndex);
        }
        resolve(true);
    });  
}