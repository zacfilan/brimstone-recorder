'use strict';
import { TestAction } from "./ui/card.js";
import { Screenshot } from "./ui/screenshot.js";
const PNG = png.PNG;
class Pixel {
    get red() {
        return this._bytes[0];
    }
    set red(to) {
        this._bytes[0] = to;
    }
    get green() {
        return this._bytes[1];
    }
    set green(to) {
        this._bytes[1] = to;
    }
    get blue() {
        return this._bytes[2];
    }
    set blue(to) {
        this._bytes[2] = to;
    }
    get alpha() {
        return this._bytes[3];
    }
    set alpha(to) {
        this._bytes[3] = to;
    }

    /**
     * 
     * @param {number} red red byte
     * @param {number} green green byte
     * @param {number} blue blue byte
     * @param {number} alpha alpha byte
     */
    constructor(red, green, blue, alpha) {
        this.red = red;
        this.green = green;
        this.blue = blue;
        this.alpha = alpha;
    }

    _bytes = [0, 0, 0, 0];
}

/**
 * A tuple of an expected and actual pixel.
 */
class PixelCondition {
    /**
     * The pixel from the expected screenshot.
     * @type {Pixel}
     */
    expected;
    /** 
     * The pixel from the actual screenshot.
     * @type {Pixel}
     */
    actual;

    /**
     * 
     * @param {PixelCondition} other 
     */
    constructor(other = {}) {
        this.expected = other.expected;
        this.actual = other.actual;
    }
}

/**
 * A orangle pixel. Used to represent unpredictable pixels.
 */
const orangePixel = new Pixel(255, 165, 0, 255);

/**
 * A rectangular region described un pixel units
 * */
export class BoundingBox {
    /** upper left x-coordinate */
    x0 = 0;
    /** upper left y-coordinate */
    y0 = 0;
    /** the width in pixels of the rectangle */
    width = 0;
    /** the height in pixels of the rectangle */
    height = 0;

    /** lower right x-coordinate */
    get x1() {
        return this.x0 + this.width;
    }

    /** lower right y-coordinate */
    get y1() {
        return this.y0 + this.height;
    }

    constructor(other = {}) {
        this.x0 = other.x0 || 0;
        this.y0 = other.y0 || 0;
        this.width = other.width || 0;
        this.height = other.height || 0;
    }
}

/**
 * Abstract base class for corrections. A correction has rectangular boundry 
 * which defines **where** this correction may be applicable. It also
 * has a boundary for the PNG, which defines the size of the PNGs this
 * correction applies to.
 * 
 * Concrete corrections will implement matches, and apply functions
 * to determine if the correction matches the current action and
 * to apply it (if it does match), respectively. 
 */
export class Correction {
    /**
     * The rectangular region this correction applies to.
     * If falsey, it applies to the whole image.
     * @type {BoundingBox}
     */
    bounds;

    /**
     * This correction only applys to PNGs of a certain size. This contains the width/height of those PNGs.
     * @type {BoundingBox}
    */
    applicablePngSize;

    /**
    * @param {object} args named arguments 
    * @param {BoundingBox} args.applicablePngSize the size of the PNG that this correction applies to
    * @param {BoundingBox} args.bounds the position of this correction within the PNG
    */
    constructor({ applicablePngSize, bounds }) {
        this.bounds = bounds;
        this.applicablePngSize = applicablePngSize;
    }
}

/** 
 * All the corrections that the user has created. 
 * @type {Correction[]}
*/
Correction.availableInstances = [];

/**
 * The corrections that apply to the current action
 * @type {Correction[]}
 */
Correction.applicableInstances = [];
/** The type of correction that the user makes when the actual pixels are correct. */

/** 
 * The type of correction that the user makes when the actual pixels are unpredictable.
 * The user defines a retangular region for the correction, which says that, 
 * this region is completely unpredictable run to run. e.g. a date/or time or advertisement div.
 *  */
export class UnpredictableCorrection extends Correction {
    /**
    * @param {object} args named arguments 
    * @param {BoundingBox} args.bounds the bounds of this correction
    * @param {TestAction} args.action the action this correction was constructed from
    */
    constructor({ bounds, action }) {
        let applicablePngSize = new BoundingBox({
            width: action.expectedScreenshot.png.width,
            height: action.expectedScreenshot.png.height
        });
        super({ bounds, applicablePngSize });
    }

