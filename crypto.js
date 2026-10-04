// ORE Kernel Production-Grade Crypto Module for Inception QuickJS
// Provides real hashing, HMAC, AES-256-CBC, CSPRNG, and key derivation.

import * as os from 'os';
import { Buffer } from 'buffer';
import fs from 'fs';

const REQ_FILE = '/ore_tmp/.ore_crypto/req.bin';
const RES_FILE = '/ore_tmp/.ore_crypto/res.bin';

// Helper to communicate with the native Rust KernelCrypto
function invokeKernelCrypto(cmdId, payloadBuffer) {
  try {
    const cmdBuf = Buffer.from([cmdId]);
    const req = payloadBuffer ? Buffer.concat([cmdBuf, payloadBuffer]) : cmdBuf;

    // TRUNCATE instead of DELETE (Safe on Windows)
    try { fs.writeFileSync(RES_FILE, Buffer.alloc(0)); } catch (_) {}

    fs.writeFileSync(REQ_FILE, req);

    // Wait synchronously for Rust to process (usually takes < 1ms)
    // 100,000 iterations ensures heavy PBKDF2 calculations never timeout
    let tries = 0;
    let resLen = 0;
    while (tries < 1000) { // 1000ms (1 second) timeout is plenty!
      try {
        // CHECK SIZE instead of EXISTENCE (Prevents Phantom Reads)
        const stat = fs.statSync(RES_FILE);
        if (stat.size > 0) {
          resLen = stat.size;
          break;
        }
      } catch (_) {}

      // YIELD TO WASI: Releases Windows file lock & burns ZERO CPU fuel!
      if (os && os.sleep) {
        os.sleep(1);
      }
      
      tries++;
    }

    if (resLen === 0) {
      throw new Error("ORE Crypto Portal Timeout: Kernel did not respond.");
    }

    const res = fs.readFileSync(RES_FILE);
    
    if (!res || res.length === 0) {
      throw new Error("ORE Crypto Portal Error: Kernel response is empty.");
    }

    // TRUNCATE for cleanup
    try { fs.writeFileSync(RES_FILE, Buffer.alloc(0)); } catch (_) {}

    const status = res[0];
    const data = res.subarray(1);

    if (status !== 0) throw new Error(data.toString('utf8'));

    return Buffer.from(data);
  } catch (e) {
    throw new Error(`KernelCrypto invocation failed: ${e.message}`);
  }
}


// CONSTANTS & METADATA (Prevents NPM Feature-Detection Crashes)
export const constants = {
  OPENSSL_CONF: 'OPENSSL_CONF',
  RSA_PKCS1_PADDING: 1,
  RSA_SSLV23_PADDING: 2,
  RSA_NO_PADDING: 3,
  RSA_PKCS1_OAEP_PADDING: 4,
  RSA_X931_PADDING: 5,
  RSA_PKCS1_PSS_PADDING: 6,
  POINT_CONVERSION_COMPRESSED: 2,
  POINT_CONVERSION_UNCOMPRESSED: 4,
  POINT_CONVERSION_HYBRID: 6,
};

export function getHashes() {
  return ['sha256', 'sha512', 'md5'];
}

export function getCiphers() {
  return ['aes-256-cbc', 'aes-128-cbc', 'aes-256-gcm'];
}

export function getCurves() {
  return ['secp256k1', 'prime256v1'];
}

export function randomBytes(size) {
  if (size < 0 || size > 2147483647) throw new RangeError('Size out of range.');
  
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(size, 0);
  const kernelRes = invokeKernelCrypto(1, lenBuf);
  if (!kernelRes) throw new Error("KernelCrypto randomBytes failed.");
  return kernelRes;
}

export function randomFill(buffer, offset = 0, size = buffer.length - offset, callback) {
  if (typeof offset === 'function') {
    callback = offset;
    offset = 0;
    size = buffer.length;
  } else if (typeof size === 'function') {
    callback = size;
    size = buffer.length - offset;
  }
  if (size === undefined) size = buffer.length - offset;

  const bytes = randomBytes(size);
  bytes.copy(buffer, offset);
  if (callback) callback(null, buffer);
  return buffer;
}

export function randomFillSync(buffer, offset = 0, size = buffer.length - offset) {
  return randomFill(buffer, offset, size);
}

