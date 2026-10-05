/**
 * revoke-dialog.test.tsx — /admin/certificates/[id] revocation dialog is
 * wired to the real door (POST /api/admin/certificates/:id/revoke via
 * AdminService.revokeCertificate), replacing the R7-A stub that only said
 * the feature would land later.
 *
 *   (a) opening the dialog shows a labelled textarea and a DISABLED confirm;
 *   (b) typing a reason enables confirm; confirming calls
 *       revokeCertificate(certId, reason) exactly once, the dialog closes,
 *       a role="status" line announces the revocation, and the revoked
 *       panel 'ใบรับรองนี้ถูกเพิกถอน' renders once getCertificate reloads
 *       the revoked row;
 *   (c) a CERTIFICATE_ALREADY_REVOKED (409) result keeps the dialog open
 *       and shows the role="alert" refresh hint;
 *   (d) the stub sentence 'จะเปิดใช้งานในรอบถัดไป' is gone from the DOM.
 *
 * Shape: the repo has @testing-library/jest-dom but NOT
 * @testing-library/react, so we render with `createRoot` + `act`, type
 * through the native value setter + an `input` event, and click with
 * dispatchEvent. Radix Dialog portals out of the container in jsdom, so
 * the dialog primitives are mocked inline (the documented workaround from
 * provider/accounting/__tests__/invoice-detail-modal-refund.test.tsx).
 */

import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { CertificateDetail } from '@/lib/services/admin-service';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type RevokeResult =
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: string; message: string };

const mockGetCertificate = jest.fn<(id: string) => Promise<CertificateDetail | null>>();
const mockRevokeCertificate = jest.fn<(id: string, reason: string) => Promise<RevokeResult>>();

// Only the two doors are mocked; the module's constants (reason max length,
// Thai error copy) stay real so the view renders what production renders.
jest.mock('@/lib/services/admin-service', () => {
    const actual = jest.requireActual('@/lib/services/admin-service') as Record<string, unknown>;
    return {
        ...actual,
        AdminService: {
            getCertificate: (id: string) => mockGetCertificate(id),
            revokeCertificate: (id: string, reason: string) => mockRevokeCertificate(id, reason),
        },
    };
});

// ADMIN session, already hydrated.
jest.mock('@/lib/services/auth-provider', () => ({
    useAuth: () => ({ user: { id: 'admin-1', role: 'system_admin_dtam' }, isLoading: false }),
}));

// Stable router + the route param the page reads.
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        useParams: () => ({ id: 'cert-1' }),
        usePathname: () => '/admin/certificates/cert-1',
        useSearchParams: () => new URLSearchParams(),
    };
});

