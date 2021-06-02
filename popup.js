var screenshotCounter = 0;
// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);
const contentWindowId = parseInt(urlParams.get('parent'), 10);
const tabId = parseInt(urlParams.get('tab'), 10);
var uiCardsElement = document.getElementById('cards');
var zip = new JSZip();
var screenshotsExpected = zip.folder("screenshots_expected");
var screenshotNumber = 0;
/** @type Card[] */
var cards = [];

//var currentUrl;

// /** Take a data url for a PNG and save it to users filesystem */
// async function savePng(dataUrl) {
//     let response = await fetch(dataUrl); 
//     let blob = await response.blob();

//     // I want to zip up all the images as I go
//     const handle = await window.showSaveFilePicker({
//         suggestedName: `screenshot${++screenshotCounter}.png`,
//         types: [
//             {
//                 description: 'A PNG',
//                 accept: {'image/png': ['.png']}
//             }
//         ]
//     }); 
//     const writable = await handle.createWritable();    
//     await writable.write(blob);  // Write the contents of the file to the stream.    
//     await writable.close(); // Close the file and write the contents to disk.
// }

// /**
//  * Add the step to the UI
//  * @param {Step} step The step to add 
//  */
// function addStep(step) {
// }

// class UserAction {

// }

// class Step {

//     constructor(args) {
//         /** @type string */
//         this.dataUrl = args.dataUrl;
//         /** @type UserAction[] */
//         this.events = [];
//     }
// } 



class UserEvent {
    /** A string identifier of the type of event, 'click', 'change' , ... */
    type = '';
    /** A CSS selector that should identify the element this event occurrd on */
    css = ''
    /** The y-offset of the element the event occurred on */
    top = 0;
    /** The x-offset of the element this event occured on */
    left = 0;
}

class Card {
    /** @type string */
    dataUrl;
    /** @type UserEvent[] */
    userEvents;

    constructor(args = {}) {
        this.dataUrl = args.dataUrl;
        this.userEvents = args.userEvents;
    }

    toString() {
        let html = '';
        html += '<div class="card">';
        html += this._screenShotHtml();
        html += this._userEventsHtml();
        html += '</div>';
        return html;
    }

    toHtml() {
        return this.toString();
    }

    _screenShotHtml() {
        let html = '';
        if (this.dataUrl) {
            html +=
                `<div class='screenshot'>
                    <img src='${this.dataUrl}'>
                `;
            this.userEvents.forEach(userEvent => {
                // the overlays should come in with these properties already as percentages
                let o = userEvent.overlay;
                userEvent.guid = Card.uuidv4();
                html += `<div class='overlay' data-uid=${userEvent.guid} style='height:${o.height};width:${o.width};top:${o.top};left:${o.left}'></div>`;
            });
            html += '</div>';

        }
        else {
            html +=
                `<div id='shutterButton' class='screenshot'>
                    Click to take screen shot
                    </div>`;
        }
        return html;
    }

    _userEventsHtml() {
        let html = `<div class='user-events'>`;
        if (this.userEvents) {
            this.userEvents.forEach(userEvent => {
                userEvent.value = userEvent.value ? `value to '${userEvent.value}' ` : '';
                html += `<div class='user-event' data-uid='${userEvent.guid}'>${userEvent.type} element ${userEvent.value}${userEvent.css}</div>`;
            });
        }
        html += '</div>';
        return html;
    }
}

Card.uuidv4 = function () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/** highlist the element that was acted on in the screenshot
 * when the user hovers over the text of a user-event
 */
$('#cards').on('mouseenter mouseleave', '.user-event', function (e) {
    $(`.overlay[data-uid='${e.target.dataset.uid}']`).toggle();
});

