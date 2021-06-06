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

/** Fixme not used. The struct returned from the content script is used directly  */
class UserEvent {
    /** A string identifier of the type of event, 'click', 'change' , ... */
    type = '';
}

/** Fixme not used */
class UserAction extends UserEvent {
    /** A CSS selector that should identify the element this event occurrd on */
    css = ''
    /** The y-offset of the element the event occurred on */
    top = 0;
    /** The x-offset of the element this event occured on */
    left = 0;
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

    async addScreenshot() {
        let dataUrl = await chrome.tabs.captureVisibleTab(contentWindowId, {
            format: 'png'
        });
        let response = await fetch(dataUrl);
        let blob = await response.blob();
        let fileName = `step${this.step}_expected.png`;
        screenshots.file(fileName, blob, { base64: true });
        this.expectedScreenshot = { fileName: `screenshots/${fileName}`, dataUrl };
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
                <div class='user-event' data-uid='${this.uid}'>${this.type} element ${value}${this.css}</div>
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
    await card.addScreenshot();
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

// The application being recorded will have a content script injected into it
// that will establish the socket, and send a message.
// The content-script (CS) lives in this function. This can't use all the chrome api's :( 
// https://developer.chrome.com/docs/extensions/mv3/content_scripts/
function forwardUserActionsToRecorder(/*injectedArgs*/) {
    let lastKeydown = '';
    // until chrome fixes the bug, we pass args this way
    chrome.storage.sync.get(["injectedArgs"], (result) => {
        console.log('got', result);
        let expectedUrl = result.injectedArgs.url;
        let actualUrl = window.location.href;//;chrome.runtime.getURL('');

        if (expectedUrl !== actualUrl) {
            console.error(`NOT injecting script, expected url to be\n${expectedUrl}\nactual\n${actualUrl}`);
            return;
        }

        var TopLevelObject = {}
        TopLevelObject.DOMNodePathStep = function (value, optimized) {
            this.value = value;
            this.optimized = optimized || false;
        }
        TopLevelObject.DOMNodePathStep.prototype = {
            /**
             * @override
             * @return {string}
             */
            toString: function () {
                return this.value;
            }
        }
        TopLevelObject.DOMPresentationUtils = {}

        TopLevelObject.DOMPresentationUtils.cssPath = function (node, optimized) {
            if (node.nodeType !== Node.ELEMENT_NODE)
                return "";
            var steps = [];
            var contextNode = node;
            while (contextNode) {
                var step = TopLevelObject.DOMPresentationUtils._cssPathStep(contextNode, !!optimized, contextNode === node);
                if (!step)
                    break; // Error - bail out early.
                steps.push(step);
                if (step.optimized)
                    break;
                contextNode = contextNode.parentNode;
            }
            steps.reverse();
            return steps.join(" > ");
        }

        TopLevelObject.DOMPresentationUtils._cssPathStep = function (node, optimized, isTargetNode) {
            if (node.nodeType !== Node.ELEMENT_NODE)
                return null;
            var id = node.getAttribute("id");
            if (optimized) {
                if (id)
                    return new TopLevelObject.DOMNodePathStep(idSelector(id), true);
                var nodeNameLower = node.nodeName.toLowerCase();
                if (nodeNameLower === "body" || nodeNameLower === "head" || nodeNameLower === "html")
                    return new TopLevelObject.DOMNodePathStep(node.tagName.toLowerCase(), true);
            }
            var nodeName = node.tagName.toLowerCase();
            if (id)
                return new TopLevelObject.DOMNodePathStep(nodeName + idSelector(id), true);
            var parent = node.parentNode;
            if (!parent || parent.nodeType === Node.DOCUMENT_NODE)
                return new TopLevelObject.DOMNodePathStep(nodeName, true);
            /**
             * @param {!TopLevelObject.DOMNode} node
             * @return {!Array.<string>}
             */
            function prefixedElementClassNames(node) {
                var classAttribute = node.getAttribute("class");
                if (!classAttribute)
                    return [];
                return classAttribute.split(/\s+/g).filter(Boolean).map(function (name) {
                    // The prefix is required to store "__proto__" in a object-based map.
                    return "$" + name;
                });
            }
            /**
             * @param {string} id
             * @return {string}
             */
            function idSelector(id) {
                return "#" + escapeIdentifierIfNeeded(id);
            }
            /**
             * @param {string} ident
             * @return {string}
             */
            function escapeIdentifierIfNeeded(ident) {
                if (isCSSIdentifier(ident))
                    return ident;
                var shouldEscapeFirst = /^(?:[0-9]|-[0-9-]?)/.test(ident);
                var lastIndex = ident.length - 1;
                return ident.replace(/./g, function (c, i) {
                    return ((shouldEscapeFirst && i === 0) || !isCSSIdentChar(c)) ? escapeAsciiChar(c, i === lastIndex) : c;
                });
            }
            /**
             * @param {string} c
             * @param {boolean} isLast
             * @return {string}
             */
            function escapeAsciiChar(c, isLast) {
                return "\\" + toHexByte(c) + (isLast ? "" : " ");
            }
            /**
             * @param {string} c
             */
            function toHexByte(c) {
                var hexByte = c.charCodeAt(0).toString(16);
                if (hexByte.length === 1)
                    hexByte = "0" + hexByte;
                return hexByte;
            }
            /**
             * @param {string} c
             * @return {boolean}
             */
            function isCSSIdentChar(c) {
                if (/[a-zA-Z0-9_-]/.test(c))
                    return true;
                return c.charCodeAt(0) >= 0xA0;
            }
            /**
             * @param {string} value
             * @return {boolean}
             */
            function isCSSIdentifier(value) {
                return /^-?[a-zA-Z_][a-zA-Z0-9_-]*$/.test(value);
            }
            var prefixedOwnClassNamesArray = prefixedElementClassNames(node);
            var needsClassNames = false;
            var needsNthChild = false;
            var ownIndex = -1;
            var elementIndex = -1;
            var siblings = parent.children;
            for (var i = 0; (ownIndex === -1 || !needsNthChild) && i < siblings.length; ++i) {
                var sibling = siblings[i];
                if (sibling.nodeType !== Node.ELEMENT_NODE)
                    continue;
                elementIndex += 1;
                if (sibling === node) {
                    ownIndex = elementIndex;
                    continue;
                }
                if (needsNthChild)
                    continue;
                if (sibling.tagName.toLowerCase() !== nodeName)
                    continue;
                needsClassNames = true;
                var ownClassNames = prefixedOwnClassNamesArray.values();
                var ownClassNameCount = 0;
                for (var name in ownClassNames)
                    ++ownClassNameCount;
                if (ownClassNameCount === 0) {
                    needsNthChild = true;
                    continue;
                }
                var siblingClassNamesArray = prefixedElementClassNames(sibling);
                for (var j = 0; j < siblingClassNamesArray.length; ++j) {
                    var siblingClass = siblingClassNamesArray[j];
                    if (!ownClassNames.hasOwnProperty(siblingClass))
                        continue;
                    delete ownClassNames[siblingClass];
                    if (!--ownClassNameCount) {
                        needsNthChild = true;
                        break;
                    }
                }
            }
            var result = nodeName;
            if (isTargetNode && nodeName.toLowerCase() === "input" && node.getAttribute("type") && !node.getAttribute("id") && !node.getAttribute("class"))
                result += "[type=\"" + node.getAttribute("type") + "\"]";
            if (needsNthChild) {
                result += ":nth-child(" + (ownIndex + 1) + ")";
            } else if (needsClassNames) {
                for (var prefixedName in prefixedOwnClassNamesArray.values())
                    result += "." + escapeIdentifierIfNeeded(prefixedName.substr(1));
            }
            return new TopLevelObject.DOMNodePathStep(result, false);
        }

        console.log('connecting port');
        var port = chrome.runtime.connect({ name: "knockknock" });
        port.postMessage({ type: 'connect' });

        port.onMessage.addListener(function (msg) {
            console.log(`RX: ${msg.type}`, msg);
            // when the popup sends messages to the context of the app that's being recorded they come in here
            if (msg.screenshotTaken) {
                //debugger;
                switch (pendingEventType) {
                    case 'click':
                        queueEvents.click = false; // the next dispatch will not be queued
                        pendingEventElement.dispatchEvent(new Event(pendingEventType, { bubbles: true }));
                        //pendingEventElement.click();
                        break;
                    case 'beforeinput':
                        console.log(`simulating the keypress of ${pendingEvent.data} now`);
                        pendingEventElement.value += pendingEvent.data;
                        let keyDown = new KeyboardEvent('keydown', {
                            key: pendingEvent.data
                        });
                        pendingEventElement.dispatchEvent(keyDown);
                        break;
                }
            }
            if (msg.type === 'disconnect') {
                port.disconnect();
            }
        });

        /** Used in the event handlers to control event queuing. If true the event is thrown out, 
         * the UI gets a post message to do something (e.g. take a screenshot) then the UI will
         * post back and set this to false, and then recreate the original event, now the event 
         * will flow through normally, since it is false, then it's set back to true and we start over.
         */
        var queueEvents = {
            click: true
        };

        var pendingEvent;
        var pendingEventElement;
        var pendingEventType;

        function buildMsg(e) {
            pendingEventElement = e.target;
            pendingEventType = e.type;
            pendingEvent = e;

            // JSON.stringify bails as soon as it hits a circular reference, so we must project out a subset of the properties
            // rather than just augment the e object.
            let msg = {
                type: e.type,
                // https://blog.davidvassallo.me/2019/09/20/a-javascript-reverse-css-selector/
                css: TopLevelObject.DOMPresentationUtils.cssPath(e.target), // reverse engineer css from dom element
                clientX: e.clientX,
                clientY: e.clientY,
                screenX: e.screenX,
                screenY: e.screenY,
                boundingClientRect: e.target.getBoundingClientRect(),
            };
            return msg;
        }

        function queueEventUntilScreenshotReceived(e, parms) {
            if (queueEvents[e.type]) {
                e.stopPropagation();
                e.preventDefault();
                let msg = buildMsg(e);
                port.postMessage(msg);
            }
            queueEvents[e.type] = true;
        }

        function onChange(e, parms) {
            console.log('event: change');
            let msg = buildMsg(e);
            msg.value = e.target.value;
            if (lastKeydown === 'Tab') {
                msg.value += '\t';  // pass that along to the driver
            }
            console.log(`change msg will be ${msg.value}`);
            lastKeydown = null;
            port.postMessage(msg);
        }

        function onClick(e, parms) {
            console.log('event: click');
            queueEventUntilScreenshotReceived(e, parms);
        }

        function onKeydown(e, parms) {
            lastKeydown = e.key; // remember the last key we press
            console.log(`event: keydown <${lastKeydown}>`); // track when the user clicks <TAB> or <ENTER> in text boxes that do stuff
        }

        /** This signals that the screen is ready, and the user wants to update an input.
        * e.g. The first keypress in a text input.
        */
        function onBeforeInput(e, parms) {
            console.log('event: beforeinput');
            // here I don't really need to queue the events, just catch the first to snag a screen shot
            if (e.target !== pendingEventElement || pendingEventType !== 'beforeinput') {
                e.stopPropagation();
                e.preventDefault();
                let msg = buildMsg(e);
                port.postMessage(msg);
            }
        }

        window.removeEventListener('click', onClick, { capture: true });
        window.addEventListener('click', onClick, { capture: true });

        // https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event
        // fired when the input value is different, not on every keystroke, but when the input "sees" the
        // change. On blur or enter.
        window.removeEventListener('beforeinput', onBeforeInput, { capture: true });
        window.addEventListener('beforeinput', onBeforeInput, { capture: true });


        window.removeEventListener('keydown', onKeydown, { capture: true });
        window.addEventListener('keydown', onKeydown, { capture: true });

        window.removeEventListener('change', onChange, { capture: true });
        window.addEventListener('change', onChange, { capture: true })

        // before the users first keystroke in a input is proessed we should take a snapshot
        function removeEventListeners() {
            window.removeEventListener('click', onClick, { capture: true });
            window.removeEventListener('beforeinput', onBeforeInput, { capture: true });
            window.removeEventListener('change', onChange, { capture: true });
            window.removeEventListener('keydown', onKeydown, { capture: true });
        }

        port.onDisconnect.addListener(function (port) {
            removeEventListeners();
        });
    });
}

function injectScript(url) {
    console.log('injecting script');

    // workarond until https://bugs.chromium.org/p/chromium/issues/detail?id=1166720
    // is fixed
    chrome.storage.sync.set({ injectedArgs: { url } }, () => {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                function: forwardUserActionsToRecorder
                //args: [url] //https://bugs.chromium.org/p/chromium/issues/detail?id=1166720
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
        cardModel.type === 'change' ? `${userEvent.type} element value to ${cardModel.value} ${cardModel.css}` :
            cardModel.type === 'click' ? `${userEvent.type} element ${cardModel.css}` :
                cardModel.type === 'beforeinput' ? `${userEvent.type} element ${cardModel.css}` :
                    'Unknown!';
    return cardModel;
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
                case 'click':
                case 'beforeinput':
                    card = await userEventToCardModel(userEvent);
                    card = new ScreenshotCard(card);
                    await card.addScreenshot();
                    cards.push(card);
                    addCardToView(card);
                    console.log('TX: screenshotTaken');
                    port.postMessage({ type: 'screenshotTaken', screenshotTaken: true });
                    break;
                case 'change':
                    let cardModel = await userEventToCardModel(userEvent);
                    card = cards[cards.length - 1]; // current card
                    card.type = 'change';
                    card.description = cardModel.description;
                    card.value = cardModel.value;
                    $(`.user-event[data-uid=${card.uid}]`)
                        .closest('.user-events').append(
                            `<div class='user-event' data-uid='${card.uid}'>${card.description}</div>`
                        );
                    console.log('TX: card-updated');
                    port.postMessage({ type: 'card-updated' });
                    break;
                case 'connect':
                    console.log('got a new connection msg from injected content script');
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