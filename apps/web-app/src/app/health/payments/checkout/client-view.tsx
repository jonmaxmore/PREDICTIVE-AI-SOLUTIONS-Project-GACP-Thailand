'use client';

/**
 * client-view.tsx — /health/payments/checkout (W2-03 D2).
 *
 * Stripe-checkout entry flow: read ?app / ?milestone / ?mockScenario from
 * the URL, call createCheckout() on demand, and render the
 * idle / creating / created / failed states.
 *
 * Hard rules pinned by __tests__/checkout-states.test.tsx:
 *
 *   - VERBATIM MONEY: every amount shown comes straight from the response
 *     breakdown. This file performs NO arithmetic on any breakdown field
 *     and imports nothing from the fee-constants module (both
 *     grep-pinned). The backend is the only calculator; the
 *     HAPPY_NON_SUMMING fixture test fails the build if anyone ever
 *     "helpfully" recomputes a total here.
 *   - NOT PAID YET: the created state is "รอชำระเงิน". No word or visual
 *     may claim the payment happened.
 *   - PASS-THROUGH PARAMS: query params go to the service untouched. The
 *     ONLY check this view makes is "is ?app present at all" — validation
 *     of the values belongs to the backend.
 *   - Error copy is Thai via a per-component error map (Policy 5 pattern
 *     from src/lib/i18n/error-code-map.ts, first used by
 *     SLIP_REVIEW_ERROR_MAP in slip-review-modal.tsx).
 *   - THE PAYMENT STEP (operator ruling 2026-09-27: PromptPay only, shown by
 *     Stripe's own component). When the checkout response carries a
 *     publishable key, the created state renders PromptPayPayStep
 *     (promptpay-pay-step.tsx), which opens Stripe's QR modal with the
 *     returned clientSecret and then waits for the WEBHOOK to settle the
 *     invoice; this screen never marks anything paid. Pinned by
 *     __tests__/checkout-promptpay-qr.test.tsx.
 *   - NO PROMISE OF A PAYMENT THIS SCREEN CANNOT TAKE (operator decision 6,
 *     2026-09-17, audit UXUI-X01). Without a key (mock adapter, fixtures) or
 *     on the backend's fail-closed refusals, the copy says the QR cannot be
 *     shown and nothing was charged (constants/service-facts.ts
 *     ONLINE_PAYMENT_NOT_READY_TH); the idle state states the one sentence
 *     true in both cases (ONLINE_PAYMENT_STEP_TH). No refusal sends the
 *     applicant to staff to pay: no staff role can record a payment. Pinned by
 *     __tests__/checkout-does-not-promise-online-payment.test.tsx.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SummaryHeader } from '@/components/feature';
import { Button } from '@/components/ui/primitives/button';
import { getCheckoutApiMode } from '@/lib/config/checkout-mode';
import { hasMappedErrorCode } from '@/lib/i18n/error-code-map';
import { FINANCE_EMAIL } from '@/constants/contact-emails';
import {
  PAYMENT_TERMS_EDITION_TH,
  PAYMENT_TERMS_EFFECTIVE_TH,
  PAYMENT_TERMS_ONE_FEE_TH,
  PAYMENT_TERMS_PRICE_BINDING_TH,
  PAYMENT_TERMS_SERVICE_LINES,
  PAYMENT_TERMS_TITLE_TH,
} from '@/constants/payment-terms';
import {
  NOT_CHARGED_TH,
  ONLINE_PAYMENT_NOT_READY_TH,
  ONLINE_PAYMENT_STEP_TH,
} from '@/constants/service-facts';
import {
  acceptedPhaseAmount,
  isPaymentTermsGranted,
  isQuotationAccepted,
  milestoneLabelTh,
  milestonePhase,
  PaymentService,
  QUOTATION_EXPIRED_COPY_TH,
  QUOTATION_NOT_ACCEPTED_COPY_TH,
  QUOTATION_NOT_ISSUED_COPY_TH,
  type QuotationRecord,
} from '@/lib/services/payment-service';
import {
  createCheckout,
  type CheckoutResult,
  type CheckoutSessionData,
} from '@/lib/services/checkout-service';
import { quotationServicesOrFallback, type QuotationServices } from '@/lib/pricing/fee-services';
import { PromptPayPayStep } from './promptpay-pay-step';

export {
  SETTLEMENT_POLL_INTERVAL_MS,
  SETTLEMENT_WATCH_TIMEOUT_MS,
} from './promptpay-pay-step';

/**
 * FE mirror of api-client's client-side abort sentinel (api-client.ts
 * returns exactly this string when the request timed out before any HTTP
 * response arrived). Not a business value — a transport sentinel that
 * api-client does not export.
 */
const API_TIMEOUT_SENTINEL = 'Request timeout. Please try again';

/**
 * The one refusal this screen can clear by itself: the box that answers it is
 * on this page. Named once and read twice (the copy map key and the recovery
 * branch in startCheckout) so the two cannot drift into a sentence that
 * promises a control nothing reopens.
 */
const PAYMENT_TERMS_NOT_ACCEPTED = 'PAYMENT_TERMS_NOT_ACCEPTED';

