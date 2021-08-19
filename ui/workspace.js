import { Player } from "../playerclass.js"
import { Tab } from "../tab.js"
import * as iconState from "../iconState.js";
import { Rectangle } from "../rectangle.js";
import { TestAction, getCard, constants, Step } from "./card.js";
import { sleep } from "../utilities.js";
import { enableConsole, disableConsole } from "./console.js";
import { loadFile, saveFile } from "./loader.js";
import { Screenshot } from "./screenshot.js";

disableConsole(); // can be reenabled in the debugger later

setToolbarState();

window.document.title = 'Brimstone - untitled';

/** The index of the first card showing in big step area */
function currentStepIndex() {
    let index = $('#content .card:first-of-type').attr('data-index');
    if (index) {
        return index - 0; // convert to number
    }
    return -1; // not found
}

/** Are we in the recording state? */
function isRecording() {
    return $('#recordButton').hasClass('active');
}

/** Are we in the playing state? */
function isPlaying() {
    return $('#playButton').hasClass('active');
}

// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);

/** The tab being recorded
 * @type {Tab}
 */
var tab = new Tab();
const tabId = parseInt(urlParams.get('tab'), 10);
const player = new Player();

var uiCardsElement = document.getElementById('cards');

/* Some globals */
var _lastScreenshot;

/** The parsed test.json object, this will change in memory during use.
 * It represents the recorded user actions, and optionally the result
 * of playing them back. 
 * 
*/

$('#ignoreDelta').on('click',
    /** Commit any volatile rectangles or individual pixel deltas. */
    async function ignoreDelta(e) {
        // if you are editing you are going to want to save, and to save we need to detach the debugger.
        await player.detachDebugger();

        // add a mask
        const { action, view } = getCard($('#content .card:nth-of-type(2)')[0]);
        await action.addMask(view);
        updateStepInView(TestAction.instances[action.index - 1]);
    }
);

$('#undo').on('click', async function() {
    // we need to purge the acceptablePixelDifferences (and all rectangles that might be drawn presently)
    const {view, action} = getCard('#content .waiting');
    action.acceptablePixelDifferences = new Screenshot();
    await action.pixelDiff();
    updateStepInView(TestAction.instances[action.index - 1]);
    addVolatileRegions();
});

// stop the image drag behavior
$('#step').on('mousedown', '.card.edit img', () => false);

$('#cards').on('click', '.thumb',
    /** When the user clicks on the thumbnail put that step in the main area. */
    async function gotoStepFromThumb(e) {
        const { action } = getCard(e.currentTarget);
        let step = new Step({ curr: action });
        setStepContent(step);
    }
);

let diffPromise = false;

function addVolatileRegions() {
    const { view } = getCard($('#content .card.waiting')[0]);
    let screenshot = view.find('.screenshot');
    Rectangle.setContainer(screenshot[0],
        () => {
            console.debug('rectangle added');
        },
        () => {
            console.debug('rectangle deleted');
        });
    // adds to DOM temporarily
}

$('#step').on('click', '.waiting .click-to-change-view',
    /** When clicking on an editable action, cycle through expected, actual, and difference views. */
    async function cycleEditStates(e) {
        // flip the cards
        const { view, action } = getCard(e.currentTarget);
        let index;
        switch (action._view) {
            case constants.view.EXPECTED:
                action._view = constants.view.ACTUAL;
                if (!action.actualScreenshot) {
                    action.actualScreenshot = new Screenshot({
                        fileName: '',
                        dataUrl: action.expectedScreenshot.dataUrl,
                        png: action.expectedScreenshot.png
                    });
                    if (action.acceptablePixelDifferences) {
                        action._view = constants.view.EDIT;
                        await action.acceptablePixelDifferences.hydrate();
                        action.editViewDataUrl = action.acceptablePixelDifferences.dataUrl;
                    }
                }
                else {
                    await action.actualScreenshot.hydrate();
                }
                updateStepInView(TestAction.instances[action.index - 1]);
                break;
            case constants.view.ACTUAL:
                action._view = constants.view.EDIT;
                if (!action.editViewDataUrl) {
                    if (!action.acceptablePixelDifferences) {
                        action.acceptablePixelDifferences = new Screenshot();
                    }
                    else {
                        await action.acceptablePixelDifferences.hydrate();
                    }
                    await action.pixelDiff();
                }
                updateStepInView(TestAction.instances[action.index - 1]);
                    /** Add rectangles where we don't care about pixel differences. */
                addVolatileRegions();
                break;
            case constants.view.EDIT:
                action._view = constants.view.EXPECTED;
                await updateStepInView(TestAction.instances[action.index - 1]);
                break;
        }
    }
);

