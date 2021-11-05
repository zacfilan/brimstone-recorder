import { Player } from "../player.js"
import { Tab } from "../tab.js"
import * as iconState from "../iconState.js";
import { Rectangle } from "../rectangle.js";
import { TestAction, getCard, constants, Step, TestMetaData } from "./card.js";
import { sleep, errorDialog } from "../utilities.js";
import { enableConsole, disableConsole } from "./console.js";
import { loadFile, saveFile } from "./loader.js";
import { Screenshot } from "./screenshot.js";
import { loadOptions, saveOptions } from "../options.js";
import * as Errors from "../error.js";

/** This version of brimstone-recorder, this may be diferent that the version a test was recorded by. */
const version = 'v' + chrome.runtime.getManifest().version;

// some meta keycodes
const ALT_KEYCODE = 18;
const META_KEYCODE = 91;
const CTRL_KEYCODE = 17;
const SHIFT_KEYCODE = 16;

const keycode2modifier = {};
keycode2modifier[ALT_KEYCODE] = 1;
keycode2modifier[CTRL_KEYCODE] = 2;
keycode2modifier[META_KEYCODE] = 4;
keycode2modifier[SHIFT_KEYCODE] = 8;

window.document.title = 'Brimstone - untitled';

async function errorHandler(e) {
    switch(e.constructor) {
        case Errors.PixelScalingError:
            let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
            await chrome.windows.update(w.id, { focused: true }); // you must be focused to see the alert
            window.alert(`🛑 Pixel scaling detected. Brimstone cannot reliably compare scaled pixels. Both the Brimstone workspace and the Chrome window being recorded must be unscaled.\n\nSet your Chrome zoom to 100%. Set your windows monitor display scale to 100%, or use an unscaled display. Restart Chrome, try again.\n\nWorksace will close when you hit [OK].`);
            // bail
            await chrome.windows.remove(w.id); // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason
            break;
        default:
            errorDialog(e);
            break;
        }
}

// catch all unhandled promise rejections and report them. i.e. any throws that occur within a promise chain.
window.addEventListener('unhandledrejection', async function(promiseRejectionEvent) {
    await errorHandler(promiseRejectionEvent.reason);
    return false;
});

window.addEventListener("error", async function(errorEvent) {
    await errorHandler(errorEvent.error);
    return false;
});

/** The id of the window that the user clicked the brimstone extension icon to launch this workspace. */
// grab the parent window id from the query parameter
const urlParams = new URLSearchParams(window.location.search);
let windowId = parseInt(urlParams.get('parent'), 10);

/**
 * allow this extension in incognito please. it increases the likelyhood that a test
 * recorded by person user can be replayed by another, since they will use common localstorage,
 * and probably have less conflicting extensions.
 */
(async function main() {
    let options = await loadOptions();
    if(options.developerMode) {
        window.alert(`🐞🔨 Developer mode enabled. I suggest you attach the debugger with ctrl+shift+i. Then hit [OK] once devtools is open.`);
        await sleep(1000);
        debugger;
    }
    else {
        disableConsole(); // can be reenabled in the debugger later
    }

    setToolbarState();

    let allowedIncognitoAccess = await (new Promise(resolve => chrome.extension.isAllowedIncognitoAccess(resolve)));
    if(!allowedIncognitoAccess) {
        let [activeChromeTab] = await chrome.tabs.query({ active: true, windowId: windowId });
        await chrome.tabs.update(activeChromeTab.id, { url: `chrome://extensions/?id=${chrome.runtime.id}` });
        while (!allowedIncognitoAccess) {
            window.alert(`🟡 Extension requires manual user intervention to allow incognito. Please flip the switch, "Allow in Incognito" so it\'s blue.\n\nOnce you do, please reopen the workspace.`);
            allowedIncognitoAccess =  await (new Promise(resolve => chrome.extension.isAllowedIncognitoAccess(resolve)));
        }
    }

    if(options.experimentalFeatures) {
        if(window.devicePixelRatio !== 1) {
            throw new Errors.PixelScalingError();
        }
    }
})();


/** used to *not* record pre-requisite screenshots when in the shadowDOM. */
var shadowDOMScreenshot = 0;

async function countDown(seconds) {
    let expectedScreenIndex = currentStepIndex() + 1;
    let action = TestAction.instances[expectedScreenIndex];
    action.overlay = {
        height: 100,
        width: 100,
        top: 0,
        left: 0
    };
    for (let i = seconds; i; --i) {
        action.overlay.html = i;
        updateStepInView(TestAction.instances[expectedScreenIndex - 1]);
        await sleep(1000);
    }
    delete action.overlay;
    updateStepInView(TestAction.instances[expectedScreenIndex - 1]);
}

