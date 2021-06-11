import { uuidv4 } from "./uuidv4.js"
import { Rectangle } from "./rectangle.js"
import { pixelmatch } from "./pixelmatch.js"

const PNG = png.PNG;
const Buffer = buffer.Buffer;

// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);
const contentWindowId = parseInt(urlParams.get('parent'), 10);
const tabId = parseInt(urlParams.get('tab'), 10);
var uiCardsElement = document.getElementById('cards');
/** @type Card[] */
var cards = [];
var currentUrl;

// the last screen shot we took
var lastScreenshot;

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

class Card {
    constructor(args = {}) {
        Object.assign(this, args);
        this.step = Card.instancesCreated++;
    }
}
Card.instancesCreated = 0;

class ScreenshotCard extends Card {
    constructor(args = {}) {
        super(args);
    }

    toJSON() {
        let clone = Object.assign({}, this);
        clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
        return clone;
    }

    toHtml() {
        let o = this.overlay;
        let html = `
          <div class='card'>
              <div class='screenshot'>
                  <img draggable='false' class='expected' src='${this.expectedScreenshot.dataUrl}'>`;
        if (this.overlay) {
            let o = this.overlay;
            html += `<div class='overlay' data-uid=${this.uid} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>`;
        }
        html += `
              </div>
              <div class='user-events'>
                  <div class='user-event' data-uid='${this.uid}'>next action: ${this.description}</div>
              </div>
          </div>`;
        return html;
    }

    addScreenshot(screenshot) {
        let fileName = `step${this.step}_expected.png`;
        this.expectedScreenshot = { fileName: `${fileName}`, dataUrl: screenshot.dataUrl };
    }
}

class FailedStepCard extends Card {
    constructor(args = {}) {
        super(args);
    }
    //        this.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await zip.file(this.expectedScreenshot.fileName).async('base64');

    addMask() {
        console.log('i hear you!');
    }

