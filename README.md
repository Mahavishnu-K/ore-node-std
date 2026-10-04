# Pure WASM Node.js Compatibility Layer (`ore-node-std`)

[![ORE Kernel](https://img.shields.io/badge/Core%20System-ORE%20Kernel-6366f1.svg?logo=rust)](https://github.com/Mahavishnu-K/ore-kernel)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](file:///d:/wasm-std-modules/javascript/modules/LICENSE)
[![Engine: Wasmtime](https://img.shields.io/badge/WASM_Engine-Wasmtime%2045%2B-orange.svg)](https://wasmtime.dev/)
[![Spec: WASI Preview 1](https://img.shields.io/badge/Spec-WASI%20P1-purple.svg)](https://wasi.dev/)
[![Runtime: QuickJS](https://img.shields.io/badge/JS%20Engine-QuickJS-brightgreen.svg)](https://bellard.org/quickjs/)
[![Portability: Pure WebAssembly](https://img.shields.io/badge/Portability-100%25%20Pure%20WASM-success.svg)]()
[![Zero Native Addons](https://img.shields.io/badge/Native%20C%2B%2B%20Addons-Zero-red.svg)]()

---

## Executive Summary

Running untrusted, LLM-generated JavaScript/TypeScript code inside multi-agent AI platforms poses a fundamental trade-off: **Security, Speed, and Node.js Ecosystem Compatibility**. 

Traditional runtimes like Node.js or V8/Deno are heavy, consume 50–150 MB of memory per instance, and suffer from slow cold-start latencies that cripple sub-second multi-agent orchestration. Conversely, lightweight WebAssembly engines running embedded engines (such as QuickJS) boast near-instant boot times (~1 ms) and strict sandboxing, but fail catastrophically when executing popular NPM packages (such as `axios`, `node-fetch`, `cheerio`, `form-data`, `zod`, and streaming parsers) due to missing Node.js core modules (`fs`, `http`, `stream`, `crypto`, `buffer`, `process`).

Prior attempts to bridge this gap (such as `wasmedge-quickjs`) introduced **proprietary host-level lock-in**, relying on non-standard C++ host functions (`_node:os`, `_node:crypto`, and proprietary socket extensions) that completely break on standard WebAssembly runtimes like **Wasmtime (WASI Preview 1)**.

**`ore-node-std`** is an engineered, self-contained, pure-JavaScript Node.js compatibility layer rewritten from the ground up to execute securely and deterministically on **standard Wasmtime WASI Preview 1** inside the **[ORE Kernel](https://github.com/Mahavishnu-K/ore-kernel)**. It eliminates all proprietary host bindings, severs foreign V8/Deno primordials, enforces strict POSIX module resolution, provides dual-format CJS/ESM dynamic linking, restores full Node.js stream contracts, and offloads heavy crypto and networking to the host kernel via safe Virtual File System (VFS) portals.

---

## Architecture Specification: Aim & Objectives

```
+-----------------------------------------------------------------------------------+
|                            UNTRUSTED AGENT SCRIPT                                 |
|            (Autonomous LLM Code: Axios, Cheerio, Lodash, Stream Pipelines)        |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
|               DUAL-FORMAT LINKING BRIDGE (cjs_bridge & esbuild)                   |
|       - Normalizes 'node:fs', '/modules/fs.js', 'fs' -> Live Polyfill             |
|       - Microtask NextTick Scheduler & Deadlock-Immune _emptyProxy               |
+-----------------------------------------------------------------------------------+
                                         │
                                         ▼
+-----------------------------------------------------------------------------------+
|                       WASM-STD-MODULES RUNTIME LAYER                              |
|   fs.js        http.js       stream.js      crypto.js      buffer.js    process.js|
|   (Sync C I/O) (Dual Agent)  (Streams3)     (VFS Portal)   (Base64/Hex) (POSIX)   |
+-----------------------------------------------------------------------------------+
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
+---------------------------------------+ +-----------------------------------------+
|     QUICKJS EMBEDDED C MODULES        | |         ORE KERNEL VFS PORTALS          |
|    - 'std' (open, read, write, seek)  | |  - /ore_tmp/.ore_crypto (Rust Crypto)   |
|    - 'os'  (stat, remove, sleep)      | |  - /ore_tmp/.ore_network (Reqwest HTTP) |
+---------------------------------------+ +-----------------------------------------+
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         ▼
+-----------------------------------------------------------------------------------+
|                   WASMTIME SANDBOX (WASI Preview 1 Engine)                        |
|  - Dynamic CPU Fuel Metering (5B instructions)  - Strict Memory Bounds            |
|  - Air-gapped Host Sockets                      - Restricted Preopens (/ore_tmp)  |
+-----------------------------------------------------------------------------------+
```

### Overall Aim
To engineer a self-contained, pure-JavaScript Node.js compatibility runtime (`js_modules/` and `internal/`) that enables untrusted, LLM-generated JavaScript/TypeScript scripts and complex NPM packages (such as `axios`, `node-fetch`, and streaming parsers) to execute securely, deterministically, and with near-zero cold-start latency inside a standard Wasmtime (WASI Preview 1) QuickJS sandbox, completely free of native C++ Node addons, Deno primordials, or proprietary host-runtime plugins.

---

### Technical Objectives

#### Objective 1: Eliminate Runtime Lock-in & Vendor Dependencies
* **Sever Proprietary Host Bindings:** Strip all reliance on WasmEdge-specific C/C++ host functions (`_node:os`, `_node:crypto`, and custom WASI socket extensions) so the runtime executes on vanilla Wasmtime (version 45.0.3+) or any standard WASI Preview 1 engine.
* **Remove Foreign Primordials:** Eliminate leaked Deno/V8 engine dependencies (such as `new SafeMap()`, `String(Deno.pid)`, and `Error.captureStackTrace`) and replace them with standard ECMAScript primitives (`Map`, `Set`, `process.pid`).
* **Ensure Pure Portable WebAssembly:** Keep all polyfills strictly written in standard JavaScript, relying exclusively on QuickJS built-in C libraries (`std` and `os`) for local I/O.

#### Objective 2: Guarantee Deterministic ES Module Resolution
* **Enforce POSIX Strictness (`.js` Extension Normalization):** Rewrite all internal relative import paths (`./`, `../`) across the entire `internal/` directory to include explicit `.js` extensions, preventing QuickJS's literal `fopen()` loader from failing with `ENOENT`.
* **Break Circular Dependency Deadlocks:** Decouple circular import chains (such as `errors.js` $\leftrightarrow$ `inspect.js`) that trigger Temporal Dead Zone (TDZ) `ReferenceError` crashes during top-level module evaluation.
* **Eliminate Top-Level `await` in Foundational Modules:** Ensure all module definitions (`fs.js`, `os.js`, `util.js`) evaluate 100% synchronously. This prevents the module graph from collapsing into an asynchronous Promise that gets swallowed silently by the WASM entrypoint (`_start`).

#### Objective 3: Build a Dual-Format (CJS + ESM) Linking Bridge
* **Universal CommonJS Interception (`cjs_bridge`):** Provide a global `require()` shim on `globalThis` that intercepts dynamic `require(...)` calls emitted by bundled NPM packages.
* **Specifier Normalization:** Transparently strip `node:` prefixes, `/modules/` directory paths, and `.js` extensions so that calls like `require('node:fs')`, `require('/modules/fs.js')`, and `require('fs')` all map to the same live polyfill.
* **Subpath Resolution:** Provide direct access to modern Node subpaths like `fs/promises`, `path/posix`, `stream/promises`, `stream/consumers`, and `util/types`.
* **Deadlock-Immune Fallback Proxy (`_emptyProxy`):** Create a safe recursive proxy for unpolyfilled modules (`tty`, `net`, `tls`, `child_process`, `worker_threads`) that returns `undefined` for `then` (preventing Promise lockups) and `false` for environment feature-checks (`isatty`, `isIP`).

#### Objective 4: Restore Full Node.js Streaming Architecture
* **Global Microtask Scheduler Integration:** Provide a native microtask-backed `nextTick` on `globalThis` so the entire `internal/streams/*` pipeline (`Readable`, `Writable`, `Duplex`, `Transform`, `pipeline`) functions without runtime errors.
* **Full Stream Contract Parity:** Enable `fs.createReadStream`, `fs.createWriteStream`, and HTTP request/response piping (`IncomingMessage` extends `Readable`, `ClientRequest` extends `Writable`), allowing packages like Axios, FormData, and CSV parsers to stream data chunks natively.

#### Objective 5: Maintain Zero-Trust Capabilities & Hardware Portals
* **Hardware-Accelerated Crypto Bridge:** Offload CPU-heavy cryptographic operations (SHA-256, HMAC, PBKDF2, AES-GCM) from QuickJS to the Rust host kernel via the `.ore_crypto` VFS register, preserving Wasmtime CPU fuel.
* **Firewalled Zero-RAM Network Routing:** Route all outgoing HTTP/HTTPS calls through the `.ore_network` VFS portal to the host's `reqwest` client, enforcing manifest domain rules, blocking localhost/SSRF, and streaming response bodies straight to disk.
* **Air-Gapped Sandbox Enclosure:** Block arbitrary outbound sockets and inbound listening servers (`http.createServer()`), ensuring agent scripts remain strictly contained within designated WASI preopens (`/ore_tmp`, `/workspace`).

---

## Why This Matters for Multi-Agent AI Systems

When AI agents autonomously write scripts to solve goals (e.g., scraping an endpoint, validating schemas, parsing CSVs, or computing hashes), they frequently import common NPM packages. The difference between the unoptimized legacy state and the target `wasm-std-modules` runtime is stark:

| Dimension | Without This Rewrite (The Broken State) | With This Rewrite (The Target State) |
| :--- | :--- | :--- |
| **Execution Determinism** | Scripts crash silently with 0 output or cryptic `ENOENT` due to extensionless imports (`./errors`) or missing host modules (`_node:os`). | Deterministic execution with clean `stdout`/`stderr` logging streamed back to the agent controller. |
| **NPM Ecosystem Reach** | LLMs are restricted to simple `fetch()` calls and cannot use popular NPM packages. Dynamic `require` throws runtime errors. | Full compatibility with top-tier packages like **Axios, Node-Fetch, Cheerio, Form-Data, Zod, and Lodash**. |
| **Engine Portability** | Bound to customized WasmEdge runtime builds; immediately breaks on standard Wasmtime, Wasmer, or browser WASM. | **100% portable, standard WebAssembly (WASI Preview 1)** running on vanilla Wasmtime 45+. |
| **Streaming & Memory** | Inability to pipe streams or handle large binary files without RAM exhaustion; no backpressure mechanism. | **True Node.js streaming architecture** with zero-RAM disk-backed VFS caching and proper backpressure. |
| **Cryptographic Cost** | Complex JS crypto algorithms exhaust the agent's Wasmtime CPU instruction fuel limit (5B instructions) in milliseconds. | Heavy hashing, HMAC, and cipher calculations are offloaded to **Rust host kernel cryptography** via zero-fuel VFS portals. |
| **Network Security** | Uncontrolled raw sockets or broken network shims that allow SSRF to internal services or fail entirely under WASI P1. | **Kernel-enforced domain firewall**, method whitelisting, SSRF prevention, and disk-streamed response payloads. |

---

## Deep-Dive Architecture & Core Subsystems

### 1. Dual-Format Linking Bridge & Module Normalization
The runtime integrates directly with the ORE Host Kernel and an ahead-of-time JIT bundler (`esbuild`). When an AI agent specifies NPM dependencies:
1. **Host-Side JIT Resolution:** The ORE Kernel downloads and caches dependencies via npm in `cache/npm/<hash>/`.
2. **ESBuild Transpilation:** The script is bundled into an ESM bundle with aliases redirecting all core Node modules (`fs`, `node:fs`, `http`, etc.) to `/modules/<name>.js`, while marking `/modules/*` as external.
3. **CommonJS Dynamic Bridge (`cjs_bridge`):** Injected at runtime entry, defining a master dynamic linker table `_ore_c_mods` and a global `require()` shim that normalizes all specifier forms:
   ```javascript
   // Universal CommonJS require() Bridge
   globalThis.require = function(name) {
       if (typeof name !== 'string') return _emptyProxy;
       let clean = name.replace(/^node:/, '');
       if (clean.startsWith('/modules/')) {
           clean = clean.slice(9).replace(/\.js$/, '');
       }
       const m = _ore_c_mods[clean] || _ore_c_mods[name];
       if (m) return m.default || m;
       return _emptyProxy;
   };
   ```
4. **Deadlock-Immune Fallback Proxy (`_emptyProxy`):** For unsupported or optional modules (`tty`, `net`, `tls`, `child_process`, `worker_threads`), a recursive proxy is returned. Critically, checking `prop === 'then'` returns `undefined`. This prevents `await require('optional_dep')` from mistaking the proxy for a Thenable Promise, which would freeze the QuickJS event loop indefinitely.

### 2. Hardware-Accelerated Crypto Portal (`.ore_crypto`)
QuickJS lacks native JIT assembly optimization, making SHA-256 rounds or PBKDF2 iterations in pure JS burn millions of Wasmtime fuel units.
* The `crypto.js` polyfill writes a command byte and payload to `/ore_tmp/.ore_crypto/req.bin`.
* A high-efficiency host watcher thread running in Rust detects the request, executes native hardware-accelerated crypto via `ore_core::crypto::KernelCrypto`, and atomically writes the result to `/ore_tmp/.ore_crypto/res.bin`.
* QuickJS yields execution using `os.sleep(1)` (WASI `poll_oneoff`), burning **zero CPU fuel** while awaiting host completion.

### 3. Firewalled Zero-RAM Network Portal (`.ore_network`)
Standard WASI Preview 1 does not standardize arbitrary TCP sockets. `http.js` and `https.js` provide full client parity (`http.request`, `http.get`, `https.request`, and `globalThis.fetch`):
* Requests are serialized to JSON in `/ore_tmp/.ore_network/req_<id>.json`.
* The ORE Kernel network supervisor validates the domain and HTTP method against the agent's manifest whitelist (`allowed_methods`, `domain`).
* Localhost/private IP addresses (`127.0.0.1`, `0.0.0.0`, `localhost`, `[::1]`) are blocked unless explicitly authorized.
* The host downloads the response stream via `reqwest` and pipes it directly to disk (`/ore_tmp/.ore_network/dl_<id>.bin`).
* **Zero RAM Bloat:** The guest receives a file-backed stream (`IncomingMessage`), allowing gigabyte-scale downloads within tiny WASM memory boundaries.

### 4. Deterministic Stream Pipeline (`stream.js`)
Full Streams3 implementation featuring:
* `Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`.
* Modern subpaths: `stream/promises` (`pipeline`, `finished`), `stream/consumers` (`text`, `json`, `buffer`, `arrayBuffer`).
* Microtask-backed `nextTick`: Emulated using `queueMicrotask` to guarantee that stream event listeners (`on('data')`, `on('end')`) are attached synchronously before chunks are emitted.

---

## Repository Layout

```
javascript/modules/
├── _empty.js                 # Fallback deadlock-immune proxy for unsupported Node built-ins
├── assert.js                 # Narwhal-derived Node.js assert & CallTracker implementation
├── buffer.js                 # Production-grade Node.js Buffer polyfill with Base64 & Hex
├── constants.js              # Legacy Node.js constants table (os, fs, crypto, zlib)
├── crypto.js                 # ORE VFS Hardware Crypto Portal + JS fallback
├── encoding.js               # WHATWG TextEncoder & TextDecoder
├── events.js                 # Pure ES Module EventEmitter with captureRejections & symbol support
├── fs.js                     # Synchronous C QuickJS 'std'/'os' backed fs implementation
├── http.js                   # Dual-protocol HTTP/HTTPS client with VFS network streaming
├── os.js                     # Pure POSIX system indicators & constants without host leaks
├── path.js                   # Self-contained POSIX path implementation
├── process.js                # Process identifiers, environment, memory usage, & hrtime
├── punycode.js               # RFC 3492 Punycode / UCS-2 conversion utility
├── querystring.js            # URL query string parser & serializer
├── stream.js                 # Streams3 Readable, Writable, Duplex, & Transform streams
├── string_decoder.js         # Buffer-to-string multi-byte decoder
├── timers.js                 # High-resolution timers, setImmediate, and clear functions
├── url.js                    # Legacy Node.js URL parser
├── util.js                   # Promisify, callbackify, deprecate, inspect, & format utilities
├── whatwg_url.js             # Spec-compliant WHATWG URL and URLSearchParams
├── fmt/
│   └── printf.js             # Formatted string generation utilities
├── fs/
│   └── promises.js           # Full Promise-based fs implementation (fs/promises)
├── internal/
│   ├── assert/               # AssertionError & calltracker helpers
│   ├── crypto/               # HKDF, PBKDF2, scrypt, and key utilities
│   ├── fs/                   # File stream wrappers (createReadStream / createWriteStream)
│   ├── streams/              # Core Streams3 pipeline, buffer list, destroy, & state
│   ├── util/                 # Deep comparisons, inspect, debuglog, & color helpers
│   ├── constants.js          # Internal POSIX error numbers and system flags
│   ├── errors.js             # Node.js standard error codes & formatted exceptions
│   └── validators.js         # Type and argument validators
├── internal_binding/
│   ├── constants.js          # Raw constant bindings
│   ├── util.js               # Binding utility helpers
│   └── uv.js                 # Libuv error code mappings
├── stream/
│   ├── consumers.js          # Modern stream/consumers subpath (text, json, buffer)
│   └── promises.js           # stream/promises pipeline & finished
├── timers/
│   └── promises.js           # timers/promises setTimeout & scheduler
└── util/
    └── types.js              # Comprehensive type checking predicates (util/types)
```

---

## Standard Library Module Coverage

| Module | Subpath / Alias | Backing Engine | Key Capabilities |
| :--- | :--- | :--- | :--- |
| **`fs`** | `node:fs`, `fs/promises` | QuickJS C `std` / `os` | `readFileSync`, `writeFileSync`, `statSync`, `readdirSync`, `unlinkSync`, `mkdirSync`, `copyFileSync`, `createReadStream`, `createWriteStream`, and full `promises.*` API. |
| **`http`** | `node:http`, `https`, `node:https` | ORE Network Portal (`reqwest`) | Dual-protocol client, `http.request`, `http.get`, `https.request`, `IncomingMessage` (Readable stream), `ClientRequest` (Writable stream), agent pooling, global `fetch`. |
| **`stream`** | `node:stream`, `stream/promises`, `stream/consumers` | Pure ES / Microtasks | `Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`, `pipeline`, `finished`, `consumers.text()`, `consumers.json()`. |
| **`crypto`** | `node:crypto` | ORE Hardware Portal + JS | SHA-256, HMAC, PBKDF2, AES-256-CBC, CSPRNG (`randomBytes`), `createHash`, `createHmac`. |
| **`buffer`** | `node:buffer`, `globalThis.Buffer` | Pure JS | `Buffer.from`, `Buffer.alloc`, Base64, Hex, UTF-8, binary conversions, slice, copy, concat. |
| **`process`** | `node:process`, `globalThis.process` | Pure POSIX | `process.env`, `process.argv`, `process.cwd()`, `process.hrtime()`, `process.nextTick()`, `process.memoryUsage()`. |
| **`path`** | `node:path`, `path/posix` | Pure JS | `join`, `resolve`, `normalize`, `dirname`, `basename`, `extname`, `parse`, `format`, `isAbsolute`. |
| **`events`** | `node:events` | Pure JS | `EventEmitter`, `on`, `once`, `emit`, `removeListener`, `captureRejections`, symbol listeners. |
| **`util`** | `node:util`, `util/types` | Pure JS | `promisify`, `callbackify`, `format`, `inspect`, `deprecate`, `types.isPromise`, `types.isUint8Array`. |
| **`os`** | `node:os` | Pure JS Constants | `EOL`, `constants`, `type()`, `platform()`, `arch()`, `homedir()`, `tmpdir()`. |
| **`timers`** | `node:timers`, `timers/promises` | QuickJS / Microtasks | `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `setImmediate`, `promises.setTimeout`. |
| **`assert`** | `node:assert`, `assert/strict` | Pure JS | `assert.strictEqual`, `assert.deepStrictEqual`, `assert.throws`, `AssertionError`, `CallTracker`. |
| **`url`** | `node:url` | Pure JS | WHATWG `URL`, `URLSearchParams`, legacy `url.parse`, `url.format`, `urlToHttpOptions`. |
| **`querystring`**| `node:querystring` | Pure JS | `parse`, `stringify`, `decode`, `encode`. |
| **`string_decoder`**| `node:string_decoder` | Pure JS | Multi-byte UTF-8 and UTF-16 streaming string decoders. |
| **`punycode`** | `node:punycode` | Pure JS | RFC 3492 Punycode encoder, decoder, UCS-2 conversion. |
| **`_empty`** | `tty`, `net`, `tls`, `child_process` | Safe Proxy | Deadlock-free proxy returning `false` for checks (`isatty`) and `undefined` for `then`. |

---

## Integration with the ORE Host Kernel

This standard module library serves as the official JavaScript runtime subsystem for the **[ORE Kernel (sandbox)](https://github.com/Mahavishnu-K/ore-kernel/blob/dev/ore-core/src/sandbox.rs)**.

To embed and execute scripts with this runtime inside a Rust-based Wasmtime sandbox:

```rust
use wasmtime::*;
use wasmtime_wasi::{WasiCtxBuilder, DirPerms, FilePerms};

// 1. Mount the JavaScript standard library to /modules (Strict Read-Only)
let js_modules_dir = ore_base_dir.join("runtimes").join("js_modules");
wasi_builder.preopened_dir(
    &js_modules_dir,
    "/modules",
    DirPerms::READ,
    FilePerms::READ,
)?;

// 2. Mount an ephemeral scratch directory to /ore_tmp (Read/Write)
wasi_builder.preopened_dir(
    &host_tmp_dir,
    "/ore_tmp",
    DirPerms::all(),
    FilePerms::all(),
)?;

// 3. Inform QuickJS and Node module resolution of the modules path
wasi_builder.env("QUICKJS_MODULE_PATH", "/modules");
wasi_builder.env("NODE_PATH", "/modules");

// 4. Configure fuel limits to prevent runaway loops (e.g., 5 Billion instructions)
store.set_fuel(5_000_000_000)?;
```

---

## Upstream Lineage & Acknowledgements

This compatibility layer was developed and curated by **[Mahavishnu K](https://github.com/Mahavishnu-K)** as the official JavaScript standard library runtime powering the **[ORE Sandbox Kernel (ore-kernel)](https://github.com/Mahavishnu-K/ore-kernel)**. 

It builds upon foundational polyfills and modules originating from:
* **[wasmedge-quickjs (modules)](https://github.com/Mahavishnu-K/wasmedge-quickjs)** (originally Second State INC) — heavily refactored to sever WasmEdge host bindings, fix circular dependencies, and adapt to Wasmtime WASI Preview 1.
* **[Node.js](https://github.com/nodejs/node)** (Joyent, Inc. and Node contributors) — reference contracts for `stream`, `fs`, `assert`, `crypto`, and `util`.
* **[Deno Standard Library](https://github.com/denoland/deno_std)** (Deno Authors) — stream mechanics and inspect implementations (primordials replaced with standard ECMAScript).
* **[Narwhal.js](http://narwhaljs.org)** — core assertion algorithms.
* **[Punycode.js](https://github.com/mathiasbynens/punycode.js)** by Mathias Bynens.
* **[base64-js](https://github.com/beatgammit/base64-js)** by T. Jameson Little.
* **[buffer](https://github.com/feross/buffer)** by Feross Aboukhadijeh.
* **[setImmediate](https://github.com/YuzuJS/setImmediate)** by YuzuJS contributors.

For comprehensive copyright notices and license texts, see the [NOTICE](file:///d:/wasm-std-modules/javascript/modules/NOTICE) file.

---

## Contributing

We welcome contributions from systems JavaScript and WebAssembly engineers to help harden, benchmark, and expand this compatibility layer toward 100% production-grade parity. Please review our [Contributing Guidelines](file:///d:/wasm-std-modules/javascript/modules/CONTRIBUTING.md) for architectural invariants, testing practices, and prioritized initiatives.

---

## License

This project is licensed under the **[MIT License](file:///d:/wasm-std-modules/javascript/modules/LICENSE)**.  
Copyright &copy; 2024–2026 **Mahavishnu K <https://github.com/Mahavishnu-K>**. All rights reserved.
