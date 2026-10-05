/**
 * รายการบทบาทสำหรับดรอปดาวน์ใน /admin/*
 *
 *   - /admin/users                              ตัวกรอง
 *   - /admin/organizations/create-user-dialog   ตัวเลือกตอนสร้างผู้ใช้
 *   - /admin/communication                      ตัวเลือกกลุ่มผู้รับ
 *
 * ทั้งสามหน้าเคยมีรายการบทบาทของตัวเอง ทำให้บทบาทที่เพิ่มใหม่ตกหล่นไปทีละหน้า
 * ไฟล์นี้จึงเป็นที่เดียวที่รายการอยู่
 *
 * ── `value` กับ `canonical` เป็นคำเดียวกันแล้ว ──────────────────────────────
 *
 * เดิมสองช่องนี้ต่างกันโดยเจตนา: `value` เก็บคำตัวพิมพ์ใหญ่ที่คอลัมน์ในฐานเคยใช้
 * (`ADMIN`, `ACCOUNT_DTAM`) ส่วน `canonical` เก็บคำตัวพิมพ์เล็กที่ RBAC ใช้
 * ตั้งแต่ operator สั่งตัดขาดจากคำเก่า 2026-09-10 ระบบมีคำชุดเดียว — การเก็บสองช่อง
 * ที่ต่างกันจะทำให้ดรอปดาวน์ส่งค่าที่ประตูปฏิเสธด้วย 400
 *
 * ช่อง `canonical` ยังอยู่เพื่อไม่ให้ผู้เรียกทั้งหมดต้องแก้พร้อมกัน และเทส
 * `admin-role-options` ตรึงไว้ว่าสองช่องต้องเท่ากันเสมอ
 *
 * ── สิ่งที่จงใจไม่มีในรายการนี้ ─────────────────────────────────────────────
 *
 * `system_admin_platform` (ผู้ดูแลของบริษัท) ไม่อยู่ในรายการ — เป็นบทบาทข้ามองค์กร
 * ที่ต้องตั้งนอกประตูนี้ (seed/ops) · `routes/api/platform-admin/organizations.js`
 * และ `provider-user-service` ปฏิเสธซ้ำอีกสองชั้น
 */

export interface AdminRoleOption {
    /** คำบทบาทตามที่เก็บในคอลัมน์ role */
    value: string;
    /** ป้ายภาษาไทย */
    label: string;
    /** คำเดียวกับ `value` — คงไว้เพื่อผู้เรียกเดิม */
    canonical: string;
    /**
     * บทบาทที่ไม่ใช่คน (webhook/cron) — ดรอปดาวน์ของคนต้องซ่อนแถวที่ `hidden=true`
     * ค่านี้ถูกตั้งโดยโค้ดเบื้องหลังเท่านั้น เลือกผ่านหน้าจอสร้างผู้ใช้ไม่ได้
     */
    hidden?: boolean;
}

export const ADMIN_ROLE_OPTIONS: ReadonlyArray<AdminRoleOption> = Object.freeze([
    Object.freeze({
        value: 'document_reviewer',
        canonical: 'document_reviewer',
        label: 'ผู้ตรวจเอกสาร',
    }),
    Object.freeze({
        value: 'dispatcher',
        canonical: 'dispatcher',
        label: 'ผู้จัดสรรงานและคิวตรวจ',
    }),
    Object.freeze({
        value: 'field_inspector',
        canonical: 'field_inspector',
        label: 'ผู้ตรวจประเมินแปลง',
    }),
    // ผู้ตัดสินให้การรับรอง (ISO/IEC 17065 §7.6 · F-CERT-SOD 2026-09-10)
    // ถ้าไม่มีแถวนี้ ผู้ดูแลจะแต่งตั้งผู้อนุมัติไม่ได้เลย และไม่มีใครอนุมัติคำขอได้
    Object.freeze({
        value: 'certificate_approver',
        canonical: 'certificate_approver',
        label: 'ผู้อนุมัติใบรับรอง',
    }),
    Object.freeze({
        value: 'finance_officer_dtam',
        canonical: 'finance_officer_dtam',
        label: 'การเงินและบัญชี (กรม)',
    }),
    Object.freeze({
        value: 'finance_officer_platform',
        canonical: 'finance_officer_platform',
        label: 'การเงินและบัญชี (บริษัท)',
    }),
    Object.freeze({
        value: 'system_admin_dtam',
        canonical: 'system_admin_dtam',
        label: 'ผู้ดูแลระบบ (กรม)',
    }),
    Object.freeze({
        value: 'health',
        canonical: 'health',
        label: 'ผู้ขอรับรอง',
    }),
    Object.freeze({
        value: 'system',
        canonical: 'system',
        label: 'ระบบ (อัตโนมัติ ใช้ภายในเท่านั้น)',
        hidden: true,
    }),
] as const);

