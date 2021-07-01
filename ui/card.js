import { Player } from "../playerclass.js"
const PNG = png.PNG;

/** This contains the in memory representation of all the steps that appear in the UI.
 * These are transformed into the test.json and screenshots in the zip file, and vice versa.
 * @type Card[] */
export var cards = [];

export function clearCards() {
    cards = [];
}

/** 
 * A step contains 2 cards. The first is the action card, which is the card that shows what the screen looks like,
 * along with what the user is trying to do. The second card is the result card. This is used to show what the screen looks
 * like when this action is completed. 
 */
export class Step {
    constructor(args = {}) {
        Object.assign(this, args);
        if (!this.status) {
            this.status = 'recorded';// // see ui.css
        }
    }
}
Step.instancesCreated = 0;

export class ScreenshotStep extends Step {
    constructor(args = {}) {
        super(args);
    }

    toJSON() {
        let clone = Object.assign({}, this);
        clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        return clone;
    }

    toThumb() {
        return `
        <div class='card ${this.status} thumb' data-index=${this.index}>
            <img draggable='false' src='${this.expectedScreenshot.dataUrl}'>
        </div>`;
    }

    toHtml() {
        let o = this.overlay;
        let html = `
        <div class='step' data-index=${this.index}>
          <div class='card ${this.status}' data-index=${this.index}>
              <div class='title'>[${this.index}]</div>
              <div class='screenshot'>
                  <img draggable='false' class='expected' src='${this.expectedScreenshot.dataUrl}'>`;
        if (this.overlay) {
            let o = this.overlay;
            html += `<div class='overlay' data-index=${this.index} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>`;
        }
        html += `
              </div>
              <div class='user-events'>
                  <div class='user-event' data-index='${this.index}'>next action: ${this.description}</div>
              </div>
            </div>
        </div>`;
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

export class FailedStep extends Step {
    constructor(args = {}) {
        super(args);
        this.status = 'failed';

        /** 
         * This is what will be shown when the card is rendered in the UI. It is not persisted. 
         * When loaded it is set. When played it can be set.
        */
        this.diffDataUrl;
    }
    //        this.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await zip.file(this.expectedScreenshot.fileName).async('base64');

    toJSON() {
        let clone = Object.assign({}, this);
        clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        clone.actualScreenshot = { fileName: this.actualScreenshot.fileName }; // delete the large dataUrl when serializing
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
            this.status = 'corrected';
        }
    }

    toThumb() {
        return `
        <div class='card ${this.status} thumb' data-index=${this.index}>
            <img draggable='false' src='${this.expectedScreenshot.dataUrl}'>
        </div>`;
    }

    toHtml() {
        let o = this.overlay;
        let html = `
          <div class='step ${this.status}' data-index=${this.index}>
              <div class='card expected ${this.status}' data-index=${this.index}>
                  <div class='title'>[${this.index}]: Expected current screen (click image to toggle)</div>
                  <div class='screenshot clickable'>
                      <img src='${this.expectedScreenshot.dataUrl}'>`;
        if (o) {
            html += `<div class='overlay' data-index=${this.index} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>`;
        }
        html += `
                  </div>
                  <div class='user-events'>
                      <div class='user-event' data-index='${this.index}'>next action: ${this.description}</div>
                  </div>
              </div>
              <div class='card pixel-differences' data-index=${this.index}>
                  <div class='title'>[${this.index}]: Difference (red pixels). ${this.numDiffPixels} pixels, ${this.percentDiffPixels}% different</div>
                  <div class='screenshot'>
                      <img src='${this.diffDataUrl}'>
                  </div>
                  <div class='user-events'>
                      <span>
                        <button class="ignore">Ignore</button>
                        <button class="volatile">Volatile</button>
                       </span>
                  </div>
              </div>
          </div>`;
        return html;
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
    let model = cards[index];
    return { view, model };
}

export class TextStep extends Step {
    constructor(args = {}) {
        super(args);
    }

    toThumb() {
        return `
            <div class='card {this.status} thumb' data-index=${this.index}'>
            </div>`;
    }

    toHtml() {
        let oHtml = `
        <div class='step' data-index=${this.index}>
          <div class='card ${this.status}'>
              <div class='title'>[${this.index}]</div>
              <div class='screenshot'>
              </div>
              <div class='user-events'>
                  <div class='user-event'>${this.description}</div>
              </div>
          </div>
        </div>`;
        return oHtml;
    }
}