import { Options, loadOptions, saveOptions } from './options.js';

const userKeypressDelayLookup = [100, 50, 0];
const userMouseDelayLookup = [2000, 500, 0];
const pixelMatchThreshholdLookup = [0.2, 0.1, 0];
const mouseWheelTimeoutLookup = [500, 250, 100];
const mouseMoveTimeoutLookup = [500, 250, 100];

/**
 * local model for the view. initialized with a copy
 * of the persisted options.
 * @type {Options}
 */
let options;

/**
 * sets the view model {@link options} from the view.
 *
 * When the user changes things in the UI, we need to
 * keep the model in sync.
 * */
async function setModelFromView() {
  //#region checking options
  options.MAX_VERIFY_TIMEOUT = parseInt(matchTimeout.value, 10);
  options.pixelMatchThreshhold =
    pixelMatchThreshholdLookup[parseFloat(pixelMatchSenstivity.value)];
  options.autoCorrect = autoCorrect.checked;
  options.autoPlay = autoPlay.checked;
  //#endregion checking option

  //#region playback options
  options.userMouseDelay =
    userMouseDelayLookup[parseInt(userMouseSpeed.value, 10)];
  options.userKeypressDelay =
    userKeypressDelayLookup[parseInt(userKeypressSpeed.value, 10)];
  options.clearConsoleBeforeMeasuringMemory =
    clearConsoleBeforeMeasuringMemory.checked;
  options.waitForCssElementsToNotExistBeforeDriving =
    waitForCssElementsToNotExistBeforeDriving.value;
  //#endregion playback options

  //#region database options
  options.postMetricsEndpoint = postMetricsEndpoint.value;
  options.postMetricsOnPass = postMetricsOnPass.checked;
  options.postMetricsOnFail = postMetricsOnFail.checked;
  options.installedOnAlias = installedOnAlias.value;
  //#endregion database options

  //#region general options
  options.hideCursor = hideCursor.checked;
  options.closeOldTestWindowOnCreate = closeOldTestWindowOnCreate.checked;
  options.confirmToDelete = confirmToDelete.checked;
  options.warnOnVersionMismatch = warnOnVersionMismatch.checked;

  //#endregion general options

  //#region recording options
  options.recordIncognito = recordIncognito.checked;
  options.mouseMoveTimeout =
    mouseMoveTimeoutLookup[parseInt(mouseMoveTimeout.value, 10)];
  options.mouseWheelTimeout =
    mouseWheelTimeoutLookup[parseInt(mouseWheelTimeout.value, 10)];
  options.clearWorkspaceBeforeRecordingActiveTab =
    clearWorkspaceBeforeRecordingActiveTab.checked;
  //#endregion recording options

  //#region developer options
  options.maxNumberOfActionsToPrehydrate = parseInt(
    maxNumberOfActionsToPrehydrate.value,
    10
  );

  options.developerMode = developerMode.checked;
  options.debugRecorder = debugRecorder.checked;
  options.autoZoomTo100 = autoZoomTo100.checked;

  options.forgetCorrectionsWhenTestIsCleared =
    forgetCorrectionsWhenTestIsCleared.checked;

  //#region timeouts
  options.verifyScreenshotRetryComparisonTimeout = parseInt(
    verifyScreenshotRetryComparisonTimeout.value
  );
  options.verifyScreenshotTakeScreenshotRetryTimeout = parseInt(
    verifyScreenshotTakeScreenshotRetryTimeout.value
  );
  options.debuggerSendCommandOnPlayRetryTimeout = parseInt(
    debuggerSendCommandOnPlayRetryTimeout.value
  );
  options.resizeViewportRetryTimeout = parseInt(
    resizeViewportRetryTimeout.value
  );
  options.captureScreenshotAsDataUrlForRecordingTimeout = parseInt(
    captureScreenshotAsDataUrlForRecordingTimeout.value
  );
  options.captureScreenshotAsDataUrlForRecordingRetryTimeout = parseInt(
    captureScreenshotAsDataUrlForRecordingRetryTimeout.value
  );
  options.pollPeriodForOverlayToBeRemoved = parseInt(
    pollPeriodForOverlayToBeRemoved.value
  );
  options.maxTimeToWaitForOverlaysToBeRemoved = parseInt(
    maxTimeToWaitForOverlaysToBeRemoved
  );
  //#endregion timeouts

  //#endregion developer options

  //#region experiments
  options.includeCss = includeCss.checked;
  //#endregion experiments
}

/**
 * save ui option change.
 * set the model from the view
 * persist the model
 */
async function save_ui_option_change() {
  setModelFromView();
  await saveOptions(options);

  optionsSaveStatus.textContent = 'Options saved.';
  setTimeout(function () {
    optionsSaveStatus.textContent = '';
  }, 750);
}

