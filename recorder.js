
// thanks dave. https://blog.davidvassallo.me/2019/09/20/a-javascript-reverse-css-selector/
var TopLevelObject = {};
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

// use like: TopLevelObject.DOMPresentationUtils.cssPath(element)

/** 
 * @typedef {import('./options.js').Options} Options 
 */

// https://stackoverflow.com/questions/35939886/find-first-scrollable-parent
function getScrollParent(element, includeHidden) {
    var style = getComputedStyle(element);
    var excludeStaticParent = style.position === "absolute";
    var overflowRegex = includeHidden ? /(auto|scroll|hidden)/ : /(auto|scroll)/;

    if (style.position === "fixed") return document.body;
    for (var parent = element; (parent = parent.parentElement);) {
        style = getComputedStyle(parent);
        if (excludeStaticParent && style.position === "static") {
            continue;
        }
        if (overflowRegex.test(style.overflow + style.overflowY + style.overflowX)) return parent;
    }

    return document.body;
}

/** This is how we distingguish synthetic events from user events.
 * And apparently only 0 can be set in the player.
 */
const SYNTHETIC_EVENT_TIMESTAMP = 0;

/**
 * Recorder class: queuue events that are triggered in response to certain user actions,
 * and send them back over the postMessage connection to the UI.
 */
class Recorder {
    /**
     *  Reset all the stat, of the recorder back to the same as when it was first constructed. 
     * 
     * */
    reset() {
        /** The chrome extension frameid this instance is running in. */
        if (this._frameId === undefined) { //  we may reset when recovering from an error, don't lose the frameId
            this._frameId = 0;
        }
        // FIXME: a better solution is to create the recorder instance once, I know it's frameId
        // else keep the assigned frameId

        /** Two way communication with the workspace */
        this._port = false;

        /**
         * Messages to the extension are queued up here.
         * @type {Event[]}
         */
        this.messageQueue = [];

        /**
         * Make key press recording perform well by bundling key events.
         * @type {Event[]}
         */
        this.keyEventQueue = [];

        /** Used to wait and see if a single click becomes a double click. */
        this.pendingClick = false;

        /** queue wheel events to record in a bundled action.
         *
         */
        this.wheelEventQueue = [];

        /**
         * True if the mouse is currently down, value contains the event itself.
         */
        this.mouseDown = false;

        /**
         * Contains the last mousedown event seen, x,y is used to figure out the scroll element
         */
        this.lastMouseDownEvent = false;

        // MOUSE MOVE
        /** the last mousemove event seen */
        this.lastMouseMoveEvent = false;
        /** What element did we start the mousemove on/from */
        this.mouseMoveStartingElement = false;

        /** there is a mouse move action still being recorded, this isn't cleared until after the mousemove has been recorded. */
        this.mouseMovePending = false;
        /** An identifier for the timeout that will record a 'mousemove' user action */
        this.pendingMouseMoveTimeout = false;

        /**
         * Hold the current/last event observed.
         * @type {Event}*/
        this.event = false

        // TIMEOUTS
        this.clearTimeouts();
        /** An identifer for the timeout that will record a 'keys' user action */
        this.pendingKeyTimeout = false;

        /** An identifer for the timeout that will record a 'wheel' user action */
        this.pendingWheelTimeout = false;

        /** An identifier for the timeout that will record a 'mousemove' user action */
        this.pendingMouseMoveTimeout = false;

        /** An identifier for the timeout that will "record" a 'wait' user action */
        this.waitActionDetectionTimeout = null;

        /** the active element on the start of a mousemove. used for error recorvery. roll back focus to this element on error. */
        this.activeElement = null;

        /** records if we are over or out of an element. if we timeout and we are out, then we cancel the record. 
         * this is supposed to be used only to detect when we move off the viewport for some reason, and not record that.
         */
        this.mousePhase = null;

        /** used to passively monitor events */
        this._debugMode = false;

        this.removeEventListeners();

        /**
         * @type {Options}
         */
        this.options = { debugRecorder: false };
    }

    constructor() {
        this.reset();

        chrome.runtime.onMessage.addListener(this._runtimeFrameIdSpecificOnMessageHandler.bind(this)); // extension sends message to one or all frames
        chrome.runtime.onConnect.addListener(this._runtimeOnConnectHandler.bind(this)); // extension will connect the port when it is time to start recording
        
        /** the css for a keyboard mouse cursor */
        this.keyboardCursor = `url(${chrome.runtime.getURL('images/keyboard.png')}) 0 0, not-allowed`;
        /** the css for a mousemove cursor */
        this.mousemoveCursor = `url(${chrome.runtime.getURL('images/mouse.png')}) 15 15, wait`;
        /** the css for a mouse wheel cursor */
        this.mousewheelCursor = `url(${chrome.runtime.getURL('images/scrolling.png')}) 15 2, auto`;
    }

