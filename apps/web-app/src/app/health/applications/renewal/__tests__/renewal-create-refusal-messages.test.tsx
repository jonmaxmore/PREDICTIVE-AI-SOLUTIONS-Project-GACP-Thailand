/**
 * renewal-create-refusal-messages.test.tsx — a refused renewal says why.
 *
 * Operator ruling 2026-10-03: a renewal is a submission, so POST
 * /api/applications/renewals now refuses a filer who may not submit for the
 * certificate's holder. Every refusal used to land on the one generic
 * errorCreateFailed line ("ไม่สามารถสร้างคำขอต่ออายุได้ กรุณาลองใหม่อีกครั้ง"),
 * which tells the applicant to retry something retrying will never fix.
 *
 * Each code the renewals door answers with must render its own Thai message
 * naming the cause and the next action. An unknown code keeps the generic line.
 *
 * The envelopes are the shapes apiClient returns for those answers: it keeps
 * the backend's machine code in `code` (renewals.js puts the code in `error`,
 * and api-client harvests `data.error || data.code`).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import RenewalPage from '../client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { th } from '@/lib/i18n/dictionaries/th';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();

jest.mock('@/lib/api', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockApiGet(...args),
        post: (...args: unknown[]) => mockApiPost(...args),
    },
}));

jest.mock('@/lib/services/auth-service-session', () => ({
    getStoredUser: jest.fn(() => ({ id: 'u-1', name: 'ทดสอบ' })),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    useSearchParams: () => new URLSearchParams('certId=cert-42'),
}));

const CERT = {
    id: 'cert-42',
    certificateNumber: 'GACP-TH-2569-RENEW1',
    applicationId: 'app-9',
    siteName: 'ฟาร์มต่ออายุ',
    plantType: 'Cannabis',
    expiryDate: '2026-12-31T00:00:00.000Z',
    status: 'active',
};

const GENERIC = th.health.renewal.errorCreateFailed;

const REFUSALS: Array<[string, { success: false; error: string; status: number; code: string }, RegExp]> = [
    [
        'FORBIDDEN_NOT_OWNER',
        { success: false, error: 'คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้', status: 403, code: 'FORBIDDEN_NOT_OWNER' },
        /ผู้ยื่นคำขอเดิม/,
    ],
    [
        'ENTITY_PERMISSION_DENIED',
        { success: false, error: 'ไม่มีสิทธิ์ยื่นคำขอในนามนิติบุคคลนี้', status: 403, code: 'ENTITY_PERMISSION_DENIED' },
        /ไม่มีสิทธิ์ยื่นคำขอในนามกิจการนี้.*เจ้าของกิจการ/,
    ],
    [
        'APPLICANT_ENTITY_MISSING',
        { success: false, error: 'ข้อมูลไม่ถูกต้อง', status: 400, code: 'APPLICANT_ENTITY_MISSING' },
        /ยังไม่ได้ผูกกับผู้ถือใบรับรอง.*ผู้ดูแลระบบ/,
    ],
];

describe('RenewalPage — a refused renewal names the cause and the next action', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApiGet.mockImplementation(async (url: unknown) => (
            String(url).startsWith('/api/certificates/')
                ? { success: true, data: CERT }
                : { success: false, error: 'not under test', status: 404 }
        ));
    });

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    async function mountAndSettle() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <RenewalPage />
                </LanguageProvider>,
            );
        });
        for (let round = 0; round < 3; round++) {
            await act(async () => {
                for (let i = 0; i < 10; i++) await Promise.resolve();
            });
        }
    }

    it.each(REFUSALS)('%s renders its own message, not the generic retry line', async (_code, envelope, expected) => {
        mockApiPost.mockResolvedValue(envelope);
        await mountAndSettle();

        expect(mockApiPost).toHaveBeenCalledWith('/api/applications/renewals', { originalCertificateId: 'cert-42' });
        const text = container!.textContent || '';
        expect(text).toMatch(expected);
        expect(text).not.toContain(GENERIC);
        // Thai copy rules: no em dash.
        expect(text).not.toMatch(/—/);
    });

    it('an unknown refusal keeps the generic line', async () => {
        mockApiPost.mockResolvedValue({ success: false, error: 'boom', status: 500, code: 'INTERNAL_ERROR' });
        await mountAndSettle();
        expect(container!.textContent || '').toContain(GENERIC);
    });
});
