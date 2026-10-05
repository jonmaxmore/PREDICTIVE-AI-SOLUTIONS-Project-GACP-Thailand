/**
 * Canonical RBAC model for provider/health workflow.
 * Keeps compatibility with existing legacy role values.
 *
 * NOTE: HEAD_AUDITOR has been consolidated into AUDITOR.
 * The enum key is retained for backward compatibility but resolves to 'auditor'.
 *
 * Tier 16 (B16-B handoff, 2026-05-16): ACCOUNT split. The single
 * `ACCOUNT` role is split into:
 *   - `ACCOUNT_DTAM`     → reviews STATE-side payment slips
 *                          (PHASE_1_STATE_FEE / PHASE_2_STATE_FEE)
 *   - `ACCOUNT_PLATFORM` → reviews PLATFORM-side payment slips
 *                          (PHASE_1_PLATFORM_FEE / PHASE_2_PLATFORM_FEE
 *                          + subscription invoices)
 *
 * Rationale: the DTAM accounting team (กรมการแพทย์แผนไทยฯ) and the
 * platform accounting team (เอกชน/บริษัท) work on strictly disjoint
 * slip queues — DTAM books revenue under government-revenue ledger
 * (Wallet A), platform books under commercial books with output VAT
 * (Wallet B). A single approver must not be able to mix the queues
 * because the receipt template / numbering / signing key differ.
 *
 * Backward compat:
 *   - The legacy `ACCOUNT` role / `account` value is kept in
 *     ROLE_ALIASES and PERMISSIONS so existing JWTs do not 401.
 *     A migration script (`scripts/migrate-account-role.js`) moves
 *     existing users to one of the new roles. Until the migration
 *     runs, ACCOUNT users keep the union permission set, but the
 *     payment-slip service additionally filters by issuer side per
 *     role — see resolveAllowedIssuerSides() in payment-slip-service.js.
 */

/**
 * คำศัพท์บทบาท — โมเดลสามฝั่ง (operator 2026-09-10)
 *
 *   ผู้รับบริการ   health   ← คำของหมอพร้อม (Health ID) ไม่ใช่คำที่เราตั้ง — ดูหมายเหตุที่ HEALTH
 *   กรม            document_reviewer · dispatcher · field_inspector ·
 *                  certificate_approver · finance_officer_dtam · system_admin_dtam
 *   บริษัท         finance_officer_platform · system_admin_platform
 *   ไม่ใช่คน        system
 *
 * **ตัดขาดจากคำเก่า** (operator วันเดียวกัน: "เลิกใช้ของเก่า รวมถึงการพูดถึงของเก่า
 * เพราะเราจะใช้ของใหม่ทั้งหมด") — ไม่มีคีย์ deprecated ไม่มี alias ของคำเก่า
 * ทำได้เพราะทั้งสามฐานถูกล้างและ seed ใหม่ในวันเดียวกัน จึงไม่มีแถวเก่าให้ต้องแปล
 * ที่เดียวที่คำเก่ายังปรากฏได้คือไฟล์ migration ซึ่งเป็นบันทึกประวัติ ไม่ใช่คำที่ยังใช้
 *
 * ทั้งสองตระกูลเป็นคู่สมมาตร `_dtam` / `_platform` ไม่มีตัวชื่อเปล่า — บทเรียนจาก
 * `account` ตัวเปล่าเดิม ที่ตอบสังกัดไม่ได้เพราะไม่มีอะไรบอกว่ามันอยู่ข้างไหน
 */
