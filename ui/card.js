import { Player } from "../playerclass.js"
import { Screenshot } from "./screenshot.js";
const PNG = png.PNG;

export const constants = {
    /** properties of the instance. it can have more than one set, these are converted to classes.*/
    class: {
        // PLAYING STATES
        /** we are waiting for this one (implies playing) */
        WAITING: 'waiting',

        /** it has been edited, and has allowed errors */
        ALLOWED: 'allowed',

        /** it doesn't match. (here is what we expected) */
        EXPECTED: 'expected',

        /** it doesn't match. (here is what we got) */
        ACTUAL: 'actual',

        /** it doesn't match. (let's make it okay to have some differences between expected and actual) */
        EDIT: 'edit',

        /** this card failed to match the last time it was played */
        FAILED: 'failed',
    }
};

export class TestAction {
    /** some special properties of the action */
    class = [];

    /** 
     * What the screen should look like before the input action can be performed.
     * @type {Screenshot}  
     * */
    expectedScreenshot;

    /** Optional. The actual screenshot, to be compared with the expected screenshot.
     * @type {Screenshot}
     */
    actualScreenshot;

    /** Optional. The pixel differences that are allowed, between the expected and actual screenshots.
     * @type {Screenshot}
     */
    acceptablePixelDifferences;

    /** Used to identify the tab being this action happened on. */
    tabUrl = '';

    /**
     * The number of pixels that were different between the expected screenshot and the actual screenshot.
     */
    numDiffPixels = 0;

    /**
     * The number of pixels that were different between the expected screenhot and the actual screenshot
     * but were allowed because of the acceptablePixelDifferences mask.
     */
    numMaskedPixels = 0;

    /** 
     * This is the raw output of the last verifyScreenshot. It may be copied, edited and the result assigned into the
     * acceptablePixelDifferences. 
     * */
    lastVerifyScreenshotDiffDataUrl;

    /**
     * It is used for display in the card view of the edit screenshot. 
     */
    editViewDataUrl;

    constructor(args) {
        Object.assign(this, args);

        if (!this.class) {
            this.class = [];
        }
        // make sure it has a step number
        if (this.index === undefined) {
            this.index = TestAction.instances.length;
        }
        TestAction.instances[this.index] = this;

    }

    /** 
     * hydrate the expectedScreenshot property from the zip file
     * */
    hydrateExpected() {
        if (!this.expectedScreenshot) {
            return; // the very first action doesn't have an expectedScreenshot
        }

        this.expectedScreenshot = new Screenshot(this.expectedScreenshot);
        this.class = [constants.class.EXPECTED];
        return this.expectedScreenshot.loadDataUrlFromFile(); // needed to see any image during loading
    }

    /** 
    * hydrate the acceptablePixelDifferences property from the zip file
    * */
    hydrateAcceptable() {
        this.acceptablePixelDifferences = new Screenshot(this.acceptablePixelDifferences);
        return this.acceptablePixelDifferences.hydrate(); 
    }

    /** needed only if we edit a action before playing it in a session.
     * insures that there is an actualScreenshot with a dataUrl.
     */
    createActualScreenshotWithDataUrl() {
        this.actualScreenshot = new Screenshot(this.actualScreenshot);
        if(this.actualScreenshot.fileName) {
            return this.actualScreenshot.loadDataUrlFromFile(); 
        }
        return this.actualScreenshot.dataUrl = this.expectedScreenshot.dataUrl; // copy from expected
    }

    /**
     * Called when the extension is given a user action that has been recorded.
     */
    addExpectedScreenshot(dataUrl) {
        this.expectedScreenshot = new Screenshot({
            dataUrl: dataUrl,
            fileName: `step${this.index}_expected.png`
            // png: await Player.dataUrlToPNG(dataUrl) // this is expensive to calculate, defer until you really need it.
        });
        this.expectedScreenshot.createPngFromDataUrl(); // kick it off but don't wait
    }

