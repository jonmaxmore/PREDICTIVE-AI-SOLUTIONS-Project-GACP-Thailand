'use client';
import { DEMO_MODE } from '@/lib/constants';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/api-client';
import { ApplicationNavigation } from '@/components/application-flow/application-navigation';
import { Button } from '@/components/ui/primitives/button';
import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import QuotationDocument from '@/features/permit-form/components/documents/quotation-document';
import { numberToThaiText } from '@/utils/number-to-thai-text';
import { formatThaiDate } from '@/lib/format/thai-date';
import {
  PaymentService,
  isQuotationAccepted,
  isQuotationAcceptable,
  isQuotationAcceptedForPayment,
  isQuotationLapsed,
  quotationAcceptFailureMessage,
  quotationLapsedNoticeTh,
  PHASE_LABEL_TH,
  phase1PaymentRefusalTh,
  type QuotationIssuerType,
  type QuotationRecord,
  type QuotationsBySide,
} from '@/lib/services/payment-service';
import { submissionClaim, LOOKUP_FAILED, type SubmissionClaim } from './submission-claim';
import { ONLINE_PAYMENT_STEP_TH, RECEIPT_TH } from '@/constants/service-facts';
import { SERVICE_NAME, quotationServicesOrFallback, type FeeService, type QuotationServices } from '@/lib/pricing/fee-services';

/* ── Types ── */

interface PhasePaymentPayload {
  requiredInvoices?: Array<{
    id: string;
    serviceType: string;
    status: string;
  }>;
  phasePaid?: boolean;
}

interface DocumentLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

/* ── Helpers ── */

const THAI_LONG_DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/**
 * The two instalment names. Declared here once, now read from the service
 * (final round R16): the checkout screen names the same two instalments, and
 * while each surface kept its own copy the confirmation screen printed the raw
 * enum 'M1' under a document that called it งวดที่ 1.
 */
const PHASE_1_LABEL = PHASE_LABEL_TH.PHASE_1;

/**
 * The lines of the document come from the ROW, never from a live fee
 * calculation (F-G4-64 spec §3.2, coordinator ruling 11). `lineItems` is what
 * the API derives from the stored row; `installments` is the row's own frozen
 * two-instalment split and is the fallback when a legacy row carries no
 * per-scope breakdown. Nothing here adds, multiplies or "corrects" an amount:
 * the total printed below is `quotation.totalAmount` verbatim.
 */
function toDocumentLines(quotation: QuotationRecord, services: QuotationServices): DocumentLine[] {
  const lineItems = quotation.lineItems ?? [];
  if (lineItems.length > 0) {
    // fix/fee-line-descriptions (operator 2026-10-03): a per-type line carries the
    // whole service of that type, so it names the catalogue's services — both
    // instalments for a new filing, the one renewal service otherwise — in the
    // server's words (copy.services). What each covers is printed once under the
    // table (QuotationDocument `serviceNotes`).
    const serviceName = services.PHASE_1
      ? `${services.PHASE_1.name} และ${services.PHASE_2.name}`
      : services.PHASE_2.name;
    // One line per cultivation type at its PRE-VAT service fee (state + platform).
    // VAT is a single line at the foot of the table (docVatBreakdown), not baked
    // into each line — a proper tax document computes it once on the subtotal
    // (operator 2026-09-06: "vat คำนวนสุดท้าย หลังยอดรวม"). The doc-review and audit
    // milestones are how the fee is PAID, not separate goods, so the offer lists the
    // service once per type; the payment page owns the M1/M2 split.
    return lineItems.map((item) => ({
      // No em dash in Thai copy (thai-ui-copy): the type goes in brackets.
      description: `${serviceName} (${item.label})`,
      quantity: 1,
      unitPrice: item.netAmount,
    }));
  }
  return (quotation.installments ?? []).map((installment) => ({
    description: installment.phase === 'PHASE_2' ? services.PHASE_2.name : (services.PHASE_1?.name ?? PHASE_1_LABEL),
    quantity: 1,
    unitPrice: installment.amount,
  }));
}

/**
 * The pre-VAT subtotal and the VAT amount for the table foot. Only when the row
 * carries a per-type breakdown (lineItems); a legacy installment-only row shows
 * the single-total layout, since its lines are already VAT-inclusive and it has no
 * separable tax figure.
 */
