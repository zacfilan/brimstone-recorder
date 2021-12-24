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


class Stack extends Array {
    /** 
     * return the top element of the stack 
     * @returns {Tab} */
    top() {
        return this[this.length - 1];
    }

    clear() {
        this.length = 0;
    }
};

/**
 * Used to remember what tabs are open, and the order they opened. 
 * Then when a tab is closed, I can re-attach the debugger to the previous tab.
 */
let tabStack = new Stack();

/**
 * The current test in memory.
 * @type {Test}
 */
Test.current = new Test();
window.document.title = `Brimstone - ${Test.current.filename}`;

async function focusWorkspaceWindow() {
    /** @type {chrome.windows.Window} */
    let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
    await chrome.windows.update(w.id, { focused: true }); // you must be focused to see the alert
    return w;
}

let brimstone = {
    window: {
        alert: async (...args) => {
            let ww = await focusWorkspaceWindow();
            window.alert('🙋❗ ' + args[0], ...args.slice(1));
            return ww;
        },
        confirm: async (...args) => {
            await focusWorkspaceWindow();
            return window.confirm('🙋❓ ' + args[0], ...args.slice(1));
        },
        prompt: async (...args) => {
            await focusWorkspaceWindow();
            return window.prompt('🙋 ' + args[0], ...args.slice(1));
        }
    }
}

/** 
 * We initially must obtain a tab of the right incognito'ness' to
 * *start* playing or recording on. This is sticky.
 * @type {Tab}
 */
var startingTab = new Tab();

const player = new Player();
/** used to *not* record pre-requisite screenshots when in the shadowDOM. */
var shadowDOMScreenshot = 0;

async function focusOrCreateTab(url) {
    let [tab] = await chrome.tabs.query({ url });
    if (!tab) {
        tab = await chrome.tabs.create({ url });
    }
    else {
        await chrome.tabs.update(tab.id, { active: true });
    }
    await chrome.windows.update(tab.windowId, { focused: true });
}

/** Generic thigs the user can do in the UI
 * 
 */
class Actions {
    /** open the actions for this extension */
    async openOptions() {
        await focusOrCreateTab(chrome.runtime.getURL('options_ui.html'));
    }

    /** try to record without specifying a URL */
    async recordActiveTab() {
        await recordSomething(true); // this can start a new recording of the the active tab (no initial goto url)
    }

    async exit() {
        try {
            let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
            await chrome.windows.remove(w.id);
        }
        catch (e) {
            console.log(e);
        }
    }

    async about() {
        await focusOrCreateTab('https://github.com/zacfilan/brimstone-recorder/wiki');
        //await focusOrCreateTab('https://chrome.google.com/webstore/detail/brimstone/kjelahkpdbdmajbknafeighkihkcjacd?hl=en');
    }

    async openWiki() {
        await focusOrCreateTab('https://github.com/zacfilan/brimstone-recorder/wiki/User-Guide');
    }

    async openIssues() {
        await focusOrCreateTab('https://github.com/zacfilan/brimstone-recorder/issues');
    }

    /** Let the user open a test (zip or plalistfile) */
    async openZip() {
        fileHandles = [];
        currentTestNumber = 0;
        try {
            let tempFileHandles = await Test.loadFileHandles();
            for (const fileHandle of tempFileHandles) {
                if (fileHandle.name.endsWith('.json')) {
                    if (!Playlist.directoryHandle) {
                        await brimstone.window.alert('You must specify a (base) directory that will contain all your tests before you can use playlists.');
                        if (!await this.loadLibrary()) {
                            fileHandles = [];
                            return;
                        }
                    }
                    let playlist = await (new Playlist()).fromFileHandle(fileHandle);
                    fileHandles.push(...playlist.play);
                }
                else {
                    fileHandles.push(fileHandle);
                }
            }
            if (fileHandles.length) {
                await loadNextTest();
            }
        }
        catch (e) {
            console.warn(e);
        }
    }

