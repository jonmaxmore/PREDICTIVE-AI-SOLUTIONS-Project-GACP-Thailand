'use client';

/**
 * TwoCardPaymentSection — renders every invoice for a single phase as its
 * own full-width `PaymentInvoiceCard`, stacked vertically.
 *
 * One service fee, one issuer, one transfer (operator 2026-09-11: no
 * state-fee/platform-fee split, the whole charge is ค่าบริการ paid to the
 * company). There is no side-by-side pair, no "missing side" placeholder,
 * and no two-transfer footnote — those described a two-money-flow model
 * this platform no longer has.
 */

import type { PaymentRecord } from '@/lib/services/payment-service';
import { PHASE_DUE_COPY_TH, type PhaseDueState } from '@/app/health/payments/phase-due-state';
import PaymentInvoiceCard from './PaymentInvoiceCard';

/**
 * How each due state is drawn. Emphasis carries the meaning as well as hue: the one
 * instalment that can be paid today is the only SOLID chip on the page, so it still
 * reads as the odd one out without relying on colour vision. Every class here is a
 * design-system token with a value in both themes (src/styles/globals.css) — a raw
 * palette colour would be a light-mode-only decision, which is how themed text landed
 * on a near-white ground once already (globals.css:99-107).
 */
const DUE_CHIP_CLASS: Readonly<Record<PhaseDueState, string>> = Object.freeze({
  DUE_NOW: 'bg-primary text-primary-foreground',
  SETTLED: 'bg-leaf-soft text-leaf-onSoft',
  NOT_YET: 'bg-muted text-muted-foreground',
  UNKNOWN: 'border border-border bg-card text-muted-foreground',
});

interface TwoCardPaymentSectionProps {
  phaseLabel: string;
  phaseDescription?: string;
  invoices: PaymentRecord[];
  /**
   * Whether this instalment is collectable today — decided by the page from the
   * filing's own status (phase-due-state.ts), not guessed here from the invoices.
   * Omitted, the section draws as it always did: the caller has made no claim, so
   * neither does the header.
   */
  dueState?: PhaseDueState;
  /**
   * O3 (staging walk 2026-09-30): the application these invoices bill. The page draws
   * one section per application × phase, so the "ยอดรวมงวด" below is one application's
   * instalment — it used to sum two applications' invoices under one "งวดที่ 1".
   */
  applicationId?: string | null;
  applicationNumber?: string | null;
  onViewDetail?: (invoice: PaymentRecord) => void;
}

export default function TwoCardPaymentSection({
  phaseLabel,
  phaseDescription,
  invoices,
  dueState,
  applicationId,
  applicationNumber,
  onViewDetail,
}: TwoCardPaymentSectionProps) {
  // Combined totals for the section header so the applicant sees the
  // round-figure total even though it is billed as two amounts.
  const total = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);

  return (
    <section
      data-testid={`two-card-phase-${phaseLabel}`}
      data-application-id={applicationId ?? undefined}
      className="rounded-2xl bg-card p-4 shadow-[0_16px_36px_-26px_rgba(15,23,42,0.35)] sm:p-5"
    >
      <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{phaseLabel}</h2>
            {/*
              operator, 2026-09-10: "ไม่รู้จ่ายบิลไหนตอนไหน". Two instalments drawn as
              two equal cards, both with a total, said nothing about which one the
              system would accept money for today. The chip is that answer, and the
              line under it is the REASON — "not yet" without a why is still a farmer
              guessing. Both sentences come from the rule, so the chip cannot say one
              thing while the pay button does another.
            */}
            {dueState ? (
              <span
                data-testid="phase-due-chip"
                data-due-state={dueState}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${DUE_CHIP_CLASS[dueState]}`}
              >
                {PHASE_DUE_COPY_TH[dueState].label}
              </span>
            ) : null}
          </div>
          {applicationNumber ? (
            <p data-testid="phase-application-number" className="mt-0.5 text-sm text-foreground">
              คำขอเลขที่ <span className="font-mono font-semibold">{applicationNumber}</span>
            </p>
          ) : null}
          {phaseDescription ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{phaseDescription}</p>
          ) : null}
          {dueState ? (
            <p data-testid="phase-due-hint" className="mt-0.5 text-xs text-muted-foreground">
              {PHASE_DUE_COPY_TH[dueState].hint}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          ยอดรวมงวด:{' '}
          <strong data-testid="phase-total" className="text-foreground">
            {new Intl.NumberFormat('th-TH', {
              style: 'currency',
              currency: 'THB',
              minimumFractionDigits: 0,
            }).format(total)}
          </strong>
        </p>
      </header>

      {/* One full-width card per invoice — one issuer, one transfer. */}
      {invoices.length > 0 ? (
        <div data-testid="payment-invoice-stack" className="grid grid-cols-1 gap-4 md:gap-5">
          {invoices.map((inv) => (
            <PaymentInvoiceCard
              key={inv.id}
              invoice={inv}
              applicationNumber={applicationNumber ?? inv.applicationNumber ?? null}
              {...(onViewDetail !== undefined ? { onViewDetail } : {})}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
