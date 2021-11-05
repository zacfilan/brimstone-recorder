/** Various user settable options. */
export class Options {
    /** The maximum time waite for an expected screenshot to match an actua screenshot during playback, in seconds. */
    MAX_VERIFY_TIMEOUT = 15; 

    /** If true the blinking text cursor (properly caret) will be hidden during recording and during playback.
     * This speeds up playback.
    */
    hideCursor = true;

    /** Used in the png matching algorithm. Pixels are allowed some color variance, to deal with anti-aliasing for example.
     * Lower numbers are more strict.
     */
    pixelMatchThreshhold = .1;

    /** delay in ms between typed characters.
     * simulates slower typing 
     * 0 50 100 seem pretty good
    */
    interKeypressDelay = 0;

    /**
     * Record incognito always
     * playback will be set to whichever mode the test was recorded in
     */
    recordIncognito = true;

    /**
     * 
     */
    experimentalFeatures = false;


    /**
     * Allow provide a way to debug better after deploy
     */
    developerMode = false;
};

var options = new Options();

/** load the user settable options from chrome storage
 * 
 */
export async function loadOptions() {
    let results = await (new Promise(resolve => chrome.storage.local.get('options', resolve)));
    Object.assign(options, results.options); // start with defaults and overwrite with stored values
    return options;
}

/**
 * 
 * @param {Options} options 
 * @returns when complete
 */
export function saveOptions(options) {
    return new Promise(resolve =>  chrome.storage.local.set({options}, resolve));
}