chrome.storage.sync.get(["injectedArgs"], (result) => {
    let expectedUrl = result.injectedArgs.url;
    let actualUrl = window.location.href;

    if (expectedUrl !== actualUrl) {
        console.error(`NOT injecting script, expected url to be\n${expectedUrl}\nactual\n${actualUrl}`);
        return;
    }
    console.log(`Injecting content-recorder.js into ${window.location.href}`);

    if (window.brimstomeRecorder !== undefined) {
        console.log('exiting existing recorder')
        brimstomeRecorder.exit(); // clean it up
        console.log('Creating new recorder');
        window.brimstomeRecorder = new Recorder(); // start over
        return;
    }

    // else we need to create it
    console.log('Creating first recorder');
    /**
     * Queue events that are triggered in response to certain user actions, 
     * and send them back over the postMessage connection to the UI.
     */
    class Recorder {
        /** The current eventing state of this recorder. */
        _currentState;
        /** The state transition table */
        _table;
        /** Used to pause event listeners this Recorder creates
         * to allow events trigerred by user actions, to not be queued.
         */
        _pause = false;

        /** Two way communication with the UI. */
        port;

        constructor() {
            this._currentState = 'start';
            this._table = {
                start: {
                    mousedown: this.down,
                    keydown: this.down
                },
                waiting_for_complete: {
                    complete: this.releaseQueuedEvent,
                    mouseup: this.drop,
                    click: this.drop
                },
                '*': {
                    record: (args) => {
                        this.addEventListeners();
                        return 'start';
                    }
                }
            };

            console.log('connecting port');
            this.port = chrome.runtime.connect({ name: "knockknock" });
            this.port.postMessage({ type: 'hello' });
            this.addEventListeners();

            let that = this;
            this.port.onDisconnect.addListener((port) => {
                that.exit();
            });

            // start listening for messages back from the popup
            this.port.onMessage.addListener((msg) => {
                console.log('RX: ', msg);
                that.transition({ input: msg.type, args: msg.args });
            });
        }

        /** Transition to the next state of this state machine. The input is presented to the current state,
         * if there is a match, the function in the state transition table is run with the args supplied.
         * If the function has a return value, it the current state is set to it, else the current state
         * remains unchanged.
         */
        transition({ input, args }) {
            let startingState = this._currentState;

            if (this._pause) {
                console.log(`SM: bubble:paused. (${startingState}) ---<${input}>---> (${this._currentState})`, args);
                return;
            }
            let action = this._table[this._currentState]?.[input] ?? this._table['*']?.[input];
            if (action) {
                let returnedState = action.call(this, args); // pretend it's a method
                if (returnedState) { // if the transition doesn't return a state, stay in the current state
                    this._currentState = returnedState;
                }
                console.log(`SM: intercept. (${startingState}) ---<${input}>---> (${this._currentState})`, args);
            }
            else {
                console.log(`SM: bubble:unmatched. (${startingState}) ---<${input}>---> (${this._currentState})`, args);
            }
        }

        /** Pause the event listeners created by this recorder. Events triggered by user actions
         * will bubble as normal.
         */
        disableQueuing() {
            this._pause = true;
        }

        /** Enable the event listeners created by this recorder. Events triggered by user actions
         * will be intercepted and queued.
         */
        enableQueuing() {
            this._pause = false;
        }

        /** If theree is a queued event it is released. Meaning it is now seen by the browser. 
         * This is an attempt to simulate events they way the browser would performed them.
        */
        releaseQueuedEvent(msg) {
            if (msg !== this.pendingEvent.type) {
                console.error(`got a complete message for <${msg}>, was expecting <${this.pendingEvent.type}>`);
            }
            this.disableQueuing();
            Recorder.simulateEvent(this.pendingEvent);
            this.pendingEvent = null;
            this.enableQueuing();
            return 'start';
        }

        /** Stop the state machine */
        exit() {
            this.removeEventListeners();
            if (this.pendingEvent) {
                this.releaseQueuedEvent(this.pendingEvent.type);
            }
        }

        down(e) {
            e.stopPropagation();
            e.preventDefault();
            let msg = this.buildMsg(e);
            this.port.postMessage(msg);
            return 'waiting_for_complete';
        }

        drop(e) {
            e.stopPropagation();
            e.preventDefault(); // ignore it and keep waiting
        }

        buildMsg(e) {
            console.log('building msg from', e);

            this.pendingEvent = e;

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
                case 'mousedown':
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
                    break;
            }

            return msg;
        };

        /** Add event listeners to the window, some events will be passed*/
        addEventListeners() {
            console.log('removing + adding event listeners');
            Recorder.events.forEach(event => {
                window.removeEventListener(event, this, { capture: true });
                window.addEventListener(event, this, { capture: true });
            });
        }

        removeEventListeners() {
            console.log('removing event listeners');
            Recorder.events.forEach(event => {
                window.removeEventListener(event, this, { capture: true });
            });
        }

        handleEvent(e) {
            this.transition({ input: e.type, args: e });
        }

    }
    /** 
     * Simulate what the browser does when it changes focus to the next element
     * when a tab is pressed.
     */
    Recorder.focusNextElement = function () {
        //add all elements we want to include in our selection
        var focussableElements = 'a:not([disabled]), button:not([disabled]), input[type=text]:not([disabled]), [tabindex]:not([disabled]):not([tabindex="-1"])';
        console.log('attempt focus change, active element', document.activeElement);
        if (document.activeElement && document.activeElement.form) {
            var focussable = Array.prototype.filter.call(document.activeElement.form.querySelectorAll(focussableElements),
                function (element) {
                    //check for visibility while always include the current activeElement 
                    return element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement
                });
            var index = focussable.indexOf(document.activeElement);
            let oe = document.activeElement;
            if (index > -1) {
                var nextElement = focussable[index + 1] || focussable[0];
                if (nextElement !== oe) {
                    console.log('setting focus to element', nextElement);
                    nextElement.focus();
                    return true;
                }
                else {
                    // focus is not going anywhere, but it can't stay here - maybe?
                    console.log('no good next element in focus, did we blur');
                    oe.blur();
                    return false;
                }
            }
            else {
                // focus is not going anywhere, but it can't stay here - maybe?
                console.log('blurring', oe)
                oe.blur();
                return false;
            }
        }
    };
    Recorder.events = ['mousedown', /*'beforeinput',*/ 'keydown', 'change', 'mouseup', 'click'];
    Recorder.simulateEvent = function simulateEvent(e) {
        switch (e.type) {
            case 'keydown':
                if (e.key !== 'Tab') {
                    e.target.value += e.key; // '\t' isn't actually in the value for text inputs
                    e.target.dispatchEvent(new KeyboardEvent('keydown', {
                        key: e.key,
                        bubbles: true
                    }));
                }
                else {
                    // it's a tab
                    Recorder.focusNextElement();
                }
                break;
            case 'mousedown':
                e.target.dispatchEvent(new Event('mousedown', { bubbles: true }));
                e.target.focus();
                break;
            default:
                console.error('unable to simulate event', e);
                break;
        }
    };

    /** Unused. But might be soon enough. */
    class Player {
        // https://www.w3schools.com/jquery/tryit.asp?filename=tryjquery_event_mouseenter_mouseover
        // https://api.jquery.com/mouseenter/
        mouseenter(x, y) {
            let e = $(document.elementFromPoint(x, y));
            e.mouseenter();
        }

        //https://api.jquery.com/mouseleave/
        mouseleave(x, y) {
            let e = $(document.elementFromPoint(x, y));
            e.mouseleave();
        }

        // https://api.jquery.com/click/
        click(x, y) {
            let e = $(document.elementFromPoint(x, y));
            e.click();
        }

        // https://api.jquery.com/keypress/
        keypress(x, y) {
            let e = $(document.elementFromPoint(x, y));
            x.keypress();
        }


    }

    // create the instace
    window.brimstomeRecorder = new Recorder();

});

