'use strict';

import { Screenshot } from './ui/screenshot.js';
import { brimstone, progressIndicator } from './utilities.js';
import * as Errors from './error.js';
import * as BDS from './ui/brimstoneDataService.js';
import { clone, getComparableVersion } from './utilities.js';
import { infobar } from './ui/infobar/infobar.js';
import { Tab } from './tab.js';
import { uuidv4, pngDiff } from './utilities.js';
import { options } from './options.js';
import {
  Correction,
  BoundingBox,
  UnpredictableCorrection,
  ActualCorrection,
  AntiAliasCorrection,
} from './rectangle.js';

const arrowsSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Pro 6.1.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2022 Fonticons, Inc. --><path d="M32 176h370.8l-57.38 57.38c-12.5 12.5-12.5 32.75 0 45.25C351.6 284.9 359.8 288 368 288s16.38-3.125 22.62-9.375l112-112c12.5-12.5 12.5-32.75 0-45.25l-112-112c-12.5-12.5-32.75-12.5-45.25 0s-12.5 32.75 0 45.25L402.8 112H32c-17.69 0-32 14.31-32 32S14.31 176 32 176zM480 336H109.3l57.38-57.38c12.5-12.5 12.5-32.75 0-45.25s-32.75-12.5-45.25 0l-112 112c-12.5 12.5-12.5 32.75 0 45.25l112 112C127.6 508.9 135.8 512 144 512s16.38-3.125 22.62-9.375c12.5-12.5 12.5-32.75 0-45.25L109.3 400H480c17.69 0 32-14.31 32-32S497.7 336 480 336z"/></svg>';
const pencilSvg =
  '<svg aria-hidden="true" focusable="false" data-prefix="far" data-icon="pencil-alt" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="svg-inline--fa fa-pencil-alt fa-w-16 fa-9x"> <path fill="currentColor" d="M491.609 73.625l-53.861-53.839c-26.378-26.379-69.075-26.383-95.46-.001L24.91 335.089.329 484.085c-2.675 16.215 11.368 30.261 27.587 27.587l148.995-24.582 315.326-317.378c26.33-26.331 26.581-68.879-.628-96.087zM200.443 311.557C204.739 315.853 210.37 318 216 318s11.261-2.147 15.557-6.443l119.029-119.03 28.569 28.569L210 391.355V350h-48v-48h-41.356l170.259-169.155 28.569 28.569-119.03 119.029c-8.589 8.592-8.589 22.522.001 31.114zM82.132 458.132l-28.263-28.263 12.14-73.587L84.409 338H126v48h48v41.59l-18.282 18.401-73.586 12.141zm378.985-319.533l-.051.051-.051.051-48.03 48.344-88.03-88.03 48.344-48.03.05-.05.05-.05c9.147-9.146 23.978-9.259 33.236-.001l53.854 53.854c9.878 9.877 9.939 24.549.628 33.861z" class=""></path></svg>';
const leftArrow =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Pro 6.1.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2022 Fonticons, Inc. --><path d="M224 480c-8.188 0-16.38-3.125-22.62-9.375l-192-192c-12.5-12.5-12.5-32.75 0-45.25l192-192c12.5-12.5 32.75-12.5 45.25 0s12.5 32.75 0 45.25L77.25 256l169.4 169.4c12.5 12.5 12.5 32.75 0 45.25C240.4 476.9 232.2 480 224 480z"/></svg>';

