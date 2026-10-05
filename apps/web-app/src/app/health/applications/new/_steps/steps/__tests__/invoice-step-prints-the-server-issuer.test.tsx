/**
 * The web quotation says what the PDF says (operator-approved 2026-09-28,
 * fix/web-quotation-truth). Seen on staging at main 863400fc
 * (state/staging-walk-2026-09-27/screens/85-web-quotation-step-863400fc.png):
 *
 *   - the header printed the retired ministry block: "ระบบรับรองมาตรฐาน GACP
 *     สมุนไพร", 88/23 หมู่ 4 ถนนติวานนท์, โทร 0-2591-7007, contact@gacpth.com
 *   - the opening paragraph doubled that name and hardcoded "พืชกัญชา" on a
 *     ginger application
 *   - the print button carried an emoji
 *   - the note under the document said a finance officer checks the payment
 *     evidence, while payment is settled by the payment provider's webhook
 *     only and no person checks it
 *
 * The screen now prints the server's `issuer` + `copy` (GET
 * /applications/:id/quotations, built by the same backend helpers as the PDF).
 * Harness: the createRoot + act pattern of invoice-step-shows-the-server-payer.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  QuotationRecord,
  QuotationsBySide,
} from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide | null>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getQuotations: () => mockGetQuotations(),
    },
  };
});

jest.mock('@/lib/api/api-client', () => ({
  apiClient: {
    get: jest.fn(async () => ({ success: true, data: { status: 'PENDING_DOC_FEE' } })),
    post: jest.fn(async () => ({ success: true, data: {} })),
  },
}));

jest.mock('../../hooks/use-application-flow-store', () => ({
  useApplicationFlowStore: () => ({
    state: { applicationId: 'app-1', applicantData: {} },
    updateState: jest.fn(),
  }),
}));

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(async () => 'data:image/png;base64,FAKE') },
}));

import { StepInvoice } from '../invoice-step';

const QUOTATION: QuotationRecord = {
  id: 'qt-1',
  applicationId: 'app-1',
  issuerType: 'PLATFORM',
  quotationNumber: 'QT-PRD-2026-000002',
  subtotal: '33000.00',
  vat: '2310.00',
  totalAmount: '35310.00',
  status: 'PENDING',
  createdAt: '2026-09-27T00:00:00.000Z',
  installments: [
    { phase: 'PHASE_1', amount: 5885 },
    { phase: 'PHASE_2', amount: 29425 },
  ],
};

// Synthetic values: the test proves the screen prints what the SERVER sent,
// so none of them is the real company's.
const SERVER = {
  issuer: {
    name: 'บริษัท ผู้ออกเอกสารทดสอบ จำกัด',
    taxId: '0105599999991',
    address: '1 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10000',
    email: 'billing@example.test',
    branch: 'สำนักงานใหญ่',
    contact: 'โทร 020000000 · อีเมล billing@example.test',
  },
  copy: {
    intro: 'บริษัท ผู้ออกเอกสารทดสอบ จำกัด (สำนักงานใหญ่) มีความยินดีที่จะเสนอราคาค่าบริการตรวจประเมินและรับรองมาตรฐานการเพาะปลูกและเก็บเกี่ยวที่ดีของพืชขิง (Good Agricultural and Collection Practices) ดังรายการต่อไปนี้',
    note: 'บรรทัดการชำระเงินจากเซิร์ฟเวอร์',
  },
  signatory: {
    org: 'ในนาม บริษัท ผู้ออกเอกสารทดสอบ จำกัด',
    name: 'ผู้มีอำนาจลงนาม',
    title1: 'กรรมการผู้มีอำนาจ',
    title2: '',
  },
};

const RETIRED = [
  'ระบบรับรองมาตรฐาน GACP สมุนไพร',
  '0-2591-7007',
  '88/23',
  'ติวานนท์',
  'contact@gacpth.com',
  'กัญชา',
];

const EMOJI = /\p{Extended_Pictographic}/u;

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('slot 10 prints the issuer and the wording the server sent', () => {
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
    container?.remove();
    container = null;
  });

  async function mountStep(): Promise<string> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<StepInvoice />);
    });
    await flushAsync();
    return container.textContent || '';
  }

  it('the header is the server issuer, never the retired ministry block', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: QUOTATION,
      ...SERVER,
    } as QuotationsBySide);
    const text = await mountStep();

    expect(text).toContain(SERVER.issuer.name);
    expect(text).toContain(SERVER.issuer.taxId);
    expect(text).toContain(SERVER.issuer.address);
    // The header prints the server's contact line, the PDF header's own string
    // (fix round 1, M-1).
    expect(text).toContain(SERVER.issuer.contact);
    expect(text).toContain(SERVER.issuer.branch);
    for (const word of RETIRED) { expect(text).not.toContain(word); }
  });

  it('the opening paragraph and the payment note are the server copy', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: QUOTATION,
      ...SERVER,
    } as QuotationsBySide);
    const text = await mountStep();

    expect(text).toContain(SERVER.copy.intro);
    expect(text).toContain(SERVER.copy.note);
    expect(text).toContain(SERVER.signatory.org);
  });

  it('no emoji anywhere on the step (the print button is a text label)', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: QUOTATION,
      ...SERVER,
    } as QuotationsBySide);
    const text = await mountStep();

    expect(text).toContain('พิมพ์เอกสาร / ดาวน์โหลด PDF');
    expect(text).not.toMatch(EMOJI);
  });

  it('no finance officer checks the payment: the sentence is gone', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: QUOTATION,
      ...SERVER,
    } as QuotationsBySide);
    const text = await mountStep();

    expect(text).not.toContain('เจ้าหน้าที่การเงินจะตรวจสอบหลักฐานการชำระเงิน');
    expect(text).not.toContain('หลักฐานการชำระเงิน');
    expect(text).not.toMatch(/stripe/i);
    // Fix round 1 (M-3): what the sentence DOES say — document review starts
    // only once the system has confirmed the first payment — and no doubled
    // "ชำระ…ชำระ" where the service-facts sentence joins it.
    expect(text).toContain('คำขอจะเข้าสู่ขั้นตอนตรวจเอกสารหลังระบบยืนยันการชำระงวดที่ 1 ค่าบริการตรวจสอบเอกสารแล้ว');
    expect(text).not.toMatch(/งวดที่ 1\s*ชำระ/);
  });

  it('no issuer from the server: the header prints nothing rather than a default issuer', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: QUOTATION });
    const text = await mountStep();

    for (const word of RETIRED) { expect(text).not.toContain(word); }
  });
});
