
import { loadOptions, saveOptions, Options } from "./options.js";
var options = new Options();

const userKeypressDelay = [
    100, 50, 0
];

const userMouseDelay = [
    2000, 500, 0
];

const pixelMatchThreshholds = [
    .2, .1, 0
];

const mouseWheelTimeout = [
    500, 250, 100
];

const mouseMoveTimeout = [
    500, 250, 100
];

// Saves options to chrome.storage
async function save_options() {
    options.MAX_VERIFY_TIMEOUT = parseInt(matchTimeout.value, 10);

    options.hideCursor = document.getElementById('hideCursor').checked;
    options.recordIncognito = document.getElementById('recordIncognito').checked;
    options.developerMode = document.getElementById('developerMode').checked;
    options.debugRecorder = document.getElementById('debugRecorder').checked;
    options.autoZoomTo100 = document.getElementById('autoZoomTo100').checked;
    options.postMetricsOnFail = document.getElementById('postMetricsOnFail').checked;
    options.postMetricsOnPass = document.getElementById('postMetricsOnPass').checked;
    options.postMetricsEndpoint = document.getElementById('postMetricsEndpoint').value;

    // experiements
    options.experiment.includeCss = document.getElementById('includeCss').checked;
    
    options.closeOldTestWindowOnCreate = document.getElementById('closeOldTestWindowOnCreate').checked;

    options.pixelMatchThreshhold = pixelMatchThreshholds[parseFloat(document.getElementById('pixelMatchSenstivity').value)];
    options.userMouseDelay = userMouseDelay[parseInt(document.getElementById('userMouseSpeed').value, 10)];
    options.userKeypressDelay = userKeypressDelay[parseInt(document.getElementById('userKeypressSpeed').value, 10)];
    options.mouseMoveTimeout = mouseMoveTimeout[parseInt(document.getElementById('mouseMoveTimeout').value, 10)];
    options.mouseWheelTimeout = mouseWheelTimeout[parseInt(document.getElementById('mouseWheelTimeout').value, 10)];

    await saveOptions(options);
    console.log(options);

    document.getElementById('status').textContent = 'Options saved.';
    setTimeout(function () {
        document.getElementById('status').textContent = '';
    }, 750);
}

async function save_defaults() {
    await saveOptions(new Options()); // persist the defaults
    await restore_options(); // load into UI
    await save_options(); // persist em again, to show the "Options saved message"
}

async function restore_options() {
    options = await loadOptions();
    document.getElementById('matchTimeout').value = options.MAX_VERIFY_TIMEOUT;
    document.getElementById('hideCursor').checked = options.hideCursor;
    document.getElementById('recordIncognito').checked = options.recordIncognito;
    document.getElementById('developerMode').checked = options.developerMode;
    document.getElementById('debugRecorder').checked = options.debugRecorder;
    document.getElementById('autoZoomTo100').checked = options.autoZoomTo100;
    document.getElementById('postMetricsOnPass').checked = options.postMetricsOnPass;
    document.getElementById('postMetricsOnFail').checked = options.postMetricsOnFail;
    document.getElementById('postMetricsEndpoint').value = options.postMetricsEndpoint;

    // experiements
    document.getElementById('includeCss').checked = options.experiment.includeCss;

    document.getElementById('closeOldTestWindowOnCreate').checked = options.closeOldTestWindowOnCreate;


    document.getElementById('pixelMatchSenstivity').value = pixelMatchThreshholds.indexOf(options.pixelMatchThreshhold);
    document.getElementById('userMouseSpeed').value = userMouseDelay.indexOf(options.userMouseDelay);
    document.getElementById('userKeypressSpeed').value = userKeypressDelay.indexOf(options.userKeypressDelay);

    document.getElementById('mouseMoveTimeout').value = mouseMoveTimeout.indexOf(options.mouseMoveTimeout);
    document.getElementById('mouseWheelTimeout').value = mouseWheelTimeout.indexOf(options.mouseWheelTimeout);

}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);
document.getElementById('reset').addEventListener('click', save_defaults);