function setInfoBarText(infobarText) {
    if (!infobarText) {
        if ($('#recordButton').hasClass('active')) {
            infobarText = '<span class="pulse">🔴</span> recording...';
        }
        else if ($('#playButton').hasClass('active')) {
            infobarText = '🟢 playing...';
        }
        else {
            infobarText = 'ready';
        }
    }
    $('#infobar').html(infobarText);
}

function setToolbarState() {
    $('button').prop('disabled', true); // start with all disabled and selectively enable some

    let rb = $('#recordButton');
    if (rb.hasClass('active')) { // recording?
        rb.prop('disabled', false);
        rb.prop('title', 'Brimstone is recording.\nClick to stop.');
        iconState.Record();
        document.documentElement.style.setProperty('--action-color', 'red');
    }
    else {
        rb.prop('title', "Click to record.");
        $('#loadButton').prop('disabled', false); // playing?
        let pb = $('#playButton');
        if ($('#playButton').hasClass('active')) {
            pb.prop('disabled', false);
            iconState.Play();
            document.documentElement.style.setProperty('--action-color', 'green');
        }
        else {
            // not playing, not recoding
            $('#helpButton').prop('disabled', false); // help is always given to those at hogwarts who ask for it.
            $('#issuesButton').prop('disabled', false);
            rb.prop('disabled', false);
            document.documentElement.style.setProperty('--action-color', 'blue');

            if (TestAction.instances.length) {
                $('#saveButton').prop('disabled', false);
                $('#clearButton').prop('disabled', false);

                let index = currentStepIndex();
                if (index > 0) {
                    $("#previous").prop('disabled', false);
                    $('#first').prop('disabled', false);
                }
                $('#playButton').prop('disabled', false);
                if (index < TestAction.instances.length - 1) {
                    $("#next").prop('disabled', false);
                    $("#last").prop('disabled', false);
                }
            }

            iconState.Ready();
        }
    }
    setInfoBarText();

    // buttons for editing allowable deltas in the second card.
    let editCard = $('#content .card:nth-of-type(2)');
    if (editCard.length) {
        const { action } = getCard(editCard);
        if (action?._view === constants.view.EDIT) {
            $('#ignoreDelta').prop('disabled', false);
            $('#undo').prop('disabled', false);
        }
    }
}

$('#first').on('click', function (e) {
    updateStepInView(TestAction.instances[0]);
});

$('#previous').on('click', function (e) {
    let index = currentStepIndex();
    if (index > 0) {
        updateStepInView(TestAction.instances[index - 1]);
    }
});

/** Remember the state of the last play, so I can resume correctly. */
var playedSuccessfully = true;

$('#playButton').on('click', async () => {
    try {
        let actions = TestAction.instances;
        player.onBeforePlay = updateStepInView;
        player.onAfterPlay = updateStepInView;
        await tab.fromChromeTabId(tabId);
        tab.height = actions[0].tabHeight;
        tab.width = actions[0].tabWidth;
        tab.zoomFactor = 1; // FIXME this needs to come from the test itself! 

        await player.attachDebugger({ tab }); // in order to play we _only_ need the debugger attached

        $('#playButton').addClass('active');
        setToolbarState();

        let playFrom = currentStepIndex(); // we will start on the step showinging in the workspace.
        // we can resume a failed step. FIXME:// I need to know the last play resulted in a failed step to set this.
        let resume = !playedSuccessfully && playFrom > 0;
        playedSuccessfully = await player.play(actions, playFrom, resume); // players gotta play...

        $('#playButton').removeClass('active');
        setToolbarState();

        setInfoBarText(playedSuccessfully ? '✅ last run passed' : `❌ last run failed after user action ${player.currentAction.index + 1}`);
        await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });

        if (playedSuccessfully) {
            alert('✅ Test passed.');
        }
    }
    catch (e) {
        $('#playButton').removeClass('active');
        setToolbarState();
        setInfoBarText('💀 aborted! ' + e?.message ?? '');
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger(s) first.");
        }
        else {
            throw e;
        }
    }

});

