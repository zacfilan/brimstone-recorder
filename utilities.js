'use strict';

export async function sleep(ms) {
  console.debug(`sleeping for ${ms}ms`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// credit where due https://stackoverflow.com/a/30800715
export function downloadObjectAsJson(exportObj, exportName) {
  var text = JSON.stringify(exportObj, null, 2); // zac likes readable json
  return saveTemplateAsFile(exportName + '.json', text, 'text/json');
}

export function downloadHtmlContent(text, filename) {
  return saveTemplateAsFile(filename + '.html', text, 'text/html');
}

export function saveTemplateAsFile(filename, text, type) {
  const blob = new Blob([text], { type: type });
  const link = document.createElement('a');

  link.download = filename;
  link.href = window.URL.createObjectURL(blob);
  link.dataset.downloadurl = [type, link.download, link.href].join(':');

  const evt = new MouseEvent('click', {
    view: window,
    bubbles: true,
    cancelable: true,
  });

  link.dispatchEvent(evt);
  link.remove();
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
  let w = await new Promise((resolve) =>
    chrome.windows.getCurrent(null, resolve)
  ); // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
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
      return window.alert(
        `🐞 You found a bug, thanks! Details were copied into the copy-buffer. You can CTRL-V (paste) them when you report the error. Errors can be reported via menu "Help"➜"Search/Report Issues".\n\nYou may or may not be able to continue this session.\n\nDetails:\n${e.stack}`
      );
    },
  },
};

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
  itemProcessor,
}) {
  if (startIndex === undefined) {
    startIndex = 0;
  }
  if (startIndex < 0) {
    startIndex = 0;
  }
  if (endIndex === undefined) {
    endIndex = items.length;
  }
  if (endIndex > items.length) {
    endIndex = items.length;
  }
  return new Promise(async (resolve, reject) => {
    let id;
    try {
      let i = startIndex;
      if (progressCallback) {
        id = setInterval(() => {
          progressCallback(i + 1, endIndex);
        }, 1000);
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
    } catch (e) {
      clearInterval(id);
      reject(e);
    }
  });
}

import { pixelmatch } from './dependencies/pixelmatch.js';
const PNG = png.PNG;
/**
 * Wrapper around my modified version of
 * pixelmatch.
 * @param {*} expectedPng
 * @param {*} actualPng
 * @param {*} maskPng
 * @param {*} pixelMatchThreshhold
 * @param {*} fastFail
 * @returns
 */
export function pngDiff(
  expectedPng,
  actualPng,
  maskPng,

  pixelMatchThreshhold,
  fastFail = false
) {
  const { width, height } = expectedPng;

  if (actualPng.width !== width || actualPng.height !== height) {
    actualPng = new PNG({ width, height });
  }

  const diffPng = new PNG({ width, height }); // new
  var { numDiffPixels, numMaskedPixels, numUnusedMaskedPixels } = pixelmatch(
    expectedPng.data,
    actualPng.data,
    diffPng.data,
    width,
    height,
    {
      threshold: pixelMatchThreshhold,
      ignoreMask: maskPng?.data,
      fastFail: fastFail,
    }
  );

  return {
    numUnusedMaskedPixels,
    numDiffPixels,
    numMaskedPixels,
    diffPng,
  };
  ra;
}

/**
 * Return the x.yy.z part after something like
 * dev1.22.2 or v6.6.6.
 * @param {string} displayString
 */
export function getComparableVersion(displayString) {
  let i = displayString.lastIndexOf('v');
  return displayString.substring(i + 1);
}

/**
 * Replace variables with actual values in a given template string.
 * Supports kendo variables (#=variable#) or es6 variables (${variable}), using es6 if not specified.
 * @param {{ template: string; variables: Array<{}>, format: string }} opts
 */
export function interpolate(opts = { template: '', model: undefined }) {
  if (!opts.model) {
    return opts.template;
  }

  return opts.template.replace(/\${([^}]*)}/g, function (matchedStr, varName) {
    var resolver = opts.model[varName];

    if (typeof resolver === 'function') {
      resolver = resolver(); // allow a function
    }

    if (typeof resolver === 'undefined') {
      // if the caller didn't specify anything that resolves the variable value, no interpolation
      return matchedStr;
    }

    // otherwise use the value directly
    return resolver;
  });
}

/**
 * This will execute the given function every
 * pollPeriod ms until it returns the expected
 * value or times out.
 * @param {*} expectedReturnValue
 * @param {*} pollingFunction
 * @param {*} timeout
 * @param {*} pollPeriod
 */
export async function pollFor(
  expectedReturnValue,
  pollingFunction,
  timeout,
  pollPeriod
) {
  let start = performance.now();
  let actual;
  do {
    actual = await pollingFunction();
    if (expectedReturnValue == actual) {
      break;
    }
    await sleep(pollPeriod);
  } while (performance.now() - start < timeout);

  return actual;
}
