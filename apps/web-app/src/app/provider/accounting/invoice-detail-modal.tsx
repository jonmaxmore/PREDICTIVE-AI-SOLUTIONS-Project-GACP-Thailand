import { useState } from "react";
import { Button } from '@/components/ui/primitives/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { IconCreditCard, IconLock, IconLockOpen } from "@tabler/icons-react";
import { apiClient, type ApiResponse } from '@/lib/api/api-client';
import { toast } from 'sonner';
import { type InvoiceItem, normalizeInvoiceStatus } from "./accounting-types";

/**
 * B2 (design-cleanup-2026-08-21) — the cancel/refund route.
 *
 * The Void/Refund button used to `PATCH /api/invoices/:id` with
 * `{status:'CANCELLED'}`. No such route exists: `routes/api/index.js:154`
 * mounts `finance/invoices.js` (GET only, plus the POST hold/release/receipt
 * handlers in `invoice-payment-handlers.js`). Live against preview:
 * `PATCH /api/invoices/<id>` → 404 text/html "Cannot PATCH …", while
 * `POST /api/finance/refunds/<id>/initiate` → 401 JSON NO_TOKEN, i.e. the
 * route is there and only auth was missing.
 *
 * `finance/refunds` (`routes/api/finance/refunds.js:49`) is also the
 * LEGALLY correct path: it wraps ใบลดหนี้ (ป.รัษฎากร ม.86/10) creation +
 * issue + journal posting in one transaction. The amount, the credit note
 * and the ledger entries are computed entirely inside `refund-service.js` —
 * this component sends no figure of any kind (LAW L3).
 */
const REFUND_REASON_CODE = 'CANCELLATION'; // credit-note-service.js:84-89 VALID_REASON_CODES
const REFUND_REASON_TH = 'ยกเลิก/คืนเงินโดยฝ่ายการเงิน';

/**
 * B2 / systemic pattern P1 — `api-client.ts` NEVER throws. Every failure
 * (HTTP 4xx/5xx, timeout, network) comes back as `{success:false, error}`,
 * so a bare `await apiClient.x()` inside a try/catch runs the success path
 * on failure and the catch block is dead code. Every handler below routes
 * its response through this so the modal only closes when the backend
 * actually did the thing.
 */
function apiErrorMessage(res: ApiResponse<unknown>, fallback: string): string {
    const msg = String(res?.error || '').trim();
    return msg || fallback;
}

interface InvoiceDetailModalProps {
    invoice: InvoiceItem | null;
    onClose: () => void;
    onRefresh: () => void;
    formatCurrency: (amt: number) => string;
    formatDate: (val: string) => string;
    getStatusBadge: (status: string) => React.ReactNode;
    /**
     * Hold/release — canHoldInvoice(role, invoice.issuerSide): RECEIPT_ISSUE plus
     * the backend side guard (finance_officer_platform cannot hold a legacy
     * state-fee invoice). operator 2026-09-27 "กรมฯ ดูอย่างเดียว": the DTAM
     * finance role sees the invoice but no write button.
     */
    canHold: boolean;
    /** Void/refund — only for the backend refund WRITE_ROLES (canWriteAccounting). */
    canRefund: boolean;
}

