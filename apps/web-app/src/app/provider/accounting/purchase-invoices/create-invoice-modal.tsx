'use client';

import { useMemo, useState } from 'react';
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
import {
    CATEGORY_OPTIONS,
    EMPTY_CREATE_FORM,
    EMPTY_ERRORS,
    type CreateInvoiceErrors,
    type CreateInvoiceFieldErrors,
    type CreateInvoiceFormState,
    type PurchaseInvoiceCategory,
} from './types';

const THAI_TAX_ID_RX = /^\d{13}$/;
const TOTAL_TOLERANCE_THB = 0.01;

/**
 * Quick parse to Number with NaN fallback for invalid entries.
 */
function asMoney(s: string): number {
    const n = Number(String(s ?? '').replace(/[, ]/g, ''));
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Pre-submit local validation. Catches the obvious user mistakes
 * before we burn a round-trip. The backend re-validates everything
 * server-side (see purchase-invoice-service.js validators).
 */
function validateForm(form: CreateInvoiceFormState): CreateInvoiceFieldErrors {
    const errors: CreateInvoiceFieldErrors = {
        invoiceNumber: '',
        supplierName: '',
        supplierTaxId: '',
        invoiceDate: '',
        subtotal: '',
        vat: '',
        totalAmount: '',
        category: '',
    };

    if (!form.invoiceNumber.trim()) {
        errors.invoiceNumber = 'กรุณากรอกเลขที่ใบกำกับภาษี';
    }
    if (!form.supplierName.trim()) {
        errors.supplierName = 'กรุณากรอกชื่อผู้ขาย';
    }
    if (!THAI_TAX_ID_RX.test(form.supplierTaxId)) {
        errors.supplierTaxId = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก (ป.รัษฎากร ม.86/4)';
    }
    if (!form.invoiceDate) {
        errors.invoiceDate = 'กรุณาเลือกวันที่ในใบกำกับภาษี';
    }

    const subtotal = asMoney(form.subtotal);
    const vat = asMoney(form.vat);
    const total = asMoney(form.totalAmount);

    if (!Number.isFinite(subtotal) || subtotal < 0) {
        errors.subtotal = 'มูลค่าก่อน VAT ต้องเป็นตัวเลข ≥ 0';
    }
    if (!Number.isFinite(vat) || vat < 0) {
        errors.vat = 'จำนวน VAT ต้องเป็นตัวเลข ≥ 0';
    }
    if (!Number.isFinite(total) || total <= 0) {
        errors.totalAmount = 'ยอดรวมต้องเป็นตัวเลข > 0';
    }

    if (
        Number.isFinite(subtotal)
        && Number.isFinite(vat)
        && Number.isFinite(total)
        && Math.abs(subtotal + vat - total) > TOTAL_TOLERANCE_THB
    ) {
        errors.totalAmount = `subtotal (${subtotal.toFixed(2)}) + VAT (${vat.toFixed(2)}) ต้องเท่ากับยอดรวม (${total.toFixed(2)})`;
    }

    if (
        !(CATEGORY_OPTIONS as ReadonlyArray<{ value: PurchaseInvoiceCategory }>)
            .some((opt) => opt.value === form.category)
    ) {
        errors.category = 'กรุณาเลือกหมวดค่าใช้จ่ายที่ถูกต้อง';
    }

    return errors;
}

function hasAnyError(errors: CreateInvoiceFieldErrors): boolean {
    return Object.values(errors).some((m) => m.length > 0);
}

/**
 * Translate backend error code / message to a Thai UI message + a
 * highlight flag for the totals row. Backend codes are documented at
 * apps/backend/services/purchase-invoice-service.js (DUPLICATE_PURCHASE_INVOICE,
 * UNBALANCED_TOTALS, INVALID_TAX_ID, etc.).
 */
function mapServerError(raw: string): {
    serverMessage: string;
    highlightTotalsMismatch: boolean;
} {
    const msg = String(raw || '');
    if (/DUPLICATE_PURCHASE_INVOICE/i.test(msg)) {
        return {
            serverMessage: 'ใบกำกับภาษีเลขนี้ของผู้ขายรายนี้บันทึกไว้แล้ว',
            highlightTotalsMismatch: false,
        };
    }
    if (/UNBALANCED_TOTALS|subtotal.*\+.*vat/i.test(msg)) {
        return {
            serverMessage: 'ยอดรวมไม่สมดุล subtotal + VAT ต้องเท่ากับ totalAmount',
            highlightTotalsMismatch: true,
        };
    }
    if (/INVALID_TAX_ID/i.test(msg)) {
        return {
            serverMessage: 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (ต้องเป็น 13 หลัก)',
            highlightTotalsMismatch: false,
        };
    }
    if (/INVALID_CATEGORY/i.test(msg)) {
        return {
            serverMessage: 'หมวดค่าใช้จ่ายไม่ถูกต้อง',
            highlightTotalsMismatch: false,
        };
    }
    if (/FORBIDDEN_ROLE|FORBIDDEN_TENANT/i.test(msg)) {
        return {
            serverMessage: 'คุณไม่มีสิทธิ์สร้างใบกำกับภาษีซื้อในองค์กรนี้',
            highlightTotalsMismatch: false,
        };
    }
    if (/DB_UNAVAILABLE/i.test(msg)) {
        return {
            serverMessage: 'ฐานข้อมูลไม่พร้อมใช้งานชั่วคราว กรุณาลองอีกครั้ง',
            highlightTotalsMismatch: false,
        };
    }
    return {
        serverMessage: msg || 'ไม่สามารถบันทึกใบกำกับภาษีซื้อได้ กรุณาลองใหม่',
        highlightTotalsMismatch: false,
    };
}

interface CreateInvoiceModalProps {
    open: boolean;
    onClose: () => void;
    /** Called once the backend has confirmed the row exists. */
    onCreated: (row: PurchaseInvoice) => void;
}

export function CreateInvoiceModal({
    open,
    onClose,
    onCreated,
}: CreateInvoiceModalProps) {
    const [form, setForm] = useState<CreateInvoiceFormState>(EMPTY_CREATE_FORM);
    const [errors, setErrors] = useState<CreateInvoiceErrors>(EMPTY_ERRORS);
    const [submitting, setSubmitting] = useState(false);

    // Derived: live preview of totals balance — gives the user a
    // running indicator so they catch the error before they hit
    // submit (better UX than "wait until you press OK then fail").
    const totalsState = useMemo(() => {
        const subtotal = asMoney(form.subtotal);
        const vat = asMoney(form.vat);
        const total = asMoney(form.totalAmount);
        if (![subtotal, vat, total].every(Number.isFinite)) {
            return { delta: NaN, balanced: false };
        }
        const delta = subtotal + vat - total;
        return { delta, balanced: Math.abs(delta) <= TOTAL_TOLERANCE_THB };
    }, [form.subtotal, form.vat, form.totalAmount]);

    function reset() {
        setForm(EMPTY_CREATE_FORM);
        setErrors(EMPTY_ERRORS);
        setSubmitting(false);
    }

    function handleClose() {
        if (submitting) return;
        reset();
        onClose();
    }

    function setField<K extends keyof CreateInvoiceFormState>(
        key: K,
        value: CreateInvoiceFormState[K],
    ) {
        setForm((prev) => ({ ...prev, [key]: value }));
        // Clear that field's error eagerly when the user edits.
        if (errors.fields[key as keyof CreateInvoiceFieldErrors]) {
            setErrors((prev) => ({
                ...prev,
                fields: { ...prev.fields, [key]: '' },
                serverMessage: null,
                highlightTotalsMismatch: false,
            }));
        }
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting) return;
        const fieldErrors = validateForm(form);
        if (hasAnyError(fieldErrors)) {
            setErrors({
                fields: fieldErrors,
                serverMessage: null,
                highlightTotalsMismatch: !!fieldErrors.totalAmount
                    && /ยอดรวม/.test(fieldErrors.totalAmount),
            });
            return;
        }
        setSubmitting(true);
        setErrors(EMPTY_ERRORS);
        try {
            const created = await PurchaseInvoiceService.create({
                invoiceNumber: form.invoiceNumber.trim(),
                supplierName: form.supplierName.trim(),
                supplierTaxId: form.supplierTaxId.trim(),
                ...(form.supplierAddress.trim() ? { supplierAddress: form.supplierAddress.trim() } : {}),
                invoiceDate: form.invoiceDate,
                subtotal: asMoney(form.subtotal),
                vat: asMoney(form.vat),
                totalAmount: asMoney(form.totalAmount),
                category: form.category,
                ...(form.description.trim() ? { description: form.description.trim() } : {}),
                ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
                ...(form.attachmentId.trim() ? { attachmentId: form.attachmentId.trim() } : {}),
            });
            reset();
            onCreated(created);
        } catch (err: unknown) {
            const raw = err instanceof Error ? err.message : String(err);
            const mapped = mapServerError(raw);
            setErrors({
                fields: EMPTY_ERRORS.fields,
                serverMessage: mapped.serverMessage,
                highlightTotalsMismatch: mapped.highlightTotalsMismatch,
            });
        } finally {
            setSubmitting(false);
        }
    }

    // Style helpers — underline both rows for the totals mismatch
    // hint regardless of which side triggered it.
    const totalsHighlight = errors.highlightTotalsMismatch
        || (!totalsState.balanced
            && Number.isFinite(totalsState.delta)
            && (!!form.subtotal || !!form.vat || !!form.totalAmount));

    return (
        <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
            <DialogContent className="max-w-2xl overflow-hidden rounded-lg bg-card p-0 shadow-lg">
                {/* X4-FIX-D H-7 — raw bg-emerald-700 → semantic bg-primary token. */}
                <DialogHeader className="border-b border-border bg-primary p-6 text-primary-foreground">
                    <DialogTitle className="text-xl font-bold">
                        บันทึกใบกำกับภาษีซื้อ (PENDING_REVIEW)
                    </DialogTitle>
                    <p className="mt-1 text-sm text-primary-foreground/80">
                        บันทึกข้อมูลใบกำกับภาษีซื้อตาม ป.รัษฎากร ม.86/4 ต้องระบุเลข TIN ผู้ขาย, เลขที่ใบกำกับ, วันที่, ยอด, และ VAT ให้ครบ
                    </p>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
                    {errors.serverMessage ? (
                        <div
                            role="alert"
                            className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
                        >
                            {errors.serverMessage}
                        </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FieldText
                            label="เลขที่ใบกำกับภาษี *"
                            value={form.invoiceNumber}
                            onChange={(v) => setField('invoiceNumber', v)}
                            error={errors.fields.invoiceNumber}
                            placeholder="เช่น INV-2026-0001"
                            // X6-B: modal opens via user action; first field receives focus
                            // so keyboard users can start typing immediately.
                            // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
                            autoFocus
                        />
                        <FieldText
                            label="ชื่อผู้ขาย *"
                            value={form.supplierName}
                            onChange={(v) => setField('supplierName', v)}
                            error={errors.fields.supplierName}
                            placeholder="เช่น บริษัท ตัวอย่าง จำกัด"
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FieldText
                            label="เลขประจำตัวผู้เสียภาษีผู้ขาย (13 หลัก) *"
                            value={form.supplierTaxId}
                            onChange={(v) => setField('supplierTaxId', v.replace(/\D/g, '').slice(0, 13))}
                            error={errors.fields.supplierTaxId}
                            placeholder="0000000000000"
                            inputMode="numeric"
                        />
                        <FieldText
                            label="วันที่ในใบกำกับภาษี *"
                            value={form.invoiceDate}
                            onChange={(v) => setField('invoiceDate', v)}
                            error={errors.fields.invoiceDate}
                            type="date"
                        />
                    </div>

                    <FieldText
                        label="ที่อยู่ผู้ขาย"
                        value={form.supplierAddress}
                        onChange={(v) => setField('supplierAddress', v)}
                        error=""
                        placeholder="ที่อยู่จดทะเบียน VAT (ถ้ามี)"
                    />

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <FieldMoney
                            label="มูลค่าก่อน VAT (subtotal) *"
                            value={form.subtotal}
                            onChange={(v) => setField('subtotal', v)}
                            error={errors.fields.subtotal}
                            highlight={totalsHighlight}
                        />
                        <FieldMoney
                            label="VAT 7% *"
                            value={form.vat}
                            onChange={(v) => setField('vat', v)}
                            error={errors.fields.vat}
                            highlight={totalsHighlight}
                        />
                        <FieldMoney
                            label="ยอดรวมทั้งสิ้น (totalAmount) *"
                            value={form.totalAmount}
                            onChange={(v) => setField('totalAmount', v)}
                            error={errors.fields.totalAmount}
                            highlight={totalsHighlight}
                        />
                    </div>

                    {Number.isFinite(totalsState.delta) ? (
                        <p
                            className={`text-xs font-semibold ${
                                totalsState.balanced
                                    ? 'text-leaf-700'
                                    : 'text-rose-700'
                            }`}
                            aria-live="polite"
                        >
                            {totalsState.balanced
                                ? 'ยอดสมดุล: subtotal + VAT = totalAmount'
                                : `ไม่สมดุล ส่วนต่าง ${totalsState.delta.toFixed(2)} บาท`}
                        </p>
                    ) : null}

                    <div>
                        <label
                            htmlFor="category"
                            className="mb-1 block text-xs font-semibold text-foreground"
                        >
                            หมวดค่าใช้จ่าย *
                        </label>
                        <select
                            id="category"
                            value={form.category}
                            onChange={(e) => setField('category', e.target.value as PurchaseInvoiceCategory)}
                            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-leaf-600"
                            aria-invalid={!!errors.fields.category}
                            aria-describedby={errors.fields.category ? 'category-err' : undefined}
                        >
                            {CATEGORY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label} ({opt.value})
                                </option>
                            ))}
                        </select>
                        {errors.fields.category ? (
                            <p id="category-err" className="mt-1 text-xs text-rose-700">
                                {errors.fields.category}
                            </p>
                        ) : null}
                    </div>

                    <FieldText
                        label="รายละเอียดเพิ่มเติม (description)"
                        value={form.description}
                        onChange={(v) => setField('description', v)}
                        error=""
                        placeholder="เช่น ค่าหมึกพิมพ์ + กระดาษ A4"
                    />

                    <FieldText
                        label="หมายเหตุภายใน (notes)"
                        value={form.notes}
                        onChange={(v) => setField('notes', v)}
                        error=""
                        placeholder="หมายเหตุภายในของฝ่ายการเงิน"
                    />

                    <FieldText
                        label="Attachment ID (ถ้ามี)"
                        value={form.attachmentId}
                        onChange={(v) => setField('attachmentId', v)}
                        error=""
                        placeholder="วาง attachmentId ที่อัปโหลดไว้แล้ว"
                    />

                    <div className="flex justify-end gap-2 border-t border-border pt-4">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={submitting}
                            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                            ยกเลิก
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-800 disabled:bg-leaf-300"
                        >
                            {submitting ? 'กำลังบันทึก...' : 'บันทึก (PENDING_REVIEW)'}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ── Small reusable field components ────────────────────────────────────────

function FieldText({
    label,
    value,
    onChange,
    error,
    placeholder,
    type = 'text',
    inputMode,
    autoFocus,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    error: string;
    placeholder?: string;
    type?: string;
    inputMode?: 'numeric' | 'text';
    autoFocus?: boolean;
}) {
    const id = useFieldId(label);
    return (
        <div>
            <label
                htmlFor={id}
                className="mb-1 block text-xs font-semibold text-foreground"
            >
                {label}
            </label>
            <input
                id={id}
                type={type}
                value={value}
                inputMode={inputMode}
                placeholder={placeholder}
                // X6-B: opt-in autoFocus controlled by the parent — only first field
                // in the modal dialog passes `autoFocus`, matching WAI-ARIA APG guidance.
                // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
                autoFocus={autoFocus}
                onChange={(e) => onChange(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-err` : undefined}
                className={`w-full rounded-lg border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                    error
                        ? 'border-rose-300 focus:ring-rose-400'
                        : 'border-border focus:ring-leaf-600'
                }`}
            />
            {error ? (
                <p id={`${id}-err`} className="mt-1 text-xs text-rose-700">
                    {error}
                </p>
            ) : null}
        </div>
    );
}

function FieldMoney({
    label,
    value,
    onChange,
    error,
    highlight,
}: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    error: string;
    highlight: boolean;
}) {
    const id = useFieldId(label);
    return (
        <div>
            <label
                htmlFor={id}
                className="mb-1 block text-xs font-semibold text-foreground"
            >
                {label}
            </label>
            <input
                id={id}
                value={value}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
                aria-invalid={!!error || highlight}
                aria-describedby={error ? `${id}-err` : undefined}
                className={`w-full rounded-lg border bg-card px-3 py-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 ${
                    error
                        ? 'border-rose-300 underline decoration-rose-500 focus:ring-rose-400'
                        : highlight
                            ? 'border-rose-300 underline decoration-rose-400 decoration-dotted focus:ring-rose-400'
                            : 'border-border focus:ring-leaf-600'
                }`}
            />
            {error ? (
                <p id={`${id}-err`} className="mt-1 text-xs text-rose-700">
                    {error}
                </p>
            ) : null}
        </div>
    );
}

function useFieldId(seed: string) {
    return useMemo(
        () => `f-${seed.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
        [seed],
    );
}

export default CreateInvoiceModal;
