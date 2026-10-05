'use client';

/**
 * PaymentInvoiceCard — one card per invoice on the applicant payment
 * screen, always full-width (TwoCardPaymentSection stacks one per invoice).
 * One issuer, one service fee (operator 2026-09-11): the retired state-fee
 * card and the two-card side-by-side pair are gone.
 *
 * The card is informational: it shows the invoice amount, VAT breakdown
 * and (once issued) the receipt number. Payment is settled online through
 * the page-level checkout flow (Stripe), not by this card.
 *
 * CHECKOUT (F-G4-48): the checkout rail's single milestone invoice
 * (CERTIFICATION_CHECKOUT_M1 / _M2) also renders through this card. Its
 * amounts come from the invoice's own line items.
 */

import { useMemo } from 'react';
import { PAYEE_TH } from '@/constants/service-facts';
import {
  LEGACY_STATE_FEE_LABEL_TH,
  RECEIPT_ISSUED_LABEL_TH,
  invoiceHasReceipt,
  receiptDocumentLabelTH,
  type PaymentRecord,
  invoiceVatSplit,
} from '@/lib/services/payment-service';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
  }).format(value || 0);
}

interface PaymentInvoiceCardProps {
  invoice: PaymentRecord;
  /**
   * O3 (2026-09-30): the application NUMBER this invoice bills. A company workspace
   * lists invoices of several applications, and a card that did not say which one was
   * indistinguishable from its neighbour. Omitted or unknown: the line is not drawn
   * (never the UUID in its place).
   */
  applicationNumber?: string | null;
  onViewDetail?: (invoice: PaymentRecord) => void;
}

