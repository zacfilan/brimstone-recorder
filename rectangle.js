'use strict';
import { TestAction } from './test.js';
import { Screenshot } from './ui/screenshot.js';
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

var littleEndian = (function () {
  var buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array uses the platform's endianness.
  return new Int16Array(buffer)[0] === 256;
})();

/**
 * An orangle pixel. Used to represent unpredictable pixels.
 *  R    G   B   A
 * 255, 165, 0 , 255
 *  ff   a5  00  ff
 */
const orangePixel = littleEndian ? 0xff00a5ff : 0xffa500ff;
const redPixel = 0xff0000ff; // same little or bug endian

/**
 * A rectangular region described un pixel units
 * */
export class BoundingBox {
  /** upper left x-coordinate (inclusive) */
  x0 = 0;
  /** upper left y-coordinate (inclusive) */
  y0 = 0;

  /** the width in pixels of the rectangle */
  width = 0;

  /** the height in pixels of the rectangle */
  height = 0;

  /** number of pixels in bounding box (width*height) */
  get len() {
    return this.width * this.height;
  }

  /** lower right x-coordinate (inclusive)*/
  get x1() {
    return this.x0 + this.width - 1;
  }

  /** lower right y-coordinate (inclusive) */
  get y1() {
    return this.y0 + this.height - 1;
  }

  constructor(other = {}) {
    this.x0 = other.x0 === undefined ? Number.MAX_SAFE_INTEGER : other.x0; // set up for accomodate if not specified
    this.y0 = other.y0 === undefined ? Number.MAX_SAFE_INTEGER : other.y0; // set up for accomodate if not specified
    this.width = other.width || 0;
    this.height = other.height || 0;
  }

  /**
   * Reconfigure this bounding box to accomodate the
   * given pixel
   * @param {} pixels
   */
  accomodate({ x, y }) {
    if (x < this.x0) {
      this.x0 = x; // smallest x we see is upper left x coordinate
    }
    if (x > this.x1) {
      this.width = x - this.x0 + 1; // bump up the x1
    }
    if (y < this.y0) {
      this.y0 = y; // smallest y we see is upper left y coordinate
    }
    if (y > this.y1) {
      this.height = y - this.y0 + 1; // bump up the y1
    }
    console.log(
      `${this.width}x${this.height}. ((${this.x0}, ${this.y0} to (${this.x1}, ${this.y1})) last:(${x},${y})`
    );
  }

  addMargin(margin) {
    this.x0 = Math.max(0, this.x0 - margin); // left - don't go negative
    this.y0 = Math.max(0, this.y0 - margin); // top - don't go negative

    // add some right and bottom margin
    this.width += margin * 2;
    this.height += margin * 2;
  }
}

/**
 * A boundingbox with pixel data in it.
 */
class Condition extends BoundingBox {
  /**
   * Sub - screenshot of the condition extracted from the pixel delta screenshot
   * @type {Screenshot}
   */
  screenshot;

  /**
   *
   * @param {Condition} other
   */
  constructor(other = {}) {
    super(other);
    this.png = new PNG(other.png);
  }
}

/**
 * Abstract base class for corrections. A correction contains
 * a {@link Condition} which is a subrectangle (within the context of a larger PNG)
 * of pixels that define when this Correction may be applied.
 *
 * Concrete corrections will implement an apply functions
 * to apply this correction in a particular way when it does
 * match some other action's pixel diff.
 */
export class Correction {
  /**
   * The condition that decides the applicability of this correction.
   * @type {Condition}
   */
  condition;

  /**
   * This correction only applys to PNGs of a certain size. This contains the width/height of those PNGs.
   * @type {BoundingBox}
   */
  applicablePngSize;

  /**
   * the byte offset of the start of this corrections pixels within the
   * larger PNG.
   */
  get byteOffset() {
    return (
      (this.applicablePngSize.width * this.condition.y0 + this.condition.x0) <<
      2
    );
  }

  /**
   * @param {object} args named arguments
   * @param {TestAction} args.action the test action we are creating this correction from
   * @param {Condition} args.condition the position of this correction within the PNG
   */
  constructor({ condition, action }) {
    this.applicablePngSize = new BoundingBox({
      width: action.expectedScreenshot.png.width,
      height: action.expectedScreenshot.png.height,
    });
    this.condition = new Condition(condition);
    this._calculateConditionScreenshot(
      action.expectedScreenshot.png,
      action.actualScreenshot.png,
      action.pixelDiffScreenshot.png
    );
  }

