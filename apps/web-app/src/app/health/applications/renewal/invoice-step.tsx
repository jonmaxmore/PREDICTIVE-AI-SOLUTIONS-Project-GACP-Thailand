"use client";

/**
 * InvoiceStep: the renewal wizard's invoice screen, showing only what the
 * register holds (fix/fees-from-server round 1, 2026-10-03).
 *
 * It used to draw a document the browser made up: `INV-${Date.now()}` as the
 * number, today as its date, today + 7 days as its due date, and the price of
 * ONE cultivation type as "ยอดรวมที่ต้องชำระ" whatever the application held.
 * Now it reads the applicant's invoices (GET /api/invoices/my, the read the
 * payments page uses) and shows this renewal's own invoice: its number, date,
 * total and status. With no invoice yet it prints no document number: it says
 * the invoice is issued at payment, and shows the quotation's own number and
 * total when the register has one (GET /api/applications/:id/quotations).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Certificate } from './types';
import { numberToThaiText } from '@/utils/number-to-thai-text';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber } from '@/lib/utils';
import { formatThaiDate } from '@/lib/format/thai-date';
import {
    PaymentService,
    type PaymentRecord,
    type QuotationRecord,
} from '@/lib/services/payment-service';

interface InvoiceStepProps {
    certificate: Certificate | null;
    renewalId: string | null;
    isDark: boolean;
    onBack: () => void;
    onProceed: () => void;
}

type Lookup =
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'invoice'; invoice: PaymentRecord }
    | { status: 'none'; quotation: QuotationRecord | null };

/** This renewal's live invoice: not cancelled, newest first. */
function pickInvoice(rows: PaymentRecord[], renewalId: string): PaymentRecord | null {
    const mine = rows
        .filter((r) => r.applicationId === renewalId && !r.isCancelled && r.type !== 'QUOTATION')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return mine[0] ?? null;
}