$('#next').on('click', function (e) {
    let index = currentStepIndex();
    if (index < TestAction.instances.length - 1) {
        updateStepInView(TestAction.instances[index + 1]);
    }
});

$('#last').on('click', function (e) {
    updateStepInView(TestAction.instances[TestAction.instances.length - 1]);
});


chrome.debugger.onDetach.addListener(async (source, reason) => {
    console.debug('The debugger was detached.', source, reason);
    if (reason === 'canceled_by_user' || player._debugger_detatch_requested) {
        await sleep(500);
        await player.tab.resizeViewport();
        if (isRecording()) {
            stopRecording();
        }
        if (isPlaying()) {
            stopPlaying(); // FIXME: refactor for less code
        }
    }
    else {
        // the debugger automatically detaches (eventually) when the tab navigates to a new URL. reason = target_closed
        await player.attachDebugger({ tab }); // it's the same tab...
    }
});

async function startRecording(tab) {
    console.debug(`begin - start recording port connection process for tab ${tab.id} ${tab.url}`);
    console.debug(`      -  tab is ${tab.width}x${tab.height} w/ zoom of ${tab.zoomFactor}`);

    //chrome.tabs.onUpdated.removeListener(tabsOnUpdatedHandler);
    //chrome.tabs.onUpdated.addListener(tabsOnUpdatedHandler);

    // only listen for navigations, when we are actively recording, and remove the listener when we are not recording.
    //https://developer.chrome.com/docs/extensions/reference/webNavigation/#event-onCompleted
    chrome.webNavigation.onCompleted.removeListener(webNavigationOnCompleteHandler);
    chrome.webNavigation.onCompleted.addListener(webNavigationOnCompleteHandler);

    // tell all the content scripts what frame they are in
    let frames = await (new Promise(response => chrome.webNavigation.getAllFrames({ tabId: tab.id }, response))); // get all frames
    for (let i = 0; i < frames.length; ++i) {
        let frame = frames[i];
        await chrome.tabs.sendMessage(tab.id, { func: 'setFrameId', args: { to: frame.frameId } }, { frameId: frame.frameId });
    }

    // establish the recording communication channel between the tab being recorded and the brimstone workspace window

    // connect to all frames in the the active tab in this window. 
    // the recorder is injected in all pages, all frames, and will respond to onconnect by starting the event handlers.
    // https://developer.chrome.com/docs/extensions/reference/tabs/#method-connect
    port = chrome.tabs.connect(tab.id, { name: "brimstone-recorder" });

    // if the active tab navigates away or is closed the port will be disconected
    // FIXME: is this needed?
    port.onDisconnect.addListener(
        /**
         * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
         * https://developer.chrome.com/docs/extensions/mv3/messaging/#port-lifetime
         * @param {*} _port 
         */
        function (_port) {
            console.debug('port was disconnected', _port, chrome.runtime.lastError);
            port.onMessage.removeListener(onMessageHandler); // this particular port is no good anymore so, kill the listener on it. needed?
            port = false;
        });

    port.onMessage.addListener(onMessageHandler);
    console.debug(`end   - start recording port connection process for tab ${tab.id} ${tab.url}`);
}

function stopRecording(tab) {
    // tell all frames to stop recording. i.e. disable the event handlers if possible.
    try {
        postMessage({ type: 'stop', broadcast: true });
    }
    catch (e) {
        console.warn(e);
    }
    chrome.webNavigation.onCompleted.removeListener(webNavigationOnCompleteHandler);
}

