



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

    /** Used to wait and see if a sibgle click becomes a double click. */
    pendingClick = false;

    /** 
     * Hold the current/last event observed.
     * @type {Event}*/
    event;

    constructor() {
        chrome.runtime.onMessage.addListener(this._runtimeFrameIdSpecificOnMessageHandler.bind(this)); // extension sends message to one or all frames
        chrome.runtime.onConnect.addListener(this._runtimeOnConnectHandler.bind(this));
    }

    /** 
     * Chrome-extension API: For single one time messages . This can respond if neeed be.
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

        this.postMessage({ type: 'connect' });
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
     * Note this automatically sends the Sender info.
     */
    postMessage(msg) {
        this.messageQueue.push(msg);
        if (this.messageQueue.length === 1) { // was an empty queue...
            this.tx(); //... so tx it right away
        }
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
            msg.sender = { frameId: this._frameId };
            console.debug(`TX: `, msg);
            this._state = Recorder.state.SIMULATE; // FIXME: redundant to this.messageQueue.length
            this._port.postMessage(msg);
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
                type: e.type
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
                msg.x = e.clientX;
                msg.y = e.clientY;
                ['clientX', 'clientY'].forEach(p =>
                    msg.event[p] = e[p]);
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
                    this.postMessage({ type: 'frameOffset', func: 'frameOffset', args: brimstoneRecorder.args });
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
            if (e.type === 'keydown' && e.timeStamp !== 0) {
                this.handleKeyDown(e); // queue the users typing
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
                case 'wheel':
                    if (!this._wheel) {
                        this._wheel = {
                            type: 'wheel',
                            deltaX: 0,
                            deltaY: 0,

                            // This is the element that first sees the event (e.g. some div)
                            // the actual one being scrolled (e.g. window) currentTargetbeing scrolled? Or the element the scrollwheel is over, cause we scroll the big one.
                            boundingClientRect: e.target.getBoundingClientRect(), // capture that now before we scroll it away

                            clientX: e.clientX,
                            clientY: e.clientY
                        };
                        this._state === Recorder.state.BLOCK;
                        this.postMessage({ type: 'screenshot' });
                        break; // the first is (intended) to be blocked from the app, and used just to indicate start, we block other events til the screenshot is taken.
                    }
                    // subsequent wheel events in the chain are aggregated and allowed to bubble, and really scroll the app
                    this._wheel.deltaX += e.deltaX;
                    this._wheel.deltaY += e.deltaY;
                    return; // bubble
                case 'keydown':
                    this.handleKeyDown(e);
                    break; // do not execute
                case 'keyup':
                case 'keypress':
                    break; // do not execute - these should not even be seen here, they should be synthetic events.                    
                case 'contextmenu':
                case 'dblclick':
                    this.recordKeySequence();
                    this.recordWheel();

                    msg = this.buildMsg(e);
                    this.postMessage(msg); // take screenshot and then simulate 
                    break;
                case 'click':
                    // don't know yet if it is a single click or the first of a double click
                    if (!this.pendingClick) {
                        this.pendingClick = e;
                        setTimeout(() => {
                            this.recordKeySequence();
                            this.recordWheel();

                            let msg = this.buildMsg(this.pendingClick);
                            this.postMessage(msg); // take screenshot, and then simulate 
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
                    return; // let it bubble
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
        this.pendingKeyTimeout = setTimeout (
            this.recordKeySequence.bind(this),
            500 // FIXME: make configurable
        );
    }

    /**
     * If there was a key sequence in process that hasn't been recorded,
     * record it now.
     */
     recordKeySequence() {
        if(!this.keyEventQueue.length) {
            return;
        }
        
        clearTimeout(this.pendingKeyTimeout);
        let rect = this.keyEventQueue[0].target.getBoundingClientRect();
        this.postMessage({
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
     * Start/Continue an observed sequence of user key events to some element.
     * 
     * Send a properly formatted keys message to the extension to implement
     * that. On the first keydown we take a screenshot, before we simulate.
     * We also schedule a callback in the future to send the record message
     * for the aggregate keystrokes.
     * 
     * Some special handling for [ENTER] key
     */
    handleKeyDown(e) {
        let takeScreenshot = this.keyEventQueue.length === 0;
        let record = false;
        if(e.keyCode === 13) {
            if(this.keyEventQueue.length === 0) {
                // no pending key presses
                record = true; // so this enter key will be an indiviudal recorded action, ss taken before, simulated last
                // fall thro to take ss, record, then simulate the [ENTER] key by its lonesome
            }
            else {
                // there are pending keypresses
                this.keyEventQueue.push(e); // through the [ENTER} on the end
                this.recordKeySequence(); // the whole sequence is recorded (anything before the [ENTER] has already been simulated)
                // fallthru to just simulate the [ENTER]
            }
        }
        else {
            this.keyEventQueue.push(e); // through the [ENTER} on the end
       
            this._scheduleRecordKeySequence();
        }

        let rect = e.target.getBoundingClientRect();
        this.postMessage({
            type: 'keypress', // convert the keydown into a keypress, to simulate down, up and chat events
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
            this.postMessage(msg); // record a wheel action, fire and forget 
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

    //'mousemove',    // blocked. maintains last known mouse position
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
    'wheel', // blocked. monitored to decide when a user performs a "complete" scroll action. 
    // the first wheel event must take a screenshot and block all subsequent events until that's done.
    // subsequent wheel events are aggregated.
    // we decide the the user is no longer scrolling when a non-wheel user action type event occurs.
    // this records the completed scroll action.

    // https://developer.mozilla.org/en-US/docs/Web/API/Element/scroll_event
    //'scroll' // not cancelable :( 

    // FIXME: I do not ever see these...WHY? 
    //'mouseleave',   // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
    //'mouseenter'    // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
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
