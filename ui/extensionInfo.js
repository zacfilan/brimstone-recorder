import { options } from '../options.js';
import { brimstone } from '../utilities.js';
/**
 * The dev-aware version of this extension.
 * e.g. "dev1.11.1" or "v2.32.5"
 *
 * *so dev versions compare
 * "higher" than all non-dev versions.*
 * */
export let version = '';

/** The chrome version comes from the userAgent string,
 * but may be overridden if there is a better way to get a
 * more detailed version.
 */
export let chromeVersion = /Chrome\/([0-9.]+)/.exec(navigator.userAgent)[1];

/**
 * just the w.x.y.z part
 */
export let chromeBuild = /Chrome\/([0-9.]+)/.exec(navigator.userAgent)[1];
/**
 * async constructor
 */
export async function initialize() {
  await tryToUpdateToDetailedChromeVersion();
  let _info = await chrome.management.getSelf();
  let _brimstoneVersion = 'v' + chrome.runtime.getManifest().version;
  version =
    (_info.installType === 'development' ? 'de' : ' ') + _brimstoneVersion;
}

async function browserGetVersion(port) {
  // TODO: this should work but something is wrong with the debugger...
  // let data = await player.debuggerSendCommand('Browser.getVersion', {});
  // so ... F IT I'LL DO IT LIVE!
  let metaData = await $.getJSON(`http://localhost:${port}/json`);

  let ws = new WebSocket(metaData[0].webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  let response = new Promise((resolve) => (ws.onmessage = resolve));
  ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
  let event = await response;
  ws.close();

  // extract and return the build number
  // e.g.: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/106.0.5249.119 Safari/537.36'
  let data = JSON.parse(event.data);
  return data;
}

/**
 * Attempt to get a detailed chrome version string
 * from the remote debugging port if it is open
 */
async function tryToUpdateToDetailedChromeVersion() {
  if (!options.remoteDebuggingPort) {
    return;
  }
  // the user specified the port in the options, but they may not have enabled the command line switch
  try {
    let [data, versions] = await Promise.all([
      browserGetVersion(options.remoteDebuggingPort),
      $.get('http://omahaproxy.appspot.com/history'),
    ]);

    chromeBuild = data.result.product.match(/([\d\.]+)/)[1];
    let myOsString = data.result.userAgent
      .match(/\(([^\)]+)\)/)[1]
      .toLowerCase();
    let myOs;
    if (myOsString.includes('windows')) {
      if (myOsString.includes('64')) {
        myOs = 'win64';
      } else {
        myOs = 'win';
      }
    } else if (myOsString.includes('mac')) {
      myOs = 'mac';
    } else if (myOsString.includes('linux')) {
      myOs = 'linux';
    }
    versions = versions.split(/\n/);
    let myChannel;
    for (let versionStr of versions) {
      let [os, channel, versionInfo] = versionStr.split(','); // short os, channel, version, date
      if (chromeBuild === versionInfo && os === myOs) {
        myChannel = channel;
        break;
      }
    }
    if (myChannel) {
      chromeVersion = `Version ${chromeBuild} (Official Build)`;

      if (myChannel !== 'stable') {
        chromeVersion += ` (${myChannel})`;
      }

      if (myOsString.includes('64')) {
        chromeVersion += ` (64-bit)`;
      }
    }
  } catch (e) {
    await brimstone.window.alert(
      `I tried to get a more specific version of the chrome build number via the remote debugging port for you. But I could not contact the remote debugging port. If you enable a remote debugging port in options, make sure you launch chrome with --remote-debugging-port=<port>. Where <port> is the value you put in the options.

  Falling back to less specific chrome build version.`
    );
  }
}
