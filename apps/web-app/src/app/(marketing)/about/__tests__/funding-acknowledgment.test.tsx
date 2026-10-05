import { renderToStaticMarkup } from 'react-dom/server';
import AboutPage from '../page';
import { FUNDING_ACKNOWLEDGMENT, PROJECT_STATUS } from '@/lib/project-info';

const pageText = () => {
  const html = renderToStaticMarkup(<AboutPage />);
  return html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
};

describe('about page — project funding and status', () => {
  it('keeps the contract clause-14 acknowledgment verbatim', () => {
    expect(FUNDING_ACKNOWLEDGMENT).toBe(
      'ได้รับทุนวิจัยสนับสนุนจากกองทุน ววน. โดย บพข. ร่วมกับ บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด ซึ่งมี มหาวิทยาลัยราชภัฏสวนสุนันทา เป็นผู้ดำเนินงาน',
    );
  });

  it('shows the acknowledgment and the pre-production status', () => {
    const text = pageText();
    expect(text).toContain(FUNDING_ACKNOWLEDGMENT);
    expect(text).toContain(PROJECT_STATUS);
    expect(PROJECT_STATUS).toBe(
      'ระบบอยู่ระหว่างการพัฒนาและทดสอบ ยังไม่เปิดให้บริการจริง ข้อมูลที่ปรากฏในระบบขณะนี้ใช้เพื่อการทดสอบเท่านั้น',
    );
  });

  // operator 2026-10-03: wording must not concede a delivery duty, a commission
  // for a named agency, or that the source is a contract output.
  it('does not claim delivery, a commission for an agency, or a contract output', () => {
    const text = pageText();
    expect(text).not.toMatch(/ส่งมอบ/);
    expect(text).not.toMatch(/พัฒนาขึ้นเพื่อ(ให้)?กรม/);
    expect(text).not.toMatch(/พัฒนาภายใต้/);
    expect(text).not.toContain('C05F680149');
    expect(text).not.toContain('หน่วยงานผู้ใช้ระบบ');
  });

  it('does not present any company as the service provider or developer', () => {
    expect(pageText()).not.toMatch(/ผู้พัฒนาระบบ|ผู้ให้บริการระบบ|Predictive AI Solution/);
  });
});
