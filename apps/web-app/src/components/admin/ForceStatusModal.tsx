'use client';

import * as React from 'react';
import { AlertTriangle, ShieldAlert, Loader2 } from 'lucide-react';
import {
    AdminB28Service,
    FORCE_STATUS_REASON_CODES,
    type ForceStatusPayload,
    type ForceStatusReasonCode,
} from '@/lib/services/admin-service-b28';
import { resolveErrorCode } from '@/lib/i18n/error-code-map';
import { getStatusLabel } from '@/lib/constants/workflow-states';
import { cn } from '@/lib/utils';

/**
 * Y1-FIX-D — Thai error-code map for
 * `POST /admin/applications/:id/force-status` responses. Policy 5 of
 * `docs/i18n-policy.md`. Backend sources:
 * `apps/backend/routes/api/admin/applications.js` (force-status route).
 *
 * Exported for unit testing.
 */
export const FORCE_STATUS_ERROR_MAP: Record<string, string> = {
    INVALID_STATE_TRANSITION: 'การเปลี่ยนสถานะนี้ไม่อนุญาตจาก state ปัจจุบัน ตรวจสอบ workflow diagram',
    INVALID_TRANSITION: 'การเปลี่ยนสถานะนี้ไม่อนุญาตจาก state ปัจจุบัน ตรวจสอบ workflow diagram',
    APPLICATION_LOCKED: 'คำขอนี้ถูกล็อกชั่วคราว (กำลังประมวลผลโดยระบบ) รีเฟรชหน้าจอแล้วลองอีกครั้ง',
    APPLICATION_NOT_FOUND: 'ไม่พบคำขอที่ระบุ อาจถูกลบหรือเลขที่อ้างอิงไม่ถูกต้อง',
    INVALID_REASON_CODE: 'หมวดเหตุผลที่ระบุไม่อยู่ในรายการที่อนุญาต',
    REASON_TOO_SHORT: 'เหตุผลต้องมีอย่างน้อย 10 ตัวอักษร',
    NO_PREVIOUS_TRANSITION: 'ไม่พบ transition ก่อนหน้า ไม่สามารถย้อนกลับได้',
    ALREADY_IN_STATUS: 'คำขอนี้อยู่ในสถานะที่ระบุอยู่แล้ว ไม่ต้องเปลี่ยนซ้ำ',
    PERMISSION_DENIED: 'คุณไม่มีสิทธิ์เปลี่ยนสถานะ ต้องเป็นบทบาท ADMIN เท่านั้น',
    FORBIDDEN_ROLE: 'คุณไม่มีสิทธิ์เปลี่ยนสถานะ ต้องเป็นบทบาท ADMIN เท่านั้น',
};

/**
 * ForceStatusModal — Admin-only emergency status override modal.
 *
 * V5-D UX-B1: now targets the Iter 28
 * `POST /api/admin/applications/:id/force-status` endpoint via
 * `AdminB28Service.forceStatus`. The payload shape changed from the
 * legacy `{ applicationId, newStatus, reason }` to the new
 * `{ toStatus, reasonCode, reason }` (reason min 10 chars, reasonCode
 * picked from `FORCE_STATUS_REASON_CODES`).
 *
 * The modal:
 *   - blocks submit unless a reason ≥ 10 chars is given AND a
 *     reasonCode is selected AND a toStatus is selected
 *   - requires the operator to type the application id again as
 *     a soft confirmation (mistype-resistance)
 *   - defaults reasonCode to `MANUAL_REVIEW_EXCEPTION` so the
 *     happy path is "pick a status, type a reason, confirm" — the
 *     dropdown is still required-to-select-explicit if the operator
 *     clears it
 *   - renders full-screen on mobile (≤ md) so the danger card
 *     and reason textarea both stay readable
 *
 * Audit trail: the backend records actor + timestamp + reason +
 * reasonCode + before/after status on every call. The modal does
 * NOT log anything client-side — the source of truth is the
 * AUDIT_LOG table on the server.
 */