/**
 * W2-03 D2 — per-component Thai error map (Policy 5). Keys are the
 * backend's stable English codes from POST /payments/checkout.
 *
 * CHECKOUT_ALREADY_IN_PROGRESS wording is scope-amendment ground truth
 * and is pinned character-for-character by the 409 test — do not edit it
 * without a new amendment.
 *
 * Exported for unit testing (same idiom as SLIP_REVIEW_ERROR_MAP).
 */
export const CHECKOUT_ERROR_MAP: Record<string, string> = {
  CHECKOUT_ALREADY_IN_PROGRESS:
    'มีรายการชำระเงินของงวดนี้กำลังดำเนินการอยู่แล้ว กรุณาเปิดหน้าชำระเงินเดิมหรือลองใหม่อีกครั้ง',
  CHECKOUT_MILESTONE_NOT_PAYABLE:
    'งวดนี้ยังไม่ถึงกำหนดชำระ คุณสามารถตรวจสอบงวดที่ต้องชำระได้จากหน้ารายการชำระเงิน',
  APPLICATION_NOT_FOUND:
    'ไม่พบคำขอนี้ในระบบ กรุณากลับไปเลือกคำขอของคุณจากหน้ารายการชำระเงินอีกครั้ง',
  CHECKOUT_INVALID_MILESTONE:
    'งวดที่ระบุไม่ถูกต้อง กรุณากลับไปเริ่มขั้นตอนใหม่จากหน้ารายการชำระเงิน',
  // Used to end by sending the applicant to finance staff to pay: no staff
  // role can take a payment (workflow-transition-service.js). What the
  // applicant needs is the fact that nothing was created or charged; the back
  // link below is the action.
  STRIPE_CHECKOUT_DISABLED:
    'ระบบชำระเงินออนไลน์ยังไม่เปิดใช้งานในขณะนี้ ระบบจึงยังไม่สร้างรายการชำระเงินและยังไม่ได้เรียกเก็บเงินจากคุณ',
  // PromptPay QR step: the backend refuses BEFORE minting when the browser
  // could not be handed a usable publishable key (missing, not a pk_ key, or a
  // test/live mode different from the secret's) or when the secret itself is
  // absent. Not "ระบบยังไม่สร้างรายการ": a re-entry may find an order minted
  // earlier, so only what is true on every path is said.
  STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED: `${ONLINE_PAYMENT_NOT_READY_TH} ${NOT_CHARGED_TH}`,
  STRIPE_KEY_MODE_MISMATCH: `${ONLINE_PAYMENT_NOT_READY_TH} ${NOT_CHARGED_TH}`,
  STRIPE_NOT_CONFIGURED: `${ONLINE_PAYMENT_NOT_READY_TH} ${NOT_CHARGED_TH}`,
  // Fix round 3 (N-2). The order already holds a payment in a state the
  // automatic PromptPay flow never produces (requires_capture /
  // requires_confirmation); the backend refuses rather than mint a second one,
  // and pressing again refuses again. So no retry is offered and no "not
  // charged" is claimed (a held authorisation is not ruled out): the payer is
  // sent to the company's payments mailbox, from the one contact source.
  CHECKOUT_INTENT_UNUSABLE:
    `รายการชำระเงินของงวดนี้อยู่ในสถานะที่ระบบดำเนินการต่อจากหน้านี้ไม่ได้ ระบบจึงไม่สร้างรายการชำระเงินซ้ำ กรุณาติดต่อบริษัทผู้ให้บริการแพลตฟอร์มที่ ${FINANCE_EMAIL} พร้อมแจ้งเลขคำขอ`,
  // Fix round 3 (N-1). The order changed between the backend's read and its
  // write (cancelled meanwhile, or moved to another payment by a concurrent
  // press). Nothing was recorded and no QR was handed out, so nothing can have
  // been charged by THIS press; starting again re-reads the order. The back
  // link below is the action.
  CHECKOUT_ORDER_CHANGED:
    'รายการชำระเงินของงวดนี้เปลี่ยนแปลงระหว่างที่ระบบกำลังเตรียมการชำระ ระบบจึงยังไม่บันทึกรายการนี้ และการกดครั้งนี้ไม่ได้เรียกเก็บเงิน กรุณากลับไปหน้ารายการชำระเงินแล้วเริ่มขั้นตอนชำระเงินใหม่',

  // F-G4-64: the card rail is now fail-closed on the quotation and on the
  // payment-terms disclosure, so seven refusals can come back that could not
  // before. The route answers `error: <CODE>` and safeErrorMessage strips the
  // backend's Thai sentence (apps/backend/shared/api-response.js), so this map
  // is the only place they become Thai. Without an entry each one fell through
  // to FALLBACK_MESSAGE_TH, which tells an applicant who has only to press
  // ยอมรับ on their quotation to try again later.
  // Pinned by __tests__/checkout-error-copy-covers-the-quotation-gate.test.ts.
  // Not "กดปุ่มรีเฟรช": this screen has no refresh button (the one plan
  // contradiction 8 names is on the payments list), and copy may not name an
  // action the screen does not offer. The back link below is the action it has.
  //
  // Fix round 3 (reviewer r2, major 1): this sentence used to end
  // "เจ้าหน้าที่ได้รับแจ้งแล้ว กรุณา … ตรวจสอบอีกครั้งในภายหลัง" and BOTH halves
  // were untrue on this path. Nothing tells staff: the gate logs and throws
  // (services/billing/quotation-gate.js), and the self-heal that the payments
  // list runs writes a console line when it fails
  // (services/quotation-issuance-on-submit.js) - the admin alert is raised on
  // the SUBMIT path only. And "check again later" is not the action either:
  // going back to the payments list is what CALLS the re-issuing endpoint
  // (GET /api/applications/:id/quotations), so the wait it asked for could
  // never end on its own. Cause, then the step that can change the outcome,
  // then the human who can fix it when that step does not.
  //
  // Last items of the final round: "กลับไปที่หน้ารายการชำระเงินเพื่อให้ระบบออกใบ
  // เสนอราคา" was true only inside SELF_HEAL_STATUSES (M1 minus DRAFT). R3
  // routes an M2-payable application holding no row to this same refusal, and
  // for it the list issues nothing however often it is opened. The catalogue
  // row is now shared verbatim with the slip rail (payment-service.ts).
  QUOTATION_NOT_ISSUED: QUOTATION_NOT_ISSUED_COPY_TH,
  // Byte-identical with what the preview page's file door says for the same
  // refusal (payment-service.QUOTATION_NOT_ACCEPTED_COPY_TH): two screens away
  // from the tick, one sentence.
  QUOTATION_NOT_ACCEPTED: QUOTATION_NOT_ACCEPTED_COPY_TH,
  // Final round R1/R21 (finding C9): the old sentence ended "กรุณาติดต่อ
  // เจ้าหน้าที่เพื่อออกใบเสนอราคาใหม่" — a function no staff surface has (ledger
  // F-G4-71). GET /api/applications/:id/quotations retires the lapsed row and
  // issues a replacement, and the payments list is the door that calls it.
  //
  // Last items of the round: for three shapes it refuses to (a pre-W14
  // DTAM+PLATFORM pair, an M2-payable row priced for both instalments, a row
  // already invoiced), and this screen holds one milestone, not the rows, so it
  // cannot tell them apart. Verbatim from the catalogue row (error-codes.js
  // QUOTATION_EXPIRED.messageTh), shared with the other rails: the door that
  // may replace the offer, then the action for when it does not.
  QUOTATION_EXPIRED: QUOTATION_EXPIRED_COPY_TH,
  QUOTATION_GATE_UNAVAILABLE:
    'ตรวจสอบสถานะใบเสนอราคาไม่สำเร็จ ระบบยังไม่สร้างรายการชำระเงินและยังไม่มีการเรียกเก็บเงิน กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
  // Final round R2 (finding C9) — same reason: no staff can issue a quotation,
  // so the copy asks for the one thing that lets staff act at all. Mirrors the
  // catalogue row (error-codes.js CHECKOUT_PHASE_NOT_PRICED.messageTh).
  CHECKOUT_PHASE_NOT_PRICED:
    'งวดนี้ไม่อยู่ในใบเสนอราคาของคำขอ ระบบจึงไม่สร้างรายการชำระเงิน กรุณาเลือกงวดที่ถูกต้อง หากยังพบข้อความนี้ กรุณาติดต่อเจ้าหน้าที่พร้อมแจ้งเลขที่ใบเสนอราคา',
  // Verbatim from the catalogue row it stands for (error-codes.js
  // CHECKOUT_PRICE_DRIFT.messageTh). "เจ้าหน้าที่ได้รับแจ้งแล้ว" is true because
  // the refusal fans an URGENT admin notification out; nothing is promised
  // beyond what the backend actually does.
  CHECKOUT_PRICE_DRIFT:
    'ยอดที่จะเรียกเก็บไม่ตรงกับใบเสนอราคาที่คุณยอมรับไว้ ระบบจึงไม่สร้างรายการชำระเงิน เจ้าหน้าที่ได้รับแจ้งแล้ว',
  // The acknowledgment is taken on THIS page now (the block below), and the
  // press records it through the same consent API the slip modal uses. Reaching
  // this refusal therefore means the recording did not stick or the disclosure
  // version moved under the applicant, and the act that clears it is one tick
  // away. Sending them to the payments list, as this sentence used to, named a
  // longer road to the same act.
  //
  // The sentence is only true because startCheckout puts the box back when this
  // code comes home (review r0 major 1): a grant recorded under an older
  // ConsentVersions.PAYMENT_TERMS reads as granted on mount, so without the
  // reset the screen would name a checkbox it had already replaced and a reload
  // would land in the same state for ever.
  [PAYMENT_TERMS_NOT_ACCEPTED]:
    'ระบบยังไม่ได้บันทึกการยอมรับเงื่อนไขการชำระเงินและการคืนเงินของคุณ กรุณาติ๊กยอมรับเงื่อนไขในหน้านี้อีกครั้ง แล้วกดเริ่มขั้นตอนชำระเงิน',
};

