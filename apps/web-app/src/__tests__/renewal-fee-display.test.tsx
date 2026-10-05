/**
 * W12 (frontend) — a screen showing the renewal fee shows what is actually due.
 *
 * Operator rulings 2026-08-22 (the change log @ 67ef3612 and @ 851fd516):
 * a renewal is ONE charge; 30,000 is its pre-VAT, pre-platform BASE.
 *
 * Before this change the wizard printed a bare 30,000 under "รวมทั้งสิ้น",
 * "ยอดรวมที่ต้องชำระ" and "จำนวนเงินที่ต้องชำระ", with a note claiming
 * "(ราคารวมภาษีมูลค่าเพิ่ม)" — VAT included. None of that was true: 30,000 is
 * the base and 33,210 is the amount due.
 *
 * The backend half (apps/backend/__tests__/unit/renewal-fee-ssot.test.js) holds
 * these numbers against the billing source. This suite guards the screens.
 */

import * as React from 'react';
import { describe, expect, it, jest, beforeAll, afterAll } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Envelope = { success: boolean; data?: unknown };
const mockGet = jest.fn<(url: string) => Promise<Envelope>>();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (url: string) => mockGet(url) },
}));

import { PaymentStep } from '@/app/health/applications/renewal/payment-step';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { resolveRenewalFee, type PublicFees } from '@/hooks/use-pricing';

const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

/**
 * 2026-10-03 (fix/fees-from-server): the web no longer holds renewal numbers.
 * The first describe here used to pin the web's literal renewal base and its
 * VAT gross-up against other web literals. Those literals are gone; the
 * relation base -> payable is the backend's and is pinned there
 * (apps/backend/__tests__/unit/renewal-fee-ssot.test.js G/H), and "the web
 * declares no fee" is pinned by no-screen-imports-a-literal-fee.test.ts.
 * What stays here is the screen half: the payable is shown, never the base.
 */
const SERVED: PublicFees = {
    applicationFee: 6_000,
    inspectionFee: 30_000,
    renewalFee: 40_000,
    renewalTotalPerScope: 42_800,
    phase1TotalPerScope: 6_420,
    phase2TotalPerScope: 32_100,
    vatRate: 0.07,
};

describe('W12 — resolveRenewalFee never hands a screen the base alone', () => {
    it('hands over the served base and payable together', () => {
        expect(resolveRenewalFee(SERVED)).toEqual({ base: 40_000, payable: 42_800 });
    });

    it('hands over nothing when the server has not answered: no remembered number', () => {
        expect(resolveRenewalFee(null)).toBeNull();
    });
});

describe('W12 — the payment screen shows the amount due, not the base', () => {
    let html = '';
    let container: HTMLDivElement;
    let root: Root;

    beforeAll(async () => {
        mockGet.mockResolvedValue({ success: true, data: SERVED });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root.render(
                <LanguageProvider>
                    <PaymentStep
                        renewalId="renewal-w12"
                        isDark={false}
                        onBack={() => undefined}
                        onConfirm={() => undefined}
                    />
                </LanguageProvider>,
            );
        });
        await act(async () => {
            await Promise.resolve();
        });
        html = container.innerHTML;
    });

    afterAll(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('prints the served payable total, not the served base', () => {
        expect(html).toContain('42,800');
        expect(html).not.toContain('40,000');
    });

    /**
     * มติ operator 2026-09-12: "เรารวมเป็นแจ้งว่าค่าบริการ แยกตามวัตถุประสงค์การปลูก"
     *
     * W12 เกิดมาเพื่อกันจอที่พิมพ์ฐาน 30,000 ลอย ๆ โดยไม่บอกว่ามันคืออะไร — วิธีแก้ตอนนั้น
     * คือบังคับให้มีป้าย "ก่อน VAT" กำกับฐานเสมอ · ตอนนี้จอไม่แสดงฐานแยกอีกแล้ว จึงไม่มี
     * ตัวเลขให้อ่านผิดตั้งแต่ต้น ซึ่งแน่นกว่าการติดป้ายกำกับ
     *
     * หมุดจึงย้ายจาก "ต้องมีป้ายกำกับฐาน" เป็น "ต้องไม่มีฐานโผล่ และยอดที่แสดงต้องบอกว่า
     * รวมภาษีแล้ว" — เจตนาเดิมทั้งดุ้น
     */
    it('แสดงยอดที่ต้องชำระจริง พร้อมบอกว่ารวมภาษีแล้ว', () => {
        expect(html).toContain('รวมภาษีมูลค่าเพิ่มแล้ว');
    });

    it('ไม่พิมพ์ฐานค่าธรรมเนียมแยกออกมาให้อ่านผิด', () => {
        expect(html).not.toContain('ฐานค่าธรรมเนียม');
        expect(html).not.toContain('ค่าบริการแพลตฟอร์ม');
    });

    it('says the charge happens once', () => {
        expect(html).toContain('ชำระครั้งเดียว');
    });
});

