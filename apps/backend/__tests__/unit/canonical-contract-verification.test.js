/**
 * Canonical contract verification tests.
 *
 * Locks the workflow & RBAC dictionaries (T-001 + T-005) to the code
 * source-of-truth. If any of these tests fail, EITHER the code drifted
 * from the contract OR the contract needs an explicit revision —
 * not silent drift.
 *
 * Reference contracts:
 *   - docs/architecture/2026-05-04-canonical-auth-session-rbac-contract.md
 *   - docs/architecture/2026-05-04-canonical-workflow-status-dictionary.md
 *
 * Source-of-truth modules under test:
 *   - apps/backend/services/workflow-transition-service.js
 *   - apps/backend/shared/canonical-rbac.js
 */

const workflowSvc = require('../../services/workflow-transition-service');
const rbac = require('../../shared/canonical-rbac');

describe('Canonical Workflow Dictionary (T-005)', () => {
    const expectedStates = [
        'DRAFT',
        'SUBMITTED',
        'PENDING_DOC_FEE',
        'DOC_FEE_PAID',
        'ASSIGNED_FOR_REVIEW',
        'REVISION_REQUESTED',
        'DOC_APPROVED',
        'PENDING_AUDIT_FEE',
        'AUDIT_FEE_PAID',
        'AUDIT_CONFIRMED',
        'CAR_PENDING',
        'CAR_REVIEWING',
        'AUDIT_PASSED',
        'APPROVED',
        'CERTIFIED',
        'REJECTED',
        'EXPIRED',
        'CANCEL_EXPIRED',
    ];

    describe('§1.1 Canonical states', () => {
        // 18 = 20 เดิม ลบสถานะสลิปสองตัวที่ปลดระวาง 2026-09-11
        it('exports exactly the 18 documented states in canonical order', () => {
            expect([...workflowSvc.WORKFLOW_STATES]).toEqual(expectedStates);
        });

        it('every state is also a key in APPLICATION_STATUSES (identity map)', () => {
            for (const state of expectedStates) {
                expect(workflowSvc.APPLICATION_STATUSES[state]).toBe(state);
            }
        });
    });

    describe('§1.2 Allowed transitions', () => {
        const expectedTransitions = {
            DRAFT: ['SUBMITTED'],
            SUBMITTED: ['PENDING_DOC_FEE'],
            // Wave 2 (Stripe checkout): the payment gates gain a DIRECT settle
            // edge driven by the verified payment_intent.succeeded webhook. The
            // slip-review edge stays until the drain window closes (D2).
            // R2 M5: the payment gates also gain a SYSTEM-only EXPIRED edge —
            // the payment-abandonment cron auto-closes a fully-reminded, long-
            // overdue unpaid checkout (jobs/payment-closure-job.js).
            PENDING_DOC_FEE: ['DOC_FEE_PAID', 'EXPIRED'],
            DOC_FEE_PAID: ['ASSIGNED_FOR_REVIEW'],
            ASSIGNED_FOR_REVIEW: ['DOC_APPROVED', 'REVISION_REQUESTED'],
            REVISION_REQUESTED: ['ASSIGNED_FOR_REVIEW', 'EXPIRED'],
            DOC_APPROVED: ['PENDING_AUDIT_FEE'],
            PENDING_AUDIT_FEE: ['AUDIT_FEE_PAID', 'EXPIRED'],
            AUDIT_FEE_PAID: ['AUDIT_CONFIRMED'],
            AUDIT_CONFIRMED: ['AUDIT_PASSED', 'CAR_PENDING', 'REJECTED'],
            CAR_PENDING: ['CAR_REVIEWING', 'EXPIRED'],
            CAR_REVIEWING: ['AUDIT_PASSED', 'CAR_PENDING'],
            AUDIT_PASSED: ['APPROVED', 'CAR_REVIEWING'],
            APPROVED: ['CERTIFIED'],
            CERTIFIED: [],
            REJECTED: [],
            // Waiver-reopen (owner ruling 2026-07-08, manual §2): EXPIRED is
            // no longer terminal — SYSTEM-only edges reopen back to the exact
            // pre-expiry state after DTAM-side accountant approval.
            EXPIRED: ['CAR_PENDING', 'REVISION_REQUESTED'],
            CANCEL_EXPIRED: [],
        };

        it('ALLOWED_TRANSITIONS keys match the canonical state set', () => {
            expect(Object.keys(workflowSvc.ALLOWED_TRANSITIONS).sort())
                .toEqual([...expectedStates].sort());
        });

        for (const [from, expected] of Object.entries(expectedTransitions)) {
            it(`from ${from} accepts exactly: [${expected.join(', ') || '(terminal)'}]`, () => {
                const actual = [...workflowSvc.ALLOWED_TRANSITIONS[from]].sort();
                expect(actual).toEqual([...expected].sort());
            });
        }

        it('canTransition rejects unknown transitions and accepts documented ones', () => {
            // happy path
            expect(workflowSvc.canTransition('DRAFT', 'SUBMITTED')).toBe(true);
            // not in graph
            expect(workflowSvc.canTransition('DRAFT', 'CERTIFIED')).toBe(false);
            // skipping a phase
            expect(workflowSvc.canTransition('SUBMITTED', 'DOC_FEE_PAID')).toBe(false);
            // terminal
            expect(workflowSvc.canTransition('CERTIFIED', 'APPROVED')).toBe(false);
        });

        it('WF-F4: canTransition stays edge-only when no actorRole is passed (backward compatible)', () => {
            // Two-arg form is unchanged — pure edge legality, no role narrowing.
            expect(workflowSvc.canTransition('AUDIT_CONFIRMED', 'REJECTED')).toBe(true);
            expect(workflowSvc.canTransition('AUDIT_PASSED', 'CAR_REVIEWING')).toBe(true);
        });

        it('WF-F4: canTransition also enforces RBAC when an actorRole is supplied', () => {
            // Edge is legal AND the role owns it → allowed.
            expect(workflowSvc.canTransition('AUDIT_CONFIRMED', 'REJECTED', { actorRole: 'field_inspector' })).toBe(true);
            // Edge is legal but the role does NOT own it → denied (previously the
            // strict writer ignored role entirely; this closes that gap).
            expect(workflowSvc.canTransition('AUDIT_CONFIRMED', 'REJECTED', { actorRole: 'health' })).toBe(false);
            // An illegal edge is denied regardless of role.
            expect(workflowSvc.canTransition('DRAFT', 'CERTIFIED', { actorRole: 'field_inspector' })).toBe(false);
            // WF-F4 SYSTEM grant: `system` is now a first-class narrowed role.
            // It owns its documented automatic/cron edges …
            expect(workflowSvc.canTransition('REVISION_REQUESTED', 'EXPIRED', { actorRole: 'system' })).toBe(true);
            expect(workflowSvc.canTransition('SUBMITTED', 'PENDING_DOC_FEE', { actorRole: 'system' })).toBe(true);
            // … and ONLY those. An edge-legal move system does NOT own is denied
            // (least-privilege; before the grant this fell through and returned true).
            expect(workflowSvc.canTransition('AUDIT_CONFIRMED', 'REJECTED', { actorRole: 'system' })).toBe(false);
            // ADMIN has no ROLE_TRANSITIONS entry and still falls through on edge
            // legality here — it is gated by the `force` flag in buildTransitionUpdate.
            expect(workflowSvc.canTransition('AUDIT_CONFIRMED', 'REJECTED', { actorRole: 'system_admin_dtam' })).toBe(true);
        });
    });

    describe('§1.3 Role-owned transitions', () => {
        const expectedRoleTransitions = {
            // ผู้ยื่นเหลือสามขา — สองขา "อัปโหลดสลิป" หายไปกับสลิป (2026-09-11)
            health: [
                'DRAFT->SUBMITTED',
                'REVISION_REQUESTED->ASSIGNED_FOR_REVIEW',
                'CAR_PENDING->CAR_REVIEWING',
            ],
            // การเงินทั้งสองฝั่ง: ชุดว่าง · ขาอนุมัติสลิปสี่ขาที่เคยเป็นขาเดียวที่มี
            // หายไปพร้อมสลิป และขาตัดเงินเป็นของ webhook ไม่ใช่ของคน
            //
            // แถวต้องยังอยู่แม้ชุดว่าง (บทเรียน P0-E): บทบาทที่ไม่มีแถวจะตกไปทาง
            // ผ่อนปรน คือผ่านด่านบทบาทได้ทุกขาที่ตารางขาอนุญาต — ลบแถว = เปิดอำนาจ
            finance_officer_dtam: [],
            finance_officer_platform: [],
            document_reviewer: [
                'ASSIGNED_FOR_REVIEW->DOC_APPROVED',
                'ASSIGNED_FOR_REVIEW->REVISION_REQUESTED',
            ],
            dispatcher: [
                'DOC_FEE_PAID->ASSIGNED_FOR_REVIEW',
                'AUDIT_FEE_PAID->AUDIT_CONFIRMED',
            ],
            field_inspector: [
                'ASSIGNED_FOR_REVIEW->DOC_APPROVED',
                'ASSIGNED_FOR_REVIEW->REVISION_REQUESTED',
                'AUDIT_CONFIRMED->AUDIT_PASSED',
                'AUDIT_CONFIRMED->CAR_PENDING',
                'AUDIT_CONFIRMED->REJECTED',
                'CAR_REVIEWING->AUDIT_PASSED',
                'CAR_REVIEWING->CAR_PENDING',
                // F-CERT-SOD 2026-09-10 — 'AUDIT_PASSED->APPROVED' และ
                // 'APPROVED->CERTIFIED' ย้ายไป certificate_approver ข้างล่าง
                'AUDIT_PASSED->CAR_REVIEWING',
            ],
            certificate_approver: [
                'AUDIT_PASSED->APPROVED',
                'AUDIT_PASSED->CAR_REVIEWING',
                'APPROVED->CERTIFIED',
            ],
            // WF-F4 SYSTEM grant — automatic billing advances + cron expiry.
            // Mirrors the canonical dictionary §1.3 system row, minus
            // APPROVED->CERTIFIED (auditor-issued, see auditor row — single-auditor
            // canon 2026-06-05) and *->CANCEL_EXPIRED (deprecated terminal).
            system: [
                'SUBMITTED->PENDING_DOC_FEE',
                'DOC_APPROVED->PENDING_AUDIT_FEE',
                'REVISION_REQUESTED->EXPIRED',
                'CAR_PENDING->EXPIRED',
                // Waiver-reopen edges (owner ruling 2026-07-08) — SYSTEM only,
                // executed inside waiver-reopen-service post-approval.
                'EXPIRED->REVISION_REQUESTED',
                'EXPIRED->CAR_PENDING',
                // Wave 2 (Stripe checkout): webhook-driven settles. Only the
                // verified payment_intent.succeeded handler exits a payment gate.
                'PENDING_DOC_FEE->DOC_FEE_PAID',
                'PENDING_AUDIT_FEE->AUDIT_FEE_PAID',
                // R2 M5 (payment-abandonment cron): SYSTEM auto-closes a fully-
                // reminded, long-overdue unpaid checkout at either payment gate.
                'PENDING_DOC_FEE->EXPIRED',
                'PENDING_AUDIT_FEE->EXPIRED',
            ],
        };

        for (const [role, expected] of Object.entries(expectedRoleTransitions)) {
            it(`${role} owns exactly the documented transitions (${expected.length} pairs)`, () => {
                const actual = [...workflowSvc.ROLE_TRANSITIONS[role]].sort();
                expect(actual).toEqual([...expected].sort());
            });
        }

        // P0-E behavioral guard: with their own entries, the Tier-16 accountant
        // roles are now LEAST-PRIVILEGE — the role gate denies any edge they do
        // not own (before, no entry meant NO role gate at all).
        describe('การเงินทั้งสองฝั่งถูกบีบจนไม่เหลือขาเลย', () => {
            it('แม้ขาตัดเงินก็ไม่ใช่ของคน — webhook เท่านั้นที่เดินได้', () => {
                expect(workflowSvc.canRoleTransition('finance_officer_dtam', 'PENDING_DOC_FEE', 'DOC_FEE_PAID')).toBe(false);
                expect(workflowSvc.canRoleTransition('finance_officer_platform', 'PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID')).toBe(false);
            });
            it('…and are DENIED scheduler/auditor edges (no more lenient fall-through)', () => {
                expect(workflowSvc.canRoleTransition('finance_officer_dtam', 'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW')).toBe(false);
                expect(workflowSvc.canRoleTransition('finance_officer_dtam', 'AUDIT_CONFIRMED', 'AUDIT_PASSED')).toBe(false);
                expect(workflowSvc.canRoleTransition('finance_officer_platform', 'APPROVED', 'CERTIFIED')).toBe(false);
            });
        });

        // บล็อกนี้เคยชื่อ "single-auditor canon (no two-person SoD)" และตรึงมติ 2026-06-05
        // ที่ให้ผู้ตรวจหน้างานคนเดียวถือทั้งบันทึกผล อนุมัติ และออกใบ · operator กลับมติเมื่อ
        // 2026-09-10 (F-CERT-SOD) · ข้อความยืนยันจึงถูก **กลับด้าน** ไม่ใช่ถูกลดทอน:
        // เคสที่เคยยืนยันว่า "ทำได้" ตอนนี้ยืนยันว่าถูกปฏิเสธ และเรียกชื่อคนที่ทำได้แทน
        describe('การตัดสินให้การรับรอง แยกจากการประเมิน (ISO/IEC 17065 §7.6)', () => {
            it('ผู้ตรวจประเมินแปลง เดินขาอนุมัติและออกใบไม่ได้อีกต่อไป', () => {
                expect(workflowSvc.canRoleTransition('field_inspector', 'AUDIT_PASSED', 'APPROVED')).toBe(false);
                expect(workflowSvc.canRoleTransition('field_inspector', 'APPROVED', 'CERTIFIED')).toBe(false);
            });
            it('ผู้อนุมัติใบรับรอง เดินได้ทั้งสองขา', () => {
                expect(workflowSvc.canRoleTransition('certificate_approver', 'AUDIT_PASSED', 'APPROVED')).toBe(true);
                expect(workflowSvc.canRoleTransition('certificate_approver', 'APPROVED', 'CERTIFIED')).toBe(true);
            });
            it('ไม่มีบทบาทอื่นถือขา APPROVED->CERTIFIED', () => {
                for (const role of ['finance_officer_platform', 'dispatcher', 'document_reviewer', 'system', 'field_inspector']) {
                    expect(workflowSvc.canRoleTransition(role, 'APPROVED', 'CERTIFIED')).toBe(false);
                }
            });
        });
    });

    describe('§1.4-1.5 Comment-required + editable statuses', () => {
        it('REQUIRES_COMMENT_TARGETS = { REVISION_REQUESTED, CAR_PENDING, REJECTED }', () => {
            expect([...workflowSvc.REQUIRES_COMMENT_TARGETS].sort()).toEqual([
                'CAR_PENDING',
                'REJECTED',
                'REVISION_REQUESTED',
            ]);
        });

        it('EDITABLE_STATUSES = { DRAFT, REVISION_REQUESTED, CAR_PENDING }', () => {
            expect([...workflowSvc.EDITABLE_STATUSES].sort()).toEqual([
                'CAR_PENDING',
                'DRAFT',
                'REVISION_REQUESTED',
            ]);
        });

        it('isApplicationEditable matches EDITABLE_STATUSES', () => {
            expect(workflowSvc.isApplicationEditable('DRAFT')).toBe(true);
            expect(workflowSvc.isApplicationEditable('REVISION_REQUESTED')).toBe(true);
            expect(workflowSvc.isApplicationEditable('CAR_PENDING')).toBe(true);
            expect(workflowSvc.isApplicationEditable('SUBMITTED')).toBe(false);
            expect(workflowSvc.isApplicationEditable('APPROVED')).toBe(false);
        });
    });

    describe('§1.6-1.7 Legacy alias dictionaries — REMOVED in PR 2c', () => {
        // Three tables (LEGACY_STATUS_BY_STATE, STATE_BY_LEGACY_STATUS,
        // STATE_INPUT_ALIASES, ~100 entries) translated legacy spellings on
        // read. They existed because writers kept producing values the state
        // machine could not name; PR 2b closed that, so the tables were
        // deleted rather than left as a permanent escape hatch.
        //
        // What used to be a contract ("these aliases resolve") is now the
        // opposite contract ("nothing but canonical resolves"), and it is
        // pinned here so a future re-introduction is a deliberate act.

        it('the alias dictionaries are no longer exported', () => {
            expect(workflowSvc.LEGACY_STATUS_BY_STATE).toBeUndefined();
            expect(workflowSvc.STATE_BY_LEGACY_STATUS).toBeUndefined();
            expect(workflowSvc.STATE_INPUT_ALIASES).toBeUndefined();
        });

        it('normalizeWorkflowStateInput accepts canonical in any case, and nothing else', () => {
            for (const state of expectedStates) {
                expect(workflowSvc.normalizeWorkflowStateInput(state)).toBe(state);
                expect(workflowSvc.normalizeWorkflowStateInput(state.toLowerCase())).toBe(state);
            }
            for (const legacy of ['REGISTERED', 'final_approved', 'audit_scheduled', 'car_submitted', 'PAYMENT_1_PAID']) {
                expect(workflowSvc.normalizeWorkflowStateInput(legacy)).toBeNull();
            }
        });
    });
});

