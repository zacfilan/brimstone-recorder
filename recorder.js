
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


/**
 * Recorder class: queuue events that are triggered in response to certain user actions, 
 * and send them back over the postMessage connection to the UI.
 */
class Recorder {
    /** The chrome extension frameid this instance is running in. */
    _frameId = 0;

    /** Two way communication with the workspace */
    _port;

    /**
     * Messages to the extension are queued up here.
     * @type {Event[]}
     */
    messageQueue = [];

    /**
     * Make key press recording perform well by bundling key events.
     * @type {Event[]} 
     */
    keyEventQueue = [];

    /** are we currently expecting events to only come in from the debugger */
    _state = Recorder.state.READY;

    /** Used to wait and see if a single click becomes a double click. */
    pendingClick = false;

    /** The last scroll events seen.
     * 
     */
    lastScrollEvents = [];

    /**
     * True if the mouse is currently down, value contains the event itself.
     */
    mouseDown = false;

    /** An identifer for the timeout that will record a scroll action */
    pendingScrollTimeout;

    boundRecordScrollAction;

    /** An identifier for the timeout that will record a mouse move action */
    boundMouseMoveTimeoutAction;
    /** the last mouse move event seen */
    lastMouseMoveEvent;

    /** 
     * Hold the current/last event observed.
     * @type {Event}*/
    event;

    constructor() {
        chrome.runtime.onMessage.addListener(this._runtimeFrameIdSpecificOnMessageHandler.bind(this)); // extension sends message to one or all frames
        chrome.runtime.onConnect.addListener(this._runtimeOnConnectHandler.bind(this));
        this.boundRecordScrollAction = this._recordScrollAction.bind(this);
        this.boundMouseMoveTimeoutAction = this._recordMouseMoveAction.bind(this);
    }

    hideCursor() {
        if (document.getElementById('brimstone-recorder-css')) {
            return;
        }

        var styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = 'body {caret-color: transparent;}';
        styleSheet.id = 'brimstone-recorder-css';
        document.head.appendChild(styleSheet);
    }

    /** 
     * Chrome-extension API: For single one time messages . This can respond if need be.
     * These can be targeted by frameId from the extension, or broadcast to all frames.
     * https://developer.chrome.com/docs/extensions/reference/runtime/#event-onMessage  
     * */
    _runtimeFrameIdSpecificOnMessageHandler(message, sender, sendResponse) {
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
                this.hideCursor();
                sendResponse();
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
    _runtimeOnConnectHandler(port) {
        //the _only_ reason that the workspace connects to this named port is to establish a recording session
        if (port.name !== 'brimstone-recorder') {
            return;
        }

        this.addEventListeners();
        this._port = port;

        this._port.onDisconnect.addListener(port => {
            this.exit();
        });

        //start listening for messages back from the workspace
        /** https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port */
        this._port.onMessage.addListener(this.rx.bind(this));

        /** 
         * The main frame needs to post into the child x-origin frames their
         * relative top, and left offsets. 
         * This cannot be done with chrome extension messaging passing :(
         * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
         * 
         * These are handled by the handleEvent method of this object.
         * */
        window.removeEventListener("message", this, { capture: true, passive: false });
        window.addEventListener("message", this, { capture: true, passive: false });

        this.pushMessage({ type: 'connect' });
    }

    /**
     * Use window.postMessage to post a message into
     * each IFRAME in this document. The message will contain
     * the offset of the IFRAME element from the perspective of
     * this window.
     * The iframe will relay this information along with its
     * chrome frameID to the extension via chome.runtime.sendMessage.
     *  The extension will then know all frame offsets within their
     *parent. 
     */
    postMessageOffsetIntoIframes() {
        //console.debug(`TX: frame ${this._frameId}:${window.location.href} broadcasts to each child frame their own offset from this frame`);
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
        this.messageQueue.push(msg);
        if (this.messageQueue.length === 1) { // was an empty queue...
            this.tx(); //... so tx it right away
        }
    }

    /**
     * Direct raw postMessage to the extension, frameId is added to message.
     */
    _postMessage(msg) {
        msg.sender = { frameId: this._frameId };
        console.debug(`TX: `, msg);
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
            this._state = Recorder.state.SIMULATE; // FIXME: redundant to this.messageQueue.length
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
            console.debug(`RX: ${this._frameId}`, msg);
            switch (msg.type) {
                case 'complete':
                    // FIXME: eventually compare sequence or id numbers for sanity
                    // if(msg.id !== this.messageQueue[0].id) {
                    //     console.error('unexpected id');
                    //     break;
                    // }
                    this.messageQueue.shift();
                    if (!this.tx()) {
                        this._state = Recorder.state.READY;
                    }
                    // else we are still transmitting queued messages
                    break;
                case 'stop':
                    this.exit();
                    break;
            }
        }
    }

