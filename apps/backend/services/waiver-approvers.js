'use strict';

/**
 * ผู้ตัดสินคำขออนุโลม (waiver-reopen) — แหล่งเดียวของ "ใครอนุมัติได้ / ใครต้องรู้"
 *
 * operator 2026-09-27 (B) "การเงินได้ทั้งสองฝั่ง": finance_officer_dtam และ
 * finance_officer_platform ตัดสินได้ทั้งคู่ · ทุกสัญญาณของคำขอต้องไปถึงทั้งสองบทบาท:
 *   - แจ้งเตือนคำขอใหม่ (routes/api/provider/waiver-reopen.js)
 *   - ยกระดับ SLA ทุกวัน (jobs/waiver-sla-escalation-job.js)
 *   - งาน WAIVER_APPROVAL ใน inbox /provider/work (candidateGroup = WAIVER_APPROVAL_GROUP)
 *
 * เดิมไฟล์นี้ชื่อ dtam-accountants.js และเลือกเฉพาะการเงินกรม — ชื่อและชุดบทบาทนั้นถูกแทนที่ทั้งตัว
 * RAW DB role values on purpose (User.role is canonical since migration 20260801000000).
 */

const { prisma } = require('./prisma-database');
const { withoutTenantScope } = require('./tenant-context');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { FINANCE_OFFICERS_GROUP } = require('../shared/user-groups');

const WAIVER_APPROVER_DB_ROLES = Object.freeze([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

/** candidateGroup ของงาน WAIVER_APPROVAL — กลุ่มร่วมของการเงินทั้งสองบทบาท (shared/user-groups) */
const WAIVER_APPROVAL_GROUP = FINANCE_OFFICERS_GROUP;

/** ACTIVE, non-deleted waiver approvers (either finance role) of one organization. */
async function listWaiverApproverIds(organizationId) {
    if (!organizationId) { return []; }
    const rows = await withoutTenantScope(() => prisma.user.findMany({
        where: {
            role: { in: [...WAIVER_APPROVER_DB_ROLES] },
            organizationId,
            status: 'ACTIVE',
            isDeleted: false,
        },
        select: { id: true },
    }));
    return rows.map((r) => r.id);
}

/**
 * Live-row verification that `userId` really is an ACTIVE, non-deleted finance
 * officer of `organizationId`, holding `role` on the User row right now
 * (hardening batch 2026-07-09). The JWT asserts a role, but the User row is the
 * record of truth — an officer suspended/demoted via any path that does not stamp
 * sessionsRevokedAt keeps a valid 12h token. Fail-closed: missing args, or a role
 * outside WAIVER_APPROVER_DB_ROLES → false.
 */
async function isActiveWaiverApprover(userId, organizationId, role) {
    if (!userId || !organizationId || !WAIVER_APPROVER_DB_ROLES.includes(role)) { return false; }
    const row = await withoutTenantScope(() => prisma.user.findFirst({
        where: {
            id: userId,
            organizationId,
            role: { in: [role] },
            status: 'ACTIVE',
            isDeleted: false,
        },
        select: { id: true },
    }));
    return Boolean(row);
}

module.exports = {
    WAIVER_APPROVER_DB_ROLES,
    WAIVER_APPROVAL_GROUP,
    listWaiverApproverIds,
    isActiveWaiverApprover,
};
