// modules/internal/fs/cp/cp.js
// Copyright Joyent, Inc. and Node.js contributors. All rights reserved. MIT license.

'use strict';

import * as errors from "../../errors.js";
import { os } from "../../constants.js";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep
} from "../../../path.js";

// IMPORT STRICTLY FROM PROMISES (Zero Sync Blocking)
import { promises as fsPromises } from "../../fs.js";

const {
  chmod,
  copyFile,
  lstat,
  mkdir,
  opendir,
  readlink,
  stat,
  symlink,
  unlink,
  utimes,
} = fsPromises;

const {
  ERR_FS_CP_DIR_TO_NON_DIR,
  ERR_FS_CP_EEXIST,
  ERR_FS_CP_EINVAL,
  ERR_FS_CP_FIFO_PIPE,
  ERR_FS_CP_NON_DIR_TO_DIR,
  ERR_FS_CP_SOCKET,
  ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY,
  ERR_FS_CP_UNKNOWN,
  ERR_FS_EISDIR,
} = errors;

const {
  errno: {
    EEXIST,
    EISDIR,
    EINVAL,
    ENOTDIR,
  }
} = os;

// Path comparison helpers
const normalizePathToArray = (path) =>
  String.prototype.split.call(resolve(path), sep).filter(Boolean);

export function isSrcSubdir(src, dest) {
  const srcArr = normalizePathToArray(src);
  const destArr = normalizePathToArray(dest);
  return srcArr.every((cur, i) => destArr[i] === cur);
}

export function areIdentical(srcStat, destStat) {
  if (!destStat || !srcStat) return false;
  if (destStat.ino !== undefined && destStat.dev !== undefined) {
    return destStat.ino === srcStat.ino && destStat.dev === srcStat.dev;
  }
  return false;
}

const defaultOptions = {
  dereference: false,
  errorOnExist: false,
  filter: undefined,
  force: true,
  preserveTimestamps: false,
  recursive: false,
  verbatimSymlinks: false,
};

// Async helper for existsSync
async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch (_) {
    return false;
  }
}

export async function cpFn(src, dest, userOpts) {
  const opts = { ...defaultOptions, ...userOpts };

  if (opts.preserveTimestamps && typeof process !== 'undefined' &&
      process.arch === 'ia32' && typeof process.emitWarning === 'function') {
    process.emitWarning(
      'Using the preserveTimestamps option in 32-bit node is not recommended',
      'TimestampPrecisionWarning'
    );
  }

  const { srcStat, destStat } = await checkPaths(src, dest, opts);

  if (srcStat.isDirectory()) {
    await checkParentPaths(src, srcStat, dest);
  }

  if (opts.filter) {
    return handleFilter(checkParentDir, destStat, src, dest, opts);
  }
  return checkParentDir(destStat, src, dest, opts);
}

async function checkPaths(src, dest, opts) {
  const { 0: srcStat, 1: destStat } = await getStats(src, dest, opts);

  if (destStat) {
    if (resolve(src) === resolve(dest) || areIdentical(srcStat, destStat)) {
      throw new ERR_FS_CP_EINVAL({
        message: 'src and dest cannot be the same',
        path: dest,
        syscall: 'cp',
        errno: EINVAL,
        code: 'EINVAL',
      });
    }
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw new ERR_FS_CP_DIR_TO_NON_DIR({
        message: `cannot overwrite directory ${src} with non-directory ${dest}`,
        path: dest,
        syscall: 'cp',
        errno: EISDIR,
        code: 'EISDIR',
      });
    }
    if (!srcStat.isDirectory() && destStat.isDirectory()) {
      throw new ERR_FS_CP_NON_DIR_TO_DIR({
        message: `cannot overwrite non-directory ${src} with directory ${dest}`,
        path: dest,
        syscall: 'cp',
        errno: ENOTDIR,
        code: 'ENOTDIR',
      });
    }
  }

  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw new ERR_FS_CP_EINVAL({
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }
  return { srcStat, destStat };
}

