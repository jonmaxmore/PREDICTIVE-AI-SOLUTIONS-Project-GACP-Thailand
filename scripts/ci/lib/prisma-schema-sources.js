'use strict';

/**
 * Where Prisma schema sources are allowed to live (guardrail G-04).
 *
 * This repo uses the prismaSchemaFolder preview feature: the schema is 28
 * domain files under apps/backend/prisma/schema/, declared in _base.prisma,
 * and every command passes --schema=prisma/schema (see apps/backend/Dockerfile).
 * Prisma concatenates the whole folder, so a .prisma file somewhere else is
 * either dead weight or a silently competing source of truth, and reading it
 * does not tell you which. That is not hypothetical here: commit 3120e673
 * ("Prisma found both prisma/schema.prisma AND prisma/schema/ directory.
 * Removed the old monolith.") is the incident this rule was written for.
 *
 * Kept in its own module so the rule can be unit-tested directly, without
 * running the six sibling checks in check-enforcement-guardrails.js — one of
 * which shells out to `prisma validate` and needs the network.
 */

const { execFileSync } = require('child_process');

// The only directory a .prisma file may live in. Trailing slash is required:
// it is what keeps a near-miss like prisma/schema-v2/ from being accepted.
const CANONICAL_SCHEMA_DIR = 'apps/backend/prisma/schema/';

/**
 * Every .prisma file git knows about, repo-relative, sorted by git.
 * Tracked files only: CI checks out a clean tree, so an untracked scratch file
 * is not what the gate is about, and counting it would make local runs noisy.
 * @param {string} root absolute path to the repository root
 * @returns {string[]}
 */
function listTrackedPrismaFiles(root) {
    const output = execFileSync('git', ['ls-files', '--', '*.prisma'], {
        cwd: root,
        encoding: 'utf8',
    });

    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

/**
 * The files that are a second schema source.
 * @param {string[]} files repo-relative paths
 * @returns {string[]}
 */
function findStraySchemaFiles(files) {
    return files.filter((file) => !file.replace(/\\/g, '/').startsWith(CANONICAL_SCHEMA_DIR));
}

/**
 * Verdict for the gate. An empty input is a failure, not a pass: the previous
 * version of this check matched zero files for five months and printed a pass
 * line the whole time. If the schema cannot be found, the gate has verified
 * nothing and must say so.
 *
 * `summary` is built here, not by the caller, because the caller's first draft
 * reused one string for both outcomes and printed "all under <dir>" on a line
 * that went on to list two files that were not under it.
 * @param {string[]} files repo-relative paths
 * @returns {{ok: boolean, checked: number, strays: string[], summary: string, reason: string|null}}
 */
function evaluateSchemaSources(files) {
    const checked = files.length;

    if (checked === 0) {
        return {
            ok: false,
            checked: 0,
            strays: [],
            summary: '0 .prisma files found',
            reason: `no .prisma file found under ${CANONICAL_SCHEMA_DIR} — this check verified nothing`,
        };
    }

    const strays = findStraySchemaFiles(files);

    if (strays.length === 0) {
        return {
            ok: true,
            checked,
            strays,
            summary: `${checked} .prisma files, all under ${CANONICAL_SCHEMA_DIR}`,
            reason: null,
        };
    }

    return {
        ok: false,
        checked,
        strays,
        summary: `${checked} .prisma files checked, ${strays.length} outside ${CANONICAL_SCHEMA_DIR}`,
        reason: 'Prisma schema found outside the canonical folder',
    };
}

module.exports = {
    CANONICAL_SCHEMA_DIR,
    listTrackedPrismaFiles,
    findStraySchemaFiles,
    evaluateSchemaSources,
};
