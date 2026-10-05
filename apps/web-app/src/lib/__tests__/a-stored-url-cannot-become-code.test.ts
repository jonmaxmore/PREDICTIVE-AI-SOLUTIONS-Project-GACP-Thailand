/**
 * ที่อยู่เอกสารที่ผู้ยื่นเขียนเอง ต้องไม่กลายเป็นโค้ดในเบราว์เซอร์ของเจ้าหน้าที่
 *
 * เส้นทางที่พิสูจน์แล้วบนระบบที่รันอยู่ 2026-09-09 (ทุกขั้นยิงจริง ไม่ได้อ่านโค้ดเดา):
 *
 *   1. ผู้ยื่นบันทึกร่างของตัวเอง
 *      POST /api/applications/draft
 *        { formData: { documents: { id_card: "javascript:alert(document.domain)" } } }
 *      -> {"success":true}
 *   2. ค่าลงฐานข้อมูลจริง — ตรวจแถวตรง ๆ:
 *        formData.documents = {"id_card":"javascript:alert(document.domain)"}
 *      (คีย์ระดับบนอย่าง landRightDoc ถูกกรองทิ้ง คีย์ที่ซ้อนอยู่ไม่ถูก)
 *   3. ประตูของเจ้าหน้าที่คืนค่าเดิมกลับมา
 *      GET /api/provider/applications/:id
 *      -> formData.documents {"id_card": "javascript:alert(document.domain)"}
 *   4. resolveDocumentUrl() คืนสตริงนั้นตรง ๆ แล้ว documents-tab-panel.tsx:82
 *      แสดงเป็น <a href={url} target="_blank">เปิด</a>
 *
 * เจ้าหน้าที่กดปุ่ม "เปิด" = โค้ดของผู้ยื่นรันบน origin ของแพลตฟอร์ม พร้อมเซสชันของ
 * เจ้าหน้าที่คนนั้น · หน้าเดียวกันนั้นมีรายชื่อคำขอของทุกคนอยู่แล้ว
 *
 * เทสนี้ตรึงสองชั้น: ตัวแปลงที่หน้าจอใช้จริง (เรียกฟังก์ชันตรง ๆ) และจุด JSX ที่เหลือ
 * ซึ่งยังไม่มี renderer ให้ทดสอบ จึงตรวจจากไฟล์ — แต่ตรวจว่า "ค่าดิบไม่ถึง href/src"
 * ไม่ใช่ตรวจว่า "มีคำว่า safeUrl อยู่ในไฟล์" ซึ่งผ่านได้โดยที่ของจริงยังรั่ว
 */

import fs from 'fs';
import path from 'path';

import { resolveDocumentUrl } from '@/app/provider/applications/[id]/provider-application-detail-config';

const SRC = path.join(__dirname, '..', '..');

/** ค่าที่เก็บลงฐานข้อมูลได้จริงในการวัดข้างบน */
const STORED_PAYLOAD = 'javascript:alert(document.domain)';

describe('ตัวแปลงที่หน้าเอกสารของเจ้าหน้าที่ใช้', () => {
  it('ค่าที่ผู้ยื่นเก็บไว้จริง ไม่กลายเป็นลิงก์', () => {
    expect(resolveDocumentUrl({ documents: { id_card: STORED_PAYLOAD } }, 'id_card')).toBeNull();
  });

  it('กันทุกที่ที่ตัวแปลงมองหา ไม่ใช่แค่ชั้นบนสุด', () => {
    for (const shape of [
      { id_card: STORED_PAYLOAD },
      { documents: { id_card: STORED_PAYLOAD } },
      { applicantData: { id_card: STORED_PAYLOAD } },
      { uploadedDocuments: { id_card: STORED_PAYLOAD } },
    ]) {
      expect(resolveDocumentUrl(shape, 'id_card')).toBeNull();
    }
  });

  it('เอกสารจริงยังเปิดได้ — ไม่มีการเข้าถึงที่หายไป', () => {
    const real = '/uploads/application-drafts/1788908107272-doc.pdf';
    expect(resolveDocumentUrl({ documents: { id_card: real } }, 'id_card')).toBe(real);
    expect(resolveDocumentUrl({ id_card: real }, 'id_card')).toBe(real);
  });

  it('ไม่มีเอกสาร = null เหมือนเดิม (หน้าจอแสดงป้าย Missing)', () => {
    expect(resolveDocumentUrl({}, 'id_card')).toBeNull();
    expect(resolveDocumentUrl(undefined, 'id_card')).toBeNull();
  });
});

describe('ไม่มีจุด render ไหนรับค่าดิบเข้า href หรือ src', () => {
  /** ตัวแปรที่พิสูจน์แล้วว่าถือค่าที่ผู้ยื่นเขียนได้ */
  const TAINTED = ['document.url', 'att.url', 'previewDocUrl', 'docViewUrl'];

  const FILES = [
    'app/provider/applications/[id]/documents-tab-panel.tsx',
    'app/provider/audits/[id]/audit-application-tab-panel.tsx',
    'components/application/application-document-view.tsx',
  ];

  it.each(FILES)('%s', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    const offenders: string[] = [];
    for (const name of TAINTED) {
      // href={x} / src={x} ที่ x คือตัวแปรดิบตรง ๆ (ยอมรับ ?? undefined ต่อท้าย
      // เพราะมันไม่ได้เปลี่ยนค่า) — ต้องไม่มีเหลือแม้ตัวเดียว
      const raw = new RegExp(
        `(href|src)=\\{\\s*${name.replace('.', '\\.')}\\s*(\\?\\?\\s*undefined\\s*)?\\}`,
        'g',
      );
      for (const m of src.matchAll(raw)) { offenders.push(m[0]); }
    }
    expect(offenders).toEqual([]);
  });

  it('ทุกจุดที่ยัง render ค่าเหล่านั้น ผ่านตัวกรองเสมอ', () => {
    for (const rel of FILES) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      for (const m of src.matchAll(/(?:href|src)=\{([^}]*)\}/g)) {
        const expr = m[1];
        const usesTainted = TAINTED.some((t) => expr.includes(t));
        if (!usesTainted) { continue; }
        expect({ rel, expr }).toEqual({ rel, expr: expect.stringMatching(/safe(Url|Src)\(/) });
      }
    }
  });
});
