/**
 * fix/fee-line-descriptions (operator 2026-10-03) — the review card names each
 * instalment by the catalogue's service name AND says what it covers, read from
 * the server (GET /applications/:id/quotations `copy.services`), not just the
 * cultivation-type label. A renewal is one service: no งวดที่ 1 block.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { QuotationRecord, QuotationsBySide } from '@/lib/services/payment-service';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

import QuotationReviewSection from '../QuotationReviewSection';

const P1 = {
  name: 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร',
  nameEn: 'x',
  coverage: 'ครอบคลุม: รับและตรวจความครบถ้วน ความถูกต้องของเอกสารคำขอตามหลักเกณฑ์ GACP · ตรวจเบื้องต้นด้วยระบบ · แจ้งผลและรับเอกสารแก้ไข · จัดเก็บเอกสารอิเล็กทรอนิกส์ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์',
  coverageEn: 'x',
};
const P2 = {
  name: 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง',
  nameEn: 'x',
  coverage: 'ครอบคลุม: นัดหมายและตรวจประเมินแปลงปลูก ณ สถานที่จริง · บันทึกหลักฐานการตรวจ · ออกใบรับรองอิเล็กทรอนิกส์พร้อมลายมือชื่อดิจิทัลและ QR ตรวจสอบย้อนกลับ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์',
  coverageEn: 'x',
};
const RN = {
  name: 'ค่าบริการต่ออายุใบรับรอง',
  nameEn: 'x',
  coverage: 'ครอบคลุม: ตรวจประเมินเพื่อต่ออายุ · ออกใบรับรองฉบับใหม่พร้อมลายมือชื่อดิจิทัลและ QR · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์',
  coverageEn: 'x',
};
const VAT = { name: 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน', nameEn: 'x' };

function row(overrides: Partial<QuotationRecord>): QuotationRecord {
  return {
    id: 'q-1',
    applicationId: 'app-1',
    issuerType: 'PLATFORM',
    quotationNumber: 'QT-PRD-2026-000001',
    subtotal: 33000,
    vat: 2310,
    totalAmount: 35310,
    status: 'PENDING',
    createdAt: '2026-10-03T00:00:00.000Z',
    lineItems: [
      { method: 'OUTDOOR', label: 'กลางแจ้ง', phase1Amount: 5885, phase2Amount: 29425, netAmount: 33000, taxAmount: 2310 },
    ],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(quotations: QuotationsBySide): Promise<string> {
  await act(async () => {
    root.render(<QuotationReviewSection applicationId="app-1" quotations={quotations} />);
  });
  return (container.textContent || '').replace(/\s+/g, ' ');
}

describe('the review card names the service and its coverage', () => {
  it('new filing: both instalments by name, each with its coverage, amounts unchanged', async () => {
    const text = await render({
      dtam: null,
      platform: row({}),
      copy: { intro: 'i', note: 'n', services: { PHASE_1: P1, PHASE_2: P2, VAT } },
    });
    expect(text).toContain(P1.name);
    expect(text).toContain(P1.coverage);
    expect(text).toContain(P2.name);
    expect(text).toContain(P2.coverage);
    // the type label stays, amounts are the row's
    expect(text).toContain('กลางแจ้ง');
    expect(text).toMatch(/5,885\.00/);
    expect(text).toMatch(/29,425\.00/);
    expect(text).toMatch(/35,310\.00/);
  });

  it('renewal: one service, named and covered; no งวดที่ 1 block', async () => {
    const text = await render({
      dtam: null,
      platform: row({
        lineItems: [{ method: 'OUTDOOR', label: 'กลางแจ้ง', phase1Amount: 0, phase2Amount: 35310, netAmount: 33000, taxAmount: 2310 }],
      }),
      copy: { intro: 'i', note: 'n', services: { PHASE_1: null, PHASE_2: RN, VAT } },
    });
    expect(text).toContain(RN.name);
    expect(text).toContain(RN.coverage);
    expect(text).not.toContain(P1.name);
    expect(text).not.toContain('งวดที่ 2');
    expect(text).toMatch(/35,310\.00/);
  });

  it('never says the fee covers inspector travel, lodging or honoraria', async () => {
    const text = await render({
      dtam: null,
      platform: row({}),
      copy: { intro: 'i', note: 'n', services: { PHASE_1: P1, PHASE_2: P2, VAT } },
    });
    expect(text).not.toMatch(/ค่าเดินทาง|ค่าที่พัก|ค่าตอบแทน|ค่าพาหนะ/);
  });
});
