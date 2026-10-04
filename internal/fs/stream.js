// modules/internal/fs/stream.js
// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent, Inc. and Node.js contributors. All rights reserved. MIT license.

'use strict';

import Readable from "../streams/readable.js";
import Writable from "../streams/writable.js";

import { Buffer } from "../../buffer.js";
import { toPathIfFileURL } from "../url.js";
import { validateEncoding } from "./utils.js";
import { validateInteger, validateObject } from "../validators.js";
import { ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE } from "../errors.js";
import fs from "../../fs.js";

const kIsPerformingIO = Symbol('kIsPerformingIO');
const kFs = Symbol('kFs');
const kIoDone = Symbol('kIoDone');
const kHandle = Symbol('kHandle');

const nextTick = (fn, ...args) => {
    if (typeof globalThis.nextTick === "function") {
        globalThis.nextTick(fn, ...args);
    } else if (typeof queueMicrotask === "function") {
        queueMicrotask(() => fn(...args));
    } else {
        Promise.resolve().then(() => fn(...args));
    }
};

function adoptFd(stream, fdOpt) {
    if (fdOpt === undefined || fdOpt === null) return false;
    if (typeof fdOpt === "number") {
        stream.fd = fdOpt;
    } else if (typeof fdOpt === "object" && typeof fdOpt.fd === "number") {
        stream[kHandle] = fdOpt;
        stream.fd = fdOpt.fd;
    } else {
        throw new ERR_INVALID_ARG_TYPE("options.fd", ["number", "FileHandle"], fdOpt);
    }
    return true;
}

function closeStream(stream, err, cb) {
    // 1. Respect autoClose: false (Crucial Node.js contract)
    if (!stream.autoClose) {
        stream.fd = null;
        stream[kHandle] = null;
        return cb(err);
    }

    const handle = stream[kHandle];
    if (handle) {
        stream[kHandle] = null;
        stream.fd = null;
        if (typeof handle.close === "function") {
            Promise.resolve(handle.close()).then(() => cb(err), (er) => cb(er || err));
        } else {
            cb(err);
        }
        return;
    }

    // fd 0 (stdin) is valid; check by type, not truthiness
    if (typeof stream.fd !== "number") {
        return cb(err);
    }

    const fd = stream.fd;
    stream.fd = null;
    stream[kFs].close(fd, (er) => {
        cb(er || err);
    });
}

// =========================================================================
// WRITE STREAM
// =========================================================================

export class WriteStreamClass extends Writable {
    fd = null;
    bytesWritten = 0;
    pos = undefined;
    autoClose = true;
    [kFs] = {
        open: fs.open,
        write: fs.write,
        close: fs.close
    };
    [kIsPerformingIO] = false;

    constructor(path, opts) {
        if (typeof opts === "string") {
            opts = { encoding: opts };
        }
        opts = opts || {};
        validateObject(opts, "options");

        if (opts.encoding) {
            validateEncoding(opts.encoding, "encoding");
        }
        if (opts.start !== undefined) {
            validateInteger(opts.start, "start", 0);
        }

        super({
            ...opts,
            decodeStrings: true, // _write expects Buffers
            autoDestroy: opts.autoClose ?? opts.autoDestroy ?? true,
            emitClose: opts.emitClose ?? true,
        });

        if (opts.encoding) {
            this.setDefaultEncoding(opts.encoding);
        }

        // Properly normalize path if provided, allow null when fd is supplied
        this.path = path ? toPathIfFileURL(path) : path;
        this.flags = opts.flags || "w";
        this.mode = opts.mode || 0o666;
        this.pos = opts.start;
        this.autoClose = opts.autoClose === undefined ? true : Boolean(opts.autoClose);

        if (opts.fs) {
            this[kFs] = opts.fs;
        }

        this.pending = !adoptFd(this, opts.fd);
    }

    _construct(callback) {
        if (this.fd !== null) {
            this.pending = false;
            callback();
            // Node semantics: no 'open' event for pre-opened fds, but 'ready' MUST fire
            nextTick(() => this.emit("ready"));
            return;
        }

        this[kFs].open(
            this.path.toString(),
            this.flags,
            this.mode,
            (err, fd) => {
                if (err) {
                    callback(err);
                    return;
                }
                this.pending = false;
                this.fd = fd;
                callback();
                this.emit("open", this.fd);
                this.emit("ready");
            },
        );
    }

    _write(data, _encoding, cb) {
        this[kIsPerformingIO] = true;

        this[kFs].write(
            this.fd,
            data,
            0,
            data.length,
            this.pos === undefined ? null : this.pos,
            (er, bytesWritten) => {
                this[kIsPerformingIO] = false;

                if (this.destroyed) {
                    cb(er);
                    return this.emit(kIoDone, er);
                }

                if (er) {
                    return cb(er);
                }

                const actualBytes = bytesWritten !== undefined ? bytesWritten : data.length;
                this.bytesWritten += actualBytes;

                if (this.pos !== undefined) {
                    this.pos += actualBytes;
                }

                cb();
            },
        );
    }

