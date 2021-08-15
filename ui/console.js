
const _console = window.console;

const devnull = {
    log: () => {},
    warn: () => {},
    debug: () => {}
};

export function enableConsole() {
    window.console = _console;
}

export function disableConsole() {
    window.console = devnull;
}

