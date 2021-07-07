import { Player } from "../playerclass.js"
import { Tab } from "../tab.js"
import * as iconState from "../iconState.js";
import { Rectangle } from "../rectangle.js";
import { TestAction, getCard, status, Step } from "./card.js";

setToolbarState();

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

$('#step').on('click', 'button#ignoreDelta', async function (e) {
    // add a mask to the 
    const { action, view } = getCard(e.currentTarget);

    await action.addMask(view);
    await updateStepInView(TestAction.instances[action.index-1]);
});

// stop the image drap behavior
$('#step').on('mousedown', '.card.pixel-differences img', () => false);

$('#step').on('click', 'button#ignoreRegion', async function (e) {
    // add a mask to the 
    const { view } = getCard(e.currentTarget);
    let screenshot = view.find('.screenshot');
    screenshot.removeClass('clickable');
    Rectangle.setContainer(screenshot[0],
        () => {
            console.log('rectangle added');
        },
        () => {
            console.log('rectangle deleted');
        });
    // adds these to the DOM temporarily
});

$('#cards').on('click', '.thumb', async function (e) {
    const { action } = getCard(e.currentTarget);
    let step = new Step({curr: action });
    setStepContent(step);
});

$('#step').on('click', '.screenshot.clickable', function (e) {
    // flip the cards
    const { view, action } = getCard(e.currentTarget);
    if (view.hasClass('expected')) {
        view.removeClass('expected').addClass('actual');
        view.find('img').attr('src', action.actualScreenshot.dataUrl);
        view.find('.title').text(`[${action.index}]: Actual next screen (click image to toggle)`);
    }
    else if(view.hasClass('actual')) {
        view.replaceWith(`
        <div class='card pixel-differences' data-index=${action.index}>
            <div class='title'>[${action.index}]: Difference (red pixels). ${action.numDiffPixels} pixels, ${action.percentDiffPixels}% different
                <button title="Ignore differences" id="ignoreDelta">
                    <svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="thumbs-up" role="img"
                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-thumbs-up fa-w-16 fa-9x">
                        <path fill="currentColor"
                        d="M496.656 285.683C506.583 272.809 512 256 512 235.468c-.001-37.674-32.073-72.571-72.727-72.571h-70.15c8.72-17.368 20.695-38.911 20.695-69.817C389.819 34.672 366.518 0 306.91 0c-29.995 0-41.126 37.918-46.829 67.228-3.407 17.511-6.626 34.052-16.525 43.951C219.986 134.75 184 192 162.382 203.625c-2.189.922-4.986 1.648-8.032 2.223C148.577 197.484 138.931 192 128 192H32c-17.673 0-32 14.327-32 32v256c0 17.673 14.327 32 32 32h96c17.673 0 32-14.327 32-32v-8.74c32.495 0 100.687 40.747 177.455 40.726 5.505.003 37.65.03 41.013 0 59.282.014 92.255-35.887 90.335-89.793 15.127-17.727 22.539-43.337 18.225-67.105 12.456-19.526 15.126-47.07 9.628-69.405zM32 480V224h96v256H32zm424.017-203.648C472 288 472 336 450.41 347.017c13.522 22.76 1.352 53.216-15.015 61.996 8.293 52.54-18.961 70.606-57.212 70.974-3.312.03-37.247 0-40.727 0-72.929 0-134.742-40.727-177.455-40.727V235.625c37.708 0 72.305-67.939 106.183-101.818 30.545-30.545 20.363-81.454 40.727-101.817 50.909 0 50.909 35.517 50.909 61.091 0 42.189-30.545 61.09-30.545 101.817h111.999c22.73 0 40.627 20.364 40.727 40.727.099 20.363-8.001 36.375-23.984 40.727zM104 432c0 13.255-10.745 24-24 24s-24-10.745-24-24 10.745-24 24-24 24 10.745 24 24z"
                        class=""></path>
                    </svg>
                </button>

                <button title="Choose region to ignore" id="ignoreRegion">
                    <svg aria-hidden="true" focusable="false" data-prefix="fal" data-icon="expand-wide" role="img"
                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-expand-wide fa-w-16 fa-9x">
                        <path fill="currentColor"
                        d="M0 212V88c0-13.3 10.7-24 24-24h124c6.6 0 12 5.4 12 12v8c0 6.6-5.4 12-12 12H32v116c0 6.6-5.4 12-12 12h-8c-6.6 0-12-5.4-12-12zM364 64h124c13.3 0 24 10.7 24 24v124c0 6.6-5.4 12-12 12h-8c-6.6 0-12-5.4-12-12V96H364c-6.6 0-12-5.4-12-12v-8c0-6.6 5.4-12 12-12zm148 236v124c0 13.3-10.7 24-24 24H364c-6.6 0-12-5.4-12-12v-8c0-6.6 5.4-12 12-12h116V300c0-6.6 5.4-12 12-12h8c6.6 0 12 5.4 12 12zM148 448H24c-13.3 0-24-10.7-24-24V300c0-6.6 5.4-12 12-12h8c6.6 0 12 5.4 12 12v116h116c6.6 0 12 5.4 12 12v8c0 6.6-5.4 12-12 12z"
                        class=""></path>
                    </svg>
                </button>

                <button title="Undo and startover" id="undo">
                    <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="undo" class="svg-inline--fa fa-undo fa-w-16"
                        role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                        <path fill="currentColor"
                        d="M212.333 224.333H12c-6.627 0-12-5.373-12-12V12C0 5.373 5.373 0 12 0h48c6.627 0 12 5.373 12 12v78.112C117.773 39.279 184.26 7.47 258.175 8.007c136.906.994 246.448 111.623 246.157 248.532C504.041 393.258 393.12 504 256.333 504c-64.089 0-122.496-24.313-166.51-64.215-5.099-4.622-5.334-12.554-.467-17.42l33.967-33.967c4.474-4.474 11.662-4.717 16.401-.525C170.76 415.336 211.58 432 256.333 432c97.268 0 176-78.716 176-176 0-97.267-78.716-176-176-176-58.496 0-110.28 28.476-142.274 72.333h98.274c6.627 0 12 5.373 12 12v48c0 6.627-5.373 12-12 12z">
                        </path>
                    </svg>
                </button>
            </div>
            <div class='screenshot clickable'>
            <img src='${action.diffDataUrl}'>
        </div>
        `);
    }
    else {
        view.replaceWith(`
        <div class='card expected ${action.status}' data-index=${action.index}>
                <div class='title'>[${action.index}]: Expected next screen (click image to toggle)</div>
                <div class='screenshot clickable'>
                    <img src='${action.expectedScreenshot.dataUrl}'>;
                </div>
            </div>
        `);
    }
});

