import { options } from '../options.js';
import { constants } from '../test.js';
import * as extensionInfo from './extensionInfo.js';
function padDigits(len, num) {
  return num.toString().padStart(len, '0');
}

/** @param {Date} the date*/
function formatDate(date) {
  return (
    [
      date.getFullYear(),
      padDigits(2, date.getMonth() + 1),
      padDigits(2, date.getDate()),
    ].join('-') +
    'T' +
    [
      padDigits(2, date.getHours()),
      padDigits(2, date.getMinutes()),
      padDigits(2, date.getSeconds()),
    ].join(':') +
    '.' +
    padDigits(3, date.getMilliseconds()) +
    'Z'
  );
}

export class Step {
  /** @type {number} database id of this step */
  id;

  /** @type {number} database id of the test this step is in */
  testRunId;

  /** @type {number} the 0-based index of the step within the test */
  index;

  /** @type {string} the step can be named for human read ability */
  name;

  /** @type {number} is this was flattened this is the base index this started at */
  baseIndex;

  /** @type {number} the user perceived latency in milliseconds */
  userLatency;

  /** @type {number} the memory used before this step executes in MBs*/
  clientMemory;

  /** @type {string} full path to the zipfile */
  path;
}

export class Test {
  /** @type {number} database identifier */
  id;

  /** @type {string} name of the recording or playlist */
  name;

  /** @type {string} full path to the zipfile */
  path;

  /** @type {string} 'pass' or 'fail' */
  status = constants.match.NOTRUN;

  /** @type {string} message about fail */
  errorMessage;

  /**
   * @type {number} The 1-based index of the step that executed
   * but did not result in the expected screenshot.
   */
  failingStep;

  /** @type {Date} when the run started */
  startDate = 0;

  /** @type {Date} when the run ended */
  endDate = 0;

  /** @type {string} this is the url that this test starts on */
  startingServer;

  /** @type {number} how many seconds in walltime the run took */
  get wallTime() {
    if (this._wallTime !== undefined) {
      return this._wallTime;
    }
    return this.endDate - this.startDate;
  }
  set wallTime(to) {
    this._wallTime = to;
  }

  /** @type {number} how many seconds of user time the run took. Sum over all step latencies. */
  get userTime() {
    if (this._userTime !== undefined) {
      return this._userTime;
    }

    let t = 0;
    if (this.steps && this.steps.length) {
      for (let i = 0; i < this.steps.length; ++i) {
        t += this.steps[i].userLatency;
      }
    }
    return t;
  }
  set userTime(to) {
    this._userTime = to;
  }

  /** Sometimes we want to be able to override the helpful summary of the latencies of the steps */
  _userTime;

  /** @type {Step[]} */
  steps = [];

  toJSON() {
    return {
      id: this.id,

      /** @type {string} name of the recording or playlist */
      name: this.name,

      /** @type {string} 'pass' or 'fail' */
      status: this.status,

      /** @type {string} message about fail */
      errorMessage: this.errorMessage,

      /** @type {Date} when the run started */
      startDate: formatDate(new Date(this.startDate)),

      /** @type {Date} when the run ended */
      endDate: formatDate(new Date(this.endDate)),

      /** @type {number} how many seconds in walltime the run took */
      wallTime: this.wallTime,

      /** @type {number} how many seconds of user time the run took. Sum over all step latencies. */
      userTime: this._userTime || this.userTime,

      /** @type {Step[]} */
      steps: this.steps,

      chromeVersion: extensionInfo.chromeVersion,

      brimstoneVersion: extensionInfo.version,

      startingServer: this.startingServer,

      brimstoneComputerAlias: options.installedOnAlias,

      applicationVersion: Test.applicationVersion,

      options: JSON.stringify(options),
    };
  }
}

/**
 * Some applications will have version identifier(s) as the apps are developed.
 * This varaible is meant to catch the version identifer(s). e.g. from executing
 * a player.getVersion() user action.
 * @type {string}
 */
Test.applicationVersion;
