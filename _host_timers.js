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
// Scheduling. Timers live in this module, which keeps at most one QuickJS timer armed, for
// the earliest deadline, and only while at least one timer is ref'd. QuickJS ends a script
// when nothing is pending, so, as in Node:
//   - an unref'd timer still fires on time while anything ref'd keeps the script alive;
//   - once only unref'd timers remain, nothing is armed and the script ends.
// Due timers fire one at a time, in deadline order and then creation order. The next one
// is queued with queueMicrotask, so promise callbacks queued by a timer run before the next
// timer, as in Node 11+, without adding QuickJS's 1 ms minimum delay.
//
// Scope: this sees every timer created through Node APIs. QuickJS's own handlers
// (os.setReadHandler, os.setTimeout from 'qjs:os') are invisible to it; while only those
// keep a script alive, unref'd timers don't fire. Node code never uses them.

import * as os from 'qjs:os';

const TIMEOUT_MAX = 2147483647;

// Same monotonic clock as QuickJS's own timers (os.now() is in microseconds).
const now = () => os.now() / 1000;

const active = new Set(); // pending timers
const byId = new Map(); // numeric id -> Timeout, for clearTimeout(id)
let nextId = 1;
let nextSeq = 1;
let armedId = 0; // the one QuickJS timer, or 0
let armedAt = Infinity; // deadline it is armed for
let draining = false; // due timers are being fired; the drain reschedules when done

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

function before(a, b) {
    return a._deadline < b._deadline || (a._deadline === b._deadline && a._seq < b._seq);
}

function disarm() {
    if (armedId) {
        os.clearTimeout(armedId);
        armedId = 0;
        armedAt = Infinity;
    }
}

// Arms the QuickJS timer for the earliest deadline, or disarms it when no timer is ref'd.
function reschedule() {
    if (draining) return;
    let next = null;
    let anyRef = false;
    for (const t of active) {
        if (t._ref) anyRef = true;
        if (!next || before(t, next)) next = t;
    }
    if (!next || !anyRef) {
        disarm();
        return;
    }
    if (armedId && armedAt === next._deadline) return;
    disarm();
    armedAt = next._deadline;
    armedId = os.setTimeout(onArmedTimer, Math.max(1, Math.ceil(next._deadline - now())));
}

function onArmedTimer() {
    armedId = 0;
    armedAt = Infinity;
    if (!draining) {
        draining = true;
        drain();
    }
}

// Fires the earliest due timer, then queues itself for the next one.
function drain() {
    const t0 = now();
    let due = null;
    for (const t of active) {
        if (t._deadline <= t0 && (!due || before(t, due))) due = t;
    }
    if (!due) {
        draining = false;
        reschedule();
        return;
    }
    if (due._repeat) {
        due._schedule(); // next interval tick, counted from now
    } else {
        active.delete(due);
        byId.delete(due._id);
    }
    try {
        due._onTimeout.apply(due, due._args);
    } finally {
        queueMicrotask(drain);
    }
}

class Timeout {
    constructor(callback, delay, args, repeat) {
        this._onTimeout = callback;
        this._idleTimeout = delay;
        this._args = args;
        this._repeat = repeat;
        this._ref = true;
        this._id = nextId++;
        this._deadline = 0;
        this._seq = 0;
        this._schedule();
        active.add(this);
        byId.set(this._id, this);
        reschedule();
    }

    _schedule() {
        this._deadline = now() + this._idleTimeout;
        this._seq = nextSeq++;
    }

    close() {
        if (active.delete(this)) {
            byId.delete(this._id);
            reschedule();
        }
        return this;
    }

    // Restarts the timer with its original delay, re-arming it if it already fired.
    refresh() {
        this._schedule();
        active.add(this);
        byId.set(this._id, this);
        reschedule();
        return this;
    }

    ref() {
        this._ref = true;
        reschedule();
        return this;
    }

    unref() {
        this._ref = false;
        reschedule();
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
    const t = byId.get(Number(timer));
    if (t) t.close();
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
