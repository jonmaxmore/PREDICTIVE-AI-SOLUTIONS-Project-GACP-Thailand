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

jest.mock('@/lib/api/api-client', () => {
  const api = {
    get: (path: string) => mockApiGet(path),
    post: jest.fn(),
    getBlob: jest.fn(),
  };
  return { api, apiClient: api };
});

jest.mock('@/lib/services/auth-service', () => ({
  AuthService: {
    getUser: () => ({ id: 'user-1', role: 'HEALTH', email: 'farmer@test' }),
    getToken: () => 'test-token',
  },
}));

jest.mock('@/components/payments/RefundVisibilitySection', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/payments/QuotationReviewSection', () => ({
  __esModule: true,
  default: () => null,
}));

// One stable URLSearchParams object whose contents each test sets — a new
// object per render would loop loadPayments (see payments-states.test.tsx).
const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/',
    query: {},
  };
  return {
    useRouter: () => router,
    usePathname: () => '/',
    useSearchParams: () => mockSearchParams,
  };
});

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}));



import HealthPaymentsPage from '../client-view';

/**
 * fix/fee-line-descriptions round 5 (review): the payments page names each invoice by the
 * service the server says it bills (GET /invoices/my `service`, from the catalogue): a
 * renewal is "ค่าบริการต่ออายุใบรับรอง" with its coverage — never "งวดที่ 2" and never the
 * old card title "ค่าบริการรับรอง", which no catalogue holds.
 */
const RENEWAL = { key: 'RENEWAL', name: 'ค่าบริการต่ออายุใบรับรอง', coverage: 'ครอบคลุม: ตรวจประเมินเพื่อต่ออายุ · ออกใบรับรองฉบับใหม่พร้อมลายมือชื่อดิจิทัลและ QR · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์' };
const P1 = { key: 'PHASE_1', name: 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร', coverage: 'ครอบคลุม: รับและตรวจความครบถ้วน ความถูกต้องของเอกสารคำขอตามหลักเกณฑ์ GACP · ตรวจเบื้องต้นด้วยระบบ · แจ้งผลและรับเอกสารแก้ไข · จัดเก็บเอกสารอิเล็กทรอนิกส์ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์' };
const APP = { id: 'app-ren-1', applicationNumber: 'APP-2569-RENEW-01', status: 'PENDING_AUDIT_FEE' };

function invoice(serviceType: string, service: unknown) {
  return {
    id: `inv-${serviceType}`, invoiceNumber: `INV-CO-RENEW001-${serviceType.slice(-2)}`, applicationId: APP.id,
    totalAmount: '70620', subtotal: '66000', vat: '4620', status: 'pending', createdAt: '2026-10-03T03:00:00.000Z',
    dueDate: '2026-10-14T00:00:00.000Z', serviceType, service, lineItems: [],
  };
}

async function flushAsync(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(invoices: unknown[]): Promise<string> {
  mockApiGet.mockImplementation(async (path: string) => {
    if (path === '/invoices/my') return { success: true, data: invoices };
    if (path === '/applications/my') return { success: true, data: [APP] };
    return { success: true, data: [] };
  });
  await act(async () => { root.render(<HealthPaymentsPage />); });
  await flushAsync();
  return (container.textContent || '').replace(/\s+/g, ' ');
}

describe('payments page names the service of each invoice', () => {
  it('a renewal invoice: the renewal name and coverage, no งวดที่ 2, no "ค่าบริการรับรอง"', async () => {
    const text = await mount([invoice('CERTIFICATION_CHECKOUT_M2', RENEWAL)]);
    expect(text).toContain(RENEWAL.name);
    expect(text).toContain(RENEWAL.coverage);
    expect(text).not.toContain('งวดที่ 2');
    expect(text).not.toContain('ค่าบริการรับรอง');
    expect(text).not.toContain('ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
  });

  it('a phase-1 invoice: the instalment name and coverage, no "ค่าบริการรับรอง"', async () => {
    const text = await mount([invoice('CERTIFICATION_CHECKOUT_M1', P1)]);
    expect(text).toContain(P1.name);
    expect(text).toContain(P1.coverage);
    expect(text).not.toContain('ค่าบริการรับรอง');
  });
});
