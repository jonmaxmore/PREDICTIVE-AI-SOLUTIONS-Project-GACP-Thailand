'use client';

/**
 * promptpay-pay-step.tsx — the step that takes the payment (operator ruling
 * 2026-09-27: PromptPay only, shown by Stripe's own component).
 *
 * Rendered by client-view.tsx inside the created state, only when the checkout
 * response carries a publishable key. It:
 *
 *   1. loads Stripe.js with the key the BACKEND returned (never a build-time
 *      value) — only when the applicant presses the button;
 *   2. calls stripe.confirmPromptPayPayment(clientSecret, { payment_method:
 *      { billing_details: { email } } }), which opens Stripe's QR modal. Stripe
 *      refuses a PromptPay confirm without the email (measured:
 *      evidence/promptpay-qr-2026-09-27/email-required-probe.txt), so the
 *      button stays disabled until there is a well-formed one;
 *   3. never marks anything paid. Whatever Stripe.js reports, the screen only
 *      says paid once the backend's invoice for THIS order reads paid — and
 *      only the verified webhook writes that (checkout-settlement-service.js,
 *      which also issues the receipt number in the same transaction). It
 *      watches GET /api/invoices/my (PaymentService.getMyPayments), the same
 *      read the payments list uses, and gives up after
 *      SETTLEMENT_WATCH_TIMEOUT_MS with a sentence that says what is known.
 *
 * Our servers never see a payment credential: the QR, the scan and the bank
 * authorisation all happen inside Stripe's frames.
 *
 * Operator ruling 2026-09-27 (review I-2): no user-facing sentence names the
 * payment provider. Code, comments and logs may; the screen says
 * "ผู้ให้บริการรับชำระเงิน".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js/pure';
import type { Stripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/primitives/button';
import { NOT_CHARGED_TH, RECEIPT_TH } from '@/constants/service-facts';
import { PaymentService } from '@/lib/services/payment-service';

/**
 * How often the screen asks whether the webhook has settled the invoice, and
 * for how long. Presentation timing, not business values: the webhook settles
 * the order whether or not this page is still open.
 */
export const SETTLEMENT_POLL_INTERVAL_MS = 3_000;
export const SETTLEMENT_WATCH_TIMEOUT_MS = 180_000;

/** Shape check only (same rule the backend applies before pre-filling). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PAY_WITH_PROMPTPAY_LABEL = 'ชำระด้วย QR พร้อมเพย์';

/**
 * The provider's own statement of what the email is for (docs.stripe.com/
 * payments/promptpay: the customer is contacted at the email given at
 * confirmation to collect refund account details). Nothing beyond that is
 * claimed, and the provider is not named (operator ruling 2026-09-27).
 */
const PAYER_EMAIL_PURPOSE_TH =
  'ผู้ให้บริการรับชำระเงินกำหนดให้ระบุอีเมลของผู้ชำระสำหรับการชำระด้วยพร้อมเพย์ และจะใช้อีเมลนี้ติดต่อคุณเกี่ยวกับการชำระเงินนี้ เช่น กรณีคืนเงิน';

/** Said under a pre-filled address so the payer knows where it came from and may change it (review M-3). */
const PAYER_EMAIL_PREFILLED_TH = 'ระบบกรอกอีเมลติดต่อที่มีอยู่ในบัญชีไว้ให้ แก้ไขได้หากไม่ใช่อีเมลที่ใช้อยู่ปัจจุบัน';

type PayStage = 'ready' | 'opening' | 'waiting' | 'settled' | 'unconfirmed' | 'closed' | 'error';

/** PaymentIntent statuses after which only the webhook can say more. */
const HANDED_TO_WEBHOOK = new Set(['succeeded', 'processing']);