// Radix Dialog portals out of the container in jsdom — render inline.
jest.mock('@/components/ui/primitives/dialog', () => ({
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
        open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// Finance chrome is not under test — keep the DOM small and deterministic.
jest.mock('@/components/finance', () => ({
    PageToolbar: ({ title }: { title?: string }) => <div>{title}</div>,
    StatusBadge: ({ status }: { status?: string }) => <span>{status}</span>,
    SummaryCard: () => null,
}));

import DetailView from '../detail-view';

const CERT_ID = 'cert-1';
const CERT_NUMBER = 'GACP-TH-2569-TEST01';
const STUB_SENTENCE = 'จะเปิดใช้งานในรอบถัดไป';

const ACTIVE_CERT: CertificateDetail = {
    id: CERT_ID,
    certificateNumber: CERT_NUMBER,
    applicationId: 'app-1',
    farmName: 'ฟาร์มทดสอบ',
    cropType: 'กัญชา',
    status: 'ACTIVE',
    issuedDate: '2026-01-01T00:00:00.000Z',
    expiryDate: '2029-01-01T00:00:00.000Z',
};

const REVOKED_CERT: CertificateDetail = {
    ...ACTIVE_CERT,
    status: 'REVOKED',
    revokedAt: '2026-08-27T00:00:00.000Z',
    revokedBy: 'admin-1',
    revokedReason: 'ตรวจพบการปลอมแปลงเอกสาร',
};

async function flushMicrotasks(rounds = 12): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

function buttonByText(text: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => (b.textContent || '').trim() === text,
    );
}

async function click(el: Element): Promise<void> {
    await act(async () => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushMicrotasks();
}

async function typeInto(el: HTMLTextAreaElement, value: string): Promise<void> {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMicrotasks(2);
}

describe('/admin/certificates/[id] — revoke dialog wired to the real door', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCertificate.mockResolvedValue(ACTIVE_CERT);
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    async function mountPage(): Promise<void> {
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(<DetailView />);
        });
        await flushMicrotasks();
    }

    async function openDialog(): Promise<void> {
        const trigger = buttonByText('เพิกถอนใบรับรอง');
        expect(trigger).toBeDefined();
        expect(trigger!.getAttribute('aria-label')).toBe('เพิกถอนใบรับรอง');
        await click(trigger!);
    }

    it('(a) opening the dialog shows a labelled reason textarea and a disabled confirm', async () => {
        await mountPage();
        expect(document.body.textContent).toContain(CERT_NUMBER);

        await openDialog();

        const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea');
        expect(textarea).not.toBeNull();
        expect(textarea!.getAttribute('maxlength')).toBe('500');
        expect(textarea!.id).not.toBe('');
        const label = document.body.querySelector<HTMLLabelElement>(`label[for="${textarea!.id}"]`);
        expect(label).not.toBeNull();
        expect(label!.textContent).toContain('เหตุผลการเพิกถอน');

        expect(document.body.textContent).toContain('เพิกถอนใบรับรอง');
        const confirm = buttonByText('ยืนยันการเพิกถอน');
        expect(confirm).toBeDefined();
        expect(confirm!.disabled).toBe(true);
        expect(mockRevokeCertificate).not.toHaveBeenCalled();
    });

    it('(b) typing a reason enables confirm; confirming calls the door once and shows the revoked panel', async () => {
        mockGetCertificate
            .mockResolvedValueOnce(ACTIVE_CERT)
            .mockResolvedValue(REVOKED_CERT);
        mockRevokeCertificate.mockResolvedValue({
            ok: true,
            data: {
                id: CERT_ID,
                certificateNumber: CERT_NUMBER,
                status: 'revoked',
                revokedAt: '2026-08-27T00:00:00.000Z',
                revokedBy: 'admin-1',
                revokedReason: 'ตรวจพบการปลอมแปลงเอกสาร',
            },
        });

        await mountPage();
        expect(document.body.textContent).not.toContain('ใบรับรองนี้ถูกเพิกถอน');
        await openDialog();

        const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!;
        await typeInto(textarea, '   ');
        expect(buttonByText('ยืนยันการเพิกถอน')!.disabled).toBe(true);

        await typeInto(textarea, 'ตรวจพบการปลอมแปลงเอกสาร');
        const confirm = buttonByText('ยืนยันการเพิกถอน')!;
        expect(confirm.disabled).toBe(false);

        await click(confirm);

        expect(mockRevokeCertificate).toHaveBeenCalledTimes(1);
        expect(mockRevokeCertificate).toHaveBeenCalledWith(CERT_ID, 'ตรวจพบการปลอมแปลงเอกสาร');
        // Reloaded through the existing load(): initial + post-revoke.
        expect(mockGetCertificate).toHaveBeenCalledTimes(2);

        // Dialog closed, revoked panel up, success announced.
        expect(document.body.querySelector('textarea')).toBeNull();
        expect(document.body.textContent).toContain('ใบรับรองนี้ถูกเพิกถอน');
        const status = Array.from(document.body.querySelectorAll('[role="status"]')).find((el) =>
            (el.textContent || '').includes(`เพิกถอนใบรับรอง ${CERT_NUMBER} แล้ว`),
        );
        expect(status).toBeDefined();
        // The trigger is gone once the row is REVOKED.
        expect(buttonByText('เพิกถอนใบรับรอง')).toBeUndefined();
    });

    it('(c) a 409 CERTIFICATE_ALREADY_REVOKED keeps the dialog open and shows the refresh hint', async () => {
        mockRevokeCertificate.mockResolvedValue({
            ok: false,
            error: 'CERTIFICATE_ALREADY_REVOKED',
            message: 'Certificate already revoked',
        });

        await mountPage();
        await openDialog();

        const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!;
        await typeInto(textarea, 'เหตุผลทดสอบ');
        await click(buttonByText('ยืนยันการเพิกถอน')!);

        expect(mockRevokeCertificate).toHaveBeenCalledTimes(1);
        // Still open.
        expect(document.body.querySelector('textarea')).not.toBeNull();
        const alert = Array.from(document.body.querySelectorAll('[role="alert"]')).find((el) =>
            (el.textContent || '').includes('ใบรับรองนี้ถูกเพิกถอนไปแล้ว รีเฟรชหน้าจอเพื่อดูสถานะล่าสุด'),
        );
        expect(alert).toBeDefined();
        // No reload on failure — the page did not pretend the revoke happened.
        expect(mockGetCertificate).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain('ใบรับรองนี้ถูกเพิกถอน ');
    });

    it('(d) the stub sentence is gone from the DOM, closed and open', async () => {
        await mountPage();
        expect(document.body.textContent).not.toContain(STUB_SENTENCE);
        expect(document.body.textContent).not.toContain('ปิดใช้งาน');

        await openDialog();
        expect(document.body.textContent).not.toContain(STUB_SENTENCE);
        expect(document.body.textContent).not.toContain('ประสานทีม backend');
    });

    // (e)/(f): the alert must show Thai cause + next action for the codes the
    // mapped table did not cover. The mocked door delegates to the REAL
    // service (and so the real apiClient) with only `fetch` stubbed, so the
    // text asserted here is the text production would render.
    describe('unmapped failures reach the alert as Thai copy, not a code or English', () => {
        const THAI = /[฀-๿]/;
        const originalFetch = globalThis.fetch;
        let fetchMock: jest.Mock;

        beforeEach(() => {
            fetchMock = jest.fn();
            globalThis.fetch = fetchMock as unknown as typeof fetch;
            const real = jest.requireActual('@/lib/services/admin-service') as {
                AdminService: { revokeCertificate: (id: string, reason: string) => Promise<RevokeResult> };
            };
            mockRevokeCertificate.mockImplementation((id, reason) => real.AdminService.revokeCertificate(id, reason));
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        async function submitAndReadAlert(): Promise<string> {
            await mountPage();
            await openDialog();
            const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!;
            await typeInto(textarea, 'เหตุผลทดสอบ');
            await click(buttonByText('ยืนยันการเพิกถอน')!);
            await flushMicrotasks();
            expect(mockRevokeCertificate).toHaveBeenCalledTimes(1);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            // Still open, no reload.
            expect(document.body.querySelector('textarea')).not.toBeNull();
            expect(mockGetCertificate).toHaveBeenCalledTimes(1);
            const alerts = Array.from(document.body.querySelectorAll('[role="alert"]'));
            expect(alerts).toHaveLength(1);
            return (alerts[0].textContent || '').trim();
        }

        it('(e) a 500 CERTIFICATE_REVOKE_FAILED shows Thai cause + next action, not the code', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 500,
                headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
                json: async () => ({
                    success: false,
                    error: 'CERTIFICATE_REVOKE_FAILED',
                    message: 'ระบบไม่สามารถเพิกถอนใบรับรองได้ในขณะนี้ กรุณาลองใหม่อีกครั้งในอีกสักครู่',
                }),
                text: async () => '',
            });

            const alertText = await submitAndReadAlert();

            expect(alertText).toMatch(THAI);
            expect(alertText).not.toContain('CERTIFICATE_REVOKE_FAILED');
            expect(alertText).toContain('ลองอีกครั้ง');
        });

        it('(f) a network failure shows Thai copy with a next action, not the client\'s English text', async () => {
            fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

            const alertText = await submitAndReadAlert();

            expect(alertText).toMatch(THAI);
            expect(alertText).not.toContain('REQUEST_FAILED');
            expect(alertText).not.toMatch(/Unable to connect|fetch failed|Please try again/i);
            expect(alertText).toContain('ลองอีกครั้ง');
        });
    });
});
