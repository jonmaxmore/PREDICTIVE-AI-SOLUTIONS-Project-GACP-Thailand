/**
 * quotation-review-section.test.tsx — PR2 farmer-facing review/accept UI.
 *
 * Covers the contract this component owes the workflow:
 *   1. Renders both the DTAM + PLATFORM quotation cards with per-cultivation-
 *      type line items split across งวดที่ 1 / งวดที่ 2 (the rows the official
 *      DTAM PDF prints), plus a "ยอมรับใบเสนอราคา" action while PENDING.
 *   2. Clicking accept calls PaymentService.acceptQuotation(appId, side) and,
 *      on success, bubbles onAccepted (this is what unlocks the Phase-1 invoice).
 *   3. An already-ACCEPTED quotation shows the accepted state, not an accept
 *      button (no re-accept).
 *   4. Self-hides (renders nothing) when no quotation has been issued yet.
 *
 * Strategy mirrors payments-states.test.tsx: createRoot + act with multiple
 * microtask flushes; PaymentService stubbed via jest.mock.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  PHASE_LABEL_TH,
  type QuotationAcceptResult,
  type QuotationRecord,
  type QuotationsBySide,
} from '@/lib/services/payment-service';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// First render of the section under a parallel jest run took 3.5-8.8 s on the laptop (fix round 1,
// 2026-08-27): the 5 s default made an unrelated timeout look like a failing assertion.
jest.setTimeout(30_000);

const mockGetQuotations = jest.fn<() => Promise<QuotationsBySide>>();
const mockAcceptQuotation = jest.fn<() => Promise<QuotationAcceptResult>>();
const mockViewQuotationPdf = jest.fn<() => Promise<boolean>>();

jest.mock('@/lib/services/payment-service', () => {
  const actual = jest.requireActual('@/lib/services/payment-service');
  return {
    ...actual,
    PaymentService: {
      ...actual.PaymentService,
      getQuotations: (...args: unknown[]) => mockGetQuotations(...(args as [])),
      acceptQuotation: (...args: unknown[]) => mockAcceptQuotation(...(args as [])),
      viewQuotationPdf: (...args: unknown[]) => mockViewQuotationPdf(...(args as [])),
    },
  };
});

import QuotationReviewSection from '../QuotationReviewSection';

// The three sentences whose presence is the contract: the panel's name, the
// instruction that asks for an action, and the line that admits it is waiting.
const HEADER_TEXT = 'ใบเสนอราคา (Quotation)';
const INSTRUCTION_TEXT = 'กรุณาตรวจสอบรายละเอียดค่าบริการ แล้วยอมรับใบเสนอราคาก่อนชำระเงินงวดที่ 1';
const INSTRUCTION_OPENING = 'กรุณาตรวจสอบรายละเอียดค่าบริการ';
const LOADING_TEXT = 'กำลังโหลดใบเสนอราคา';

const LINE_ITEMS = [
  { method: 'INDOOR', label: 'ค่าตรวจประเมิน — ในร่ม (Indoor)', phase1Amount: 5000, phase2Amount: 25000, netAmount: 30000, taxAmount: 0 },
  { method: 'GREENHOUSE', label: 'ค่าตรวจประเมิน — โรงเรือน (Greenhouse)', phase1Amount: 5000, phase2Amount: 25000, netAmount: 30000, taxAmount: 0 },
  { method: 'OUTDOOR', label: 'ค่าตรวจประเมิน — กลางแจ้ง (Outdoor)', phase1Amount: 5000, phase2Amount: 25000, netAmount: 30000, taxAmount: 0 },
];

function makeQuotation(overrides: Partial<QuotationRecord>): QuotationRecord {
  return {
    id: 'q-1',
    applicationId: 'app-1',
    issuerType: 'DTAM',
    quotationNumber: 'QT-DTAM-2569-000001',
    subtotal: 90000,
    vat: 0,
    totalAmount: 90000,
    installments: [{ phase: 'PHASE_1', amount: 15000 }, { phase: 'PHASE_2', amount: 75000 }],
    status: 'PENDING',
    createdAt: '2026-06-05T00:00:00.000Z',
    lineItems: LINE_ITEMS,
    ...overrides,
  };
}

async function flushAsync(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('QuotationReviewSection (PR2)', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockViewQuotationPdf.mockResolvedValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('renders DTAM + PLATFORM cards with per-phase line items and an accept button', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: makeQuotation({ issuerType: 'DTAM', quotationNumber: 'QT-DTAM-2569-000001' }),
      platform: makeQuotation({
        id: 'q-2',
        issuerType: 'PLATFORM',
        quotationNumber: 'QT-PRD-2026-000001',
        totalAmount: 9630,
      }),
    });

    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });
    await flushAsync();

    const html = container?.innerHTML || '';
    expect(html).toContain('ใบเสนอราคา (Quotation)');
    expect(html).toContain('QT-DTAM-2569-000001');
    expect(html).toContain('QT-PRD-2026-000001');
    expect(html).toContain('งวดที่ 1');
    expect(html).toContain('งวดที่ 2');
    expect(html).toContain('Indoor');
    expect(html).toContain('ยอมรับใบเสนอราคา');
  });

  it('calls acceptQuotation and bubbles onAccepted when the accept button is clicked', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: makeQuotation({ issuerType: 'DTAM' }),
      platform: null,
    });
    mockAcceptQuotation.mockResolvedValue({ ok: true, row: makeQuotation({ status: 'ACCEPTED' }) });
    const onAccepted = jest.fn();

    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" onAccepted={onAccepted} />);
    });
    await flushAsync();

    const acceptBtn = Array.from(container?.querySelectorAll('button') || []).find(
      (b) => b.textContent?.includes('ยอมรับใบเสนอราคา'),
    );
    expect(acceptBtn).toBeTruthy();

    await act(async () => {
      acceptBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(mockAcceptQuotation).toHaveBeenCalledWith('app-1', 'DTAM');
    expect(onAccepted).toHaveBeenCalled();
  });

  it('shows the accepted state (no accept button) for an already-ACCEPTED quotation', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: makeQuotation({ status: 'ACCEPTED' }),
      platform: null,
    });

    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });
    await flushAsync();

    const html = container?.innerHTML || '';
    expect(html).toContain('ยอมรับแล้ว');
    const hasAcceptBtn = Array.from(container?.querySelectorAll('button') || []).some(
      (b) => b.textContent?.trim() === 'ยอมรับใบเสนอราคา',
    );
    expect(hasAcceptBtn).toBe(false);
  });

  it('renders nothing when no quotation has been issued (both sides null)', async () => {
    mockGetQuotations.mockResolvedValue({ dtam: null, platform: null });

    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });
    await flushAsync();

    expect((container?.innerHTML || '').trim()).toBe('');
  });

  /**
   * F-G4-55 (FE part): while the fetch is still in flight the section used to
   * render its full header — 'ใบเสนอราคา (Quotation)' plus the instruction to
   * accept a quotation before paying phase 1 — above two grey pulse boxes. On a
   * CERTIFIED application there is no quotation to accept, and the screenshot
   * caught exactly that instruction standing over an empty panel
   * (evidence/g4-rebuild-2026-08-25/c02-b/C02-01-payments-after-repair.png).
   * A loading state may not assert anything: it may only say it is loading.
   */
  it('while loading it instructs nothing: it says, visibly, that it is loading', async () => {
    // A promise that never settles during this assertion window.
    let resolveQuotations: ((value: QuotationsBySide) => void) | undefined;
    mockGetQuotations.mockReturnValue(
      new Promise<QuotationsBySide>((resolve) => {
        resolveQuotations = resolve;
      }),
    );

    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });

    const html = container?.innerHTML || '';
    expect(html).not.toContain('ใบเสนอราคา (Quotation)');
    expect(html).not.toContain('ยอมรับใบเสนอราคา');

    const section = container?.querySelector('[data-testid="quotation-review-section"]');
    expect(section).toBeTruthy();
    expect(section?.getAttribute('aria-busy')).toBe('true');
    // Two grey boxes explain nothing: the wait must be named on screen, not
    // only to a screen reader, so the node carrying the words is not sr-only.
    expect(section?.textContent).toContain(LOADING_TEXT);
    const loadingNode = Array.from(section?.querySelectorAll('*') || []).find(
      (node) => (node.textContent || '').trim() === LOADING_TEXT,
    );
    // A node whose whole text is the loading line.
    expect(loadingNode).toBeTruthy();
    expect(loadingNode?.className).not.toContain('sr-only');
    expect(loadingNode?.className).toContain('text-muted-foreground');

    // Settle it so the component unmounts clean.
    await act(async () => {
      resolveQuotations?.({ dtam: null, platform: null });
    });
    await flushAsync();
  });

  it('after the load resolves with a PENDING quotation the header and the instruction take over from the placeholder', async () => {
    let resolveQuotations: ((value: QuotationsBySide) => void) | undefined;
    mockGetQuotations.mockReturnValue(
      new Promise<QuotationsBySide>((resolve) => {
        resolveQuotations = resolve;
      }),
    );

    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });
    expect(container?.querySelector('[data-testid="quotation-review-section"]')).toBeTruthy();
    // "take over from the placeholder" only means something if the placeholder
    // did not already say it: before the fetch settles, the instruction to
    // accept a quotation is an assertion the section cannot yet make.
    expect(container?.textContent ?? '').not.toContain(INSTRUCTION_TEXT);

    await act(async () => {
      resolveQuotations?.({
        dtam: null,
        platform: makeQuotation({ issuerType: 'PLATFORM', status: 'PENDING' }),
      });
    });
    await flushAsync();

    const heading = container?.querySelector('h2');
    expect(heading?.textContent).toContain(HEADER_TEXT);
    expect(container?.textContent).toContain(INSTRUCTION_TEXT);
    expect(container?.querySelector('[aria-busy]')).toBeNull();
    expect(container?.textContent).not.toContain(LOADING_TEXT);
  });

  it('an ACCEPTED quotation keeps the header but drops the instruction: there is nothing left to accept', async () => {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: makeQuotation({ issuerType: 'PLATFORM', status: 'ACCEPTED' }),
    });

    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });
    await flushAsync();

    const heading = container?.querySelector('h2');
    expect(heading?.textContent).toContain(HEADER_TEXT);
    expect(container?.textContent).not.toContain(INSTRUCTION_TEXT);
    expect(container?.textContent).not.toContain(INSTRUCTION_OPENING);
  });
});

