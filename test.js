import { TestAction, constants } from "./ui/card.js";
import { Screenshot } from "./ui/screenshot.js";

/**
 * A test instance is a recording of user actions that can be played back
 * and verified.
 */
export class Test {
    /**
     * reset state
     * @param {Test} test
     */
    reset() {
        /**
         * These are the individual actions of the test.
         * @type {TestAction[]}
         */
        this.steps = [];

        /** The version of brimstone-recorder used to record this test. */
        this.version = 'v' + chrome.runtime.getManifest().version;

        /** Should we hide the cursor for this test for performance? */
        this.hideCursor = true;

        /** Was this test recorded in (and hence should be played back in) incognito? */
        this.incognito = true;

        /** If this test is persisted to disk, this records the name used */
        this.filename = 'untitled';

        /**
         * The zipfile this instance was loaded from or saved into.
         */
        this.zip = undefined;

        /**
         * Allow actions added to the test to overwrite old actions. This
         * is needed to record over sections of the test. It remembers the
         * index to recd the next action into.
         */
        this.recordIndex = 0;

        this._imageProcessingPromise = null;
    }

    /** 
     * Returns a promise that completes when the test images are al processed.
     * 
     * All dataurls and PNGs are ready in the test. 
     * this is S-L-O-W because of the way I create PNG objects. Try to speed up!
     * 
     * https://www.npmjs.com/package/pngjs#example
     * 
     * https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams
     */
    async imageProcessing() {
        await this._imageProcessingPromise;
    }

    /** 
     * Sets a promise completes when the image processing is done.
     * await this.imageProcessing() somewhere else to wait for it to complete.
     * 
     * All dataurls and PNGs are ready in the test. 
     * this is S-L-O-W because of the way I create PNG objects. Try to speed up!
     * 
     * https://www.npmjs.com/package/pngjs#example
     * 
     * https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams
     */
    startImageProcessing(progressCallback) {
        this._imageProcessingPromise = this._hydrateForPlay(progressCallback, this.zip)
    }

    /**
     * default constructor
     */
    constructor() {
        this.reset();
    }

    /**
     * Insert or append the action to the test. If the action does
     * not have an index it will be assigned an index 1 past the last.
     * Then the action will be inserted there.
     * 
     * @param {TestAction} action The action to push onto the end.
     */
    updateOrAppendAction(action) {
        // make sure it has a step number
        if (action.index === undefined) { // when recording actions they (may!) come in without an index, so use the running one.
            action.setIndex(this.recordIndex);
        }
        // wait actions only update the UI they don't actually get recorded
        if(action.type !== 'wait') {
            this.recordIndex = action.index + 1;
        }
        this.steps[action.index] = action;
        action.test = this; // each action knows what test it is in
    }

    /** 
     * Delete the specified action from the test. This changes the indexes of all subsequent actions, but that isn't
     * persisted until a save. 
     * @param {TestAction} action */
    deleteAction(action) {
        let removeIndex = action.index;
        for (let i = action.index + 1; i < this.steps.length; ++i) {
            let action = this.steps[i];
            action.setIndex(i - 1);
        }
        this.steps.splice(removeIndex, 1);
    }

    /**
     * Delete all the actions before the passed in one.
     * The passed in one becomes index .
     * @param {TestAction} action 
     */
    deleteActionsBefore(action) {
        this.steps.splice(0, action.index);
        this.reindex();
    }

    reindex() {
        for (let i = 0; i < this.steps.length; ++i) {
            let action = this.steps[i];
            action.setIndex(i);
        }
    }
    /**
     * Delete all the actions after the passed in one.
     * The passed in one becomes one before the last.
     * Update the last to just contain the expected screenshot.
     * @param {TestAction} action 
     */
    deleteActionsAfter(action) {
        this.steps.splice(action.index + 2);
        this.reindex();

    }

    /**
     *  insert the action at the index specified in the action
     *  @param {TestAction} newAction The action to insert
     */
    insertAction(newAction) {
        this.steps.splice(newAction.index, 0, newAction);
        this.reindex();
    }

    /**
     * save the current state to a zip file 
     */
    async saveFile() {
        console.debug('create zip');
        this.zip = new JSZip();
        this.zip.file('test.json', JSON.stringify(
            this,
            null,
            2
        )); // add the test.json file to archive

        let screenshots = this.zip.folder("screenshots"); // add a screenshots folder to the archive
        // add all the expected screenshots to the screenshots directory in the archive
        for (let i = 0; i < this.steps.length; ++i) {
            console.log(`saving files for ${i}`);
            let card = this.steps[i];
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
        let blobpromise = this.zip.generateAsync({ type: "blob" });
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
            this.filename = handle.name;
            return handle;
        }
        catch (e) {
            console.error(e);
        }
    }

