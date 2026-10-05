'use client';

import { useState, type FormEvent } from 'react';
import { IconReceiptTax, IconX } from '@tabler/icons-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/primitives/dialog';
import { WhtCertificateService } from '@/lib/services/finance-orphans-service';

/**
 * RecordCertificateModal — POST form for recording a ทบ.50 ทวิ that a
 * corporate buyer has mailed back to platform finance.
 *
 * Required fields:
 *   - invoiceId         (platform invoice id)
 *   - certificateNumber (cert number from buyer)
 *   - issuedByTaxId     (13-digit Thai TIN of buyer)
 *   - issuedByName      (buyer legal name)
 *   - certificateDate   (ISO yyyy-mm-dd)
 *   - whtAmount         (THB, > 0)
 *
 * Optional:
 *   - attachmentId      (scanned PDF reference)
 *
 * Backend error codes surfaced inline:
 *   - INVOICE_NOT_PAID                  (409)
 *   - NOT_PLATFORM_INVOICE              (422)
 *   - WHT_EXCEEDS_SUBTOTAL              (400)
 *   - WHT_CERTIFICATE_ALREADY_RECORDED  (409)
 *
 * Role gate enforced by parent (WRITE_ROLES = ACCOUNT_PLATFORM, ADMIN).
 * This modal assumes the caller already checked role — DTAM users do not
 * see the button that opens it.
 *
 * Reference: apps/backend/services/wht-service.js recordWhtCertificate()
 *   lines 321-513
 */

interface RecordCertificateModalProps {
    open: boolean;
    onClose: () => void;
    /** Called after a successful record so the list can re-fetch. */
    onRecorded: () => void;
}

interface FormState {
    invoiceId: string;
    certificateNumber: string;
    issuedByTaxId: string;
    issuedByName: string;
    certificateDate: string;
    whtAmount: string;
    attachmentId: string;
}

const EMPTY: FormState = {
    invoiceId: '',
    certificateNumber: '',
    issuedByTaxId: '',
    issuedByName: '',
    certificateDate: '',
    whtAmount: '',
    attachmentId: '',
};

// Backend Thai messages keyed by code — fall back to backend message
// when the code is not in this map.
const ERROR_COPY: Record<string, string> = {
    INVOICE_NOT_PAID:
        'ใบกำกับภาษีนี้ยังไม่ได้ชำระเงิน บันทึก ทบ.50 ทวิ ได้เฉพาะใบที่มีสถานะ paid เท่านั้น (RD ม.50 + ม.65/2)',
    NOT_PLATFORM_INVOICE:
        'WHT ใช้กับใบกำกับภาษีฝั่งแพลตฟอร์มเท่านั้น ใบเสร็จเงินรายได้รัฐได้รับยกเว้น VAT และไม่อยู่ในขอบเขต ม.50',
    WHT_EXCEEDS_SUBTOTAL:
        'จำนวน WHT เกิน subtotal ของใบกำกับภาษี ตาม ม.50 หักได้สูงสุดเท่ากับฐานที่ต้องเสียภาษี',
    WHT_CERTIFICATE_ALREADY_RECORDED:
        'ใบกำกับภาษีนี้มีการบันทึก ทบ.50 ทวิ ฉบับอื่นไว้แล้ว หากต้องการแทนที่ต้องลบฉบับเดิมก่อน',
    INVALID_BUYER_TAX_ID: 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก',
    INVALID_WHT_AMOUNT: 'จำนวน WHT ต้องมากกว่า 0',
    INVALID_CERTIFICATE_DATE: 'กรุณาเลือกวันที่ในหนังสือรับรอง',
    INVOICE_NOT_FOUND: 'ไม่พบใบกำกับภาษี ตรวจสอบ invoiceId อีกครั้ง',
    FORBIDDEN_ROLE: 'บัญชีของคุณไม่มีสิทธิ์บันทึก ทบ.50 ทวิ',
};

const TAX_ID_REGEX = /^\d{13}$/u;