/**
 * ตัวแปรสำหรับตัวกรองใน /admin/users ที่ต้องมี "ทุกบทบาท" เป็นแถวแรก
 * ไม่รวมแถวที่ซ่อนไว้ เพราะผู้ดูแลไม่ได้ไล่ดูบัญชีของ cron/webhook ผ่านรายชื่อผู้ใช้
 */
export const ADMIN_ROLE_OPTIONS_WITH_ALL_PREFIX: ReadonlyArray<AdminRoleOption> = Object.freeze([
    Object.freeze({
        value: 'ALL',
        canonical: 'all',
        label: 'ทุกบทบาท',
    }),
    ...ADMIN_ROLE_OPTIONS.filter((option) => !option.hidden),
] as const);

/** ตัวแปรสำหรับหน้าสร้างผู้ใช้ — ไม่รวมบทบาทที่ไม่ใช่คน */
export const ADMIN_ROLE_OPTIONS_FOR_NEW_USER: ReadonlyArray<AdminRoleOption> = Object.freeze(
    ADMIN_ROLE_OPTIONS.filter((option) => !option.hidden),
);

/**
 * บทบาทที่ "เพิ่มผู้ใช้ในองค์กร" สร้างได้จริง
 *
 * ประตูคือ POST /api/platform-admin/organizations/:id/users ซึ่งตรวจด้วย z.enum
 * ของ PROVIDER_ROLES_ALLOWED (routes/api/platform-admin/organizations.js:41-49) —
 * ค่าที่ไม่อยู่ในนั้นถูกปฏิเสธด้วย 400 ก่อนถึงฐานข้อมูล ดรอปดาวน์จึงต้องไม่เสนอมัน
 *
 * ที่ตัดออกจากรายการเต็ม และเหตุผล:
 *   health                 ผู้ขอรับรองสมัครเอง ไม่ใช่คนที่ผู้ดูแลเพิ่มเข้าองค์กร
 *   system_admin_platform  บทบาทข้ามองค์กร ตั้งนอกประตูนี้ (seed/ops) — ประตูปฏิเสธซ้ำ
 *   system                 ไม่ใช่คน (hidden อยู่แล้ว)
 *
 * เทส `admin-role-options` อ่านไฟล์หลังบ้านเป็นข้อความและตรึงว่าสองรายการตรงกัน —
 * เพราะรายการที่เพี้ยนจากประตูไม่ได้พังดัง ๆ มันแค่ทำให้ปุ่มบางปุ่มตาย
 */
const ORG_STAFF_EXCLUDED = Object.freeze(['health', 'system_admin_platform']);

export const ADMIN_ROLE_OPTIONS_FOR_ORG_STAFF: ReadonlyArray<AdminRoleOption> = Object.freeze(
    ADMIN_ROLE_OPTIONS_FOR_NEW_USER.filter((option) => !ORG_STAFF_EXCLUDED.includes(option.value)),
);
