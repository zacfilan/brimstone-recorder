import { loadOptions, saveOptions } from "../options.js";
import { constants, TestAction } from "./card.js";
import { Screenshot } from "./screenshot.js";

/** the zipfile */
var zip;

/** the screenshots dir in the zip */
var screenshots;

/** the screenshots dir in the zip */
export function getScreenshots() {
    return screenshots;
}

/** show file picker and let user load a test recording. */
export async function loadFile() {
    let fileHandle;
    try {
        [fileHandle] = await window.showOpenFilePicker({
            suggestedName: `test.zip`,
            types: [
                {
                    description: 'A ZIP archive that can be run by Brimstone',
                    accept: { 'application/zip': ['.zip'] }
                }
            ]
        });
    }
    catch (e) {
        console.error(e);
        return;
    }

    const blob = await fileHandle.getFile();
    zip = await (new JSZip()).loadAsync(blob);
    screenshots = await zip.folder('screenshots');
    let test = JSON.parse(await zip.file("test.json").async("string"));

    let actions = test.steps;

    // if the test has meta data, then update the currently running set of options with this data
    let options = await loadOptions();
    options.hideCursor = test.meta?.hideCursor ?? false;
    await saveOptions(options);

    let screenshotPromises = [];
    for (let i = 0; i < actions.length; ++i) {
        let action = new TestAction(actions[i]);
        let screenshotPromise;

        if (action.expectedScreenshot?.fileName) {
            action.expectedScreenshot = new Screenshot(action.expectedScreenshot);
            action._view = constants.view.EXPECTED;
            screenshotPromise = action.expectedScreenshot.loadDataUrlFromFile();
            screenshotPromises.push(screenshotPromise); // needed to see any image during loading
        }

        // create the container for the other screenshots to be hydrated, 
        // thus, if these props exist on the action, they def have a fileName
        // but may not be hydrated. if they don't exist, they weren't in the file, nor has this action been played
        if (action.acceptablePixelDifferences?.fileName) {
            action._match = constants.match.ALLOW;
            action.acceptablePixelDifferences = new Screenshot(action.acceptablePixelDifferences);
        }
        if (action.actualScreenshot?.fileName) {
            action._match = constants.match.FAIL; // if it failed, do I really care to know there are allowed differences too?
            // if you have an actual one to load it means that the last time this was run it failed.
            action.actualScreenshot = new Screenshot(action.actualScreenshot);
        }
    }
    if (screenshotPromises.length) {
        await Promise.all(screenshotPromises);
    }

    hydrateForPlay();
    return blob;
}

var acceptableHydratedPromise = false;

/**
 * 
 * @returns {Promise<boolean>}
 */
export function getHydratedForPlayPromise() {
    return acceptableHydratedPromise;
}

/** schedules some code to set the pngs for expected screnshots
 * and the dataurl+pngs for actions with allowed differences.
 * this sets a promise that can be sampled with getHydratedForPlayPromise()
 */
export function hydrateForPlay() {
    let screenshotPromises = [];
    let screenshotPromise;
    for (let i = 0; i < TestAction.instances.length; ++i) {
        let action = TestAction.instances[i];
        if (action.acceptablePixelDifferences && !action.acceptablePixelDifferences.png) {
            if (action.acceptablePixelDifferences?.fileName) { // protect against possible bad save
                screenshotPromise = action.acceptablePixelDifferences.hydrate();
                screenshotPromises.push(screenshotPromise);
            }
        }
        if (action.expectedScreenshot && !action.expectedScreenshot.png) {
            screenshotPromise = action.expectedScreenshot.createPngFromDataUrl();
            screenshotPromises.push(screenshotPromise);
        }
    }
    console.log(`loader: hydrated ${screenshotPromises.length} acceptable screenshot promises`);
    if (screenshotPromises.length > 0) {
        acceptableHydratedPromise = Promise.all(screenshotPromises);
    }
}

/**
 * save the current state to a zip file 
 */
export async function saveFile() {
    console.debug('create zip');
    zip = new JSZip();
    zip.file('test.json', JSON.stringify(
        {
            meta: TestAction.meta,
            steps: TestAction.instances
        }, null, 2)); // add the test.json file to archive
    screenshots = zip.folder("screenshots"); // add a screenshots folder to the archive
    // add all the expected screenshots to the screenshots directory in the archive
    for (let i = 0; i < TestAction.instances.length; ++i) {
        console.log(`saving files for ${i}`);
        let card = TestAction.instances[i];
        if (card.expectedScreenshot?.dataUrl) {
            let response = await fetch(card.expectedScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.expectedScreenshot.fileName, blob, { base64: true });
        }

        // only save the actual screenshot if it didn't match the expected, before checking for acceptable pixel differences
        // in other words don't save the same image twice.
        if (card.actualScreenshot && card.numDiffPixels && card.actualScreenshot.fileName && card.actualScreenshot.dataUrl) {
            let response = await fetch(card.actualScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.actualScreenshot.fileName, blob, { base64: true });
        }

        if (card.acceptablePixelDifferences?.dataUrl) {
            let response = await fetch(card.acceptablePixelDifferences.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.acceptablePixelDifferences.fileName, blob, { base64: true });
        }
    }

    console.debug('save zip to disk');
    let blobpromise = zip.generateAsync({ type: "blob" });
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: `test.zip`,
            types: [
                {
                    description: 'A ZIP archive that can be run by Brimstone',
                    accept: { 'application/zip': ['.zip'] }
                }
            ]
        });
        const writable = await handle.createWritable();
        let blob = await blobpromise;
        await writable.write(blob);  // Write the contents of the file to the stream.    
        await writable.close(); // Close the file and write the contents to disk.
        return handle;
    }
    catch (e) {
        console.error(e);
    }
}