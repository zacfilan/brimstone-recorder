
import { loadOptions } from "./options.js";
var options;

// Saves options to chrome.storage
function save_options() {
    options.MAX_VERIFY_TIMEOUT = parseInt(matchTimeout.value, 10);
    chrome.storage.local.set({options}, function () {
        // Update status to let user know options were saved.
        document.getElementById('status').textContent = 'Options saved.';
        setTimeout(function () {
            document.getElementById('status').textContent = '';
        }, 750);
    });
}

async function restore_options() {
    options = await loadOptions();
    document.getElementById('matchTimeout').value = options.MAX_VERIFY_TIMEOUT;
}

document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);