/**
 * Test harness for gacp/no-direct-audit-or-notification-write.
 *
 * Mirrors the harness used for no-direct-application-status-write.
 * Exit 0 = all tests pass; non-zero = at least one failed.
 */

'use strict';

const path = require('path');
const { Linter } = require('eslint');
const rule = require('./no-direct-audit-or-notification-write');

const linter = new Linter({ configType: 'flat' });
const baseConfig = {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    plugins: { gacp: { rules: { 'no-direct-audit-or-notification-write': rule } } },
    rules: { 'gacp/no-direct-audit-or-notification-write': 'error' },
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
        label: 'unrelated prisma model create is OK',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.user.create({ data: { email: 'x' } }); }",
        expectErrors: 0,
    },
    {
        label: 'prisma.application.update without status is OK (different rule)',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.application.update({ where: { id: 'a' }, data: { phase1Status: 'PAID' } }); }",
        expectErrors: 0,
    },
    {
        label: 'audit-logger.js itself is exempt for auditLog.create',
        filename: 'middleware/audit-logger.js',
        code: "async function f() { return prisma.auditLog.create({ data: { logId: 'x' } }); }",
        expectErrors: 0,
    },
    {
        label: 'notification-service.js itself is exempt for notification.create',
        filename: 'services/notification-service.js',
        code: "async function f() { return prisma.notification.create({ data: { userId: 'u' } }); }",
        expectErrors: 0,
    },
    {
        label: 'notification-service.js exempt for notification.createMany too',
        filename: 'services/notification-service.js',
        code: "async function f() { return prisma.notification.createMany({ data: [{ userId: 'u' }] }); }",
        expectErrors: 0,
    },
    {
        label: 'unit test for audit-logger is exempt',
        filename: '__tests__/unit/audit-logger.test.js',
        code: "async function f() { return prisma.auditLog.create({ data: { logId: 'x' } }); }",
        expectErrors: 0,
    },
    {
        label: 'unit test for notification-service is exempt',
        filename: '__tests__/unit/notification-service.test.js',
        code: "async function f() { return prisma.notification.create({ data: { userId: 'u' } }); }",
        expectErrors: 0,
    },

    // ── Flagged ────────────────────────────────────────────────────
    {
        label: 'direct prisma.auditLog.create in a route handler is flagged',
        filename: 'routes/api/foo.js',
        code: "async function f() { return prisma.auditLog.create({ data: { logId: 'x' } }); }",
        expectErrors: 1,
        expectMsgId: 'directAuditLogWrite',
    },
    {
        label: 'direct prisma.notification.create in a service is flagged',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.notification.create({ data: { userId: 'u' } }); }",
        expectErrors: 1,
        expectMsgId: 'directNotificationWrite',
    },
    {
        label: 'direct prisma.notification.createMany is flagged',
        filename: 'routes/api/foo.js',
        code: "async function f() { return prisma.notification.createMany({ data: [{ userId: 'u' }] }); }",
        expectErrors: 1,
        expectMsgId: 'directNotificationWrite',
    },
    {
        label: 'tx alias (transaction handle) is also caught',
        filename: 'services/foo.js',
        code: "async function f(tx) { return tx.notification.create({ data: { userId: 'u' } }); }",
        expectErrors: 1,
        expectMsgId: 'directNotificationWrite',
    },
    {
        label: 'this.prisma.auditLog.create is also caught',
        filename: 'services/foo.js',
        code: "async function f() { return this.prisma.auditLog.create({ data: { logId: 'x' } }); }",
        expectErrors: 1,
        expectMsgId: 'directAuditLogWrite',
    },
    {
        label: 'auditLog.update is NOT flagged (only create / createMany)',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.auditLog.update({ where: { id: 'x' }, data: {} }); }",
        expectErrors: 0,
    },
    {
        label: 'notification.findMany is NOT flagged (only writes)',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.notification.findMany({}); }",
        expectErrors: 0,
    },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const c of cases) {
    const messages = lint(c.code, c.filename);
    const errs = messages.filter((m) => m.severity === 2);
    const ok = errs.length === c.expectErrors
        && (c.expectMsgId ? errs[0]?.messageId === c.expectMsgId : true);
    if (ok) {
        passed++;
    } else {
        failed++;
        failures.push({
            label: c.label,
            expected: c.expectErrors,
            got: errs.length,
            messages: errs.map((m) => `${m.messageId}: ${m.message}`),
        });
    }
}

 
console.log(`\n${passed} passed, ${failed} failed (out of ${cases.length})`);
for (const f of failures) {
     
 console.log(` ${f.label}: expected ${f.expected} error(s), got ${f.got}`);
    for (const m of f.messages) {
         
        console.log(`    ${m}`);
    }
}

process.exit(failed === 0 ? 0 : 1);