interface PromptPayPayStepProps {
  publishableKey: string;
  /** null when the intent already succeeded: nothing left to confirm (review I-1). */
  clientSecret: string | null;
  /** The status of the intent the backend handed back, when it says (review I-1). */
  paymentIntentStatus?: string | null;
  invoiceId: string | null;
  payerEmail: string | null;
  /**
   * Told once the webhook-settled invoice has been read, so the page around
   * this step stops saying "รอชำระเงิน" (found by the real walk: the heading
   * above the paid panel still said the order was awaiting payment).
   */
  onSettled?: () => void;
}

interface Settlement {
  paid: boolean;
  receiptNumber: string | null;
}

async function readSettlement(invoiceId: string): Promise<Settlement | null> {
  const rows = await PaymentService.getMyPayments();
  const row = rows.find((r) => r.id === invoiceId);
  if (!row) return null;
  return { paid: row.isPaid === true, receiptNumber: row.receiptNumber ?? null };
}

export function PromptPayPayStep({
  publishableKey, clientSecret, paymentIntentStatus, invoiceId, payerEmail, onSettled,
}: PromptPayPayStepProps) {
  // A re-entered order whose intent is already paid, or being paid, has
  // nothing to confirm: go straight to watching for the webhook (review I-1).
  const [stage, setStage] = useState<PayStage>(
    !clientSecret || (paymentIntentStatus && HANDED_TO_WEBHOOK.has(paymentIntentStatus)) ? 'waiting' : 'ready',
  );
  // Pre-filled from the backend, but always editable and always re-validated
  // (review M-3): a stale company address would send the provider's refund
  // contact to the wrong inbox.
  const [typedEmail, setTypedEmail] = useState(payerEmail ?? '');
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);
  const [watchRound, setWatchRound] = useState(0);
  const stripeRef = useRef<Promise<Stripe | null> | null>(null);

  const email = typedEmail.trim();
  const emailUsable = EMAIL_SHAPE.test(email);

  const pay = useCallback(async () => {
    if (!emailUsable || !clientSecret) return;
    setStage('opening');
    try {
      if (!stripeRef.current) stripeRef.current = loadStripe(publishableKey);
      const stripe = await stripeRef.current;
      if (!stripe) {
        stripeRef.current = null;
        setStage('error');
        return;
      }
      // Opens Stripe's QR modal and resolves when it closes.
      const result = await stripe.confirmPromptPayPayment(clientSecret, {
        payment_method: { billing_details: { email } },
      });
      const status = result.error ? result.error.payment_intent?.status : result.paymentIntent?.status;
      if (status && HANDED_TO_WEBHOOK.has(status)) {
        setStage('waiting');
        setWatchRound((n) => n + 1);
        return;
      }
      setStage(result.error ? 'error' : 'closed');
    } catch {
      stripeRef.current = null;
      setStage('error');
    }
  }, [clientSecret, email, emailUsable, publishableKey]);

  // The watch: ask the backend until the webhook's settlement shows on this
  // order's invoice, or the window closes. The client writes nothing.
  useEffect(() => {
    if (stage !== 'waiting') return undefined;
    if (!invoiceId) {
      setStage('unconfirmed');
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const check = async () => {
      let settlement: Settlement | null = null;
      try {
        settlement = await readSettlement(invoiceId);
      } catch {
        settlement = null;
      }
      if (cancelled) return;
      if (settlement?.paid) {
        setReceiptNumber(settlement.receiptNumber);
        setStage('settled');
        onSettled?.();
        return;
      }
      if (Date.now() - startedAt >= SETTLEMENT_WATCH_TIMEOUT_MS) {
        setStage('unconfirmed');
        return;
      }
      timer = setTimeout(() => { void check(); }, SETTLEMENT_POLL_INTERVAL_MS);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [stage, invoiceId, watchRound, onSettled]);

  if (stage === 'settled') {
    return (
      <div
        role="status"
        data-testid="checkout-promptpay-settled"
        className="mt-4 rounded-2xl border border-primary-100 bg-leaf-soft px-4 py-3 text-sm text-leaf-onSoft"
      >
        <p>ระบบได้รับการยืนยันการชำระเงินจากผู้ให้บริการรับชำระเงินแล้ว</p>
        {receiptNumber ? (
          <p className="mt-1">
            ระบบออกใบเสร็จรับเงินเลขที่ <span className="font-mono">{receiptNumber}</span> ให้อัตโนมัติแล้ว
            ดูได้ที่หน้ารายการชำระเงิน
          </p>
        ) : (
          <p className="mt-1">{RECEIPT_TH}</p>
        )}
      </div>
    );
  }

  if (stage === 'waiting') {
    return (
      <p
        role="status"
        data-testid="checkout-promptpay-waiting"
        className="mt-4 rounded-2xl border border-primary-100 bg-muted px-4 py-3 text-sm text-foreground"
      >
        กำลังรอการยืนยันการชำระเงินจากผู้ให้บริการรับชำระเงิน
        การชำระเงินจะถูกบันทึกเข้าระบบก็ต่อเมื่อได้รับการยืนยันจากผู้ให้บริการรับชำระเงิน
        หากปิดหน้านี้ การยืนยันจะบันทึกเข้าระบบเองและดูได้ที่หน้ารายการชำระเงิน
      </p>
    );
  }

  if (stage === 'unconfirmed') {
    return (
      <div
        role="status"
        data-testid="checkout-promptpay-unconfirmed"
        className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
      >
        <p>
          ระบบยังไม่ได้รับการยืนยันจากผู้ให้บริการรับชำระเงิน
          หากคุณสแกนชำระแล้ว ระบบจะบันทึกเองเมื่อได้รับการยืนยัน และดูสถานะได้ที่หน้ารายการชำระเงิน
        </p>
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setStage('waiting');
              setWatchRound((n) => n + 1);
            }}
          >
            ตรวจสอบอีกครั้ง
          </Button>
        </div>
      </div>
    );
  }

  const opening = stage === 'opening';

  return (
    <div className="mt-4 space-y-3" data-testid="checkout-promptpay-step">
      <p className="text-sm text-foreground">
        กดปุ่มด้านล่างเพื่อแสดง QR พร้อมเพย์ของผู้ให้บริการรับชำระเงิน แล้วสแกนด้วยแอปธนาคารของคุณ
        การชำระเงินจะถูกบันทึกเข้าระบบก็ต่อเมื่อได้รับการยืนยันจากผู้ให้บริการรับชำระเงิน
      </p>

      <label className="block text-sm">
        <span className="font-medium text-foreground">อีเมลผู้ชำระ (จำเป็น)</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={typedEmail}
          onChange={(e) => setTypedEmail(e.currentTarget.value)}
          aria-invalid={typedEmail.trim() !== '' && !emailUsable}
          data-testid="checkout-payer-email-input"
          className="mt-1 block w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {payerEmail ? (
          <span className="mt-1 block text-xs text-muted-foreground">{PAYER_EMAIL_PREFILLED_TH}</span>
        ) : null}
        <span className="mt-1 block text-xs text-muted-foreground">{PAYER_EMAIL_PURPOSE_TH}</span>
      </label>

      {stage === 'closed' ? (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          หน้าต่าง QR ถูกปิดก่อนการชำระเงินเสร็จ ยังไม่มีการยืนยันการชำระเงิน กดปุ่มด้านล่างเพื่อแสดง QR อีกครั้ง
        </p>
      ) : null}
      {stage === 'error' ? (
        <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          แสดง QR พร้อมเพย์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังพบปัญหา ตรวจสอบสถานะได้ที่หน้ารายการชำระเงิน
        </p>
      ) : null}
      {stage === 'ready' ? (
        <p className="text-xs text-muted-foreground">{NOT_CHARGED_TH}</p>
      ) : null}

      <Button
        type="button"
        variant="primary"
        size="sm"
        loading={opening}
        disabled={opening || !emailUsable}
        onClick={() => void pay()}
      >
        {PAY_WITH_PROMPTPAY_LABEL}
      </Button>
    </div>
  );
}
