/**
 * Health Dashboard Stage classifier — backend projection layer.
 *
 * normalizeHealthDashboardStage() collapses the 18-state canonical
 * workflow into 8 user-friendly dashboard tiles. The precedence rules
 * are subtle (terminal > approved > audit > phase-2 fee > revision >
 * doc-review > phase-1 fee > draft > fallback), so a regression that
 * changes the order silently re-classifies live applications into the
 * wrong tile — visible to every health user on login.
 *
 * Frontend mirror: apps/web-app/src/lib/health-dashboard-stage.ts.
 * Both must classify the same app the same way; this test locks the
 * backend half.
 */

const {
    HEALTH_DASHBOARD_STAGES,
    normalizeHealthDashboardStage,
    buildHealthProcessCounts,
} = require('../../shared/health-dashboard-stage');

describe('health-dashboard-stage', () => {
    describe('normalizeHealthDashboardStage — precedence rules', () => {
        it('CERTIFIED wins when workflowState=CERTIFIED + hasCertificate=true', () => {
            expect(normalizeHealthDashboardStage(
                { workflowState: 'CERTIFIED' },
                { hasCertificate: true },
            )).toBe(HEALTH_DASHBOARD_STAGES.CERTIFIED);
        });

        it('CERTIFIED wins via certificateCount > 0 (alt input)', () => {
            expect(normalizeHealthDashboardStage(
                { status: 'CERTIFIED' },
                { certificateCount: 1 },
            )).toBe(HEALTH_DASHBOARD_STAGES.CERTIFIED);
        });

        it('APPROVED stage upgrades to CERTIFIED when hasCertificate=true', () => {
            expect(normalizeHealthDashboardStage(
                { status: 'APPROVED' },
                { hasCertificate: true },
            )).toBe(HEALTH_DASHBOARD_STAGES.CERTIFIED);
        });

        it('APPROVED for status=APPROVED / workflowState=APPROVED', () => {
            expect(normalizeHealthDashboardStage({ status: 'APPROVED' }))
                .toBe(HEALTH_DASHBOARD_STAGES.APPROVED);
            expect(normalizeHealthDashboardStage({ workflowState: 'APPROVED' }))
                .toBe(HEALTH_DASHBOARD_STAGES.APPROVED);
        });

        it('AUDIT_PASSED also lands in APPROVED tile (waiting final approval)', () => {
            expect(normalizeHealthDashboardStage({ status: 'AUDIT_PASSED' }))
                .toBe(HEALTH_DASHBOARD_STAGES.APPROVED);
            expect(normalizeHealthDashboardStage({ workflowState: 'AUDIT_PASSED' }))
                .toBe(HEALTH_DASHBOARD_STAGES.APPROVED);
        });

        // AUDIT_FEE_PAID ออกจากชุดนี้ไปเป็นขั้นของตัวเอง 2026-09-11 — จ่ายแล้วแต่ยังไม่มี
        // ใครนัดวัน ไม่ใช่ "กำลังตรวจ" (ดู describe 'รอนัดวันตรวจแปลงเป็นขั้นของตัวเอง')
        it('UNDER_FIELD_AUDIT for any AUDIT_STATES member', () => {
            for (const state of ['AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING']) {
                expect(normalizeHealthDashboardStage({ status: state }))
                    .toBe(HEALTH_DASHBOARD_STAGES.UNDER_FIELD_AUDIT);
            }
        });

        it('PENDING_FEE_PHASE2 for DOC_APPROVED / PENDING_AUDIT_FEE', () => {
            expect(normalizeHealthDashboardStage({ status: 'DOC_APPROVED' }))
                .toBe(HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE2);
            expect(normalizeHealthDashboardStage({ status: 'PENDING_AUDIT_FEE' }))
                .toBe(HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE2);
        });

        it('REVISION_REQUIRED for REVISION_REQUESTED', () => {
            expect(normalizeHealthDashboardStage({ status: 'REVISION_REQUESTED' }))
                .toBe(HEALTH_DASHBOARD_STAGES.REVISION_REQUIRED);
        });

        it('UNDER_DOCUMENT_REVIEW for DOC_FEE_PAID / ASSIGNED_FOR_REVIEW + legacy aliases', () => {
            for (const state of ['DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW', 'PENDING_REVIEW', 'IN_REVIEW']) {
                expect(normalizeHealthDashboardStage({ status: state }))
                    .toBe(HEALTH_DASHBOARD_STAGES.UNDER_DOCUMENT_REVIEW);
            }
        });

        it('PENDING_FEE_PHASE1 for SUBMITTED / PENDING_DOC_FEE', () => {
            for (const state of ['SUBMITTED', 'PENDING_DOC_FEE']) {
                expect(normalizeHealthDashboardStage({ status: state }))
                    .toBe(HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE1);
            }
        });

        it('DRAFT when status is DRAFT or absent', () => {
            expect(normalizeHealthDashboardStage({ status: 'DRAFT' }))
                .toBe(HEALTH_DASHBOARD_STAGES.DRAFT);
            expect(normalizeHealthDashboardStage({}))
                .toBe(HEALTH_DASHBOARD_STAGES.DRAFT);
            expect(normalizeHealthDashboardStage(null))
                .toBe(HEALTH_DASHBOARD_STAGES.DRAFT);
        });

        it('falls back to UNDER_DOCUMENT_REVIEW for unrecognized non-empty status', () => {
            // Defensive default — better to show the user "review in progress"
            // than crash or show a misleading "draft" tile.
            expect(normalizeHealthDashboardStage({ status: 'SOME_NEW_STATUS' }))
                .toBe(HEALTH_DASHBOARD_STAGES.UNDER_DOCUMENT_REVIEW);
        });

        it('reads workflowState from formData when top-level is absent', () => {
            // Backend sometimes mirrors workflow state into formData.
            expect(normalizeHealthDashboardStage({
                formData: { workflowState: 'AUDIT_CONFIRMED' },
            })).toBe(HEALTH_DASHBOARD_STAGES.UNDER_FIELD_AUDIT);
        });

        it('precedence: workflowState beats status when both classify differently', () => {
            // App with status=DRAFT but workflowState=AUDIT_CONFIRMED resolves
            // to the audit tile — workflow engine has advanced past the
            // legacy-status mirror.
            expect(normalizeHealthDashboardStage({
                status: 'DRAFT',
                workflowState: 'AUDIT_CONFIRMED',
            })).toBe(HEALTH_DASHBOARD_STAGES.UNDER_FIELD_AUDIT);
        });
    });

    describe('buildHealthProcessCounts', () => {
        it('returns all-zero counts for empty input', () => {
            const counts = buildHealthProcessCounts([]);
            expect(counts.draft).toBe(0);
            expect(counts.pendingFeePhase1).toBe(0);
            expect(counts.underDocumentReview).toBe(0);
            expect(counts.revisionRequired).toBe(0);
            expect(counts.pendingFeePhase2).toBe(0);
            expect(counts.underFieldAudit).toBe(0);
            expect(counts.approved).toBe(0);
            expect(counts.certified).toBe(0);
        });

        it('counts each app into exactly one stage', () => {
            const counts = buildHealthProcessCounts([
                { status: 'DRAFT' },
                { status: 'SUBMITTED' },
                { status: 'DOC_FEE_PAID' },
                { status: 'REVISION_REQUESTED' },
                { status: 'PENDING_AUDIT_FEE' },
                { status: 'AUDIT_CONFIRMED' },
                { status: 'AUDIT_PASSED' },
                { status: 'CERTIFIED', hasCertificate: true },
            ]);
            expect(counts.draft).toBe(1);
            expect(counts.pendingFeePhase1).toBe(1);
            expect(counts.underDocumentReview).toBe(1);
            expect(counts.revisionRequired).toBe(1);
            expect(counts.pendingFeePhase2).toBe(1);
            expect(counts.underFieldAudit).toBe(1);
            expect(counts.approved).toBe(1);
            expect(counts.certified).toBe(1);
        });

        it('exposes backward-compat keys (waitingDocumentReview / waitingPayment / waitingAudit)', () => {
            // Older frontend builds depend on these aggregate keys.
            const counts = buildHealthProcessCounts([
                { status: 'DOC_FEE_PAID' },         // underDocumentReview
                { status: 'REVISION_REQUESTED' },   // revisionRequired
                { status: 'SUBMITTED' },            // pendingFeePhase1
                { status: 'PENDING_AUDIT_FEE' },    // pendingFeePhase2
                { status: 'AUDIT_CONFIRMED' },      // underFieldAudit
                { status: 'AUDIT_PASSED' },         // approved
            ]);
            expect(counts.waitingDocumentReview).toBe(2); // underDoc + revision
            expect(counts.waitingPayment).toBe(2);        // phase1 + phase2 fees
            expect(counts.waitingAudit).toBe(2);          // audit + approved
        });

        it('handles null / undefined input defensively', () => {
            const counts = buildHealthProcessCounts(null);
            expect(counts.draft).toBe(0);
            expect(counts.certified).toBe(0);
        });
    });
});

