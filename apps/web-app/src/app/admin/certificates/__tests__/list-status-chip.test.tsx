/**
 * list-status-chip.test.tsx — /admin/certificates roster: the status chip on
 * each row and the status filter + counter that share its vocabulary
 * (ledger F-G4-46, list half).
 *
 * Evidence: evidence/g4-rebuild-2026-08-25/c01/C01-04-revoked.png — after a
 * real revocation the detail chip read 'ไม่ทราบสถานะ'. The list row failed the
 * same way for the same reason: certificate-service writes canonical
 * lowercase 'revoked', the list rendered <StatusBadge status={row.status} />,
 * StatusBadge uppercases to REVOKED, and REVOKED is absent from
 * StatusBadge.tsx STATUS_TO_TONE, so every revoked row on the roster read
 * 'ไม่ทราบสถานะ'. The detail page has its own test
 * ([id]/__tests__/status-and-identities.test.tsx (a)); this one mounts the
 * list page.
 *
 *   (a) a 'revoked' row renders 'เพิกถอนแล้ว' inside its own <tr>, and
 *       'ไม่ทราบสถานะ' appears nowhere in the table;
 *   (b) a legacy uppercase 'REVOKED' row renders the same chip;
 *   (c) pressing the 'เพิกถอน' filter narrows the roster to the revoked row,
 *       marks that button aria-pressed, and raises the 'สถานะ: เพิกถอน' chip;
 *   (d) the 'เพิกถอน' summary counter reads 1 with one revoked row in two.
 *
 * (c) and (d) already held before the fix (the old uppercase compare and the
 * shared normaliser select the same rows); they pin the filter and the
 * counter to the chip's vocabulary so the three cannot drift apart again.
 *
 * Shape follows list-application-handle.test.tsx: createRoot + act, the
 * finance chrome (DataTable, FilterBar, SummaryCard, PageToolbar) is REAL,
 * so the chip label under test is what production renders.
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

const ACTIVE_ROW: CertificateRow = {
    id: '0c2f7b1e-5d3a-4c8b-9e2f-1a2b3c4d5e6f',
    certificateNumber: 'GACP-TH-2569-CAE820',
    applicationId: 'd74191d7-055b-49b4-a555-501cd30a9954',
    farmName: 'ไร่ใจดีสมุนไพรไทย',
    cropType: 'Herb',
    status: 'active',
    issuedDate: '2024-01-01T00:00:00.000Z',
    expiryDate: '2027-01-01T00:00:00.000Z',
};

// Canonical lowercase, as certificate-service.js writes on revocation.
const REVOKED_ROW: CertificateRow = {
    id: '6f1e2d3c-4b5a-4968-8776-655443322110',
    certificateNumber: 'GACP-TH-2569-E5960D',
    applicationId: '3b8e0c41-92f7-4d6a-b1c5-7e2f9a0d4c11',
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

function rowFor(certificateNumber: string): HTMLTableRowElement {
    const tr = Array.from(document.body.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((el) =>
        (el.textContent || '').includes(certificateNumber),
    );
    expect(tr).toBeDefined();
    return tr!;
}

function statusFilterButton(label: string): HTMLButtonElement {
    const button = Array.from(
        document.body.querySelectorAll<HTMLButtonElement>('#admin-certs-status button'),
    ).find((el) => (el.textContent || '').trim() === label);
    expect(button).toBeDefined();
    return button!;
}

// SummaryCard stacks the value <dd> above its label <dt>.
function counterValue(label: string): string {
    const dt = Array.from(document.body.querySelectorAll('dl dt')).find(
        (el) => (el.textContent || '').trim() === label,
    );
    expect(dt).toBeDefined();
    const dd = dt!.previousElementSibling;
    expect(dd).not.toBeNull();
    expect(dd!.tagName).toBe('DD');
    return (dd!.textContent || '').trim();
}

describe('/admin/certificates — row status chip, filter and counter', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
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

    async function mountPage(rows: ReadonlyArray<CertificateRow>): Promise<void> {
        mockListCertificates.mockResolvedValue([...rows]);
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(<ClientView />);
        });
        await flushMicrotasks();
        for (const row of rows) {
            expect(tableBodyText()).toContain(row.certificateNumber);
        }
    }

    it('(a) a revoked row renders เพิกถอนแล้ว in its own row, and ไม่ทราบสถานะ appears nowhere in the table', async () => {
        await mountPage([ACTIVE_ROW, REVOKED_ROW]);

        const revokedRow = rowFor(REVOKED_ROW.certificateNumber);
        expect(revokedRow.textContent).toContain('เพิกถอนแล้ว');
        expect(revokedRow.textContent).not.toContain('ไม่ทราบสถานะ');

        const activeRow = rowFor(ACTIVE_ROW.certificateNumber);
        expect(activeRow.textContent).toContain('กำลังใช้งาน');
        expect(activeRow.textContent).not.toContain('เพิกถอนแล้ว');

        expect(tableBodyText()).not.toContain('ไม่ทราบสถานะ');
    });

    it('(b) a legacy uppercase REVOKED row renders the same เพิกถอนแล้ว chip', async () => {
        await mountPage([{ ...REVOKED_ROW, status: 'REVOKED' }]);

        const revokedRow = rowFor(REVOKED_ROW.certificateNumber);
        expect(revokedRow.textContent).toContain('เพิกถอนแล้ว');
        expect(tableBodyText()).not.toContain('ไม่ทราบสถานะ');
    });

    it('(c) pressing the เพิกถอน filter narrows the roster to the revoked row and marks the button pressed', async () => {
        await mountPage([ACTIVE_ROW, REVOKED_ROW]);

        expect(statusFilterButton('ทั้งหมด').getAttribute('aria-pressed')).toBe('true');
        expect(statusFilterButton('เพิกถอน').getAttribute('aria-pressed')).toBe('false');

        await act(async () => {
            statusFilterButton('เพิกถอน').click();
        });
        await flushMicrotasks();

        expect(statusFilterButton('เพิกถอน').getAttribute('aria-pressed')).toBe('true');
        expect(statusFilterButton('ทั้งหมด').getAttribute('aria-pressed')).toBe('false');
        expect(tableBodyText()).toContain(REVOKED_ROW.certificateNumber);
        expect(tableBodyText()).not.toContain(ACTIVE_ROW.certificateNumber);
        expect(visibleText()).toContain('สถานะ: เพิกถอน');
        expect(visibleText()).toContain('แสดง 1 จาก 2 รายการ');
    });

    it('(d) the เพิกถอน summary counter reads 1 with one revoked row in two', async () => {
        await mountPage([ACTIVE_ROW, REVOKED_ROW]);

        expect(counterValue('ทั้งหมด')).toBe('2');
        expect(counterValue('ใช้งานอยู่')).toBe('1');
        expect(counterValue('หมดอายุ')).toBe('0');
        expect(counterValue('เพิกถอน')).toBe('1');
    });
});
