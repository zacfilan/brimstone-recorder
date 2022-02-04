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
    pixelMatchThreshhold = .2; // different screens seem to render a little different...

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
     * Sometimes we neeed to create a new window in order to record or play incognito.
     * Should we close the previous test window when we do this.
     */
    closeOldTestWindowOnCreate = true;

    /**
     * Experimental features
     */
    experiment = {
        /**
         * Record the CSS of the element acted on in each step.
         * This is not used by the player, but may be
         * useful for external code.
         */
        includeCss: false,
        
        /**
        * When loading multiple tests, we can treat them as an array of seperate tests, or as one big test.
        * Which is it?
        */
        joinSubTests: false
    };

    /**
     * Allow provide a way to debug better after deploy
     */
    developerMode = false;

    /** Only monitor the events in the recorder, do not actually record them. */
    debugRecorder = false;

    /**
     * Number of millseconds to wait to terminate a mousewheel sequence.
     */
    mouseWheelTimeout = 250;

    /** 
     * Number of milliseconds to wait to terminiate a mousemove sequence action.
     * Lower numbers may reduce the number of "please wait until..." alerts the user 
     * receives since they do not need to wait as long to identify the end of the sequence,
     * but is more likely to record more (unecessary) mouse move actions. Higher numbers will force the user to wait
     * longer to avoid the alerts, but is less likely to record unnecessary moousemoves.
     */
    mouseMoveTimeout = 250;

    /**
     * The url that we post a test's run metrics to.
     * This can be used to store performance metrics in a database,
     * if the endpoint is built to do so.
     * e.g.
     * https://my.server.com/api/testruns
     */
    postMetricsEndpoint = 'https://postman-echo.com/post'; // this is a simple POST echo

    /** 
     * If we want to automaticaly post the metrics when a test passes.
     * */
    postMetricsOnPass = false;

    /** 
     * If we want to automatically post the metrics when a test fails */
    postMetricsOnFail = false;

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
    return new Promise(resolve => chrome.storage.local.set({ options }, resolve));
}