const CANONICAL_ROLES = Object.freeze({
  /**
   * ผู้ขอรับรอง — พิสูจน์ตัวตนเอง ไม่มีใครแต่งตั้ง
   *
   * **คำนี้ห้ามเปลี่ยน** (operator 2026-09-10): `health` กับ `provider` ไม่ใช่คำที่เราตั้งเอง
   * แต่อ้างอิงหมอพร้อม (Health ID / Provider ID) ซึ่งกระทรวงสาธารณสุขบังคับให้เชื่อมต่อ
   * — อนาคตต้องลิงก์ฐานข้อมูลหรือเรียก API ของหมอพร้อม การเปลี่ยนคำฝั่งเราจะทำให้
   * สองระบบพูดคนละภาษากันทันที
   */
  HEALTH: 'health',

  /** กรม — ผู้ตรวจ "เอกสาร" */
  DOCUMENT_REVIEWER: 'document_reviewer',
  /** กรม — จ่ายงานและคุมคิวตรวจ */
  DISPATCHER: 'dispatcher',
  /** กรม — ลงพื้นที่ตรวจแปลงจริง */
  FIELD_INSPECTOR: 'field_inspector',
  /** กรม — ผู้ตัดสินให้การรับรอง (ISO/IEC 17065 §7.6: ต้องไม่ใช่ผู้ประเมิน) */
  CERTIFICATE_APPROVER: 'certificate_approver',
  /** กรม — การเงินฝั่งค่าธรรมเนียมรัฐ */
  FINANCE_OFFICER_DTAM: 'finance_officer_dtam',
  /** กรม — ผู้ดูแลระบบของกรม ผูกกับองค์กรตัวเอง (ไม่ข้ามองค์กร) */
  SYSTEM_ADMIN_DTAM: 'system_admin_dtam',

  /** บริษัท — การเงินฝั่งค่าบริการแพลตฟอร์ม */
  FINANCE_OFFICER_PLATFORM: 'finance_officer_platform',
  /** บริษัท — ผู้ดูแลระบบของบริษัท · **role เดียวที่ข้ามองค์กรได้** (ADR-014 / SEC-PROV-001) */
  SYSTEM_ADMIN_PLATFORM: 'system_admin_platform',

  /**
   * ไม่ใช่คน — webhook (lab, payment) และ cron
   * ไม่มีสิทธิ์ใน ROLE_PERMISSIONS เลย · เดินได้เฉพาะ transition ที่ ROLE_TRANSITIONS
   * อนุญาตไว้ชัดเจน (workflow-transition-service.js)
   */
  SYSTEM: 'system',
});

/**
 * ตัวปรับค่าให้เป็นคำมาตรฐาน — รับเฉพาะ "คำปัจจุบัน" เท่านั้น
 *
 * แผนที่นี้ **ปิด**: ทุกคำในตารางแปลเป็นตัวมันเอง ยกเว้น webhook/cron ที่เป็นชื่อเรียก
 * ผู้กระทำที่ไม่ใช่คน · คำที่ปลดระวางแล้วต้องแปลไม่ออก (คืน null) โดยเจตนา —
 * ด่านนี้อยู่ใน `__tests__/unit/role-vocabulary-three-sides.test.js` และจะแดงทันที
 * ถ้ามีใครเติมคำเก่ากลับเข้ามา
 *
 * normalizeRole() ตัดช่องว่างและแปลงเป็นตัวพิมพ์เล็กก่อนค้น คีย์จึงเป็นตัวพิมพ์เล็กทั้งหมด
 */
const ROLE_ALIASES = Object.freeze({
  health: CANONICAL_ROLES.HEALTH,
  document_reviewer: CANONICAL_ROLES.DOCUMENT_REVIEWER,
  dispatcher: CANONICAL_ROLES.DISPATCHER,
  field_inspector: CANONICAL_ROLES.FIELD_INSPECTOR,
  certificate_approver: CANONICAL_ROLES.CERTIFICATE_APPROVER,
  finance_officer_dtam: CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
  system_admin_dtam: CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
  finance_officer_platform: CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  system_admin_platform: CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
  system: CANONICAL_ROLES.SYSTEM,
  webhook: CANONICAL_ROLES.SYSTEM,
  cron: CANONICAL_ROLES.SYSTEM,
});

