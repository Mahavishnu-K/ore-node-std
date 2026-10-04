// Node.js 'fs/promises' compatibility subpath.

import { promises } from '../fs.js';

export const {
    constants,
    readFile,
    writeFile,
    appendFile,
    readdir,
    mkdir,
    rmdir,
    rm,
    unlink,
    rename,
    copyFile,
    cp,
    stat,
    lstat,
    access,
    realpath,
    truncate,
    open
} = promises;

export default promises;