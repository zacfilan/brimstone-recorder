import { Player } from "../player.js"
import { Screenshot } from "./screenshot.js";
import { loadOptions } from "../options.js";

const PNG = png.PNG;

export const constants = {
    /** properties of the instance. it can have more than one set, these are converted to classes.*/
    view: {
        /** it doesn't match. (here is what we expected) */
        EXPECTED: 'expected',

        DYNAMIC: 'dynamic',

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

    /** did this action happen in the shadownDOM? */
    shadowDOMAction = false;

    /** The test this action is in. */
    /**
     * @type {Test}
     */
    test = null;

    constructor(args) {
        Object.assign(this, args);
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
        return this.expectedScreenshot.createPngFromDataUrl(); // kick it off but don't wait
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
            url: this.url, // only on goto actions
            hoverTime: this.hoverTime,
            deltaX: this.deltaX, // only on wheel actions 
            deltaY: this.deltaY, // only on wheel actions
            name: this.name, // optional
            shadowDOMAction: this.shadowDOMAction,
            css: this.css // experimental for fun
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
        let options = await loadOptions();

        let { numUnusedMaskedPixels, numDiffPixels, numMaskedPixels, diffPng }
            = Player.pngDiff(
                this.expectedScreenshot.png,
                this.actualScreenshot.png,
                this.acceptablePixelDifferences?.png,
                options.pixelMatchThreshhold // should I store match threshholds per card?
            );
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

        let imageClasses = this.shadowDOMAction ? 'class="shadowDOM"' : '';
        let shadowDesc = this.shadowDOMAction ? '(shadowDOM) ' : ''
        let html = `
    <div class='card ${this.classes()} ${className}' data-index=${this.index}>
        <div title='${title.tooltip}' class='click-to-change-view title'><div class='text'>${title.text}</div><div class='actions'>${title.actions || ''}</div></div>
        <div class="meter">
            <span style="width:100%;"><span class="progress"></span></span>
            <span style="width:100%;"><span class="match-status"></span></span>
        </div>
        <div class='screenshot'>
            <img ${imageClasses} src='${src}'>`;

        // FIXME: calculate the best location for the callout, based on the location of the overlay
        if (this.overlay) {
            let o = this.overlay;
            let calloutY = o.top + o.height; // position of the text box that contains the description
            let calloutX = Math.max(o.left, 0); // position of the text box that contains the description
            if (this.type === 'mousemove' || this.type === 'click' || this.type === 'dblclick' || this.type === 'contextmenu' || this.type === 'wheels' || this.type === 'wait' || this.type === 'mouseover') {
                html += `
                <div class='overlay pointer pulse' data-index=${this.index} style='top:${o.y}%;left:${o.x}%'>
                    ${pointer}
                    </br>
                    <div class='action' data-index='${this.index}'>${shadowDesc}${this.description}</div>
                </div>`;
            }
            else {
                html += `<div class='overlay pulse action' data-index='${this.index}' style='top:${calloutY}%;left:${calloutX}%;'>${shadowDesc}${this.description}</div>`;
            }

            // highlight the whole rectangle element we are acting on
            if (o.html) {
                html += `<div class='overlay pulse-light countdown' data-index=${this.index} style='height:${o.height}%;width:${o.width}%;top:${o.top}%;left:${o.left}%'>${o.html ? o.html : ''}</div>`;
            }
            else {
                html += `<div class='overlay pulse-light' data-index=${this.index} style='height:${o.height}%;width:${o.width}%;top:${o.top}%;left:${o.left}%'></div>`;
            }
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
        if (!stats) {
            footer = '';
        }
        footer += `<div class="stepNumber">${this.index + 1}/${this.test.steps.length}</div>`;
        html += `
        </div>
        <div class='footer'>${footer}</div>
    </div>`;

        return html;
    }

    /** 
     * Update the id of this action. The id is currently also the index in the array.
     * This will update screenshot filenames too.
     */
    setIndex(to) {
        this.index = to; // reset the indicies
        if (this.expectedScreenshot?.fileName) {
            this.expectedScreenshot.fileName = this.expectedScreenshot.fileName.replace(/\d+/, to);
        }
        if (this.acceptablePixelDifferences?.fileName) {
            this.acceptablePixelDifferences.fileName = this.acceptablePixelDifferences.fileName.replace(/\d+/, to);
        }
        if (this.actualScreenshot?.fileName) {
            this.actualScreenshot.fileName = this.actualScreenshot.fileName.replace(/\d+/, to);
        }
    }
}

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

    /**
     * 
     * @param {object} args
     * @param {TestAction} args.curr The current test action
     * @param {TestAction} args.next The next test actions
     * @param {Test} args.test The containing test 
     */
    constructor({ curr, next = null, test }) {
        this.curr = curr;
        this.test = test;
        this.next = next || test.steps[this.curr.index + 1];
    }

    toHtml({ isRecording }) {
        let title = {
            text: `
            <svg aria-hidden="true" focusable="false" data-prefix="far" data-icon="pencil-alt" role="img"
            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-pencil-alt fa-w-16 fa-9x">
            <path fill="currentColor"
              d="M491.609 73.625l-53.861-53.839c-26.378-26.379-69.075-26.383-95.46-.001L24.91 335.089.329 484.085c-2.675 16.215 11.368 30.261 27.587 27.587l148.995-24.582 315.326-317.378c26.33-26.331 26.581-68.879-.628-96.087zM200.443 311.557C204.739 315.853 210.37 318 216 318s11.261-2.147 15.557-6.443l119.029-119.03 28.569 28.569L210 391.355V350h-48v-48h-41.356l170.259-169.155 28.569 28.569-119.03 119.029c-8.589 8.592-8.589 22.522.001 31.114zM82.132 458.132l-28.263-28.263 12.14-73.587L84.409 338H126v48h48v41.59l-18.282 18.401-73.586 12.141zm378.985-319.533l-.051.051-.051.051-48.03 48.344-88.03-88.03 48.344-48.03.05-.05.05-.05c9.147-9.146 23.978-9.259 33.236-.001l53.854 53.854c9.878 9.877 9.939 24.549.628 33.861z"
              class="">
            </path>
          </svg>`,
            tooltip: 'Click to edit.',
            actions: ''
        };
        if (isRecording) {
            title.text += this.curr.name || (this.curr.index === this.test.steps.length - 1 ? 'Last recorded user action' : 'User action');
        }
        else {
            title.text += this.curr.name || (this.curr.index === this.test.steps.length - 1 ? 'Final screenshot' : 'User action');
        }
        title.actions = `
        <div class="actions">
          <button title="Delete this action" data-action="deleteAction">
            <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="trash"
              class="svg-inline--fa fa-trash fa-w-14" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
              <path fill="currentColor"
                d="M432 32H312l-9.4-18.7A24 24 0 0 0 281.1 0H166.8a23.72 23.72 0 0 0-21.4 13.3L136 32H16A16 16 0 0 0 0 48v32a16 16 0 0 0 16 16h416a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16zM53.2 467a48 48 0 0 0 47.9 45h245.8a48 48 0 0 0 47.9-45L416 128H32z">
              </path>
            </svg>
          </button>
        </div>`;

        let html = `
        <div id="content">
            ${this.curr.toHtml({ title: title, src: null, className: 'action', stats: false })}
            `;

        if (this.next) {
            let src;
            let title = {
                text: `
                    <svg id='cycle' viewbox="0 0 120 120"">
                    <circle cx="60"    cy="60"    r="40"   stroke="currentColor" stroke-width="5" fill="none" />
                    <circle cx="60"    cy="22"  r="20" fill="currentColor" />
                 </svg>`,
                tooltip: 'Click to cycle through\nexpected, actual, and difference views.',
                actions: ''
            };


            if (this.next._match === constants.match.PLAY) {
                title.text += 'Wait for actual to match.';
            }
            else {

                if (this.next._match === constants.match.FAIL) {
                    title.text += 'Failed match. ';
                }

                switch (this.next._view) {
                    case constants.view.EXPECTED:
                        title.text += 'Expected result';
                        if (this.next.index === this.test.steps.length - 1) {
                            title.text += ' - final screenshot';
                        }
                        title.text += '.';
                        break;
                    case constants.view.DYNAMIC:
                        title.text += 'Expecting result';
                        break;
                    case constants.view.ACTUAL:
                        title.text += 'Actual result.';
                        src = this.next?.actualScreenshot?.dataUrl ?? '../images/notfound.png';
                        break;
                    case constants.view.EDIT:
                        title.text += `Difference (red pixels). ${this.next.numDiffPixels} pixels, ${this.next.percentDiffPixels}% different.`;
                        // <button title="Repeat last added rectangle(s)" id="stampDelta">
                        //     <svg aria-hidden="true" focusable="false" data-prefix="far" data-icon="stamp" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-stamp fa-w-16 fa-7x"><path fill="currentColor" d="M416 256h-66.56c-16.26 0-29.44-13.18-29.44-29.44v-9.46c0-27.37 8.88-53.42 21.46-77.73 9.11-17.61 12.9-38.38 9.05-60.42-6.77-38.78-38.47-70.7-77.26-77.45C267.41.49 261.65 0 256 0c-53.02 0-96 42.98-96 96 0 14.16 3.12 27.54 8.68 39.57C182.02 164.43 192 194.71 192 226.5v.06c0 16.26-13.18 29.44-29.44 29.44H96c-53.02 0-96 42.98-96 96v48c0 8.84 7.16 16 16 16h16v64c0 17.67 14.33 32 32 32h384c17.67 0 32-14.33 32-32v-64h16c8.84 0 16-7.16 16-16v-48c0-53.02-42.98-96-96-96zM48 352c0-26.47 21.53-48 48-48h66.56c42.7 0 77.44-34.74 77.44-77.5 0-34.82-8.82-70.11-27.74-111.06-2.83-6.12-4.26-12.66-4.26-19.44 0-26.47 21.53-48 48-48 2.96 0 6 .27 9.02.79 18.82 3.28 34.89 19.43 38.2 38.42 1.87 10.71.39 20.85-4.4 30.11C280.78 152.21 272 184.85 272 217.1v9.46c0 42.7 34.74 77.44 77.44 77.44H416c26.47 0 48 21.53 48 48v16H48v-16zm384 112H80v-48h352v48z" class=""></path></svg>
                        // </button>
                        title.actions = `
                        <button title="Accept Unpredictable Pixels" id="ignoreDelta">
                        <svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="thumbs-up" role="img"
                          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-thumbs-up fa-w-16 fa-9x">
                          <path fill="currentColor"
                            d="M496.656 285.683C506.583 272.809 512 256 512 235.468c-.001-37.674-32.073-72.571-72.727-72.571h-70.15c8.72-17.368 20.695-38.911 20.695-69.817C389.819 34.672 366.518 0 306.91 0c-29.995 0-41.126 37.918-46.829 67.228-3.407 17.511-6.626 34.052-16.525 43.951C219.986 134.75 184 192 162.382 203.625c-2.189.922-4.986 1.648-8.032 2.223C148.577 197.484 138.931 192 128 192H32c-17.673 0-32 14.327-32 32v256c0 17.673 14.327 32 32 32h96c17.673 0 32-14.327 32-32v-8.74c32.495 0 100.687 40.747 177.455 40.726 5.505.003 37.65.03 41.013 0 59.282.014 92.255-35.887 90.335-89.793 15.127-17.727 22.539-43.337 18.225-67.105 12.456-19.526 15.126-47.07 9.628-69.405zM32 480V224h96v256H32zm424.017-203.648C472 288 472 336 450.41 347.017c13.522 22.76 1.352 53.216-15.015 61.996 8.293 52.54-18.961 70.606-57.212 70.974-3.312.03-37.247 0-40.727 0-72.929 0-134.742-40.727-177.455-40.727V235.625c37.708 0 72.305-67.939 106.183-101.818 30.545-30.545 20.363-81.454 40.727-101.817 50.909 0 50.909 35.517 50.909 61.091 0 42.189-30.545 61.09-30.545 101.817h111.999c22.73 0 40.627 20.364 40.727 40.727.099 20.363-8.001 36.375-23.984 40.727zM104 432c0 13.255-10.745 24-24 24s-24-10.745-24-24 10.745-24 24-24 24 10.745 24 24z"
                            class=""></path>
                        </svg>
                      </button>
              
                      <button title="Clear Unpredictable Pixels" id="undo">
                        <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="undo"
                          class="svg-inline--fa fa-undo fa-w-16" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                          <path fill="currentColor"
                            d="M212.333 224.333H12c-6.627 0-12-5.373-12-12V12C0 5.373 5.373 0 12 0h48c6.627 0 12 5.373 12 12v78.112C117.773 39.279 184.26 7.47 258.175 8.007c136.906.994 246.448 111.623 246.157 248.532C504.041 393.258 393.12 504 256.333 504c-64.089 0-122.496-24.313-166.51-64.215-5.099-4.622-5.334-12.554-.467-17.42l33.967-33.967c4.474-4.474 11.662-4.717 16.401-.525C170.76 415.336 211.58 432 256.333 432c97.268 0 176-78.716 176-176 0-97.267-78.716-176-176-176-58.496 0-110.28 28.476-142.274 72.333h98.274c6.627 0 12 5.373 12 12v48c0 6.627-5.373 12-12 12z">
                          </path>
                        </svg>
                      </button>
              
                      <button title="Replace Expected with Actual" id="replace">
                        <svg id="Capa_1" enable-background="new 0 0 512 512" height="512" viewBox="0 0 512 512" width="512"
                          xmlns="http://www.w3.org/2000/svg">
                          <g>
                            <g>
                              <path
                                d="m101.664 416.507 22.123 22.123h-63.787v-46.63h-30v76.63h93.787l-22.123 22.123 21.213 21.213 58.336-58.336-58.336-58.336z" />
                              <path
                                d="m413.213 150h-112.213v-51.213l-98.787-98.787h-202.213v362h211v150h301v-263.213zm8.787 51.213 38.787 38.787h-38.787zm-211-150 38.787 38.787h-38.787zm-181-21.213h151v90h90v212h-241zm211 452v-120h60v-182h91v90h90v212z" />
                              <path
                                d="m435.394 361.147-26.517 26.517-26.517-26.517-21.213 21.213 26.517 26.517-26.517 26.517 21.213 21.212 26.517-26.516 26.517 26.516 21.212-21.212-26.516-26.517 26.516-26.517z" />
                            </g>
                          </g>
                        </svg>
                      </button>`;
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

/**
 * 
 * @param {*} element 
 * @param {Test} test 
 * @returns 
 */
export function getCard(element, test) {
    let view = $(element).closest('.card');
    let index = view.attr('data-index');
    let action = test.steps[index];
    return { view, action };
}
