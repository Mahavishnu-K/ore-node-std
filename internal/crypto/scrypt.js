// Copyright Joyent and Node contributors. All rights reserved. MIT license.
'use strict';

import { Buffer } from '../../buffer.js';

import {
  validateFunction,
  validateInteger,
  validateInt32,
  validateUint32,
} from '../validators.js';

import {
  ERR_CRYPTO_SCRYPT_INVALID_PARAMETER,
  ERR_CRYPTO_SCRYPT_NOT_SUPPORTED,
} from '../errors.js';

import {
  getArrayBufferOrView,
  getDefaultEncoding,
} from './util.js';

import { createHmac } from '../../crypto.js';

function R(a, b) {
  return (a << b) | (a >>> (32 - b));
}

function salsa20_8(B) {
  const B32 = new Uint32Array(B.buffer, B.byteOffset, 16);
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i++) x[i] = B32[i];

  for (let i = 0; i < 8; i += 2) {
    x[ 4] ^= R((x[ 0] + x[12]) >>> 0,  7);
    x[ 8] ^= R((x[ 4] + x[ 0]) >>> 0,  9);
    x[12] ^= R((x[ 8] + x[ 4]) >>> 0, 13);
    x[ 0] ^= R((x[12] + x[ 8]) >>> 0, 18);

    x[ 9] ^= R((x[ 5] + x[ 1]) >>> 0,  7);
    x[13] ^= R((x[ 9] + x[ 5]) >>> 0,  9);
    x[ 1] ^= R((x[13] + x[ 9]) >>> 0, 13);
    x[ 5] ^= R((x[ 1] + x[13]) >>> 0, 18);

    x[14] ^= R((x[10] + x[ 6]) >>> 0,  7);
    x[ 2] ^= R((x[14] + x[10]) >>> 0,  9);
    x[ 6] ^= R((x[ 2] + x[14]) >>> 0, 13);
    x[10] ^= R((x[ 6] + x[ 2]) >>> 0, 18);

    x[ 3] ^= R((x[15] + x[11]) >>> 0,  7);
    x[ 7] ^= R((x[ 3] + x[15]) >>> 0,  9);
    x[11] ^= R((x[ 7] + x[ 3]) >>> 0, 13);
    x[15] ^= R((x[11] + x[ 7]) >>> 0, 18);

    x[ 1] ^= R((x[ 0] + x[ 3]) >>> 0,  7);
    x[ 2] ^= R((x[ 1] + x[ 0]) >>> 0,  9);
    x[ 3] ^= R((x[ 2] + x[ 1]) >>> 0, 13);
    x[ 0] ^= R((x[ 3] + x[ 2]) >>> 0, 18);

    x[ 6] ^= R((x[ 5] + x[ 4]) >>> 0,  7);
    x[ 7] ^= R((x[ 6] + x[ 5]) >>> 0,  9);
    x[ 4] ^= R((x[ 7] + x[ 6]) >>> 0, 13);
    x[ 5] ^= R((x[ 4] + x[ 7]) >>> 0, 18);

    x[11] ^= R((x[10] + x[ 9]) >>> 0,  7);
    x[ 8] ^= R((x[11] + x[10]) >>> 0,  9);
    x[ 9] ^= R((x[ 8] + x[11]) >>> 0, 13);
    x[10] ^= R((x[ 9] + x[ 8]) >>> 0, 18);

    x[12] ^= R((x[15] + x[14]) >>> 0,  7);
    x[13] ^= R((x[12] + x[15]) >>> 0,  9);
    x[14] ^= R((x[13] + x[12]) >>> 0, 13);
    x[15] ^= R((x[14] + x[13]) >>> 0, 18);
  }

  for (let i = 0; i < 16; i++) {
    B32[i] = (B32[i] + x[i]) >>> 0;
  }
}

function blockmix_salsa8(B, Y, r) {
  const X = Buffer.alloc(64);
  B.copy(X, 0, (2 * r - 1) * 64, (2 * r) * 64);

  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 64; j++) {
      X[j] ^= B[i * 64 + j];
    }
    salsa20_8(X);
    const destOffset = (i % 2 === 0 ? (i / 2) : (r + (i - 1) / 2)) * 64;
    X.copy(Y, destOffset, 0, 64);
  }
  Y.copy(B, 0, 0, 2 * r * 64);
}

function integerify(B, r, N) {
  const offset = (2 * r - 1) * 64;
  return B.readUInt32LE(offset) % N;
}

function smix(B, r, N) {
  const B_len = 128 * r;
  const V = [];
  const X = Buffer.alloc(B_len);
  const Y = Buffer.alloc(B_len);
  B.copy(X, 0, 0, B_len);

  for (let i = 0; i < N; i++) {
    const v = Buffer.alloc(B_len);
    X.copy(v, 0, 0, B_len);
    V.push(v);
    blockmix_salsa8(X, Y, r);
  }

  for (let i = 0; i < N; i++) {
    const j = integerify(X, r, N);
    const Vj = V[j];
    for (let k = 0; k < B_len; k++) {
      X[k] ^= Vj[k];
    }
    blockmix_salsa8(X, Y, r);
  }
  X.copy(B, 0, 0, B_len);
}

