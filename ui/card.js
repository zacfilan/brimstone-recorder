import { Player } from "../player.js"
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
        FAIL: 'fail',
        CANCEL: 'cancel'
    }
};

const chart = `
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 viewBox="0 0 512 512" style="enable-background:new 0 0 512 512;" xml:space="preserve">
<g>
	<g>
		<path d="M465.455,74.473c-25.664,0-46.545,20.882-46.545,46.545c0,14.749,7.028,27.76,17.766,36.294L322.498,359.319
			c-8.502-9.101-20.509-14.883-33.916-14.883c-9.159,0-17.651,2.75-24.86,7.339L178.018,240.36
			c5.134-7.482,8.164-16.513,8.164-26.251c0-25.664-20.882-46.545-46.545-46.545c-25.664,0-46.545,20.882-46.545,46.545
			c0,9.664,2.969,18.643,8.032,26.092l-41.951,50.342c-4.042-1.15-8.222-1.961-12.626-1.961C20.882,288.582,0,309.464,0,335.127
			s20.882,46.545,46.545,46.545s46.545-20.882,46.545-46.545c0-14.425-6.736-27.178-17.073-35.723l38.516-46.219
			c7.257,4.678,15.845,7.469,25.102,7.469c9.159,0,17.651-2.75,24.86-7.339L250.2,364.731c-5.134,7.482-8.164,16.512-8.164,26.251
			c0,25.664,20.882,46.545,46.545,46.545c25.664,0,46.545-20.882,46.545-46.545c0-4.514-0.849-8.791-2.052-12.922
			c0.289-0.367,0.611-0.697,0.848-1.115l119.373-211.197c3.9,1.064,7.925,1.815,12.159,1.815c25.664,0,46.545-20.882,46.545-46.545
			S491.118,74.473,465.455,74.473z M46.545,363.055c-15.4,0-27.927-12.527-27.927-27.927S31.145,307.2,46.545,307.2
			s27.927,12.527,27.927,27.927S61.945,363.055,46.545,363.055z M139.636,242.036c-15.4,0-27.927-12.527-27.927-27.927
			c0-15.4,12.527-27.927,27.927-27.927c15.4,0,27.927,12.527,27.927,27.927C167.564,229.509,155.036,242.036,139.636,242.036z
			 M288.582,418.909c-15.4,0-27.927-12.527-27.927-27.927s12.527-27.927,27.927-27.927c15.4,0,27.927,12.527,27.927,27.927
			S303.982,418.909,288.582,418.909z M465.455,148.945c-15.4,0-27.927-12.527-27.927-27.927s12.527-27.927,27.927-27.927
			s27.927,12.527,27.927,27.927S480.855,148.945,465.455,148.945z"/>
	</g>
</g>
</svg>
`;


const pointer = `
<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="arrow-pointer"
  class="svg-inline--fa fa-arrow-pointer" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512">
  <path fill="currentColor"
    d="M318.4 304.5c-3.531 9.344-12.47 15.52-22.45 15.52h-105l45.15 94.82c9.496 19.94 1.031 43.8-18.91 53.31c-19.95 9.504-43.82 1.035-53.32-18.91L117.3 351.3l-75 88.25c-4.641 5.469-11.37 8.453-18.28 8.453c-2.781 0-5.578-.4844-8.281-1.469C6.281 443.1 0 434.1 0 423.1V56.02c0-9.438 5.531-18.03 14.12-21.91C22.75 30.26 32.83 31.77 39.87 37.99l271.1 240C319.4 284.6 321.1 295.1 318.4 304.5z">
  </path>
</svg>`;

export class TestAction {
    /** 
     * @type {object}
     * @property {number} frameId frame in the tab that generated this action */
    sender;

    /**
     * object that describes the boundingClientRect in percentages
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

    /** x coordinate of the action. for mouse events, this is the pixel location of the mouse. for type events it is the middle of the element that gets the key */
    x;

    /** y coordinate of the action. for mouse events, this is the pixel location of the mouse. for type events it is the middle of the element that gets the key */
    y;

    /** filtered copy of the event that generated this action */
    event;

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
     * one of 'fail', 'allow', 'pass', 'play', 'cancel', undefined. the last meaning we don't have that info.
     */
    _match;

    /** The view view of the card, really which image src to use */
    _view;

    /** recorded during playback, this is the number of MBs in use after this action is performed. */
    memoryUsed;

