import { TestAction, constants } from "./ui/card.js";
import { Screenshot } from "./ui/screenshot.js";
import { brimstone } from "./utilities.js";
import * as Errors from "./error.js";
import * as BDS from "./ui/brimstoneDataService.js";
import {clone} from "./utilities.js"

/**
 * A ziptest instance is a recording of user actions that can be played back
 * and verified.
 */
export class Test {
    /**
     * reset state
     * @param {Test} test
     */
    reset() {
        /**
         * If the current test has been edited so that the user can be given a 
         * chance to record before leaving the test.
         */
        this.dirty = false;

        /**
         * These are the individual actions of the test.
         * @type {TestAction[]}
         */
        this.steps = [];

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

        /**
         * The last action we *overwrote* during a recording
         * @type {TestAction}
         */
        this.replacedAction = null;

        /** The PlayTree node for this test.
         * @type {PlayTree}
         */
        this._playTree = null;

        /** Statistics about the last run of this zipfile test */
        this.lastRun = new BDS.Test();

        /**
         * The server this test starts on. Normall this would come from the first 
         * action. The first action normally is a goto <URL>. But in the case of 
         * a multizip test, later zips might be internal parts of the workflow.
         * in that case we still need to propagate the url into the DB.
         */
        this.startingServer = null;
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
        this._playTree = new PlayTree();
        this._playTree._zipTest = this;
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
        if (action.type !== 'wait') {
            this.recordIndex = action.index + 1;
        }

        if (this.steps[action.index]) {
            // we are replacing a step, hang onto the original one.
            this.replacedAction = this.steps[action.index];
        }
        this.steps[action.index] = action;

        action.test = this; // each action knows what test it is in
    }

    /** 
     * Delete the specified action from the test. This changes the indexes of all subsequent actions, but that isn't
     * persisted until a save. 
     * @param {TestAction} action */
    deleteAction(action) {
        this.dirty = true;
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
        this.dirty = true;
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
        this.dirty = true;
        this.steps.splice(action.index + 2);
        this.reindex();

    }

    /**
     *  insert the action at the index specified in the action
     *  @param {TestAction} newAction The action to insert
     */
    insertAction(newAction) {
        newAction.test = this;
        newAction.tab = clone(this.steps[newAction.index].tab);
        this.dirty = true;
        this.steps.splice(newAction.index, 0, newAction);
        this.reindex();
    }

    toJSON() {
        return {
            steps: this.steps,
            brimstoneVersion: BDS.brimstoneVersion,
            hideCursor: this.hideCursor,
            incognito: this.incognito
        };
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
                suggestedName: this.filename,
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
            this.dirty = false;
            return handle;
        }
        catch (e) {
            if (e instanceof DOMException && e.message === 'The user aborted a request.') {
                return; // fine
            }
            throw e;
        }
    }

    /**
     * async constructor from a zip filehandle in playtree.
     * loads all the expected screenshots into data urls as fast as possible from the zip.
     * @param {PlayTree} playTree 
     * @returns 
     */
    async fromPlayTree(playTree) {
        await this.fromFileHandle(playTree._fileHandle);
        this._playTree = playTree;
        this._playTree._zipTest = this;
        return this;
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
            let _action = actions[i];
            if (_action.type === 'start') {
                _action.type = 'goto';
            }
            if (_action.sender) {
                _action.tab = _action.sender;
            }
            else if (!_action.tab) {
                _action.tab = {};
            }
            if (_action.tabWidth) {
                _action.tab.width = _action.tabWidth;
                _action.tab.height = _action.tabHeight;
                delete _action.tabWidth;
                delete _action.tabHeight;
            }
            if (_action.tab.virtualId === undefined) {
                _action.tab.virtualId = 0;
            }

            let action = new TestAction(_action);
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
        if (e instanceof DOMException && e.message === 'The user aborted a request.') {
            return; // fine
        }
        throw e;
    }
    return fileHandles;
};

/**
 * A global to pass around easily that contains the current test
 * @type {Test}
 */
Test.current = null;

export class PlayTree {
    /** json identifier for this filetype */
    type = 'brimstone playtree';

    /** @type {string} */
    description;

    /** @type {string} */
    author;

    /** is this playtree to be considered one big flat test, or as a (linear vis DFT) suite of tests? 
     * If true, each item is a test, else we conceptually flatten the list of items into one big test.
    */
    suite = true;

    /**
     * Defined only for non-leaf nodes.
     * @type {PlayTree[]}
     */
    children;

    /** 
     * The filehandle of this node (zip or playlist file).
     * @type {FileHandle}*/
    _fileHandle;

    /**
     * If this node is for a ziptest the test will be stored in here.
     * @type {Test}
     * */
    _zipTest;

    /** @type {PlayTree} */
    _parent;

    constructor(args) {
        this._parent = args?.parent;
    }

