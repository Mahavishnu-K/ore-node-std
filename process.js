// Node.js 'process' compatibility module for WASI / QuickJS.

import EventEmitter from './events.js';

// Environment and runtime identifiers.
const title = 'wasmedge_quickjs';
const arch = 'wasm';
const platform = 'linux';
const version = 'v18.20.0';
const versions = {
  node: '18.20.0',
  v8: '0.0.0',
  wasm: '1.0',
  modules: '108',
  quickjs: '2021-03-27'
};

const release = {
  name: 'node',
  sourceUrl: '',
  headersUrl: '',
  libUrl: '',
};

// Process I/O streams and execution arguments.
const env = {
  FORCE_COLOR: '1',
  ...(globalThis.env || {})
};
const argv = globalThis.argv || globalThis.args || ['wasmedge-quickjs', '/ore_tmp/inception.js'];
const execArgv = [];
const argv0 = 'wasmedge-quickjs';
const execPath = '/usr/local/bin/wasmedge';
const pid = 1000;
const ppid = 999;
const debugPort = 9229;

const createStdStream = (fd) => ({
  fd,
  isTTY: true,
  columns: 80,
  rows: 24,
  getWindowSize: () => [80, 24],
  hasColors: (count = 16) => true, // Announces color support (16, 256, truecolor)
  getColorDepth: () => 8,          // 8-bit depth (256 colors). Use 24 for TrueColor
  write: (chunk) => {
    const str = typeof chunk === 'string' ? chunk : (chunk ? chunk.toString() : '');
    print(str);
    return true;
  },
  on: () => {},
  once: () => {},
  emit: () => false,
  end: () => {}
});

const stdout = createStdStream(1);
const stderr = createStdStream(2);
const stdin = createStdStream(0);

// Microtask scheduling and high-resolution performance timers.
const nextTick = (fn, ...args) => {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(() => fn(...args));
  } else {
    Promise.resolve().then(() => fn(...args));
  }
};

const _performance = {
  now: undefined,
  timing: undefined,
};
if (_performance.now === undefined) {
  const nowOffset = Date.now();
  _performance.now = function () { return Date.now() - nowOffset; };
}

const uptime = () => _performance.now() / 1000;

const nanoPerSec = 1000000000;
function hrtime(previousTimestamp) {
  const clocktime = _performance.now() * 1e-3;
  let seconds = Math.floor(clocktime);
  let nanoseconds = Math.floor((clocktime % 1) * 1e9);
  if (previousTimestamp) {
    seconds = seconds - previousTimestamp[0];
    nanoseconds = nanoseconds - previousTimestamp[1];
    if (nanoseconds < 0) {
      seconds--;
      nanoseconds += nanoPerSec;
    }
  }
  return [seconds, nanoseconds];
}

hrtime.bigint = function (time) {
  const diff = hrtime(time);
  if (typeof BigInt === 'undefined') {
    return diff[0] * nanoPerSec + diff[1];
  }
  return BigInt(diff[0] * nanoPerSec) + BigInt(diff[1]);
};

// Resource metrics and filesystem context.
const cwd = () => '/ore_tmp';
const chdir = () => {};
const umask = () => 0;

const memoryUsage = () => ({
  rss: 32 * 1024 * 1024,
  heapTotal: 16 * 1024 * 1024,
  heapUsed: 8 * 1024 * 1024,
  external: 0,
  arrayBuffers: 0
});
memoryUsage.rss = () => memoryUsage().rss;

const cpuUsage = () => ({
  user: 1000,
  system: 500
});
const resourceUsage = () => ({
  ...cpuUsage(),
  maxRSS: 32768,
});

// Stubs for legacy Node features
const noop = () => {};
const _rawDebug = noop;
const moduleLoadList = [];
const config = {};
const domain = {};
const _preload_modules = [];
const allowedNodeEnvironmentFlags = new Set();
const features = {
  inspector: false,
  debug: false,
  uv: false,
  ipv6: false,
  tls_alpn: false,
  tls_sni: false,
  tls_ocsp: false,
  tls: false,
  cached_builtins: true,
};

// Process EventEmitter implementation.
class Process extends EventEmitter {
  constructor() {
    super();
    this[Symbol.toStringTag] = 'process';
    this.title = title;
    this.arch = arch;
    this.platform = platform;
    this.version = version;
    this.versions = versions;
    this.release = release;
    this.argv = argv;
    this.argv0 = argv0;
    this.execArgv = execArgv;
    this.execPath = execPath;
    this.env = env;
    this.pid = pid;
    this.ppid = ppid;
    this.debugPort = debugPort;
    this.stdout = stdout;
    this.stderr = stderr;
    this.stdin = stdin;
    this.nextTick = nextTick;
    this.hrtime = hrtime;
    this.uptime = uptime;
    this.cwd = cwd;
    this.chdir = chdir;
    this.umask = umask;
    this.memoryUsage = memoryUsage;
    this.cpuUsage = cpuUsage;
    this.resourceUsage = resourceUsage;
    this.features = features;
    this.config = config;
    this.domain = domain;
    this._preload_modules = _preload_modules;
    this.moduleLoadList = moduleLoadList;
    this.allowedNodeEnvironmentFlags = allowedNodeEnvironmentFlags;
    this._exiting = false;
    this.exitCode = undefined;
  }

