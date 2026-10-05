// Copyright Joyent and Node contributors. All rights reserved. MIT license.
'use strict';

import {
  validateFunction,
  validateInteger,
  validateString,
  validateUint32,
} from '../validators.js';

import { Buffer, kMaxLength } from '../../buffer.js';

import {
  getArrayBufferOrView,
  normalizeHashName,
  toBuf,
  validateByteSource,
  kKeyObject,
  getHashes,
} from './util.js';

import {
  createSecretKey,
  isKeyObject,
} from './keys.js';

import {
  lazyDOMException,
} from '../util.js';

import {
  isAnyArrayBuffer,
  isArrayBufferView,
} from '../util/types.js';

import {
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
  ERR_MISSING_OPTION,
  hideStackFrames,
  ERR_CRYPTO_INVALID_DIGEST,
  ERR_CRYPTO_INVALID_KEYLEN,
} from '../errors.js';

import { createHmac } from '../../crypto.js';

function getDigestByteLength(name) {
  const norm = String(name).toLowerCase().replace(/[-_]/g, '');
  switch (norm) {
    case 'sha256':
    case 'sha512256':
      return 32;
    case 'sha512':
      return 64;
    case 'sha384':
      return 48;
    case 'sha1':
      return 20;
    case 'md5':
      return 16;
    default:
      return 32;
  }
}

// RFC 5869 Section 2.2: HKDF-Extract(salt, IKM) -> PRK
function hkdfExtract(hash, ikm, salt) {
  const hashByteLen = getDigestByteLength(hash);
  const saltBuf = (!salt || salt.byteLength === 0)
    ? Buffer.alloc(hashByteLen, 0)
    : Buffer.from(salt.buffer ?? salt, salt.byteOffset ?? 0, salt.byteLength ?? salt.length);
  const ikmBuf = Buffer.from(ikm.buffer ?? ikm, ikm.byteOffset ?? 0, ikm.byteLength ?? ikm.length);
  return createHmac(hash, saltBuf).update(ikmBuf).digest();
}

// RFC 5869 Section 2.3: HKDF-Expand(PRK, info, L) -> OKM
function hkdfExpand(hash, prk, info, length) {
  if (length === 0) return new ArrayBuffer(0);
  const hashByteLen = getDigestByteLength(hash);
  const n = Math.ceil(length / hashByteLen);
  if (n > 255) {
    throw new ERR_CRYPTO_INVALID_KEYLEN();
  }
  const infoBuf = (info && info.byteLength > 0)
    ? Buffer.from(info.buffer ?? info, info.byteOffset ?? 0, info.byteLength ?? info.length)
    : Buffer.alloc(0);
  const prkBuf = Buffer.from(prk.buffer ?? prk, prk.byteOffset ?? 0, prk.byteLength ?? prk.length);

  const okm = Buffer.alloc(length);
  let prevT = Buffer.alloc(0);
  let written = 0;

  for (let i = 1; i <= n; i++) {
    const hmac = createHmac(hash, prkBuf);
    if (prevT.length > 0) {
      hmac.update(prevT);
    }
    if (infoBuf.length > 0) {
      hmac.update(infoBuf);
    }
    hmac.update(Buffer.from([i]));
    prevT = hmac.digest();

    const toCopy = Math.min(prevT.length, length - written);
    prevT.copy(okm, written, 0, toCopy);
    written += toCopy;
  }

  return okm.buffer.slice(okm.byteOffset, okm.byteOffset + okm.byteLength);
}

const validateParameters = hideStackFrames((hash, key, salt, info, length) => {
  validateString(hash, 'digest');

  key = prepareKey(key).export();
  salt = validateByteSource(salt, 'salt');
  info = validateByteSource(info, 'info');

  validateInteger(length, 'length', 0, kMaxLength);
  if (info.byteLength > 1024) {
    throw new ERR_OUT_OF_RANGE(
      'info',
      'must not contain more than 1024 bytes',
      info.byteLength);
  }

  if (!getHashes().includes(hash)) {
    throw new ERR_CRYPTO_INVALID_DIGEST(hash);
  }

  if (hash === "sha256" && length > 255 * 32) {
    throw new ERR_CRYPTO_INVALID_KEYLEN();
  } else if (hash === "sha512" && length > 255 * 64) {
    throw new ERR_CRYPTO_INVALID_KEYLEN();
  }

  return {
    hash,
    key,
    salt,
    info,
    length,
  };
});

function prepareKey(key) {
  if (isKeyObject(key))
    return key;

  if (isAnyArrayBuffer(key))
    return createSecretKey(key);

  key = toBuf(key);

  if (!isArrayBufferView(key)) {
    throw new ERR_INVALID_ARG_TYPE(
      'ikm',
      [
        'string',
        'SecretKeyObject',
        'ArrayBuffer',
        'TypedArray',
        'DataView',
        'Buffer',
      ],
      key);
  }

  return createSecretKey(key);
}

function hkdf(hash, key, salt, info, length, callback) {
  ({
    hash,
    key,
    salt,
    info,
    length,
  } = validateParameters(hash, key, salt, info, length));

  validateFunction(callback, 'callback');

  setTimeout(() => {
    try {
      const prk = hkdfExtract(hash, key, salt);
      const result = hkdfExpand(hash, prk, info, length);
      callback(null, result);
    } catch (err) {
      callback(err);
    }
  }, 0);
}

function hkdfSync(hash, key, salt, info, length) {
  ({
    hash,
    key,
    salt,
    info,
    length,
  } = validateParameters(hash, key, salt, info, length));

  const prk = hkdfExtract(hash, key, salt);
  return hkdfExpand(hash, prk, info, length);
}

async function hkdfDeriveBits(algorithm, baseKey, length) {
  const { hash } = algorithm;
  const salt = getArrayBufferOrView(algorithm.salt, 'algorithm.salt');
  const info = getArrayBufferOrView(algorithm.info, 'algorithm.info');
  if (hash === undefined)
    throw new ERR_MISSING_OPTION('algorithm.hash');

  let byteLength = 512 / 8;
  if (length !== undefined) {
    if (length === 0)
      throw lazyDOMException('length cannot be zero', 'OperationError');
    if (length === null)
      throw lazyDOMException('length cannot be null', 'OperationError');
    validateUint32(length, 'length');
    if (length % 8) {
      throw lazyDOMException(
        'length must be a multiple of 8',
        'OperationError');
    }
    byteLength = length / 8;
  }

  return new Promise((resolve, reject) => {
    hkdf(
      normalizeHashName(hash.name),
      baseKey[kKeyObject],
      salt,
      info,
      byteLength,
      (err, bits) => {
        if (err) return reject(err);
        resolve(bits);
      });
  });
}

export {
  hkdf,
  hkdfSync,
  hkdfDeriveBits,
};