/**
 * รอนัดวันตรวจแปลง — ช่วงระหว่าง "จ่ายงวดที่ 2 แล้ว" กับ "มีคนนัดวันให้แล้ว"
 *
 * `AUDIT_FEE_PAID` เคยอยู่ในชุดเดียวกับสถานะที่กำลังตรวจจริง (AUDIT_CONFIRMED,
 * AUDIT_PASSED, CAR_*) จอจึงบอกว่า "อยู่ระหว่างตรวจประเมิน" ตั้งแต่วินาทีที่เงินเข้า
 * ทั้งที่ยังไม่มีผู้ตรวจและยังไม่มีวัน · ผู้ยื่นไม่มีเหตุให้สงสัยเลย เพราะจอบอกว่า
 * ขั้นถัดไปเริ่มไปแล้ว แล้วก็รอไปเรื่อย ๆ
 *
 * คนที่เปลี่ยนสถานะนี้ต่อคือผู้จัดสรรงาน (AUDIT_FEE_PAID → AUDIT_CONFIRMED,
 * audit-scheduling-service.js:7) — จอต้องบอกให้ตรงว่ากำลังรอใคร
 *
 * นี่คือคลาสเดียวกับข้อบกพร่องที่บล็อกนี้เคยตรึงไว้ตอนยังมีสถานะสลิป: สถานะที่ตก
 * ผ่านทุกสาขาไปจบที่ป้ายผิด
 */
