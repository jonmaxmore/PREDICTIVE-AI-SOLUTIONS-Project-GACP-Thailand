"use client";

/**
 * QuotationStep — the renewal wizard's ใบเสนอราคา screen.
 *
 * F-G4-64 final round R23 (finding S13). This screen used to PRINT A DOCUMENT
 * THE BROWSER INVENTED: the number was `QT-${Date.now().toString(36)}`, the
 * validity date was "today + 30 days" computed in the browser, and the figures
 * came from the live fee hook — none of it from the register, and with no
 * accept control anywhere on it. Meanwhile this branch made renewal issue a
 * real `QT-PRD-` row (services/renewal-service.js) and made acceptance of THAT
 * row a precondition for every renewal payment
 * (services/billing/quotation-gate.js).
 *
 * It is the same defect the branch fixed in wizard slot 10: "four applicants
 * were told they had accepted a document that did not exist". So this screen
 * now renders the register's row through the SAME accept surface the payments
 * page uses (components/payments/QuotationReviewSection) — one component, one
 * accept tick, one set of rules about when it may be drawn — and when the
 * register holds no row it names the page that issues and accepts one instead
 * of drawing a document nobody has.
 */

import { useCallback, useEffect, useState } from 'react';
import { Certificate } from './types';
import { useLanguage } from '@/lib/i18n/language-context';
import QuotationReviewSection from '@/components/payments/QuotationReviewSection';
import { PaymentService, type QuotationsBySide } from '@/lib/services/payment-service';

interface QuotationStepProps {
    certificate: Certificate | null;
    renewalId: string | null;
    isDark: boolean;
    onBack: () => void;
    onProceed: () => void;
}

export function QuotationStep({ certificate, renewalId, isDark, onBack, onProceed }: QuotationStepProps) {
    const { dict } = useLanguage();
    const q = dict.health.renewal.quotation;

    /*
      The page owns the fetch and hands the rows down, exactly as
      /health/payments does: GET /api/applications/:id/quotations is also the
      door that re-issues a missing quotation, so two components fetching it
      would race two issuance attempts.

      `null` from getQuotations means the LOOKUP failed — not "the register
      holds none". This screen may not tell the second story on the first fact.
    */
    const [quotations, setQuotations] = useState<QuotationsBySide | null>(null);
    const [loading, setLoading] = useState(true);
    const [lookupFailed, setLookupFailed] = useState(false);

    const load = useCallback(async () => {
        if (!renewalId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const answer = await PaymentService.getQuotations(renewalId);
        setLookupFailed(answer === null);
        setQuotations(answer);
        setLoading(false);
    }, [renewalId]);

    useEffect(() => {
        void load();
    }, [load]);

    const hasRow = Boolean(quotations?.dtam || quotations?.platform);
    const noticeClass = 'rounded-xl border border-border bg-card p-5 text-sm text-foreground';
    const actionClass =
        'mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl border-2 border-primary-600 px-4 py-2 text-sm font-semibold text-primary-600 no-underline';

    return (
        <div className={`min-h-screen p-6 font-sans ${isDark ? 'bg-slate-900' : 'bg-surface-100'}`}>
            <div className="mx-auto max-w-3xl">
                <button
                    type="button"
                    onClick={onBack}
                    className={`mb-6 inline-flex items-center gap-2 rounded-lg border px-4 py-2 ${isDark ? 'border-slate-700 text-muted-foreground' : 'border-surface-200 text-muted-foreground'}`}
                >
                    {q.back}
                </button>
                <h1 className={`mb-2 text-xl font-semibold ${isDark ? 'text-surface-100' : 'text-foreground'}`}>
                    {q.title}
                </h1>
                {/*
                    Who the renewal is for, and against which certificate. The
                    invented document carried this in its own "เรียน / To:" block;
                    the register's card names the document, not the holder, so
                    the two facts stay on the screen here.
                */}
                <p className="mb-1 text-sm font-medium text-foreground">
                    {q.recipient} {certificate?.siteName || q.fallbackRecipient}
                </p>
                <p className="mb-5 text-xs text-muted-foreground">
                    {q.certNumber} {certificate?.certificateNumber || '-'}
                </p>

                {!renewalId ? (
                    <div className={noticeClass}>
                        <p className="font-semibold text-foreground">{q.noRenewalTitle}</p>
                        <p className="mt-1 text-muted-foreground">{q.noRenewalBody}</p>
                    </div>
                ) : loading ? (
                    <p className="text-sm text-muted-foreground">{q.loadingLabel}</p>
                ) : lookupFailed ? (
                    <div className={noticeClass}>
                        <p className="font-semibold text-foreground">{q.lookupFailedTitle}</p>
                        <p className="mt-1 text-muted-foreground">{q.lookupFailedBody}</p>
                        <button type="button" onClick={() => void load()} className={actionClass}>
                            {q.retryCta}
                        </button>
                    </div>
                ) : hasRow ? (
                    /*
                      The register's document, with the accept tick the payments
                      page draws — including its rules about when it may not be
                      drawn at all (accepted, refused, or past validUntil).
                    */
                    <QuotationReviewSection
                        applicationId={renewalId}
                        quotations={quotations}
                        onAccepted={() => void load()}
                        // This screen draws no รีเฟรช button (its controls are
                        // ย้อนกลับ / ถัดไป), so a lapsed offer is explained in the
                        // words of a page that is not the payments list, and it
                        // names that list instead (review r1, minor 1).
                        lapsedSurface="elsewhere"
                    />
                ) : (
                    <div className={noticeClass}>
                        <p className="font-semibold text-foreground">{q.noRowTitle}</p>
                        <p className="mt-1 text-muted-foreground">{q.noRowBody}</p>
                        <a href={`/health/payments?app=${encodeURIComponent(renewalId)}`} className={actionClass}>
                            {q.goToPaymentsCta}
                        </a>
                    </div>
                )}

                <div className="mt-6 flex gap-3">
                    <button
                        type="button"
                        onClick={onProceed}
                        className="flex-1 rounded-xl bg-primary py-3.5 text-sm font-semibold text-white shadow-sm"
                    >
                        {q.nextCta}
                    </button>
                </div>
            </div>
        </div>
    );
}
