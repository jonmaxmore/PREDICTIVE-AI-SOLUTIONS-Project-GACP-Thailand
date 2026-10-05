/**
 * loading-a11y.test.tsx — X1-FIX-D pin tests for M-15.
 *
 * What changed in X1-FIX-D:
 *   - PageSkeleton now wraps every variant in
 *     `role="status" aria-live="polite" aria-busy="true"` with an
 *     `sr-only` Thai label so screen readers announce the loading state.
 *   - Spinner now uses the same `role="status" aria-live="polite"`
 *     pattern with a customizable Thai label (default "กำลังโหลด...").
 *
 * What we assert:
 *   1. (M-15) Every PageSkeleton variant emits a `role="status"` container.
 *   2. (M-15) The sr-only "กำลังโหลด..." label is present inside the shell.
 *   3. (M-15) Spinner emits `role="status"` + `aria-live="polite"`.
 *   4. (M-15) Spinner's `label` prop overrides the default.
 *
 * SSR-markup based (matches the existing layout/__tests__ pattern).
 */

import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import { PageSkeleton } from '../page-skeleton';
import { Spinner } from '../spinner';

describe('PageSkeleton — M-15 a11y status announce', () => {
    const variants = ['dashboard', 'list', 'detail', 'form', 'table'] as const;

    it.each(variants)('variant "%s" wraps content in role="status" aria-live="polite"', (variant) => {
        const html = renderToStaticMarkup(<PageSkeleton type={variant} />);
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-busy="true"');
    });

    it.each(variants)('variant "%s" includes a Thai sr-only loading label', (variant) => {
        const html = renderToStaticMarkup(<PageSkeleton type={variant} />);
        expect(html).toContain('sr-only');
        expect(html).toContain('กำลังโหลด...');
    });
});

describe('Spinner — M-15 a11y status announce', () => {
    it('emits role="status" + aria-live="polite" + aria-busy="true"', () => {
        const html = renderToStaticMarkup(<Spinner />);
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-busy="true"');
    });

    it('renders the default Thai "กำลังโหลด..." label inside sr-only span', () => {
        const html = renderToStaticMarkup(<Spinner />);
        expect(html).toContain('sr-only');
        expect(html).toContain('กำลังโหลด...');
    });

    it('honours a custom label override', () => {
        const html = renderToStaticMarkup(<Spinner label="กำลังบันทึก..." />);
        expect(html).toContain('กำลังบันทึก...');
        // Default label MUST NOT also appear when overridden.
        expect(html).not.toContain('กำลังโหลด...');
    });
});