  /**
   * Returns true if this passed in action matches the condition for this correction.
   * @param {TestAction} action can I apply this correction to this action
   */
  matches(action) {
    let pixelDiffPng = action.pixelDiffScreenshot.png;

    if (pixelDiffPng.width !== this.applicablePngSize.width) {
      return false;
    }

    let pixels = this.condition.screenshot.getPixelsAsUint32Array();

    for (let y = 0; y < this.condition.height; ++y) {
      if (this.condition.y0 + y >= pixelDiffPng.height) {
        break; // ignore off by one type errors
      }
      //console.log(`write row ${y} -> ${this.condition.y0 + y}`);
      let pixelDiffPngRow = new Uint32Array(
        pixelDiffPng.data.buffer,
        ((this.condition.y0 + y) * pixelDiffPng.width) << 2,
        pixelDiffPng.width
      );
      let conditionRowOffset = y * this.condition.width;
      for (let x = 0; x < this.condition.width; ++x) {
        if (
          pixels[conditionRowOffset + x] !==
          pixelDiffPngRow[this.condition.x0 + x]
        ) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Build the ({@link Condition.screenshot})
   * from the passed in PNGs. Extracts a PNG from the
   * deltaPng using the condition dimensions/coordinates.
   *
   * @param {PNG} expectedPng the expected screenshot
   * @param {PNG} actualPng the actual screenshot
   * @param {PNG} deltaPng the screenshot showing the delta between the the two above. a red pixel is a delta. orange/yellow are unpredictable, greyscale fine.
   */
  _calculateConditionScreenshot(expectedPng, actualPng, deltaPng) {
    if (
      !(
        expectedPng.width === actualPng.width &&
        actualPng.width === deltaPng.width
      )
    ) {
      throw new Error('Widths do not match!');
    }

    this.condition.screenshot = new Screenshot({
      png: new PNG({
        width: this.condition.width,
        height: this.condition.height,
      }),
    });

    let pixels = this.condition.screenshot.getPixelsAsUint32Array(); //  this.condition.len);

    // extract the rectangle of pixels from the larger PNG by rows
    for (let y = 0; y < this.condition.height; ++y) {
      if (this.condition.y0 + y >= deltaPng.height) {
        break; // ignore off by one type errors
      }
      let bigRow = new Uint32Array(
        deltaPng.data.buffer,
        ((this.condition.y0 + y) * deltaPng.width) << 2,
        deltaPng.width
      );
      for (let x = 0; x < this.condition.width; ++x) {
        pixels[y * this.condition.width + x] = bigRow[this.condition.x0 + x];
      }
    }
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

/**
 * The type of correction that the user makes when all the pixels in the rectangle are unpredictable.
 * The user defines a retangular region for the correction, which says that,
 * this region is completely unpredictable run to run. e.g. a date/or time or advertisement div.
 *  */
export class UnpredictableCorrection extends Correction {
  /**
   * @param {object} args named arguments
   * @param {Condition} args.condition the condition of this correction
   * @param {TestAction} args.action the action this correction was constructed from
   */
  constructor({ condition, action }) {
    super({ condition, action });
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
          height: action.pixelDiffScreenshot.png.height,
        }),
        fileName: `step${action.index}_acceptablePixelDifferences.png`,
      });
    }

    let png = action.acceptablePixelDifferences.png;
    let ymax = this.condition.y0 + this.condition.height;
    let xmax = this.condition.x0 + this.condition.width;
    for (var y = this.condition.y0; y <= ymax; y++) {
      for (var x = this.condition.x0; x <= xmax; x++) {
        var idx = (this.applicablePngSize.width * y + x) << 2;
        // 0xffa500ff - orange
        png.data[idx + 0] = 255;
        png.data[idx + 1] = 165;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 255;
      }
    }
    if (this.condition.y0 <= ymax && this.condition.x0 <= xmax) {
      // we did poke some data.
      action.acceptablePixelDifferences.pngDataChanged();
    }
  }
}

/**
 * Concrete correction. Use to correct, what appear to be anti-aliasing
 * diferences.
 */
export class AntiAliasCorrection extends Correction {
  /**
   * @param {object} args named arguments
   * @param {TestAction} args.action the action this correction was constructed from
   * @param {Condition} args.condition the action this correction was constructed from
   */
  constructor({ condition, action }) {
    super({ action, condition });
  }

  /**
   * Poke the corresponding red pixel from the condition as orange
   * in the action.acceptablePixelDifferences.
   * @param {TestAction} action the action to apply this correction to.
   */
  apply(action) {
    if (action.expectedScreenshot.png.width !== this.applicablePngSize.width) {
      throw new Error('Bad width');
    }

    if (!action.acceptablePixelDifferences?.png) {
      action.acceptablePixelDifferences = new Screenshot({
        png: new PNG({
          width: action.pixelDiffScreenshot.png.width,
          height: action.pixelDiffScreenshot.png.height,
        }),
        fileName: `step${action.index}_acceptablePixelDifferences.png`,
      });
    }

    let pngChanged = false;
    let acceptableDifferencesPng = action.acceptablePixelDifferences.png;
    let pixels = this.condition.screenshot.getPixelsAsUint32Array();

    for (let y = 0; y < this.condition.height; ++y) {
      if (this.condition.y0 + y >= acceptableDifferencesPng.height) {
        break; // ignore off by one type errors
      }
      //console.log(`write row ${y} -> ${this.condition.y0 + y}`);
      let acceptableDifferencesRow = new Uint32Array(
        acceptableDifferencesPng.data.buffer,
        ((this.condition.y0 + y) * acceptableDifferencesPng.width) << 2,
        acceptableDifferencesPng.width
      );
      let conditionRowOffset = y * this.condition.width;
      for (let x = 0; x < this.condition.width; ++x) {
        if (pixels[conditionRowOffset + x] == redPixel) {
          pngChanged = true;
          acceptableDifferencesRow[this.condition.x0 + x] = orangePixel;
        } else {
          acceptableDifferencesRow[this.condition.x0 + x] =
            pixels[conditionRowOffset + x];
        }
      }
    }

    if (pngChanged) {
      action.acceptablePixelDifferences.pngDataChanged();
      action.dirty = true;
    }
  }
}

