/**
 * @module shared/user-groups
 *
 * Resolution helpers for the M2M user × role-group model (ADR-016 Phase 1C).
 *
 * Read paths:
 *   - getUserGroups(prisma, userId): canonical group codes the user belongs to.
 *     Falls back to [normalizeRole(user.role)] when the user has no
 *     memberships (e.g. fresh signup before ops adds them to groups).
 *   - userInGroup(prisma, userId, groupCode): O(1) check used by claim/route guards.
 *   - listGroupMemberUserIds(prisma, organizationId, groupCode): "everyone in
 *     group X for tenant Y" — used by notification dispatch + queue UIs.
 *
 * Write paths (admin-only) live in routes/api/provider/admin/user-groups.js.
 *
 * Backward-compatible note: User.role stays. New code that wants to
 * "find users with role X in tenant T" should call listGroupMemberUserIds
 * instead of doing prisma.user.findMany({ where: { role, ... } }) — that
 * older query misses users whose primary role is something else but who
 * also belong to group X via memberships.
 */

'use strict';

const { normalizeRole, CANONICAL_ROLES } = require('./canonical-rbac');

/**
 * กลุ่มประกอบ (composite group) — รหัสกลุ่มที่สมาชิกคือทุกคนที่อยู่ในกลุ่มย่อยใดกลุ่มหนึ่ง
 * ไม่มีแถวในตาราง role_groups · ใช้กับงานที่ "บทบาทใดก็ได้ในชุดนี้" รับได้ โดยไม่ต้องทำงานซ้ำ
 * หนึ่งชิ้นต่อบทบาท (inbox มี partial unique หนึ่งงานเปิดต่อ (คำขอ, ชนิดงาน, stage))
 *
 * finance_officers — การเงินทั้งสองบทบาท: งาน WAIVER_APPROVAL (operator 2026-09-27 (B)
 * "การเงินได้ทั้งสองฝั่ง")
 */
const FINANCE_OFFICERS_GROUP = 'finance_officers';
const COMPOSITE_GROUPS = Object.freeze({
    [FINANCE_OFFICERS_GROUP]: Object.freeze([
        CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
        CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    ]),
});

function withCompositeGroups(codes) {
    const out = [...codes];
    for (const [composite, members] of Object.entries(COMPOSITE_GROUPS)) {
        if (!out.includes(composite) && members.some((m) => out.includes(m))) { out.push(composite); }
    }
    return out;
}

// In-memory cache of role-group code → id, populated lazily.
//
// เดิมคอมเมนต์ตรงนี้เขียนว่าทะเบียน "never edited at runtime" จึงไม่ต้อง invalidate —
// ข้อนั้นเลิกจริงตั้งแต่ใบ 20260910120000_rename_role_vocabulary ซึ่ง "เปลี่ยนคำในแถวเดิม"
// (auditor → field_inspector) โดยตั้งใจ เพื่อให้สมาชิกกลุ่มตามไปด้วย ⇒ process ที่ warm
// cache ไว้ก่อน migration จะถือคำชุดเก่าไปตลอดอายุของมัน
//
// วัดจริงแล้วว่าเกิดอะไรขึ้น (evidence/role-vocabulary-rehearsal-2026-09-10/cache-probe.txt):
// process ที่ไม่ได้รีสตาร์ตคืนรายชื่อสมาชิกสั้นกว่าความจริงหนึ่งคน — คนที่อยู่ในกลุ่มด้วย
// การเป็นสมาชิก แต่บทบาทหลักเป็นคำอื่น (ทางที่สองคือ fallback ด้วย users.role จึงไม่ช่วย)
// ไม่มี exception ไม่มี log — แค่คนหายไปจากรายชื่อผู้รับแจ้งเตือนและจากคิว
let _groupIdByCode = null;

async function loadGroupIdMap(prisma) {
    if (_groupIdByCode) {return _groupIdByCode;}
    const rows = await prisma.roleGroup.findMany({
        where: { isActive: true },
        select: { id: true, code: true },
    });
    _groupIdByCode = Object.fromEntries(rows.map((r) => [r.code, r.id]));
    return _groupIdByCode;
}

function clearCache() {
    _groupIdByCode = null;
}