async function getStats(src, dest, opts) {
  const statFunc = opts.dereference ? stat : lstat;
  const srcStat = await statFunc(src);

  let destStat = null;
  try {
    destStat = await statFunc(dest);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  return [srcStat, destStat];
}

async function checkParentDir(destStat, src, dest, opts) {
  const destParent = dirname(dest);
  const dirExists = await pathExists(destParent);
  if (dirExists) return getStatsForCopy(destStat, src, dest, opts);
  await mkdir(destParent, { recursive: true });
  return getStatsForCopy(destStat, src, dest, opts);
}

async function checkParentPaths(src, srcStat, dest) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));

  if (destParent === srcParent || destParent === parse(destParent).root || destParent === ".") {
    return;
  }

  let destStat;
  try {
    destStat = await stat(destParent);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  if (resolve(src) === resolve(destParent) || areIdentical(srcStat, destStat)) {
    throw new ERR_FS_CP_EINVAL({
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }
  return checkParentPaths(src, srcStat, destParent);
}

async function handleFilter(onInclude, destStat, src, dest, opts) {
  const include = await opts.filter(src, dest);
  if (include) return onInclude(destStat, src, dest, opts);
}

async function startCopy(destStat, src, dest, opts) {
  if (opts.filter) {
    return handleFilter(getStatsForCopy, destStat, src, dest, opts);
  }
  return getStatsForCopy(destStat, src, dest, opts);
}

async function getStatsForCopy(destStat, src, dest, opts) {
  const statFn = opts.dereference ? stat : lstat;
  const srcStat = await statFn(src);

  if (srcStat.isDirectory() && opts.recursive) {
    return onDir(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isDirectory()) {
    throw new ERR_FS_EISDIR({
      message: `${src} is a directory (not copied)`,
      path: src,
      syscall: 'cp',
      errno: EISDIR,
      code: 'EISDIR',
    });
  } else if (srcStat.isFile() || srcStat.isCharacterDevice() || srcStat.isBlockDevice()) {
    return onFile(srcStat, destStat, src, dest, opts);
  } else if (srcStat.isSymbolicLink()) {
    return onLink(destStat, src, dest, opts);
  } else if (srcStat.isSocket()) {
    throw new ERR_FS_CP_SOCKET({
      message: `cannot copy a socket file: ${dest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  } else if (srcStat.isFIFO()) {
    throw new ERR_FS_CP_FIFO_PIPE({
      message: `cannot copy a FIFO pipe: ${dest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  throw new ERR_FS_CP_UNKNOWN({
    message: `cannot copy an unknown file type: ${dest}`,
    path: dest,
    syscall: 'cp',
    errno: EINVAL,
    code: 'EINVAL',
  });
}

async function onFile(srcStat, destStat, src, dest, opts) {
  if (!destStat) return _copyFile(srcStat, src, dest, opts);
  return mayCopyFile(srcStat, src, dest, opts);
}

async function mayCopyFile(srcStat, src, dest, opts) {
  if (opts.force) {
    try { await unlink(dest); } catch (_) {}
    return _copyFile(srcStat, src, dest, opts);
  } else if (opts.errorOnExist) {
    throw new ERR_FS_CP_EEXIST({
      message: `${dest} already exists`,
      path: dest,
      syscall: 'cp',
      errno: EEXIST,
      code: 'EEXIST',
    });
  }
}

async function _copyFile(srcStat, src, dest, opts) {
  await copyFile(src, dest);
  if (opts.preserveTimestamps) {
    return handleTimestampsAndMode(srcStat.mode, src, dest);
  }
  return setDestMode(dest, srcStat.mode);
}

async function handleTimestampsAndMode(srcMode, src, dest) {
  if (fileIsNotWritable(srcMode)) {
    await makeFileWritable(dest, srcMode);
    return setDestTimestampsAndMode(srcMode, src, dest);
  }
  return setDestTimestampsAndMode(srcMode, src, dest);
}

function fileIsNotWritable(srcMode) {
  return (srcMode & 0o200) === 0;
}

async function makeFileWritable(dest, srcMode) {
  return setDestMode(dest, srcMode | 0o200);
}

async function setDestTimestampsAndMode(srcMode, src, dest) {
  await setDestTimestamps(src, dest);
  return setDestMode(dest, srcMode);
}

async function setDestMode(dest, srcMode) {
  return chmod(dest, srcMode);
}

async function setDestTimestamps(src, dest) {
  const updatedSrcStat = await stat(src);
  return utimes(dest, updatedSrcStat.atime, updatedSrcStat.mtime);
}

async function onDir(srcStat, destStat, src, dest, opts) {
  if (!destStat) return mkDirAndCopy(srcStat.mode, src, dest, opts);
  return copyDir(src, dest, opts);
}

async function mkDirAndCopy(srcMode, src, dest, opts) {
  await mkdir(dest, { recursive: true });
  await copyDir(src, dest, opts);
  return setDestMode(dest, srcMode);
}

async function copyDir(src, dest, opts) {
  const dir = await opendir(src);

  for await (const entry of dir) {
    const { name } = entry;
    const srcItem = join(src, name);
    const destItem = join(dest, name);
    const { destStat } = await checkPaths(srcItem, destItem, opts);
    await startCopy(destStat, srcItem, destItem, opts);
  }
}

// WASI-safe symbolic link handling
async function onLink(destStat, src, dest, opts) {
  let resolvedSrc;
  try {
    resolvedSrc = await readlink(src);
  } catch (err) {
    return onFile(await stat(src), destStat, src, dest, opts);
  }

  if (!opts.verbatimSymlinks && !isAbsolute(resolvedSrc)) {
    resolvedSrc = resolve(dirname(src), resolvedSrc);
  }

  if (!destStat) {
    try {
      return await symlink(resolvedSrc, dest);
    } catch (_) {
      return onFile(await stat(src), destStat, src, dest, opts);
    }
  }

  let resolvedDest;
  try {
    resolvedDest = await readlink(dest);
  } catch (err) {
    if (err.code === 'EINVAL' || err.code === 'UNKNOWN') {
      try {
        return await symlink(resolvedSrc, dest);
      } catch (_) {
        return onFile(await stat(src), destStat, src, dest, opts);
      }
    }
    throw err;
  }

  if (!isAbsolute(resolvedDest)) {
    resolvedDest = resolve(dirname(dest), resolvedDest);
  }

  if (isSrcSubdir(resolvedSrc, resolvedDest)) {
    throw new ERR_FS_CP_EINVAL({
      message: `cannot copy ${resolvedSrc} to a subdirectory of self ${resolvedDest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  const dStat = await stat(dest);
  if (dStat.isDirectory() && isSrcSubdir(resolvedDest, resolvedSrc)) {
    throw new ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY({
      message: `cannot overwrite ${resolvedDest} with ${resolvedSrc}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  return copyLink(src, resolvedSrc, dest, destStat, opts);
}

async function copyLink(src, resolvedSrc, dest, destStat, opts) {
  try {
    await unlink(dest);
    return await symlink(resolvedSrc, dest);
  } catch (err) {
    // If the WASM sandbox denies symlink creation, fallback to file copy
    return onFile(await stat(src), destStat, src, dest, opts);
  }
}

export default {
  areIdentical,
  cpFn,
  isSrcSubdir,
};