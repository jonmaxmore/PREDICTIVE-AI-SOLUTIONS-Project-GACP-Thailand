/**
 * X4-FIX-C / UX-D6, RETIRED by operator 2026-09-11 — accounting export
 * dropdown no longer has a side filter.
 *
 * UX-D6 used to gate two of three export buttons by accountSide: DTAM
 * staff could not see the VAT (ภ.พ.30) export (state fees were VAT-exempt,
 * ม.81/3 + ม.65/2) and PLATFORM staff could not see the gov-remittance
 * export (Wallet A belonged to the DTAM treasury channel).
 *
 * Operator 2026-09-11 retired both the two-sided fee split and Wallet A/B:
 * "finance ต้องเห็นเหมือนกัน ... เพื่อแสดงความโปร่งใส" / "เราไม่มี wallet A/B แล้ว".
 * There is no more government-fee side to exempt from VAT and no more
 * treasury wallet to keep off the platform side, so the export MENU renders
 * the same two buttons (monthly, tax) for every role with no accountSide
 * gate on either one, and no gov_remittance button exists to click. (The
 * literal string 'gov_remittance' still sits in handleFinancialExport's
 * filename lookup table below the menu — a dead entry nothing in the menu
 * calls; this suite guards the menu, not that table.)
 * Per "superseded designs leave no trace": this suite now pins the CURRENT
 * rule (same two exports, same set, for every finance role) instead of
 * asserting the retired gate.
 *
 * Source-regex pattern (mirrors receipts-side-filter.test.tsx) — the
 * `useAuth() + apiClient + Radix Dialog` stack that portals away in
 * jsdom, so we assert the wiring directly on the source file instead of
 * mounting the whole page.
 *
 * The dashboard JSX lives in accounting-dashboard-client.tsx (page.tsx is a
 * thin wrapper), so the export wiring this suite pins lives in the client file.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
    resolve(__dirname, '..', 'accounting-dashboard-client.tsx'),
    'utf-8',
);

describe('[X4-FIX-C / UX-D6 retired 2026-09-11] accounting export dropdown — no side filter', () => {
    describe('Source-level wiring', () => {
        it('has no accountant side at all — one title and one export menu for every viewer (2026-09-27)', () => {
            // เดิม: ตรึงว่าหน้ายังอ่าน getAccountSide(user?.role) เพื่อตั้งหัวข้อตามฝั่ง ·
            // หัวข้อตามฝั่งถูกลบแล้ว (finance-one-view.test.tsx พิสูจน์ด้วยการ render จริง)
            expect(SOURCE).not.toMatch(/getAccountSide|accountSide/);
        });

        // Scope the checks below to the export-dropdown JSX block itself
        // (from just before its wrapper div through the next sibling
        // section, TabNav) rather than a fixed lookback window from each
        // button's testid. A fixed window can sit inside a conditional
        // that wraps the WHOLE menu (the div is ~700 chars before the
        // second button) and miss it entirely; scanning the whole block
        // catches a gate on the div, on either button, or hidden/disabled
        // props on a button tag, and both ==/=== and single/double quotes.
        const dropdownIdx = SOURCE.indexOf('data-testid="accounting-export-dropdown"');
        const tabNavIdx = SOURCE.indexOf('<TabNav');
        const dropdownBlock = SOURCE.slice(Math.max(0, dropdownIdx - 300), tabNavIdx);
        const accountSideGate = /accountSide\s*(={2,3}|!={1,2})\s*(['"])(DTAM|PLATFORM)\2/;

        it('renders the SAME two export buttons for every finance role — no accountSide gate wraps the menu or either button', () => {
            // The tax (ภ.พ.30) export used to be PLATFORM-only and the
            // gov_remittance export DTAM-only. Both gates are retired:
            // every finance role now sees the same export set.
            expect(dropdownIdx).toBeGreaterThan(-1);
            expect(tabNavIdx).toBeGreaterThan(dropdownIdx);
            expect(dropdownBlock).toContain('data-testid="export-btn-monthly"');
            expect(dropdownBlock).toContain('data-testid="export-btn-tax"');
            expect(dropdownBlock).not.toMatch(accountSideGate);
        });

        it('no button in the export menu triggers gov_remittance — Wallet A/B is retired', () => {
            // Checks the call site, not just the testid string: a button
            // under any other testid calling handleFinancialExport('gov_remittance')
            // would still contain the literal 'gov_remittance' inside this
            // block, so this catches that too.
            expect(dropdownBlock).not.toMatch(/gov_remittance/);
            expect(dropdownBlock).not.toMatch(/export-btn-gov/);
        });

        it('leaves the monthly summary export ungated (both sides need it)', () => {
            // Pin: monthly revenue is a SHARED export — must not be
            // wrapped in a side conditional. Both DTAM and PLATFORM need
            // a per-month revenue sheet.
            expect(SOURCE).toContain('data-testid="export-btn-monthly"');
            // The 200 chars immediately before the monthly button must NOT
            // contain an accountSide conditional that gates it.
            const idx = SOURCE.indexOf('data-testid="export-btn-monthly"');
            const before = SOURCE.slice(Math.max(0, idx - 200), idx);
            expect(before).not.toMatch(/accountSide !==\s*'(DTAM|PLATFORM)'\s*\?/);
        });

        it('the dead gov_remittance filename-lookup entry is deleted, not just uncalled (one-fee residue sweep 2026-09-26)', () => {
            // Was carried as a dead entry ("nothing in the menu calls it") after
            // the button itself was removed 2026-09-11. Superseded designs leave
            // no trace: the orphaned map key comes out too.
            expect(SOURCE).not.toMatch(/gov_remittance/);
        });
    });

    describe('Comment trail — design intent', () => {
        it('cites the operator ruling date (2026-09-11) that retired the side split', () => {
            // Defense against future regressions — anyone re-adding a side
            // conditional around an export button should see this comment
            // and the ruling it cites before doing so.
            expect(SOURCE).toMatch(/2026-09-11/);
        });

        it('states there is no wallet A/B left — the fact the retired gate depended on', () => {
            expect(SOURCE).toMatch(/wallet A\/B/);
        });

        it('names no "state-fee lane" / "platform-fee lane" for the /dtam and /platform entrypoints (one-fee residue sweep 2026-09-26)', () => {
            // operator 2026-09-11: one ค่าบริการ, no fee-lane split. The two
            // routes are still each finance role's own entrypoint (unchanged,
            // separate task), but the header comment must not call them fee
            // "lanes".
            expect(SOURCE).not.toMatch(/state-fee lane/);
            expect(SOURCE).not.toMatch(/platform-fee lane/);
        });
    });
});
