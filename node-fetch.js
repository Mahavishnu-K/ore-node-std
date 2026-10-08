// High-performance node-fetch compatibility module for WasmEdge / QuickJS.
// Seamlessly routes fetch(), Headers, Request, and Response to the native environment
// without the overhead or stream-inversion deadlocks of npm node-fetch.

import * as oreHttp from './http.js';
import { Buffer } from './buffer.js';

export class Headers {
    constructor(init) {
        this._map = new Map();
        if (init) {
            if (init instanceof Headers) {
                init.forEach((val, key) => this.set(key, val));
            } else if (init instanceof Map) {
                for (const [k, v] of init.entries()) this.set(k, v);
            } else if (Array.isArray(init)) {
                for (const [k, v] of init) this.append(k, v);
            } else if (typeof init === 'object') {
                for (const [k, v] of Object.entries(init)) this.set(k, v);
            }
        }
    }

    append(name, value) {
        const k = String(name).toLowerCase();
        const existing = this._map.get(k);
        this._map.set(k, existing ? `${existing}, ${value}` : String(value));
    }

    delete(name) {
        this._map.delete(String(name).toLowerCase());
    }

    get(name) {
        return this._map.get(String(name).toLowerCase()) ?? null;
    }

    has(name) {
        return this._map.has(String(name).toLowerCase());
    }

    set(name, value) {
        this._map.set(String(name).toLowerCase(), String(value));
    }

    forEach(callback, thisArg) {
        for (const [k, v] of this._map.entries()) {
            callback.call(thisArg, v, k, this);
        }
    }

    *keys() {
        yield* this._map.keys();
    }

    *values() {
        yield* this._map.values();
    }

    *entries() {
        yield* this._map.entries();
    }

    [Symbol.iterator]() {
        return this.entries();
    }

    raw() {
        const res = {};
        for (const [k, v] of this._map.entries()) {
            res[k] = [v];
        }
        return res;
    }
}

export class Request {
    constructor(input, init = {}) {
        if (typeof input === 'string') {
            this.url = input;
        } else if (input && input.url) {
            this.url = input.url;
        } else {
            this.url = String(input);
        }

        this.method = (init.method || (input && input.method) || 'GET').toUpperCase();
        this.headers = new Headers(init.headers || (input && input.headers));
        this.body = init.body !== undefined ? init.body : (input && input.body ? input.body : null);
        this.redirect = init.redirect || (input && input.redirect) || 'follow';
        this.signal = init.signal || (input && input.signal) || null;
    }

    clone() {
        return new Request(this.url, {
            method: this.method,
            headers: new Headers(this.headers),
            body: this.body,
            redirect: this.redirect,
            signal: this.signal
        });
    }
}

export class Response {
    constructor(body = null, init = {}) {
        this.status = init.status ?? 200;
        this.statusText = init.statusText ?? 'OK';
        this.ok = this.status >= 200 && this.status < 300;
        this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
        this._body = body;
        this._bodyUsed = false;
    }

    get bodyUsed() {
        return this._bodyUsed;
    }

    async text() {
        this._bodyUsed = true;
        if (this._body == null) return '';
        if (typeof this._body === 'string') return this._body;
        if (this._body instanceof Buffer) return this._body.toString('utf8');
        if (this._body instanceof ArrayBuffer) return Buffer.from(this._body).toString('utf8');
        return String(this._body);
    }

    async json() {
        const str = await this.text();
        return JSON.parse(str);
    }

    async arrayBuffer() {
        this._bodyUsed = true;
        if (this._body == null) return new ArrayBuffer(0);
        if (this._body instanceof ArrayBuffer) return this._body;
        if (this._body instanceof Buffer) {
            return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength);
        }
        const b = Buffer.from(String(this._body));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
}

export class FetchError extends Error {
    constructor(message, type = 'system', systemError) {
        super(message);
        this.name = 'FetchError';
        this.type = type;
        if (systemError) {
            this.code = systemError.code;
            this.errno = systemError.errno;
        }
    }
}

export class AbortError extends Error {
    constructor(message = 'The operation was aborted.') {
        super(message);
        this.name = 'AbortError';
        this.type = 'aborted';
    }
}

export async function fetch(url, options = {}) {
    const fetchFn = globalThis.fetch || oreHttp.fetch;
    const reqUrl = typeof url === 'object' && url.url ? url.url : url;
    
    const rawRes = await fetchFn(reqUrl, options);

    // If native fetch already returned a WHATWG response with json/text methods, wrap it cleanly
    const bodyText = typeof rawRes.text === 'function' ? await rawRes.text() : String(rawRes);

    return new Response(bodyText, {
        status: rawRes.status ?? 200,
        statusText: rawRes.statusText ?? 'OK',
        headers: rawRes.headers
    });
}

fetch.default = fetch;
fetch.Headers = Headers;
fetch.Request = Request;
fetch.Response = Response;
fetch.FetchError = FetchError;
fetch.AbortError = AbortError;
fetch.isRedirect = (code) => [301, 302, 303, 307, 308].includes(code);

export default fetch;
