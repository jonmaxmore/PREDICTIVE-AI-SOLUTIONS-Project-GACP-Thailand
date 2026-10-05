/**
 * gacp/no-direct-application-status-write — Phase A6 / PR-WF-1.
 *
 * Flags any direct `prisma.application` mutation that sets `status` on a row
 * that ALREADY EXISTS, from a file OTHER than the canonical
 * `services/application-status-writer.js`. The intent is to surface every
 * direct status *transition* so the migration backlog is visible in lint
 * output.
 *
 * SCOPE: mutate-existing-row only. Row creation is deliberately NOT covered.
 * `writeApplicationStatus()` performs a from→to transition on an existing row
 * (it reads the current status, asserts the transition is legal, then writes);
 * it structurally cannot bring a row into existence. Every application must
 * therefore be born from some `create`, so flagging `create` would flag the
 * normal birth path — 10 legitimate call sites, including the production
 * submit and draft-create paths
 * — while closing no hole: a brand-new row has no prior status to bypass a
 * fence on. The real hole is a write that moves an existing row's status
 * around the writer, which is what this rule catches.
 *
 * Covered methods and where the `status` key is looked for:
 *   - update / updateMany → `data.status`   (mutates existing rows)
 *   - upsert              → `update.status` ONLY (the update branch is the
 *     row-already-exists path — the R1b hole was exactly
 *     `prisma.application.upsert({ update: { status } })` slipping past a rule
 *     that only knew update/updateMany, e.g. prisma/seed-gacp.js:322-329).
 *
 * Allowed: writes that don't include a `status` key in the relevant payload;
 * `create`; an `upsert` whose `status` appears only in the `create` branch
 * (that branch runs only when no row exists, so it is a create, not a
 * transition); or any write from inside `application-status-writer.js` itself.
 *
 * Severity is `warn` initially. Once the existing 92-ish call sites
 * are migrated to use writeApplicationStatus(), the rule flips to
 * `error` (PR-WF-2 ratchet).
 */

'use strict';

const _path = require('path');

const WRITER_FILE_PATTERNS = [
    /\/apps\/backend\/services\/application-status-writer\.js$/i,
    /\/apps\/backend\/services\/application-status-writer\.test\.js$/i,
    /\/apps\/backend\/__tests__\/.*\/application-status-writer\.test\.js$/i,
    // Future home in modules/:
    /\/apps\/backend\/modules\/application\/internal\/status-writer\.js$/i,
];

function isCanonicalWriter(filename) {
    if (!filename) {return false;}
    const norm = filename.replace(/\\/g, '/');
    return WRITER_FILE_PATTERNS.some((re) => re.test(norm));
}

/**
 * Pick out the property named `propName` from an ObjectExpression node.
 * Returns the property's `value` AST node, or null.
 */
function findProperty(objectExprNode, propName) {
    if (!objectExprNode || objectExprNode.type !== 'ObjectExpression') {return null;}
    for (const p of objectExprNode.properties) {
        if (p.type !== 'Property') {continue;}
        const key = p.key;
        if (
            (key.type === 'Identifier' && key.name === propName) ||
            (key.type === 'Literal' && key.value === propName)
        ) {
            return p.value;
        }
    }
    return null;
}

// Prisma write methods that can move an EXISTING Application row's `status`.
// `upsert` is included because its `update` branch is exactly such a move —
// that omission was the R1b hole (`prisma.application.upsert({ update: {
// status } })` walked past a rule that only knew update/updateMany).
// `create` is deliberately absent: it brings a new row into existence rather
// than transitioning one, so it cannot bypass a fence (see file header).
const STATUS_WRITE_METHODS = new Set(['update', 'updateMany', 'upsert']);

/**
 * Decide whether a CallExpression matches a `prisma.application.<method>(...)`
 * write where <method> is one of STATUS_WRITE_METHODS. Returns the method name
 * on match, or null.
 */
function matchPrismaApplicationUpdate(callExpr) {
    const callee = callExpr.callee;
    if (!callee || callee.type !== 'MemberExpression') {return null;}
    if (callee.property.type !== 'Identifier') {return null;}
    const methodName = callee.property.name;
    if (!STATUS_WRITE_METHODS.has(methodName)) {return null;}
    // .<method> is on `<x>.application` — walk one more step
    const innerExpr = callee.object;
    if (
        !innerExpr ||
        innerExpr.type !== 'MemberExpression' ||
        innerExpr.property.type !== 'Identifier' ||
        innerExpr.property.name !== 'application'
    ) {
        return null;
    }
    return methodName;
}

/**
 * Given the matched method and the call's first argument (ObjectExpression),
 * decide whether it sets `status` on an already-existing row. Routes each
 * method to its payload sub-object:
 *   - update / updateMany → `data.status`
 *   - upsert              → `update.status` only
 * Returns true on a status write (reported once per call), false otherwise.
 */
function argSetsStatus(method, arg) {
    if (!arg || arg.type !== 'ObjectExpression') {return false;}
    if (method === 'upsert') {
        // Only the `update` branch is a transition: it runs when the row already
        // exists, so a `status` there moves a live row around the writer. The
        // `create` branch runs only when no row exists — that is a birth, not a
        // transition, and is treated exactly like a bare `create` (not flagged).
        // `upsert({ update: { status }, create: { status } })` — the seed-gacp.js
        // shape (prisma/seed-gacp.js:322-329) — still trips, via its update branch.
        const updateBranch = findProperty(arg, 'update');
        return Boolean(
            updateBranch &&
                updateBranch.type === 'ObjectExpression' &&
                findProperty(updateBranch, 'status'),
        );
    }
    // update / updateMany both carry the row payload under `data`.
    const dataNode = findProperty(arg, 'data');
    if (!dataNode || dataNode.type !== 'ObjectExpression') {return false;}
    return Boolean(findProperty(dataNode, 'status'));
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Direct prisma.application status writes on an existing row ' +
                '(update / updateMany / upsert-update-branch) must go through ' +
                'services/application-status-writer.writeApplicationStatus(). ' +
                'Row creation (create / upsert-create-branch) is out of scope.',
            category: 'Best Practices',
            recommended: false,
        },
        schema: [],
        messages: {
            directStatusWrite:
                "Direct status write detected: prisma.application.{{ method }} with `status` field. " +
                "Use `writeApplicationStatus()` from services/application-status-writer.js instead. " +
                "(Phase A6 / PR-WF-1 — see modules/README.md for migration plan.)",
        },
    },

    create(context) {
        const filename = context.filename || context.getFilename();
        if (isCanonicalWriter(filename)) {
            // The writer itself is allowed — and so are its tests.
            return {};
        }

        return {
            CallExpression(node) {
                const method = matchPrismaApplicationUpdate(node);
                if (!method) {return;}
                // Inspect the method's payload sub-object for a `status` key.
                if (!argSetsStatus(method, node.arguments[0])) {return;}
                context.report({
                    node,
                    messageId: 'directStatusWrite',
                    data: { method },
                });
            },
        };
    },
};

// Exposed for unit tests.
module.exports.__test = { isCanonicalWriter, matchPrismaApplicationUpdate, argSetsStatus, findProperty, WRITER_FILE_PATTERNS, STATUS_WRITE_METHODS };