     /** (Re)calculate the differance between the expected screenshot
     * and the actual screenshot, then apply mask
     */
    pixelDiff() {
        const img1 = PNG.sync.read(Buffer.from(this.expected_uint8array));
        var img2 = PNG.sync.read(Buffer.from(this.actual_uint8array));
        const { width, height } = img1;
        if (img2.width !== width || img2.height !== height) {
            img2 = new PNG({ width, height });
        }

        let diff = new PNG({ width, height });

        this.numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.5 });
        let UiPercentDelta = (this.numDiffPixels * 100) / (width * height);
        this.percentDiffPixels = UiPercentDelta.toFixed(2);

        this.diffDataUrl = 'data:image/png;base64,' + PNG.sync.write(diff).toString('base64');
    }

    toHtml() {
        let o = this.overlay;
        let html = `
          <div class='failed-step'>
              <div class='card fail expected' data-uid=${this.uid}>
                  <div class='title'>Expected current screen (click image to toggle)</div>
                  <div class='screenshot'>
                      <img src='${this.expectedScreenshot.dataUrl}'>
                      <div class='overlay' data-uid=${this.uid} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>
                  </div>
                  <div class='user-events'>
                      <div class='user-event' data-uid='${this.uid}'>next action: ${this.description}</div>
                  </div>
              </div>
              <div class='card'>
                  <div class='title'>Difference (red pixels). ${this.numDiffPixels} pixels, ${this.percentDiffPixels}% different</div>
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

function getCard(element) {
    let view = $(element).closest('.card');
    let uid = view.attr('data-uid');
    let model = cards.find(card => card.uid === uid);
    return { view, model };
}

$('#cards').on('click', 'button.ignore', function (e) {
    // add a mask to the 
    const { model } = getCard(e.urrentTarget);
    model.addDiffMask();
});

$('#cards').on('click', '.card.fail .screenshot', function (e) {
    // flip the image
    const { view, model } = getCard(e.urrentTarget);
    if (view.hasClass('expected')) {
        view.removeClass('expected').addClass('actual');
        view.find('img').attr('src', model.actualScreenshot.dataUrl);
        view.find('.title').text('Actual current screen (click image to toggle)');
    }
    else {
        view.removeClass('actual').addClass('expected');
        view.find('img').attr('src', model.expectedScreenshot.dataUrl);
        view.find('.title').text('Expected current screen (click image to toggle)');
    }
});

class TextCard extends Card {
    constructor(args = {}) {
        super(args);
    }

    toHtml() {
        let oHtml = `
          <div class='card'>
              <div class='screenshot'>
              </div>
              <div class='user-events'>
                  <div class='user-event'>${this.description}</div>
              </div>
          </div>`;
        return oHtml;
    }
}

/** highlist the element that was acted on in the screenshot
 * when the user hovers over the text of a user-event
 */
$('#cards').on('mouseenter mouseleave', '.user-event[data-uid]', function (e) {
    $(`.overlay[data-uid='${e.target.dataset.uid}']`).toggle();
});

function injectOnNavigation(obj) {
    console.log('GOT NAV in Recording Window', obj);
    if (obj.url !== currentUrl) {
        currentUrl = obj.url;
        injectScript(obj.url);
    }
}


/** Turn the tab we were launched from into the initial state 
 * of the recording we are playing back. Set url, viewport, and focus.
 */
async function setViewport(width, height) {
    function getBorder() {
        return {
            width: window.outerWidth - window.innerWidth,
            height: window.outerHeight - window.innerHeight
        };
    }

    let frames = await chrome.scripting.executeScript( { 
        target: { tabId },
        function: getBorder,
    });
    let border = frames[0].result;
        
    await chrome.windows.update(contentWindowId, { 
         focused: true,
         width: width + border.width,
         height:height + border.height
    });
}

$('#playButton').on('click', async () => {
    let action;

    for(let i = 0 ; i < cards.length; ++i) {
        action = cards[i];
        console.log(action.description);
        switch(action.type) {
            case 'start':
                await setViewport(action.tabWidth, action.tabHeight);
                // If we just recorded it and want to play it back, we can reuse the window we recorded it from
                // We can reuse the tab we launched the UI from.
                chrome.tabs.update(tabId, {
                    highlighted: true,
                    active: true,
                    url: action.url
                });
                // await chrome.debugger.attach({tabId}, "1.3");
                // await chrome.debugger.sendCommand( {tabId} , 'Page.navigate', {url: action.url});
                break;
            case 'keydown':
                break;
            case 'mousedown':
//                chrome.debugger.sendCommand({tabId}, 'Input.dispatchKeyEvent');
//                chrome.debugger.sendCommand({tabId}, 'Input.dispatchKeyEvent');
                break;
        }
    }
});

$('#recordButton').on('click', async () => {
    await chrome.windows.update(contentWindowId, {focused:true});
    chrome.tabs.update(tabId, {
        highlighted: true,
        active: true
    });

    var zip = new JSZip();
    let tab = await chrome.tabs.get(tabId);

    // No screenshots for this first one (the first user action determines state that identifies when this is done)
    let card = new TextCard({
        type: 'start', // start recording
        url: tab.url,
        description: `start recording from ${tab.url}`,
        tabHeight: tab.height,
        tabWidth: tab.width
    });
    addCardToView(card);

    try {
        port.postMessage({ type: 'record' }); // reuse if you can
    }
    catch (e) {
        console.log(e);
        if (![
            'port.postMessage is not a function',
            'Attempting to use a disconnected port object'
        ].includes(e.message)) {
            throw e;
        }
        await replaceOnConnectListener(tab.url);
    }

    // I only care about navigation if I am recording
    chrome.webNavigation.onCompleted.addListener(injectOnNavigation);
});

function stopRecording() {
    // tell the endpoint to stop recording
    try {
        port.disconnect();
    }
    catch { }
    chrome.webNavigation.onCompleted.removeListener(injectOnNavigation);
}

$('#clearButton').on('click', async () => {
    stopRecording();

    // remove the cards
    cards = [];
    $('#cards').empty();
});

$('#saveButton').on('click', async () => {
    let card = new ScreenshotCard({
        type: 'stop', // stop recording
        description: `stop recording`
    });
    port.postMessage({ type: 'stop' });

    // final state if you were recording!
    let screenshot = await takeScreenshot();
    card.addScreenshot(screenshot);
    addCardToView(card);

    console.log('create zip');
    var zip = new JSZip();
    zip.file('test.json', JSON.stringify({ actions: cards }, null, 2)); // add the test.json file to archive
    var screenshots = zip.folder("screenshots"); // add a screenshots folder to the archive
    // add all the expected screenshots to the screenshots directory in the archive
    for (let i = 0; i < cards.length; ++i) {
        let card = cards[i];
        if (card.expectedScreenshot) {
            let response = await fetch(card.expectedScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.expectedScreenshot.fileName, blob, { base64: true });
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
    let zip = await (new JSZip()).loadAsync(blob);
    let screenshots = await zip.folder('screenshots');
    var test = JSON.parse(await zip.file("test.json").async("string"));
    let userEvents = test.actions;
    let failedOnStep = test?.player?.failedOnStep;
    // just show the one failure, and allow for editing, and rerun.
    if (failedOnStep) {
        let userEvent = userEvents[failedOnStep];

        userEvent.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await zip.file(userEvent.expectedScreenshot.fileName).async('base64');
        let actualFilename = `step${userEvent.step}_actual.png`;
        userEvent.actualScreenshot = {
            dataUrl: 'data:image/png;base64,' + await screenshots.file(actualFilename).async('base64'),
            fileName: actualFilename
        };

        userEvent.expected_uint8array = await zip.file(this.expectedScreenshot.fileName).async('uint8array');
        userEvent.actual_uint8array = await zip.file(this.actualScreenshot.fileName).async('uint8array');
        let card = new FailedStepCard(userEvent);
        card.pixelDiff();
        addCardToView(card);
    }
    else {
        for (let i = 0; i < userEvents.length; ++i) {
            let card;
            let userEvent = userEvents[i];
            if (userEvent.expectedScreenshot) {
                userEvent.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(userEvent.expectedScreenshot.fileName).async('base64');
                card = new ScreenshotCard(userEvent);
            }
            else {
                card = new TextCard(userEvent);
            }
            addCardToView(card);
        }
    }
});

function injectScript(url) {
    console.log(`injecting script into ${url}`);

    chrome.storage.sync.set({ injectedArgs: { url } }, () => {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                files: ['content-recorder.js']
            },
            (injectionResults) => {
                for (const frameResult of injectionResults)
                    console.log('Injected script returns: ' + frameResult.result);
            }
        );
    });
}

var port = false;

/** Take the user event, use it as a viewmodel (data) to create the model (ui) */
function addCardToView(card) {
    let $card = $(card.toHtml());
    cards.push(card);
    uiCardsElement.appendChild($card[0], $card[0]);
}

/** Process a user event received from the content script
 * screenshot, annotate event and convert to card
 */
async function userEventToCardModel(userEvent) {
    let cardModel = userEvent; // start with the user event and convert to a cardModel (by adding some properties)
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
    cardModel.uid = uuidv4(); // FIXME: this was a uid because once upon a time I would let there be several useractions per card/step. now with auto screen shot capture that is not needed.
    cardModel.description =
        //ardModel.type === 'change' ? `change text to ${cardModel.value} in element at location (${userEvent.clientX}, ${userEvent.clientY})` :
        cardModel.type === 'keydown' ? `keydown ${userEvent.value} in element at location (${userEvent.clientX}, ${userEvent.clientY})` :
            cardModel.type === 'mousedown' ? `mousedown at location (${userEvent.clientX}, ${userEvent.clientY})` :
                //cardModel.type === 'click' ? `click at location (${userEvent.clientX}, ${userEvent.clientY})` :
                //cardModel.type === 'beforeinput' ? `next: beforeinput at location (${userEvent.clientX}, ${userEvent.clientY})` :
                'Unknown!';
    return cardModel;
}

async function takeScreenshot() {
    let dataUrl = await chrome.tabs.captureVisibleTab(contentWindowId, {
        format: 'png'
    });
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
            let card;
            switch (userEvent.type) {
                case 'mousedown':
                case 'keydown':
                    let screenshot = await takeScreenshot();
                    card = await userEventToCardModel(userEvent);
                    card = new ScreenshotCard(card);
                    card.addScreenshot(screenshot);
                    addCardToView(card);
                    port.postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
                    break;
                case 'change':
                    port.postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
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
    injectScript(url); // inject a content script that will connect
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