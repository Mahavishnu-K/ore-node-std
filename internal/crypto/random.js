// internal/crypto/random.js
'use strict';

import crypto from '../../crypto.js';

export const randomBytes = crypto.randomBytes;
export const randomFill = crypto.randomFill;
export const randomFillSync = crypto.randomFillSync;
export const randomInt = crypto.randomInt;
export const randomUUID = crypto.randomUUID;

export default {
    randomBytes,
    randomFill,
    randomFillSync,
    randomInt,
    randomUUID
};