export function InvoiceStep({ certificate, renewalId, isDark, onBack, onProceed }: InvoiceStepProps) {
    const { dict } = useLanguage();
    const inv = dict.health.renewal.invoice;
    const f = dict.health.renewal.fee;
    const [lookup, setLookup] = useState<Lookup>({ status: 'loading' });
    const [downloading, setDownloading] = useState(false);
    const [downloadError, setDownloadError] = useState<string | null>(null);

    // Same door, same failure contract as the payments page
    // (app/health/payments/client-view.tsx handleDownloadInvoice).
    async function handleDownload(record: PaymentRecord) {
        setDownloadError(null);
        setDownloading(true);
        try {
            const ok = await PaymentService.downloadInvoicePdf(record.id, record.documentNumber);
            if (!ok) setDownloadError(inv.downloadFailed.replace('{number}', record.documentNumber));
        } catch {
            setDownloadError(inv.downloadFailed.replace('{number}', record.documentNumber));
        } finally {
            setDownloading(false);
        }
    }

    const load = useCallback(async () => {
        if (!renewalId) {
            setLookup({ status: 'none', quotation: null });
            return;
        }
        setLookup({ status: 'loading' });
        let rows: PaymentRecord[];
        try {
            rows = await PaymentService.getMyPayments();
        } catch {
            setLookup({ status: 'failed' });
            return;
        }
        const invoice = pickInvoice(rows, renewalId);
        if (invoice) {
            setLookup({ status: 'invoice', invoice });
            return;
        }
        // No invoice yet: the quotation is the only server document with a total.
        // A failed quotation read only costs the hint, never invents one.
        const quotations = await PaymentService.getQuotations(renewalId);
        setLookup({ status: 'none', quotation: quotations?.platform ?? quotations?.dtam ?? null });
    }, [renewalId]);

    useEffect(() => {
        void load();
    }, [load]);

    const invoice = lookup.status === 'invoice' ? lookup.invoice : null;
    const total = invoice ? Number(invoice.amount) || 0 : 0;
    const noticeClass = 'mb-6 rounded-xl border border-border bg-card p-5 text-sm text-foreground';
    const actionClass =
        'mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl border-2 border-primary-600 px-4 py-2 text-sm font-semibold text-primary-600 no-underline dark:border-primary-400 dark:text-primary-300';

    if (!invoice) {
        return (
            <div className={`min-h-screen p-6 font-sans ${isDark ? 'bg-slate-900' : 'bg-surface-100'}`}>
                <div className="mx-auto max-w-3xl">
                    <button type="button" onClick={onBack} className={`mb-6 inline-flex items-center gap-2 rounded-lg border px-4 py-2 ${isDark ? 'border-slate-700 text-muted-foreground' : 'border-surface-200 text-muted-foreground'}`}>{inv.back}</button>
                    <h1 className={`mb-5 text-xl font-semibold ${isDark ? 'text-surface-100' : 'text-foreground'}`}>{inv.title}</h1>
                    {lookup.status === 'loading' ? (
                        <div className={noticeClass} role="status">{inv.loadingLabel}</div>
                    ) : lookup.status === 'failed' ? (
                        <div className={noticeClass} role="alert">
                            <p>{inv.lookupFailedBody}</p>
                            <button type="button" onClick={() => void load()} className={actionClass}>{inv.retryCta}</button>
                        </div>
                    ) : (
                        <div className={noticeClass} data-testid="renewal-no-invoice">
                            <p className="font-semibold">{inv.noInvoiceTitle}</p>
                            <p className="mt-1 text-muted-foreground">{inv.noInvoiceBody}</p>
                            {lookup.status === 'none' && lookup.quotation ? (
                                <p className="mt-3">
                                    {inv.quotationTotalLabel.replace('{number}', lookup.quotation.quotationNumber)}{' '}
                                    <strong className="whitespace-nowrap">฿{formatNumber(Number(lookup.quotation.totalAmount) || 0)}</strong>
                                </p>
                            ) : null}
                            {renewalId ? (
                                <Link href={`/health/payments?app=${encodeURIComponent(renewalId)}`} className={actionClass}>{inv.goToPaymentsCta}</Link>
                            ) : null}
                        </div>
                    )}
                    <div className="flex gap-3">
                        <button type="button" onClick={onProceed} className="flex-1 rounded-xl bg-primary py-3.5 text-sm font-semibold text-white shadow-sm">{inv.nextCta}</button>
                    </div>
                </div>
            </div>
        );
    }

    // Round 5 (review IMPORTANT, 2026-10-03): no browser-drawn "document" here.
    // The page used to draw a billing note around the real invoice number, with
    // a header naming the ministry and a "พิมพ์ใบวางบิล" button, so an applicant
    // could print finance paper carrying a real number and the wrong issuer.
    // Finance paper comes only from the backend pipeline (company issuer, logo,
    // payer block): the facts are shown on screen and the paper is the server
    // PDF, through the same door the payments page uses (GET /api/invoices/:id/pdf).
    return (
        <div className={`min-h-screen p-6 font-sans ${isDark ? 'bg-slate-900' : 'bg-surface-100'}`}>
            <div className="mx-auto max-w-3xl">
                <button type="button" onClick={onBack} className={`mb-6 inline-flex items-center gap-2 rounded-lg border px-4 py-2 ${isDark ? 'border-slate-700 text-muted-foreground' : 'border-surface-200 text-muted-foreground'}`}>{inv.back}</button>
                <h1 className={`mb-5 text-xl font-semibold ${isDark ? 'text-surface-100' : 'text-foreground'}`}>{inv.title}</h1>

                <div className="mb-6 rounded-xl border border-border bg-card p-5 text-sm text-foreground" data-testid="renewal-invoice-facts">
                    <dl className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs text-muted-foreground">{inv.docNumber}</dt>
                            <dd className="font-semibold">{invoice.documentNumber}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">{inv.docDate}</dt>
                            <dd>{formatThaiDate(invoice.createdAt)}</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">{inv.grandTotal}</dt>
                            <dd className="whitespace-nowrap text-lg font-bold">฿{formatNumber(total)}</dd>
                            <dd className="text-xs text-muted-foreground">({numberToThaiText(total)})</dd>
                        </div>
                        <div>
                            <dt className="text-xs text-muted-foreground">{inv.statusLabel}</dt>
                            <dd className={`font-semibold ${invoice.isPaid ? 'text-leaf-700 dark:text-primary-300' : 'text-foreground'}`}>{invoice.isPaid ? inv.statusPaid : inv.statusAwaiting}</dd>
                        </div>
                    </dl>
                    {certificate?.certificateNumber ? (
                        <p className="mt-4 text-xs text-muted-foreground">{inv.certLabel} {certificate.certificateNumber}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">{inv.itemRenewal} · {f.serviceLabel}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{f.singleChargeNote}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{inv.methodTransfer}</p>
                    {downloadError ? (
                        <p className="mt-3 text-sm text-foreground" role="alert">{downloadError}</p>
                    ) : null}
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                    <button type="button" onClick={() => void handleDownload(invoice)} disabled={downloading} className="flex-1 rounded-xl border-2 border-primary-600 py-3.5 text-sm font-semibold text-primary-600 disabled:opacity-60 dark:border-primary-400 dark:text-primary-300">
                        {downloading ? inv.downloadingLabel : inv.downloadCta}
                    </button>
                    <button type="button" onClick={onProceed} className="flex-1 rounded-xl bg-primary py-3.5 text-sm font-semibold text-white shadow-sm">{inv.nextCta}</button>
                </div>
            </div>
        </div>
    );
}
