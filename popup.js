import { uuidv4 } from "./uuidv4.js"
import { Rectangle } from "./rectangle.js"

var screenshotCounter = 0;
// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);
const contentWindowId = parseInt(urlParams.get('parent'), 10);
const tabId = parseInt(urlParams.get('tab'), 10);
var uiCardsElement = document.getElementById('cards');
var zip = new JSZip();
var screenshots = zip.folder("screenshots");
/** @type Card[] */
var cards = [];

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
                <div class='user-event' data-uid='${this.uid}'>${this.description}</div>
            </div>
        </div>`;
        return html;
    }

    addScreenshot() {
        let fileName = `step${this.step}_expected.png`;
        screenshots.file(fileName, lastScreenshot.blob, { base64: true });
        this.expectedScreenshot = { fileName: `screenshots/${fileName}`, dataUrl: lastScreenshot.dataUrl };
    }
}

class VerifiedStepCard extends Card {
    constructor(args = {}) {
        super(args);
    }

    toHtml() {
        let nHtml = `
        <div class='card'>
            <div class='screenshot'>
                <img class='expected' src='${this.expectedScreenshot.dataUrl}'>
                <img class='actual' src='${this.actualScreenshot.dataUrl}'>
                <div class='overlay' data-uid=${this.uid} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>
            </div>
            <div class='screenshot'>
                <img src='${this.diffScreenshot}'>
            </div>
            <div class='user-events'>
                <div class='user-event' data-uid='${this.uid}'>${this.type} element ${value}</div>
            </div>
        </div>`;
    }
}

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

$('#saveButton').click(async () => {
    let card = new ScreenshotCard({
        type: 'stop', // stop recording
        description: `stop recording`
    });
    await screenshot();
    card.addScreenshot();
    addCardToView(card);

    console.log('writing zip file to disk I hope');
    // make the 'test'.
    zip.file('test.json', JSON.stringify(cards, null, 2));
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

$('#loadButton').click(async () => {
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
    var zip = await (new JSZip()).loadAsync(blob);
    let screenshotFilenames = [];
    let userEvents = JSON.parse(await zip.file("test.json").async("string"));
    console.log(userEvents);
    for (let i = 0; i < userEvents.length; ++i) {
        let card;
        let userEvent = userEvents[i];
        if (userEvent.expectedScreenshot) {
            userEvent.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await zip.file(userEvent.expectedScreenshot.fileName).async('base64');
            if (userEvent.actualScreenshot?.fileName) {
                userEvent.actualScreenshot.dataUrl = 'data:image/png;base64,' + await zip.file(userEvent.actualScreenshot.fileName).async('base64');
            }
            card = new ScreenshotCard(userEvent);
        }
        else {
            card = new TextCard(userEvent);
        }

        addCardToView(card);
    }
});



function injectScript(url) {
    console.log('injecting script');

    // workarond until https://bugs.chromium.org/p/chromium/issues/detail?id=1166720
    // is fixed
    chrome.storage.sync.set({ injectedArgs: { url } }, () => {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                //function: forwardUserActionsToRecorder
                //args: [url] //https://bugs.chromium.org/p/chromium/issues/detail?id=1166720
                files: ['contentScript.js']
            },
            (injectionResults) => {
                for (const frameResult of injectionResults)
                    console.log('Injected script returns: Frame Title: ' + frameResult.result);
            }
        );
    });
}

var contentPort = false;

/** Take the user event, use it as a viewmodel (data) to create the model (ui) */
function addCardToView(card) {
    let $card = $(card.toHtml());
    $card.find('img').on('load', function (e) {
        uiCardsElement.scrollBy(100000000, 0);
        Rectangle.setContainer(
            $card.find('.screenshot')[0],
            addMask => {
                if (!card.screenshotMasks) {
                    card.screenshotMasks = [];
                }
                card.screenshotMasks.push(addMask);
            },
            delMask => {
                card.screenshotMasks = card.screenshotMasks.filter(mask => mask.uid !== delMask.uid);
            }
        );
    });
    uiCardsElement.appendChild($card[0]);
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
        cardModel.type === 'beforeinput' ? `beforeinput at location (${userEvent.clientX}, ${userEvent.clientY})` :
                    'Unknown!';
    return cardModel;
}

async function screenshot() {
    let dataUrl = await chrome.tabs.captureVisibleTab(contentWindowId, {
        format: 'png'
    });
    let response = await fetch(dataUrl);
    lastScreenshot = {
        blob: await response.blob(),
        dataUrl
    };
}

/** Set up  */
async function replaceOnConnectListener(url) {
    chrome.runtime.onConnect.addListener(function (port) { // wait for a connect
        contentPort = port;
        // contentPort.onDisconnect.addListener(function(port) {
        //     replaceOnConnectListener(); // listen again for the next connection
        // });
        console.log('PORT CONNECTED', port);
        contentPort.onMessage.addListener(async function (userEvent) {
            console.log(`RX: ${userEvent.type}`, userEvent);
            let card;
            switch (userEvent.type) {
                case 'mousedown':
                case 'keydown': 
                    await screenshot();
                    card = await userEventToCardModel(userEvent);
                    card = new ScreenshotCard(card);
                    card.addScreenshot();
                    cards.push(card);
                    addCardToView(card);
                    port.postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
                    break;
                case 'change':
                    port.postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
                    break;
                case 'connect':
                    console.log('got a new connection msg from injected content script');
                    break;
                default:
                    console.error(`unexpected userEvent received <${userEvent.type}>`);
                    break;
            }
        });
    });
    injectScript(url); // inject a content script that will connect
}

chrome.webNavigation.onCompleted.addListener(function (obj) {
    console.log('GOT NAV in Recording Window', obj);
    // in case the app does many naivigations and queues them before this can react
    //    if (obj.url !== currentUrl) {
    //        currentUrl = obj.url;
    injectScript(obj.url);
    //    }
});

chrome.webNavigation.onBeforeNavigate.addListener(function (obj) {
    console.log('before nav disconnect', obj);
    contentPort.postMessage({ type: 'disconnect' });
});

// the creation of the window gets the initial parms as query parms
(async () => {
    let tab = await chrome.tabs.get(tabId);

    // No screenshots for this first one (the first user action determines state that identifies when this is done)
    let card = new TextCard({
        type: 'start', // start recording
        url: tab.url,
        description: `start recording from ${tab.url}`,
        tabHeight: tab.height,
        tabWidth: tab.width
    });
    cards.push(card);
    addCardToView(card);

    // inject into page
    await replaceOnConnectListener(tab.url);
})();

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