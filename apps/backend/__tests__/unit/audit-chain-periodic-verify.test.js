/**
 * Audit gap #14 (B) — verifyChain was a DEAD proactive control.
 *
 * verifyChain/getPaymentAuditTrail had zero non-test callers: no cron, no
 * endpoint, no startup check ran them, so an edit rewriting an AUDITOR REJECT
 * into APPROVE was never detected — the "immutable audit trail" DTAM relies on
 * for the 5-year inspection was un-alarmed (carpet-bomb-inversion-audit
 * 2026-07-06 #27).
 *
 * Fix: runScheduledChainVerification() sweeps each tenant's recent chain window
 * (per-tenant chains, ADR-014) via auditLogger.verifyChain and logs a loud
 * [AUDIT_CHAIN_ALERT] on any LINK/HASH break. It is wired into the node-cron
 * scheduler (jobs/scheduler.js) so the check runs daily in production.
 *
 * RED (pre-fix): service.runScheduledChainVerification is undefined.
 */

'use strict';

function loadService({ verifyChain, groupByRows }) {
    jest.resetModules();
    const prismaMock = {
        auditLog: {
            create: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            groupBy: jest.fn().mockResolvedValue(groupByRows),
        },
    };
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn() }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn(), verifyChain },
        AuditCategory: { AUTHENTICATION: 'AUTHENTICATION', PAYMENT: 'PAYMENT', SYSTEM: 'SYSTEM' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
        ResourceType: { USER: 'USER', APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
    }));
    return { prismaMock, service: require('../../services/audit-trail') };
}

const clean = () => ({ verified: true, totalLogs: 3, linkMismatches: 0, hashMismatches: 0, corruptedLogs: [] });
const broken = () => ({
    verified: false,
    totalLogs: 3,
    linkMismatches: 0,
    hashMismatches: 1,
    corruptedLogs: [{ type: 'HASH_MISMATCH', logId: 'LOG-9', sequenceNumber: 9 }],
});

describe('audit gap #14 (B) — runScheduledChainVerification (periodic integrity sweep)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('verifies every tenant chain and reports a clean summary (no alert)', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: [
                { organizationId: 'org-A', _max: { sequenceNumber: 120 } },
                { organizationId: 'org-B', _max: { sequenceNumber: 4 } },
            ],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const summary = await service.runScheduledChainVerification();

        expect(verifyChain).toHaveBeenCalledTimes(2);
        expect(verifyChain).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-A' }));
        expect(verifyChain).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-B' }));
        expect(summary.orgsChecked).toBe(2);
        expect(summary.breaksFound).toBe(0);
        // No alert emitted on a clean sweep.
        expect(errorSpy.mock.calls.some(([msg]) => String(msg).includes('[AUDIT_CHAIN_ALERT]'))).toBe(false);

        errorSpy.mockRestore();
    });

    test('detects a break and emits an [AUDIT_CHAIN_ALERT] with forensic detail', async () => {
        const verifyChain = jest.fn()
            .mockResolvedValueOnce(clean())   // org-A healthy
            .mockResolvedValueOnce(broken());  // org-B tampered
        const { service } = loadService({
            verifyChain,
            groupByRows: [
                { organizationId: 'org-A', _max: { sequenceNumber: 10 } },
                { organizationId: 'org-B', _max: { sequenceNumber: 10 } },
            ],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const summary = await service.runScheduledChainVerification();

        expect(summary.orgsChecked).toBe(2);
        expect(summary.breaksFound).toBeGreaterThanOrEqual(1);
        const orgB = summary.orgs.find((o) => o.organizationId === 'org-B');
        expect(orgB.verified).toBe(false);

        // A loud, greppable alert names the tenant and carries the corrupted rows.
        const alertCall = errorSpy.mock.calls.find(([msg]) => String(msg).includes('[AUDIT_CHAIN_ALERT]'));
        expect(alertCall).toBeDefined();
        expect(alertCall[1]).toEqual(expect.objectContaining({ organizationId: 'org-B' }));

        errorSpy.mockRestore();
    });

    test('scopes each verify to a bounded recent window (tail - windowSize + 1, floored at 1)', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: [
                { organizationId: 'org-big', _max: { sequenceNumber: 8000 } },
                { organizationId: 'org-small', _max: { sequenceNumber: 3 } },
            ],
        });

        await service.runScheduledChainVerification({ windowSize: 5000 });

        // Large chain → windowed from 3001; small chain → floored at 1.
        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-big', startSequence: 3001 }),
        );
        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-small', startSequence: 1 }),
        );
    });

    test('a verify that throws for one tenant does not abort the whole sweep', async () => {
        const verifyChain = jest.fn()
            .mockRejectedValueOnce(new Error('db blip'))  // org-A errors
            .mockResolvedValueOnce(clean());               // org-B still checked
        const { service } = loadService({
            verifyChain,
            groupByRows: [
                { organizationId: 'org-A', _max: { sequenceNumber: 5 } },
                { organizationId: 'org-B', _max: { sequenceNumber: 5 } },
            ],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const summary = await service.runScheduledChainVerification();

        // Both tenants attempted; the erroring one is recorded, not fatal.
        expect(verifyChain).toHaveBeenCalledTimes(2);
        expect(summary.orgsChecked).toBe(2);
        const orgA = summary.orgs.find((o) => o.organizationId === 'org-A');
        expect(orgA.error).toBeTruthy();

        errorSpy.mockRestore();
    });
});

