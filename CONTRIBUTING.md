# Contributing to `ore-node-std`

Thank you for your interest in contributing to `ore-node-std` (the JavaScript standard runtime layer for the [ORE Kernel](https://github.com/Mahavishnu-K/ore-kernel)). 

We are actively calling on **Systems JavaScript Engineers, WebAssembly Specialists, and Runtime Implementers** to help build a deterministic, production-grade, and 100% spec-compliant Node.js compatibility layer running on unmodified QuickJS within Wasmtime (WASI Preview 1).

---

## The Mission

Executing untrusted, AI-generated code and modern NPM packages inside high-density multi-agent sandboxes requires microsecond cold starts, zero native host dependencies, and strict memory safety. 

Existing solutions either pull in a 100 MB+ V8 binary or rely on proprietary host bindings (`_node:os`, `_node:crypto`) that break under standard WASI. Our objective is to engineer a self-contained, pure-JavaScript standard library that bridges the gap between the modern Node.js ecosystem and sandboxed WebAssembly engines.

If you have experience with ECMAScript specifications, Node.js core internals, Libuv emulation, or WebAssembly sandbox constraints, we welcome your contributions.

---

## Core Architectural Invariants

Every contribution must strictly adhere to the following architectural constraints:

### 1. Zero Native Engine Lock-In
* **No Proprietary Host Syscalls:** Code must never rely on vendor-specific C/C++ host imports (e.g., WasmEdge host functions).
* **Vanilla WASI Preview 1 Compatibility:** All code must run on standard Wasmtime (version 45.0.3+) using standard WASI Preview 1 interfaces.
* **No Leaked Engine Primordials:** Never introduce V8 internals or Deno-specific globals (`SafeMap`, `Deno.pid`, etc.). Write clean, standard ECMAScript backed solely by QuickJS's built-in `std` and `os` C modules.

### 2. Strict POSIX Import Resolution
* QuickJS resolves module paths via a literal `fopen()` call on the underlying filesystem.
* **Explicit Extensions Required:** All relative imports within `internal/` and `js_modules/` must include explicit `.js` extensions (e.g., `import { format } from './internal/util.js';`, not `./internal/util`).
* **Zero Top-Level Await in Core Modules:** Core standard library modules (`fs.js`, `os.js`, `path.js`, `util.js`) must evaluate synchronously. Top-level Promises collapse the module graph into an asynchronous task that gets swallowed silently by the WASM `_start` entrypoint.

### 3. Circular Dependency & TDZ Immunity
* Circular imports in ES modules trigger Temporal Dead Zone (TDZ) `ReferenceError` crashes during top-level evaluation.
* Always isolate shared helper routines, error definitions, and symbol registries into independent leaf modules under `internal/`.

### 4. Full Node.js Stream Contract Parity
* All streaming interfaces (`fs.createReadStream`, `http.IncomingMessage`, `crypto` streams) must adhere to the Streams3 contract (`Readable`, `Writable`, `Duplex`, `Transform`).
* Microtask queues (`queueMicrotask`) must be used for asynchronous deferred dispatch (`process.nextTick`) to guarantee that consumer event listeners attach synchronously before data chunks emit.
* Backpressure (`highWaterMark`, `pause()`, `resume()`, `drain`) must be respected to prevent WASM linear memory exhaustion.

### 5. CPU Fuel & Memory Conservation
* Untrusted agent sandboxes run under finite Wasmtime CPU fuel budgets (e.g., 5 Billion instructions).
* Code must avoid unbounded polling, high-allocation busy loops, or heavy mathematical computations that can be offloaded to host VFS registers (`.ore_crypto` and `.ore_network`).

---

## The Host VFS Hardware Portals (`.ore_crypto` and `.ore_network`)

A unique and deliberate architectural pattern in `ore-node-std` is the use of **Host VFS Hardware Portals** for cryptography and networking. Contributors must understand how these work before modifying `crypto.js` or `http.js`:

### Why We Use VFS Portals
1. **No Outbound Sockets in Standard WASI P1:** WASI Preview 1 does not provide standard outbound TCP socket interfaces. Rather than introducing non-standard C++ host functions (which break Wasmtime portability), network requests are marshaled through VFS queues.
2. **Fuel Preservation (Eliminating Pure-JS Math Traps):** QuickJS is an interpreter without a JIT compiler. Running SHA-256 compression rounds, PBKDF2 iterations, or AES cipher rounds in pure JavaScript burns millions of Wasmtime fuel instructions in milliseconds, triggering premature CPU exhaustion traps.

### How the Portals Function
* **The Crypto Portal (`/ore_tmp/.ore_crypto`):**
  - Guest JS (`crypto.js`) writes command bytes and input buffers to `req.bin`.
  - The ORE host kernel watcher thread (in Rust) detects the file, invokes native hardware-accelerated algorithms (`ore_core::crypto::KernelCrypto`), and writes the result atomically to `res.bin`.
  - Guest JS pauses execution using `os.sleep(1)` (which compiles to WASI `poll_oneoff`), releasing host execution and burning **zero CPU fuel** while waiting for the response.
* **The Network Portal (`/ore_tmp/.ore_network`):**
  - Guest JS (`http.js`) serializes requests into concurrent `req_<id>.json` manifests.
  - The ORE host network supervisor validates the domain and method against the agent's firewall manifest, enforces SSRF/localhost blocking, and streams the body via Rust `reqwest` straight to disk (`dl_<id>.bin`).
  - The guest exposes this file through a streaming `IncomingMessage` (Readable stream), achieving true zero-RAM buffering.

### Contributor Invariants for Crypto & Network
* **Do NOT replace VFS calls with pure-JS crypto polyfills.** Pure-JS crypto will exhaust agent instruction quotas.
* **Do NOT assume socket APIs exist.** All network traffic must conform to the portal message schema.
* **Preserve Atomic File Handling:** Always use truncation or temporary file renames (`res.tmp` -> `res.bin`) to prevent phantom reads or Windows file-locking race conditions.

---

## Priority Areas for Contribution

We are currently prioritizing the following engineering initiatives:

1. **Node.js Test Suite Porting:**
   - Adapting tests from `nodejs/node/test/parallel/` to validate module parity inside QuickJS.
   - Establishing automated CI matrices executing tests against Wasmtime CLI.

2. **Stream Subsystem Hardening:**
   - Edge-case handling for `stream/promises` (`pipeline`, `finished`).
   - Binary chunk management in `internal/streams/buffer_list.js`.

3. **Filesystem Edge-Cases (`fs.js` & `fs/promises.js`):**
   - High-fidelity `fs.Stats` calculations using QuickJS `os.stat`.
   - Streaming file reads and writes (`createReadStream` / `createWriteStream`) with chunk chunking and error propagation.

4. **HTTP Client & Parsing Robustness (`http.js`):**
   - Chunked transfer-encoding parsing for disk-backed response streams.
   - Multipart and form-data compatibility with popular HTTP clients (`axios`, `undici`, `node-fetch`).

5. **Fallback Proxy Refinements (`_empty.js`):**
   - Improving graceful no-op behaviors for unpolyfilled modules (`net`, `tls`, `dgram`, `child_process`).
   - Ensuring `thenable` checks universally return `undefined` to prevent async deadlocks.

---

## Development & Contribution Workflow

### Prerequisites
* **Rust & Cargo** (for building and testing with Wasmtime)
* **Wasmtime CLI** (version 45.0.3 or higher)
* **QuickJS WASM binary** compiled for WASI Preview 1
* **Node.js** (for running JIT packaging tests with `esbuild`)

### Submitting Changes

1. **Fork the Repository** and create a feature branch:
   ```bash
   git checkout -b feature/fs-stream-hardening
   ```
2. **Implement Your Changes** adhering to the invariants above.
3. **Verify Pure WASM Compatibility:**
   Execute your changes inside the WASM sandbox environment without host native dependencies.
4. **Maintain Attribution Integrity:**
   If you adapt code or algorithms from open-source repositories (Node.js, Deno, Narwhal, etc.), preserve existing license headers and update the [NOTICE](file:///d:/wasm-std-modules/javascript/modules/NOTICE) file accordingly.
5. **Commit Message Format:**
   Use clear, conventional commit messages:
   ```text
   feat(fs): implement streaming backpressure for createReadStream
   fix(util): decouple inspect circular dependency with errors.js
   perf(buffer): optimize base64 decode lookup table
   ```
6. **Open a Pull Request** describing:
   - The module affected.
   - The specific Node.js API contract implemented or fixed.
   - Evidence of deterministic execution under Wasmtime.

---

## Code of Conduct & Licensing

By contributing to `ore-node-std`, you agree that your contributions will be licensed under the project's [MIT License](file:///d:/wasm-std-modules/javascript/modules/LICENSE) and that you have the right to submit the work under those terms.
