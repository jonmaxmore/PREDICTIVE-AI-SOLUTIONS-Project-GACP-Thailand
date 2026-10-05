import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * The public verifier portal now answers the language toggle.
 *
 * `/verify` is an 11-line shell around this component, so everything a citizen
 * or an overseas buyer sees on the public trust surface lives in these 462
 * lines. Until now every string was hardcoded Thai and the page ignored the
 * toggle entirely — TH and EN rendered pixel-identically (measured across 21
 * capture pairs in the 2026-07-26 visual-QA sweep).
 *
 * The previous revision of this spec deliberately asserted that raw English
 * ("trust registry", "Revocation Transparency") was still mixed into Thai
 * sentences, recording current state so the replacement would show up as a
 * reviewable diff rather than vanish among 98 strings. Those assertions are
 * now inverted: the formal Thai for all three terms already existed in the
 * section headings of this same file, so the fix was an internal-consistency
 * one, not a translation gap.
 *
 * The mandate this pins: in English mode the page must contain ZERO Thai
 * codepoints. That is asserted directly rather than trusted.
 *
 * Uses createRoot + act — the React 18 style this repo prefers over
 * @testing-library/react (see RootLangUpdater.test.tsx) — because the locale
 * is adopted in an effect after mount, which renderToStaticMarkup never runs.
 */

jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('next/navigation', () => {
    const stableRouter = {
        push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
        back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
        pathname: '/', query: {},
    };
    return {
        useRouter: () => stableRouter,
        usePathname: () => '/verify',
        useSearchParams: () => new URLSearchParams(),
    };
});

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.unmock('@/lib/i18n/language-context');

import { LanguageProvider } from '@/lib/i18n/language-context';
import TrustVerifierPortal from '../trust-verifier-portal';

const THAI_CODEPOINTS = /[฀-๿]/;