let pendingScreenShotTimeout = null
async function replaceScreenshot() {
    if (!pendingScreenShotTimeout) {
        return;
    }
    try {
        console.log('replacing last screenshot');
        await captureScreenshotAsDataUrl();
        let lastAction = TestAction.instances[TestAction.instances.length - 1];
        // use the lower cost option, just the dataurl don't make into a PNG
        // that will come later when we create a user action.
        lastAction.expectedScreenshot = new Screenshot({
            dataUrl: _lastScreenshot
        });
        updateStepInView(TestAction.instances[TestAction.instances.length - 2]);
    }
    catch (e) {
        console.log('error replacing last screenshot', e);
        // the capture can fail if the app is in the middle of a navigation, in which case don't worry about the
        // screen, we will get it once it settles.
    }
}

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

/** The tab being recorded/played
 * @type {Tab}
 */
var tab = new Tab();

const player = new Player();

var uiCardsElement = document.getElementById('cards');

/**
 * asynchronously updated "latest" view of the appn
 * */
var _lastScreenshot;

/** 
 * lock down the screen state at a point in time
*/
var _lastSavedScreenshot;

/**
 * cache the last mouse move 
 * */
var _lastMouseMove;


/** The parsed test.json object, this will change in memory during use.
 * It represents the recorded user actions, and optionally the result
 * of playing them back. 
 * 
*/

$('#ignoreDelta').on('click',
    /** Commit any volatile rectangles or individual pixel deltas. */
    async function ignoreDelta(e) {

        // add a mask
        const { action, view } = getCard($('#content .card:nth-of-type(2)')[0]);
        await action.addMask(view);
        updateStepInView(TestAction.instances[action.index - 1]);
    }
);

$('#undo').on('click', async function () {
    // we need to purge the acceptablePixelDifferences (and all rectangles that might be drawn presently)
    const { view, action } = getCard('#content .waiting');
    action.acceptablePixelDifferences = new Screenshot();
    await action.pixelDiff();
    updateStepInView(TestAction.instances[action.index - 1]);
    addVolatileRegions();
});

