/**
 * residency-claim-removed.test.tsx — operator ruling 2026-09-27 (AskUserQuestion,
 * "ลบประโยคที่ไม่จริง + ล้างกฎเก่า"), extended same day by the operator
 * ("เรื่องที่คุณนำเสนอมาให้คุณดำเนินการได้").
 *
 * §7 used to make two claims:
 *   1. 'ระบบเก็บข้อมูลผู้ใช้งานในประเทศไทยทั้งหมด ไม่มีการส่งหรือโอนข้อมูลส่วนบุคคลไปยังต่างประเทศ'
 *      — false today: the platform sends payment data to a foreign payment
 *      provider.
 *   2. 'หากในอนาคตมีความจำเป็นต้องโอนข้อมูลไปต่างประเทศ ... จะแจ้งให้เจ้าของข้อมูลทราบล่วงหน้า'
 *      — a promise of advance notice of *future* transfers that is not being
 *      kept, since a transfer (to the payment provider) already happens.
 * With both sentences gone the section was empty, so §7 itself (id
 * `cross-border`) was removed entirely and the following sections (formerly
 * 8-13) renumbered to 7-12. This locks that removal so neither false claim,
 * nor the empty section, nor the anchor can regress.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacyPolicyPage from '../page';

describe('privacy-policy — retired cross-border section removed entirely', () => {
  const html = renderToStaticMarkup(<PrivacyPolicyPage />);

  it('does NOT claim all data is kept in Thailand with no cross-border transfer', () => {
    expect(html).not.toContain(
      'ระบบเก็บข้อมูลผู้ใช้งานในประเทศไทยทั้งหมด ไม่มีการส่งหรือโอนข้อมูลส่วนบุคคลไปยังต่างประเทศ',
    );
    expect(html).not.toContain('ในประเทศไทยทั้งหมด');
  });

  it('does NOT promise advance notice of a future transfer that is not being kept', () => {
    expect(html).not.toContain(
      'หากในอนาคตมีความจำเป็นต้องโอนข้อมูลไปต่างประเทศ จะดำเนินการเฉพาะกรณีที่ประเทศปลายทางมีมาตรฐานคุ้มครองข้อมูลที่เพียงพอตามมาตรา 28 พ.ร.บ. PDPA และจะแจ้งให้เจ้าของข้อมูลทราบล่วงหน้า',
    );
  });

  it('does not name a payment provider as a replacement claim', () => {
    expect(html).not.toMatch(/Stripe/i);
  });

  it('removed the cross-border section (title and #cross-border anchor) entirely', () => {
    expect(html).not.toContain('การส่งหรือโอนข้อมูลไปต่างประเทศ');
    expect(html).not.toContain('id="cross-border"');
    expect(html).not.toContain('href="#cross-border"');
  });

  it('renumbered the sections after the removed one, with no gap and no duplicate', () => {
    const numbers = Array.from(html.matchAll(/<h2[^>]*>(\d+)\.\s/g)).map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('keeps the retention section (formerly §8) as the new §7', () => {
    expect(html).toContain('7. ระยะเวลาจัดเก็บข้อมูล');
  });

  it('keeps the last section (formerly §13) as the new §12', () => {
    expect(html).toContain('12. การปรับปรุงนโยบาย');
    expect(html).not.toMatch(/13\.\s/);
  });
});
