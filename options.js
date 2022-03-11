/** Various user settable options. */
export class Options {
    /** The maximum time waite for an expected screenshot to match an actua screenshot during playback, in seconds. */
    MAX_VERIFY_TIMEOUT = 5;

    /** If true the blinking text cursor (properly caret) will be hidden during recording and during playback.
     * This speeds up playback.
    */
    hideCursor = true;

    /** Used in the png matching algorithm. Pixels are allowed some color variance, to deal with anti-aliasing for example.
     * Lower numbers are more strict.
     */
    pixelMatchThreshhold = .2; // different screens seem to render a little different...

    /** delay in ms before a mouse mouse is played.
     * simulates slower typing 
     * 2000 500 0 seem pretty good
    */
    userMouseDelay = 0;

    /** delay in ms before key action is played
     * simulates slower typing 
     * 100 50 0 seem pretty good
    */
     userKeypressDelay = 0;

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
        includeCss: false
    };

    /**
     * Allow provide a way to debug better after deploy
     */
    developerMode = false;

    /** Only monitor the events in the recorder, do not actually record them. */
    debugRecorder = false;

    /** Always try to help the user by silently resetting their zoom to 100% */
    autoZoomTo100 = true;

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

    /**
     * Allow the user to identify the machine that this instance of brimstone-recorder 
     * is installed on. can be used to classify application test run persisted performance 
     * based on which machine was running the test app.
     * @type {string}
     */
    installedOnAlias;

    /**
     * In the verify screenshot function we need to take the actual screen
     * shot first. There is setup to even pull this off. When this throws
     * we sleep and try again. This is that sleep amount
     */
    verifyScreenshotTakeScreenshotRetryTimeout = 500;

    /** after we was taken that first screenshot we compare them,
     * if they are different we want to try again, but not right
     * away. This is how long to wait before we grab the actual 
     * again and compare. Directly affects reported user latency precision.
     */
    verifyScreenshotRetryComparisonTimeout= 200;
    
    /**
     * when playing we send a command via the debugger, if that
     * debugger is detached, or becomes detached during the command
     * we reattach and retry the command once. this happens on or right
     * after a navigation. once we reattach the debugger we wait before 
     * we retry this. this is how long to wait. it's infrequent so it's
     * jacked up a bit high.
     */
    debuggerSendCommandOnPlayRetryTimeout = 2000;

    /** when resizing the viewport, it can fail because of zoom 
     * or pixel scaling issues. so we retry. this is how long to
     * wait before each iteration of the retry.
     */
    resizeViewportRetryTimeout = 500;

    /**
     * This is the total number of ms we will wait 
     * so obtain a screenshot of the size we expect
     * during recording 
     */
    captureScreenshotAsDataUrlForRecordingTimeout = 5000;

    /**
     * How long we wait between back-to-bck attempts to capture a 
     * screenshot of the correct size during record.
     */
    captureScreenshotAsDataUrlForRecordingRetryTimeout = 500;

    /**
     * Automatically apply "actual" type corrections.
     * Actual corrections are applicable if the expected and actual pixels
     * (the condition) of the correction EXACTLY match the condition
     * of the new action expected+actual screenshots.
     * If they match, then the correction is applied, meaning the actual pixels
     * overwrite corresponding expected pixels in the expectedScreenshot of the 
     * current action.
     * 
     * Automatically apply "unpredictable" type corrections.
     * Unpredictable corrections are applicable if there are ANY
     * red pixels in the rectangle defining the boundary of the
     * correction. 
     * If applicable, the unpredictable region is added to the 
     * acceptablePixelDifferences screenshot of the action.
     */
    autoCorrect = true;

    /**
     * Automatically resume playing after applying a 
     * correction.
     */
    autoPlay = false;

    /**
     * Should we forget the corrections we learned when the 
     * test we learned them from is cleared?
     */
     forgetCorrectionsWhenTestIsCleared = false;

     /**
      * Use more memory for faster performance,
      * at the expense of, well, using more memory. :)
      * 
      * This many actions will be prehydrated before
      * playing. 
      * 
      * Higher numbers, speed up playback. 
    */
      maxNumberOfActionsToPrehydrate = 100;
};

/**
 * Cached version of options. This is updated everytime {@link loadOptions}
 * or {@link saveOptions} is called.
 */
export var options = new Options();

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