$('#saveButton').click(async () => {
    await screenshot(); // take last state since we are ending the recording
    console.log('writing zip file to disk I hope');
    // make the 'test'.
    zip.file('test.json', JSON.stringify(cards.map(card => card.userEvents[0]), null, 2));
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

// The application being recorded will have a content script injected into it
// that will establish the socket, and send a message.
// The content-script (CS) lives in this function. This can't use all the chrome api's :( 
// https://developer.chrome.com/docs/extensions/mv3/content_scripts/
function forwardUserActionsToRecorder(/*injectedArgs*/) {
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
                brimstoneScreenshotRequired = false;
                switch (pendingEventType) {
                    case 'click':
                        pendingEventElement.click();
                        break;
                    case 'change':
                        pendingEventElement.dispatchEvent(new Event(pendingEventType, { bubbles: true }));
                        break;
                }
            }
            if (msg.type === 'disconnect') {
                port.disconnect();
            }
        });

        var brimstoneScreenshotRequired = true;
        var pendingEvent;
        var pendingEventElement;
        var pendingEventType;

        function onevent(e, parms) {
            if (brimstoneScreenshotRequired) {
                e.stopPropagation();
                e.preventDefault();
                pendingEventElement = e.target;
                pendingEventType = e.type;
                pendingEvent = e;

                // JSON.stringify bails as soon as it hits a circular reference, so we must project out a subset of the properties
                // rather than just augment the e object.
                port.postMessage({
                    type: e.type,
                    // https://blog.davidvassallo.me/2019/09/20/a-javascript-reverse-css-selector/
                    css: TopLevelObject.DOMPresentationUtils.cssPath(e.target), // reverse engineer css from dom element
                    clientX: e.clientX,
                    clientY: e.clientY,
                    screenX: e.screenX,
                    screenY: e.screenY,
                    boundingClientRect: e.target.getBoundingClientRect(),
                    value: e.type === 'change' ? e.target.value : undefined
                });
            }
            brimstoneScreenshotRequired = true;
        }

        window.removeEventListener('click', onevent, { capture: true });
        window.addEventListener('click', onevent, { capture: true });
        // https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event
        window.removeEventListener('change', onevent, { capture: true });
        window.addEventListener('change', onevent, { capture: true });
        //window.addEventListener('input', onevent, { capture: true });

        function removeEventListeners() {
            window.removeEventListener('click', onevent, { capture: true });
            window.removeEventListener('change', onevent, { capture: true });
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

async function screenshot() {
    let dataUrl = await chrome.tabs.captureVisibleTab(contentWindowId, {
        format: 'png'
    });
    let response = await fetch(dataUrl);
    let blob = await response.blob();
    ++screenshotNumber;
    screenshotsExpected.file(`screenshot${screenshotNumber}.png`, blob, { base64: true });
    return dataUrl;
}

var contentPort = false;

/** Set up  */
function replaceOnConnectListener(url) {
    chrome.runtime.onConnect.addListener(function (port) { // wait for a connect
        contentPort = port;
        // contentPort.onDisconnect.addListener(function(port) {
        //     replaceOnConnectListener(); // listen again for the next connection
        // });
        console.log('PORT CONNECTED', port);
        contentPort.onMessage.addListener(async function (userEvent) {
            console.log(`RX: ${userEvent.type}`, userEvent);
            switch (userEvent.type) {
                case 'click':
                case 'change':
                    let dataUrl = await screenshot();
 
                    let tab = await chrome.tabs.get(tabId);
                    let element = userEvent.boundingClientRect;
                    userEvent.overlay = {
                        height: `${element.height * 100 / tab.height}%`,
                        width: `${element.width * 100 / tab.width}%`,
                        top: `${element.top * 100 / tab.height}%`,
                        left: `${element.left * 100 / tab.width}%`
                    };
                    userEvent.step = screenshotNumber; 
                    let card = new Card({
                        dataUrl,
                        userEvents: [userEvent]
                    });
                    cards.push(card);
                    card = $(card.toHtml());
                    card.find('img').on('load', function (e) {
                        uiCardsElement.scrollBy(100000000, 0);
                    });
                    uiCardsElement.appendChild(card[0]);
                    console.log('TX: screenshotTaken');
                    port.postMessage({ type: 'screenshotTaken', screenshotTaken: true });
                    break;
                case 'connect':
                    console.log('got a new connection request msg from injected content script');
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
    let queryOptions = { active: true, currentWindow: true };
    let tab = await chrome.tabs.get(tabId);
    replaceOnConnectListener(tab.url);
})();


function saveTest() {
    zip.file("test.js", "Hello World\n");


    zip.generateAsync({ type: "blob" }).then(function (content) {
        // see FileSaver.js
        saveAs(content, "example.zip");
    });
}

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