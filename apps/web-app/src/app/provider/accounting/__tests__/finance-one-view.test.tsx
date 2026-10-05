/**
 * การเงินสองบทบาทเห็นหน้าบัญชีเดียวกัน — ทุกหน้า ทุกแท็บ
 *
 * operator 2026-09-11: "finance ต้องเห็นเหมือนกัน หรือว่าตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน
 * เพื่อแสดงความโปร่งใส" · operator 2026-09-27: "กรมฯ ดูอย่างเดียว" — finance_officer_dtam
 * เห็นทุกอย่างที่ finance_officer_platform เห็น แต่ไม่มีปุ่มเขียนบัญชีเลย
 *
 * วิธี: mount หน้าจริง (createRoot + act) ด้วยข้อมูลชุดเดียวกัน ครั้งหนึ่งเป็นการเงินกรม อีกครั้ง
 * เป็นการเงินบริษัท แล้วเทียบ "เนื้อหาอ่าน" = ข้อความทั้งหน้าหลังตัดปุ่มเขียนออก · ปุ่มเขียน
 * (ชื่อใน WRITE_LABELS) ต้องไม่มีเลยในหน้าของการเงินกรม และต้องมีในหน้าของการเงินบริษัท
 * (ไม่งั้นการตัดปุ่มออกจะพิสูจน์อะไรไม่ได้)
 * ของปลอม: ผู้ใช้ที่ล็อกอิน · กรอบหน้า (ProviderLayout) · ชั้นเรียก API
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockRole = 'finance_officer_platform';
let mockWithState = false;

jest.mock('@/lib/services/auth-provider', () => ({
    useAuth: () => ({ user: { id: 'u-1', role: mockRole }, isLoading: false }),
}));
jest.mock('next/navigation', () => ({
    usePathname: () => '/provider/accounting',
    useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('../../components/provider-layout', () => ({
    __esModule: true,
    default: ({ children, title }: { children: React.ReactNode; title?: React.ReactNode }) => (
        <div data-testid="provider-layout">{title}{children}</div>
    ),
}));
jest.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
// Radix Dialog portals out of the container in jsdom — render inline (same as invoice-detail-modal tests).
jest.mock('@/components/ui/primitives/dialog', () => ({
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
        open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}));

const INVOICES = [
    {
        id: 'inv-1', invoiceNumber: 'INV-2569-0001', applicationNumber: 'APP-0001', totalAmount: 35310,
        status: 'PAID_PENDING_RECEIPT', dueDate: '2026-09-20T00:00:00Z', paidAt: '2026-09-18T00:00:00Z',
        createdAt: '2026-09-10T00:00:00Z', applicant: { firstName: 'สมชาย', lastName: 'ใจดี' }, items: [],
    },
    {
        id: 'inv-2', invoiceNumber: 'INV-2569-0002', applicationNumber: 'APP-0002', totalAmount: 12000,
        status: 'RECEIPT_ISSUED', erpStatus: 'RECEIPT_ISSUED', dueDate: '2026-09-21T00:00:00Z',
        createdAt: '2026-09-11T00:00:00Z', applicant: { companyName: 'บริษัท สมุนไพร จำกัด' }, items: [],
    },
];
// ใบแจ้งหนี้ค่าธรรมเนียมรัฐแบบเก่า — หลังบ้านกันการเงินบริษัทไม่ให้ระงับ/ปลดระงับ (assertInvoiceSideWritable)
const mockStateInvoice = {
    id: 'inv-s', invoiceNumber: 'INV-2568-STATE', applicationNumber: 'APP-0003', totalAmount: 5000, serviceType: 'PHASE_1_STATE_FEE',
    issuerSide: 'DTAM', // derived by the backend (invoice-service withDerivedStatus)
    status: 'PAID_PENDING_RECEIPT', dueDate: '2026-09-20T00:00:00Z', paidAt: '2026-09-18T00:00:00Z',
    createdAt: '2026-09-09T00:00:00Z', applicant: { firstName: 'สมศรี', lastName: 'ใจงาม' }, items: [],
};

function mockApiGet(url: string) {
    if (url.startsWith('/invoices/summary')) {
        return { success: true, data: { totalRevenue: 47310, pendingAmount: 0, overdueAmount: 0, monthlyRevenue: 47310, invoiceCount: { paid: 2, pending: 0, overdue: 0 } } };
    }
    if (url.startsWith('/invoices/receipts/exceptions')) { return { success: true, data: { exceptions: [] } }; }
    if (url.startsWith('/invoices/receipts/pending')) {
        return { success: true, data: { invoices: [
            { id: 'r-1', invoiceNumber: 'INV-2569-0101', applicationNumber: 'APP-0101', applicantName: 'สมชาย ใจดี', totalAmount: 35310, paidAt: '2026-09-18T00:00:00Z', serviceType: 'PHASE_1_PLATFORM_FEE' },
            { id: 'r-2', invoiceNumber: 'INV-2569-0102', applicationNumber: 'APP-0102', applicantName: 'สมหญิง ใจงาม', totalAmount: 5000, paidAt: '2026-09-17T00:00:00Z', serviceType: 'PHASE_1_STATE_FEE' },
        ] } };
    }
    if (url.startsWith('/invoices/revenue-summary')) { return { success: true, data: {} }; }
    if (url.startsWith('/invoices')) { return { success: true, data: { invoices: mockWithState ? [mockStateInvoice] : INVOICES } }; }
    return { success: true, data: {} };
}
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (url: string) => Promise.resolve(mockApiGet(url)),
        post: () => Promise.resolve({ success: true, data: {} }),
        getBlob: () => Promise.resolve(null),
    },
}));

jest.mock('@/lib/services/finance-orphans-service', () => {
    const actual = jest.requireActual('@/lib/services/finance-orphans-service') as Record<string, unknown>;
    const PI = [{
        id: 'pi-00000001', invoiceNumber: 'SUP-001', supplierName: 'ผู้ขาย ก', supplierTaxId: '0105551234567',
        invoiceDate: '2026-09-01T00:00:00Z', subtotal: 100, vat: 7, totalAmount: 107, category: 'OTHER',
        status: 'PENDING_REVIEW', createdAt: '2026-09-01T00:00:00Z',
    }];
    return {
        ...actual,
        PurchaseInvoiceService: { list: () => Promise.resolve(PI), listPurchaseInvoices: () => Promise.resolve(PI) },
        PeriodCloseService: {
            listPeriodCloses: () => Promise.resolve([{
                id: 'pc-1', year: 2026, month: 8, status: 'CLOSED', closedAt: '2026-09-02T00:00:00Z', closedBy: 'u-9',
            }]),
        },
        ManualJournalEntryService: {
            listDrafts: () => Promise.resolve([{
                id: 'je-00000001', status: 'DRAFT', entryDate: '2026-09-05T00:00:00Z', description: 'ปรับปรุงรายการ',
                lines: [], totalDebit: 100, totalCredit: 100, createdBy: 'u-9', createdAt: '2026-09-05T00:00:00Z',
            }]),
        },
        WhtCertificateService: {
            listCertificates: () => Promise.resolve({ count: 0, certificates: [] }),
            checkApplicable: () => Promise.resolve({ applicable: false }),
        },
    };
});

jest.mock('@/lib/services/accounting-service', () => {
    const actual = jest.requireActual('@/lib/services/accounting-service') as Record<string, unknown>;
    return {
        ...actual,
        AccountingService: {
            ...(actual.AccountingService as Record<string, unknown>),
            getTrialBalance: () => Promise.resolve({
                asOfDate: '2026-09-27', rows: [], totals: { debit: 0, credit: 0, isBalanced: true },
            }),
            getArAging: (args: { bookSide: string }) => Promise.resolve({
                asOfDate: '2026-09-27', bookSide: args.bookSide, organizationId: 'org-1',
                totalsByBucket: {}, totalOutstanding: args.bookSide === 'PLATFORM' ? 35310 : 0,
                rowCount: 0, rows: [],
            }),
        },
    };
});

import { AccountingDashboardClient } from '../accounting-dashboard-client';
import WhtClientView from '../wht/client-view';
import PurchaseInvoicesClientView from '../purchase-invoices/client-view';
import ReportsClientView from '../reports/client-view';
import PeriodCloseClientView from '../period-close/client-view';
import ManualJournalClientView from '../manual-journal-entries/client-view';
import { ArAgingReport } from '../reports/ArAgingReport';
import { moduleTabsFor } from '../../components/provider-module-tabs';
import ReceiptsPage from '../../receipts/page';
import { providerLandingPath, providerRoleCanOpen } from '@/lib/provider-role-config';

const D = 'finance_officer_dtam';
const P = 'finance_officer_platform';

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
});
afterEach(async () => {
    if (root) { await act(async () => { root?.unmount(); }); root = null; }
    container.remove();
});

async function renderAs(role: string, element: React.ReactElement): Promise<HTMLElement> {
    mockRole = role;
    await act(async () => {
        root = createRoot(container);
        root.render(element);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const snapshot = container.cloneNode(true) as HTMLElement;
    await act(async () => { root?.unmount(); });
    root = null;
    container.innerHTML = '';
    return snapshot;
}

/** ข้อความทั้งหน้า หลังตัดปุ่ม/ลิงก์ที่เป็นการเขียนออก และตัดประกาศสิทธิ์ของผู้ดู */
function readContent(snapshot: HTMLElement, writeLabels: readonly string[]): string {
    const copy = snapshot.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-role-notice]').forEach((el) => el.remove());
    copy.querySelectorAll('button, a').forEach((el) => {
        if (isWriteControl(el, writeLabels)) { el.remove(); }
    });
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}

