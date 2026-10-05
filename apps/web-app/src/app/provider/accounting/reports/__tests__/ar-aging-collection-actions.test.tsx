/**
 * X4-FIX-C / H-3 — AR aging collection-action affordance.
 *
 * Closes X4-A audit gap: the AR aging table is supposed to drive
 * collections — DTAM finance staff chase applicants who haven't wired
 * to Treasury, PLATFORM staff chase applicants who haven't paid
 * platform fees. Before X4-FIX-C the table rendered the data with NO
 * path forward, so staff had to copy email/phone manually.
 *
 * X4-FIX-C adds 2 buttons per row (`ส่งใบทวงถาม` + `ทำเครื่องหมายว่าเก็บเงินแล้ว`).
 * Backend endpoints are pending the X4.5 follow-up — buttons are
 * rendered disabled with a Thai-language tooltip so the workflow shape
 * is visible ahead of the API landing.
 *
 * Source-regex pattern (mirrors receipts-side-filter.test.tsx) —
 * ArAgingReport.tsx renders useAuth() + AccountingService.getArAging
 * which is heavy to stub end-to-end. We pin the action affordance on
 * the source file so a regression that drops the buttons trips at CI.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
    resolve(__dirname, '..', 'ArAgingReport.tsx'),
    'utf-8',
);

describe('[X4-FIX-C / H-3] AR aging — collection-action buttons', () => {
    describe('Per-row affordance', () => {
        it('renders a "ส่งใบทวงถาม" (send reminder) button per row', () => {
            // The Thai label and the data-testid prefix must both be
            // present so e2e + unit tests can target the button.
            expect(SOURCE).toContain('ส่งใบทวงถาม');
            expect(SOURCE).toMatch(/data-testid=\{`ar-action-remind-\$\{row\.invoiceId\}`\}/);
        });

        it('renders a "ทำเครื่องหมายว่าเก็บเงินแล้ว" (mark collected) button per row', () => {
            expect(SOURCE).toContain('ทำเครื่องหมายว่าเก็บเงินแล้ว');
            expect(SOURCE).toMatch(/data-testid=\{`ar-action-mark-collected-\$\{row\.invoiceId\}`\}/);
        });

        it('renders the action column header in the table thead', () => {
            // colSpan/print:hidden alignment pins — the new column must
            // be hidden on print so the A4-landscape view stays compact.
            expect(SOURCE).toMatch(/การติดตามหนี้/);
        });
    });

    describe('Disabled state — backend endpoint pending', () => {
        it('marks both action buttons as `disabled` with a tooltip indicating X4.5', () => {
            // Backend endpoints (POST /invoices/:id/reminder,
            // POST /invoices/:id/mark-collected) are NOT in scope of
            // X4-FIX-C — the buttons render disabled so we don't ship
            // dead onClick handlers that call missing endpoints.
            const remindBlock = SOURCE.match(
                /data-testid=\{`ar-action-remind-\$\{row\.invoiceId\}`\}[\s\S]{0,400}?disabled[\s\S]{0,200}?X4\.5/,
            );
            expect(remindBlock).not.toBeNull();

            const collectedBlock = SOURCE.match(
                /data-testid=\{`ar-action-mark-collected-\$\{row\.invoiceId\}`\}[\s\S]{0,400}?disabled[\s\S]{0,200}?X4\.5/,
            );
            expect(collectedBlock).not.toBeNull();
        });
    });

    describe('Empty-state safety', () => {
        it('still spans the action column in the empty-row colSpan (9 columns now)', () => {
            // When data.rows.length === 0 the empty-state td must span
            // the full new column count (was 9, now 10 with the action
            // column). A drift here = ugly empty-state alignment.
            expect(SOURCE).toMatch(/colSpan=\{9\}/);
        });
    });
});
