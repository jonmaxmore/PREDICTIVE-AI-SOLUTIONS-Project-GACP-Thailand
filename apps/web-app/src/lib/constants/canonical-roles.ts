/**
 * คำศัพท์บทบาทฝั่งเว็บ — ต้องตรงกับ apps/backend/shared/canonical-rbac.js เป๊ะ ๆ
 *
 * โมเดลสามฝั่ง (operator 2026-09-10):
 *
 *   ผู้รับบริการ   health
 *   กรม            document_reviewer · dispatcher · field_inspector ·
 *                  certificate_approver · finance_officer_dtam · system_admin_dtam
 *   บริษัท         finance_officer_platform · system_admin_platform
 *
 * **ตัดขาดจากคำเก่า** — ไม่มีคีย์ deprecated ไม่มี alias ของคำเก่า (operator วันเดียวกัน:
 * "เลิกใช้ของเก่า รวมถึงการพูดถึงของเก่า" และ "ลบคำเก่าออกไปเลยก็ได้ เพราะกันการสับสน
 * เวลาเราไปทำบนเซิร์ฟเวอร์โปรดักชันในอนาคต")
 *
 * ด่านที่ตรึงให้สองไฟล์ตรงกัน: `apps/backend/__tests__/unit/role-vocabulary-three-sides.test.js`
 * (อ่านไฟล์นี้จริงทั้งไฟล์ ไม่ได้เทียบจากความจำ)
 */

export const CANONICAL_ROLES = {
    /**
     * ผู้ขอรับรอง — **คำนี้ห้ามเปลี่ยน** เพราะอ้างอิงหมอพร้อม (Health ID)
     * ที่กระทรวงสาธารณสุขบังคับให้เชื่อมต่อในอนาคต
     */
    HEALTH: 'health',

    /** กรม */
    DOCUMENT_REVIEWER: 'document_reviewer',
    DISPATCHER: 'dispatcher',
    FIELD_INSPECTOR: 'field_inspector',
    CERTIFICATE_APPROVER: 'certificate_approver',
    FINANCE_OFFICER_DTAM: 'finance_officer_dtam',
    SYSTEM_ADMIN_DTAM: 'system_admin_dtam',

    /** บริษัท — `system_admin_platform` เป็นบทบาทเดียวที่ข้ามองค์กรได้ */
    FINANCE_OFFICER_PLATFORM: 'finance_officer_platform',
    SYSTEM_ADMIN_PLATFORM: 'system_admin_platform',

    /** ไม่ใช่คน — webhook / cron */
    SYSTEM: 'system',
} as const;

export type CanonicalRole = typeof CANONICAL_ROLES[keyof typeof CANONICAL_ROLES];

/**
 * ตัวปรับค่าให้เป็นคำมาตรฐาน — รับเฉพาะคำปัจจุบัน
 *
 * ไม่มี alias ของคำเก่าอีกต่อไป (operator 2026-09-10: "เลิกใช้ของเก่า รวมถึงการพูดถึง
 * ของเก่า") · normalizeRole ตัดช่องว่างและแปลงเป็นตัวพิมพ์เล็กก่อนค้น คีย์จึงเป็น
 * ตัวพิมพ์เล็กทั้งหมด — ต้องตรงกับ ROLE_ALIASES ฝั่งหลังบ้านเป๊ะ ๆ
 */
export const ROLE_ALIASES: Record<string, CanonicalRole> = {
    health: 'health',
    document_reviewer: 'document_reviewer',
    dispatcher: 'dispatcher',
    field_inspector: 'field_inspector',
    certificate_approver: 'certificate_approver',
    finance_officer_dtam: 'finance_officer_dtam',
    system_admin_dtam: 'system_admin_dtam',
    finance_officer_platform: 'finance_officer_platform',
    system_admin_platform: 'system_admin_platform',
    system: 'system',
};

export function normalizeRole(role: string | null | undefined): CanonicalRole | null {
    const key = String(role || '').trim().toLowerCase();
    return key ? (ROLE_ALIASES[key] ?? null) : null;
}

/** บทบาทที่ถือว่าเป็นเจ้าหน้าที่ — ทั้งของกรมและของบริษัท */
export const PROVIDER_ROLES = new Set<CanonicalRole>([
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.CERTIFICATE_APPROVER,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
]);

