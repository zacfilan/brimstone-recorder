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
* A set of pixels from the expected screenshot that did not match, 
* and the correspnding set from actual screenshot that was used to replace them. 
* These two sets together are the condition of the correction. The later actual 
* set is also called the fix. The fix from a correct can be automatically applied
* later. When auto-correction is enabled, when a fail occurs, each correction's 
* condition is evaluated against the current step. If the condition exactly 
* matches, then the fix is applied. Corrections expire when a different test is
 loaded or the current one is cleared. 
 */
export class Correction {
    /**
     * The rectangular region this correction applies to.
     * If falsey, it applies to the whole image.
     * @type {BoundingBox}
     */
    bounds;

    /**
    * @param {Correction} other 
    */
    constructor(other = {}) {
        this.bounds = other.bounds;
    }

    /**
     * Apply this correction to the supplied PNG.
     * @param {PNG} png The PNG to change. 
     */
    apply(png) {
        throw new Error("Not implemented");
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


/** The type of correction that the user makes when the actual pixels are unpredictable. */
export class UnpredictableCorrection extends Correction {
    /**
    * @param {UnpredictableCorrection} other 
    */
    constructor(other = {}) {
        super(other);
    }

    /**
     * Apply this correction to the supplied PNG.
     * Injects an organge rectangle into the PNG.
     * @param {PNG} png The PNG to change. 
     */
    apply(png) {
        if (png.width !== this.conditionWidth) {
            throw new Error("Bad width");
        }

        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.conditionWidth * y + x) << 2;
                png.data[idx + 0] = orangePixel._bytes[0];
                png.data[idx + 1] = orangePixel._bytes[1];
                png.data[idx + 2] = orangePixel._bytes[2];
                png.data[idx + 3] = orangePixel._bytes[3];
            }
        }
    }

    /**
    * Does this newer data match our condition?
    * For this condition to match it simply needs
    * to have 1 red pixel in the rectangular area.
    * No other preconditions. These might be too
    * powerful/general to auto-correct with.
     */
    matches(action) {
        let delta = action.lastVerifyScreenshotDiffPng.data;

        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.conditionWidth * y + x) << 2;

                let newPixelIsRed =
                    delta[idx + 1] === 0 &&
                    delta[idx + 0] == 255 &&
                    delta[idx + 2] === 0 &&
                    delta[idx + 3] === 255; 
                if(newPixelIsRed) {
                    return true;
                }
            }
        }
        return false;
    }
}

/** The type of correction that the user makes when the actual pixels are correct. */
export class ActualCorrection extends Correction {
    /**
     * A sparse matrix of the expected/actual pixel tuples that
     *  make up the condition of this correctio
     * The first index is x, the second index is y. 
     * 
     * e.g. pixelCondition[4]
     *   is a sparse array of the pixels in the vertical line x=4 in this correction.
     * @type {PixelCondition[][]}
     */
    pixelCondition = [];

    /**
     * when setting the condition from some pngs we should lock in the png width
     */
    conditionWidth = 0;

    /** 
     * The number of the pixels in this correction that currently match 
     * This is used during auto-correction.*/
    matchingPixelCount = 0;

    /**
    * Does this newer data match our condition?
    */
    matches(action) {
        let delta    = action.lastVerifyScreenshotDiffPng.data;
        let expected = action.expectedScreenshot.png.data;
        let actual   = action.actualScreenshot.png.data;

        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.conditionWidth * y + x) << 2;

                let newPixelIsRed =
                    delta[idx + 1] === 0 &&
                    delta[idx + 0] == 255 &&
                    delta[idx + 2] === 0 &&
                    delta[idx + 3] === 255;

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
        return true;
    }

    /**
    * @param {ActualCorrection} other 
    */
    constructor(other = {}) {
        super(other);
    }

    /**
    * Build the sparse condition matrix from the 
    * expected and actual pngs passed in.
    * @param {PNG} expectedPng 
    * @param {PNG} actualPng 
    */
    setCondition(expectedPng, actualPng, deltaPng) {
        if (!(expectedPng.width === actualPng.width && actualPng.width === deltaPng.width)) {
            throw new Error("Widths do not match!");
        }
        this.conditionWidth = expectedPng.width;
        this.pixelCondition = this.calculateCondition(expectedPng, actualPng, deltaPng);
        return this; // fluent
    }

    /**
     * Build the sparse condition matrix from the 
     * expected and actual pngs passed in.
     * @param {PNG} expectedPng 
     * @param {PNG} actualPng 
     */
    calculateCondition(expectedPng, actualPng, deltaPng) {
        let pixelCondition = [];
        let ymax = this.bounds.y0 + this.bounds.height;
        let xmax = this.bounds.x0 + this.bounds.width;
        for (var y = this.bounds.y0; y <= ymax; y++) {
            for (var x = this.bounds.x0; x <= xmax; x++) {
                var idx = (this.conditionWidth * y + x) << 2;

                if (deltaPng.data[idx + 0] !== 255 ||
                    deltaPng.data[idx + 1] !== 0 ||
                    deltaPng.data[idx + 2] !== 0 ||
                    deltaPng.data[idx + 3] !== 255
                ) {
                    continue; // not a failing pixel 
                }

                // a failing pixel

                if (pixelCondition[x] === undefined) {
                    pixelCondition[x] = [];
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
                pixelCondition[x][y] = new PixelCondition({
                    expected: expected,
                    actual: actual
                });
            }
        }
        console.debug(`Handled ${this.numberOfPixelConditions()} red pixels`);
        return pixelCondition;
    }

    /**
     * Apply this sparse correction to the supplied PNG.
     * Overwrites the expected pixels in this correction
     * with the actual pixels in this correction.
     * @param {PNG} png The PNG to change. 
     */
    apply(png) {
        if (png.width !== this.conditionWidth) {
            throw new Error("Bad width");
        }
        // Array.foEach will not call the callback on undefined
        // elements an array. Hence efficient, for sparse martrix.
        this.pixelCondition.forEach((vline, x_index) => {
            vline.forEach((pixel, y_index) => {
                var idx = (this.conditionWidth * y_index + x_index) << 2;
                png.data[idx + 0] = pixel.actual._bytes[0];
                png.data[idx + 1] = pixel.actual._bytes[1];
                png.data[idx + 2] = pixel.actual._bytes[2];
                png.data[idx + 3] = pixel.actual._bytes[3];
            });
        });
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

export class Rectangle {
    _coords = [];

    constructor({ x0 = 0, y0 = 0, x1 = 0, y1 = 0, container = null }) {
        this._coords = [{ x: x0, y: y0 }, { x: x1, y: y1 }];
        const rectangle = document.createElement("div");
        rectangle.classList.add('rectangle');
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



