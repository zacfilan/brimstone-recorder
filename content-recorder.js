(function () {
    if (window.brimstomeRecorder !== undefined) {
        console.warn(`content-recorder.js is already injected into ${window.location.href}`);
        return;
    }

    chrome.storage.local.get(["injectedArgs"], (result) => {
        let expectedUrl = result.injectedArgs.url;
        let actualUrl = window.location.href;

        /** Used to wait and see if a sibgle click becomes a double click. */
        let pendingClick;

        if (expectedUrl !== actualUrl) {
            console.error(`NOT injecting script, expected url to be\n${expectedUrl}\nactual\n${actualUrl}`);
            return;
        }
        console.debug(`Injecting content-recorder.js into ${window.location.href}`);

        // create it
        console.debug('Creating new recorder');
        /**
         * Queue events that are triggered in response to certain user actions, 
         * and send them back over the postMessage connection to the UI.
         */
        class Recorder {
            constructor() {
                /** The keys that have been pressed down in the current chord. */
                this.keysDown = [];

                /** The keys that have been released up in the current chord. */
                this.keysUp = [];

                /** Two way communication with the UI. */
                this.port;

                /** are we currently expecting events to only come i from the debugger */
                this._state = Recorder.state.READY;

                console.debug('connecting port');
                this.port = chrome.runtime.connect({ name: "brimstone" });
                this.port.postMessage({ type: 'hello' });
                this.addEventListeners();

                let that = this;
                this.port.onDisconnect.addListener((port) => {
                    that.exit();
                });

                // start listening for messages back from the popup
                this.port.onMessage.addListener((msg) => {
                    console.debug('RX: ', msg);
                    switch (msg.type) {
                        case 'complete':
                            this._state = Recorder.state.READY;
                            break;
                        case 'stop':
                            this.exit();
                            break;
                        case 'start':
                            this.port.postMessage({ type: 'hello' });
                            this.addEventListeners();
                            break;
                    }
                });
            }


            /** Clean up */
            exit() {
                console.debug('exit called');
                this.removeEventListeners();
            }

            buildMsg(e) {
                console.debug('building msg from', e);

                // JSON.stringify bails as soon as it hits a circular reference, so we must project out a subset of the properties
                // rather than just augment the e object.
                let msg = {
                    // properties of the message
                    type: e.type,
                    boundingClientRect: e.target.getBoundingClientRect(),

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
                            console.warn("hover time is limited to 5 seconds");
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
                    case 'keydown':
                        ['altKey', 'charCode', 'code', 'ctrlKey', 'key', 'keyCode', 'metaKey', 'shiftKey'].forEach(p =>
                            msg.event[p] = e[p]);
                        msg.x = msg.boundingClientRect.x + msg.boundingClientRect.width / 2;
                        msg.y = msg.boundingClientRect.y + msg.boundingClientRect.height / 2;
                        msg.type = 'keypress'; // keydown events will be emitted as keypress msgs eventually
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
                console.debug('removing + adding event listeners');
                Recorder.events.forEach(event => {
                    window.removeEventListener(event, this, { capture: true });
                    window.addEventListener(event, this, { capture: true });
                });
            }

            /** Remove previous bound event listeners */
            removeEventListeners() {
                console.debug('removing event listeners');
                Recorder.events.forEach(event => {
                    window.removeEventListener(event, this, { capture: true });
                });
            }

            /** Central callback for all bound event handlers */
            handleEvent(e) {
              //  console.debug(`handle user input event: ${e.type}`, e);

                if (this._state === Recorder.state.BLOCK) {
                    Recorder.block(e);
                    return false;
                }

                // if we are done driving the browser (simulating a user input) 
                // wait for the next user input before we start blocking events.
                if (this._state === Recorder.state.READY) {
                    switch (e.type) {
                        case 'wheel':
                        case 'mousemove':
                        case 'mousedown':
                        case 'contextmenu':
                        case 'keydown':
                            this._state = Recorder.state.RECORD;
                            console.debug(`user input event: ${e.type} switches us to RECORD state`);
                            break;
                        case 'mouseover':
                            this._mouseEnterTime = performance.now(); // keep on accounting
                            return;
                        default:
                            // mouse move clutters things up
                            console.debug(`passthru event: ${e.type} while waiting for user input event to switch us to record`);
                            return;
                    }
                }

                if (this._state === Recorder.state.SIMULATE) {
                    // FIXME: how do I know this event came from the debugger versus from from the user?!
                    // FIXME: There is a race condition here!!                
                    console.debug(`${e.timeStamp} simulated event: ${e.type}`, e.target, e);
                }
                else {
                    let msg;
                    switch (e.type) {
                        case 'wheel':
                            if (!this._wheel) {
                                this._wheel = {
                                    type: 'wheel',
                                    deltaX: e.deltaX,
                                    deltaY: e.deltaY,
                                    target: e.target,
                                    clientX: e.clientX,
                                    clientY: e.clientY
                                };
                                this._state === Recorder.state.BLOCK;
                                this.port.postMessage({ type: 'screenshot' });
                                break; // the first is (intended) to be blocked from the app, and used just to indicate start, we block other events til the screenshot is taken.
                                // but...apparently I can't block it and it sneaks through, so I need to include the delta in my total count.
                            }
                            // subsequent wheel events in the chain are agregatted and allowed to bubble, and really scroll the app
                            this._wheel.deltaX += e.deltaX;
                            this._wheel.deltaY += e.deltaY;
                            return; // bubble
                        case 'keydown':
                            if (e.repeat) {
                                break;
                            }
                            if (this._wheel) {
                                // any (other) user input signals the end of a scroll input
                                msg = this.buildMsg(this._wheel);
                                this.port.postMessage(msg); // record a wheel action 
                                this._wheel = false;
                            }

                            if (this.keysDown.length || e.ctrlKey) {
                                this.keysDown.push(e);
                                //console.debug('chord? chord start or continue keydown');
                                break;
                            }

                            // this keydown is unrelated to chords
                            //console.debug('chord? not chord keydown');
                            msg = this.buildMsg(e);
                            this.port.postMessage(msg); // take screenshot and then simulate 
                            this._state = Recorder.state.SIMULATE;
                            break;
                        case 'keyup':
                            if (this.keysDown.length) {
                                // we started a chord
                                this.keysUp.push(e); // and just released a key in the chord
                                if (this.keysUp.length === this.keysDown.length) {
                                    //console.debug('chord? all released keyup');// else not all keys are released
                                    // released all keys n the chord
                                    let userAction = {
                                        type: 'chord',
                                        target: e.target
                                    };
                                    msg = this.buildMsg(userAction);
                                    this.keysUp = [];
                                    this.keysDown = [];
                                    this.port.postMessage(msg); // take screenshot and then simulate 
                                    this._state = Recorder.state.SIMULATE;
                                }
                                else {
                                    //console.debug('chord? not all released keyup');// else not all keys are released
                                }
                            }
                            else {
                                //console.debug('chord? not chord keyup');
                            }

                            break;
                        case 'contextmenu':
                        case 'dblclick':
                            if (this._wheel) {
                                // any (other) user input signals the end of a scroll input
                                msg = this.buildMsg(this._wheel);
                                this.port.postMessage(msg); // record a wheel action 
                                this._wheel = false;
                            }
                            msg = this.buildMsg(e);
                            this.port.postMessage(msg); // take screenshot and then simulate 
                            this._state = Recorder.state.SIMULATE;
                            break;
                        case 'click':
                            // don't know yet if it is a single click or the first of a double click
                            if (!pendingClick) {
                                pendingClick = e;
                                setTimeout(() => {
                                    if (this._wheel) {
                                        // any (other) user input signals the end of a scroll input
                                        let msg = this.buildMsg(this._wheel);
                                        this.port.postMessage(msg); // record a wheel action, fire and forget 
                                        this._wheel = false;
                                    }
                                    let msg = this.buildMsg(pendingClick);
                                    this.port.postMessage(msg); // take screenshot, and then simulate 
                                    this._state = Recorder.state.SIMULATE;
                                    pendingClick = false;
                                }, 500);
                            }
                            else {
                                // this is the second single click within 500ms. It should generate a double click.
                                pendingClick = false;
                                if (e.detail != 2) {
                                    console.error('sanity check fails. got a 2nd single click within 500ms but not marked as 2nd click.')
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

            'mouseout',
            'mouseover',

            'wheel' // monitored to decide when a user performs a "complete" scroll action. 
            // the first wheel event must take a screenshot and block all subsequent events until that's done.
            // subsequent wheel events are agregated.
            // we decide the the user is no longer scrolling when a non-wheel user action type event occurs.
            // this records the completed scroll action.

            //'scroll'

            // FIXME: I do not ever see these...WHY? 
            //'mouseleave',   // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
            //'mouseenter'    // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
        ];

        Recorder.block = function block(e) {
            if (e.type !== 'mousemove') { // these saturate the logs
                console.debug(`${e.timeStamp} blocking event: ${e.type}`, e.target, e);
            }
            else {
                console.debug(`blocking event: ${e.type}`);
            }
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
        };

        // create the instace
        window.brimstomeRecorder = new Recorder();

    }); // end chrome.storage.sync.get

})();