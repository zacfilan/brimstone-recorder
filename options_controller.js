
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
    options.MAX_VERIFY_TIMEOUT = parseInt(matchTimeout.value, 10);

    options.hideCursor = hideCursor.checked;
    options.recordIncognito = recordIncognito.checked;
    options.developerMode = developerMode.checked;
    options.debugRecorder = debugRecorder.checked;
    options.autoZoomTo100 = autoZoomTo100.checked;
    options.postMetricsOnFail = postMetricsOnFail.checked;
    options.postMetricsOnPass = postMetricsOnPass.checked;
    options.postMetricsEndpoint = postMetricsEndpoint.value;
    options.installedOnAlias = installedOnAlias.value;

    // experiements
    options.experiment.includeCss = includeCss.checked;
    
    options.closeOldTestWindowOnCreate = closeOldTestWindowOnCreate.checked;

    options.pixelMatchThreshhold = pixelMatchThreshholdLookup[parseFloat(pixelMatchSenstivity.value)];
    options.numberOfRedPixelsAllowed = parseInt(numberOfRedPixelsAllowed.value, 10);
    options.userMouseDelay = userMouseDelayLookup[parseInt(userMouseSpeed.value, 10)];
    options.userKeypressDelay = userKeypressDelayLookup[parseInt(userKeypressSpeed.value, 10)];
    options.mouseMoveTimeout = mouseMoveTimeoutLookup[parseInt(mouseMoveTimeout.value, 10)];
    options.mouseWheelTimeout = mouseWheelTimeoutLookup[parseInt(mouseWheelTimeout.value, 10)];

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
    matchTimeout.value = options.MAX_VERIFY_TIMEOUT;
    hideCursor.checked = options.hideCursor;
    recordIncognito.checked = options.recordIncognito;
    developerMode.checked = options.developerMode;
    debugRecorder.checked = options.debugRecorder;
    autoZoomTo100.checked = options.autoZoomTo100;
    postMetricsOnPass.checked = options.postMetricsOnPass;
    postMetricsOnFail.checked = options.postMetricsOnFail;
    postMetricsEndpoint.value = options.postMetricsEndpoint;
    installedOnAlias.value = options.installedOnAlias;

    // experiements
    includeCss.checked = options.experiment.includeCss;

    closeOldTestWindowOnCreate.checked = options.closeOldTestWindowOnCreate;


    pixelMatchSenstivity.value = pixelMatchThreshholdLookup.indexOf(options.pixelMatchThreshhold);
    numberOfRedPixelsAllowed.value = options.numberOfRedPixelsAllowed;
    userMouseSpeed.value = userMouseDelayLookup.indexOf(options.userMouseDelay);
    userKeypressSpeed.value = userKeypressDelayLookup.indexOf(options.userKeypressDelay);

    mouseMoveTimeout.value = mouseMoveTimeoutLookup.indexOf(options.mouseMoveTimeout);
    mouseWheelTimeout.value = mouseWheelTimeoutLookup.indexOf(options.mouseWheelTimeout);

}

document.addEventListener('DOMContentLoaded', restore_options);
save.addEventListener('click', save_options);
reset.addEventListener('click', save_defaults);