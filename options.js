/** Various user settable options. */
var options = {
};

var defaults = {
    MAX_VERIFY_TIMEOUT: 15 // seconds;
};

/** load the user settable options from chrome storage
 * 
 */
export async function loadOptions() {
    let results = await (new Promise(resolve => chrome.storage.local.get('options', resolve)));
    Object.assign(defaults, results.options); // stat with defaults and overwrite with stored values
    Object.assign(options, defaults); // then update the exportable set
    return options;
}