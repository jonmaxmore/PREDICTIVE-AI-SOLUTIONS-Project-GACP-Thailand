/**
 * เอกสารการเงินมีสามใบ ไม่ใช่สี่
 *
 * มติ operator 2026-09-05 (`docs/design/2026-09-05-finance-documents-design.md` §2)
 * เขียนไว้ตรงตัวว่า **"ไม่มีใบที่ 4"**:
 *   1. ใบเสนอราคา (QT-PRD-)
 *   2. ใบวางบิล / ใบแจ้งหนี้ (INV-PRD-) — สองชื่อนี้คือใบเดียวกัน
 *   3. ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป (TAX-PRD-) — ป.รัษฎากร ม.86/4 ผูกที่ใบนี้ใบเดียว
 *
 * หน้าชำระเงินของเกษตรกรยังวาดแถบสี่ใบ โดยแยก "ใบเสร็จรับเงิน" ออกจาก "ใบกำกับภาษี" ·
 * เห็นตอนเดินจริงผ่านเบราว์เซอร์ 2026-09-06 · เกษตรกรที่อ่านแถบนี้จะรอเอกสารที่ไม่มีวันมา
 * และการนับใบผิดคือการบอกจำนวนหลักฐานทางภาษีผิด
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'client-view.tsx'), 'utf8');

/** เฉพาะโค้ด ไม่รวมคอมเมนต์ — คำอธิบายว่าทำไมใบที่ 4 หายไป ต้องไม่ถูกอ่านว่ามันยังอยู่ */
const CODE = SOURCE
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('แถบขั้นตอนเอกสารการเงิน', () => {
    it('มีสามใบ', () => {
        const labels = [...CODE.matchAll(/sublabel: '([^']+)'/g)].map((m) => m[1]);
        expect(labels).toEqual(['Quotation', 'Invoice', 'Receipt / Tax Invoice']);
    });

    it('ใบที่ 2 พูดทั้งสองชื่อ เพราะเป็นใบเดียวกัน', () => {
        expect(CODE).toContain('ใบวางบิล / ใบแจ้งหนี้');
    });

    it('ใบที่ 3 รวมใบเสร็จกับใบกำกับภาษีไว้ด้วยกัน', () => {
        expect(CODE).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี');
    });

    it('คำอธิบายใต้แถบก็เล่าสามใบ ไม่ใช่สี่', () => {
        // ข้อความนี้เคยเล่าสี่ขั้น "…จะออกใบเสร็จอัตโนมัติ → พร้อมใบกำกับภาษี…"
        expect(CODE).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษี</strong>ให้อัตโนมัติในใบเดียวกัน');
        expect(CODE).not.toContain('พร้อม<strong>ใบกำกับภาษี</strong>');
    });

    it('ไม่มีใบที่ 4 แยกต่างหากอีกแล้ว', () => {
        const standaloneTax = /label: 'ใบกำกับภาษี'/.test(CODE);
        const standaloneReceipt = /label: 'ใบเสร็จรับเงิน'/.test(CODE);
        expect(standaloneTax || standaloneReceipt).toBe(false);
    });
});
