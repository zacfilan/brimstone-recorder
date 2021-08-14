function setVersion() {
    document.getElementById('version').textContent = chrome.runtime.getManifest().version;
}

document.addEventListener('DOMContentLoaded', setVersion);
