import { Player } from "../player.js"
import { Tab } from "../tab.js"
import * as iconState from "../iconState.js";
import { Rectangle } from "../rectangle.js";
import { TestAction, getCard, constants, Step } from "./card.js";
import { sleep, errorDialog, downloadObjectAsJson } from "../utilities.js";
import { disableConsole } from "./console.js";
import { Test, Playlist } from "../test.js";
import { Screenshot } from "./screenshot.js";
import { loadOptions, saveOptions } from "../options.js";
import * as Errors from "../error.js";
import { MenuController } from "./menu_controller.js";

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

/**
 * The current test in memory.
 * @type {Test}
 */
Test.current = new Test();
window.document.title = `Brimstone - ${Test.current.filename}`;

/** The testing tab being recorded/played
 * @type {Tab}
 */
var applicationUnderTestTab = new Tab();
const player = new Player();
/** used to *not* record pre-requisite screenshots when in the shadowDOM. */
var shadowDOMScreenshot = 0;

/** Generic thigs the user can do in the UI
 * 
 */
class Actions {
    async exit() {
        try {
            let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
            await chrome.windows.remove(w.id);
        }
        catch (e) {
            console.log(e);
        }
    }

    about() {
        chrome.tabs.create({
            url: 'https://chrome.google.com/webstore/detail/brimstone/kjelahkpdbdmajbknafeighkihkcjacd?hl=en'
        });
    }

    openWiki() {
        chrome.tabs.create({
            url: 'https://github.com/zacfilan/brimstone-recorder/wiki'
        });
    }

    openIssues() {
        chrome.tabs.create({
            url: 'https://github.com/zacfilan/brimstone-recorder/issues'
        });
    }

    /** Let the user open a test (zip file) */
    async openZip() {
        fileHandles = [];
        currentTestNumber = 0;
        try {
            fileHandles = await Test.loadFileHandles();
            if (fileHandles.length) {
                await loadNextTest();
            }
        }
        catch (e) {
            console.warn(e);
        }
    }

    /** Let the user open a test (playlist file) */
    async openPlaylist() {

    }

    /** Let the user specify a directory underwhich all recordings/tests/playlists will be accessible */
    async loadLibrary() {
        let handle = await window.showDirectoryPicker();
        debugger;
        let entries = await handle.entries();
        let values = await handle.values();
        let keys = await handle.keys();
        for await (let [key, value] of handle.entries()) {
            console.log({ key, value });
            if (value instanceof FileSystemDirectoryHandle) {
                for await (let [kkey, kvalue] of value.entries()) {
                    console.log('deep', { kkey, kvalue });
                }
            }
        }
    }

    /** Give the user quick access to raw JSON */
    exportJson() {
        // I only want a few properties, so swap out the serializer
        // let orig = TestAction.prototype.toJSON;
        // TestAction.prototype.toJSON = function () {
        //     return {
        //         index: this.index,
        //         memoryUsed: this.memoryUsed,
        //         latency: this.latency,
        //         name: this.name,
        //         css: this.css
        //     };
        // };
        let name = Test.current.filename.replace(/\.[^/.]+$/, '') + '_metrics';
        downloadObjectAsJson({ steps: Test.current.steps }, name);
        //TestAction.prototype.toJSON = orig;
    }

    /** edit pixel differences - Commit any volatile rectangles or individual pixel deltas. */
    async ignoreDelta(e) {
        // add a mask
        const { action, view } = getCard($('#content .card:nth-of-type(2)')[0], Test.current);
        await action.addMask(view);
        updateStepInView(Test.current.steps[action.index - 1]);
    }

    /** edit pixel differences - remove the allowed differences, see the differences */
    async seeDelta() {
        // we need to purge the acceptablePixelDifferences (and all rectangles that might be drawn presently)
        const { view, action } = getCard('#content .waiting', Test.current);
        action.acceptablePixelDifferences = new Screenshot();
        await action.pixelDiff();
        updateStepInView(Test.current.steps[action.index - 1]);
        addVolatileRegions();
    }

    /** edit pixel differences - when the recording is wrong */
    async replaceExpectedWithActual() {
        // push the actual into the expected and be done with it.
        const { action, view } = getCard($('#content .card:nth-of-type(2)')[0], Test.current);
        action.expectedScreenshot.png = action.actualScreenshot.png;
        action.expectedScreenshot.dataUrl = action.actualScreenshot.dataUrl;
        action.acceptablePixelDifferences = new Screenshot();
        await action.pixelDiff();
        updateStepInView(Test.current.steps[action.index - 1]);
        addVolatileRegions();
    }