    /** Let the user specify a directory underwhich all recordings/tests/playlists will be accessible */
    async loadLibrary() {
        try {
            Playlist.directoryHandle = await window.showDirectoryPicker();
            return true;
        }
        catch (e) {
            return false;
        }
    }

    downloadLastRunJson() {
        downloadObjectAsJson(playedRecordings, 'last_run_metrics');
    }

    /** retpeat the last added rectangle(s) */
    async stampDelta() {

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

    /**
     * Insert a blank action before the current one. This along with recording over actions,
     * allows the user to insert newly recorded actions.
     */
    insertActionBefore() {
        const { action } = getCard($('#content .card:first-of-type')[0], Test.current);
        let newAction = new TestAction();
        newAction.setIndex(action.index);
        Test.current.insertAction(newAction);
        updateStepInView(Test.current.steps[action.index]);
    }

}
const actions = new Actions();
const menuController = new MenuController(actions);

async function errorHandler(e) {
    switch (e.constructor) {
        case Errors.PixelScalingError:
            let workspaceWindow = await brimstone.window.alert(`Pixel scaling detected. Brimstone cannot reliably compare scaled pixels. The Chrome window being recorded must be in an unscaled display.\n\nSet your windows monitor display scale to 100%, or put Chrome in an unscaled display. Restart Chrome, try again.\n\nWorkspace will close when you hit [OK].`);
            // bail
            try {
                await chrome.windows.remove(workspaceWindow.id);
            }
            catch (e) {
                console.log(e);
            }
            await chrome.windows.remove(w.id); // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason

            break;
        case Errors.ReuseTestWindow:
            await brimstone.window.alert(`You are trying to record into, or play from, the middle of an existing test, but there is no current Chrome test window that matches your current test requirements.`);
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
    await startingTab.fromWindowId(_windowId); // start with this one

    let activeChromeTab = startingTab.chromeTab;

    let allowedIncognitoAccess = await (new Promise(resolve => chrome.extension.isAllowedIncognitoAccess(resolve)));
    if (!allowedIncognitoAccess) {
        await brimstone.window.alert(`Extension requires manual user intervention to allow incognito. 
        
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

async function countDown(seconds, action) {
    for (let i = seconds; i; --i) {
        action.overlay.html = i;
        updateStepInView(Test.current.steps[action.index - 1]);
        await sleep(1000);
    }
    delete action.overlay;
    updateStepInView(Test.current.steps[action.index - 1]);
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
 * asynchronously updated "latest" view of the app
 * @type {Screenshot}
 * */
var _lastScreenshot;

/** 
 * lock down the screen state at a point in time
 * @type {Screenshot}
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
    $('[data-action="openOptions"]').attr('disabled', false);
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
            $('[data-action="loadLibrary"]').attr('disabled', false);
            $('[data-action="recordActiveTab"]').attr('disabled', false);
            $('#menu>.option').attr('disabled', false);

            rb.attr('disabled', false);
            document.documentElement.style.setProperty('--action-color', 'blue');

            if (Test.current.steps.length) {
                $('[data-action="saveZip"]').attr('disabled', false);
                $('[data-action="clearTest"]').attr('disabled', false);
                $('[data-action="downloadLastRunJson"]').attr('disabled', false);
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

$('[data-action="openOptions"]').on('click', actions.openOptions);
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

/**
 * All the recordings (zips) that were played in the last atomic play. This means that it
 * gets reset each time you play.
 */
var playedRecordings;

$('#playButton').on('click', async function () {
    let button = $(this);
    if (button.hasClass('active')) {
        stopPlaying();
        return;
    }
    try {
        let nextTest;
        playedRecordings = {
            totalNumberOfActions: 0,
            recordings: []
        };

        do {
            nextTest = false;
            $('#playButton').addClass('active');
            setToolbarState();
            await Test.current.imageProcessing(imageProcessingProgress);

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
                // we are on the first step of some test in the suite. 
                if (!await startingTab.reuse({ incognito: Test.current.incognito })) { // reuse if you can
                    await startingTab.create({ url: "about:blank", incognito: Test.current.incognito });   // if not create
                }
            }
            else {
                // we are resuming play in the middle of some test in the suite. The startingTab needs to already 
                // be up (and in the right state) to resume 
                if (!await startingTab.reuse({ incognito: Test.current.incognito })) { // reuse if you can
                    throw new Errors.ReuseTestWindow(); // if you can't then there is no way to resume
                }
            }

            startingTab.width = actions[0].tabWidth;
            startingTab.height = actions[0].tabHeight;

            let playingTab = new Tab(startingTab);
            tabStack = new Stack();
            tabStack.push(playingTab);

            await player.attachDebugger({ tab: playingTab });
            if (playingTab.url !== 'about:blank') {
                await playingTab.resizeViewport();
            }
            await playTab();

            playMatchStatus = await player.play(Test.current, playFrom, resume); // players gotta play...

            $('#playButton').removeClass('active');
            setToolbarState();

            await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });
            switch (playMatchStatus) {
                case constants.match.PASS:
                case constants.match.ALLOW:
                    playedRecordings.totalNumberOfActions += Test.current.steps.length;
                    playedRecordings.recordings.push({
                        filename: Test.current.filename,
                        steps: Test.current.steps.map(testAction => ({
                            index: testAction.index,
                            memoryUsed: testAction.memoryUsed,
                            latency: testAction.latency,
                            name: testAction.name,
                            css: testAction.css
                        }))
                    });
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
        stopPlaying();
    }
    catch (e) {
        stopPlaying();
        if (e === 'debugger_already_attached') {
            await brimstone.window.alert("You must close the existing debugger(s) first.");
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
// if we are recording and taking a screenshot with the debugger and it's detached we are sort of hosed.


// if the user manually closes the debugger and then tries to record or play we need the debugger to reattach inorder for that to happen
// which means we need to wait and re-issue this command

async function debuggerOnDetach(source, reason) {
    console.debug('The debugger was detached.', source, reason);

    if (isRecording()) {
        if (source.tabId !== tabStack.top().chromeTab.id) {
            console.debug(`will not record tabId:${source.tabId} is not tracked.`);
            return;
        }
        // else the tab we were recording had the debugger detach - reattach it.
        await recordTab();
    }
    else if (isPlaying()) {
        // the reattach will happen in the player itself
        // to the tab in the next played action
    }
    else {
        // the user somehow detached the debugger 
        //await sleep(500); // why do I wait here you ask. It's to give the banner a chance to disappear, so that the resize below works. 

        // sometimes this is re-entered after the workspace window has been closed.
        let topTab = tabStack?.top();
        if (!topTab) {
            console.warn('race condition avoided');
            return;
        }
        await topTab.resizeViewport();
    }
};

chrome.debugger.onDetach.addListener(debuggerOnDetach);

/**
 * Hide the cursor in all frames. If this test is so specified.
 */
async function hideCursor() {
    if (Test.current.hideCursor) {
        let tab = tabStack.top();
        await chrome.tabs.sendMessage(tab.chromeTab.id, { func: 'hideCursor' });
    }
}

/**
 * this is called (at least once) for *every* frame in details.tabId
 * every navigation in the main frame of the tab will result in any previously
 * attached debugger getting detached. which is why i do so much in here.
 *  */ 
async function webNavigationOnCompleteHandler(details) {
    try {
        
        if (isRecording()) {
            if (tabStack.top().chromeTab.id !== details.tabId) {
                console.debug(`tabId:${details.tabId} navigation completed in untracked tab. will track this tab now.`, details);
    
                // tell all the other frames in the previous tab to stop recording. i.e. disable the event handlers if possible.
                // FIXME: this should be a pause with a "not allowed" type pointer, maybe even an overlay to prevent user interaction, or block all user events.
                // https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-setIgnoreInputEvents
                try {
                    postMessage({ type: 'stop', broadcast: true });
                    port.disconnect();
                }
                catch (e) {
                    console.warn(e);
                }
    
                let tab = new Tab();
                // this popup will already have the debugger attached
                // but the player will have the older tab(id) registered for sendCommand so update it.
                player.tab = tab;
                tabStack.push(tab);
                await tab.fromTabId(details.tabId);
            }
            else {
                console.debug(`tab ${details.tabId} navigation completed in tab being recorded.`, details);
            }
            await recordTab();
        }
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
    console.debug('connect: creating port.');
    let recordingTab = tabStack.top();
    port = chrome.tabs.connect(recordingTab.chromeTab.id, { name: "brimstone-recorder" });

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
    let tab = tabStack.top();
    let tabId = tab.chromeTab.id;
    console.debug(`connect: tell each recorder in tabId:${tabId} their frame id`);
    let frames = await (new Promise(response => chrome.webNavigation.getAllFrames({ tabId: tabId}, response))); // get all frames
    for (let i = 0; i < frames.length; ++i) {
        let frame = frames[i];
        await chrome.tabs.sendMessage(tabId, { func: 'setFrameId', args: { to: frame.frameId } }, { frameId: frame.frameId });
    }
}

/** Fired when a tab is closed.  */
async function tabsOnRemovedHandler(tabId, removeInfo) {
    console.log(`tab tabId:${tabId} winId:${removeInfo.windowId} is removed.`, removeInfo);

    let i = tabStack.findIndex(tab => tab.chromeTab.id === tabId);
    if (i < 0) {
        await brimstone.window.alert("An untracked tab just closed. This is unexplained, your recording sesion may be unstable.");
        return;
    }

    if (i === 0) {
        await brimstone.window.alert("The brimstone workspace spawning tab just closed. This is unexplained, your recording session may be unstable.");
        return;

    }

    if (i !== tabStack.length - 1) {
        await brimstone.window.alert("The brimstone workspace is not closing the last opened tab first. Your recording session may be unstable.");
        return;
    }

    // else it's a tab i tracked being opened (e.g. a popup), that was just closed
    let closedTab = tabStack.pop();

    await recordUserAction({
        type: 'close',
        url: closedTab.chromeTab.url,
        sender: {
            href: closedTab.chromeTab.url
        }
    }); // convert userEvent to testaction, insert at given index

    if(tabStack.length) {
        await recordTab(); // switch to the previous tab
    }
    // FIXME: else we closed the only active tab, we should end the recording.
}

async function tabsOnActivatedHandler(activeInfo) {
    /* Fires when the active tab in a window changes. 
    Note that the tab's URL may not be set at the time this event fired, 
    but you can listen to onUpdated events so as to be notified when a URL is set.*/

    // I don't think I care
    console.log(`tab tabId:${activeInfo.tabId} winId:${activeInfo.windowId} is activated.`, activeInfo);
}

/**
 * 
 * @param {chrome.tabs.Tab} tab 
 */

async function tabsOnCreatedHandler(tab) {
    // the user performed an action that opened a new tab in *some* window.
    // should this be considered the tab we are recording now? does it matter?
    // an action will be recorded from *any* tab and placed in the workspace.

    // the screenshot poller should always be polling the 1 active focused tab+window.
    // like the highlander: "there can only be one".
    console.log(`tab tabId:${tab.id} winId:${tab.windowId} is created.`);
}

/**
 * 
 * @param {chrome.tabs.Tab} tab 
 */
async function tabsOnUpdatedHandler(tabId, changeInfo, tab) {
    console.log(`tab tabId:${tabId} winId:${tab.windowId} is updated.`, changeInfo);
}

/**
 * 
 * @param {chrome.windows.Window} window 
 */
async function windowsOnCreatedHandler(window) {
    console.log(`winId:${window.id} is created.`);
}

async function windowsOnFocusChangedHandler(window) {
    // first on created, is this
    console.log(`focus changed to winId:${window.id}.`);
}

async function windowsOnRemovedHandler(windowId) {
    console.log(`winId:${windowId} is removed.`);
}

// function debugEvent(debugee, method, params) {
//     console.log("EVENT! ", debugee, method, params);
// }

function addEventHandlers() {
    chrome.webNavigation.onCompleted.removeListener(webNavigationOnCompleteHandler);
    chrome.webNavigation.onCompleted.addListener(webNavigationOnCompleteHandler);

    chrome.tabs.onActivated.removeListener(tabsOnActivatedHandler);
    chrome.tabs.onActivated.addListener(tabsOnActivatedHandler);

    chrome.tabs.onRemoved.removeListener(tabsOnRemovedHandler);
    chrome.tabs.onRemoved.addListener(tabsOnRemovedHandler);

    chrome.tabs.onCreated.removeListener(tabsOnCreatedHandler);
    chrome.tabs.onCreated.addListener(tabsOnCreatedHandler);

    chrome.tabs.onUpdated.removeListener(tabsOnUpdatedHandler);
    chrome.tabs.onUpdated.addListener(tabsOnUpdatedHandler);

    chrome.windows.onCreated.removeListener(windowsOnCreatedHandler);
    chrome.windows.onCreated.addListener(windowsOnCreatedHandler);

    chrome.windows.onFocusChanged.removeListener(windowsOnFocusChangedHandler);
    chrome.windows.onCreated.addListener(windowsOnFocusChangedHandler);

    chrome.windows.onRemoved.removeListener(windowsOnRemovedHandler);
    chrome.windows.onRemoved.addListener(windowsOnRemovedHandler);
}

function removeEventHandlers() {
    chrome.webNavigation.onCompleted.removeListener(webNavigationOnCompleteHandler);

    chrome.tabs.onActivated.removeListener(tabsOnActivatedHandler);

    chrome.tabs.onRemoved.removeListener(tabsOnRemovedHandler);

    chrome.tabs.onCreated.removeListener(tabsOnCreatedHandler);

    chrome.tabs.onUpdated.removeListener(tabsOnUpdatedHandler);

    chrome.windows.onCreated.removeListener(windowsOnCreatedHandler);

    chrome.windows.onFocusChanged.removeListener(windowsOnFocusChangedHandler);

    chrome.windows.onRemoved.removeListener(windowsOnRemovedHandler);
}

/**
 * Set up navigation listener, which refires this function when a nav completes.
 * Tell recorders their frameids.
 * Hide the cursor.
 * Resize the viewport.
 * @param {Tab} tab 
 */
async function prepareToRecord() {
    let tab = tabStack.top();
    player.usedFor = 'recording';

    console.debug(`connect: begin - preparing to record tab ${tab.chromeTab.id} ${tab.url}`);
    console.debug(`connect:       -  tab is ${tab.width}x${tab.height}`);

    addEventHandlers();
    await tellRecordersTheirFrameIds();
    await hideCursor();
    if (tab.height && tab.width) {
        await tab.resizeViewport();
    }
    // else don't resize a popup
    console.debug(`connect: end   - preparing to record tab ${tab.chromeTab.id} ${tab.url}`);
}

function stopRecording() {
    tabStack = new Stack();

    removeEventHandlers();

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

    Test.current.startImageProcessing(imageProcessingProgress); // just kick it off again
}

async function focusTab() {
    await chrome.windows.update(tabStack.top().chromeWindow.id, { focused: true });
    await chrome.tabs.update(tabStack.top().chromeTab.id, {
        highlighted: true,
        active: true
    });
}

/**
 * Let's record something!
 * @param {boolean} attachActiveTab Splice record or URL record
 * @returns 
 */
async function recordSomething(attachActiveTab) {
    try {
        let button = $('#recordButton');
        if (button.hasClass('active')) {
            // before I take the last screenshot the window must have focus again.
            //await focusTab();
            let last = Test.current.steps[Test.current.steps.length - 1];
            last.addExpectedScreenshot(last.expectedScreenshot); // build the final png
            stopRecording();
            return;
        }

        let url = '';
        let options = await loadOptions();
        let index = currentStepIndex(); // there are two cards visible in the workspace now. (normally - unless the user is showing the last only!)
        //updateThumbs(); // If I actually changed it I should show that

        // are we doing an incognito recording - this is determined by the option first, or the state of the tab we are going to use
        Test.current.incognito = options.recordIncognito ? true : startingTab.chromeTab.incognito;

        // A completely fresh recording will prompt for the URL, else promp for splice record.
        // If the attachActiveTab is true we splice record, else it is a fresh (new URL) recording.
        if (!attachActiveTab) {
            let defaultUrl = options?.url ?? '';
            url = await brimstone.window.prompt('Where to? Type or paste URL to start recording from.', defaultUrl);
            if (!url) {
                return; // they bailed
            }
            if (url.startsWith('chrome')) {
                alert('Recording chrome:// urls is not currently supported.\n\nTo record first navigate to where you want to start recording from. Then hit the record button.')
                return false;
            }
            options.url = url; // Cache the last URL recorded so we can reset it in the prompt, next time.
            await saveOptions(options);
            let created = false;
            // recording from beginning

            if (!await startingTab.reuse({ url: url, incognito: Test.current.incognito })) {
                await startingTab.create({ url: url, incognito: Test.current.incognito });
                created = true;
            }

            let recordingTab = new Tab(startingTab);
            tabStack = new Stack();
            tabStack.push(recordingTab);

            await player.attachDebugger({ tab: recordingTab });
            await recordingTab.resizeViewport();

            await prepareToRecord();
            button.addClass('active');
            setToolbarState();

            // update the UI: insert the first text card in the ui
            await recordUserAction({
                type: 'goto',
                url: recordingTab.url
            });

            // FOCUS ISSUE. when we create a window (because we need to record incognito for example), 
            // and then navigate the active tab, the focus/active tabs styles aren't automatically placed 
            // on the document.activeElement. i don't know why this is the case. 
            // so the initial screen is recorded without "focus". 
            // 
            // to work around this i do this preamble on record (when first action is goto) and play when first action is goto. 
            await player.mousemove({ x: 0, y: 0 });
            await player.mousemove({ x: -1, y: -1 });
        }
        else {
            // we are going to record over some steps in the existing test
            if (Test.current.steps.length) {
                let action = Test.current.steps[index + 1];
                let old = {
                    overlay: action.overlay
                };
                action.overlay = {
                    height: 100,
                    width: 100,
                    top: 0,
                    left: 0,
                    html: '&nbsp;'
                };

                updateStepInView(Test.current.steps[index]);
                await sleep(10); // update the ui please

                // allow recording over the current steps (not insert, but overwriting them)
                if (!await brimstone.window.confirm(`Recording from here will overwrite existing actions, starting with action ${index + 2}, until you stop.`)) {
                    action.overlay = old.overlay;
                    updateStepInView(Test.current.steps[index]);
                    return;
                }
                Test.current.recordIndex = index + 1;

                // overwriting actions in an existing test
                if (!await startingTab.reuse({ incognito: Test.current.incognito })) {
                    throw new Errors.ReuseTestWindow();
                }

                let recordingTab = new Tab(startingTab);
                tabStack = new Stack();
                tabStack.push(recordingTab);

                await player.attachDebugger({ tab: recordingTab });
                await recordingTab.resizeViewport();

                await prepareToRecord();
                button.addClass('active');
                setToolbarState();
                await countDown(3, action);
            }
            else {
                // overwriting actions in an existing test
                // this is the case where the user wants to "Record Active Tab" from scratch.
                Test.current.reset();

                let recordingTab = new Tab(startingTab);
                tabStack = new Stack();
                tabStack.push(recordingTab);

                // If you "Record the Active Tab" you will make a recording in incognito or not based on the Active Tab state, not any external preferences!
                Test.current.incognito = recordingTab.chromeTab.incognito;

                if (!await recordingTab.reuse({ incognito: Test.current.incognito })) {
                    throw new Errors.ReuseTestWindow();
                }
                // there is nothing in the current test, so I should add something
                if (recordingTab.chromeTab.url.startsWith('chrome:')) {
                    await brimstone.window.alert("We don't currently allow recording in a chrome:// url. If you want this feature please upvote the issue.");
                    return;
                }
                await player.attachDebugger({ tab: recordingTab });
                await recordingTab.resizeViewport();

                await prepareToRecord();
                button.addClass('active');
                setToolbarState();

                // update the UI: insert the first text card in the ui
                await recordUserAction({
                    type: 'goto',
                    url: 'active tab'
                });

                // FOCUS ISSUE. when we create a window (because we need to record incognito for example), 
                // and then navigate the active tab, the focus/active tabs styles aren't automatically placed 
                // on the document.activeElement. i don't know why this is the case. 
                // so the initial screen is recorded without "focus". 
                // 
                // to work around this i do this preamble on record (when first action is goto) and play when first action is goto. 
                await player.mousemove({ x: 0, y: 0 });
                await player.mousemove({ x: -1, y: -1 });
            }
        }

        await startRecorders(); // this REALLY activates the recorder, by connecting the port, which the recorder interprets as a request to start event listening.

        // last thing we do is give the focus back to the window and tab we want to record, so the user doesn't have to.
        await focusTab();
    }
    catch (e) {
        stopRecording();
        throw e;
    }
}

$('#recordButton').on('click', (e) => {
    // if there are steps we interpret the button as splice record
    // if no we prompt for URL to record a fresh one

    // if the user wants to start a new (from blank) recording w/o a url
    // they can use the "Record Active Tab" option in the menu, and not use this button at all.    
    recordSomething(!!Test.current.steps.length);
});

function stopPlaying() {
    tabStack = new Stack();
    $('#playButton').removeClass('active');
    setToolbarState();
    //removeEventHandlers();
    player.stopPlaying();
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

$('#loadButton').on('click', actions.openZip.bind(actions));
$('#saveButton').on('click', actions.saveZip);
$('#clearButton').on('click', actions.clearTest);

function imageProcessingProgress(value, max) {
    let ib = $('#infobar');
    ib.html(`${version} processing image ${value}/${max} <progress max="${max}" value="${value}"></progress>`);
}

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

        // This load is just super fast.
        Test.current = await (new Test()).fromFileHandle(fileHandles[currentTestNumber - 1]);

        // kick off without waiting for this. 
        Test.current.startImageProcessing(imageProcessingProgress);
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

    let recordingTab = tabStack.top();

    cardModel.tabHeight = recordingTab.height;
    cardModel.tabWidth = recordingTab.width;

    cardModel.x += frameOffset.left;
    cardModel.y += frameOffset.top;

    if (element) {
        /** During recording we know the tab height and width, this will be the size of the screenshots captured.
         * We can convert the element positions in pixels into percentages. The overlay represents the location
         * of the overlay in percentages of the aspect-ratio preserved image.
         */
        cardModel.overlay = {
            height: element.height * 100 / recordingTab.height, // height of target element as a percent of screenshot height
            width: element.width * 100 / recordingTab.width, // width of target element as a percent screenshot width

            /** absolute y coordinate of the TARGET ELEMENT as a percent of screenshot */
            top: (element.top + frameOffset.top) * 100 / recordingTab.height,
            /** absolute x coordinate of the TARGET ELEMENT as a percent of screenshot */
            left: (element.left + frameOffset.left) * 100 / recordingTab.width,

            tabHeight: recordingTab.height,
            tabWidth: recordingTab.width,

            /** absolute x coordinate of the mouse position as a percent of screenshot */
            x: cardModel.x * 100 / recordingTab.width,
            /** absolute y coordinate of the mouse position as a percent of screenshot */
            y: cardModel.y * 100 / recordingTab.height
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
        case 'goto': {
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
        case 'close':
            cardModel.description = `close ${cardModel.url}`;
            cardModel.overlay = {
                height: 0,
                width: 0,
                top: 0,
                left: 0
            };
            cardModel._view = constants.view.EXPECTED;
            addExpectedScreenshot(cardModel);
            break;
        case 'change':
            // change is not a direct UI action. it is only sent on SELECTs that change their value, which happens *after* the user interacts with the shadowDOM.
            // recorder can't detect when the shadowdom is opened (or interacted with at all), so it can't detect the start of a change action. it can't turn off
            // the auto screenshot updating mechanism (don't know we are in the shadow DOM), so it keeps clicking away while the user interacts with the shadow dom.
            // (hence the _lastScreenshot contains the state where the shadowDOM options are open and the user has clicked the new one, which is not the correct pre-requisite)
            // it only knows when the action is done by getting the change event. 
            // so there is no pre-requisite starting state for await change operation, it's not a directly observable UI action.
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

    // show the latest screenshot in the expected card to give quick feedbak
    let wait = await userEventToAction({ type: 'wait' }); // create a new waiting action
    // use the lower cost option: just the dataUrl not the PNG. the PNG is generated when we create a userAction
    wait.expectedScreenshot = new Screenshot(_lastScreenshot); // something to show immediately
    wait._view = constants.view.DYNAMIC;
    wait.sender = {
        href: _lastScreenshot?.tab?.url
    };

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

            let ci = currentStepIndex();
            let lastAction = Test.current.steps[ci + 1];

            // refresh the expected action placeholder the user sees.
            // use the lower cost option, just the dataurl don't make into a PNG
            // that will come later when we create the next user action.
            lastAction.expectedScreenshot = new Screenshot(_lastScreenshot);
            lastAction._view = constants.view.DYNAMIC;
            lastAction.sender = {
                href: _lastScreenshot.tab.url
            };

            updateStepInView(Test.current.steps[ci]);
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
            wait.expectedScreenshot = new Screenshot(_lastScreenshot); // something to show immediately
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

/** state to know if we are already in the midde of the recordTab function,
 * to prevent doing it twice.
 */
let recordTabFunctionExecuting = false;

/**
 * Record the tab specified. This should be the top level
 * safe call to establish recording of the given tab.
 * @param {Tab} tab 
 */
async function recordTab() {
    let tab = tabStack.top();
    console.log(`record tabId: ${tab.chromeTab.id}`);

    if (recordTabFunctionExecuting) {
        console.warn('the recordTabFunction is already in progress');
        return;
    }
    recordTabFunctionExecuting = true;
    // FIXME: what happens if we spawn a "real window"?
    player.tab = tab; // at this point the debugger is already attached, to the popup (which is like a tab to the mainwindow, but in its own browser window?)

    await prepareToRecord();
    await startRecorders();
    recordTabFunctionExecuting = false;
}

/**
 * Change the active tab that the player instance
 * is currently playing.
 * @param {Tab} tab 
 */
async function playTab() {
    let tab = tabStack.top();
    console.log(`play tabId: ${tab.chromeTab.id}`);

    // FIXME: what happens if we spawn a "real window"?
    player.tab = tab; // at this point the debugger is already attached, to the popup (which is like a tab to the mainwindow, but in its own browser window?)
    
    player.usedFor = 'playing';
    //addEventHandlers();
    await hideCursor();
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
    let frames = await (new Promise(resolve => chrome.webNavigation.getAllFrames({ tabId: tabStack.top().chromeTab.id }, resolve))); // get all frames

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
        await chrome.tabs.sendMessage(tabStack.top().chromeTab.id, { func: 'postMessageOffsetIntoIframes' }, { frameId: frame.parentFrameId });
        // it's posted, but that doesn't mean much

        let response = await p; // eventually some 'frameOffset' messages come in, and when I see mie (this frame) this promise is resolved with my offset.

        frameOffset.left += response.left;
        frameOffset.top += response.top;
    }

    return frameOffset;
}