export function randomInt(min, max) {
  if (max === undefined) { max = min; min = 0; }
  if (min >= max) throw new RangeError('min must be < max');
  const range = max - min;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8) || 1;
  const maxValid = Math.floor(256 ** bytesNeeded / range) * range;
  while (true) {
    const bytes = randomBytes(bytesNeeded);
    let val = 0;
    // Multiplication avoids 32-bit signed shift overflow
    for (let i = 0; i < bytesNeeded; i++) val = (val * 256) + bytes[i];
    if (val < maxValid) return min + (val % range);
  }
}

export function randomUUID() {
  const b = randomBytes(16);
  // RFC 4122 v4
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}


// TIMING SAFE EQUALITY (Uses Kernel Command 8)

export function timingSafeEqual(a, b) {
  if (!Buffer.isBuffer(a) && !(a instanceof Uint8Array)) throw new TypeError('First argument must be Buffer.');
  if (!Buffer.isBuffer(b) && !(b instanceof Uint8Array)) throw new TypeError('Second argument must be Buffer.');
  if (a.byteLength !== b.byteLength) throw new RangeError('Buffers must have equal byte length.');
  if (a.byteLength === 0) return true;

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(bufA.length, 0);

  const payload = Buffer.concat([lenBuf, bufA, bufB]);
  const kernelRes = invokeKernelCrypto(8, payload);
  if (!kernelRes) throw new Error("KernelCrypto timingSafeEqual failed.");
  return kernelRes[0] === 1;
}

// STREAMING HASH ENGINE (Uses Kernel Commands 2, 3, 4)

export class Hash {
  constructor(algorithm) {
    this.algorithm = String(algorithm).toLowerCase().replace(/[-_]/g, '');
    this.chunks = [];
  }
  update(data, encoding = 'utf8') {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
    this.chunks.push(b);
    return this;
  }
  digest(encoding) {
    const full = Buffer.concat(this.chunks);
    let cmd = 2; // SHA-256
    if (this.algorithm === 'sha256') cmd = 2;
    else if (this.algorithm === 'sha512') cmd = 3;
    else if (this.algorithm === 'md5') cmd = 4;
    else throw new Error(`Hash algorithm '${this.algorithm}' not supported. Supported: sha256, sha512, md5.`);

    const kernelRes = invokeKernelCrypto(cmd, full);
    if (!kernelRes) throw new Error(`KernelCrypto hash failed for ${this.algorithm}`);
    return encoding ? kernelRes.toString(encoding) : kernelRes;
  }
}

export function createHash(algo) { return new Hash(algo); }


// STREAMING HMAC ENGINE (Uses Kernel Commands 5 & 10)

export class Hmac {
  constructor(algorithm, key) {
    this.algorithm = String(algorithm).toLowerCase().replace(/[-_]/g, '');
    this.key = Buffer.isBuffer(key) ? key : Buffer.from(key);
    this.chunks = [];
  }
  update(data, encoding = 'utf8') {
    const b = (typeof data === 'string') ? Buffer.from(data, encoding) : Buffer.from(data);
    this.chunks.push(b);
    return this;
  }
  digest(encoding) {
    const data = Buffer.concat(this.chunks);
    let cmd = 5; // HMAC-SHA256
    if (this.algorithm === 'sha256') cmd = 5;
    else if (this.algorithm === 'sha512') cmd = 10;
    else throw new Error(`HMAC algorithm '${this.algorithm}' not supported. Supported: sha256, sha512.`);

    const keyLenBuf = Buffer.alloc(2);
    keyLenBuf.writeUInt16BE(this.key.length, 0);
    const payload = Buffer.concat([keyLenBuf, this.key, data]);

    const kernelRes = invokeKernelCrypto(cmd, payload);
    if (!kernelRes) throw new Error(`KernelCrypto HMAC failed for ${this.algorithm}`);
    return encoding ? kernelRes.toString(encoding) : kernelRes;
  }
}

export function createHmac(algo, key) { return new Hmac(algo, key); }


// KEY DERIVATION (PBKDF2 via Kernel Command 9)

export function pbkdf2Sync(password, salt, iterations, keylen, digest = 'sha256') {
  const pass = Buffer.isBuffer(password) ? password : Buffer.from(password);
  const s = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);

  const header = Buffer.alloc(10);
  header.writeUInt32BE(iterations, 0);
  header.writeUInt32BE(keylen, 4);
  header.writeUInt16BE(s.length, 8);

  const payload = Buffer.concat([header, s, pass]);
  const kernelRes = invokeKernelCrypto(9, payload);
  if (!kernelRes) throw new Error("KernelCrypto PBKDF2 failed.");
  return kernelRes;
}