    toJSON() {
        let clone = Object.assign({}, this);
        //console.debug(this);
        if (this.expectedScreenshot) {
            clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        }

        if (this.actualScreenshot) {
            clone.actualScreenshot = { fileName: this.actualScreenshot.fileName }; // delete the large dataUrl when serializing
        }

        if (clone.acceptablePixelDifferences) {
            clone.acceptablePixelDifferences = { fileName: this.acceptablePixelDifferences.fileName };
        }

        delete clone.lastVerifyScreenshotDiffDataUrl;
        delete clone.numDiffPixels;
        delete clone.percentDiffPixels;
        // FIXME: rather than add and delete can I prevent this by construction or make it easier to delete via encapsulation

        return clone;
    }

    /** 
    * When the user clicks the button, I want the current red pixels to all turn green, and the step to pass.
    * 
    */
    async addMask($card) { // FIMXE: don't pass the card in...
        if (!this.acceptablePixelDifferences) {
            this.acceptablePixelDifferences = new Screenshot();
        }

        if (this.lastVerifyScreenshotDiffDataUrl) {
            this.acceptablePixelDifferences.dataUrl = this.lastVerifyScreenshotDiffDataUrl;
            this.acceptablePixelDifferences.fileName = `step${this.index}_acceptablePixelDifferences.png`;
            await this.acceptablePixelDifferences.createPngFromDataUrl();
        }
        // else we use whatever is already in acceptablePixelDifferences (editing before playing)

        // manipulate the PNG
        let volatileRegions = $card.find('.rectangle');
        if (volatileRegions.length) {
            let $image = $card.find('img');
            let image = $image[0].getBoundingClientRect();

            // this is scaled
            let xscale = this.acceptablePixelDifferences.png.width / image.width;
            let yscale = this.acceptablePixelDifferences.png.height / image.height;

            volatileRegions.each((index, rectangle) => {
                // viewport relative measurements with scaled lengths
                let rec = rectangle.getBoundingClientRect();

                // make them image relative measurements with lengths scaled to the PNG
                let pngRectangle = {
                    x0: Math.floor((rec.left - image.left) * xscale),
                    y0: Math.floor((rec.top - image.top) * yscale),
                    width: Math.floor(rec.width * xscale),
                    height: Math.floor(rec.height * yscale)
                };

                addRectangle.call(this.acceptablePixelDifferences.png, pngRectangle);
            });
        }

        return await this.pixelDiff();
    }

    /** (Re)calculate the difference between the expected screenshot
    * and the actual screenshot, then apply the acceptablePixelDifferences mask.
    * this is called via the path when we add changes, or are planning to.
    * so this.acceptablePixelDifferences, must exist
    */
    async pixelDiff() {
        let { numDiffPixels, numMaskedPixels, diffPng } = Player.pngDiff(this.expectedScreenshot.png, this.actualScreenshot.png, this.acceptablePixelDifferences?.png);
        this.acceptablePixelDifferences.dataUrl = 'data:image/png;base64,' + PNG.sync.write(diffPng).toString('base64');
        this.acceptablePixelDifferences.png = diffPng;

        // view models stuff
        this.numDiffPixels = numDiffPixels;
        let UiPercentDelta = (numDiffPixels * 100) / (this.expectedScreenshot.png.width * this.expectedScreenshot.png.height);
        this.percentDiffPixels = UiPercentDelta.toFixed(2);
        this.editViewDataUrl = this.acceptablePixelDifferences.dataUrl;
        if (numMaskedPixels) {
            this.class = [constants.class.EDIT, constants.class.ALLOWED];
        }
        else if (this.numDiffPixels) {
            this.class = [constants.class.EDIT, constants.class.FAILED];
        }
    }

    toThumb() {
        let src = this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        return `
        <div class='card ${this.class.join(' ')} thumb' data-index=${this.index}>
            <img draggable='false' src='${src}'>
        </div>`;
    }