/**
 * Concrete correction. Used to correct an area by overwriting the
 * expected pixels with the actual pixels.
 */
export class ActualCorrection extends Correction {
  /**
   * @param {object} args named arguments
   * @param {TestAction} args.action the action this correction was constructed from
   */
  constructor({ condition, action }) {
    super({ action, condition });
  }

  /**
   * Poke all the pixels from the rectangle in the actual screenshot
   * into the the expected pixels screenshot.
   * @param {TestAction} action the action to apply this correction to.
   */
  apply(action) {
    if (action.expectedScreenshot.png.width !== this.applicablePngSize.width) {
      throw new Error('Bad width');
    }

    let expected = action.expectedScreenshot.png.data;
    let actual = action.actualScreenshot.png.data;
    let ymax = this.condition.y0 + this.condition.height;
    let xmax = this.condition.x0 + this.condition.width;
    for (var y = this.condition.y0; y <= ymax; y++) {
      for (var x = this.condition.x0; x <= xmax; x++) {
        var idx = (this.applicablePngSize.width * y + x) << 2;
        expected[idx + 0] = actual[idx + 0];
        expected[idx + 1] = actual[idx + 1];
        expected[idx + 2] = actual[idx + 2];
        expected[idx + 3] = actual[idx + 3];
      }
    }
    if (this.condition.y0 <= ymax && this.condition.x0 <= xmax) {
      // we did poke some data.
      action.expectedScreenshot.pngDataChanged();
    }
  }
}

export class Rectangle {
  _coords = [];

  constructor({
    x0 = 0,
    y0 = 0,
    x1 = 0,
    y1 = 0,
    container = null,
    type = '',
    classes = '',
  }) {
    this._coords = [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ];
    if (type) {
      type = `type="${type}"`;
    }

    const rectangle = $(`<div class="rectangle ${classes}"${type}></div>`)[0];
    let c = container ?? Rectangle.container;
    c.appendChild(rectangle);

    rectangle.addEventListener('mousedown', (e) => {
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

    let pTop = (100 * top) / Rectangle.container.offsetHeight;
    let pHeight = (100 * height) / Rectangle.container.offsetHeight;
    let pLeft = (100 * left) / Rectangle.container.offsetWidth;
    let pWidth = (100 * width) / Rectangle.container.offsetWidth;

    //    console.log(`pos: (${pLeft}%,${pTop}%) size: ${pWidth}%x${pHeight}%`);
    this.rectangle.style.top = pTop + '%';
    this.rectangle.style.height = pHeight + '%';
    this.rectangle.style.left = pLeft + '%';
    this.rectangle.style.width = pWidth + '%';
  }
}

Rectangle.container = document.body;
Rectangle._resizing = false;
Rectangle.setContainer = function (container, addCallback, delCallback) {
  Rectangle.container = container;
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    Rectangle._resizing = new Rectangle({
      x0: e.clientX - container.offsetLeft, // the clentX is the absolute x value of the mouse
      y0: e.clientY - container.offsetTop,
      x1: e.clientX - container.offsetLeft,
      y1: e.clientY - container.offsetTop,
      classes: 'manual',
    });
  });

  container.addEventListener('mousemove', (e) => {
    if (Rectangle._resizing) {
      Rectangle._resizing._coords[1] = {
        x: e.clientX - container.offsetLeft,
        y: e.clientY - container.offsetTop,
      };
      Rectangle._resizing.redraw();
    }
  });

  container.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (Rectangle._resizing) {
      Rectangle._resizing._coords[1] = {
        x: e.clientX - container.offsetLeft,
        y: e.clientY - container.offsetTop,
      };
      Rectangle._resizing.redraw();
      addCallback({
        coords: Rectangle._resizing._coords,
      }); // this one is now added, so callback
      Rectangle._resizing = null;
    }
  });

  container.addEventListener('click', (e) => {
    // don't let these bubble up - we own the mouse presently.
    e.stopPropagation();
    e.preventDefault();
    return false;
  });
};
