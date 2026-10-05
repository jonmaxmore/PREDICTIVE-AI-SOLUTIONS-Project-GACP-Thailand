/**
 * FaqAccordion.test.tsx — Iter 28 FAQ accordion expand/collapse.
 *
 * Mix of SSR markup checks and jsdom interactive tests.
 */

import * as React from 'react';
import { describe, it, expect } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FaqAccordion, type FaqItem } from './FaqAccordion';

declare global {
     
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: ReadonlyArray<FaqItem> = [
    {
        id: 'sample-1',
        question: 'ใช้เอกสารอะไรบ้าง?',
        answer: 'เตรียมสำเนาบัตรประชาชน เอกสารสิทธิ์ที่ดิน และแผนผังฟาร์ม',
    },
    {
        id: 'sample-2',
        question: 'ค่าธรรมเนียมเท่าไหร่?',
        answer: 'scope เล็ก 5,535 บาท / scope ใหญ่ 27,675 บาท',
    },
];

describe('FaqAccordion (Iter 28 §Step 5)', () => {
    it('renders all questions as collapsed buttons in SSR', () => {
        const html = renderToStaticMarkup(<FaqAccordion items={ITEMS} />);
        expect(html).toContain('ใช้เอกสารอะไรบ้าง?');
        expect(html).toContain('ค่าธรรมเนียมเท่าไหร่?');
        expect(html).toContain('aria-expanded="false"');
        // No panel rendered initially
        expect(html).not.toContain('data-testid="faq-panel-sample-1"');
    });

    it('shows empty-state when items array is empty', () => {
        const html = renderToStaticMarkup(<FaqAccordion items={[]} />);
        expect(html).toContain('ไม่พบคำถามที่ตรงกับเงื่อนไข');
    });

    it('clicking a question expands its panel', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root: Root | null = null;
        act(() => {
            root = createRoot(container);
            root.render(<FaqAccordion items={ITEMS} />);
        });

        const btn = container.querySelector<HTMLButtonElement>(
            '[data-testid="faq-toggle-sample-1"]',
        );
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-expanded')).toBe('false');

        act(() => {
            btn!.click();
        });

        expect(btn!.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('[data-testid="faq-panel-sample-1"]')).not.toBeNull();
        expect(container.textContent).toContain('เตรียมสำเนาบัตรประชาชน');

        // Second click collapses
        act(() => {
            btn!.click();
        });
        expect(btn!.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('[data-testid="faq-panel-sample-1"]')).toBeNull();

        act(() => {
            root?.unmount();
        });
        container.remove();
    });

    it('multiple items can be expanded independently', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root: Root | null = null;
        act(() => {
            root = createRoot(container);
            root.render(<FaqAccordion items={ITEMS} />);
        });

        const btn1 = container.querySelector<HTMLButtonElement>('[data-testid="faq-toggle-sample-1"]');
        const btn2 = container.querySelector<HTMLButtonElement>('[data-testid="faq-toggle-sample-2"]');
        act(() => {
            btn1!.click();
            btn2!.click();
        });

        expect(btn1!.getAttribute('aria-expanded')).toBe('true');
        expect(btn2!.getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('[data-testid="faq-panel-sample-1"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="faq-panel-sample-2"]')).not.toBeNull();

        act(() => {
            root?.unmount();
        });
        container.remove();
    });

    it('respects defaultOpenId prop', () => {
        const html = renderToStaticMarkup(<FaqAccordion items={ITEMS} defaultOpenId="sample-2" />);
        // The panel for sample-2 is rendered (open), but not for sample-1 (closed).
        expect(html).toContain('data-testid="faq-panel-sample-2"');
        expect(html).not.toContain('data-testid="faq-panel-sample-1"');
        // The opened question has aria-expanded="true".
        expect(html).toMatch(/aria-expanded="true"[^>]*data-testid="faq-toggle-sample-2"/);
    });
});