/** Client-side abort / no-HTTP-response — retryable. */
const TIMEOUT_MESSAGE_TH = 'เชื่อมต่อกับระบบไม่สำเร็จ กรุณากดปุ่มลองใหม่อีกครั้ง';

/** Unmapped backend failure (e.g. 5xx) — cause + path back. */
const FALLBACK_MESSAGE_TH =
  'ไม่สามารถสร้างรายการชำระเงินได้ กรุณาลองใหม่ภายหลัง หรือกลับไปที่หน้ารายการชำระเงิน';

/**
 * The consent write failed, so nothing was asked of the payment rail. Naming
 * that matters: the applicant has just ticked a box about money and must not be
 * left wondering whether a charge was started anyway.
 */
const CONSENT_WRITE_FAILED_TH =
  'บันทึกการยอมรับเงื่อนไขการชำระเงินไม่สำเร็จ ระบบจึงยังไม่สร้างรายการชำระเงินและยังไม่มีการเรียกเก็บเงิน กรุณากดลองใหม่อีกครั้ง';

/**
 * Is there a consent ledger to talk to at all?
 *
 * Fix round 2 (review r1 major 1). createCheckout answers from fixtures
 * "without touching the network" in mock mode (checkout-service.ts), and this
 * page is run that way on purpose: e2e/checkout-visual.spec.ts opens it with
 * NEXT_PUBLIC_CHECKOUT_API_MODE=mock and NO backend behind it, then presses the
 * real เริ่มขั้นตอนชำระเงิน button. The consent read and the consent write had no
 * such branch, so in that environment the read failed, the write failed, and
 * the press could never reach the fixture.
 *
 * Only the LEDGER call is skipped. The disclosure is still rendered and still
 * has to be ticked, so the screen a mock run captures is the screen a real
 * applicant sees, and so nothing here can be mistaken for evidence that a human
 * agreed to anything: in mock mode no consent row is written, and no money
 * moves either.
 *
 * Same fail-safe direction as getCheckoutApiMode itself — anything other than
 * the exact value 'mock' means a real backend, and a real consent record.
 */