    /** Clean up */
    exit() {
        //console.debug('exit called');
        this.removeEventListeners();
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
            case 'wheel':
                msg.detail = 'wheel';
                msg.deltaX = e.deltaX;
                msg.deltaY = e.deltaY;
                msg.x = e.clientX;
                msg.y = e.clientY;
                break;
            case 'click':
                msg.detail = e.detail;
            case 'contextmenu':
            case 'dblclick':
                msg.hoverTime = performance.now() - this._mouseEnterTime;
                if (msg.hoverTime > 5000) {
                    msg.hoverTime = 5000;
                    //console.warn("hover time is limited to 5 seconds");
                }
                msg.x = e.clientX;
                msg.y = e.clientY;
                ['clientX', 'clientY'].forEach(p =>
                    msg.event[p] = e[p]);
                break;
            case 'mousemove':
                msg.x = e.x;
                msg.y = e.y;
                ['clientX', 'clientY'].forEach(p =>
                    msg.event[p] = e[p]);
                msg.handler = {
                    record: true // no simulate, no screenshots.
                };
                break;
            case 'chord':
                msg.x = msg.boundingClientRect.x + msg.boundingClientRect.width / 2;
                msg.y = msg.boundingClientRect.y + msg.boundingClientRect.height / 2;
                msg.keysDown = [];
                msg.keysUp = [];
                for (let i = 0; i < this.keysDown.length; ++i) {
                    let keyDownEvent = this.keysDown[i];
                    let keyUpEvent = this.keysUp[i];
                    let down = {};
                    let up = {};
                    ['altKey', 'charCode', 'code', 'ctrlKey', 'key', 'keyCode', 'metaKey', 'shiftKey'].forEach(p => {
                        down[p] = keyDownEvent[p];
                        up[p] = keyUpEvent[p];
                    });
                    msg.keysDown.push(down);
                    msg.keysUp.push(up);
                }
                break;
            case 'change':
                msg.x = msg.boundingClientRect.x + msg.boundingClientRect.width / 2;
                msg.y = msg.boundingClientRect.y + msg.boundingClientRect.height / 2;
                msg.handler = {
                    takeScreenshot: false, // use the last taken, as the correct state
                    record: true,
                    simulate: false
                };
                msg.event.value = e.target.value; // specific to the change event
                break;
        }

