

const record = {text: 'REC', color: [255,0,0,255], title: 'Recording'};
const play = {text: 'PLAY', color: [0,255,0,255], title: 'Playing'};
const ready = {text: '', color: [0,0,0,0], title: 'Ready to play or record.'};
const pass = {text: '\u2705', color: [255,255,255,255], title: 'Test passed.'};
const fail = {text: '\u274c', color: [255,255,255,255], title: 'Test failed'}

function set({text, color, title}) {
    chrome.action.setBadgeBackgroundColor({color});
    chrome.action.setBadgeText({text});
    chrome.action.setTitle({title});
 }
 
 /** Change the extension icon to the ready state, */
export function Ready() {
    set(ready);
}

/** Change the extension icon to the playing state. */
export function Play() {
    set(play);
}

/** Change the extension icon to the recording state. */
export function Record() {
    set(record);
}

/** Change the extension icon to the passed state. */
export function Pass() {
    set(pass);
}

/** Change the extension icon to the failed state. */
export function Fail() {
    set(fail);
}
