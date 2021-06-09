function focusNextElement() {
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
            if(nextElement !== oe) {
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
}

class StateMachine {
    _currentState;
    _table;
    _pause = false;

    constructor({ currentState, table }) {
        this._currentState = currentState;
        this._table = table;
    }

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

    pause() {
        this._pause = true;
    }

    resume() {
        this._pause = false;
    }
}

// The content-script (CS). This can't use all the chrome api's :( 
// The application being recorded will have this injected into it.

// https://developer.chrome.com/docs/extensions/mv3/content_scripts/
// until chrome fixes the bug, we pass args this way
chrome.storage.sync.get(["injectedArgs"], (result) => {
    console.log('got', result);
    let expectedUrl = result.injectedArgs.url;
    let actualUrl = window.location.href;//;chrome.runtime.getURL('');

    /*
    if (expectedUrl !== actualUrl) {
        console.error(`NOT injecting script, expected url to be\n${expectedUrl}\nactual\n${actualUrl}`);
        return;
    }
*/
    let stateMachine = new StateMachine({
        table: {
            start: {
                mousedown: function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    let msg = this.buildMsg(e);
                    this.port.postMessage(msg); // we now wait for message back from popup that we took the screenshot
                    return 'waiting_for_complete';
                },
                keydown: function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    let msg = this.buildMsg(e);
                    this.port.postMessage(msg);
                    return 'waiting_for_complete';
                },
                change: function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    let msg = this.buildMsg(e);
                    this.port.postMessage(msg);
                    return 'waiting_for_complete';
                },
                // beforeinput: function(e) {
                //     if(e.target === this.pendingEventElement) { // just the first is blocking
                //         return;
                //     } 
                //     e.stopPropagation();
                //     e.preventDefault();
                //     let msg = this.buildMsg(e);
                //     this.port.postMessage(msg); // we now wait for message back from popup that we took the screenshot
                //     return 'waiting_for_complete';
                // },
                // these are user events that no longer are required. i programatcally dispatched these after mousedown, so block em.
                // mouseup: (e) => { 
                //     e.stopPropagation();
                //     e.preventDefault();
                // },
                // click: (e) => {
                //     e.stopPropagation();
                //     e.preventDefault();
                // }
            },
            waiting_for_complete: {
                complete: function (msg) {
                    if (msg !== this.pendingEventType) {
                        console.error(`got a complete message for <${msg}>, was expecting <${this.pendingEventType}>`);
                    }
                    this.pause();
                    switch (msg) {
                        case 'keydown':
                            if (this.pendingEvent.key !== 'Tab') {
                                this.pendingEventElement.value += this.pendingEvent.key; // '\t' isn't actually in the value for text inputs
                                this.pendingEventElement.dispatchEvent(new KeyboardEvent('keydown', { 
                                    key: this.pendingEvent.key,
                                    bubbles: true
                                }));
                            }
                            else {
                                // it's a tab
                                focusNextElement();
                            }
                            break;
                        case 'mousedown':
                            this.pendingEventElement.dispatchEvent(new Event('mousedown', { bubbles: true }));
                            this.pendingEventElement.focus();
                            break;
                        case 'change':
                            // nada, this just generates a screenshot
                            break;
                        default:
                            console.error(`unexpected completion message from popup: ${this.pendingEventType}`);
                            this.resume();
                            return;
                    }
                    this.resume();
                    return 'start';
                },
                mouseup: function (e) {
                    e.stopPropagation();
                    e.preventDefault(); // ignore it and keep waiting
                },
                click: function (e) {
                    e.stopPropagation();
                    e.preventDefault(); // ignore it and keep waiting
                }
            },
            '*': {
                'msg': function (msg) {
                    if (msg.type === 'disconnect') {
                        this.port.disconnect();
                    }
                }
            }
        },
        currentState: 'start'
    });

    // add some properties to the statemachine instance
    console.log('connecting port');
    stateMachine.port = chrome.runtime.connect({ name: "knockknock" });
    stateMachine.port.postMessage({ type: 'connect' });

    stateMachine.buildMsg = function (e) {
        console.log('building msg from', e);

        this.pendingEventElement = e.target;
        this.pendingEventType = e.type;
        this.pendingEvent = e;

        // JSON.stringify bails as soon as it hits a circular reference, so we must project out a subset of the properties
        // rather than just augment the e object.
        let msg = {
            type: e.type,
            boundingClientRect: e.target.getBoundingClientRect()
        };

        switch (e.type) {
            case 'mousedown':
                msg.clientX = e.clientX;
                msg.clientY = e.clientY;
                break;
            case 'keydown':
                msg.clientX = msg.boundingClientRect.x + msg.boundingClientRect.width / 2;
                msg.clientY = msg.boundingClientRect.y + msg.boundingClientRect.height / 2;
                msg.value = e.key;
                break;
        }

        return msg;
    };

    // start listening for messages back from the popup
    stateMachine.port.onMessage.addListener(function (msg) {
        console.log('RX: ', msg);
        stateMachine.transition({ input: msg.type, args: msg.args });
    });

    function handleEvent(e) {
        stateMachine.transition({ input: e.type, args: e });
    }

    let events = ['mousedown', /*'beforeinput',*/ 'keydown', 'change', 'mouseup', 'click'];
    events.forEach(event => {
        window.removeEventListener(event, handleEvent, { capture: true });
        window.addEventListener(event, handleEvent, { capture: true });
    })

    // before the users first keystroke in a input is proessed we should take a snapshot
    function removeEventListeners() {
        events.forEach(event => {
            window.removeEventListener(event, handleEvent, { capture: true });
        });
    }

    stateMachine.port.onDisconnect.addListener(function (port) {
        removeEventListeners();
    });
});
