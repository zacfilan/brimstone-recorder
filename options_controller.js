
import { loadOptions, saveOptions, Options } from "./options.js";
var options = new Options();

const interkeyPressDelays = [
    100, 50, 0
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
    options.experimentalFeatures = document.getElementById('experimentalFeatures').checked;
    options.closeOldTestWindowOnCreate = document.getElementById('closeOldTestWindowOnCreate').checked;

    options.pixelMatchThreshhold = pixelMatchThreshholds[parseFloat(document.getElementById('pixelMatchSenstivity').value)];
    options.interKeypressDelay = interkeyPressDelays[parseInt(document.getElementById('typingSpeed').value, 10)];
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

    document.getElementById('experimentalFeatures').checked = options.experimentalFeatures;
    document.getElementById('closeOldTestWindowOnCreate').checked = options.closeOldTestWindowOnCreate;


    document.getElementById('pixelMatchSenstivity').value = pixelMatchThreshholds.indexOf(options.pixelMatchThreshhold);
    document.getElementById('typingSpeed').value = interkeyPressDelays.indexOf(options.interKeypressDelay);

    document.getElementById('mouseMoveTimeout').value = mouseMoveTimeout.indexOf(options.mouseMoveTimeout);
    document.getElementById('mouseWheelTimeout').value = mouseWheelTimeout.indexOf(options.mouseWheelTimeout);

}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);
document.getElementById('reset').addEventListener('click', save_defaults);