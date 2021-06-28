import { Player } from "../playerclass.js"
import { Tab } from "../tab.js"
import * as iconState from "../iconState.js";
import { Rectangle } from "../rectangle.js";
import { Step, TextStep, ScreenshotStep, FailedStep, getCard, cards } from "./card.js";

iconState.Ready();

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

$('#content').on('click', 'button.ignore', async function (e) {
    // add a mask to the 
    const { model, view } = getCard(e.currentTarget);

    await model.addMask(view);
    await updateStepInView(model);
});

// stop the image drap behavior
$('#content').on('mousedown', '.card.pixel-differences img', () => false);

$('#content').on('click', 'button.volatile', async function (e) {
    // add a mask to the 
    const { view } = getCard(e.currentTarget);
    let screenshot = view.find('.screenshot');
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
    const { model } = getCard(e.currentTarget);
    await setContentStep(model);
});

$('#content').on('click', '.screenshot.clickable', function (e) {
    // flip the image
    const { view, model } = getCard(e.currentTarget);
    if (view.hasClass('expected')) {
        view.removeClass('expected').addClass('actual');
        view.find('img').attr('src', model.actualScreenshot.dataUrl);
        view.find('.title').text(`[${model.index}]: Actual current screen (click image to toggle)`);
    }
    else {
        view.removeClass('actual').addClass('expected');
        view.find('img').attr('src', model.expectedScreenshot.dataUrl);
        view.find('.title').text(`[${model.index}]: Expected current screen (click image to toggle)`);
    }
});



/** highlist the element that was acted on in the screenshot
 * when the user hovers over the text of a user-event
 */
$('#content').on('mouseenter mouseleave', '.user-event[data-index]', function (e) {
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

$('#playButton').on('click', async () => {
    // stopRecording(); // should not be necessary - button enable logic will prevent this
    try {
        cards.forEach(card => {
            card.status = 'notrun';
            updateStepInView(card);
        });
        player.onBeforePlay = updateStepInView;
        player.onAfterPlay = updateStepInView;
        await tab.fromChromeTabId(tabId);
        tab.height = cards[0].tabHeight;
        tab.width = cards[0].tabWidth;
        tab.zoomFactor = 1; // FIXME this needs to come from the test itself! 

        await player.attachDebugger({
            tab,
            canceled_by_user: () => {
                player.stop();
                iconState.Ready();
            },
            debugger_already_attached: () => { throw 'debugger_already_attached' }
        });

        iconState.Play();
        await player.play(cards); // players gotta play...
        iconState.Ready();
    }
    catch (e) {
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger first.");
        }
        else if (e?.message !== 'screenshots do not match') {
            throw e;
        }
        await updateStepInView(e.failingStep); // update the UI with the pixel diff information
    }
});

$('#endRecordingButton').on('click', async () => {
    // before I take the last screenshot the window must have focus again.
    await chrome.windows.update(tab.windowId, { focused: true });
    let action = await userEventToAction({ type: 'stop' });
    await updateStepInView(action);
    let x = await stopRecording();
    console.log(x);
});

$('#recordButton').on('click', async () => {
    try {
        await stopRecording();
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

        iconState.Record();
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
    // tell the endpoint to stop recording
    try {
        try {
            postMessage({ type: 'stop' });
            port.disconnect();
        }
        catch { }
        chrome.webNavigation.onCompleted.removeListener(injectOnNavigation);
        await player.detachDebugger();
        iconState.Ready();
    }
    catch (e) { 
        console.error(e);
    }
}

$('#clearButton').on('click', async () => {
    await stopRecording();
    Step.instancesCreated = 0;

    // remove the cards
    cards = [];
    $('#cards').empty();
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
    await stopRecording();
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

    let userEvents = test.steps;

    for (let i = 0; i < userEvents.length; ++i) {
        let userEvent = userEvents[i];
        await updateStepInView(userEvent);
    }

});

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
function setContentStep(step) {
    let $step = $(step.toHtml());
    $('#content .step').replaceWith($step); // the big card
};

/** The raw user action triggers an event which comes from the recording proess as a 'userEvent'. The userEvent is annotated 
 * into an action. The 'action' is passed into a particular 'step' generator, which is then
 * rendered in the UI. */
async function updateStepInView(action) {
    let step = new Step(action); // make sure it has a step number

    if (step.actualScreenshot) {
        let screenshots = zip.folder('screenshots');
        // this step failed - we need to generate the diff
        if (!step.expectedScreenshot.dataUrl) {
            step.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.expectedScreenshot.fileName).async('base64');
        }
        if (!step.actualScreenshot.dataUrl) {
            step.actualScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.actualScreenshot.fileName).async('base64');
        }
        if (step.acceptablePixelDifferences && !step.acceptablePixelDifferences.dataUrl) {
            step.acceptablePixelDifferences.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.acceptablePixelDifferences.fileName).async('base64');
        }

        step = new FailedStep(step);
        await step.pixelDiff();
    }
    else {
        let screenshots = zip.folder('screenshots');
        if (step.expectedScreenshot) {
            if (!step.expectedScreenshot.dataUrl) {
                step.expectedScreenshot.dataUrl = 'data:image/png;base64,' + await screenshots.file(step.expectedScreenshot.fileName).async('base64');
            }
            step = new ScreenshotStep(step);
        }
        else {
            step = new TextStep(step);
        }
    }

    setContentStep(step);
    let $thumb = $(step.toThumb()); // smaller view

    if (cards[step.index]) {
        // replace
        $(`#cards .card[data-index=${step.index}]`).replaceWith($thumb);
        let c = $(`#cards .card[data-index=${step.index}]`);
        if (c.length) {
            $('#cards').scrollLeft(c.position().left);
        }
    }
    else {
        uiCardsElement.appendChild($thumb[0]);
    }
    cards[step.index] = step;
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
    cardModel.index = Step.instancesCreated++;

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
        case 'keypress':
            cardModel.description = `type ${userEvent.event.key} at location (${userEvent.x}, ${userEvent.y})`;
            await addScreenshot(cardModel);
            break;
        case 'click':
            cardModel.description = `click at location (${userEvent.x}, ${userEvent.y})`;
            await addScreenshot(cardModel);
            break;
        case 'contextmenu':
            cardModel.description = `right click at location (${userEvent.x}, ${userEvent.y})`;
            await addScreenshot(cardModel);
            break;
        case 'dblclick':
            cardModel.description = `double click at location (${userEvent.x}, ${userEvent.y})`;
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