    /** The user has waited long enough that we should consider that an active
     * wait action and record it.
     */
    recordWaitAction() {
        // it was cancelled/completed or something else snuck into the queue
        if (this.waitActionDetectionTimeout == null || this.messageQueue.length) {
            return;
        }
        this.waitActionDetectionTimeout = null;
        this.pushMessage({ type: 'wait' });
    }

    /**
     * If the user is "actively" doing nothing. During a recording we will
     * identify that as a wait user action. e.g. this is what the user does
     * when they wait for a hover related screen update (tooltip etc.).
     * e.g. hitting a key (e.g. [ENTER]) can kick off a navigate and they wait for the 
     * screen to settle before the next operation.
     * 
     * This should be scheduled whenever the tx queue becomes empty.
     */
    scheduleWaitActionDetection() {
        // FIXME: this is still insufficient to handle  multiple frames correctly. I originally thought of them as
        // being in a single queue, but now there are two active queues, main frame for these
        // and subframes for normal recording events.
        if (this._frameId) {
            return; // only do this from the main frame
        }

        // and schedule one for a second from now
        clearTimeout(this.waitActionDetectionTimeout);
        this.waitActionDetectionTimeout = null;
        this.waitActionDetectionTimeout = setTimeout(
            () => this.recordWaitAction(),
            1000
        );
    }

    /**
     * Cancel any scheduled wait action detection.
     */
    cancelScheduleWaitActionDetection() {
        clearTimeout(this.waitActionDetectionTimeout);
        this.waitActionDetectionTimeout = null;
    }

    /**
     * Chrome-extension API: For single one time messages . This can respond if need be.
     * These can be targeted by frameId from the extension, or broadcast to all frames.
     * https://developer.chrome.com/docs/extensions/reference/runtime/#event-onMessage
     * */
    _runtimeFrameIdSpecificOnMessageHandler(message, sender, sendResponse) {
        console.debug('connect: _runtimeFrameIdSpecificOnMessageHandler', message, sender);

        // the sender will always be the extension, since the chrome extension api
        // doesn't provide for content-script to content-script messaging. (For that
        // I need to rely on windows.postMessage.)
        switch (message.func) {
            case 'postMessageOffsetIntoIframes': // received per frameId
                this.postMessageOffsetIntoIframes();
                sendResponse();
                return;
            case 'setFrameId':
                this._frameId = message.args.to;
                sendResponse();
                break;
            case 'hideCursor':
                this.injectCssNode();
                this.hideCaret();
                sendResponse();
                break;
            case 'loadOptions':
                this.options = message.args;
                break;
            default:
                //console.warn('unknown message', message);
                sendResponse('unknown');
                break;
        }
    }

    /**
     * https://developer.chrome.com/docs/extensions/reference/runtime/#event-onConnect
     * */
    async _runtimeOnConnectHandler(port) {
        //the _only_ reason that the workspace connects to this named port is to establish a recording session
        if (!port.name.startsWith('brimstone-recorder')) {
            return;
        }
        console.debug('connect: to extension (workspace).')
        this.reset(); // be paranoid.
        this.options = (await (new Promise(resolve => chrome.storage.local.get('options', resolve)))).options;

        this.addEventListeners();
        this._port = port;

        // if the extenstion disconnects the port we reset to our dormant state.
        this._port.onDisconnect.addListener(port => {
            this.exit();
        });

        // I want to know when this page get's navigated away from
        // https://developers.google.com/web/updates/2018/07/page-lifecycle-api#events
        document.onvisibilitychange = () => {
            // https://developers.google.com/web/updates/2018/07/page-lifecycle-api#state-hidden
            if (document.visibilityState === 'hidden') {
                // the whole sequence is recorded immediately (anything before this event has already been simulated)
                this.recordKeySequence();
            }
        }

        //start listening for messages back from the workspace
        /** https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port */
        this._port.onMessage.addListener(this.rx.bind(this));
        // FIXME: can this leak handlers on multiple connects? I never remove this listener.

        // just say hi with connect, for debugging
        this.pushMessage(this.buildMsg({
            type: 'connect',
            target: document.documentElement
        }));
    }