describe('W12 — no renewal screen prints a bare base any more', () => {
    /*
      F-G4-64 final round R23 — the renewal quotation screen no longer prints a
      fee AT ALL. It used to invent a document in the browser (a `QT-${Date.now()}`
      number, a client-side validUntil and a live-fee table); it now renders the
      register's real row through the payments card, which reads its figures
      from the row. A screen that prints no fee cannot print a bare base, so
      the two guards below are the wrong question to ask of it — the right one
      is asked in its own `it` beneath.
    */
    // Round 1 (2026-10-03): invoice-step left this list. It no longer prints a
    // catalogue price at all, only the register's invoice (or quotation) total
    // for this renewal: renewal-invoice-step-shows-the-server-document.test.tsx.
    const SCREENS = [
        'app/health/applications/renewal/payment-step.tsx',
    ];

    it.each(SCREENS)('%s reads the fee through the resolver, not the raw constant', (screen) => {
        const src = read(screen);
        expect(src).toMatch(/useRenewalFee\(\)/);
        // RENEWAL_FEE is the bare base. A screen importing it can print it
        // alone, which is the defect this work item exists to close.
        expect(src).not.toMatch(/\bRENEWAL_FEE\b/);
    });

    it.each(SCREENS)('%s renders the payable total', (screen) => {
        expect(read(screen)).toMatch(/fee\.payable/);
    });

    it('the quotation screen states no fee of its own — it shows the register row', () => {
        const src = read('app/health/applications/renewal/quotation-step.tsx');
        // No fee hook, no fee arithmetic, no bare base: every figure on that
        // screen now comes from the quotation row the backend issued.
        expect(src).not.toMatch(/useRenewalFee|formatNumber\(fee/);
        expect(src).not.toMatch(/\bRENEWAL_FEE\b/);
        expect(src).toMatch(/QuotationReviewSection/);
    });

    it('no renewal screen claims the price includes VAT', () => {
        const th = read('lib/i18n/dictionaries/sections/th-health.ts');
        // The claim itself is what this guards, and it may not reappear
        // anywhere in the renewal dictionary — the `vatNote` key that carried
        // it is gone with the invented document (R23).
        expect(th).not.toContain('(ราคารวมภาษีมูลค่าเพิ่ม)');
        // คำแถลงของกติกาที่เหลืออยู่: พจนานุกรมต้องไม่มีป้ายที่กางองค์ประกอบบัญชี
        // (baseLabel / addonsLabel ถูกถอดออก 2026-09-12 ตามมติ operator) และป้ายเดียว
        // ที่เหลือต้องบอกตรง ๆ ว่ายอดนั้นรวมภาษีแล้ว
        expect(th).not.toMatch(/^\s*baseLabel:/m);
        expect(th).not.toMatch(/^\s*addonsLabel:/m);
        const serviceLabelLine = th.split(String.fromCharCode(10)).find((l) => l.trim().startsWith('serviceLabel:')) || '';
        expect(serviceLabelLine).toContain('รวมภาษีมูลค่าเพิ่มแล้ว');
    });
});

describe('W12 — a NEW application still shows its two phases, unchanged', () => {
    // RETIRED: plant-selection-config-panels.tsx was deleted with the superseded v1
    // wizard (749a97ee). The case has been reading a missing file and failing ever
    // since — a red that asserts nothing about today's code. The two-instalment split
    // it guarded is now pinned where it actually lives: the money engine
    // (apps/backend fee-service phase1/phase2) and the quotation document
    // (invoice-step toDocumentLines + DtamItemsTable's VAT/subtotal rows).

    it('and no per-method estimate constant is left for anyone to pick up', () => {
        // This used to check, by name, that CULTIVATION_FEE_PER_METHOD aliased
        // the new-application total and not the renewal fee. Both constants are
        // gone (2026-10-03): a new application's amounts come from the
        // quotation the backend issues, and any catalogue price on screen comes
        // from GET /api/pricing/fees. The stronger pin is that no alias exists.
        const config = read('app/health/applications/new/_steps/steps/plant-selection-config.ts');
        expect(config).not.toMatch(/export\s*\{[^}]*CULTIVATION_FEE_PER_METHOD/);
        expect(config).not.toMatch(/from\s+['"]@\/constants\/fees['"]/);
    });
});