    /** discard the current workspace test */
    async clearTest() {
        // remove the cards
        // FIXME abstract this away in a Test instance
        Test.current = new Test();

        setToolbarState();
        window.document.title = `Brimstone - ${Test.current.filename}`;

        $('#cards').empty();
        $('#step').empty();
    }

    /** save the current test as a zip file */
    async saveZip() {
        let file = await Test.current.saveFile();
        if (file) {
            window.document.title = `Brimstone - ${Test.current.filename}`;
        }
    }

    /** change the name of the currently displayed action */
    async editActionName() {
        const { action } = getCard($('#content .card:first-of-type')[0], Test.current);
        let name = prompt('What would you like to name this step?', action.name || 'User action');
        if (name && name !== 'User action') {
            action.name = name;
            updateStepInView(Test.current.steps[action.index]);
        }
    }

    async chartMetrics() {
        let latencyValues = Test.current.steps.map(a => a.latency);
        let memoryUsedValues = Test.current.steps.map(a => a.memoryUsed);
        let indicies = Test.current.steps.map(a => a.index);
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
    }

    /** Delete the currently displayed user action */
    deleteAction() {
        const { action } = getCard($('#content .card:first-of-type')[0], Test.current);
        Test.current.deleteAction(action);
        updateStepInView(Test.current.steps[action.index]);
    }

    /** Delete all actions before this one. This one becomes index 0. */
    deleteActionsBefore() {
        const { action } = getCard($('#content .card:first-of-type')[0], Test.current);
        Test.current.deleteActionsBefore(action);
        updateStepInView(Test.current.steps[0]);
    }

    /** Delete all actions after this one. We keep one past this since it is the ending action.*/
    deleteActionsAfter() {
        const { action } = getCard($('#content .card:first-of-type')[0], Test.current);
        Test.current.deleteActionsAfter(action);
        updateStepInView(Test.current.steps[action.index]);
    }

}
const actions = new Actions();
const menuController = new MenuController(actions);

async function errorHandler(e) {
    let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
    await chrome.windows.update(w.id, { focused: true }); // you must be focused to see the alert
    switch (e.constructor) {
        case Errors.PixelScalingError:
            window.alert(`🛑 Pixel scaling detected. Brimstone cannot reliably compare scaled pixels. The Chrome window being recorded must be in an unscaled display.\n\nSet your windows monitor display scale to 100%, or put Chrome in an unscaled display. Restart Chrome, try again.\n\nWorkspace will close when you hit [OK].`);
            // bail
            try {
                await chrome.windows.remove(applicationUnderTestTab.chromeWindow.id);
            }
            catch (e) {
                console.log(e);
            }
            await chrome.windows.remove(w.id); // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason

            break;
        case Errors.ReuseTestWindow:
            //let replay = window.confirm(`🛑 You are trying to record new steps and insert them into an existing test, but there is no current Chrome test window that matches your current test requirements.\n\nI can replay your test to the current step. After which you should be able to insert newly recorded steps.\n\nWould you like to do this?`);
            window.alert(`🛑 You are trying to record into, or play from, the middle of an existing test, but there is no current Chrome test window that matches your current test requirements.`);
            break;
        default:
            errorDialog(e);
            break;
    }
}

// catch all unhandled promise rejections and report them. i.e. any throws that occur within a promise chain.
window.addEventListener('unhandledrejection', async function (promiseRejectionEvent) {
    await errorHandler(promiseRejectionEvent.reason);
    return false;
});

window.addEventListener("error", async function (errorEvent) {
    await errorHandler(errorEvent.error);
    return false;
});

/**********************************************************************************************
 * Main entry point. - allow this extension in incognito please. it increases the likelyhood that a test
 * recorded by person user can be replayed by another, since they will use common localstorage,
 * and probably have less conflicting extensions.
 */
