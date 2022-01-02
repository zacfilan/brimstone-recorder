
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
