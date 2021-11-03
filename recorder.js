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
     * @param {bool} removeMessageEventListener false by default
     * 
     * */
    reset() {
        /** The chrome extension frameid this instance is running in. */
        this._frameId = 0;

        /** attach this to a easter egg in the app so i can debug easily */
        this.debugging = false;

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

        /** The last scroll events seen.
         *
         */
        this.lastScrollEvents = [];

        /**
         * True if the mouse is currently down, value contains the event itself.
         */
        this.mouseDown = false;

        /**
         * Contains the last mousedown event seen, x,y is used to figure out the scroll element
         */
        this.lastMouseDownEvent = false;

        // SCROLL - scroll bar drag action
        this.boundRecordScrollAction = false

        // MOUSE MOVE
        /** the last mousemove event seen */
        this.lastMouseMoveEvent = false;
        /** What element did we start the mousemove on/from */
        this.mouseMoveStartingElement = false;
        /** there is a mouse move action still being recorded */
        this.mouseMovePending = false;

        // MOUSE WHEEL
        /** The last wheel event in the currently occuring sequence */
        this._wheel = false;

        /**
         * Hold the current/last event observed.
         * @type {Event}*/
        this.event = false

        /** The last message in the tx queue, or if the queue is empty, sent to the extension.  */
        this.lastMsg = false;

        // TIMEOUTS
        this.clearTimeouts();
        /** An identifer for the timeout that will record a 'keys' user action */
        this.pendingKeyTimeout = false;

        /** An identifer for the timeout that will record a 'scroll' user action */
        this.pendingScrollTimeout = false;

        /** An identifier for the timeout that will record a 'mousemove' user action */
        this.pendingMouseMoveTimeout = false;

        /** An identifier for the timeout that will "record" a 'wait' user action */
        this.waitActionDetectionTimeout = false;

        /** the active element on the start of a mousemove. used for error recorvery. roll back focus to this element on error. */
        this.activeElement = null;

        this.removeEventListeners();
    }

    constructor() {
        this.reset();

        chrome.runtime.onMessage.addListener(this._runtimeFrameIdSpecificOnMessageHandler.bind(this)); // extension sends message to one or all frames
        chrome.runtime.onConnect.addListener(this._runtimeOnConnectHandler.bind(this)); // extension will connect the port when it is time to start recording

        this.boundRecordScrollAction = this._recordScrollAction.bind(this);
    }

    /** The user has waited long enough that we should consider that an active
     * wait action and record it.
     */
    recordWaitAction() {
        if (!this.waitActionDetectionTimeout || this.messageQueue.length) {
            this.waitActionDetectionTimeout = null;
            return;
        }
        this.waitActionDetectionTimeout = null;
        this.lastMsg.type = 'wait'; // convert it
        this.pushMessage(this.lastMsg);
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
        this.reset(); // be paranoid.

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
     *  The extension will then know all frame offsets within their
     *parent.
     */
    postMessageOffsetIntoIframes() {
        //console.debug(`TX: frame ${ this._frameId }:${ window.location.href } broadcasts to each child frame their own offset from this frame`);
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
        this.lastMsg = msg;
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
                    }
                    if (!this.tx()) {
                        this.scheduleWaitActionDetection(); // the queue is empty right now, if it is still empty in 1 sec take a picture
                    }
                    // else we are still transmitting queued messages
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
    }

    /** Clear any pending record detecting timeouts */
    clearTimeouts() {
        // FIXME: i really should only have only pending thing at a timee...
        clearTimeout(this.pendingKeyTimeout);
        clearTimeout(this.pendingScrollTimeout);
        clearTimeout(this.pendingMouseMoveTimeout);
        clearTimeout(this.waitActionDetectionTimeout);
        this.waitActionDetectionTimeout = this.pendingKeyTimeout = this.pendingScrollTimeout = this.pendingMouseMoveTimeout = null;
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
            // case 'wheel':
            //     msg.event.deltaX = e.deltaX;
            //     msg.event.deltaY = e.deltaY;
            //     msg.event.altKey = e.altKey;
            //     msg.event.ctrlKey = e.ctrlKey;
            //     msg.event.metaKey = e.metaKey;
            //     msg.event.shiftKey = e.shiftKey;
            //     msg.event.clientX = e.clientX;
            //     msg.event.clientY = e.clientY;

            //     msg.x = msg.event.clientX;
            //     msg.y = msg.event.clientY;
            //     msg.handler = { simulate: true };
            //     break;
            case 'click':
                msg.detail = e.detail;
            case 'contextmenu':
            case 'dblclick':
                msg.x = e.clientX;
                msg.y = e.clientY;
                ['clientX', 'clientY'].forEach(p =>
                    msg.event[p] = e[p]);
                msg.handler = { simulate: true };
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
    recoverableUserError(lastEventType = 'mousemove') {
        this._userError(lastEventType, true);
    }

    /** Pop an alert, end the recording and reset the workspace UI. The user will need to manually restart recording. */
    unrecoverableUserError(lastEventType = 'mousemove') {
        this._userError(lastEventType, false);
    }

    _userError(lastEventType = 'mousemove', recoverable) {
        let icon = recoverable ? '🟡' : '🛑';
        let msg = `${icon} Please wait for Brimstone to record your ${lastEventType} before you attempt to '${this.event.type}'.\n\n`;
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
    }

    startMouseMove(e) {
        this.lastMouseMoveEvent = e;
        clearTimeout(this.pendingMouseMoveTimeout);
        this.pendingMouseMoveTimeout = setTimeout(
            () => {
                if (!this.mouseMovePending) {
                    return;
                }

                this.clearPendingMouseMove();

                if (this.mouseMoveStartingElement !== this.lastMouseMoveEvent.target) {
                    let msg = this.buildMsg(this.lastMouseMoveEvent);
                    this.pushMessage(msg);
                }
                // else - we endedup back where we started, treat that as not moving.
            },
            500 // FIXME: make configurable
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
        //return Recorder.propagate(e); // for debugging

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
                return Recorder.propagate(e); // some other non-brimstone postedMessage into this frame. We don't care about it.
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
            return Recorder.cancel(e); // ..so these are pointless
        }

        if (e.brimstoneClass === 'synthetic') {
            return Recorder.propagate(e);
        }
        // else this is a user generated event

        if (this.messageQueue.length) {
            // we are waiting on responses from the extension
            // and we are getting some more user events while we wait.

            // this is expected for events that are queued and simulated, and recorded in aggregate, so let expected ones go to the big recorder switch
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
                return Recorder.propagate(e);
            }
        }

        // the big recorder switch
        switch (e.type) {
            case 'mousemove':
                this.startMouseMove(e);
                return Recorder.propagate(e);
            case 'mouseover':
            case 'mouseout':
                return Recorder.propagate(e);
            case 'change':
                // this is not a direct user input, but it is (indirectly) the only way to identify
                // when a select value was changed via a user interacting in the shadow DOM (where the record cannot monitor events).
                // in this case, at this point in time the shadow DOM is closed and the value has already changed.
                if (e.target.tagName === 'SELECT') {
                    let msg = this.buildMsg(e);
                    // when the shadow DOM options closes the mouse can be over some other element, which will get caught by a mouseover event
                    
                    this.clearPendingMouseMove(); // would have to be a a fast shadow dom interaction to need to cancel it, but might as well
                    
                    this.pushMessage(msg); // the change needs to be recorded, although it is a non-ui action
                }
                return Recorder.propagate(e);
            case 'mousedown':
                if (this.mouseMovePending) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        this.recoverableUserError();
                        return Recorder.cancel(e);
                    }
                    else {
                        this.clearPendingMouseMove();
                    }
                }

                this._recordScrollAction(); // terminate any pending scroll actions

                this.mouseDown = e; // down right now
                this.lastMouseDownEvent = e; // and hang onto it after it is not the last event
                return Recorder.cancel(e); // recall I am going to simulate the whole click or double click, so I don't release to the app
            case 'mouseup':
                this.mouseDown = false;
                this.lastMouseMoveEvent = e;
                return Recorder.cancel(e); // going to simulate the whole click or double click, so I don't release this to the app
            case 'scroll':
                clearTimeout(this.waitActionDetectionTimeout);
                this.waitActionDetectionTimeout = this.pendingMouseMoveTimeout = null;

                let element = e.target === document ? document.documentElement : e.target;
                // FIXME: could make sure the elements for mouse down scrolltarget are the same too
                this.lastScrollEvents.push({ element: element, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }); // just the last one
                clearTimeout(this.pendingScrollTimeout);
                this.pendingScrollTimeout = setTimeout(
                    () => {
                        clearTimeout(this.waitActionDetectionTimeout);
                        clearTimeout(this.pendingMouseMoveTimeout);
                        this.waitActionDetectionTimeout = this.pendingMouseMoveTimeout = null;

                        this._recordScrollAction();
                        this.scheduleWaitActionDetection(); // the user can hang around after one of these, waiting for hover effects
                    },
                    500 // FIXME: make configurable
                );
                return Recorder.propagate(e); // not cancellable anyway (i.e cannot preventDefault actions) (wheel event generated)
            case 'wheel':
                if (this.mouseMovePending) {
                    this.unrecoverableUserError();
                    return Recorder.cancel(e);
                }

                if (!this.wheel) {
                    // hang onto the first one to record the mouse location, since there isn't an explicit mouse location with scroll events
                    this._wheel = e;
                }
                clearTimeout(this.waitActionDetectionTimeout);
                this.waitActionDetectionTimeout = this.pendingMouseMoveTimeout = null;

                return Recorder.propagate(e);
            case 'keydown':
            case 'keyup':
                this._recordScrollAction(); // terminate any pending scroll actions

                this.handleKey(e);
                return Recorder.cancel(e);
            case 'keypress':
                return Recorder.cancel(e);
            case 'contextmenu':
            case 'dblclick':
                if (this.mouseMovePending) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        this.recoverableUserError();
                        return Recorder.cancel(e);
                    }
                    else {
                        this.clearPendingMouseMove();
                    }
                }

                this.recordKeySequence(); // teminate and pending keys
                this._recordScrollAction(); // terminate any pending scroll actions

                msg = this.buildMsg(e);
                this.pushMessage(msg); // take screenshot and then simulate
                return Recorder.cancel(e);
            case 'click':
                if (this.mouseMovePending) {
                    if (this.mouseMoveStartingElement !== e.target) {
                        this.recoverableUserError();
                        return Recorder.cancel(e);
                    }
                    else {
                        this.clearPendingMouseMove();
                    }
                }

                clearTimeout(this.waitActionDetectionTimeout);
                this.waitActionDetectionTimeout = null;

                // don't know yet if it is a single click or the first of a double click
                if (!this.pendingClick) {
                    this.pendingClick = e;
                    setTimeout(() => {
                        if (this.mouseMovePending) {
                            if (this.mouseMoveStartingElement !== this.pendingClick.target) {
                                this.recoverableUserError(); // and you are on a differnet element that you started the mousemove on
                                return;
                            }
                            else {
                                this.clearPendingMouseMove();
                            }
                        }

                        this.recordKeySequence(); // teminate any pending keys
                        this._recordScrollAction(); // terminate any pending scroll actions

                        let msg = this.buildMsg(this.pendingClick);
                        this.pushMessage(msg); // take screenshot, and then simulate
                    }, 500);
                }
                else {
                    // this is the second single click within 500ms. It should generate a double click.
                    this.pendingClick = false;
                    if (e.detail != 2) {
                        //console.error('sanity check fails. got a 2nd single click within 500ms but not marked as 2nd click.')
                    }
                }
                return Recorder.cancel(e);
            case 'mouseover': // alow these to bubble so I can see the complex hover stuff like tooltips and menus
                /** The time that the users mouse entered the current element, used to record hover effects. */
                this._mouseEnterTime = performance.now();
            case 'mouseout': // allow these to bubble so I can see the complex hover stuff like tooltips and menus
                return Recorder.propagate(e);
            //}
            default:
                return Recorder.propagate(e); // why block other events?
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
            }))
            // handler: {
            //     record: true, // no simulate, because we already did on each individual
            // }
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
        let x, y;
        if (this._wheel) {
            // hovering and using wheel
            x = this._wheel.clientX;
            y = this._wheel.clientY;
        }
        else {
            // dragging a scrollbar? use the wheel man!
            if (!this.mouseDown) {
                console.log('ignoring unanticipated (programatically triggered?) scroll event');
                return;
            }
            x = this.lastMouseDownEvent.x;
            y = this.lastMouseDownEvent.y;
        }

        let element = getScrollParent(document.elementFromPoint(x, y));
        let scrollLeft = null, scrollTop = null; // be undefined

        if (this.lastScrollEvents.length > 1) {
            let prevItem = this.lastScrollEvents[0];
            if (prevItem.scrollTop !== item.scrollTop) {
                scrollTop = item.scrollTop;
            }
            if (prevItem.scrollLeft !== item.scrollLeft) {
                scrollLeft = item.scrollLeft;
            }
            // FIXME: what if neither?
        }
        else {
            scrollTop = item.scrollTop;
            scrollLeft = item.scrollLeft;
        }

        let description = '';
        if (scrollTop !== null) {
            description = this._wheel ? 'mouse wheel ' : 'drag ';
            description += `v-scroll ${scrollTop}px`;
        }
        if (scrollLeft !== null) {
            if (scrollTop !== null) {
                description += ', ';
            }
            description += this._wheel ? 'mouse shift+wheel ' : 'drag ';
            description += `h-scroll ${scrollLeft}px`;
        }
        this._wheel = null;

        clearTimeout(this.pendingScrollTimeout);
        this.pendingScrollTimeout = false;
        let rect = element.getBoundingClientRect();
        this.pushMessage({
            type: 'scroll',
            boundingClientRect: rect,
            // the element scrolled is under these points on the scrollbar
            x: x,
            y: y,
            event: {
                type: 'scroll',
                scrollTop: scrollTop,
                scrollLeft: scrollLeft
            },
            handler: {
                record: true
            },
            description: description
        });
        this.lastScrollEvents = [];
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

Recorder.cancel = function cancel(e) {
    console.debug(`${e.type} ${e.brimstoneClass} ${e.cancelable ? '*cancelled' : '*un-cancelable'}`, e);

    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    return false;
};

Recorder.propagate = function propagate(e) {
    console.debug(`${e.type} ${e.brimstoneClass} *propagated`, e);
}

// create the instance
new Recorder();
