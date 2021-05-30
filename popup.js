var screenshotCounter = 0;
// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);
const parentWindowId = parseInt(urlParams.get('parent'), 10);
const tabId = parseInt(urlParams.get('tab'), 10);
var uiCardsElement = document.getElementById('cards');
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
    /** @type string */
    type;
    /** @type string */
    css;
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
                html += `<div class='user-event' data-uid='${userEvent.guid}'>${userEvent.type} element ${userEvent.css}</div>`;
            });
        }
        html += '</div>';
        return html;
    }
}

Card.uuidv4 = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// chrome.storage.local.set({ brimstoneScreenshot: dataUrl});
// await chrome.scripting.executeScript({
//     target: { tabId: tab.id },
//     function: writeScreenShotToLocalStorage,
// });


/** highlist the element that was acted on in the screenshot
 * when the user hovers over the text of a user-event
 */
$('#cards').on('mouseenter mouseleave', '.user-event', function (e) {
    $(`.overlay[data-uid='${e.target.dataset.uid}']`).toggle();
});


/*
// obsolete manually add a screenshot
$('#cards').on('click', '#shutterButton', async function (e) {
    let dataUrl = await chrome.tabs.captureVisibleTab(parentWindowId, {
        format: 'png'
    }); // e.g. dataUrl === 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...'
    // let userActions = [new UserAction()];

    // remove the shutter and replace it with a screenshot
    let blankCard = $('#shutterButton').closest('.card');
    let screenShotCard = $(cardHtml({
        dataUrl,
        overlays: [
            { height: '30%', width: '30%', top: '0%', left: '0%' }
        ]
    }));

    screenShotCard.find('img').on('load', function (e) {
        blankCard = $('#shutterButton').closest('.card'); // it moved
        let position = blankCard.position();
        uiCardsElement.scrollBy(position.left, 0);
    });

    screenShotCard.insertBefore(blankCard);117
});
*/

// The application being recorded will have a content script injected into it
// that will establish the socket, and send a message.
chrome.runtime.onConnect.addListener(function (port) {
    console.assert(port.name == "knockknock");
    console.log(`connected to port ${port}`);
    port.onMessage.addListener(async function (userEvent) {
        console.log('popup.js got message', userEvent);
        let card;
        switch (userEvent.type) {
            case 'click':
                let dataUrl = await chrome.tabs.captureVisibleTab(parentWindowId, {
                    format: 'png'
                });
                let tab = await chrome.tabs.get(tabId);
                let element = userEvent.boundingClientRect;
                userEvent.overlay = { 
                    height: `${element.height*100/tab.height}%`,
                    width: `${element.width*100/tab.width}%`,
                    top: `${element.top*100/tab.height}%`,
                    left: `${element.left*100/tab.width}%`
                };
                card = new Card({
                    dataUrl,
                    userEvents: [userEvent]
                });
                card = $(card.toHtml());
                card.find('img').on('load', function (e) {
                    blankCard = $('#blankCard'); // it moved
                    let position = blankCard.position();
                    uiCardsElement.scrollBy(position.left, 0);
                });
                card.insertBefore('#blankCard');
                port.postMessage({screenshotTaken: true});
                break;
            case 'connect':
                card = new Card();
                card = $(card.toHtml());
                card.attr('id', 'blankCard');
                $('#cards').append(card);
                break;
        }
    });
});

// The content-script (CS) lives in this function. This can't use all the chrome api's :( 
// https://developer.chrome.com/docs/extensions/mv3/content_scripts/
function forwardUserActionsToRecorder() {
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
        console.log(msg);
        // when the popup sends messages to the context of the app that's being recorded they come in here
        if(msg.screenshotTaken) {
            brimstoneScreenshotRequired = false;
            pendingClickEventElement.click();
        }
    });

    var brimstoneScreenshotRequired = true;
    var pendingClickEventElement;
    function onclick(e) {
        if(brimstoneScreenshotRequired) {
            e.stopPropagation();
            e.preventDefault();
            pendingClickEventElement = e.target;
        
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
                boundingClientRect: e.target.getBoundingClientRect()
            }); 
        }
        brimstoneScreenshotRequired = true;
    }

    window.addEventListener('click', onclick, { capture: true });
}

chrome.scripting.executeScript({
    target: { tabId },
    function: forwardUserActionsToRecorder
});



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