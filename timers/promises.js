// timers/promises.js
'use strict';

import timers from '../timers.js';

export function setTimeout(delay = 0, value, options = {}) {
    const signal = options?.signal;
    if (signal?.aborted) {
        return Promise.reject(signal.reason ?? new Error('The operation was aborted'));
    }

    return new Promise((resolve, reject) => {
        let timerId;
        let onAbort;

        if (signal) {
            onAbort = () => {
                timers.clearTimeout(timerId);
                reject(signal.reason ?? new Error('The operation was aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        timerId = timers.setTimeout(() => {
            if (signal && onAbort) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve(value);
        }, delay);
    });
}

export function setImmediate(value, options = {}) {
    const signal = options?.signal;
    if (signal?.aborted) {
        return Promise.reject(signal.reason ?? new Error('The operation was aborted'));
    }

    return new Promise((resolve, reject) => {
        let immediateId;
        let onAbort;

        if (signal) {
            onAbort = () => {
                timers.clearImmediate(immediateId);
                reject(signal.reason ?? new Error('The operation was aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        immediateId = timers.setImmediate(() => {
            if (signal && onAbort) {
                signal.removeEventListener('abort', onAbort);
            }
            resolve(value);
        });
    });
}

export async function* setInterval(delay = 0, value, options = {}) {
    const signal = options?.signal;
    while (true) {
        if (signal?.aborted) {
            throw (signal.reason ?? new Error('The operation was aborted'));
        }
        await setTimeout(delay, undefined, options);
        yield value;
    }
}

export default {
    setTimeout,
    setImmediate,
    setInterval
};