function consentLedgerReachable(): boolean {
  return getCheckoutApiMode() !== 'mock';
}

const PAYMENTS_LIST_HREF = '/health/payments';
const BACK_TO_PAYMENTS_LABEL = 'กลับไปหน้ารายการชำระเงิน';

interface CheckoutFailure {
  message: string;
  retryable: boolean;
}

/**
 * Map a failed envelope to Thai copy + retryability.
 * Order: (1) mapped code (prefer `code`, fall back to `error` since the
 * mock/backend envelopes carry the identifier in both), (2) client-side
 * timeout — the sentinel string OR any envelope with no HTTP `status`,
 * (3) generic Thai fallback. Raw English codes never reach the screen.
 */
function resolveCheckoutFailure(result: CheckoutResult): CheckoutFailure {
  const codeKey = result.code ?? result.error;
  const mapped = hasMappedErrorCode(codeKey, CHECKOUT_ERROR_MAP)
    ? CHECKOUT_ERROR_MAP[codeKey]
    : undefined;
  if (mapped !== undefined) {
    return { message: mapped, retryable: false };
  }
  if (result.error === API_TIMEOUT_SENTINEL || result.status === undefined) {
    return { message: TIMEOUT_MESSAGE_TH, retryable: true };
  }
  return { message: FALLBACK_MESSAGE_TH, retryable: false };
}