/** highlist the element that was acted on in the screenshot
 * when the user hovers over the text of a user-event
 */
$('#step').on('mouseenter mouseleave', '.user-event[data-index]', function (e) {
    $(`.overlay[data-index='${e.target.dataset.index}']`).toggle();
});

async function injectOnNavigation(obj) {
    console.log('GOT NAV in Recording Window', obj);
    if (obj.url !== currentUrl) {
        currentUrl = obj.url;
        await injectScript(obj.url);
        await tab.resizeViewport();
    }
}

function setToolbarState() {

    let ifNoCards = !TestAction.instances.length;

    let rb = $('#recordButton');
    if (rb.hasClass('active')) {
        rb.prop('title', 'Brimstone is recording.\nClick to stop.');

        $('#loadButton').prop('disabled', true);
        $('#playButton').prop('disabled', true);
        $('#saveButton').prop('disabled', true);
        $('#clearButton').prop('disabled', true);
        iconState.Record();
    }
    else {
        rb.prop('title', "Click to record.");
        $('#loadButton').prop('disabled', false);

        if ($('#playButton').hasClass('active')) {

            $('#loadButton').prop('disabled', true);
            $('#saveButton').prop('disabled', true);
            $('#clearButton').prop('disabled', true);
            $('#recordButton').prop('disabled', true);
            iconState.Play();
        }
        else {
            $('#playButton').prop('disabled', ifNoCards);
            $('#saveButton').prop('disabled', ifNoCards);
            $('#clearButton').prop('disabled', ifNoCards);
            iconState.Ready();
        }
    }
}

