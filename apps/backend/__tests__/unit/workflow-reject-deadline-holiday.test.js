'use strict';

/**
 * Blocker F (full-system audit 2026-07-07, area F — GAP, go-live blocking):
 *
 * The CANONICAL reviewer/auditor reject surface — provider workflow-transitions
 * (REVISION_REQUESTED + CAR_PENDING) — computed the legally-relevant,
 * money-triggering 5-working-day correction deadline via
 * services/working-days-service.js: holiday-"capable" but holiday-BLIND in
 * practice (its holiday sources — env TH_PUBLIC_HOLIDAYS + systemConfig
 * `public_holidays_th` — are empty and never seeded) and evaluated in
 * SERVER-LOCAL timezone. The sibling paths (services/car-deadline-service.js,
 * application-review-revision-methods.js) already use the Thai-holiday-aware,
 * Asia/Bangkok utils/working-days.js — car-deadline-service.js:29 even warns
 * "NOT the holiday-blind services/working-days-service".
 *
 * Consequence: a reject whose 5-day window spans a Thai public holiday got a
 * TOO-SHORT deadline → the auto-cancel cron EXPIRED the application early →
 * the farmer forfeits งวดที่ 1 (5,535 THB) and must re-file. Example pinned
 * below: reject on Fri 2026-07-24 spans วันเฉลิมพระชนมพรรษา ร.10 (Tue
 * 2026-07-28) — blind due = Fri 2026-07-31, correct due = Mon 2026-08-03.
 *
 * Fix: workflow-handler-deps.js exports utils/working-days.addWorkingDays
 * (identity), and the handler drops loadHolidaySet entirely (the util carries
 * the Thai calendar + ICT internally).
 *
 * RED (pre-fix): identity + behavior + wiring tests all fail.
 */

const fs = require('fs');
const path = require('path');

// ---- Load the deps barrel with its heavy imports stubbed (prisma-database
// exits without DATABASE_URL — the project rules test gotcha). working-days modules
// stay REAL: they are the subject under test.
function loadDepsBarrel() {
    jest.resetModules();
    jest.doMock('../../routes/api/provider/handlers/shared', () => ({
        prisma: {},
        authenticateProvider: (_req, _res, next) => next(),
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        PERMISSIONS: {},
        requireCanonicalPermission: () => (_req, _res, next) => next(),
        obj: (x) => (x && typeof x === 'object' ? x : {}),
        arr: (x) => (Array.isArray(x) ? x : []),
        resolveUserIdFromHealthId: jest.fn(),
    }));
    jest.doMock('../../services/workflow-transition-service', () => ({}));
    jest.doMock('../../services/certificate-service', () => ({}));
    jest.doMock('../../services/invoice-service', () => ({ listSettlementsForApplication: jest.fn() }));
    jest.doMock('../../services/application-service', () => ({}));
    jest.doMock('../../utils/client-ip', () => ({ getRequestIp: () => '127.0.0.1' }));
    jest.doMock('../../routes/api/provider/handlers/queue-utils', () => ({ getRevisionDueAt: jest.fn() }));
    jest.doMock('../../services/phase-billing-service', () => ({ computePhaseSettlement: jest.fn() }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn(), logWithin: jest.fn() },
        AuditCategory: {}, AuditSeverity: {}, ResourceType: {},
        statusTransitionAuditHook: jest.fn(() => jest.fn()),
    }));
    const deps = require('../../routes/api/provider/handlers/workflow-handler-deps');
    // Same-registry canonical instance (jest.resetModules() re-instantiates
    // modules, so the top-level require would be a DIFFERENT instance and the
    // identity assertion would false-fail).
    const freshCanonical = require('../../utils/working-days');
    return { deps, freshCanonical };
}

const canonical = require('../../utils/working-days');

