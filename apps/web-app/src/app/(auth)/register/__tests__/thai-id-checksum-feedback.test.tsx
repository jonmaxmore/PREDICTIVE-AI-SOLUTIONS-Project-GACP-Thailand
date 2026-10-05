/**
 * W3-C — inline mod-11 checksum feedback on the register ID field.
 *
 * Carpet-100 finding: a 13-digit Thai national ID with an INVALID checksum
 * sailed through the whole 4-step wizard (zod only checked length + digits)
 * and the user was rejected by the backend at final submit — three steps
 * away from the field, with only a generic top-of-form banner. The shared
 * validator `isValidThaiNationalId` (src/lib/validation/thai-formats.ts,
 * mirrors apps/backend/shared/utilities.js) existed but was not wired in.
 *
 * This suite pins the fix: the zod schema refines the identifier with the
 * mod-11 checksum, so the user hears about a mistyped ID at the field,
 * on step 1, in Thai that names the cause and the next action.
 *
 * Rendering: createRoot + act per the repo idiom (RootLangUpdater.test.tsx,
 * auth-provider-first-render.test.tsx) — no @testing-library dependency.
 * Events: native `input` + `focusout` dispatches drive react-hook-form's
 * onTouched mode exactly like a real keyboard user leaving the field.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LanguageProvider } from '@/lib/i18n/language-context';
import RegisterPage from '@/app/(auth)/register/page';

// Valid/invalid pair from src/lib/validation/__tests__/thai-formats.test.ts:
// same 12 leading digits, only the check digit differs.
const VALID_THAI_ID = '1708643756689';
const INVALID_CHECKSUM_ID = '1101400100796';
const CHECKSUM_MESSAGE = 'เลขบัตรประชาชนไม่ถูกต้อง กรุณาตรวจสอบตัวเลขให้ตรงกับบัตรของคุณ';
const LENGTH_MESSAGE = 'เลขบัตรประชาชนต้องมี 13 หลัก';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
});

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
});

async function renderRegister(): Promise<void> {
    await act(async () => {
        root = createRoot(container!);
        root.render(
            <LanguageProvider>
                <RegisterPage />
            </LanguageProvider>,
        );
    });
}

async function typeIdentifierAndBlur(value: string): Promise<HTMLInputElement> {
    const input = document.getElementById('reg-identifier') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    return input;
}

describe('W3-C register — inline Thai-ID checksum feedback', () => {
    it('shows a field-level error for a 13-digit ID with an invalid checksum', async () => {
        await renderRegister();
        await typeIdentifierAndBlur(INVALID_CHECKSUM_ID);
        expect(document.body.textContent).toContain(CHECKSUM_MESSAGE);
    });

    it('accepts a 13-digit ID with a valid checksum (no checksum error)', async () => {
        await renderRegister();
        await typeIdentifierAndBlur(VALID_THAI_ID);
        expect(document.body.textContent).not.toContain(CHECKSUM_MESSAGE);
    });

    it('still reports too-short input with the length message, not the checksum one', async () => {
        await renderRegister();
        await typeIdentifierAndBlur('12345');
        expect(document.body.textContent).toContain(LENGTH_MESSAGE);
        expect(document.body.textContent).not.toContain(CHECKSUM_MESSAGE);
    });
});
