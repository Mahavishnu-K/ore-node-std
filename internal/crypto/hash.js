// Re-exports hash and HMAC implementations for internal crypto subpaths.
'use strict';

import crypto from '../../crypto.js';

export const Hash = crypto.Hash;
export const Hmac = crypto.Hmac;
export const createHash = crypto.createHash;
export const createHmac = crypto.createHmac;

export default { Hash, Hmac, createHash, createHmac };