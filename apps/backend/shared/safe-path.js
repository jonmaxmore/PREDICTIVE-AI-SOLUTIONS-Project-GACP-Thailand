/**
 * Path confinement for APIs that take a file NAME.
 *
 * `path.join(dir, name)` resolves `..` rather than rejecting it, so a value
 * like `'../../../shared/logger.js'` silently escapes `dir`. Any function whose
 * argument is called `filename` reads as safe, which is exactly why this keeps
 * being reintroduced: the caller has no cue that the value is interpreted as a
 * path at all.
 *
 * ONE DIRECTION: a name is a name. It never contains a directory component, so
 * a value that does is REJECTED — not quietly rewritten with path.basename().
 * Rewriting is the more dangerous repair for a delete: it would remove a
 * different file than the caller named and report success.
 *
 * @module shared/safe-path
 */

'use strict';

const path = require('path');

class UnsafeFilenameError extends Error {
    constructor(filename) {
        super(`Unsafe filename (must be a bare name with no path component): ${JSON.stringify(filename)}`);
        this.name = 'UnsafeFilenameError';
        this.code = 'UNSAFE_FILENAME';
    }
}

/**
 * True when `name` is a plain filename — no separators, no traversal, no
 * absolute prefix, not `.` or `..`.
 *
 * Checks both separators regardless of platform: a POSIX server can still be
 * handed a Windows-style `..\\..\\x` by a client, and `path.basename` on POSIX
 * would not treat the backslash as a separator.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
function isBareFilename(name) {
    if (typeof name !== 'string') {
        return false;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..') {
        return false;
    }
    if (trimmed.includes('/') || trimmed.includes('\\')) {
        return false;
    }
    if (trimmed.includes('\0')) {
        return false;
    }
    // Belt and braces: whatever the platform thinks, the basename must be the
    // whole string, and it must not be absolute.
    return !path.isAbsolute(trimmed) && path.basename(trimmed) === trimmed;
}

/**
 * Join `filename` onto `directory`, proving the result stays inside it.
 *
 * @param {string} directory absolute directory the file must live in
 * @param {unknown} filename bare filename supplied by a caller
 * @returns {string} the resolved absolute path
 * @throws {UnsafeFilenameError} when the name is not a bare filename, or the
 *         resolved path would land outside `directory`
 */
function resolveInDirectory(directory, filename) {
    if (!isBareFilename(filename)) {
        throw new UnsafeFilenameError(filename);
    }
    const root = path.resolve(directory);
    const resolved = path.resolve(root, String(filename).trim());
    // The separator suffix is what stops `<root>-evil/x` passing as a child.
    if (!resolved.startsWith(root + path.sep)) {
        throw new UnsafeFilenameError(filename);
    }
    return resolved;
}

module.exports = {
    UnsafeFilenameError,
    isBareFilename,
    resolveInDirectory,
};