    /** Return the html for the edit card view. */
    toHtml(title, src) {
        src = src || (this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png');

        let html = `
    <div class='card ${this.class.join(' ')}' data-index=${this.index}>
        <div class='title'><div style="float:left;">${title}</div><div style="float:right;">${this.index + 1}</div></div>
        <div class="meter">
            <span style="width:100%;"><span class="progress"></span></span>
            <span style="width:100%;"><span class="match-status"></span></span>
        </div>
        <div class='screenshot clickable'>
            <img src='${src}'>`;

        // FIXME: calculate the best location for the callout, based on the location of the overlay
        if (this.overlay) {
            let o = this.overlay;
            html += `
            <div class='overlay pulse' data-index=${this.index} style='height:${o.height}%;width:${o.width}%;top:${o.top}%;left:${o.left}%'></div>
            <div class='action callout user-event' data-index='${this.index}' style='top:${o.top + o.height}%;left:${o.left}%;'>${this.description}</div>
            `;
        }
        html += `
        </div>
    </div>`;

        return html;
    }

}

/**
 * @type {TestAction[]}
 */
TestAction.instances = [];

/**
 * An action followed by the next expected screen: action, expected screen
 * i.e expected screen, input, expected screen. These are used in the UI mainly.
 * This is really just (some parts) of two consecutive TestActions. It is modelled as so.
 */
export class Step {
    /** The current action.
     * @type {TestAction}
     */
    curr;

    /** The next action.
     * @type {TestAction}
     */
    next;

    constructor(args = {}) {
        this.curr = args.curr;
        this.next = args.next || TestAction.instances[this.curr.index + 1];
    }

    toHtml({ isRecording }) {
        let title = '';
        if (isRecording) {
            title = this.curr.index === TestAction.instances.length - 1 ? 'Last recorded user action' : 'User action';
        }
        else {
            title = this.curr.index === TestAction.instances.length - 1 ? 'Final screenshot' : 'User action';
        }

        let html = `
        <div id="content">
            ${this.curr.toHtml(title)}
            `;

        if (this.next) {
            let src;
            let title = '<span>';

            if (this.next.class.includes(constants.class.FAILED)) {
                title += '❌ failed match. ';
            }

            if (this.next.class.includes(constants.class.WAITING)) {
                title += 'Waiting for actual next screen to match this.';
            }
            else if (this.next.class.includes(constants.class.EXPECTED)) {
                title += 'Expected result.';
            }
            else if (this.next.class.includes(constants.class.ACTUAL)) {
                title += 'Actual result.';
                src = this.next?.actualScreenshot?.dataUrl ?? '../images/notfound.png';
            }
            else if (this.next.class.includes(constants.class.EDIT)) {
                title += `Difference (red pixels). ${this.next.numDiffPixels} pixels, ${this.next.percentDiffPixels}% different`;
                src = this.next.editViewDataUrl ?? '../images/notfound.png';
            }
            else {
                title += 'Expected result.';
                if (this.next.index === TestAction.instances.length - 1) {
                    title += ' - final screenshot.';
                }
            }

            if (this.next.class.includes(constants.class.ALLOWED)) {
                title += ` <span id='allowed-differences'>Has allowed differences.</span>`;
            }

            title += '</span>';
            html += this.next.toHtml(title, src);
        }
        html += `
        </div>
        `;

        return html;
    }

}

function addRectangle({ x0, y0, width, height }) {
    let ymax = y0 + height;
    let xmax = x0 + width;
    for (var y = y0; y <= ymax; y++) {
        for (var x = x0; x <= xmax; x++) {
            var idx = (this.width * y + x) << 2;
            // [255, 165, 0, 255] // orange
            this.data[idx] = 255;
            this.data[idx + 1] = 165;
            this.data[idx + 2] = 0;
            this.data[idx + 3] = 255; // fully opaque
        }
    }
}

export function getStep(element) {
    let view = $(element).closest('.step');
    let index = view.attr('data-index');
    let model = cards[index];
    return { view, model };
}

export function getCard(element) {
    let view = $(element).closest('.card');
    let index = view.attr('data-index');
    let action = TestAction.instances[index];
    return { view, action };
}
