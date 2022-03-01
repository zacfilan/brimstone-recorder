'use strict';

import { Tab } from "../tab.js";

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
            let data = this.dataBase64;
            if (data) {
                this._dataUrl = 'data:image/png;base64,' + this._dataBase64;
            }
        }

        return this._dataUrl;
    }
    /**
     * backing variable for dataUrl. private.
     */
    _dataUrl;

    /** 
     * The raw base64 data returned, can autovivify 
     * from internal png data. 
     */
    get dataBase64() {
        if (!this._dataBase64) {
            if (this._png) {
                this._dataBase64 = PNG.sync.write(this._png).toString('base64');
            }
        }
        return this._dataBase64;
    }

    /**
     * When the png data changes the base64 data and 
     * dataurl are invalidated.
     */
    pngDataChanged() {
        this._dataBase64 = null;
        this._dataUrl = null;
    }

    /**
     * backing data variable for dataBase64. private.
     * @type {string}
     */
    _dataBase64;

    /** 
     * Return the PNG for this screenshot.
     * Can autovivify from internal base64 data.
     */
    get png() {
        if (!this._png) {
            if (this._dataBase64) {
                let buffer = Buffer.from(this._dataBase64, 'base64');
                this._png = PNG.sync.read(buffer);
                console.debug(`built png for ${this.fileName}`);
            }
        }
        return this._png;
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
     * 
     * @param {Screenshot | {dataBase64?: string, png?: PNG}} args
     */
    constructor(args = {}) {
        if (args instanceof Screenshot) {
            // copy constructor
            this.fileName = args.fileName;
            this.tab = args.tab;

            this._dataBase64 = args.dataBase64;
            this._extractSize();
        }
        else {
            // you should contruct this from one or the other but not both
            if (args.dataBase64 && args.png) {
                throw new Error("png and dataBase64 cannot both be specified");
            }
            if (args.dataBase64) {
                this._dataBase64 = args.dataBase64;
                this._extractSize();
            }
            if (args.png) {
                this._png = args.png;
            }

            this.fileName = args.fileName;
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
    async loadDataUrlFromZipDir(screenshots) {
        let that = this;
        this._dataUrlPromise =
            screenshots.file(this.fileName).async('base64')
                .then(data => {
                    that._dataBase64 = data;
                    this._extractSize();
                });
        return this._dataUrlPromise;
    }

    /**
     * populate the dataUrl and the png fields if they are not already
     * 
     * @returns 
     */
    async hydrate(screenshots) {
        if (!this.dataUrl && this.fileName) {
            return this.loadDataUrlFromZipDir(screenshots)
                .then(() => this.png);
        }
        this.png;
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
        if (this._dataBase64) {
            let binaryString = atob(this._dataBase64.substring(16, 16 + 16));
            let dv = binaryStringToDataView(binaryString);

            // the width and height are in (bigendian) words [1] and [2] from the words pulled out
            this._dataUrlWidth = dv.getInt32(4); // byte offset of word1
            this._dataUrlHeight = dv.getInt32(8); // byte offest of word2
        }
    }
}