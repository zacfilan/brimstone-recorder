import { Player } from "../playerclass.js";

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
     * zipfile location from which we can load the screenshots later
     */
    screenshots;

    /**
     * 
     * @param {object} args 
     * @param {*} screenshots zipfile location from which we can load the screenshots later
     */
    constructor(args = {}, screenshots) {
        this.dataUrl = args.dataUrl;
        this.png = args.png;
        this.fileName = args.fileName;
        this.screenshots = screenshots;
    }

    /** A promise that is resolved once we have loaded the dataUrl */
    _dataUrlPromise;

    /** a promise that is resolved once we have loaded the png */
    _pngPromise;

    /**
     * create the dataUrl property by reading the zipfile
     * @returns string
     */
    async createDataUrl() {
        let that = this;
        this._dataUrlPromise = 
            this.screenshots.file(this.fileName).async('base64')
                .then( data => that.dataUrl = ('data:image/png;base64,' + data));
        return this._dataUrlPromise;
    }

    /**
     * This is expensive so only create it when needed.
     * It is needd when playing back a recording in the verifyScreenshot function.
     */
    async createPng() {
        let that = this;
        this._pngPromise = 
            Player.dataUrlToPNG(this.dataUrl)
                .then( png => that.png = png );
        return this._pngPromise;
    }

    async hydrate() {
        await this.createDataUrl();
        await this.createPng();
    }
}