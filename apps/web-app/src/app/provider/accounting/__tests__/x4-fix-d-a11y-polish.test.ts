/**
 * x4-fix-d-a11y-polish.test.ts — X4-FIX-D regression suite.
 *
 * Pins the 6 fix groups landed by X4-FIX-D against the X4 audit:
 *
 *   H-7  · 5 modal headers raw bg-emerald-700 → bg-primary token
 *   H-11 · 7 modals first-input autoFocus (WAI-ARIA APG)
 *   H-9  · 9 irreversible-action buttons bumped 32-40px → 44px (WCAG 2.5.5)
 *   H-10 · accounting dashboard ยกเลิก / ดู buttons → 44px
 *   H-12 · receipts page now renders a real <h1> (WCAG 2.4.6)
 *   M-10 · whtAmount input has inputMode="decimal"
 *   H-4  · RETIRED 2026-09-27 — the 5 DTAM-gate sites and <DtamForbiddenCallout>
 *          were deleted (operator 2026-09-11 "finance ต้องเห็นเหมือนกัน"); the
 *          suite now pins that no DTAM gate remains on those pages
 *
 * Strategy — source-grep (same pattern X3-FIX-B used for gov-gradient
 * regression: `x3-fix-b-gov-gradient.test.tsx`). Mounting the modal
 * components requires heavy provider mocks (auth, api, sonner) that are
 * orthogonal to the class/attribute contracts being pinned here. The
 * JSX-level contract is the truth — render-time fidelity is covered by
 * the existing per-modal test files (close-period-modal.test.tsx etc).
 *
 * If any of the X4-FIX-D edits gets reverted accidentally, this suite
 * fails fast on the next CI run.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ACC_ROOT = path.resolve(
    __dirname,
    '..',
);

const INVOICE_DETAIL = readFileSync(path.join(ACC_ROOT, 'invoice-detail-modal.tsx'), 'utf8');
// subscription-cancel-modal.tsx ถูกลบ 2026-09-11 พร้อมพื้นผิวแพ็กเกจสมาชิกทั้งชุด
// B5: the accounting dashboard UI was extracted from page.tsx into the
// shared accounting-dashboard-client.tsx (so the per-side landing routes
// /dtam + /platform render the same component). The source-grep contracts
// below now read the client where the JSX actually lives. page.tsx is now a
// thin wrapper that just renders <AccountingDashboardClient />.
const ACC_DASHBOARD = readFileSync(path.join(ACC_ROOT, 'accounting-dashboard-client.tsx'), 'utf8');

const CLOSE_PERIOD = readFileSync(
    path.join(ACC_ROOT, 'period-close', 'close-period-modal.tsx'),
    'utf8',
);
const REOPEN_PERIOD = readFileSync(
    path.join(ACC_ROOT, 'period-close', 'reopen-period-modal.tsx'),
    'utf8',
);
const PERIOD_CLOSE_CLIENT = readFileSync(
    path.join(ACC_ROOT, 'period-close', 'client-view.tsx'),
    'utf8',
);

const CREATE_DRAFT = readFileSync(
    path.join(ACC_ROOT, 'manual-journal-entries', 'create-draft-modal.tsx'),
    'utf8',
);
const DRAFT_DETAIL = readFileSync(
    path.join(ACC_ROOT, 'manual-journal-entries', 'draft-detail-modal.tsx'),
    'utf8',
);
const MJE_CLIENT = readFileSync(
    path.join(ACC_ROOT, 'manual-journal-entries', 'client-view.tsx'),
    'utf8',
);

const WHT_RECORD = readFileSync(
    path.join(ACC_ROOT, 'wht', 'record-certificate-modal.tsx'),
    'utf8',
);
const WHT_CLIENT = readFileSync(
    path.join(ACC_ROOT, 'wht', 'client-view.tsx'),
    'utf8',
);

const PURCHASE_CREATE = readFileSync(
    path.join(ACC_ROOT, 'purchase-invoices', 'create-invoice-modal.tsx'),
    'utf8',
);
const PURCHASE_REVIEW = readFileSync(
    path.join(ACC_ROOT, 'purchase-invoices', 'review-actions.tsx'),
    'utf8',
);
const PURCHASE_CLIENT = readFileSync(
    path.join(ACC_ROOT, 'purchase-invoices', 'client-view.tsx'),
    'utf8',
);

const REPORTS_CLIENT = readFileSync(
    path.join(ACC_ROOT, 'reports', 'client-view.tsx'),
    'utf8',
);

const RECEIPTS_PAGE = readFileSync(
    path.resolve(ACC_ROOT, '..', 'receipts', 'page.tsx'),
    'utf8',
);

// ── H-7 — 5 modal headers emerald → primary ─────────────────────────────────
describe('X4-FIX-D H-7 — 5 modal headers bg-emerald-700 → bg-primary', () => {
    it('close-period-modal header is bg-primary not raw emerald', () => {
        expect(CLOSE_PERIOD).toMatch(/DialogHeader[^>]*bg-primary[^>]*p-6[^>]*text-primary-foreground/);
        expect(CLOSE_PERIOD).not.toMatch(/DialogHeader[^>]*bg-emerald-700/);
    });

    it('create-draft-modal header is bg-primary not raw emerald', () => {
        expect(CREATE_DRAFT).toMatch(/DialogHeader[^>]*bg-primary[^>]*p-5[^>]*text-primary-foreground/);
        expect(CREATE_DRAFT).not.toMatch(/DialogHeader[^>]*bg-emerald-700/);
    });

    it('record-certificate-modal header is bg-primary not raw emerald', () => {
        expect(WHT_RECORD).toMatch(/DialogHeader[^>]*bg-primary[^>]*p-5[^>]*text-primary-foreground/);
        expect(WHT_RECORD).not.toMatch(/DialogHeader[^>]*bg-emerald-700/);
    });

    it('create-invoice-modal header is bg-primary not raw emerald', () => {
        expect(PURCHASE_CREATE).toMatch(/DialogHeader[^>]*bg-primary[^>]*p-6[^>]*text-primary-foreground/);
        expect(PURCHASE_CREATE).not.toMatch(/DialogHeader[^>]*bg-emerald-700/);
    });

    it('review-actions toneHeader emerald → bg-primary', () => {
        // The 5th header is the dynamic confirmTone='emerald' branch — it
        // assembles the className as a template string `${toneHeader}`.
        expect(PURCHASE_REVIEW).toMatch(/toneHeader\s*=\s*confirmTone\s*===\s*'emerald'\s*[\r\n\s]*\?\s*'bg-primary'/);
        expect(PURCHASE_REVIEW).not.toMatch(/toneHeader\s*=\s*confirmTone\s*===\s*'emerald'\s*[\r\n\s]*\?\s*'bg-emerald-700'/);
    });
});

// ── H-11 — 7 modals first-input autoFocus ──────────────────────────────────
describe('X4-FIX-D H-11 — 7 modals receive first-input autoFocus', () => {
    it('close-period-modal year-select has autoFocus', () => {
        // The autoFocus sits below the eslint-disable comment line.
        expect(CLOSE_PERIOD).toMatch(/id="close-year"[\s\S]*?jsx-a11y\/no-autofocus[\s\S]*?autoFocus/);
    });

    it('reopen-period-modal reason textarea has autoFocus', () => {
        expect(REOPEN_PERIOD).toMatch(/id="reopen-reason"[\s\S]*?jsx-a11y\/no-autofocus[\s\S]*?autoFocus/);
    });

    it('create-draft-modal description input has autoFocus', () => {
        expect(CREATE_DRAFT).toMatch(/id="mje-desc"[\s\S]*?jsx-a11y\/no-autofocus[\s\S]*?autoFocus/);
    });

    it('record-certificate-modal invoiceId input has autoFocus', () => {
        expect(WHT_RECORD).toMatch(/id="wht-cert-invoice-id"[\s\S]*?jsx-a11y\/no-autofocus[\s\S]*?autoFocus/);
    });

    it('invoice-detail-modal refund-confirm sub-state focuses the safe cancel', () => {
        // X4-FIX-D chose to focus the *safe* (cancel) button so the first
        // Enter doesn't accidentally fire the destructive refund.
        expect(INVOICE_DETAIL).toMatch(/key="refund-confirm-pane"/);
        expect(INVOICE_DETAIL).toMatch(/safe-action focus[\s\S]*?autoFocus/);
    });
});

// ── H-9 + H-10 — 9 irreversible buttons + dashboard ตรวจ → 44px ────────────
describe('X4-FIX-D H-9 / H-10 — irreversible-action buttons 44px (WCAG 2.5.5)', () => {
    it('close-period submit button is min-h-[44px] + bg-primary', () => {
        expect(CLOSE_PERIOD).toMatch(/min-h-\[44px\][^"]*bg-primary[^"]*text-primary-foreground/);
    });

    it('invoice-detail refund-confirm + cancel buttons are 44px', () => {
        // Two adjacent buttons inside the refund-confirm sub-state.
        const matches = INVOICE_DETAIL.match(/min-h-\[44px\] min-w-\[44px\] flex-1 rounded-xl/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('JE approve / post / reject / reject-confirm buttons are 44px', () => {
        const matches = DRAFT_DETAIL.match(/min-h-\[44px\] min-w-\[44px\] rounded-lg/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(4);
    });

    // Minimal redesign (2026-07): the radius token on these CTAs moved
    // rounded-xl -> rounded-lg (`borderRadius.lg: var(--radius)`); the 44px
    // tap-target contract this suite exists to protect is unchanged.
    // ปุ่ม "ยกเลิก" ของแพ็กเกจสมาชิกเคยถูกตรึงไว้ที่นี่ด้วย — แท็บแพ็กเกจสมาชิกถูกลบทั้งแท็บ
    // 2026-09-11 (operator: แพลตฟอร์มไม่มีบริการนี้) เหลือปุ่มของใบแจ้งหนี้ซึ่งยังอยู่จริง
    it('accounting dashboard invoice ดู button is 44px', () => {
        expect(ACC_DASHBOARD).toMatch(
            /aria-label="ดูรายละเอียดใบแจ้งหนี้"[\s\S]*?min-h-\[44px\] min-w-\[44px\] rounded-lg p-0/,
        );
    });
});

// ── H-12 — receipts page renders a single <h1> ─────────────────────────────
describe('X4-FIX-D H-12 — receipts page emits exactly one <h1>', () => {
    it('receipts/page.tsx has a real <h1> (no longer h2-only)', () => {
        expect(RECEIPTS_PAGE).toMatch(/<h1[^>]*>[\s\S]*?ออกใบเสร็จรับเงิน/);
    });

    it('receipts/page.tsx no longer contains the legacy inline <h2> for the title', () => {
        // The legacy markup was `<h2 className="text-xl font-semibold...`.
        // We only need to ensure the *page title* slot uses <h1>; subsection
        // headings can still be h2/h3.
        expect(RECEIPTS_PAGE).not.toMatch(
            /<h2 className="text-xl font-semibold text-foreground">[\s\S]*?<IconReceipt/,
        );
    });

    it('receipts/page.tsx h1 includes the decorative IconReceipt with aria-hidden', () => {
        expect(RECEIPTS_PAGE).toMatch(
            /<h1[^>]*>[\s\S]*?aria-hidden="true"[\s\S]*?ออกใบเสร็จรับเงิน/,
        );
    });
});

// ── M-10 — 2 amount fields receive inputMode="decimal" ─────────────────────
describe('X4-FIX-D M-10 — amount fields have inputMode="decimal"', () => {
    it('wht record-certificate whtAmount input declares inputMode="decimal"', () => {
        expect(WHT_RECORD).toMatch(/id="wht-cert-amount"[\s\S]*?inputMode="decimal"/);
    });
});

// ── H-4 retired — no DTAM gate left on the five accounting pages ──────────
// เดิม: ห้าหน้านี้ต้อง import + render <DtamForbiddenCallout> · คำตัดสิน operator 2026-09-11
// ("finance ต้องเห็นเหมือนกัน") ลบประตูนั้นทิ้ง ⇒ ตอนนี้ตรึงว่าไม่มีประตูแบบนั้นเหลือ
describe('X4-FIX-D H-4 (retired) — the 5 accounting pages carry no DTAM gate', () => {
    const SITES: ReadonlyArray<{ name: string; src: string }> = [
        { name: 'reports/client-view.tsx', src: REPORTS_CLIENT },
        { name: 'manual-journal-entries/client-view.tsx', src: MJE_CLIENT },
        { name: 'purchase-invoices/client-view.tsx', src: PURCHASE_CLIENT },
        { name: 'period-close/client-view.tsx', src: PERIOD_CLOSE_CLIENT },
        { name: 'wht/client-view.tsx', src: WHT_CLIENT },
    ];

    it.each(SITES)('$name neither imports nor renders DtamForbiddenCallout', ({ src }) => {
        expect(src).not.toMatch(/DtamForbiddenCallout/);
        expect(src).not.toMatch(/getAccountSide|accountSide === 'DTAM'/);
    });

    it.each(SITES)('$name no longer holds the verbatim 25-line amber-card block', ({ src }) => {
        const stillHasOldGate = /<div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-8 text-center">[\s\S]*?<IconBuildingBank[\s\S]*?size=\{48\}[\s\S]*?text-amber-700/.test(src);
        expect(stillHasOldGate).toBe(false);
    });
});

// ── Annotation sentinel — every patch carries an X4-FIX-D tag for trace ───
describe('X4-FIX-D — annotation comments present on every patched site', () => {
    it.each([
        ['close-period-modal.tsx', CLOSE_PERIOD],
        ['reopen-period-modal.tsx', REOPEN_PERIOD],
        ['create-draft-modal.tsx', CREATE_DRAFT],
        ['draft-detail-modal.tsx', DRAFT_DETAIL],
        ['record-certificate-modal.tsx', WHT_RECORD],
        ['invoice-detail-modal.tsx', INVOICE_DETAIL],
        ['create-invoice-modal.tsx', PURCHASE_CREATE],
        ['review-actions.tsx', PURCHASE_REVIEW],
        ['accounting/accounting-dashboard-client.tsx', ACC_DASHBOARD],
        ['receipts/page.tsx', RECEIPTS_PAGE],
        // reports / manual-journal-entries / purchase-invoices / period-close / wht
        // client views dropped out: their only X4-FIX-D patch was the H-4 DTAM gate,
        // deleted 2026-09-27 (see the retired H-4 block above).
    ] as ReadonlyArray<readonly [string, string]>)(
        '%s carries an X4-FIX-D trace comment',
        (_name, src) => {
            expect(src).toMatch(/X4-FIX-D/);
        },
    );
});