function docVatBreakdown(quotation: QuotationRecord): { subtotal: number; vat: number } | null {
  const lineItems = quotation.lineItems ?? [];
  if (lineItems.length === 0) { return null; }
  const subtotal = lineItems.reduce((sum, item) => sum + item.netAmount, 0);
  const vat = lineItems.reduce((sum, item) => sum + item.taxAmount, 0);
  return { subtotal, vat };
}

/**
 * Fold the accept response into the row the screen is drawing.
 *
 * POST /applications/:id/quotations/:issuer/accept answers with
 * markQuotationAccepted's raw Prisma row: status, acceptedAt, acceptedBy and the
 * snapshot columns. It carries no `lineItems` and no `scopeMismatch` — the GET
 * derives both. Assigning the response over the rendered row therefore redrew a
 * three-scope document as two generic instalment lines, and dropped the ruling-12
 * mismatch warning, at the exact instant the applicant accepted it. Overlay what
 * the response knows; keep what only the GET can know.
 */
function withAcceptedRow(
  current: QuotationsBySide,
  updated: QuotationRecord,
): QuotationsBySide {
  const overlay = (row: QuotationRecord | null): QuotationRecord | null =>
    row && row.issuerType === updated.issuerType ? { ...row, ...updated } : row;
  // Keep the server's payer + signatory: the accept response carries neither.
  return { ...current, dtam: overlay(current.dtam), platform: overlay(current.platform) };
}

/**
 * Was this application ever filed?
 *
 * Slot 10 is reachable BEFORE filing: hooks/wizard-step-access.ts opens the
 * payment slot as soon as the flow steps are complete, the wizard's file door is
 * /health/applications/preview (review-step routes there), and /step/11 still
 * redirects stale bookmarks here. For an unfiled application the register will
 * never hold a quotation — ensureQuotationForIssuedApplication only mints inside
 * SELF_HEAL_STATUSES (apps/backend/services/quotation-issuance-on-submit.js),
 * which is built from the payable states — so the "ระบบกำลังออกใบเสนอราคา" copy
 * named an act the platform is not performing, and รีเฟรช could not change the
 * answer once, ever.
 *
 * The same door the sibling success step asks, classified by the same shared
 * function, so the two screens cannot disagree about what counts as filed. Only
 * a status positively read may take the issuing copy away: a failed request, or
 * a body with no status in it, is ignorance and not evidence that nothing was
 * filed.
 */
async function readSubmissionClaim(applicationId: string): Promise<SubmissionClaim> {
  try {
    const response = await apiClient.get<{ status?: string }>(
      `/applications/${encodeURIComponent(applicationId)}`,
    );
    const status = typeof response.data?.status === 'string' ? response.data.status.trim() : '';
    if (!response.success || !status) { return LOOKUP_FAILED; }
    return submissionClaim({ applicationId, status });
  } catch {
    return LOOKUP_FAILED;
  }
}

/* ================================================================
   StepInvoice — ใบเสนอราคา (Payment step, slot 10)

   UX consolidation (2026-05-16): the previous wizard split this into
   two adjacent steps — Step 10 (quote-step) and Step 11 (invoice-step).
   Both pulled identical applicant context, both showed essentially the
   same fee table with one acknowledge checkbox each, and both forced
   the user to click "next" between them with no new decision to make.
   The 5-agent UX audit flagged this as a primary contributor to the
   "where am I" dropout pattern; this step merges them into a single
   payment screen.

   F-G4-64 (2026-08-28) — what this screen shows and what the tick means:

   Until now the screen INVENTED the document it asked about. The number
   came from generateDocumentNumber ("G-01-DDMMYY-nnnn"), which no register
   ever held; the amounts came from the live fee constants with quantity
   pinned to 1, so a one-scope applicant was shown 30,000 for a bill of
   35,310 and a three-scope applicant was shown the same 30,000 for
   105,930; and the tick was written to browser state (`dtamQuote`), which
   has no server-side reader anywhere. Four applicants were told they had
   accepted a document that did not exist.

   It now renders the QT-PRD- row the register holds and the tick IS the
   acceptance: it POSTs, and the screen believes the row that comes back,
   not the checkbox. The Phase-1 invoice is created server-side by the
   button below (POST /payments/phase1/:id), which is why no invoice
   document is drawn here any more: this screen had been printing a
   "GI-02-" invoice number that no invoice carried either.

   EVERY row, with one tick each. A pre-W14 application carries a DTAM row
   as well as the PLATFORM one, and services/billing/quotation-gate.js
   refuses to create a payment until every row it holds is accepted; a
   screen that opened the next step on one of them walked the applicant
   into a QUOTATION_NOT_ACCEPTED refusal on both rails.

   The vacant slot 11 is preserved in URL space — a static redirect at
   /step/11/page.tsx forwards stale bookmarks here.
   ================================================================ */

