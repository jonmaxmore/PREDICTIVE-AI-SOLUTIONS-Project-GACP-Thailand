/**
 * RED proof 6 (F-G4-64, spec §4; synthesis.md §2.4).
 *
 * Slot 10 asks the applicant to tick "ข้าพเจ้ารับทราบและยอมรับใบเสนอราคา…"
 * over a document the BROWSER invented: the number came from
 * generateDocumentNumber (G-01-DDMMYY-nnnn, not the QT-PRD- the register
 * holds), the amounts came from use-pricing with quantity pinned to 1 and no
 * platform or VAT line, and the tick was written to browser state only
 * (`dtamQuote`, which has no server-side reader anywhere).
 *
 * For one cultivation scope that screen showed 30,000 while the real price is
 * 35,310; for three it still showed 30,000 while the real price is 105,930.
 *
 * Harness: createRoot + act with microtask flushes, the pattern every sibling
 * suite on this surface uses (../../__tests__/submit-step-states.test.tsx uses
 * @testing-library/react, which is NOT installed in this workspace —
 * `require.resolve('@testing-library/react')` throws at HEAD — so the plan's
 * literal RTL body could not run at all; the assertions are unchanged).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type {
  QuotationAcceptResult,
  QuotationIssuerType,
  QuotationRecord,
  QuotationsBySide,
} from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Same reason as quotation-review-section.test.tsx: the first render of a
// document-heavy tree under a parallel jest run can take several seconds on
// the laptop, and the 5 s default turns that into a fake assertion failure.
jest.setTimeout(30_000);

const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide | null>>();
const mockAcceptQuotation =
  jest.fn<(applicationId: string, issuerType: QuotationIssuerType) => Promise<QuotationAcceptResult>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service') as {
    PaymentService: Record<string, unknown>;
  };
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getQuotations: (...args: unknown[]) => mockGetQuotations(...(args as [])),
      acceptQuotation: (...args: unknown[]) =>
        mockAcceptQuotation(...(args as [string, QuotationIssuerType])),
    },
  };
});

/**
 * The door the sibling success-step already asks for a filed/not-filed answer
 * (GET /applications/:id -> status, classified by submissionClaim). Slot 10 asks
 * it only when the register holds NO quotation, because that is the only state
 * whose copy depends on whether the application was ever filed.
 */
const mockApiGet =
  jest.fn<(path: string) => Promise<{ success: boolean; data?: { status?: string } }>>();
jest.mock('@/lib/api/api-client', () => ({
  apiClient: {
    get: (path: string) => mockApiGet(path),
    post: jest.fn(async () => ({ success: true, data: {} })),
  },
}));

const mockUpdateState = jest.fn();
// The wizard draft this screen reads. Mutable because a stale bookmark to
// /step/10 in a fresh session has NO applicationId, and that state has its own
// copy (review r2 minor 2).
let mockApplicationId: string | undefined = 'app-1';
jest.mock('../../hooks/use-application-flow-store', () => ({
  useApplicationFlowStore: () => ({
    state: {
      ...(mockApplicationId ? { applicationId: mockApplicationId } : {}),
      applicantData: { applicantType: 'INDIVIDUAL', firstName: 'ก', lastName: 'ข' },
    },
    updateState: (...args: unknown[]) => mockUpdateState(...args),
  }),
}));

// The document layout renders a real QR client-side; keep the network and the
// canvas out of this suite (same stub as payments-checkout-entry-*).
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
  lineItems: [
    {
      method: 'outdoor',
      label: 'กลางแจ้ง',
      phase1Amount: 5885,
      phase2Amount: 29425,
      netAmount: 33000,
      taxAmount: 2310,
    },
  ],
};

/**
 * What POST /applications/:id/quotations/:issuer/accept REALLY answers:
 * markQuotationAccepted's raw Prisma row (routes/api/applications/quotations.js
 * → services/quotation-service.js, a bare `db.quotation.update`). It carries no
 * `lineItems` and no `scopeMismatch` — the GET adds both
 * (routes/api/applications/quotations.js). A fixture that answered with the GET
 * shape hid the redraw this suite now pins.
 */