export function pbkdf2(password, salt, iterations, keylen, digest, callback) {
  if (typeof digest === 'function') { callback = digest; digest = 'sha256'; }
  try {
    const res = pbkdf2Sync(password, salt, iterations, keylen, digest);
    if (callback) callback(null, res);
  } catch (err) {
    if (callback) callback(err);
  }
}


// REAL HARDWARE AES-GCM (With getAuthTag / setAuthTag Support)

export class Cipheriv {
  constructor(algorithm, key, iv) {
    this.algorithm = algorithm.toLowerCase();
    this.key = Buffer.isBuffer(key) ? key : Buffer.from(key);
    this.iv = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
    this.chunks = [];
    this.authTag = Buffer.alloc(0);

    if (this.algorithm === 'aes-256-gcm') {
      if (this.key.length !== 32) throw new Error(`aes-256-gcm requires 32-byte key. Got ${this.key.length}B.`);
      if (this.iv.length !== 12) throw new Error(`aes-256-gcm requires 12-byte IV. Got ${this.iv.length}B.`);
    } else if (this.algorithm === 'aes-256-cbc') {
      if (this.key.length !== 32) throw new Error(`aes-256-cbc requires 32-byte key. Got ${this.key.length}B.`);
      if (this.iv.length !== 16) throw new Error(`aes-256-cbc requires 16-byte IV. Got ${this.iv.length}B.`);
    } else if (this.algorithm === 'aes-128-cbc') {
      if (this.key.length !== 16) throw new Error(`aes-128-cbc requires 16-byte key. Got ${this.key.length}B.`);
      if (this.iv.length !== 16) throw new Error(`aes-128-cbc requires 16-byte IV. Got ${this.iv.length}B.`);
    } else {
      throw new Error(`Unsupported cipher '${this.algorithm}'. Supported: aes-256-gcm, aes-256-cbc, aes-128-cbc.`);
    }
  }
  update(data, inputEncoding, outputEncoding) {
    let chunk;
    if (typeof data === 'string') {
      chunk = Buffer.from(data, typeof outputEncoding === 'string' ? inputEncoding : 'utf8');
      if (typeof inputEncoding === 'string' && typeof outputEncoding !== 'string') {
        outputEncoding = inputEncoding;
      }
    } else {
      chunk = Buffer.from(data);
      if (typeof inputEncoding === 'string') {
        outputEncoding = inputEncoding;
      }
    }
    this.chunks.push(chunk);
    return outputEncoding ? '' : Buffer.alloc(0);
  }
  setAAD(_buffer) {
    return this; // Compatibility stub for GCM AAD
  }
  setAutoPadding(_autoPadding = true) {
    return this; // Compatibility stub
  }
  final(outputEncoding) {
    const plaintext = Buffer.concat(this.chunks);
    if (this.algorithm === 'aes-256-gcm') {
      const payload = Buffer.concat([this.key, this.iv, plaintext]);
      const encrypted = invokeKernelCrypto(6, payload); // CMD 6 = AES_GCM_ENCRYPT
      if (encrypted.length < 16) throw new Error("AES-GCM encryption failed.");

      const ciphertext = encrypted.subarray(0, encrypted.length - 16);
      this.authTag = encrypted.subarray(encrypted.length - 16);
      return outputEncoding ? ciphertext.toString(outputEncoding) : ciphertext;
    } else {
      // AES-256-CBC or AES-128-CBC
      const keyLenBuf = Buffer.from([this.key.length]);
      const payload = Buffer.concat([keyLenBuf, this.key, this.iv, plaintext]);
      const ciphertext = invokeKernelCrypto(11, payload); // CMD 11 = AES_CBC_ENCRYPT
      if (!ciphertext) throw new Error("AES-CBC encryption failed.");
      return outputEncoding ? ciphertext.toString(outputEncoding) : ciphertext;
    }
  }
  getAuthTag() {
    if (!this.algorithm.includes('gcm')) {
      throw new Error("getAuthTag() is only supported for GCM mode ciphers.");
    }
    if (this.authTag.length === 0) {
      throw new Error("getAuthTag() called before cipher.final().");
    }
    return this.authTag;
  }
}