        return msg;
    };

    /** Add event listeners to the window, some events will be passed*/
    addEventListeners() {
        //console.debug('removing + adding event listeners');
        Recorder.events.forEach(event => {
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

    /** Central callback for all bound event handlers */
    handleEvent(e) {
        console.debug(`${e.type} frame ${this._frameId}:${window.location.href} handle ${e.timeStamp === 0 ? 'SYNTHETIC' : 'user'} event:`, e);
        this.event = e;

        /** 
         * A child (possibly x-origin) frame needs to know its
         * relative top, and left offsets.
         * 
         * https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
         * */
        if (e.type === 'message') {
            let brimstoneRecorder = e.data.brimstoneRecorder;
            if (!brimstoneRecorder) {
                return; // some other non-brimstone postedMessage into this frame. We don't care about it.
            }
            switch (brimstoneRecorder.func) {
                case 'relayFrameOffsetToExtension': // *all* children frames get this message
                    this._postMessage({ type: 'frameOffset', func: 'frameOffset', args: brimstoneRecorder.args });
                    break;
            }

            /**
             * I want to eat this event, and have no-one else see it, but 'message' is not cancelable.
             * https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel/message_event
             */
            Recorder.block(e); // does nothing :(
            return false;
        }

        if (this._state === Recorder.state.BLOCK) {
            Recorder.block(e);
            return false;
        }

        // if we are done driving the browser (simulating a user input) 
        // wait for the next user input before we start blocking events.
        // e.g. a click changes the screen, the app may give focus to some new element text box,
        // I do not want to lose this state when I take the prereq screenshot for the next action, so I cannot block that focus event.
        // I wait for a user action to indicate that the screen is ready, and now it's okay to start blocking subsequent events
        // while I decode the users next action.
        if (this._state === Recorder.state.READY) {
            switch (e.type) {
                case 'wheel':
                case 'mousemove':
                case 'mousedown':
                case 'contextmenu':
                case 'keydown':
                case 'change':
                case 'scroll':
                    this._state = Recorder.state.RECORD;
                    //console.debug(`${e.type} ${window.location.href}} switches us to RECORD state`);
                    break;
                case 'mouseover':
                    this._mouseEnterTime = performance.now(); // keep on accounting
                    return;
                default:
                    // mouse move clutters things up
                    //console.debug(`${e.type} ${window.location.href} passthru while waiting for user input event to switch us to record`);
                    return;
            }
        }

        if (this._state === Recorder.state.SIMULATE) {
            // how do I know this event came from the debugger versus from from the user?! perhaps this?
            // https://bugs.chromium.org/p/chromium/issues/detail?id=746690&q=setIgnoreInputEvents&can=2

            // I send a timestamp of 0 on synthetic events to distingush them from user events
            if ((e.type === 'keydown' || e.type === 'keyup') && e.timeStamp !== 0) {
                this.handleKey(e); // queue the users typing
                Recorder.block(e);
                return false;
            }
            else {
                // FIXME: timestamp the other events with 0 when I see the need.              
                // console.debug(`${e.type} ${window.location.href} ${e.timeStamp} simulated`, e.target, e);
            }
        }
        else {
            let msg;
            switch (e.type) {
                case 'mousemove':
                    if (this.mouseDown || this.pendingClick) {
                        return; //bubble
                    }
                    this.lastMouseMoveEvent = e;
                    if (!this.pendingMouseMoveTimeout) {
                        // first. take a screenshot now.
                        this.pushMessage({
                            type: 'mousemove',
                            x: e.x, // these are the mouse coordinates
                            y: e.y, // these are the mouse coordinates
                            event: {
                                type: e.type
                            },
                            handler: {
                                takeScreenshot: true,
                                //simulate: true, // just drop it i guess
                                record: false
                            }
                        });
                    }
                    clearTimeout(this.pendingMouseMoveTimeout);
                    this.pendingMouseMoveTimeout = setTimeout(
                        this.boundMouseMoveTimeoutAction,
                        500 // FIXME: make configurable
                    );
                    return; // bubble
                case 'change':
                    // handle select elements that update their value by user interacting, e.g. clicking, in the shadow DOM options, where we cannot see these events.
                    // at this point in time the shadow DOM is closed and the value has already changed.
                    if (e.target.tagName === 'SELECT') {
                        let msg = this.buildMsg(e);
                        this.pushMessage(msg);
                    }
                    return; // bubble it
                case 'mousedown':
                    this.mouseDown = e;
                    if (this.pendingMouseMoveTimeout) {
                        clearTimeout(this.pendingMouseMoveTimeout);
                        this.pendingMouseMoveTimeout = null;
                    }
                    break; // block?
                case 'mouseup':
                    this.mouseDown = false;
                    break;
                case 'scroll':
                    console.log(e.target.scrollLeft);
                    if (this.mouseDown) { // only record scroll event when the user is moving the slider with the mouse
                        let element = e.target === document ? document.documentElement : e.target;
                        // FIXME: could make sure the elements for mouse down scrolltarget are the same too
                        this.lastScrollEvents.push({ element: element, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }); // just the last one
                        clearTimeout(this.pendingScrollTimeout);
                        this.pendingScrollTimeout = setTimeout(
                            this.boundRecordScrollAction,
                            500 // FIXME: make configurable
                        );
                    }
                    return; // cannot be cancelled anyway - but when this is recorded it needs
                case 'keydown':
                case 'keyup':
                    this.handleKey(e);
                    break; // do not execute
                case 'keypress':
                    break; // do not execute - these should not even be seen here, they should be synthetic events only.                    
                case 'contextmenu':
                case 'dblclick':
                    this.recordKeySequence();
                    this.recordWheel();
                    msg = this.buildMsg(e);
                    this.pushMessage(msg); // take screenshot and then simulate 
                    break;
                case 'click':
                    // don't know yet if it is a single click or the first of a double click
                    if (!this.pendingClick) {
                        this.pendingClick = e;
                        setTimeout(() => {
                            this.recordKeySequence();
                            this.recordWheel();
                            let msg = this.buildMsg(this.pendingClick);
                            this.pushMessage(msg); // take screenshot, and then simulate 
                            this.pendingClick = false;
                        }, 500);
                    }
                    else {
                        // this is the second single click within 500ms. It should generate a double click.
                        this.pendingClick = false;
                        if (e.detail != 2) {
                            //console.error('sanity check fails. got a 2nd single click within 500ms but not marked as 2nd click.')
                        }
                    }
                    break;

                // these will bubble (via the early return)
                case 'mouseover': // alow these to bubble so I can see the complex hover stuff like tooltips and menus
                    /** The time that the users mouse entered the current element, used to record hover effects. */
                    this._mouseEnterTime = performance.now();
                case 'mouseout': // allow these to bubble so I can see the complex hover stuff like tooltips and menus
                    return; // bubble
            }
            Recorder.block(e);
            return false; // should be redundant and not needed, I am blocking all these I hope
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
        if (!this.keyEventQueue.length) {
            return;
        }

        clearTimeout(this.pendingKeyTimeout);
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
            })),
            handler: {
                record: true, // no simulate, no screenshots.
            }
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
    _recordScrollAction() {
        if (!this.lastScrollEvents.length) {
            return;
        }

        let item = this.lastScrollEvents[this.lastScrollEvents.length - 1];
        let element = item.element;
        let scrollLeft = null, scrollTop = null; // be undefined

        if (this.lastScrollEvents.length > 1) {
            let prevItem = this.lastScrollEvents[this.lastScrollEvents.length - 2];
            if (prevItem.scrollTop !== item.scrollTop) {
                scrollTop = item.scrollTop;
            }
            if (prevItem.scrollLeft !== item.scrollLeft) {
                scrollLeft = item.scrollLeft;
            }
        }
        else {
            scrollTop = item.scrollTop;
            scrollLeft = item.scrollLeft;
        }

        clearTimeout(this.pendingScrollTimeout);
        let rect = element.getBoundingClientRect();
        this.pushMessage({
            type: 'scroll',
            boundingClientRect: rect,
            x: rect.x + rect.width / 2,
            y: rect = rect.y + rect.height / 2,
            event: {
                type: 'scroll',
                // x,y is not going to suffice in general for this I believe
                css: TopLevelObject.DOMPresentationUtils.cssPath(element),
                scrollTop: scrollTop,
                scrollLeft: scrollLeft
            },
            handler: {
                record: true, // no simulate, no screenshots.
            }
        });
        this.lastScrollEvents = [];
    }

    /**
     * The user has paused long enough to have the mousemove operation recorded.
     */
    _recordMouseMoveAction() {
        if (!this.pendingMouseMoveTimeout) {
            return;
        }
        clearTimeout(this.pendingScrollTimeout);
        this.pendingMouseMoveTimeout = null;
        this.pushMessage(this.buildMsg(this.lastMouseMoveEvent));
    };

    /**
     * Start/Continue an observed sequence of user key events to some element.
     * 
     * Send a properly formatted keys message to the extension to implement
     * that. On the first keydown we take a screenshot, before we simulate.
     * We also schedule a callback in the future to send the record message
     * for the aggregate keystrokes.
     * 
     * Some special handling for [ENTER] key
     */
    handleKey(e) {
        this.mouseDown = false; // cancel mousemove recording in process
        if (e.repeat) {
            return;
        }

        let takeScreenshot = this.keyEventQueue.length === 0 && e.type === 'keydown';
        let record = false;

        if (e.keyCode === 13) {
            if (e.type === 'keydown') {
                if (this.keyEventQueue.length === 0) {
                    // no pending key presses
                    record = true; // so this enter key down event will be an indiviudal recorded action, ss taken before, simulated last
                    // fall thro to take ss, record, then simulate the [ENTER] key by its lonesome
                }
                else {
                    // there are pending key events
                    this.keyEventQueue.push(e); // throw the [ENTER] keydown event on the end
                    this.recordKeySequence(); // the whole sequence is recorded immediately (anything before this event has already been simulated)
                    // fallthru to just simulate the [ENTER] key event
                }
            }
            else {
                // keyup enter
                takeScreenshot = false; // just fall thru to simulate it, no ss, no record
            }
        }
        else {
            // not when the only thing that would be in the queue is a single keyup
            // related to enter key handling. 1 down, enter down is meant to clear the queue, but if I let go of 1 late, it gets in the queue, which 
            // is unintentional. i.e. don't add a keyup to a flushed (empty) queue
            if (this.keyEventQueue.length !== 0 || e.type === 'keydown') {
                this.keyEventQueue.push(e); // throw the key event on the end, simulate immediately, and record it later.
                this._scheduleRecordKeySequence();
            }
        }

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
                takeScreenshot: takeScreenshot,
                record: record, // enter can navigate to another page, where we lose this recorders context, so we need to force the recording of this key
                simulate: true
            }
        });
    }

    /**
     * If there are buffered wheel events, formally record the wheel action.
     */
    recordWheel() {
        if (this._wheel) {
            // any (other) user input signals the end of a scroll input
            let msg = this.buildMsg(this._wheel);
            this.pushMessage(msg); // record a wheel action, fire and forget 
            this._wheel = false;
        }
    }
} // end class Recorder

