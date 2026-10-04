// js_modules/encoding.js
// Production-grade pure-JS WHATWG TextEncoder & TextDecoder for QuickJS / Wasmtime

import { Buffer } from 'buffer';

const kEnvs = ['utf-8', 'utf8', 'unicode-1-1-utf-8'];

export class TextEncoder {
    get encoding() {
        return 'utf-8';
    }

    encode(input = '') {
        const str = typeof input === 'string' ? input : String(input);
        const buf = Buffer.from(str, 'utf8');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    encodeInto(src, dest) {
        if (!(dest instanceof Uint8Array)) {
            throw new TypeError('The "dest" argument must be an instance of Uint8Array.');
        }

        const str = typeof src === 'string' ? src : String(src);
        const buf = Buffer.from(str, 'utf8');
        const written = Math.min(buf.byteLength, dest.byteLength);
        
        dest.set(buf.subarray(0, written));
        return {
            read: str.length,
            written
        };
    }
}

export class TextDecoder {
    constructor(label = 'utf-8', options = {}) {
        const normalized = String(label).trim().toLowerCase();
        if (!kEnvs.includes(normalized) && !Buffer.isEncoding(normalized)) {
            throw new RangeError(`The "${label}" encoding is not supported`);
        }

        this.encoding = normalized.replace('utf-8', 'utf8');
        this.fatal = !!options.fatal;
        this.ignoreBOM = !!options.ignoreBOM;
    }

    decode(input, options = {}) {
        // WHATWG Spec: Calling decode() or decode(undefined) flushes the decoder and returns empty string
        if (input === undefined || input === null) {
            return '';
        }

        let buf;
        if (input instanceof ArrayBuffer) {
            buf = Buffer.from(input);
        } else if (ArrayBuffer.isView(input)) {
            // Respect byteOffset and byteLength for sliced TypedArrays / Buffers!
            buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
        } else {
            throw new TypeError('The "input" argument must be an instance of ArrayBuffer or ArrayBufferView.');
        }

        let str = buf.toString(this.encoding);

        // Strip UTF-8 Byte Order Mark (BOM: \uFEFF) if not explicitly ignored
        if (!this.ignoreBOM && str.charCodeAt(0) === 0xFEFF) {
            str = str.slice(1);
        }

        return str;
    }
}

// Mount onto globalThis if not already present
if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = TextDecoder;
}

export default {
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder
};