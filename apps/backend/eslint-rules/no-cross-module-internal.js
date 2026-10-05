/**
 * gacp/no-cross-module-internal — Phase A6 §A6-1 module boundary rule.
 *
 * Flags any `require()` or `import` of `"modules/<other>/internal/..."`
 * from a file outside that same module. The intent is to surface
 * cross-module reaches into private internals so they get refactored
 * to use the importing module's public barrel (`modules/<other>/index.js`).
 *
 * Allowed:
 *   - require('../modules/billing')          ← public barrel
 *   - require('../modules/billing/index.js')  ← same as above
 *   - require('../modules/billing/routes/...')← public route file
 *   - same-module: a file in modules/billing/internal/foo.js requiring
 *     ../internal/bar.js, or modules/billing/index.js requiring
 *     ./internal/bar.js
 *
 * Flagged:
 *   - require('../modules/billing/internal/fee-service') from a file
 *     outside modules/billing/
 *
 * Severity: starts as `warn` — there are zero violations on landing
 * because no services have been moved into modules/ yet. Once Phase A6
 * step 2+ migrates services and any cross-module reach is detected, the
 * rule fails CI early instead of after merge.
 */

'use strict';

const path = require('path');

/**
 * Determine which module (if any) a file path belongs to. Returns the
 * module name (e.g. "billing") or null if the file is outside modules/.
 */
function moduleNameOf(filePathRaw) {
    if (!filePathRaw) {return null;}
    // Normalise to forward-slash for consistent matching across OSes.
    const filePath = filePathRaw.replace(/\\/g, '/');
    const m = filePath.match(/\/apps\/backend\/modules\/([^/]+)\//);
    return m ? m[1] : null;
}

/**
 * Determine which module's internal/ a target import path resolves to,
 * relative to the importing file. Returns the target module name OR
 * null if the target is not under modules/<x>/internal/.
 *
 * @param {string} importingFile — absolute path of the file with the import
 * @param {string} target        — the require/import string (relative or absolute)
 */
function targetInternalModule(importingFile, target) {
    if (!target || typeof target !== 'string') {return null;}
    // Skip non-relative imports — those are npm packages, not our modules
    // (with the noted exception of an absolute @-alias if the project has
    // one configured for backend, which it currently does not).
    if (!target.startsWith('.') && !target.startsWith('/')) {return null;}
    const resolved = path
        .resolve(path.dirname(importingFile), target)
        .replace(/\\/g, '/');
    const m = resolved.match(/\/apps\/backend\/modules\/([^/]+)\/internal\b/);
    return m ? m[1] : null;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow importing modules/<other>/internal/* from outside that module. ' +
                'Use the module\'s public barrel (modules/<other>) instead.',
            category: 'Best Practices',
            recommended: false,
        },
        schema: [],
        messages: {
            crossModuleInternal:
                "Cross-module reach detected: importing internal of '{{ targetModule }}' from '{{ source }}'. " +
                "Use the public barrel `modules/{{ targetModule }}` instead, or expose the symbol from " +
                "`modules/{{ targetModule }}/index.js` if it is genuinely public API.",
            crossModuleInternalFromOutside:
                "Reaching into 'modules/{{ targetModule }}/internal/' from a file that is not part of any " +
                "module ({{ source }}). Treat 'internal/' as private — use the public barrel " +
                "`modules/{{ targetModule }}` instead.",
        },
    },

    create(context) {
        const filename = context.filename || context.getFilename();
        const ownModule = moduleNameOf(filename);

        function check(node, target) {
            const targetModule = targetInternalModule(filename, target);
            if (!targetModule) {return;}
            if (ownModule === targetModule) {return;} // same-module internal access OK
            context.report({
                node,
                messageId: ownModule
                    ? 'crossModuleInternal'
                    : 'crossModuleInternalFromOutside',
                data: {
                    targetModule,
                    source: ownModule || 'non-module file',
                },
            });
        }

        return {
            // CommonJS: require('...')
            CallExpression(node) {
                if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') {
                    return;
                }
                const arg = node.arguments[0];
                if (!arg) {return;}
                if (arg.type === 'Literal' && typeof arg.value === 'string') {
                    check(node, arg.value);
                }
                if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
                    check(node, arg.quasis[0].value.cooked);
                }
            },
            // ESM: import x from '...'
            ImportDeclaration(node) {
                if (typeof node.source.value === 'string') {
                    check(node, node.source.value);
                }
            },
            // ESM: import('...')
            ImportExpression(node) {
                if (
                    node.source.type === 'Literal' &&
                    typeof node.source.value === 'string'
                ) {
                    check(node, node.source.value);
                }
            },
        };
    },
};