export const FORCE_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'REGISTERED', label: 'ลงทะเบียน' },
    { value: 'SUBMITTED', label: 'ส่งคำขอแล้ว' },
    { value: 'PENDING_DOC_FEE', label: 'รอชำระงวดที่ 1' },
    { value: 'DOC_FEE_PAID', label: 'ชำระงวดที่ 1 แล้ว' },
    { value: 'ASSIGNED_FOR_REVIEW', label: 'มอบหมายตรวจเอกสาร' },
    { value: 'REVISION_REQUESTED', label: 'ขอแก้ไขเอกสาร' },
    { value: 'DOC_APPROVED', label: 'เอกสารผ่านการตรวจ' },
    { value: 'PENDING_AUDIT_FEE', label: 'รอชำระค่าบริการก่อนตรวจแปลง' },
    { value: 'AUDIT_FEE_PAID', label: 'ชำระค่าบริการแล้ว รอนัดตรวจ' },
    { value: 'AUDIT_CONFIRMED', label: 'ยืนยันนัดตรวจแปลง' },
    { value: 'CAR_PENDING', label: 'รอแก้ไข CAR' },
    { value: 'CAR_REVIEWING', label: 'ตรวจ CAR' },
    { value: 'AUDIT_PASSED', label: 'ผ่านการตรวจ' },
    { value: 'APPROVED', label: 'อนุมัติ' },
    { value: 'CERTIFIED', label: 'ออกใบรับรองแล้ว' },
    { value: 'CANCEL_EXPIRED', label: 'ยกเลิก/หมดอายุ' },
];

export interface ForceStatusModalProps {
    /** Application id being overridden. */
    applicationId: string;
    /** Current status (rendered for context — not editable). */
    currentStatus?: string;
    /** Whether the modal is visible. */
    open: boolean;
    /** Close handler — called on cancel and on successful submit. */
    onClose: () => void;
    /** Success handler — receives the new status. */
    onSuccess?: (newStatus: string) => void;
    /**
     * Optional override hook for tests — defaults to
     * `AdminB28Service.forceStatus`.
     */
    submitHandler?: (payload: ForceStatusPayload) => Promise<{
        success: boolean;
        message?: string;
        error?: string;
        code?: string;
    }>;
}