describe('public verifier portal', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => { root?.unmount(); });
        container?.remove();
        container = null;
        root = null;
        localStorage.clear();
    });

    function renderIn(language: 'th' | 'en'): HTMLElement {
        localStorage.setItem('language', language);
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <TrustVerifierPortal />
                </LanguageProvider>,
            );
        });
        return container!;
    }

    // F-VERIFY-PORTAL-SHAPE-MISMATCH (Phase 0 walk-2 2026-08-19, C15): the real
    // walk pressed the portal with a freshly-CERTIFIED certificate — the API
    // answered {success, valid:true, trustStatus:'ACTIVE', data:{...}} but the
    // panel rendered "ผลการตรวจสอบ: ไม่ผ่าน" with every field dashed, because
    // handleVerify cast `response.data` (the UNWRAPPED inner data —
    // api-client.ts:449-454 also harvests the envelope siblings valid/trustStatus
    // into `.meta`) as if it were still the full envelope. A citizen was told a
    // valid certificate FAILED verification. This test drives the form with the
    // exact response shape the walk observed.
    describe('F-VERIFY-PORTAL-SHAPE-MISMATCH — a valid certificate must render as ผ่าน', () => {
        it('renders the certificate number and no "ไม่ผ่าน" verdict for a valid ACTIVE cert', async () => {
            const { apiClient } = jest.requireMock('@/lib/api/api-client') as {
                apiClient: { get: jest.Mock };
            };
            apiClient.get.mockResolvedValueOnce({
                success: true,
                data: {
                    certificateNumber: 'GACP-TH-2569-E0DF5B',
                    trustStatus: 'ACTIVE',
                    issuedDate: '2026-08-18T19:42:37.288Z',
                    expiryDate: '2029-08-18T19:42:37.288Z',
                    revokedAt: null,
                    revokedReason: null,
                    farm: { id: 'farm-1', name: 'ฟาร์มทดสอบ', province: 'เชียงใหม่', district: 'เมือง' },
                },
                meta: { valid: true, trustStatus: 'ACTIVE' },
            });

            const el = renderIn('th');
            const input = el.querySelector('#certificate-number') as HTMLInputElement;
            expect(input).toBeTruthy();
            act(() => {
                const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
                setValue.call(input, 'GACP-TH-2569-E0DF5B');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            const form = input.closest('form')!;
            await act(async () => {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            });

            const text = el.textContent ?? '';
            expect(text).toContain('GACP-TH-2569-E0DF5B'); // the panel names THIS certificate, not '-'
            expect(text).not.toContain('ไม่ผ่าน');          // a valid cert must never read as FAILED
        });

        it('renders a valid SIGNATURE as ผ่าน with its hash (same class, handleSignatureVerify)', async () => {
            // Review 2026-08-19 confirmed the identical stale cast in
            // handleSignatureVerify: POST /v1/signatures/verify returns the same
            // sibling envelope {success, valid, data:{hash, signatureAlgorithm}},
            // so a VALID signature rendered as failed with hash '-'.
            const { apiClient } = jest.requireMock('@/lib/api/api-client') as {
                apiClient: { post: jest.Mock };
            };
            apiClient.post.mockResolvedValueOnce({
                success: true,
                data: { hash: 'abc123def456', signatureAlgorithm: 'RSA-SHA256' },
                meta: { valid: true },
            });

            const el = renderIn('th');
            const sig = el.querySelector('#signature-input') as HTMLTextAreaElement;
            expect(sig).toBeTruthy();
            act(() => {
                const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
                setValue.call(sig, 'deadbeef');
                sig.dispatchEvent(new Event('input', { bubbles: true }));
            });
            const form = sig.closest('form')!;
            await act(async () => {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            });

            const text = el.textContent ?? '';
            expect(text).toContain('abc123def456'); // the hash renders, not '-'
            expect(text).not.toContain('ไม่ผ่าน');   // a valid signature must never read as FAILED
        });
    });

    describe('Thai', () => {
        it('renders the heading and all four sections', () => {
            const text = renderIn('th').textContent ?? '';

            expect(text).toContain('พอร์ทัลตรวจสอบใบรับรอง');
            expect(text).toContain('ตรวจสอบใบรับรอง');
            expect(text).toContain('ทะเบียนความเชื่อถือและความโปร่งใสการเพิกถอน');
            expect(text).toContain('ตรวจสอบเอกสารลงลายเซ็นดิจิทัล');
            expect(text).toContain('เหตุการณ์ตรวจสอบย้อนกลับ');
        });

        it('no longer leaves raw English inside Thai sentences', () => {
            const text = renderIn('th').textContent ?? '';

            expect(text).not.toContain('Revocation Transparency');
            expect(text).not.toContain('trust registry');
            // The formal Thai that already existed in this file's own headings.
            expect(text).toContain('ความโปร่งใสการเพิกถอน');
            expect(text).toContain('ทะเบียนความเชื่อถือ');
        });
    });

    describe('English', () => {
        it('renders the heading and all four sections', () => {
            const text = renderIn('en').textContent ?? '';

            expect(text).toContain('Certificate Verifier Portal');
            expect(text).toContain('Verify a certificate');
            expect(text).toContain('Trust registry and revocation transparency');
            expect(text).toContain('Verify a digitally signed document');
            expect(text).toContain('Traceability events');
        });

        it('contains ZERO Thai characters anywhere in the rendered page', () => {
            const el = renderIn('en');

            const offenders = (el.textContent ?? '')
                .split(/\s+/)
                .filter((token) => THAI_CODEPOINTS.test(token));
            expect(offenders).toEqual([]);

            // Attributes are user-visible too — placeholders especially.
            const attrOffenders: string[] = [];
            for (const node of Array.from(el.querySelectorAll('*'))) {
                for (const attr of Array.from(node.attributes)) {
                    if (THAI_CODEPOINTS.test(attr.value)) {
                        attrOffenders.push(`${node.tagName.toLowerCase()}[${attr.name}]="${attr.value}"`);
                    }
                }
            }
            expect(attrOffenders).toEqual([]);
        });

        it('mounts the language toggle so the locale can actually be changed here', () => {
            const el = renderIn('en');

            const toggle = Array.from(el.querySelectorAll('button')).find((b) =>
                /EN|TH/i.test(b.textContent ?? ''),
            );
            expect(toggle).toBeDefined();
        });
    });
});
