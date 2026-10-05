'use strict';

/**
 * Legacy status translation purge — PR 2c.
 *
 * PR 2b stopped every writer producing non-canonical `Application.status`
 * values. That removed the reason the read-side translation layer existed:
 * it was not holding historical data, it was holding data current code kept
 * refilling. With the writers fixed and the database wiped for this
 * pre-production environment, the layer is dead weight that actively hurts:
 *
 *   - `LEGACY_STATUS_BY_STATE` was 20 entries, every one of them identity
 *     (`DRAFT: 'DRAFT'`, …). `LEGACY_STATUS_BY_STATE[s] === s` for all s.
 *   - `STATE_BY_LEGACY_STATUS` was 47 entries: the same 20 identity entries
 *     again, plus 27 legacy spellings.
 *   - `STATE_INPUT_ALIASES` was 34: 18 canonical-lowercase entries that
 *     `toUpperCase()` already handles, plus 16 legacy aliases.
 *
 * Three tables, ~100 entries, of which the only load-bearing content was the
 * legacy half — and every one of those made `normalizeWorkflowStateInput()`
 * accept a spelling the state machine cannot otherwise name. Keeping them
 * means a typo'd or stale status keeps resolving to *something*, silently,
 * forever.
 *
 * After the purge normalization is fail-closed: canonical in any case with
 * any surrounding whitespace, or `null`.
 */

const fs = require('fs');
const path = require('path');

const wf = require('../../services/workflow-transition-service');
const { WORKFLOW_STATES, normalizeWorkflowStateInput } = wf;

const BACKEND_ROOT = path.join(__dirname, '../..');

// Every legacy spelling the three tables used to resolve.
const PURGED_SPELLINGS = [
    'PAYMENT_1_PAID', 'PAYMENT_1_PENDING', 'PAYMENT_PHASE_1', 'PAYMENT_PHASE_2',
    'REGISTERED', 'PENDING_REVIEW', 'IN_REVIEW', 'UNDER_REVIEW', 'DOC_REVIEW',
    'REVISION_REQUIRED', 'REVISION_REQ', 'DOCUMENT_APPROVED', 'PAYMENT_2_PENDING',
    'PAYMENT_2_COMPLETED', 'AWAITING_SCHEDULE', 'SCHEDULED', 'AUDIT_SCHEDULED',
    'AUDIT_IN_PROGRESS', 'PENDING_AUDIT', 'INSPECTION_IN_PROGRESS',
    'INSPECTION_COMPLETED', 'INSPECTION_SCHEDULED', 'AUDITED', 'FINAL_APPROVED',
    'FINAL_REJECTED', 'AUDIT_FAILED', 'CAR_SUBMITTED',
    // STATE_INPUT_ALIASES-only spellings
    'PENDING_DOCUMENT_REVIEW', 'DOC_REVIEW_IN_PROGRESS', 'WAITING_PHASE2_PAYMENT',
    'SCHEDULABLE', 'SCHEDULING',
];

describe('the translation tables are gone, not merely unused', () => {
    test('workflow-transition-service no longer exports STATE_BY_LEGACY_STATUS', () => {
        expect(wf.STATE_BY_LEGACY_STATUS).toBeUndefined();
    });

    test('workflow-transition-service no longer exports LEGACY_STATUS_BY_STATE', () => {
        // It was pure identity — `LEGACY_STATUS_BY_STATE[s] === s` for every
        // state — so every read of it was a no-op with extra indirection.
        expect(wf.LEGACY_STATUS_BY_STATE).toBeUndefined();
    });

    test('no production CODE references either table', () => {
        // Comments are stripped: naming a deleted symbol to explain why a
        // lookup is gone is useful documentation, and the thing that must not
        // survive is a live reference that would now be `undefined[...]`.
        const offenders = [];
        for (const file of walkBackend()) {
            const rel = path.relative(BACKEND_ROOT, file).split(path.sep).join('/'); // posix-normalised (Windows dev machines)
            const source = stripComments(fs.readFileSync(file, 'utf8'));
            if (/\bSTATE_BY_LEGACY_STATUS\b|\bLEGACY_STATUS_BY_STATE\b/.test(source)) {
                offenders.push(rel);
            }
        }
        expect(offenders.sort()).toEqual([]);
    });
});