    /**
     * Injects an orange rectangle into {@link TestAction.acceptablePixelDifferences action.acceptablePixelDifferences}
     * of the supplied action. This will be used later by {@link TestAction.calculatePixelDiff action.calculatePixelDiff}.
     * 
     * @param {TestAction} action the action this is being applied to 
     */
    apply(action) {
        if (!action.acceptablePixelDifferences) {
            action.acceptablePixelDifferences = new Screenshot({
                png: new PNG({
                    width: action.pixelDiffScreenshot.png.width,
                    height: action.pixelDiffScreenshot.png.height
                }),
                fileName: `step${action.index}_acceptablePixelDifferences.png`
            });
        }

        let png = action.acceptablePixelDifferences.png;
        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.applicablePngSize.width * y + x) << 2;
                png.data[idx + 0] = orangePixel._bytes[0];
                png.data[idx + 1] = orangePixel._bytes[1];
                png.data[idx + 2] = orangePixel._bytes[2];
                png.data[idx + 3] = orangePixel._bytes[3];
            }
        }
        if (this.bounds.y0 <= ymax && this.bounds.x0 <= xmax) {
            // we did poke some data.
            action.acceptablePixelDifferences.pngDataChanged();
        }
    }

    /**
    * Does this newer data match our condition?
    * For this condition to match it simply needs
    * to have 1 red pixel in the rectangular area.
    * No other preconditions. These might be too
    * powerful/general to auto-correct with.
    * @param {TestAction} action the testaction
    * 
     */
    matches(action) {
        let pngWidth = action.pixelDiffScreenshot.png.width;
        if (pngWidth != this.applicablePngSize.width) {
            return false;
        }

        let delta = action.pixelDiffScreenshot.png.data;

        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.applicablePngSize.width * y + x) << 2;

                let newPixelIsRed =
                    delta[idx + 1] === 0 &&
                    delta[idx + 0] == 255 &&
                    delta[idx + 2] === 0 &&
                    delta[idx + 3] === 255;
                if (newPixelIsRed) {
                    return true;
                }
            }
        }
        return false;
    }
}

/**
 * Abstract base class, for SpareApplyCorrections.
 * In contrast the to {@link UnpredictableCorrection} which is applied
 * by inserting a whole rectangle of new pixels, SparseApplyCorrections
 * apply just a subset of the pixels in the bounds of the correction.
 * e.g. just those that differ get replaced, one way or another.
 * Concrete classes muse implement  _applyToPixel(pixel, idx)
 * which detemines exactly how to replace the  
 */
export class SparseApplyCorrection extends Correction {
    /**
     * A sparse matrix of the expected/actual pixel tuples that
     *  make up the condition of this correction
     * The first index is x, the second index is y. 
     * 
     * e.g. pixelCondition[4]
     *   is a sparse array of the pixels in the vertical line x=4 in this correction.
     * @type {PixelCondition[][]}
     */
    pixelCondition = [];

    /** 
     * The number of the pixels in this correction that currently match 
     * This is used during auto-correction.*/
    matchingPixelCount = 0;

    /**
    * @param {object} args named arguments
    * @param {TestAction} args.action the action to build this correction from
    * @param {BoundingBox} args.bounds the bounds of the correction
    */
    constructor({ action, bounds }) {
        let applicablePngSize = new BoundingBox({
            width: action.expectedScreenshot.png.width,
            height: action.expectedScreenshot.png.height
        });
        super({ bounds, applicablePngSize });
        this.calculateCondition(action.expectedScreenshot.png, action.actualScreenshot.png, action.pixelDiffScreenshot.png);
    }

    /**
     * Build the sparse condition matrix ({@link pixelCondition})
     * from the passed in PNGs. The condition matrix is built from just
     * the failing (red) pixels, within the boundary of this condition.
     * @param {PNG} expectedPng the expected screenshot
     * @param {PNG} actualPng the actual screenshot
     * @param {PNG} deltaPng the screenshot showing the delta between the the two above. a red pixel is a delta. orange/yellow are unpredictable, greyscale fine.
     */
    calculateCondition(expectedPng, actualPng, deltaPng) {
        if (!(expectedPng.width === actualPng.width && actualPng.width === deltaPng.width)) {
            throw new Error("Widths do not match!");
        }

        this.pixelCondition = [];
        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.applicablePngSize.width * y + x) << 2;

                if (deltaPng.data[idx + 0] !== 255 ||
                    deltaPng.data[idx + 1] !== 0 ||
                    deltaPng.data[idx + 2] !== 0 ||
                    deltaPng.data[idx + 3] !== 255
                ) {
                    continue; // not a failing pixel 
                }