/** ปุ่ม/ลิงก์ที่เป็นการเขียน — จับจากข้อความบนปุ่มหรือ aria-label */
function isWriteControl(el: Element, writeLabels: readonly string[]): boolean {
    const text = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`;
    return writeLabels.some((label) => text.includes(label));
}

function writeButtons(snapshot: HTMLElement, writeLabels: readonly string[]): string[] {
    return Array.from(snapshot.querySelectorAll('button, a'))
        .filter((el) => isWriteControl(el, writeLabels))
        .map((el) => `${(el.textContent || '').trim()} ${el.getAttribute('aria-label') || ''}`.trim());
}

const PAGES: ReadonlyArray<[string, () => React.ReactElement, readonly string[]]> = [
    ['แดชบอร์ดบัญชี /provider/accounting', () => <AccountingDashboardClient />, []],
    ['ภาษีหัก ณ ที่จ่าย /wht', () => <WhtClientView />, ['บันทึก ทบ.50 ทวิ ใหม่']],
    ['ใบกำกับภาษีซื้อ /purchase-invoices', () => <PurchaseInvoicesClientView />, ['บันทึกใบกำกับใหม่', 'อนุมัติใบกำกับ', 'ปฏิเสธใบกำกับ']],
    ['รายงานการเงิน /reports', () => <ReportsClientView />, []],
    ['ปิดงวดบัญชี /period-close', () => <PeriodCloseClientView />, ['ปิดงวดใหม่']],
    ['สมุดรายวันทั่วไป /manual-journal-entries', () => <ManualJournalClientView />, ['สร้างร่างใหม่']],
    ['ลูกหนี้ค้างชำระ /ar-aging', () => <ArAgingReport />, []],
    ['ใบเสร็จ /provider/receipts', () => <ReceiptsPage />, ['ออกใบเสร็จ']],
];

describe('หน้าบัญชี — การเงินกรมกับการเงินบริษัทเห็นเนื้อหาอ่านเดียวกัน', () => {
    it.each(PAGES)('%s', async (_name, make, writeLabels) => {
        const asD = await renderAs(D, make());
        const asP = await renderAs(P, make());
        expect(readContent(asD, writeLabels)).toEqual(readContent(asP, writeLabels));
        expect(readContent(asD, writeLabels)).not.toContain('ไม่มีสิทธิ์เข้าถึง');
    });
});

describe('ปุ่มเขียนบัญชี — การเงินกรมไม่เห็นเลย การเงินบริษัทเห็น (กรมฯ ดูอย่างเดียว)', () => {
    it.each(PAGES.filter(([, , labels]) => labels.length > 0))('%s', async (_name, make, writeLabels) => {
        const asD = await renderAs(D, make());
        const asP = await renderAs(P, make());
        expect(writeButtons(asD, writeLabels)).toEqual([]);
        expect(writeButtons(asP, writeLabels).length).toBeGreaterThan(0);
    });
});

describe('หัวข้อหน้าบัญชี — กลาง ๆ เดียวกันทั้งสองบทบาท', () => {
    it('ไม่มีคำว่า "บัญชี DTAM" หรือ "บัญชี Platform" ในหน้าของใครเลย', async () => {
        for (const role of [D, P]) {
            const text = (await renderAs(role, <AccountingDashboardClient />)).textContent || '';
            expect(text).toContain('บัญชีและใบเสร็จ');
            expect(text).not.toMatch(/บัญชี DTAM|บัญชี Platform|ฝั่งรัฐ \(DTAM\)|ฝั่งแพลตฟอร์ม/);
        }
    });
});

describe('แท็บเมนูบัญชี — ชุดเดียวกัน', () => {
    it('moduleTabsFor ไม่รับบทบาทเลย — แท็บเดียวกันทุกคน ครบหกแท็บ', () => {
        // เดิม: moduleTabsFor(pathname, role) และการเงินกรมได้แท็บเดียว (ลูกหนี้ค้างชำระ)
        expect(moduleTabsFor.length).toBe(1);
        expect(moduleTabsFor('/provider/accounting')?.tabs.map((t) => t.href)).toHaveLength(6);
    });
});

describe('รายละเอียดใบแจ้งหนี้ — ระงับ/ปลดระงับ/คืนเงิน เฉพาะบทบาทที่หลังบ้านยอมให้เขียน', () => {
    const MODAL_WRITE = ['ระงับ / Hold', 'ปลดล็อก', 'คืนเงิน'];

    async function openFirstInvoiceAs(role: string): Promise<string[]> {
        mockRole = role;
        await act(async () => {
            root = createRoot(container);
            root.render(<AccountingDashboardClient />);
        });
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        const eye = container.querySelector('button[aria-label="ดูรายละเอียดใบแจ้งหนี้"]') as HTMLButtonElement | null;
        expect(eye).not.toBeNull();
        await act(async () => { eye?.click(); });
        const found = writeButtons(container, MODAL_WRITE);
        const dialogText = container.querySelector('[data-testid="dialog"]')?.textContent || '';
        await act(async () => { root?.unmount(); });
        root = null;
        container.innerHTML = '';
        expect(dialogText).toContain('INV-2569-0001');
        return found;
    }

    it('การเงินกรมเปิดรายละเอียดได้ แต่ไม่มีปุ่มเขียนเลย (เดิมปุ่มคืนเงินขึ้นแล้วได้ 403)', async () => {
        expect(await openFirstInvoiceAs(D)).toEqual([]);
    });

    it('การเงินบริษัทเห็นปุ่มระงับและคืนเงิน', async () => {
        const found = await openFirstInvoiceAs(P);
        expect(found.some((t) => t.includes('ระงับ / Hold'))).toBe(true);
        expect(found.some((t) => t.includes('คืนเงิน'))).toBe(true);
    });
});

describe('หน้าแรกหลังล็อกอิน — ที่เดียวกันสำหรับการเงินทั้งสองบทบาท', () => {
    it('providerLandingPath ส่งทั้งคู่ไป /provider/accounting และเปิดทุกแท็บได้', () => {
        expect(providerLandingPath(D)).toBe('/provider/accounting');
        expect(providerLandingPath(P)).toBe('/provider/accounting');
        for (const path of ['/provider/accounting', '/provider/accounting/reports', '/provider/accounting/wht',
            '/provider/accounting/purchase-invoices', '/provider/accounting/manual-journal-entries',
            '/provider/accounting/period-close', '/provider/accounting/ar-aging', '/provider/receipts']) {
            expect([path, providerRoleCanOpen(D, path)]).toEqual([path, providerRoleCanOpen(P, path)]);
            expect(providerRoleCanOpen(D, path)).toBe(true);
        }
    });
});

describe('fix round 1 — ระงับ/ปลดระงับ บนใบค่าธรรมเนียมรัฐแบบเก่า: ไม่แสดงปุ่มที่หลังบ้านจะตอบ 403', () => {
    afterEach(() => { mockWithState = false; });

    it('การเงินบริษัทเปิดใบ STATE → ไม่มีปุ่มระงับ (ด่าน assertInvoiceSideWritable ปฏิเสธ) · ผู้ดูแลระบบกรมยังเห็น', async () => {
        mockWithState = true;
        async function holdButtonsAs(role: string): Promise<string[]> {
            mockRole = role;
            await act(async () => { root = createRoot(container); root.render(<AccountingDashboardClient />); });
            await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
            const eye = container.querySelector('button[aria-label="ดูรายละเอียดใบแจ้งหนี้"]') as HTMLButtonElement | null;
            expect(eye).not.toBeNull();
            await act(async () => { eye?.click(); });
            const found = writeButtons(container, ['ระงับ / Hold', 'ปลดล็อก']);
            await act(async () => { root?.unmount(); });
            root = null;
            container.innerHTML = '';
            return found;
        }
        expect(await holdButtonsAs(P)).toEqual([]);
        expect((await holdButtonsAs('system_admin_dtam')).length).toBeGreaterThan(0);
    });
});

describe('S6 (operator 2026-09-27) — ผู้ตรวจประเมินไม่เห็นหน้าบัญชี', () => {
    it('field_inspector เปิด /provider/accounting และ /provider/receipts ไม่ได้ และไม่มีแท็บเมนูบัญชี', () => {
        for (const path of ['/provider/accounting', '/provider/accounting/reports', '/provider/receipts']) {
            expect([path, providerRoleCanOpen('field_inspector', path)]).toEqual([path, false]);
        }
    });

    it('หน้ารายงานของ field_inspector แสดงไม่มีสิทธิ์เข้าถึง', async () => {
        const text = (await renderAs('field_inspector', <ReportsClientView />)).textContent || '';
        expect(text).toContain('ไม่มีสิทธิ์เข้าถึง');
    });
});
