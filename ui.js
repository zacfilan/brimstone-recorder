import { Player } from "./playerclass.js"
const PNG = png.PNG;
const Buffer = buffer.Buffer;

// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);
const contentWindowId = parseInt(urlParams.get('parent'), 10);
const tabId = parseInt(urlParams.get('tab'), 10);
const player = new Player(contentWindowId, tabId);
var uiCardsElement = document.getElementById('cards');
var currentUrl;

/* Some globals */

/** This contains the in memory representation of all the steps that appear in the UI.
 * These are transformed into the test.json and screenshots in the zip file, and vice versa.
 * @type Card[] */
var cards = [];

var zip;

/** The parsed test.json object, this will change in memory during use.
 * It represents the recorded user actions, and optionally the result
 * of playing them back. 
 * 
*/

/** Fixme not used. The struct returned from the content script is used directly  */
class UserEvent {
    /** A string identifier of the type of event, 'click', 'change' , ... */
    type = '';
}

/** Fixme not used */
class UserAction extends UserEvent {
    /** The y-offset of the element the event occurred on */
    clientX = 0;
    /** The x-offset of the element this event occured on */
    clientY = 0;
}

class Step {
    constructor(args = {}) {
        Object.assign(this, args);
        if (!this.status) {
            this.status = 'recorded';// // see ui.css
        }
    }
}
Step.instancesCreated = 0;

