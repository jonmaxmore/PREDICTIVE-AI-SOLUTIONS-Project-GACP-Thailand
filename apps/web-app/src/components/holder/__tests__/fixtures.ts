import type { EntityMembership } from '@/lib/services/my-entities-provider';

export function entity(over: Partial<EntityMembership> & { id: string }): EntityMembership {
    return {
        type: 'JURISTIC',
        displayName: 'บริษัท สมุนไพรไทย จำกัด',
        slug: null,
        role: 'OWNER',
        membershipStatus: 'ACTIVE',
        isPersonal: false,
        organizationId: 'org-1',
        permissions: [],
        can: { edit: true, submit: true, createFarm: true },
        ...over,
    };
}

export const PERSONAL = entity({
    id: 'e-personal', type: 'INDIVIDUAL', displayName: 'สมชาย ใจดี', isPersonal: true,
});
export const COMPANY = entity({ id: 'e-company' });
export const COMMUNITY = entity({
    id: 'e-community', type: 'COMMUNITY_ENTERPRISE', displayName: 'วิสาหกิจชุมชนบ้านสวน', role: 'MANAGER',
    can: { edit: true, submit: false, createFarm: false },
});
export const VIEWER = entity({
    id: 'e-viewer', displayName: 'ห้างหุ้นส่วนดูอย่างเดียว', role: 'VIEWER',
    can: { edit: false, submit: false, createFarm: false },
});

/** Words and symbols no holder surface may print (operator ruling: no workspace, no emoji). */
export const FORBIDDEN_COPY = /workspace|พื้นที่ทำงาน|\p{Extended_Pictographic}/iu;
