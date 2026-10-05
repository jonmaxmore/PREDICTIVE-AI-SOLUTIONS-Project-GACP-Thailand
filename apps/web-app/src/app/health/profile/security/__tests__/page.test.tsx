/**
 * HealthSecurityPage — render smoke (renderToStaticMarkup; the web-app harness
 * has no @testing-library/react).
 *
 * มติ operator 2026-09-15: ผู้ขอรับรองยืนยันตัวตนผ่าน หมอพร้อม / ThaID ไม่มี 2FA แบบอีเมล
 * หน้านี้จึงเลิกเป็นแบบฟอร์มลงทะเบียน OTP ทางอีเมล (endpoint ฝั่ง backend ถูกปลดทั้งชุด)
 * และกลายเป็นหน้าอธิบาย เทสนี้พิสูจน์ว่าหน้า mount ได้, บอกทางเข้าที่มีจริง, ไม่พูดถึงรหัสทางอีเมลอีก,
 * ไม่สัญญาสิ่งที่ระบบไม่ได้ทำ (review 2026-09-16) และไม่มี API client ให้เรียก
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import HealthSecurityPage from '../page';

describe('HealthSecurityPage', () => {
  it('names หมอพร้อม / ThaID and offers no email 2FA', () => {
    const html = renderToStaticMarkup(<HealthSecurityPage />);
    expect(html).toContain('การยืนยันตัวตน'); // page title
    expect(html).toContain('หมอพร้อม');
    expect(html).toContain('ThaID');
    expect(html).toContain('กลับ'); // back button
    // the retired enrol flow's own chrome must be gone (the page may still SAY there is no email OTP)
    expect(html).not.toContain('Two-Factor Authentication (Email OTP)');
    expect(html).not.toContain('ยืนยันรหัสจากอีเมล');
    expect(html).not.toContain('ส่งรหัส 6 หลัก');
  });

  it('promises nothing the system does not do', () => {
    const html = renderToStaticMarkup(<HealthSecurityPage />);
    // Logging in again revokes nothing. Only a password change, a staff
    // role/status change and PDPA erasure stamp sessionsRevokedAt
    // (apps/backend/services/auth/password-management.js, routes/api/admin/users.js).
    expect(html).not.toContain('ยกเลิกการเข้าสู่ระบบเดิม');
    // /health/settings still lets a password account change its password.
    expect(html).not.toContain('ไม่มีรหัสผ่าน');
    // The login chooser still keeps a temporary password door next to หมอพร้อม / ThaID,
    // so "every login goes through them" is not true yet.
    expect(html).not.toContain('ทุกครั้งที่เข้าสู่ระบบ');
  });

  // Operator 2026-09-17: "เราไม่มีการกู้บัญชี". The page used to end with "if you
  // cannot log in, contact DTAM staff", which reads as a way back in. There is none:
  // the staff-issued reset token is gone (backend password-reset-routes-behaviour.test.js).
  it('says there is no account recovery and sends no one to staff to get back in', () => {
    const html = renderToStaticMarkup(<HealthSecurityPage />);
    expect(html).toContain('ระบบนี้ไม่มีการกู้บัญชี');
    expect(html).not.toContain('หากเข้าสู่ระบบไม่ได้');
    expect(html).not.toContain('ติดต่อเจ้าหน้าที่');
    // "no reset by email or SMS" implied a reset some other way
    expect(html).not.toContain('รีเซ็ตรหัสผ่านทางอีเมลหรือ SMS');
    // the one thing a signed-in applicant can still do about a leaked password
    expect(html).toContain('เปลี่ยนรหัสผ่านทันที');
  });

  // /api/auth/idp/providers on demo and staging, 2026-09-16: local=enabled,
  // healthid/providerid/thaid=coming_soon. Applicants sign in with ID + password
  // today, so the page must not say หมอพร้อม / ThaID already verify them.
  it('does not claim หมอพร้อม / ThaID already verify the applicant', () => {
    const html = renderToStaticMarkup(<HealthSecurityPage />);
    expect(html).not.toContain('ยืนยันตัวตนด้วย หมอพร้อม หรือ ThaID');
    expect(html).not.toContain('ยืนยันตัวตนของคุณด้วยกลไกของหน่วยงานผู้ออกบัตรเอง');
    expect(html).toContain('ยังไม่เปิดใช้');
    expect(html).toContain('เข้าสู่ระบบด้วยเลขบัตรประชาชนและรหัสผ่าน');
  });

  it('imports no API client: there is nothing to enrol or check any more', () => {
    const src = readFileSync(resolve(__dirname, '..', 'page.tsx'), 'utf8');
    expect(src).not.toMatch(/api-client|apiClient|fetch\(/);
  });
});