export function ForceStatusModal({
    applicationId,
    currentStatus,
    open,
    onClose,
    onSuccess,
    submitHandler,
}: ForceStatusModalProps) {
    const [newStatus, setNewStatus] = React.useState('');
    const [reasonCode, setReasonCode] =
        React.useState<ForceStatusReasonCode | ''>('MANUAL_REVIEW_EXCEPTION');
    const [reason, setReason] = React.useState('');
    const [confirmId, setConfirmId] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open) {
            setNewStatus('');
            setReasonCode('MANUAL_REVIEW_EXCEPTION');
            setReason('');
            setConfirmId('');
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    if (!open) return null;

    const idMismatch = confirmId.trim() !== applicationId.trim();
    const reasonTooShort = reason.trim().length < 10;
    const noStatus = !newStatus;
    const noReasonCode = !reasonCode;
    const canSubmit =
        !idMismatch && !reasonTooShort && !noStatus && !noReasonCode && !submitting;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            const handler = submitHandler ?? AdminB28Service.forceStatus.bind(AdminB28Service);
            const res = await handler({
                applicationId: applicationId.trim(),
                toStatus: newStatus,
                reasonCode: reasonCode as ForceStatusReasonCode,
                reason: reason.trim(),
            });
            if (res.success) {
                onSuccess?.(newStatus);
                onClose();
            } else {
                // Y1-FIX-D — Policy 5: Thai-friendly resolver.
                setError(
                    resolveErrorCode(res, FORCE_STATUS_ERROR_MAP, 'ไม่สามารถเปลี่ยนสถานะได้'),
                );
            }
        } catch {
            setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4"
        >
            {/* W5-C: backdrop is a real <button>, dialog panel sits on top. */}
            <button
                type="button"
                aria-label="ปิดหน้าต่าง"
                className="absolute inset-0 cursor-default bg-slate-900/60"
                onClick={onClose}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="force-status-title"
                className="relative flex max-h-[100vh] w-full flex-col overflow-hidden bg-white shadow-2xl md:max-h-[90vh] md:w-full md:max-w-lg md:rounded-2xl"
            >
                <header className="border-b border-rose-200 bg-rose-50 px-5 py-4">
                    <h2
                        id="force-status-title"
                        className="flex items-center gap-2 text-base font-bold text-rose-900"
                    >
                        <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                        เปลี่ยนสถานะฉุกเฉิน (Admin Override)
                    </h2>
                    <p className="mt-1 text-xs text-rose-800">
                        ข้ามขั้นตอน Workflow ปกติ ใช้เฉพาะกรณีฉุกเฉินเท่านั้น
                    </p>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                        <p className="flex items-center gap-1.5 font-bold">
                            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                            คำเตือน
                        </p>
                        <p className="mt-1">
                            การกระทำนี้จะบันทึก Audit Trail ถาวร (ผู้ดำเนินการ + วันเวลา + เหตุผล)
                            และไม่สามารถย้อนกลับได้
                        </p>
                    </div>

                    <div>
                        {/* W5-C: label/control association — read-only id is rendered as <output>
                            and associated with the descriptive label via htmlFor. */}
                        <label htmlFor="force-status-app-id" className="mb-1 block text-xs font-bold text-slate-800">
                            รหัสคำขอ (Application ID)
                        </label>
                        <output
                            id="force-status-app-id"
                            className="block break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
                            data-testid="force-status-app-id"
                        >
                            {applicationId}
                        </output>
                        {currentStatus ? (
                            <p className="mt-1 text-[11px] text-slate-500">
                                สถานะปัจจุบัน: <span className="font-semibold">{getStatusLabel(currentStatus)}</span>
                            </p>
                        ) : null}
                    </div>

                    <div>
                        <label
                            htmlFor="force-status-new"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            สถานะใหม่ <span className="text-rose-600">*</span>
                        </label>
                        <select
                            id="force-status-new"
                            value={newStatus}
                            onChange={(e) => setNewStatus(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                            aria-required="true"
                        >
                            <option value="">เลือกสถานะ...</option>
                            {FORCE_STATUS_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label} ({opt.value})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label
                            htmlFor="force-status-reason-code"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            หมวดเหตุผล (Reason code) <span className="text-rose-600">*</span>
                        </label>
                        <select
                            id="force-status-reason-code"
                            value={reasonCode}
                            onChange={(e) =>
                                setReasonCode(e.target.value as ForceStatusReasonCode | '')
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                            aria-required="true"
                            data-testid="force-status-reason-code"
                        >
                            <option value="">เลือกหมวดเหตุผล...</option>
                            {FORCE_STATUS_REASON_CODES.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label
                            htmlFor="force-status-reason"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            เหตุผล (รายละเอียด) <span className="text-rose-600">*</span>
                        </label>
                        <textarea
                            id="force-status-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            placeholder="ระบุเหตุผลที่ต้อง override (อย่างน้อย 10 ตัวอักษร)"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                            aria-required="true"
                            aria-describedby="force-status-reason-hint"
                        />
                        <p
                            id="force-status-reason-hint"
                            className="mt-1 text-[11px] text-slate-500"
                        >
                            ระบุอย่างน้อย 10 ตัวอักษร ข้อมูลนี้จะถูกเก็บใน audit log
                        </p>
                    </div>

                    <div>
                        <label
                            htmlFor="force-status-confirm"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            ยืนยันโดยพิมพ์รหัสคำขออีกครั้ง{' '}
                            <span className="text-rose-600">*</span>
                        </label>
                        <input
                            id="force-status-confirm"
                            type="text"
                            value={confirmId}
                            onChange={(e) => setConfirmId(e.target.value)}
                            placeholder={applicationId}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
                            autoComplete="off"
                        />
                        {confirmId && idMismatch ? (
                            <p className="mt-1 text-[11px] text-rose-600">
                                รหัสไม่ตรงกับคำขอที่กำลังจะเปลี่ยนสถานะ
                            </p>
                        ) : null}
                    </div>

                    {error ? (
                        <div
                            role="alert"
                            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800"
                        >
                            {error}
                        </div>
                    ) : null}
                </div>

                <footer className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 md:flex-row md:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        ยกเลิก
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className={cn(
                            'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white',
                            canSubmit
                                ? 'bg-rose-600 hover:bg-rose-700'
                                : 'cursor-not-allowed bg-rose-300',
                        )}
                        data-testid="force-status-submit"
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                        )}
                        ยืนยันเปลี่ยนสถานะ
                    </button>
                </footer>
            </div>
        </div>
    );
}

export default ForceStatusModal;