async function focusTab() {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, {
        highlighted: true,
        active: true
        // url: tab.url // shouldn't need that
    });
}

$('#recordButton').on('click', async function () {
    let button = $(this);
    if (button.hasClass('active')) {
        button.removeClass('active'); // stop recording
        // before I take the last screenshot the window must have focus again.
        await focusTab();
        let action = await userEventToAction({
            type: 'stop',
            x: -1,
            y: -1
        });
        updateStepInView(action);
        stopRecording();
        return;
    }

    try {
        await tab.fromChromeTabId(tabId);
        await player.attachDebugger({ tab }); // required to play anything in the tab being recorded.

        await startRecording(tab);
        button.addClass('active');
        setToolbarState();

        if (!TestAction.instances.length) {
            // update the UI: insert the first text card in the ui
            let userEvent = {
                type: 'start', // start recording
                url: tab.url
            };
            let action = await userEventToAction(userEvent);
            updateStepInView(action);
        }
        else {
            // we are updating our recording: recording over or appending to an existing test
            let index = currentStepIndex();
            // see last screen, make mine look like that (play)
            // hit record
            // this screen needs to go, it will be replaced by the required screen for the next recorded action

            // see some step - i need to make the screen look like the screen in the useraction
            // hit record
            // this action and screen need to go, i am doing a new recording.
            TestAction.instances.splice(index); // remove the last 'action'. it is just an image w/o an action
        }

        // last thing we do is give the focus back to the window and tab we want to record, so the user doesn't have to.
        await focusTab();

    }
    catch (e) {
        stopRecording();
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger first.");
        }
        else if (e === "cannot_set_desired_viewport") {
            window.alert("Cannot resize the recording window. Do not start a recording maximized, space is needed for the debugger banner.");
        }
        else {
            throw e;
        }
    }
});

async function stopPlaying() {
    $('#playButton').removeClass('active');
    setToolbarState();
}

$('#clearButton').on('click', async () => {
    // remove the cards
    TestAction.instances = [];
    setToolbarState();
    window.document.title = `Brimstone - untitled`;

    $('#cards').empty();
    $('#step').empty();
});

/**
 * Send a msg back to the bristone workspace over the recording channel port. 
 * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
 * Note this automatically sends the Sender info.
 */
function postMessage(msg) {
    console.debug('TX', msg);
    port.postMessage(msg);
}

$('#saveButton').on('click', async () => {
    let file = await saveFile();
    window.document.title = `Brimstone - ${file.name}`;
});

$('#helpButton').on('click', () => {
    chrome.tabs.create({
        url: 'https://github.com/zacfilan/brimstone-recorder/wiki'
    });
});

$('#issuesButton').on('click', () => {
    chrome.tabs.create({
        url: 'https://github.com/zacfilan/brimstone-recorder/issues'
    });
});

$('#loadButton').on('click', async () => {
    let file = await loadFile();
    if (file) {
        window.document.title = `Brimstone - ${file.name}`;
        updateStepInView(TestAction.instances[0]);
        for (let i = 1; i < TestAction.instances.length; ++i) {
            let action = TestAction.instances[i];
            updateThumb(action)
        }
        setToolbarState();
    }
});

function updateStepInView(action) {
    // immediately show if there is nothing pending
    let step = new Step({ curr: action });
    setStepContent(step);
}

/** The recording channel port. This port connects to (broadcasts to) 
 * every frame in the tab.
*/
var port = false;

/**
 * 
 * @param {Step} step the step
 */
function setStepContent(step) {
    $('#step').html(step.toHtml({ isRecording: isRecording() })); // two cards in a step
    setToolbarState();
    updateThumb(step.curr);
};

/**
 * Update the thumb from the given action
 * @param {TestAction} action 
 */
function updateThumb(action) {
    let $thumb = $(action.toThumb()); // smaller view
    let card = $(`#cards .card[data-index=${action.index}]`);
    if (card.length) {
        // replace
        card.replaceWith($thumb);
    }
    else {
        uiCardsElement.appendChild($thumb[0]);
    }
}

