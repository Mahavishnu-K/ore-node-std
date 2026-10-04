// Copyright Joyent, Inc. and Node.js contributors. All rights reserved.
// MIT license.
//
// Pure-JavaScript WASI-compatible implementation of fs.cpSync().
//
// Design goals:
//   - No internalBinding()
//   - No Node native C++ cpSync helpers
//   - No primordials
//   - No native addons
//   - Preserve Node.js cpSync() observable behavior
//   - Work inside QuickJS + WASI Preview 1
//   - Keep synchronous semantics genuinely synchronous
//
// This file is intentionally implemented in terms of the JavaScript fs.js
// compatibility layer supplied by this runtime.

'use strict';

import * as codes from "../../errors.js";
import { os } from "../../constants.js";

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} from "../../fs.js";

import {
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
} from "../../../path.js";

import {
  areIdentical,
  isSrcSubdir,
} from "./cp.js";

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
  ERR_INVALID_RETURN_VALUE,
} = codes;

const {
  errno: {
    EEXIST,
    EISDIR,
    EINVAL,
    ENOTDIR,
  },
} = os;


/*
 * ---------------------------------------------------------------------------
 * Defaults
 * ---------------------------------------------------------------------------
 *
 * Normally fs.js validates and supplies cp options before reaching this
 * internal function. Keeping defaults here makes the internal function
 * robust when called directly by the compatibility layer.
 */

const defaultOptions = {
  dereference: false,
  errorOnExist: false,
  filter: undefined,
  force: true,
  mode: 0,
  preserveTimestamps: false,
  recursive: false,
  verbatimSymlinks: false,
};


/*
 * ---------------------------------------------------------------------------
 * Promise detection
 * ---------------------------------------------------------------------------
 *
 * fs.cpSync() requires filter() to return a boolean synchronously.
 *
 * A thenable/Promise must therefore produce ERR_INVALID_RETURN_VALUE rather
 * than silently being treated as truthy.
 */

function isPromise(value) {
  return value instanceof Promise;
}


/*
 * ---------------------------------------------------------------------------
 * Public entry point
 * ---------------------------------------------------------------------------
 */

function cpSyncFn(src, dest, userOpts = {}) {
  const opts = {
    ...defaultOptions,
    ...userOpts,
  };

  /*
   * Match Node's 32-bit timestamp warning behavior without assuming that
   * process exists in every QuickJS embedding.
   */
  if (
    opts.preserveTimestamps &&
    typeof process !== 'undefined' &&
    process.arch === 'ia32' &&
    typeof process.emitWarning === 'function'
  ) {
    process.emitWarning(
      'Using the preserveTimestamps option in 32-bit node is not recommended',
      'TimestampPrecisionWarning'
    );
  }

  /*
   * The root filter is evaluated before touching the source/destination.
   * This is important: filter=false means the copy is skipped entirely.
   */
  if (opts.filter) {
    const shouldCopy = opts.filter(src, dest);

    if (isPromise(shouldCopy)) {
      throw new ERR_INVALID_RETURN_VALUE(
        'boolean',
        'filter',
        shouldCopy
      );
    }

    if (!shouldCopy) {
      return;
    }
  }

  /*
   * Validate source/destination relationships before creating anything.
   */
  const { srcStat, destStat } = checkPathsSync(src, dest, opts);

  /*
   * Prevent copying a directory into itself or one of its descendants.
   *
   * This is required for recursive copies and is intentionally performed
   * before creating destination directories.
   */
  checkParentPathsSync(src, srcStat, dest);

  /*
   * Node's public API allows a destination whose parent does not yet exist.
   * Create the missing parent hierarchy before performing the actual copy.
   */
  return handleFilterAndCopy(destStat, src, dest, opts);
}


/*
 * ---------------------------------------------------------------------------
 * Initial path validation
 * ---------------------------------------------------------------------------
 */

