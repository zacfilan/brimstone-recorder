chrome.storage.sync.get(["injectedArgs"], (result) => {
    let expectedUrl = result.injectedArgs.url;
    let actualUrl = window.location.href;
    
    /** Used to wait and see if a sibgle click becomes a double click. */
    let pendingClick;

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
                    case 'stop':
                        this.exit();
                        break;
                }
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
                    msg.detail = e.detail;
                case 'contextmenu':
                case 'dblclick':
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
            // console.log(`${e.timeStamp} handle event: ${e.type}`, e.target);
            // if(e.type === 'submit') {
            //     debugger;
            // }

            if (this._simulatingEvents) {
                // FIXME: how do I know this event came from the debugger versus from from the user?!
                // FIXME: There is a race condition here!!                
                console.log(`${e.timeStamp} simulated event: ${e.type}`, e.target, e);
            }
            else {
                // block everything
                console.log(`${e.timeStamp} blocking event: ${e.type}`, e.target, e);
                e.preventDefault(); 
                e.stopPropagation();

                switch (e.type) {
                    case 'keydown':
                    case 'contextmenu':
                    case 'dblclick':
                        let msg = this.buildMsg(e);
                        //console.log('TX: keypress (from a keydown)');
                        this.port.postMessage(msg); // will screenshot and then simulate the keydown, char, and keyup of the user
                        this._simulatingEvents = true;
                        break;
                    case 'click':
                        // don't know yet if it is a single click or the first of a double click
                        if(!pendingClick) {
                            pendingClick = e;
                            setTimeout( () => {
                                let msg = this.buildMsg(pendingClick);
                                //console.log('TX: keypress (from a keydown)');
                                this.port.postMessage(msg); // will screenshot and then simulate the keydown, char, and keyup of the user
                                this._simulatingEvents = true;
                                pendingClick = false;
                            }, 500); 
                        }
                        else {
                            // this is the second single click within 500ms. It should generate a double click.
                            pendingClick = false;
                            if(e.detail != 2) {
                                console.error('sanity check fails. got a 2nd single click within 500ms but not marked as 2nd click.')
                            }
                        }
                        break;
                }
                return false;
            }
        }
    } // end class Recorder

    Recorder.events = ['click', 'dblclick', 'contextmenu', 'mousedown', /*'beforeinput',*/ 'keydown', 'keypress', 'keyup', 'change', 'mouseup', 'mouseleave', 'mouseenter', 'focus', 'focusin', 'blur', 'submit', 'invalid'];
    // create the instace
    window.brimstomeRecorder = new Recorder();

}); // end chrome.storage.sync.get