function pbkdf2_sha256_1(password, salt, dkLen) {
  const blocks = Math.ceil(dkLen / 32);
  const out = Buffer.alloc(dkLen);
  let written = 0;
  for (let i = 1; i <= blocks; i++) {
    const hmac = createHmac('sha256', password);
    hmac.update(salt);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(i, 0);
    hmac.update(counter);
    const U1 = hmac.digest();
    const toCopy = Math.min(32, dkLen - written);
    U1.copy(out, written, 0, toCopy);
    written += toCopy;
  }
  return out;
}

function scrypt_sync(password, salt, N, r, p, dkLen) {
  const passBuf = Buffer.isBuffer(password) ? password : Buffer.from(password.buffer ?? password, password.byteOffset ?? 0, password.byteLength ?? password.length);
  const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt.buffer ?? salt, salt.byteOffset ?? 0, salt.byteLength ?? salt.length);
  const B = pbkdf2_sha256_1(passBuf, saltBuf, p * 128 * r);
  const B_len = 128 * r;
  for (let i = 0; i < p; i++) {
    const chunk = B.subarray(i * B_len, (i + 1) * B_len);
    smix(chunk, r, N);
  }
  return pbkdf2_sha256_1(passBuf, B, dkLen);
}

const defaults = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 << 20,  // 32 MiB, matches SCRYPT_MAX_MEM.
};

function scrypt(password, salt, keylen, options, callback = defaults) {
  if (callback === defaults) {
    callback = options;
    options = defaults;
  }

  options = check(password, salt, keylen, options);
  const { N, r, p, maxmem } = options;
  ({ password, salt, keylen } = options);

  validateFunction(callback, 'callback');
  const encoding = getDefaultEncoding();
  setTimeout(() => {
    try {
      const result = scrypt_sync(password, salt, N, r, p, keylen);
      const buf = Buffer.from(result);
      if (encoding === 'buffer') {
        callback(null, buf);
      } else {
        callback(null, buf.toString(encoding));
      }
    } catch (err) {
      callback(err);
    }
  }, 0);
}

function scryptSync(password, salt, keylen, options = defaults) {
  options = check(password, salt, keylen, options);
  const { N, r, p, maxmem } = options;
  ({ password, salt, keylen } = options);

  const result = scrypt_sync(password, salt, N, r, p, keylen);
  const buf = Buffer.from(result);
  const encoding = getDefaultEncoding();
  return encoding === 'buffer' ? buf : buf.toString(encoding);
}

function check(password, salt, keylen, options) {
  /*if (ScryptJob === undefined)
    throw new ERR_CRYPTO_SCRYPT_NOT_SUPPORTED();*/

  password = getArrayBufferOrView(password, 'password');
  salt = getArrayBufferOrView(salt, 'salt');
  validateInt32(keylen, 'keylen', 0);

  let { N, r, p, maxmem } = defaults;
  if (options && options !== defaults) {
    const has_N = options.N !== undefined;
    if (has_N) {
      N = options.N;
      validateUint32(N, 'N');
    }
    if (options.cost !== undefined) {
      if (has_N) throw new ERR_CRYPTO_SCRYPT_INVALID_PARAMETER();
      N = options.cost;
      validateUint32(N, 'cost');
    }
    const has_r = (options.r !== undefined);
    if (has_r) {
      r = options.r;
      validateUint32(r, 'r');
    }
    if (options.blockSize !== undefined) {
      if (has_r) throw new ERR_CRYPTO_SCRYPT_INVALID_PARAMETER();
      r = options.blockSize;
      validateUint32(r, 'blockSize');
    }
    const has_p = options.p !== undefined;
    if (has_p) {
      p = options.p;
      validateUint32(p, 'p');
    }
    if (options.parallelization !== undefined) {
      if (has_p) throw new ERR_CRYPTO_SCRYPT_INVALID_PARAMETER();
      p = options.parallelization;
      validateUint32(p, 'parallelization');
    }
    if (options.maxmem !== undefined) {
      maxmem = options.maxmem;
      validateInteger(maxmem, 'maxmem', 0);
    }
    if (N === 0) N = defaults.N;
    if (r === 0) r = defaults.r;
    if (p === 0) p = defaults.p;
    if (maxmem === 0) maxmem = defaults.maxmem;
  }

  if (Math.log2(N) % 1 !== 0 || N <= 1) {
    throw new ERR_CRYPTO_SCRYPT_INVALID_PARAMETER();
  }

  let blen = p * 128 * r;
  let vlen = 32 * r * (N + 2) * 4;
  if (vlen + blen > maxmem || 128 * N * r > maxmem || N >= 2 ** (r * 16) || p > (2 ** 30 - 1) / r) {
    throw new ERR_CRYPTO_SCRYPT_INVALID_PARAMETER();
  }

  return { password, salt, keylen, N, r, p, maxmem };
}

export {
  scrypt,
  scryptSync,
};
