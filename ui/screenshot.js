import { Player } from "../playerclass.js";
import { getScreenshots } from "./loader.js";

/** A container for properties of a screenshot */
export class Screenshot {
    /** 
     * A dataurl for the screenshot.
     * @type {string}  
     * */
    dataUrl;

    /** A PNG of the Screenshot.
     * @type {PNG}
     */
    png;

    /** The filename in the zip under the screenshots/ directory *
     * @type {string}
     */
    fileName;

    /**
     * 
     * @param {object} args 
     */
    constructor(args = {}) {
        this.dataUrl = args.dataUrl;
        this.png = args.png;
        this.fileName = args.fileName;
    }

    /** A promise that is resolved once we have loaded the dataUrl */
    _dataUrlPromise;

    /** a promise that is resolved once we have loaded the png */
    _pngPromise;

    /**
     * create the dataUrl property by reading the zipfile
     * @returns string
     */
     async loadDataUrlFromFile() {
        let that = this;

        this._dataUrlPromise =
            getScreenshots().file(this.fileName).async('base64')
                .then(data => that.dataUrl = ('data:image/png;base64,' + data));
        return this._dataUrlPromise;
    }

    /**
     * This is expensive so only create it when needed.
     * It's up to the caller to insure there is a dataUrl
     */
    async createPngFromDataUrl() {
        let that = this;
        this._pngPromise =
            Player.dataUrlToPNG(this.dataUrl)
                .then(png => that.png = png);
        return this._pngPromise;
    }

    hydrate() {
        return this.loadDataUrlFromFile()
            .then( () => this.createPngFromDataUrl());
    }
}