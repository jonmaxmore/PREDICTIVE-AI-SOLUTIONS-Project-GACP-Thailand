/**
 * list-application-handle.test.tsx — /admin/certificates roster: the
 * application under each certificate number (ledger F-G4-47, list half).
 *
 * certificate-display.tsx promises both admin certificate pages read the
 * application as a number or a '#'+last-6 handle, never the uuid. The
 * detail page kept that promise (status-and-identities.test.tsx (c)); the
 * list page still printed the raw Certificate.applicationId in a mono
 * subline under every certificate number. GET /api/certificates carries no
 * application include (certificate-service.js listCertificates), so the
 * row has only applicationId and the shared handle is the only readable
 * form available.
 *
 *   (a) with rows carrying raw application uuids, no 36-char uuid appears
 *       as visible text anywhere on the page;
 *   (b) the '#'+last-6 handle from applicationLabel() appears under the
 *       certificate number;
 *   (c) typing that handle into the search box narrows the roster to the
 *       matching row — what a person sees is what a person can search.
 *
 * Shape follows [id]/__tests__/status-and-identities.test.tsx: createRoot +
 * act, the finance chrome (DataTable, FilterBar, SummaryCard, PageToolbar)
 * is REAL — the subline under test is what production renders.
 */

import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { CertificateRow } from '@/lib/services/admin-service';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockListCertificates = jest.fn<(params?: { take?: number }) => Promise<CertificateRow[]>>();

jest.mock('@/lib/services/admin-service', () => {
    const actual = jest.requireActual('@/lib/services/admin-service') as Record<string, unknown>;
    return {
        ...actual,
        AdminService: {
            listCertificates: (params?: { take?: number }) => mockListCertificates(params),
        },
    };
});

jest.mock('@/lib/services/auth-provider', () => ({
    useAuth: () => ({ user: { id: 'admin-1', role: 'system_admin_dtam' }, isLoading: false }),
}));

import ClientView from '../client-view';
import { applicationLabel } from '../certificate-display';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const APPLICATION_ID_A = 'd74191d7-055b-49b4-a555-501cd30a9954';
const APPLICATION_ID_B = '3b8e0c41-92f7-4d6a-b1c5-7e2f9a0d4c11';

const ROW_A: CertificateRow = {
    id: '0c2f7b1e-5d3a-4c8b-9e2f-1a2b3c4d5e6f',
    certificateNumber: 'GACP-TH-2569-CAE820',
    applicationId: APPLICATION_ID_A,
    farmName: 'ไร่ใจดีสมุนไพรไทย',
    cropType: 'Herb',
    status: 'active',
    issuedDate: '2024-01-01T00:00:00.000Z',
    expiryDate: '2027-01-01T00:00:00.000Z',
};

const ROW_B: CertificateRow = {
    id: '6f1e2d3c-4b5a-4968-8776-655443322110',
    certificateNumber: 'GACP-TH-2569-E5960D',
    applicationId: APPLICATION_ID_B,
    farmName: 'สวนสมุนไพรบ้านนา',
    cropType: 'Herb',
    status: 'revoked',
    issuedDate: '2024-02-01T00:00:00.000Z',
    expiryDate: '2027-02-01T00:00:00.000Z',
};

async function flushMicrotasks(rounds = 12): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

function visibleText(): string {
    return document.body.textContent || '';
}

function tableBodyText(): string {
    return document.body.querySelector('tbody')?.textContent || '';
}

// React listens for the native 'input' event on controlled inputs; setting
// `.value` through the prototype setter keeps React's value tracker in sync.
function typeInto(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('/admin/certificates — application handle under the certificate number', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockListCertificates.mockResolvedValue([ROW_A, ROW_B]);
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
            root.render(<ClientView />);
        });
        await flushMicrotasks();
        expect(tableBodyText()).toContain(ROW_A.certificateNumber);
        expect(tableBodyText()).toContain(ROW_B.certificateNumber);
    }

    it('(a) no 36-char uuid is visible when rows carry raw application uuids', async () => {
        await mountPage();

        expect(visibleText()).not.toMatch(UUID_RE);
        expect(visibleText()).not.toContain(APPLICATION_ID_A);
        expect(visibleText()).not.toContain(APPLICATION_ID_B);
    });

    it('(b) the shared #last-6 handle appears under each certificate number', async () => {
        await mountPage();

        const handleA = applicationLabel(null, APPLICATION_ID_A);
        const handleB = applicationLabel(null, APPLICATION_ID_B);
        expect(handleA).toBe(`#${APPLICATION_ID_A.slice(-6).toUpperCase()}`);
        expect(tableBodyText()).toContain(handleA);
        expect(tableBodyText()).toContain(handleB);
    });

    it('(c) typing the handle into the search box narrows the roster to that row', async () => {
        await mountPage();

        const input = document.body.querySelector<HTMLInputElement>('#admin-certs-q');
        expect(input).not.toBeNull();
        await act(async () => {
            typeInto(input!, applicationLabel(null, APPLICATION_ID_B));
        });
        await flushMicrotasks();

        expect(tableBodyText()).toContain(ROW_B.certificateNumber);
        expect(tableBodyText()).not.toContain(ROW_A.certificateNumber);
    });
});