class ScreenshotStep extends Step {
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

class FailedStep extends Step {
    constructor(args = {}) {
        super(args);
        this.status = 'failed';
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
    async addMask() {
        if (!this.acceptablePixelDifferences) {
            this.acceptablePixelDifferences = {};
        }
        this.acceptablePixelDifferences.dataUrl = this.diffDataUrl;
        this.acceptablePixelDifferences.fileName = `step${this.index}_acceptablePixelDifferences.png`;
    }

    /** (Re)calculate the difference between the expected screenshot
    * and the actual screenshot, then apply mask
    */
    async pixelDiff() {
        let { png: expectedPng } = await Player.dataUrlToPNG(this.expectedScreenshot.dataUrl);
        let { png: actualPng } = await Player.dataUrlToPNG(this.actualScreenshot.dataUrl);
        let acceptableErrorsPng;
        if (this.acceptablePixelDifferences?.dataUrl) {
            acceptableErrorsPng = (await Player.dataUrlToPNG(this.acceptablePixelDifferences.dataUrl)).png;
        }
        let { numDiffPixels, numMaskedPixels, diffPng } = Player.pngDiff(expectedPng, actualPng, acceptableErrorsPng);

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
              <div class='card'>
                  <div class='title'>[${this.index}]: Difference (red pixels). ${this.numDiffPixels} pixels, ${this.percentDiffPixels}% different</div>
                  <div class='screenshot'>
                      <img src='${this.diffDataUrl}'>
                  </div>
                  <div class='user-events'>
                      <button class="ignore">Ignore</button>
                  </div>
              </div>
          </div>`;
        return html;
    }
}

function getStep(element) {
    let view = $(element).closest('.step');
    let index = view.attr('data-index');
    let model = cards[index];
    return { view, model };
}

function getCard(element) {
    let view = $(element).closest('.card');
    let index = view.attr('data-index');
    let model = cards[index];
    return { view, model };
}

$('#content').on('click', 'button.ignore', async function (e) {
    // add a mask to the 
    const { model } = getStep(e.currentTarget);
    await model.addMask();
    await updateStepInView(model);
});

$('#cards').on('click', '.thumb', async function (e) {
    const { model } = getCard(e.currentTarget);
    await setContentStep(model);
});

$('#content').on('click', '.screenshot.clickable', function (e) {
    // flip the image
    const { view, model } = getCard(e.currentTarget);
    if (view.hasClass('expected')) {
        view.removeClass('expected').addClass('actual');
        view.find('img').attr('src', model.actualScreenshot.dataUrl);
        view.find('.title').text(`[${model.index}]: Actual current screen (click image to toggle)`);
    }
    else {
        view.removeClass('actual').addClass('expected');
        view.find('img').attr('src', model.expectedScreenshot.dataUrl);
        view.find('.title').text(`[${model.index}]: Expected current screen (click image to toggle)`);
    }
});

class TextStep extends Step {
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

/** highlist the element that was acted on in the screenshot
 * when the user hovers over the text of a user-event
 */
$('#content').on('mouseenter mouseleave', '.user-event[data-index]', function (e) {
    $(`.overlay[data-index='${e.target.dataset.index}']`).toggle();
});

async function injectOnNavigation(obj) {
    console.log('GOT NAV in Recording Window', obj);
    if (obj.url !== currentUrl) {
        currentUrl = obj.url;
        await injectScript(obj.url);
    }
}

$('#playButton').on('click', async () => {
    stopRecording();
    try {
        cards.forEach(card => {
            card.status = 'notrun';
            updateStepInView(card);
        });
        player.onBeforePlay = updateStepInView;
        player.onAfterPlay = updateStepInView;
        await player.play(cards,); // players gotta play...
    }
    catch (e) {
        if (e?.message !== 'screenshots do not match') {
            throw e;
        }
        await updateStepInView(e.failingStep); // update the UI with the pixel diff information
    }
});

$('#endRecordingButton').on('click', async () => {
    stopRecording();
    let action = await userEventToAction(userEvent);
    await updateStepInView(action);
});

function setIconState(state) {
    switch(state) {
        case 'recording':
            // chrome.action.setIcon({imageData: imageData}, () => { ... });
            chrome.action.setBadgeBackgroundColor(
                 {color: [255, 0, 0, 255]}
            );
            chrome.action.setBadgeText({
                text: 'R'
            });
            chrome.action.setTitle({
                title: 'Brimstone is recording user actions on this tab.'
            });
            break;
        case 'playing':
            chrome.action.setBadgeBackgroundColor(
                {color: [0, 255, 0, 255]}
           );
           chrome.action.setBadgeText({
               text: 'P'
           });
           chrome.action.setTitle({
               title: 'Brimstone is playing previously recorded user actions on this tab.'
           });
           break;
        case 'editing':
            chrome.action.setBadgeBackgroundColor(
                {color: [0, 0, 0, 0]}
           );
           chrome.action.setBadgeText({
               text: 'E'
           });
           chrome.action.setTitle({
               title: 'Brimstone is ready to record or play back pre-recorded user actions.'
           });
           break;
    }
}

$('#recordButton').on('click', async () => {
    await chrome.windows.update(contentWindowId, { focused: true });
    chrome.tabs.update(tabId, {
        highlighted: true,
        active: true
    });

    zip = new JSZip();
    let tab = await chrome.tabs.get(tabId);

    // No screenshots for this first one (the first user action determines state that identifies when this is done)
    let userEvent = {
        type: 'start', // start recording
        url: tab.url,
        tabHeight: tab.height,
        tabWidth: tab.width
    };
    let action = await userEventToAction(userEvent);
    await updateStepInView(action);
    await replaceOnConnectListener(tab.url);
    // I only care about navigation if I am recording
    chrome.webNavigation.onCompleted.addListener(injectOnNavigation);
    await player.attachDebugger();

    // set the icon state to recording
    //setIconState('recording');
});

function stopRecording() {
    // tell the endpoint to stop recording
    try {
        postMessage({ type: 'stop' });
        port.disconnect();
    }
    catch { }
    chrome.webNavigation.onCompleted.removeListener(injectOnNavigation);
}

$('#clearButton').on('click', async () => {
    stopRecording();
    Step.instancesCreated = 0;

    // remove the cards
    cards = [];
    $('#cards').empty();
});

function postMessage(msg) {
    console.log('TX', msg);
    port.postMessage(msg);
}

$('#saveButton').on('click', async () => {
    console.log('create zip');
    zip = new JSZip();
    zip.file('test.json', JSON.stringify({ steps: cards }, null, 2)); // add the test.json file to archive
    var screenshots = zip.folder("screenshots"); // add a screenshots folder to the archive
    // add all the expected screenshots to the screenshots directory in the archive
    for (let i = 0; i < cards.length; ++i) {
        let card = cards[i];
        if (card.expectedScreenshot) {
            let response = await fetch(card.expectedScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.expectedScreenshot.fileName, blob, { base64: true });
        }
        if (card.actualScreenshot) {
            let response = await fetch(card.actualScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.actualScreenshot.fileName, blob, { base64: true });
        }
        if (card.acceptablePixelDifferences) {
            let response = await fetch(card.acceptablePixelDifferences.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.acceptablePixelDifferences.fileName, blob, { base64: true });
        }
    }

    console.log('save zip to disk');
    let blob = await zip.generateAsync({ type: "blob" });
    const handle = await window.showSaveFilePicker({
        suggestedName: `test.zip`,
        types: [
            {
                description: 'A ZIP archive that can be run by Brimstone',
                accept: { 'application/zip': ['.zip'] }
            }
        ]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);  // Write the contents of the file to the stream.    
    await writable.close(); // Close the file and write the contents to disk.
});

$('#loadButton').on('click', async () => {
    stopRecording();

    let [fileHandle] = await window.showOpenFilePicker({
        suggestedName: `test.zip`,
        types: [
            {
                description: 'A ZIP archive that can be run by Brimstone',
                accept: { 'application/zip': ['.zip'] }
            }
        ]
    });
    const blob = await fileHandle.getFile();
    zip = await (new JSZip()).loadAsync(blob);
    let screenshots = await zip.folder('screenshots');
    let test = JSON.parse(await zip.file("test.json").async("string"));

    let userEvents = test.steps;

    for (let i = 0; i < userEvents.length; ++i) {
        let userEvent = userEvents[i];
        await updateStepInView(userEvent);
    }

});

async function injectScript(url) {
    console.log(`injecting script into ${url}`);

    await (new Promise(resolve => chrome.storage.sync.set({ injectedArgs: { url } }, resolve)));
    await (new Promise(resolve => chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-recorder.js']
    }, resolve)));

    // (injectionResults) => {
    //     for (const frameResult of injectionResults)
    //         console.log('Injected script returns: ' + frameResult.result);
    // }
    //     );
    // });
}

var port = false;
function setContentStep(step) {
    let $step = $(step.toHtml());
    $('#content .step').replaceWith($step); // the big card
};
/** The raw user action triggers an event which comes from the recording proess as a 'userEvent'. The userEvent is annotated 
 * into an action. The 'action' is passed into a particular 'step' generator, which is then
 * rendered in the UI. */
async function updateStepInView(action) {
    let step = new Step(action); // make sure it has a step number

    if (step.actualScreenshot) {
        let screenshots = zip.folder('screenshots');
        // this step failed - we need to generate the diff
        if (!step.expectedScreenshot.dataUrl) {
            step.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.expectedScreenshot.fileName).async('base64');
        }
        if (!step.actualScreenshot.dataUrl) {
            step.actualScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.actualScreenshot.fileName).async('base64');
        }
        if (step.acceptablePixelDifferences && !step.acceptablePixelDifferences.dataUrl) {
            step.acceptablePixelDifferences.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.acceptablePixelDifferences.fileName).async('base64');
        }

        step = new FailedStep(step);
        await step.pixelDiff();
    }
    else {
        let screenshots = zip.folder('screenshots');
        if (step.expectedScreenshot) {
            if (!step.expectedScreenshot.dataUrl) {
                step.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.expectedScreenshot.fileName).async('base64');
            }
            step = new ScreenshotStep(step);
        }
        else {
            step = new TextStep(step);
        }
    }


    setContentStep(step);
    let $thumb = $(step.toThumb()); // smaller view

    if (cards[step.index]) {
        // replace
        $(`#cards .card[data-index=${step.index}]`).replaceWith($thumb);
        let c = $(`#cards .card[data-index=${step.index}]`);
        if (c.length) {
            $('#cards').scrollLeft(c.position().left);
        }
    }
    else {
        uiCardsElement.appendChild($thumb[0]);
    }
    cards[step.index] = step;
}

async function addScreenshot(step) {
    let { dataUrl } = await takeScreenshot();
    step.expectedScreenshot = { dataUrl, fileName: `step${step.index}_expected.png` };
}

/** 
 * This is only used during recording. It update the zip file.
 * 
 * Process a user event received from the content script (during recording)
 * screenshot, annotate event and convert to card
 */
async function userEventToAction(userEvent) {
    let cardModel = userEvent; // start with the user event and convert to a cardModel (by adding some properties)
    cardModel.index = Step.instancesCreated++;

    let tab = await chrome.tabs.get(tabId);
    let element = userEvent.boundingClientRect;
    cardModel.tabHeight = tab.height;
    cardModel.tabWidth = tab.width;

    if (element) {
        cardModel.overlay = {
            height: `${element.height * 100 / tab.height}%`,
            width: `${element.width * 100 / tab.width}%`,
            top: `${element.top * 100 / tab.height}%`,
            left: `${element.left * 100 / tab.width}%`
        };
    }

    switch (userEvent.type) {
        case 'keypress':
            cardModel.description = `type ${userEvent.event.key} at location (${userEvent.x}, ${userEvent.y})`;
            await addScreenshot(cardModel);
            break;
        case 'click':
            cardModel.description = `click at location (${userEvent.x}, ${userEvent.y})`;
            await addScreenshot(cardModel);
            break;
        case 'stop':
            cardModel.description = 'stop recording';
            await addScreenshot(cardModel);
            break;
        case 'start': {
            cardModel.description = `start recording from ${cardModel.url}`;
            break;
        }
        default:
            cardModel.description = 'Unknown!';
            break;
    }
    return cardModel;
}

async function takeScreenshot() {
    let dataUrl = await chrome.tabs.captureVisibleTab(contentWindowId, {
        format: 'png'
    });
    console.log('\t\tscreenshot taken');
    //let response = await fetch(dataUrl);
    return {
        //blob: await response.blob(),
        dataUrl
    };
}

/** Set up  */
async function replaceOnConnectListener(url) {
    chrome.runtime.onConnect.addListener(function (_port) { // wait for a connect
        port = _port; // make it global
        // contentPort.onDisconnect.addListener(function(port) {
        //     replaceOnConnectListener(); // listen again for the next connection
        // });
        console.log('PORT CONNECTED', port);
        port.onMessage.addListener(async function (userEvent) {
            console.log(`RX: ${userEvent.type}`, userEvent);
            let action;
            switch (userEvent.type) {
                case 'click':
                case 'keypress':
                    // update the UI with a screenshot
                    action = await userEventToAction(userEvent);
                    await updateStepInView(action);

                    // Now simulate that event back in the recording, via the CDP
                    await player[userEvent.type](userEvent);

                    postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
                    break;
                case 'hello':
                    console.log('got a new hello msg from injected content script');
                    break;
                default:
                    console.error(`unexpected userEvent received <${userEvent.type}>`);
                    break;
            }
        });
    });
    await injectScript(url); // inject a content script that will connect
}


// chrome.webNavigation.onBeforeNavigate.addListener(function (obj) {
//     console.log('before nav disconnect', obj);
//     port.postMessage({ type: 'disconnect' });
// });

// /**
//  * Injected into the app to store the screenshot into localstorage for the current domain
//  * @param {string} dataUrl Base64 encoded image
//  */
//  function writeScreenShotToLocalStorage(dataUrl) {
//     // content scripts can access chrome storage API, https://developer.chrome.com/docs/extensions/reference/storage/
//     // this is used to "pass arguments" from the popup context into function injeted into the webpage context
//     chrome.storage.local.get(['brimstoneScreenshot'],
//         (entry) => localStorage.setItem('brimstoneScreenshot', entry.brimstoneScreenshot));
// }

// REFERENCES
// Getting started with an extension
//    https://developer.chrome.com/docs/extensions/mv3/getstarted/
// headless recorder chrome extension
//    https://chrome.google.com/webstore/detail/headless-recorder/djeegiggegleadkkbgopoonhjimgehda?hl=en
// Chrome extension APIs 
//     https://developer.chrome.com/extensions/tabs#method-captureVisibleTab
// HTML5 fetch
//     https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
//     https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch
// HTML5 file system access
//     https://web.dev/file-system-access/ 
//     https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
// Webpack
//     https://webpack.js.org/
// adm-zip
//     https://www.npmjs.com/package/adm-zip