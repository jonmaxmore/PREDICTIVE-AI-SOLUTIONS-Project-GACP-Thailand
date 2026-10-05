/**
 * Test harness for gacp/no-legacy-status-vocabulary — PR 2d ratchet.
 *
 * Exit 0 = all tests pass; non-zero = at least one failed.
 *
 * The rule is the ratchet PR 2c earned. 2c deleted three translation tables and
 * every legacy spelling that fed them; without a gate, the next person to hit
 * an unrecognised status re-adds one alias "just for this case" and the layer
 * grows back one entry at a time — which is how it reached ~100 entries the
 * first time.
 *
 * Two things the rule must NOT do, both of which would get it disabled:
 *   - fire on the slip / invoice / notification domains, which legitimately own
 *     PENDING_REVIEW, IN_REVIEW, DOCUMENT_APPROVED and CAR_SUBMITTED;
 *   - fire on prose. A comment explaining why a value was removed is the
 *     documentation, not the violation.
 */

'use strict';

const path = require('path');
const { Linter } = require('eslint');
const rule = require('./no-legacy-status-vocabulary');

const linter = new Linter({ configType: 'flat' });
const baseConfig = {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    plugins: { gacp: { rules: { 'no-legacy-status-vocabulary': rule } } },
    rules: { 'gacp/no-legacy-status-vocabulary': 'error' },
};

function abs(rel) {
    return path.resolve(process.cwd(), rel);
}

function lint(code, relativeFilename) {
    return linter.verify(code, [baseConfig], { filename: abs(relativeFilename) });
}

