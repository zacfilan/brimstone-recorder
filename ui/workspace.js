import { Player } from "../playerclass.js"
import { Tab } from "../tab.js"
import * as iconState from "../iconState.js";
import { Rectangle } from "../rectangle.js";
import { TestAction, getCard, status, Step } from "./card.js";
import { sleep } from "../utilities.js"

setToolbarState();

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
var currentUrl;

/* Some globals */
var _lastScreenshot;

var zip;

/** The parsed test.json object, this will change in memory during use.
 * It represents the recorded user actions, and optionally the result
 * of playing them back. 
 * 
*/

/** Fixme not used. The struct returned from the content script is used directly  */
class UserEvent {
    /** A string identifier of the type of event, 'click', 'change' , ... */
    type = '';
}

/** Fixme not used */
class UserAction extends UserEvent {
    /** The y-offset of the element the event occurred on */
    clientX = 0;
    /** The x-offset of the element this event occured on */
    clientY = 0;
}

$('#ignoreDelta').on('click', async function (e) {

    // if you are editing you are going to want to save, and to save we need to detach the debugger.
    await player.detachDebugger();

    // add a mask to the 
    const { action, view } = getCard($('#content .card:nth-of-type(2)')[0]);
    await action.addMask(view);
    action.status = status.EDIT; // stay on edit

    updateStepInView(TestAction.instances[action.index - 1]);

});

// stop the image drap behavior
$('#step').on('mousedown', '.card.edit img', () => false);

$('#ignoreRegion').on('click', async function (e) {
    // add a mask to the 
    const { view } = getCard($('#content .card:nth-of-type(2)')[0]);
    let screenshot = view.find('.screenshot');
    screenshot.removeClass('clickable');
    Rectangle.setContainer(screenshot[0],
        () => {
            console.debug('rectangle added');
        },
        () => {
            console.debug('rectangle deleted');
        });
    // adds these to the DOM temporarily
});

$('#cards').on('click', '.thumb', async function (e) {
    const { action } = getCard(e.currentTarget);
    let step = new Step({ curr: action });
    setStepContent(step);
});

$('#step').on('click', '.screenshot.clickable', function (e) {
    // flip the cards
    const { view, action } = getCard(e.currentTarget);
    if (action.status === status.EXPECTED) {
        action.status = status.ACTUAL;
    }
    else if (action.status === status.ACTUAL) {
        action.status = status.EDIT;
    }
    else {
        action.status = status.EXPECTED;
    }

    // we can only click the 2nd card in the step not the first.
    updateStepInView(TestAction.instances[action.index - 1]);
});

/** highlist the element that was acted on in the screenshot
 * when the user hovers over the text of a user-event
 */
$('#step').on('mouseenter mouseleave', '.user-event[data-index]', function (e) {
    $(`.overlay[data-index='${e.target.dataset.index}']`).toggle();
});

async function injectOnNavigation(obj) {
    console.debug('inject on navigation called', obj);
    if (obj.url !== currentUrl) {
        currentUrl = obj.url;
        await injectScript(obj.url);
    }
}

