/**
 * faq-no-residency-claim.test.ts — operator ruling 2026-09-27 (AskUserQuestion,
 * "ลบประโยคที่ไม่จริง + ล้างกฎเก่า"), extended same day (coordinator follow-up).
 *
 * The FAQ item 'pdpa-export' asked 'ข้อมูลถูกส่งออกนอกประเทศหรือไม่?' and answered
 * 'ไม่ ข้อมูลส่วนบุคคลถูกเก็บในประเทศไทยทั้งหมด ระบบไม่มีการส่งข้อมูลไปประมวลผลในต่างประเทศ' —
 * false today: payment data goes to a foreign provider. The whole Q&A item is
 * removed (its answer IS the false claim), not reworded. This locks that
 * removal so the item cannot regress.
 *
 * The item 'pdpa-storage' answered 'จัดเก็บในศูนย์ข้อมูลที่ตั้งในประเทศไทย เข้ารหัส...' —
 * the location clause is also false: the staging/demo database hosts are both
 * Supabase `aws-0-ap-southeast-1` (Singapore, checked by hostname only). Only
 * the location clause is removed; the rest of the answer (encryption +
 * access-control) is a separate, still-true claim and is kept, unchanged.
 */
import { ALL_FAQ_ITEMS } from '../faq-data';

describe('faq-data — retired residency claim item removed', () => {
  const allItems = ALL_FAQ_ITEMS;

  it('no longer has the pdpa-export item', () => {
    expect(allItems.find((item) => item.id === 'pdpa-export')).toBeUndefined();
  });

  it('no item claims all data stays in Thailand with no cross-border transfer', () => {
    for (const item of allItems) {
      expect(item.answer).not.toContain('ในประเทศไทยทั้งหมด');
      expect(item.question).not.toContain('ข้อมูลถูกส่งออกนอกประเทศหรือไม่');
    }
  });

  it('pdpa-storage no longer claims the data center is located in Thailand', () => {
    const item = allItems.find((i) => i.id === 'pdpa-storage');
    expect(item).toBeDefined();
    expect(item!.answer).not.toContain('ศูนย์ข้อมูลที่ตั้งในประเทศไทย');
    expect(item!.answer).not.toMatch(/ประเทศไทย/);
  });

  it('pdpa-storage keeps its still-true encryption/access-control claim', () => {
    const item = allItems.find((i) => i.id === 'pdpa-storage');
    expect(item!.answer).toContain('เข้ารหัสทั้งระหว่างส่งและขณะจัดเก็บ (TLS + AES-256)');
    expect(item!.answer).toContain('เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาตเท่านั้นเข้าถึงได้');
  });

  it('no item claims a Thailand-located data center or server (any phrasing)', () => {
    for (const item of allItems) {
      expect(item.answer).not.toMatch(/ศูนย์ข้อมูล.*ประเทศไทย/);
      expect(item.answer).not.toMatch(/เซิร์ฟเวอร์.*ประเทศไทย/);
      expect(item.answer).not.toMatch(/hosted in Thailand/i);
      expect(item.answer).not.toMatch(/Thai data center/i);
    }
  });
});
