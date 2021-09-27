/** Various user settable options. */
var options = {
};


/** load the user settable options from chrome storage
 * 
 */
export async function loadOptions() {
    let results = await (new Promise(resolve => chrome.storage.local.get('options', resolve)));
    var defaults = {
        MAX_VERIFY_TIMEOUT: 15, // seconds;
        hideCursor: true
    };
    Object.assign(defaults, results.options); // start with defaults and overwrite with stored values
    Object.assign(options, defaults); // then update the exportable set
    return options;
}

export function saveOptions(options) {
    return new Promise(resolve =>  chrome.storage.local.set({options}, resolve));
}