describe('normalizeWorkflowStateInput is fail-closed', () => {
    test.each(PURGED_SPELLINGS)('%s no longer resolves to anything', (spelling) => {
        expect(normalizeWorkflowStateInput(spelling)).toBeNull();
        expect(normalizeWorkflowStateInput(spelling.toLowerCase())).toBeNull();
    });

    test.each([...WORKFLOW_STATES])('%s still resolves to itself', (state) => {
        expect(normalizeWorkflowStateInput(state)).toBe(state);
    });

    test('canonical states resolve regardless of case and padding', () => {
        expect(normalizeWorkflowStateInput('  pending_doc_fee  ')).toBe('PENDING_DOC_FEE');
        expect(normalizeWorkflowStateInput('Car_Pending')).toBe('CAR_PENDING');
    });

    test('empty and nullish input resolve to null, not to a default state', () => {
        for (const value of ['', '   ', null, undefined, 0, false]) {
            expect(normalizeWorkflowStateInput(value)).toBeNull();
        }
    });
});

describe('resolveRawStatusesForStates is an identity projection now', () => {
    test.each([...WORKFLOW_STATES])('%s expands to exactly itself', (state) => {
        expect(wf.resolveRawStatusesForStates(state)).toEqual([state]);
    });

    test('an unknown state expands to nothing rather than to itself', () => {
        // Returning the input would let a typo'd filter silently match a
        // column value that no writer can produce.
        expect(wf.resolveRawStatusesForStates('REGISTERED')).toEqual([]);
    });
});

describe('PaymentSlip status is decoupled from Application status', () => {
    // PENDING_REVIEW / IN_REVIEW / UNDER_REVIEW are PaymentSlip and
    // PurchaseInvoice statuses — they have their own enums (SLIP_STATUS in
    // payment-slip-service.js, STATUS in purchase-invoice-service.js). They
    // were ALSO listed as Application statuses in DOC_REVIEW_STATES and in
    // STATE_BY_LEGACY_STATUS, so two unrelated domains shared one string and
    // a slip status classified an application.
    const SLIP_ONLY_STATUSES = ['PENDING_REVIEW', 'IN_REVIEW', 'UNDER_REVIEW'];

    const stage = require('../../shared/health-dashboard-stage');

    test.each(SLIP_ONLY_STATUSES)('%s carries no special meaning on the application side', (slipStatus) => {
        // The decoupling property is that the application classifier gives
        // slip vocabulary no more meaning than any other unrecognised string
        // — so PaymentSlip.status can change without auditing the applicant
        // dashboard. (Both land on the closing fallback; the point is that
        // they land there for the SAME reason, not because DOC_REVIEW_STATES
        // claims the word.)
        const asSlipWord = stage.normalizeHealthDashboardStage({ status: slipStatus, formData: {} });
        const asNonsense = stage.normalizeHealthDashboardStage({ status: 'ZZZ_NOT_A_STATUS', formData: {} });
        expect(asSlipWord).toBe(asNonsense);
    });

    test('the application-status classification sets contain no slip vocabulary', () => {
        const source = fs.readFileSync(path.join(BACKEND_ROOT, 'shared/health-dashboard-stage.js'), 'utf8');
        const setsRegion = stripComments(source).slice(
            stripComments(source).indexOf('const AUDIT_STATES'),
            stripComments(source).indexOf('function normalizeHealthDashboardStage'),
        );
        expect(setsRegion.length).toBeGreaterThan(100);
        for (const slipStatus of SLIP_ONLY_STATUSES) {
            expect(setsRegion).not.toContain(`'${slipStatus}'`);
        }
    });

    test.each(SLIP_ONLY_STATUSES)('%s is not a canonical application state', (slipStatus) => {
        expect(WORKFLOW_STATES).not.toContain(slipStatus);
        expect(normalizeWorkflowStateInput(slipStatus)).toBeNull();
    });

});

