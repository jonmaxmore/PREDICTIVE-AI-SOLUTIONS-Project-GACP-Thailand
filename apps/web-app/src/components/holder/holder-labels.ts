/**
 * The words the holder surfaces use (spec 2026-09-30-remove-workspace-mode §3.6).
 * One place, so the picker, the chip, the lists and the workspaces page say the
 * same thing about the same entity.
 */
import type { EntityMembership } from '@/lib/services/my-entities-provider';

export const HOLDER_COPY_TH = Object.freeze({
    title: 'ยื่นในนาม',
    help: 'ใบรับรองจะออกในนามที่คุณเลือก และเปลี่ยนภายหลังไม่ได้',
    addEntityLink: 'เพิ่มนิติบุคคลหรือวิสาหกิจชุมชน',
    editNotSubmit: 'คุณกรอกคำขอในนามนี้ได้ แต่ผู้มีสิทธิ์ยื่นต้องเป็นผู้กดยื่น',
    viewerOnly: 'คุณมีสิทธิ์ดูอย่างเดียวในนามนี้',
    chipHint: 'ถ้าเลือกผิด ให้ลบฉบับร่างนี้แล้วเริ่มคำขอใหม่',
    restart: 'ลบฉบับร่างนี้แล้วเริ่มใหม่',
    restartConfirm: 'ยืนยันลบฉบับร่าง',
    restartCancel: 'ไม่ลบ',
    restartFailed: 'ลบฉบับร่างไม่สำเร็จ ฉบับร่างและผู้ถือยังเหมือนเดิม ลองอีกครั้ง',
    all: 'ทั้งหมด',
    column: 'ยื่นในนาม',
    farmTitle: 'ลงทะเบียนในนาม',
    farmHelp: 'สถานที่ปลูกจะอยู่ในนามที่คุณเลือก',
    noFarmRight: 'คุณไม่มีสิทธิ์เพิ่มสถานที่ปลูกในนามนี้',
    noHolderForFile: 'คุณยังไม่มีสิทธิ์กรอกคำขอในนามใดเลย ติดต่อผู้ดูแลของนิติบุคคลหรือวิสาหกิจชุมชนที่คุณเป็นสมาชิก',
    noHolderForFarm: 'คุณยังไม่มีสิทธิ์เพิ่มสถานที่ปลูกในนามใดเลย ติดต่อผู้ดูแลของนิติบุคคลหรือวิสาหกิจชุมชน',
});

/** Where the create page sends the user back to the application (Task 14 hand-off). */
export const ADD_ENTITY_HREF = '/health/workspaces/new?from=application';

const TYPE_LINE_TH: Record<EntityMembership['type'], string> = {
    INDIVIDUAL: 'บุคคลธรรมดา',
    JURISTIC: 'นิติบุคคล',
    COMMUNITY_ENTERPRISE: 'วิสาหกิจชุมชน',
};

const PERSONAL_LINE_TH = 'ตัวคุณเอง (บุคคลธรรมดา)';

export function holderTypeLine(e: Pick<EntityMembership, 'type' | 'isPersonal'>): string {
    return e.isPersonal ? PERSONAL_LINE_TH : TYPE_LINE_TH[e.type];
}

export const ROLE_LINE_TH: Record<EntityMembership['role'], string> = {
    OWNER: 'เจ้าของ',
    ADMIN: 'ผู้ดูแล',
    MANAGER: 'ผู้จัดการ',
    VIEWER: 'ผู้ดู',
};

/** Active memberships only, the personal holder first, then by name. */
export function orderHolders(entities: readonly EntityMembership[]): EntityMembership[] {
    return entities
        .filter((e) => e.membershipStatus === 'ACTIVE')
        .slice()
        .sort((a, b) => Number(b.isPersonal) - Number(a.isPersonal) || a.displayName.localeCompare(b.displayName, 'th'));
}