    /** 
     * A set of run reports for this node.
     * If this node is is zipnode, or a flat (suite:false) playlist
     * then there will only be one entry. If this node
     * is a suite (suite:true) then there will be one or more entries.
     * @type {BDS.Test[]} 
     * */
    reports;

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
     * @param {FileHandle[]} fileHandles 
     * @returns this
     */
    async fromFileHandles(...fileHandles) {
        if (fileHandles.length > 1) {
            this.children = [];
            // we want to create this node with many filehandles, so it has children
            for (let i = 0; i < fileHandles.length; ++i) {
                let fileHandle = fileHandles[i];
                let child = await (new PlayTree({ parent: this }).fromFileHandles(fileHandle));
                this.children.push(child);
            }
        }
        else {
            // we want to create a node from one file handle
            this._fileHandle = fileHandles[0];
            if (this._fileHandle.name.endsWith('.json')) {
                // the filehandle is to a json file. so we we need to get it's file handles and recurse back to previous case.
                if (!PlayTree.directoryHandle) {
                    await brimstone.window.alert('You must specify a (base) directory that will contain all your tests before you can use playlists.');
                    if (!await PlayTree.loadLibrary()) {
                        throw new Errors.TestLoadError("Base test directory access must be specified in order to load playlists.", this._fileHandle.name);
                    }
                }

                let blob = await this._fileHandle.getFile();
                blob = await blob.text();
                let pojo;
                try {
                    pojo = JSON.parse(blob);
                }
                catch (e) {
                    if (e instanceof SyntaxError) {
                        throw new Errors.TestLoadError(`Syntax error: ${e.message}`, this._fileHandle.name);
                    }
                }

                this.description = pojo.description;
                this.author = pojo.author;
                this.suite = pojo.suite === undefined ? true : pojo.suite;

                /* build a map from filename to filehandle */
                let directoryEntries = {};
                for await (let [key, value] of PlayTree.directoryHandle.entries()) {
                    directoryEntries[key] = value;
                }
                // get the filehandles for this playlist
                let fileHandles = pojo.play.map(playNode => directoryEntries[playNode.name] ?? (() => { throw new Errors.TestLoadError(`playlist item file '${playNode.name}' not found`, this._fileHandle.name) })());
                // recurse
                await this.fromFileHandles(...fileHandles);
            }
            else {
                // it's a zip, which terminates recursion
            }
        }

        return this;
    }

    /** Give us the depth first traversal of the tree leaf nodes.
     * i.e. the linear sequence of zip files to play.
     */
    depthFirstTraversal(array) {
        if (!this.children) {
            array.push(this);
        }
        this.children?.forEach(child => child.depthFirstTraversal(array));
    }

    /** return the path to the parent */
    path() {
        let p = "";
        for (let node = this; node?._fileHandle?.name || node?._zipTest?.filename ; node = node._parent) {
            let old = p;
            p = node?._fileHandle?.name || node?._zipTest?.filename;
            if (old) {
                p += '/' + old;
            }
        }
        return p;
    }

    /**
     * Build the report(s) for this node.
     * @returns {BDS.Test[]} A set of run reports for this node.
     * If this node is is zipnode, or a flat (suite:false) playlist
     * then there will only be one entry. If this node
     * is a suite (suite:true) then there will be one or more entries.
    */
    buildReports() {
        this.reports = [];
        let reports = this.reports; // shorter alias

        // if I am a ziptest node return me
        if (this._zipTest) {
            this._zipTest.lastRun.path = this.path();
            return this.reports = [this._zipTest.lastRun];
        }
        if (!this.children && this._fileHandle.name.endsWith(".zip")) {
            // we haven't loaded this zipfile into a zipTest yet, meaning
            // we have not run it.
            return this.reports = [new BDS.Test()]; // returns status "not run"
        }
        // you should either be a _zipTest or have children but not both.

        for (let i = 0; i < this.children.length; ++i) {
            let child = this.children[i];
            /** @type {BDS.Test[]} */
            let childReports;
            childReports = child.buildReports();

            // playing this child has returned either [report], or [report1, report2, ...],
            // either way keep on appending them into a flat array.
            reports.push(...childReports);
        }
        // now all children are processed

        if (!this.suite) {
            // i need to return a single report, i.e. [report]
            let flatReport = new BDS.Test();
            flatReport.startDate = reports[0].startDate;
            flatReport.wallTime = 0;
            flatReport.userTime = 0;
            flatReport.name = this._fileHandle.name;
            flatReport.startingServer = reports[0].startingServer;
            flatReport.chromeVersion = BDS.chromeVersion;
            flatReport.brimstoneVersion = BDS.brimstoneVersion;

            var baseIndex = 0;
            for (let i = 0; i < reports.length; ++i) {
                let report = reports[i];
                flatReport.status = report.status === 'allow' ? 'pass' : report.status; // an allow is a pass
                flatReport.userTime += report.userTime;
                flatReport.wallTime += report.wallTime;
                flatReport.endDate = report.endDate;
                flatReport.errorMessage = report.errorMessage;
                let lastStep = report.failingStep || report.steps.length;
                for (let j = 0; j < lastStep; ++j) {
                    let step = clone(report.steps[j]);
                    step.baseIndex = baseIndex;
                    step.index += baseIndex;
                    step.path = report.path;
                    flatReport.steps.push(step);
                }
                if(report.failingStep) {
                    flatReport.errorMessage = report.errorMessage;
                    break;
                }
                baseIndex += report.steps.length;
            }

            this.reports = [flatReport];
        }
        // else it's a suite so we process all the child results as individual tests

        return this.reports;
    }
}

/**
 * @type {FileSystemDirectoryHandle}
 */
PlayTree.directoryHandle;

/** 
 * The complete playtree, i.e the root node;
 * @type {PlayTree}
 */
PlayTree.complete;

PlayTree.loadLibrary = async function loadLibrary() {
    try {
        PlayTree.directoryHandle = await window.showDirectoryPicker();
        return true;
    }
    catch (e) {
        return false;
    }
}