async function save_defaults() {
  Object.assign(options, new Options()); // change the current model to default values
  setViewFromModel(); // allow a change from the extension to immediately show
  await saveOptions(options);

  optionsSaveStatus.textContent = 'Options saved.';
  setTimeout(function () {
    optionsSaveStatus.textContent = '';
  }, 750);
}

/**
 * Update the view from global model {@link options}.
 */
function setViewFromModel() {
  //#region checking options
  matchTimeout.value = options.MAX_VERIFY_TIMEOUT;
  pixelMatchSenstivity.value = pixelMatchThreshholdLookup.indexOf(
    options.pixelMatchThreshhold
  );
  autoCorrect.checked = options.autoCorrect;
  autoPlay.checked = options.autoPlay;
  //#endregion checking options

  //#region playback options
  userKeypressSpeed.value = userKeypressDelayLookup.indexOf(
    options.userKeypressDelay
  );
  userMouseSpeed.value = userMouseDelayLookup.indexOf(options.userMouseDelay);
  clearConsoleBeforeMeasuringMemory.checked =
    options.clearConsoleBeforeMeasuringMemory;
  waitForCssElementsToNotExistBeforeDriving.value =
    options.waitForCssElementsToNotExistBeforeDriving;
  //#endregion playback options

  //#region database options
  postMetricsEndpoint.value = options.postMetricsEndpoint;
  postMetricsOnPass.checked = options.postMetricsOnPass;
  postMetricsOnFail.checked = options.postMetricsOnFail;
  installedOnAlias.value = options.installedOnAlias;
  //#endregion database options

  //#region general options
  hideCursor.checked = options.hideCursor;
  closeOldTestWindowOnCreate.checked = options.closeOldTestWindowOnCreate;
  confirmToDelete.checked = options.confirmToDelete;
  warnOnVersionMismatch.checked = options.warnOnVersionMismatch;
  //#endregion general options

  //#region recording options
  recordIncognito.checked = options.recordIncognito;
  mouseMoveTimeout.value = mouseMoveTimeoutLookup.indexOf(
    options.mouseMoveTimeout
  );
  mouseWheelTimeout.value = mouseWheelTimeoutLookup.indexOf(
    options.mouseWheelTimeout
  );
  clearWorkspaceBeforeRecordingActiveTab.checked =
    options.clearWorkspaceBeforeRecordingActiveTab;
  //#endregion recording options

  //#region developer options
  maxNumberOfActionsToPrehydrate.value = options.maxNumberOfActionsToPrehydrate;
  developerMode.checked = options.developerMode;
  debugRecorder.checked = options.debugRecorder;
  autoZoomTo100.checked = options.autoZoomTo100;

  forgetCorrectionsWhenTestIsCleared.checked =
    options.forgetCorrectionsWhenTestIsCleared;
  //#region timeouts
  verifyScreenshotTakeScreenshotRetryTimeout.value =
    options.verifyScreenshotTakeScreenshotRetryTimeout;

  verifyScreenshotRetryComparisonTimeout.value =
    options.verifyScreenshotRetryComparisonTimeout;

  debuggerSendCommandOnPlayRetryTimeout.value =
    options.debuggerSendCommandOnPlayRetryTimeout;

  resizeViewportRetryTimeout.value = options.resizeViewportRetryTimeout;

  captureScreenshotAsDataUrlForRecordingTimeout.value =
    options.captureScreenshotAsDataUrlForRecordingTimeout;

  captureScreenshotAsDataUrlForRecordingRetryTimeout.value =
    options.captureScreenshotAsDataUrlForRecordingRetryTimeout;

  pollPeriodForOverlayToBeRemoved.value =
    options.pollPeriodForOverlayToBeRemoved;

  maxTimeToWaitForOverlaysToBeRemoved.value =
    options.maxTimeToWaitForOverlaysToBeRemoved;
  //#endregion timeouts
  //#endregion developer options

  //#region experiments
  includeCss.checked = options.includeCss;
  //#endregion experiments
}

/**
 * Handle messages about the options changing
 */
async function onMessageHandler(
  request,
  sender
  //sendResponse
) {
  console.log(
    sender.tab
      ? 'from a content script:' + sender.tab.url
      : 'from the extension',
    request
  );
  if (request.optionsChanged) {
    options.set(request.optionsChanged);
    setViewFromModel(); // allow a change from the extension to immediately show

    optionsSaveStatus.textContent = 'Options saved.';
    setTimeout(function () {
      optionsSaveStatus.textContent = '';
    }, 750);
  }
}

// main
(async () => {
  options = await loadOptions();
  // set the view from the model when we start up
  setViewFromModel();
  //  document.addEventListener('DOMContentLoaded', setViewFromModel);

  // if you click the save button, save the options
  save.addEventListener('click', save_ui_option_change);

  // if you change any checkbox immediately save the options
  $('input[type="checkbox"]').change(save_ui_option_change);

  // allow a reset
  reset.addEventListener('click', save_defaults);

  chrome.runtime.onMessage.addListener(onMessageHandler);
})();