    _destroy(err, cb) {
        if (this[kIsPerformingIO]) {
            this.once(kIoDone, (er) => closeStream(this, err || er, cb));
        } else {
            closeStream(this, err, cb);
        }
    }

    close(cb) {
        if (cb) {
            if (this.closed) {
                nextTick(cb);
                return;
            }
            this.once("close", cb);
        }

        if (this.destroyed) {
            return;
        }

        // Flush buffered writes before shutting down
        this.end();
    }
}

export function WriteStream(path, opts) {
    return new WriteStreamClass(path, opts);
}
WriteStream.prototype = WriteStreamClass.prototype;

export function createWriteStream(path, opts) {
    return new WriteStreamClass(path, opts);
}

// =========================================================================
// READ STREAM
// =========================================================================

export class ReadStream extends Readable {
    fd = null;
    bytesRead = 0;
    pos = undefined;
    autoClose = true;
    [kFs] = {
        open: fs.open,
        read: fs.read,
        close: fs.close
    };
    [kIsPerformingIO] = false;

    constructor(path, opts) {
        if (typeof opts === "string") {
            opts = { encoding: opts };
        }
        opts = opts || {};
        validateObject(opts, "options");

        if (opts.encoding) {
            validateEncoding(opts.encoding, "encoding");
        }
        if (opts.start !== undefined) {
            validateInteger(opts.start, "start", 0);
        }
        if (opts.end !== undefined && opts.end !== Infinity) {
            validateInteger(opts.end, "end", 0);
        }
        if (opts.start !== undefined && opts.end !== undefined && opts.start > opts.end) {
            throw new ERR_OUT_OF_RANGE("start", `<= "end" (here: ${opts.end})`, opts.start);
        }

        super({
            highWaterMark: opts.highWaterMark === undefined ? 64 * 1024 : opts.highWaterMark,
            encoding: opts.encoding,
            autoDestroy: opts.autoClose ?? opts.autoDestroy ?? true,
            emitClose: opts.emitClose ?? true,
        });

        this.path = path ? toPathIfFileURL(path) : path;
        this.flags = opts.flags || "r";
        this.mode = opts.mode || 0o666;
        this.start = opts.start;
        this.end = opts.end !== undefined ? opts.end : Infinity;
        this.pos = opts.start;
        this.autoClose = opts.autoClose === undefined ? true : Boolean(opts.autoClose);

        if (opts.fs) {
            this[kFs] = opts.fs;
        }

        this.pending = !adoptFd(this, opts.fd);
    }

    _construct(callback) {
        if (this.fd !== null) {
            this.pending = false;
            callback();
            // Node semantics: no 'open' event for pre-opened fds, but 'ready' MUST fire
            nextTick(() => this.emit("ready"));
            return;
        }

        this[kFs].open(
            this.path.toString(),
            this.flags,
            this.mode,
            (err, fd) => {
                if (err) {
                    callback(err);
                    return;
                }
                this.fd = fd;
                this.pending = false;
                callback();
                this.emit("open", this.fd);
                this.emit("ready");
            },
        );
    }

    _read(n) {
        if (this.fd === null) {
            return;
        }

        // Bounded chunk calculation (Node 'end' is inclusive)
        const remaining = this.pos !== undefined
            ? this.end - this.pos + 1
            : this.end - this.bytesRead + 1;
        const toRead = Math.min(n || 65536, remaining);

        if (toRead <= 0) {
            this.push(null);
            return;
        }

        const buffer = Buffer.allocUnsafe(toRead);
        this[kIsPerformingIO] = true;

        this[kFs].read(
            this.fd,
            buffer,
            0,
            toRead,
            this.pos === undefined ? null : this.pos,
            (er, bytesRead) => {
                this[kIsPerformingIO] = false;

                if (this.destroyed) {
                    this.emit(kIoDone, er);
                    return;
                }

                if (er) {
                    this.destroy(er);
                    return;
                }

                if (bytesRead > 0) {
                    this.bytesRead += bytesRead;
                    if (this.pos !== undefined) {
                        this.pos += bytesRead;
                    }
                    this.push(buffer.subarray(0, bytesRead));
                } else {
                    this.push(null);
                }
            },
        );
    }

    _destroy(err, cb) {
        if (this[kIsPerformingIO]) {
            this.once(kIoDone, (er) => closeStream(this, err || er, cb));
        } else {
            closeStream(this, err, cb);
        }
    }

    close(cb) {
        if (typeof cb === "function") {
            if (this.closed) {
                nextTick(cb);
                return;
            }
            this.once("close", cb);
        }
        this.destroy();
    }
}

export function createReadStream(path, options) {
    return new ReadStream(path, options);
}

export default {
    ReadStream,
    WriteStream,
    WriteStreamClass,
    createReadStream,
    createWriteStream,
};