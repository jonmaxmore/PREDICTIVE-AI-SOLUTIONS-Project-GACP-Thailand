/**
 * Unit tests for application-visibility helper.
 *
 * Wave A Phase 44 simplified the filter to check only the canonical
 * role columns (`auditorId`, `headAuditorId`, `reviewerId`). The dormant
 * column sets get dropped in Phase D.
 *
 * H17 (2026-08-23) replaced the "unnarrowed roles fall through to null"
 * fall-through with an explicit three-bucket contract — an absent scope now
 * means DENY. See shared/application-visibility.js's header and
 * __tests__/unit/h17-application-visibility-scope.test.js for the route-level
 * proof on the three surfaces that leaked.
 */

const {
    applicationVisibilityFilter,
    withVisibility,
    DENY_ALL,
} = require('../shared/application-visibility');
const { ROLE_TRANSITIONS } = require('../services/workflow-transition-service');

describe('applicationVisibilityFilter — unrestricted roles (null = no narrowing)', () => {
    // Only the tenant operator roles read everything. admin holds every
    // permission (canonical-rbac.js:232-235); platform_admin is its
    // cross-tenant superset (ADR-014).
    it.each([
        ['system_admin_dtam', 'u-admin'],
        ['system_admin_platform', 'u-pa'],
    ])('returns null for canonicalRole=%s', (role, id) => {
        expect(applicationVisibilityFilter({ id, canonicalRole: role })).toBeNull();
    });
});

describe('applicationVisibilityFilter — work-pool roles narrowed to their own workflow edges', () => {
    // H17 regression: these returned null (= whole table, applicant national
    // ID + address included). They are now sliced to the lifecycle states
    // named by their own ROLE_TRANSITIONS rows.
    // การเงินสองฝั่งไม่อยู่ในชุดนี้ตั้งแต่ 2026-09-11: สไลซ์ของเขาไม่ได้มาจากขาใน
    // ROLE_TRANSITIONS อีกแล้ว (เขาไม่มีขาเลย — webhook เป็นผู้ตัดสถานะ) หน้าต่างของเขา
    // ถูกประกาศไว้ตรง ๆ ที่ FINANCE_READ_WINDOW และมีเทสของตัวเองข้างล่างที่ตรึงทั้งรายการ
    it.each([
        ['dispatcher'],
    ])('%s sees only the states its own role edges touch', (role) => {
        const filter = applicationVisibilityFilter({ id: 'u-1', canonicalRole: role });
        const expected = new Set();
        for (const edge of ROLE_TRANSITIONS[role]) {
            const [from, to] = String(edge).split('->');
            expected.add(from);
            expected.add(to);
        }
        expect(filter).toEqual({ status: { in: expect.any(Array) } });
        expect(new Set(filter.status.in)).toEqual(expected);
        // The states that carry no work for these roles must be absent.
        expect(filter.status.in).not.toContain('DRAFT');
        expect(filter.status.in).not.toContain('CERTIFIED');
    });

    it('dispatcher is scoped to assign-reviewer + confirm-audit states', () => {
        const filter = applicationVisibilityFilter({ id: 'u-s', canonicalRole: 'dispatcher' });
        expect(new Set(filter.status.in)).toEqual(new Set([
            'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW', 'AUDIT_FEE_PAID', 'AUDIT_CONFIRMED',
        ]));
    });

    // หน้าต่างนี้ถูกประกาศไว้ตรง ๆ ไม่ได้ derive (ดู FINANCE_READ_WINDOW) เพราะการเงิน
    // ไม่มีขาใน ROLE_TRANSITIONS แล้วหลังสลิปปลดระวาง · ข้อนี้จึงเป็นด่านของ "อำนาจอ่าน":
    // เพิ่มสถานะเข้าไปต้องแก้บรรทัดนี้ด้วย จะแอบกว้างขึ้นไม่ได้
    it('การเงินถูกจำกัดอยู่ในหน้าต่างการชำระเงินที่ตัวเองดูแล และไม่กว้างกว่านั้น', () => {
        const expected = new Set([
            'PENDING_DOC_FEE', 'DOC_FEE_PAID',
            'PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID',
        ]);
        for (const role of ['finance_officer_platform', 'finance_officer_dtam']) {
            const filter = applicationVisibilityFilter({ id: 'u-a', canonicalRole: role });
            expect(new Set(filter.status.in)).toEqual(expected);
        }
        // และตรงกับรายการที่โมดูลประกาศไว้ — ไม่ใช่เลขที่เทสจำเอง
        const { FINANCE_READ_WINDOW } = require('../shared/application-visibility');
        expect(new Set(FINANCE_READ_WINDOW)).toEqual(expected);
    });
});

