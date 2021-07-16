(function () {
    if (window.brimstomeRecorder !== undefined) {
        console.warn(`content-recorder.js is already injected into ${window.location.href}`);
        return;
    }

    chrome.storage.sync.get(["injectedArgs"], (result) => {
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
                /** Build a keypress event from a keyup and a keydown */
                this._lastKeyPress;

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
                    case 'click':
                        msg.detail = e.detail;
                    case 'contextmenu':
                    case 'dblclick':
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
                // if we are done driving the browser (simulating a user input) 
                // wait for the next user input befre we start blocking events.
                if (this._state === Recorder.state.READY) {
                    switch (e.type) {
                        case 'mouseleave':
                        case 'mouseenter':
                        case 'mousedown':
                        case 'contextmenu':
                        case 'keydown':
                            this._state = Recorder.state.RECORD;
                            console.debug(`${e.timeStamp} user input event: ${e.type} switches us to RECORD state`);
                            break;
                        default:
                            // mouse move clutters things up
                            //console.debug(`${e.timeStamp} passthru event: ${e.type} while waiting for user input event to switch us to record`);
                            return;
                    }
                }

                if (this._state === Recorder.state.SIMULATE) {
                    // FIXME: how do I know this event came from the debugger versus from from the user?!
                    // FIXME: There is a race condition here!!                
                    console.debug(`${e.timeStamp} simulated event: ${e.type}`, e.target, e);
                }
                else {

                    Recorder.block(e);

                    switch (e.type) {
                        case 'keydown':
                            if (e.key === 'Control') {
                                if (!e.repeat) {
                                    // just take a snapshot now and that is all
                                    this.port.postMessage({ type: 'screenshot' }); // nothing will be simulated
                                }
                                break;
                            }
                        // else fall through
                        case 'contextmenu':
                        case 'dblclick':
                            let msg = this.buildMsg(e);
                            this.port.postMessage(msg); // take screenshot and then simulate 
                            this._state = Recorder.state.SIMULATE;
                            break;
                        case 'click':
                            // don't know yet if it is a single click or the first of a double click
                            if (!pendingClick) {
                                pendingClick = e;
                                setTimeout(() => {
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
                        case 'mousemove':
                            this._mousemove = e; // remember the last element entered, but bubble
                            break;
                        case 'keyup':
                            if (e.key === 'Control') {
                                let msg = this.buildMsg(this._mousemove); // send a *mousemove* event
                                this.port.postMessage(msg);
                            }
                            break;
                    }
                    return false; // should be redundant and not needed.
                }
            }
        } // end class Recorder

        Recorder.state = {
            /** we are recording and blocking all events */
            RECORD: 0,

            /** we are simulating (driving the browser programmatically) and letting all events through */
            SIMULATE: 1,

            /** we are ready to start recording (again), but need a user input before we block events */
            READY: 2
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
            'submit',       // blocked. ?
            'invalid',      // blocked. ?
            'change',       // blocked. it changes styles. e.g. (x) on a combobox.
            'mouseleave',   // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
            'mouseenter'    // blocked. it changes styles. e.g. some hover approximations. Also record how long the user was over the element before they clicked it.
        ];

        Recorder.block = function block(e) {
            if (e.type !== 'mousemove') { // these saturate the logs
                console.debug(`${e.timeStamp} blocking event: ${e.type}`, e.target, e);
            }
            e.preventDefault();
            e.stopPropagation();
        };


        // create the instace
        window.brimstomeRecorder = new Recorder();

    }); // end chrome.storage.sync.get

})();