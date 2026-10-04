// Node.js 'stream/consumers' compatibility subpath.
'use strict';

import { Buffer } from "../buffer.js";

/**
 * @typedef {import('../_global.d.ts').ReadableStream
 * } ReadableStream
 * @typedef {import('../_stream.d.ts')} Readable
 */


/**
 * @param {AsyncIterable|ReadableStream|Readable} stream
 * @returns {Promise<ArrayBuffer>}
 */
async function arrayBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const buf = Buffer.concat(chunks);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * @param {AsyncIterable|ReadableStream|Readable} stream
 * @returns {Promise<Buffer>}
 */
async function buffer(stream) {
    return Buffer.from(await arrayBuffer(stream));
}

/**
 * @param {AsyncIterable|ReadableStream|Readable} stream
 * @returns {Promise<string>}
 */
async function text(stream) {
    const dec = new TextDecoder();
    let str = "";
    for await (const chunk of stream) {
        if (typeof chunk === "string") {
            str += chunk;
        } else {
            str += dec.decode(chunk, { stream: true });
        }
    }
    // Flush the streaming TextDecoder so that any pending
    // incomplete multibyte characters are handled.
    str += dec.decode(undefined, { stream: false });
    return str;
}

/**
 * @param {AsyncIterable|ReadableStream|Readable} stream
 * @returns {Promise<any>}
 */
async function json(stream) {
    const str = await text(stream);
    return JSON.parse(str);
}

export default {
    arrayBuffer,
    buffer,
    json,
    text,
};
export { arrayBuffer, buffer, json, text };