const cases = [
    // ── Flagged: legacy application-status literals ───────────────
    {
        label: 'legacy status written directly',
        filename: 'services/foo.js',
        code: "const x = { status: 'PAYMENT_1_PENDING' };",
        expectErrors: 1,
    },
    {
        label: 'legacy status in a toStatus write',
        filename: 'services/foo.js',
        code: "async function f() { return writeApplicationStatus({ toStatus: 'PAYMENT_2_COMPLETED' }); }",
        expectErrors: 1,
    },
    {
        label: 'legacy status inside a STATUS-named read allowlist',
        filename: 'services/foo.js',
        code: "const EDITABLE_STATUSES = new Set(['DRAFT', 'REGISTERED']);",
        expectErrors: 1,
    },
    {
        label: 'legacy status in an application prisma filter',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.application.findMany({ where: { status: { in: ['DOCUMENT_APPROVED'] } } }); }",
        expectErrors: 1,
    },
    {
        label: 'several legacy spellings in one status array report one error each',
        filename: 'services/foo.js',
        code: "const CLOSED_STATES = ['FINAL_APPROVED', 'FINAL_REJECTED', 'AUDIT_FAILED'];",
        expectErrors: 3,
    },
    {
        label: 'lowercase alias spelling is flagged in a status position',
        filename: 'services/foo.js',
        code: "const WORKFLOW_STATE_ALLOWLIST = ['inspection_scheduled'];",
        expectErrors: 1,
    },

    // ── Flagged: the deleted translation symbols ──────────────────
    {
        label: 're-introducing STATE_BY_LEGACY_STATUS',
        filename: 'services/foo.js',
        code: 'const s = wf.STATE_BY_LEGACY_STATUS[status];',
        expectErrors: 1,
    },
    {
        label: 're-declaring LEGACY_STATUS_BY_STATE',
        filename: 'services/foo.js',
        code: 'const LEGACY_STATUS_BY_STATE = { DRAFT: "DRAFT" };',
        expectErrors: 1,
    },
    {
        label: 're-declaring STATE_INPUT_ALIASES',
        filename: 'services/foo.js',
        code: 'const STATE_INPUT_ALIASES = { registered: "SUBMITTED" };',
        expectErrors: 1,
    },

    // ── Allowed: canonical vocabulary ─────────────────────────────
    {
        label: 'canonical status is fine',
        filename: 'services/foo.js',
        code: "const x = { status: 'PENDING_DOC_FEE' };",
        expectErrors: 0,
    },
    {
        label: 'canonical status set is fine',
        filename: 'services/foo.js',
        code: "const EDITABLE_STATUSES = new Set(['DRAFT', 'REVISION_REQUESTED', 'CAR_PENDING']);",
        expectErrors: 0,
    },

    // ── Allowed: other domains that own the same words ────────────
    {
        label: 'PaymentSlip status in the slip service',
        filename: 'services/payment-slip-service.js',
        code: "async function f() { return prisma.paymentSlip.findMany({ where: { status: 'PENDING_REVIEW' } }); }",
        expectErrors: 0,
    },
    {
        label: 'PurchaseInvoice status in its own service',
        filename: 'services/purchase-invoice-service.js',
        code: "const STATUS = { PENDING_REVIEW: 'PENDING_REVIEW' };",
        expectErrors: 0,
    },
    {
        label: 'a service querying PaymentSlip.status',
        filename: 'services/ar-aging-service.js',
        code: "async function f() { return prisma.paymentSlip.findMany({ where: { status: 'PENDING_REVIEW' } }); }",
        expectErrors: 0,
    },
    {
        label: 'NotifyType values in the notification service',
        filename: 'services/notification-service.js',
        code: "const NotifyType = { DOCUMENT_APPROVED: 'DOCUMENT_APPROVED', CAR_SUBMITTED: 'CAR_SUBMITTED' };",
        expectErrors: 0,
    },
    {
        // The SSOT is NOT exempt. It holds no legacy spelling after PR 2c, and
        // re-adding one there is precisely the regrowth this rule exists to
        // stop — an exemption would put the hole back in the one file that
        // matters most.
        label: 'the SSOT is not exempt from the status-position check',
        filename: 'services/workflow-transition-service.js',
        code: "const REJECTED_STATUSES = ['REGISTERED'];",
        expectErrors: 1,
    },

    // ── Allowed: prose ────────────────────────────────────────────
    {
        label: 'a line comment explaining the removal is not a violation',
        filename: 'services/foo.js',
        code: "// PR 2c: 'REGISTERED' was removed here.\nconst a = 1;",
        expectErrors: 0,
    },
    {
        label: 'a block comment explaining the removal is not a violation',
        filename: 'services/foo.js',
        code: "/* legacy PAYMENT_1_PENDING no longer written */\nconst a = 1;",
        expectErrors: 0,
    },
    {
        label: 'a JSDoc mentioning the old spelling is not a violation',
        filename: 'services/foo.js',
        code: "/**\n * Was STATE_BY_LEGACY_STATUS[status] until PR 2c.\n */\nconst a = 1;",
        expectErrors: 0,
    },

    // ── Allowed: the same word in a DIFFERENT position ────────────
    // These are why the rule is positional rather than a string search. Each
    // was a real false positive on the first pass over the codebase.
    {
        label: 'AUDIT_SCHEDULED as an audit-log action',
        filename: 'services/audit-scheduling-service.js',
        code: "async function f() { return _safeAudit('AUDIT_SCHEDULED', 'INFO', actor, id, {}); }",
        expectErrors: 0,
    },
    {
        label: 'AUDIT_SCHEDULED as a NotifyType',
        filename: 'services/foo.js',
        code: "async function f() { return fanout.send({ userId: u, type: 'AUDIT_SCHEDULED', payload: {} }); }",
        expectErrors: 0,
    },
    {
        label: 'AUDIT_SCHEDULED as a transition reason code',
        filename: 'services/foo.js',
        code: "async function f() { return write({ toStatus: 'AUDIT_CONFIRMED', reason: 'AUDIT_SCHEDULED' }); }",
        expectErrors: 0,
    },
    {
        label: 'SCHEDULED as Audit.status (a different model)',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.audit.findMany({ where: { status: 'SCHEDULED' } }); }",
        expectErrors: 0,
    },
    {
        label: 'DOC_REVIEW as a WorkActivity workType',
        filename: 'services/foo.js',
        code: "const isDocReview = config.workType === 'DOC_REVIEW';",
        expectErrors: 0,
    },
    {
        label: 'REVISION_REQUIRED as a dashboard stage name',
        filename: 'shared/health-dashboard-stage.js',
        code: "const STAGES = { REVISION_REQUIRED: 'REVISION_REQUIRED' };",
        expectErrors: 0,
    },
    {
        label: 'a test asserting the deleted symbols are gone',
        filename: '__tests__/unit/purge.test.js',
        code: 'expect(wf.STATE_BY_LEGACY_STATUS).toBeUndefined();',
        expectErrors: 0,
    },

    // ── Flagged: an application-status POSITION ───────────────────
    {
        label: 'legacy value compared against an application status',
        filename: 'services/foo.js',
        code: "if (application.status === 'REGISTERED') { return 1; }",
        expectErrors: 1,
    },
    {
        label: 'legacy value in an application status `in` filter',
        filename: 'services/foo.js',
        code: "async function f() { return prisma.application.findMany({ where: { status: { in: ['AUDIT_IN_PROGRESS'] } } }); }",
        expectErrors: 1,
    },
    {
        label: 'legacy value in a STATUS-named allowlist',
        filename: 'services/foo.js',
        code: "const PHASE2_ELIGIBLE_STATUSES = ['DOC_APPROVED', 'UNDER_REVIEW'];",
        expectErrors: 1,
    },

    // ── Allowed: unrelated strings that merely look similar ───────
    {
        label: 'a substring match does not count',
        filename: 'services/foo.js',
        code: "const a = 'NOT_REGISTERED_YET';",
        expectErrors: 0,
    },
    {
        label: 'a user-facing message is not a status write',
        filename: 'services/foo.js',
        code: "const msg = 'Application is registered';",
        expectErrors: 0,
    },
];

let failed = 0;
for (const testCase of cases) {
    const messages = lint(testCase.code, testCase.filename);
    const actual = messages.length;
    if (actual !== testCase.expectErrors) {
        failed += 1;
        console.error(
            `FAIL: ${testCase.label}\n  expected ${testCase.expectErrors} error(s), got ${actual}`
            + (actual ? `\n  ${messages.map((m) => m.message).join('\n  ')}` : ''),
        );
    } else {
        console.log(`ok: ${testCase.label}`);
    }
}

if (failed > 0) {
    console.error(`\n${failed} case(s) failed`);
    process.exit(1);
}
console.log(`\nall ${cases.length} cases passed`);