export default function PaymentInvoiceCard({
  invoice,
  applicationNumber,
  onViewDetail,
}: PaymentInvoiceCardProps) {
  // O3: the invoice number was only in the detail modal. `documentNumber` falls back to
  // the row id when the read carries no number; an id is not a number to quote.
  const invoiceNumber = invoice.documentNumber && invoice.documentNumber !== invoice.id
    ? invoice.documentNumber
    : null;
  const isPlatformSide = invoice.component === 'PLATFORM';
  const isCheckout = invoice.component === 'CHECKOUT';
  // Fix round 1 (2026-09-26, controller decision): a LEGACY row minted before
  // the 2026-09-11 one-ค่าบริการ ruling. Real, still surfaced today by
  // phase-billing-service.js flattenRequiredInvoices for pre-ruling
  // settlements (~22 on record) — not a shape any new invoice can produce.
  // Rendered truthfully and minimally: its own label, no VAT line (the state
  // fee was VAT-exempt, ป.รัษฎากร ม.77/1(10)), no company-issuer claim. The
  // total stays exactly the stored amount either way.
  const isLegacyState = invoice.component === 'STATE';

  // VAT/breakdown for the card: the invoice row's own subtotal and VAT (round 5).
  // It used to be `total / 1.07 * 0.07`, a typed rate applied to the total;
  // without the row's split the card shows the total alone.
  const breakdown = useMemo(
    () => invoiceVatSplit(invoice),
    [invoice],
  );

  // Card surfaces are theme tokens (M7, 2026-10-02). The violet-50/100/200 palette
  // had no dark value, so in dark mode the header stayed a light slab on a dark card
  // (O3 view-pack). muted / border / leaf-soft each carry a value in :root and .dark
  // (themed-surface-tokens probe).
  const palette = {
    accent: 'border-border',
    header: 'bg-muted text-foreground',
    icon: 'bg-leaf-soft text-leaf-onSoft',
  };

  const cardTitle = isLegacyState
    ? LEGACY_STATE_FEE_LABEL_TH
    : isPlatformSide
      ? 'ค่าบริการแพลตฟอร์ม'
      : isCheckout
        // round 5: the catalogue name of the service this row bills (server `service`,
        // renewal-aware) — "ค่าบริการรับรอง" stood here, a name no catalogue holds.
        ? (invoice.service?.name ?? 'ค่าบริการ')
        : 'ใบแจ้งหนี้';
  const cardSubtitle = isLegacyState
    // No company-issuer claim: this was a VAT-exempt government receipt, not
    // a document the company issued (controller decision, fix round 1).
    ? ''
    : isCheckout
      // Said "ชำระผ่านระบบออนไลน์", which no screen can do yet (operator
      // decision 6, audit UXUI-X01). What the card can state is the payee (W14).
      ? (invoice.service?.key === 'RENEWAL'
        ? `ใบแจ้งหนี้ใบเดียว ชำระให้${PAYEE_TH}`
        : `ใบแจ้งหนี้ใบเดียวของงวดนี้ ชำระให้${PAYEE_TH}`)
      : 'บริษัท Predictive AI Solution Co., Ltd.';

  // The checkout invoice is minted with its own three-line itemization
  // (department fee, platform fee, VAT). Show those lines rather than
  // re-deriving VAT from the total: the invoice is the record.
  const checkoutLineItems = isCheckout && invoice.lineItems && invoice.lineItems.length > 0
    ? invoice.lineItems
    : null;

  // Status chip (F-G4-53): a paid invoice whose receipt exists says so, and
  // the card quotes the receipt number. Same label as the table / detail
  // modal on /health/payments (RECEIPT_ISSUED_LABEL_TH), same tone as paid.
  const hasReceipt = invoiceHasReceipt(invoice);
  const isSettled = hasReceipt || Boolean(invoice.isPaid);
  const statusLabel = hasReceipt
    ? RECEIPT_ISSUED_LABEL_TH
    : invoice.isPaid
      ? 'ชำระแล้ว'
      : 'รอชำระ';
  // The state-side (DTAM) receipt is a plain receipt: the department is
  // VAT-exempt and issues no tax invoice. The company's receipt is both.
  // Named in payment-service so the detail modal says the same words.
  const receiptDocumentLabel = receiptDocumentLabelTH(invoice);

  return (
    <article
      data-testid={`payment-invoice-card-${invoice.component || 'UNKNOWN'}`}
      className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_18px_38px_-28px_rgba(15,23,42,0.4)] ${palette.accent}`}
    >
      <header className={`flex items-start justify-between gap-3 px-5 py-4 ${palette.header}`}>
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold ${palette.icon}`}
            aria-hidden="true"
          >
            PRD
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">{cardTitle}</h3>
            <p className="mt-0.5 text-xs opacity-80">{cardSubtitle}</p>
            {/* round 5: what the service covers, in the server's catalogue words */}
            {isCheckout && invoice.service?.coverage ? (
              <p className="mt-1 text-xs text-muted-foreground">{invoice.service.coverage}</p>
            ) : null}
          </div>
        </div>
        <span
          data-testid="payment-invoice-status"
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            isSettled ? 'bg-leaf-soft text-leaf-onSoft' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {statusLabel}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        {/* Amount block — always visible. */}
        <section aria-label="ยอดชำระ">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            ยอดชำระ
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{formatCurrency(invoice.amount)}</p>
          <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {checkoutLineItems ? (
              checkoutLineItems.map((item) => (
                <div key={item.lineNumber} className="flex justify-between gap-3">
                  <dt>{item.description}</dt>
                  <dd className="whitespace-nowrap font-medium tabular-nums">{formatCurrency(item.amount)}</dd>
                </div>
              ))
            ) : isLegacyState || !breakdown ? null : (
              <>
                <div className="flex justify-between">
                  <dt>ค่าบริการ</dt>
                  <dd className="font-medium tabular-nums">{formatCurrency(breakdown.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>ภาษีมูลค่าเพิ่ม</dt>
                  <dd className="font-medium tabular-nums">{formatCurrency(breakdown.vat)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between text-foreground">
              <dt className="font-semibold">รวม</dt>
              <dd className="font-semibold tabular-nums">{formatCurrency(invoice.amount)}</dd>
            </div>
          </dl>
          {/* O3: which invoice, of which application — quotable without opening the modal. */}
          {invoiceNumber ? (
            <p data-testid="payment-invoice-number" className="mt-3 text-xs text-muted-foreground">
              ใบแจ้งหนี้เลขที่{' '}
              <code className="font-mono text-foreground">{invoiceNumber}</code>
            </p>
          ) : null}
          {applicationNumber ? (
            <p data-testid="payment-invoice-application-number" className="mt-1 text-xs text-muted-foreground">
              คำขอเลขที่{' '}
              <code className="font-mono text-foreground">{applicationNumber}</code>
            </p>
          ) : null}
          {/* Receipt number, once issued, so the applicant can quote it. */}
          {invoice.receiptNumber ? (
            <p
              data-testid="payment-invoice-receipt-number"
              className="mt-2 text-xs text-muted-foreground"
            >
              {receiptDocumentLabel}{' '}
              <code className="font-mono text-foreground">{invoice.receiptNumber}</code>
            </p>
          ) : null}
        </section>
      </div>

      {onViewDetail ? (
        // Tokens, not slate-*: the slate classes have no dark value while text-foreground
        // flips to near-white, so in dark mode "ดูรายละเอียด" was white on white
        // (seen in the O3 view-pack, 2026-09-30).
        <footer className="flex flex-col gap-2 border-t border-border bg-muted/40 px-5 py-3 sm:flex-row">
          <button
            type="button"
            onClick={() => onViewDetail(invoice)}
            className="flex-1 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted/70"
          >
            ดูรายละเอียด
          </button>
        </footer>
      ) : null}
    </article>
  );
}
