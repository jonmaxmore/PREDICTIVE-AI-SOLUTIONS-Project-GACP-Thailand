/**
 * x6-b.test.tsx — X6-B (Iter X6) regression suite.
 *
 * Pins the contract for the 22 → 0 ESLint warning closure shipped by X6-B
 * across the source files. Categories:
 *
 *   - W5-C `<button>` backdrop + `<div role="dialog">` split
 *       (health/payments invoice detail,
 *        admin force-status revert modal)
 *   - <div onClick> rows promoted to <button> or augmented with
 *       role=button + onKeyDown (notification-bell, health/notifications)
 *   - autoFocus in modals + dedicated trace landing page disabled with
 *       a reason comment per WAI-ARIA APG (X2-FIX-A M-13 lineage)
 *   - jsx-a11y/heading-has-content closed on the Card primitive by
 *       returning null when CardTitle children are empty
 *   - FAQ <nav role="tablist"> → <div role="tablist"> (WAI-ARIA APG §3.13)
 *   - WAI-ARIA combobox `role="listbox"` + `role="option"` retained on
 *       the CoA picker via targeted eslint-disable + reason comment
 *
 * Strategy: source-grep assertions (proven by x5-fix-b.test.tsx +
 * x3-fix-b-gov-gradient.test.tsx) plus 3 mount tests for keyboard
 * activation regression on the converted notification button + the
 * notification-bell button promotion + the Card primitive empty heading.
 */

import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    Card,
    CardHeader,
    CardTitle,
    CardContent,
} from '@/components/ui/primitives/card';

const SRC_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(...segments: string[]): string {
    return readFileSync(path.join(SRC_ROOT, ...segments), 'utf8');
}

// Source loads — cached at module level.

// NOTE: components/ui/notification-bell.tsx was removed — the old bell-dropdown
// (with per-notification clickable rows) was replaced by a simple
// navigate-to-/notifications header button in components/layout/dashboard-layout.tsx.
// That button's a11y is covered by dashboard-layout-bell.test.tsx, so the old
// per-row <button> pin below is obsolete and was dropped (2026-06-05).
const CARD_PRIMITIVE_SRC = readSource('components', 'ui', 'primitives', 'card.tsx');
const FAQ_CLIENT_SRC = readSource('app', 'help', 'faq', 'faq-client.tsx');
const COA_PICKER_SRC = readSource('app', 'provider', 'accounting', 'manual-journal-entries', 'coa-account-picker.tsx');
const CREATE_INVOICE_MODAL_SRC = readSource('app', 'provider', 'accounting', 'purchase-invoices', 'create-invoice-modal.tsx');
const TRACE_CLIENT_SRC = readSource('app', 'trace', 'client-view.tsx');
const HEALTH_NOTIF_SRC = readSource('app', 'health', 'notifications', 'client-view.tsx');
const HEALTH_PAY_SRC = readSource('app', 'health', 'payments', 'client-view.tsx');
const FORCE_STATUS_SRC = readSource('app', 'admin', 'applications', '[id]', 'force-status', 'page.tsx');
const AUDIT_LOG_SRC = readSource('app', 'admin', 'audit-log', 'page.tsx');

// 1. W5-C backdrop split — 3 sites