/**
 * Final fix round (2026-08-29) — rulings R19, R20, R21.
 *
 * R19 (C12): the tick that IS the acceptance can fail, and the sentence saying
 * so was written into a plain <p>. Focus stays on the (now unchecked) control,
 * so a screen-reader user got no feedback at all. The same branch's checkout
 * error block already uses role="alert".
 *
 * R20 (S14): every accept failure became "กรุณาลองใหม่อีกครั้ง", including the
 * two that can never succeed on retry. The service now returns the code and
 * this card says which refusal it was, with the number staff would need.
 *
 * R21 (C1 FE / S16): the acceptance door binds validUntil (final round R1), so
 * a lapsed row may not be drawn with an accept button, and the date the offer
 * stands until has to be on the card that asks for the acceptance.
 */
describe('QuotationReviewSection under the final-round rulings', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const FUTURE = '2099-01-01T00:00:00.000Z';
  const PAST = '2020-01-01T00:00:00.000Z';

  beforeEach(() => {
    jest.clearAllMocks();
    mockViewQuotationPdf.mockResolvedValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  async function mountWith(row: Partial<QuotationRecord>): Promise<void> {
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: makeQuotation({ issuerType: 'PLATFORM', quotationNumber: 'QT-PRD-2026-000001', ...row }),
    });
    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });
    await flushAsync();
  }

  function acceptButton(): HTMLButtonElement | undefined {
    return Array.from(container?.querySelectorAll('button') || []).find(
      (b) => (b.textContent || '').includes('ยอมรับใบเสนอราคา'),
    );
  }

  async function pressAccept(): Promise<void> {
    await act(async () => {
      acceptButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
  }

  it('prints the date the offer stands until, on the card that asks for the acceptance (R21)', async () => {
    await mountWith({ status: 'PENDING', validUntil: FUTURE });

    const text = container?.textContent || '';
    expect(text).toContain('ใช้ได้ถึง');
    // formatThaiDate renders the Buddhist year — the same helper the staff
    // billing view uses.
    expect(text).toMatch(/ใช้ได้ถึง[^\d]*\d/);
  });

  it('a lapsed PENDING row draws no accept button and says what the system will do (R21)', async () => {
    await mountWith({ status: 'PENDING', validUntil: PAST });

    expect(acceptButton()).toBeUndefined();
    const text = container?.textContent || '';
    expect(text).toContain('เกินกำหนดยืนราคาแล้ว');
    // ledger F-G4-71: no staff quotation-issuance door exists, so the copy may
    // not send anyone to one.
    expect(text).not.toContain('ติดต่อเจ้าหน้าที่');
  });

  it('a lapsed pre-W14 PAIR is told the truth: the replacement is not automatic (fix round 1)', async () => {
    // The backend replaces a lapsed offer only when the application holds ONE
    // live row (_lapsedOfferToReplace, quotation-issuance-on-submit.js), so on
    // a pair this card may not promise a new document. The only door that
    // exists takes the numbers.
    mockGetQuotations.mockResolvedValue({
      dtam: makeQuotation({
        issuerType: 'DTAM',
        quotationNumber: 'QT-DTAM-2026-000001',
        status: 'PENDING',
        validUntil: PAST,
      }),
      platform: makeQuotation({
        issuerType: 'PLATFORM',
        quotationNumber: 'QT-PRD-2026-000001',
        status: 'PENDING',
        validUntil: PAST,
      }),
    });
    await act(async () => {
      root?.render(<QuotationReviewSection applicationId="app-1" />);
    });
    await flushAsync();

    const text = container?.textContent || '';
    expect(acceptButton()).toBeUndefined();
    expect(text).toContain('เกินกำหนดยืนราคาแล้ว');
    expect(text).not.toContain('ระบบจะออกใบใหม่');
    expect(text).toContain('ติดต่อเจ้าหน้าที่');
    expect(text).toContain('QT-DTAM-2026-000001');
  });

  /**
   * Review r1, minor 2 — PIN, not a fix: the two headings were already
   * byte-identical to the constant, so this case is green on the code it was
   * written against. It exists because they were LITERALS: R16 made
   * PHASE_LABEL_TH the one place the instalments are named (the checkout
   * summary, the created screen and the wizard document all read it), and this
   * card sits one scroll below the checkout entry button on the same page. A
   * rename in the constant would have left two names for one instalment on one
   * screen.
   */
  it('names both instalments from the one constant every other surface reads', async () => {
    await mountWith({ status: 'PENDING', validUntil: FUTURE });

    const text = container?.textContent || '';
    expect(text).toContain(PHASE_LABEL_TH.PHASE_1);
    expect(text).toContain(PHASE_LABEL_TH.PHASE_2);
  });

  it('the accept-failure sentence is a live region (R19)', async () => {
    await mountWith({ status: 'PENDING', validUntil: FUTURE });
    mockAcceptQuotation.mockResolvedValue({ ok: false });

    await pressAccept();

    const alert = container?.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('ลองใหม่อีกครั้ง');
  });

  it('SNAPSHOT_REQUIRED is not answered with a retry, and names the document (R20)', async () => {
    await mountWith({ status: 'PENDING', validUntil: FUTURE });
    mockAcceptQuotation.mockResolvedValue({ ok: false, code: 'SNAPSHOT_REQUIRED' });

    await pressAccept();

    const alert = container?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('QT-PRD-2026-000001');
    expect(alert?.textContent).toContain('เจ้าหน้าที่');
    expect(alert?.textContent).not.toContain('ลองใหม่อีกครั้ง');
  });

  it('INVALID_QUOTATION_STATUS re-reads the row instead of asking for a retry (R20)', async () => {
    await mountWith({ status: 'PENDING', validUntil: FUTURE });
    expect(mockGetQuotations).toHaveBeenCalledTimes(1);
    mockAcceptQuotation.mockResolvedValue({ ok: false, code: 'INVALID_QUOTATION_STATUS' });
    // What the register now holds: someone else moved the row on.
    mockGetQuotations.mockResolvedValue({
      dtam: null,
      platform: makeQuotation({
        issuerType: 'PLATFORM',
        quotationNumber: 'QT-PRD-2026-000001',
        status: 'ACCEPTED',
      }),
    });

    await pressAccept();

    expect(mockGetQuotations).toHaveBeenCalledTimes(2);
    const alert = container?.querySelector('[role="alert"]');
    expect(alert?.textContent).not.toContain('ลองใหม่อีกครั้ง');
    expect(container?.textContent).toContain('ยอมรับแล้ว');
  });
});