  emitWarning(message, type) {
    print(`[WARNING] ${type ? type + ': ' : ''}${message}`);
  }

  exit(code = this.exitCode ?? 0) {
    this.exitCode = code;
    this._exiting = true;
    
    // Run registered exit listeners before stopping execution
    try {
        this.emit('exit', code);
    } catch (_) {}

    if (typeof globalThis.exit === 'function') {
        globalThis.exit(code);
    }
  }

  reallyExit(code = 0) {
    this.exit(code);
  }

  abort() {
    this.exit(1);
  }

  kill(_pid, _sig) {
    return true;
  }

  openStdin() {
    return stdin;
  }

  assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion error');
  }

  binding(_name) {
    throw new Error('process.binding is not supported in WASM');
  }

  _linkedBinding(_name) {
    throw new Error('process._linkedBinding is not supported in WASM');
  }

  dlopen(_mod, _filename) {
    throw new Error('process.dlopen is forbidden in the WASM Sandbox');
  }

  _getActiveRequests() { return []; }
  _getActiveHandles() { return []; }
  _tickCallback() {}
  _debugProcess() {}
  _debugEnd() {}
  _startProfilerIdleNotifier() {}
  _stopProfilerIdleNotifier() {}
  setUncaughtExceptionCaptureCallback() {}
  hasUncaughtExceptionCaptureCallback() { return false; }
  setSourceMapsEnabled() {}
}

// Process singleton instance.
const process = new Process();

process.off = process.removeListener;

// Node.js self-reference quirk (process.process === process)
process.process = process;

if (typeof globalThis.process === 'undefined') {
  globalThis.process = process;
}

// Pre-bound named exports for detached invocation.
const emitWarning = process.emitWarning.bind(process);
const exit = process.exit.bind(process);
const reallyExit = process.reallyExit.bind(process);
const abort = process.abort.bind(process);
const kill = process.kill.bind(process);
const _kill = kill;
const openStdin = process.openStdin.bind(process);
const assert = process.assert.bind(process);
const binding = process.binding.bind(process);
const _linkedBinding = process._linkedBinding.bind(process);
const dlopen = process.dlopen.bind(process);

// EventEmitter methods
const addListener = process.addListener.bind(process);
const on = process.on.bind(process);
const once = process.once.bind(process);
const off = (ev, fn) => (process.off ? process.off(ev, fn) : process.removeListener(ev, fn));
const removeListener = process.removeListener.bind(process);
const removeAllListeners = process.removeAllListeners.bind(process);
const emit = process.emit.bind(process);
const prependListener = process.prependListener.bind(process);
const prependOnceListener = process.prependOnceListener.bind(process);
const listeners = process.listeners.bind(process);
const listenerCount = process.listenerCount.bind(process);
const eventNames = process.eventNames.bind(process);

// Stubs
const _getActiveHandles = process._getActiveHandles.bind(process);
const _getActiveRequests = process._getActiveRequests.bind(process);
const _tickCallback = process._tickCallback.bind(process);
const _debugProcess = process._debugProcess.bind(process);
const _debugEnd = process._debugEnd.bind(process);
const _startProfilerIdleNotifier = process._startProfilerIdleNotifier.bind(process);
const _stopProfilerIdleNotifier = process._stopProfilerIdleNotifier.bind(process);
const setUncaughtExceptionCaptureCallback = process.setUncaughtExceptionCaptureCallback.bind(process);
const hasUncaughtExceptionCaptureCallback = process.hasUncaughtExceptionCaptureCallback.bind(process);
const setSourceMapsEnabled = process.setSourceMapsEnabled.bind(process);
const _fatalExceptions = noop;
const _exiting = false;

// Default export
export default process;

var _events = {};
var _eventsCount = 0;
// Named exports (Both the instance and all properties)
export {
  process,
  _debugEnd,
  _debugProcess,
  _events,
  _eventsCount,
  _exiting,
  _fatalExceptions,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _linkedBinding,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert,
  binding,
  chdir,
  config,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  features,
  hasUncaughtExceptionCaptureCallback,
  hrtime,
  kill,
  listenerCount,
  listeners,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  reallyExit,
  release,
  removeAllListeners,
  removeListener,
  resourceUsage,
  setSourceMapsEnabled,
  setUncaughtExceptionCaptureCallback,
  stderr,
  stdin,
  stdout,
  title,
  umask,
  uptime,
  version,
  versions
};