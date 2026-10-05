// Node.js 'fs' compatibility module for WASI / QuickJS.
// Uses synchronous QuickJS C primitives ('std' and 'os') for POSIX file operations.

import * as std from 'std';
import * as os from 'os';
import { Buffer } from './buffer.js';
import { Readable, Writable } from './stream.js';

// File access constants and stats indicators.
export const F_OK = 0;
export const X_OK = 1;
export const W_OK = 2;
export const R_OK = 4;

export const constants = {
    F_OK,
    R_OK,
    W_OK,
    X_OK,
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    O_CREAT: 64,
    O_EXCL: 128,
    O_TRUNC: 512,
    O_APPEND: 1024,
};

const S_IFMT   = 0o170000;
const S_IFREG  = 0o100000;
const S_IFDIR  = 0o040000;
const S_IFCHR  = 0o020000;
const S_IFBLK  = 0o060000;
const S_IFIFO  = 0o010000;
const S_IFLNK  = 0o120000;
const S_IFSOCK = 0o140000;

export class Stats {
    constructor(raw = {}) {
        this.dev = raw.dev || 0;
        this.ino = raw.ino || 0;
        this.mode = raw.mode || S_IFREG | 0o666;
        this.nlink = raw.nlink || 1;
        this.uid = raw.uid || 0;
        this.gid = raw.gid || 0;
        this.rdev = raw.rdev || 0;
        this.size = raw.size || 0;
        this.blksize = raw.blksize || 4096;
        this.blocks = raw.blocks || Math.ceil(this.size / 512);

        const mtime = raw.mtime ? (raw.mtime > 1e11 ? raw.mtime : raw.mtime * 1000) : Date.now();
        const atime = raw.atime ? (raw.atime > 1e11 ? raw.atime : raw.atime * 1000) : mtime;
        const ctime = raw.ctime ? (raw.ctime > 1e11 ? raw.ctime : raw.ctime * 1000) : mtime;

        this.atimeMs = atime;
        this.mtimeMs = mtime;
        this.ctimeMs = ctime;
        this.birthtimeMs = ctime;

        this.atime = new Date(atime);
        this.mtime = new Date(mtime);
        this.ctime = new Date(ctime);
        this.birthtime = new Date(ctime);
    }

    isFile() { return (this.mode & S_IFMT) === S_IFREG; }
    isDirectory() { return (this.mode & S_IFMT) === S_IFDIR; }
    isSymbolicLink() { return (this.mode & S_IFMT) === S_IFLNK; }
    isBlockDevice() { return (this.mode & S_IFMT) === S_IFBLK; }
    isCharacterDevice() { return (this.mode & S_IFMT) === S_IFCHR; }
    isFIFO() { return (this.mode & S_IFMT) === S_IFIFO; }
    isSocket() { return (this.mode & S_IFMT) === S_IFSOCK; }
}

export class Dirent {
    constructor(name, isDir, isFile) {
        this.name = name;
        this._isDir = isDir;
        this._isFile = isFile;
    }
    isDirectory() { return this._isDir; }
    isFile() { return this._isFile; }
    isSymbolicLink() { return false; }
    isBlockDevice() { return false; }
    isCharacterDevice() { return false; }
    isFIFO() { return false; }
    isSocket() { return false; }
}

