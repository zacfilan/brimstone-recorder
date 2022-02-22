
import { loadOptions, saveOptions, Options } from "./options.js";
var options = new Options();

const userKeypressDelayLookup = [
    100, 50, 0
];

const userMouseDelayLookup = [
    2000, 500, 0
];

const pixelMatchThreshholdLookup = [
    .2, .1, 0
];

const mouseWheelTimeoutLookup = [
    500, 250, 100
];

const mouseMoveTimeoutLookup = [
    500, 250, 100
];

// Saves options to chrome.storage
async function save_options() {
    //#region checking options
    options.MAX_VERIFY_TIMEOUT = parseInt(matchTimeout.value, 10);
    options.pixelMatchThreshhold = pixelMatchThreshholdLookup[parseFloat(pixelMatchSenstivity.value)];
    options.autoCorrectActual = autoCorrectActual.checked;
    options.autoCorrectUnpredictable = autoCorrectUnpredictable.checked;
    //#endregion checking option

    //#region playback options
    options.userMouseDelay = userMouseDelayLookup[parseInt(userMouseSpeed.value, 10)];
    options.userKeypressDelay = userKeypressDelayLookup[parseInt(userKeypressSpeed.value, 10)];
    //#endregion playback options

    //#region database options
    options.postMetricsEndpoint = postMetricsEndpoint.value;
    options.postMetricsOnPass = postMetricsOnPass.checked;
    options.postMetricsOnFail = postMetricsOnFail.checked;
    options.installedOnAlias = installedOnAlias.value;
    //#endregion database options

    //#region general options
    options.hideCursor = hideCursor.checked;
    options.closeOldTestWindowOnCreate = closeOldTestWindowOnCreate.checked;
    //#endregion general options

    //#region recording options
    options.recordIncognito = recordIncognito.checked;
    options.mouseMoveTimeout = mouseMoveTimeoutLookup[parseInt(mouseMoveTimeout.value, 10)];
    options.mouseWheelTimeout = mouseWheelTimeoutLookup[parseInt(mouseWheelTimeout.value, 10)];
    //#endregion recording options

    //#region developer options
    options.developerMode = developerMode.checked;
    options.debugRecorder = debugRecorder.checked;
    options.autoZoomTo100 = autoZoomTo100.checked;
    options.numberOfRedPixelsAllowed = parseInt(numberOfRedPixelsAllowed.value, 10);
    options.forgetCorrectionsWhenTestIsCleared = forgetCorrectionsWhenTestIsCleared.checked;
    //#region timeouts
    options.verifyScreenshotRetryComparisonTimeout = parseInt(verifyScreenshotRetryComparisonTimeout.value);
    options.verifyScreenshotTakeScreenshotRetryTimeout = parseInt(verifyScreenshotTakeScreenshotRetryTimeout.value);
    options.debuggerSendCommandOnPlayRetryTimeout = parseInt(debuggerSendCommandOnPlayRetryTimeout.value);
    options.resizeViewportRetryTimeout = parseInt(resizeViewportRetryTimeout.value);
    options.captureScreenshotAsDataUrlForRecordingTimeout = parseInt(captureScreenshotAsDataUrlForRecordingTimeout.value);
    options.captureScreenshotAsDataUrlForRecordingRetryTimeout = parseInt(captureScreenshotAsDataUrlForRecordingRetryTimeout.value);
    //#endregion timeouts
    //#endregion developer options 

    //#region experiments
    options.experiment.includeCss = includeCss.checked;
    //#endregion experiments

    await saveOptions(options);
    console.log(options);

    optionsSaveStatus.textContent = 'Options saved.';
    setTimeout(function () {
        optionsSaveStatus.textContent = '';
    }, 750);
}

async function save_defaults() {
    await saveOptions(new Options()); // persist the defaults
    await restore_options(); // load into UI
    await save_options(); // persist em again, to show the "Options saved message"
}

async function restore_options() {
    options = await loadOptions();

    //#region checking options
    matchTimeout.value = options.MAX_VERIFY_TIMEOUT;
    pixelMatchSenstivity.value = pixelMatchThreshholdLookup.indexOf(options.pixelMatchThreshhold);
    autoCorrectActual.checked = options.autoCorrectActual;
    autoCorrectUnpredictable.checked = options.autoCorrectUnpredictable;
    //#endregion checking options

    //#region playback options
    userKeypressSpeed.value = userKeypressDelayLookup.indexOf(options.userKeypressDelay);
    userMouseSpeed.value = userMouseDelayLookup.indexOf(options.userMouseDelay);
    //#endregion playback options

    //#region database options
    postMetricsEndpoint.value = options.postMetricsEndpoint;
    postMetricsOnPass.checked = options.postMetricsOnPass;
    postMetricsOnFail.checked = options.postMetricsOnFail;
    installedOnAlias.value = options.installedOnAlias;
    //#endregion database options

    //#region general options
    closeOldTestWindowOnCreate.checked = options.closeOldTestWindowOnCreate;

    //#endregion general options
    hideCursor.checked = options.hideCursor;
    //#endregion general options

    //#region recording options
    recordIncognito.checked = options.recordIncognito;
    mouseMoveTimeout.value = mouseMoveTimeoutLookup.indexOf(options.mouseMoveTimeout);
    mouseWheelTimeout.value = mouseWheelTimeoutLookup.indexOf(options.mouseWheelTimeout);
    //#endregion recording options

    //#region developer options
    developerMode.checked = options.developerMode;
    debugRecorder.checked = options.debugRecorder;
    autoZoomTo100.checked = options.autoZoomTo100;
    numberOfRedPixelsAllowed.value = options.numberOfRedPixelsAllowed;
    forgetCorrectionsWhenTestIsCleared.checked = options.forgetCorrectionsWhenTestIsCleared;
    //#region timeouts
    verifyScreenshotTakeScreenshotRetryTimeout.value = options.verifyScreenshotTakeScreenshotRetryTimeout;
    verifyScreenshotRetryComparisonTimeout.value = options.verifyScreenshotRetryComparisonTimeout;
    debuggerSendCommandOnPlayRetryTimeout.value = options.debuggerSendCommandOnPlayRetryTimeout;
    resizeViewportRetryTimeout.value = options.resizeViewportRetryTimeout;
    captureScreenshotAsDataUrlForRecordingTimeout.value = options.captureScreenshotAsDataUrlForRecordingTimeout;
    captureScreenshotAsDataUrlForRecordingRetryTimeout.value = options.captureScreenshotAsDataUrlForRecordingRetryTimeout;
    //#endregion timeouts
    //#endregion developer options

    //#region experiments
    includeCss.checked = options.experiment.includeCss;
    //#endregion experiments

}

document.addEventListener('DOMContentLoaded', restore_options);
save.addEventListener('click', save_options);
reset.addEventListener('click', save_defaults);