(async function main() {
    let options = await loadOptions();
    if (options.developerMode) {
        window.alert(`🐞🔨 Developer mode enabled. I suggest you attach the debugger with ctrl+shift+i. Then hit [OK] once devtools is open.`);
        await sleep(1000);
        debugger;
    }
    else {
        disableConsole(); // can be reenabled in the debugger later
    }

    setToolbarState();
    /** The id of the window that the user clicked the brimstone extension icon to launch this workspace. */
    // grab the parent window id from the query parameter   
    const urlParams = new URLSearchParams(window.location.search);
    let _windowId = parseInt(urlParams.get('parent'), 10);
    await applicationUnderTestTab.fromWindowId(_windowId); // start with this one
    let activeChromeTab = applicationUnderTestTab.chromeTab;

    let allowedIncognitoAccess = await (new Promise(resolve => chrome.extension.isAllowedIncognitoAccess(resolve)));
    if (!allowedIncognitoAccess) {
        window.alert(`🟡 Extension requires manual user intervention to allow incognito. 
        
When you hit [OK] I'll try to navigate you to the correct page (chrome://extensions/?id=${chrome.runtime.id}).

On that page please flip the switch, "Allow in Incognito" so it\'s blue, and reopen this workspace.`);
        let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually

        [activeChromeTab] = await chrome.tabs.query({ active: true, windowId: _windowId });
        await chrome.tabs.update(activeChromeTab.id, {
            url: `chrome://extensions/?id=${chrome.runtime.id}`,
            active: true,
            highlighted: true
        });
        await chrome.windows.update(activeChromeTab.windowId, { focused: true });
        await chrome.windows.remove(w.id);
    }
})();