/**
 * code → id โดยไม่เชื่อ cache เป็นคำตอบสุดท้ายเมื่อหาไม่เจอ
 *
 * cache ที่ไม่มี code นี้ ไม่ได้แปลว่าไม่มีกลุ่มนี้ในทะเบียน — แปลได้อีกทางว่า cache
 * ถูกสร้างตอนทะเบียนยังใช้คำอีกชุดหนึ่ง · ถามทะเบียนตรง ๆ หนึ่งครั้ง (index บน code)
 * ถูกกว่าการคืนรายชื่อที่สั้นกว่าความจริงโดยไม่มีใครรู้ · เจอแล้วจำไว้ ⇒ ราคาเกิดครั้งเดียว
 */
async function resolveGroupId(prisma, code) {
    if (!code) {return undefined;}
    const map = await loadGroupIdMap(prisma);
    if (map[code]) {return map[code];}

    const row = await prisma.roleGroup.findFirst({
        where: { code, isActive: true },
        select: { id: true },
    });
    if (row?.id) {
        map[code] = row.id;
        return row.id;
    }
    return undefined;
}

async function getUserGroups(prisma, userId) {
    if (!userId) {return [];}
    const memberships = await prisma.userGroupMembership.findMany({
        where: { userId, isActive: true },
        select: { group: { select: { code: true, isActive: true } } },
    });
    const codes = memberships
        .filter((m) => m.group?.isActive)
        .map((m) => m.group.code);

    if (codes.length > 0) {
        return withCompositeGroups(codes);
    }

    // Fallback to legacy User.role for users without memberships.
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
    });
    const canonical = normalizeRole(user?.role);
    return canonical ? withCompositeGroups([canonical]) : [];
}

async function userInGroup(prisma, userId, groupCode) {
    if (!userId || !groupCode) {return false;}
    const target = normalizeRole(groupCode) || groupCode;

    // Admin shortcut: if the user is in the admin group (via membership
    // OR via legacy User.role), grant access to every group.
    const groups = await getUserGroups(prisma, userId);
    if (groups.includes(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM)) {return true;}
    return groups.includes(target);
}

async function listGroupMemberUserIds(prisma, organizationId, groupCode) {
    if (!organizationId || !groupCode) {return [];}
    if (COMPOSITE_GROUPS[groupCode]) {
        const lists = await Promise.all(COMPOSITE_GROUPS[groupCode]
            .map((member) => listGroupMemberUserIds(prisma, organizationId, member)));
        return Array.from(new Set(lists.flat()));
    }
    const target = normalizeRole(groupCode) || groupCode;

    // 1) Members via the M2M memberships
    const groupId = await resolveGroupId(prisma, target);
    let memberRows = [];
    if (groupId) {
        memberRows = await prisma.userGroupMembership.findMany({
            where: {
                groupId,
                organizationId,
                isActive: true,
                user: { isDeleted: false, isLocked: false },
            },
            select: { userId: true },
        });
    }

    // 2) Plus any user whose User.role still matches and who has no
    //    membership row yet — defensive fallback for new users created
    //    before being added to a group.
    //
    //    Migration 20260801000000_canonicalize_user_role made User.role
    //    CANONICAL (lowercase, alias-collapsed), and the four writers were
    //    flipped to canonical in the same phase, so `target` is exactly the
    //    value stored in the column. This filter was widened to accept the
    //    legacy spelling too while rows of both existed; the production run
    //    reported zero legacy rows remaining, so the second spelling can only
    //    ever match nothing and is gone.
    let fallbackRows = [];
    if (target) {
        fallbackRows = await prisma.user.findMany({
            where: {
                organizationId,
                role: target,
                isDeleted: false,
                isLocked: false,
            },
            select: { id: true },
        });
    }

    const seen = new Set();
    for (const r of memberRows) {seen.add(r.userId);}
    for (const r of fallbackRows) {seen.add(r.id);}
    return Array.from(seen);
}

/**
 * Convenience: full picture for one user — primary role from User.role
 * plus the canonical group codes from memberships, deduped.
 */
async function describeUserAccess(prisma, userId) {
    if (!userId) {return { primaryRole: null, groups: [] };}
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
    });
    const groups = await getUserGroups(prisma, userId);
    return {
        primaryRole: normalizeRole(user?.role),
        groups,
    };
}

module.exports = {
    FINANCE_OFFICERS_GROUP,
    COMPOSITE_GROUPS,
    getUserGroups,
    userInGroup,
    listGroupMemberUserIds,
    describeUserAccess,
    clearCache,
};
