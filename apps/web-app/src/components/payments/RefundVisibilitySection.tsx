'use client';

/**
 * RefundVisibilitySection — "การคืนเงิน" panel on /health/payments.
 *
 * Iter 23 scope: when the finance team issues a credit note (ใบลดหนี้)
 * against one of the applicant's invoices, the applicant currently has
 * no in-app way to see the refund — they only see it via email. This
 * panel surfaces every credit note tied to the active application's
 * invoices, with the reason, amount, status pill, and a "ติดต่อ
 * ทีมการเงิน" mailto for follow-up questions.
 *
 * Color palette: rose / burgundy. Pulled from
 * `finance-tokens.json::documentTypes.CREDIT_NOTE`
 * (accent #9F1239 = rose-700, accentSoft #FFF1F2 = rose-50). These
 * stay aligned with the credit-note PDF template so an applicant
 * holding the email PDF + this screen sees the same color signal.
 *
 * The section hides itself entirely when the applicant has zero credit
 * notes. This avoids confusing applicants who haven't been refunded
 * with an empty "refunds" panel.
 */

import { useEffect, useState } from 'react';
import {
    PaymentService,
    type CreditNoteRecord,
    type CreditNoteStatus,
} from '@/lib/services/payment-service';
import { StatusBadge, type StatusTone } from '@/components/finance';
import { formatThaiDate } from '@/lib/format/thai-date';

interface RefundVisibilitySectionProps {
    applicationId: string;
    financeContactEmail?: string;
}

const DEFAULT_FINANCE_EMAIL = 'finance@dtam.go.th';

function formatCurrency(value: number) {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 0,
    }).format(value || 0);
}

function formatDate(value?: string | null) {
    return formatThaiDate(value);
}

function cnTone(status: CreditNoteStatus): { tone: StatusTone; label: string } {
    if (status === 'POSTED') return { tone: 'info', label: 'คืนเงินแล้ว' };
    if (status === 'ISSUED') return { tone: 'verifying', label: 'ออกเอกสารแล้ว' };
    if (status === 'CANCELLED') return { tone: 'cancelled', label: 'ยกเลิก' };
    return { tone: 'draft', label: 'แบบร่าง' };
}

export default function RefundVisibilitySection({
    applicationId,
    financeContactEmail = DEFAULT_FINANCE_EMAIL,
}: RefundVisibilitySectionProps) {
    const [notes, setNotes] = useState<CreditNoteRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!applicationId) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        void (async () => {
            try {
                const list = await PaymentService.getCreditNotes(applicationId);
                if (cancelled) return;
                setNotes(list);
            } catch {
                if (cancelled) return;
                setNotes([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [applicationId]);

    // Hide entirely if the applicant has no credit notes — spec.
    if (!loading && notes.length === 0) return null;

    const totalRefunded = notes
        .filter((cn) => cn.status === 'POSTED' || cn.status === 'ISSUED')
        .reduce((sum, cn) => sum + (cn.totalAmount || 0), 0);

    const mailtoSubject = encodeURIComponent('สอบถามเรื่องการคืนเงิน (ใบลดหนี้)');
    const mailtoBody = encodeURIComponent(
        'เรียนทีมการเงินค่ะ/ครับ\n\nขอสอบถามรายละเอียดเกี่ยวกับใบลดหนี้ที่ออกให้กับคำขอของข้าพเจ้า\n\nขอบคุณค่ะ/ครับ',
    );

    return (
        <section
            data-testid="refund-visibility-section"
            // Rose accent matches finance-tokens.json CREDIT_NOTE palette
            // (accent rose-700 / accentSoft rose-50 / accentBorder rose-300).
            className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 shadow-[0_16px_36px_-26px_rgba(159,18,57,0.25)] sm:p-5"
        >
            <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-rose-900">การคืนเงิน</h2>
                    <p className="mt-0.5 text-xs text-rose-800/80">
                        ใบลดหนี้ (Credit Note) ที่ออกให้กับใบแจ้งหนี้ของท่าน
                    </p>
                </div>
                {notes.length > 0 ? (
                    <p className="text-xs text-rose-900">
                        ยอดที่คืน:{' '}
                        <strong className="text-rose-900">{formatCurrency(totalRefunded)}</strong>
                    </p>
                ) : null}
            </header>

            {loading ? (
                <div className="h-14 animate-pulse rounded-lg bg-rose-100/60" />
            ) : (
                <>
                    <ul className="space-y-3">
                        {notes.map((cn) => {
                            const meta = cnTone(cn.status);
                            return (
                                <li
                                    key={cn.id}
                                    className="rounded-xl border border-rose-100 bg-card p-4"
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="font-mono text-sm font-semibold text-foreground">
                                                    {cn.creditNoteNumber || 'ร่าง'}
                                                </p>
                                                <StatusBadge
                                                    status={cn.status}
                                                    tone={meta.tone}
                                                    label={meta.label}
                                                />
                                            </div>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                อ้างอิงใบแจ้งหนี้:{' '}
                                                <span className="font-mono">
                                                    {cn.originalInvoiceNumber || cn.originalInvoiceId}
                                                </span>
                                            </p>
                                            {cn.reason ? (
                                                <p className="mt-2 text-sm text-foreground">
                                                    <span className="text-muted-foreground">เหตุผล: </span>
                                                    {cn.reason}
                                                </p>
                                            ) : null}
                                            <p className="mt-2 text-xs text-muted-foreground">
                                                วันที่: {formatDate(cn.issuedAt || cn.createdAt)}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-[11px] uppercase text-muted-foreground">
                                                ยอดคืนเงิน
                                            </p>
                                            <p className="text-xl font-bold text-rose-900">
                                                {formatCurrency(cn.totalAmount)}
                                            </p>
                                            {cn.vat > 0 ? (
                                                <p className="text-[11px] text-muted-foreground">
                                                    รวม VAT {formatCurrency(cn.vat)}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    <div className="mt-4 flex flex-col items-stretch gap-2 rounded-xl border border-rose-100 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                            มีคำถามเกี่ยวกับการคืนเงิน? ติดต่อทีมการเงินเพื่อสอบถามเพิ่มเติม
                        </p>
                        <a
                            href={`mailto:${financeContactEmail}?subject=${mailtoSubject}&body=${mailtoBody}`}
                            className="inline-flex items-center justify-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800"
                        >
                            ติดต่อทีมการเงิน
                        </a>
                    </div>
                </>
            )}
        </section>
    );
}
