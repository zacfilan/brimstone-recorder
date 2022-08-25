/** an error that identifies when we detected pixel scaling */
export class PixelScalingError extends Error {
  constructor(msg) {
    super(msg || 'pixel scaling detected');
  }
}

export class ZoomError extends Error {
  constructor(msg) {
    super(msg || 'zoom error detected');
  }
}

/** an error that identifies when we cannot resize the viewport */
export class ResizeViewportError extends Error {
  constructor(msg) {
    super(msg || 'unable to resize viewport');
  }
}

/** an error that identifies when the user cannot reuse an existing test window
 * for whatever they are typing to do.
 */
export class ReuseTestWindow extends Error {
  constructor(msg) {
    super(msg || 'unable to reuse test window');
  }
}

/** an error that identifies that we took a screenshot ok, but
 * not of the required size.
 */
export class IncorrectScreenshotSize extends Error {
  constructor(msg) {
    super(msg || 'wrong size screenshot taken');
  }
}

/** an error that identifies that we issues a cmd to the debugger
 * but the debugger is not attached.
 */
export class DebuggerDetached extends Error {
  constructor(msg) {
    super(msg || 'Debugger detached');
  }
}

/** an error that identifies we had issues obtaining an active tab */
export class NoActiveTab extends Error {
  constructor(msg) {
    super(msg || 'The active tab cannot be obtaind.');
  }
}

/** an error that identifies we had issues loading the requested test */
export class TestLoadError extends Error {
  constructor(msg, testName) {
    if (!testName) {
      testName = 'The requested test';
    } else {
      testName = `Test '${testName}'`;
    }
    if (msg) {
      msg = `${testName} could not be loaded: \n\n${msg}.`;
    } else {
      msg = `${testName} could not be loaded.`;
    }
    super(msg);
  }
}

/** an error that identifies we had issues saving the requested test */
export class TestSaveError extends Error {
  constructor(msg, testName) {
    if (!testName) {
      testName = 'The requested test';
    } else {
      testName = `Test '${testName}'`;
    }
    if (msg) {
      msg = `${testName} could not be saved: \n\n${msg}.`;
    } else {
      msg = `${testName} could not be saved.`;
    }
    super(msg);
  }
}

/**
 * an error that indicates the user is loading a test from a version of brimstone older than the
 * version that reecorded the test
 */
export class InvalidVersion extends Error {
  constructor(msg) {
    super(msg || 'The test version is newer than the Brimstone version.');
  }
}

export class DebuggerAttachError extends Error {
  constructor(msg) {
    super(msg || 'Cannot attach the debugger.');
  }
}

/**
 * An error that indicates that we were unable to connect to the frame for messages passing.
 */
export class ConnectionError extends Error {
  constructor(msg) {
    super(
      msg || 'Could not establish connection. Receiving end does not exist.'
    );
  }
}

/**
 * An error that indicats that the user supplied some bad CSS
 */
export class CssError extends Error {
  constructor(msg) {
    super(msg || 'CSS Error');
  }
}
