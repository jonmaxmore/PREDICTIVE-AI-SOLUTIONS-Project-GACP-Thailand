'use strict';

/**
 * Status renderer exhaustiveness — PR 2a.
 *
 * Every applicant-facing status renderer is a projection of the workflow SSOT
 * (services/workflow-transition-service.js WORKFLOW_STATES). A projection that
 * is not TOTAL over its source leaks the raw enum key to a farmer's screen, or
 * silently collapses to a default that means something else entirely.
 *
 * Three live defects this suite pins (all reproduce on main):
 *
 *  1. DISPLAY_STATUS_BY_RAW_STATUS has no REJECTED / EXPIRED entry, so
 *     resolveDisplayStatus() falls through `|| status` and the tracking API
 *     hands the frontend the raw string "EXPIRED".
 *
 *  2. Because that raw string is not a key of STEP_BY_DISPLAY_STATUS, the
 *     `|| 0` on the step lookup resets the progress ladder to 0 — the same
 *     value DRAFT uses. A rejected applicant sees an empty progress bar
 *     indistinguishable from "never started".
 *
 *  3. The two PHASE_*_SLIP_UNDER_REVIEW entries map to Thai *text* rather than
 *     a display *key*. Thai text is never a key of STEP_BY_DISPLAY_STATUS
 *     either, so an applicant who has already transferred the fee and is
 *     waiting on the ACCOUNT team also drops to step 0 — mid-flow.
 *
 * The exhaustiveness assertions below are the durable half: they fail for any
 * state added to the SSOT in the future without a display projection, which is
 * how #2/#3 got in.
 */

const {
    DISPLAY_STATUS_BY_RAW_STATUS,
    STEP_BY_DISPLAY_STATUS,
    TERMINAL_DISPLAY_STATUSES,
    TRACKING_STEPS,
} = require('../../routes/api/helpers/application-constants');
const {
    resolveDisplayStatus,
    buildTrackingPayload,
    buildActionCard,
} = require('../../routes/api/helpers/application-payload-builders');
const { WORKFLOW_STATES } = require('../../services/workflow-transition-service');
const {
    normalizeHealthDashboardStage,
    HEALTH_DASHBOARD_STAGES,
    STAGE_LABEL_TH,
    STAGE_LABEL_EN,
    STAGE_NEXT_ACTION_TH,
    buildHealthProcessCounts,
} = require('../../shared/health-dashboard-stage');

// A display bucket key looks like a canonical enum key: A-Z, 0-9, underscore.
// Thai prose does not.
const DISPLAY_KEY_SHAPE = /^[A-Z][A-Z0-9_]*$/;

function appIn(state, extra = {}) {
    return {
        id: 'app-1',
        applicationNumber: 'GACP-2026-0001',
        status: state,
        formData: { workflowState: state },
        ...extra,
    };
}

describe('DISPLAY_STATUS_BY_RAW_STATUS is total over the workflow SSOT', () => {
    test('every canonical workflow state has a display bucket', () => {
        const missing = WORKFLOW_STATES.filter(
            (state) => !Object.prototype.hasOwnProperty.call(DISPLAY_STATUS_BY_RAW_STATUS, state),
        );
        expect(missing).toEqual([]);
    });

    test('every display bucket is a KEY, never user-facing prose', () => {
        const prose = Object.entries(DISPLAY_STATUS_BY_RAW_STATUS)
            .filter(([, bucket]) => !DISPLAY_KEY_SHAPE.test(bucket))
            .map(([raw, bucket]) => `${raw} -> ${bucket}`);
        expect(prose).toEqual([]);
    });

    test('every display bucket has a tracking step (the map is closed)', () => {
        const unstepped = [...new Set(Object.values(DISPLAY_STATUS_BY_RAW_STATUS))].filter(
            (bucket) => !Object.prototype.hasOwnProperty.call(STEP_BY_DISPLAY_STATUS, bucket),
        );
        expect(unstepped).toEqual([]);
    });

    test('every non-terminal step points at a real rung of the tracking ladder', () => {
        const ladder = new Set(TRACKING_STEPS.map((step) => step.step));
        const offLadder = Object.entries(STEP_BY_DISPLAY_STATUS)
            .filter(([bucket, step]) => !TERMINAL_DISPLAY_STATUSES.has(bucket) && step !== 0 && !ladder.has(step))
            .map(([bucket, step]) => `${bucket} -> ${step}`);
        expect(offLadder).toEqual([]);
    });
});

describe('terminal states never render as a raw enum key', () => {
    test.each(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED'])('%s resolves to a known display bucket', (state) => {
        const displayStatus = resolveDisplayStatus(appIn(state));
        expect(STEP_BY_DISPLAY_STATUS).toHaveProperty(displayStatus);
    });

    test.each(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED'])('%s is flagged terminal, not confused with DRAFT', (state) => {
        const payload = buildTrackingPayload(appIn(state));
        expect(payload.tracking.terminal).toBe(true);
        // DRAFT sits at step 0 too — the flag is what separates "never started"
        // from "closed", so it must be present and false for DRAFT.
        expect(buildTrackingPayload(appIn('DRAFT')).tracking.terminal).toBe(false);
    });

    test.each(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED'])('%s offers a re-apply action, not "waiting"', (state) => {
        const card = buildActionCard(resolveDisplayStatus(appIn(state)));
        expect(card.key).toBe('REAPPLY');
    });
});