function acceptResponse(row: QuotationRecord): QuotationRecord {
  const answered: QuotationRecord = {
    ...row,
    status: 'ACCEPTED',
    acceptedAt: '2026-08-29T00:00:00.000Z',
  };
  delete answered.lineItems;
  delete answered.scopeMismatch;
  delete answered.applicationScopeCount;
  return answered;
}

const NEXT_LABEL = 'ไปหน้าชำระเงิน';
const REFRESH_LABEL = 'รีเฟรช';
const WAITING_TEXT = 'ระบบกำลังออกใบเสนอราคา';
const LOOKUP_FAILED_TEXT = 'ตรวจสอบใบเสนอราคาไม่สำเร็จ';
// 2026-09-06: the document lists ONE pre-VAT line per cultivation type (state +
// platform), with VAT as a single line at the foot — not a phase-split line each
// carrying its own VAT. These pin the per-type lines by their type label.
// fix/fee-line-descriptions (operator 2026-10-03): the line names the catalogue's
// services (both instalments, since a per-type line carries both), not the retired
// "ค่าบริการตรวจประเมินและรับรองมาตรฐาน GACP".
const BOTH_SERVICES = 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร และงวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง';
const SCOPE_LINE_OUTDOOR = `${BOTH_SERVICES} (กลางแจ้ง)`;
const SCOPE_LINE_INDOOR = `${BOTH_SERVICES} (ในร่ม)`;
const MISMATCH_TEXT = 'จำนวนรูปแบบการปลูกที่คำขอระบุไว้ในวันที่ออกใบ';
const ACK_TEXT = 'ยืนยันจำนวนเงินตามใบเสนอราคาข้างต้น';
const NOT_FILED_TEXT = 'คำขอนี้ยังไม่ได้ยื่น';
const CANNOT_ACCEPT_TEXT = 'ไม่สามารถกดยอมรับได้แล้ว';
const RETRY_TEXT = 'กรุณาลองใหม่อีกครั้ง';
// review r2 minor 4 — no staff surface can void and re-issue a quotation
// (apps/backend/routes/api/{admin,provider} holds no quotation route), so copy
// that promises a new document names a door nobody has.
const REISSUE_PROMISE = 'ออกใบเสนอราคาใหม่';
const STAFF_CONTACT_TEXT = 'กรุณาติดต่อเจ้าหน้าที่';
// review r2 minors 1-2 — the sentence above the next button, and the state
// where the wizard draft carries no applicationId at all.
const FILING_CLAIM_TEXT = 'คำขอจะถูกยื่นเมื่อกดปุ่มด้านล่าง';
const NO_APPLICATION_ID_TEXT = 'ไม่พบรหัสคำขอ';

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('slot 10 accepts the quotation the register actually holds (F-G4-64)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApplicationId = 'app-1';
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: QUOTATION });
    mockAcceptQuotation.mockResolvedValue({ ok: true, row: acceptResponse(QUOTATION) });
    // A FILED application by default: PENDING_DOC_FEE is inside
    // SELF_HEAL_STATUSES (services/quotation-issuance-on-submit.js), so the
    // register really is about to hold a document.
    mockApiGet.mockResolvedValue({ success: true, data: { status: 'PENDING_DOC_FEE' } });
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

  async function mountStep(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<StepInvoice />);
    });
    await flushAsync();
    return container;
  }

  function findButton(label: string): HTMLButtonElement | null {
    return (
      Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
        (btn.textContent || '').includes(label),
      ) ?? null
    );
  }

  function findCheckbox(): HTMLInputElement | null {
    return container!.querySelector<HTMLInputElement>('input[type="checkbox"]');
  }

  function findCheckboxes(): HTMLInputElement[] {
    return Array.from(container!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  }

  async function tickAccept(index = 0): Promise<void> {
    const box = findCheckboxes()[index];
    expect(box).toBeDefined();
    await act(async () => {
      box!.click();
    });
    await flushAsync();
  }

  it('shows the REAL quotation number, not one the browser made up', async () => {
    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain('QT-PRD-2026-000001');
    expect(text).not.toMatch(/G-01-/);
  });

  it('shows the REAL total, 35,310, not the 30,000 the fee constants produce', async () => {
    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain('35,310');
    expect(text).not.toContain('30,000');
  });

  it('ticking accept POSTs to the backend, and does not merely set browser state', async () => {
    await mountStep();
    await tickAccept();

    expect(mockAcceptQuotation).toHaveBeenCalledWith('app-1', 'PLATFORM');
  });

  it('the applicant cannot continue until the backend says ACCEPTED', async () => {
    mockAcceptQuotation.mockResolvedValue({ ok: false }); // no answer came back
    await mountStep();
    await tickAccept();

    const next = findButton(NEXT_LABEL);
    expect(next).not.toBeNull();
    expect(next!.disabled).toBe(true);
  });

  it('an ACCEPTED row from the backend is what opens the next step', async () => {
    await mountStep();
    await tickAccept();

    const next = findButton(NEXT_LABEL);
    expect(next).not.toBeNull();
    expect(next!.disabled).toBe(false);
  });

  it('no quotation yet shows a waiting state with a refresh action, not a made-up document', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    const el = await mountStep();

    expect(el.textContent || '').toContain(WAITING_TEXT);
    expect(findButton(REFRESH_LABEL)).not.toBeNull();
    expect(findCheckbox()).toBeNull();
  });

  it('the refresh action asks the API again, which is what the QUOTATION_NOT_ISSUED copy promises', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    await mountStep();
    expect(mockGetQuotations).toHaveBeenCalledTimes(1);

    const refresh = findButton(REFRESH_LABEL);
    expect(refresh).not.toBeNull();
    await act(async () => {
      refresh!.click();
    });
    await flushAsync();

    expect(mockGetQuotations).toHaveBeenCalledTimes(2);
  });

  // ── Fix round 1 (review r0) ──────────────────────────────────────────────

  it('the accepted document is the document that was accepted: the per-scope lines survive the tick', async () => {
    // review r0 major 2 — the accept POST answers with the register's ROW, which
    // has no lineItems. Assigning it over the rendered row redrew a three-scope
    // document as two generic instalment lines at the exact instant it was
    // accepted, on a Tier C money path.
    const threeScopes: QuotationRecord = {
      ...QUOTATION,
      lineItems: [
        ...QUOTATION.lineItems!,
        { method: 'indoor', label: 'ในร่ม', phase1Amount: 5885, phase2Amount: 29425, netAmount: 33000, taxAmount: 2310 },
      ],
    };
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: threeScopes });
    mockAcceptQuotation.mockResolvedValue({ ok: true, row: acceptResponse(threeScopes) });

    const el = await mountStep();
    expect(el.textContent).toContain(SCOPE_LINE_OUTDOOR);
    // What each service covers, once per service under the table (the server sent
    // no `copy.services` here, so the one web mirror answers).
    expect(el.textContent).toContain('ครอบคลุม: รับและตรวจความครบถ้วน');
    expect(el.textContent).toContain('ครอบคลุม: นัดหมายและตรวจประเมินแปลงปลูก ณ สถานที่จริง');

    await tickAccept();

    // The per-type lines survive the accept (the register ROW carries no lineItems;
    // assigning it over the rendered row must not collapse the document).
    expect(el.textContent).toContain(SCOPE_LINE_OUTDOOR);
    expect(el.textContent).toContain(SCOPE_LINE_INDOOR);
    // VAT is its own line at the foot, computed once on the subtotal.
    expect(el.textContent).toContain('ภาษีมูลค่าเพิ่ม 7%');
  });

  it('a scope-mismatch warning survives the tick, which is the moment it matters most', async () => {
    // Ruling 12 — the row was priced under a different scope count. The accept
    // response cannot know that (the GET computes it), so it must not erase it.
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...QUOTATION, scopeMismatch: true, applicationScopeCount: 3 },
    });

    const el = await mountStep();
    expect(el.textContent).toContain(MISMATCH_TEXT);

    await tickAccept();

    expect(el.textContent).toContain(MISMATCH_TEXT);
  });

  it('the acknowledgment names the document on the screen, not an invoice that is not', async () => {
    // review r0 minor 3 — the InvoiceDocument this label pointed at was deleted
    // in this same change, so the tick of record referred to nothing on screen.
    const el = await mountStep();

    expect(el.textContent).toContain(ACK_TEXT);
    expect(el.textContent).not.toContain('ใบแจ้งหนี้');
  });

  it('a pre-W14 pair needs BOTH rows accepted before the next step opens', async () => {
    // review r0 minor 4 — services/billing/quotation-gate.js requires every row
    // the application holds. Opening the door on one accepted row sent the
    // applicant to a QUOTATION_NOT_ACCEPTED refusal on both rails.
    const dtamRow: QuotationRecord = { ...QUOTATION, id: 'qt-0', issuerType: 'DTAM', quotationNumber: 'QT-DTAM-2026-000001' };
    mockGetQuotations.mockResolvedValue({ dtam: dtamRow, platform: QUOTATION });
    mockAcceptQuotation.mockImplementation(async (_appId, issuer) =>
      ({ ok: true, row: acceptResponse(issuer === 'DTAM' ? dtamRow : QUOTATION) }),
    );

    const el = await mountStep();

    expect(el.textContent).toContain('QT-DTAM-2026-000001');
    expect(el.textContent).toContain('QT-PRD-2026-000001');
    expect(findCheckboxes()).toHaveLength(2);

    await tickAccept(0);
    expect(findButton(NEXT_LABEL)!.disabled).toBe(true);

    await tickAccept(1);
    expect(findButton(NEXT_LABEL)!.disabled).toBe(false);
  });

  it('a failed lookup says the lookup failed, not that the system is issuing a document', async () => {
    // review r0 minor 6 — getQuotations answers null when the request itself
    // failed. "ระบบกำลังออกใบเสนอราคา" is a fact about the server the browser
    // cannot know from a 500 or a dropped connection.
    mockGetQuotations.mockResolvedValue(null);

    const el = await mountStep();

    expect(el.textContent).toContain(LOOKUP_FAILED_TEXT);
    expect(el.textContent).not.toContain(WAITING_TEXT);
    expect(findButton(REFRESH_LABEL)).not.toBeNull();
    expect(findCheckbox()).toBeNull();
  });

  // -- Fix round 2 (review r1) ---------------------------------------------

  it('a DRAFT application is told it has not been filed, not that a document is on the way', async () => {
    // review r1 minor 2 - slot 10 opens as soon as the flow steps are complete
    // (hooks/wizard-step-access.ts evaluateStepAccess, the isPaymentStep
    // branch), which is BEFORE the application is filed: the file door is
    // /health/applications/preview and /step/11 redirects stale bookmarks here.
    // ensureQuotationForIssuedApplication will never mint a row for a DRAFT
    // (SELF_HEAL_STATUSES is built from PAYABLE_STATES), so
    // "the system is issuing your quotation" named an act the platform is not
    // performing, and refresh could not change the answer once, ever.
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    mockApiGet.mockResolvedValue({ success: true, data: { status: 'DRAFT' } });

    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain(NOT_FILED_TEXT);
    expect(text).not.toContain(WAITING_TEXT);
    // And the way out is the door that files it.
    const submitLink = Array.from(el.querySelectorAll('a')).find((a) =>
      (a.getAttribute('href') || '').includes('/health/applications/preview'),
    );
    expect(submitLink).toBeDefined();
    expect(findCheckbox()).toBeNull();
  });

  it('a filed application with no row keeps the issuing copy and the refresh button', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    mockApiGet.mockResolvedValue({ success: true, data: { status: 'SUBMITTED' } });

    const el = await mountStep();

    expect(el.textContent || '').toContain(WAITING_TEXT);
    expect(el.textContent || '').not.toContain(NOT_FILED_TEXT);
    expect(findButton(REFRESH_LABEL)).not.toBeNull();
  });

  it('a status the door cannot answer keeps the issuing copy, never a not-filed claim', async () => {
    // Only a status positively read may take the issuing copy away: a failed or
    // empty answer is not knowledge that nothing was filed.
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    mockApiGet.mockResolvedValue({ success: false });

    const el = await mountStep();

    expect(el.textContent || '').toContain(WAITING_TEXT);
    expect(el.textContent || '').not.toContain(NOT_FILED_TEXT);
  });

  it.each(['EXPIRED', 'REJECTED'] as const)(
    'a %s row offers no tick, and names the party to contact instead of a retry that cannot work',
    async (status) => {
      // review r1 minor 3 - markQuotationAccepted allows DRAFT/PENDING/SENT only
      // (services/quotation-service.js), so the POST 409s, acceptQuotation
      // answers null and the screen said "please try again": a retry that can
      // never succeed. Same defect r0 minor 5 removed from the payments entry.
      mockGetQuotations.mockResolvedValue({ dtam: null, platform: { ...QUOTATION, status } });

      const el = await mountStep();

      expect(findCheckbox()).toBeNull();
      expect(el.textContent || '').toContain(CANNOT_ACCEPT_TEXT);
      expect(el.textContent || '').not.toContain(RETRY_TEXT);
      expect(mockAcceptQuotation).not.toHaveBeenCalled();
      expect(findButton(NEXT_LABEL)!.disabled).toBe(true);
    },
  );

  it('a pair with one EXPIRED row still offers the tick on the row that can take it', async () => {
    const dtamRow: QuotationRecord = {
      ...QUOTATION,
      id: 'qt-0',
      issuerType: 'DTAM',
      quotationNumber: 'QT-DTAM-2026-000001',
      status: 'EXPIRED',
    };
    mockGetQuotations.mockResolvedValue({ dtam: dtamRow, platform: QUOTATION });

    const el = await mountStep();

    expect(findCheckboxes()).toHaveLength(1);
    expect(el.textContent || '').toContain(CANNOT_ACCEPT_TEXT);

    await tickAccept(0);
    expect(mockAcceptQuotation).toHaveBeenCalledWith('app-1', 'PLATFORM');
  });

  // -- Residual round (reviews r2 minors 1, 2, 4) --------------------------

  it('the sentence above the button no longer claims that button files the application', async () => {
    // review r2 minor 1 - the next button is enabled only when canProceed is
    // true, which needs an accepted quotation, which only exists for an
    // application already past DRAFT. It opens the payment list; it cannot be
    // the act of filing, and a DRAFT screen showed that sentence four lines
    // under 'this application has not been filed'.
    const el = await mountStep();

    expect(el.textContent || '').not.toContain(FILING_CLAIM_TEXT);
    expect(el.textContent || '').toContain('หน้ารายการชำระเงิน');
  });

  it('with no document on screen there is no sentence about the button at all', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    mockApiGet.mockResolvedValue({ success: true, data: { status: 'DRAFT' } });

    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain(NOT_FILED_TEXT);
    expect(text).not.toContain(FILING_CLAIM_TEXT);
    expect(text).not.toContain('หน้ารายการชำระเงิน');
  });

  it('a stale bookmark with no applicationId says so, and offers the step that has one', async () => {
    // review r2 minor 2 - loadQuotation returns early without an applicationId,
    // so the screen fell through to 'the system is issuing your quotation' with
    // a refresh button whose handler hits the same early return: pressed
    // forever, no request made, nothing on screen changing.
    mockApplicationId = undefined;

    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain(NO_APPLICATION_ID_TEXT);
    expect(text).not.toContain(WAITING_TEXT);
    expect(findButton(REFRESH_LABEL)).toBeNull();
    expect(mockGetQuotations).not.toHaveBeenCalled();
    const back = Array.from(el.querySelectorAll('a')).find((a) =>
      (a.getAttribute('href') || '').includes('/health/applications/new/step/9'),
    );
    expect(back).toBeDefined();
  });

  it('the mismatch notice names the document to quote and promises no new one', async () => {
    // review r2 minor 4 - there is no staff re-issue door, so 'contact staff to
    // have a new quotation issued' sends the applicant to a function nobody has.
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...QUOTATION, scopeMismatch: true, applicationScopeCount: 3 },
    });

    const el = await mountStep();
    const text = el.textContent || '';

    expect(text).toContain(MISMATCH_TEXT);
    expect(text).toContain(STAFF_CONTACT_TEXT);
    expect(text).toContain('QT-PRD-2026-000001');
    expect(text).not.toContain(REISSUE_PROMISE);
  });

  it.each(['EXPIRED', 'REJECTED'] as const)(
    'a %s row tells the applicant what to quote, not that a replacement will be issued',
    async (status) => {
      mockGetQuotations.mockResolvedValue({ dtam: null, platform: { ...QUOTATION, status } });

      const el = await mountStep();
      const text = el.textContent || '';

      expect(text).toContain(CANNOT_ACCEPT_TEXT);
      expect(text).toContain(STAFF_CONTACT_TEXT);
      expect(text).toContain('QT-PRD-2026-000001');
      expect(text).not.toContain(REISSUE_PROMISE);
    },
  );

  it('the tick writes nothing to the wizard draft: dtamQuote had no server-side reader', async () => {
    await mountStep();
    await tickAccept();

    const wroteQuote = mockUpdateState.mock.calls.some((call) =>
      JSON.stringify(call).includes('dtamQuote'),
    );
    expect(wroteQuote).toBe(false);
  });
});