describe('X6-B / W5-C backdrop split', () => {
    it('health/payments invoice detail modal: <button> backdrop precedes <div role="dialog">', () => {
        expect(HEALTH_PAY_SRC).toMatch(
            /aria-label="ปิดหน้าต่างรายละเอียดใบแจ้งหนี้"[\s\S]*className="absolute inset-0 cursor-default bg-slate-900\/45"/,
        );
        expect(HEALTH_PAY_SRC).toMatch(
            /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="invoice-detail-title"/,
        );
        expect(HEALTH_PAY_SRC).toContain('X6-B');
    });

    it('admin force-status revert modal: <button> backdrop precedes <div role="dialog">', () => {
        expect(FORCE_STATUS_SRC).toMatch(
            /aria-label="ปิดหน้าต่าง"[\s\S]*className="absolute inset-0 cursor-default bg-slate-900\/60"/,
        );
        expect(FORCE_STATUS_SRC).toMatch(
            /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="revert-last-transition-title"/,
        );
        // X6-B annotation tag present.
        expect(FORCE_STATUS_SRC).toContain('X6-B');
        // Legacy `onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}`
        // signature on the dialog root MUST be gone (would re-introduce
        // jsx-a11y/click-events-have-key-events).
        expect(FORCE_STATUS_SRC).not.toMatch(
            /role="dialog"[\s\S]*onClick=\{[\s\S]{0,160}e\.target === e\.currentTarget/,
        );
    });
});

// 2. div onClick row → <button> or role=button + onKeyDown

describe('X6-B / interactive row promotion', () => {
    // (notification-bell dropdown pin removed — component deleted; bell a11y now
    // covered by dashboard-layout-bell.test.tsx — see NOTE above.)

    it('health/notifications row: role="button" + tabIndex + onKeyDown handler with Enter/Space activation', () => {
        // role="button" present (always — flips inert via tabIndex / aria-disabled).
        expect(HEALTH_NOTIF_SRC).toMatch(/role="button"/);
        expect(HEALTH_NOTIF_SRC).toMatch(/tabIndex=\{isInert \? -1 : 0\}/);
        // Keyboard activation handler covers Enter + Space.
        expect(HEALTH_NOTIF_SRC).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
        expect(HEALTH_NOTIF_SRC).toContain('X6-B');
    });

    it('admin force-status revert modal removed the static-element onClick on the dialog root', () => {
        // Sanity: only 1 occurrence of `aria-labelledby="revert-last-transition-title"`
        // and it is on the <div role="dialog"> (not on the backdrop).
        const occurrences = FORCE_STATUS_SRC.match(/aria-labelledby="revert-last-transition-title"/g) ?? [];
        expect(occurrences.length).toBe(1);
    });
});

// 3. autoFocus disable comments — 3 sites

describe('X6-B / autoFocus a11y disables', () => {
    it('create-invoice-modal: first field carries the disable + reason on the wrapper', () => {
        expect(CREATE_INVOICE_MODAL_SRC).toMatch(
            /eslint-disable-next-line jsx-a11y\/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG/,
        );
        // Two autoFocus call sites total (FieldText invocation + FieldText
        // input definition).
        const matches = CREATE_INVOICE_MODAL_SRC.match(/eslint-disable-next-line jsx-a11y\/no-autofocus/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('trace landing page input: disable + reason comment present', () => {
        expect(TRACE_CLIENT_SRC).toMatch(
            /eslint-disable-next-line jsx-a11y\/no-autofocus -- reason:/,
        );
        expect(TRACE_CLIENT_SRC).toContain('X6-B');
    });
});

// 4. Card primitive — empty heading does not render <h3>

describe('X6-B / Card primitive heading-has-content', () => {
    it('source contains the empty-children guard returning null', () => {
        expect(CARD_PRIMITIVE_SRC).toMatch(
            /children === undefined \|\| children === null \|\| children === false \|\| children === ''/,
        );
        expect(CARD_PRIMITIVE_SRC).toMatch(/return null;/);
        expect(CARD_PRIMITIVE_SRC).toContain('X6-B');
    });

    it('renders an <h3> when CardTitle has children', () => {
        const html = renderToStaticMarkup(
            <Card>
                <CardHeader>
                    <CardTitle>มีหัวข้อ</CardTitle>
                </CardHeader>
                <CardContent>เนื้อหา</CardContent>
            </Card>,
        );
        expect(html).toMatch(/<h3[^>]*>มีหัวข้อ<\/h3>/);
    });

    it('does NOT render an <h3> when CardTitle is empty', () => {
        const html = renderToStaticMarkup(
            <Card>
                <CardHeader>
                    <CardTitle />
                </CardHeader>
                <CardContent>เนื้อหา</CardContent>
            </Card>,
        );
        // No h3 in the tree — the empty-heading SR anti-pattern is avoided.
        expect(html).not.toMatch(/<h3/);
    });
});

// 5. FAQ tablist refactor (nav → div)

describe('X6-B / FAQ tablist refactor', () => {
    it('uses <div role="tablist"> not <nav role="tablist">', () => {
        // The new <div role="tablist"> is present, carrying an accessible
        // name. The name itself moved into the dictionary when the FAQ was
        // made bilingual, so this asserts the a11y property that X6-B was
        // about rather than the Thai literal it happened to be spelled
        // with — the label is covered by the dictionary parity test.
        expect(FAQ_CLIENT_SRC).toMatch(/<div[\s\S]*?role="tablist"[\s\S]*?aria-label=\{copy\.tabListLabel\}/);
        // The old <nav> opening element with role="tablist" is gone. Strip
        // comment lines first so the X6-B annotation comment doesn't
        // false-positive — the annotation legitimately references the old
        // shape for grep-ability.
        const codeOnly = FAQ_CLIENT_SRC.replace(/^\s*\/\/.*$/gm, '');
        expect(codeOnly).not.toMatch(/<nav\s[\s\S]{0,80}role="tablist"/);
        expect(FAQ_CLIENT_SRC).toContain('X6-B');
    });
});

// 6. CoA picker — WAI-ARIA combobox role retention with reason

describe('X6-B / CoA picker combobox roles retained', () => {
    it('listbox + option roles are kept and have targeted disable + reason comments', () => {
        expect(COA_PICKER_SRC).toMatch(/role="listbox"/);
        expect(COA_PICKER_SRC).toMatch(/role="option"/);
        // Both targeted disable directives carry "-- reason:" + APG citation.
        const disables = COA_PICKER_SRC.match(
            /eslint-disable-next-line jsx-a11y\/no-noninteractive-element-to-interactive-role -- reason: WAI-ARIA combobox/g,
        ) ?? [];
        expect(disables.length).toBe(2);
    });
});

// 7. Tailwind classnames-order fix on audit-log row #549

describe('X6-B / Tailwind classnames-order auto-fix', () => {
    it('audit-log expanded row sequence number paragraph uses canonical class order', () => {
        // The canonical order Tailwind plugin enforces puts `font-mono` before
        // `text-sm` (and `text-slate-700` last). The pre-fix order
        // `text-sm font-mono text-slate-700` is gone.
        expect(AUDIT_LOG_SRC).toMatch(/className="font-mono text-sm text-slate-700"/);
        expect(AUDIT_LOG_SRC).not.toMatch(/className="text-sm font-mono text-slate-700"/);
    });
});
