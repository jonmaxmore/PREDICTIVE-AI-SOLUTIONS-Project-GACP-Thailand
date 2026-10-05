/**
 * applicant-receipt-and-workspace.test.tsx — staging walk 2026-09-29
 * (~/work/state/staging-walk-2026-09-29/INDEX.md), four defects on /health/payments:
 *
 *   P1  After payment the only download was the invoice ("ใบวางบิล / ใบแจ้งหนี้").
 *       A paid invoice that carries a receipt number now offers the receipt the
 *       system issued ("ใบเสร็จรับเงิน/ใบกำกับภาษี", served by the owner's door
 *       GET /api/invoices/my/:id/receipt/pdf). Unpaid: the invoice PDF, as before.
 *   P5  The filter chip printed the application UUID ("กรองตามคำขอ: aa75ba6e-…").
 *       It now prints the application NUMBER the applicant knows.
 *   P6  Billing reads follow the active workspace: switching workspace on this
 *       page reloads the invoices, the applications and the quotation lookup.
 *   ?applicationId=  The page read only ?app=; a link carrying ?applicationId=
 *       showed another application's quotation. Both are read now,
 *       ?applicationId= first.
 *
 * Transport-level mock (api.get routed by path) so getMyPayments, getMyApplications
 * and getQuotations run for real.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Envelope = { success: boolean; data?: unknown; error?: string };

const mockApiGet = jest.fn<(path: string) => Promise<Envelope>>();
const mockDownloadInvoicePdf = jest.fn<(id: string, n: string) => Promise<boolean>>();
const mockDownloadReceiptPdf = jest.fn<(id: string, n: string) => Promise<boolean>>();

jest.mock('@/lib/api/api-client', () => {
  const api = {
    get: (path: string) => mockApiGet(path),
    post: jest.fn(),
    getBlob: jest.fn(),
  };
  return { api, apiClient: api };
});

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getIssuerByServiceType: async () => ({ success: true, data: null }),
      getCreditNotes: async () => [],
      downloadInvoicePdf: (id: string, n: string) => mockDownloadInvoicePdf(id, n),
      downloadReceiptPdf: (id: string, n: string) => mockDownloadReceiptPdf(id, n),
    },
  };
});

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
    getToken: () => 'test-token',
  },
}));

// The workspace the page is in. Mutated between renders to simulate a switch.
const workspace: { current: { id: string } | null } = { current: null };
jest.mock('@/lib/services/active-entity-provider', () => ({
  useActiveEntity: () => ({
    entities: [],
    activeEntity: workspace.current,
    isLoading: false,
    setActiveEntity: async () => {},
    refresh: async () => {},
  }),
}));

jest.mock('@/components/payments/RefundVisibilitySection', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/payments/QuotationReviewSection', () => ({ __esModule: true, default: () => null }));

const search: { current: URLSearchParams } = { current: new URLSearchParams() };
jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
    back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
    pathname: '/', query: {},
  };
  return {
    useRouter: () => router,
    usePathname: () => '/',
    useSearchParams: () => search.current,
  };
});

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));

import HealthPaymentsPage from '../client-view';

const APP_UUID = 'aa75ba6e-2f4c-4d7e-9a0e-5b1f7c3d2e10';
const APP_NUMBER = 'APP-2569-MUJZRHP3-69A796';
const OTHER_UUID = '7fe0b094-1111-4222-8333-944455556666';
const RECEIPT_NUMBER = 'TAX-PRD-2026-000002';
const RECEIPT_BUTTON = 'ดาวน์โหลดใบเสร็จรับเงิน/ใบกำกับภาษี';

const lineItems = [
  { lineNumber: 1, description: 'ค่าบริการ GACP', quantity: 1, unitPrice: '5500.00', amount: '5500.00' },
];
const rawPaidWithReceipt = {
  id: 'inv-paid',
  invoiceNumber: 'INV-CO-09246C23-M1',
  applicationId: APP_UUID,
  totalAmount: '5885.00',
  status: 'RECEIPT_ISSUED',
  erpStatus: 'RECEIPT_ISSUED',
  receiptNumber: RECEIPT_NUMBER,
  receiptIssuedAt: '2026-09-29T08:14:45.000Z',
  createdAt: '2026-09-29T08:13:00.000Z',
  paidAt: '2026-09-29T08:14:45.000Z',
  serviceType: 'CERTIFICATION_CHECKOUT_M1',
  lineItems,
};
const rawUnpaid = {
  ...rawPaidWithReceipt,
  id: 'inv-unpaid',
  status: 'pending',
  erpStatus: 'PENDING',
  receiptNumber: null,
  receiptIssuedAt: null,
  paidAt: null,
};

function routeApi({
  invoices = [] as unknown[],
  applications = [] as unknown[],
  quotationNumber = null as string | null,
} = {}) {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path === '/invoices/my') return { success: true, data: invoices };
    if (path === '/applications/my') return { success: true, data: applications };
    if (path.startsWith('/applications/') && path.endsWith('/quotations')) {
      return { success: true, data: { dtam: null, platform: null, applicationNumber: quotationNumber } };
    }
    return { success: true, data: null };
  });
}

const callsTo = (predicate: (p: string) => boolean) => mockApiGet.mock.calls.filter(([p]) => predicate(p)).length;
const quotationCalls = () => mockApiGet.mock.calls.map(([p]) => p).filter((p) => p.endsWith('/quotations'));

async function flushAsync(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes(label)) as
    | HTMLButtonElement
    | undefined;
}

function click(btn: HTMLElement | undefined, label: string) {
  if (!btn) throw new Error(`button "${label}" not found`);
  act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('/health/payments — applicant receipt, application number, workspace (walk 2026-09-29)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    workspace.current = null;
    search.current = new URLSearchParams();
    mockDownloadInvoicePdf.mockResolvedValue(true);
    mockDownloadReceiptPdf.mockResolvedValue(true);
  });

  afterEach(() => {
    if (root) { act(() => { root?.unmount(); }); root = null; }
    if (container) { container.remove(); container = null; }
  });

  async function renderPage(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthPaymentsPage />);
    });
    await flushAsync();
    return container;
  }

  async function rerender() {
    await act(async () => { root!.render(<HealthPaymentsPage />); });
    await flushAsync();
  }

  async function openDetail(c: HTMLElement) {
    click(buttonByText(c, 'ดูรายละเอียด'), 'ดูรายละเอียด');
    await flushAsync(2);
    expect(c.textContent).toContain('รายละเอียดใบแจ้งหนี้');
  }

  describe('P1 — the paid invoice offers its receipt', () => {
    it('a paid invoice with a receipt number offers ใบเสร็จรับเงิน/ใบกำกับภาษี and downloads it through the receipt door', async () => {
      routeApi({ invoices: [rawPaidWithReceipt], applications: [{ id: APP_UUID, applicationNumber: APP_NUMBER, status: 'DOC_FEE_PAID' }] });
      const c = await renderPage();
      await openDetail(c);

      const receiptBtn = buttonByText(c, RECEIPT_BUTTON);
      expect(receiptBtn).toBeTruthy();
      click(receiptBtn, RECEIPT_BUTTON);
      await flushAsync();

      expect(mockDownloadReceiptPdf).toHaveBeenCalledWith('inv-paid', RECEIPT_NUMBER);
      expect(mockDownloadInvoicePdf).not.toHaveBeenCalled();
    });

    it('the invoice itself is still downloadable after payment, named as the invoice', async () => {
      routeApi({ invoices: [rawPaidWithReceipt] });
      const c = await renderPage();
      await openDetail(c);

      click(buttonByText(c, 'ดาวน์โหลดใบแจ้งหนี้'), 'ดาวน์โหลดใบแจ้งหนี้');
      await flushAsync();

      expect(mockDownloadInvoicePdf).toHaveBeenCalledWith('inv-paid', 'INV-CO-09246C23-M1');
      expect(mockDownloadReceiptPdf).not.toHaveBeenCalled();
    });

    it('a failed receipt download says so in Thai and names the receipt number', async () => {
      mockDownloadReceiptPdf.mockResolvedValue(false);
      routeApi({ invoices: [rawPaidWithReceipt] });
      const c = await renderPage();
      await openDetail(c);

      click(buttonByText(c, RECEIPT_BUTTON), RECEIPT_BUTTON);
      await flushAsync();

      const alert = c.querySelector('[role="alert"]');
      expect(alert?.textContent || '').toContain('ดาวน์โหลดใบเสร็จรับเงิน/ใบกำกับภาษีไม่สำเร็จ');
      expect(alert?.textContent || '').toContain(RECEIPT_NUMBER);
    });

    it('an unpaid invoice offers no receipt; its download is the invoice PDF as before', async () => {
      routeApi({ invoices: [rawUnpaid] });
      const c = await renderPage();
      await openDetail(c);

      expect(buttonByText(c, RECEIPT_BUTTON)).toBeUndefined();
      click(buttonByText(c, 'ดาวน์โหลด PDF'), 'ดาวน์โหลด PDF');
      await flushAsync();
      expect(mockDownloadInvoicePdf).toHaveBeenCalledWith('inv-unpaid', 'INV-CO-09246C23-M1');
      expect(mockDownloadReceiptPdf).not.toHaveBeenCalled();
    });
  });

  describe('P5 — the filter chip names the application by its number', () => {
    it('prints the application number from the applicant\'s own list, never the UUID', async () => {
      search.current = new URLSearchParams(`app=${APP_UUID}`);
      routeApi({ invoices: [rawPaidWithReceipt], applications: [{ id: APP_UUID, applicationNumber: APP_NUMBER, status: 'DOC_FEE_PAID' }] });
      const c = await renderPage();

      expect(c.textContent).toContain(`กรองตามคำขอ: ${APP_NUMBER}`);
      expect(c.textContent).not.toContain(APP_UUID);
    });

    it('falls back to the number the quotation lookup returned', async () => {
      search.current = new URLSearchParams(`app=${APP_UUID}`);
      routeApi({ invoices: [rawPaidWithReceipt], applications: [], quotationNumber: APP_NUMBER });
      const c = await renderPage();

      expect(c.textContent).toContain(`กรองตามคำขอ: ${APP_NUMBER}`);
      expect(c.textContent).not.toContain(APP_UUID);
    });

    it('with no number known yet, the chip still never prints the UUID', async () => {
      search.current = new URLSearchParams(`app=${APP_UUID}`);
      routeApi({ invoices: [], applications: [], quotationNumber: null });
      const c = await renderPage();

      expect(c.textContent).toContain('กรองตามคำขอที่เลือก');
      expect(c.textContent).not.toContain(APP_UUID);
    });
  });

  describe('?applicationId= is read as well as ?app=', () => {
    it('?applicationId= filters the page and drives the quotation lookup', async () => {
      search.current = new URLSearchParams(`applicationId=${APP_UUID}`);
      routeApi({ invoices: [rawPaidWithReceipt], applications: [{ id: APP_UUID, applicationNumber: APP_NUMBER, status: 'DOC_FEE_PAID' }] });
      const c = await renderPage();

      expect(c.textContent).toContain(`กรองตามคำขอ: ${APP_NUMBER}`);
      expect(quotationCalls()).toEqual([`/applications/${encodeURIComponent(APP_UUID)}/quotations`]);
    });

    it('when a link carries both, ?applicationId= wins', async () => {
      search.current = new URLSearchParams(`app=${OTHER_UUID}&applicationId=${APP_UUID}`);
      routeApi({ invoices: [rawPaidWithReceipt], applications: [{ id: APP_UUID, applicationNumber: APP_NUMBER, status: 'DOC_FEE_PAID' }] });
      await renderPage();

      expect(quotationCalls()).toEqual([`/applications/${encodeURIComponent(APP_UUID)}/quotations`]);
    });

    it('an old ?app= link keeps working', async () => {
      search.current = new URLSearchParams(`app=${APP_UUID}&phase=PHASE_1`);
      routeApi({ invoices: [rawPaidWithReceipt], applications: [{ id: APP_UUID, applicationNumber: APP_NUMBER, status: 'DOC_FEE_PAID' }] });
      await renderPage();

      expect(quotationCalls()).toEqual([`/applications/${encodeURIComponent(APP_UUID)}/quotations`]);
    });
  });

  describe('P6 — the page follows the active workspace', () => {
    it('switching workspace reloads the invoices, the applications and the quotation lookup', async () => {
      workspace.current = { id: 'entity-company' };
      routeApi({ invoices: [rawPaidWithReceipt], applications: [{ id: APP_UUID, applicationNumber: APP_NUMBER, status: 'DOC_FEE_PAID' }] });
      await renderPage();
      const before = {
        invoices: callsTo((p) => p === '/invoices/my'),
        applications: callsTo((p) => p === '/applications/my'),
      };
      expect(before.invoices).toBe(1);

      // The personal workspace holds nothing of the company's.
      routeApi({ invoices: [], applications: [] });
      workspace.current = { id: 'entity-personal' };
      await rerender();

      expect(callsTo((p) => p === '/invoices/my')).toBe(before.invoices + 1);
      expect(callsTo((p) => p === '/applications/my')).toBe(before.applications + 1);
      // Nothing of the company's application is asked for in the personal workspace.
      expect(quotationCalls().filter((p) => p.includes(APP_UUID))).toHaveLength(1);
    });

    it('the workspace arriving after the first render (provider hydration) does not fetch twice', async () => {
      workspace.current = null;
      routeApi({ invoices: [rawPaidWithReceipt], applications: [{ id: APP_UUID, applicationNumber: APP_NUMBER, status: 'DOC_FEE_PAID' }] });
      await renderPage();
      workspace.current = { id: 'entity-company' };
      await rerender();

      expect(callsTo((p) => p === '/invoices/my')).toBe(1);
      expect(callsTo((p) => p === '/applications/my')).toBe(1);
      expect(quotationCalls()).toHaveLength(1);
    });
  });
});