$("#replace").on('click', async function () {
    // push the actual into the expected and be done with it.
    const { action, view } = getCard($('#content .card:nth-of-type(2)')[0]);
    action.expectedScreenshot.png = action.actualScreenshot.png;
    action.expectedScreenshot.dataUrl = action.actualScreenshot.dataUrl;
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

$('#step').on('click', '.action .title',
    function (e) {
        const { view, action } = getCard(e.currentTarget);
        let name = prompt('What would you like to name this step?', action.name || 'User action');
        if (name && name !== 'User action') {
            action.name = name;
            updateStepInView(TestAction.instances[action.index]);
        }
    }
);

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
    $('#infobar').html(version + ' ' + infobarText);
}

function setToolbarState() {
    $('#toolbar button').prop('disabled', true); // start with all disabled and selectively enable some

    let rb = $('#recordButton');
    if (rb.hasClass('active')) { // recording?
        rb.prop('disabled', false);
        rb.prop('title', 'Brimstone is recording.\nClick to stop.');
        iconState.Record();
        document.documentElement.style.setProperty('--action-color', 'red');
    }
    else {
        //not recording.
        rb.prop('title', "Click to record.");
        $('#loadButton').prop('disabled', false); // playing?
        let pb = $('#playButton');
        if ($('#playButton').hasClass('active')) {
            pb.prop('disabled', false);
            pb.prop('title', 'Brimstone is playing.\nClick to stop.');
            iconState.Play();
            document.documentElement.style.setProperty('--action-color', 'green');
        }
        else {
            pb.prop('title', "Click to play.");

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
            $('#replace').prop('disabled', false);
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
var playMatchStatus = constants.match.PASS;

/**
 * 
 * @param {object} args
 * @param {number=} args.width the width to set the active tab to
 * @param {number=} args.height the height to set the active tab to 
 * @param {string=} args.url the url to go to in the tab, if it is a chrome url
 * @param {Tab=} args.tab the tab to attach to, if not specifed the active tab is used.
 */
async function attachDebuggerToTab(args) {
    // what tab should I play in? I am going to take over the active tab, in the window that launched the workspace.
    let activeChromeTab = args?.tab;
    if (!activeChromeTab) {
        [activeChromeTab] = await chrome.tabs.query({ active: true, windowId: windowId });
    }

    // weird case, when the user closes the window that spawned the workspace - perhaps it should also close the workspace, but I dunno.
    if (!activeChromeTab || activeChromeTab.incognito !== args.incognito) {
        let window = await chrome.windows.create({
            //url: 'about:blank',
            type: "normal",
            focused: false, // why do i leave focus in the workspace?, i think because it mimics playback?
            incognito: args.incognito
        });
        windowId = window.id;
        [activeChromeTab] = await chrome.tabs.query({ active: true, windowId: windowId });
    }

    let w = await chrome.windows.get(activeChromeTab.windowId);
    if (w.state !== 'normal') {
        window.alert(`The window state of the tab you want to record or playback is '${w.state}'. It will be set to 'normal' to continue.`);
        await chrome.windows.update(activeChromeTab.windowId, { state: 'normal' });
    }

    if (args?.url) {
        // this better be a URL that I can attach a debugger to
        var resolveNavigationPromise;
        let navPromise = new Promise(resolve => { resolveNavigationPromise = resolve; });
        chrome.webNavigation.onCommitted.addListener(function navCommit(details) {
            chrome.webNavigation.onCommitted.removeListener(navCommit);
            resolveNavigationPromise(details);
        });
        await chrome.tabs.update(activeChromeTab.id, { url: args.url });
        let details = await navPromise; // the above nav is really done.
    }

    await tab.fromChromeTabId(activeChromeTab.id);

    args?.height && (tab.height = args.height);
    args?.width && (tab.width = args.width);
    args?.url && (tab.url = args.url); // don't want where we end up on redirect, want where we started
    tab.zoomFactor = 1; // FIXME this needs to come from the test itself! 

    await player.attachDebugger({ tab }); // in order to play we _only_ need the debugger attached, the recorder does not need to be injected
}

$('#step').on('click', '#chartButton', async function () {
    let latencyValues = TestAction.instances.map(a => a.latency);
    let memoryUsedValues = TestAction.instances.map(a => a.memoryUsed);
    let indicies = TestAction.instances.map(a => a.index);
    let chartDescriptor = JSON.stringify({
        type: 'line',
        data: {
            labels: indicies, // x-axis labels
            datasets: [
                {
                    label: 'Latency (secs.)',
                    borderColor: 'red',
                    backgroundColor: 'white',
                    fill: false,
                    data: latencyValues,
                    yAxisID: 'y'
                },
                {
                    label: 'Memory (MBs)',
                    borderColor: 'blue',
                    backgroundColor: 'white',
                    fill: false,
                    data: memoryUsedValues,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            stacked: false,
            title: {
                display: true,
                text: 'Some stats'
            },
            scales: {
                yAxes: [
                    {
                        id: "y",
                        type: "linear",
                        display: true,
                        position: "left"
                    },
                    {
                        id: "y1",
                        type: "linear",
                        display: true,
                        position: "right",
                        gridLines: {
                            drawOnChartArea: false
                        }
                    }
                ]
            }
        }
    });
    let window = await chrome.windows.create({
        url: chrome.runtime.getURL(`ui/chart.html?c=${chartDescriptor}`),
        type: "popup",
    });
});

$('#playButton').on('click', async function () {
    let button = $(this);
    if (button.hasClass('active')) {
        button.removeClass('active'); // stop playing
        player.stopPlaying();
        return;
    }
    try {
        $('#playButton').addClass('active');
        setToolbarState();

        let actions = TestAction.instances;
        player.onBeforePlay = updateStepInView;
        player.onAfterPlay = updateStepInView;

        let playFrom = currentStepIndex(); // we will start on the step showing in the workspace.
        let [activeChromeTab] = await chrome.tabs.query({ active: true, windowId: windowId });

        // weird case, when the user closes the window that spawned the workspace - perhaps it should also close the workspace, but I dunno.
        if (!activeChromeTab) {
            let window = await chrome.windows.create({
                url: 'about:blank',
                type: "normal",
                focused: false
            });
            windowId = window.id;
            [activeChromeTab] = await chrome.tabs.query({ active: true, windowId: windowId });
        }
        let url = false;

        // we can resume a failed step, which means we don't drive the action just check the screenshot results of it.
        // this is used when the user fixes a failed step and wants to play from there.
        let resume = (playMatchStatus === constants.match.FAIL || playMatchStatus === constants.match.CANCEL) && playFrom > 0;

        // common to record then immediately hit play, so do the rewind for the user
        if (playFrom === TestAction.instances.length - 1) {
            playFrom = 0;
            resume = false;
        }

        if (playFrom === 0) {
            // if we are playing from the beginning we navigate to about:blank, then to the starting url, then attach the debugger.
            // https://github.com/zacfilan/brimstone-recorder/issues/87
            await chrome.tabs.update(activeChromeTab.id, { url: 'about:blank' });
            url = actions[0].url;
            playFrom = 1; // don't navigate to the start twice
        }

        await attachDebuggerToTab({
            tab: activeChromeTab,
            width: actions[0].tabWidth,
            height: actions[0].tabHeight,
            url: url,
            incognito: TestAction.meta.incognito
        });

        await startPlaying(tab);

        playMatchStatus = await player.play(actions, playFrom, resume); // players gotta play...

        $('#playButton').removeClass('active');
        setToolbarState();

        await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });
        switch (playMatchStatus) {
            case constants.match.PASS:
            case constants.match.ALLOW:
                setInfoBarText('✅ last run passed');
                alert('✅ Test passed.');
                break;
            case constants.match.FAIL:
                updateStepInView(TestAction.instances[currentStepIndex()]);
                setInfoBarText(`❌ last run failed after user action ${player.currentAction.index + 1}`);
                break;
            case constants.match.CANCEL:
                updateStepInView(TestAction.instances[currentStepIndex()]);
                setInfoBarText(`❌ last run canceled after user action ${player.currentAction.index + 1}`);
                break;
            default:
                setInfoBarText(`💀 unknown status reported '${playMatchStatus}'`);
                break;
        }
    }
    catch (e) {
        $('#playButton').removeClass('active');
        setToolbarState();
        if (e === 'debugger_already_attached') {
            window.alert("You must close the existing debugger(s) first.");
        }
        else {
            setInfoBarText('💀 aborted! ' + e?.message ?? '');
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

// we have a handler for when the debugger detaches, if there was a command in flight when the debugger deattached
// it may be ok to ignore it, the only one I can think of is during *playback* while we are waiting to verify by reading screenshots
// and the debugger is detached because playback is in the middle of a navigation. that closes the debugger, which should reattach,
// the verify loop should pick up where it was just fine.


// if the user manually closes the debugger and then tries to record or play we need the debugger to reattach inorder for that to happen
// which means we need to wait and re-issue this command

// if we are recording and taking a screenshot with the debugger and it's detached we are sort of hosed.
async function debuggerOnDetach(source, reason) {
    console.debug('The debugger was detached.', source, reason);
    if (reason === 'canceled_by_user' || player._debugger_detach_requested) {
        //await sleep(500); // why do I wait here you ask. It's to give the banner a chance to disappear, so that the resize below works. 

        // sometimes this is re-entered after the workspace window has been closed.
        if (!player?.tab) {
            console.warn('race condition avoided');
            return;
        }
        await player.tab.resizeViewport();
        stopRecording();
        stopPlaying(); // FIXME: refactor for less code
    }
    // else {
    //     // the debugger automatically detaches (eventually) when the tab navigates to a new URL. reason = target_closed
    //     // this can also happen if the user closes the application tab being recorded (for some user reason) in the middle of a recording.
    //     try {
    //         await player.attachDebugger({ tab }); // it's the same tab...
    //     }
    //     catch (e) {
    //         stopRecording();
    //         stopPlaying();
    //         console.error(e);
    //         throw new Error("Unable to reattach the debugger.");
    //     }
    // }
};

chrome.debugger.onDetach.addListener(debuggerOnDetach);

/**
 * Hide the cursor in all frames.
 * Read value from Options, write into TestAction.meta.
 */
async function hideCursor() {
    if (TestAction.meta.hideCursor) {
        await chrome.tabs.sendMessage(tab.id, { func: 'hideCursor' });
    }
}

async function startPlaying(tab) {
    player.usedFor = 'playing';
    // only listen for navigations, when we are actively playing, and remove the listener when we are not.
    //https://developer.chrome.com/docs/extensions/reference/webNavigation/#event-onCompleted
    chrome.webNavigation.onCompleted.removeListener(playingWebNavigationOnCompleteHandler);
    chrome.webNavigation.onCompleted.addListener(playingWebNavigationOnCompleteHandler);

    await hideCursor();

}

async function playingWebNavigationOnCompleteHandler(details) {
    try {
        console.debug(`tab ${details.tabId} navigation completed`, details);
        if (details.url === 'about:blank') {
            console.debug(`    - ignoring navigation to page url 'about:blank'`);
            return;
        }
        await startPlaying(tab);

    }
    catch (e) {
        // this can be some intermediate redirect page(s) that the user doesn't actually interact with
        console.log('navigation completion failed.', e);
    }
}

/** 
 * Establish the recording communication channel between the tab being recorded and the brimstone workspace window.
 * This is in the global variable: port.
 */
async function startRecorders() {
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
            port?.onMessage?.removeListener(onMessageHandler); // this particular port is no good anymore so, kill the listener on it. needed?
            port = false;
        });

    port.onMessage.addListener(onMessageHandler);
    await captureScreenshotAsDataUrl(); // grab the first screenshot
}

/**  
 * tell all the content scripts what frame they are in via chrome.tab.sendMessage
 */
async function tellRecordersTheirFrameIds() {
    let frames = await (new Promise(response => chrome.webNavigation.getAllFrames({ tabId: tab.id }, response))); // get all frames
    for (let i = 0; i < frames.length; ++i) {
        let frame = frames[i];
        await chrome.tabs.sendMessage(tab.id, { func: 'setFrameId', args: { to: frame.frameId } }, { frameId: frame.frameId });
    }
}

async function prepareToRecord(tab) {
    player.usedFor = 'recording';

    console.debug(`begin - preparing to record tab ${tab.id} ${tab.url}`);
    console.debug(`      -  tab is ${tab.width}x${tab.height} w/ zoom of ${tab.zoomFactor}`);

    // only listen for navigations, when we are actively recording, and remove the listener when we are not recording.
    //https://developer.chrome.com/docs/extensions/reference/webNavigation/#event-onCompleted
    chrome.webNavigation.onCompleted.removeListener(webNavigationOnCompleteHandler);
    chrome.webNavigation.onCompleted.addListener(webNavigationOnCompleteHandler);

    await tellRecordersTheirFrameIds();
    await hideCursor();
    await tab.resizeViewport(); // this can be called on a navigation, and the tab needs to be the correct size before the port is established, in case it decides to send us some mousemoves

    console.debug(`end   - preparing to record tab ${tab.id} ${tab.url}`);
}

function stopRecording(tab) {
    chrome.webNavigation.onCompleted.removeListener(webNavigationOnCompleteHandler);

    $('#recordButton').removeClass('active');
    setToolbarState();
    // tell all frames to stop recording. i.e. disable the event handlers if possible.
    try {
        postMessage({ type: 'stop', broadcast: true });
        port.disconnect();
    }
    catch (e) {
        console.warn(e);
    }
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
    try {
        let button = $(this);
        if (button.hasClass('active')) {
            // before I take the last screenshot the window must have focus again.
            //await focusTab();
            let last = TestAction.instances[TestAction.instances.length - 1];
            last.addExpectedScreenshot(last.expectedScreenshot.dataUrl); // build the final png
            stopRecording();
            return;
        }

        let url = '';
        if (!TestAction.instances.length || currentStepIndex() === 0) {
            let options = await loadOptions();
            let defaultUrl = options?.url ?? '';
            url = prompt('Where to? Type or paste URL to start recording from.', defaultUrl);
            if (!url) {
                return false;
            }
            if (url.startsWith('chrome')) {
                alert('Recording chrome:// urls is not currently supported.\n\nTo record first navigate to where you want to start recording from. Then hit the record button.')
                return false;
            }
            options.url = url;
            saveOptions(options); // no need to wait
            TestAction.meta = new TestMetaData();
            TestAction.meta.incognito = options.recordIncognito;
            await attachDebuggerToTab({ url: url, incognito: TestAction.meta.incognito }); // get us there bro
        }
        else {
            // we are recording over some steps, don't do an initial navigate
            //FIXME: need to reset the lastScreenshot to whatever
            await attachDebuggerToTab({ incognito: TestAction.meta.incognito });
        }

        await prepareToRecord(tab);

        button.addClass('active');
        setToolbarState();

        // by the time we get here we have set up the 2 starting actions.
        // and should be polling for the screenshot

        if (!TestAction.instances.length) {
            startRecorders();

            // update the UI: insert the first text card in the ui
            await recordUserAction({
                type: 'start',
                url: tab.url
            });
        }
        else {
            // we are appending to an existing test
            let index = currentStepIndex(); // there are two cards visible in the workspace now. (normally - nuless the user is showing the last only!)
            TestAction.instances.splice(index + 2); // anything after these 2 is gone.

            //updateThumbs();
            await countDown(3);

            // rename that
            startRecorders(); // this REALLY activates the recorder, by connecting the port, which the recorder interprets as a request to start event listening.

            // we assume the app in in the state of the second card, containing the expected state.
            // when we record it will replace this card.
        }

        // last thing we do is give the focus back to the window and tab we want to record, so the user doesn't have to.
        await focusTab();
    }
    catch (e) {
        stopRecording();
        throw e;
    }
});

async function stopPlaying() {
    $('#playButton').removeClass('active');
    setToolbarState();
}

$('#clearButton').on('click', async () => {
    // remove the cards
    // FIXME abstract this away in a Test instance
    TestAction.instances = [];
    TestAction.meta = new TestMetaData();

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
    try {
        port.postMessage(msg);
    }
    catch (e) {
        // it is possible that we are in the process of navigating, either by synthetic or real user event (e.g. passive recording)
        // the port can be down.
        console.log('post message failed.', e);
    }
}

$('#saveButton').on('click', async () => {
    let file = await saveFile();
    if (file) {
        window.document.title = `Brimstone - ${file.name}`;
    }
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
    updateThumb(step.curr); // this isn't the cause of the slow processing of keystokes.
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
 * Uses the debugger API to capture a screenshot.
 * Returns the dataurl on success.
 * 
 * Cache the dataURl in the _lastScreenshot variable
 * 
 * @throws {Exception} on failure.
 */
async function captureScreenshotAsDataUrl() {
    _lastScreenshot = await player.captureScreenshotAsDataUrl();
    return _lastScreenshot;
}

// async function ignoreInputCaptureScreenshotAsDataUrl() {
//     await player.debuggerSendCommand('Input.setIgnoreInputEvents', { ignore: true });
//     let ss = await captureScreenshotAsDataUrl();
//     await player.debuggerSendCommand('Input.setIgnoreInputEvents', { ignore: false });
//     return ss;
// }

/**
 * Add the _lastScavedScreenshot to the cardmodel if that screenshot wasn't of
 * an open shadowDOM
 *  @param {TestAction} cardModel The action to add the screenshot to
 */
function addExpectedScreenshot(cardModel, ss = _lastScreenshot) {
    if (shadowDOMScreenshot) {
        --shadowDOMScreenshot;
        cardModel.shadowDOMAction = true;
    }
    cardModel.addExpectedScreenshot(ss);
}

/** 
 * This is only used during recording. 
 * 
 * Process a user event received from the content script (during recording)
 * screenshot, annotate event and convert to card
 */
async function userEventToAction(userEvent) {
    let frameId = userEvent?.sender?.frameId;
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
            height: element.height * 100 / tab.height, // height of target element as a percent of screenshot height
            width: element.width * 100 / tab.width, // width of target element as a percent screenshot width

            /** absolute y coordinate of the TARGET ELEMENT as a percent of screenshot */
            top: (element.top + frameOffset.top) * 100 / tab.height,
            /** absolute x coordinate of the TARGET ELEMENT as a percent of screenshot */
            left: (element.left + frameOffset.left) * 100 / tab.width,

            tabHeight: tab.height,
            tabWidth: tab.width,

            /** absolute x coordinate of the mouse position as a percent of screenshot */
            x: cardModel.x * 100 / tab.width,
            /** absolute y coordinate of the mouse position as a percent of screenshot */
            y: cardModel.y * 100 / tab.height
        };
    }

    let dataUrl = '';
    switch (userEvent.type) {
        case 'wait':
            cardModel.description = 'wait';
            break;
        case 'mouseover':
            // this is sort of an error case!
            cardModel.description = 'orphaned mouseover observed here';
            addExpectedScreenshot(cardModel, _lastScreenshot);
            break;
        case 'mousemove':
            cardModel.description = 'move mouse to here';
            addExpectedScreenshot(cardModel, _lastSavedScreenshot);
            break;
        case 'scroll':
            addExpectedScreenshot(cardModel);
            break;
        case 'keys':
            cardModel.description = 'type ';

            for (let i = 0; i < userEvent.event.length; ++i) {
                let event = userEvent.event[i];

                if (event.type === 'keydown') {
                    let isModifierKey = keycode2modifier[event.keyCode] || 0;
                    let modifiers = 0;
                    modifiers |= event.altKey ? 1 : 0;
                    modifiers |= event.ctrlKey ? 2 : 0;
                    modifiers |= event.metaKey ? 4 : 0;
                    modifiers |= event.shiftKey ? 8 : 0;

                    let chord = modifiers & ~isModifierKey;
                    if (chord) {
                        cardModel.description += `<span class='modifier'>+</span>`;
                    }
                    if (chord || event.key.length > 1) {
                        cardModel.description += `<span class='modifier'>${event.key}</span>`;
                    }
                    else {
                        cardModel.description += event.key;
                    }
                }
                // else keyup, nothing to report
            }
            addExpectedScreenshot(cardModel);
            break;
        case 'keydown':
        case 'keypress':
            cardModel.description = 'type ';
            if (userEvent.event.key.length > 1) {
                cardModel.description += `<span class='modifier'>${userEvent.event.key}</span>`;
            }
            else {
                cardModel.description += userEvent.event.key;
            }
            addExpectedScreenshot(cardModel);
            break;
        case 'click':
            cardModel.description = 'click';
            addExpectedScreenshot(cardModel);
            break;
        case 'contextmenu':
            cardModel.description = 'right click';
            addExpectedScreenshot(cardModel);
            break;
        case 'dblclick':
            cardModel.description = 'double click';
            addExpectedScreenshot(cardModel);
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
        case 'change':
            // change is not a direct UI action. it is only sent on SELECTs that change their value, which happens *after* the user interacts with the shadowDOM.
            // recorder can't detect when the shadowdom is opened (or interacted with at all), so it can't detect the start of a change action. it can't turn off
            // the auto screenshot updating mechanism (don't know we are in the shadow DOM), so it keeps clicking away while the user interacts with the shadow dom.
            // (hence the _lastScreenshot contains the state where the shadowDOM options are open and the user has clicked the new one, which is not the correct pre-requisite)
            // it only knows when the action is done by getting the change event. 
            // so there is no pre-requisite starting state for a change operation, it's not a directly observable UI action.
            // +1 shadowDOMScreenshot

            // furthur, during record, after the change event occurs, the shadowDOM is closed and the mouse may be somewhere new, without an observed mousemove.
            // i.e. there was a mousemove that started in the shadow DOM (which can't be seen) and ended somewhere else that can be seen. in order to record this mousemove it would
            // need the pre-requiste state of the mousemove, which occurs when the shadowDOM is open.
            // i decided that, the recorder won't use shadowDOM screenshots at all, so this (next) pre-requisite one too should be ignored.
            // +1 shadowDOMScreenshot

            cardModel.description = `change value to ${cardModel.event.value}`;
            shadowDOMScreenshot += 2;
            addExpectedScreenshot(cardModel);
            break;
        default:
            cardModel.description = 'Unknown!';
            break;
    }
    return cardModel;
}

/** 
 * set up the step and start refreshing the next expected screen */
async function recordUserAction(userEvent) {
    let action = await userEventToAction(userEvent); // convert userEvent to testaction, insert at given index

    // show the latest screenshot in the expected card and start polling it
    await captureScreenshotAsDataUrl();
    let wait = await userEventToAction({ type: 'wait' }); // create a new waiting action
    // use the lower cost option: just the dataUrl not the PNG. the PNG is generated when we create a userAction
    wait.expectedScreenshot = new Screenshot({ dataUrl: _lastScreenshot }); // something to show immediately
    wait._view = constants.view.DYNAMIC;

    updateStepInView(action); // update the UI
}

/** 
 * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
*/
async function onMessageHandler(message, _port) {
    let userEvent = message;
    console.debug(`RX: ${userEvent.type} ${userEvent.sender.href}`, userEvent);
    let action;

    userEvent._view = constants.view.EXPECTED;
    // the last one contains the screenshot the user was looking at in the expected when they recorded this action
    userEvent.index = Math.max(0, TestAction.instances.length - 1); // used by userEventToAction constructor
    switch (userEvent.type) {
        case 'error':
            // remove current expected
            if (TestAction.instances.length > 2) {
                TestAction.instances.splice(TestAction.instances.length - 1); // the expected and the mouseove start

                // rename the mouse start step, cause that needs to be re-recorded.
                TestAction.instances[TestAction.instances.length - 1].type = 'wait';
                updateStepInView(TestAction.instances[TestAction.instances.length - 2]); // update the UI 
            }
            stopRecording(); // I need to broadcast stop to all the frames
            break;
        case 'frameOffset':
            if (userEvent.sender.frameId === _waitForFrameOffsetMessageFromFrameId) {
                _resolvePostMessageResponsePromise(userEvent.args);
            }
            break;
        case 'save-lastscreenshot':
            _lastSavedScreenshot = _lastScreenshot;
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break
        // the user is actively waiting for the screen to change
        case 'wait':
            await captureScreenshotAsDataUrl(); // grab latest image

            if (!_lastSavedScreenshot) {
                _lastSavedScreenshot = _lastScreenshot;
            }

            let lastAction = TestAction.instances[userEvent.index]; // grab current expected action playholder (2nd card)

            // refresh the expected action placeholder the user sees.
            // use the lower cost option, just the dataurl don't make into a PNG
            // that will come later when we create the next user action.
            lastAction.expectedScreenshot = new Screenshot({
                dataUrl: _lastScreenshot
            });
            lastAction._view = constants.view.DYNAMIC;
            updateStepInView(TestAction.instances[TestAction.instances.length - 2]);

            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'mouseover':
        case 'mousemove':
        case 'click':
        case 'contextmenu':
        case 'dblclick':
            // it takes a mouse move to get here. if it wasn't allowed to end (fast user) we want to grab and reuse the pre-requisite screenshot of the mousemove.
            // (this is user error, if they want the right state they must wait and check, so acceptable.) 
            // if it is allowed to end, then still, we want to grab and reuse the pre-requisite screenshot of the mousemove

            // but we CANNOT take a SS here for the start state, because of :hover and :active issues on mouseover and mousedown respectively.
            recordUserAction(userEvent);

            // these need to be simulated because I do double click detection in the recorder itself, which intercepts click.
            // FIXME: why must I simulate these?

            // Could recorder passively monitor, and propagate them? i need to record *something*. is it a single click or a double click that I want to record?
            // I am using an old start state anyway...
            if (userEvent.handler?.simulate) {
                await player[userEvent.type](userEvent); // this can result in a navigation to another page.
            }

            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'scroll':
            recordUserAction(userEvent);
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        // keyevents should work almost the same as mousemove except, i want more/faster visual feedback for the user, which is 
        // why i simulate them. this lets the browser update the screen, even though I don't take a screenshot everytime.
        case 'keys':
            // i just don't know how to record in the shadowDOM very well!!
            recordUserAction(userEvent);
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'change':
            //recordUserAction(userEvent);
            let action = await userEventToAction(userEvent); // convert userEvent to testaction, insert at given index

            // show the latest screenshot in the expected card and start polling it
            await captureScreenshotAsDataUrl();
            let wait = await userEventToAction({ type: 'wait' }); // create a new waiting action
            // use the lower cost option: just the dataUrl not the PNG. the PNG is generated when we create a userAction
            wait.expectedScreenshot = new Screenshot({ dataUrl: _lastScreenshot }); // something to show immediately
            wait._view = constants.view.DYNAMIC;
            wait.shadowDOMAction = true;

            updateStepInView(action); // update the UI

            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'keydown':
        case 'keyup':
            if (userEvent.handler?.simulate) {
                await player[userEvent.type](userEvent); // this can result in a navigation to another page.
            }
            if (userEvent.handler?.record) {
                recordUserAction(userEvent);
            }

            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'connect':
            console.debug(`connection established from frame ${userEvent.sender.frameId}`);
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        default:
            console.warn(`unexpected userEvent received <${userEvent.type}>`);
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
    }
};

/**
 * This only is active when we are actively recording.
 * https://developer.chrome.com/docs/extensions/reference/webNavigation/#event-onCompleted
 */
async function webNavigationOnCompleteHandler(details) {
    try {
        console.debug(`tab ${details.tabId} navigation completed`, details);
        if (details.url === 'about:blank') {
            console.debug(`    - ignoring navigation to page url 'about:blank'`);
            return;
        }
        const { height, width } = tab; // hang onto the original size
        await tab.fromChromeTabId(details.tabId); // since this resets those to the chrome tab sizes, which is wrong because of the banner.
        tab.height = height;
        tab.width = width;

        await prepareToRecord(tab);
        startRecorders();
    }
    catch (e) {
        // this can be some intermediate redirect page(s) that the user doesn't actually interact with
        console.log('navigation completion failed.', e);
    }
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

        // tell this frames parent to broadcast down into his kids (including this frame) their offsets
        await chrome.tabs.sendMessage(tab.id, { func: 'postMessageOffsetIntoIframes' }, { frameId: frame.parentFrameId });
        // it's posted, but that doesn't mean much

        let response = await p; // eventually some 'frameOffset' messages come in, and when I see mie (this frame) this promise is resolved with my offset.

        frameOffset.left += response.left;
        frameOffset.top += response.top;
    }

    return frameOffset;
}