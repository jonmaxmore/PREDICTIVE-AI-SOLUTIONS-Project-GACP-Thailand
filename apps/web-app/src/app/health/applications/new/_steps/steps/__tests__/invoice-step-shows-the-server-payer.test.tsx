/**
 * Payer block by Entity.type (operator rule 2026-09-27, the audit ledger L-089/L-090/L-091).
 *
 * The slot-10 quotation used to build its "เรียน / เลขประจำตัวผู้เสียภาษี" block
 * from raw wizard state: `taxId || idCard`, so an individual applicant's own
 * national ID was printed under a tax-id label (L-089), a community enterprise's
 * registration number was never shown (L-090), and the signatory was one
 * hardcoded named person on every document (L-091).
 *
 * The screen now prints what the SERVER resolved (GET /applications/:id/quotations
 * `payer` + `signatory`, built by apps/backend/utils/applicant-resolver.js and the
 * same issuer config the PDF uses). Harness: the createRoot + act pattern of
 * invoice-step-accepts-the-real-quotation.test.tsx (RTL is not installed here).
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

// Synthetic, checksum-valid, never a real person. Wizard state carries it
// exactly as the real wizard does (step2-identity-config.ts `idCard`).
const NATIONAL_ID = '1100000000008';

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

// The wizard draft: an INDIVIDUAL filer whose state still carries the national
// ID and a stale company name. Neither may reach the document.
jest.mock('../../hooks/use-application-flow-store', () => ({
  useApplicationFlowStore: () => ({
    state: {
      applicationId: 'app-1',
      applicantData: {
        applicantType: 'INDIVIDUAL',
        firstName: 'ชื่อในวิซาร์ด',
        lastName: 'นามสกุลในวิซาร์ด',
        idCard: NATIONAL_ID,
        taxId: NATIONAL_ID,
        companyName: 'บริษัทค้างในวิซาร์ด',
        phone: '0899999999',
      },
    },
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
  quotationNumber: 'QT-PRD-2026-000001',
  subtotal: '33000.00',
  vat: '2310.00',
  totalAmount: '35310.00',
  status: 'PENDING',
  createdAt: '2026-08-25T00:00:00.000Z',
  installments: [
    { phase: 'PHASE_1', amount: 5885 },
    { phase: 'PHASE_2', amount: 29425 },
  ],
};

const SIGNATORY = {
  org: 'ในนาม บริษัท ผู้ออกเอกสารทดสอบ จำกัด',
  name: 'ผู้มีอำนาจลงนาม',
  title1: 'กรรมการผู้มีอำนาจ',
  title2: '',
};

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('slot 10 prints the payer block and signatory the server resolved', () => {
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

  it('INDIVIDUAL: the server name and "-", never the national ID from wizard state', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: QUOTATION,
      payer: {
        type: 'INDIVIDUAL',
        nameLabel: 'ชื่อ-นามสกุล',
        name: 'สมชาย จากเซิร์ฟเวอร์',
        idLabel: 'เลขประจำตัวประชาชน',
        idPrinted: '-',
        address: '12 หมู่ 3 เชียงใหม่',
        contactName: 'สมชาย จากเซิร์ฟเวอร์',
        phone: '0811110001',
      },
      signatory: SIGNATORY,
    });
    const text = await mountStep();

    expect(text).toContain('สมชาย จากเซิร์ฟเวอร์');
    expect(text).toContain('12 หมู่ 3 เชียงใหม่');
    expect(text).toContain('0811110001');
    expect(text).not.toContain(NATIONAL_ID);
    expect(text).not.toContain('0008');
    expect(text).not.toContain('ชื่อในวิซาร์ด');
    expect(text).not.toContain('บริษัทค้างในวิซาร์ด');
  });

  it('COMMUNITY_ENTERPRISE: the registration number under its own label', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: QUOTATION,
      payer: {
        type: 'COMMUNITY_ENTERPRISE',
        nameLabel: 'ชื่อวิสาหกิจชุมชน',
        name: 'วิสาหกิจชุมชนจากเซิร์ฟเวอร์',
        idLabel: 'เลขทะเบียนวิสาหกิจชุมชน',
        idPrinted: '58012345678',
        address: '55 หมู่ 1 เชียงราย',
        contactName: 'วิสาหกิจชุมชนจากเซิร์ฟเวอร์',
        phone: '0833330003',
      },
      signatory: SIGNATORY,
    });
    const text = await mountStep();

    expect(text).toContain('วิสาหกิจชุมชนจากเซิร์ฟเวอร์');
    expect(text).toContain('เลขทะเบียนวิสาหกิจชุมชน');
    expect(text).toContain('58012345678');
    expect(text).not.toContain(NATIONAL_ID);
  });

  it('the signatory is the one the server sent, not a hardcoded person', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: QUOTATION,
      payer: {
        type: 'JURISTIC',
        nameLabel: 'ชื่อบริษัท',
        name: 'บริษัท ลูกค้า จำกัด',
        idLabel: 'เลขประจำตัวผู้เสียภาษี',
        idPrinted: '0105561234560',
        address: '-',
        contactName: 'บริษัท ลูกค้า จำกัด',
        phone: '-',
      },
      signatory: SIGNATORY,
    });
    const text = await mountStep();

    expect(text).toContain('0105561234560');
    expect(text).toContain(SIGNATORY.org);
    expect(text).toContain(SIGNATORY.title1);
    expect(text).not.toContain('นายปรีชา');
    expect(text).not.toContain('ปฏิบัติราชการแทน');
  });

  it('no payer from the server: the block says so, it does not fall back to wizard state', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: QUOTATION });
    const text = await mountStep();

    expect(text).not.toContain(NATIONAL_ID);
    expect(text).not.toContain('ชื่อในวิซาร์ด');
  });
});