    /**
     * Use window.postMessage to post a message into
     * each IFRAME in this document. The message will contain
     * the offset of the IFRAME element from the perspective of
     * this window.
     * The iframe will relay this information along with its
     * chrome frameID to the extension via chome.runtime.sendMessage.
     * The extension will then know all frame offsets within their
     * parent.
     */
    postMessageOffsetIntoIframes() {
        console.debug(`TX: frame ${this._frameId}:${window.location.href} broadcasts to each child frame their own offset from this frame`);
        let iframes = document.getElementsByTagName('IFRAME');
        for (let i = 0; i < iframes.length; ++i) {
            let iframe = iframes[i];
            let rect = iframe.getBoundingClientRect();
            iframe.contentWindow.postMessage(
                {
                    brimstoneRecorder: {
                        func: 'relayFrameOffsetToExtension',
                        args: {
                            top: rect.top,
                            left: rect.left
                        }
                    }
                },
                '*'
            );
        }
    }

    /**
     * Enqueue a message to send to the bristone workspace over the recording channel port.
     *
     * If there is nothing pending it will be immediated transmitted.
     *
     * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
     * Note this automatically sends the Sender (frameId) info.
     */
    pushMessage(msg) {
        this.cancelScheduleWaitActionDetection();
        this.messageQueue.push(msg);
        if (this.messageQueue.length === 1) { // was an empty queue...
            this.tx(); //... so tx it right away
        }
    }

    /**
     * Direct raw postMessage to the extension, frameId is added to message.
     */
    _postMessage(msg) {
        msg.sender = { frameId: this._frameId, href: window.location.href };
        console.debug(`TX: ${msg.type} ${msg.sender.href}`, msg);
        this._port.postMessage(msg);
    }

    /**
     * If there is something in the queue transmit (tx) it to the extention over the
     * recording channel port.
     *
     * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
     * Note this automatically sends the Sender info.
     * @returns true if anything was transmitted, false otherwise.
     */
    tx() {
        if (this.messageQueue.length) {
            let msg = this.messageQueue[0];
            this._postMessage(msg);
            return true;
        }
        return false;
    }

    /**
     * Receive (rx) message from the extension. These are either
     * acks/complete or stop messages.
     *
     */
    rx(msg) {
        if (msg.broadcast || msg.to === this._frameId) {
            console.debug(`RX: ${this._frameId} `, msg);
            switch (msg.type) {
                case 'complete':
                    this.messageQueue.shift();
                    if (msg.args === 'click') {
                        this.pendingClick = false; // now we are done that
                    }
                    if (msg.args === 'mousemove') {
                        this.mouseMovePending = false; // now we are really done
                        this.revertCursorCss();
                    }
                    if (msg.args === 'wheels') {
                        this.pendingWheelTimeout = false; // really done
                        this.revertCursorCss();
                    }
                    if (!this.tx()
                        && !this.options.debugRecorder
                        && !this.pendingKeyTimeout
                        && !this.pendingWheelTimeout
                        && !this.pendingMouseMoveTimeout) {
                        if (msg.args !== 'wait') {
                            this.pushMessage({ type: 'wait' });
                        }
                        else {
                            this.scheduleWaitActionDetection(); // the queue is empty right now, if it is still empty in 1 sec take a picture
                        }
                    }
                    // else don't  
                    break;
                case 'stop':
                    this.exit();
                    break;
            }
        }
    }

    exit() {
        this.reset();
        this.removeEventListeners(); // message too
        this.clearCss();
    }

    /** Clear any pending record detecting timeouts */
    clearTimeouts() {
        this.revertCursorCss(); 
        // FIXME: i really should only have only pending thing at a timee...
        clearTimeout(this.pendingKeyTimeout);
        clearTimeout(this.pendingWheelTimeout);
        clearTimeout(this.pendingMouseMoveTimeout);
        clearTimeout(this.waitActionDetectionTimeout);
        this.waitActionDetectionTimeout = this.pendingKeyTimeout = this.pendingWheelTimeout = this.pendingMouseMoveTimeout = null;
    }

