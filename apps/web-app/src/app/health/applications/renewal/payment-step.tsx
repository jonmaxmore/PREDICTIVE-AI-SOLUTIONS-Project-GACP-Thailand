"use client";

import { useLanguage } from '@/lib/i18n/language-context';
import { useRenewalFee } from '@/hooks/use-pricing';
import { feesNotice } from '@/lib/pricing/public-fees';
// W12 - the amount keeps the literal ฿ prefix and the shared formatNumber
// helper rather than formatCurrency. src/app/__tests__/currency-never-wraps.test.ts
// guards money against mid-number line breaks by matching the JSX shape of a
// baht sign rendered immediately before an interpolated value;
// formatCurrency emits its own symbol, which renders the same amount but hides
// it from that guard. This element is a live money surface and must stay guarded.
import { formatNumber } from '@/lib/utils';

interface PaymentStepProps {
    renewalId: string | null;
    isDark: boolean;
    onBack: () => void;
    onConfirm: () => void;
}

export function PaymentStep({ renewalId, isDark, onBack, onConfirm }: PaymentStepProps) {
    const { dict } = useLanguage();
    const p = dict.health.renewal.payment;
    const f = dict.health.renewal.fee;
    // W12 — this panel showed the pre-VAT base under the label
    // "จำนวนเงินที่ต้องชำระ". The amount due is fee.payable; the base is kept
    // beside it so the applicant can see where the number comes from.
    // The amount is the served one (GET /api/pricing/fees); without it the
    // panel shows the notice and no number, never a remembered price.
    const { fee, state: feesState } = useRenewalFee();

    return (
        <div className={`min-h-screen p-6 font-sans ${isDark ? 'bg-slate-900' : 'bg-surface-100'}`}>
            <div className="mx-auto max-w-md">
                <button type="button" onClick={onBack} className={`mb-6 inline-flex items-center gap-2 rounded-lg border px-4 py-2 ${isDark ? 'border-slate-700 text-muted-foreground' : 'border-surface-200 text-muted-foreground'}`}>{p.back}</button>

                <h1 className={`mb-2 text-2xl font-semibold ${isDark ? 'text-surface-100' : 'text-foreground'}`}>{p.title}</h1>
                <p className={`mb-6 ${isDark ? 'text-muted-foreground' : 'text-muted-foreground'}`}>{p.subtitle}</p>

                <div className={`rounded-2xl border p-7 ${isDark ? 'border-slate-700 bg-slate-800' : 'border-surface-200 bg-card'}`}>
                    <div className="mb-5 rounded-xl bg-primary-50 p-4 text-center">
                        <p className="mb-1 text-sm text-muted-foreground">{p.amountLabel}</p>
                        {fee ? (
                            <p className="whitespace-nowrap text-3xl font-bold text-primary-600">฿{formatNumber(fee.payable)}</p>
                        ) : (
                            <p className="text-sm text-foreground">{feesNotice(feesState)}</p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">{f.serviceLabel}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{p.perTypeNote}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{f.singleChargeNote}</p>
                    </div>

                    <div className={`mb-6 rounded-lg p-3 text-sm ${isDark ? 'bg-slate-700 text-slate-300' : 'bg-surface-100 text-foreground'}`}>
                        <p className="mb-1"><strong>{p.caseLabel}</strong> {renewalId}</p>
                        <p>{p.helpText}</p>
                    </div>

                    <button type="button" onClick={onConfirm} className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-white shadow-sm">{p.cta}</button>
                </div>
            </div>
        </div>
    );
}
