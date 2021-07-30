import { Player } from "../playerclass.js"
const PNG = png.PNG;

/** A user input, type, click, context, double, etc.*/
class Input {

}

export const constants = {
    status: {
        /** the action card */
        INPUT: 'input',

        /** we are waiting for this one (implies playing) */
        WAITING: 'waiting',

        /** it has beed edited, and has allowed errors */
        ALLOWED: 'allowed',

        /** it doesn't match. (here is what we expected) */
        EXPECTED: 'expected',

        /** it doesn't match. (here is what we got) */
        ACTUAL: 'actual',

        /** it doesn't match. (let's make it okay to have some differences between expected and actual) */
        EDIT: 'edit'
    }
};

/** A container for properties of a screenshot */
class Screenshot {
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

    constructor(args = {}) {
        this.dataUrl = args.dataUrl;
        this.png = args.png;
        this.fileName = args.fileName;
    }
}

export class TestAction {
    /** The status of the test step. */
    status;

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

    constructor(args) {
        Object.assign(this, args);

        if (!this.status) {
            this.status = constants.status.INPUT;
        }
        // make sure it has a step number
        if (this.index === undefined) {
            this.index = TestAction.instances.length;
        }
        TestAction.instances[this.index] = this;
    }

    /** 
     * Some properties are populated async, which we can't do in a constructor so... */
    async hydrate(screenshots) {
        if (this.expectedScreenshot && !this.expectedScreenshot.dataUrl) {
            this.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(this.expectedScreenshot.fileName).async('base64');
        }

        if (this.actualScreenshot) {
            if (!this.actualScreenshot.dataUrl) {
                this.actualScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(this.actualScreenshot.fileName).async('base64');
            }
            if (this.acceptablePixelDifferences && !this.acceptablePixelDifferences.dataUrl) {
                this.acceptablePixelDifferences.dataUrl = 'data:image/png;base64,' + await screenshots.file(this.acceptablePixelDifferences.fileName).async('base64');
            }

            await this.pixelDiff();
        }
        return this;
    }

    toJSON() {
        let clone = Object.assign({}, this);
        if (this.expectedScreenshot) {
            clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        }
        if (this.actualScreenshot) {
            clone.actualScreenshot = { fileName: this.actualScreenshot.fileName }; // delete the large dataUrl when serializing
        }
        if (clone.acceptablePixelDifferences) {
            clone.acceptablePixelDifferences = { fileName: this.acceptablePixelDifferences.fileName };
        }

        delete clone.diffDataUrl;
        delete clone.numDiffPixels;
        delete clone.percentDiffPixels;
        delete clone.acceptableErrorsPng;
        // FIXME: rather than add and delete can I prevent this by construction or make it easier to delete via encapsulation

        return clone;
    }

    /** 
    * When the user clicks the button, I want the current red pixels to all turn green, and the step to pass.
    * 
    */
    async addMask($card) { // FIMXE: don't pass the card in...
        if (!this.acceptablePixelDifferences) {
            this.acceptablePixelDifferences = {};
        }
        this.acceptablePixelDifferences.dataUrl = this.diffDataUrl; // what is shown currently. .
        this.acceptablePixelDifferences.fileName = `step${this.index}_acceptablePixelDifferences.png`;
        if (this.acceptablePixelDifferences?.dataUrl) {
            this.acceptableErrorsPng = (await Player.dataUrlToPNG(this.acceptablePixelDifferences.dataUrl)).png; // convert to png
        }

        // manipulate the PNG
        let volatileRegions = $card.find('.rectangle');
        if (volatileRegions.length) {
            let $image = $card.find('img');
            let image = $image[0].getBoundingClientRect();

            // this is scaled
            let xscale = this.acceptableErrorsPng.width / image.width;
            let yscale = this.acceptableErrorsPng.height / image.height;

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

                addRectangle.call(this.acceptableErrorsPng, pngRectangle);
            });
        }
        // once this is done I need to turn this back into the diffDataUrl, since that is what will be show...and I do in pixelDiff function
        return await this.pixelDiff();
    }

    /** (Re)calculate the difference between the expected screenshot
    * and the actual screenshot, then apply mask
    */
    async pixelDiff() {
        let { png: expectedPng } = await Player.dataUrlToPNG(this.expectedScreenshot.dataUrl);
        let { png: actualPng } = await Player.dataUrlToPNG(this.actualScreenshot.dataUrl);
        let { numDiffPixels, numMaskedPixels, diffPng } = Player.pngDiff(expectedPng, actualPng, this.acceptableErrorsPng);

        this.numDiffPixels = numDiffPixels;
        let UiPercentDelta = (numDiffPixels * 100) / (expectedPng.width * expectedPng.height);
        this.percentDiffPixels = UiPercentDelta.toFixed(2);

        /** 
         * This is what will be shown when the card is rendered in the UI. It is not persisted. 
         * When loaded it is set. When played it can be set.
        */
        this.diffDataUrl = 'data:image/png;base64,' + PNG.sync.write(diffPng).toString('base64');
        if (numMaskedPixels) {
            this.status = constants.status.ALLOWED;
        }
        else if (this.numDiffPixels) {
            this.status = constants.status.EXPECTED;
        }
    }

    toThumb() {
        let src = this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        return `
        <div class='card ${this.status} thumb' data-index=${this.index}>
            <img draggable='false' src='${src}'>
        </div>`;
    }

    /** Return the html for the edit card view. */
    toHtml() {
        let title = 'Current screen';
        let src = this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        switch (this.status) {
            case constants.status.WAITING: // we are waiting for this one (implies playing)
                title = 'Waiting for next screen';
                break;
            case constants.status.ALLOWED: // it has beed edited, and has allowed errors
                title = "Expected next screen. This screen has allowed differences.";
                break;
            // these are all 'fail states'
            case constants.status.EXPECTED: // it doesn't match. (here is what we expected)
                title = 'Expected next screen (click image to toggle)';
                break;
            case constants.status.ACTUAL: // it doesn't match. (here is what we got)
                title = 'Actual next screen (click image to toggle)';
                src = this?.actualScreenshot?.dataUrl ?? '../images/notfound.png';
                break;
            case constants.status.EDIT: // it doesn't match. (let's make it okay to have some differences between expected and actual)
                title = `Difference (red pixels). ${this.numDiffPixels} pixels, ${this.percentDiffPixels}% different`;
                src = this.diffDataUrl ?? '../images/notfound.png'
                break;
        }

        let html = `
    <div class='card ${this.status}' data-index=${this.index}>
        <div class='title'>[${this.index}]: ${title}</div>
        <div class="meter">
            <span style="width:100%;"><span class="progress"></span></span>
        </div>
        <div class='screenshot clickable'>
            <img src='${src}'>`;

        // FIXME: calculate the best location for the callout, based on the location of the overlay
        if (this.overlay) { // or this.status === constants.status.INPUT
            let o = this.overlay;
            html += `
            <div class='overlay pulse-rectangle' data-index=${this.index} style='height:${o.height}%;width:${o.width}%;top:${o.top}%;left:${o.left}%'></div>
            <div class='action callout user-event' data-index='${this.index}' style='top:${o.top + o.height}%;left:${o.left}%;'>${this.description}</div>
            `;
        }
        html += `
        </div>
    </div>`;

        return html;
    }

}
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

    toHtml() {
        let html = `
        <div id="content">
            ${this.curr.toHtml()}
            `;
        if (this.next) {
            html += this.next.toHtml();
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
