
// Node.js 'os' compatibility module for WASI / QuickJS.

import process from './process.js';

export const EOL = '\n';
export const devNull = '/dev/null';

export const constants = {
    UV_UDP_REUSEADDR: 4,
    dlopen: {
        RTLD_LAZY: 1,
        RTLD_NOW: 2,
        RTLD_GLOBAL: 8,
        RTLD_LOCAL: 4,
    },
    errno: {
        E2BIG: 7,
        EACCES: 13,
        EADDRINUSE: 48,
        EADDRNOTAVAIL: 49,
        EAFNOSUPPORT: 47,
        EAGAIN: 35,
        EALREADY: 37,
        EBADF: 9,
        EBUSY: 16,
        ECONNREFUSED: 61,
        ECONNRESET: 54,
        EEXIST: 17,
        EINVAL: 22,
        EIO: 5,
        EISDIR: 21,
        EMFILE: 24,
        ENOENT: 2,
        ENOMEM: 12,
        ENOSPC: 28,
        ENOSYS: 78,
        ENOTDIR: 20,
        ENOTEMPTY: 66,
        EPERM: 1,
        EPIPE: 32,
        ETIMEDOUT: 60,
    },
    signals: {
        SIGHUP: 1,
        SIGINT: 2,
        SIGQUIT: 3,
        SIGKILL: 9,
        SIGUSR1: 10,
        SIGUSR2: 12,
        SIGTERM: 15,
    },
    priority: {
        PRIORITY_LOW: 19,
        PRIORITY_BELOW_NORMAL: 10,
        PRIORITY_NORMAL: 0,
        PRIORITY_ABOVE_NORMAL: -7,
        PRIORITY_HIGH: -14,
        PRIORITY_HIGHEST: -20,
    }
};

export const arch = () => (typeof process !== 'undefined' && process.arch) || 'wasm';
export const platform = () => (typeof process !== 'undefined' && process.platform) || 'wasi';
export const type = () => 'wasmedge';
export const release = () => (typeof process !== 'undefined' && process.version) || '1.0.0';
export const version = () => (typeof process !== 'undefined' && process.version) || '1.0.0';
export const machine = () => 'wasm32';


export const cpus = () => [
    {
        model: 'WASM Virtual Core',
        speed: 3000,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
    }
];

// Concurrency parallelism limit for worker pools.
export const availableParallelism = () => 1;

export const endianness = () => 'LE';
export const totalmem = () => 4 * 1024 * 1024 * 1024;
export const freemem = () => 2 * 1024 * 1024 * 1024;

export const homedir = () => {
    if (typeof process !== 'undefined' && process.env && process.env.HOME) {
        return process.env.HOME;
    }
    return '/ore_tmp';
};

export const tmpdir = () => {
    if (typeof process !== 'undefined' && process.env) {
        return process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/ore_tmp';
    }
    return '/ore_tmp';
};

export const hostname = () => 'ore-sandbox';
export const networkInterfaces = () => ({});
export const loadavg = () => [0, 0, 0];

export const uptime = () => {
    if (typeof process !== 'undefined' && typeof process.uptime === 'function') {
        return process.uptime();
    }
    return 0;
};

export const getPriority = (_pid = 0) => 0;
export const setPriority = (_pid, _priority) => {};

export const userInfo = (_options = {}) => ({
    uid: 0,
    gid: 0,
    username: 'ore',
    homedir: homedir(),
    shell: null
});


export default {
    EOL,
    devNull,
    constants,
    arch,
    platform,
    type,
    release,
    version,
    machine,
    cpus,
    availableParallelism,
    endianness,
    totalmem,
    freemem,
    homedir,
    tmpdir,
    hostname,
    networkInterfaces,
    loadavg,
    uptime,
    getPriority,
    setPriority,
    userInfo,
};