const PERMISSIONS = Object.freeze({
  APPLICATION_SUBMIT: 'application.submit',
  APPLICATION_VIEW_SELF: 'application.view.self',
  APPLICATION_VIEW_ALL: 'application.view.all',
  // ประตูตามสอบย้อนกลับทั่วประเทศ (รอบปลูก แปลง กิจกรรม ของทุกฟาร์ม) — แยกจาก
  // APPLICATION_VIEW_ALL เพราะสองอย่างนี้คือข้อมูลคนละชุด "ดูใบสมัครทั้งหมด" เป็นสิ่งที่ฝ่าย
  // การเงินต้องมีเพื่อออกใบแจ้งหนี้ ส่วน "ดูไทม์ไลน์การเพาะปลูกและตำแหน่งแปลงของทุกฟาร์ม"
  // ไม่ใช่งานของเขา — มติ operator 2026-09-07: ฝ่ายการเงิน "เห็นแค่ billing หรือ transaction
  // และข้อมูลที่เอาไปทำบัญชีเท่านั้น" (F-SCOPE-01)
  TRACKING_VIEW_ALL: 'tracking.view.all',
  APPLICATION_DOC_REVIEW: 'application.document.review',
  APPLICATION_SCHEDULE: 'application.schedule',
  APPLICATION_AUDIT_RECORD: 'application.audit.record',
  APPLICATION_WORKFLOW_TRANSITION: 'application.workflow.transition',
  USERS_MANAGE: 'users.manage',
  MASTER_DATA_MANAGE: 'master_data.manage',
  ACCOUNTING_DASHBOARD_READ: 'accounting.dashboard.read',
  INVOICE_VIEW_ALL: 'invoice.view.all',
  RECEIPT_ISSUE: 'receipt.issue',
  REPORT_EXPORT: 'report.export',
  AUDIT_TIMELINE_READ: 'audit.timeline.read',
  AUDIT_SUBMIT: 'audit.submit',
  APPLICATION_OVERRIDE: 'application.override',
  // Slip-flow (2026-04-29): manual bank-transfer + slip-upload + ACCOUNT review
  // replaces the prior gateway/webhook integration. See:
  //   docs/architecture/2026-04-29-rfc-payment-slip-flow.md
  BANK_ACCOUNT_READ_ALL: 'bank_account.read.all',
  BANK_ACCOUNT_MANAGE: 'bank_account.manage',
  PAYMENT_SLIP_READ_ALL: 'payment_slip.read.all',
  // Generic review permission retained for legacy ACCOUNT users until
  // migration completes. New routes should check the side-specific
  // keys below.
  PAYMENT_SLIP_REVIEW: 'payment_slip.review',
  // Tier 16 ACCOUNT split — side-specific review permissions. The
  // payment-slip-service consults reviewer.role at runtime to decide
  // which side (DTAM / PLATFORM) the slip belongs to, and rejects with
  // 403 INVALID_REVIEWER_SIDE if the slip's invoice serviceType does
  // not match. The audit trail records actorRole = ACCOUNT_DTAM /
  // ACCOUNT_PLATFORM so auditors can prove segregation of duties.
  PAYMENT_SLIP_REVIEW_DTAM: 'payment_slip.review.dtam',
  PAYMENT_SLIP_REVIEW_PLATFORM: 'payment_slip.review.platform',
  // Admin-only — for support / break-glass scenarios. Routes log
  // [admin-override] when ADMIN reviews a slip so post-incident
  // review can flag the bypass. AUDITOR carries the read-only
  // variant of this via PAYMENT_SLIP_READ_ALL.
  PAYMENT_SLIP_REVIEW_ANY: 'payment_slip.review.any',
  PAYMENT_SLIP_READ_OWN: 'payment_slip.read.own',
});

// Read permissions both finance roles hold — the two see the same data
// (operator 2026-09-11). finance_officer_dtam holds exactly this set;
// finance_officer_platform adds the write permissions below.
const ACCOUNT_BASE_PERMISSIONS = [
  PERMISSIONS.APPLICATION_VIEW_ALL,
  PERMISSIONS.ACCOUNTING_DASHBOARD_READ,
  PERMISSIONS.INVOICE_VIEW_ALL,
  PERMISSIONS.REPORT_EXPORT,
  PERMISSIONS.AUDIT_TIMELINE_READ,
  PERMISSIONS.BANK_ACCOUNT_READ_ALL,
  PERMISSIONS.PAYMENT_SLIP_READ_ALL,
];

