/**
 * personal-workspace-copy.ts — pure, SSR-safe copy helpers for the
 * workspace members page (design-cleanup-2026-08-21 W8).
 *
 * Item 2 of the brief: when the entity is INDIVIDUAL (a person doing
 * cannabis as a side business, farm in their own name — NOT a registered
 * company), the members page must not talk as if the user runs an
 * organisation. The role one-liners below are DERIVED from the REAL
 * default capability sets in apps/backend/services/entity-service.js —
 * not invented:
 *
 *   ADMIN   defaults: entity-service.js:187-197 — SUBMIT_APPLICATION,
 *           PRINT_QR, EDIT_FARM, INVITE_MEMBER, REVOKE_MEMBER,
 *           VIEW_FINANCIAL, EDIT_ENTITY_PROFILE + every farm-operation code.
 *   MANAGER defaults: entity-service.js:204-207 — PRINT_QR +
 *           MANAGER_FARM_OPERATIONS (entity-service.js:155-161, which is
 *           FARM_OPERATION_CAPABILITIES minus FARM_CREATE/EDIT_FARM minus
 *           SUBMIT_APPLICATION). MANAGER explicitly EXCLUDES
 *           SUBMIT_APPLICATION (NOT_A_ROLE_DEFAULT, entity-service.js:149,
 *           "MANAGER can fill the wizard / save drafts but not submit")
 *           and VIEW_FINANCIAL / INVITE_MEMBER / REVOKE_MEMBER (never
 *           present in MANAGER's bundle, entity-service.js:204-207).
 *   VIEWER  defaults: entity-service.js:208 — empty array (no write
 *           capability by default; read-only).
 *
 * Kept pure (no React) so the test suite can assert the copy without
 * booting the client island — same convention as
 * member-permission-matrix-logic.ts in this same directory.
 */

export type EntityType = 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE';
export type InvitableRole = 'ADMIN' | 'MANAGER' | 'VIEWER';

/**
 * entity.type === INDIVIDUAL means this is a person's own farm (the
 * operator's case: grows cannabis as a side business, owns the farm in
 * their own name) — not a registered organisation. Used to switch the
 * page's copy register, independent of which member is viewing.
 */
export function isPersonalEntity(entityType: EntityType | null | undefined): boolean {
    return entityType === 'INDIVIDUAL';
}

/**
 * One-line, operator-facing explanation of what each invitable role can
 * and cannot do. Every clause below is backed by the capability arrays
 * cited in the module doc above — see personal-workspace-copy.test.ts's
 * cross-check against a mirrored copy of those same arrays.
 */
export const ROLE_CAPABILITY_SUMMARY_TH: Record<InvitableRole, string> = {
    ADMIN: 'ทำแทนเจ้าของได้เกือบทุกอย่าง รวมถึงยื่นคำขอ เชิญ/ถอนสิทธิ์สมาชิก และดูข้อมูลการเงิน',
    MANAGER: 'บันทึกการปลูกและเก็บเกี่ยวแทนได้ แต่ยื่นคำขอและดูข้อมูลการเงินไม่ได้',
    VIEWER: 'ดูข้อมูลได้อย่างเดียว บันทึกหรือแก้ไขอะไรไม่ได้',
};

/** SummaryHeader eyebrow — personal farms are not a "Workspace". */
export function eyebrowFor(personal: boolean): string {
    return personal ? 'ฟาร์มของฉัน · ทีมงาน' : 'ผู้ขอรับรอง · Workspace';
}

/** SummaryHeader description line — swaps "จัดการสมาชิก" org-copy for personal-farm copy. */
export function descriptionFor(personal: boolean, roleLabelTH: string): string {
    return personal
        ? `จัดการคนที่คุณให้ช่วยบันทึกงานในฟาร์ม · บทบาทของคุณ: ${roleLabelTH}`
        : `จัดการสมาชิก · บทบาทของคุณ: ${roleLabelTH}`;
}
