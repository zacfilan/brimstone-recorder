import { constants, TestAction } from "./card.js";

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
    let screenshotPromises = [];
    for (let i = 0; i < actions.length; ++i) {
        let screenshotPromise = (new TestAction(actions[i])).hydrateExpected();
        screenshotPromises.push(screenshotPromise);
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
        if (action.acceptablePixelDifferences) {
            action.class.push(constants.class.ALLOWED);
            screenshotPromise = action.hydrateAcceptable();
            screenshotPromises.push(screenshotPromise);
        }
        if (action.expectedScreenshot) {
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
    zip.file('test.json', JSON.stringify({ steps: TestAction.instances }, null, 2)); // add the test.json file to archive
    screenshots = zip.folder("screenshots"); // add a screenshots folder to the archive
    // add all the expected screenshots to the screenshots directory in the archive
    for (let i = 0; i < TestAction.instances.length; ++i) {
        let card = TestAction.instances[i];
        if (card.expectedScreenshot?.dataUrl) {
            let response = await fetch(card.expectedScreenshot.dataUrl);
            let blob = await response.blob();
            screenshots.file(card.expectedScreenshot.fileName, blob, { base64: true });
        }

        // only save the actual screenshot if it didn't match the expected, before checking for acceptable pixel differences
        // in other words don't save the same image twice.
        if (card.actualScreenshot?.dataUrl) {
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
}