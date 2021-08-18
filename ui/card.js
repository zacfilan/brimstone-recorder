import { Player } from "../playerclass.js"
import { Screenshot } from "./screenshot.js";
const PNG = png.PNG;

export const constants = {
    /** properties of the instance. it can have more than one set, these are converted to classes.*/
    view: {
        /** it doesn't match. (here is what we expected) */
        EXPECTED: 'expected',

        /** it doesn't match. (here is what we got) */
        ACTUAL: 'actual',

        /** it doesn't match. (let's make it okay to have some differences between expected and actual) */
        EDIT: 'edit'
    },

    match: {
        PASS: 'pass',
        PLAY: 'play',
        ALLOW: 'allow',
        FAIL: 'fail'
    }
};

export class TestAction {
    /** 
     * @type {object}
     * @property {number} frameId frame in the tab that generated this action */
    sender;

    /**
     * object that descobes the boundingClientRect in percentages
     * so that it can render when the UI is resized.
     */
    overlay;

    /** how long the mouse hovered over this element before it was clicked.
     * helps replay wait long enough to trigger (custom) tooltips.
     */
    hoverTime;

    /** text to display in UI about this action */
    description;

    /** the tabHeight when this action was recorded. */
    tabHeight;

    /** the tabWidth when this action was recorded. */
    tabWidth;

    /** the index of this action within the full test */
    index;

    /**
     * used to distinguish 1st from 2nd click for single double clicks
     */
    detail;

    /**
     * the element that is the target of this action
     */
    boundingClientRect;

    /** the x coordinate of this action*/
    x;

    /** the y corrdinate of this action */
    y;

    /** raw copy of the event that generated this action */
    event;

    /** string id of the type of the action (e.g. event.type) */
    type;

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
     * acceptablePixelDifferences, 
     * */
    lastVerifyScreenshotDiffDataUrl;

    /**
     * It is used for display in the card view of the edit screenshot.
     * Why would this be different than the acceptblePixelDifference.dataUrl? 
     */
    editViewDataUrl;

    /**
     * the result of the last time we tried to match expected against actual with the mask 
     * one of 'fail', 'allow', 'pass', 'play',  undefined. the last meaning we don't have that info.
     */
    _match;

    /** The view view of the card, really which image src to use */
    _view;

    constructor(args) {
        Object.assign(this, args);

        // make sure it has a step number
        if (this.index === undefined) {
            this.index = TestAction.instances.length;
        }
        TestAction.instances[this.index] = this;

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
        let clone = {
            type: this.type,
            boundingClientRect: this.boundingClientRect,
            event: this.event,
            x: this.x,
            y: this.y,
            sender: this.sender,
            index: this.index,
            tabHeight: this.tabHeight,
            tabWidth: this.tabWidth,
            overlay: this.overlay,
            description: this.description
        };

        if (this.expectedScreenshot) {
            clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        }

        if (this.actualScreenshot && this.numDiffPixels && this.actualScreenshot.fileName) {
            clone.actualScreenshot = { fileName: this.actualScreenshot.fileName }; // delete the large dataUrl when serializing
        }

        if (this.acceptablePixelDifferences) {
            clone.acceptablePixelDifferences = { fileName: this.acceptablePixelDifferences.fileName };
        }

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

        this.acceptablePixelDifferences.fileName = `step${this.index}_acceptablePixelDifferences.png`;

        if (this.lastVerifyScreenshotDiffDataUrl) {
            this.acceptablePixelDifferences.dataUrl = this.lastVerifyScreenshotDiffDataUrl;
            await this.acceptablePixelDifferences.createPngFromDataUrl();
            delete this.lastVerifyScreenshotDiffDataUrl;
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
        let { numUnusedMaskedPixels, numDiffPixels, numMaskedPixels, diffPng } = Player.pngDiff(this.expectedScreenshot.png, this.actualScreenshot.png, this.acceptablePixelDifferences?.png);
        this.acceptablePixelDifferences.dataUrl = 'data:image/png;base64,' + PNG.sync.write(diffPng).toString('base64');
        this.acceptablePixelDifferences.png = diffPng;

        // view models stuff
        this.numDiffPixels = numDiffPixels;
        let UiPercentDelta = (numDiffPixels * 100) / (this.expectedScreenshot.png.width * this.expectedScreenshot.png.height);
        this.percentDiffPixels = UiPercentDelta.toFixed(2);
        this.editViewDataUrl = this.acceptablePixelDifferences.dataUrl;
        if (numMaskedPixels || numUnusedMaskedPixels) {
            this._view = constants.view.EDIT;
            this._match = constants.match.ALLOW;
        }
        else if (this.numDiffPixels) {
            this._view = constants.view.EDIT;
            this._match = constants.match.FAIL;
        }
    }

    toThumb() {
        let src = this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        return `
        <div class='card ${this.classes()} thumb' data-index=${this.index}>
            <img draggable='false' src='${src}'>
        </div>`;
    }

    /** calculate the classes to put on the DOM element */
    classes() {
        return `${this?._view || ''} ${this?._match || ''}`;
    }

    /** Return the html for the edit card view. */
    toHtml(title, src) {
        src = src || (this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png');

        let html = `
    <div class='card ${this.classes()}' data-index=${this.index}>
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

            if(this.next._match === constants.match.PLAY) {
                title += 'Wait for actual to match.';
            }
            else {

                if(this.next._match === constants.match.FAIL) {
                    title += '❌ failed match. ';
                }

                switch (this.next._view) {
                    case constants.view.EXPECTED:
                        title += 'Expected result';
                        if (this.next.index === TestAction.instances.length - 1) {
                            title += ' - final screenshot';
                        }
                        title += '.';
                        break;
                    case constants.view.ACTUAL:
                        title += 'Actual result.';
                        src = this.next?.actualScreenshot?.dataUrl ?? '../images/notfound.png';
                        break;
                    case constants.view.EDIT:
                        title += `Difference (red pixels). ${this.next.numDiffPixels} pixels, ${this.next.percentDiffPixels}% different`;
                        src = this.next.editViewDataUrl ?? '../images/notfound.png';
                        break;
                }
            }

            if (this.next._match === constants.match.ALLOW) {
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