describe('รอนัดวันตรวจแปลงเป็นขั้นของตัวเอง', () => {
    const { normalizeHealthDashboardStage, HEALTH_DASHBOARD_STAGES, STAGE_LABEL_TH } =
        require('../../shared/health-dashboard-stage');

    it('ไม่ใช่ "กำลังตรวจประเมิน"', () => {
        expect(normalizeHealthDashboardStage({ status: 'AUDIT_FEE_PAID' }))
            .toBe(HEALTH_DASHBOARD_STAGES.PENDING_AUDIT_SCHEDULE);
        expect(normalizeHealthDashboardStage({ status: 'AUDIT_FEE_PAID' }))
            .not.toBe(HEALTH_DASHBOARD_STAGES.UNDER_FIELD_AUDIT);
    });

    it('อ่าน workflowState ด้วย ไม่ใช่ status อย่างเดียว', () => {
        expect(normalizeHealthDashboardStage({ workflowState: 'AUDIT_FEE_PAID' }))
            .toBe(HEALTH_DASHBOARD_STAGES.PENDING_AUDIT_SCHEDULE);
    });

    it('บอกว่ากำลังรออะไรอยู่จริง ๆ', () => {
        expect(STAGE_LABEL_TH[HEALTH_DASHBOARD_STAGES.PENDING_AUDIT_SCHEDULE])
            .toBe('รอนัดวันตรวจประเมินแปลง');
    });

    it('ไม่บอกว่ายังค้างค่าธรรมเนียมอยู่', () => {
        // จ่ายแล้ว · การพากลับไปหน้าชำระเงินชวนให้จ่ายซ้ำ
        expect(normalizeHealthDashboardStage({ status: 'AUDIT_FEE_PAID' }))
            .not.toBe(HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE2);
    });

    it('นัดแล้วถึงจะเป็น "กำลังตรวจ" — สองขั้นนี้ต้องไม่ใช่ขั้นเดียวกัน', () => {
        expect(normalizeHealthDashboardStage({ status: 'AUDIT_CONFIRMED' }))
            .toBe(HEALTH_DASHBOARD_STAGES.UNDER_FIELD_AUDIT);
    });

    it('นับแยกกัน', () => {
        const { buildHealthProcessCounts } = require('../../shared/health-dashboard-stage');
        const counts = buildHealthProcessCounts([
            { status: 'AUDIT_FEE_PAID' },
            { status: 'AUDIT_CONFIRMED' },
            { status: 'ASSIGNED_FOR_REVIEW' },
        ]);
        expect(counts.pendingAuditSchedule).toBe(1);
        expect(counts.underFieldAudit).toBe(1);
        expect(counts.underDocumentReview).toBe(1);
    });
});
