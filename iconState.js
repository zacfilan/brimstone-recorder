const record = {path: '../images/red_b_32.png',    title: 'Brimstone is recording.'};
const play   = {path: '../images/green_b_32.png',  title: 'Brimstone is playing.'};
const ready  = {path: '../images/orange_b_32.png', title: 'Brimstone is ready to play or record.'};
const inactive = {path: '../images/grey_b_32.png', title: 'Brimstone is not active.'}
// const pass = {text: '\u2705', color: [255,255,255,255], title: 'Test passed.'};
// const fail = {text: '\u274c', color: [255,255,255,255], title: 'Test failed'}

function set({path, text, color, title}) {
    if(title) {
        //chrome.action.setBadgeText({text});
        chrome.action.setTitle({title});
        //chrome.action.setBadgeBackgroundColor({color});
    }
    chrome.action.setIcon({path});
    $('#favicon').attr('href', path);
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

/** Change the extension icon to the inactve state. */
export function Inactive() {
    set(inactive);
}

// /** Change the extension icon to the passed state. */
// export function Pass() {
//     set(pass);
// }

// /** Change the extension icon to the failed state. */
// export function Fail() {
//     set(fail);
// }