    /** 
     * Optional the user can name this action. e.g. 'Open Dialog'
     * @type {string}*/
    name;

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
            event: this.event, // curated properties from an Event
            x: this.x,
            y: this.y,
            sender: this.sender,
            index: this.index,
            tabHeight: this.tabHeight,
            tabWidth: this.tabWidth,
            overlay: this.overlay,
            description: this.description,
            memoryUsed: this.memoryUsed,
            latency: this.latency,
            url: this.url, // only on start actions
            hoverTime: this.hoverTime,
            deltaX: this.deltaX, // only on wheel actions 
            deltaY: this.deltaY, // only on wheel actions
            name: this.name // optional
        };

        if (this.expectedScreenshot) {
            clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        }

        if (this.actualScreenshot?.fileName && this.numDiffPixels) {
            clone.actualScreenshot = { fileName: this.actualScreenshot.fileName }; // delete the large dataUrl when serializing
        }

        if (this.acceptablePixelDifferences?.fileName) {
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
        else {
            this._match = constants.match.PASS;
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
    toHtml({ title, src, className, stats }) {
        src = src || (this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png');
        //let clickable = this._view === constants.view.EDIT ? '' : ' click-to-change-view';

        let html = `
    <div class='card ${this.classes()} ${className}' data-index=${this.index}>
        <div title='${title.tooltip}' class='click-to-change-view title'>${title.text}<div class="stepNumber">${this.index + 1}</div></div>
        <div class="meter">
            <span style="width:100%;"><span class="progress"></span></span>
            <span style="width:100%;"><span class="match-status"></span></span>
        </div>
        <div class='screenshot'>
            <img src='${src}'>`;

        // FIXME: calculate the best location for the callout, based on the location of the overlay
        if (this.overlay) {
            let o = this.overlay;
            let calloutY = o.top + o.height;
            let calloutX = o.left;
            if (this.type === 'mousemove' || this.type === 'click' || this.type === 'doubleclick' || this.type === 'contenxtmenu') {
                calloutY = o.y + (100 * ((18 + 25) / o.tabHeight)); // 25px lower than the 18px pointer is
                calloutX = o.x;
                html += `<div class='overlay pointer' data-index=${this.index} style='top:${o.y}%;left:${o.x}%'>${pointer}</div>`;
            }
            html += `
            <div class='overlay pulse' data-index=${this.index} style='height:${o.height}%;width:${o.width}%;top:${o.top}%;left:${o.left}%'></div>
            <div class='action callout user-event' data-index='${this.index}' style='top:${calloutY}%;left:${calloutX}%;'>${this.description}</div>
            `;
        }

        let footer = '';
        if (this.latency) {
            let red = this.latency > 3 ? "class='error-text'" : '';
            footer += `Visible in&nbsp<span ${red}>${this.latency}s</span>.`;
        }
        if (this.memoryUsed) {
            if (this.latency) {
                footer += ' ';
            }
            footer += `${this.memoryUsed}MBs in use.`;
        }
        if (this.latency || this.memoryUsed) {
            footer += `<button id='chartButton' title='Chart these metrics.'>${chart}</button>`;
        }
        if (!stats) {
            footer = '';
        }
        html += `
        </div>
        <div class='footer'>${footer}</div>
    </div>`;

        return html;
    }

}

/**
 * @type {TestAction[]}
 */
TestAction.instances = [];

/**
 * Metadata about the current set of test actions.
 */
TestAction.meta = {
    /** The version of brimstone-recorder used to record this test. */
    version: 'v' + chrome.runtime.getManifest().version,

    /** Should we hide the cursor for this test for performance? */
    hideCursor: true,

    /** Was this test recorded (and should be played back) incognito? */
    incognito: false
};

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
        let title = {
            text: '',
            tooltip: 'Click to edit.'
        };
        if (isRecording) {
            title.text = this.curr.name || (this.curr.index === TestAction.instances.length - 1 ? 'Last recorded user action' : 'User action');
        }
        else {
            title.text = this.curr.name || (this.curr.index === TestAction.instances.length - 1 ? 'Final screenshot' : 'User action');
        }

        let html = `
        <div id="content">
            ${this.curr.toHtml({ title: title, src: null, className: 'action', stats: false })}
            `;

        if (this.next) {
            let src;
            let title = {
                text: '',
                tooltip: 'Click to cycle through\nexpected, actual, and difference views.'
            };

            if (this.next._match === constants.match.PLAY) {
                title.text += 'Wait for actual to match.';
            }
            else {

                if (this.next._match === constants.match.FAIL) {
                    title.text += '<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="exchange" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-exchange fa-w-16 fa-5x"><path fill="currentColor" d="M0 168v-16c0-13.255 10.745-24 24-24h381.97l-30.467-27.728c-9.815-9.289-10.03-24.846-.474-34.402l10.84-10.84c9.373-9.373 24.568-9.373 33.941 0l82.817 82.343c12.497 12.497 12.497 32.758 0 45.255l-82.817 82.343c-9.373 9.373-24.569 9.373-33.941 0l-10.84-10.84c-9.556-9.556-9.341-25.114.474-34.402L405.97 192H24c-13.255 0-24-10.745-24-24zm488 152H106.03l30.467-27.728c9.815-9.289 10.03-24.846.474-34.402l-10.84-10.84c-9.373-9.373-24.568-9.373-33.941 0L9.373 329.373c-12.497 12.497-12.497 32.758 0 45.255l82.817 82.343c9.373 9.373 24.569 9.373 33.941 0l10.84-10.84c9.556-9.556 9.341-25.113-.474-34.402L106.03 384H488c13.255 0 24-10.745 24-24v-16c0-13.255-10.745-24-24-24z" class=""></path></svg>'
                    title.text += ' failed match. ';
                }

                switch (this.next._view) {
                    case constants.view.EXPECTED:
                        title.text += 'Expected result';
                        if (this.next.index === TestAction.instances.length - 1) {
                            title.text += ' - final screenshot';
                        }
                        title.text += '.';
                        break;
                    case constants.view.ACTUAL:
                        title.text += 'Actual result.';
                        src = this.next?.actualScreenshot?.dataUrl ?? '../images/notfound.png';
                        break;
                    case constants.view.EDIT:
                        title.text += `Difference (red pixels). ${this.next.numDiffPixels} pixels, ${this.next.percentDiffPixels}% different.`;
                        src = this.next.editViewDataUrl ?? '../images/notfound.png';
                        break;
                }
            }

            if (this.next._match === constants.match.ALLOW) {
                title.text += ` <span id='allowed-differences'>&nbspHas allowed differences.</span>`;
            }

            html += this.next.toHtml({ title: title, src: src, className: 'waiting', stats: true });
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
