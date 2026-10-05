/**
 * Application visibility filter (Wave A Phase 19, G4 partial).
 *
 * Returns a Prisma `where` fragment that constrains which Applications a
 * given user is allowed to see — a row-level read filter for the
 * application table.
 *
 * CONTRACT (H17, 2026-08-23): **an absent scope means DENY.** Every canonical
 * role must land in exactly one of the three buckets below; a role that lands
 * in none gets `DENY_ALL`. Before H17 this function fell through to
 * `return null` for every role it had not explicitly narrowed, and
 * `withVisibility()` reads `null` as "no additional constraint" — so
 * "no scope defined for this role" silently meant "read the whole table".
 * That is how ACCOUNT / SCHEDULER (and any future role) could pull ANY
 * application by raw id, applicant national ID and address included, through
 * `GET /provider/applications/:id`, `…/:id/activities` and
 * `…/:id/audit-timelines`.
 *
 * The three buckets:
 *
 *   1. UNRESTRICTED — `admin`, `platform_admin`. The tenant operator (and its
 *      cross-tenant superset, ADR-014). ADMIN holds every permission
 *      (canonical-rbac.js:232-235) and is the documented override on every
 *      workflow edge, so narrowing it here would break the admin surfaces that
 *      legitimately span the tenant.
 *
 *   2. ASSIGNMENT-SCOPED — `auditor`, `document_reviewer`. Unchanged: each
 *      sees only the applications assigned to it.
 *
 *   3. WORK-POOL-SCOPED — `scheduler`, `account`, `account_dtam`,
 *      `account_platform`. These roles do work a tenant-wide pool, but only a
 *      *slice* of the lifecycle. The slice is DERIVED, not hand-listed: it is
 *      the set of states named by that role's own rows in `ROLE_TRANSITIONS`
 *      (services/workflow-transition-service.js:99-139) — the states it can
 *      move an application out of, plus the states it can move one into:
 *        · scheduler → DOC_FEE_PAID, ASSIGNED_FOR_REVIEW, AUDIT_FEE_PAID,
 *          AUDIT_CONFIRMED (assign-reviewer + confirm-audit)
 *        · การเงิน   → PENDING_DOC_FEE, DOC_FEE_PAID, PENDING_AUDIT_FEE,
 *          AUDIT_FEE_PAID — หน้าต่างการชำระเงินที่เขาดูแล · **ข้อยกเว้นเดียวของถังนี้ที่
 *          ไม่ได้ derive** เพราะการเงินไม่มีขาใน ROLE_TRANSITIONS แล้ว (สลิปปลดระวาง
 *          2026-09-11 — webhook เป็นผู้ตัดสถานะ) เหตุผลเต็มอยู่ที่ FINANCE_READ_WINDOW
 *      Deriving from the SSOT means a new role edge widens the read scope in
 *      lock-step, and nothing widens it silently. Neither role loses its own
 *      product surface: the scheduler dashboard queries directly
 *      (scheduler-dashboard-handler.js:28-46) and the accounting surfaces are
 *      the finance routes (routes/api/finance/*) — neither passes through this
 *      filter — and the frontend does not admit either role to
 *      /provider/applications at all (web-app/src/lib/provider-role-config.ts:87).
 *
 *   Everything else (`health`, `system`, any future or unmapped role) →
 *   DENY_ALL.
 *
 * NOTE: do NOT assume DB-level tenant RLS backstops this filter — on current
 * main the RLS policy is observe-only (permissive) and org read-scoping is
 * flag-gated off, so any cross-organization narrowing that must hold today has
 * to be expressed HERE.
 *
 * Usage:
 *
 *   const { applicationVisibilityFilter } = require('../shared/application-visibility');
 *   const visibility = applicationVisibilityFilter(req.user);
 *   const where = visibility ? { AND: [baseWhere, visibility] } : baseWhere;
 *   const app = await prisma.application.findFirst({ where, select: ... });
 */

'use strict';

const { CANONICAL_ROLES, normalizeRole } = require('./canonical-rbac');
const { ROLE_TRANSITIONS } = require('../services/workflow-transition-service');

/**
 * A `where` no row can satisfy. Used wherever the answer is "this caller has
 * no business reading applications through this surface". Callers turn an
 * empty result into 404 (never 403), so existence is not leaked either.
 */
const DENY_ALL = Object.freeze({ id: '__no_application_scope__' });

/** Bucket 1 — tenant operator roles that legitimately read everything. */
const UNRESTRICTED_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
]);

