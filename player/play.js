const fs = require('fs');
const unzipper = require('unzipper');
const webdriver = require('selenium-webdriver');
const { PNG } = require('pngjs');
const { readdir, readFile, writeFile } = require('fs/promises');
const pixelmatch = require('pixelmatch');
const { Options, ServiceBuilder } = require('selenium-webdriver/chrome');

/** The last actual screenshot taken. It will hold the error state when an 
 * actions expectedScreenshot doesn't match the actualScreenshot
 */
var actualScreenshotBuffer;

var getWindowSizeForViewPort = function (rect) {
    return {
        width: window.outerWidth - window.innerWidth + rect.width,
        height: window.outerHeight - window.innerHeight + rect.height
    };
};

/////////////////////// 
// Set up the driver
const args = [
    '--incognito',
    '--enable-automation',
    '--disable-infobars',
    '--ignore-ssl-errors=yes',
    '--ignore-certificate-errors'
];

var chromeCapabilities = webdriver.Capabilities.chrome()
    .set('chromeOptions', {args})
    .set('acceptInsecureCerts', true);

const serviceBuilder = new ServiceBuilder('../node_modules/chromedriver/lib/chromedriver/chromedriver.exe');

const driver = new webdriver.Builder()
    .forBrowser('chrome')
    .withCapabilities(chromeCapabilities)
    .setChromeService(serviceBuilder)
    .build();
///////////////////////

const expectedScreenshots = {};
async function loadExpectedScreenshots(dirname = 'screenshots/') {
    console.log(`loading expected screenshots from ${dirname}`);
    let filenames = await readdir(dirname);

    for (let i = 0; i < filenames.length; ++i) {
        let filename = filenames[i];
        let match = filename.match(/^step(\d+)_expected\.png$/);
        if (match) {
            console.log(`  ${filename}`);
            let content = await readFile(dirname + filename);
            expectedScreenshots[dirname + filename] = content;
        }
    }
    if (Object.keys(expectedScreenshots).length === 0) {
        throw `There are no screen shots in directory ${dirname}`;
    }
};

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function expectedScreenshot({ type, expectedScreenshot: ss, step, clientX, clientY }) {
    let blob = expectedScreenshots[ss.fileName];
    let expectedScreenshot = PNG.sync.read(blob); // this is the state required BEFORE we can drive, it verifies the PREVIOUS step completed as expected
    let max_verify_timout = 10; // seconds
    let sleepMs = 500;
    let MaxCheckForEqualityCount = Math.floor((max_verify_timout * 1000) / sleepMs);
    for (let checkForEqualityCount = 0; checkForEqualityCount < MaxCheckForEqualityCount; ++checkForEqualityCount) {
        try {
            if (type === 'mousedown') {
                // for a click, we first mouseover the location, so as to change the screen correctly with hover effect
                const actions = driver.actions({ async: true });
                console.log(`move mouse to (500,500), and then to (${clientX}, ${clientY})`)
                await actions
                    .move({ origin: 'viewport', x: 500, y: 500 }) // mouseleave
                    .move({ origin: 'viewport', x: clientX, y: clientY })
                    .pause(sleepMs) // mouseover
                    .perform();
            }

            let actualScreenshotAsBase64 = await driver.takeScreenshot();
            actualScreenshotBuffer = Buffer.from(actualScreenshotAsBase64, 'base64');
            let actualScreenshot = PNG.sync.read(actualScreenshotBuffer); // FIXME: slower than a string compare on the base64
            const { width, height } = expectedScreenshot;

            if (actualScreenshot.width !== width || actualScreenshot.height !== height) {
                break;
            }

            const diff = new PNG({ width, height });
            var numDiffPixels = pixelmatch(expectedScreenshot.data, actualScreenshot.data, diff.data, width, height, { threshold: 0.5 });
            if (numDiffPixels === 0) {
                return;
            }
        }
        catch (e) {
            console.warn(e);
        }
        if (type !== 'mousedown') {
            await sleep(sleepMs);
        }
    }
    throw 'screenshots do not match';
}

class Actions {
    async start(args) {
        console.log(`point the browser at the url <a href="${args.url}" target="_blank">${args.url}</a> then set viewport to ${args.tabWidth}x${args.tabHeight}px`);
        await driver.get(args.url);
        let requiredWindowSize = await driver.executeScript(getWindowSizeForViewPort, { width: args.tabWidth, height: args.tabHeight });
        await driver.manage().window().setRect(requiredWindowSize);
    }

    async keydown(args) {
        await expectedScreenshot(args);
        console.log(`type '${args.value}' key at location (${args.clientX}, ${args.clientY})`);
        let key = args.value === 'Tab' ? webdriver.Key.TAB : args.value;
        return driver.actions({ async: true })
            .move({ origin: 'viewport', x: args.clientX, y: args.clientY })
            .sendKeys(key)
            .perform();
    }

    async mousedown(args) {
        await expectedScreenshot(args);
        console.log(`click at location (${args.clientX}, ${args.clientY})`);
        return driver.actions({ async: true })
            .move({ origin: 'viewport', x: args.clientX, y: args.clientY })
            .click()
            .perform();
    }
}

const actions = new Actions();
async function unzipTest() {
    fs.rmdirSync('screenshots', { recursive: true });
    if (fs.existsSync('test.json')) {
        fs.unlinkSync('test.json');
    }
    let zipname = 'test.zip';
    let p;

    if (fs.existsSync(zipname)) {
        console.log(`(unzipping): ${zipname}`);
        await fs.createReadStream(zipname)
            .pipe(unzipper.Extract({ path: process.cwd() }))
            .promise();
    }
    else {
        throw `There is no zipfile named ${zipname}.`;
    }
}

var currentAction;
var currentTest;

function getRecordedEvents() {
    let json = fs.readFileSync('test.json', 'utf8');
    currentTest = JSON.parse(json);
    return currentTest.actions;
}

(async function test() {
    try {
        await unzipTest();
        let recordedEvents = getRecordedEvents();
        await loadExpectedScreenshots();
        currentTest.player = {};
        for (let i = 0; i < recordedEvents.length; ++i) {
            currentAction = recordedEvents[i];
            delete currentAction.actualScreenshot;
            console.log(`execute page.${currentAction.type}`);
            await actions[currentAction.type](currentAction);
        }
        await driver.quit();
    }
    catch (e) {
        console.log(e);
        await driver.quit();
        if (e !== 'screenshots do not match') {
            throw e;
        }
        let fileName = `step${currentAction.step}_actual.png`;
        actualFilename = `screenshots/${fileName}`;
        fs.writeFileSync(actualFilename, actualScreenshotBuffer);
        currentTest.player.failedOnStep = currentAction.step; // indicates the test fail, what step, and the path to the actual screenshot
    }
    fs.writeFileSync('test.json', JSON.stringify(currentTest, null, 2));
})();