export function StepInvoice() {
  const router = useRouter();
  const { state } = useApplicationFlowStore();

  const [isProcessing, setIsProcessing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const applicationId = state.applicationId;

  /*
    Every row the application holds, not just one. services/billing/quotation-gate.js
    refuses unless EVERY quotation is accepted, so a screen that opened the next
    step on one accepted row sent a pre-W14 applicant (DTAM row + PLATFORM row)
    straight into a QUOTATION_NOT_ACCEPTED refusal on both rails.
  */
  const [quotations, setQuotations] = useState<QuotationsBySide | null>(null);
  const [loadingQuotation, setLoadingQuotation] = useState(true);
  // `null` from getQuotations = the lookup itself failed. That is not the same
  // fact as "no quotation issued", and this screen must not tell it as if it
  // were: it cannot know, from a 500, that anything is being issued.
  const [lookupFailed, setLookupFailed] = useState(false);
  const [acceptingIssuer, setAcceptingIssuer] = useState<QuotationIssuerType | null>(null);
  // Only consulted when the register holds NO row: that is the one state whose
  // copy depends on whether the application was ever filed.
  const [claim, setClaim] = useState<SubmissionClaim | null>(null);

  const loadQuotation = useCallback(async () => {
    if (!applicationId) {
      setLoadingQuotation(false);
      return;
    }
    setLoadingQuotation(true);
    const answer = await PaymentService.getQuotations(applicationId);
    setLookupFailed(answer === null);
    setQuotations(answer);
    const registerHoldsNone = answer !== null && !answer.dtam && !answer.platform;
    setClaim(registerHoldsNone ? await readSubmissionClaim(applicationId) : null);
    setLoadingQuotation(false);
  }, [applicationId]);

  useEffect(() => {
    void loadQuotation();
  }, [loadQuotation]);

  /*
    The payer block and the signatory are the SERVER's (GET
    /applications/:id/quotations `payer` + `signatory`, built by
    apps/backend/utils/applicant-resolver.js and the issuer config the PDF uses;
    operator rule 2026-09-27). This screen used to build them from wizard state:
    falling back to the wizard's national-ID field printed an individual's own ID under a tax-id
    label (the audit ledger L-089), a community enterprise's registration number was
    never shown (L-090), and the signatory was one hardcoded person (L-091).
  */
  const payer = quotations?.payer ?? null;
  const signatory = quotations?.signatory ?? null;
  // The issuer header and the document wording, from the same backend helpers
  // the quotation PDF prints (fix/web-quotation-truth, 2026-09-28): the screen
  // used to print the retired ministry header and "พืชกัญชา" on every filing.
  const issuer = quotations?.issuer ?? null;
  const copy = quotations?.copy ?? null;
  const services = quotationServicesOrFallback(copy?.services);

  const rows = useMemo<QuotationRecord[]>(
    () =>
      [quotations?.dtam, quotations?.platform].filter(
        (row): row is QuotationRecord => Boolean(row),
      ),
    [quotations],
  );

  // The same rule the backend gate applies, through the same helper the payments
  // page uses: every row accepted, and holding none is not "accepted" either.
  const canProceed = isQuotationAcceptedForPayment(quotations) && Boolean(applicationId);

  /*
    Fix round 1 (reviewer MINOR ×2). Two facts the guidance under the disabled
    button and the notice on a lapsed card both need:

    - is there a tick to press at all? R21 draws none for a lapsed row, so
      "กรุณาติ๊กยอมรับใบเสนอราคาด้านบนก่อน" named a control that is not on the
      screen;
    - does the platform really issue a replacement? Only for a single live row
      (_lapsedOfferToReplace, services/quotation-issuance-on-submit.js), so a
      pre-W14 pair must not be promised one.

    'elsewhere' because this is the wizard, not the payments list: the page that
    performs the replacement is the one the sentence has to name.
  */
  const somethingToAccept = rows.some((row) => isQuotationAcceptable(row));
  const somethingLapsed = rows.some((row) => isQuotationLapsed(row));
  const lapsedNotice = quotationLapsedNoticeTh(quotations, 'elsewhere');
  const quotationNumbers = rows.map((row) => row.quotationNumber).join(' และ ');

  /**
   * The tick IS the acceptance: it posts, and the screen believes the row that
   * comes back, not the checkbox. A tick that only set local state is how this
   * screen came to tell four applicants they had accepted a document the
   * register never held (F-G4-64).
   */
  const handleAccept = async (row: QuotationRecord) => {
    if (!applicationId || acceptingIssuer) { return; }
    setAcceptingIssuer(row.issuerType);
    setLocalError(null);
    const result = await PaymentService.acceptQuotation(applicationId, row.issuerType);
    if (result.ok) {
      setQuotations((current) => (current ? withAcceptedRow(current, result.row) : current));
    } else {
      // Final round R20 — which refusal it was, with the number that identifies
      // the document. "Try again" was the answer to all three, and two of them
      // can never succeed on a retry.
      setLocalError(quotationAcceptFailureMessage(result.code, row.quotationNumber));
      if (result.code === 'INVALID_QUOTATION_STATUS') {
        // The register moved on under the screen: re-read it rather than leave
        // the applicant looking at a state that no longer exists.
        await loadQuotation();
      }
    }
    setAcceptingIssuer(null);
  };

  /* ── Payment handler ── */
  const handleOpenPayment = async () => {
    if (!applicationId) {
      setLocalError(
        'ไม่พบรหัสคำขอ กรุณาย้อนกลับไปขั้นตอนยืนยันคำขอ',
      );
      return;
    }

    if (!canProceed) {
      setLocalError('กรุณายอมรับใบเสนอราคาทุกฉบับของคำขอนี้ก่อนชำระเงิน');
      return;
    }

    setLocalError(null);
    setIsProcessing(true);

    try {
      const response = await apiClient.post<PhasePaymentPayload>(
        `/payments/phase1/${applicationId}`,
        {},
      );
      if (!response.success) {
        throw new Error(
          // Fail-closed refusal of the pay door (round 4): name the cause in Thai.
          phase1PaymentRefusalTh(response.code)
            || response.error
            || 'ไม่สามารถสร้างรายการชำระเงินได้',
        );
      }

      // Invoice records are created server-side; the user then proceeds
      // to /health/payments to complete payment.
      router.push(
        `/health/payments?app=${encodeURIComponent(applicationId)}&phase=PHASE_1`,
      );
    } catch (submitError: unknown) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : 'เกิดข้อผิดพลาดในการเปิดหน้าชำระเงิน';
      setLocalError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  /* ── Loading ── */
  if (loadingQuotation) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          กำลังโหลดใบเสนอราคาของคำขอนี้
        </div>
      </div>
    );
  }

  /* ── Render ── */
  return (
    <div className="w-full px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      {/*
        Final round R19 (C12) — the tick IS the acceptance, and when it fails
        focus stays on the (now unchecked) checkbox with the explanation printed
        somewhere above it. Without a live region a screen-reader user was told
        nothing at all. The checkout rail's error block on the same branch
        already announces itself.
      */}
      {localError ? (
        <div role="alert" className="mb-4 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {localError}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <section className="mb-8" aria-label="ใบเสนอราคา">
          <h3 className="mb-3 text-sm font-bold text-muted-foreground" data-print-hide="true">
            ใบเสนอราคาของคำขอนี้
          </h3>

          {rows.map((row) => {
            const documentLines = toDocumentLines(row, services);
            const vatBreakdown = docVatBreakdown(row);
            const totalAmount = Number(row.totalAmount);
            const rowAccepted = isQuotationAccepted(row);
            // Is there still an accept to be made on this row? Through the same
            // predicate the payments entry uses, which mirrors
            // markQuotationAccepted's own guard — DRAFT / PENDING / SENT, and
            // since the final round (R1/R21) the validity window as well.
            const rowAcceptable = isQuotationAcceptable(row);
            const rowLapsed = isQuotationLapsed(row);
            return (
              <article key={row.id} className="mb-8 last:mb-0">
                {/*
                  Ruling 12 — the number of lines on the document comes from the
                  row's own scopeCount, so a form revised after the quotation was
                  priced leaves the two disagreeing. The screen says so instead of
                  printing a document that looks current, and names the party to
                  ask, with the number that identifies this document to them.

                  Review r2 minor 4: it no longer promises a NEW document. No
                  staff surface can void and re-issue a quotation — there is no
                  quotation route under routes/api/admin or routes/api/provider,
                  and no provider screen for one — so "contact staff to have a
                  new quotation issued" named a function nobody has.
                */}
                {row.scopeMismatch ? (
                  <div
                    role="status"
                    className="mb-3 rounded-lg border border-border bg-card p-4 text-sm text-foreground"
                    data-print-hide="true"
                  >
                    ใบเสนอราคาฉบับนี้ออกตามจำนวนรูปแบบการปลูกที่คำขอระบุไว้ในวันที่ออกใบ
                    ซึ่งต่างจากที่คำขอระบุอยู่ตอนนี้ ยอดในเอกสารจึงเป็นยอดที่ตรึงไว้ ณ วันออกใบ
                    หากต้องการให้ตรงกับคำขอปัจจุบัน กรุณาติดต่อเจ้าหน้าที่
                    พร้อมแจ้งเลขที่เอกสาร {row.quotationNumber}
                  </div>
                ) : null}

                {/*
                  Final round R21 — the document prints the deadline it really
                  carries: the actual `validUntil` date the row holds (7
                  วันทำการ นับจากวันที่ออก, operator ruling re-confirmed
                  2026-09-27), never a hardcoded day count. Past that date the
                  acceptance door refuses this document (QUOTATION_EXPIRED).
                */}
                <QuotationDocument
                  quotationNumber={row.quotationNumber}
                  quotationDate={formatThaiDate(row.createdAt, THAI_LONG_DATE)}
                  {...(row.validUntil
                    ? { validUntil: formatThaiDate(row.validUntil, THAI_LONG_DATE) }
                    : {})}
                  {...(applicationId !== undefined ? { applicationId } : {})}
                  payer={payer}
                  signatory={signatory}
                  issuer={issuer}
                  copy={copy}
                  items={documentLines}
                  serviceNotes={[services.PHASE_1, services.PHASE_2]
                    .filter((service): service is FeeService => Boolean(service))
                    .map((service) => ({ name: service.name, coverage: service.coverage }))}
                  {...(services.VAT ? { vatLabel: services.VAT.name } : {})}
                  {...(vatBreakdown ? { subtotal: vatBreakdown.subtotal, vat: vatBreakdown.vat } : {})}
                  totalAmount={totalAmount}
                  totalAmountText={numberToThaiText(totalAmount)}
                />

                {/*
                  One tick per document, and it names the document it is about:
                  the acknowledgment is the acceptance of record, so it may not
                  point at an ใบแจ้งหนี้ (this screen stopped drawing one) nor at
                  "the quotation" when two are on the page.

                  Fix round 2 (review r1 minor 3): the tick is drawn only while
                  the accept step is still open. On an EXPIRED or REJECTED row it
                  used to render enabled, the POST answered 409, and the screen
                  told the applicant to try again — a retry that could never
                  succeed. That is the same defect the payments entry had removed
                  one block higher; the party who can move such a row on is staff.
                */}
                {rowAccepted || rowAcceptable ? (
                  <label
                    className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm text-foreground"
                    data-print-hide="true"
                  >
                    <input
                      type="checkbox"
                      checked={rowAccepted}
                      disabled={rowAccepted || acceptingIssuer !== null}
                      onChange={() => void handleAccept(row)}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <span>
                      ข้าพเจ้ารับทราบและยอมรับใบเสนอราคาเลขที่ {row.quotationNumber}{' '}
                      และยืนยันจำนวนเงินตามใบเสนอราคาข้างต้น
                    </span>
                  </label>
                ) : rowLapsed ? (
                  /*
                    Final round R21 — the offer window closed on a row nobody
                    accepted, so markQuotationAccepted refuses it
                    (QUOTATION_EXPIRED) and no tick may be drawn. The remedy is
                    the platform's own and it happens on the payments list: the
                    GET there retires the lapsed row and issues a replacement
                    (services/quotation-issuance-on-submit.js). No staff surface
                    can issue a quotation (ledger F-G4-71), so none is named.
                  */
                  <div
                    role="status"
                    className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-foreground"
                    data-print-hide="true"
                  >
                    {lapsedNotice}
                  </div>
                ) : (
                  <div
                    role="status"
                    className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-foreground"
                    data-print-hide="true"
                  >
                    ใบเสนอราคาฉบับนี้ไม่สามารถกดยอมรับได้แล้ว
                    กรุณาติดต่อเจ้าหน้าที่ พร้อมแจ้งเลขที่เอกสาร {row.quotationNumber}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ) : !applicationId ? (
        /*
          Review r2 minor 2 — the wizard draft carries no applicationId at all: a
          stale bookmark to /step/10 (or the /step/11 redirect) in a fresh
          session. loadQuotation returns early in that state, so the screen used
          to fall through to "the platform is issuing your quotation" beside a
          รีเฟรช button whose handler hits the same early return — pressed
          forever, no request made, nothing changing.

          Nothing here can be repaired from this screen, and no refresh can
          reach a document that has no application to belong to. Name the cause
          and the step that holds the id, which is the same door the back button
          of this screen already goes to.
        */
        <section className="mb-8 rounded-2xl border border-border bg-card p-6 text-sm">
          <p className="font-semibold text-foreground">ไม่พบรหัสคำขอ</p>
          <p className="mt-1 text-muted-foreground">
            ไม่พบรหัสคำขอ กรุณาย้อนกลับไปขั้นตอนยืนยันคำขอ
            แล้วเข้าสู่ขั้นตอนนี้อีกครั้ง ระบบจึงจะดึงใบเสนอราคาของคำขอคุณได้
          </p>
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            href="/health/applications/new/step/9"
          >
            ไปขั้นตอนยืนยันคำขอ
          </Button>
        </section>
      ) : lookupFailed ? (
        /*
          The request failed, so this screen does not know what the register
          holds. It may not say a document is on its way; what it can say is that
          it could not check, and which button asks again.
        */
        <section className="mb-8 rounded-2xl border border-border bg-card p-6 text-sm">
          <p className="font-semibold text-foreground">ตรวจสอบใบเสนอราคาไม่สำเร็จ</p>
          <p className="mt-1 text-muted-foreground">
            ระบบยังไม่ทราบสถานะใบเสนอราคาของคำขอนี้ กรุณากดปุ่มรีเฟรชอีกครั้ง
            หากยังไม่สำเร็จ กรุณาติดต่อเจ้าหน้าที่
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void loadQuotation()}
          >
            รีเฟรช
          </Button>
        </section>
      ) : claim?.kind === 'not-submitted' && applicationId ? (
        /*
          No row, and the application has not been filed. Nothing is being issued
          and nothing will be until it is, so this state names the real cause and
          the door that changes it: the preview page is where the wizard files a
          draft (preview/client-view.tsx posts /applications/submit, then creates
          the phase-1 payment).
        */
        <section className="mb-8 rounded-2xl border border-border bg-card p-6 text-sm">
          <p className="font-semibold text-foreground">คำขอนี้ยังไม่ได้ยื่น</p>
          <p className="mt-1 text-muted-foreground">
            ระบบจะออกใบเสนอราคาให้หลังจากยื่นคำขอแล้ว
            กรุณาไปที่หน้าตรวจสอบคำขอเพื่อยื่นคำขอและสร้างรายการชำระ{SERVICE_NAME.PHASE_1}
            จากนั้นใบเสนอราคาจะปรากฏที่ขั้นตอนนี้
          </p>
          <Button
            variant="primary"
            size="sm"
            className="mt-3"
            href={`/health/applications/preview?id=${encodeURIComponent(applicationId)}`}
          >
            ไปหน้าตรวจสอบคำขอ
          </Button>
        </section>
      ) : (
        /*
          No row yet. GET /api/applications/:id/quotations re-issues, once and
          idempotently, for an application past DRAFT that has none
          (services/quotation-issuance-on-submit.js), so pressing รีเฟรช is a
          step that can change the outcome. This is the button the
          QUOTATION_NOT_ISSUED copy refers to (coordinator ruling 8).
        */
        <section className="mb-8 rounded-2xl border border-border bg-card p-6 text-sm">
          <p className="font-semibold text-foreground">ระบบกำลังออกใบเสนอราคาของคำขอนี้</p>
          <p className="mt-1 text-muted-foreground">
            ใบเสนอราคาจะปรากฏภายในไม่กี่วินาที กดปุ่มรีเฟรชเพื่อตรวจสอบอีกครั้ง
            หากยังไม่ปรากฏหลังจากรอสักครู่ กรุณาติดต่อเจ้าหน้าที่
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void loadQuotation()}
          >
            รีเฟรช
          </Button>
        </section>
      )}

      {/* Note + Navigation — hidden on print */}
      <div className="mt-6 space-y-4" data-print-hide="true">
        {/* There used to be a "ส่งคำขอโดยยังไม่ชำระ" button here. It called
            nothing — its whole implementation was a router.push to the success
            screen — while the copy beside it said "คำขอจะถูกบันทึก". A farmer
            who pressed it was congratulated on filing an application that did
            not exist, and given an application number taken from their own
            browser's draft state.

            Review r2 minor 1: the replacement sentence renders only beside a
            document, and says what the button really does. The button is
            enabled only when canProceed is true, which needs an accepted
            quotation, which only exists for an application already past DRAFT —
            so it cannot be the act of filing anything. It posts to
            /payments/phase1 and opens the payment list of an application that
            was filed on the preview screen. Rendered unconditionally, it sat
            four lines under "คำขอนี้ยังไม่ได้ยื่น" and named a second, dead door
            for the same act. */}
        {rows.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {/* fix/web-quotation-truth (2026-09-28): this used to say a finance
                officer checks the payment evidence before document review. No
                person checks a payment: only the verified provider webhook
                settles it and the receipt is issued automatically. Both facts
                read from constants/service-facts.ts. */}
            กดปุ่มด้านล่างเพื่อไปหน้ารายการชำระเงินของคำขอที่ยื่นไว้แล้ว{' '}
            {ONLINE_PAYMENT_STEP_TH} {RECEIPT_TH}{' '}
            คำขอจะเข้าสู่ขั้นตอนตรวจเอกสารหลังระบบยืนยันการชำระ{SERVICE_NAME.PHASE_1}แล้ว
          </p>
        ) : null}

        {/*
          Final round R22 (finding S19) — why the button below is greyed out.
          This sentence used to render only when the application carried MORE
          than one document, so the ordinary post-W14 applicant (one PLATFORM
          row) saw a disabled "ไปหน้าชำระเงิน" at 45% opacity, out of the tab
          order, with no stated cause: the message naming it was set inside
          handleOpenPayment, which a disabled button can never call. It points
          at the tick above, which is the control that clears it.
        */}
        {rows.length > 0 && !canProceed ? (
          <p
            role="status"
            data-testid="invoice-step-accept-guidance"
            className="text-sm text-muted-foreground"
          >
            {/*
              Fix round 1 (reviewer MINOR) — the sentence may only ask for an
              act the screen offers. It asked for a tick even where R21 draws
              none (a lapsed row), so the applicant read "กรุณาติ๊ก…" four lines
              under a card that deliberately has no checkbox. Each branch below
              names the cause and a door that exists.
            */}
            {somethingToAccept
              ? (rows.length > 1
                ? `คำขอนี้มีใบเสนอราคา ${rows.length} ฉบับ กรุณาติ๊กยอมรับใบเสนอราคาให้ครบทุกฉบับด้านบน ปุ่มไปหน้าชำระเงินจึงจะกดได้`
                : 'กรุณาติ๊กยอมรับใบเสนอราคาด้านบนก่อน ปุ่มไปหน้าชำระเงินจึงจะกดได้')
              : somethingLapsed
                ? `ปุ่มไปหน้าชำระเงินยังกดไม่ได้ เพราะ${lapsedNotice}`
                : `ปุ่มไปหน้าชำระเงินยังกดไม่ได้ เพราะใบเสนอราคาของคำขอนี้ไม่สามารถกดยอมรับได้แล้ว กรุณาติดต่อเจ้าหน้าที่ พร้อมแจ้งเลขที่เอกสาร ${quotationNumbers}`}
          </p>
        ) : null}

        <ApplicationNavigation
          onBack={() =>
            router.push('/health/applications/new/step/9')
          }
          onNext={() => void handleOpenPayment()}
          isNextDisabled={
            DEMO_MODE ? false : !canProceed || isProcessing
          }
          backLabel="ย้อนกลับ"
          nextLabel={
            isProcessing
              ? 'กำลังเปิดหน้าชำระเงิน...'
              : 'ไปหน้าชำระเงิน'
          }
        />
      </div>

      <style jsx global>{`
                @page {
                    size: A4;
                    margin: 12mm;
                }
                @media print {
                    body {
                        background: #fff !important;
                    }
                    [data-print-hide='true'] {
                        display: none !important;
                    }
                }
            `}</style>
    </div>
  );
}

export default StepInvoice;
