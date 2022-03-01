'use strict';

import { Player } from "../player.js"
import { Tab } from "../tab.js"
import * as iconState from "../iconState.js";
import { Correction, Rectangle } from "../rectangle.js";
import { TestAction, getCard, constants, Step } from "./card.js";
import { sleep, downloadObjectAsJson } from "../utilities.js";
import { disableConsole, enableConsole } from "./console.js";
import { Test, PlayTree } from "../test.js";
import { Screenshot } from "./screenshot.js";
import { loadOptions, options, saveOptions } from "../options.js";
import * as Errors from "../error.js";
import { MenuController } from "./menu_controller.js";
import { clone, brimstone, focusWorkspaceWindow } from "../utilities.js";
import * as BDS from "./brimstoneDataService.js";

const ALT_KEYCODE = 18;
const META_KEYCODE = 91;
const CTRL_KEYCODE = 17;
const SHIFT_KEYCODE = 16;

const keycode2modifier = {};
keycode2modifier[ALT_KEYCODE] = 1;
keycode2modifier[CTRL_KEYCODE] = 2;
keycode2modifier[META_KEYCODE] = 4;
keycode2modifier[SHIFT_KEYCODE] = 8;
const PNG = png.PNG;

/**
 * Used to remember what tabs are open, and the order they opened. 
 * Then when a tab is closed, I can re-attach the debugger to the previous tab.
 */
Tab.reset();

/**
 * The current test in memory.
 * @type {Test}
 */