function checkPathsSync(src, dest, opts) {
  const { srcStat, destStat } = getIdentityStatsSync(src, dest, opts);

  if (destStat) {
    /*
     * Same file/device/inode.
     *
     * resolve() catches the common textual same-path case even on filesystems
     * where inode information is unavailable.
     */
    if (
      resolve(src) === resolve(dest) ||
      areIdentical(srcStat, destStat)
    ) {
      throw new ERR_FS_CP_EINVAL({
        message: 'src and dest cannot be the same',
        path: dest,
        syscall: 'cp',
        errno: EINVAL,
        code: 'EINVAL',
      });
    }

    /*
     * Directory -> non-directory is invalid.
     */
    if (srcStat.isDirectory() && !destStat.isDirectory()) {
      throw new ERR_FS_CP_DIR_TO_NON_DIR({
        message: `cannot overwrite directory ${src} with non-directory ${dest}`,
        path: dest,
        syscall: 'cp',
        errno: EISDIR,
        code: 'EISDIR',
      });
    }

    /*
     * Non-directory -> directory is invalid.
     */
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

  /*
   * Path-string protection against:
   *
   *   cpSync("foo", "foo/bar", { recursive: true })
   */
  if (srcStat.isDirectory() && isSrcSubdir(src, dest)) {
    throw new ERR_FS_CP_EINVAL({
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  return {
    srcStat,
    destStat,
  };
}


/*
 * ---------------------------------------------------------------------------
 * Identity stats
 * ---------------------------------------------------------------------------
 *
 * Use BigInt stats for inode/device comparison.
 *
 * IMPORTANT:
 * These stats are ONLY used for identity/path checks.
 *
 * The actual copy path obtains ordinary Stats objects later because fields
 * such as mode and timestamps must remain compatible with chmodSync()/utimesSync().
 */

function getIdentityStatsSync(src, dest, opts) {
  const statFunc = opts.dereference
    ? (file) => statSync(file, { bigint: true })
    : (file) => lstatSync(file, { bigint: true });

  const srcStat = statFunc(src);

  let destStat;

  try {
    destStat = statFunc(dest);
  } catch (err) {
    if (err.code === 'ENOENT') {
      destStat = null;
    } else {
      throw err;
    }
  }

  return {
    srcStat,
    destStat,
  };
}


/*
 * ---------------------------------------------------------------------------
 * Parent-path safety
 * ---------------------------------------------------------------------------
 *
 * Walk upward from destination's parent and make sure that the destination
 * tree does not eventually resolve back onto the source.
 *
 * This protects against:
 *
 *   src/
 *   src/file
 *
 * followed by:
 *
 *   cpSync(src, src/subdir/out, { recursive: true })
 *
 * The WASI environment does not necessarily expose a traditional host root,
 * so "." is also treated as a stopping point.
 */

function checkParentPathsSync(src, srcStat, dest) {
  const srcParent = resolve(dirname(src));
  const destParent = resolve(dirname(dest));

  /*
   * Nothing more to inspect once we reach:
   *
   *   - the source parent
   *   - the parsed filesystem root
   *   - "."
   *
   * The final condition is useful for WASI/QuickJS path environments.
   */
  if (
    destParent === srcParent ||
    destParent === parse(destParent).root ||
    destParent === "."
  ) {
    return;
  }

  let destStat;

  try {
    /*
     * Use BigInt here because srcStat came from the identity-stat phase.
     */
    destStat = statSync(destParent, { bigint: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }

    throw err;
  }

  /*
   * The parent itself is the source.
   */
  if (
    resolve(src) === resolve(destParent) ||
    areIdentical(srcStat, destStat)
  ) {
    throw new ERR_FS_CP_EINVAL({
      message: `cannot copy ${src} to a subdirectory of self ${dest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  return checkParentPathsSync(src, srcStat, destParent);
}


/*
 * ---------------------------------------------------------------------------
 * Filter + destination-parent handling
 * ---------------------------------------------------------------------------
 */

function handleFilterAndCopy(destStat, src, dest, opts) {
  /*
   * The root filter has already been evaluated by cpSyncFn().
   *
   * At this point we only need to make sure the destination's parent exists.
   */
  const destParent = dirname(dest);

  if (!existsSync(destParent)) {
    mkdirSync(destParent, { recursive: true });
  }

  return getStats(destStat, src, dest, opts);
}


/*
 * ---------------------------------------------------------------------------
 * Per-entry filter
 * ---------------------------------------------------------------------------
 */

function startCopy(destStat, src, dest, opts) {
  if (opts.filter) {
    const shouldCopy = opts.filter(src, dest);

    if (isPromise(shouldCopy)) {
      throw new ERR_INVALID_RETURN_VALUE(
        'boolean',
        'filter',
        shouldCopy
      );
    }

    if (!shouldCopy) {
      return;
    }
  }

  return getStats(destStat, src, dest, opts);
}


/*
 * ---------------------------------------------------------------------------
 * Actual source-type dispatch
 * ---------------------------------------------------------------------------
 *
 * This intentionally uses ordinary Stats.
 *
 * The BigInt identity stats used earlier must NOT leak into mode/timestamp
 * operations.
 */

function getStats(destStat, src, dest, opts) {
  const statSyncFn = opts.dereference ? statSync : lstatSync;
  const srcStat = statSyncFn(src);

  if (srcStat.isDirectory() && opts.recursive) {
    return onDir(srcStat, destStat, src, dest, opts);
  }

  if (srcStat.isDirectory()) {
    throw new ERR_FS_EISDIR({
      message: `${src} is a directory (not copied)`,
      path: src,
      syscall: 'cp',
      errno: EISDIR,
      code: 'EISDIR',
    });
  }

  if (
    srcStat.isFile() ||
    srcStat.isCharacterDevice() ||
    srcStat.isBlockDevice()
  ) {
    return onFile(srcStat, destStat, src, dest, opts);
  }

  if (srcStat.isSymbolicLink()) {
    return onLink(destStat, src, dest, opts);
  }

  if (srcStat.isSocket()) {
    throw new ERR_FS_CP_SOCKET({
      message: `cannot copy a socket file: ${dest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  if (srcStat.isFIFO()) {
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


/*
 * ---------------------------------------------------------------------------
 * Regular files
 * ---------------------------------------------------------------------------
 */

function onFile(srcStat, destStat, src, dest, opts) {
  /*
   * Destination does not exist.
   */
  if (!destStat) {
    return copyFile(srcStat, src, dest, opts);
  }

  /*
   * Destination exists and force=true.
   *
   * Node replaces the existing destination.
   */
  if (opts.force) {
    unlinkSync(dest);
    return copyFile(srcStat, src, dest, opts);
  }

  /*
   * force=false + errorOnExist=true => EEXIST.
   */
  if (opts.errorOnExist) {
    throw new ERR_FS_CP_EEXIST({
      message: `${dest} already exists`,
      path: dest,
      syscall: 'cp',
      errno: EEXIST,
      code: 'EEXIST',
    });
  }

  /*
   * force=false + errorOnExist=false => do nothing.
   */
  return;
}


function copyFile(srcStat, src, dest, opts) {
  /*
   * Preserve the public fs.cp()/cpSync() mode option.
   *
   * If the compatibility fs.js implementation ignores an undefined mode,
   * this remains backwards-compatible.
   */
  copyFileSync(src, dest, opts.mode);

  if (opts.preserveTimestamps) {
    handleTimestamps(srcStat.mode, src, dest);
  }

  return setDestMode(dest, srcStat.mode);
}


/*
 * ---------------------------------------------------------------------------
 * File timestamps + mode
 * ---------------------------------------------------------------------------
 */

function handleTimestamps(srcMode, src, dest) {
  /*
   * utimes may require the destination to be writable.
   *
   * Match Node's behavior by temporarily restoring owner-write permission.
   */
  if (fileIsNotWritable(srcMode)) {
    makeFileWritable(dest, srcMode);
  }

  return setDestTimestamps(src, dest);
}


function fileIsNotWritable(srcMode) {
  return (srcMode & 0o200) === 0;
}


function makeFileWritable(dest, srcMode) {
  return setDestMode(dest, srcMode | 0o200);
}


function setDestMode(dest, srcMode) {
  return chmodSync(dest, srcMode);
}


function setDestTimestamps(src, dest) {
  /*
   * The source atime can have changed after the file was read.
   *
   * Obtain a fresh stat immediately before applying timestamps.
   */
  const updatedSrcStat = statSync(src);

  return utimesSync(
    dest,
    updatedSrcStat.atime,
    updatedSrcStat.mtime
  );
}


/*
 * ---------------------------------------------------------------------------
 * Directories
 * ---------------------------------------------------------------------------
 */

function onDir(srcStat, destStat, src, dest, opts) {
  /*
   * Destination does not exist.
   */
  if (!destStat) {
    return mkDirAndCopy(srcStat.mode, src, dest, opts);
  }

  /*
   * Node's contract:
   *
   * errorOnExist only matters when force=false.
   */
  if (opts.errorOnExist && !opts.force) {
    throw new ERR_FS_CP_EEXIST({
      message: `${dest} already exists`,
      path: dest,
      syscall: 'cp',
      errno: EEXIST,
      code: 'EEXIST',
    });
  }

  copyDir(src, dest, opts);

  /*
   * When the destination directory already existed, restore timestamps
   * after all children have been copied.
   */
  if (opts.preserveTimestamps) {
    setDestTimestamps(src, dest);
  }
}


function mkDirAndCopy(srcMode, src, dest, opts) {
  /*
   * The destination itself is known not to exist.
   *
   * mkdirSync() intentionally creates exactly this directory. Its parent
   * hierarchy was already handled by handleFilterAndCopy().
   */
  mkdirSync(dest);

  copyDir(src, dest, opts);

  /*
   * Preserve the source directory timestamps when requested.
   */
  if (opts.preserveTimestamps) {
    setDestTimestamps(src, dest);
  }

  /*
   * Finally restore the source directory mode.
   */
  return setDestMode(dest, srcMode);
}


/*
 * ---------------------------------------------------------------------------
 * Recursive directory traversal
 * ---------------------------------------------------------------------------
 */

function copyDir(src, dest, opts) {
  const dir = opendirSync(src);

  try {
    let dirent;

    while ((dirent = dir.readSync()) !== null) {
      const { name } = dirent;

      const srcItem = join(src, name);
      const destItem = join(dest, name);

      /*
       * Perform the same destination/source relationship checks for every
       * recursive entry.
       */
      const {
        destStat,
      } = checkPathsSync(srcItem, destItem, opts);

      startCopy(destStat, srcItem, destItem, opts);
    }
  } finally {
    /*
     * Always close the directory, including when a child copy throws.
     */
    dir.closeSync();
  }
}


/*
 * ---------------------------------------------------------------------------
 * Symbolic links
 * ---------------------------------------------------------------------------
 */

function onLink(destStat, src, dest, opts) {
  /*
   * Read the link itself. Because opts.dereference=false is required to reach
   * this function, the source must remain a symbolic link.
   */
  let resolvedSrc;

  try {
    resolvedSrc = readlinkSync(src);
  } catch (err) {
    /*
     * Some WASI filesystem implementations may expose an incomplete
     * readlink implementation. In that case, fall back to copying the
     * resolved source as a normal file.
     *
     * This is a deliberate WASI compatibility fallback.
     */
    const stat = statSync(src);
    return onFile(stat, destStat, src, dest, opts);
  }

  /*
   * Node's default behavior resolves relative symlink targets unless
   * verbatimSymlinks=true.
   */
  if (!opts.verbatimSymlinks && !isAbsolute(resolvedSrc)) {
    resolvedSrc = resolve(dirname(src), resolvedSrc);
  }

  /*
   * Determine whether the symlink target is a directory.
   *
   * stat() follows the link; lstat() would only tell us that src itself
   * is a symlink.
   */
  let srcIsDir = false;

  try {
    srcIsDir = statSync(src).isDirectory();
  } catch (_) {
    /*
     * Broken symlink: treat it as a file target for platforms that require
     * an explicit symlink type.
     */
    srcIsDir = false;
  }

  /*
   * QuickJS/WASI fs.js may ignore the third argument if the underlying WASI
   * implementation does not distinguish link types.
   */
  const symlinkType = srcIsDir ? 'dir' : 'file';

  /*
   * Destination does not exist.
   */
  if (!destStat) {
    try {
      return symlinkSync(
        resolvedSrc,
        dest,
        symlinkType
      );
    } catch (err) {
      /*
       * Deliberate WASI fallback:
       *
       * Some WASI configurations deny symlink creation entirely.
       * If so, copy the target rather than making the entire cp operation
       * unusable.
       *
       * NOTE: this is a compatibility extension, not exact POSIX semantics.
       */
      return onFile(statSync(src), destStat, src, dest, opts);
    }
  }

  /*
   * Destination already exists.
   *
   * Determine whether the existing destination is itself a symlink.
   */
  let resolvedDest;

  try {
    resolvedDest = readlinkSync(dest);
  } catch (err) {
    /*
     * Existing regular file/directory.
     *
     * Windows-compatible Node behavior permits EINVAL/UNKNOWN here.
     */
    if (err.code === 'EINVAL' || err.code === 'UNKNOWN') {
      try {
        return symlinkSync(
          resolvedSrc,
          dest,
          symlinkType
        );
      } catch (_) {
        return onFile(
          statSync(src),
          destStat,
          src,
          dest,
          opts
        );
      }
    }

    throw err;
  }

  if (!isAbsolute(resolvedDest)) {
    resolvedDest = resolve(dirname(dest), resolvedDest);
  }

  /*
   * Only directory symlinks can form the "copy into subdirectory of self"
   * relationship.
   */
  if (
    srcIsDir &&
    isSrcSubdir(resolvedSrc, resolvedDest)
  ) {
    throw new ERR_FS_CP_EINVAL({
      message:
        `cannot copy ${resolvedSrc} to a subdirectory of self ` +
        `${resolvedDest}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  /*
   * Prevent unlinking a real destination directory when the source resolves
   * inside that destination.
   */
  const actualDestStat = statSync(dest);

  if (
    actualDestStat.isDirectory() &&
    isSrcSubdir(resolvedDest, resolvedSrc)
  ) {
    throw new ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY({
      message:
        `cannot overwrite ${resolvedDest} with ${resolvedSrc}`,
      path: dest,
      syscall: 'cp',
      errno: EINVAL,
      code: 'EINVAL',
    });
  }

  return copyLink(
    resolvedSrc,
    dest,
    symlinkType,
    src,
    destStat,
    opts
  );
}


/*
 * ---------------------------------------------------------------------------
 * Symbolic-link replacement
 * ---------------------------------------------------------------------------
 */

function copyLink(
  resolvedSrc,
  dest,
  symlinkType,
  src,
  destStat,
  opts
) {
  /*
   * Node replaces the existing destination.
   */
  try {
    unlinkSync(dest);

    return symlinkSync(
      resolvedSrc,
      dest,
      symlinkType
    );
  } catch (err) {
    /*
     * Deliberate WASI compatibility fallback.
     *
     * If the WASI host denies unlink/symlink creation, fall back to copying
     * the source as a normal file where possible.
     */
    return onFile(
      statSync(src),
      destStat,
      src,
      dest,
      opts
    );
  }
}


/*
 * ---------------------------------------------------------------------------
 * Export
 * ---------------------------------------------------------------------------
 *
 * cp-sync.js is consumed internally as the synchronous cp implementation.
 * Keep the default export as the cpSyncFn itself, matching the internal
 * module's intended shape.
 */

export { cpSyncFn };

export default cpSyncFn;