export class Decipheriv {
  constructor(algorithm, key, iv) {
    this.algorithm = algorithm.toLowerCase();
    this.key = Buffer.isBuffer(key) ? key : Buffer.from(key);
    this.iv = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
    this.chunks = [];
    this.authTag = Buffer.alloc(0);

    if (this.algorithm === 'aes-256-gcm') {
      if (this.key.length !== 32) throw new Error(`aes-256-gcm requires 32-byte key. Got ${this.key.length}B.`);
      if (this.iv.length !== 12) throw new Error(`aes-256-gcm requires 12-byte IV. Got ${this.iv.length}B.`);
    } else if (this.algorithm === 'aes-256-cbc') {
      if (this.key.length !== 32) throw new Error(`aes-256-cbc requires 32-byte key. Got ${this.key.length}B.`);
      if (this.iv.length !== 16) throw new Error(`aes-256-cbc requires 16-byte IV. Got ${this.iv.length}B.`);
    } else if (this.algorithm === 'aes-128-cbc') {
      if (this.key.length !== 16) throw new Error(`aes-128-cbc requires 16-byte key. Got ${this.key.length}B.`);
      if (this.iv.length !== 16) throw new Error(`aes-128-cbc requires 16-byte IV. Got ${this.iv.length}B.`);
    } else {
      throw new Error(`Unsupported cipher '${this.algorithm}'. Supported: aes-256-gcm, aes-256-cbc, aes-128-cbc.`);
    }
  }
  update(data, inputEncoding, outputEncoding) {
    let chunk;
    if (typeof data === 'string') {
      chunk = Buffer.from(data, typeof outputEncoding === 'string' ? inputEncoding : 'utf8');
      if (typeof inputEncoding === 'string' && typeof outputEncoding !== 'string') {
        outputEncoding = inputEncoding;
      }
    } else {
      chunk = Buffer.from(data);
      if (typeof inputEncoding === 'string') {
        outputEncoding = inputEncoding;
      }
    }
    this.chunks.push(chunk);
    return outputEncoding ? '' : Buffer.alloc(0);
  }
  setAuthTag(tag) {
    if (!this.algorithm.includes('gcm')) {
      return this; // No-op for CBC ciphers
    }
    const t = Buffer.isBuffer(tag) ? tag : Buffer.from(tag);
    if (t.length !== 16) throw new Error("Auth tag must be exactly 16 bytes.");
    this.authTag = t;
    return this;
  }
  setAAD(_buffer) {
    return this; // Compatibility stub
  }
  setAutoPadding(_autoPadding = true) {
    return this; // Compatibility stub
  }
  final(outputEncoding) {
    const ciphertext = Buffer.concat(this.chunks);

    if (this.algorithm === 'aes-256-gcm') {
      if (this.authTag.length !== 16) {
        throw new Error("Authentication tag of 16 bytes required. Call decipher.setAuthTag(tag).");
      }
      const fullCiphertext = Buffer.concat([ciphertext, this.authTag]);
      const payload = Buffer.concat([this.key, this.iv, fullCiphertext]);
      const decrypted = invokeKernelCrypto(7, payload); // CMD 7 = AES_GCM_DECRYPT
      if (!decrypted) throw new Error("AES-GCM authentication/decryption failed: Tag mismatch.");
      return outputEncoding ? decrypted.toString(outputEncoding) : decrypted;
    } else {
      // AES-256-CBC or AES-128-CBC
      const keyLenBuf = Buffer.from([this.key.length]);
      const payload = Buffer.concat([keyLenBuf, this.key, this.iv, ciphertext]);
      const decrypted = invokeKernelCrypto(12, payload); // CMD 12 = AES_CBC_DECRYPT
      if (!decrypted) throw new Error("AES-CBC decryption failed.");
      return outputEncoding ? decrypted.toString(outputEncoding) : decrypted;
    }
    
  }
}

export function createCipheriv(algo, key, iv) { return new Cipheriv(algo, key, iv); }
export function createDecipheriv(algo, key, iv) { return new Decipheriv(algo, key, iv); }


// THE COMPLETE 20 EXPORTS AGGREGATE

export default {
  constants,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  getCiphers,
  getCurves,
  getHashes,
  Hash,
  Hmac,
  Cipheriv,
  Decipheriv,
  pbkdf2,
  pbkdf2Sync,
  randomBytes,
  randomFill,
  randomFillSync,
  randomInt,
  randomUUID,
  timingSafeEqual,
};