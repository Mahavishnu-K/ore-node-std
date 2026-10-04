// internal_binding/constants.js
// Node.js legacy 'constants' compatibility module

import { os, fs, crypto, zlib } from '../internal/constants.js';

// Node's legacy 'constants' module is simply a flat merge of all sub-tables:
const constants = Object.freeze(Object.assign(
    {},
    os.dlopen,
    os.errno,
    os.priority,
    os.signals,
    fs,
    crypto,
    zlib
));

// Named exports (e.g. import { O_RDONLY, ENOENT } from 'constants')
export * from '../internal/constants.js';

// Default export (e.g. const constants = require('constants'))
export default constants;