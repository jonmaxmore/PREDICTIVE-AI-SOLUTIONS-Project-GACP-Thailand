/**
 * Test harness for gacp/no-direct-application-status-write — PR-WF-1.
 *
 * Exit 0 = all tests pass; non-zero = at least one failed.
 */

'use strict';

const path = require('path');
const { Linter } = require('eslint');
const rule = require('./no-direct-application-status-write');

const linter = new Linter({ configType: 'flat' });
const baseConfig = {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    plugins: { gacp: { rules: { 'no-direct-application-status-write': rule } } },
    rules: { 'gacp/no-direct-application-status-write': 'error' },
};

function abs(rel) {
    return path.resolve(process.cwd(), rel);
}

function lint(code, relativeFilename) {
    return linter.verify(code, [baseConfig], { filename: abs(relativeFilename) });
}

const cases = [
    // ── Allowed (no warnings) ─────────────────────────────────────
    {
        label: 'update without status field is OK',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.application.update({ where: { id: 'a' }, data: { phase1Status: 'PAID' } }); }",
        expectErrors: 0,
    },
    {
        label: 'updateMany without status is OK',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.application.updateMany({ where: { healthId: 'h' }, data: { isDeleted: true } }); }",
        expectErrors: 0,
    },
    {
        label: 'unrelated prisma model update is OK',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.invoice.update({ where: { id: 'i' }, data: { status: 'PAID' } }); }",
        expectErrors: 0,
    },
    {
        label: 'writer file itself is exempt (status write OK there)',
        filename: 'services/application-status-writer.js',
        code: "async function f() { return prisma.application.update({ where: { id: 'a' }, data: { status: 'SUBMITTED' } }); }",
        expectErrors: 0,
    },
    {
        label: 'writer test file is exempt',
        filename: '__tests__/unit/application-status-writer.test.js',
        code: "async function f() { return prisma.application.update({ where: { id: 'a' }, data: { status: 'SUBMITTED' } }); }",
        expectErrors: 0,
    },

    // ── Flagged ────────────────────────────────────────────────────
    {
        label: 'direct update with status in services',
        filename: 'services/application-service/foo.js',
        code: "async function f() { return prisma.application.update({ where: { id: 'a' }, data: { status: 'SUBMITTED' } }); }",
        expectErrors: 1,
        expectMsgId: 'directStatusWrite',
    },
    {
        label: 'direct update with status in routes',
        filename: 'routes/api/admin/applications.js',
        code: "async function f() { return prisma.application.update({ where: { id: 'a' }, data: { status: 'CERTIFIED', updatedAt: new Date() } }); }",
        expectErrors: 1,
        expectMsgId: 'directStatusWrite',
    },
    {
        label: 'direct updateMany with status flagged',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.application.updateMany({ where: { healthId: 'h' }, data: { status: 'EXPIRED' } }); }",
        expectErrors: 1,
        expectMsgId: 'directStatusWrite',
    },
    {
        label: 'tx.application.update with status flagged (different binding name)',
        filename: 'services/foo.js',
        code: "async function f() { return tx.application.update({ where: { id: 'a' }, data: { status: 'SUBMITTED' } }); }",
        expectErrors: 1,
        expectMsgId: 'directStatusWrite',
    },

    // ── R1b: upsert's `update` branch must not slip a status write past the guard ──
    //
    // Scope boundary pinned by the cases below — mutate-existing-row ONLY:
    //   flagged     : update / updateMany / upsert.update  (moves a live row's status)
    //   not flagged : create / upsert.create               (brings a new row into being)
    // Rationale: writeApplicationStatus() is a from→to transition on an existing
    // row and structurally cannot create one, so every application must be born
    // from some `create`. Flagging creation would flag the normal birth path
    // while closing no hole — a row that does not exist yet has no prior status
    // for a caller to bypass the terminal/writer fence on.
    {
        label: 'upsert without status in either branch is OK',
        filename: 'prisma/seed.js',
        code: "async function f() { return prisma.application.upsert({ where: { id: 'a' }, update: { formData: {} }, create: { id: 'a', formData: {} } }); }",
        expectErrors: 0,
    },
    {
        label: 'create without status is OK',
        filename: 'prisma/seed.js',
        code: "async function f() { return prisma.application.create({ data: { applicationNumber: 'X', formData: {} } }); }",
        expectErrors: 0,
    },
    {
        label: 'unrelated model upsert with status is OK',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.invoice.upsert({ where: { id: 'i' }, update: { status: 'PAID' }, create: { status: 'PAID' } }); }",
        expectErrors: 0,
    },
    {
        label: 'unrelated model create with status is OK',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.invoice.create({ data: { status: 'PAID' } }); }",
        expectErrors: 0,
    },
    {
        label: 'application.upsert with status in update branch flagged',
        filename: 'prisma/seed.js',
        code: "async function f() { return prisma.application.upsert({ where: { id: 'a' }, update: { status: 'CERTIFIED' }, create: { id: 'a', formData: {} } }); }",
        expectErrors: 1,
        expectMsgId: 'directStatusWrite',
    },
    {
        // create-branch-only status == creating a new row == same as a bare
        // `create`, so NOT flagged. Real shape: scripts/ent01-two-org-verify.js:72
        // (update: { organizationId }, create: { status: 'DRAFT' }) — that seeds a
        // fresh row, it never moves an existing one.
        label: 'application.upsert with status ONLY in create branch is OK (creates a row, does not transition one)',
        filename: 'prisma/seed.js',
        code: "async function f() { return prisma.application.upsert({ where: { id: 'a' }, update: { formData: {} }, create: { id: 'a', status: 'REJECTED' } }); }",
        expectErrors: 0,
    },
    {
        // seed-gacp.js:322-329 shape — trips on the update branch. This is the
        // case the line-scoped eslint-disable there is still required for.
        label: 'application.upsert with status in BOTH branches reports exactly once (via update branch)',
        filename: 'prisma/seed.js',
        code: "async function f() { return prisma.application.upsert({ where: { id: 'a' }, update: { status: 'CERTIFIED' }, create: { id: 'a', status: 'REJECTED' } }); }",
        expectErrors: 1,
        expectMsgId: 'directStatusWrite',
    },
    {
        // Bare create with status == the normal birth path (10 real call sites,
        // incl. services/application-service/application-submission-methods.js:129).
        label: 'application.create with status is OK (row birth, not a transition)',
        filename: 'prisma/seed.js',
        code: "async function f() { return prisma.application.create({ data: { applicationNumber: 'X', status: 'DRAFT' } }); }",
        expectErrors: 0,
    },
    {
        label: 'tx.application.create with status is OK (row birth, different binding name)',
        filename: 'services/foo.js',
        code: "async function f() { return tx.application.create({ data: { applicationNumber: 'X', status: 'SUBMITTED' } }); }",
        expectErrors: 0,
    },
    {
        label: 'tx.application.upsert with status flagged (different binding name)',
        filename: 'services/foo.js',
        code: "async function f() { return tx.application.upsert({ where: { id: 'a' }, update: { status: 'SUBMITTED' }, create: { id: 'a' } }); }",
        expectErrors: 1,
        expectMsgId: 'directStatusWrite',
    },
    {
        label: 'writer file itself is exempt for upsert too',
        filename: 'services/application-status-writer.js',
        code: "async function f() { return prisma.application.upsert({ where: { id: 'a' }, update: { status: 'SUBMITTED' }, create: { id: 'a' } }); }",
        expectErrors: 0,
    },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
    const messages = lint(c.code, c.filename);
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