                // a failing pixel

                if (this.pixelCondition[x] === undefined) {
                    this.pixelCondition[x] = [];
                }
                let expected = new Pixel(
                    expectedPng.data[idx + 0],
                    expectedPng.data[idx + 1],
                    expectedPng.data[idx + 2],
                    expectedPng.data[idx + 3],
                );
                let actual = new Pixel(
                    actualPng.data[idx + 0],
                    actualPng.data[idx + 1],
                    actualPng.data[idx + 2],
                    actualPng.data[idx + 3],
                );
                this.pixelCondition[x][y] = new PixelCondition({
                    expected: expected,
                    actual: actual
                });
            }
        }
        console.debug(`Handled ${this.numberOfPixelConditions()} red pixels`);
    }

    /**
    * Does this newer data match our condition? This means the **whole rectangle** of the
    * correction condition matches the passed in action. 
    * @param {TestAction} action The test action
    */
    matches(action) {
        let delta = action.pixelDiffScreenshot.png.data;
        let expected = action.expectedScreenshot.png.data;
        let actual = action.actualScreenshot.png.data;

        if (action.expectedScreenshot.png.width !== this.applicablePngSize.width) {
            return false;
        }

        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        let redPixelFound = false;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.applicablePngSize.width * y + x) << 2;

                let newPixelIsRed =
                    delta[idx + 1] === 0 &&
                    delta[idx + 0] == 255 &&
                    delta[idx + 2] === 0 &&
                    delta[idx + 3] === 255;

                if (newPixelIsRed) {
                    redPixelFound = true;
                }
                let ourPixel = this.pixelCondition?.[x]?.[y]; // if this exists, then we think this pixel needs correction

                if (!!ourPixel !== !!newPixelIsRed) { // not same as bools
                    return false; // we don't agree this pixel needs correction.
                }

                if (!ourPixel && !newPixelIsRed) {
                    continue; // we both agree this pixel doesn't need correction.
                }

                // we both agree this pixel does need correction
                // is the pixel condition exactly the same?
                for (let i = 0; i < 4; ++i) {
                    if (ourPixel.expected._bytes[i] !== expected[idx + i]) {
                        return false;
                    }
                    if (ourPixel.actual._bytes[i] !== actual[idx + i]) {
                        return false;
                    }
                }
            }
        }
        return redPixelFound;
    }


    /**
     * Apply this sparse correction to the expectedScreenshot
     * PNG of the supplied action.
     *
     * Overwrites the expected pixels in this correction
     * with the actual pixels in this correction.
     * @param {TestAction} action The PNG to change. 
     */
    apply(action) {
        throw new Error("call dervied method!");
    }


    /**
    * This function is exected on each PixelCondition in this
    * correction.
    * @callback pixelCorrectionFunction
    * @param {PixelCondition} pixelCondition The of the current pixel.
    * @param {number} flatIndex The flat PNG data index of this pixel.
    * @returns {Screenshot} The screenshot that was altered.
    */

    /**
     * 
     * @param {pixelCorrectionFunction} foo the function that is applied to each pixel
     */
    _forEachPixel(foo) {
        /** @type {Screenshot} */
        let pngChanged = null;
        // Array.foEach will not call the callback on undefined
        // elements an array. Hence efficient, for sparse martrix.
        this.pixelCondition.forEach((vline, x_index) => {
            vline.forEach((pixel, y_index) => {
                var idx = (this.applicablePngSize.width * y_index + x_index) << 2;
                pngChanged = foo(pixel, idx);
            });
        });
        if(pngChanged) {
            pngChanged.pngDataChanged();
        }
    }

    /**
     * mostly for debug, but this counts the number of pixels in the sparse array
     */
    numberOfPixelConditions() {
        let count = 0;
        this.pixelCondition.forEach((vline, x_index) => {
            vline.forEach((pixel, y_index) => {
                ++count;
            });
        });
        return count;
    }
}

/**
 * Concrete correction. Use to correct, what appear to be anti-aliasing 
 * diferences.
 */
export class AntiAliasCorrection extends SparseApplyCorrection {
    /**
     * @param {object} args named arguments 
     * @param {TestAction} args.action the action this correction was constructed from
     */
    constructor({ bounds, action }) {
        let applicablePngSize = new BoundingBox({
            width: action.expectedScreenshot.png.width,
            height: action.expectedScreenshot.png.height
        });
        super({
            action: action,
            bounds: bounds,
            applicablePngSize
        });
    }