$('#playButton').on('click', async () => {
    // stopRecording(); // should not be necessary - button enable logic will prevent this
    try {
        let actions = TestAction.instances;
        for(let i=0; i < actions.length; ++i) {
            let action = actions[i];
             action.status = status.NOTRUN;
             updateThumb(action);
        }
        player.onBeforePlay = updateStepInView;
        player.onAfterPlay = updateStepInView;
        await tab.fromChromeTabId(tabId);
        tab.height = actions[0].tabHeight;
        tab.width = actions[0].tabWidth;
        tab.zoomFactor = 1; // FIXME this needs to come from the test itself! 

        await player.attachDebugger({
            tab,
            canceled_by_user: () => {
                player.stop();
                setToolbarState(); // you were playing but no longer
            },
            debugger_already_attached: () => { throw 'debugger_already_attached' }
        });

        $('#playButton').addClass('active');
        setToolbarState();

        await player.play(actions); // players gotta play...

        $('#playButton').removeClass('active');
        setToolbarState();
    }
    catch (e) {
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger first.");
        }
        else if (e?.message !== 'screenshots do not match') {
            throw e;
        }
    }
});

$('#continueButton').on('click', async () => {
    try {
        iconState.Play();
        await player.continue(); // players gotta play...
        iconState.Ready();
    }
    catch (e) {
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger first.");
        }
        else if (e?.message !== 'screenshots do not match') {
            throw e;
        }
        go.boom.now;
        await updateStepInView(e.failingStep); // update the UI with the pixel diff information
    }
});

$('#recordButton').on('click', async function () {
    let button = $(this);
    if (button.hasClass('active')) {
        button.removeClass('active'); // stop recording
        // before I take the last screenshot the window must have focus again.
        await chrome.windows.update(tab.windowId, { focused: true });
        let action = await userEventToAction({ type: 'stop' });
        await updateStepInView(action);
        let x = await stopRecording();
        console.log(x);
        return;
    }

    try {
        await tab.fromChromeTabId(tabId);
        console.log(`recording tab ${tab.id} which is ${tab.width}x${tab.height} w/ zoom of ${tab.zoomFactor}`);

        // inorder to simulate any events we need to attach the debugger
        await player.attachDebugger({
            tab,
            canceled_by_user: stopRecording,
            debugger_already_attached: () => { throw 'debugger_already_attached' }
        });

        // establish the communication channel between the tab being recorded and the brimstone workspace window
        await listenOnPort(tab.url);

        // during recording if we navigate to another page within the tab I will need to re-establish the connection
        chrome.webNavigation.onCompleted.addListener(injectOnNavigation);

        // update the UI: insert the first text card in the ui
        let userEvent = {
            type: 'start', // start recording
            url: tab.url
        };
        let action = await userEventToAction(userEvent);
        zip = new JSZip(); // FIXME: refactor so this isn't needed here!
        await updateStepInView(action);

        // last thing we do is give the focus back to the window and tab we want to record
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, {
            highlighted: true,
            active: true
            // url: tab.url // shouldn't need that
        });

        button.addClass('active');
        setToolbarState();
    }
    catch (e) {
        await stopRecording();
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger first.");
        }
        else if (e === "cannot_set_desired_viewport") {
            window.alert("Cannot resize the recording window. Do not start a recording maximized, space is needed for the debugger banner.");
            await stopRecording();
        }
        else {
            throw e;
        }
    }
});

async function stopRecording() {
    $('#recordButton').removeClass('active');
    $('#playButton').removeClass('active');

    setToolbarState();
    // tell the endpoint to stop recording
    try {
        try {
            postMessage({ type: 'stop' });
            port.disconnect();
        }
        catch { }
        chrome.webNavigation.onCompleted.removeListener(injectOnNavigation);
        await player.detachDebugger();
    }
    catch (e) {
        console.error(e);
    }
}

$('#clearButton').on('click', async () => {
    await stopRecording();

    // remove the cards
    TestAction.instances = [];
    setToolbarState();

    $('#cards').empty();
    $('#content .step').empty();
});

function postMessage(msg) {
    console.log('TX', msg);
    port.postMessage(msg);
}