async function countDown(seconds) {
    let expectedScreenIndex = currentStepIndex() + 1;
    let action = Test.current.steps[expectedScreenIndex];
    action.overlay = {
        height: 100,
        width: 100,
        top: 0,
        left: 0
    };
    for (let i = seconds; i; --i) {
        action.overlay.html = i;
        updateStepInView(Test.current.steps[expectedScreenIndex - 1]);
        await sleep(1000);
    }
    delete action.overlay;
    updateStepInView(Test.current.steps[expectedScreenIndex - 1]);
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

$('#step').on('click', '#ignoreDelta', async (e) => {
    e.stopPropagation();
    await actions.ignoreDelta();
});

$('#step').on('click', '#undo', async (e) => {
    e.stopPropagation();
    await actions.seeDelta();
});

$("#step").on('click', '#replace', async (e) => {
    e.stopPropagation();
    await actions.replaceExpectedWithActual();
});

$('#step').on('click', '[data-action="deleteAction"]', (e) => {
    e.stopPropagation();
    actions.deleteAction();
});

// stop the image drag behavior
$('#step').on('mousedown', '.card.edit img', () => false);

$('#cards').on('click', '.thumb',
    /** When the user clicks on the thumbnail put that step in the main area. */
    async function gotoStepFromThumb(e) {
        const { action } = getCard(e.currentTarget, Test.current);
        let step = new Step({ curr: action, test: Test.current });
        setStepContent(step);
    }
);

let diffPromise = false;

function addVolatileRegions() {
    const { view } = getCard($('#content .card.waiting')[0], Test.current);
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


$('#step').on('click', '.action .title', actions.editActionName);

$('#step').on('click', '.waiting .click-to-change-view',
    /** When clicking on an editable action, cycle through expected, actual, and difference views. */
    async function cycleEditStates(e) {
        // flip the cards
        const { view, action } = getCard(e.currentTarget, Test.current);
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
                        await action.acceptablePixelDifferences.hydrate(Test.current.zip?.folder("screenshots"));
                        action.editViewDataUrl = action.acceptablePixelDifferences.dataUrl;
                    }
                }
                else {
                    await action.actualScreenshot.hydrate(Test.current.zip?.folder("screenshots"));
                }
                updateStepInView(Test.current.steps[action.index - 1]);
                break;
            case constants.view.ACTUAL:
                action._view = constants.view.EDIT;
                if (!action.editViewDataUrl) {
                    if (!action.acceptablePixelDifferences) {
                        action.acceptablePixelDifferences = new Screenshot();
                    }
                    else {
                        await action.acceptablePixelDifferences.hydrate(Test.current.zip?.folder("screenshots"));
                    }
                    await action.pixelDiff();
                }
                updateStepInView(Test.current.steps[action.index - 1]);
                /** Add rectangles where we don't care about pixel differences. */
                addVolatileRegions();
                break;
            case constants.view.EDIT:
                action._view = constants.view.EXPECTED;
                await updateStepInView(Test.current.steps[action.index - 1]);
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
    $('[data-action]').attr('disabled', true);
    $('.help.option [data-action]').attr('disabled', false);
    $('[data-action="exit"]').attr('disabled', false);

    let rb = $('#recordButton');
    if (rb.hasClass('active')) { // recording?
        $('#menu>.option').attr('disabled', true);
        rb.attr('disabled', false);
        rb.attr('title', 'Brimstone is recording.\nClick to stop.');
        iconState.Record();
        document.documentElement.style.setProperty('--action-color', 'red');
    }
    else {
        //not recording.
        rb.prop('title', "Click to record.");
        let pb = $('#playButton');
        if ($('#playButton').hasClass('active')) {
            $('#menu>.option').attr('disabled', true);
            pb.attr('disabled', false);
            pb.prop('title', 'Brimstone is playing.\nClick to stop.');
            iconState.Play();
            document.documentElement.style.setProperty('--action-color', 'green');
        }
        else {
            pb.prop('title', "Click to play.");
            // not playing, not recoding
            $('[data-action="openZip"]').attr('disabled', false);
            $('#menu>.option').attr('disabled', false);

            rb.attr('disabled', false);
            document.documentElement.style.setProperty('--action-color', 'blue');

            if (Test.current.steps.length) {
                $('[data-action="saveZip"]').attr('disabled', false);
                $('[data-action="clearTest"]').attr('disabled', false);
                $('[data-action="exportJson"]').attr('disabled', false);
                $('[data-action="chartMetrics"]').attr('disabled', false);

                $('.edit.option [data-action]').attr('disabled', false); // everything under edit
                $('[data-action="deleteAction"]').attr('disabled', false); // delete action icon on card 

                let index = currentStepIndex();
                if (index > 0) {
                    $("#previous").attr('disabled', false);
                    $('#first').attr('disabled', false);
                }
                $('#playButton').attr('disabled', false);
                if (index < Test.current.steps.length - 1) {
                    $("#next").attr('disabled', false);
                    $("#last").attr('disabled', false);
                }
            }

            iconState.Ready();
        }
    }
    setInfoBarText();
}

$('#first').on('click', function (e) {
    updateStepInView(Test.current.steps[0]);
});

$('#previous').on('click', function (e) {
    let index = currentStepIndex();
    if (index > 0) {
        updateStepInView(Test.current.steps[index - 1]);
    }
});

/** Remember the state of the last play, so I can resume correctly. */
var playMatchStatus = constants.match.PASS;

$('#playButton').on('click', async function () {
    let button = $(this);
    if (button.hasClass('active')) {
        button.removeClass('active'); // stop playing
        player.stopPlaying();
        return;
    }
    try {
        let nextTest;
        do {
            nextTest = false;
            $('#playButton').addClass('active');
            setToolbarState();

            let actions = Test.current.steps;
            player.onBeforePlay = updateStepInView;
            player.onAfterPlay = updateStepInView;

            let playFrom = currentStepIndex(); // we will start on the step showing in the workspace.

            // we can resume a failed step, which means we don't drive the action just check the screenshot results of it.
            // this is used when the user fixes a failed step and wants to play from there.
            let resume = (playMatchStatus === constants.match.FAIL || playMatchStatus === constants.match.CANCEL) && playFrom > 0;

            // common to record then immediately hit play, so do the rewind for the user
            if (playFrom === Test.current.steps.length - 1) {
                playFrom = 0;
                resume = false;
            }

            if (playFrom === 0) {
                playFrom = 1; // don't navigate to the start twice, the goto is handled when we set up the applicationUnderTestTab
                if (!await applicationUnderTestTab.reuse({ url: actions[0].url, incognito: Test.current.incognito })) {
                    await applicationUnderTestTab.create({ url: actions[0].url, incognito: Test.current.incognito });
                }
            }
            else {
                if (!await applicationUnderTestTab.reuse({ incognito: Test.current.incognito })) {
                    throw new Errors.ReuseTestWindow();
                }
            }

            applicationUnderTestTab.url = actions[0].url;
            applicationUnderTestTab.width = actions[0].tabWidth;
            applicationUnderTestTab.height = actions[0].tabHeight;

            await player.attachDebugger({ tab: applicationUnderTestTab });

            await startPlaying(applicationUnderTestTab);

            playMatchStatus = await player.play(Test.current, playFrom, resume); // players gotta play...

            $('#playButton').removeClass('active');
            setToolbarState();

            await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });
            switch (playMatchStatus) {
                case constants.match.PASS:
                case constants.match.ALLOW:
                    nextTest = await loadNextTest();
                    if (!nextTest) {
                        setInfoBarText('✅ last run passed');
                        alert('✅ Test passed.');
                    }
                    break;
                case constants.match.FAIL:
                    updateStepInView(Test.current.steps[currentStepIndex()]);
                    setInfoBarText(`❌ last run failed after user action ${player.currentAction.index + 1}`);
                    break;
                case constants.match.CANCEL:
                    updateStepInView(Test.current.steps[currentStepIndex()]);
                    setInfoBarText(`❌ last run canceled after user action ${player.currentAction.index + 1}`);
                    break;
                default:
                    setInfoBarText(`💀 unknown status reported '${playMatchStatus}'`);
                    break;
            }
        } while (nextTest);
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
    if (index < Test.current.steps.length - 1) {
        updateStepInView(Test.current.steps[index + 1]);
    }
});