Test.current = new Test();
window.document.title = `Brimstone - ${Test.current._playTree.path()}`;

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
    _modalClosed; // function to resolve a promise externally

    /** lastAction executed */
    nameOfLastMethodExecuted;

    /**
     * last user action executed
     */
    nameOfLastUserActionExecuted;

    /**
     * Pass in another method of this class.
     * Track it as being called from a user gensture.
     * @param {function} method 
     * @returns 
     */
    async callMethodByUser(method, ...args) {
        this.nameOfLastUserActionExecuted = method.name;
        return await method.call(this, ...args);
    }

    async callMethodNameByUser(methodName, ...args) {
        this.nameOfLastUserActionExecuted = methodName;
        return await this[methodName](...args);
    }

    /**
     * Pass in another method of this class.
     * Track it as being executed.
     * @param {function} method 
     * @returns 
     */
    async callMethod(method) {
        this.nameOfLastMethodExecuted = method.name;
        return await method.call(this);
    }

    async openOptions() {
        await focusOrCreateTab(chrome.runtime.getURL('options_ui.html'));
    }

    /** try to record without specifying a URL */
    async recordActiveTab() {
        await recordSomething(false); // this can start a new recording of the the active tab (no initial goto url)
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

    /** Let the user open a test (zip or json playlist file) */
    async openZip() {
        zipNodes = [];
        currentTestNumber = 0;
        try {
            let tempFileHandles = await Test.loadFileHandles();
            if (!tempFileHandles?.length > 0) {
                return; // user changed mind.
            }
            PlayTree.complete = await (new PlayTree()).fromFileHandles(...tempFileHandles);
            PlayTree.complete.depthFirstTraversal(zipNodes); // FIXME: add cycle check

            if (zipNodes.length) {
                await loadNextTest();
            }
        }
        catch (e) {
            if (e instanceof Errors.TestLoadError) {
                await brimstone.window.alert(e);
            }
            else {
                throw e;
            }
        }
    }

    /** Let the user specify a directory under which all recordings/tests/playlists will be accessible */
    async loadLibrary() {
        await PlayTree.loadLibrary();
    }

    async downloadLastRunMetrics() {
        downloadObjectAsJson(lastRunMetrics, 'last_run_metrics');
    }

    /**
    * Report the results of the PlayTree (root node) played.
    * If the toplevel is a suite, a report for each child will be reported.
    * Else a single report will be reported. 
    * 
    * @param {boolean?} autoPostMetrics If true we will only post if the matching postMetricsOn* option is enabled.
    * If false we will blindly post the metrics.
    */
    async postLastRunMetrics(autoPostMetrics) {
        let options = await loadOptions();

        // (re)-generate the results in the playtree 
        let reports = lastRunMetrics;
        for (let i = 0; i < reports.length; ++i) {
            let report = reports[i];
            if (!autoPostMetrics ||
                (options.postMetricsOnFail && report.status === constants.match.FAIL) ||
                (options.postMetricsOnPass && report.status === constants.match.PASS)) {
                $.ajax({
                    type: "POST",
                    url: options.postMetricsEndpoint,
                    data: JSON.stringify(report),
                    contentType: "application/json",
                    success: function (result) {
                        console.log(result);
                    },
                    error: function (jqXHR, textStatus, errorThrown) {
                        brimstone.window.alert(`There was a problem posting last run's metrics.\n\nMore information may be available in devtools.`);
                    }
                });
            }
            // else not run or some other crap
        };
    }

    /** 
     * User clicked a button to apply their corrections that are
     * pending on the EDIT view.
     * @param {Event} e - the button clicked is avaiable in here 
     * */
    async applyCorrections(e) {
        const { action, view } = getCard($('#content .card:nth-of-type(2)')[0], Test.current);
        await action.applyCorrections(view, e);
        updateStepInView(Test.current.steps[action.index - 1]);
        action.test.dirty = true;
        if (action.autoPlay) {
            this.callMethod(this.playSomething);
        }
        else {
            addVolatileRegions();
        }
    }

    /** 
     * Called when we want to "start over".
     * All acceptable pixel differences are removed, and we recalculate the
     * pixel differences.
     *  */
    async undo() {
        // we need to purge the acceptablePixelDifferences (and all rectangles that might be drawn presently)
        const { view, action } = getCard('#content .waiting', Test.current);
        action.autoPlay = false;
        action.acceptablePixelDifferences = new Screenshot({
            png: new PNG({
                width: action.pixelDiffScreenshot.png.width,
                height: action.pixelDiffScreenshot.png.height
            })
        }); // chuck whatever we got out.
        action.calculatePixelDiff();
        updateStepInView(Test.current.steps[action.index - 1]);

        addVolatileRegions();
        action.test.dirty = true;
    }

    async clearWorkspace() {
        await this.clearTest();
        Correction.availableInstances = [];
        delete PlayTree.current;
    }

    /** discard everytihing in the current workspace*/
    async clearTest() {
        if (Test.current.dirty) {
            // the dreaded "user gesture required"
            // await focusWorkspaceWindow();
            // let result = window.confirm(`🙋❓ File '${Test.current.filename}' has unsaved changes.\n\nDo you want to save?`);
            // if(result) {
            //     await actions.saveZip();
            // }

            let result = await actions.confirmSaveModal();
        }

        Test.current.removeScreenshots();

        // remove the cards
        // FIXME abstract this away in a Test instance
        Test.current = new Test();
        Tab.reset();
        lastRunMetrics = undefined;

        setToolbarState();
        window.document.title = `Brimstone - ${Test.current._playTree.path()}`;

        $('#cards').empty();
        $('#step').empty();
        if(options.forgetCorrectionsWhenTestIsCleared) {
            Correction.availableInstances = [];
        }
    }

    /** save the current test as a zip file */
    async saveZip() {
        let fileHandle = await Test.current.saveFile();
        // the name may have changed
        if (fileHandle) {
            Test.current.filename = fileHandle.name;
            window.document.title = `Brimstone - ${Test.current._playTree.path()}`;
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

    editActionJson() {
        const { action } = getCard($('#content .card:first-of-type')[0], Test.current);
        var copy = clone(action); // pass a copy

        // don't allow edit of these
        delete copy.expectedScreenshot;
        delete copy.acceptablePixelDifferences;
        delete copy.actualScreenshot;

        var modalContentContainer = $('#modal-content').html('');
        var wrapper = $('<div class="content-wrapper"></div>');
        modalContentContainer.append(wrapper);
        var jsonEditorContainer = $("<div id='json-editor'></div>");
        wrapper.append(jsonEditorContainer);
        jsonEditor = new JSONEditor(jsonEditorContainer[0], {
            mode: 'form',
            onChangeJSON: json => {
                Object.assign(action, json);
                updateStepInView(action);
            }
        });
        jsonEditor.set(copy);
        modalContentContainer.modal();
    }

    viewTestJson() {
        var test = clone(Test.current); // pass a copy
        var modalContentContainer = $('#modal-content').html('');
        var wrapper = $('<div class="content-wrapper"></div>');
        modalContentContainer.append(wrapper);
        var jsonEditorContainer = $("<div id='json-editor'></div>");
        wrapper.append(jsonEditorContainer);
        jsonEditor = new JSONEditor(jsonEditorContainer[0], {
            mode: 'view',
        });
        jsonEditor.set(test);
        modalContentContainer.modal();
    }

    async chartMetrics() {
        let latencyValues = [];
        let memoryUsedValues = [];
        let labels = [];

        let index = 0;
        for (let ri = 0; ri < lastRunMetrics.length; ++ri) {
            let recording = lastRunMetrics[ri];
            for (let si = 0; si < recording.steps.length; ++si) {
                let step = recording.steps[si];
                labels.push(step.index + 1);
                memoryUsedValues.push(step.clientMemory);
                latencyValues.push(step.userLatency);
            }
        }

        let chartDescriptor = JSON.stringify({
            type: 'line',
            data: {
                labels: labels, // x-axis labels
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
    async insertActionAfter() {
        const { action } = getCard($('#content .card:first-of-type')[0], Test.current);
        let next = Test.current.steps[action.index + 1];
        let newAction = await userEventToAction({
            type: 'wait',
            sender: action.sender,
            tab: action.tab,
            expectedScreenshot: next?.expectedScreenshot && new Screenshot(next.expectedScreenshot),
            actualScreenshot: next?.actualScreenshot && new Screenshot(next.actualScreenshot),
            acceptablePixelDifferences: next?.acceptablePixelDifferences && new Screenshot(next.acceptablePixelDifferences),
            test: Test.current,
            index: action.index + 1
        }, false);
        if (newAction.acceptablePixelDifferences) {
            newAction._match === constants.match.ALLOW;
        }
        Test.current.insertAction(newAction);
        updateStepInView(newAction);
    }

    /** When clicking on an editable action, cycle through expected, actual, and difference views. */
    async cycleEditStates(e) {
        // flip the cards
        const { view, action } = getCard(e.currentTarget, Test.current);
        let index;
        switch (action._view) {
            case constants.view.EXPECTED: // expected -> actual
                action._view = constants.view.ACTUAL;
                if (!action.actualScreenshot) {
                    action.actualScreenshot = new Screenshot(action.expectedScreenshot);
                    action.actualScreenshot.fileName = '';
                    if (action.acceptablePixelDifferences) {
                        await action.acceptablePixelDifferences.hydrate(Test.current.zip?.folder("screenshots"));
                    }
                }
                else {
                    await action.actualScreenshot.hydrate(Test.current.zip?.folder("screenshots"));
                }
                updateStepInView(Test.current.steps[action.index - 1]);
                break;
            case constants.view.ACTUAL: // actual -> edit
                action._view = constants.view.EDIT;
                if(action.acceptablePixelDifferences) {
                    await action.acceptablePixelDifferences.hydrate(Test.current.zip?.folder("screenshots"));
                }
                action.calculatePixelDiff();
                updateStepInView(Test.current.steps[action.index - 1]);
                /** Add rectangles where we don't care about pixel differences. */
                addVolatileRegions();
                break;
            case constants.view.EDIT: // edit -> expected
                action._view = constants.view.EXPECTED;
                await updateStepInView(Test.current.steps[action.index - 1]);
                break;
        }
    }

    /**
     * try to play
     */
    async playSomething() {
        await _playSomething();
    }

    /**
     * stop playing
     */
    async stopPlaying() {
        await _stopPlaying();
    }

    async confirmSaveModal() {
        Test.current.filename
        let userButtonPress = new Promise(resolve => {
            this._modalClosed = resolve;
        });

        let cs = $('#confirmSave');
        cs.find("#message").text(`🙋❓ File '${Test.current.filename}' has unsaved changes.`);
        cs.modal();
        return userButtonPress;
    }
    //#endregion userActions

}
const actions = new Actions();
const menuController = new MenuController(actions);

async function errorHandler(e) {
    let workspaceWindow;
    switch (e.constructor) {
        case Errors.PixelScalingError:
            workspaceWindow = await brimstone.window.alert(`Pixel scaling detected. Brimstone cannot reliably compare scaled pixels. The Chrome window being recorded must be in an unscaled display, for the entire recording.\n\nSet your windows monitor display scale to 100%, or put Chrome in an unscaled display. Restart Chrome, try again.\n\nWorkspace will close when you hit [OK].`);
            try {
                await chrome.windows.remove(workspaceWindow.id);
            }
            catch (e) {
                console.log(e);
            }

            break;
        case Errors.ZoomError:
            workspaceWindow = await brimstone.window.alert(`Invalid chrome zoom factor detected. Brimstone cannot reliably compare zoomed pixels. Please insure that the Chrome "Settings"➜"Appearance"➜"Page zoom" is set to 100%.\n\nWorkspace will close when you hit [OK].`);
            try {
                await chrome.windows.remove(workspaceWindow.id);
            }
            catch (e) {
                console.log(e);
            }
            break;
        case Errors.ReuseTestWindow:
            await brimstone.window.alert(`You are trying to record into, or play from, the middle of an existing test, but there is no current Chrome test window that matches your current test requirements.`);
            break;
        case Errors.InvalidVersion:
            await brimstone.window.alert(e.message);
            break;
        default:
            await brimstone.window.error(e);
            break;
    }
}

// catch all unhandled promise rejections and report them. i.e. any throws that occur within a promise chain.
window.addEventListener('unhandledrejection', async function (promiseRejectionEvent) {
    let reason = promiseRejectionEvent.reason;
    if (!reason.stack) {
        reason = new Error(reason); // the stack is useless :(
    }
    await errorHandler(reason);
    return false;
});

window.addEventListener("error", async function (errorEvent) {
    await errorHandler(errorEvent.error);
    return false;
});

/** the jsoneditor instance used in the modal
 * https://github.com/josdejong/jsoneditor
 */
let jsonEditor;
let extensionInfo;
/**
 * @type {string}
 *  i want to know if this was a developer version of brimstone or not */
let installType;

/**********************************************************************************************
 * Main entry point. - allow this extension in incognito please. it increases the likelyhood that a test
 * recorded by person user can be replayed by another, since they will use common localstorage,
 * and probably have less conflicting extensions.
 */
(async function main() {
    let options = await loadOptions();
    if (options.developerMode) {
        window.alert(`🐞🔨 Developer mode enabled. I suggest you attach the debugger with ctrl+shift+i. Then hit [OK] once devtools is open.`);
        await sleep(1000); // not sure why i wait here.
        let dbg = console.debug;
        // this mreserves the caller file/line, and appends a few spaces to the message
        console.debug = Function.prototype.bind.call(dbg, console, '  ');
        debugger;
    }
    else {
        disableConsole(); // can be reenabled in the debugger later
    }

    for (let i = 0; i < 3 && !options.installedOnAlias; ++i) {
        options.installedOnAlias = await brimstone.window.prompt('Please provide an identifier for this computer. It can be the real computer name or something else, e.g. "Zac\'s Laptop"');
        await saveOptions(options);
    }

    // let info = await (new Promise(resolve => chrome.runtime.getPlatformInfo(resolve)));
    // console.log(info, navigator.userAgent);
    extensionInfo = await chrome.management.getSelf();
    installType = extensionInfo.installType === 'development' ? '👿dev ' : '';

    setToolbarState();
    /** The id of the window that the user clicked the brimstone extension icon to launch this workspace. */
    // grab the parent window id from the query parameter   
    const urlParams = new URLSearchParams(window.location.search);
    let _windowId = parseInt(urlParams.get('parent'), 10);

    let allowedIncognitoAccess = await (new Promise(resolve => chrome.extension.isAllowedIncognitoAccess(resolve)));
    if (!allowedIncognitoAccess) {
        await brimstone.window.alert(`Extension requires manual user intervention to allow incognito. 
        
When you hit [OK] I'll try to navigate you to the correct page (chrome://extensions/?id=${chrome.runtime.id}).

On that page please flip the switch, "Allow in Incognito" so it\'s blue, and reopen this workspace.`);
        let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually

        let [activeChromeTab] = await chrome.tabs.query({ active: true, windowId: _windowId });
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

/** 
 * Click the question mark to create unpredictable regions/corrections.
 */
$('#step').on('click', '#correctAsUnpredictable', async (e) => {
    e.stopPropagation();
    await actions.callMethodByUser(actions.applyCorrections, e);
});

/** 
 * Click the question mark to create unpredictable regions/corrections.
 */
 $('#step').on('click', '#correctAsAntiAlias', async (e) => {
    e.stopPropagation();
    await actions.callMethodByUser(actions.applyCorrections, e);
});

$("#step").on('click', '#correctAsActual', async (e) => {
    e.stopPropagation();
    await actions.callMethodByUser(actions.applyCorrections, e);
});

/** 
 * Click the magic wand to apply the possible corrections
 */
 $('#step').on('click', '#possibleCorrections', async (e) => {
    e.stopPropagation();
    await actions.callMethodByUser(actions.applyCorrections, e);
});

// color the rectangles when we are about to commit them
$('#step').on('mouseenter', '#correctAsUnpredictable', (e) => {
    $('.rectangle').attr('type', 'UnpredictableCorrection');
});
$('#step').on('mouseenter', '#correctAsActual', (e) => {
    $('.rectangle').attr('type', 'ActualCorrection');
});
$('#step').on('mouseenter', '#correctAsAntiAlias', (e) => {
    $('.rectangle').attr('type', 'AntiAliasCorrection');
});
$('#step').on('mouseleave', '#correctAsUnpredictable, #correctAsActual', (e) => {
    $('.rectangle').removeAttr('type');
});

/**
 * The currently visible corrections that could be applied
 * @type {Correction[]}
 */
let applicableCorrections;

$('#step').on('mouseenter', '#possibleCorrections', function (e) {
    const { action } = getCard(e.currentTarget, Test.current);
    // when the user hovers over the stamp it should show/reveal the last set of used rectangles
    // We must see which ones are in fact applicable. This would've/could've have been done during the last play of this action.
    Correction.applicableInstances = Correction.availableInstances.filter(c => c.matches(action));
    if (!Correction.applicableInstances?.length) {
        return;
    }

    let screenshot = $(this).closest(".card").find('.screenshot'); // FIXME: screenshot size != img size ??
    screenshot.addClass('relative-position');
    let image = screenshot.find('img')[0].getBoundingClientRect();
    let xscale = image.width / action.expectedScreenshot.png.width;
    let yscale = image.height / action.expectedScreenshot.png.height;

    Correction.applicableInstances.forEach(c => {
        /**
         * append this rectangle into the given container
        */
        new Rectangle({
            x0: c.bounds.x0 * xscale,
            y0: c.bounds.y0 * yscale,
            x1: c.bounds.x1 * xscale,
            y1: c.bounds.y1 * yscale,
            container: screenshot[0],
            type: c.constructor.name
        });
    });
});

$('#step').on('mouseleave', '#possibleCorrections', function (e) {
    // when the user hovers over the stamp it should remove/hide the last set of 
    if (!Correction.availableInstances.length) {
        return;
    }
    let screenshot = $(this).closest(".card").find('.screenshot');
    screenshot.removeClass('relative-position');
    screenshot.find(".rectangle").remove();
});

$('#step').on('click', '#undo', async (e) => {
    e.stopPropagation();
    await actions.callMethodByUser(actions.undo);
});

$('#step').on('click', '[data-action="deleteAction"]', (e) => {
    e.stopPropagation();
    actions.callMethodByUser(actions.deleteAction);
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

/** 
 * (Try to) 
 * enable the ability to draw rectangles on the screenshot. */
function addVolatileRegions() {
    const { view, action } = getCard($('#content .card.waiting')[0], Test.current);

    // can't add rectangles unless there are red pixels
    if(!action.numDiffPixels) {
        return;
    }

    let screenshot = view.find('.screenshot');
    // you can only draw rectangles if there are red pixels.

    Rectangle.setContainer(screenshot[0],
        () => {
            // if control gets here there are red pixels      
            // and there is an untyped rectangle showing.
            $('#possibleCorrections').attr('disabled', true); // wand
            $('#correctAsUnpredictable').attr('disabled', false); // question mark
            $('#correctAsAntiAlias').attr('disabled', false); // iron
        },
        () => {
            console.debug('rectangle deleted');
        });
    // adds to DOM temporarily
}

$('#step').on('click', '.action .title', () => {
    actions.callMethodByUser(actions.editActionName);
});

$('#step').on('click', '.waiting .click-to-change-view', (...args) => {
    actions.callMethodByUser(actions.cycleEditStates, ...args);
});

$('#confirmSaveChangesButton').click(async () => {
    await actions.saveZip(); //  need to do this here, rather than post the promise the
    // next line resolves. if i try it post the promise the next line resolves I get
    // that dreaded "user gesture required"
    actions._modalClosed('Save Changes');    // i don't actually know if the user actually saved or not, they could have cancelled.
});

$('#confirmDiscardChangesButton').click(() => {
    actions._modalClosed('Discard Changes');
});

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
    $('#infobar').html(installType + BDS.brimstoneVersion + ' ' + infobarText);
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

            if (lastRunMetrics?.length) {
                $('.metrics.option [data-action]').attr('disabled', false); // everything under metrics
            }

            if (Test.current.steps.length) {
                $('[data-action="saveZip"]').attr('disabled', false);
                $('[data-action="clearWorkspace"]').attr('disabled', false);

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
    playMatchStatus = constants.match.PASS;
    let index = currentStepIndex();
    if (index > 0) {
        updateStepInView(Test.current.steps[index - 1]);
    }
});

/** Remember the state of the last play, so I can resume correctly. */
var playMatchStatus = constants.match.PASS;

$('#playButton').on('click', function (e) { // I use "this". So no lambda.
    let button = $(this);
    if (button.hasClass('active')) {
        actions.callMethodByUser(actions.stopPlaying);
        return;
    }
    actions.callMethodByUser(actions.playSomething);
});

/**
 * The metrics from the last run.
 * @type {BDS.Test[]}
 */
var lastRunMetrics;

/** play the current playnode */
async function _playSomething() {
    let options = await loadOptions();
    try {
        let nextTest;
        let startingTab = await getActiveApplicationTab();

        do {
            nextTest = false;
            $('#playButton').addClass('active');
            setToolbarState();
            await Test.current.imageProcessing(imageProcessingProgress);
            Test.current.lastRun = new BDS.Test();
            Test.current.lastRun.startDate = Date.now();
            Test.current.lastRun.name = Test.current.filename;
            Test.current.lastRun.startingServer = Test.current.startingServer || Test.current.steps[0].url;
            Test.current.lastRun.brimstoneVersion = BDS.brimstoneVersion;
            Test.current.lastRun.chromeVersion = BDS.chromeVersion;

            let actions = Test.current.steps;
            player.onBeforePlay = updateStepInView;
            player.onAfterPlay = updateStepInView;

            let playFrom = currentStepIndex(); // we will start on the step showing in the workspace.

            // we can resume a failed step, which means we don't drive the action just check the screenshot results of it.
            // this is used when the user fixes a failed step and wants to play from there.
            let resume = (playMatchStatus === constants.match.FAIL || playMatchStatus === constants.match.CANCEL) && playFrom > 0;

            if (playFrom === 0) {
                // we are on the first step of some test in the suite. 
                if (!await startingTab.reuse({ incognito: Test.current.incognito })) { // reuse if you can
                    await startingTab.create({ url: "about:blank", incognito: Test.current.incognito });   // if not create
                }

                Tab.reset(); // FIXME: how do i deal with multi-recording tests with multiple tabs?!
                startingTab.trackCreated();
            }
            else {
                // do not reset we are resuming play from current state

                // we are resuming play in the middle of some test in the suite. The startingTab needs to already 
                // be up (and in the right state) to resume 
                if (!await startingTab.reuse({ incognito: Test.current.incognito })) { // reuse if you can
                    throw new Errors.ReuseTestWindow(); // if you can't then there is no way to resume
                }

                // if we never played anything but start in the middle I guess the
                // best we can do is assume one tab exists.
                if(! Tab.getByVirtualId(0)) {
                    Tab.reset(); // FIXME: how do i deal with multi-recording tests with multiple tabs?!
                    startingTab.trackCreated();
                }
                
            }

            startingTab.width = actions[0].tab.width;
            startingTab.height = actions[0].tab.height;
            startingTab.blessed = true;

            Tab.active = startingTab;

            if (await player.attachDebugger({ tab: Tab.active })) {
                if (Tab.active.url !== 'about:blank') {
                    await Tab.active.resizeViewport();
                }
            }
            await playTab();

            playMatchStatus = await player.play(Test.current, playFrom, resume); // players gotta play...
            Test.current.lastRun.endDate = Date.now();
            Test.current.lastRun.status = playMatchStatus;
            Test.current.lastRun.steps = Test.current.steps.map(testAction => {
                let step = new BDS.Step();
                step.index = testAction.index;
                step.clientMemory = testAction.memoryUsed;
                step.userLatency = testAction.latency;
                step.name = testAction.name || testAction.description;
                // FIXME: can add full path here as a separate field.
                return step;
            });

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
                    let step = Test.current.steps[currentStepIndex()];
                    let next = Test.current.steps[currentStepIndex() + 1];
                    next.autoPlay = true;
                    updateStepInView(step);

                    addVolatileRegions(); // you can draw right away
                    Test.current.lastRun.errorMessage = `last run failed after user action ${player.currentAction.index + 1}`;
                    Test.current.lastRun.failingStep = player.currentAction.index + 1;
                    setInfoBarText(`❌ ${Test.current.lastRun.errorMessage}`);
                    break;
                case constants.match.CANCEL:
                    updateStepInView(Test.current.steps[currentStepIndex()]);
                    setInfoBarText(`✋ last run canceled after user action ${player.currentAction.index + 1}`);
                    break;
                default:
                    setInfoBarText(`💀 unnown status reported '${playMatchStatus}'`);
                    break;
            }
        } while (nextTest);
        actions.callMethod(actions.stopPlaying);
        lastRunMetrics = PlayTree.complete.buildReports();
        setToolbarState(); // enable the metrics menu
        if (options.postMetricsOnFail || options.postMetricsOnPass) {
            await actions.postLastRunMetrics(true);
        }
    }
    catch (e) {
        actions.callMethod(actions.stopPlaying);
        if (e instanceof Errors.NoActiveTab) {
            setInfoBarText(`❌ play canceled - ${e?.message ?? ''}`);
        }
        else {
            setInfoBarText('💀 aborted! ' + e?.message ?? '');
            throw e;
        }
    }
}

$('#next').on('click', function (e) {
    playMatchStatus = constants.match.PASS;
    let index = currentStepIndex();
    if (index < Test.current.steps.length - 1) {
        updateStepInView(Test.current.steps[index + 1]);
    }
});

$('#last').on('click', function (e) {
    playMatchStatus = constants.match.PASS;
    updateStepInView(Test.current.steps[Test.current.steps.length - 1]);
});

// we have a handler for when the debugger detaches, if there was a command in flight when the debugger deattached
// it may be ok to ignore it, the only one I can think of is during *playback* while we are waiting to verify by reading screenshots
// and the debugger is detached because playback is in the middle of a navigation. that closes the debugger, which should reattach,
// the verify loop should pick up where it was just fine.
// if we are recording and taking a screenshot with the debugger and it's detached we are sort of hosed.


// if the user manually closes the debugger and then tries to record or play we need the debugger to reattach inorder for that to happen
// which means we need to wait and re-issue this command
/**
 * 
 * @param {TestActionSourceId} source 
 * @param {*} reason 
 * @returns 
 */
async function debuggerOnDetach(debuggee, reason) {
    console.debug('The debugger was detached.', debuggee, reason);

    if (isRecording()) {
        if (debuggee.tabId !== Tab.active.chromeTab.id) {
            console.debug(`ignoring detached tabId:${debuggee.tabId} during recording.`);
            return;
        }

        // else the tab we were recording had the debugger detach. reasons:
        // 1. user manually closed this tab.
        // 2. user manually closed a different tab in this window group. :(
        // 3. a navigation occurred in the tab.

        // if 1 or 2 then we need to figure out what is the active tab before we start recording again
        // if it is 3, it's fine to call this anyway.
        await Tab.reaquireActiveTab();

        // keep on trucking.
        await recordTab();
    }
    else if (isPlaying()) {
        await Tab.reaquireActiveTab();

        // the reattach will happen in the player itself
        // to the tab in the next played action
    }
    else {
        // the user somehow detached the debugger 
        //await sleep(500); // why do I wait here you ask. It's to give the banner a chance to disappear, so that the resize below works. 

        // This is to shrink it back
        await Tab.active.resizeViewport();
    }
};

chrome.debugger.onDetach.addListener(debuggerOnDetach);

/**
 * Hide the cursor in all frames. If this test is so specified.
 */
async function hideCursor() {
    if (Test.current.hideCursor) {
        await chrome.tabs.sendMessage(Tab.active.chromeTab.id, { func: 'hideCursor' });
    }
}

/**
 * this is called (at least once) for *every* frame in details.tabId.
 * 
 * every navigation in the main frame of the tab will result in any previously
 * attached debugger getting detached. which is why i do so much in here.
 *  */
async function webNavigationOnCompleteHandler(details) {
    try {

        if (isRecording()) {
            if (Tab.active.chromeTab.id !== details.tabId) {

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
                Tab.active = Tab.getByRealId(details.tabId);
                if (!Tab.active) {
                    throw new Error('Active tab is not tracked!');
                }
            }
            else {
                console.log(`tab ${details.tabId} navigation completed.`, details);
            }

            await recordTab();
        }
        else if (isPlaying()) {
            // don't really need to call all of playTab(), just hideCursor should do it.
            await hideCursor();
        }
        else {
            throw new Error("Navigation callbacks need to be removed.");
        }
        // else you shouldn't get here
    }
    catch (e) {
        if (e instanceof Errors.PixelScalingError || e instanceof Errors.ZoomError) {
            throw e;
        }
        // FIXME: do these EVER occur anymore?
        console.warn('swallowed navigation completion exception.', e);
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
    let recordingTab = Tab.active;
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
    await captureScreenshotAsDataUrlForRecording(); // grab the first screenshot
}

/**  
 * tell all the content scripts what frame they are in via chrome.tab.sendMessage
 */
async function tellRecordersTheirFrameIds() {
    let tab = Tab.active;
    let tabId = tab.chromeTab.id;
    console.debug(`connect: tell each recorder in tab:${tab.id} their frame id`);
    let frames = await (new Promise(response => chrome.webNavigation.getAllFrames({ tabId: tabId }, response))); // get all frames
    for (let i = 0; i < frames.length; ++i) {
        let frame = frames[i];
        await chrome.tabs.sendMessage(tabId, { func: 'setIds', args: { tabId: tabId, frameId: frame.frameId } }, { frameId: frame.frameId });
    }
}

/** Fired when a tab is closed.  */
async function tabsOnRemovedHandler(tabId, removeInfo) {
    let tab = Tab.getByRealId(tabId);
    if (!tab) {
        console.log(`untracked tab tabId:${tabId} winId:${removeInfo.windowId} is removed.`, removeInfo);
        return;
    }

    console.log(`tracked tab tab:${tab.id} winId:${removeInfo.windowId} is removed.`, removeInfo);
    tab.trackRemoved();

    if (isRecording()) {
        await recordUserAction({
            type: 'close',
            url: tab.chromeTab.url,
            sender: {
                href: tab.chromeTab.url
            }
        });

        if (Tab._open.length === 0) {
            // we closed the only active tab, we should end the recording.
            console.log("stopping recording since there are no tracked tabs!");
            stopRecording();
        }
    }
}

/** async event handlers, that contain awaits relinquish control. so other control paths cannot assume
 * that a started async event handler actually "completes" from an async point of view.
 */
async function tabsOnActivatedHandler(activeInfo) {
    /* 
        Fires when the active tab in a window changes. 
        Note that the tab's URL may not be set at the time this event fired, 
        but you can listen to onUpdated events so as to be notified when a URL is set.
    */
    Tab.active = Tab.getByRealId(activeInfo.tabId);
    if (!Tab.active) {
        throw new Error("active tab is not tracked.")
    }
    console.log(`chromeTab tabId:${Tab.active.id} is active.`, activeInfo);

    if (isRecording()) {
        // we only record one tab at a time: the active tab
        if (await player.attachDebugger({ tab: Tab.active })) {
            // if the debugger needed to be attached we fall in here.
            // and try to resice the viewport.
            try {
                await Tab.active.resizeViewport();  // FIXME: resize can fail. not sure why.
            }
            catch (e) {
                console.warn(e);
            }
        }
        await recordTab();
    }
    // else playing and we will attach to the expected tab, at the expected size
}

/**
 * This is called when recording or playing, whenever a new tab is created.
 * In both cases whenever a tab is created, it should already have the debugger attached.
 
 * This means it will be created with the debugger banner already smashed in there and visible
 * (pretty soon - like after the navigations in here are all complete)
 * 
 * @param {chrome.tabs.Tab} chromeTab 
 */
function tabsOnCreatedHandler(chromeTab) {
    console.debug(`tab tabId:${chromeTab.id} winId:${chromeTab.windowId} is created.`);

    // the user performed an action that opened a new tab in *some* window.
    // should this be considered the tab we are recording now? does it matter?
    // an action will be recorded from *any* tab and placed in the workspace.

    // the screenshot poller should always be polling the 1 active focused tab+window.
    // like the highlander: "there can only be one".

    // the url for the tab may not be settled yet, but I can handle onUpdated and set the url property then...
    // but the ID is supposed to be all I need. 

    // recording or playing we assume that the debugger is properly attached
    let newTab = (new Tab()).fromChromeTab(chromeTab);
    newTab.height -= 46; // If it already has the 46 px border on it, then we need to subtract it from the desired viewport height.
    newTab.trackCreated();

    // this is also assuming that the debugger is attached!
    // since this is what will be stored in the recording.
}

/**
 * 
 * @param {chrome.tabs.Tab} tab 
 */
async function tabsOnUpdatedHandler(tabId, changeInfo, tab) {
    console.debug(`tab tabId:${tabId} winId:${tab.windowId} is updated.`, changeInfo);
}

/**
 * 
 * @param {chrome.windows.Window} window 
 */
async function windowsOnCreatedHandler(window) {
    console.debug(`winId:${window.id} is created.`);
}

async function windowsOnFocusChangedHandler(window) {
    // first on created, is this
    console.debug(`focus changed to winId:${window.id}.`);
}

async function windowsOnRemovedHandler(windowId) {
    console.debug(`winId:${windowId} is removed.`);
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
 * @param {Tab} tab 
 */
async function prepareToRecord() {
    let tab = Tab.active;
    player.usedFor = 'recording';

    console.debug(`connect: begin - preparing to record tab:${tab.id} ${tab.url}`);
    console.debug(`connect:       -  tab is ${tab.width}x${tab.height}`);

    addEventHandlers();
    await tellRecordersTheirFrameIds();
    await hideCursor();
    // else don't resize a popup
    console.debug(`connect: end   - preparing to record tab ${tab.chromeTab.id} ${tab.url}`);
}

function stopRecording() {
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

    // this is only supposed to be used when we are recording over steps in the MIDDLE of the 
    // test. FIXME: whole mechanism is a little gross.
    if (Test.current.replacedAction?.index === Test.current.steps.length - 1) {
        // insert the action that our final useless "end-recording-noop-expected-screenshot-action" replaced.
        // insert it right after that noop. the user can delete the noop. i don't want to delete that for them.
        Test.current.replacedAction.index++;
        Test.current.insertAction(Test.current.replacedAction);
    }

    Test.current.startImageProcessing(imageProcessingProgress); // just kick it off again
}

async function focusTab() {
    await chrome.windows.update(Tab.active.chromeTab.windowId, { focused: true });
    await chrome.tabs.update(Tab.active.chromeTab.id, {
        highlighted: true,
        active: true
    });
}

/**
 * Get *the* application Tab that we intend to attch the debugger to.
 * i.e. the Tab we will starting playing or recording on.
 * 
 * This can return a Tab without a virtualId and chromeTab property 
 * when there is no application tab available at all.
 * i.e. there are no open windows except the brimstone workspace itself.
 * 
 */
async function getActiveApplicationTab() {
    let tabs = await chrome.tabs.query({});
    if (tabs.length > 2) {
        let ok = await brimstone.window.confirm('There are multiple application tabs. Brimstone will use the active tab as the initial target.');
        if (!ok) {
            throw new Errors.NoActiveTab();
        }
    }

    let w = await (new Promise(resolve => chrome.windows.getCurrent(null, resolve)));  // chrome.windows.WINDOW_ID_CURRENT // doesn't work for some reason, so get it manually
    let recordChromeTab = tabs.find(tab => tab.windowId !== w.id);
    let tab = new Tab();
    if (recordChromeTab) {
        await tab.fromChromeTab(recordChromeTab);
    }
    return tab;
}

/**
 * Let's record something!
 * @param {boolean} attachActiveTab Splice record or URL record
 * @returns 
 */
async function recordSomething(promptForUrl) {
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

        let startingTab = await getActiveApplicationTab();
        // are we doing an incognito recording - this is determined by the option only now.
        Test.current.incognito = options.recordIncognito;

        // A completely fresh recording will prompt for the URL, else prompt for splice record.
        // If the attachActiveTab is true we splice record, else it is a fresh (new URL) recording.

        if (promptForUrl) {
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

            Tab.reset(); // FIXME: multi-tab multi-recording tests
            startingTab.trackCreated();
            Tab.active = startingTab;

            if (await player.attachDebugger({ tab: Tab.active })) {
                await Tab.active.resizeViewport();
            }

            await prepareToRecord();
            button.addClass('active');
            setToolbarState();

            // update the UI: insert the first text card in the ui
            await recordUserAction({
                type: 'goto',
                url: Tab.active.url
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
            // we are going to start recording *the* active tab at the current url.
            if (!startingTab.chromeTab) {
                throw new Errors.ReuseTestWindow();
            }

            if (Test.current.steps.length) {
                startingTab.trackCreated();
                // we are going to record over some steps in the existing test in memory
                Tab.active = startingTab;

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
                Test.current.replacedAction = null;

                // see if we are tracking the tab of the action we are recording over
                Tab.active = Tab.getByVirtualId(action.tab.virtualId);
                if (!Tab.active) {
                    throw new Error(`Not currently tracking tab:${action.tab.virtualId}`);
                }

                // overwriting actions in an existing test
                if (!await Tab.active.reuse({ incognito: Test.current.incognito })) {
                    throw new Errors.ReuseTestWindow();
                }

                if (await player.attachDebugger({ tab: Tab.active })) {
                    await Tab.active.resizeViewport();
                }

                await prepareToRecord();
                button.addClass('active');
                setToolbarState();
                await countDown(3, action);
            }
            else {
                // we are recording a fresh test starting with the active tab.
                // there is no test loaded in memory. recording starts at
                // step 1 (index 0)

                Test.current = new Test();
                startingTab.trackCreated();
                Tab.active = startingTab;

                // If you "Record the Active Tab" you will make a recording in incognito or not based on the Active Tab state, not any external preferences!
                Test.current.incognito = Tab.active.chromeTab.incognito;

                if (!await Tab.active.reuse({ incognito: Test.current.incognito })) {
                    throw new Errors.ReuseTestWindow();
                }
                // there is nothing in the current test, so I should add something
                if (Tab.active.chromeTab.url.startsWith('chrome:')) {
                    await brimstone.window.alert("We don't currently allow recording in a chrome:// url. If you want this feature please upvote the issue.");
                    return;
                }
                if (await player.attachDebugger({ tab: Tab.active })) {
                    await Tab.active.resizeViewport();
                }

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

        if (!PlayTree.complete) { // pretend it is suite which is the general case I need to handle.
            PlayTree.complete = await new PlayTree();
            PlayTree.complete._zipTest = Test.current;
            Test.current._playTree = PlayTree.complete;
        }
        await startRecorders(); // this REALLY activates the recorder, by connecting the port, which the recorder interprets as a request to start event listening.


        // last thing we do is give the focus back to the window and tab we want to record, so the user doesn't have to.
        await focusTab();
    }
    catch (e) {
        stopRecording();
        if (e instanceof Errors.NoActiveTab) {
            setInfoBarText(`❌ recording canceled - ${e?.message ?? ''}`);
        }
        else {
            throw e;
        }
    }
}

$('#recordButton').on('click', (e) => {
    // if there are steps we interpret the button as splice record
    // if no we prompt for URL to record a fresh one

    // if the user wants to start a new (from blank) recording w/o a url
    // they can use the "Record Active Tab" option in the menu, and not use this button at all.  
    let testInMemory = Test.current.steps.length;
    let promptForUrl = !testInMemory;
    recordSomething(promptForUrl);
});

function _stopPlaying() {
    $('#playButton').removeClass('active');
    setToolbarState();
    removeEventHandlers();
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
$('#clearButton').on('click', actions.clearWorkspace.bind(actions));

function imageProcessingProgress(value, max) {
    let ib = $('#infobar');
    ib.html(`${installType}${BDS.brimstoneVersion} processing image ${value}/${max} <progress max="${max}" value="${value}"></progress>`);
}

async function loadNextTest() {
    let numberOfTestsInSuite = zipNodes.length;
    if (++currentTestNumber > numberOfTestsInSuite) {
        return false;
    }
    let options = await loadOptions();
    let suite = numberOfTestsInSuite > 1 ? ` (test ${currentTestNumber}/${numberOfTestsInSuite})` : '';
    //let lastStep = Test.current.steps.length >= 1 ? Test.current.steps.length - 1 : 0;

    await actions.clearTest();

    // This load is just super fast.
    Test.current = await (new Test()).fromPlayTree(zipNodes[currentTestNumber - 1]);
    Test.current.startingServer = Test.current.steps[0].url || zipNodes[0]._zipTest.startingServer || null;

    // kick off without waiting for this. 
    Test.current.startImageProcessing(imageProcessingProgress);

    window.document.title = `Brimstone - ${Test.current._playTree.path()}${suite}`;
    updateStepInView(Test.current.steps[0]);
    // for (let i = 1; i < Test.current.steps.length; ++i) {
    //      let action = Test.current.steps[i];
    //      updateThumb(action);
    // }
    setToolbarState();
    return true;
}

/** The filehandles of the tests the user loaded. Used for playing back 1 or more tests.
 * @type {PlayTree[]}
 */
let zipNodes = [];
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
    let acs = [];
    if(step?.curr?.autoCorrected) {
        acs.push(step.curr.index+1);
    }
    if(step?.next?.autoCorrected) {
        acs.push(step.next.index+1);
    }
    if(acs.length) {
        let s = '';
        if(acs.length>1) {
            s = 's';
        }
        setInfoBarText(`step${s} ${acs.join(', ')} auto-corrected.`);
    }
    
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
 * Try to capture a screenshot of the expected size
 * while making a recording.
 * 
 * The debugger attaches and detaches during the 
 * normal course of tab opening, closing, and navigating.
 * 
 * The debugger banner affects viewport size, hence
 * we need to make sure we grab a screenshot of the expected
 * size.
 * 
 * @throws {Exception} on failure.
 */
async function captureScreenshotAsDataUrlForRecording() {
    // how long should we wait during recording to be able to 
    // screenshot of the correct size?
    let start = performance.now();
    let lastError;
    // max time to wait for a screenshot of the correct size to be taken during recording
    let startingActiveTabId = Tab.active.virtualId;
    while (((performance.now() - start)) < options.captureScreenshotAsDataUrlForRecordingTimeout) {
        try {
            _lastScreenshot = await player.captureScreenshot();
            return _lastScreenshot;
        }
        catch (e) {
            lastError = e;

            // if the tab we want to take the picture on has closed/is not the active tab then swallow error and don't take the screenshot.
            if (!Tab.active || Tab.active.virtualId !== startingActiveTabId) {
                console.info('active tab changed while waiting for a screenshot', lastError);
                return;
            }
            console.warn(lastError);

            if (lastError instanceof Errors.IncorrectScreenshotSize) {
                // this can only happen during recording if the debugger banner is volatile
                await player.tab.resizeViewport();
                await sleep(options.captureScreenshotAsDataUrlForRecordingRetryTimeout);
                continue;
            }
            throw lastError;
        }
    }
    throw lastError;
}

/**
 * Add the _lastScavedScreenshot to the testAction if that screenshot wasn't of
 * an open shadowDOM
 *  @param {TestAction} testAction The action to add the screenshot to
 */
function addExpectedScreenshot(testAction, ss = _lastScreenshot) {
    if (shadowDOMScreenshot) {
        --shadowDOMScreenshot;
        testAction.shadowDOMAction = true;
    }
    testAction.addExpectedScreenshot(ss);
}

/** 
 * This is normally only used during recording. 
 * 
 * Process a user event received from the content script (during recording)
 * screenshot, annotate event and convert to TestAction;
 * 
 */
async function userEventToAction(userEvent, insert = true) {
    let frameId = userEvent?.sender?.frameId;
    let frameOffset = userEvent.type === 'close' ? { left: 0, top: 0 } : await getFrameOffset(frameId);

    let testAction = new TestAction(userEvent);
    testAction.tab = new Tab(Tab.active);
    // FIXME: remove this. This is here currently because addExpectedScreenshot has a ependency on the index
    // which has a dependency on this call because it can set the index
    if (insert) {
        Test.current.updateOrAppendAction(testAction);
    }
    let element = userEvent.boundingClientRect;

    testAction.x += frameOffset.left;
    testAction.y += frameOffset.top;

    if (element) {
        /** During recording we know the tab height and width, this will be the size of the screenshots captured.
         * We can convert the element positions in pixels into percentages. The overlay represents the location
         * of the overlay in percentages of the aspect-ratio preserved image.
         */
        testAction.overlay = {
            height: element.height * 100 / testAction.tab.height, // height of target element as a percent of screenshot height
            width: element.width * 100 / testAction.tab.width, // width of target element as a percent screenshot width

            /** absolute y coordinate of the TARGET ELEMENT as a percent of screenshot */
            top: (element.top + frameOffset.top) * 100 / testAction.tab.height,
            /** absolute x coordinate of the TARGET ELEMENT as a percent of screenshot */
            left: (element.left + frameOffset.left) * 100 / testAction.tab.width,

            /** absolute x coordinate of the mouse position as a percent of screenshot */
            x: testAction.x * 100 / testAction.tab.width,
            /** absolute y coordinate of the mouse position as a percent of screenshot */
            y: testAction.y * 100 / testAction.tab.height
        };
    }

    let dataUrl = '';
    switch (userEvent.type) {
        case 'wait':
            if (!testAction.event) {
                testAction.event = {};
            }
            if (testAction.event.milliseconds === undefined) {
                testAction.event.milliseconds = 0;
            }
            testAction.description = `wait ${testAction.event.milliseconds}ms.`;
            testAction.overlay = {
                height: 0,
                width: 0,
                top: 0,
                left: 0
            };
            testAction._view = constants.view.EXPECTED;
            //addExpectedScreenshot(testAction, _lastScreenshot);
            break;
        case 'pollscreen':
            testAction.description = 'no action performed.'; // do I even need a message?
            testAction.overlay = {
                height: 0,
                width: 0,
                top: 0,
                left: 0
            };
            testAction._view = constants.view.EXPECTED;
            break;
        case 'mouseover':
            // this is sort of an error case!
            testAction.description = 'orphaned mouseover observed here';
            addExpectedScreenshot(testAction, _lastScreenshot);
            break;
        case 'mousemove':
            testAction.description = 'move mouse';
            addExpectedScreenshot(testAction, _lastSavedScreenshot);
            break;
        case 'wheels':
            // rebase the individual wheel events position to their frame offsets
            testAction.event.forEach(wheelEvent => {
                wheelEvent.x += frameOffset.left;
                wheelEvent.y += frameOffset.top;
            });
            addExpectedScreenshot(testAction, _lastSavedScreenshot);
            break;
        case 'keys':
            testAction.description = 'type ';

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
                        testAction.description += `<span class='modifier'>+</span>`;
                    }
                    if (chord || event.key.length > 1) { // these are button looking thangs
                        testAction.description += `<span class='modifier'>${keyName}</span>`;
                    }
                    else {
                        testAction.description += keyName;
                    }
                }
                else if (i === 0) {
                    // we are starting on a keyup
                    testAction.description += `<span class='modifier'>${event.key}🠭</span>`;
                }
            }
            addExpectedScreenshot(testAction);
            break;
        case 'keydown':
        case 'keypress':
            testAction.description = 'type ';
            if (userEvent.event.key.length > 1) {
                testAction.description += `<span class='modifier'>${userEvent.event.key}</span>`;
            }
            else {
                testAction.description += userEvent.event.key;
            }
            addExpectedScreenshot(testAction);
            break;
        case 'click':
            testAction.description = 'click';
            addExpectedScreenshot(testAction);
            break;
        case 'contextmenu':
            testAction.description = 'right click';
            addExpectedScreenshot(testAction);
            break;
        case 'dblclick':
            testAction.description = 'double click';
            addExpectedScreenshot(testAction);
            break;
        case 'goto': {
            testAction.description = `goto tab:${testAction.tab.virtualId} ${testAction.url}`;
            testAction.overlay = {
                height: 0,
                width: 0,
                top: 0,
                left: 0
            };
            testAction._view = constants.view.EXPECTED;
            break;
        }
        case 'close':
            testAction.description = `close tab:${testAction.tab.virtualId} ${testAction.url}`;
            testAction.overlay = {
                height: 0,
                width: 0,
                top: 0,
                left: 0
            };
            testAction._view = constants.view.EXPECTED;
            addExpectedScreenshot(testAction);
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

            testAction.description = `change value to ${testAction.event.value}`;
            shadowDOMScreenshot += 2;
            addExpectedScreenshot(testAction);
            break;
        default:
            testAction.description = 'Unknown!';
            break;
    }

    let stream = testAction.type === 'pollscreen' ? 'debug' : 'log';
    console[stream](`[step:${testAction.index} tab:${testAction.tab.id}] record "${testAction.description}"`);
    return testAction;
}

/** 
 * set up the step and start refreshing the next expected screen */
async function recordUserAction(userEvent) {
    let action = await userEventToAction(userEvent); // convert userEvent to testaction, insert at given index
    action.tab.blessed = true;

    // show the latest screenshot in the expected card to give quick feedbak
    let wait = await userEventToAction({ type: 'pollscreen' }); // create a new waiting action
    // use the lower cost option: just the dataUrl not the PNG. the PNG is generated when we create a userAction
    wait.expectedScreenshot = new Screenshot(_lastScreenshot); // something to show immediately
    wait._view = constants.view.DYNAMIC;
    wait.sender = {
        href: _lastScreenshot?.tab?.url
    };
    if (_lastScreenshot) {
        wait.tab = _lastScreenshot.tab;
    }
    // else we assigned Tab.active to wait.tab.

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
        case 'pollscreen':
            await captureScreenshotAsDataUrlForRecording(); // grab latest image

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
            lastAction.tab = _lastScreenshot.tab; // this is only for the cas where the last action is a close of a tab and we need to show some other active screenshot.

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
            action.tab.blessed = true;
            // show the latest screenshot in the expected card and start polling it
            await captureScreenshotAsDataUrlForRecording();

            let wait = await userEventToAction({ type: 'pollscreen' }); // create a new waiting action
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
 * Record the Tab.active tab. This should be the top level
 * safe/idempotent call to establish recording of the given tab.
 * @param {Tab} tab 
 */
async function recordTab() {
    let tab = Tab.active;
    console.log(`record tab:${tab.id}`);

    if (recordTabFunctionExecuting) {
        console.warn('the recordTabFunction is already in progress');
        return;
    }
    recordTabFunctionExecuting = true;

    // FIXME: what happens if we spawn a "real window"?
    player.tab = tab; // at this point the debugger is already attached, to the popup (which is like a tab to the mainwindow, but in its own browser window?)

    await prepareToRecord();

    // FIXME: I don't want to ignore the "native" size secondary tabs or popups that are recorded. need to be a little careful here.
    // need these e.g. when a redirect nav occurs on the current tab. like in login.
    await Tab.active.resizeViewport();

    await startRecorders();
    recordTabFunctionExecuting = false;
}

/**
 * Change the active tab that the player instance
 * is currently playing.
 * @param {Tab} tab 
 */
async function playTab() {
    let tab = Tab.active;
    console.log(`play tab:${tab.chromeTab.id}`);

    // FIXME: what happens if we spawn a "real window"?
    player.tab = tab; // at this point the debugger is already attached, to the popup (which is like a tab to the mainwindow, but in its own browser window?)

    player.usedFor = 'playing';
    addEventHandlers();
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
    let frames = await (new Promise(resolve => chrome.webNavigation.getAllFrames({ tabId: Tab.active.chromeTab.id }, resolve))); // get all frames

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
        await chrome.tabs.sendMessage(Tab.active.chromeTab.id, { func: 'postMessageOffsetIntoIframes' }, { frameId: frame.parentFrameId });
        // it's posted, but that doesn't mean much

        let response = await p; // eventually some 'frameOffset' messages come in, and when I see mie (this frame) this promise is resolved with my offset.

        frameOffset.left += response.left;
        frameOffset.top += response.top;
    }

    return frameOffset;
}