describe('Blocker F — canonical reject deadline is Thai-holiday-aware + Asia/Bangkok', () => {
    // Reject Friday 2026-07-24 10:00 ICT. Window spans ร.10 birthday (Tue 07-28).
    const REJECT_AT = new Date('2026-07-24T03:00:00.000Z'); // 10:00 ICT

    test('deps barrel exports THE holiday-aware util (identity — not the holiday-blind service)', () => {
        const { deps, freshCanonical } = loadDepsBarrel();
        expect(deps.addWorkingDays).toBe(freshCanonical.addWorkingDays);
        // The blind pair must be gone from the barrel so no future handler
        // re-wires the wrong engine.
        expect(deps.loadHolidaySet).toBeUndefined();
    });

    test('5-working-day deadline spanning วันเฉลิมฯ ร.10 (2026-07-28) lands Wed 2026-08-05, not Fri 07-31', () => {
        const { deps } = loadDepsBarrel();
        const due = deps.addWorkingDays(REJECT_AT, 5);
        const { isoDate } = canonical.getZonedParts(due);
        // Holiday-blind (current bug): Mon27+1 Tue28+2 Wed29+3 Thu30+4 Fri31+5 → 2026-07-31.
        // Holiday-aware (correct):    Mon27+1 [Tue28 ร.10, Wed29 อาสาฬหบูชา,
        // Thu30 เข้าพรรษา หยุด] Fri31+2 Mon Aug3+3 Tue4+4 Wed5+5.
        expect(isoDate).toBe('2026-08-05');
    });

    test('the transitions handler no longer references loadHolidaySet (wiring pin)', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../routes/api/provider/handlers/workflow-transitions-handler.js'),
            'utf8',
        );
        expect(src.includes('loadHolidaySet')).toBe(false);
        // Both reject sites must call the 2-arg canonical signature.
        // The revision site moved into the shared builder (workflow-side-effects), so the
        // per-slot door and this one cannot compute two clocks; the CAR site stays here.
        const builder = fs.readFileSync(
            path.join(__dirname, '../../routes/api/provider/handlers/workflow-side-effects.js'),
            'utf8',
        );
        expect(builder).toMatch(/addWorkingDays\(requestedAt,\s*slaDays\)/);
        expect(src).toContain('buildRevisionDeadlineFormData');
        expect(src).toMatch(/addWorkingDays\(requestedAt,\s*CAR_SLA_DAYS\)/);
    });

    test('the SECOND reject surface (PATCH /applications/:id/reject) uses the holiday-aware engine too (adversarial-verify MUST)', () => {
        // application-workflow-handlers.js stamps the SAME revisionDueAt/carDueAt
        // + RevisionDeadline.revisionDue keys the auto-expire cron enforces — a
        // holiday-blind computation here reopens the exact farmer-forfeits-งวด-1
        // defect on a live provider-reachable route.
        const src = fs.readFileSync(
            path.join(__dirname, '../../routes/api/applications/application-workflow-handlers.js'),
            'utf8',
        );
        // Pin the actual require, not comment mentions of the old module.
        expect(src).not.toMatch(/require\([^)]*working-days-service/);
        expect(src.includes('loadHolidaySet')).toBe(false);
        expect(src).toMatch(/require\(['"][^'"]*utils\/working-days['"]\)/);
        // R2 M3 strengthening (Law 3.5/3.6): the window length now comes from
        // the config SSOT — the old literal-5 pin would have frozen the
        // hardcode in place. Same value, one defining source.
        expect(src).toMatch(/addWorkingDays\(now,\s*PAYMENT\.REVISION_DEADLINE_BUSINESS_DAYS\)/);
        expect(src).not.toMatch(/addWorkingDays\(now,\s*5\)/);
    });

    test('timezone: Friday 23:30 ICT reject still counts Friday as day zero (ICT, not UTC)', () => {
        // 2026-07-17 16:30 UTC = Friday 23:30 ICT. In UTC-evaluated logic the
        // next day boundary drifts; canonical utils must evaluate ICT.
        const lateNightICT = new Date('2026-07-17T16:30:00.000Z');
        const due = canonical.addWorkingDays(lateNightICT, 5);
        const { isoDate } = canonical.getZonedParts(due);
        // Sat18/Sun19 skip → Mon20+1 Tue21+2 Wed22+3 Thu23+4 Fri24+5 → 2026-07-24.
        expect(isoDate).toBe('2026-07-24');
    });

    test('lunar-holiday coverage past the table (2028+) warns loudly instead of silently under-counting', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            // 2028 has NO EXTRA_HOLIDAYS_BY_YEAR entry (gazette dates unknown —
            // must not be fabricated). Computing into it must WARN so ops seed
            // the table, and must still return a valid date (recurring holidays
            // + weekends still applied).
            const due = canonical.addWorkingDays(new Date('2028-01-05T03:00:00.000Z'), 5);
            expect(due instanceof Date).toBe(true);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2028'));
        } finally {
            warnSpy.mockRestore();
        }
    });
});
