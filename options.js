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
  pixelMatchThreshhold = 0.2; // different screens seem to render a little different...

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
  /**
   * Record the CSS of the element acted on in each step.
   * This is not used by the player, but may be
   * useful for external code.
   */
  includeCss = false;

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
  mouseWheelTimeout = 500;

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
  installedOnAlias = null;

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
  verifyScreenshotRetryComparisonTimeout = 200;

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
   * How long we wait between back-to-back attempts to capture a
   * screenshot of the correct size during record.
   */
  captureScreenshotAsDataUrlForRecordingRetryTimeout = 500;

  /**
   * Allow for hang detection on debugger commands.
   * Probably obsolete.
   */
  sendDebuggerCommandTimeout = 0;

  /**
   * How low should we wait for an overlay specfied with
   * {@link waitForCssElementsToNotExistBeforeDriving} before
   * we declare an error. In milliseconds.
   */
  maxTimeToWaitForOverlaysToBeRemoved = 3000;

  /**
   * How often do we submit the function to see if the overlay
   * specified by {@link waitForCssElementsToNotExistBeforeDriving}
   * has disappeared. In ms.
   */
  pollPeriodForOverlayToBeRemoved = 200;

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
  autoPlay = true;

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

  /**
   * Should we give the user a confirm dialog before they
   * issue any delete action?
   */
  confirmToDelete = true;

  /**
   * Should we give the user a warning if the test version is
   * ahead of the brimstone version being used.
   */
  warnOnVersionMismatch = true;

  /**
   * Should the clapperboard icon in the vertical toolbar
   * clear the workspace before recording the active tab or
   * not. This will add an emblem to the icon if set to true;
   */
  clearWorkspaceBeforeRecordingActiveTab = false;

  /**
   * The console can hang onto memory and give false looking memory leaks.
   * If this option is on then the the console is cleared before we
   * measure the memory.
   */
  clearConsoleBeforeMeasuringMemory = true;

  /**
   * When hovering over an icon this is the default size max width rectangle it will use
   */
  autoRectangleMaxWidth = 100;
  /**
   * When hovering over an icon this is the default size max width rectangle it will use
   */
  autoRectangleMaxHeight = 100;

  /**
   * If there is an (even invisible to the eye) overlay that is used to catch all actions, we need to wait for it
   * to NOT be in the DOM before we try and submit actions.
   */
  waitForCssElementsToNotExistBeforeDriving = '';

  /**
   * Actually it is the local debugging port. This is a direct line to use the CDP
   * in this browser in the cases where chrome.debugger.sendMessge fails (i'm looking
   * at you Browser.getVersion).
   */
  remoteDebuggingPort;

  /**
   * where to open the brimstone window: top
   */
  windowTop;
  /**
   * where to open the brimstone window: left
   */
  windowLeft;
  /**
   * where to open the brimstone window: width
   */
  windowWidth;
  /**
   * where to open the brimstone window: height
   */
  windowHeight;

  /**
   * Is the window using a vertical layout?
   */
  verticalLayout = false;

  /**
   * Copy constructor
   * @param {Options} other
   */
  constructor(other = null) {
    if (other) {
      for (let prop in other) {
        this[prop] = other[prop];
      }
    }
  }

  /**
   * Set some options from this one from the other one.
   * Return true if anything changed, false otherwise.
   * @param {Options} other
   * @returns {object |  false} changed options or false if there are none
   */
  set(other) {
    // calculate which options changed value
    let changed = false;
    let changedOptions = {};
    for (let key in other) {
      if (other[key] !== this[key]) {
        changedOptions[key] = this[key] = other[key];
        changed = true;
      }
    }
    return changed && changedOptions;
  }
}

/**
 * Cached version of options. This is updated everytime {@link loadOptions}
 * or {@link saveOptions} is called.
 */
export var options = new Options();

/**
 * return a copy of the user settable options from chrome storage,
 * also updated the exported options object.
 */
export async function loadOptions() {
  let results = await new Promise((resolve) =>
    chrome.storage.local.get('options', resolve)
  );
  let optionsCopy = new Options();
  Object.assign(optionsCopy, results.options); // start with defaults and overwrite with stored values
  options.set(optionsCopy);
  return optionsCopy;
}

/**
 * If the options object passed has any different values
 * save them to storage and send a message containing
 * just the options that changed along with their value to the extension
 * */
export async function saveOptions(newOptions, message = true) {
  let optionsCopy = await loadOptions();
  let optionsChanged = optionsCopy.set(newOptions);
  options.set(optionsCopy);
  if (optionsChanged) {
    await new Promise((resolve) =>
      chrome.storage.local.set({ options }, resolve)
    );
    if (message) {
      try {
        await chrome.runtime.sendMessage({ optionsChanged });
      } catch (e) {
        // it's possible the only one side is up
      }
    }
  }
}
