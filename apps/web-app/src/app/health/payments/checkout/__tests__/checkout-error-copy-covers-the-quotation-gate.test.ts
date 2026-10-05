/**
 * The checkout screen answers every refusal the payment rail can now raise
 * (F-G4-64, fix round 2).
 *
 * The backend gate turned the card rail fail-closed: seven codes can come back
 * from POST /api/payments/checkout that could not before. `resolveCheckoutFailure`
 * falls through to "ไม่สามารถสร้างรายการชำระเงินได้ กรุณาลองใหม่ภายหลัง …" for any
 * code the map does not hold, so an applicant who only has to press ยอมรับ on
 * their quotation, or accept the payment terms, was being told to try again
 * later, which can never work.
 *
 * The route answers `error: <CODE>` with `safeErrorMessage` replacing the Thai
 * sentence (apps/backend/shared/api-response.js), so this per-component map is
 * the only place that code becomes Thai. thai-ui-copy: the envelope keeps the
 * English identifier; the map is where it becomes a sentence.
 */
import { describe, expect, it } from '@jest/globals';

import { CHECKOUT_ERROR_MAP } from '../client-view';
import {
  QUOTATION_EXPIRED_COPY_TH,
  QUOTATION_NOT_ISSUED_COPY_TH,
} from '@/lib/services/payment-service';

/** Every refusal createCheckoutForApplication can raise for a quotation or terms reason. */
const RAIL_CODES = [
  'QUOTATION_NOT_ISSUED',
  'QUOTATION_NOT_ACCEPTED',
  'QUOTATION_EXPIRED',
  'QUOTATION_GATE_UNAVAILABLE',
  'CHECKOUT_PHASE_NOT_PRICED',
  'CHECKOUT_PRICE_DRIFT',
  'PAYMENT_TERMS_NOT_ACCEPTED',
] as const;

