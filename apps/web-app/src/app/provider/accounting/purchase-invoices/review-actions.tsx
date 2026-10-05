'use client';

import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/primitives/dialog';
import {
    PurchaseInvoiceService,
    type PurchaseInvoice,
} from '@/lib/services/finance-orphans-service';
import type { ReviewActionMode } from './types';

const MIN_REJECT_REASON = 3;

interface ReviewActionsProps {
    invoice: PurchaseInvoice;
    /** Whether the current role may mutate purchase-invoice rows.
     *  Mirrors backend WRITE_ROLES (ADMIN ∪ ACCOUNT_PLATFORM). When
     *  false, all three buttons render disabled so AUDITOR / ACCOUNT
     *  read-only roles cannot trigger a guaranteed-403 round-trip. */
    canWrite: boolean;
    /** Called once the backend confirms a successful mutation. */
    onUpdated: () => void;
}

/**
 * Three row-level action buttons for a purchase-invoice row:
 *
 *   • อนุมัติ (approve)    — only when status === PENDING_REVIEW
 *   • ปฏิเสธ (reject)      — only when status === PENDING_REVIEW;
 *                            opens a textarea modal (≥ 3 char reason)
 *   • บันทึกชำระแล้ว        — only when status === APPROVED && !paidAt
 *
 * After any successful mutation the parent re-fetches the list via
 * `onUpdated()` so the row reflects the new status.
 */
export function ReviewActions({ invoice, canWrite, onUpdated }: ReviewActionsProps) {
    const [mode, setMode] = useState<ReviewActionMode>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    function closeModal() {
        if (busy) return;
        setMode(null);
        setError(null);
        setRejectReason('');
    }

    async function runApprove() {
        setBusy(true);
        setError(null);
        try {
            await PurchaseInvoiceService.approve(invoice.id);
            closeModal();
            onUpdated();
        } catch (err: unknown) {
            setError(mapError(err));
        } finally {
            setBusy(false);
        }
    }

    async function runReject() {
        if (rejectReason.trim().length < MIN_REJECT_REASON) {
            setError(`กรุณากรอกเหตุผลอย่างน้อย ${MIN_REJECT_REASON} ตัวอักษร`);
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await PurchaseInvoiceService.reject(invoice.id, rejectReason.trim());
            closeModal();
            onUpdated();
        } catch (err: unknown) {
            setError(mapError(err));
        } finally {
            setBusy(false);
        }
    }

    async function runMarkPaid() {
        setBusy(true);
        setError(null);
        try {
            await PurchaseInvoiceService.markPaid(invoice.id);
            closeModal();
            onUpdated();
        } catch (err: unknown) {
            setError(mapError(err));
        } finally {
            setBusy(false);
        }
    }

    // Read-only viewers (the DTAM finance role, inspectors) get no action
    // buttons at all — operator 2026-09-27 "กรมฯ ดูอย่างเดียว".
    if (!canWrite) {
        return <span data-role-notice className="text-xs text-muted-foreground">—</span>;
    }

    const canApprove = canWrite && invoice.status === 'PENDING_REVIEW';
    const canReject = canWrite && invoice.status === 'PENDING_REVIEW';
    const canMarkPaid = canWrite && invoice.status === 'APPROVED' && !invoice.paidAt;

    return (
        <>
            <div className="flex items-center justify-center gap-1.5">
                <button
                    type="button"
                    onClick={() => setMode('approve')}
                    disabled={!canApprove}
                    className="rounded-md border border-leaf-300 bg-leaf-soft px-2.5 py-1 text-xs font-semibold text-leaf-onSoft hover:bg-leaf-soft disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`อนุมัติใบกำกับ ${invoice.invoiceNumber}`}
                >
                    อนุมัติ
                </button>
                <button
                    type="button"
                    onClick={() => setMode('reject')}
                    disabled={!canReject}
                    className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`ปฏิเสธใบกำกับ ${invoice.invoiceNumber}`}
                >
                    ปฏิเสธ
                </button>
                {canMarkPaid ? (
                    <button
                        type="button"
                        onClick={() => setMode('mark-paid')}
                        className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                        aria-label={`บันทึกชำระเงินใบกำกับ ${invoice.invoiceNumber}`}
                    >
                        บันทึกชำระแล้ว
                    </button>
                ) : null}
            </div>

            {/* Approve confirmation modal */}
            {mode === 'approve' ? (
                <ConfirmDialog
                    title="ยืนยันการอนุมัติใบกำกับภาษีซื้อ"
                    description={`การอนุมัติจะบันทึก journal entry (Dr Input VAT 7%) สำหรับใบกำกับ ${invoice.invoiceNumber} จาก ${invoice.supplierName}`}
                    confirmLabel={busy ? 'กำลังอนุมัติ...' : 'อนุมัติ'}
                    confirmTone="emerald"
                    onConfirm={runApprove}
                    onCancel={closeModal}
                    busy={busy}
                    error={error}
                />
            ) : null}

            {/* Reject modal — textarea required */}
            {mode === 'reject' ? (
                <Dialog open onOpenChange={(o) => !o && closeModal()}>
                    <DialogContent className="max-w-md overflow-hidden rounded-lg bg-card p-0 shadow-lg">
                        <DialogHeader className="border-b border-border bg-rose-700 p-5 text-white">
                            <DialogTitle className="text-lg font-bold">
                                ปฏิเสธใบกำกับภาษีซื้อ
                            </DialogTitle>
                            <p className="mt-1 text-xs text-rose-50">
                                {invoice.invoiceNumber} จาก {invoice.supplierName}
                            </p>
                        </DialogHeader>
                        <div className="space-y-3 p-5">
                            <div>
                                <label
                                    htmlFor="reject-reason"
                                    className="mb-1 block text-xs font-semibold text-foreground"
                                >
                                    เหตุผลการปฏิเสธ (≥ {MIN_REJECT_REASON} ตัวอักษร) *
                                </label>
                                <textarea
                                    id="reject-reason"
                                    value={rejectReason}
                                    onChange={(e) => {
                                        setRejectReason(e.target.value);
                                        setError(null);
                                    }}
                                    rows={4}
                                    placeholder="เช่น TIN ไม่ตรงกับเอกสารต้นฉบับ"
                                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                                    aria-invalid={!!error}
                                    aria-describedby={error ? 'reject-err' : undefined}
                                />
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                    เหตุผลจะถูกบันทึกใน audit log และจะปรากฏใน detail ของใบกำกับ
                                </p>
                            </div>
                            {error ? (
                                <p
                                    id="reject-err"
                                    role="alert"
                                    className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"
                                >
                                    {error}
                                </p>
                            ) : null}
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    disabled={busy}
                                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                >
                                    ยกเลิก
                                </button>
                                <button
                                    type="button"
                                    onClick={runReject}
                                    disabled={busy || rejectReason.trim().length < MIN_REJECT_REASON}
                                    className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:bg-rose-300"
                                >
                                    {busy ? 'กำลังปฏิเสธ...' : 'ยืนยันการปฏิเสธ'}
                                </button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            ) : null}

            {/* Mark-paid confirmation modal */}
            {mode === 'mark-paid' ? (
                <ConfirmDialog
                    title="บันทึกการชำระเงินใบกำกับภาษีซื้อ"
                    description={`บันทึกว่าใบกำกับ ${invoice.invoiceNumber} จาก ${invoice.supplierName} ได้ชำระเงินแล้ว (paidAt = วันนี้) สถานะ APPROVED จะไม่เปลี่ยน`}
                    confirmLabel={busy ? 'กำลังบันทึก...' : 'บันทึกชำระแล้ว'}
                    confirmTone="sky"
                    onConfirm={runMarkPaid}
                    onCancel={closeModal}
                    busy={busy}
                    error={error}
                />
            ) : null}
        </>
    );
}

