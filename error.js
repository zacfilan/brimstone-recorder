
/** an error that identifies when we detected pixel scaling */
export class PixelScalingError extends Error {
    constructor(msg) {
        super(msg || 'pixel scaling detected');
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