export function RecordCertificateModal({
    open,
    onClose,
    onRecorded,
}: RecordCertificateModalProps) {
    const [form, setForm] = useState<FormState>(EMPTY);
    const [submitting, setSubmitting] = useState(false);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    function reset() {
        setForm(EMPTY);
        setErrorCode(null);
        setErrorMessage(null);
    }

    function handleClose() {
        if (submitting) return;
        reset();
        onClose();
    }

    function validateLocal(): string | null {
        if (!form.invoiceId.trim()) return 'กรุณากรอก invoiceId';
        if (!form.certificateNumber.trim()) return 'กรุณากรอกเลขที่หนังสือรับรอง';
        if (!TAX_ID_REGEX.test(form.issuedByTaxId.trim())) {
            return 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
        }
        if (!form.issuedByName.trim()) return 'กรุณากรอกชื่อนิติบุคคลผู้ออก';
        if (!form.certificateDate.trim()) return 'กรุณาเลือกวันที่ในหนังสือรับรอง';
        const wht = Number(form.whtAmount);
        if (!Number.isFinite(wht) || wht <= 0) {
            return 'จำนวน WHT ต้องเป็นตัวเลข > 0';
        }
        return null;
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorCode(null);
        setErrorMessage(null);

        const localError = validateLocal();
        if (localError) {
            setErrorMessage(localError);
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                invoiceId: form.invoiceId.trim(),
                certificateNumber: form.certificateNumber.trim(),
                issuedByTaxId: form.issuedByTaxId.trim(),
                issuedByName: form.issuedByName.trim(),
                certificateDate: form.certificateDate,
                whtAmount: Number(form.whtAmount),
                ...(form.attachmentId.trim()
                    ? { attachmentId: form.attachmentId.trim() }
                    : {}),
            };
            await WhtCertificateService.recordCertificate(payload);
            reset();
            onRecorded();
            onClose();
        } catch (err) {
            const e = err as { code?: string; message?: string };
            const code = e?.code || null;
            setErrorCode(code);
            setErrorMessage(
                (code && ERROR_COPY[code]) || e?.message || 'บันทึกไม่สำเร็จ',
            );
        } finally {
            setSubmitting(false);
        }
    }

    const fieldClass =
        'h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
    const labelClass =
        'mb-1 block text-xs font-semibold text-muted-foreground';

    return (
        <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : null)}>
            <DialogContent className="max-w-2xl overflow-hidden rounded-lg p-0 shadow-lg">
                {/* X4-FIX-D H-7 — raw bg-emerald-700 → semantic bg-primary token. */}
                <DialogHeader className="border-b border-border bg-primary p-5 text-primary-foreground">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                        <IconReceiptTax size={22} aria-hidden="true" />
                        บันทึกหนังสือรับรองการหักภาษี ณ ที่จ่าย (ทบ.50 ทวิ)
                    </DialogTitle>
                    <p className="mt-1 text-xs text-primary-foreground/80">
                        บันทึกเอกสารที่ผู้ซื้อนิติบุคคลส่งกลับมา ระบบไม่ได้หัก 3% อัตโนมัติและไม่ได้ออก ภ.ง.ด.53
                    </p>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 p-6">
                    <div>
                        <label htmlFor="wht-cert-invoice-id" className={labelClass}>
                            Invoice ID (ใบกำกับภาษีฝั่งแพลตฟอร์ม) *
                        </label>
                        <input
                            id="wht-cert-invoice-id"
                            type="text"
                            value={form.invoiceId}
                            onChange={(e) => setField('invoiceId', e.target.value)}
                            className={`${fieldClass} font-mono`}
                            required
                            autoComplete="off"
                            spellCheck={false}
                            // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (X4-FIX-D H-11).
                            autoFocus
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label htmlFor="wht-cert-number" className={labelClass}>
                                เลขที่ ทบ.50 ทวิ *
                            </label>
                            <input
                                id="wht-cert-number"
                                type="text"
                                value={form.certificateNumber}
                                onChange={(e) => setField('certificateNumber', e.target.value)}
                                className={fieldClass}
                                required
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label htmlFor="wht-cert-date" className={labelClass}>
                                วันที่ในหนังสือรับรอง *
                            </label>
                            <input
                                id="wht-cert-date"
                                type="date"
                                value={form.certificateDate}
                                onChange={(e) => setField('certificateDate', e.target.value)}
                                className={fieldClass}
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label htmlFor="wht-cert-tax-id" className={labelClass}>
                                เลขประจำตัวผู้เสียภาษีของผู้ออก (13 หลัก) *
                            </label>
                            <input
                                id="wht-cert-tax-id"
                                type="text"
                                inputMode="numeric"
                                value={form.issuedByTaxId}
                                onChange={(e) =>
                                    setField('issuedByTaxId', e.target.value.replace(/\D/gu, '').slice(0, 13))
                                }
                                className={`${fieldClass} font-mono tabular-nums ${
                                    errorCode === 'INVALID_BUYER_TAX_ID'
                                        ? 'border-rose-400 focus:ring-rose-400'
                                        : ''
                                }`}
                                pattern="\d{13}"
                                maxLength={13}
                                required
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label htmlFor="wht-cert-name" className={labelClass}>
                                ชื่อนิติบุคคลผู้ออก *
                            </label>
                            <input
                                id="wht-cert-name"
                                type="text"
                                value={form.issuedByName}
                                onChange={(e) => setField('issuedByName', e.target.value)}
                                className={fieldClass}
                                required
                                autoComplete="off"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label htmlFor="wht-cert-amount" className={labelClass}>
                                จำนวน WHT (THB) *
                            </label>
                            <input
                                id="wht-cert-amount"
                                type="number"
                                // X4-FIX-D M-10 — mobile shows the decimal numeric
                                // keypad for THB entry (matches the JE row inputs
                                // at create-draft-modal.tsx:317).
                                inputMode="decimal"
                                step="0.01"
                                min="0.01"
                                value={form.whtAmount}
                                onChange={(e) => setField('whtAmount', e.target.value)}
                                className={`${fieldClass} font-mono tabular-nums ${
                                    errorCode === 'WHT_EXCEEDS_SUBTOTAL'
                                    || errorCode === 'INVALID_WHT_AMOUNT'
                                        ? 'border-rose-400 focus:ring-rose-400'
                                        : ''
                                }`}
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="wht-cert-attachment" className={labelClass}>
                                Attachment ID (สแกน PDF) ไม่บังคับ
                            </label>
                            <input
                                id="wht-cert-attachment"
                                type="text"
                                value={form.attachmentId}
                                onChange={(e) => setField('attachmentId', e.target.value)}
                                className={`${fieldClass} font-mono`}
                                autoComplete="off"
                                placeholder="เว้นว่างได้"
                            />
                        </div>
                    </div>

                    {errorMessage ? (
                        <div
                            role="alert"
                            className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800"
                        >
                            <div className="flex items-start gap-2">
                                <IconX size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <div className="min-w-0 flex-1 space-y-1">
                                    <p className="font-semibold">{errorMessage}</p>
                                    {errorCode ? (
                                        <p className="font-mono text-[11px] opacity-75">
                                            error code: {errorCode}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={submitting}
                            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                            ยกเลิก
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white hover:bg-leaf-800 disabled:pointer-events-none disabled:bg-leaf-300"
                        >
                            {submitting ? 'กำลังบันทึก...' : 'บันทึกหนังสือรับรอง'}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default RecordCertificateModal;