    // FIXME: this 'e' should have a better defined type.
    buildMsg(e) {
        //console.debug('building msg from', e);

        // JSON.stringify bails as soon as it hits a circular reference, so we must project out a subset of the properties
        // rather than just augment the e object.

        let msg = {
            // properties of the message
            type: e.type,

            // e.target.getBoundingClientRect() identifies where the element is NOW. for wheel events that would be too late, so allow an overload
            boundingClientRect: e.boundingClientRect || e.target.getBoundingClientRect(),

            // properties of the event
            event: {
                type: e.type,
                target: {
                    tagName: e.target.tagName
                }
            }
        };

        switch (e.type) {
            case 'mousemove':
                msg.event.clientX = e.clientX;
                msg.event.clientY = e.clientY;
                msg.x = msg.event.clientX;
                msg.y = msg.event.clientY;
                break;
            case 'connect':
            case 'mouseover':
                msg.x = msg.boundingClientRect.x + msg.boundingClientRect.width / 2;
                msg.y = msg.boundingClientRect.y + msg.boundingClientRect.height / 2;
                break;
            case 'wait':
                break;
            case 'wheel':
                msg.event.deltaX = e.deltaX;
                msg.event.deltaY = e.deltaY;

                msg.event.altKey = e.altKey;
                msg.event.ctrlKey = e.ctrlKey;
                msg.event.metaKey = e.metaKey;
                msg.event.shiftKey = e.shiftKey;

                msg.event.clientX = e.clientX;
                msg.event.clientY = e.clientY;

                msg.x = msg.event.clientX;
                msg.y = msg.event.clientY;

                msg.handler = { simulate: true };
                break;
            case 'click':
                msg.detail = e.detail;
            case 'contextmenu':
            case 'dblclick':
                msg.x = e.clientX;
                msg.y = e.clientY;
                ['clientX', 'clientY'].forEach(p =>
                    msg.event[p] = e[p]);
                msg.handler = { simulate: true };
                if (this.options?.experiment?.includeCss) {
                    msg.css = TopLevelObject.DOMPresentationUtils.cssPath(e.target);
                }
                break;
            case 'change':
                msg.x = msg.boundingClientRect.x + msg.boundingClientRect.width / 2;
                msg.y = msg.boundingClientRect.y + msg.boundingClientRect.height / 2;
                msg.event.value = e.target.value; // specific to the change event
                break;
        }

        return msg;
    };

    /** Add event listeners to the window, some events will be passed*/
    addEventListeners(...only) {
        //console.debug('removing + adding event listeners');
        Recorder.events.filter(e => !(only?.length) || only.includes(e)).forEach(event => {
            window.removeEventListener(event, this, { capture: true, passive: false });
            window.addEventListener(event, this, { capture: true, passive: false });
        });
    }

    /** Remove previous bound event listeners */
    removeEventListeners() {
        //console.debug('removing event listeners');
        Recorder.events.forEach(event => {
            window.removeEventListener(event, this, { capture: true, passive: false });
        });
    }

    /** record a completed (ended) mousemove */
    _recordMouseMoveEnd() {
        // ending a mouse move user action.
        this.mouseMovePending = false;
        this.pendingMouseMoveTimeout = null;
        let msg = this.buildMsg(this.lastMouseMoveEvent);
        this.pushMessage(msg);
    }

    /** Pop an alert, reset what we can for the user and keep recording. */
    recoverableUserError(lastEventType = 'unknownEvent') {
        this._userError(lastEventType, true);
    }

    /** Pop an alert, end the recording and reset the workspace UI. The user will need to manually restart recording. */
    unrecoverableUserError(lastEventType = 'mousemove') {
        this._userError(lastEventType, false);
    }

    _userError(lastEventType = 'mousemove', recoverable) {
        let icon = recoverable ? '🟡' : '🛑';
        let msg = `${icon} Please wait for Brimstone to record your '${lastEventType}'' before you attempt to '${this.event.type}'.\n\n`;
        if (recoverable) {
            msg += `As soon as you hit OK you will be recording again.`;
            if (this.activeElement) {
                this.activeElement.focus(); // mousedown applies :active and there is nothing we can do to prevent it. So we recover from it.
            }
        }
        else {
            msg += `Recording stopped. Match screenshot in "Expected result" (for some step in the workspace) to what is actually showing in the app. You may need to move back a few steps in the recording to do this. Once they match click the record button to continue. This time wait for any ${lastEventType} to complete before you attempt another action.`;
            this._postMessage({ type: 'error' }); // update the workspace UI
        }
        window.alert(msg);
        let p = this._port;
        this.reset(); // flush state
        if (recoverable) {
            this._port = p; // but hang onto the port
            this.addEventListeners(); // and keep on recording
        }
        else {
            this.addEventListeners('message'); // need to keep just this one open
        }
    }

    clearPendingMouseMove() {
        this.mouseMovePending = false;
        clearTimeout(this.pendingMouseMoveTimeout);
        this.pendingMouseMoveTimeout = null;
        this.revertCursorCss();
    }

    /** Remove css I injected */
    clearCss() {
        let css = document.getElementById('brimstone-recorder-css');
        if(css) {
            css.innerText = '';
        }
    }

    /** The caret is the blinky "cursor" in a text input. In contrast the "cursor" is the mouse cursor. */
    hideCaret() {
        let css = document.getElementById('brimstone-recorder-css');
        css.innerText += 'body {caret-color: transparent;}';
    }

