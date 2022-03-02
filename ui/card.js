'use strict';

import { Player } from "../player.js"
import { Screenshot } from "./screenshot.js";
import { options } from "../options.js";
import { Tab } from "../tab.js";
import { ActualCorrection, Correction, UnpredictableCorrection, BoundingBox, AntiAliasCorrection } from "../rectangle.js";
import { Test } from "./brimstoneDataService.js";

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

    /** the status of a testrun/step */
    match: {
        PASS: 'pass',
        PLAY: 'play',
        ALLOW: 'allow',
        FAIL: 'fail',
        CANCEL: 'cancel',
        NOTRUN: 'notrun'
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
     * a string that identifies the action type. 
     * FIXME: i think it would make sense to refactor these as a subclass of 
     * TestAction?
     * @type {string} 
     */
    type;

    /** 
     * @type {object}
     * @property {number} frameId frame in the tab that generated this action */
    sender;

    /**
     * @type {Tab} info about the tab this action was recorded on.
     */
    tab = null;

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
     * What the screen should look like *before* the input action can be performed.
     * @type {Screenshot}  
     * */
    expectedScreenshot;

    /** 
     * Optional. The actual screenshot, to be compared with the expected screenshot.
     * This is updated by playing the action *before* this one.
     * @type {Screenshot}
     */
    actualScreenshot;

    /** 
     * Optional. The pixel differences that are officially allowed, 
     * between the expected and actual screenshots.
     * This contains **only** unpredictable (orange/yellow) pixels, and greyscale.
     * It **cannot** contain **red** pixels. Red pixels would be found in 
     * {@link pixelDiffScreenshot}.
     * @type {Screenshot} 
     * 
     */
    acceptablePixelDifferences;

    /** 
     * This is the *last* result of verifying this actions screenshots.
     * It is the result that shows what is *still* different between
     * expected and actual after the acceptable are factored in. It should
     * look just like {@link acceptablePixelDifferences} with possibly some
     * red pixels in place of some greyscale pixels.
     * 
     * Hence this is always what is seen in the EDIT view.
     *
     * @type {Screenshot}
     * */
    pixelDiffScreenshot;

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

    /**
     * Add a delay before playing. Can be inserted directly via json.
     * @type {number}    
    */
    waitBeforePlaying = 0;

    /** the user perceived latency in millisconds for this action to complete */
    latency = 0;

    /** 
     * allow each action to override how long the wait is for this particular action.
     * if it is unset, when it is needed, it comes from the global options value.
     * @type {number}
     */
    MAX_VERIFY_TIMEOUT;

    /** 
     * viewmodel variable for the time reported in the waiting title view
     * @type {number}
     */
    _lastTimeout;

    /** 
     * @type {boolean} if true playback will stop before this action is played.
    */
    breakPoint = false;

    /**
     * If the last time this action was played it was autocorrected or not.
     */
    autoCorrected = false;

    constructor(args) {
        Object.assign(this, args);
        this.tab = new Tab(this.tab);
    }

    /**
     * Called when the extension is given a user action that has been recorded.
     * @param {Screenshot} ss
     */
    addExpectedScreenshot(ss) {
        this.expectedScreenshot = new Screenshot(ss);
        this.expectedScreenshot.fileName = `step${this.index}_expected.png`;
        this.expectedScreenshot.png;
    }

    toJSON() {
        let clone = {
            type: this.type,
            boundingClientRect: this.boundingClientRect,
            event: this.event, // curated properties from an Event
            x: this.x,
            y: this.y,
            tab: this.tab,
            index: this.index,
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
            css: this.css, // experimental for fun
            waitBeforePlaying: this.waitBeforePlaying,
            breakPoint: this.breakPoint
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
     * This pokes some pixels specifed by the correction rectangle
     * into the appropriate PNG depending on the button the user pressed.
     * @param {string} buttonId what button the user pressed
     * @param {BoundingBox} bounds the bounds of this correction, comes from the rectangle correction.
     */
    _applyCorrection($rectangle, buttonId, bounds) {
        let correction;
        switch (buttonId) {
            case 'correctAsUnpredictable':
                correction = new UnpredictableCorrection({ bounds: bounds, action: this });
                Correction.availableInstances.push(correction);
                correction.apply(this);
                break;
            case 'correctAsActual':
                correction = new ActualCorrection({ bounds: bounds, action: this });
                Correction.availableInstances.push(correction);
                correction.apply(this);
                break;
            case 'possibleCorrections':
                Correction.applicableInstances.forEach(correction => {
                    correction.apply(this);
                });
                break;
            case 'correctAsAntiAlias':
                correction = new AntiAliasCorrection({ bounds: bounds, action: this });
                Correction.availableInstances.push(correction);
                correction.apply(this);
                break;
            default:
                throw new Error("internal error");
        }
    }

    /** 
    * The user is asking to fix the pixel differences they see in the EDIT view
    * of this action.
    * 
    * If there are rectangles on the screen then rectangles only are fixed according to the
    * button the user pressed (wand, question, check).
    * 
    * If there are no rectangles then all the "loose red pixels" are handled
    * according to the button the user pressed (wand, question, check).
    * 
    * Corrections applied will, change one or both of {@link acceptablePixelDifferences} and
    * {@link expectedScreenshot}. Befre returning, {@link pixelDiffScreenshot} wil be recalculated to show
    * what effect the corrections had.
    *  */
    async applyCorrections($card, e) { // FIMXE: don't pass the card in...
        // else we use whatever is already in acceptablePixelDifferences (editing before playing)
        // manipulate the PNG
        let volatileRegions = $card.find('.rectangle');
        if (volatileRegions.length) {
            // this is scaled
            let $image = $card.find('img');
            let image = $image[0].getBoundingClientRect();

            // this is scaled, need to be able to get at the actual unscaled pixels
            let xscale = this.pixelDiffScreenshot.png.width / image.width;
            let yscale = this.pixelDiffScreenshot.png.height / image.height;
            volatileRegions.each((index, rectangle) => {
                // viewport relative measurements with scaled lengths
                let rec = rectangle.getBoundingClientRect();
                let bounds = new BoundingBox({
                    x0: Math.floor((rec.left - image.left) * xscale),
                    y0: Math.floor((rec.top - image.top) * yscale),
                    width: Math.floor(rec.width * xscale),
                    height: Math.floor(rec.height * yscale)
                });

                this._applyCorrection(rectangle, e.currentTarget.id, bounds);
            });
        }
        else {
            // the user poked a button without any rectangles showing, in this case the operation applies to the whole screen
            if (e.currentTarget.id === 'correctAsActual') {
                // push the actual into the expected and be done with it.
                this.expectedScreenshot._png = this.actualScreenshot.png;
                this.expectedScreenshot.pngDataChanged();
                delete this.acceptablePixelDifferences;
                this.test.dirty = true;
            }
        }

        this.calculatePixelDiff();
    }

    /** 
     * Called anytime
     * we need to (re)build the {@link pixelDiffScreenshot} to see if there are pixel errors
     * in this action. This is what is shown in the EDIT view.
     * 
    * @param {Object} obj Destructured arguments
    * @param {boolean} obj.fastFail - Should we fast fail the pixel diff? 
    * */
    calculatePixelDiff({ fastFail = false } = {}) {
        let { numUnusedMaskedPixels, numDiffPixels, numMaskedPixels, diffPng }
            = Player.pngDiff(
                this.expectedScreenshot.png,
                this.actualScreenshot.png,
                this.acceptablePixelDifferences?.png, // this may not exist, in which case our diffPng will not have orange pixels

                options.pixelMatchThreshhold,
                fastFail
            );
        // the diff PNG comes out with perhaps some red ones, but these should be outside of what went in. 
        // I should not be able to lose orange or yellow, but always pass those through to the result.
        this.pixelDiffScreenshot = new Screenshot({png: diffPng});

        // view models stuff
        this.numDiffPixels = numDiffPixels;
        let UiPercentDelta = (numDiffPixels * 100) / (this.expectedScreenshot.png.width * this.expectedScreenshot.png.height);
        this.percentDiffPixels = UiPercentDelta.toFixed(2);

        this._match = constants.match.FAIL; // until we determine different
        if (numDiffPixels === 0) { // it matched
            this._match = constants.match.PASS;
            if (numMaskedPixels || numUnusedMaskedPixels) { // it matched only because of the masking we allowed
                this._match = constants.match.ALLOW;
            }
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
    toHtml({ title, src, className, stats, screenshot = {class: ''} }) {
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
        <div class='screenshot ${screenshot.class}'>
            <img ${imageClasses} src='${src}'>`;

        // FIXME: calculate the best location for the callout, based on the location of the overlay
        if (this.overlay) {
            let o = this.overlay;
            let calloutY = o.top + o.height; // position of the text box that contains the description
            let calloutX = Math.max(o.left, 0); // position of the text box that contains the description
            if (this.type === 'mousemove' || this.type === 'click' || this.type === 'dblclick' || this.type === 'contextmenu' || this.type === 'wheels' || this.type === 'mouseover') {
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
        // the 2nd card shows the latency of the previous action to complete, and the memory when it did complete.
        let latency, memoryUsed;
        if (this.index) {
            let prev = this.test.steps[this.index - 1];
            latency = prev.latency;
            memoryUsed = prev.memoryUsed;
        }
        if (latency) {
            let red = latency > 3000 ? "class='error-text'" : '';
            footer += `Visible in&nbsp<span ${red}>${(latency / 1000).toFixed(1)}s</span>.`;
        }
        if (memoryUsed) {
            if (latency) {
                footer += ' ';
            }
            footer += `${memoryUsed}MBs in use.`;
        }

        if (!stats) {
            footer = '';
        }

        let width = '?';
        let height = '?';
        let ss;
        switch (this._view) {
            case 'dynamic':
            case 'expected':
                ss = this.expectedScreenshot;
                break;
            case 'edit':
                if (this.pixelDiffScreenshot) {
                    ss = this.pixelDiffScreenshot;
                }
                break;
            case 'actual':
                ss = this.actualScreenshot;
                break;
        }

        if (ss) {
            if (ss.dataUrlHeight) {
                width = ss.dataUrlWidth;
                height = ss.dataUrlHeight;
            }
            else if (ss.png) {
                width = ss.png.width;
                height = ss.png.height;
            }
        }

        footer += ` tab:${this.tab.virtualId} viewport:${width}x${height} `;
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
                title.text += `Wait ${this.next._lastTimeout} second${this.next._lastTimeout > 1 ? 's' : ''} for actual screen to match this.`;
            }
            else {

                if (this.next._match === constants.match.FAIL) {
                    title.text += `Failed to match in ${this.next._lastTimeout} second${this.next._lastTimeout > 1 ? 's' : ''}. `;
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
                        let autoplay = this.next.test.autoPlay ? "autoPlay" : '';
                        let titleSuffix = autoplay ? '. Autoplay.' : '';

                        // at this point there can be NO untyped rectangles. But there *might* be red pixels or not.
                        let noRedPixels = !this.next.numDiffPixels;
                        let wandDisabled = noRedPixels || !Correction.availableInstances.length;
                        let questionMarkDisabled = true; // there is no untyped rectangle
                        let ironDisabled = true; // there is no untyped rectangle
                        let checkDisabled = noRedPixels; // disabled if there are no red pixels

                        title.actions = `
                        <button ${wandDisabled ? 'disabled': ''} title="Possible corrections${titleSuffix}" id="possibleCorrections" class="${autoplay}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 6.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="M3.682 149.1L53.32 170.7L74.02 220.3c1.016 2.043 3.698 3.696 5.977 3.696c.0078 0-.0078 0 0 0c2.271-.0156 4.934-1.661 5.946-3.696l20.72-49.63l49.62-20.71c2.023-1.008 3.68-3.681 3.691-5.947C159.1 141.7 158.3 139 156.3 138L106.9 117.4L106.5 117L85.94 67.7C84.93 65.66 82.27 64.02 80 64c-.0078 0 .0078 0 0 0c-2.279 0-4.966 1.649-5.981 3.692L53.32 117.3L3.682 138C1.652 139.1 0 141.7 0 144C0 146.3 1.652 148.9 3.682 149.1zM511.1 368c-.0039-2.273-1.658-4.95-3.687-5.966l-49.57-20.67l-20.77-49.67C436.9 289.7 434.3 288 432 288c-2.281 0-4.948 1.652-5.964 3.695l-20.7 49.63l-49.64 20.71c-2.027 1.016-3.684 3.683-3.687 5.956c.0039 2.262 1.662 4.954 3.687 5.966l49.57 20.67l20.77 49.67C427.1 446.3 429.7 448 432 448c2.277 0 4.944-1.656 5.96-3.699l20.69-49.63l49.65-20.71C510.3 372.9 511.1 370.3 511.1 368zM207.1 64l12.42 29.78C221 95.01 222.6 96 223.1 96s2.965-.9922 3.575-2.219L239.1 64l29.78-12.42c1.219-.6094 2.215-2.219 2.215-3.578c0-1.367-.996-2.969-2.215-3.578L239.1 32L227.6 2.219C226.1 .9922 225.4 0 223.1 0S221 .9922 220.4 2.219L207.1 32L178.2 44.42C176.1 45.03 176 46.63 176 48c0 1.359 .9928 2.969 2.21 3.578L207.1 64zM399.1 191.1c8.875 0 15.1-7.127 15.1-16v-28l91.87-101.7c5.75-6.371 5.5-15.1-.4999-22.12L487.8 4.774c-6.125-6.125-15.75-6.375-22.12-.625L186.6 255.1H144c-8.875 0-15.1 7.125-15.1 15.1v36.88l-117.5 106c-13.5 12.25-14.14 33.34-1.145 46.34l41.4 41.41c12.1 12.1 34.13 12.36 46.37-1.133l279.2-309.5H399.1z"/></svg>
                        </button>

                        <button ${questionMarkDisabled ? 'disabled': ''} title="Mark red pixels in rectangle(s) as unpredictable${titleSuffix}" id="correctAsUnpredictable" class="${autoplay}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 6.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="M204.3 32.01H96c-52.94 0-96 43.06-96 96c0 17.67 14.31 31.1 32 31.1s32-14.32 32-31.1c0-17.64 14.34-32 32-32h108.3C232.8 96.01 256 119.2 256 147.8c0 19.72-10.97 37.47-30.5 47.33L127.8 252.4C117.1 258.2 112 268.7 112 280v40c0 17.67 14.31 31.99 32 31.99s32-14.32 32-31.99V298.3L256 251.3c39.47-19.75 64-59.42 64-103.5C320 83.95 268.1 32.01 204.3 32.01zM144 400c-22.09 0-40 17.91-40 40s17.91 39.1 40 39.1s40-17.9 40-39.1S166.1 400 144 400z"/></svg>                      
                        </button>

                        <button ${ironDisabled ? 'disabled': ''} title="Mark red pixels in rectangle(s) as anti-alias differences${titleSuffix}" id="correctAsAntiAlias" class="${autoplay}">
                            <svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
                                viewBox="0 0 489.962 489.962" style="enable-background:new 0 0 489.962 489.962;" xml:space="preserve">
                                    <path d="M486.8,248.733c-15.9-14.8-22.6-38.9-16.3-59.9c0.8-2.3,23.9-54.7-17.5-71.5c-31.7-7.8-52.5,5.4-57.9,10.9l-2-4.2
                                            l-36.6,21.8l-3.5-9.4c0,0-280.4,1.9-335.6,201.8h365.1l29.2-45.5l-44.4-118.8l40.4-23.3l-2.3-4.8c1.2-0.8,13.4-15.2,41.2-10.1
                                            c20,5.6,6.2,44.7,5.4,47.8c-8.2,28,0.4,59.9,21.8,79.7c1.9,1.9,7.8,5.1,13.6-0.4C491.1,258.433,490.7,252.533,486.8,248.733z
                                            M186.6,263.433c21-76.2,127.9-77,127.9-77l28.8,77H186.6z"/>
                                        <rect y="357.533" width="382.6" height="17.5"/>
                            
                            </svg>
                        </button>

                        <button ${checkDisabled ? 'disabled': ''} title="Mark red pixels/rectangles as correct${titleSuffix}" id="correctAsActual" class=" ${autoplay}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 6.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="M438.6 105.4C451.1 117.9 451.1 138.1 438.6 150.6L182.6 406.6C170.1 419.1 149.9 419.1 137.4 406.6L9.372 278.6C-3.124 266.1-3.124 245.9 9.372 233.4C21.87 220.9 42.13 220.9 54.63 233.4L159.1 338.7L393.4 105.4C405.9 92.88 426.1 92.88 438.6 105.4H438.6z"/></svg>
                        </button>

                        <button title="Clear Unpredictable Pixels" id="undo">
                            <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="undo"
                                class="svg-inline--fa fa-undo fa-w-16" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                                <path fill="currentColor"
                                d="M212.333 224.333H12c-6.627 0-12-5.373-12-12V12C0 5.373 5.373 0 12 0h48c6.627 0 12 5.373 12 12v78.112C117.773 39.279 184.26 7.47 258.175 8.007c136.906.994 246.448 111.623 246.157 248.532C504.041 393.258 393.12 504 256.333 504c-64.089 0-122.496-24.313-166.51-64.215-5.099-4.622-5.334-12.554-.467-17.42l33.967-33.967c4.474-4.474 11.662-4.717 16.401-.525C170.76 415.336 211.58 432 256.333 432c97.268 0 176-78.716 176-176 0-97.267-78.716-176-176-176-58.496 0-110.28 28.476-142.274 72.333h98.274c6.627 0 12 5.373 12 12v48c0 6.627-5.373 12-12 12z">
                                </path>
                            </svg>
                        </button>
 `;
                        src = this.next.pixelDiffScreenshot.dataUrl;
                        break;
                }
            }

            if (this.next._match === constants.match.ALLOW) {
                title.text += ` <span id='unpredictable-pixels'>&nbspHas unpredictable pixels.</span>`;
            }

            let classes = 'waiting';
            let screenshot = this.next.numDiffPixels && ({class: 'hasRedPixels'});
            html += this.next.toHtml({ 
                title: title, 
                src: src, 
                className: 'waiting', 
                stats: true,  
                screenshot: screenshot
            });
        }
        html += `
        </div>
        `;

        return html;
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
    /** @type {TestAction} */
    let action = test.steps[index];
    return { view, action };
}
