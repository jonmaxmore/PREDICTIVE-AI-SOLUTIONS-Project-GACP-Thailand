/**
 * fix/fee-line-descriptions (operator 2026-10-03) — the pricing page and the
 * ToS fee clause name each charge, and say what it covers, from the server's
 * catalogue (GET /api/pricing/fees `services`). Phase 2 covers no inspector
 * travel, lodging or honoraria — the page used to say it did.
 *
 * The served coverage here differs from the web fallback on purpose, so a page
 * that reads its own copy instead of the server fails.
 */

import * as React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import PricingPage from '@/app/(marketing)/pricing/page';
import TermsOfServicePage from '@/app/(marketing)/terms-of-service/page';

const SERVED_SERVICES = {
  PHASE_1: { name: 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร', nameEn: 'Instalment 1 served', coverage: 'ครอบคลุม: ข้อความงวดหนึ่งจากเซิร์ฟเวอร์', coverageEn: 'Covers: served one' },
  PHASE_2: { name: 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง', nameEn: 'Instalment 2 served', coverage: 'ครอบคลุม: ข้อความงวดสองจากเซิร์ฟเวอร์', coverageEn: 'Covers: served two' },
  RENEWAL: { name: 'ค่าบริการต่ออายุใบรับรอง', nameEn: 'Renewal served', coverage: 'ครอบคลุม: ข้อความต่ออายุจากเซิร์ฟเวอร์', coverageEn: 'Covers: served renewal' },
  VAT: { name: 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน', nameEn: 'VAT 7% on the whole service fee' },
};

const SERVER = {
  applicationFee: 6_000,
  inspectionFee: 30_000,
  renewalFee: 40_000,
  renewalTotalPerScope: 42_800,
  renewalChargeCount: 1,
  currency: 'THB',
  vatRate: 0.07,
  phase1TotalPerScope: 6_420,
  phase2TotalPerScope: 32_100,
  services: SERVED_SERVICES,
};

const fetchMock = jest.fn<(input: unknown, init?: unknown) => Promise<unknown>>();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
});
const serveOk = () => fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: SERVER }) });
const serveDown = () => fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

function textOf(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').replace(/\s+/g, ' ');
}
async function renderServer(Page: () => unknown): Promise<string> {
  return textOf(renderToStaticMarkup((await Page()) as React.ReactElement));
}
const th = (n: number) => n.toLocaleString('th-TH');
const NOT_COVERED = /ค่าเดินทาง|ค่าที่พัก|ค่าตอบแทน|ค่าพาหนะ/;

describe('pricing page names and covers each charge from the server', () => {
  it('prints the served name and coverage for both instalments and renewal', async () => {
    serveOk();
    const text = await renderServer(PricingPage as () => unknown);
    for (const key of ['PHASE_1', 'PHASE_2', 'RENEWAL'] as const) {
      expect(text).toContain(SERVED_SERVICES[key].name);
      expect(text).toContain(SERVED_SERVICES[key].coverage);
      expect(text).toContain(SERVED_SERVICES[key].nameEn);
    }
    expect(text).not.toMatch(NOT_COVERED);
    // amounts unchanged: still the served ones
    expect(text).toContain(`${th(6_420)} บาท`);
    expect(text).toContain(`${th(32_100)} บาท`);
    expect(text).toContain(`${th(42_800)} บาท`);
  });

  it('when the server is down the names still print (one web mirror), no amount, no travel claim', async () => {
    serveDown();
    const text = await renderServer(PricingPage as () => unknown);
    expect(text).toContain('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
    expect(text).toContain('งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
    expect(text).toContain('ค่าบริการต่ออายุใบรับรอง');
    expect(text).toContain('ครอบคลุม: นัดหมายและตรวจประเมินแปลงปลูก ณ สถานที่จริง');
    expect(text).not.toMatch(/[0-9][0-9,]*\s*บาท/);
    expect(text).not.toMatch(NOT_COVERED);
  });
});

describe('ToS fee clause names and covers each charge from the server', () => {
  it('states the served names, their coverage and the served amounts', async () => {
    serveOk();
    const text = await renderServer(TermsOfServicePage as () => unknown);
    expect(text).toContain(`${SERVED_SERVICES.PHASE_1.name} ${th(6_000)} บาท`);
    expect(text).toContain(`${SERVED_SERVICES.PHASE_2.name} ${th(30_000)} บาท`);
    expect(text).toContain(`${SERVED_SERVICES.RENEWAL.name} ${th(40_000)} บาท`);
    for (const key of ['PHASE_1', 'PHASE_2', 'RENEWAL'] as const) {
      expect(text).toContain(SERVED_SERVICES[key].coverage);
    }
    expect(text).toContain(`รวม ${th(6_420)} บาท`);
    expect(text).toContain(`รวม ${th(32_100)} บาท`);
    expect(text).toContain(`รวม ${th(42_800)} บาท`);
    expect(text).not.toMatch(NOT_COVERED);
  });
});
