// internal/util/debuglog.js
// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
//
// Copyright Joyent and Node.js contributors. All rights reserved. MIT license.

'use strict';

import { sprintf } from "../../fmt/printf.js";


/*
 * debugImpls contains the lazily-created debug functions.
 *
 * Object.create(null) is intentional:
 * debug namespaces such as "constructor" or "toString" must not collide
 * with Object.prototype properties.
 */
let debugImpls = Object.create(null);


/*
 * NODE_DEBUG matcher.
 *
 * These are deliberately initialized through initializeDebugEnv().
 * debuglog() may be called while internal modules are being initialized,
 * so environment-dependent state is evaluated lazily by the returned logger.
 */
let testEnabled;


/*
 * NODE_DEBUG is traditionally a comma-separated list of debug namespaces.
 *
 * Examples:
 *
 *   NODE_DEBUG=http
 *   NODE_DEBUG=http,fs
 *   NODE_DEBUG=fs*
 *   NODE_DEBUG=*
 */
function initializeDebugEnv(debugEnv) {
    debugImpls = Object.create(null);

    if (debugEnv) {
        /*
         * Escape RegExp metacharacters first.
         *
         * The '*' wildcard is handled separately below.
         */
        debugEnv = debugEnv
            .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
            .replaceAll('*', '.*')
            .replaceAll(',', '$|^');

        const debugEnvRegex = new RegExp(`^${debugEnv}$`, 'i');

        testEnabled = (str) => debugEnvRegex.exec(str) !== null;
    } else {
        testEnabled = () => false;
    }
}


/*
 * Node warns when HTTP debugging is enabled because debug output can expose
 * sensitive information such as authentication headers and credentials.
 */
function emitWarningIfNeeded(set) {
    if (set === 'HTTP' || set === 'HTTP2') {
        console.warn(
            'Setting the NODE_DEBUG environment variable ' +
            `to '${set.toLowerCase()}' can expose sensitive ` +
            'data (such as passwords, tokens and authentication headers) ' +
            'in the resulting log.'
        );
    }
}


/*
 * Disabled debug namespaces use the same shared no-op function.
 */
const noop = () => {};


/*
 * Obtain the process identifier without depending on Deno.
 *
 * QuickJS/WASI environments may not expose process at all.
 */
function getPid() {
    if (
        typeof process !== 'undefined' &&
        process &&
        process.pid !== undefined &&
        process.pid !== null
    ) {
        return process.pid;
    }

    return 0;
}


/*
 * Convert a debug argument to the representation used by Node-style
 * debug output.
 *
 * Strings are preserved as strings rather than being JSON quoted.
 * Objects and other values use JSON serialization when possible.
 */
function formatDebugArg(arg) {
    if (typeof arg === 'string') {
        return arg;
    }

    try {
        return JSON.stringify(arg);
    } catch (_) {
        /*
         * Circular objects and unusual host values may not be serializable.
         * String() provides a safe final fallback.
         */
        return String(arg);
    }
}


/*
 * Lazily create the implementation for a namespace.
 */
function debuglogImpl(enabled, set) {
    if (debugImpls[set] === undefined) {
        if (enabled) {
            emitWarningIfNeeded(set);

            const pid = getPid();

            debugImpls[set] = function debug(...args) {
                const msg = args.map(formatDebugArg).join(' ');

                console.error(
                    sprintf(
                        '%s %s: %s',
                        set,
                        String(pid),
                        msg
                    )
                );
            };
        } else {
            debugImpls[set] = noop;
        }
    }

    return debugImpls[set];
}


/*
 * debuglog() depends on process.env.NODE_DEBUG and process.pid.
 *
 * Initialization is intentionally lazy so internal modules can safely
 * create debugloggers before the runtime environment is fully exposed.
 */
export function debuglog(set, cb) {
    /*
     * Preserve the original namespace supplied by the caller until the
     * returned logger is actually used.
     */
    function init() {
        set = String(set).toUpperCase();
        enabled = testEnabled(set);
    }


    /*
     * The first invocation initializes the namespace and replaces this
     * function with the actual implementation.
     */
    let debug = (...args) => {
        init();

        /*
         * Only create the actual logger on first use.
         */
        debug = debuglogImpl(enabled, set);

        /*
         * Node's callback form receives the initialized debug function.
         */
        if (typeof cb === 'function') {
            cb(debug);
        }

        return debug(...args);
    };


    let enabled;


    /*
     * enabled is also initialized lazily.
     *
     * This is important because NODE_DEBUG can be unavailable during early
     * internal-module initialization.
     */
    let test = () => {
        init();

        test = () => enabled;

        return enabled;
    };


    /*
     * The returned logger is callable:
     *
     *   const debug = debuglog('http');
     *   debug('request started');
     *
     * while also exposing:
     *
     *   debug.enabled
     */
    const logger = (...args) => debug(...args);


    Object.defineProperty(logger, 'enabled', {
        get() {
            return test();
        },

        configurable: true,
        enumerable: true,
    });


    return logger;
}


/*
 * Read NODE_DEBUG from the compatibility process environment if available.
 *
 * QuickJS/WASI may not provide process, so the absence of process simply
 * means debugging is disabled.
 */
const debugEnv =
    typeof process !== 'undefined' &&
    process &&
    process.env &&
    process.env.NODE_DEBUG
        ? process.env.NODE_DEBUG
        : '';


initializeDebugEnv(debugEnv);


/*
 * Preserve the internal-module default export shape.
 */
export default {
    debuglog,
};