/** Bucket 3 — tenant-wide work-pool roles, sliced by their own workflow edges. */
const WORK_POOL_ROLES = new Set([
    // ผู้ตัดสินให้การรับรอง (F-CERT-SOD 2026-09-10) — ต้องเห็นคำขอที่รอการตัดสิน
    // ทั้งหน่วยงาน ไม่ใช่เฉพาะที่มอบหมายให้ตัวเอง เพราะงานของเขาคือตัดสินคำขอที่
    // **คนอื่น** เป็นผู้ประเมิน · สไลซ์ได้มาจาก ROLE_TRANSITIONS ของเขาเอง
    // (AUDIT_PASSED / APPROVED / CERTIFIED) เหมือนทุก role ในถังนี้ — ไม่มีรายชื่อ
    // สถานะเขียนมือ ⇒ ขอบเขตการอ่านขยับตามขาที่เขาเดินได้จริงเสมอ
    //
    // ถ้าไม่มีบรรทัดนี้ ด่านที่ contract ข้างบนบอกว่า "ไม่มีสโคป = ปฏิเสธ" จะทำงาน
    // ตรงตามที่เขียนไว้: ผู้อนุมัติมองไม่เห็นอะไรเลย และคิวอนุมัติจะว่างตลอดกาล
    CANONICAL_ROLES.CERTIFICATE_APPROVER,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

/**
 * หน้าต่างการอ่านของฝ่ายการเงิน — **ประกาศไว้ตรงนี้ ไม่ได้ derive**
 *
 * ทุก role ในถังนี้ได้สไลซ์มาจากขาใน `ROLE_TRANSITIONS` ของตัวเอง ซึ่งใช้ได้ตราบที่
 * role นั้นมีขา · การเงินไม่มีขาแล้วตั้งแต่สลิปถูกปลดระวาง 2026-09-11 (webhook เป็น
 * ผู้ตัดสถานะ ไม่มีมนุษย์อนุมัติการชำระเงิน) ⇒ การ derive จะคืนชุดว่าง = ปฏิเสธทุกอย่าง
 * และเจ้าหน้าที่การเงินจะมองไม่เห็นคำขอที่ตัวเองต้องกระทบยอด
 *
 * ทำไมไม่ derive จาก SSOT ของเงินแทน: `PAYABLE_STATES` (stripe-checkout-service) กับ
 * `SETTLED_TARGET_STATE` (checkout-settlement-service) รวมกันได้หกสถานะ — **กว้างกว่า
 * ของเดิมสองสถานะ** (SUBMITTED, DOC_APPROVED) · การขยายขอบเขตการอ่านคือการเพิ่มอำนาจ
 * และต้องเป็น diff ที่คนเห็น ไม่ใช่ผลข้างเคียงของการเปลี่ยนวิธีคำนวณ
 *
 * ⇒ สี่สถานะนี้คือหน้าต่างเดิมเป๊ะ ๆ: สองสถานะที่ยังค้างชำระ และสองสถานะที่เพิ่งชำระ
 * ด่าน `application-visibility` ตรึงทั้งรายการไว้ การเพิ่มสถานะจึงต้องแก้เทสด้วย
 */
const FINANCE_READ_WINDOW = Object.freeze([
    'PENDING_DOC_FEE',
    'DOC_FEE_PAID',
    'PENDING_AUDIT_FEE',
    'AUDIT_FEE_PAID',
]);

const FINANCE_ROLES = Object.freeze(new Set([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]));

/**
 * The lifecycle states a work-pool role may see: every state named on either
 * side of one of its `ROLE_TRANSITIONS` edges ("FROM->TO").
 *
 * @param {string} role canonical role
 * @returns {string[]} status codes (possibly empty)
 */
function workPoolStatuses(role) {
    if (FINANCE_ROLES.has(role)) {
        return [...FINANCE_READ_WINDOW];
    }
    const edges = ROLE_TRANSITIONS[role];
    if (!edges) {
        return [];
    }
    const states = new Set();
    for (const edge of edges) {
        const [from, to] = String(edge).split('->');
        if (from) {
            states.add(from);
        }
        if (to) {
            states.add(to);
        }
    }
    return [...states];
}

/**
 * @param {{ id?: string, canonicalRole?: string, role?: string }} user
 * @returns {object | null}  A Prisma `where` fragment, or null ONLY for the
 *   unrestricted roles (bucket 1). Never null as a fall-through.
 */
function applicationVisibilityFilter(user) {
    if (!user) {
        // Defensive: no user = caller must have already auth-gated.
        // Returning null here would silently broaden the query, so we
        // return an impossible filter to fail closed.
        return { id: '__no_user__' };
    }

    const role = normalizeRole(user.canonicalRole || user.role);
    const userId = user.id;

    if (!role) {
        // Unmapped or missing role — no scope, therefore no read.
        return DENY_ALL;
    }

    if (UNRESTRICTED_ROLES.has(role)) {
        return null;
    }

    // AUDITOR — sees only the applications it is assigned to.
    // Wave A Phase 44 (drift unwind Phase C): check only the canonical role
    // columns (Phase 42/43). The sameReviewerAuditor branch covers the
    // legitimate cross-role case where an auditor was the document reviewer
    // earlier in the same workflow (scheduler-assign-reviewer-handler.js).
    if (role === CANONICAL_ROLES.FIELD_INSPECTOR) {
        if (!userId) {
            // An auditor without a User.id can't have any assignments —
            // fail closed so the API doesn't leak.
            return { id: '__no_user_id__' };
        }
        return {
            OR: [
                { auditorId: userId },
                { headAuditorId: userId },
                // 2026-09-05 — พบจากการเดินฝั่งพนักงานจริง: รายชื่อผู้ตรวจเอกสารที่ผู้จัดตาราง
                // เลือกได้ **ตั้งใจ** รวมผู้ตรวจแปลงไว้ด้วย (scheduler-assign-reviewer-handler.js
                // reviewerRoles = [DOCUMENT_REVIEWER, AUDITOR]) · แต่การมอบหมายเขียนแค่
                // `reviewerId` และปล่อยธง sameReviewerAuditor เป็น false — ธงนั้นแปลว่า
                // "คนเดียวกันทำทั้งสองบทบาทของคำขอนี้" ซึ่งยังไม่จริง ณ เวลามอบหมาย
                // ⇒ งานถูกมอบหมายให้คนที่มองไม่เห็นมัน เปิดได้ก็ต่อเมื่อรู้ id
                //
                // กฎเดียวกับสาขา DOCUMENT_REVIEWER ข้างล่าง: "คุณเห็นสิ่งที่มอบหมายให้คุณ"
                // รั่วไม่ได้ เพราะมันแสดงคำขอให้เฉพาะคนที่ถูกมอบหมายเท่านั้น และธงยังคง
                // หมายความตามชื่อของมัน ไม่ได้ถูกแตะ
                { reviewerId: userId },
                {
                    AND: [
                        { sameReviewerAuditor: true },
                        { reviewerId: userId },
                    ],
                },
            ],
        };
    }

    // DOCUMENT_REVIEWER — sees only the applications assigned to it for review.
    // Mirrors the reviewer dashboard's own-assignment scope (reviewer.js:40-43):
    // canonical `reviewerId` column first + the legacy
    // `formData.PROVIDERAssignment.reviewerId` fallback for pre-backfill rows
    // (the assign-reviewer handler writes BOTH). Without this branch the GENERAL
    // surfaces (`GET /provider/applications` list/queue/:id/activities) leaked the
    // entire tenant pipeline — other reviewers' + audit-phase cases + applicant
    // PII (email/phone) + workflow history — even though the dashboard was scoped.
    // (Function-level APPLICATION_VIEW_ALL is unchanged; this is the ERP-style
    // data-security layer the function permission lacked.)
    if (role === CANONICAL_ROLES.DOCUMENT_REVIEWER) {
        if (!userId) {
            return { id: '__no_user_id__' };
        }
        return {
            OR: [
                { reviewerId: userId },
                { formData: { path: ['PROVIDERAssignment', 'reviewerId'], equals: userId } },
            ],
        };
    }

    // SCHEDULER / ACCOUNT* — tenant-wide but lifecycle-sliced (bucket 3). A
    // role whose ROLE_TRANSITIONS row is missing or empty gets nothing rather
    // than everything.
    if (WORK_POOL_ROLES.has(role)) {
        const statuses = workPoolStatuses(role);
        if (statuses.length === 0) {
            return DENY_ALL;
        }
        return { status: { in: statuses } };
    }

    // health / system / anything unmapped — no application-read scope here.
    // Applicants read their own applications through the health-side routes
    // (routes/api/applications/*), which do not use this filter.
    return DENY_ALL;
}

/**
 * Convenience: combine the visibility filter with a base where clause
 * using AND. If no constraint applies, returns the base unchanged.
 *
 * @param {object} baseWhere
 * @param {{ canonicalRole?: string, providerId?: string | null }} user
 * @returns {object}
 */
function withVisibility(baseWhere, user) {
    const v = applicationVisibilityFilter(user);
    if (!v) {
        return baseWhere;
    }
    return { AND: [baseWhere, v] };
}

module.exports = {
    applicationVisibilityFilter,
    withVisibility,
    DENY_ALL,
    // ส่งออกเพื่อให้ด่านตรึงรายการได้ — การเพิ่มสถานะเข้าหน้าต่างนี้คือการเพิ่มอำนาจอ่าน
    FINANCE_READ_WINDOW,
};