/** Same defensive Intl pattern as formatCurrency in ../client-view.tsx. */
function formatCurrency(value: number) {
  const n = Number(value);
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

type Phase = 'idle' | 'creating' | 'created' | 'failed';

/**
 * A Stripe publishable key is the only thing this screen accepts to load
 * Stripe.js with. Anything else (null, a fixture's absence, a secret that
 * somehow travelled) means there is no browser step here.
 */
function usablePublishableKey(key: string | null | undefined): key is string {
  return typeof key === 'string' && /^pk_(test|live)_/.test(key);
}

export default function HealthPaymentsCheckoutPage() {
  const searchParams = useSearchParams();
  // Pass-through params. No trimming, no normalization, no validation —
  // the backend owns all of that. The only decision made here is the
  // presence check on `app` below.
  const applicationId = searchParams.get('app') ?? '';
  const milestoneParam = searchParams.get('milestone') ?? '';
  const mockScenarioParam = searchParams.get('mockScenario') ?? undefined;

  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<CheckoutSessionData | null>(null);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  // Set only by PromptPayPayStep, and only after it has READ the invoice the
  // webhook settled; this screen never decides it by itself.
  const [settled, setSettled] = useState(false);
  const markSettled = useCallback(() => setSettled(true), []);

  /*
    Q4 pre-payment disclosure (owner ruling 2026-07-08) reaches the card rail.
    Coordinator ruling 2 (2026-08-28): ONE consent namespace — the same
    UserConsent ledger, the same category and the same POST /api/consent the
    slip modal writes, which is what services/billing/payment-terms-gate.js
    reads before either rail may create a payment. `termsRecorded` = a granted
    consent already exists server-side; `termsAccepted` = the box ticked in THIS
    session (recorded on press). Same two-flag shape as slip-upload-modal.tsx,
    on purpose: two rails asking one question.
  */
  const [termsRecorded, setTermsRecorded] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  /*
    F-G4-64 final round R15 (findings S15/S22) — spec §3.5 binds this screen to
    show "เลขใบเสนอราคา + ยอดงวดจาก snapshot" beside the acknowledgment. Until
    now both appeared only in the `created` branch, i.e. AFTER the consent was
    written and the order + PaymentIntent were minted: the applicant ticked a
    no-refund disclosure and pressed pay on a screen that named neither the
    document nor the sum, under a bullet claiming the amount was locked by "the
    quotation you accepted".

    Same endpoint the payments list uses, which is also the door that re-issues
    a missing quotation. Read-only here: a failure is silent, because this
    screen's job is still to take the acknowledgment, and the gate behind the
    button is the thing that refuses (fail-closed on the server, never here).
  */
  const [acceptedQuotation, setAcceptedQuotation] = useState<QuotationRecord | null>(null);
  // the backlog ~line 611 — the applicant knows their application by
  // its NUMBER (e.g. APP-2569-MUJIXOBX-0C1EC3), never the internal UUID
  // this screen reads from the URL. Read from the SAME call as
  // `acceptedQuotation` above (no second fetch) — the backend already
  // selects `applicationNumber` for the payer/copy blocks and now puts it
  // on the wire. `null` until it answers: the UUID is never shown as a
  // stand-in.
  const [applicationNumber, setApplicationNumber] = useState<string | null>(null);
  // What THIS application's milestones are called (fix/fee-line-descriptions round 2):
  // a renewal's M2 is the renewal service, not งวดที่ 2. `null` while the quotation
  // read is in flight, so no instalment name is shown before the server says which;
  // a read that fails falls back to the new-filing names (the screen's old behaviour).
  const [services, setServices] = useState<QuotationServices | null>(null);

  useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await PaymentService.getQuotations(applicationId);
        if (cancelled) return;
        setServices(quotationServicesOrFallback(rows?.copy?.services));
        if (!rows) return;
        // The row the gate itself binds the charge to: PLATFORM when the
        // application holds one, else the pre-W14 DTAM row
        // (services/billing/quotation-gate.js).
        const bound = rows.platform ?? rows.dtam;
        setAcceptedQuotation(isQuotationAccepted(bound) ? bound : null);
        if (rows.applicationNumber) setApplicationNumber(rows.applicationNumber);
      } catch {
        // No answer is not a fact about the document: say nothing.
        if (!cancelled) setServices(quotationServicesOrFallback(null));
      }
    })();
    return () => { cancelled = true; };
  }, [applicationId]);

  // Never the raw UUID (the backlog ~line 611): while the number is
  // still loading, say so rather than falling back to `applicationId`.
  const applicationNumberDisplay = applicationNumber ?? 'กำลังโหลด…';

  const milestoneLabel = services ? milestoneLabelTh(milestoneParam, services) : null;
  const sessionMilestoneLabel = session && services ? milestoneLabelTh(session.milestone, services) : null;
  // `phase` is taken by this view's own state machine, so the instalment the
  // milestone collects is named for what it is.
  const milestoneInstalment = milestonePhase(milestoneParam);
  const acceptedAmount = milestoneInstalment
    ? acceptedPhaseAmount(acceptedQuotation, milestoneInstalment)
    : null;

  useEffect(() => {
    if (!applicationId || !consentLedgerReachable()) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await PaymentService.getPaymentTermsConsent();
        if (cancelled) return;
        // The real GET /consent body keys consents BY CATEGORY; parse through
        // the shared tested helper rather than re-reading the shape here.
        if (res.success && isPaymentTermsGranted(res.data)) setTermsRecorded(true);
      } catch {
        // A failed lookup leaves the box required, never less than that.
      }
    })();
    return () => { cancelled = true; };
  }, [applicationId]);

  const startCheckout = useCallback(async () => {
    setPhase('creating');
    setFailure(null);
    try {
      // Record the acknowledgment BEFORE asking for a charge (idempotent — the
      // backend upserts one row per user+category). Without it the request
      // would come back PAYMENT_TERMS_NOT_ACCEPTED anyway; recording first
      // gives one clean press instead of a confusing two-step failure. The
      // version is the server's (ConsentVersions.PAYMENT_TERMS) — this bundle
      // does not get to name the disclosure it showed.
      if (!termsRecorded && consentLedgerReachable()) {
        const consent = await PaymentService.acceptPaymentTerms();
        if (!consent.success) {
          setFailure({ message: CONSENT_WRITE_FAILED_TH, retryable: true });
          setPhase('failed');
          return;
        }
        setTermsRecorded(true);
      }

      // exactOptionalPropertyTypes: only attach mockScenario when the
      // query param is actually present (still verbatim pass-through).
      const result = await createCheckout({
        applicationId,
        milestone: milestoneParam,
        ...(mockScenarioParam === undefined ? {} : { mockScenario: mockScenarioParam }),
      });
      if (result.success && result.data) {
        setSession(result.data);
        setPhase('created');
        return;
      }
      setFailure(resolveCheckoutFailure(result));
      // The gate says the disclosure was never answered, or was answered under a
      // version that no longer counts. The applicant is standing in front of the
      // control that fixes that, so give it back to them: the failed phase
      // renders neither the terms section nor the start button, and a grant
      // already on file replaces the box with "คุณได้ยอมรับเงื่อนไขนี้ไว้แล้ว",
      // so without this the copy above names two controls that are not on the
      // screen and a reload re-derives the same dead end. The slip rail does the
      // same thing on the same code (slip-upload-modal.tsx).
      if ((result.code ?? result.error) === PAYMENT_TERMS_NOT_ACCEPTED) {
        setTermsRecorded(false);
        setTermsAccepted(false);
        setPhase('idle');
        return;
      }
      setPhase('failed');
    } catch {
      // createCheckout resolves envelopes; an actual throw means no
      // response at all — treat like a client-side timeout (retryable).
      setFailure({ message: TIMEOUT_MESSAGE_TH, retryable: true });
      setPhase('failed');
    }
  }, [applicationId, milestoneParam, mockScenarioParam, termsRecorded]);

  const creating = phase === 'creating';
  // The disclosure has to be answered before a charge may be asked for: ticked
  // now, or already on file from an earlier payment.
  const termsAnswered = termsRecorded || termsAccepted;

  return (
    <div className="space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · การเงิน"
        title="สร้างรายการชำระเงิน"
        description="สร้างรายการชำระเงินสำหรับงวดของคำขอ"
      />

      {!applicationId ? (
        // Missing ?app — the one check this view is allowed to make.
        <section className="rounded-[1.375rem] bg-card p-5 shadow-leaf-card sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">ไม่พบเลขคำขอ</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            ลิงก์ที่คุณเปิดไม่มีเลขคำขอแนบมาด้วย
            ระบบจึงไม่ทราบว่าจะสร้างรายการชำระเงินสำหรับคำขอใด
            กรุณากลับไปที่หน้ารายการชำระเงิน แล้วกดปุ่มสร้างรายการชำระเงินจากคำขอที่ต้องการ
          </p>
          <div className="mt-4">
            <Button variant="secondary" size="sm" href={PAYMENTS_LIST_HREF}>
              {BACK_TO_PAYMENTS_LABEL}
            </Button>
          </div>
        </section>
      ) : phase === 'created' && session ? (
        // Created, AWAITING PAYMENT. Amounts render verbatim from the
        // response breakdown — no arithmetic, ever (grep-pinned).
        <section className="rounded-[1.375rem] bg-card p-5 shadow-leaf-card sm:p-6">
          <h2 className="text-lg font-semibold text-leaf-700">
            {settled ? 'ชำระเงินสำเร็จ' : 'สร้างรายการสำเร็จ รอชำระเงิน'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {settled
              ? 'ระบบได้รับการยืนยันการชำระเงินของรายการนี้แล้ว'
              : 'ระบบสร้างรายการชำระเงินของคุณเรียบร้อย สถานะปัจจุบันคือรอชำระเงิน'}
          </p>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">เลขคำขอ</span>
              <span className="font-mono text-foreground">{applicationNumberDisplay}</span>
            </div>
            {/*
              F-G4-64 — the priced document this charge collects against. The
              backend returns the number of the quotation its gate matched, so
              the applicant can see that the amount below answers to the
              document they accepted rather than to a figure this screen chose.
            */}
            {session.quotationNumber ? (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">ใบเสนอราคาที่ยอมรับไว้</span>
                <span className="font-mono text-foreground">{session.quotationNumber}</span>
              </div>
            ) : null}
            {/*
              Final round R16 — this used to print `session.milestone` verbatim
              ('M1'), a machine code on the one screen that confirms what was
              just ordered, directly under a document that calls the same thing
              งวดที่ 1. The label map is shared with the wizard's own document
              lines (payment-service.PHASE_LABEL_TH). A milestone the map does
              not know is not printed at all: the backend refuses an unknown one
              before minting (UNKNOWN_MILESTONE), so there is nothing to name.
            */}
            {sessionMilestoneLabel ? (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">รายการที่ต้องชำระ</span>
                <span className="font-medium text-foreground">
                  {sessionMilestoneLabel}
                </span>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">เลขที่รายการ</span>
              <span className="font-mono text-foreground">{session.checkoutOrderId}</span>
            </div>
          </div>

          <div className="mt-4 space-y-1.5 rounded-2xl bg-mint-soft p-3 text-sm">
            <p className="mb-2 font-semibold text-foreground">รายการที่ชำระ</p>
            {/* มติ operator 2026-09-07 (ปิด F-MONEY-UI-02): "ไม่ต้อง เราแยกตามบริการ …
                เรื่ององค์ประกอบบัญชี จะไปคุยกันเอง" — บล็อกนี้เคยกางเงินเป็น 3 ยอด
                (ราคาเต็ม · ค่าแพลตฟอร์ม · VAT) ซึ่งคือบัญชีภายในของผู้ขาย ไม่ใช่สิ่งที่
                ผู้ยื่นซื้อ · หน้านี้บอกว่า "จ่ายค่าบริการอะไร งวดไหน เท่าไร รวมภาษีแล้ว"
                ส่วนราคาต่อรูปแบบการปลูกอยู่บนใบเสนอราคาที่เพิ่งกดยอมรับ */}
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{milestoneLabel || 'ค่าบริการตามใบเสนอราคา'}</span>
              <span className="tabular-nums text-foreground">
                {formatCurrency(session.breakdown.totalPayableAmount)}
              </span>
            </div>
            <div className="mt-1 flex justify-between border-t border-primary-100 pt-1.5 font-semibold">
              <span>ยอดรวม (รวมภาษีมูลค่าเพิ่มแล้ว)</span>
              <span className="tabular-nums text-leaf-700">
                {formatCurrency(session.breakdown.totalPayableAmount)}
              </span>
            </div>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            ยอดทั้งหมดคำนวณโดยระบบและแสดงตามที่ได้รับ
          </p>
          {/* The key is what makes the QR possible, and it comes from the
              backend with this very response. Without one there is no next
              payment step to point at: say the QR cannot be shown and that
              nothing was charged. */}
          {usablePublishableKey(session.publishableKey) ? (
            <PromptPayPayStep
              publishableKey={session.publishableKey}
              clientSecret={session.clientSecret}
              paymentIntentStatus={session.paymentIntentStatus ?? null}
              invoiceId={session.invoiceId ?? null}
              payerEmail={session.payerEmail ?? null}
              onSettled={markSettled}
            />
          ) : (
            <p
              role="status"
              className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              {ONLINE_PAYMENT_NOT_READY_TH} {NOT_CHARGED_TH}
            </p>
          )}

          <div className="mt-4">
            <Button variant="secondary" size="sm" href={PAYMENTS_LIST_HREF}>
              {BACK_TO_PAYMENTS_LABEL}
            </Button>
          </div>
        </section>
      ) : phase === 'failed' && failure ? (
        <section className="rounded-[1.375rem] bg-card p-5 shadow-leaf-card sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">สร้างรายการชำระเงินไม่สำเร็จ</h2>
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {failure.message}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {failure.retryable ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void startCheckout()}
              >
                ลองใหม่อีกครั้ง
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" href={PAYMENTS_LIST_HREF}>
              {BACK_TO_PAYMENTS_LABEL}
            </Button>
          </div>
        </section>
      ) : (
        // idle / creating
        <section className="rounded-[1.375rem] bg-card p-5 shadow-leaf-card sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">เริ่มชำระเงินสำหรับคำขอของคุณ</h2>
          <div className="mt-3 flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">เลขคำขอ</span>
            <span className="font-mono text-foreground">{applicationNumberDisplay}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            เมื่อกดเริ่ม ระบบจะสร้างรายการชำระเงินของงวดนี้ให้คุณ
            พร้อมสรุปค่าบริการทั้งหมด
          </p>
          <p className="mt-3 rounded-2xl border border-primary-100 bg-muted px-4 py-3 text-sm text-foreground">
            {ONLINE_PAYMENT_STEP_TH}
          </p>
          {creating ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              กำลังสร้างรายการชำระเงิน กรุณารอสักครู่
            </p>
          ) : null}

          {/*
            Final round R15 — the document this press authorises, named BEFORE
            the tick and before any charge exists. Every figure is read, never
            computed: the amount is the phaseTotal the acceptance froze
            (acceptedSnapshot), which is the same figure the backend compares the
            charge against (assertChargeMatchesAcceptedFigures). When no
            acceptance is on file there is nothing to name here, and the gate
            behind the button is what refuses.
          */}
          {acceptedQuotation && milestoneLabel ? (
            <section
              data-testid="checkout-quotation-summary"
              className="mt-4 space-y-1.5 rounded-2xl bg-muted p-4 text-sm"
            >
              <h3 className="font-semibold text-foreground">ใบเสนอราคาที่ยอมรับไว้</h3>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">เลขที่ใบเสนอราคา</span>
                <span className="font-mono text-foreground">
                  {acceptedQuotation.quotationNumber}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">รายการที่ต้องชำระ</span>
                <span className="text-foreground">{milestoneLabel}</span>
              </div>
              {/*
                Fix round 1 (reviewer MAJOR) — the figure is printed only when
                the DOCUMENT states the whole phase. A row too old to record a
                phase price (pre-GAP-5 instalments carry {phase, amount} only)
                gets its number and its instalment named and no sum: this line
                sits above the no-refund tick, so a figure here is the one the
                applicant consents against, and the issuer's own slice is not
                that figure.
              */}
              {acceptedAmount !== null ? (
                <div className="flex justify-between gap-4 font-semibold">
                  <span className="text-foreground">ยอดตามใบเสนอราคา</span>
                  <span className="tabular-nums text-leaf-700">
                    {formatCurrency(acceptedAmount)}
                  </span>
                </div>
              ) : null}
            </section>
          ) : null}

          {/*
            A refusal the applicant can clear from this very screen (today: the
            payment-terms one) comes back to the idle state rather than the
            failed one, because the control it asks for lives here. The sentence
            still has to be read, so it is shown above that control.
          */}
          {phase === 'idle' && failure ? (
            <div
              role="alert"
              className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {failure.message}
            </div>
          ) : null}

          {/*
            Q4 (owner ruling 2026-07-08) reaches the card rail. The disclosure
            is SHOWN here, not linked: there is no /legal/payment-terms route in
            apps/web-app (only (marketing)/privacy-policy and terms-of-service),
            and the slip rail's own block inlines the same summary
            (slip-upload-modal.tsx, data-testid slip-upload-terms-section). The
            full text is docs/legal/payment-terms-th-v1.2.md, and the version
            the acknowledgment is recorded under is the SERVER's
            (ConsentVersions.PAYMENT_TERMS) — coordinator ruling 2, one consent
            namespace. The edition named above the bullets is the document the
            summary was WRITTEN from (constants/payment-terms.ts), pinned to the
            server's published default by
            __tests__/truthful-copy/payment-terms-summary-is-the-published-document.test.ts;
            it is not a claim about what the server records.
            ท่าน is used inside the QUOTED BULLETS on purpose: thai-ui-copy
            reserves it for legal surfaces, and the slip block uses it for the
            same text. Everything the SYSTEM says, here and below, stays คุณ
            (final round R17) — one page, one register.
          */}
          {/*
            Final round R18 (C11): bg-mint-soft is the literal hex #f4f8f4 with
            no `.dark` counterpart while text-foreground flips to near-white, and
            this portal ships a theme toggle — so in dark mode the disclosure
            read white on white. bg-muted is a token and flips with the theme.
          */}
          <section
            className="mt-4 rounded-2xl border border-border bg-muted p-4"
            data-testid="checkout-terms-section"
          >
            <h3 className="text-sm font-semibold text-foreground">เงื่อนไขการชำระเงินและการคืนเงิน</h3>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="checkout-terms-version">
              สรุปจาก{PAYMENT_TERMS_TITLE_TH} ฉบับที่ {PAYMENT_TERMS_EDITION_TH} มีผลตั้งแต่วันที่{' '}
              {PAYMENT_TERMS_EFFECTIVE_TH}
            </p>
            {/*
              payment-terms v1.2 §2.5-§2.6 (operator 2026-10-03): each line by the
              name the quotation, invoice and receipt print, what it covers, and
              that it is one fee with no state part.
            */}
            <ul
              className="mt-2 space-y-1 text-xs text-muted-foreground"
              data-testid="checkout-terms-service-lines"
            >
              {PAYMENT_TERMS_SERVICE_LINES.map((line) => (
                <li key={line.name}>
                  <strong className="font-medium text-foreground">{line.name}</strong>: {line.covers}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{PAYMENT_TERMS_ONE_FEE_TH}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>
                ค่าบริการของขั้นตอนที่<strong>เริ่มดำเนินการตรวจแล้ว ไม่สามารถขอคืนได้</strong>{' '}
                แม้ผลจะไม่ผ่านหรือคำขอถูกยกเลิกเพราะพ้นกำหนดแก้ไข
              </li>
              <li>
                เมื่อถูกสั่งแก้ไข ท่านมีเวลา <strong>5 วันทำการ</strong> (ไม่นับเสาร์-อาทิตย์และวันหยุดราชการไทย)
                พ้นกำหนดคำขอจะถูกยกเลิกอัตโนมัติ
              </li>
              <li>
                การยกเลิกที่เกิดจากความผิดพลาดของระบบเอง แพลตฟอร์มคืนสถานะให้อัตโนมัติ
                เงินที่เก็บซ้ำหรือเก็บผิดพลาดมีสิทธิ์ได้รับคืน
              </li>
              {/*
                Final round R17 (S18) — thai-ui-copy: one register per page. ท่าน
                belongs to the quoted legal text above; this bullet is about the
                document named at the top of this screen, so it drops the pronoun
                rather than switching the page's voice mid-block.
              */}
              {/*
                v1.2 §3.4 replaced v1.1's "locked at submission": the price is
                the accepted quotation's, binding every instalment.
              */}
              <li>
                ยอดที่ต้องชำระยึดตามใบเสนอราคาที่ยอมรับไว้ {PAYMENT_TERMS_PRICE_BINDING_TH}
              </li>
            </ul>
            {termsRecorded ? (
              <p
                className="mt-3 text-xs font-medium text-leaf-700"
                data-testid="checkout-terms-recorded"
              >
                คุณได้ยอมรับเงื่อนไขนี้ไว้แล้ว
              </p>
            ) : (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.currentTarget.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  // No aria-label: it would REPLACE the sentence below as the
                  // control's accessible name, so a screen-reader user would
                  // hear the section heading instead of what they are agreeing
                  // to, and a voice-control user would have to say words that
                  // are not on the screen (WCAG 2.5.3). The wrapping <label>
                  // names it, exactly as the slip rail's identical tick does
                  // (slip-upload-modal.tsx).
                  data-testid="checkout-terms-checkbox"
                />
                <span className="text-foreground">
                  ข้าพเจ้าได้อ่านและ<strong>ยอมรับเงื่อนไขการชำระเงินและการคืนเงิน</strong>ข้างต้น
                </span>
              </label>
            )}
          </section>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={creating}
              disabled={creating || !termsAnswered}
              onClick={() => void startCheckout()}
            >
              เริ่มขั้นตอนชำระเงิน
            </Button>
            <Button variant="secondary" size="sm" href={PAYMENTS_LIST_HREF}>
              {BACK_TO_PAYMENTS_LABEL}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
