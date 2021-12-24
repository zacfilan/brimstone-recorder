import { Player } from "../player.js";

/** A container for properties of a screenshot */
export class Screenshot {
    /**
     * This is the tab identifer (just url really) of the tab this screenshot was taken from.
     */
    tab = {
        url: ''
    };

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
     * @param {Screenshot} args 
     */
    constructor(args = {}) {
        this.dataUrl = args.dataUrl;
        this.png = args.png;
        this.fileName = args.fileName;
        this.tab = args.tab;
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

    /**
     * populate the dataUrl and the png fields if they are not already
     * 
     * @returns 
     */
    hydrate(screenshots) {
        if(!this.dataUrl) {
            return this.loadDataUrlFromZipDir(screenshots)
                .then( () => this.createPngFromDataUrl());  
        }
        if(!this.png) {
            return this.createPngFromDataUrl();
        }
    }

}