describe('no legacy application-status spelling survives in a status set', () => {
    // Read-side allowlists that carried legacy spellings are the other half
    // of the compatibility layer. With no writer able to produce them and no
    // row holding them, each entry is a value that can never match — dead
    // weight that reads like a live requirement.
    const SCAN_DIRS = ['routes', 'services', 'controllers', 'jobs', 'shared', 'middleware'];

    // Files that legitimately name these strings for a DIFFERENT domain.
    const ALLOWED = new Set([
        'services/payment-slip-service.js',       // SLIP_STATUS enum
        'services/purchase-invoice-service.js',   // PurchaseInvoice STATUS enum
        'services/ar-aging-service.js',           // queries PaymentSlip.status
        'services/accounting-service.js',         // queries PaymentSlip.status
        'services/customer-statement-service.js', // documents PaymentSlip.status
        'services/vat-report-service.js',         // documents PaymentSlip.status
        // NotifyType enum. DOCUMENT_APPROVED and CAR_SUBMITTED are notification
        // TYPES, not application statuses — the string collision is the same
        // domain-overlap hazard as PENDING_REVIEW, and the notification domain
        // is the legitimate owner of these two.
        'services/notification-service.js',
    ]);

    // Application-status spellings only — PENDING_REVIEW etc. are excluded
    // because they are legitimately owned by the slip domain, which the
    // ALLOWED list above scopes.
    const APPLICATION_ONLY_LEGACY = [
        'PAYMENT_1_PENDING', 'PAYMENT_1_PAID', 'PAYMENT_2_PENDING', 'PAYMENT_2_COMPLETED',
        'PAYMENT_PHASE_1', 'PAYMENT_PHASE_2', 'REGISTERED', 'DOCUMENT_APPROVED',
        'FINAL_APPROVED', 'FINAL_REJECTED', 'REVISION_REQ', 'AWAITING_SCHEDULE',
        'AUDIT_FAILED', 'CAR_SUBMITTED', 'INSPECTION_SCHEDULED', 'INSPECTION_COMPLETED',
    ];

    test('no legacy application-status literal survives outside the slip domain', () => {
        const offenders = [];
        for (const dir of SCAN_DIRS) {
            for (const file of walk(path.join(BACKEND_ROOT, dir))) {
                const rel = path.relative(BACKEND_ROOT, file).split(path.sep).join('/'); // posix-normalised (Windows dev machines)
                if (ALLOWED.has(rel)) { continue; }
                const source = stripComments(fs.readFileSync(file, 'utf8'));
                for (const literal of APPLICATION_ONLY_LEGACY) {
                    if (new RegExp(`'${literal}'`).test(source)) {
                        offenders.push(`${rel}: ${literal}`);
                    }
                }
            }
        }
        expect(offenders.sort()).toEqual([]);
    });

    test('the scan reads real files and the comment stripper works', () => {
        expect(walkBackend().length).toBeGreaterThan(100);
        expect(stripComments("// keep 'REGISTERED' for history\nconst a = 1;"))
            .not.toContain('REGISTERED');
        expect(stripComments("/* 'REGISTERED' */\nconst a = 1;")).not.toContain('REGISTERED');
        expect(stripComments("const a = 'REGISTERED';")).toContain('REGISTERED');
    });
});

// Helpers

function walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (['node_modules', '__tests__', 'migrations'].includes(entry.name)) { continue; }
            walk(full, out);
        } else if (entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

function walkBackend() {
    return ['routes', 'services', 'controllers', 'jobs', 'shared', 'middleware', 'scripts', 'prisma']
        .flatMap((dir) => walk(path.join(BACKEND_ROOT, dir)));
}

/** Strip // and block comments so prose about the purge is not a violation. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