    /** the mousecursor */
    revertCursorCss() {
        let css = document.getElementById('brimstone-recorder-css');
        if(css) {
            css.innerText = css.innerText.replace(/\*[^\}]+\}/, '');
        }
    }

    /** the mousecursor */
    setCursorCssTo(v) {
        let css = document.getElementById('brimstone-recorder-css');
        this.revertCursorCss();
        css.innerText += `* {cursor: ${v} !important;}`;
    }
    
    injectCssNode() {
        if (document.getElementById('brimstone-recorder-css')) {
            return;
        }

        var styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.id = 'brimstone-recorder-css';
        document.head.appendChild(styleSheet);
    }

    startMouseMove(e) {
        this.lastMouseMoveEvent = e;
        clearTimeout(this.pendingMouseMoveTimeout);
        this.pendingMouseMoveTimeout = setTimeout(
            () => {
                if (!this.mouseMovePending || this.mousePhase === 'out') {
                    this.clearPendingMouseMove();
                    return;
                }

                this.clearPendingMouseMove();

                if (this.mouseMoveStartingElement !== this.lastMouseMoveEvent.target) {
                    let msg = this.buildMsg(this.lastMouseMoveEvent);
                    this.pushMessage(msg);
                }
                // else - we endedup back where we started, treat that as not moving.
            },
            this.options.mouseMoveTimeout
        );

        if (!this.mouseMovePending) {
            this.mouseMovePending = true; // a mouse move action has started
            this.mouseMoveStartingElement = e.target;
            this.pushMessage({ type: 'save-lastscreenshot' });
        }
    }

    /** Central callback for all bound event handlers */
    handleEvent(e) {
        e.brimstoneClass = e.timeStamp === SYNTHETIC_EVENT_TIMESTAMP ? 'synthetic' : 'user'; // an event simulated by brimstone
        this.event = e;
        let msg;

        if (this._debugMode) {
            return this.propagate(e); // for debugging
        }

        console.debug(`${e.type} ${e.brimstoneClass} SEEN`, e);
        // This message can't be folded into the swtich below, we receive it for any user action currently being recorded.
        if (e.type === 'message') {
            /**
             * A child (possibly x-origin) frame needs to know its
             * relative top, and left offsets.
             *
             * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
             * */
            let brimstoneRecorder = e.data.brimstoneRecorder;
            if (!brimstoneRecorder) {
                console.debug('connect: non brimstone message received', e);
                return this.propagate(e); // some other non-brimstone postedMessage into this frame. We don't care about it.
            }
            switch (brimstoneRecorder.func) {
                case 'relayFrameOffsetToExtension': // *all* children frames get this message
                    console.debug('connect: relayFrameOffsetToExtension');
                    this._postMessage({ type: 'frameOffset', func: 'frameOffset', args: brimstoneRecorder.args });
                    break;
                default:
                    console.warn('connect: bad brimstone function', e);
                    break;
            }
            /**
             * I want to eat this event, and have no-one else see it, but 'message' is not cancelable.
             * https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel/message_event
             */
            return this.cancel(e); // ..so these are pointless
        }

        if (e.brimstoneClass === 'synthetic') {
            return this.propagate(e);
        }
        // else this is a user generated event

        if (this.messageQueue.length) {
            // we are waiting on responses from the extension
            // and we are getting some more user events while we wait.

            // this is expected for events that are queued and **simulated**, and recorded in aggregate, so let expected ones go to the big recorder switch
            // for proper accounting.
            // FIXME: can't I replace all these with pending* varables
            if (this.messageQueue[0].type === 'wait' || this.mouseMovePending || this.pendingClick || e.type === 'keydown' || e.type === 'keyup' || e.type === 'wheel' || e.type === 'scroll') {
                ; // expected - these will be processed by the big recorder swtich
            }
            else {
                // it's not a queuing related event. it could be a hyper user :).
                // or or a legit untrusted event - in response to something we are simulating. (e.g. the app itself could trigger a click event to do work)
                //  https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
                // after we simulate keydown enter either way just let the app deal with it.
                return this.propagate(e);
            }
        }

        // the big recorder switch
        switch (e.type) {
            case 'mousemove':
                if (this.pendingWheelTimeout) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        // this.recoverableUserError('wheel'); // don't allow movemouse until the present wheel event is recorded
                        // return this.cancel(e);
                    }
                    else {
                        return this.propagate(e); // unless it is on the same element (fatfinger) then ignore this event
                    }
                }

                this.startMouseMove(e);
                return this.propagate(e);
            case 'mouseover':
                this.mousePhase = 'over';
                this.setCursorCssTo(this.mousemoveCursor);
                return this.propagate(e);
            case 'mouseout':
                this.mousePhase = 'out';
                  return this.propagate(e);
            case 'change':
                // this is not a direct user input, but it is (indirectly) the only way to identify
                // when a select value was changed via a user interacting in the shadow DOM (where the record cannot monitor events).
                // in this case, at this point in time the shadow DOM is closed and the value has already changed.
                if (e.target.tagName === 'SELECT') {
                    msg = this.buildMsg(e);
                    // when the shadow DOM options closes the mouse can be over some other element, which will get caught by a mouseover event

                    this.clearPendingMouseMove(); // would have to be a a fast shadow dom interaction to need to cancel it, but might as well

                    this.pushMessage(msg); // the change needs to be recorded, although it is a non-ui action
                }
                return this.propagate(e);
            case 'mousedown':
                if (this.mouseMovePending) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        // this.recoverableUserError('mousemove'); // don't click until the mousemove completes
                        // return this.cancel(e);
                    }
                    else {
                        this.clearPendingMouseMove(); // unless it is on the same element (fatfinger)
                    }
                }

                // if (this.pendingWheelTimeout) { // don't click until the present wheel event is recorded
                //     this.recoverableUserError('wheel');
                //     return this.cancel(e);
                // }

                // if (this.pendingKeyTimeout) {
                //     this.recoverableUserError('keys');
                //     return this.cancel(e);
                // }

                this.mouseDown = e; // down right now
                this.lastMouseDownEvent = e; // and hang onto it after it is not the last event
                return this.cancel(e); // recall I am going to simulate the whole click or double click, so I don't release to the app
            case 'mouseup':
                this.mouseDown = false;
                this.lastMouseMoveEvent = e;
                return this.cancel(e); // going to simulate the whole click or double click, so I don't release this to the app
            case 'wheel':

                if (this.mouseMovePending) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        // this.recoverableUserError('mousemove'); // don't allow wheel event until mousemove completed
                        // return this.cancel(e);
                    }
                    else {
                        this.clearPendingMouseMove(); // unless it is the same element (fatfinger)
                    }
                }

                clearTimeout(this.waitActionDetectionTimeout);
                this.waitActionDetectionTimeout = this.pendingMouseMoveTimeout = null;

                msg = this.buildMsg(e);
                this.wheelEventQueue.push(msg); // FIXME: should be called the wheelActionQueue

                clearTimeout(this.pendingWheelTimeout);
                this.pendingWheelTimeout = setTimeout(
                    () => {
                        clearTimeout(this.waitActionDetectionTimeout);
                        clearTimeout(this.pendingMouseMoveTimeout);
                        this.waitActionDetectionTimeout = this.pendingMouseMoveTimeout = null;

                        this._recordWheelAction();
                    },
                    this.options.mouseWheelTimeout
                );

                // https://w3c.github.io/uievents/#cancelability-of-wheel-events 
                // In a scrolling sequence I can only cancel the first one. If I "replace" it with a synthetic one
                // (generated from CDP) then it seems to confuse Chrome and I see all the non-cancelable ones in the sequence.
                // I don't want to (additionally) simulate those, since the browser is already handling them, and I can't stop it.
                if (this.wheelEventQueue.length === 1) {
                    // The first in the sequence
                    // simulate so we can lock in the pre-requisite ss
                    msg.handler.saveScreenshot = true;
                    this.setCursorCssTo(this.mousewheelCursor);
                }
                if (e.cancelable) {
                    this.pushMessage(msg); // simulate it
                    return this.cancel(e); // can only cancel the first in the sequence             
                }
                else {
                    // i'm not allowed to cancel it, so...
                    console.debug('wheel - will propagate since I can not cancel');
                    return this.propagate(e); // just watch/record them
                }
            case 'keyup':
                this.handleKey(e);
                return this.cancel(e);
            case 'keydown':
                this.mouseDown = false; // FIXME: WTF? cancel mousemove recording in process
                if (e.repeat) {
                    return;
                }

                // if (this.mouseMovePending) {
                //     this.recoverableUserError('mousemove');
                //     return this.cancel(e);
                // }

                // if (this.pendingWheelTimeout) { // don't click until the present wheel event is recorded
                //     this.recoverableUserError('wheel');
                //     return this.cancel(e);
                // }

                this.handleKey(e);
                return this.cancel(e);
            case 'keypress':
                return this.cancel(e);
            case 'contextmenu':
            case 'dblclick':
                if (this.mouseMovePending) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        // this.recoverableUserError();
                        // return this.cancel(e);
                    }
                    else {
                        this.clearPendingMouseMove();
                    }
                }

                msg = this.buildMsg(e);
                this.pushMessage(msg); // take screenshot and then simulate
                return this.cancel(e);
            case 'click':

                if (this.mouseMovePending) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        // this.recoverableUserError('mousemove');// don't allow a click until a mousemove completes
                        // return this.cancel(e);
                    }
                    else {
                        this.clearPendingMouseMove(); // unless it is the same element (fatfinger)
                    }
                }

                clearTimeout(this.waitActionDetectionTimeout);
                this.waitActionDetectionTimeout = null;

                // don't know yet if it is a single click or the first of a double click
                if (!this.pendingClick) {
                    this.pendingClick = e;
                    setTimeout(
                        () => {

                            if (this.mouseMovePending) {
                                if (this.mouseMoveStartingElement !== this.pendingClick.target) {
                                    // this.recoverableUserError('mousemove'); // don't allow a click until a mousemove completes
                                    // return;
                                }
                                else {
                                    this.clearPendingMouseMove(); // unless it is the same element (fatfinger)
                                }
                            }

                            // if (this.pendingWheelTimeout) { // don't click until the present wheel event is recorded
                            //     this.recoverableUserError('wheel');
                            //     return;
                            // }

                            // if (this.pendingKeyTimeout) {
                            //     this.recoverableUserError('keys');
                            //     return;
                            // }


                            msg = this.buildMsg(this.pendingClick);
                            this.pushMessage(msg); // take screenshot, and then simulate
                        },
                        500
                    );
                }
                else {
                    // this is the second single click within 500ms. It should generate a double click.
                    this.pendingClick = false;
                    if (e.detail != 2) {
                        //console.error('sanity check fails. got a 2nd single click within 500ms but not marked as 2nd click.')
                    }
                }
                return this.cancel(e);
            case 'mouseover': // alow these to bubble so I can see the complex hover stuff like tooltips and menus
                /** The time that the users mouse entered the current element, used to record hover effects. */
                this._mouseEnterTime = performance.now();
            case 'mouseout': // allow these to bubble so I can see the complex hover stuff like tooltips and menus
                return this.propagate(e);
            //}
            default:
                return this.propagate(e); // why block other events?
        }
    }

    /**
      * Schedule a recordKeySequence operation
      * to occur in the future.
      */
    _scheduleRecordKeySequence() {
        clearTimeout(this.pendingKeyTimeout);
        this.pendingKeyTimeout = setTimeout(
            this.recordKeySequence.bind(this),
            500 // FIXME: make configurable
        );
    }

    /**
     * If there was a key sequence in process that hasn't been recorded,
     * record it now.
     */
    recordKeySequence() {
        this.revertCursorCss();
        if (!this.keyEventQueue.length) {
            return;
        }

        clearTimeout(this.pendingKeyTimeout);
        this.pendingKeyTimeout = false;
        let rect = this.keyEventQueue[0].target.getBoundingClientRect();
        this.pushMessage({
            type: 'keys',
            boundingClientRect: rect,
            x: rect.x + rect.width / 2,
            y: rect = rect.y + rect.height / 2,
            event: this.keyEventQueue.map(e => ({
                type: e.type,
                altKey: e.altKey,
                charCode: e.charCode,
                code: e.code,
                ctrlKey: e.ctrlKey,
                key: e.key,
                keyCode: e.keyCode,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey
            }))
        });
        this.keyEventQueue = []; // FIXME: is this correct?!
    }

    /**
     * Enough time has passed without the user doing anything to record the last observed scroll event.
     * The start screen for the scroll event must already have been taken. How? Options:
     * 1. take a screenshot periodically every 500ms to refresh the last screenshot
     * 2. take a screenshot on 'other' events, that preceed the scroll event. This is hard, I cannot block the scroll action so the
     *    user must know not to scroll until after the screenshot is taken.
     *
     *      If I use some form of mousemove between recorded events to indicate the last event is done I can take a screenshot
     *      based on that. I also want a visual indicator to the user that brimstone is ready to record your next action. (i.e.) it
     *      has recorded the screen
     */
    _recordWheelAction() {
        if (!this.wheelEventQueue.length) {
            return;
        }

        let firstWheelAction = this.wheelEventQueue[0];
        let firstWheelEvent = firstWheelAction.event;

        let shift = firstWheelEvent.shiftKey ? "shift+" : '';
        let direction = '';
        if (firstWheelEvent.shiftKey) {
            if (firstWheelEvent.deltaY < 0) {
                direction = 'scroll left. ';
            }
            if (firstWheelEvent.deltaY > 0) {
                direction = 'scroll right. ';
            }
        }
        else {
            if (firstWheelEvent.deltaY < 0) {
                direction = 'scroll up. ';
            }
            if (firstWheelEvent.deltaY > 0) {
                direction = 'scroll down. ';
            }
        }

        let description = `${direction}mouse ${shift}wheel (${this.wheelEventQueue.length}x)`;

        this.pushMessage({
            type: 'wheels',
            boundingClientRect: firstWheelAction.boundingClientRect,
            // the element scrolled is under these points on the scrollbar
            x: firstWheelAction.x,
            y: firstWheelAction.y,

            event: this.wheelEventQueue,
            description
        });
        this.wheelEventQueue = [];
    }

    /**
     * Start/Continue an observed sequence of user key events to some element.
     *
     * Send a properly formatted keys message to the extension to implement
     * that. On the first keydown we take a screenshot, before we simulate.
     * We also schedule a callback in the future to send the record message
     * for the aggregate keystrokes.
     * 
     * This should work very miuch like mousemove recording, except we simulate the keystrokes to
     * give fast feedback to the user in the app.
     * 
     */
    handleKey(e) {
        this.mouseDown = false; // FIXME: WTF? cancel mousemove recording in process

        if (e.repeat) {
            return;
        }
        let record = false;
        this.keyEventQueue.push(e); // throw the key event on the end, simulate immediately, and record it later.
        if(this.keyEventQueue.length == 1) {
            this.setCursorCssTo(this.keyboardCursor);
        }
        this._scheduleRecordKeySequence();

        let rect = e.target.getBoundingClientRect();
        this.pushMessage({
            type: e.type, // simulate the down or the up in the order they are queued
            boundingClientRect: rect,
            x: rect.x + rect.width / 2,
            y: rect = rect.y + rect.height / 2,
            event: {
                type: e.type,
                altKey: e.altKey,
                charCode: e.charCode,
                code: e.code,
                ctrlKey: e.ctrlKey,
                key: e.key,
                keyCode: e.keyCode,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey
            },
            handler: {
                simulate: true
            }
        });
    }

    /**
     * The RECORDER will handle this event. It will (try to) cancel it. Try to prevent the application from seeing it. Not bubbled etc.
     * 
     * @param {Event} e 
     * @returns 
     */
    cancel(e) {
        console.debug(`EVENT ${e.type} ${e.brimstoneClass} ${e.cancelable ? '*cancelled' : '*un-cancelable'} frameId:${this._frameId} ${window.location.href}`, e);

        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        return false;
    };

    /**
     * The APPLICATION will handle event. It will be ignored by the recorder. Allowed to bubble etc.
     * @param {Event} e 
     */
    propagate(e) {
        console.debug(`EVENT ${e.type} ${e.brimstoneClass} *propagated frameId:${this._frameId} ${window.location.href}`, e);
    }

} // end class Recorder

