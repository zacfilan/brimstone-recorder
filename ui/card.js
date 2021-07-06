import { Player } from "../playerclass.js"
const PNG = png.PNG;

/** A user input, type, click, context, double, etc.*/
class Input {

}

export const status = {
    FAIL: 'failed',
    PASS: 'passed',
    CORRECTED: 'corrected',
    PLAYING: 'playing',
    RECORDED: 'recorded',
    NOTRUN: 'notrun',
    NEXT: 'next'
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

/** Something the user does. Primarily, a tuple with a pre-requiste screenshot, and a subsequent input.
 * This is populated durig recording.
 */
class UserAction {
    /** 
     * What the screen should look like before the input action can be performed.
     * @type {Screenshot}  
     * */
    expectedScreenshot;

    /** The input.
     * @type {Input}
     */
    input;

    constructor(args = {}) {
        Object.assign(this, args);
    }
}

/** Contains additional info about the status of testing (playing) a UserAction */
export class TestAction extends UserAction {
    /** The status of the test step. */
    status;

    /** Optional. The actual screenshot, to be compared with the expected screenshot.
     * @type {Screenshot}
     */
    actualScreenshot;

    /** Optional. The pixel differences that are allowed, between the expected and actual screenshots.
     * @type {Screenshot}
     */
    acceptablePixelDifferences;

    constructor(args = {}) {
        super(args);
        if (!this.status) {
            this.status = status.RECORDED;
        }

        // make sure it has a step number
        if (this.index === undefined) {
            this.index = TestActions.instances.length;
        }

        TestAction.instances[this.index] = this;
    }

    /** 
     * Some properties are populated async, which we can't do in a constuctor so... */
    async hydrate(screenshots) {
        if (this?.expectedScreenshot?.fileName) {
            if (!this?.expectedScreenshot?.dataUrl) {
                this.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(this.expectedScreenshot.fileName).async('base64');
            }
        }

        if (this.actualScreenshot) {
            // this step failed - we need to generate the diff
            if (!this.expectedScreenshot.dataUrl) {
                this.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(this.expectedScreenshot.fileName).async('base64');
            }
            if (!this.actualScreenshot.dataUrl) {
                this.actualScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(this.actualScreenshot.fileName).async('base64');
            }
            if (this.acceptablePixelDifferences && !this.acceptablePixelDifferences.dataUrl) {
                this.acceptablePixelDifferences.dataUrl = 'data:image/png;base64,' + await screenshots.file(this.acceptablePixelDifferences.fileName).async('base64');
            }

            this.status = status.FAIL;
            await this.pixelDiff();
        }
    }

    toJSON() {
        let clone = Object.assign({}, this);
        clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        if (this.actualScreenshot) {
            clone.actualScreenshot = { fileName: this.actualScreenshot.fileName }; // delete the large dataUrl when serializing
        }
        if (clone.acceptablePixelDifferences) {
            clone.acceptablePixelDifferences = { fileName: this.acceptablePixelDifferences.fileName };
        }
        delete clone.diffDataUrl;
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
            // once this is done I need to turn this back into the diffDataUrl, since that is what will be show...and I do in pixelDiff function
        }
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
        this.diffDataUrl = 'data:image/png;base64,' + PNG.sync.write(diffPng).toString('base64');
        if (numMaskedPixels) {
            this.status = status.CORRECTED;
        }
    }

    toThumb() {
        let src = this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        return `
        <div class='card ${this.status} thumb' data-index=${this.index}>
            <img draggable='false' src='${src}'>
        </div>`;
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

    /** 
     * This is what will be shown when the card is rendered in the UI. It is not persisted. 
     * When loaded it is set. When played it can be set.
    */
    diffDataUrl;

    toHtml() {
        if (this.status === status.FAIL) {
            return this._failView();
        }

        let curr = this.curr;
        let next = this.next;
        let src = curr?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        let nextSrc = next?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        let html = `
        <div id="content">
            <div class='card expected ${curr.status}' data-index=${curr.index}>
                <div class='title'>[${curr.index}]: Current screen</div>
                <div class='screenshot'>
                    <img src='${src}'>`;
        if (curr.overlay) {
            let o = curr.overlay;
            html += `<div class='overlay' data-index=${curr.index} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>`;
        }
        html += `
                </div>
            </div>
            <div class='card ${next.status}' data-index=${next.index}>
                <div class='title'>[${next.index}]: Next screen. (after action completes)</div>
                <div class='screenshot'>
                    <img src='${nextSrc}'>
                </div>
            </div>
        </div>`;

        if (curr.overlay) {
            html += `<div id="action" class='user-event' data-index='${curr.index}'>next action: ${curr.description}</div>`
        }

        return html;
    }

    _failView() {
        let curr = this.curr;
        let src = curr?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
        let html = `
        <div id="content">
            <div class='card expected ${curr.status}' data-index=${curr.index}>
            <div class='title'>[${curr.index}]: Expected current screen (click image to toggle)</div>
            <div class='screenshot clickable'>
                    <img src='${src}'>`;
        if (curr.overlay) {
            let o = curr.overlay;
            currCardHtml += `<div class='overlay' data-index=${curr.index} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>`;
        }
        html += `
                </div>
            </div>
            <div class='card pixel-differences' data-index=${curr.index}>
                <div class='title'>[${curr.index}]: Difference (red pixels). ${curr.numDiffPixels} pixels, ${curr.percentDiffPixels}% different</div>
                <div class='screenshot'>
                    <img src='${curr.diffDataUrl}'>
                </div>
                <div class='user-events'>
                    <span>
                        <button class="ignore">Ignore</button>
                        <button class="volatile">Volatile</button>
                    </span>
                </div>
            </div>
        </div>`;

        if (curr.overlay) {
            html += `<div id="action" class='user-event' data-index='${curr.index}'>next action: ${curr.description}</div>`
        }

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
