'use strict';

import { Tab } from '../tab.js';

const PNG = png.PNG;
const Buffer = buffer.Buffer;

// we can reuse these
var _arrayBuffer = new ArrayBuffer(16); // 1 bytes for each char, need 3 words
var _dataView = new DataView(_arrayBuffer);
function binaryStringToDataView(str) {
  for (var i = 0, strLen = str.length; i < strLen; i++) {
    _dataView.setUint8(i, str.charCodeAt(i));
  }
  return _dataView;
}

/** A container for properties of a screenshot */
export class Screenshot {
  /**
   * This is the tab this screenshot was taken from.
   * @type {Tab}
   */
  tab = null;

  /**
   * A dataUrl for the screenshot.
   * Can autovivify from internal png data.
   * @type {string}
   * */
  get dataUrl() {
    if (!this._dataUrl) {
      if (this._png) {
        this._dataUrl =
          'data:image/png;base64,' +
          PNG.sync.write(this._png).toString('base64');
      }
    }
    return this._dataUrl;
  }

  /**
   * Return a view into the pixel buffer of the png.
   *
   */
  getPixelsAsUint32Array() {
    return new Uint32Array(this.png.data.buffer);
  }

  set dataUrl(to) {
    this._dataUrl = to;
  }

  /**
   * backing variable for dataUrl. private.
   * e.g. 'data:image/png;base64,...'
   * @type {string}
   */
  _dataUrl;

  /**
   * When the png data changes the dataUrl is invalid
   */
  pngDataChanged() {
    this._dataUrl = null;
  }

  /**
   * Return the PNG for this screenshot.
   * Can autovivify from internal base64 data.
   */
  get png() {
    if (!this._png) {
      if (this._dataUrl) {
        let buffer = Buffer.from(this._dataUrl.slice(22), 'base64');
        this._png = PNG.sync.read(buffer); // S-L-O-W and F-A-T
        console.debug(`built png for ${this.fileName}`);
      }
    }
    return this._png;
  }

  set png(to) {
    this._png = to;
    this._dataUrl = null;
  }

  /**
   * The backing data for property png. private.
   * @type {PNG}
   */
  _png;

  /**
   * The width of the png encoded in the dataUrl
   * @type {number}
   */
  get dataUrlWidth() {
    return this._dataUrlWidth;
  }
  /**
   * private backing datafor dataUrlWidth property.
   * @type {number}
   */
  _dataUrlWidth;

  /**
   * The height of the png encoded in the dataUrl
   *  @type {number}
   */
  get dataUrlHeight() {
    return this._dataUrlHeight;
  }
  /**
   * private backing data for dataUrlHeight
   * @type {number}
   */
  _dataUrlHeight;

  /** The filename in the zip under the screenshots/ directory *
   * @type {string}
   */
  fileName;

  /**
   * A zipfile entry datastructure that can be used to hydrate this
   * screenshot at will.
   */
  zipEntry;

  /**
   *
   * @param {Screenshot | {dataBase64?: string, png?: PNG}} args
   */
  constructor(args = {}) {
    if (args instanceof Screenshot) {
      // copy constructor
      this.fileName = args.fileName;
      this.tab = args.tab;

      this.dataUrl = args.dataUrl;
      this._extractSize();
    } else {
      // you should contruct this from one or the other but not both
      if (args.dataUrl && args.png) {
        throw new Error('png and dataBase64 cannot both be specified');
      }
      if (args.dataUrl) {
        this.dataUrl = args.dataUrl;
        this._extractSize();
      }
      if (args.png) {
        this.png = args.png;
      }

      this.fileName = args.fileName;
      this.zipEntry = args.zipEntry;
      this.tab = args.tab;
    }
  }

  /** A promise that is resolved once we have loaded the dataUrl */
  _dataUrlPromise;

  /** a promise that is resolved once we have loaded the png */
  _pngPromise;

  /**
   * create the dataUrl property by reading the zipfile
   * @returns string
   */
  async loadDataUrlFromZip() {
    let that = this;
    this._dataUrlPromise = this.zipEntry
      .getData(new zip.Data64URIWriter('image/png'))
      .then((data) => {
        that.dataUrl = data;
        this._extractSize();
      });
    return this._dataUrlPromise;
  }

  /**
   * If the dataUrl is empty populate it from zip
   * (if possible). Once/if we have a dataUrl, build
   * the expensive PNG from it.
   *
   * @returns
   */
  async hydrate() {
    if (!this.dataUrl && this.zipEntry) {
      return this.loadDataUrlFromZip().then(() => this.png);
    }
    this.png;
  }

  /**
   * free up screenshot memory. only on steps that are NOT dirty
   */
  dehydrate() {
    // dirty actions will not dehydrate their screenshots
    delete this._png; // this is the large one, chuck it.
    if (this.zipEntry) {
      // smaller to keep around, than the PNG object, but clean them up anyway, providing that they can
      // be rehydrated via a zipEntry.
      delete this._dataUrl;
    }
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
  _extractSize() {
    // 6 bytes of base64 encode 4 bytes of real data
    // so sequential 16 bytes of base64 encode sequential 12 bytes of real data

    // read out 24 real bytes that contain words [3], [4], [5] from the base64
    if (this._dataUrl) {
      let binaryString = atob(this._dataUrl.substring(22 + 16, 22 + 16 + 16));
      let dv = binaryStringToDataView(binaryString);

      // the width and height are in (bigendian) words [1] and [2] from the words pulled out
      this._dataUrlWidth = dv.getInt32(4); // byte offset of word1
      this._dataUrlHeight = dv.getInt32(8); // byte offest of word2
    }
  }
}