export function InvoiceDetailModal({
    invoice,
    onClose,
    onRefresh,
    formatCurrency,
    formatDate,
    getStatusBadge,
    canHold,
    canRefund,
}: InvoiceDetailModalProps) {
    const [isHolding, setIsHolding] = useState(false);
    const [isRefunding, setIsRefunding] = useState(false);
    const [refundConfirm, setRefundConfirm] = useState<string | null>(null);

    if (!invoice) return null;

    const handleHoldInvoice = async () => {
        setIsHolding(true);
        try {
            const res = await apiClient.post(`/invoices/${invoice.id}/hold`, { reason: 'ระงับโดยฝ่ายการเงิน' });
            if (!res.success) {
                // P1: a 403 (wrong finance role) or 409 used to close the modal
                // and refresh, so the invoice looked held when it was not.
                toast.error(apiErrorMessage(res, 'ไม่สามารถระงับใบแจ้งหนี้ได้ กรุณาลองใหม่'));
                return;
            }
            toast.success('ระงับใบแจ้งหนี้แล้ว');
            onClose();
            onRefresh();
        } finally {
            setIsHolding(false);
        }
    };

    const handleReleaseInvoice = async () => {
        setIsHolding(true);
        try {
            const res = await apiClient.post(`/invoices/${invoice.id}/release`, {});
            if (!res.success) {
                toast.error(apiErrorMessage(res, 'ไม่สามารถปลดล็อกใบแจ้งหนี้ได้ กรุณาลองใหม่'));
                return;
            }
            toast.success('ปลดล็อกใบแจ้งหนี้แล้ว');
            onClose();
            onRefresh();
        } finally {
            setIsHolding(false);
        }
    };

    const handleRefundInvoice = async () => {
        setIsRefunding(true);
        try {
            // Body carries NO amount — refund-service derives the credit-note
            // figure from the invoice itself (LAW L3). `reason` must be ≥3
            // chars and `reasonCode` one of VALID_REASON_CODES
            // (refund-service.js:272-277).
            const res = await apiClient.post(`/finance/refunds/${invoice.id}/initiate`, {
                reason: REFUND_REASON_TH,
                reasonCode: REFUND_REASON_CODE,
            });
            if (!res.success) {
                // Stay on the confirm pane so the operator sees WHY it failed
                // (INVOICE_NOT_PAID / FORBIDDEN_ROLE / REFUND_BLOCKED_BY_POLICY /
                // REFUND_ALREADY_COMPLETED) and can retry or escalate. Closing
                // here is what made staff believe cancelled invoices were done.
                toast.error(apiErrorMessage(res, 'ไม่สามารถยกเลิก/คืนเงินได้ กรุณาลองใหม่'));
                return;
            }
            toast.success('บันทึกการยกเลิก/คืนเงินแล้ว (ออกใบลดหนี้)');
            setRefundConfirm(null);
            onClose();
            onRefresh();
        } finally {
            setIsRefunding(false);
        }
    };

    return (
        <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-3xl overflow-hidden rounded-lg border-none p-0 shadow-lg">
                <DialogHeader className="bg-primary p-6 text-primary-foreground">
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                        <IconCreditCard size={24} />
                        รายละเอียดการชำระเงิน
                    </DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2">
                    <div className="space-y-6 p-8">
                        <div className="space-y-4">
                            <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
                                <p className="text-xs font-medium text-muted-foreground">หมายเลขใบแจ้งหนี้</p>
                                <p className="text-xl font-semibold text-foreground">{invoice.invoiceNumber}</p>
                                <p className="text-sm font-medium text-muted-foreground">{invoice.applicationNumber}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground">จำนวนเงิน</p>
                                    <p className="text-lg font-semibold text-primary">{formatCurrency(invoice.amount)}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium text-muted-foreground">สถานะ</p>
                                    <div className="mt-1">{getStatusBadge(normalizeInvoiceStatus(invoice))}</div>
                                </div>
                            </div>

                            <hr className="border-border/50" />

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">ชื่อผู้สมัคร</span>
                                    <span className="text-sm font-bold">{invoice.healthName}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">วันที่ออกเอกสาร</span>
                                    <span className="text-sm font-bold">{formatDate(invoice.createdAt)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">กำหนดชำระ</span>
                                    <span className="text-sm font-bold text-rose-600">{formatDate(invoice.dueDate)}</span>
                                </div>
                            </div>
                        </div>

                        {/* UX-ACCT: removed two dead buttons ("ออกใบเสร็จรับเงิน" /
 "พิมพ์เอกสาร") that had no handler — receipt issuance is
                            automatic on AUDIT_PASSED, and printing lives in the page
                            header. Hold/Release below is the real per-invoice action. */}
                        {/* Hold/Release Button — write roles only */}
                        <div className="pt-2">
                            {!canHold ? null : normalizeInvoiceStatus(invoice) === 'HELD' ? (
                                <Button
                                    variant="outline"
                                    className="w-full rounded-xl border-leaf-300 text-leaf-onSoft hover:bg-leaf-soft hover:text-leaf-onSoft"
                                    disabled={isHolding}
                                    onClick={handleReleaseInvoice}
                                >
                                    <IconLockOpen className="mr-2 h-4 w-4" />
                                    {isHolding ? 'กำลังดำเนินการ...' : 'ปลดล็อก (Release Hold)'}
                                </Button>
                            ) : normalizeInvoiceStatus(invoice) !== 'CANCELLED' && normalizeInvoiceStatus(invoice) !== 'FORFEITED' ? (
                                <Button
                                    variant="outline"
                                    className="w-full rounded-xl border-amber-200 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                    disabled={isHolding}
                                    onClick={handleHoldInvoice}
                                >
                                    <IconLock className="mr-2 h-4 w-4" />
                                    {isHolding ? 'กำลังดำเนินการ...' : 'ระงับ / Hold (Finance)'}
                                </Button>
                            ) : null}
                        </div>
                        {canRefund && normalizeInvoiceStatus(invoice).includes('PAID') && (
                            <div className="pt-2">
                                {refundConfirm === invoice.id ? (
                                    // X4-FIX-D H-11 + H-9 — refund-confirm sub-state.
                                    // The cancel button receives autoFocus (NOT the destructive
                                    // confirm) so the keyboard reviewer's first Enter does the
                                    // safe action; both buttons bumped to 44px per WCAG 2.5.5
                                    // because refund is irreversible.
                                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4" key="refund-confirm-pane">
                                        <p className="mb-3 text-sm font-bold text-rose-700">⚠️ ยืนยันการยกเลิก/คืนเงิน?</p>
                                        <p className="mb-3 text-xs text-rose-600">หมายเลข: {invoice.invoiceNumber} {formatCurrency(invoice.amount)}</p>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                className="min-h-[44px] min-w-[44px] flex-1 rounded-xl"
                                                disabled={isRefunding}
                                                onClick={handleRefundInvoice}
                                            >
                                                {isRefunding ? 'กำลังดำเนินการ...' : 'ยืนยัน ยกเลิกรายการ'}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="min-h-[44px] min-w-[44px] flex-1 rounded-xl"
                                                onClick={() => setRefundConfirm(null)}
                                                // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: WAI-ARIA APG safe-action focus (X4-FIX-D H-11).
                                                autoFocus
                                            >
                                                ยกเลิก
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Button
                                        variant="outline"
                                        className="w-full rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                        onClick={() => setRefundConfirm(invoice.id)}
                                    >
                                        ยกเลิก / คืนเงิน (Void/Refund)
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col border-l border-border/50 bg-muted/20 p-8">
                        <p className="mb-6 text-sm font-bold text-foreground">สถานะการวางบิล</p>
                        <div className="space-y-4">
                            {[
                                { label: 'สร้างใบแจ้งหนี้', date: invoice.createdAt, done: true },
                                { label: 'ส่งใบวางบิล', date: invoice.createdAt, done: true },
                                { label: 'ชำระเงิน', date: invoice.paidAt, done: !!invoice.paidAt },
                                { label: 'ออกใบเสร็จ', date: invoice.paidAt, done: normalizeInvoiceStatus(invoice) === 'RECEIPT_ISSUED' },
                            ].map((step, idx) => (
                                <div key={idx} className="flex items-start gap-3">
                                    <div className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                        step.done
                                            ? 'bg-leaf-soft text-leaf-onSoft'
                                            : 'bg-muted text-muted-foreground'
                                    }`}>
                                        {step.done ? '✓' : idx + 1}
                                    </div>
                                    <div>
                                        <p className={`text-sm font-semibold ${step.done ? 'text-foreground' : 'text-muted-foreground'}`}>{step.label}</p>
                                        {step.done && step.date && (
                                            <p className="text-xs text-muted-foreground">{formatDate(step.date)}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/*
                          * ── บล็อก "ช่องทางชำระเงิน" ถูกถอด 2026-09-11 ──────────────────
                          * เดิมพิมพ์เลขบัญชีธนาคารของกรมและเลขประจำตัวผู้เสียภาษีของกรม
                          * ไว้ตรง ๆ ในหน้าจอ เป็นค่าคงที่ที่ไม่ได้มาจากแหล่งใดเลย
                          * (ไม่คัดเลขเหล่านั้นมาไว้ในคอมเมนต์: ของที่ถูกถอดต้องหาไม่เจอ)
                          *
                          * operator 2026-09-11: "เลขที่ประจำตัวผู้เสียภาษี เป็นของบริษัท
                          * ค่าเดียว ในใบเสนอราคา ใบวางบิล และใบเสร็จ ก็จะเป็นของบริษัททั้งหมด"
                          *
                          * และการจ่ายเงินเป็น Stripe ไม่ใช่การโอนเข้าบัญชีธนาคารมานานแล้ว
                          * ⇒ กล่องนี้บอกผู้ใช้ให้โอนเงินไปที่ที่ระบบไม่ได้รับเงิน
                          * ช่องทางเดียวที่เป็นจริงอยู่ที่ constants/service-facts.ts
                          * (PAYMENT_CHANNEL_TH) ซึ่งหน้าฝั่งผู้ยื่นคำขอแสดง
                          */}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