describe('จ่ายงวดที่ 2 แล้วต้องอยู่บนบันได ไม่ถอยกลับหน้าจ่ายเงิน', () => {
    // เดิมบล็อกนี้ตรึงสถานะสลิปสองตัวไว้ · สลิปปลดระวาง 2026-09-11 แต่ข้อบกพร่องที่
    // มันกันไว้ยังมีอยู่จริงและย้ายมาอยู่ที่นี่: สถานะที่ "จ่ายแล้วแต่ยังไม่มีใครทำต่อ"
    // ต้องไม่หลุดกลับไปเป็นปุ่มชำระเงิน ไม่งั้นผู้ยื่นจ่ายซ้ำ
    test('AUDIT_FEE_PAID ไม่รีเซ็ตแถบความก้าวหน้าเป็น 0', () => {
        const payload = buildTrackingPayload(appIn('AUDIT_FEE_PAID'));
        expect(payload.tracking.currentStep).toBeGreaterThan(0);
        expect(payload.tracking.terminal).toBe(false);
    });

    test('AUDIT_FEE_PAID อยู่เลยขั้นตรวจเอกสารไปแล้ว', () => {
        const payload = buildTrackingPayload(appIn('AUDIT_FEE_PAID'));
        expect(payload.tracking.currentStep).toBeGreaterThanOrEqual(6);
    });

    test('ไม่มีสถานะที่จ่ายแล้วสถานะใดชวนให้จ่ายอีก', () => {
        for (const state of ['DOC_FEE_PAID', 'AUDIT_FEE_PAID']) {
            const card = buildActionCard(resolveDisplayStatus(appIn(state)));
            expect(card.key).not.toBe('PAY_DOC_FEE');
            expect(card.key).not.toBe('PAY_AUDIT_FEE');
        }
    });

    test('ปุ่มชำระเงินไม่พิมพ์ยอดเอง — ยอดมาจากตัวคิดเงิน', () => {
        // เดิมการ์ดพิมพ์ 'Pay 5,535 THB' / 'Pay 27,675 THB' ซึ่งเป็นสูตรที่เลิกใช้
        // ตั้งแต่ W14 และไม่มีด่านใดอ่านมันจึงไม่มีใครแก้ตาม
        for (const state of ['PENDING_DOC_FEE', 'PENDING_AUDIT_FEE']) {
            const card = buildActionCard(resolveDisplayStatus(appIn(state)));
            expect(card.enabled).toBe(true);
            expect(card.title).not.toMatch(/[0-9],[0-9]{3}/);
        }
    });
});

describe('no canonical state falls through the tracking payload', () => {
    test.each([...WORKFLOW_STATES])('%s produces a resolved, non-raw display status', (state) => {
        const payload = buildTrackingPayload(appIn(state));
        expect(STEP_BY_DISPLAY_STATUS).toHaveProperty(payload.displayStatus);
        expect(Number.isInteger(payload.tracking.currentStep)).toBe(true);
        expect(typeof payload.tracking.terminal).toBe('boolean');
    });
});

describe('health dashboard stage is total over the workflow SSOT', () => {
    test.each([...WORKFLOW_STATES])('%s maps to a declared dashboard stage', (state) => {
        const stage = normalizeHealthDashboardStage(appIn(state), {
            hasCertificate: state === 'CERTIFIED',
        });
        expect(Object.values(HEALTH_DASHBOARD_STAGES)).toContain(stage);
    });

    test.each(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED'])(
        '%s is NOT reported as "documents under review"',
        (state) => {
            const stage = normalizeHealthDashboardStage(appIn(state));
            expect(stage).not.toBe(HEALTH_DASHBOARD_STAGES.UNDER_DOCUMENT_REVIEW);
            expect(stage).toBe(HEALTH_DASHBOARD_STAGES.CLOSED);
        },
    );

    test('every declared stage has TH label, EN label and next-action copy', () => {
        for (const stage of Object.values(HEALTH_DASHBOARD_STAGES)) {
            expect(STAGE_LABEL_TH).toHaveProperty(stage);
            expect(STAGE_LABEL_EN).toHaveProperty(stage);
            expect(STAGE_NEXT_ACTION_TH).toHaveProperty(stage);
        }
    });

    test('closed applications are counted, not silently dropped', () => {
        const counts = buildHealthProcessCounts([
            appIn('REJECTED'),
            appIn('EXPIRED'),
            appIn('CANCEL_EXPIRED'),
            appIn('DRAFT'),
        ]);
        expect(counts.closed).toBe(3);
        expect(counts.draft).toBe(1);
        expect(counts.underDocumentReview).toBe(0);
    });

    test('the counter has a bucket for every declared stage', () => {
        const counts = buildHealthProcessCounts([]);
        const missing = Object.values(HEALTH_DASHBOARD_STAGES)
            .map((stage) => stage.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()))
            .filter((key) => !Object.prototype.hasOwnProperty.call(counts, key));
        expect(missing).toEqual([]);
    });

    test('every application lands in exactly one stage bucket', () => {
        const BACK_COMPAT = new Set(['waitingDocumentReview', 'waitingPayment', 'waitingAudit']);
        for (const state of WORKFLOW_STATES) {
            const counts = buildHealthProcessCounts([appIn(state)]);
            const total = Object.entries(counts)
                .filter(([key]) => !BACK_COMPAT.has(key))
                .reduce((sum, [, value]) => sum + value, 0);
            expect({ state, total }).toEqual({ state, total: 1 });
        }
    });
});