/**
 * พจนานุกรมบทบาท (T-001)
 *
 * เขียนใหม่ 2026-09-10 หลัง operator สั่งตัดขาดจากคำเก่า — เดิมส่วนนี้ตรึงสามอย่างที่
 * ไม่มีอยู่แล้ว: ตารางแปลคำเก่า (`ROLE_ALIASES` ที่รับ 30 กว่าคำ), คีย์ deprecated
 * ใน `CANONICAL_ROLES`, และ `canonicalToLegacyRole()` ที่แปลงกลับเป็นตัวพิมพ์ใหญ่ยุคก่อน
 *
 * สิ่งที่ยังต้องตรึงคือรูปร่างของสัญญา ไม่ใช่เนื้อคำ: มีกี่บทบาท · แต่ละบทบาทอยู่ฝั่งไหน ·
 * แผนที่ปิดหรือไม่ · และคำที่ไม่รู้จักถูกปฏิเสธหรือไม่
 */
describe('Canonical RBAC Dictionary (T-001)', () => {
    const EXPECTED_ROLES = [
        'health',
        'document_reviewer', 'dispatcher', 'field_inspector', 'certificate_approver',
        'finance_officer_dtam', 'system_admin_dtam',
        'finance_officer_platform', 'system_admin_platform',
        'system',
    ];

    describe('§4.1 บทบาททั้งหมด', () => {
        it('CANONICAL_ROLES มีสิบค่า ไม่มีคำนอกรายการ', () => {
            const values = [...new Set(Object.values(rbac.CANONICAL_ROLES))].sort();
            expect(values).toEqual([...EXPECTED_ROLES].sort());
        });

        it('ไม่มีคีย์ deprecated เหลืออยู่', () => {
            for (const key of ['ADMIN', 'PLATFORM_ADMIN', 'SCHEDULER', 'AUDITOR',
                'HEAD_AUDITOR', 'AUDIT', 'ACCOUNT', 'ACCOUNT_DTAM', 'ACCOUNT_PLATFORM']) {
                expect(rbac.CANONICAL_ROLES[key]).toBeUndefined();
            }
        });
    });

    describe('§4.2 แผนที่ปิด และปฏิเสธคำเก่า', () => {
        it('ทุกคำแปลเป็นตัวมันเอง', () => {
            for (const role of EXPECTED_ROLES) {
                expect(rbac.normalizeRole(role)).toBe(role);
                expect(rbac.normalizeRole(role.toUpperCase())).toBe(role);
                expect(rbac.normalizeRole(`  ${role}  `)).toBe(role);
            }
        });

        it('คำที่ปลดระวางแล้วแปลไม่ออก', () => {
            for (const retired of ['admin', 'super_admin', 'platform_admin', 'account',
                'accountant', 'account_dtam', 'account_platform', 'auditor', 'scheduler',
                'reviewer', 'approver', 'applicant', 'farmer']) {
                expect(rbac.normalizeRole(retired)).toBeNull();
            }
        });

        it('webhook/cron ยังเป็น system — ชื่อเรียกผู้กระทำที่ไม่ใช่คน', () => {
            expect(rbac.normalizeRole('webhook')).toBe('system');
            expect(rbac.normalizeRole('cron')).toBe('system');
        });

        it('ค่าว่าง/ไม่รู้จัก คืน null', () => {
            for (const bad of ['', '   ', null, undefined, 'no_such_role', 'EXECUTIVE']) {
                expect(rbac.normalizeRole(bad)).toBeNull();
            }
        });
    });

    describe('§4.3 สังกัดสามฝั่ง', () => {
        const SIDE = {
            health: 'public',
            document_reviewer: 'certification_body',
            dispatcher: 'certification_body',
            field_inspector: 'certification_body',
            certificate_approver: 'certification_body',
            finance_officer_dtam: 'certification_body',
            system_admin_dtam: 'certification_body',
            finance_officer_platform: 'platform_operator',
            system_admin_platform: 'platform_operator',
            system: 'system',
        };

        it.each(Object.entries(SIDE))('%s อยู่ฝั่ง %s', (role, side) => {
            expect(rbac.roleAffiliation(role)).toBe(side);
        });
    });

    describe('§4.4 ใครเป็นเจ้าหน้าที่', () => {
        it('เจ้าหน้าที่แปดบทบาท — ผู้ขอรับรองและ system ไม่ใช่', () => {
            const staff = EXPECTED_ROLES.filter((r) => r !== 'health' && r !== 'system');
            for (const role of staff) { expect(rbac.isProviderRole(role)).toBe(true); }
            expect(rbac.isProviderRole('health')).toBe(false);
            expect(rbac.isProviderRole('system')).toBe(false);
        });
    });

    describe('§4.7 ไม่มีทางแปลงกลับเป็นคำเก่า', () => {
        it('canonicalToLegacyRole ถูกลบทิ้งแล้ว', () => {
            expect(rbac.canonicalToLegacyRole).toBeUndefined();
        });
    });
});
