/**
 * V2-B RB-5 contract lock — explicit assertion that AUDITOR can perform
 * the document-review transitions and that DOCUMENT_REVIEWER's
 * permission set is exactly the documented 2 entries.
 *
 * Why this test exists:
 *   - The RFC §RB-5 documents that
 *     `ROLE_TRANSITIONS[auditor]` (workflow-transition-service.js:217-226)
 *     deliberately includes `ASSIGNED_FOR_REVIEW → DOC_APPROVED` and
 *     `ASSIGNED_FOR_REVIEW → REVISION_REQUESTED`. This is the
 *     post-consolidation behaviour: the legacy HEAD_AUDITOR role was
 *     merged into AUDITOR (canonical-rbac.js:38) and the doc-review
 *     fallback path moved with it.
 *   - The user has flagged this combination as a worry ("AUDITOR must
 *     NOT be able to approve documents"). It is, however, the canonical
 *     contract — `REVIEWERS` role group at canonical-rbac.js:246-249
 *     also includes AUDITOR, and `APPLICATION_DOC_REVIEW` permission is
 *     granted to AUDITOR at canonical-rbac.js:184.
 *   - This test locks the canonical contract so it can ONLY change
 *     deliberately. A future cleanup that silently drops the entries
 *     fails this test loudly with a "missing transition" message. If
 *     business decides AUDITOR should be narrowed, the test must be
 *     updated in the same commit as the source change.
 *
 * Pattern: mirrors `canonical-contract-verification.test.js:140-145`
 * (frozen-dictionary assertions on the workflow service exports).
 *
 * See: docs/handoffs/iter-V2/00-rfc.md §V2-B / RB-5
 */

const workflowSvc = require('../../services/workflow-transition-service');
const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');

