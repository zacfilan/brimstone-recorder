'use strict';

import { TestAction, constants } from "./ui/card.js";
import { Screenshot } from "./ui/screenshot.js";
import { brimstone, progressIndicator } from "./utilities.js";
import * as Errors from "./error.js";
import * as BDS from "./ui/brimstoneDataService.js";
import { clone } from "./utilities.js"
import { infobar } from "./ui/infobar.js";

/**
 * A ziptest instance is a recording of user actions that can be played back
 * and verified.
 */
export class Test {
    get dirty() {
        for (let i = 0; i < this.steps.length; ++i) {
            if (this.steps[i].dirty) {
                return true;
            }
        }
        return false;
    }

    /**
     * reset state
     * @param {Test} test
     */
    _reset() {
        /**
         * Like dirty, but only because the version is older.
         */
        this.oldVersion = false;

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

        /**
         * The last action we *overwrote* during a recording
         * @type {TestAction}
         */
        this.replacedAction = null;

        /** Statistics about the last run of this zipfile test */
        this.lastRun = new BDS.Test();

        /**
         * The server this test starts on. Normall this would come from the first 
         * action. The first action normally is a goto <URL>. But in the case of 
         * a multizip test, later zips might be internal parts of the workflow.
         * in that case we still need to propagate the url into the DB.
         */
        this.startingServer = null;

        /** The PlayTree node for this test.
         * @type {PlayTree}
         */
        this._playTree = new PlayTree();
        this._playTree._zipTest = this;

        /**
         * The version of brimstone that this test format corresponds to.
         * @type {string}
         */
        this.brimstoneVersion = undefined;
    }

    /** 
     * Hydrates the dataurl for expected and acceptable screenshots in all steps in this
     * test, that are not currently hydrated. Dirty steps should always remain hydrated
     * so they should not be overwritten by this.
     * */
    hydrateStepsDataUrls() {
        console.debug('hydrating step dataurls');
        return progressIndicator({
            progressCallback: infobar.setProgress.bind(infobar, 'hydrate', 'hydrated'),
            items: this.steps,
            itemProcessor: async action => {
                if (action.expectedScreenshot && !action.expectedScreenshot.dataUrl) {
                    if (action.expectedScreenshot?.fileName) { // protect against possible bad save
                        await action.expectedScreenshot.loadDataUrlFromZip();
                    }
                }
                if (action.acceptablePixelDifferences && !action.acceptablePixelDifferences.dataUrl) {
                    if (action.acceptablePixelDifferences?.fileName) { // protect against possible bad save
                        await action.acceptablePixelDifferences.loadDataUrlFromZip();
                    }
                }
            }
        });
    }

