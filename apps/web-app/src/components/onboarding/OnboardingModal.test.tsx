/**
 * OnboardingModal.test.tsx — Iter 28 onboarding modal tests.
 *
 * SSR-markup based to match the repo pattern (see
 * auto-save-indicator.test.tsx). For interactive tests we use
 * Testing Library + jsdom to assert Skip / Next button behaviour.
 */

import * as React from 'react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
    OnboardingModal,
    buildOnboardingSteps,
    ONBOARDING_STORAGE_KEY,
} from './OnboardingModal';

// The tour's length does not depend on whether the fees have loaded; the fee
// lines inside it do (fees-from-server.test.tsx).
const DEFAULT_ONBOARDING_STEPS = buildOnboardingSteps({ status: 'loading' });

// React 18 concurrent act() needs this global flag for jsdom envs.
declare global {
     
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom doesn't ship localStorage.clear by default in all setups —
// guard against undefined globals before each test.
function resetStorage() {
    try {
        window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
        // ignore
    }
}

describe('OnboardingModal (Iter 28 §Step 2)', () => {
    beforeEach(() => {
        resetStorage();
    });

    it('renders the first step title in SSR markup', () => {
        const html = renderToStaticMarkup(<OnboardingModal />);
        expect(html).toContain('ยินดีต้อนรับสู่ GACP THAILAND');
        expect(html).toContain('data-testid="onboarding-modal"');
        expect(html).toContain('data-testid="onboarding-skip"');
        expect(html).toContain('data-testid="onboarding-next"');
    });

    it('renders the step counter "ขั้นที่ 1 / 5" by default', () => {
        const html = renderToStaticMarkup(<OnboardingModal />);
        expect(html).toContain(`ขั้นที่ 1 / ${DEFAULT_ONBOARDING_STEPS.length}`);
    });

    it('Next advances to the second step', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root: Root | null = null;
        act(() => {
            root = createRoot(container);
            root.render(<OnboardingModal />);
        });

        const nextBtn = container.querySelector<HTMLButtonElement>(
            '[data-testid="onboarding-next"]',
        );
        expect(nextBtn).not.toBeNull();
        act(() => {
            nextBtn!.click();
        });
        // The second step was titled "ขั้นตอนการสมัคร 12 ขั้น" and put instalment 2
        // after the farm inspection; it now follows the state machine (UXUI-01).
        expect(container.textContent).toContain('ขั้นตอนการขอรับรอง');

        act(() => {
            root?.unmount();
        });
        container.remove();
    });

    it('Skip closes the modal and writes the persisted flag', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root: Root | null = null;
        const onSkip = jest.fn();
        act(() => {
            root = createRoot(container);
            root.render(<OnboardingModal onSkip={onSkip} />);
        });

        const skipBtn = container.querySelector<HTMLButtonElement>(
            '[data-testid="onboarding-skip"]',
        );
        expect(skipBtn).not.toBeNull();
        act(() => {
            skipBtn!.click();
        });

        expect(onSkip).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="onboarding-modal"]')).toBeNull();
        expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');

        act(() => {
            root?.unmount();
        });
        container.remove();
    });

    it('Next on the last step calls onComplete and writes the flag', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root: Root | null = null;
        const onComplete = jest.fn();
        const lastIndex = DEFAULT_ONBOARDING_STEPS.length - 1;
        act(() => {
            root = createRoot(container);
            root.render(<OnboardingModal initialStep={lastIndex} onComplete={onComplete} />);
        });

        const nextBtn = container.querySelector<HTMLButtonElement>(
            '[data-testid="onboarding-next"]',
        );
        expect(nextBtn).not.toBeNull();
        act(() => {
            nextBtn!.click();
        });

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');

        act(() => {
            root?.unmount();
        });
        container.remove();
    });
});