const ROLE_PERMISSIONS = Object.freeze({
  [CANONICAL_ROLES.HEALTH]: new Set([
    PERMISSIONS.APPLICATION_SUBMIT,
    PERMISSIONS.APPLICATION_VIEW_SELF,
    // Slip-flow: applicants see only their own slips
    PERMISSIONS.PAYMENT_SLIP_READ_OWN,
  ]),
  [CANONICAL_ROLES.DOCUMENT_REVIEWER]: new Set([
    PERMISSIONS.TRACKING_VIEW_ALL,
    PERMISSIONS.APPLICATION_VIEW_ALL,
    PERMISSIONS.APPLICATION_DOC_REVIEW,
    PERMISSIONS.APPLICATION_WORKFLOW_TRANSITION,
    PERMISSIONS.AUDIT_TIMELINE_READ,
  ]),
  [CANONICAL_ROLES.DISPATCHER]: new Set([
    PERMISSIONS.TRACKING_VIEW_ALL,
    PERMISSIONS.APPLICATION_VIEW_ALL,
    PERMISSIONS.APPLICATION_SCHEDULE,
    PERMISSIONS.APPLICATION_WORKFLOW_TRANSITION,
    PERMISSIONS.AUDIT_TIMELINE_READ,
    PERMISSIONS.REPORT_EXPORT,
  ]),
  [CANONICAL_ROLES.FIELD_INSPECTOR]: new Set([
    PERMISSIONS.TRACKING_VIEW_ALL,
    PERMISSIONS.APPLICATION_VIEW_ALL,
    PERMISSIONS.APPLICATION_DOC_REVIEW,
    PERMISSIONS.APPLICATION_AUDIT_RECORD,
    PERMISSIONS.APPLICATION_WORKFLOW_TRANSITION,
    PERMISSIONS.AUDIT_TIMELINE_READ,
    PERMISSIONS.AUDIT_SUBMIT,
    PERMISSIONS.REPORT_EXPORT,
    // No finance read (operator 2026-09-27: the inspection job reaches the
    // inspector only after payment, so billing is not theirs to see).
  ]),
  // ผู้ตัดสินให้การรับรอง (ISO/IEC 17065 §7.6) — อ่านได้ทุกอย่างที่ต้องใช้ตัดสิน
  // และเดินสถานะได้ แต่ **ไม่มี** APPLICATION_AUDIT_RECORD / AUDIT_SUBMIT:
  // คนที่ตัดสินต้องไม่ใช่คนที่บันทึกผลประเมิน · การไม่ให้สิทธิ์บันทึกผลตรวจ ทำให้
  // การถือสองบทบาทพร้อมกันไม่ได้แปลว่าทำงานตัวเองครบวงจร
  [CANONICAL_ROLES.CERTIFICATE_APPROVER]: new Set([
    PERMISSIONS.APPLICATION_VIEW_ALL,
    PERMISSIONS.APPLICATION_WORKFLOW_TRANSITION,
    PERMISSIONS.AUDIT_TIMELINE_READ,
    PERMISSIONS.TRACKING_VIEW_ALL,
    PERMISSIONS.REPORT_EXPORT,
  ]),
  // operator 2026-09-27 (A) "กรมฯ ดูอย่างเดียว": read permissions only — no
  // write permission of any kind, including ones no route uses today
  // (BANK_ACCOUNT_MANAGE / PAYMENT_SLIP_REVIEW*), so a future route that checks
  // hasPermission cannot silently hand this role a write (L5, 2026-09-27).
  [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: new Set([
    ...ACCOUNT_BASE_PERMISSIONS,
  ]),
  [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: new Set([
    ...ACCOUNT_BASE_PERMISSIONS,
    // ออกใบเสร็จ + ระงับ/ปลดระงับใบแจ้งหนี้ — เฉพาะการเงินบริษัท (operator 2026-09-27:
    // "กรมฯ ดูอย่างเดียว" · บริษัทเป็นผู้ออกเอกสารรายเดียว สมุดบัญชีเป็นของบริษัท)
    // การเงินกรมอ่านได้เท่ากันผ่าน INVOICE_VIEW_ALL แต่ไม่มีสิทธิ์นี้
    PERMISSIONS.RECEIPT_ISSUE,
    PERMISSIONS.BANK_ACCOUNT_MANAGE,
    PERMISSIONS.PAYMENT_SLIP_REVIEW,
    // PLATFORM-side only: PHASE_1_PLATFORM_FEE / PHASE_2_PLATFORM_FEE
    // + subscription invoices. State-side slips return 403.
    PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM,
  ]),
  [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: new Set(Object.values(PERMISSIONS)),
  // PLATFORM_ADMIN is a superset of ADMIN (all permissions) plus the
  // cross-tenant org-management surface gated by ROLE_GROUPS.PLATFORM_ADMIN_ONLY.
  [CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM]: new Set(Object.values(PERMISSIONS)),
});

/**
 * สังกัดของแต่ละบทบาท — "ใครเป็นคนของใคร"
 *
 * operator 2026-09-10: บทบาทวันนี้เรียงแบน ๆ แล้วสับสน · การแยกกรม/บริษัทมีอยู่จริง
 * ในระบบมาตลอด แต่มีอยู่แค่ในฝั่งบัญชีเท่านั้น (account_dtam กับ account_platform)
 * ส่วน admin กับ platform_admin ไม่มีอะไรบอกว่าเกี่ยวกันอย่างไร — นั่นคือที่มาของ
 * "ไม่รู้ว่าใครเป็นใคร"
 *
 * ตารางนี้ยกความจริงข้อนั้นขึ้นมาเป็นข้อมูลชั้นแรก โดย **ไม่เปลี่ยนชื่อบทบาทใด ๆ**:
 * เพิ่มอย่างเดียว ไม่มีอะไรพังได้ · ประตูที่วันนี้ถามว่า "เป็น role อะไร" จะถามได้ว่า
 * "เป็นคนของกรมหรือของบริษัท" เมื่อคำถามนั้นคือคำถามที่ถูกต้องกว่า
 *
 * ทำไมไม่เปลี่ยนชื่อ admin → certification_body_admin ไปเลย: คำว่า admin ไม่ได้กำกวม
 * (ต่างจาก auditor ที่ปนกับผู้ตรวจเอกสารจริง ๆ) สิ่งที่ขาดคือ "สังกัด" ไม่ใช่ "ชื่อ"
 * และ admin ยังพันกับ URL /admin/* กับ middleware requireAdmin ⇒ ความเสี่ยงสูงกว่าประโยชน์
 */
const ROLE_AFFILIATIONS = Object.freeze({
  /** ประชาชน / ผู้ขอรับรอง — พิสูจน์ตัวตนเอง ไม่มีใครแต่งตั้ง */
  PUBLIC: 'public',
  /** กรม / หน่วยรับรอง — ผู้ดูแลกรมเป็นผู้มอบบทบาท */
  CERTIFICATION_BODY: 'certification_body',
  /** บริษัทผู้ให้บริการแพลตฟอร์ม — ผู้ดูแลบริษัทเป็นผู้มอบบทบาท */
  PLATFORM_OPERATOR: 'platform_operator',
  /** ไม่ใช่คน */
  SYSTEM: 'system',
});

const ROLE_AFFILIATION_BY_ROLE = Object.freeze({
  [CANONICAL_ROLES.HEALTH]: ROLE_AFFILIATIONS.PUBLIC,

  [CANONICAL_ROLES.DOCUMENT_REVIEWER]: ROLE_AFFILIATIONS.CERTIFICATION_BODY,
  [CANONICAL_ROLES.FIELD_INSPECTOR]: ROLE_AFFILIATIONS.CERTIFICATION_BODY,
  [CANONICAL_ROLES.CERTIFICATE_APPROVER]: ROLE_AFFILIATIONS.CERTIFICATION_BODY,
  [CANONICAL_ROLES.DISPATCHER]: ROLE_AFFILIATIONS.CERTIFICATION_BODY,
  [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: ROLE_AFFILIATIONS.CERTIFICATION_BODY,
  [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: ROLE_AFFILIATIONS.CERTIFICATION_BODY,

  [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: ROLE_AFFILIATIONS.PLATFORM_OPERATOR,
  [CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM]: ROLE_AFFILIATIONS.PLATFORM_OPERATOR,

  [CANONICAL_ROLES.SYSTEM]: ROLE_AFFILIATIONS.SYSTEM,
});

/**
 * สังกัดของบทบาทนี้ หรือ null เมื่อตอบไม่ได้
 * (บทบาทที่ไม่รู้จัก หรือ legacy ACCOUNT ที่ยังไม่ได้แยกข้าง)
 */
function roleAffiliation(role) {
  const canonical = normalizeRole(role);
  if (!canonical) { return null; }
  return ROLE_AFFILIATION_BY_ROLE[canonical] ?? null;
}

/** บทบาทที่ถือว่าเป็น "เจ้าหน้าที่" — ทั้งของกรมและของบริษัท (ไม่รวมผู้ขอรับรอง) */
const PROVIDER_CANONICAL_ROLES = new Set([
  CANONICAL_ROLES.DOCUMENT_REVIEWER,
  CANONICAL_ROLES.DISPATCHER,
  CANONICAL_ROLES.FIELD_INSPECTOR,
  CANONICAL_ROLES.CERTIFICATE_APPROVER,
  CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
  CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
  CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
]);

/**
 * กลุ่มบทบาทที่ตั้งชื่อไว้ — ใช้แทนการเขียนอาเรย์ของ role ตรง ๆ ในไฟล์เส้นทาง
 *
 * เดิมทุกกลุ่มมีค่าตัวพิมพ์ใหญ่ของคำเก่าปนอยู่ด้วย เพื่อให้ requireRole() ผ่านไม่ว่า JWT
 * จะเข้ารหัส role มาแบบไหน · ตอนนี้ไม่มีแล้ว: มีคำชุดเดียวทั้งระบบ และ normalizeRole()
 * ปฏิเสธคำเก่าทุกคำ ⇒ ค่าตัวพิมพ์ใหญ่ที่ค้างไว้จะกลายเป็นสิ่งที่อ่านแล้วเข้าใจผิดว่ายังรับอยู่
 */
const ROLE_GROUPS = Object.freeze({
  /** เจ้าหน้าที่ทุกคน ทั้งสองสังกัด */
  ALL_PROVIDER: [
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.CERTIFICATE_APPROVER,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  ],
  /**
   * ผู้ดูแลระบบของกรมเท่านั้น
   *
   * ผู้ดูแลของบริษัท **ไม่อยู่ในกลุ่มนี้และไม่อยู่ใน ALL_PROVIDER / FULL_STAFF** —
   * มันเป็นบทบาทกำกับดูแลข้ามองค์กร ไม่ใช่เจ้าหน้าที่สายงาน · การใส่มันเข้ามา
   * "เพื่อความสมมาตร" คือการเปิดประตูงานทุกบานให้มัน (วัดได้จาก rbac-matrix-final:
   * 22 เคส NEGATIVE กลายเป็นผ่าน)
   */
  ADMIN_ONLY: [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
  ],
  /**
   * ผู้ดูแลของบริษัทเท่านั้น (ADR-014 / SEC-PROV-001)
   * ผู้ดูแลของกรมไม่อยู่ในกลุ่มนี้โดยเจตนา — นั่นคือเส้นแบ่งข้ามองค์กร
   */
  PLATFORM_ADMIN_ONLY: [
    CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
  ],
  REVIEWERS: [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
  ],
  /** สายงานตรวจ — ไม่มีฝ่ายการเงิน (F-SCOPE-01) */
  AUDIT_STAFF: [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.DISPATCHER,
  ],
  /**
   * การเงินทั้งสองฝั่ง + ผู้ดูแล · การอนุญาตเฉพาะฝั่งเกิดลึกลงไปที่ชั้น slip-service
   * ไม่ใช่ที่กลุ่มนี้ (VIS-ACCT-02)
   */
  FINANCE: [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  ],
  /** ประตูที่ต้องการ "คนของฝ่ายบัญชี ฝั่งไหนก็ได้" */
  ACCOUNT_STAFF: [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  ],
  SCHEDULERS: [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.DISPATCHER,
  ],
  /**
   * บันทึกผลการตรวจ (AUDIT_CONFIRMED → AUDIT_PASSED|CAR_PENDING|REJECTED)
   *
   * AUDIT-001 (2026-06-24): ผู้ดูแลระบบถูกตัดออกจากกลุ่มนี้ — ผู้ดูแลไม่ได้อยู่ในเส้นทาง
   * ตัดสินผลตรวจ (SoD) · ทางกู้คืนของผู้ดูแลคือเส้น force ของ workflow หรือ
   * ADMIN_AUDIT_OVERRIDE ข้างล่างบนเส้นทาง force/recovery เท่านั้น
   */
  AUDITORS: [
    CANONICAL_ROLES.FIELD_INSPECTOR,
  ],
  /**
   * ผู้ตัดสินให้การรับรอง (ISO/IEC 17065 §7.6 · F-CERT-SOD 2026-09-10)
   *
   * แยกจาก AUDITORS โดยเจตนา และต้องแยกตลอดไป: AUDITORS คุมประตู "บันทึกผลตรวจ"
   * ส่วนกลุ่มนี้คุมประตู "ตัดสิน" · ถ้ารวมสองกลุ่ม คนคนเดียวจะกลับไปถือทั้งสองอำนาจอีกครั้ง
   * ซึ่งคือสิ่งที่ F-CERT-SOD แก้
   *
   * ผู้ตรวจหน้างานไม่อยู่ในรายชื่อนี้ — ก่อนหน้านี้คิวอนุมัติเปิดให้เขา และนั่นคือเหตุที่
   * ใบรับรองถูกออกโดยผู้ประเมินคนเดียวกัน · ผู้ดูแลระบบก็ไม่อยู่ ด้วยเหตุผลเดียวกับ AUDIT-001
   */
  CERT_DECIDERS: [
    CANONICAL_ROLES.CERTIFICATE_APPROVER,
  ],
  /** สงวนไว้สำหรับเส้นทาง force/recovery เท่านั้น — ห้ามใช้กับประตูตัดสินผลตรวจปกติ */
  ADMIN_AUDIT_OVERRIDE: [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
  ],
  /** เจ้าหน้าที่ทั้งหมดรวมฝ่ายการเงิน */
  FULL_STAFF: [
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.CERTIFICATE_APPROVER,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  ],
});

function normalizeRole(role) {
  const key = String(role || '').trim().toLowerCase();
  if (!key) {
    return null;
  }
  return ROLE_ALIASES[key] || null;
}

function hasPermission(role, permission) {
  const canonicalRole = normalizeRole(role);
  if (!canonicalRole) {
    return false;
  }
  const granted = ROLE_PERMISSIONS[canonicalRole];
  return granted ? granted.has(permission) : false;
}

function isProviderRole(role) {
  const canonicalRole = normalizeRole(role);
  return canonicalRole ? PROVIDER_CANONICAL_ROLES.has(canonicalRole) : false;
}

module.exports = {
  ROLE_PERMISSIONS,
  PROVIDER_CANONICAL_ROLES,
  ROLE_AFFILIATIONS,
  ROLE_AFFILIATION_BY_ROLE,
  roleAffiliation,
  CANONICAL_ROLES,
  PERMISSIONS,
  ROLE_GROUPS,
  normalizeRole,
  hasPermission,
  isProviderRole,
};