const noImageAvailableDataUrl =
  'data:image/png;base64,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';

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
     * This is the default index of the next recorded action.
     * If the action comes in with an index already that is used.
     */
    this.recordIndex = 0;

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
      progressCallback: infobar.setProgress.bind(
        infobar,
        'hydrate',
        'hydrated'
      ),
      items: this.steps,
      itemProcessor: async (action) => {
        if (action.expectedScreenshot && !action.expectedScreenshot.dataUrl) {
          if (action.expectedScreenshot?.fileName) {
            // protect against possible bad save
            await action.expectedScreenshot.loadDataUrlFromZip();
          }
        }
        if (
          action.acceptablePixelDifferences &&
          !action.acceptablePixelDifferences.dataUrl
        ) {
          if (action.acceptablePixelDifferences?.fileName) {
            // protect against possible bad save
            await action.acceptablePixelDifferences.loadDataUrlFromZip();
          }
        }
      },
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
    if (action.index === undefined) {
      // when recording actions they (may!) come in without an index, so use the running one.
      action.setIndex(this.recordIndex);
    }

    // pollscreen actions only update the UI they don't actually get recorded
    if (action.type !== 'pollscreen') {
      this.recordIndex = action.index + 1;
    }

    this.steps[action.index] = action;
    action.test = this; // each action knows what test it is in
  }

  /**
   * Delete the specified action from the test. This changes the indexes of all subsequent actions, but that isn't
   * persisted until a save.
   * @param {TestAction} action */
  async deleteAction(action) {
    let abort = false;
    if (options.confirmToDelete) {
      abort = !(await brimstone.window.confirm(
        'This will delete the current action from memory, not from disk. There is no undo (yet).\n\nContinue?'
      ));
    }
    if (abort) {
      return false;
    }

    await this.hydrateStepsDataUrls(); // this is required to save correctly now
    let removeIndex = action.index;
    for (let i = action.index + 1; i < this.steps.length; ++i) {
      let action = this.steps[i];
      action.setIndex(i - 1);
      action.dirty = true;
    }
    this.steps.splice(removeIndex, 1);
    return true;
  }

  /**
   * Delete all the actions before the passed in one.
   * The passed in one becomes index .
   * @param {TestAction} action
   */
  async deleteActionsBefore(action) {
    let abort = false;
    if (options.confirmToDelete) {
      abort = !(await brimstone.window.confirm(
        'This will delete all actions before the current one from memory, not from disk. There is no undo (yet).\n\nContinue?'
      ));
    }
    if (abort) {
      return false;
    }
    await this.hydrateStepsDataUrls(); // this is required to save correctly now
    this.steps.splice(0, action.index);
    this.reindex({ changedAsDirty: false });
    return true;
  }

  /**
   * Put the real index of the action within the
   * steps property into the action index property.
   *
   * Will mark actions that are updated as dirty.
   */
  reindex({ changedAsDirty = true } = {}) {
    for (let i = 0; i < this.steps.length; ++i) {
      let action = this.steps[i];
      let oldIndex = action.index;
      action.setIndex(i);
      if (changedAsDirty && oldIndex !== i) {
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
    let abort = false;
    if (options.confirmToDelete) {
      abort = !(await brimstone.window.confirm(
        'This will delete all actions after the current one from memory, not from disk. There is no undo (yet).\n\nContinue?'
      ));
    }
    if (abort) {
      return false;
    }
    await this.hydrateStepsDataUrls(); // this is required to save correctly now
    this.steps.splice(action.index + 2);
    this.reindex();
    return true;
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

  /**
   * Insert the given actions into this test
   * at the given index.
   *
   * @param {number} index the index to insert the actions
   * @param {TestAction[]} actions the actions to insert
   */
  insertActions(index, actions) {
    this.steps.splice(index, 0, ...actions);
    for (let i = 0; i < actions.length; ++i) {
      actions[i].inserted = true;
      actions[i].test = this;
    }
    this.reindex({ changedAsDirty: false });
  }

  toJSON() {
    return {
      steps: this.steps,
      brimstoneVersion: BDS.extensionInfo.version,
      hideCursor: this.hideCursor,
      incognito: this.incognito,
    };
  }

  /**
   * create a blob in memory that
   * can be wrtten to disk as the zipfile.
   * @returns {Blob}
   */
  async createZipBlob() {
    console.debug('create zip');
    const blobWriter = new zip.BlobWriter('application/zip');
    const writer = new zip.ZipWriter(blobWriter);
    await writer.add(
      'test.json',
      new zip.TextReader(JSON.stringify(this, null, 2))
    ); // add the test.json file to archive
    await writer.add('screenshots', null, { directory: true }); // directory

    await this.hydrateStepsDataUrls();

    // write the dataUrl for expected and acceptable screenshots in all steps of this test into the zip.
    await progressIndicator({
      progressCallback: infobar.setProgress.bind(
        infobar,
        'build save data',
        'built'
      ),
      items: this.steps,
      itemProcessor: async (card) => {
        if (card.expectedScreenshot?.dataUrl) {
          await writer.add(
            `screenshots/${card.expectedScreenshot.fileName}`,
            new zip.Data64URIReader(card.expectedScreenshot.dataUrl)
          );
        }
        if (card.acceptablePixelDifferences?.dataUrl) {
          await writer.add(
            `screenshots/${card.acceptablePixelDifferences.fileName}`,
            new zip.Data64URIReader(card.acceptablePixelDifferences.dataUrl)
          );
        }
      },
    });
    await writer.close();
    return blobWriter.getData();
  }

  /**
   * Pop the showSaveFilePicker dialog to the user. If the user picks
   * a handle, write the passed in blob to the handle. The moment
   * that the showSaveFilePicker dialog picks a handle that file
   * is **truncated**. This is why the blob must be precalculated,
   * we don't want the user to be able to lose data.
   * @param {Blob} the blob of the file to write to the zip
   */
  async saveZipFile(blob) {
    if (!blob) {
      throw new Errors.TestSaveError('no blob was provided to saveZipFile');
    }

    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: this.filename,
        types: [
          {
            description: 'A ZIP archive that can be run by Brimstone',
            accept: { 'application/zip': ['.zip'] },
          },
        ],
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
      await writable.write(blob); // Write the contents of the file to the stream.
      await writable.close(); // Close the file and write the contents to disk.
      this.filename = handle.name;
      for (let i = 0; i < this.steps.length; ++i) {
        this.steps[i].dirty = false;
        this.steps[i].inserted = false;
      }
      infobar.setText(`saved ${handle.name}`);
      return handle;
    } catch (e) {
      if (
        e instanceof DOMException &&
        e.message === 'The user aborted a request.'
      ) {
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

    let testJsonEntry = entries.find((e) => e.filename === 'test.json');
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

    if (options.warnOnVersionMismatch) {
      let extensionVersion = getComparableVersion(BDS.extensionInfo.version);
      let testVersion = getComparableVersion(this.brimstoneVersion);
      if (testVersion > extensionVersion) {
        let tryAnyway = await brimstone.window
          .confirm(`You are trying to load test '${this.filename}' which was saved with a newer version of Brimstone than you are currently using. This test might misbehave, but probably not. Your call.
            
Continue to load this test with (your possibly) incompatible version of Brimstone?`);
        if (!tryAnyway) {
          throw new Errors.InvalidVersion();
        }
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
        } else if (!_action.tab) {
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
          if (
            _action.type === 'wait' &&
            _action?.event?.milliseconds === undefined
          ) {
            _action.type = 'pollscreen';
          }
        }
      }

      let action = new TestAction(_action);
      this.updateOrAppendAction(action);

      if (action.expectedScreenshot?.fileName) {
        console.debug(`attach expected zipEntry for step ${i}`);
        action.expectedScreenshot = new Screenshot(action.expectedScreenshot);
        action.expectedScreenshot.zipEntry = entries.find(
          (e) =>
            e.filename === `screenshots/${action.expectedScreenshot.fileName}`
        );
        action._view = constants.view.EXPECTED;
        if (!action.expectedScreenshot.zipEntry) {
          throw new Error("can't find entry");
        }
      } else {
        action.expectedScreenshot = undefined; // whack any bad data
      }

      // create the container for the other screenshots to be hydrated,
      // thus, if these props exist on the action, they def have a fileName
      // but may not be hydrated. if they don't exist, they weren't in the zip.
      // These can be hydrated later
      if (action.acceptablePixelDifferences?.fileName) {
        console.debug(`attach acceptable zipEntry for step ${i}`);
        action._match = constants.match.ALLOW;
        action.acceptablePixelDifferences = new Screenshot(
          action.acceptablePixelDifferences
        );
        action.acceptablePixelDifferences.zipEntry = entries.find(
          (e) =>
            e.filename ===
            `screenshots/${action.acceptablePixelDifferences.fileName}`
        );
        if (!action.acceptablePixelDifferences.zipEntry) {
          throw new Error("can't find entry");
        }
      } else {
        action.acceptablePixelDifferences = undefined; // whack any bad data
      }

      if (action.actualScreenshot?.fileName) {
        action._match = constants.match.FAIL; // if it failed, do I really care to know there are allowed differences too?
        // if you have an actual one to load it means that the last time this was run it failed.
        // I only store these in old tests. Newer tests will not store these.
        action.actualScreenshot = new Screenshot(action.actualScreenshot);
        action.actualScreenshot.zipEntry = entries.find(
          (e) =>
            e.filename === `screenshots/${action.actualScreenshot.fileName}`
        );
        if (!action.actualScreenshot.zipEntry) {
          action.actualScreenshot = undefined; // whack any bad data
        }
      } else {
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
            'application/json': ['.json'],
          },
        },
      ],
      multiple: true,
    });
  } catch (e) {
    if (
      e instanceof DOMException &&
      e.message === 'The user aborted a request.'
    ) {
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

/**
 * A precalculated blob of the zipfile to save.
 * @type {Blob}
 */
Test._saveBlob;

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

  /**
   * If this node is for a ziptest the number of steps in this
   * zip test will be stored in here. Used for ETA.
   * @type {number}
   * */
  _stepsInZipTest;

  /**
   * If this node is for a ziptest then this is the base index of
   * this zipnodes steps in the context of the larger set.
   * @type {number}
   */
  _stepBaseIndex;

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
      play: this.play.map((p) => ({ name: p.name })),
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
        let child = await new PlayTree({ parent: this }).fromFileHandles(
          fileHandle
        );
        this.children.push(child);
      }
    } else {
      // we want to create a node from one file handle
      this._fileHandle = fileHandles[0];
      if (this._fileHandle.name.endsWith('.json')) {
        // the filehandle is to a json file. so we we need to get it's file handles and recurse back to previous case.
        if (!PlayTree.directoryHandle) {
          await brimstone.window.alert(
            'You must specify a (base) directory that will contain all your tests before you can use playlists.'
          );
          if (!(await PlayTree.loadLibrary())) {
            throw new Errors.TestLoadError(
              'Base test directory access must be specified in order to load playlists.',
              this._fileHandle.name
            );
          }
        }

        let blob = await this._fileHandle.getFile();
        blob = await blob.text();
        let pojo;
        try {
          pojo = JSON.parse(blob);
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Errors.TestLoadError(
              `Syntax error: ${e.stack}`,
              this._fileHandle.name
            );
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
        let fileHandles = pojo.play.map(
          (playNode) =>
            directoryEntries[playNode.name] ??
            (() => {
              throw new Errors.TestLoadError(
                `playlist item file '${playNode.name}' not found`,
                this._fileHandle.name
              );
            })()
        );
        // recurse
        await this.fromFileHandles(...fileHandles);
      } else {
        // it's a zip, which terminates recursion
        // get the nmber of steps in the zip so we can
        // let the user know how long playing takes etc.
        const blob = await this._fileHandle.getFile();
        let blobReader = new zip.BlobReader(blob); // construct a blob reader
        let zipReader = new zip.ZipReader(blobReader); // construct a zip reader
        let entries = await zipReader.getEntries(); // get the entries

        let testJsonEntry = entries.find((e) => e.filename === 'test.json');
        let testJson = await testJsonEntry.getData(new zip.TextWriter()); // The type of Writer determines the return type.

        let testPojo = JSON.parse(testJson);
        this._stepsInZipTest = testPojo.steps.length;
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
    this.children?.forEach((child) => child.depthFirstTraversal(array));
  }

  /** return the path to the parent */
  path() {
    let p = '';
    for (
      let node = this;
      node?._fileHandle?.name || node?._zipTest?.filename;
      node = node._parent
    ) {
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
      return (this.reports = [this._zipTest.lastRun]);
    }
    if (!this.children && this._fileHandle.name.endsWith('.zip')) {
      // we haven't loaded this zipfile into a zipTest yet, meaning
      // we have not run it.
      return (this.reports = [new BDS.Test()]); // returns status "not run"
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
  } catch (e) {
    return false;
  }
};

/** The aggregate number of steps over all zipnodes loaded. */
PlayTree.stepsInZipNodes = 0;

const PNG = png.PNG;

export const constants = {
  /** properties of the instance. it can have more than one set, these are converted to classes.*/
  view: {
    /** 2nd card - result doesn't match. (here is what we expected) */
    EXPECTED: 'expected',

    /** 2nd card during recording - screenshot is constantly being refreshed */
    DYNAMIC: 'dynamic',

    /** 2nd card - it doesn't match. (here is what we got) */
    ACTUAL: 'actual',

    /** 2nd card - it doesn't match. (let's make it okay to have some differences between expected and actual) */
    EDIT: 'edit',

    /** 1st card - just show the action */
    ACTION: 'action',
  },

  /** the status of a testrun/step */
  match: {
    /** the last time this action ws played it passed */
    PASS: 'pass',
    /** this action is currently being played */
    PLAY: 'play',
    /** the last time this action was played it passed with allowed pixel differences */
    ALLOW: 'allow',
    /** the last time this action was played it mismatched screenshots */
    FAIL: 'fail',
    /** the last time this action was played it was canceled by the user before */
    CANCEL: 'cancel',
    /** this action has not been played yet */
    NOTRUN: 'notrun',
    /** play stopped just prior to this action actully playing because of a breakpoint */
    BREAKPOINT: 'breakpoint',
  },
};

const pointer = `
<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="arrow-pointer"
  class="svg-inline--fa fa-arrow-pointer" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512">
  <path fill="currentColor"
    d="M318.4 304.5c-3.531 9.344-12.47 15.52-22.45 15.52h-105l45.15 94.82c9.496 19.94 1.031 43.8-18.91 53.31c-19.95 9.504-43.82 1.035-53.32-18.91L117.3 351.3l-75 88.25c-4.641 5.469-11.37 8.453-18.28 8.453c-2.781 0-5.578-.4844-8.281-1.469C6.281 443.1 0 434.1 0 423.1V56.02c0-9.438 5.531-18.03 14.12-21.91C22.75 30.26 32.83 31.77 39.87 37.99l271.1 240C319.4 284.6 321.1 295.1 318.4 304.5z">
  </path>
</svg>`;

export class TestAction {
  /**
   * a string that identifies the action type.
   * FIXME: i think it would make sense to refactor these as a subclass of
   * TestAction?
   * @type {string}
   */
  type;

  /**
   * @type {object}
   * @property {number} frameId frame in the tab that generated this action */
  sender;

  /**
   * @type {Tab} info about the tab this action was recorded on.
   */
  tab = null;

  /**
   * object that describes the boundingClientRect in percentages
   * so that it can render when the UI is resized.
   */
  overlay;

  /** how long the mouse hovered over this element before it was clicked.
   * helps replay wait long enough to trigger (custom) tooltips.
   */
  hoverTime;

  /** text to display in UI about this action */
  description;

  /** the index of this action within the full test */
  index;

  /**
   * used to distinguish 1st from 2nd click for single double clicks
   */
  detail;

  /**
   * the element that is the target of this action
   */
  boundingClientRect;

  /** x coordinate of the action. for mouse events, this is the pixel location of the mouse. for type events it is the middle of the element that gets the key */
  x;

  /** y coordinate of the action. for mouse events, this is the pixel location of the mouse. for type events it is the middle of the element that gets the key */
  y;

  /** filtered copy of the event that generated this action */
  event;

  /**
   * What the screen should look like *before* the input action can be performed.
   * @type {Screenshot}
   * */
  expectedScreenshot;

  /**
   * Optional. The actual screenshot, to be compared with the expected screenshot.
   * This is updated by playing the action *before* this one.
   * @type {Screenshot}
   */
  actualScreenshot;

  /**
   * Optional. The pixel differences that are officially allowed,
   * between the expected and actual screenshots.
   * This contains **only** unpredictable (orange/yellow) pixels, and greyscale.
   * It **cannot** contain **red** pixels. Red pixels would be found in
   * {@link pixelDiffScreenshot}.
   * @type {Screenshot}
   *
   */
  acceptablePixelDifferences;

  /**
   * This is the *last* result of verifying this actions screenshots.
   * It is the result that shows what is *still* different between
   * expected and actual after the acceptable are factored in. It should
   * look just like {@link acceptablePixelDifferences} with possibly some
   * red pixels in place of some greyscale pixels.
   *
   * Hence this is always what is seen in the EDIT view.
   *
   * @type {Screenshot}
   * */
  pixelDiffScreenshot;

  /**
   * The number of pixels that were different between the expected screenshot and the actual screenshot.
   */
  numDiffPixels = 0;

  /**
   * The number of pixels that were different between the expected screenhot and the actual screenshot
   * but were allowed because of the acceptablePixelDifferences mask.
   */
  numMaskedPixels = 0;

  /**
   * The result of the last time we tried to match expected against actual with the mask.
   * One of 'fail', 'allow', 'pass', 'play', 'cancel', or undefined. Undefined means we don't have this info.
   */
  _match;

  /** The view view of the card, really which image src to use */
  _view;

  /** recorded during playback, this is the number of MBs in use after this action is performed. */
  memoryUsed;

  /**
   * Optional the user can name this action. e.g. 'Open Dialog'
   * @type {string}*/
  name;

  /** did this action happen in the shadownDOM? */
  shadowDOMAction = false;

  /** The test this action is in. */
  /**
   * @type {Test}
   */
  test = null;

  /**
   * Add a delay before playing. Can be inserted directly via json.
   * @type {number}
   */
  waitBeforePlaying = 0;

  /** the user perceived latency in millisconds for this action to complete */
  latency = 0;

  /**
   * allow each action to override how long the wait is for this particular action.
   * if it is unset, when it is needed, it comes from the global options value.
   * @type {number}
   */
  maxVerifyTimeout;

  /**
   * viewmodel variable for the time reported in the waiting title view
   * @type {number}
   */
  _lastTimeout;

  /**
   * @type {boolean} if true playback will stop before this action is played.
   */
  breakPoint = false;

  /**
   * The last time this action was accessed. Used for runtime memory
   * savings.
   * @type {number}
   */
  _accessTime = Number.MAX_SAFE_INTEGER; // sometime long after I am dead

  /**
   * A temporary uid for this action this session.
   * @type {string}
   */
  _uid;

  /**
   * Was this test action modified? Used to
   * suggest saving.
   */
  dirty = false;

  /** Is this action presently in the inserted state */
  inserted = false;

  constructor(args) {
    Object.assign(this, args);
    this.tab = new Tab(this.tab);
    if (!this._uid) {
      this._uid = uuidv4();
    }
  }

  /**
   * Called when the extension is given a user action that has been recorded.
   * @param {Screenshot} ss
   */
  addExpectedScreenshot(ss) {
    this.expectedScreenshot = new Screenshot(ss);
    this.expectedScreenshot.fileName = `step${this.index}_expected.png`;
    this.expectedScreenshot.png;
  }

  toJSON() {
    let clone = {
      type: this.type,
      boundingClientRect: this.boundingClientRect,
      event: this.event, // curated properties from an Event
      x: this.x,
      y: this.y,
      tab: this.tab,
      index: this.index,
      overlay: this.overlay,
      description: this.description,
      memoryUsed: this.memoryUsed,
      latency: this.latency,
      url: this.url, // only on goto actions
      hoverTime: this.hoverTime,
      deltaX: this.deltaX, // only on wheel actions
      deltaY: this.deltaY, // only on wheel actions
      name: this.name, // optional
      shadowDOMAction: this.shadowDOMAction,
      css: this.css, // experimental for fun
      waitBeforePlaying: this.waitBeforePlaying,
      breakPoint: this.breakPoint,
      maxVerifyTimeout: this.maxVerifyTimeout,
    };

    if (this.expectedScreenshot) {
      clone.expectedScreenshot = { fileName: this.expectedScreenshot.fileName }; // delete the large dataUrl when serializing
    }

    if (this.actualScreenshot?.fileName && this.numDiffPixels) {
      clone.actualScreenshot = { fileName: this.actualScreenshot.fileName }; // delete the large dataUrl when serializing
    }

    if (this.acceptablePixelDifferences?.fileName) {
      clone.acceptablePixelDifferences = {
        fileName: this.acceptablePixelDifferences.fileName,
      };
    }

    return clone;
  }

  /**
   * This pokes some pixels specifed by the correction rectangle
   * into the appropriate PNG depending on the button the user pressed.
   * @param {string} buttonId what button the user pressed
   * @param {BoundingBox} bounds the bounds of the condition on this correction, comes from the rectangle the user chose/drew.
   */
  _applyCorrection(buttonId, bounds) {
    let correction;
    switch (buttonId) {
      case 'correctAsUnpredictable':
        correction = new UnpredictableCorrection({
          condition: bounds,
          action: this,
        });
        Correction.availableInstances.push(correction);
        correction.apply(this);
        break;
      case 'correctAsActual':
        correction = new ActualCorrection({ condition: bounds, action: this });
        Correction.availableInstances.push(correction);
        correction.apply(this);
        break;
      case 'possibleCorrections':
        Correction.applicableInstances.forEach((correction) => {
          correction.apply(this);
        });
        break;
      case 'correctAsAntiAlias':
        correction = new AntiAliasCorrection({
          condition: bounds,
          action: this,
        });
        Correction.availableInstances.push(correction);
        correction.apply(this);
        break;
      default:
        throw new Error('internal error');
    }
  }

  /**
   * The user is asking to fix the pixel differences they see in the EDIT view
   * of this action.
   *
   * If there are rectangles on the screen then rectangles only are fixed according to the
   * button the user pressed (wand, question, check).
   *
   * If there are no rectangles then the active rectangle is considered to be the whole screen.
   *
   * Corrections applied will, change one or both of {@link acceptablePixelDifferences} and
   * {@link expectedScreenshot}. Before returning, {@link pixelDiffScreenshot} wil be recalculated to show
   * what effect the corrections had.
   * @param {object} $card jquery card of the correction
   * @param {Event} e event
   *  */
  async applyCorrections($card, e) {
    // FIMXE: don't pass the card in...
    this.dirty = true;
    let volatileRegions = $card.find('.rectangle');
    if (volatileRegions.length) {
      // this is scaled
      let $image = $card.find('img');
      let image = $image[0].getBoundingClientRect();

      // this is scaled, need to be able to get at the actual unscaled pixels
      let xscale = this.pixelDiffScreenshot.png.width / image.width;
      let yscale = this.pixelDiffScreenshot.png.height / image.height;
      volatileRegions.each((index, rectangle) => {
        // viewport relative measurements with scaled lengths
        let rec = rectangle.getBoundingClientRect();
        let bounds = new BoundingBox({
          x0: Math.floor((rec.left - image.left) * xscale),
          y0: Math.floor((rec.top - image.top) * yscale),
          width: Math.floor(rec.width * xscale),
          height: Math.floor(rec.height * yscale),
        });

        this._applyCorrection(e.currentTarget.id, bounds);
      });
    } else {
      // the user poked a button without any rectangles showing, in this case the operation applies to the whole screen
      if (e.currentTarget.id === 'replaceExpectedWithActual') {
        // push the actual into the expected and be done with it.
        this.expectedScreenshot._png = this.actualScreenshot.png;
        this.expectedScreenshot.pngDataChanged();
        this.dirty = true;
        delete this.acceptablePixelDifferences;
      }
    }

    this.calculatePixelDiff();
  }

  /**
   * Called anytime
   * we need to (re)build the {@link pixelDiffScreenshot} to see if there are pixel errors
   * in this action. This is what is shown in the EDIT view.
   *
   * @param {Object} obj Destructured arguments
   * @param {boolean} obj.fastFail - Should we fast fail the pixel diff?
   * */
  calculatePixelDiff({ fastFail = false } = {}) {
    let { numUnusedMaskedPixels, numDiffPixels, numMaskedPixels, diffPng } =
      pngDiff(
        this.expectedScreenshot.png,
        this.actualScreenshot.png,
        this.acceptablePixelDifferences?.png, // this may not exist, in which case our diffPng will not have orange pixels

        options.pixelMatchThreshhold,
        fastFail
      );
    // the diff PNG comes out with perhaps some red ones, but these should be outside of what went in.
    // I should not be able to lose orange or yellow, but always pass those through to the result.
    this.pixelDiffScreenshot = new Screenshot({ png: diffPng });

    // view models stuff
    this.numDiffPixels = numDiffPixels;
    let UiPercentDelta =
      (numDiffPixels * 100) /
      (this.expectedScreenshot.png.width * this.expectedScreenshot.png.height);
    this.percentDiffPixels = UiPercentDelta.toFixed(2);

    this._match = constants.match.FAIL; // until we determine different
    if (numDiffPixels === 0) {
      // it matched
      this._match = constants.match.PASS;
      if (numMaskedPixels || numUnusedMaskedPixels) {
        // it matched only because of the masking we allowed
        this._match = constants.match.ALLOW;
      }
    }
  }

  toThumb() {
    let src = this?.expectedScreenshot?.dataUrl ?? '../images/notfound.png';
    return `
        <div id="thumbNail" class='card ${this.classes()} thumb' data-index=${
      this.index
    }>
            <img draggable='false' src='${src}'>
        </div>`;
  }

  /** calculate the classes to put on the DOM element */
  classes() {
    return `${this?._view || ''} ${this?._match || ''}`;
  }

  toHtml({ view = null, isRecording = false } = {}) {
    if (!view) {
      // allow override of the view by the parameter, but give it a default
      view = this._view; // default
    }

    switch (view) {
      case constants.view.ACTION: {
        let title = {
          text: `
                    <input class="stopPropagation" id="editActionName" value="${
                      this.name || 'User action'
                    }"></input>`,
          tooltip: 'Edit the user name of this action.',
          actions: '',
        };
        if (isRecording) {
          title.text = 'Last recorded user action';
        } else if (this.index === this.test.steps.length - 1) {
          title.text += 'Final screenshot';
        }
        title.actions = `
                <div class="actions">
                  <button title="Delete this action" data-action="deleteAction">
                    <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="trash"
                      class="svg-inline--fa fa-trash fa-w-14" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
                      <path fill="currentColor"
                        d="M432 32H312l-9.4-18.7A24 24 0 0 0 281.1 0H166.8a23.72 23.72 0 0 0-21.4 13.3L136 32H16A16 16 0 0 0 0 48v32a16 16 0 0 0 16 16h416a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16zM53.2 467a48 48 0 0 0 47.9 45h245.8a48 48 0 0 0 47.9-45L416 128H32z">
                      </path>
                    </svg>
                  </button>
                </div>`;

        return this._toHtml({
          view: view,
          title: title,
          src: null,
          className: constants.view.ACTION,
          stats: false,
        });
      }
      case constants.view.EXPECTED:
      case constants.view.ACTUAL:
      case constants.view.EDIT:
      case constants.view.DYNAMIC:
      default: {
        let src;
        let title = {
          text: '',
          tooltip: 'Click to cycle through\nexpected and actual views.',
          actions: `<button id="editDifferencesButton" title="Edit differences">${pencilSvg}</button>`,
        };

        if (this._match === constants.match.PLAY) {
          title.text += `Wait ${this._lastTimeout} second${
            this._lastTimeout > 1 ? 's' : ''
          } for actual screen to match this.`;
        } else {
          switch (view) {
            case constants.view.EXPECTED:
              title.text += `<button>${arrowsSvg}</button> <b>Expected</b> result under <input title="Change the timeout\n for just this action" class="stopPropagation" type="number" min="1" max="120" value="${
                this.maxVerifyTimeout || options.MAX_VERIFY_TIMEOUT
              }" id="actionMatchTimeout"></input> seconds`;
              if (this.index === this.test.steps.length - 1) {
                title.text += ' - final screenshot';
              }
              title.text += '.';
              break;
            case constants.view.DYNAMIC:
              title.text += 'Expecting result';
              break;
            case constants.view.ACTUAL:
              title.text += `<button>${arrowsSvg}</button> <b>Actual</b>result.`;
              src = this.actualScreenshot?.dataUrl ?? '../images/notfound.png';
              break;
            case constants.view.EDIT:
              title.text += `<button title="Back to expected view">${leftArrow}</button><b>Difference</b>${this.numDiffPixels} pixels (${this.percentDiffPixels}%).`;
              let titleSuffix = enableAutoPlayCheckbox.checked
                ? ' Autoplay.'
                : '';

              // at this point there can be NO untyped rectangles. But there *might* be red pixels or not.
              let noRedPixels = !this.numDiffPixels;
              let wandDisabled =
                noRedPixels || !Correction.availableInstances.length;
              let questionMarkDisabled = noRedPixels; // disabled if there are no red pixels
              let ironDisabled = noRedPixels; // disabled if there are no red pixels
              let checkDisabled = noRedPixels; // disabled if there are no red pixels
              let autoplay = options.autoPlay
                ? 'autoplay="true"'
                : "autoplay='false'";

              title.actions = `
                        <div class="stopPropagation" title="Enabled when there are red pixels,\navailable corrections, and you have\nnot drawn a selecting rectangle.">
                          <button class="${options.autoCorrect ? 'hide' : ''}"${
                wandDisabled ? 'disabled' : ''
              } title="Possible corrections.${titleSuffix}" id="possibleCorrections" ${autoplay}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!--! Font Awesome Free 6.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="M3.682 149.1L53.32 170.7L74.02 220.3c1.016 2.043 3.698 3.696 5.977 3.696c.0078 0-.0078 0 0 0c2.271-.0156 4.934-1.661 5.946-3.696l20.72-49.63l49.62-20.71c2.023-1.008 3.68-3.681 3.691-5.947C159.1 141.7 158.3 139 156.3 138L106.9 117.4L106.5 117L85.94 67.7C84.93 65.66 82.27 64.02 80 64c-.0078 0 .0078 0 0 0c-2.279 0-4.966 1.649-5.981 3.692L53.32 117.3L3.682 138C1.652 139.1 0 141.7 0 144C0 146.3 1.652 148.9 3.682 149.1zM511.1 368c-.0039-2.273-1.658-4.95-3.687-5.966l-49.57-20.67l-20.77-49.67C436.9 289.7 434.3 288 432 288c-2.281 0-4.948 1.652-5.964 3.695l-20.7 49.63l-49.64 20.71c-2.027 1.016-3.684 3.683-3.687 5.956c.0039 2.262 1.662 4.954 3.687 5.966l49.57 20.67l20.77 49.67C427.1 446.3 429.7 448 432 448c2.277 0 4.944-1.656 5.96-3.699l20.69-49.63l49.65-20.71C510.3 372.9 511.1 370.3 511.1 368zM207.1 64l12.42 29.78C221 95.01 222.6 96 223.1 96s2.965-.9922 3.575-2.219L239.1 64l29.78-12.42c1.219-.6094 2.215-2.219 2.215-3.578c0-1.367-.996-2.969-2.215-3.578L239.1 32L227.6 2.219C226.1 .9922 225.4 0 223.1 0S221 .9922 220.4 2.219L207.1 32L178.2 44.42C176.1 45.03 176 46.63 176 48c0 1.359 .9928 2.969 2.21 3.578L207.1 64zM399.1 191.1c8.875 0 15.1-7.127 15.1-16v-28l91.87-101.7c5.75-6.371 5.5-15.1-.4999-22.12L487.8 4.774c-6.125-6.125-15.75-6.375-22.12-.625L186.6 255.1H144c-8.875 0-15.1 7.125-15.1 15.1v36.88l-117.5 106c-13.5 12.25-14.14 33.34-1.145 46.34l41.4 41.41c12.1 12.1 34.13 12.36 46.37-1.133l279.2-309.5H399.1z"/></svg>
                          </button>
                        </div>

                        <div id="correctionButtons">
                          <div class='stopPropagation' title="Enabled when red pixels exist.">
                              <button ${
                                questionMarkDisabled ? 'disabled' : ''
                              } title="Mark ALL pixels in rectangle(s) as unpredictable.\nUse on areas changing every run (e.g. dates).${titleSuffix}" id="correctAsUnpredictable" data-constructor="UnpredictableCorrection" ${autoplay}>
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512"><!--! Font Awesome Free 6.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="M204.3 32.01H96c-52.94 0-96 43.06-96 96c0 17.67 14.31 31.1 32 31.1s32-14.32 32-31.1c0-17.64 14.34-32 32-32h108.3C232.8 96.01 256 119.2 256 147.8c0 19.72-10.97 37.47-30.5 47.33L127.8 252.4C117.1 258.2 112 268.7 112 280v40c0 17.67 14.31 31.99 32 31.99s32-14.32 32-31.99V298.3L256 251.3c39.47-19.75 64-59.42 64-103.5C320 83.95 268.1 32.01 204.3 32.01zM144 400c-22.09 0-40 17.91-40 40s17.91 39.1 40 39.1s40-17.9 40-39.1S166.1 400 144 400z"/></svg>                      
                              </button>
                          </div>

                          <div class='stopPropagation' title="Enabled when red pixels exist.">
                            <button ${
                              ironDisabled ? 'disabled' : ''
                            } title="Mark ONLY red pixels in rectangle(s) as unpredictable.\nUse on areas containing render deltas (e.g. anti-alising).${titleSuffix}" id="correctAsAntiAlias" data-constructor="AntiAliasCorrection" ${autoplay}>
                              <svg version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
                                  viewBox="0 0 489.962 489.962" style="enable-background:new 0 0 489.962 489.962;" xml:space="preserve">
                                      <path d="M486.8,248.733c-15.9-14.8-22.6-38.9-16.3-59.9c0.8-2.3,23.9-54.7-17.5-71.5c-31.7-7.8-52.5,5.4-57.9,10.9l-2-4.2
                                              l-36.6,21.8l-3.5-9.4c0,0-280.4,1.9-335.6,201.8h365.1l29.2-45.5l-44.4-118.8l40.4-23.3l-2.3-4.8c1.2-0.8,13.4-15.2,41.2-10.1
                                              c20,5.6,6.2,44.7,5.4,47.8c-8.2,28,0.4,59.9,21.8,79.7c1.9,1.9,7.8,5.1,13.6-0.4C491.1,258.433,490.7,252.533,486.8,248.733z
                                              M186.6,263.433c21-76.2,127.9-77,127.9-77l28.8,77H186.6z"/>
                                          <rect y="357.533" width="382.6" height="17.5"/>
                              </svg>
                            </button>
                          </div>

                          <div class='stopPropagation' title="Enabled when red pixels exist.">
                              <button ${
                                checkDisabled ? 'disabled' : ''
                              } title="Mark all pixels in rectangle(s) as correct.\nUse when actual region is correct and\nexpected is not (e.g. application changes,\nor you recorded the wrong expected screen).${titleSuffix}" id="correctAsActual" data-constructor="ActualCorrection" ${autoplay}>
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!--! Font Awesome Free 6.0.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License) Copyright 2022 Fonticons, Inc. --><path d="M438.6 105.4C451.1 117.9 451.1 138.1 438.6 150.6L182.6 406.6C170.1 419.1 149.9 419.1 137.4 406.6L9.372 278.6C-3.124 266.1-3.124 245.9 9.372 233.4C21.87 220.9 42.13 220.9 54.63 233.4L159.1 338.7L393.4 105.4C405.9 92.88 426.1 92.88 438.6 105.4H438.6z"/></svg>
                              </button>
                          </div>
                        </div>

                        <div class='stopPropagation' title="Enabled when red pixels exist.">
                          <button ${
                            noRedPixels ? 'disabled' : ''
                          }  title="Replace entire expected screenshot\nwith actual screenshot.\n\nUse when entire actual screen is correct and\nexpected is not (e.g. application changes,\nor you recorded the wrong expected screen)." id="replaceExpectedWithActual" ${autoplay}>
                            <svg id="Capa_1" enable-background="new 0 0 512 512" height="512" viewBox="0 0 512 512" width="512" xmlns="http://www.w3.org/2000/svg"><g><g><path d="m101.664 416.507 22.123 22.123h-63.787v-46.63h-30v76.63h93.787l-22.123 22.123 21.213 21.213 58.336-58.336-58.336-58.336z"/><path d="m413.213 150h-112.213v-51.213l-98.787-98.787h-202.213v362h211v150h301v-263.213zm8.787 51.213 38.787 38.787h-38.787zm-211-150 38.787 38.787h-38.787zm-181-21.213h151v90h90v212h-241zm211 452v-120h60v-182h91v90h90v212z"/><path d="m435.394 361.147-26.517 26.517-26.517-26.517-21.213 21.213 26.517 26.517-26.517 26.517 21.213 21.212 26.517-26.516 26.517 26.516 21.212-21.212-26.516-26.517 26.516-26.517z"/></g></g></svg>
                          </button>
                        </div>

                        <button title="Clear Unpredictable Pixels" id="undo">
                            <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="undo"
                                class="svg-inline--fa fa-undo fa-w-16" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                                <path fill="currentColor"
                                d="M212.333 224.333H12c-6.627 0-12-5.373-12-12V12C0 5.373 5.373 0 12 0h48c6.627 0 12 5.373 12 12v78.112C117.773 39.279 184.26 7.47 258.175 8.007c136.906.994 246.448 111.623 246.157 248.532C504.041 393.258 393.12 504 256.333 504c-64.089 0-122.496-24.313-166.51-64.215-5.099-4.622-5.334-12.554-.467-17.42l33.967-33.967c4.474-4.474 11.662-4.717 16.401-.525C170.76 415.336 211.58 432 256.333 432c97.268 0 176-78.716 176-176 0-97.267-78.716-176-176-176-58.496 0-110.28 28.476-142.274 72.333h98.274c6.627 0 12 5.373 12 12v48c0 6.627-5.373 12-12 12z">
                                </path>
                            </svg>
                        </button>
  `;
              src = this.pixelDiffScreenshot.dataUrl;
              break;
          }
        }

        if (this._match === constants.match.ALLOW) {
          title.text += ` <span id='unpredictable-pixels'>&nbspHas unpredictable pixels.</span>`;
        }

        let screenshot = this.numDiffPixels && { class: 'hasRedPixels' };

        return this._toHtml({
          view: view,
          title: title,
          src: src,
          className: 'waiting', // this is just a dumb name to id the 2nd card
          stats: true,
          screenshot: screenshot,
        });
      }
    }
  }

  /**
   * Return a card, this could be the first or second card in the step
   * */
  _toHtml({ view, title, src, className, stats, screenshot = { class: '' } }) {
    src = src || (this?.expectedScreenshot?.dataUrl ?? noImageAvailableDataUrl);
    //let clickable = this._view === constants.view.EDIT ? '' : ' click-to-change-view';

    let imageClasses = this.shadowDOMAction ? 'class="shadowDOM"' : '';
    let shadowDesc = this.shadowDOMAction ? '(shadowDOM) ' : '';
    let html = `
    <div class='card ${this.classes()} ${className}' data-index=${this.index}>
        <div title='${
          title.tooltip
        }' class='click-to-change-view title'><div class='text'>${
      title.text
    }</div><div class='actions'>${title.actions || ''}</div></div>
        <div class="meter">
            <span style="width:100%;"><span class="progress"></span></span>
            <span style="width:100%;"><span class="match-status"></span></span>
        </div>
        <div class='screenshot ${screenshot.class}'>
            <img ${imageClasses} src='${src}'>`;

    // FIXME: calculate the best location for the callout, based on the location of the overlay
    if (this.overlay) {
      let o = this.overlay;
      let calloutY = o.top + o.height; // position of the text box that contains the description
      let calloutX = Math.max(o.left, 0); // position of the text box that contains the description
      if (
        this.type === 'mousemove' ||
        this.type === 'click' ||
        this.type === 'dblclick' ||
        this.type === 'contextmenu' ||
        this.type === 'wheels' ||
        this.type === 'mouseover'
      ) {
        html += `
                <div class='overlay pointer pulse' data-index=${this.index} style='top:${o.y}%;left:${o.x}%'>
                    ${pointer}
                    </br>
                    <div class='action' data-index='${this.index}'>${shadowDesc}${this.description}</div>
                </div>`;
      } else {
        html += `<div class='overlay pulse action' data-index='${this.index}' style='top:${calloutY}%;left:${calloutX}%;'>${shadowDesc}${this.description}</div>`;
      }

      // highlight the whole rectangle element we are acting on
      if (o.html) {
        html += `<div class='overlay pulse-light countdown' data-index=${
          this.index
        } style='height:${o.height}%;width:${o.width}%;top:${o.top}%;left:${
          o.left
        }%'>${o.html ? o.html : ''}</div>`;
      } else {
        html += `<div class="overlay-clipper"><div class='overlay pulse-light' data-index=${this.index} style='height:${o.height}%;width:${o.width}%;top:${o.top}%;left:${o.left}%'></div></div>`;
      }
    }

    let footer = '';
    // the 2nd card shows the latency of the previous action to complete, and the memory when it did complete.
    let latency, memoryUsed;
    if (this.index) {
      let prev = this.test.steps[this.index - 1];
      latency = prev.latency;
      memoryUsed = prev.memoryUsed;
    }
    if (latency) {
      let red = latency > 3000 ? "class='error-text'" : '';
      footer += `Visible in&nbsp<span ${red}>${(latency / 1000).toFixed(
        1
      )}s</span>.`;
    }
    if (memoryUsed) {
      if (latency) {
        footer += ' ';
      }
      footer += `${memoryUsed}MBs in use.`;
    }

    if (!stats) {
      footer = '';
    }

    let width = '?';
    let height = '?';
    let ss;
    switch (view) {
      case constants.view.DYNAMIC:
      case constants.view.EXPECTED:
        ss = this.expectedScreenshot;
        break;
      case constants.view.EDIT:
        if (this.pixelDiffScreenshot) {
          ss = this.pixelDiffScreenshot;
        }
        break;
      case constants.view.ACTUAL:
        ss = this.actualScreenshot;
        break;
    }

    if (ss) {
      if (ss.dataUrlHeight) {
        width = ss.dataUrlWidth;
        height = ss.dataUrlHeight;
      } else if (ss.png) {
        width = ss.png.width;
        height = ss.png.height;
      }
    }

    footer += ` tab:${this.tab.virtualId} viewport:${width}x${height} `;
    let stepNumber = `${this.index + 1}/${this.test.steps.length}`;
    if (
      PlayTree.stepsInZipNodes > this.test.steps.length &&
      this.test._playTree._stepBaseIndex !== undefined
    ) {
      stepNumber += ` (${this.index + 1 + this.test._playTree._stepBaseIndex}/${
        PlayTree.stepsInZipNodes
      })`;
    }
    footer += `<div class="stepNumber">${stepNumber}</div>`;
    html += `
        </div>
        <div class='footer'>${footer}</div>
    </div>`;

    return html;
  }

  /**
   * Update the id of this action. The id is currently also the index in the array.
   * This will update screenshot filenames too.
   */
  setIndex(to) {
    this.index = to; // reset the indicies
    if (this.expectedScreenshot?.fileName) {
      this.expectedScreenshot.fileName =
        this.expectedScreenshot.fileName.replace(/\d+/, to);
    }
    if (this.acceptablePixelDifferences?.fileName) {
      this.acceptablePixelDifferences.fileName =
        this.acceptablePixelDifferences.fileName.replace(/\d+/, to);
    }
    if (this.actualScreenshot?.fileName) {
      this.actualScreenshot.fileName = this.actualScreenshot.fileName.replace(
        /\d+/,
        to
      );
    }
  }

  /**
   * For expected, acceptable and actual screenshots,
   * populate the dataUrl from disk if possible, then
   * build the expensive PNG field. (PNGs are only
   * required to play this action.)
   */
  async hydrateScreenshots() {
    await Promise.all([
      this.expectedScreenshot?.hydrate(),
      this.acceptablePixelDifferences?.hydrate(),
      this.actualScreenshot?.hydrate(), // this should not persist at all
    ]);
  }

  /**
   * dehydrate, expected, acceptable, and actual screenshots.
   * delete pixelDiffScreenshot.
   */
  dehydrateScreenshots() {
    console.debug(`dehydrating screenshots for step[${this.index + 1}]`);
    this.expectedScreenshot?.dehydrate();
    this.acceptablePixelDifferences?.dehydrate();
    this.actualScreenshot?.dehydrate();
    delete this.pixelDiffScreenshot;
  }
}

/**
 * An action followed by the next expected screen: action, expected screen
 * i.e expected screen, input, expected screen. These are used in the UI mainly.
 * This is really just (some parts) of two consecutive TestActions. It is modelled as so.
 */
export class Step {
  /** The current action.
   * @type {TestAction}
   */
  curr;

  /** The next action.
   * @type {TestAction}
   */
  next;

  /**
   *
   * @param {object} args
   * @param {TestAction} args.curr The current test action
   * @param {TestAction} args.next The next test actions
   * @param {Test} args.test The containing test
   */
  constructor({ curr, next = null, test }) {
    this.curr = curr;
    this.test = test;
    this.next = next || test.steps[this.curr.index + 1];
  }

  /**
   * Render two cards, curr, next, in the workspace.
   * @param } param0
   * @returns
   */
  toHtml({ isRecording }) {
    // first card
    let html =
      '<div id="content">' +
      this.curr.toHtml({ view: constants.view.ACTION, isRecording });

    /// set up 2nd card if it exists
    if (this.next) {
      html += this.next.toHtml();
    }
    html += '</div>';
    return html;
  }
}

export function getStep(element) {
  let view = $(element).closest('.step');
  let index = view.attr('data-index');
  let model = cards[index];
  return { view, model };
}

/**
 *
 * @param {*} element
 * @param {Test} test
 * @returns
 */
export function getCard(element, test) {
  let view = $(element).closest('.card');
  let index = view.attr('data-index');
  /** @type {TestAction} */
  let action = test.steps[index];
  return { view, action };
}