/** 
 * This is only used during recording. It update the zip file.
 * 
 * Process a user event received from the content script (during recording)
 * screenshot, annotate event and convert to card
 */
async function userEventToAction(userEvent, frameId) {
    let frameOffset = await getFrameOffset(frameId);

    let cardModel = new TestAction(userEvent);

    let element = userEvent.boundingClientRect;
    cardModel.tabHeight = tab.height;
    cardModel.tabWidth = tab.width;

    cardModel.x += frameOffset.left;
    cardModel.y += frameOffset.top;

    if (element) {
        /** During recording we know the tab height and width, this will be the size of the screenshots captured.
         * We can convert the element positions in pixels into percentages. The overlay represents the location
         * of the overlay in percentages of the aspect-ratio preserved image.
         */
        cardModel.overlay = {
            height: element.height * 100 / tab.height,
            width: element.width * 100 / tab.width,
            top: (element.top + frameOffset.top) * 100 / tab.height,
            left: (element.left + frameOffset.left) * 100 / tab.width
        };
    }

    let dataUrl = '';
    switch (userEvent.type) {
        case 'mousemove':
            cardModel.description = 'move mouse here';
            dataUrl = await captureScreenshotAsDataUrl();
            cardModel.addExpectedScreenshot(dataUrl);
            break;
        case 'wheel':
            let direction = '';
            let magnitude;
            if (cardModel.deltaX) {
                direction = cardModel.deltaY < 0 ? 'left' : 'right';
                magnitude = Math.abs(cardModel.deltaY);
            }
            else if (cardModel.deltaY) {
                direction = cardModel.deltaY < 0 ? 'up' : 'down';
                magnitude = Math.abs(cardModel.deltaY);
            }
            cardModel.description = `mouse here, scroll wheel ${magnitude}px ${direction}`;
            cardModel.addExpectedScreenshot(_lastScreenshot);
            break;
        case 'keypress':
            cardModel.description = `type ${userEvent.event.key}`;
            dataUrl = await captureScreenshotAsDataUrl();
            cardModel.addExpectedScreenshot(dataUrl);
            break;
        case 'chord':
            cardModel.description = 'type ' + userEvent.keysDown.map(k => k.key).join('-'); // e.g. Ctrl-a
            dataUrl = await captureScreenshotAsDataUrl();
            cardModel.addExpectedScreenshot(dataUrl);
            break;
        case 'click':
            cardModel.description = 'click';
            dataUrl = await captureScreenshotAsDataUrl();
            cardModel.addExpectedScreenshot(dataUrl);
            break;
        case 'contextmenu':
            cardModel.description = 'right click';
            dataUrl = await captureScreenshotAsDataUrl();
            cardModel.addExpectedScreenshot(dataUrl);
            break;
        case 'dblclick':
            cardModel.description = 'double click';
            dataUrl = await captureScreenshotAsDataUrl();
            cardModel.addExpectedScreenshot(dataUrl);
            break;
        case 'stop':
            cardModel.description = 'stop recording';
            dataUrl = await captureScreenshotAsDataUrl();
            cardModel.addExpectedScreenshot(dataUrl);
            break;
        case 'start': {
            cardModel.description = `goto ${cardModel.url}`;
            cardModel.overlay = {
                height: 0,
                width: 0,
                top: 0,
                left: 0
            };
            cardModel._view = constants.view.EXPECTED;
            break;
        }
        default:
            cardModel.description = 'Unknown!';
            break;
    }
    return cardModel;
}

async function captureScreenshotAsDataUrl() {
    let result = await player.debuggerSendCommand('Page.captureScreenshot', {
        format: 'png'
    });
    let dataUrl = 'data:image/png;base64,' + result.data;
    return dataUrl;
}