// Baseline floor (AUDIT_CHAIN_VERIFY_FROM_SEQ) — fix/audit-batch3.
//
// Pre-existing benign breaks live BELOW a v2-cutover point: PDPA re-key /
// detokenize scripts mutated legacy audit-log columns without recomputing
// currentHash (standing HASH_MISMATCH), plus some legacy rows have dropped
// sequence numbers (LINK_MISMATCH). Without a baseline, the daily cron would
// emit [AUDIT_CHAIN_ALERT] every night on these benign legacy breaks —
// alarm-fatigue that masks a REAL tamper. The baseline lets an operator set
// AUDIT_CHAIN_VERIFY_FROM_SEQ ONCE post-deploy (to the then-current max
// sequenceNumber) so the sweep only verifies the clean v2-forward chain.
//
// The mock below is startSequence-aware ON PURPOSE — it mirrors the real
// auditLogger.verifyChain contract (WHERE sequenceNumber >= startSequence), so
// a break BELOW startSequence is genuinely outside the scanned window and
// invisible. A mock that ignored startSequence would false-green this fix.
describe('audit gap #14 (B) — baseline floor scopes the sweep to v2-forward (AUDIT_CHAIN_VERIFY_FROM_SEQ)', () => {
    const ENV = 'AUDIT_CHAIN_VERIFY_FROM_SEQ';

    beforeEach(() => {
        delete process.env[ENV];
        jest.clearAllMocks();
    });
    afterEach(() => {
        delete process.env[ENV];
    });

    // Returns broken() only when the scan starts at/below the break's sequence
    // — exactly how the real verifyChain (gte startSequence) behaves.
    const seqAwareVerify = (breakAt) => jest.fn(async ({ startSequence }) => (
        startSequence <= breakAt ? broken() : clean()
    ));

    test('a pre-existing benign break BELOW the baseline is NOT alerted', async () => {
        const verifyChain = seqAwareVerify(9); // legacy break at seq 9 (PDPA re-key mutated it)
        const { service } = loadService({
            verifyChain,
            groupByRows: [{ organizationId: 'org-A', _max: { sequenceNumber: 120 } }],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Baseline set above the legacy break → verify from seq 50 forward.
        const summary = await service.runScheduledChainVerification({ fromSequence: 50 });

        // Scan is floored at the baseline (not the full recent window).
        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-A', startSequence: 50 }),
        );
        expect(summary.baseline).toBe(50);
        expect(summary.breaksFound).toBe(0);
        const org = summary.orgs.find((o) => o.organizationId === 'org-A');
        expect(org.verified).toBe(true);
        // The legacy break below the baseline must NOT cry wolf.
        expect(errorSpy.mock.calls.some(([m]) => String(m).includes('[AUDIT_CHAIN_ALERT]'))).toBe(false);

        errorSpy.mockRestore();
    });

    test('a break AT/ABOVE the baseline STILL alerts (real tamper not masked)', async () => {
        const verifyChain = seqAwareVerify(100); // real post-cutover break at seq 100
        const { service } = loadService({
            verifyChain,
            groupByRows: [{ organizationId: 'org-A', _max: { sequenceNumber: 120 } }],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const summary = await service.runScheduledChainVerification({ fromSequence: 50 });

        // Scan starts at 50; the break at 100 is inside the window → flagged.
        expect(summary.breaksFound).toBeGreaterThanOrEqual(1);
        const alert = errorSpy.mock.calls.find(([m]) => String(m).includes('[AUDIT_CHAIN_ALERT]'));
        expect(alert).toBeDefined();
        expect(alert[1]).toEqual(expect.objectContaining({ organizationId: 'org-A' }));

        errorSpy.mockRestore();
    });

    test('fromSequence unset/0 → unchanged full recent-window behavior (legacy break IS seen)', async () => {
        const verifyChain = seqAwareVerify(9);
        const { service } = loadService({
            verifyChain,
            groupByRows: [{ organizationId: 'org-A', _max: { sequenceNumber: 120 } }],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const summary = await service.runScheduledChainVerification(); // no baseline, env unset

        // windowStart = max(1, 120 - 5000 + 1) = 1 → the break at 9 is in-window.
        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-A', startSequence: 1 }),
        );
        expect(summary.baseline).toBe(0);
        expect(summary.breaksFound).toBeGreaterThanOrEqual(1);

        errorSpy.mockRestore();
    });

    test('reads the baseline from env AUDIT_CHAIN_VERIFY_FROM_SEQ when no explicit fromSequence', async () => {
        process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ = '50';
        const verifyChain = seqAwareVerify(9);
        const { service } = loadService({
            verifyChain,
            groupByRows: [{ organizationId: 'org-A', _max: { sequenceNumber: 120 } }],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const summary = await service.runScheduledChainVerification(); // env supplies the baseline

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-A', startSequence: 50 }),
        );
        expect(summary.baseline).toBe(50);
        expect(summary.breaksFound).toBe(0);
        expect(errorSpy.mock.calls.some(([m]) => String(m).includes('[AUDIT_CHAIN_ALERT]'))).toBe(false);

        errorSpy.mockRestore();
    });

    test('a malformed env value (NaN) falls back to baseline 0 (no accidental suppression)', async () => {
        process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ = 'not-a-number';
        const verifyChain = seqAwareVerify(9);
        const { service } = loadService({
            verifyChain,
            groupByRows: [{ organizationId: 'org-A', _max: { sequenceNumber: 120 } }],
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const summary = await service.runScheduledChainVerification();

        expect(summary.baseline).toBe(0);
        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-A', startSequence: 1 }),
        );

        errorSpy.mockRestore();
    });
});
