// Node.js 'http' and 'https' compatibility module for WASI / QuickJS.
// Routes outbound HTTP/HTTPS requests through the .ore_network VFS portal.

import * as std from 'std';
import * as os from 'os';
import { Buffer } from './buffer.js';
import { Readable, Writable } from './stream.js';

export const STATUS_CODES = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'
};

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

// Universal Agent supporting both HTTP and HTTPS protocols.
export class Agent {
    constructor(options = {}) {
        this.options = options;
        this.protocol = options.protocol || undefined;
        this.defaultPort = options.defaultPort || (this.protocol === 'https:' ? 443 : 80);
    }
    destroy() {}
}

export const globalAgent = new Agent();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Monotonic request ID generator.
function generateRequestId() {
    return `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

async function waitDone(doneFilePath) {
    let attempts = 0;
    while (attempts < 3000) {
        try {
            let df = std.open(doneFilePath, "r");
            if (df) {
                df.close();
                return;
            }
        } catch (_) {}
        await sleep(10);
        attempts++;
    }
}

// Polls target response file until completion or timeout.
async function waitForResponse(resFilePath, metaFilePath) {
    let attempts = 0;
    while (attempts < 3000) { // 30-second timeout
        try {
            let f = std.open(resFilePath, "r");
            if (f) {
                f.seek(0, std.SEEK_END);
                let size = f.tell();
                f.seek(0, std.SEEK_SET);
                
                if (size > 0) {
                    let buffer = new ArrayBuffer(size);
                    f.read(buffer, 0, size);
                    f.close();
                    
                    // Clean up response file from VFS
                    try {
                        if (os && (os.remove || os.unlink)) {
                            (os.remove || os.unlink)(resFilePath);
                        } else {
                            let clear = std.open(resFilePath, "w");
                            if (clear) clear.close();
                        }
                    } catch (_) {}

                    // Read metadata if available
                    let meta = {};
                    if (metaFilePath) {
                        try {
                            let mf = std.open(metaFilePath, "r");
                            if (mf) {
                                mf.seek(0, std.SEEK_END);
                                let msize = mf.tell();
                                mf.seek(0, std.SEEK_SET);
                                if (msize > 0) {
                                    let mbuf = new ArrayBuffer(msize);
                                    mf.read(mbuf, 0, msize);
                                    let mstr = Buffer.from(mbuf).toString('utf8');
                                    meta = JSON.parse(mstr);
                                }
                                mf.close();
                                try {
                                    if (os && (os.remove || os.unlink)) {
                                        (os.remove || os.unlink)(metaFilePath);
                                    }
                                } catch (_) {}
                            }
                        } catch (_) {}
                    }
                    
                    return { buffer: Buffer.from(buffer), meta };
                }
                f.close();
            }
        } catch (_) {}
        
        await sleep(10); // Yield execution without consuming CPU fuel
        attempts++;
    }
    throw new Error(`ORE Network Portal Timeout on ${resFilePath}`);
}

export async function fetch(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const reqId = generateRequestId();

    // Dedicated VFS channel per request flight
    const targetFilename = `.ore_network/dl_${reqId}.bin`;
    const reqFilePath = `/ore_tmp/.ore_network/req_${reqId}.json`;
    const resFilePath = `/ore_tmp/.ore_network/res_${reqId}.bin`;
    const metaFilePath = `/ore_tmp/.ore_network/res_${reqId}.meta`;
    const doneFilePath = `/ore_tmp/${targetFilename}.done`;

    const sanitizedHeaders = Object.assign({}, options.headers || {});
    for (const k of Object.keys(sanitizedHeaders)) {
        if (k.toLowerCase() === 'accept-encoding') {
            delete sanitizedHeaders[k];
        }
    }

    const reqPayload = JSON.stringify({
        method: method,
        url: url.toString(),
        headers: sanitizedHeaders,
        body: options.body ? options.body.toString() : "",
        filename: targetFilename
    });

    let reqFile = std.open(reqFilePath, "w");
    if (!reqFile) throw new Error("ORE Network Portal Unreachable");
    reqFile.puts(reqPayload);
    reqFile.close();

    const { buffer: rawBuffer, meta } = await waitForResponse(resFilePath, metaFilePath);
    const statusChar = rawBuffer.slice(0, 1).toString('utf8');
    const payload = rawBuffer.slice(1);

    if (statusChar !== '0') {
        throw new Error(`ORE Firewall Blocked Request: ${payload.toString('utf8')}`);
    }

    const bodyPath = `/ore_tmp/${targetFilename}`;
    const statusCode = (meta && meta.status) ? meta.status : 200;
    const statusText = (meta && meta.status_text) ? meta.status_text : (STATUS_CODES[statusCode] || 'OK');

    const headersMap = new Map();
    if (meta && meta.headers && typeof meta.headers === 'object') {
        for (const [k, v] of Object.entries(meta.headers)) {
            headersMap.set(k.toLowerCase(), v);
        }
    } else {
        headersMap.set('content-type', 'application/json');
    }

    return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        statusText: statusText,
        headers: headersMap,
        cookies: (meta && meta.cookies) ? meta.cookies : {},
        _bodyPath: bodyPath,
        _donePath: doneFilePath,
        text: async () => {
            await waitDone(doneFilePath);
            return std.loadFile(bodyPath);
        },
        json: async () => {
            await waitDone(doneFilePath);
            return JSON.parse(std.loadFile(bodyPath));
        },
        arrayBuffer: async () => {
            await waitDone(doneFilePath);
            let f = std.open(bodyPath, "rb");
            if (!f) return new ArrayBuffer(0);
            f.seek(0, std.SEEK_END);
            let size = f.tell();
            f.seek(0, std.SEEK_SET);
            let buf = new ArrayBuffer(size);
            f.read(buf, 0, size);
            f.close();
            return buf;
        }
    };
}
globalThis.fetch = fetch;

// IncomingMessage: Readable stream implementation for response payloads with real status & streaming chunks.
export class IncomingMessage extends Readable {
    constructor(bodyPath, statusCode = 200, statusMessage = 'OK', headers = {}) {
        super();
        this.statusCode = statusCode;
        this.statusMessage = statusMessage;
        
        const normHeaders = {};
        const rawHeaders = [];
        if (headers instanceof Map) {
            for (const [k, v] of headers.entries()) {
                normHeaders[k.toLowerCase()] = v;
                rawHeaders.push(k, v);
            }
        } else if (headers && typeof headers === 'object') {
            for (const [k, v] of Object.entries(headers)) {
                normHeaders[k.toLowerCase()] = v;
                rawHeaders.push(k, v);
            }
        } else {
            normHeaders['content-type'] = 'application/json';
            rawHeaders.push('Content-Type', 'application/json');
        }

        this.headers = normHeaders;
        this.rawHeaders = rawHeaders;
        this.bodyPath = bodyPath;
        this.donePath = `${bodyPath}.done`;
        this._reading = false;
        this._offset = 0;
    }

    _read() {
        if (this._reading) return;
        this._reading = true;

        const pump = () => {
            try {
                let f = std.open(this.bodyPath, "rb");
                if (f) {
                    f.seek(0, std.SEEK_END);
                    let total = f.tell();
                    if (total > this._offset) {
                        f.seek(this._offset, std.SEEK_SET);
                        let toRead = total - this._offset;
                        let buf = new ArrayBuffer(toRead);
                        f.read(buf, 0, toRead);
                        f.close();
                        this._offset = total;
                        this.push(Buffer.from(buf));
                    } else {
                        f.close();
                    }
                }
            } catch (_) {}

            let isDone = false;
            try {
                let df = std.open(this.donePath, "r");
                if (df) {
                    isDone = true;
                    df.close();
                }
            } catch (_) {}

            if (isDone) {
                try {
                    let f = std.open(this.bodyPath, "rb");
                    if (f) {
                        f.seek(0, std.SEEK_END);
                        let total = f.tell();
                        if (total > this._offset) {
                            f.seek(this._offset, std.SEEK_SET);
                            let toRead = total - this._offset;
                            let buf = new ArrayBuffer(toRead);
                            f.read(buf, 0, toRead);
                            f.close();
                            this._offset = total;
                            this.push(Buffer.from(buf));
                        } else {
                            f.close();
                        }
                    }
                } catch (_) {}
                this.push(null);
            } else {
                setTimeout(pump, 10);
            }
        };

        pump();
    }
}

// ClientRequest: Writable stream implementation for request payloads.
export class ClientRequest extends Writable {
    constructor(url, options, cb) {
        super({
            autoDestroy: true,
            emitClose: true
        });

        this.options = options || {};
        this.cb = cb;
        this.bodyChunks = [];
        this.headers = Object.assign({}, this.options.headers || {});
        for (const k of Object.keys(this.headers)) {
            if (k.toLowerCase() === 'accept-encoding') {
                delete this.headers[k];
            }
        }

        if (typeof url === 'string') {
            this.url = url;
        } else if (url && url.href) {
            this.url = url.href;
        } else {
            let proto = this.options.protocol || (this.options.port === 443 || this.options.defaultPort === 443 ? 'https:' : 'http:');
            if (!proto.endsWith(':')) proto += ':';
            let host = this.options.hostname || this.options.host || 'localhost';
            let port = '';
            if (this.options.port && !host.includes(':')) {
                const p = String(this.options.port);
                if ((proto === 'http:' && p !== '80') || (proto === 'https:' && p !== '443')) {
                    port = `:${p}`;
                }
            }
            const path = this.options.path || '/';
            this.url = `${proto}//${host}${port}${path}`;
        }
    }

    // Header management methods.
    setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
    }

    getHeader(name) {
        return this.headers[name.toLowerCase()];
    }

    getHeaders() {
        return Object.assign({}, this.headers);
    }

    hasHeader(name) {
        return name.toLowerCase() in this.headers;
    }

    removeHeader(name) {
        delete this.headers[name.toLowerCase()];
    }

    // Connection configuration stubs.
    setTimeout(ms, cb) {
        if (cb) setTimeout(cb, ms);
        return this;
    }
    setNoDelay() { return this; }
    setSocketKeepAlive() { return this; }

    // Receives chunks from .write() or .pipe().
    _write(chunk, encoding, callback) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        this.bodyChunks.push(buf);
        callback();
    }

    // Dispatches request when all data is written and .end() is called.
    _final(callback) {
        const bodyData = this.bodyChunks.length > 0 
            ? Buffer.concat(this.bodyChunks).toString('utf8') 
            : "";

        fetch(this.url, {
            method: this.options.method || 'GET',
            headers: this.headers,
            body: bodyData
        }).then(res => {
            const responseStream = new IncomingMessage(
                res._bodyPath,
                res.status,
                res.statusText,
                res.headers
            );
            if (this.cb) this.cb(responseStream);
            this.emit('response', responseStream);
            callback();
        }).catch(err => {
            this.emit('error', err);
            callback(err);
        });
    }

    abort() { this.destroy(); }
}

export function request(url, options, cb) {
    if (typeof url === 'object' && url !== null && !url.href) {
        cb = options;
        options = url;
        url = null;
    } else if (typeof options === 'function') {
        cb = options;
        options = {};
    }
    return new ClientRequest(url, options, cb);
}

export function get(url, options, cb) {
    const req = request(url, options, cb);
    req.end();
    return req;
}

export function createServer() {
    throw new Error("ORE KERNEL SECURITY: Inbound network servers are forbidden in the WASM Sandbox.");
}
export const Server = createServer;

export default {
    STATUS_CODES,
    METHODS,
    Agent,
    globalAgent,
    fetch,
    request,
    get,
    ClientRequest,
    IncomingMessage,
    createServer,
    Server
};