describe('CHECKOUT_ERROR_MAP covers every refusal of the gated card rail', () => {
  it.each(RAIL_CODES)('%s has Thai copy of its own', (code) => {
    const copy = CHECKOUT_ERROR_MAP[code];
    expect(typeof copy).toBe('string');
    expect(copy).toMatch(/[฀-๿]/);
    // thai-ui-copy: no em dash in Thai copy.
    expect(copy).not.toContain('—');
    // Long enough to name a cause and an action, short enough to render.
    expect(copy.length).toBeGreaterThan(20);
    expect(copy.length).toBeLessThanOrEqual(200);
  });

  it('no two refusals share the same sentence', () => {
    const shown = RAIL_CODES.map((c) => CHECKOUT_ERROR_MAP[c]);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('an unaccepted quotation names the button the applicant has to press', () => {
    expect(CHECKOUT_ERROR_MAP.QUOTATION_NOT_ACCEPTED).toContain('ยอมรับใบเสนอราคา');
    expect(CHECKOUT_ERROR_MAP.QUOTATION_NOT_ACCEPTED).not.toContain('ลองใหม่ภายหลัง');
  });

  it('the terms refusal points at the terms, not at a retry', () => {
    expect(CHECKOUT_ERROR_MAP.PAYMENT_TERMS_NOT_ACCEPTED).toContain('เงื่อนไขการชำระเงิน');
    expect(CHECKOUT_ERROR_MAP.PAYMENT_TERMS_NOT_ACCEPTED).not.toContain('ลองใหม่ภายหลัง');
  });

  it('the codes the applicant cannot act on name staff, and do not ask for a retry', () => {
    for (const code of ['QUOTATION_NOT_ISSUED', 'CHECKOUT_PRICE_DRIFT', 'CHECKOUT_PHASE_NOT_PRICED']) {
      expect(CHECKOUT_ERROR_MAP[code]).toContain('เจ้าหน้าที่');
      expect(CHECKOUT_ERROR_MAP[code]).not.toContain('ลองใหม่ภายหลัง');
    }
  });

  // Fix round 3 (reviewer r2, major 1). "เจ้าหน้าที่ได้รับแจ้งแล้ว" is a promise,
  // and exactly one refusal on this rail keeps it: CHECKOUT_PRICE_DRIFT fans an
  // URGENT admin notification out (notifyAdminCheckoutPriceDrift, awaited by
  // services/checkout/stripe-checkout-service.js before it throws).
  // QUOTATION_NOT_ISSUED does not: services/billing/quotation-gate.js logs and
  // throws, and the self-heal the payments list runs writes a console line when
  // it fails. An applicant told that staff already know stops acting and waits
  // for a call nobody was asked to make.
  const CODES_THAT_ALERT_STAFF: string[] = ['CHECKOUT_PRICE_DRIFT'];
  it.each(RAIL_CODES)('%s claims an alert only when the rail actually sends one', (code) => {
    expect(CHECKOUT_ERROR_MAP[code].includes('ได้รับแจ้งแล้ว'))
      .toBe(CODES_THAT_ALERT_STAFF.includes(code));
  });

  // Final round, last items. "กรุณากลับไปที่หน้ารายการชำระเงินเพื่อให้ระบบออกใบ
  // เสนอราคา" was true only inside SELF_HEAL_STATUSES (M1 minus DRAFT). R3
  // routes an M2-payable application with no row to this same refusal, and for
  // it the list issues nothing however often it is opened. The map now mirrors
  // the catalogue row byte for byte, so the card rail and the slip rail cannot
  // say two different things about one refusal.
  it('a missing quotation mirrors the catalogue and asks for the application number', () => {
    const copy = CHECKOUT_ERROR_MAP.QUOTATION_NOT_ISSUED;
    expect(copy).toBe(QUOTATION_NOT_ISSUED_COPY_TH);
    expect(copy).toContain('ติดต่อเจ้าหน้าที่');
    expect(copy).toContain('แจ้งเลขที่คำขอ');
    expect(copy).not.toContain('รีเฟรช');
  });

  // Final round, last items. Round 4 replaced the staff door nobody has
  // (ledger F-G4-71) with a promise that the payments read issues a
  // replacement. It does, for most rows — and refuses for three shapes that
  // raise this very code: a pre-W14 DTAM+PLATFORM pair, an M2-payable
  // application whose lapsed row prices both instalments, and a row whose
  // งวดที่ 2 is already invoiced (services/quotation-issuance-on-submit.js).
  // This map holds no rows and cannot tell them apart, so it names the door
  // that may replace the offer and what to do when it does not.
  it('an expired quotation points at the list without promising a document it may not get', () => {
    const copy = CHECKOUT_ERROR_MAP.QUOTATION_EXPIRED;
    expect(copy).toBe(QUOTATION_EXPIRED_COPY_TH);
    expect(copy).toContain('หน้ารายการชำระเงิน');
    expect(copy).toContain('หากระบบไม่ออกใบใหม่ให้');
    expect(copy).toContain('แจ้งเลขที่ใบเสนอราคา');
    expect(copy).not.toContain('ระบบจะออกใบใหม่ให้');
    expect(copy).not.toContain('ออกใบเสนอราคาใหม่');
    expect(copy).not.toContain('ลองใหม่อีกครั้ง');
  });

  it('the phase-not-priced refusal asks for the number instead of promising a new document', () => {
    // Final round R2 — mirrors the catalogue row this code stands for
    // (error-codes.js CHECKOUT_PHASE_NOT_PRICED.messageTh).
    const copy = CHECKOUT_ERROR_MAP.CHECKOUT_PHASE_NOT_PRICED;
    expect(copy).toContain('เลขที่ใบเสนอราคา');
    expect(copy).not.toContain('ออกใบเสนอราคาใหม่');
  });

  it('a gate lookup failure is the one that says it is temporary, and that no charge was made', () => {
    const copy = CHECKOUT_ERROR_MAP.QUOTATION_GATE_UNAVAILABLE;
    expect(copy).toContain('ลองใหม่อีกครั้ง');
    // True on this rail specifically: no order and no PaymentIntent exist until
    // the gate passes, so saying so is not a promise the rail cannot keep.
    expect(copy).toContain('ยังไม่สร้างรายการชำระเงิน');
  });
});