describe('V2-B RB-5 — AUDITOR can transition ASSIGNED_FOR_REVIEW → DOC_APPROVED (intentional)', () => {
    it('ROLE_TRANSITIONS exposes the AUDITOR set', () => {
        const auditorTransitions = workflowSvc.ROLE_TRANSITIONS[CANONICAL_ROLES.FIELD_INSPECTOR];
        expect(auditorTransitions).toBeDefined();
        expect(auditorTransitions instanceof Set).toBe(true);
    });

    it('AUDITOR set explicitly includes ASSIGNED_FOR_REVIEW → DOC_APPROVED', () => {
        const auditorTransitions = workflowSvc.ROLE_TRANSITIONS[CANONICAL_ROLES.FIELD_INSPECTOR];
        expect(auditorTransitions.has('ASSIGNED_FOR_REVIEW->DOC_APPROVED')).toBe(true);
    });

    it('AUDITOR set explicitly includes ASSIGNED_FOR_REVIEW → REVISION_REQUESTED', () => {
        const auditorTransitions = workflowSvc.ROLE_TRANSITIONS[CANONICAL_ROLES.FIELD_INSPECTOR];
        expect(auditorTransitions.has('ASSIGNED_FOR_REVIEW->REVISION_REQUESTED')).toBe(true);
    });

    it('canRoleTransition agrees that AUDITOR can approve docs', () => {
        // Behavioural assertion via the public predicate. If the
        // dictionary ever drifts the predicate goes with it; this
        // double-check catches a subtle refactor that swaps the Set
        // implementation but accidentally drops the doc-review pair.
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.FIELD_INSPECTOR,
            'ASSIGNED_FOR_REVIEW',
            'DOC_APPROVED',
        )).toBe(true);
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.FIELD_INSPECTOR,
            'ASSIGNED_FOR_REVIEW',
            'REVISION_REQUESTED',
        )).toBe(true);
    });

    it('canRoleTransition accepts the AUDITOR alias forms (head_auditor, inspector)', () => {
        // canonical-rbac.js consolidates HEAD_AUDITOR + inspector into
        // AUDITOR via the alias table. The contract carries over to
        // canRoleTransition because it normalises the role first.
        expect(workflowSvc.canRoleTransition('field_inspector', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(true);
        expect(workflowSvc.canRoleTransition('FIELD_INSPECTOR', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(true);
        // คำเก่าถูกปฏิเสธ ไม่ใช่แปลให้
        expect(workflowSvc.canRoleTransition('inspector', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(false);
        expect(workflowSvc.canRoleTransition('field_inspector', 'ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED')).toBe(true);
    });

    it('AUDITOR set contains exactly the 10 documented transitions (full lock)', () => {
        // Frozen-dictionary assertion: the canonical contract pins the
        // AUDITOR transition set to these 10 entries. Adding / removing
        // entries requires updating this list deliberately.
        // 2026-05-31: APPROVED->CERTIFIED added — the auditor (certification body)
        // issues the certificate; admin is not part of the workflow.
        const expected = [
            'ASSIGNED_FOR_REVIEW->DOC_APPROVED',
            'ASSIGNED_FOR_REVIEW->REVISION_REQUESTED',
            'AUDIT_CONFIRMED->AUDIT_PASSED',
            'AUDIT_CONFIRMED->CAR_PENDING',
            'AUDIT_CONFIRMED->REJECTED',
            'CAR_REVIEWING->AUDIT_PASSED',
            'CAR_REVIEWING->CAR_PENDING',
            // F-CERT-SOD 2026-09-10 — 'AUDIT_PASSED->APPROVED' และ 'APPROVED->CERTIFIED'
            // ถูกถอดออกจากผู้ตรวจประเมินแปลง และย้ายไปอยู่กับ CERTIFICATE_APPROVER
            // ผู้ตรวจยังย้อนผลของตัวเองได้ (ขาข้างล่าง) แต่ตัดสินให้การรับรองไม่ได้แล้ว
            'AUDIT_PASSED->CAR_REVIEWING',
        ];
        const auditorTransitions = workflowSvc.ROLE_TRANSITIONS[CANONICAL_ROLES.FIELD_INSPECTOR];
        const actual = [...auditorTransitions].sort();
        expect(actual).toEqual([...expected].sort());
    });

    test('ผู้ตัดสินให้การรับรอง ถือขาตัดสินครบ และไม่มีขาบันทึกผลตรวจเลย', () => {
        const approver = workflowSvc.ROLE_TRANSITIONS[CANONICAL_ROLES.CERTIFICATE_APPROVER];
        expect([...approver].sort()).toEqual([
            'APPROVED->CERTIFIED',
            'AUDIT_PASSED->APPROVED',
            'AUDIT_PASSED->CAR_REVIEWING',
        ]);
        // ขาที่บันทึก "ผลการตรวจ" ต้องไม่อยู่ในมือผู้ตัดสิน
        expect(approver.has('AUDIT_CONFIRMED->AUDIT_PASSED')).toBe(false);
        expect(approver.has('AUDIT_CONFIRMED->REJECTED')).toBe(false);
    });
});

describe('V2-B RB-2 — DOCUMENT_REVIEWER permission set is exactly the documented 2 entries', () => {
    it('ROLE_TRANSITIONS exposes the DOCUMENT_REVIEWER set', () => {
        const docReviewerTransitions = workflowSvc.ROLE_TRANSITIONS[CANONICAL_ROLES.DOCUMENT_REVIEWER];
        expect(docReviewerTransitions).toBeDefined();
        expect(docReviewerTransitions instanceof Set).toBe(true);
    });

    it('DOCUMENT_REVIEWER contains exactly the 2 documented transitions', () => {
        const expected = [
            'ASSIGNED_FOR_REVIEW->DOC_APPROVED',
            'ASSIGNED_FOR_REVIEW->REVISION_REQUESTED',
        ];
        const docReviewerTransitions = workflowSvc.ROLE_TRANSITIONS[CANONICAL_ROLES.DOCUMENT_REVIEWER];
        const actual = [...docReviewerTransitions].sort();
        expect(actual).toEqual([...expected].sort());
    });

    it('DOCUMENT_REVIEWER CANNOT perform AUDITOR-only transitions', () => {
        // Negative checks — proves the set is bounded above as well as
        // below. If DOCUMENT_REVIEWER ever picks up audit-result
        // transitions silently, this test fails.
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            'AUDIT_CONFIRMED',
            'AUDIT_PASSED',
        )).toBe(false);
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            'AUDIT_CONFIRMED',
            'REJECTED',
        )).toBe(false);
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            'AUDIT_PASSED',
            'APPROVED',
        )).toBe(false);
    });

    it('DOCUMENT_REVIEWER CANNOT perform SCHEDULER transitions', () => {
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            'DOC_FEE_PAID',
            'ASSIGNED_FOR_REVIEW',
        )).toBe(false);
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.DOCUMENT_REVIEWER,
            'AUDIT_FEE_PAID',
            'AUDIT_CONFIRMED',
        )).toBe(false);
    });
});

