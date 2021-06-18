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


        constructor() {
            /** Build a keypress event from a keyup and a keydown */
            this._lastKeyPress;

            /** The last type of down event: mousedown or keydown */
            this._lastDown;

               /** Two way communication with the UI. */
            this.port;

            /** are we currently expecting events to only come i from the debugger */
            this._simulatingEvents = false;

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
                switch (msg.type) {
                    case 'complete':
                        this._simulatingEvents = false;
                        break;
                };
            });
        }


        /** Clean up */
        exit() {
            this.removeEventListeners();
        }

        buildMsg(e) {
            console.log('building msg from', e);

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
            console.log('removing + adding event listeners');
            Recorder.events.forEach(event => {
                window.removeEventListener(event, this, { capture: true });
                window.addEventListener(event, this, { capture: true });
            });
        }

        /** Remove previous bound event listeners */
        removeEventListeners() {
            console.log('removing event listeners');
            Recorder.events.forEach(event => {
                window.removeEventListener(event, this, { capture: true });
            });
        }

        /** Central callback for all bound event handlers */
        handleEvent(e) {
            if(e.type === 'mousedown') {
                this._lastDown = 'mousedown';
            }
            else if(e.type === 'keydown') {
                this._lastDown = 'keydown'
            }
            if (this._simulatingEvents) {
                // FIXME: how do I know this event came from the debugger versus from from the user?!
                // FIXME: There is a race condition here!!
                console.log(`simulated event: ${e.type}`, e.target);
            }
            else {
                switch (e.type) {
                    case 'keydown':
                        console.log(`compile event: ${e.type}`, e.target);
                        e.stopPropagation();
                        e.preventDefault(); 
                        let msg = this.buildMsg(e);
                        console.log('TX: keypress');
                        this.port.postMessage(msg); // will screenshot and then simulate the keydown, char, and keyup of the user
                        this._simulatingEvents = true;
                        break;
                    case 'blur':
                        // blur is also fired when the user tabs around
                        // we can tell if blur is from a key press or mousedown (by recording event sequences received and looking back)
                        // if from keydown I should ignore it since I already do screen capture on every keypres
                        
                        // case 1 of click handled here
                        if(this._lastDown === 'mousedown') {
                            e.stopPropagation();
                            e.preventDefault(); 
                            console.log('TX: take-screenshot');
                            this.port.postMessage({type: 'take-screenshot'}); 
                        }
                        break;
                    case 'click':
                        // there are two cases when clicking
                        // 1. The user clicks an element that doesn't currently have focus
                        // 2. The user clicks the element that already has focus
                        e.stopPropagation();
                        e.preventDefault(); 
                        console.log(`TX event: ${e.type}`, e.target);
                        this.port.postMessage(this.buildMsg(e)); // will (perhaps) screenshot and then simulate the mousedown, mouseup of the user
                        this._simulatingEvents = true;
                        break;
                    default:
                        console.log(`observed event: ${e.type}`, e.target);
                        break;
                }
            }
        }
    } // end class Recorder

    Recorder.events = ['mousedown', /*'beforeinput',*/ 'keydown', 'change', 'mouseup', 'click', 'mouseleave', 'mouseenter', 'focus', 'focusin', 'blur'];
    // create the instace
    window.brimstomeRecorder = new Recorder();

}); // end chrome.storage.sync.get