Recorder.state = {
    /** we are recording, some events are intercepted and blocked, some bubble */
    RECORD: 0,

    /** we are simulating (driving the browser programmatically) and letting all events through. Everything bubbles. */
    SIMULATE: 1,

    /** we are ready to start recording (again), but need a user input before we block events */
    READY: 2,

    /** we are blocking everything. let nothing bubble. */
    BLOCK: 3
};

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

    //'mouseout', // not used
    'mouseover', // bubble and is used to observe and calculate hoverTime

    // https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event
    //'wheel', // blocked. monitored to decide when a user performs a "complete" scroll action. 
    // the first wheel event must take a screenshot and block all subsequent events until that's done.
    // subsequent wheel events are aggregated.
    // we decide the the user is no longer scrolling when a non-wheel user action type event occurs.
    // this records the completed scroll action.

    // https://developer.mozilla.org/en-US/docs/Web/API/Element/scroll_event
    'scroll', // not cancelable 

    // FIXME: I do not ever see these...WHY? 
    'mouseleave',   // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
    'mouseenter'    // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
];

Recorder.block = function block(e) {
    if (e.type !== 'mousemove') { // these saturate the logs
        //console.debug(`${e.type} ${window.location.href} blocking event: ${e.type}`, e.target, e);
    }
    else {
        //console.debug(`${e.type} ${window.location.href} blocked event`);
    }

    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
};

// create the instance
new Recorder();