/** 
 * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
*/
async function onMessageHandler(message, _port) {
    let userEvent = message;
    console.debug(`RX: ${userEvent.type}`, userEvent);
    let action;
    userEvent._view = constants.view.EXPECTED;
    switch (userEvent.type) {
        case 'frameOffset':
            if (userEvent.sender.frameId === _waitForFrameOffsetMessageFromFrameId) {
                _resolvePostMessageResponsePromise(userEvent.args);
            }
            break;
        case 'screenshot':
            _lastScreenshot = await captureScreenshotAsDataUrl();
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId });
            break;
        case 'mousemove': // this does not ack, because it will always be followed by another operation.
        case 'wheel': // this does not ack, because it will always be followed by another operation.
            // update the UI with a screenshot
            action = await userEventToAction(userEvent, userEvent.sender.frameId);
            updateStepInView(action);
            // no simulation required
            break;
        case 'click':
        case 'keypress':
        case 'contextmenu':
        case 'dblclick':
        case 'chord':
            // update the UI with a screenshot
            action = await userEventToAction(userEvent, userEvent.sender.frameId);
            updateStepInView(action);
            // Now simulate that event back in the recording, via the CDP
            await player[action.type](action);
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // don't need to send the whole thing back
            break;
        case 'connect':
            console.debug(`connection established from frame ${userEvent.sender.frameId}`);
            break;
        default:
            console.error(`unexpected userEvent received <${userEvent.type}>`);
            break;
    }
};

/**
 * This only is active when we are actively recording.
 * https://developer.chrome.com/docs/extensions/reference/webNavigation/#event-onCompleted
 */
async function webNavigationOnCompleteHandler(details) {
    console.debug(`tab ${details.tabId} navigation completed`, details);
    if (details.url === 'about:blank') {
        console.debug(`    - ignoring navigation to page url 'about:blank'`);
        return;
    }
    const { height, width } = tab; // hang onto the original size
    await tab.fromChromeTabId(details.tabId); // since this resets those to the chrome tab sizes, which is wrong because of the banner.
    tab.height = height;
    tab.width = width;

    await startRecording(tab);
    await tab.resizeViewport();
}

/** Used to wait for all frameoffsets to be reported */
var _waitForFrameOffsetMessageFromFrameId;

/** used to resolve a promise via external function */
var _resolvePostMessageResponsePromise;

/** used to reject a promise via external function */
var _rejectPostMessageResponsePromise;

/**
 * Return a frame offset structure for this frame.
 * @param {number} frameId 0 is main frame, positive is a child frame.
 * 
 * FIXME: consider using https://chromedevtools.github.io/devtools-protocol/tot/Page/#event-frameAttached 
 * to keep frame info in sync.
 */
async function getFrameOffset(frameId) {
    let frameOffset = {
        left: 0,
        top: 0
    };

    if (!frameId) {
        return frameOffset; // main frame
    }
    // else - a child frame made this request

    /** Array of frames in the current tab 
     * https://developer.chrome.com/docs/extensions/reference/webNavigation/#method-getAllFrames 
     */
    let frames = await (new Promise(resolve => chrome.webNavigation.getAllFrames({ tabId: tab.id }, resolve))); // get all frames

    // find my offset and all my ancestors offsets too
    for (let frame = frames.find(f => f.frameId === frameId); frame.parentFrameId >= 0; frame = frames.find(f => f.frameId === frame.parentFrameId)) {
        /** https://developer.chrome.com/docs/extensions/reference/tabs/#method-sendMessage */
        _waitForFrameOffsetMessageFromFrameId = frame.frameId; // I am waiting for my own offset to be broadcast from my parent

        // create 'externally' resolved promise
        let p = new Promise((resolve, reject) => {
            _resolvePostMessageResponsePromise = resolve;
            _rejectPostMessageResponsePromise = reject;
        });

        // tell my parent to broadcast down into his kids (including me) their offsets
        await chrome.tabs.sendMessage(tab.id, { func: 'postMessageOffsetIntoIframes' }, { frameId: frame.parentFrameId });
        // it's posted, but that doesn't mean much

        let response = await p; // eventually some 'frameOffset' messages come in, and when I see mine this promise is resolved with my offset.

        frameOffset.left += response.left;
        frameOffset.top += response.top;
    }

    return frameOffset;
}