
import { loadOptions, saveOptions, Options } from "./options.js";
var options = new Options();

// Saves options to chrome.storage
async function save_options() {
    options.MAX_VERIFY_TIMEOUT = parseInt(matchTimeout.value, 10);
    options.hideCursor = document.getElementById('hideCursor').checked;
    options.pixelMatchThreshhold = parseFloat(document.getElementById('pixelMatchThreshold').value);
    await saveOptions(options);

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
    document.getElementById('pixelMatchThreshold').value = options.pixelMatchThreshhold;
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);
document.getElementById('reset').addEventListener('click', save_defaults);