Recorder.events = [
    // comments describe what is done when recording, not handling 'simulated' events.
    // simulated events all bubble directly to the app.

    'mousemove',    // blocked. maintains last known mouse position
    'mousedown',    // blocked. just observed, required for click to occur?.
    'mouseup',      // blocked. just observed, required for click to occur?.

    'click',        // blocked, used to detect single or double click. recorded, generates simulated events.
    'dblclick',     // blocked. recorded and generates simulated events.
    'contextmenu',  // blocked. recorded and generates simulated events.

    'keydown',      // blocked. if not Ctrl then it gets recorded and generates simulated events.
    // If Ctrl it's used to detect (significant) styles on hover, like new menus opening.
    'keypress',     // blocked. just observed.
    'keyup',        // blocked. conditionally used to detect (significant) styles on hover, like new menus opening.

    'focus',        // blocked. it changes styles. e.g. border.
    'focusin',      // blocked. it changes styles. e.g. border.
    'blur',         // blocked. it changes styles. e.g. border.
    'submit',       // blocked. this can submit a form and start a navigation and I can't have that until I am simulating.
    'invalid',      // blocked. ''
    'change',       // blocked. it changes styles. e.g. (x) on a combobox.

    'mouseout',  // block sometimes...
    'mouseover', // bubble and is used to observe and calculate hoverTime

    // https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event
    'wheel', // blocked. monitored to decide when a user performs a "complete" scroll action.

    // https://developer.mozilla.org/en-US/docs/Web/API/Element/scroll_event
    'scroll', // not cancelable

    // FIXME: I do not ever see these...WHY?
    'mouseleave',   // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
    'mouseenter',    // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.

    /**
     * The main frame needs to post into the child x-origin frames their
     * relative top, and left offsets.
     * This cannot be done with chrome extension messaging passing :(
     * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
     *
     * These are handled by the handleEvent method of this object.
     * */
    'message'
];

// create the instance
new Recorder();