$('#last').on('click', function (e) {
    updateStepInView(Test.current.steps[Test.current.steps.length - 1]);
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
};

chrome.debugger.onDetach.addListener(debuggerOnDetach);

/**
 * Hide the cursor in all frames. If this test is so specified.
 */
async function hideCursor() {
    if (Test.current.hideCursor) {
        await chrome.tabs.sendMessage(applicationUnderTestTab.chromeTab.id, { func: 'hideCursor' });
    }
}

async function startPlaying() {
    player.usedFor = 'playing';
    // only listen for navigations, when we are actively playing, and remove the listener when we are not.
    //https://developer.chrome.com/docs/extensions/reference/webNavigation/#event-onCompleted
    chrome.webNavigation.onCompleted.removeListener(playingWebNavigationOnCompleteHandler);
    chrome.webNavigation.onCompleted.addListener(playingWebNavigationOnCompleteHandler);

    await hideCursor();
    // find FOCUS ISSUE in this file
    // this screws up playback after a pixel fix.
    //await player.mousemove({ x: 0, y: 0 });
    //await player.mousemove({ x: -1, y: -1 });
}

async function playingWebNavigationOnCompleteHandler(details) {
    try {
        console.debug(`tab ${details.tabId} navigation completed`, details);
        if (details.url === 'about:blank') {
            console.debug(`    - ignoring navigation to page url 'about:blank'`);
            return;
        }
        await startPlaying();

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
    let options = await loadOptions();
    // connect to all frames in the the active tab in this window. 
    // the recorder is injected in all pages, all frames, and will respond to onconnect by starting the event handlers.
    // https://developer.chrome.com/docs/extensions/reference/tabs/#method-connect
    console.debug('connect: creating port.')
    port = chrome.tabs.connect(applicationUnderTestTab.chromeTab.id, { name: "brimstone-recorder" });

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
    console.debug('connect: tell each recorder their frame id');
    let frames = await (new Promise(response => chrome.webNavigation.getAllFrames({ tabId: applicationUnderTestTab.chromeTab.id }, response))); // get all frames
    for (let i = 0; i < frames.length; ++i) {
        let frame = frames[i];
        await chrome.tabs.sendMessage(applicationUnderTestTab.chromeTab.id, { func: 'setFrameId', args: { to: frame.frameId } }, { frameId: frame.frameId });
    }
}

// function debugEvent(debugee, method, params) {
//     console.log("EVENT! ", debugee, method, params);
// }

/**
 * Set up navigation listener, which refires this function when a nav completes.
 * Tell recorders their frameids.
 * Hide the cursor.
 * Resize the viewport.
 * @param {Tab} tab 
 */
async function prepareToRecord(tab) {
    player.usedFor = 'recording';

    console.debug(`connect: begin - preparing to record tab ${tab.chromeTab.id} ${tab.url}`);
    console.debug(`connect:       -  tab is ${tab.width}x${tab.height}`);

    // only listen for navigations, when we are actively recording, and remove the listener when we are not recording.
    //https://developer.chrome.com/docs/extensions/reference/webNavigation/#event-onCompleted
    chrome.webNavigation.onCompleted.removeListener(webNavigationOnCompleteHandler);
    chrome.webNavigation.onCompleted.addListener(webNavigationOnCompleteHandler);

    await tellRecordersTheirFrameIds();
    await hideCursor();
    await tab.resizeViewport(); // this can be called on a navigation, and the tab needs to be the correct size before the port is established, in case it decides to send us some mousemoves
    console.debug(`connect: end   - preparing to record tab ${tab.chromeTab.id} ${tab.url}`);
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
    await chrome.windows.update(applicationUnderTestTab.chromeWindow.id, { focused: true });
    await chrome.tabs.update(applicationUnderTestTab.chromeTab.id, {
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
            let last = Test.current.steps[Test.current.steps.length - 1];
            last.addExpectedScreenshot(last.expectedScreenshot.dataUrl); // build the final png
            stopRecording();
            return;
        }

        let url = '';
        let options = await loadOptions();
        let index = currentStepIndex(); // there are two cards visible in the workspace now. (normally - unless the user is showing the last only!)
        //updateThumbs(); // If I actually changed it I should show that

        // are we doing an incognito recording - this is determined by the option first, or the state of the tab we are going to use
        Test.current.incognito = options.recordIncognito ? true : applicationUnderTestTab.chromeTab.incognito;

        if (!(index > 0)) {
            let defaultUrl = options?.url ?? '';
            url = prompt('Where to? Type or paste URL to start recording from.', defaultUrl);
            if (url.startsWith('chrome')) {
                alert('Recording chrome:// urls is not currently supported.\n\nTo record first navigate to where you want to start recording from. Then hit the record button.')
                return false;
            }
            options.url = url; // Cache the last URL recorded so we can reset it in the prompt, next time.
            saveOptions(options); // no need to wait

            // recording from beginning
            if (!await applicationUnderTestTab.reuse({ url: url, incognito: Test.current.incognito })) {
                await applicationUnderTestTab.create({ url: url, incognito: Test.current.incognito });
            }

            await player.attachDebugger({ tab: applicationUnderTestTab });
            await prepareToRecord(applicationUnderTestTab);
            button.addClass('active');
            setToolbarState();

            // update the UI: insert the first text card in the ui
            if (url) {
                await recordUserAction({
                    type: 'start',
                    url: applicationUnderTestTab.url
                });
            }
            else {
                await recordUserAction({
                    type: 'wait'
                });
            }

            // FOCUS ISSUE. when we create a window (because we need incognito for example) the focus isn't automatically placed on the viewport.
            // i don't know why this is the case. so the initial screen is recorded without focus. the when we playback
            // the first action is to move the mouse ontp the viewport so we can interact with it. this gives the viewport focus, before the
            // mousemove completes. So the expected (no focus) can never match the actual (with focus). 
            // to work around this i put the mouse on the viewport here to give it focus, in both recording and playback.
            await player.mousemove({ x: 0, y: 0 }); // this is a bit of a hack. on recordig we don't get focus automatically on the viewport when we mustsince the first mousemove onto the viewport affects the screen.
        }
        else {
            Test.current.steps.splice(index + 2); // anything after the step showing is gone.

            // appending to an existing test
            if (!await applicationUnderTestTab.reuse({ incognito: Test.current.incognito })) {
                throw new Errors.ReuseTestWindow();
            }

            await player.attachDebugger({ tab: applicationUnderTestTab });
            await prepareToRecord(applicationUnderTestTab);
            button.addClass('active');
            setToolbarState();

            await countDown(3);
        }

        startRecorders(); // this REALLY activates the recorder, by connecting the port, which the recorder interprets as a request to start event listening.

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

$('#loadButton').on('click', actions.openZip);
$('#saveButton').on('click', actions.saveZip);
$('#clearButton').on('click', actions.clearTest);

async function loadNextTest() {
    let numberOfTestsInSuite = fileHandles.length;
    if (++currentTestNumber > numberOfTestsInSuite) {
        return false;
    }
    let options = await loadOptions();
    let suite = numberOfTestsInSuite > 1 ? ` (test ${currentTestNumber}/${numberOfTestsInSuite})` : '';
    //let lastStep = Test.current.steps.length >= 1 ? Test.current.steps.length - 1 : 0;

    if (options.experiment.joinSubTests) {
        throw new Error("not implemented yet");
        //let nextTest = await constructNextTest();
        //testFileName = 'untitled';
    }
    else {
        await actions.clearTest();
        Test.current = await (new Test()).fromFileHandle(fileHandles[currentTestNumber - 1]);
    }

    window.document.title = `Brimstone - ${Test.current.filename}${suite}`;
    updateStepInView(Test.current.steps[0]);
    // for (let i = 1; i < Test.current.steps.length; ++i) {
    //      let action = Test.current.steps[i];
    //      updateThumb(action);
    // }
    setToolbarState();
    return true;
}

/** The filehandles of the tests the user loaded. Used for playing back 1 or more tests. */
let fileHandles = [];
/** The 1-based index of the current test. */
let currentTestNumber = 0;

function updateStepInView(action) {
    // immediately show if there is nothing pending
    let step = new Step({ curr: action, test: Test.current });
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
    Test.current.updateOrAppendAction(cardModel);

    let element = userEvent.boundingClientRect;
    cardModel.tabHeight = applicationUnderTestTab.height;
    cardModel.tabWidth = applicationUnderTestTab.width;

    cardModel.x += frameOffset.left;
    cardModel.y += frameOffset.top;

    if (element) {
        /** During recording we know the tab height and width, this will be the size of the screenshots captured.
         * We can convert the element positions in pixels into percentages. The overlay represents the location
         * of the overlay in percentages of the aspect-ratio preserved image.
         */
        cardModel.overlay = {
            height: element.height * 100 / applicationUnderTestTab.height, // height of target element as a percent of screenshot height
            width: element.width * 100 / applicationUnderTestTab.width, // width of target element as a percent screenshot width

            /** absolute y coordinate of the TARGET ELEMENT as a percent of screenshot */
            top: (element.top + frameOffset.top) * 100 / applicationUnderTestTab.height,
            /** absolute x coordinate of the TARGET ELEMENT as a percent of screenshot */
            left: (element.left + frameOffset.left) * 100 / applicationUnderTestTab.width,

            tabHeight: applicationUnderTestTab.height,
            tabWidth: applicationUnderTestTab.width,

            /** absolute x coordinate of the mouse position as a percent of screenshot */
            x: cardModel.x * 100 / applicationUnderTestTab.width,
            /** absolute y coordinate of the mouse position as a percent of screenshot */
            y: cardModel.y * 100 / applicationUnderTestTab.height
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
        case 'wheels':
            // rebase the individual wheel events position to their frame offsets
            cardModel.event.forEach(wheelEvent => {
                wheelEvent.x += frameOffset.left;
                wheelEvent.y += frameOffset.top;
            });
            addExpectedScreenshot(cardModel, _lastSavedScreenshot);
            break;
        case 'keys':
            cardModel.description = 'type ';

            for (let i = 0; i < userEvent.event.length; ++i) {
                let event = userEvent.event[i];

                if (event.type === 'keydown') {
                    let keyName = event.key;
                    if (i === userEvent.event.length - 1) {
                        keyName += '🠯';
                    }

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
                    if (chord || event.key.length > 1) { // these are button looking thangs
                        cardModel.description += `<span class='modifier'>${keyName}</span>`;
                    }
                    else {
                        cardModel.description += keyName;
                    }
                }
                else if (i === 0) {
                    // we are starting on a keyup
                    cardModel.description += `<span class='modifier'>${event.key}🠭</span>`;
                }
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
    return action;
}

/** 
 * https://developer.chrome.com/docs/extensions/reference/runtime/#type-Port
*/
async function onMessageHandler(message, _port) {
    let userEvent = message;
    console.debug(`RX: ${userEvent.type} ${userEvent.sender.href}`, userEvent);

    userEvent._view = constants.view.EXPECTED;
    // the last one contains the screenshot the user was looking at in the expected when they recorded this action
    userEvent.index = Math.max(0, Test.current.steps.length - 1); // used by userEventToAction constructor
    let action;
    switch (userEvent.type) {
        case 'error':
            // remove current expected
            if (Test.current.steps.length > 2) {
                Test.current.steps.splice(Test.current.steps.length - 1); // the expected and the mouseove start

                // rename the mouse start step, cause that needs to be re-recorded.
                Test.current.steps[Test.current.steps.length - 1].type = 'wait';
                updateStepInView(Test.current.steps[Test.current.steps.length - 2]); // update the UI 
            }
            stopRecording(); // I need to broadcast stop to all the frames
            break;
        case 'frameOffset':
            if (userEvent.sender.frameId === _waitForFrameOffsetMessageFromFrameId) {
                console.log(`connect: using frameOffset for frameId ${userEvent.sender.frameId}`);
                _resolvePostMessageResponsePromise(userEvent.args);
            }
            else {
                console.log(`connect: ignoring frameOffset for frameId ${userEvent.sender.frameId}`);
            }
            break;
        case 'save-lastscreenshot':
            _lastSavedScreenshot = _lastScreenshot;
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        // the user is actively waiting for the screen to change
        case 'wait':
            await captureScreenshotAsDataUrl(); // grab latest image

            // only one time ever
            if (!_lastSavedScreenshot) {
                _lastSavedScreenshot = _lastScreenshot;
            }

            let lastAction = Test.current.steps[userEvent.index]; // grab current expected action playholder (2nd card)

            // refresh the expected action placeholder the user sees.
            // use the lower cost option, just the dataurl don't make into a PNG
            // that will come later when we create the next user action.
            lastAction.expectedScreenshot = new Screenshot({
                dataUrl: _lastScreenshot
            });
            lastAction._view = constants.view.DYNAMIC;
            updateStepInView(Test.current.steps[Test.current.steps.length - 2]);

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
            action = await recordUserAction(userEvent);

            // these need to be simulated because I do double click detection in the recorder itself, which intercepts click.
            // FIXME: why must I simulate these?
            // Could recorder passively monitor, and propagate them? i need to record *something*. is it a single click or a double click that I want to record?
            // I am using an old start state anyway...
            if (userEvent.handler?.simulate) {
                await player[action.type](action); // this can result in a navigation to another page.
            }

            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'wheel':

            let frameId = userEvent?.sender?.frameId;
            let frameOffset = await getFrameOffset(frameId);
            userEvent.x += frameOffset.left;
            userEvent.y += frameOffset.top;

            if (userEvent.handler?.saveScreenshot) {
                _lastSavedScreenshot = _lastScreenshot;
            }

            // in this case the uesrEvent is essentially shaped like an action
            // by the recorder
            if (userEvent.handler?.simulate) {
                await player[userEvent.type](userEvent); // this can result in a navigation to another page.
            }

            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'wheels':
            await recordUserAction(userEvent);
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        // keyevents should work almost the same as mousemove except, i want more/faster visual feedback for the user, which is 
        // why i simulate them. this lets the browser update the screen, even though I don't take a screenshot everytime.
        case 'keys':
            // i just don't know how to record in the shadowDOM very well!!
            await recordUserAction(userEvent);
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'change':
            //await (userEvent);
            action = await userEventToAction(userEvent); // convert userEvent to testaction, insert at given index

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
                await recordUserAction(userEvent);
            }

            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            break;
        case 'connect':
            console.debug(`connect: connection established from frame ${userEvent.sender.frameId} ${userEvent.sender.href}`);

            // FIXME: the recorder didn't know its frameID when it asked to connect, so I can't really
            // use the 'to' correctly here. I'd ike to sendback the correct frameID right away.
            postMessage({ type: 'complete', args: userEvent.type, to: userEvent.sender.frameId }); // ack
            await tellRecordersTheirFrameIds(); // the recorder doesn't know it's frameId when it is connected, so tell it (them all)
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

        // a user action during recording caused a navigation.
        // update the applicationUnderTestTab to reflect the new state of the tab
        const { height, width } = applicationUnderTestTab; // hang onto the original size
        let chromeTab = await chrome.tabs.get(details.tabId);
        await applicationUnderTestTab.fromChromeTab(chromeTab); // since this resets those to the chrome tab sizes, which is wrong because of the banner.
        applicationUnderTestTab.height = height;
        applicationUnderTestTab.width = width;

        await prepareToRecord(applicationUnderTestTab);
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
    let frames = await (new Promise(resolve => chrome.webNavigation.getAllFrames({ tabId: applicationUnderTestTab.chromeTab.id }, resolve))); // get all frames

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
        await chrome.tabs.sendMessage(applicationUnderTestTab.chromeTab.id, { func: 'postMessageOffsetIntoIframes' }, { frameId: frame.parentFrameId });
        // it's posted, but that doesn't mean much

        let response = await p; // eventually some 'frameOffset' messages come in, and when I see mie (this frame) this promise is resolved with my offset.

        frameOffset.left += response.left;
        frameOffset.top += response.top;
    }

    return frameOffset;
}