    /**
     * Poke the pixels in this correction into the acceptable
     * pixels screenshot as orange pixels.
     * @param {TestAction} action the action to apply this correction to.
     */
    apply(action) {
        if (action.expectedScreenshot.png.width !== this.applicablePngSize.width) {
            throw new Error("Bad width");
        }

        if (!action.acceptablePixelDifferences?.png) {
            action.acceptablePixelDifferences = new Screenshot({
                png: new PNG({
                    width: action.pixelDiffScreenshot.png.width,
                    height: action.pixelDiffScreenshot.png.height
                }),
                fileName: `step${action.index}_acceptablePixelDifferences.png`
            });
        }

        this._forEachPixel((pixelCondition, flatIndex) => {
            for (let b = 0; b < 4; ++b) {
                action.acceptablePixelDifferences.png.data[flatIndex + b] = orangePixel._bytes[b];
            }
            return action.acceptablePixelDifferences; // the png i am changing
        });
    }
}

/**
 * Concrete correction. Used to correct an area by overwriting the
 * expected pixels with the actual pixels.
 */
export class ActualCorrection extends SparseApplyCorrection {
    /**
    * @param {object} args named arguments 
    * @param {TestAction} args.action the action this correction was constructed from
    * /
    constructor({ bounds, action }) {
        let applicablePngSize = new BoundingBox({
            width: action.expectedScreenshot.png.width,
            height: action.expectedScreenshot.png.height
        });
        super({
            action: action,
            bounds: bounds,
            applicablePngSize
        });
    }

    /**
    * Poke the actual pixels from this correction into the expected
    * pixels screenshot.
    * @param {TestAction} action the action to apply this correction to.
    */
    apply(action) {
        if (action.expectedScreenshot.png.width !== this.applicablePngSize.width) {
            throw new Error("Bad width");
        }

        this._forEachPixel((pixelCondition, flatIndex) => {
            for (let b = 0; b < 4; ++b) {
                action.expectedScreenshot.png.data[flatIndex + b] = pixelCondition.actual._bytes[b];
            }
            return action.expectedScreenshot;
        });
    }
}

export class Rectangle {
    _coords = [];

    constructor({ x0 = 0, y0 = 0, x1 = 0, y1 = 0, container = null, type = '' }) {
        this._coords = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
        if (type) {
            type = `type="${type}"`;
        }

        const rectangle = $(`<div class="rectangle" ${type}></div>`)[0];
        (container ?? Rectangle.container).appendChild(rectangle);
        rectangle.addEventListener("mousedown", e => {
            if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                rectangle.remove();
            }
        });
        this.rectangle = rectangle;
        this.redraw();
    }

    get topLeftCoords() {
        return this._coords[0];
    }

    get bottomRightCoords() {
        return this._coords[1];
    }

    redraw() {
        const top = Math.min(this._coords[0].y, this._coords[1].y);
        const height = Math.max(this._coords[0].y, this._coords[1].y) - top;
        const left = Math.min(this._coords[0].x, this._coords[1].x);
        const width = Math.max(this._coords[0].x, this._coords[1].x) - left;
        this.rectangle.style.top = top + "px";
        this.rectangle.style.height = height + "px";
        this.rectangle.style.left = left + "px";
        this.rectangle.style.width = width + "px";
    };

}

Rectangle.container = document.body;
Rectangle._resizing = false;
Rectangle.setContainer = function (container, addCallback, delCallback) {
    Rectangle.container = container;
    container.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        Rectangle._resizing = new Rectangle({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    });

    container.addEventListener("mousemove", e => {
        if (Rectangle._resizing) {
            Rectangle._resizing._coords[1] = { x: e.clientX, y: e.clientY };
            Rectangle._resizing.redraw();
        }
    });

    container.addEventListener("mouseup", e => {
        if (e.button !== 0) return;
        if (Rectangle._resizing) {
            Rectangle._resizing._coords[1] = { x: e.clientX, y: e.clientY };
            Rectangle._resizing.redraw();
            addCallback({
                coords: Rectangle._resizing._coords
            }); // this one is now added, so callback
            Rectangle._resizing = null;
        }
    });

    container.addEventListener('click', e => {
        // don't let these bubble up - we own the mouse presently.
        e.stopPropagation();
        e.preventDefault();
        return false;
    });
};