    /**
    * async constructor from a filehandle of the zip.
    * loads all the expected screenshots into data urls as fast as possible from the zip.
    * 
    * no feedback.
    */
    async fromFileHandle(fileHandle) {
        if (!fileHandle) {
            return this;
        }
        this.reset();
        
        const blob = await fileHandle.getFile();
        this.zip = await (new JSZip()).loadAsync(blob);
        let screenshots = this.zip.folder("screenshots"); // access screenshots folder from the archive

        let testPojo = JSON.parse(await this.zip.file("test.json").async("string"));
        let actions = testPojo.steps;

        // convert older tests
        if (testPojo.meta) {
            Object.assign(testPojo, testPojo.meta);
            delete testPojo.meta;
        }

        this.hideCursor = testPojo.hideCursor;
        this.incognito = testPojo.incognito;
        this.filename = fileHandle.name;

        let screenshotPromises = [];
        for (let i = 0; i < actions.length; ++i) {
            // convert old tests
            if (actions[i].type === 'start') {
                actions[i].type = 'goto';
            }

            let action = new TestAction(actions[i]);
            this.updateOrAppendAction(action);
            let screenshotPromise;

            if (action.expectedScreenshot?.fileName) {
                action.expectedScreenshot = new Screenshot(action.expectedScreenshot);
                action._view = constants.view.EXPECTED;
                screenshotPromise = action.expectedScreenshot.loadDataUrlFromZipDir(screenshots);
                screenshotPromises.push(screenshotPromise); // needed to see any image during loading
            }
            else {
                action.expectedScreenshot = undefined; // whack any bad data
            }

            // create the container for the other screenshots to be hydrated, 
            // thus, if these props exist on the action, they def have a fileName
            // but may not be hydrated. if they don't exist, they weren't in the file, nor has this action been played
            if (action.acceptablePixelDifferences?.fileName) {
                action._match = constants.match.ALLOW;
                action.acceptablePixelDifferences = new Screenshot(action.acceptablePixelDifferences);
            }
            else {
                action.acceptablePixelDifferences = undefined; // whack any bad data
            }
            if (action.actualScreenshot?.fileName) {
                action._match = constants.match.FAIL; // if it failed, do I really care to know there are allowed differences too?
                // if you have an actual one to load it means that the last time this was run it failed.
                action.actualScreenshot = new Screenshot(action.actualScreenshot);
            }
            else {
                action.actualScreenshot = undefined; // whack any bad data
            }
        }
        if (screenshotPromises.length) {
            // FIXME: in truth I don't need to wait for all of these. 
            // I only need these dataurls if the user looks at them (navigates to them to manually or because of playing)
            // but this is PLENTY fast, so don't sweat it!
            await Promise.all(screenshotPromises);
        }

        return this;
    }

    /** schedules some code to set the pngs for expected screnshots
     * and the dataurl+pngs for actions with allowed differences.
     * this sets a promise that can be sampled with getHydratedForPlayPromise()
     * @param {Test} test The test we need to hydrate
     */
    async _hydrateForPlay(progressCallback) {
        return new Promise(async (resolve) => {
            let screenshots = this.zip?.folder("screenshots");
            let i = 0;
            let id;
            if (progressCallback) {
                id = setInterval(
                    () => {
                        progressCallback(i + 1, this.steps.length);
                    },
                    1000);
            }
            for (i = 0; i < this.steps.length; ++i) {
                let action = this.steps[i];
                if (action.acceptablePixelDifferences && !action.acceptablePixelDifferences.png) {
                    if (action.acceptablePixelDifferences?.fileName) { // protect against possible bad save
                        await action.acceptablePixelDifferences.hydrate(screenshots);
                    }
                }
                if (action.expectedScreenshot && !action.expectedScreenshot.png) {
                    await action.expectedScreenshot.createPngFromDataUrl();
                }
            }
            if (progressCallback) {
                clearInterval(id);
                progressCallback(this.steps.length, this.steps.length);
            }
            resolve(true);
        });
    }
}

/**
 * An array of file handles to the zipfiles 
 * @type {FileHandle[]}
 */
let fileHandles = [];

/**
 * Let the user pick one or more tests to load.
 * @returns {FileHandle[]} An array of filehandles
 *  
 */
Test.loadFileHandles = async function loadFileHandles() {
    fileHandles = [];
    try {
        fileHandles = await window.showOpenFilePicker({
            suggestedName: `test.zip`,
            types: [
                {
                    description: 'ZIP archive(s) that can be run by Brimstone',
                    accept: {
                        'application/zip': ['.zip'],
                        'application/json': ['.json']
                    }
                }
            ],
            multiple: true
        });
    }
    catch (e) {
        console.error(e);
    }
    return fileHandles;
};

/**
 * A global to pass around easily that contains the current test
 * @type {Test}
 */
Test.current = null;

export class Playlist {
    /** json identifier for this filetype */
    type = 'brimstone playlist';

    /** @type {string} */
    description;

    /** @type {string} */
    author;

    /**
     * @type {FieSystemFileHandle[]}
     */
    play = [];

    /**@type {FileSystemDirectoryHandle} */
    _directoryHandle;

    toJSON() {
        return {
            type: this.type,
            description: this.description,
            author: this.author,
            play: this.play.map(p => ({ name: p.name }))
        };
    }

    /**
     * async constructor
     * @param {FileHandle} fileHandle 
     * @returns this
     */
    async fromFileHandle(fileHandle) {
        let directoryEntries = {};
        for await (let [key, value] of Playlist.directoryHandle.entries()) {
            directoryEntries[key] = value;
        }

        let blob = await fileHandle.getFile();
        blob = await blob.text();
        let pojo = JSON.parse(blob);

        this.description = pojo.description;
        this.author = pojo.author;
        this.play = pojo.play.map(fh => directoryEntries[fh.name]);

        return this;
    }
}

/**
 * @type {FileSystemDirectoryHandle}
 */
Playlist.directoryHandle;