/**
 * Final fix round (2026-08-29) — rulings R19, R20, R21, R22.
 *
 * R19 (C12) the accept failure is announced; R20 (S14) it says WHICH refusal;
 * R21 (C1 FE / S16) the document prints the date the offer stands until and a
 * lapsed row is not drawn with a tick; R22 (S19) the disabled next button has a
 * stated cause for the ordinary one-document applicant, not only for a pair.
 */
describe('slot 10 under the final-round rulings (F-G4-64)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const FUTURE = '2099-01-01T00:00:00.000Z';
  const PAST = '2020-01-01T00:00:00.000Z';
  const GUIDANCE_TEXT = 'ยอมรับใบเสนอราคา';

  beforeEach(() => {
    jest.clearAllMocks();
    mockApplicationId = 'app-1';
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...QUOTATION, validUntil: FUTURE },
    });
    mockAcceptQuotation.mockResolvedValue({ ok: true, row: acceptResponse(QUOTATION) });
    mockApiGet.mockResolvedValue({ success: true, data: { status: 'PENDING_DOC_FEE' } });
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

  async function mountStep(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container!);
      root.render(<StepInvoice />);
    });
    await flushAsync();
    return container;
  }

  function findButton(label: string): HTMLButtonElement | null {
    return (
      Array.from(container!.querySelectorAll<HTMLButtonElement>('button')).find((btn) =>
        (btn.textContent || '').includes(label),
      ) ?? null
    );
  }

  async function tick(index = 0): Promise<void> {
    const box = Array.from(container!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))[index];
    expect(box).toBeDefined();
    await act(async () => {
      box!.click();
    });
    await flushAsync();
  }

  it('the document prints the date the offer stands until (R21)', async () => {
    const el = await mountStep();

    expect(el.textContent || '').toContain('ใช้ได้ถึง');
  });

  it('a lapsed row offers no tick and names the replacement the system issues (R21)', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: { ...QUOTATION, status: 'PENDING', validUntil: PAST },
    });

    const el = await mountStep();

    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    expect(el.textContent || '').toContain('เกินกำหนดยืนราคาแล้ว');
    expect(el.textContent || '').toContain('หน้ารายการชำระเงิน');
    expect(mockAcceptQuotation).not.toHaveBeenCalled();
    expect(findButton(NEXT_LABEL)!.disabled).toBe(true);

    /*
      Fix round 1 — reviewer MINOR. The disabled button still needs a stated
      cause (R22), but this screen deliberately draws NO checkbox for a lapsed
      row, so "กรุณาติ๊กยอมรับใบเสนอราคาด้านบนก่อน" named a control that is not
      on the page. The cause here is the expiry, and the next action is the page
      that issues the replacement.
    */
    const guidance = el.querySelector('[data-testid="invoice-step-accept-guidance"]');
    expect(guidance).not.toBeNull();
    expect(guidance!.textContent).not.toContain('ติ๊ก');
    expect(guidance!.textContent).toContain('เกินกำหนดยืนราคา');
    expect(guidance!.textContent).toContain('หน้ารายการชำระเงิน');
  });

  it('a lapsed PAIR is told the truth: no replacement is issued for two rows (fix round 1)', async () => {
    // _lapsedOfferToReplace (apps/backend/services/quotation-issuance-on-submit.js)
    // returns null the moment an application holds two live rows, so promising
    // a new document here would send the applicant refreshing for ever.
    mockGetQuotations.mockResolvedValue({
      dtam: {
        ...QUOTATION,
        id: 'qt-0',
        issuerType: 'DTAM',
        quotationNumber: 'QT-DTAM-2026-000001',
        status: 'PENDING',
        validUntil: PAST,
      },
      platform: { ...QUOTATION, status: 'PENDING', validUntil: PAST },
    });

    const el = await mountStep();

    const text = el.textContent || '';
    expect(text).toContain('เกินกำหนดยืนราคาแล้ว');
    expect(text).not.toContain('ระบบจะออกใบใหม่');
    expect(text).toContain('กรุณาติดต่อเจ้าหน้าที่');
    expect(text).toContain('QT-DTAM-2026-000001');
  });

  it('the accept failure is announced, not just printed (R19)', async () => {
    mockAcceptQuotation.mockResolvedValue({ ok: false });

    await mountStep();
    await tick();

    const alert = container!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('ลองใหม่อีกครั้ง');
  });

  it('SNAPSHOT_REQUIRED names the document and does not ask for a retry (R20)', async () => {
    mockAcceptQuotation.mockResolvedValue({ ok: false, code: 'SNAPSHOT_REQUIRED' });

    await mountStep();
    await tick();

    const alert = container!.querySelector('[role="alert"]');
    expect(alert!.textContent).toContain('QT-PRD-2026-000001');
    expect(alert!.textContent).toContain('เจ้าหน้าที่');
    expect(alert!.textContent).not.toContain('ลองใหม่อีกครั้ง');
  });

  it('INVALID_QUOTATION_STATUS re-reads the register instead of asking for a retry (R20)', async () => {
    mockAcceptQuotation.mockResolvedValue({ ok: false, code: 'INVALID_QUOTATION_STATUS' });

    await mountStep();
    expect(mockGetQuotations).toHaveBeenCalledTimes(1);

    await tick();

    expect(mockGetQuotations).toHaveBeenCalledTimes(2);
    const alert = container!.querySelector('[role="alert"]');
    expect(alert!.textContent).not.toContain('ลองใหม่อีกครั้ง');
  });

  it('a single unaccepted document states why the next button is disabled (R22)', async () => {
    const el = await mountStep();

    const next = findButton(NEXT_LABEL);
    expect(next!.disabled).toBe(true);
    const guidance = el.querySelector('[data-testid="invoice-step-accept-guidance"]');
    expect(guidance).not.toBeNull();
    expect(guidance!.textContent).toContain(GUIDANCE_TEXT);
  });

  it('once every document is accepted the guidance goes away with the block (R22)', async () => {
    const el = await mountStep();
    await tick();

    expect(findButton(NEXT_LABEL)!.disabled).toBe(false);
    expect(el.querySelector('[data-testid="invoice-step-accept-guidance"]')).toBeNull();
  });

  it('a pair still gets the multi-document wording (R22)', async () => {
    const dtamRow: QuotationRecord = {
      ...QUOTATION,
      id: 'qt-0',
      issuerType: 'DTAM',
      quotationNumber: 'QT-DTAM-2026-000001',
      validUntil: FUTURE,
    };
    mockGetQuotations.mockResolvedValue({
      dtam: dtamRow,
      platform: { ...QUOTATION, validUntil: FUTURE },
    });

    const el = await mountStep();

    const guidance = el.querySelector('[data-testid="invoice-step-accept-guidance"]');
    expect(guidance).not.toBeNull();
    expect(guidance!.textContent).toContain('2 ฉบับ');
  });

  it('with no document on screen there is no guidance either (R22)', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });
    mockApiGet.mockResolvedValue({ success: true, data: { status: 'DRAFT' } });

    const el = await mountStep();

    expect(el.querySelector('[data-testid="invoice-step-accept-guidance"]')).toBeNull();
  });
});
