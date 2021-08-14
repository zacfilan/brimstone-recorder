import { Player } from "../playerclass.js"
import { Screenshot } from "./screenshot.js";

const PNG = png.PNG;

/** A user input, type, click, context, double, etc.*/
class Input {

}

export const constants = {
    status: {
        /** the action card */
        INPUT: 'input',

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

        /** We are recording, this card was recorded. */
        RECORDED: 'recorded'
    }
};

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
     * Some properties are populated async, which we can't do in a constructor.
     * */
    async hydrate(screenshots) {
        if (this.expectedScreenshot) {
            this.expectedScreenshot = new Screenshot(this.expectedScreenshot, screenshots);
            await this.expectedScreenshot.createDataUrl(); // needed to see any image during loading
            this.expectedScreenshot.createPng(); 
        }

        if (this.acceptablePixelDifferences) {
            this.acceptablePixelDifferences = new Screenshot(this.acceptablePixelDifferences, screenshots);
            this.acceptablePixelDifferences.hydrate(); // don't await it, we can await the png or dataUrl later
        }

        if (this.actualScreenshot) {
            this.actualScreenshot = new Screenshot(this.actualScreenshot,screenshots);
            // only needed when the user edits the step before running. less likely. but could
            // be used in the case where a failure is passed to someone else to look at.
            //dataUrlPromises.push(this.actualScreenshot.createDataUrl()); 

            //await this.actualScreenshot.hydrate(); // expensive
            //await this.pixelDiff();
        }

        return this;
    }

    addExpectedScreenshot(dataUrl) {
        this.expectedScreenshot = new Screenshot({
            dataUrl: dataUrl,
            fileName: `step${this.index}_expected.png`
            // png: await Player.dataUrlToPNG(dataUrl) // this is expensive to calculate, defer until you really need it.
        });
        this.expectedScreenshot.createPng(); // kick it off but don't wait
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

        delete clone.diffDataUrl;
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
        this.acceptablePixelDifferences.dataUrl = this.diffDataUrl; // what is shown currently. at this point what we see, will become the new acceptable mask.
        this.acceptablePixelDifferences.fileName = `step${this.index}_acceptablePixelDifferences.png`;
        if (this.acceptablePixelDifferences?.dataUrl) {
            this.acceptablePixelDifferences.png = await Player.dataUrlToPNG(this.acceptablePixelDifferences.dataUrl); // convert to png
        }

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

        // once this is done I need to turn this back into the diffDataUrl, since that is what will be shown...and I do in pixelDiff function
        return await this.pixelDiff();
    }

    /** (Re)calculate the difference between the expected screenshot
    * and the actual screenshot, then apply the current acceptableErrors mask.
    */
    async pixelDiff() {
        let expectedPng = await Player.dataUrlToPNG(this.expectedScreenshot.dataUrl);
        let actualPng = await Player.dataUrlToPNG(this.actualScreenshot.dataUrl);
        let { numDiffPixels, numMaskedPixels, diffPng } = Player.pngDiff(expectedPng, actualPng, this.acceptablePixelDifferences?.png);

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
    toHtml(title, src) {
        src = src || (this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png');

        let html = `
    <div class='card ${this.status}' data-index=${this.index}>
        <div class='title'><div style="float:left;">${title}</div><div style="float:right;">${this.index + 1}</div></div>
        <div class="meter">
            <span style="width:100%;"><span class="progress"></span></span>
        </div>
        <div class='screenshot clickable'>
            <img src='${src}'>`;

        // FIXME: calculate the best location for the callout, based on the location of the overlay
        if (this.overlay) { // or this.status === constants.status.INPUT
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

    toHtml() {
        let title = '';
        switch (this.curr.status) {
            case constants.status.RECORDED:
                title = this.curr.index === TestAction.instances.length - 1 ? 'Last recorded user action' : 'User action';
                break;
            default:
                title = this.curr.index === TestAction.instances.length - 1 ? 'Final screenshot' : 'User action';
                break;
        }
        let html = `
        <div id="content">
            ${this.curr.toHtml(title)}
            `;

        if (this.next) {
            let src;
            let title;
            switch (this.next.status) {
                case constants.status.WAITING: // we are waiting for this one (implies playing)
                    title = 'Waiting for actual next screen to match this.';
                    break;
                case constants.status.ALLOWED: // it has beed edited, and has allowed errors
                    title = "Expected result. This screen has allowed differences.";
                    break;

                // these are all 'fail states'
                case constants.status.EXPECTED: // it doesn't match. (here is what we expected)
                    title = 'Expected result (last play failed here, click image to toggle)';
                    break;
                case constants.status.ACTUAL: // it doesn't match. (here is what we got)
                    title = 'Actual result (last play failed here, click image to toggle)';
                    src = this.next?.actualScreenshot?.dataUrl ?? '../images/notfound.png';
                    break;
                case constants.status.EDIT: // it doesn't match. (let's make it okay to have some differences between expected and actual)
                    title = `Difference (red pixels). ${this.next.numDiffPixels} pixels, ${this.next.percentDiffPixels}% different`;
                    src = this.next.diffDataUrl ?? '../images/notfound.png'
                    break;
                default:
                    title = 'Expected result';
                    if (this.next.index === TestAction.instances.length - 1) {
                        title += ' - final screenshot';
                    }
                    break;
            }
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
