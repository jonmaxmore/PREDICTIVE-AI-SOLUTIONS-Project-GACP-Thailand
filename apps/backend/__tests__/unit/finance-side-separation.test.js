// ด่านแยกฝั่งการเงิน — สัญญา segregation-of-duties (§6.2 · VIS-ACCT-02)
//
// ไฟล์นี้เดิมชื่อ canonical-rbac-account-split.test.js และตรึงคำศัพท์ยุค Tier 16
// (`account_dtam` / `account_platform` / คำเปล่า `account`) · หลัง operator สั่งตัดขาด
// จากคำเก่า 2026-09-10 คำเหล่านั้นไม่มีอยู่แล้ว แต่ **ข้อตกลงที่ไฟล์นี้ปกป้องยังอยู่เหมือนเดิม**
// จึงเขียนใหม่ด้วยคำปัจจุบัน ไม่ใช่ลบทิ้ง:
//
//   - การเงินฝั่งกรมรีวิวสลิปฝั่งบริษัทไม่ได้ และกลับกัน
//   - ผู้ดูแลระบบมีสิทธิ์ข้ามฝั่ง (PAYMENT_SLIP_REVIEW_ANY)
//   - ผู้ตรวจแปลงอ่านได้ทั้งสองฝั่งเพื่อตรวจ SoD แต่รีวิวไม่ได้สักฝั่ง
//   - ผู้ขอรับรองไม่มีสิทธิ์รีวิวอะไรเลย
//
// ถ้าข้อใดข้อหนึ่งหลุด สลิปจะไหลเข้าคิวของทีมที่ไม่ใช่เจ้าของ

'use strict';

const {
  CANONICAL_ROLES,
  PERMISSIONS,
  ROLE_GROUPS,
  normalizeRole,
  hasPermission,
  isProviderRole,
} = require('../../shared/canonical-rbac');

describe('การเงินสองฝั่ง — คำศัพท์', () => {
  it('มีบทบาทการเงินสองตัว แยกกรม/บริษัทชัดเจน', () => {
    expect(CANONICAL_ROLES.FINANCE_OFFICER_DTAM).toBe('finance_officer_dtam');
    expect(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM).toBe('finance_officer_platform');
  });

  it('ไม่มีคำเปล่าที่ตัดสินฝั่งไม่ได้เหลืออยู่', () => {
    expect(normalizeRole('account')).toBeNull();
    expect(normalizeRole('accountant')).toBeNull();
    expect(normalizeRole('finance')).toBeNull();
  });
});

describe('สิทธิ์รีวิวสลิป — ต้องแยกฝั่งจริง', () => {
  // operator 2026-09-27 (A) "กรมฯ ดูอย่างเดียว" + security review L5 — เดิม: รีวิวฝั่งรัฐได้ (true)
  it('การเงินฝั่งกรม รีวิวสลิปไม่ได้สักฝั่ง (ดูอย่างเดียว)', () => {
    const r = CANONICAL_ROLES.FINANCE_OFFICER_DTAM;
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_DTAM)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_ANY)).toBe(false);
  });

  it('การเงินฝั่งบริษัท รีวิวได้เฉพาะฝั่งแพลตฟอร์ม', () => {
    const r = CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM;
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM)).toBe(true);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_DTAM)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_ANY)).toBe(false);
  });

  it('ผู้ดูแลระบบทั้งสองฝั่งข้ามฝั่งได้', () => {
    for (const r of [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM]) {
      expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_ANY)).toBe(true);
      expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_DTAM)).toBe(true);
      expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM)).toBe(true);
    }
  });

  // S6 (operator 2026-09-27) — เดิม: ผู้ตรวจแปลงอ่านสลิปได้ทั้งสองฝั่ง (true)
  it('ผู้ตรวจแปลงไม่อ่านเรื่องเงิน และรีวิวไม่ได้สักฝั่ง', () => {
    const r = CANONICAL_ROLES.FIELD_INSPECTOR;
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_READ_ALL)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_DTAM)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_ANY)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW)).toBe(false);
  });

  it('ผู้ขอรับรองไม่มีสิทธิ์รีวิวอะไรเลย', () => {
    const r = CANONICAL_ROLES.HEALTH;
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_DTAM)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM)).toBe(false);
    expect(hasPermission(r, PERMISSIONS.PAYMENT_SLIP_REVIEW_ANY)).toBe(false);
  });
});

describe('คีย์สิทธิ์ที่ด่านนี้พึ่งพา', () => {
  it('มีคีย์รีวิวแยกฝั่งครบสามตัว', () => {
    expect(PERMISSIONS.PAYMENT_SLIP_REVIEW_DTAM).toBeDefined();
    expect(PERMISSIONS.PAYMENT_SLIP_REVIEW_PLATFORM).toBeDefined();
    expect(PERMISSIONS.PAYMENT_SLIP_REVIEW_ANY).toBeDefined();
  });
});

describe('กลุ่มบทบาทของฝ่ายการเงิน', () => {
  it('ACCOUNT_STAFF และ FINANCE มีการเงินทั้งสองฝั่ง', () => {
    for (const group of [ROLE_GROUPS.ACCOUNT_STAFF, ROLE_GROUPS.FINANCE]) {
      expect(group).toContain(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
      expect(group).toContain(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM);
    }
  });

  it('ไม่มีคำเก่าตกค้างในกลุ่มไหนเลย', () => {
    const retired = ['account', 'accountant', 'ACCOUNTANT', 'ACCOUNT_DTAM',
      'ACCOUNT_PLATFORM', 'ADMIN', 'SUPER_ADMIN', 'AUDITOR', 'SCHEDULER'];
    for (const [name, group] of Object.entries(ROLE_GROUPS)) {
      const found = group.filter((r) => retired.includes(r));
      expect({ group: name, found }).toEqual({ group: name, found: [] });
    }
  });
});

describe('ทั้งสองฝั่งเป็นเจ้าหน้าที่', () => {
  it('isProviderRole รับทั้งคู่', () => {
    expect(isProviderRole(CANONICAL_ROLES.FINANCE_OFFICER_DTAM)).toBe(true);
    expect(isProviderRole(CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM)).toBe(true);
  });
});