describe('V2-B — cross-role boundary integrity', () => {
    it('SCHEDULER cannot approve documents', () => {
        // V1's RFC §RB-6 asserts this informally; lock it explicitly so
        // a future refactor that widens SCHEDULER fails the test.
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.DISPATCHER,
            'ASSIGNED_FOR_REVIEW',
            'DOC_APPROVED',
        )).toBe(false);
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.DISPATCHER,
            'ASSIGNED_FOR_REVIEW',
            'REVISION_REQUESTED',
        )).toBe(false);
    });

    it('การเงินทั้งสองฝั่งเดินสถานะคำขอไม่ได้เลย — รวมถึงขาที่เป็นเงินของตัวเอง', () => {
        // เดิมสองบทบาทนี้ถือขาอนุมัติสลิปเป็นขาเดียวที่มี · สลิปถูกปลดระวาง 2026-09-11
        // การจ่ายเป็น Stripe และ webhook ที่ยืนยันลายเซ็นแล้วเป็นผู้ตัดสถานะ
        // ⇒ ชุดว่างคือความจริงของงาน ไม่ใช่ของที่ลืมเติม
        expect(workflowSvc.canRoleTransition('finance_officer_dtam', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(false);
        expect(workflowSvc.canRoleTransition('finance_officer_platform', 'AUDIT_FEE_PAID', 'AUDIT_CONFIRMED')).toBe(false);
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            'ASSIGNED_FOR_REVIEW',
            'DOC_APPROVED',
        )).toBe(false);

        // ขาตัดเงินเป็นของ webhook ไม่ใช่ของคน — เจ้าหน้าที่การเงินกดเองไม่ได้
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            'PENDING_DOC_FEE',
            'DOC_FEE_PAID',
        )).toBe(false);
        expect(workflowSvc.canRoleTransition(
            CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
            'PENDING_AUDIT_FEE',
            'AUDIT_FEE_PAID',
        )).toBe(false);

        // และแถวของทั้งสองต้อง **ยังอยู่** ในตาราง แม้ชุดจะว่าง — บทบาทที่ไม่มีแถว
        // จะตกไปทางผ่อนปรน คือผ่านด่านบทบาทได้ทุกขาที่ตารางขาอนุญาต (บทเรียน P0-E)
        expect(Object.keys(workflowSvc.ROLE_TRANSITIONS))
            .toEqual(expect.arrayContaining([
                CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
                CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
            ]));
    });

    it('HEALTH cannot impersonate any doc-review or audit-result transition', () => {
        expect(workflowSvc.canRoleTransition('health', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(false);
        expect(workflowSvc.canRoleTransition('health', 'AUDIT_CONFIRMED', 'AUDIT_PASSED')).toBe(false);
        expect(workflowSvc.canRoleTransition('health', 'AUDIT_PASSED', 'APPROVED')).toBe(false);
    });

    it('unknown / falsy roles return false (never throw)', () => {
        expect(workflowSvc.canRoleTransition('garbage', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(false);
        expect(workflowSvc.canRoleTransition(null, 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(false);
        expect(workflowSvc.canRoleTransition(undefined, 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(false);
        expect(workflowSvc.canRoleTransition('', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED')).toBe(false);
    });
});
