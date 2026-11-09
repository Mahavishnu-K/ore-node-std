// Node.js timer globals for QuickJS-NG.
//
// QuickJS-NG provides timers only on its 'qjs:os' module (os.setTimeout, os.setInterval,
// os.clearTimeout, os.clearInterval); WasmEdge-QuickJS provided them as globals. This
// module installs Node-compatible globals once, only where they are missing:
//   - extra arguments are passed to the callback, which is called with the Timeout as `this`
//   - setTimeout/setInterval return a Timeout (ref, unref, hasRef, refresh, close, and
//     conversion to its numeric id)
//   - clearTimeout/clearInterval accept a Timeout, a numeric id, null or undefined
//   - like Node, a delay below 1 ms or above 2^31-1 ms (or not a number) becomes 1 ms
// Every polyfill that uses timers imports this file.
//
// Limitation: the QuickJS event loop has no unreferenced timers, so unref() only records
// the flag. A pending unref'd timer still keeps the script running until it fires.

import * as os from 'qjs:os';

const TIMEOUT_MAX = 2147483647;

function normalizeDelay(delay) {
    const ms = Number(delay);
    return ms >= 1 && ms <= TIMEOUT_MAX ? Math.trunc(ms) : 1;
}

function checkCallback(callback) {
    if (typeof callback !== 'function') {
        throw new TypeError(
            `The "callback" argument must be of type function. Received ${callback === null ? 'null' : typeof callback}`
        );
    }
    return callback;
}

class Timeout {
    constructor(callback, delay, args, repeat) {
        this._onTimeout = callback;
        this._idleTimeout = delay;
        this._args = args;
        this._repeat = repeat;
        this._ref = true;
        this._id = 0;
        this._schedule();
    }

    _schedule() {
        const fire = () => {
            if (!this._repeat) this._id = 0;
            this._onTimeout.apply(this, this._args);
        };
        this._id = this._repeat
            ? os.setInterval(fire, this._idleTimeout)
            : os.setTimeout(fire, this._idleTimeout);
    }

    close() {
        if (this._id) {
            os.clearTimeout(this._id);
            this._id = 0;
        }
        return this;
    }

    // Restarts the timer with its original delay, re-arming it if it already fired.
    refresh() {
        this.close();
        this._schedule();
        return this;
    }

    ref() {
        this._ref = true;
        return this;
    }

    unref() {
        this._ref = false;
        return this;
    }

    hasRef() {
        return this._ref;
    }

    [Symbol.toPrimitive]() {
        return this._id;
    }
}

function clearTimer(timer) {
    if (timer == null) return;
    if (timer instanceof Timeout) {
        timer.close();
        return;
    }
    const id = Number(timer);
    if (id > 0) os.clearTimeout(id);
}

if (typeof globalThis.setTimeout !== 'function') {
    globalThis.setTimeout = function setTimeout(callback, delay, ...args) {
        return new Timeout(checkCallback(callback), normalizeDelay(delay), args, false);
    };
}
if (typeof globalThis.setInterval !== 'function') {
    globalThis.setInterval = function setInterval(callback, delay, ...args) {
        return new Timeout(checkCallback(callback), normalizeDelay(delay), args, true);
    };
}
if (typeof globalThis.clearTimeout !== 'function') {
    globalThis.clearTimeout = clearTimer;
}
if (typeof globalThis.clearInterval !== 'function') {
    globalThis.clearInterval = clearTimer;
}