$('#saveButton').on('click', async () => {
    console.log('create zip');
    zip = new JSZip();
    zip.file('test.json', JSON.stringify({ steps: cards }, null, 2)); // add the test.json file to archive
    var screenshots = zip.folder("screenshots"); // add a screenshots folder to the archive
    // add all the expected screenshots to the screenshots directory in the archive
    for (let i = 0; i < cards.length; ++i) {
        let card = cards[i];
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

    console.log('save zip to disk');
    let blob = await zip.generateAsync({ type: "blob" });
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
 * @param {Action} action The modified action.
 */
function updateStepInView(action) {
    let step = new Step({ curr: action });
    setStepContent(step);
    updateThumb(action);
}

async function injectScript(url) {
    console.log(`injecting script into ${url}`);

    await (new Promise(resolve => chrome.storage.sync.set({ injectedArgs: { url } }, resolve)));
    await (new Promise(resolve => chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-recorder.js']
    }, resolve)));

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
    let cardModel = userEvent; // start with the user event and convert to a cardModel (by adding some properties)
    cardModel.index = TestAction.instancesCreated++; // FIXME!!

    let element = userEvent.boundingClientRect;
    cardModel.tabHeight = tab.height;
    cardModel.tabWidth = tab.width;

    if (element) {
        cardModel.overlay = {
            height: `${element.height * 100 / tab.height}%`,
            width: `${element.width * 100 / tab.width}%`,
            top: `${element.top * 100 / tab.height}%`,
            left: `${element.left * 100 / tab.width}%`
        };
    }

    switch (userEvent.type) {
        case 'mousemove':
            cardModel.description = `movemouse to (${userEvent.x}, ${userEvent.y})`;
            //cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break;
        case 'keypress':
            cardModel.description = `type ${userEvent.event.key} in active element`;
            await addScreenshot(cardModel);
            break;
        case 'click':
            cardModel.description = `click at location (${userEvent.x}, ${userEvent.y})`;
            //cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break;
        case 'contextmenu':
            cardModel.description = `right click at location (${userEvent.x}, ${userEvent.y})`;
            //cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break;
        case 'dblclick':
            cardModel.description = `double click at location (${userEvent.x}, ${userEvent.y})`;
            //            cardModel.expectedScreenshot = { dataUrl: _lastScreenshot, fileName: `step${cardModel.index}_expected.png` };
            await addScreenshot(cardModel);
            break
        case 'stop':
            cardModel.description = 'stop recording';
            await addScreenshot(cardModel);
            break;
        case 'start': {
            cardModel.description = `start recording from ${cardModel.url}`;
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
    console.log('\t\tscreenshot taken');
    return {
        dataUrl
    };
}

/** One time */
/** Set up  */
async function listenOnPort(url) {
    if (port) {
        await injectScript(url); // inject a content script that will connect, really just need to restart the event listeners unless the ther end called disconnect.
        return Promise.resolve(port);
    }

    let p = new Promise(resolve => {
        chrome.runtime.onConnect.addListener(function (_port) { // wait for a connect
            if (_port.name !== 'brimstone') {
                return;
            }
            port = _port; // make it global
            // contentPort.onDisconnect.addListener(function(port) {
            //     replaceOnConnectListener(); // listen again for the next connection
            // });
            console.log('PORT CONNECTED', port); // this will only happen once per window launch.
            port.onMessage.addListener(async function (userEvent) {
                console.log(`RX: ${userEvent.type}`, userEvent);
                let action;
                switch (userEvent.type) {
                    case 'screenshot':
                        _lastScreenshot = (await takeScreenshot()).dataUrl;
                        postMessage({ type: 'complete', args: userEvent.type });
                        break;
                    case 'mousemove':
                        // update the UI with a screenshot
                        action = await userEventToAction(userEvent);
                        await updateStepInView(action);
                        // no simulation required
                        postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
                        break;
                    case 'click':
                    case 'keypress':
                    case 'contextmenu':
                    case 'dblclick':
                        // update the UI with a screenshot
                        action = await userEventToAction(userEvent);
                        await updateStepInView(action);
                        // Now simulate that event back in the recording, via the CDP
                        await player[userEvent.type](userEvent);
                        postMessage({ type: 'complete', args: userEvent.type }); // don't need to send the whole thing back
                        break;
                    case 'hello':
                        console.log('got a new hello msg from injected content script');
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
