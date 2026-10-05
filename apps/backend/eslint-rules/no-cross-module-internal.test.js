/**
 * Test harness for gacp/no-cross-module-internal — Phase A6 §A6-1.
 *
 * Uses the flat-config Linter API directly (matches what runtime ESLint
 * does). Run: `node eslint-rules/no-cross-module-internal.test.js`.
 *
 * Exit 0 = all tests pass; non-zero = at least one failed.
 */

'use strict';

const path = require('path');
const { Linter } = require('eslint');
const rule = require('./no-cross-module-internal');

const linter = new Linter({ configType: 'flat' });
// Flat config: `files: ['**/*.js']` is required for the rule to apply,
// AND filenames must resolve under `process.cwd()` (eslint's flat config
// matches relative to CWD). We resolve test filenames against CWD and
// the `apps/backend/` prefix. CWD when this runs is `apps/backend`, so
// the paths come out as the real paths a developer would lint.
const baseConfig = {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    plugins: { gacp: { rules: { 'no-cross-module-internal': rule } } },
    rules: { 'gacp/no-cross-module-internal': 'error' },
};

function abs(rel) {
    // `rel` is like "services/x.js" — resolve against CWD which is
    // expected to be apps/backend when the test is run from there.
    return path.resolve(process.cwd(), rel);
}

function lint(code, relativeFilename, sourceType = 'commonjs') {
    const config = {
        ...baseConfig,
        files: relativeFilename.endsWith('.mjs') ? ['**/*.mjs'] : ['**/*.js'],
        languageOptions: { ...baseConfig.languageOptions, sourceType },
    };
    return linter.verify(code, [config], { filename: abs(relativeFilename) });
}

const cases = [
    // ── Allowed (no warnings) ─────────────────────────────────────
    {
        label: 'public barrel import is OK',
        filename: 'services/x.js',
        code: "const billing = require('../modules/billing');",
        expectErrors: 0,
    },
    {
        label: 'public barrel via index.js is OK',
        filename: 'services/x.js',
        code: "const billing = require('../modules/billing/index.js');",
        expectErrors: 0,
    },
    {
        label: 'route file (not internal) is OK',
        filename: 'services/x.js',
        code: "const r = require('../modules/billing/routes/invoices.js');",
        expectErrors: 0,
    },
    {
        label: 'same-module internal access is OK',
        filename: 'modules/billing/internal/foo.js',
        code: "const fee = require('./fee-service');",
        expectErrors: 0,
    },
    {
        label: 'same-module internal via barrel is OK',
        filename: 'modules/billing/index.js',
        code: "const fee = require('./internal/fee-service');",
        expectErrors: 0,
    },
    {
        label: 'unrelated relative import is OK',
        filename: 'services/x.js',
        code: "const u = require('./utils');",
        expectErrors: 0,
    },
    {
        label: 'npm package import is OK',
        filename: 'services/x.js',
        code: "const lodash = require('lodash');",
        expectErrors: 0,
    },

    // ── Flagged (1 warning each) ──────────────────────────────────
    {
        label: 'cross-module internal from non-module file',
        filename: 'services/x.js',
        code: "const fee = require('../modules/billing/internal/fee-service');",
        expectErrors: 1,
        expectMsgId: 'crossModuleInternalFromOutside',
    },
    {
        label: 'cross-module internal from another module',
        filename: 'modules/audit/index.js',
        code: "const fee = require('../billing/internal/fee-service');",
        expectErrors: 1,
        expectMsgId: 'crossModuleInternal',
    },
    {
        label: 'ESM import of cross-module internal flagged',
        filename: 'modules/audit/index.mjs',
        code: "import fee from '../billing/internal/fee-service';",
        sourceType: 'module',
        expectErrors: 1,
        expectMsgId: 'crossModuleInternal',
    },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
    const messages = lint(c.code, c.filename, c.sourceType);
    const ok =
        messages.length === c.expectErrors &&
        (!c.expectMsgId ||
            (messages.length > 0 && messages[0].messageId === c.expectMsgId));
    if (ok) {
        pass += 1;
        console.log(`${c.label}`);
    } else {
        fail += 1;
        console.error(`${c.label}`);
        console.error(`    code:           ${c.code}`);
        console.error(`    filename:       ${c.filename}`);
        console.error(
            `    expected count: ${c.expectErrors}${c.expectMsgId ? ` + msg=${c.expectMsgId}` : ''}`,
        );
        console.error(
            `    got:            ${messages.length} ${JSON.stringify(messages.map((m) => m.messageId))}`,
        );
    }
}

console.log('');
console.log(`Total: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    process.exit(1);
}