// Synchronous file operations.
export function existsSync(path) {
    try {
        if (os && os.stat) {
            const res = os.stat(path);
            if (Array.isArray(res)) return res[1] === 0;
            return !!res;
        }
        const f = std.open(path, "rb");
        if (f !== null) {
            f.close();
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}

export function statSync(path, options = {}) {
    let raw = null;
    if (os && os.stat) {
        const res = os.stat(path);
        if (Array.isArray(res)) {
            if (res[1] === 0) raw = res[0];
        } else if (res) {
            raw = res;
        }
    }
    if (!raw) {
        const f = std.open(path, "rb");
        if (!f) {
            if (options.throwIfNoEntry === false) return undefined;
            throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
        }
        f.seek(0, std.SEEK_END);
        const size = Math.max(0, f.tell());
        f.close();
        raw = { mode: S_IFREG | 0o666, size: size, mtime: Date.now() };
    }
    return new Stats(raw);
}

export const lstatSync = statSync;

export function readFileSync(path, options) {
    let encoding = null;
    if (typeof options === 'string') encoding = options;
    else if (options && typeof options === 'object') encoding = options.encoding;

    const file = std.open(path, "rb");
    if (!file) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    try {
        file.seek(0, std.SEEK_END);
        const size = Math.max(0, file.tell());
        file.seek(0, std.SEEK_SET);

        const arrayBuf = new ArrayBuffer(size);
        file.read(arrayBuf, 0, size);

        const buf = Buffer.from(arrayBuf);
        if (encoding) {
            return buf.toString(encoding);
        }
        return buf;
    } finally {
        file.close();
    }
}

export function writeFileSync(path, data, options) {
    let mode = "wb";
    if (options) {
        const flag = typeof options === 'string' ? options : options.flag;
        if (flag === 'a' || flag === 'a+' || flag === 1089) {
            mode = "ab";
        }
    }

    const file = std.open(path, mode);
    if (!file) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    try {
        if (typeof data === 'string') {
            let encoding = 'utf8';
            if (options) {
                encoding = typeof options === 'string' ? options : (options.encoding || 'utf8');
            }
            if (encoding === 'utf8' || encoding === 'utf-8') {
                file.puts(data);
            } else {
                const buf = Buffer.from(data, encoding);
                file.write(buf.buffer, buf.byteOffset, buf.byteLength);
            }
        } else if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
            file.write(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof ArrayBuffer) {
            file.write(data, 0, data.byteLength);
        } else {
            file.puts(String(data));
        }
    } finally {
        file.close();
    }
}

export function appendFileSync(path, data, options) {
    const opts = typeof options === 'string' ? { encoding: options } : (options || {});
    return writeFileSync(path, data, { ...opts, flag: 'a' });
}

export function mkdirSync(path, options) {
    const recursive = options && (options.recursive === true || typeof options === 'boolean' && options);
    
    if (!recursive) {
        if (os && os.mkdir) {
            const err = os.mkdir(path, 0o777);
            if (err !== 0 && err !== undefined) {
                throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
            }
        }
        return path;
    }

    // Recursive directory creation
    const parts = path.split(/[\/\\]/);
    let current = path.startsWith('/') ? '/' : '';
    for (const part of parts) {
        if (!part) continue;
        current = current ? (current === '/' ? `/${part}` : `${current}/${part}`) : part;
        if (!existsSync(current)) {
            if (os && os.mkdir) {
                os.mkdir(current, 0o777);
            }
        }
    }
    return path;
}

export function readdirSync(path, options) {
    const withFileTypes = options && typeof options === 'object' && !!options.withFileTypes;

    let list = null;
    if (os && os.readdir) {
        const res = os.readdir(path);
        if (Array.isArray(res)) {
            if (res.length === 2 && typeof res[1] === 'number') {
                if (res[1] === 0) list = res[0];
            } else {
                list = res;
            }
        }
    }

    if (!list) {
        throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    list = list.filter(item => item !== '.' && item !== '..');

    if (!withFileTypes) {
        return list;
    }

    return list.map(name => {
        const full = path.endsWith('/') ? `${path}${name}` : `${path}/${name}`;
        let isDir = false;
        let isFile = true;
        try {
            const st = statSync(full, { throwIfNoEntry: false });
            if (st) {
                isDir = st.isDirectory();
                isFile = st.isFile();
            }
        } catch (_) {}
        return new Dirent(name, isDir, isFile);
    });
}

export function unlinkSync(path) {
    if (os && (os.unlink || os.remove)) {
        const fn = os.unlink || os.remove;
        const res = fn(path);
        if (res !== 0 && res !== undefined) {
            throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
        }
        return;
    }
    throw new Error(`unlinkSync not supported on this platform`);
}

export function rmSync(path, options = {}) {
    if (!existsSync(path)) {
        if (options.force) return;
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    const st = statSync(path, { throwIfNoEntry: false });
    if (st && st.isDirectory()) {
        if (options.recursive) {
            const entries = readdirSync(path);
            for (const entry of entries) {
                const child = path.endsWith('/') ? `${path}${entry}` : `${path}/${entry}`;
                rmSync(child, options);
            }
        }
        if (os && (os.rmdir || os.remove)) {
            const fn = os.rmdir || os.remove;
            fn(path);
        }
    } else {
        unlinkSync(path);
    }
}

export const rmdirSync = rmSync;

export function renameSync(oldPath, newPath) {
    if (os && os.rename) {
        const res = os.rename(oldPath, newPath);
        if (res !== 0 && res !== undefined) {
            throw new Error(`EXDEV: cross-device link not permitted, rename '${oldPath}' -> '${newPath}'`);
        }
        return;
    }
    copyFileSync(oldPath, newPath);
    unlinkSync(oldPath);
}

export function copyFileSync(src, dest) {
    const data = readFileSync(src);
    writeFileSync(dest, data);
}

export const cpSync = copyFileSync;

export function realpathSync(path) {
    if (os && os.realpath) {
        const res = os.realpath(path);
        if (Array.isArray(res)) {
            if (res[1] === 0) return res[0];
        } else if (typeof res === 'string') {
            return res;
        }
    }
    return path;
}

export function accessSync(path, _mode = F_OK) {
    if (!existsSync(path)) {
        throw new Error(`ENOENT: no such file or directory, access '${path}'`);
    }
}

export function opendirSync(path) {
    const entries = readdirSync(path, { withFileTypes: true });
    let idx = 0;
    return {
        path,
        readSync() {
            if (idx < entries.length) return entries[idx++];
            return null;
        },
        closeSync() {}
    };
}

export async function opendir(path) {
    const entries = readdirSync(path, { withFileTypes: true });
    return {
        path,
        async *[Symbol.asyncIterator]() {
            for (const entry of entries) {
                yield entry;
            }
        },
        async close() {}
    };
}

// File descriptor table emulation.
const fileTable = new Map();
let nextFd = 100;

export function openSync(path, flags = 'r', _mode = 0o666) {
    let stdMode = 'rb';

    // Universal string and numeric flag handler
    if (typeof flags === 'number') {
        if ((flags & 512) || (flags & 64) || (flags & 1) || (flags & 577)) stdMode = 'wb+';
        else if ((flags & 1024) || (flags & 1089)) stdMode = 'ab+';
        else if (flags & 2) stdMode = 'rb+';
    } else if (typeof flags === 'string') {
        if (flags.startsWith('w')) stdMode = 'wb+';
        else if (flags.startsWith('a')) stdMode = 'ab+';
        else if (flags.includes('+')) stdMode = 'rb+';
    }

    const file = std.open(path, stdMode);
    if (!file) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    const fd = nextFd++;
    fileTable.set(fd, { file, path });
    return fd;
}

export function closeSync(fd) {
    const entry = fileTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor, close`);
    entry.file.close();
    fileTable.delete(fd);
}

export function writeSync(fd, buffer, offset = 0, length, position) {
    const entry = fileTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor, write`);
    const file = entry.file;

    if (typeof buffer === 'string') {
        file.puts(buffer);
        return buffer.length;
    }

    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const len = length !== undefined ? length : buf.byteLength - offset;
    if (position !== undefined && position !== null && position !== -1) {
        file.seek(position, std.SEEK_SET);
    }
    file.write(buf.buffer, buf.byteOffset + offset, len);
    return len;
}

export function readSync(fd, buffer, offset = 0, length, position) {
    const entry = fileTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor, read`);
    const file = entry.file;
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const len = length !== undefined ? length : buf.byteLength - offset;
    if (position !== undefined && position !== null && position !== -1) {
        file.seek(position, std.SEEK_SET);
    }
    return file.read(buf.buffer, buf.byteOffset + offset, len);
}

export function fstatSync(fd) {
    const entry = fileTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor, fstat`);
    return statSync(entry.path);
}

export function truncateSync(path, len = 0) {
    const data = readFileSync(path);
    const slice = data.subarray(0, len);
    writeFileSync(path, slice);
}

export function ftruncateSync(fd, len = 0) {
    const entry = fileTable.get(fd);
    if (!entry) throw new Error(`EBADF: bad file descriptor, ftruncate`);
    truncateSync(entry.path, len);
}

// Streaming file I/O implementations.
export class ReadStream extends Readable {
    constructor(path, options = {}) {
        super(options);
        this.path = path;
        this.fd = null;
        this.end = options.end !== undefined ? options.end : Infinity;
        this.pos = options.start || 0;
    }

    _read(size) {
        if (!this.fd) {
            this.fd = std.open(this.path, "rb");
            if (!this.fd) {
                this.destroy(new Error(`ENOENT: no such file or directory, open '${this.path}'`));
                return;
            }
            if (this.pos > 0) this.fd.seek(this.pos, std.SEEK_SET);
        }
        
        let toRead = Math.min(size || 65536, this.end - this.pos + 1);
        if (toRead <= 0) {
            this.push(null);
            return;
        }

        let buf = new ArrayBuffer(toRead);
        let bytesRead = this.fd.read(buf, 0, toRead);
        
        if (bytesRead === 0) {
            this.push(null);
            this.fd.close();
            this.fd = null;
        } else {
            this.pos += bytesRead;
            this.push(Buffer.from(buf.slice(0, bytesRead)));
        }
    }

    _destroy(err, cb) {
        if (this.fd) {
            this.fd.close();
            this.fd = null;
        }
        if (cb) cb(err);
    }
}

export class WriteStream extends Writable {
    constructor(path, options = {}) {
        super(options);
        this.path = path;
        this.fd = null;
        
        let flags = options.flags || 'w';
        this.mode = "wb";
        if (flags === 'a' || flags === 'a+' || flags === 1089) {
            this.mode = "ab";
        } else if (flags === 'r+' || flags === 2) {
            this.mode = "rb+";
        }
    }

    _write(chunk, encoding, callback) {
        if (!this.fd) {
            this.fd = std.open(this.path, this.mode);
            if (!this.fd) {
                return callback(new Error(`ENOENT: no such file or directory, open '${this.path}'`));
            }
        }
        
        let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        this.fd.write(buf.buffer, buf.byteOffset, buf.byteLength);
        callback();
    }

    _final(callback) {
        if (this.fd) {
            this.fd.close();
            this.fd = null;
        }
        callback();
    }

    _destroy(err, cb) {
        if (this.fd) {
            this.fd.close();
            this.fd = null;
        }
        if (cb) cb(err);
    }
}

export function createReadStream(path, options) {
    return new ReadStream(path, options);
}

export function createWriteStream(path, options) {
    return new WriteStream(path, options);
}

// Symbolic link operations.
export function readlinkSync(path) {
    if (os && os.readlink) {
        const res = os.readlink(path);
        if (Array.isArray(res)) {
            if (res[1] === 0) return res[0];
            throw new Error(`ENOENT: no such file or directory, readlink '${path}'`);
        } else if (typeof res === 'string') {
            return res;
        }
    }
    throw new Error(`ENOSYS: function not implemented, readlink '${path}'`);
}

export function symlinkSync(target, path, _type) {
    if (os && os.symlink) {
        const res = os.symlink(target, path);
        if (res === 0 || res === undefined) return;
        throw new Error(`EPERM: operation not permitted, symlink '${target}' -> '${path}'`);
    }
    // Fallback: If host WASI sandbox denies symlink creation, copy content directly
    copyFileSync(target, path);
}

// POSIX permissions and metadata stubs.
export function chmodSync() {}
export function chownSync() {}
export function fchmodSync() {}
export function fchownSync() {}
export function utimesSync() {}
export function futimesSync() {}

// Asynchronous callback shims.
function makeAsync(syncFn) {
    return (...args) => {
        const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        try {
            const result = syncFn(...args);
            if (cb) setTimeout(() => cb(null, result), 0);
        } catch (err) {
            if (cb) setTimeout(() => cb(err), 0);
            else throw err;
        }
    };
}

export const exists = (path, cb) => setTimeout(() => cb && cb(existsSync(path)), 0);
export const stat = makeAsync(statSync);
export const lstat = makeAsync(lstatSync);
export const fstat = makeAsync(fstatSync);
export const readFile = makeAsync(readFileSync);
export const writeFile = makeAsync(writeFileSync);
export const appendFile = makeAsync(appendFileSync);
export const mkdir = makeAsync(mkdirSync);
export const readdir = makeAsync(readdirSync);
export const unlink = makeAsync(unlinkSync);
export const rm = makeAsync(rmSync);
export const rmdir = makeAsync(rmdirSync);
export const rename = makeAsync(renameSync);
export const copyFile = makeAsync(copyFileSync);
export const cp = makeAsync(copyFileSync);
export const realpath = makeAsync(realpathSync);
export const access = makeAsync(accessSync);
export const open = makeAsync(openSync);
export const close = makeAsync(closeSync);
export const read = makeAsync(readSync);
export const write = makeAsync(writeSync);
export const truncate = makeAsync(truncateSync);
export const ftruncate = makeAsync(ftruncateSync);
export const chmod = makeAsync(chmodSync);
export const chown = makeAsync(chownSync);
export const readlink = makeAsync(readlinkSync);
export const symlink = makeAsync(symlinkSync);
export const utimes = makeAsync(utimesSync);
export const futimes = makeAsync(futimesSync);

// Promise-based filesystem API (fs/promises).
export const promises = {
    constants,
    readFile: async (...args) => readFileSync(...args),
    writeFile: async (...args) => writeFileSync(...args),
    appendFile: async (...args) => appendFileSync(...args),
    readdir: async (...args) => readdirSync(...args),
    mkdir: async (...args) => mkdirSync(...args),
    rmdir: async (...args) => rmdirSync(...args),
    rm: async (...args) => rmSync(...args),
    unlink: async (...args) => unlinkSync(...args),
    rename: async (...args) => renameSync(...args),
    copyFile: async (...args) => copyFileSync(...args),
    cp: async (...args) => copyFileSync(...args),
    stat: async (...args) => statSync(...args),
    lstat: async (...args) => lstatSync(...args),
    access: async (...args) => accessSync(...args),
    realpath: async (...args) => realpathSync(...args),
    truncate: async (...args) => truncateSync(...args),
    readlink: async (...args) => readlinkSync(...args),
    symlink: async (...args) => symlinkSync(...args),
    chmod: async (path, mode) => chmodSync(path, mode),
    utimes: async (path, atime, mtime) => utimesSync(path, atime, mtime),
    opendir: async (path) => opendir(path),
    open: async (path, flags, mode) => {
        const fd = openSync(path, flags, mode);
        return {
            fd,
            read: async (...a) => readSync(fd, ...a),
            write: async (...a) => writeSync(fd, ...a),
            readFile: async (opts) => readFileSync(path, opts),
            writeFile: async (data, opts) => writeFileSync(path, data, opts),
            stat: async () => fstatSync(fd),
            truncate: async (len) => ftruncateSync(fd, len),
            close: async () => closeSync(fd)
        };
    }
};

// Module exports.
export default {
    F_OK,
    R_OK,
    W_OK,
    X_OK,
    constants,
    Stats,
    Dirent,
    // Streams
    ReadStream,
    WriteStream,
    createReadStream,
    createWriteStream,
    // Sync
    existsSync,
    statSync,
    lstatSync,
    fstatSync,
    readFileSync,
    readlinkSync,
    symlinkSync,
    writeFileSync,
    appendFileSync,
    mkdirSync,
    readdirSync,
    unlinkSync,
    rmSync,
    rmdirSync,
    renameSync,
    copyFileSync,
    cpSync,
    realpathSync,
    accessSync,
    opendirSync,
    openSync,
    closeSync,
    readSync,
    writeSync,
    truncateSync,
    ftruncateSync,
    chmodSync,
    chownSync,
    // Callbacks
    exists,
    stat,
    lstat,
    fstat,
    readFile,
    writeFile,
    appendFile,
    mkdir,
    opendir,
    readdir,
    unlink,
    rm,
    rmdir,
    rename,
    readlink,
    symlink,
    copyFile,
    cp,
    realpath,
    access,
    open,
    close,
    read,
    write,
    truncate,
    ftruncate,
    chmod,
    chown,
    utimes,
    // Promises
    promises,
};