/** หน้าที่ถามว่า "คนนี้เป็นฝ่ายบัญชีไหม" ให้ใช้ชุดนี้ ไม่ใช่เทียบทีละคำ */
export const ACCOUNT_ROLES = new Set<CanonicalRole>([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

/**
 * ขอบเขตหน้าบัญชี (/provider/accounting) — ไม่มี "ฝั่ง" แล้ว
 *
 * operator 2026-09-11: "finance ต้องเห็นเหมือนกัน ... ตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน
 * เพื่อแสดงความโปร่งใส" · operator 2026-09-27: "กรมฯ ดูอย่างเดียว" — การเงินกรมเห็นทุกอย่าง
 * ที่การเงินบริษัทเห็น แต่ไม่มีอำนาจเขียนบัญชี (บริษัทเป็นผู้ออกเอกสารรายเดียว)
 *
 * เดิมที่นี่คือ getAccountSide() ซึ่งแยกการเงินสองบทบาทเป็น 'DTAM' / 'PLATFORM' เพื่อตั้ง
 * หัวข้อหน้า ซ่อนแท็บ และบังคับ bookSide — แนวคิดนั้นถูกลบทั้งตัว เหลือสามคำถามที่หน้าจอ
 * ต้องถามจริง ๆ และแต่ละชุดตรงกับด่านฝั่งหลังบ้าน
 */

/**
 * อ่านหน้าบัญชีได้ — ตรงกับชุดอ่านของทุก service การเงินฝั่งหลังบ้าน (READ_ROLES ของ
 * purchase-invoice / refund / credit-note / debit-note / wht · ALLOWED_ROLES ของ reports /
 * tax-reports / customer-reports) · ผู้ตรวจประเมินไม่อ่านเรื่องเงิน (operator 2026-09-27)
 * ชุดเดียวที่ทุกหน้าบัญชีใช้ — ตรึงโดย apps/backend/__tests__/unit/finance-fix1-hygiene.test.js
 */
export const ACCOUNTING_READ_ROLES: ReadonlySet<CanonicalRole> = new Set<CanonicalRole>([
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

/**
 * เขียนบัญชี — ปิดงวด · สมุดรายวันทั่วไป · บันทึก ทบ.50 ทวิ · ใบกำกับภาษีซื้อ · คืนเงิน
 * ตรงกับ WRITE_ROLES / CREATE_ROLES / CLOSE_ROLES ฝั่งหลังบ้าน (การเงินบริษัท + ผู้ดูแลระบบกรม)
 */
export const ACCOUNTING_WRITE_ROLES: ReadonlySet<CanonicalRole> = new Set<CanonicalRole>([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
]);

/** ออกใบเสร็จ · ระงับ/ปลดระงับใบแจ้งหนี้ — ตรงกับสิทธิ์ RECEIPT_ISSUE ฝั่งหลังบ้าน */
export const RECEIPT_ISSUE_ROLES: ReadonlySet<CanonicalRole> = new Set<CanonicalRole>([
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
]);

function hasRole(set: ReadonlySet<CanonicalRole>, role: string | null | undefined): boolean {
    const canonical = normalizeRole(role);
    return canonical ? set.has(canonical) : false;
}

export function canViewAccounting(role: string | null | undefined): boolean {
    return hasRole(ACCOUNTING_READ_ROLES, role);
}

export function canWriteAccounting(role: string | null | undefined): boolean {
    return hasRole(ACCOUNTING_WRITE_ROLES, role);
}

export function canIssueReceipts(role: string | null | undefined): boolean {
    return hasRole(RECEIPT_ISSUE_ROLES, role);
}

/**
 * ระงับ/ปลดระงับใบแจ้งหนี้นี้ได้ไหม — RECEIPT_ISSUE และด่านฝั่งของหลังบ้าน
 * (invoice-helpers.assertInvoiceSideWritable): การเงินบริษัทแตะใบค่าธรรมเนียมรัฐแบบเก่า
 * (issuerSide = 'DTAM') ไม่ได้ · ไม่แสดงปุ่มที่กดแล้วได้ 403
 */
export function canHoldInvoice(role: string | null | undefined, issuerSide: string | null | undefined): boolean {
    if (!canIssueReceipts(role)) return false;
    if (normalizeRole(role) === CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM && issuerSide === 'DTAM') return false;
    return true;
}

export function isProviderRole(role: string | null | undefined): boolean {
    const canonical = normalizeRole(role);
    return canonical ? PROVIDER_ROLES.has(canonical) : false;
}