describe('applicationVisibilityFilter — document_reviewer narrowed to own assignments', () => {
    // Regression: previously returned null → the GENERAL /provider/applications
    // list/queue/:id/activities leaked the whole tenant pipeline + applicant PII to a
    // reviewer. Now scoped to its own assigned apps (mirrors the reviewer dashboard:
    // reviewerId column + legacy formData.PROVIDERAssignment.reviewerId fallback).
    it('matches the reviewerId column + legacy formData fallback', () => {
        expect(applicationVisibilityFilter({ id: 'u-rv', canonicalRole: 'document_reviewer' })).toEqual({
            OR: [
                { reviewerId: 'u-rv' },
                { formData: { path: ['PROVIDERAssignment', 'reviewerId'], equals: 'u-rv' } },
            ],
        });
    });

    it('fails closed when a document_reviewer has no User.id', () => {
        expect(applicationVisibilityFilter({ canonicalRole: 'document_reviewer' })).toEqual({ id: '__no_user_id__' });
    });
});

describe('applicationVisibilityFilter — fail-closed paths', () => {
    it('returns an impossible filter when no user is supplied', () => {
        expect(applicationVisibilityFilter(null)).toEqual({ id: '__no_user__' });
        expect(applicationVisibilityFilter(undefined)).toEqual({ id: '__no_user__' });
    });

    it('returns an impossible filter when a field inspector has no User.id', () => {
        expect(
            applicationVisibilityFilter({ canonicalRole: 'field_inspector' }),
        ).toEqual({ id: '__no_user_id__' });
        expect(
            applicationVisibilityFilter({ canonicalRole: 'field_inspector', id: null }),
        ).toEqual({ id: '__no_user_id__' });
        expect(
            applicationVisibilityFilter({ canonicalRole: 'field_inspector', id: undefined }),
        ).toEqual({ id: '__no_user_id__' });
    });

    // H17: the fall-through case. A role with no declared scope must DENY,
    // never fall through to null (= no restriction).
    it.each([
        ['health'],
        ['system'],
        ['some_future_role'],
        [''],
        [undefined],
    ])('denies a role with no declared application scope (%s)', (role) => {
        expect(applicationVisibilityFilter({ id: 'u-x', canonicalRole: role })).toEqual(DENY_ALL);
        expect(applicationVisibilityFilter({ id: 'u-x', canonicalRole: role })).not.toBeNull();
    });
});

describe('withVisibility', () => {
    const baseWhere = { isDeleted: false, status: 'APPROVED' };

    it('passes the base where through unchanged for unrestricted roles', () => {
        const out = withVisibility(baseWhere, { id: 'u-admin', canonicalRole: 'system_admin_dtam' });
        expect(out).toBe(baseWhere); // identity preserved
    });

    it('wraps in AND for a field inspector', () => {
        const out = withVisibility(baseWhere, { id: 'u-99', canonicalRole: 'field_inspector' });
        expect(out).toEqual({
            AND: [
                baseWhere,
                {
                    OR: [
                        { auditorId: 'u-99' },
                        { headAuditorId: 'u-99' },
                        // 2026-09-05 — a field inspector the dispatcher assigned as DOCUMENT
                        // reviewer must see that application in their own list. The roster
                        // deliberately offers field inspectors for review work, but the assignment
                        // writes only `reviewerId` and leaves sameReviewerAuditor false, so
                        // before this clause the work was assigned to someone who could not
                        // find it. Same rule the DOCUMENT_REVIEWER branch uses: you see what
                        // is assigned to you. Proved on a real database, not deduced.
                        { reviewerId: 'u-99' },
                        {
                            AND: [
                                { sameReviewerAuditor: true },
                                { reviewerId: 'u-99' },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('fails closed when no user is supplied', () => {
        const out = withVisibility(baseWhere, null);
        expect(out).toEqual({
            AND: [baseWhere, { id: '__no_user__' }],
        });
    });

    it('fails closed for a role with no declared scope', () => {
        const out = withVisibility(baseWhere, { id: 'u-x', canonicalRole: 'some_future_role' });
        expect(out).toEqual({ AND: [baseWhere, DENY_ALL] });
    });
});
