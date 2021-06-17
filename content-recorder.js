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
        // are we actively queuing user events (blocking them from getting into the app)
        _queueActive = false;

        // a queue of events we have blocked from getting into the app, we will release them 
        // later.
        _eventQueue = [];

        /** Two way communication with the UI. */
        port;

        constructor() {
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
                if(msg.type === 'complete') {
                    this.releaseQueuedEvents();
                }
                else {
                    console.warn('IGNORED RX');
                }
            });
        }

        /** If theree is a queued event it is released. Meaning it is now seen by the browser. 
         * This is an attempt to simulate events they way the browser would performed them.
        */
        releaseQueuedEvents() {
            this._queueActive = false;
            this._simulatingEvents = true;
            while (this._eventQueue.length) {
                let e = this._eventQueue.shift();
                Recorder.simulateEvent(e);
            }
            this._simulatingEvents = false;
        }

        /** Stop the state machine */
        exit() {
            this.removeEventListeners();
            this.releaseQueuedEvents();
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
                case 'mouseup':
                case 'mousedown':
                case 'click':
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
            if(e.type === 'click') {
                debugger;
            }
            if (this._queueEvents) {
                e.stopPropagation(); // block and queue
                e.preventDefault(); 
                this._queueEvents.push(e);
                console.log(`queue subsequent event: ${e.type}`, e.target);
            }
            // else if(e.type === 'click') {
            //     // click only happens after a mousedown (unless the app is triggering it manually!)
            //     let msg = this.buildMsg(e);
            //     this.port.postMessage(msg);
            //     console.log(`fire and forget event: ${e.type}`, e.target);
            // }
            else if(this._simulatingEvents) {
                console.log(`simulated event: ${e.type}`, e.target); // let it thru
            }
            else {
                // catch the interesting ones 
                switch (e.type) {
                    case 'click':
                    case 'keydown':
                        // when this happens I must block this event
                        e.stopPropagation();
                        e.preventDefault(); // maybe let this thru for mousedown on buttons?

                        // I will send a msg to take a screenshot, the screen must not change from the current state until the screenshot is taken.
                        // so I must also block any events that could change the screen while I wait for that screenshot to be taken.
                        this._queueActive = true;
                        this._eventQueue.push(e);
                        console.log(`queue first event: ${e.type}`, e.target);

                        // send the message
                        let msg = this.buildMsg(e);
                        this.port.postMessage(msg);
                        break;
                    default:
                        console.log(`observed event: ${e.type}`, e.target);
                        break;
                }
            }
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
    Recorder.events = ['mousedown', /*'beforeinput',*/ 'keydown', 'change', 'mouseup', 'click', 'mouseleave', 'mouseenter', 'focus', 'focusin', 'blur'];
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
            case 'mouseup':
            case 'click':
                e.target.dispatchEvent(new Event(e.type, { bubbles: true }));
                break;
            default:
                console.error('unable to simulate event', e);
                throw 'unable to simulate';
                break;
        }
    };

    // create the instace
    window.brimstomeRecorder = new Recorder();

});