function setToolbarState() {
    $('button').prop('disabled', true); // start with all disabled and selectively enable some

    let rb = $('#recordButton');
    if (rb.hasClass('active')) { // recording?
        rb.prop('disabled', false);
        rb.prop('title', 'Brimstone is recording.\nClick to stop.');
        iconState.Record();
    }
    else {
        rb.prop('title', "Click to record.");
        $('#loadButton').prop('disabled', false); // playing?
        let pb = $('#playButton');
        if ($('#playButton').hasClass('active')) {
            pb.prop('disabled', false);
            iconState.Play();
        }
        else {
            // not playing, not recoding
            rb.prop('disabled', false);

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

    // buttons for editing allowable deltas in the second card.
    let editCard = $('#content .card:nth-of-type(2)');
    if (editCard.length) {
        const { action } = getCard(editCard);
        switch (action?.status) {
            case status.EXPECTED:
            case status.ACTUAL:
            case status.ALLOWED:
                $('#edit').prop('disabled', false);
                break;
            case status.EDIT:
                $('#ignoreDelta').prop('disabled', false);
                $('#ignoreRegion').prop('disabled', false);
                break;
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

$('#playButton').on('click', async () => {
    try {
        let actions = TestAction.instances;
        for (let i = 0; i < actions.length; ++i) {
            let action = actions[i];
            action.status = status.INPUT;
            updateThumb(action);
        }
        player.onBeforePlay = updateStepInView;
        player.onAfterPlay = updateStepInView;
        await tab.fromChromeTabId(tabId);
        tab.height = actions[0].tabHeight;
        tab.width = actions[0].tabWidth;
        tab.zoomFactor = 1; // FIXME this needs to come from the test itself! 

        await player.attachDebugger({ tab }); // in order to play we only need the debugger attached

        $('#playButton').addClass('active');
        setToolbarState();

        await player.play(actions); // players gotta play...
        $('#playButton').removeClass('active');
        setToolbarState();
    }
    catch (e) {
        $('#playButton').removeClass('active');
        setToolbarState();
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger(s) first.");
        }
        else {
            if (e?.message !== 'screenshots do not match') {
                throw e;
            }
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

/** Called during playback or recording when the user input results in a navigation to another page.
 * e.g. for a SPA test this would only occur on login or logout of the app.
 */
async function beforeNavigation(obj) {
    console.debug(`before navigation: ${obj.url}`);
}

chrome.debugger.onDetach.addListener(async (source, reason) => {
    console.debug('The debugger was detached.', source, reason);
    if (reason === 'canceled_by_user') {
        await sleep(500);
        await player.tab.resizeViewport();
        if (isRecording()) {
            stopRecording();
        }
        if (isPlaying) {
            stopPlaying(); // FIXME: refactor for less code
        }
    }
    else {
        // the debugger automatically detaches (eventually) when the tab navigates to a new URL. reason = target_closed
        await player.attachDebugger({ tab }); // it's the same tab...
    }
});

async function completeNavigation(obj) {
    console.debug(`complete navigation: ${obj.url}`);
    await injectOnNavigation(obj);
}

function detachNavigationListeners() {
    chrome.webNavigation.onBeforeNavigate.removeListener(beforeNavigation);
    chrome.webNavigation.onCompleted.removeListener(completeNavigation);
}

function attachNavigationListeners() {
    detachNavigationListeners();
    chrome.webNavigation.onBeforeNavigate.addListener(beforeNavigation);
    chrome.webNavigation.onCompleted.addListener(completeNavigation);
}

/** Set up everything needed for the workspace to communicate with the content script and vice-versa. */
async function startCommunication(tab) {
    // inorder to simulate any events we need to attach the debugger
    await player.attachDebugger({ tab });

    // establish the communication channel between the tab being recorded and the brimstone workspace window
    await listenOnPort(tab.url);

    // during recording if we navigate to another page within the tab I will need to re-establish the connection
    attachNavigationListeners();
}

async function stopCommunication(tab) {
    // tell the endpoint to stop recording. i.e. disable the event handlers if possible.
    try {
        postMessage({ type: 'stop' });
        // port.disconnect(); // why disconnect? I might want to play right after and reuse the port.
    }
    catch (e) {
        console.error(e);
    }
    detachNavigationListeners(); // navigation listeners inject the content-script, which we ONLY want to do when we are recording anyway.
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
        let action = await userEventToAction({ type: 'stop' });
        updateStepInView(action);
        let x = await stopRecording();
        //console.debug(x);
        return;
    }

    try {
        await tab.fromChromeTabId(tabId);
        console.debug(`recording tab ${tab.id} which is ${tab.width}x${tab.height} w/ zoom of ${tab.zoomFactor}`);

        await startCommunication(tab);

        // update the UI: insert the first text card in the ui
        let userEvent = {
            type: 'start', // start recording
            url: tab.url
        };
        let action = await userEventToAction(userEvent);
        zip = new JSZip(); // FIXME: refactor so this isn't needed here!
        updateStepInView(action);

        // last thing we do is give the focus back to the window and tab we want to record, so the user doesn't have to.
        await focusTab();

        button.addClass('active');
        setToolbarState();
    }
    catch (e) {
        await stopCommunication();
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

async function stopRecording() {
    $('#recordButton').removeClass('active');
    setToolbarState();
    stopCommunication(tab);
}

async function stopPlaying() {
    $('#playButton').removeClass('active');
    setToolbarState();
    stopCommunication(tab);
}

$('#clearButton').on('click', async () => {
    // remove the cards
    TestAction.instances = [];
    setToolbarState();

    $('#cards').empty();
    $('#step').empty();
});

function postMessage(msg) {
    console.debug('TX', msg);
    port.postMessage(msg);
}

$('#saveButton').on('click', async () => {
    console.debug('create zip');
    zip = new JSZip();
    zip.file('test.json', JSON.stringify({ steps: TestAction.instances }, null, 2)); // add the test.json file to archive
    var screenshots = zip.folder("screenshots"); // add a screenshots folder to the archive
    // add all the expected screenshots to the screenshots directory in the archive
    for (let i = 0; i < TestAction.instances.length; ++i) {
        let card = TestAction.instances[i];
        if (card.expectedScreenshot) {
            let response = await fetch(card.expectedScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.expectedScreenshot.fileName, blob, { base64: true });
        }
        if (card.actualScreenshot) {
            let response = await fetch(card.actualScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.actualScreenshot.fileName, blob, { base64: true });
        }
        if (card.acceptablePixelDifferences) {
            let response = await fetch(card.acceptablePixelDifferences.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.acceptablePixelDifferences.fileName, blob, { base64: true });
        }
    }

    console.debug('save zip to disk');
    let blobpromise = zip.generateAsync({ type: "blob" });
    const handle = await window.showSaveFilePicker({
        suggestedName: `test.zip`,
        types: [
            {
                description: 'A ZIP archive that can be run by Brimstone',
                accept: { 'application/zip': ['.zip'] }
            }
        ]
    });
    const writable = await handle.createWritable();
    let blob = await blobpromise;
    await writable.write(blob);  // Write the contents of the file to the stream.    
    await writable.close(); // Close the file and write the contents to disk.
});

$('#loadButton').on('click', async () => {
    try {
        let [fileHandle] = await window.showOpenFilePicker({
            suggestedName: `test.zip`,
            types: [
                {
                    description: 'A ZIP archive that can be run by Brimstone',
                    accept: { 'application/zip': ['.zip'] }
                }
            ]
        });
        const blob = await fileHandle.getFile();
        zip = await (new JSZip()).loadAsync(blob);
        let screenshots = await zip.folder('screenshots');
        let test = JSON.parse(await zip.file("test.json").async("string"));

        let actions = test.steps;

        // start: [url, viewport]
        // input: [click, type, double click, context menu]
        // action: [expected screen, input]
        // stop: expected screen
        // test: start, action[, action], stop


        // step: action, expected screen
        // that is expected screen, action, expected screen
        for (let i = 0; i < actions.length; ++i) {
            let actionDescriptor = actions[i];
            let testAction = new TestAction(actionDescriptor);
            await testAction.hydrate(screenshots);
        }

        // fun to watch them animate on load
        let i;
        for (i = 0; i < actions.length; ++i) {
            let action = TestAction.instances[i];
            updateStepInView(action);
            await (new Promise(resolve => setTimeout(resolve, 1))); // force an update of the screen

        }

        updateStepInView(TestAction.instances[0]);

        setToolbarState();
    }
    catch (e) {
        console.error(e);
    }
});

/**
 * Updates the UI, step (two cards) and the thumbnail for the given action.
 * @param {TestAction} action The modified action.
 */
function updateStepInView(action) {
    let step = new Step({ curr: action });
    setStepContent(step);
    updateThumb(action);
}

async function injectScript(url) {
    console.debug(`injecting script into ${url}`);

    await (new Promise(resolve => chrome.storage.local.set({ injectedArgs: { url } }, resolve)));
    await (new Promise(resolve => chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-recorder.js']
    }, resolve)));

    // Leaving in case I want to add css at some point.
    // await (new Promise(resolve => chrome.scripting.insertCSS({
    //     target: { tabId },
    //     files: ['unset-active.css']
    // }, resolve)));


    // (injectionResults) => {
    //     for (const frameResult of injectionResults)
    //         console.log('Injected script returns: ' + frameResult.result);
    // }
    //     );
    // });
}

var port = false;

function setStepContent(step) {
    $('#step').html(step.toHtml()); // two cards in a step
    setToolbarState();
};

/**
 * uUpdate the thumb from the given action
 * @param {Action} action 
 */
function updateThumb(action) {
    let $thumb = $(action.toThumb()); // smaller view
    let card = $(`#cards .card[data-index=${action.index}]`);
    if (card.length) {
        // replace
        card.replaceWith($thumb);
        $('#cards').scrollLeft(0);
        $('#cards').scrollLeft(card.position().left - 150);
    }
    else {
        uiCardsElement.appendChild($thumb[0]);
    }
}

async function addScreenshot(step) {
    let { dataUrl } = await takeScreenshot();
    step.expectedScreenshot = { dataUrl, fileName: `step${step.index}_expected.png` };
}

/** 
 * This is only used during recording. It update the zip file.
 * 
 * Process a user event received from the content script (during recording)
 * screenshot, annotate event and convert to card
 */
async function userEventToAction(userEvent) {
    let cardModel = new TestAction(userEvent);

    let element = userEvent.boundingClientRect;
    cardModel.tabHeight = tab.height;
    cardModel.tabWidth = tab.width;

    if (element) {
        cardModel.overlay = {
            height: element.height * 100 / tab.height,
            width: element.width * 100 / tab.width,
            top: element.top * 100 / tab.height,
            left: element.left * 100 / tab.width
        };
    }

    switch (userEvent.type) {
        case 'mousemove':
            cardModel.description = 'move mouse here';
            //cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break;
        case 'wheel':
            cardModel.description = 'move mouse here, then scroll via mouse wheel';
            cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            //await addScreenshot(cardModel);
            break;
        case 'keypress':
            cardModel.description = `type ${userEvent.event.key}`;
            await addScreenshot(cardModel);
            break;
        case 'click':
            cardModel.description = 'click';
            //cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break;
        case 'contextmenu':
            cardModel.description = 'right click';
            //cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break;
        case 'dblclick':
            cardModel.description = 'double click';
            //            cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break
        case 'stop':
            cardModel.description = 'stop recording';
            await addScreenshot(cardModel);
            break;
        case 'start': {
            cardModel.description = `goto ${cardModel.url}`;
            break;
        }
        default:
            cardModel.description = 'Unknown!';
            break;
    }
    return cardModel;
}

async function takeScreenshot() {
    let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png'
    });
    console.debug('\t\tscreenshot taken');
    return {
        dataUrl
    };
}

/** 
 * Inject the content script into the tab we intend to interact with.
 * Wait for the content script to connect to us on the port named 'brimstone'.
 * 
 * If our port is already connected, restart the event listeners.
*/
async function listenOnPort(url) {
    if (port) {
        postMessage({ type: 'start' });
        return Promise.resolve(port);
    }

    let p = new Promise(resolve => {
        chrome.runtime.onConnect.addListener(function (_port) { // wait for a connect
            if (_port.name !== 'brimstone') {
                return;
            }
            port = _port; // make it global
            port.onDisconnect.addListener(function (_port) {
                console.debug('port was disconnected!', port);
                port = false;
            });
            console.debug('port connected', port); // this will only happen once per window launch.
            port.onMessage.addListener(async function (userEvent) {
                console.debug(`RX: ${userEvent.type}`, userEvent);
                let action;
                switch (userEvent.type) {
                    case 'screenshot':
                        _lastScreenshot = (await takeScreenshot()).dataUrl;
                        postMessage({ type: 'complete', args: userEvent.type });
                        break;
                    case 'mousemove':
                    case 'wheel':
                        // update the UI with a screenshot
                        action = await userEventToAction(userEvent);
                        updateStepInView(action);
                        // no simulation required
                        // this does not ack, because it will always be followed by another operation.
                        break;
                    case 'click':
                    case 'keypress':
                    case 'contextmenu':
                    case 'dblclick':
                        // update the UI with a screenshot
                        action = await userEventToAction(userEvent);
                        updateStepInView(action);
                        // Now simulate that event back in the recording, via the CDP
                        await player[userEvent.type](userEvent);
                        postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
                        break;
                    case 'hello':
                        console.debug('got a new hello msg from injected content script');
                        await tab.resizeViewport(); // if the debugger doesn't need to be attached, we still need to resize the viewport
                        break;
                    default:
                        console.error(`unexpected userEvent received <${userEvent.type}>`);
                        break;
                }
            });
            resolve(port);
        });
    });

    await injectScript(url); // inject a content script that will connect
    return p;
}