    /**
     * default constructor
     */
    constructor() {
        this._reset();
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

        // pollscreen actions only update the UI they don't actually get recorded
        if (action.type !== 'pollscreen') {
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
    async deleteAction(action) {
        await this.hydrateStepsDataUrls(); // this is required to save correctly now
        let removeIndex = action.index;
        for (let i = action.index + 1; i < this.steps.length; ++i) {
            let action = this.steps[i];
            action.setIndex(i - 1);
            action.dirty = true;
        }
        this.steps.splice(removeIndex, 1);
    }

    /**
     * Delete all the actions before the passed in one.
     * The passed in one becomes index .
     * @param {TestAction} action 
     */
    async deleteActionsBefore(action) {
        await this.hydrateStepsDataUrls(); // this is required to save correctly now
        this.steps.splice(0, action.index);
        this.reindex();
    }

    reindex() {
        for (let i = 0; i < this.steps.length; ++i) {
            let action = this.steps[i];
            let oldIndex = action.index;
            action.setIndex(i);
            if (oldIndex !== i) {
                action.dirty = true;
            }
        }
    }
    /**
     * Delete all the actions after the passed in one.
     * The passed in one becomes one before the last.
     * Update the last to just contain the expected screenshot.
     * @param {TestAction} action 
     */
    async deleteActionsAfter(action) {
        await this.hydrateStepsDataUrls(); // this is required to save correctly now
        this.steps.splice(action.index + 2);
        this.reindex();

    }

    /**
     *  insert (splice in) the action at the index specified in the action
     *  @param {TestAction} newAction The action to insert
     */
    async insertAction(newAction) {
        await this.hydrateStepsDataUrls(); // this is required to save correctly now
        newAction.test = this;
        newAction.tab = clone(this.steps[newAction.index].tab);
        this.steps.splice(newAction.index, 0, newAction);
        this.reindex();
    }

    toJSON() {
        return {
            steps: this.steps,
            brimstoneVersion: BDS.extensionInfo.version,
            hideCursor: this.hideCursor,
            incognito: this.incognito
        };
    }

    /**
     * create a zipfile.
     */
    async createZip() {
        console.debug('create zip');
        const blobWriter = new zip.BlobWriter("application/zip");
        const writer = new zip.ZipWriter(blobWriter);
        await writer.add('test.json', new zip.TextReader(
            JSON.stringify(
                this,
                null,
                2
            ))); // add the test.json file to archive
        await writer.add('screenshots', null, { directory: true }); // directory

        await this.hydrateStepsDataUrls();

        // write the dataUrl for expected and acceptable screenshots in all steps of this test into the zip.
        await progressIndicator({
            progressCallback: infobar.setProgress.bind(infobar, 'write zip step', 'wrote zip steps'),
            items: this.steps,
            itemProcessor: async card => {
                if (card.expectedScreenshot?.dataUrl) {
                    await writer.add(`screenshots/${card.expectedScreenshot.fileName}`, new zip.Data64URIReader(card.expectedScreenshot.dataUrl));
                }
                if (card.acceptablePixelDifferences?.dataUrl) {
                    await writer.add(`screenshots/${card.acceptablePixelDifferences.fileName}`, new zip.Data64URIReader(card.acceptablePixelDifferences.dataUrl));
                }
            }
        });
        await writer.close();
        return blobWriter.getData();
    }

    /**
     * save the current state to a zip file 
     */
    async saveFile() {
        let handle;
        try {
            // FIXME: this will NOT work if you insert or delete items !!
            let blob = await this.createZip();
            console.debug('save zip to disk'); 

            // the moment I invoke showSaveFilePicker the file is truncated, which means I cannot overlap the createZip operation
            // with picking the save file which is a nice time saver for te user
            handle = await window.showSaveFilePicker({
                suggestedName: this.filename,
                types: [
                    {
                        description: 'A ZIP archive that can be run by Brimstone',
                        accept: { 'application/zip': ['.zip'] }
                    }
                ]
            });

            // get the zip file as a Blob, if the promise rejects the wait throws the rejected value.
            const writable = await handle.createWritable();
            infobar.setText(`saving ${handle.name} <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="save"
            class="svg-inline--fa fa-save fa-w-14" role="img" xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512">
            <path fill="currentColor"
              d="M433.941 129.941l-83.882-83.882A48 48 0 0 0 316.118 32H48C21.49 32 0 53.49 0 80v352c0 26.51 21.49 48 48 48h352c26.51 0 48-21.49 48-48V163.882a48 48 0 0 0-14.059-33.941zM224 416c-35.346 0-64-28.654-64-64 0-35.346 28.654-64 64-64s64 28.654 64 64c0 35.346-28.654 64-64 64zm96-304.52V212c0 6.627-5.373 12-12 12H76c-6.627 0-12-5.373-12-12V108c0-6.627 5.373-12 12-12h228.52c3.183 0 6.235 1.264 8.485 3.515l3.48 3.48A11.996 11.996 0 0 1 320 111.48z">
            </path>
          </svg>`);
            await writable.write(blob);  // Write the contents of the file to the stream.    
            await writable.close(); // Close the file and write the contents to disk.
            this.filename = handle.name;
            for (let i = 0; i < this.steps.length; ++i) {
                this.steps[i].dirty = false;
            }
            infobar.setText(`saved ${handle.name}`);
            return handle;
        }
        catch (e) {
            if (e instanceof DOMException && e.message === 'The user aborted a request.') {
                return; // fine
            }
            throw new Errors.TestSaveError(e.stack);
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
        this._reset();

        const blob = await fileHandle.getFile();
        let blobReader = new zip.BlobReader(blob); // construct a blob reader
        let zipReader = new zip.ZipReader(blobReader); // construct a zip reader
        let entries = await zipReader.getEntries(); // get the entries

        let testJsonEntry = entries.find(e => e.filename === 'test.json');
        let testJson = await testJsonEntry.getData(new zip.TextWriter()); // The type of Writer determines the return type.

        let testPojo = JSON.parse(testJson);
        let actions = testPojo.steps;

        // convert older tests
        if (testPojo.meta) {
            Object.assign(testPojo, testPojo.meta);
            delete testPojo.meta;
        }

        this.hideCursor = testPojo.hideCursor;
        this.incognito = testPojo.incognito;
        this.filename = fileHandle.name;
        this.brimstoneVersion = testPojo.brimstoneVersion;
        if (this.brimstoneVersion === undefined) {
            this.brimstoneVersion = 'v1.0.0';
        }

        if (this.brimstoneVersion > BDS.extensionInfo.version) {
            let tryAnyway = await brimstone.window.confirm(`You are trying to load test '${this.filename}' which was saved with version ${this.brimstoneVersion}. This test might misbehave unless you use extension version '${this.brimstoneVersion}' or better, but that's up to you.
            
Continue to load this test with (your possibly) incompatible version of Brimstone?`);
            if (!tryAnyway) {
                return false; // bail
            }
        }

        let screenshotPromises = [];
        for (let i = 0; i < actions.length; ++i) {
            let _action = actions[i];
            if (this.brimstoneVersion < BDS.extensionInfo.version) {
                this.oldVersion = true;
                // convert old tests
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
                if ('v1.18.0' <= BDS.extensionInfo.version) {
                    if (_action.type === 'wait' && _action?.event?.milliseconds === undefined) {
                        _action.type = 'pollscreen';
                    }
                }
            }

            let action = new TestAction(_action);
            this.updateOrAppendAction(action);

            if (action.expectedScreenshot?.fileName) {
                console.debug(`attach expected zipEntry for step ${i}`);
                action.expectedScreenshot = new Screenshot(action.expectedScreenshot);
                action.expectedScreenshot.zipEntry = entries.find(e => e.filename === `screenshots/${action.expectedScreenshot.fileName}`);
                action._view = constants.view.EXPECTED;
                if (!action.expectedScreenshot.zipEntry) {
                    throw new Error("can't find entry")
                }
            }
            else {
                action.expectedScreenshot = undefined; // whack any bad data
            }

            // create the container for the other screenshots to be hydrated, 
            // thus, if these props exist on the action, they def have a fileName
            // but may not be hydrated. if they don't exist, they weren't in the zip.
            // These can be hydrated later 
            if (action.acceptablePixelDifferences?.fileName) {
                console.debug(`attach acceptable zipEntry for step ${i}`);
                action._match = constants.match.ALLOW;
                action.acceptablePixelDifferences = new Screenshot(action.acceptablePixelDifferences);
                action.acceptablePixelDifferences.zipEntry = entries.find(e => e.filename === `screenshots/${action.acceptablePixelDifferences.fileName}`);
                if (!action.acceptablePixelDifferences.zipEntry) {
                    throw new Error("can't find entry")
                }

            }
            else {
                action.acceptablePixelDifferences = undefined; // whack any bad data
            }

            if (action.actualScreenshot?.fileName) {
                action._match = constants.match.FAIL; // if it failed, do I really care to know there are allowed differences too?
                // if you have an actual one to load it means that the last time this was run it failed. 
                // I only store these in old tests. Newer tests will not store these.
                action.actualScreenshot = new Screenshot(action.actualScreenshot);
                action.actualScreenshot.zipEntry = entries.find(e => e.filename === `screenshots/${action.actualScreenshot.fileName}`);
                if (!action.actualScreenshot.zipEntry) {
                    action.actualScreenshot = undefined; // whack any bad data
                }
            }
            else {
                action.actualScreenshot = undefined; // whack any bad data
            }

        }

        return this;
    }

    /**
     * A hack to reduce the memory footprint.
     * A better approach is to refactor the PlayTree, Test, TestAction, BDS.Test BDS.step classes.
     */
    removeScreenshots() {
        delete this.steps;
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
        for (let node = this; node?._fileHandle?.name || node?._zipTest?.filename; node = node._parent) {
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
                if (report.failingStep) {
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