// ── Generic confirm dialog ─────────────────────────────────────────────────

function ConfirmDialog({
    title,
    description,
    confirmLabel,
    confirmTone,
    onConfirm,
    onCancel,
    busy,
    error,
}: {
    title: string;
    description: string;
    confirmLabel: string;
    confirmTone: 'emerald' | 'sky';
    onConfirm: () => void;
    onCancel: () => void;
    busy: boolean;
    error: string | null;
}) {
    // X4-FIX-D H-7 — raw bg-emerald-700 → semantic bg-primary token.
    // The "emerald" tone here represents the canonical approve/positive
    // action; routing it through bg-primary keeps the brand cohesion
    // and lets a future theme switch update the modal header in one
    // place. The sky tone is kept as the secondary action accent
    // (post/pay/disburse) — distinct enough from primary to remain
    // semantically unique.
    const toneBtn = confirmTone === 'emerald'
        ? 'bg-primary hover:bg-primary/90 disabled:opacity-50'
        : 'bg-sky-700 hover:bg-sky-800 disabled:bg-sky-300';
    const toneHeader = confirmTone === 'emerald'
        ? 'bg-primary'
        : 'bg-sky-700';
    return (
        <Dialog open onOpenChange={(o) => !o && onCancel()}>
            <DialogContent className="max-w-md overflow-hidden rounded-lg bg-card p-0 shadow-lg">
                <DialogHeader className={`border-b border-border p-5 text-white ${toneHeader}`}>
                    <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 p-5">
                    <p className="text-sm text-foreground">{description}</p>
                    {error ? (
                        <p
                            role="alert"
                            className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"
                        >
                            {error}
                        </p>
                    ) : null}
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={busy}
                            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                            ยกเลิก
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={busy}
                            className={`rounded-lg px-3 py-2 text-sm font-semibold text-white ${toneBtn}`}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Translate the underlying service error to a Thai inline message.
 * Backend codes are documented at apps/backend/services/purchase-invoice-service.js.
 */
function mapError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (/INVALID_REASON/i.test(raw)) {
        return `กรุณากรอกเหตุผลอย่างน้อย ${MIN_REJECT_REASON} ตัวอักษร`;
    }
    if (/INVALID_TRANSITION/i.test(raw)) {
        return 'ไม่สามารถเปลี่ยนสถานะจากสถานะปัจจุบันได้';
    }
    if (/ALREADY_PAID/i.test(raw)) {
        return 'ใบกำกับนี้ถูกบันทึกชำระแล้ว';
    }
    if (/UNBALANCED_ENTRY/i.test(raw)) {
        return 'Journal entry ไม่สมดุล ติดต่อทีมการเงินเพื่อแก้ไขข้อมูลตัวเลข';
    }
    if (/PURCHASE_INVOICE_NOT_FOUND/i.test(raw)) {
        return 'ไม่พบใบกำกับภาษีซื้อรายการนี้';
    }
    if (/PURCHASE_INVOICE_DELETED/i.test(raw)) {
        return 'ใบกำกับนี้ถูกลบไปแล้ว';
    }
    if (/FORBIDDEN_ROLE|FORBIDDEN_TENANT/i.test(raw)) {
        return 'คุณไม่มีสิทธิ์ดำเนินการกับใบกำกับนี้';
    }
    if (/DB_UNAVAILABLE/i.test(raw)) {
        return 'ฐานข้อมูลไม่พร้อมใช้งานชั่วคราว กรุณาลองอีกครั้ง';
    }
    return raw || 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่';
}

export default ReviewActions;
