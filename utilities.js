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

export function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}