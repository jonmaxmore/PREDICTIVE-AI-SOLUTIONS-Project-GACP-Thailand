'use client';

import * as React from 'react';
import { Users, Loader2 } from 'lucide-react';
import { AdminB28Service } from '@/lib/services/admin-service-b28';
import { resolveErrorCode } from '@/lib/i18n/error-code-map';
import { cn } from '@/lib/utils';

/**
 * ChangeRoleModal — V5-D Iter 28 admin role-change surface.
 *
 * Wraps the Iter 28 `PATCH /api/admin/users/:id/change-role`
 * endpoint behind a confirm-with-reason modal. Mirrors the shape of
 * `UserDisableModal` (mobile full-screen + desktop dialog,
 * reason-textarea + minimum length gate, optional submitHandler
 * injection for tests).
 *
 * Reason gate: ≥ 10 characters (matches backend
 * `CHANGE_ROLE_REASON_MIN_LEN`). The before/after audit shape is
 * populated server-side from the existing user row — this modal
 * only ships `{ newRole, reason }`.
 *
 * V5-A is expected to ship `lib/constants/admin-role-options.ts`
 * with the canonical role list. Until that lands V5-D uses a local
 * `ROLE_OPTIONS` mirroring `canonical-roles.ts` so the modal is
 * self-contained and does not block on V5-A.
 */

/**
 * Local ROLE_OPTIONS — to be replaced by import from
 * `@/lib/constants/admin-role-options` when V5-A lands. The list
 * mirrors `canonical-roles.ts` plus the two Tier 16 split roles
 * (ACCOUNT_DTAM, ACCOUNT_PLATFORM) that V5-A also adds to
 * /admin/users page-level filters.
 */
/**
 * Y1-FIX-D — Thai error-code map for `PATCH /admin/users/:id/change-role`
 * responses. Policy 5 of `docs/i18n-policy.md`: backend returns stable
 * English code identifiers (`SELF_ROLE_CHANGE_FORBIDDEN`,
 * `USER_NOT_FOUND`, etc.) that the modal renders in Thai. Backend
 * sources: `apps/backend/services/admin-user-service.js:372-383` plus
 * the role-change planner (`planRoleChangeSideEffects`).
 *
 * Exported for unit testing.
 */
export const CHANGE_ROLE_ERROR_MAP: Record<string, string> = {
    SELF_ROLE_CHANGE_FORBIDDEN: 'ระบบไม่อนุญาตให้ผู้ดูแลระบบเปลี่ยนบทบาทของตนเอง',
    ROLE_ADMIN_CANNOT_BE_LAST: 'ไม่สามารถลดบทบาทของผู้ดูแลระบบคนสุดท้ายได้ ต้องมี ADMIN อย่างน้อยหนึ่งคนเสมอ',
    ROLE_DOWNGRADE_FORBIDDEN: 'ไม่สามารถลดบทบาทผู้ใช้นี้ในสถานะปัจจุบันได้ ปิดงานที่ค้างก่อน',
    USER_NOT_FOUND: 'ไม่พบบัญชีผู้ใช้ที่ระบุ อาจถูกลบหรือถูกย้าย',
    INVALID_ROLE: 'บทบาทที่ระบุไม่อยู่ในรายการที่อนุญาต',
    UNSUPPORTED_ROLE: 'บทบาทที่ระบุไม่อยู่ในรายการที่อนุญาต',
    PERMISSION_DENIED: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
    FORBIDDEN_ROLE: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
};

const ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'system_admin_dtam', label: 'ผู้ดูแลระบบ (ADMIN)' },
    { value: 'field_inspector', label: 'ผู้ตรวจประเมิน (AUDITOR)' },
    { value: 'DOCUMENT_REVIEWER', label: 'ผู้ตรวจเอกสาร (DOCUMENT_REVIEWER)' },
    { value: 'dispatcher', label: 'ผู้จัดตาราง (SCHEDULER)' },
    { value: 'finance_officer_dtam', label: 'นักบัญชี (รายได้แผ่นดิน) (ACCOUNT_DTAM)' },
    { value: 'finance_officer_platform', label: 'นักบัญชี (แพลตฟอร์ม) (ACCOUNT_PLATFORM)' },
    { value: 'finance_officer_platform', label: 'นักบัญชี (เลกาซี เลิกใช้) (ACCOUNT)' },
    { value: 'HEALTH', label: 'ผู้ขอใบรับรอง (HEALTH)' },
];

export interface ChangeRoleModalProps {
    userId: string;
    userLabel: string;
    /** Current role string (rendered for context — not editable). */
    currentRole: string;
    open: boolean;
    onClose: () => void;
    onSuccess?: (newRole: string) => void;
    /** Optional override for tests. */
    submitHandler?: (
        userId: string,
        newRole: string,
        reason: string,
    ) => Promise<{ success: boolean; message?: string; error?: string; code?: string }>;
}

export function ChangeRoleModal({
    userId,
    userLabel,
    currentRole,
    open,
    onClose,
    onSuccess,
    submitHandler,
}: ChangeRoleModalProps) {
    const [newRole, setNewRole] = React.useState('');
    const [reason, setReason] = React.useState('');
    const [confirmText, setConfirmText] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open) {
            setNewRole('');
            setReason('');
            setConfirmText('');
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    if (!open) return null;

    // X5-FIX-D H-7: type-to-confirm mistype-resistance. The operator
    // must type the literal string "CONFIRM" before the submit button
    // unlocks — mirrors the ForceStatusModal:286-294 pattern.
    const CONFIRM_TOKEN = 'CONFIRM';
    const reasonTooShort = reason.trim().length < 10;
    const sameRole = newRole && newRole === currentRole;
    const noRole = !newRole;
    const confirmMismatch = confirmText.trim() !== CONFIRM_TOKEN;
    const canSubmit =
        !noRole && !sameRole && !reasonTooShort && !confirmMismatch && !submitting;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            const handler =
                submitHandler ??
                ((id: string, role: string, r: string) =>
                    AdminB28Service.changeRole(id, role, r));
            const res = await handler(userId, newRole, reason.trim());
            if (res.success) {
                onSuccess?.(newRole);
                onClose();
            } else {
                // Y1-FIX-D — Policy 5: prefer Thai message from CHANGE_ROLE_ERROR_MAP
                // when the backend returns a stable English `code`. Falls back to
                // `error` / `message` then to a generic Thai default.
                setError(
                    resolveErrorCode(res, CHANGE_ROLE_ERROR_MAP, 'ไม่สามารถเปลี่ยนบทบาทได้'),
                );
            }
        } catch {
            setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4">
            {/* X5-FIX-B H-9: W5-C backdrop split. The clickable scrim is a real
                <button> so click-outside-to-close also works via Enter/Space —
                drops the previous jsx-a11y/click-events-have-key-events +
                no-noninteractive-element-interactions warnings (the dialog
                root no longer carries the mouse listener). Mirrors
                ForceStatusModal.tsx:142-158 (the W5-C reference). */}
            <button
                type="button"
                aria-label="ปิดหน้าต่าง"
                className="absolute inset-0 cursor-default bg-slate-900/60"
                onClick={onClose}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="change-role-title"
                className="relative flex max-h-[100vh] w-full flex-col overflow-hidden bg-white shadow-2xl md:max-h-[90vh] md:w-full md:max-w-md md:rounded-2xl"
            >
                <header className="border-b border-amber-200 bg-amber-50 px-5 py-4">
                    <h2
                        id="change-role-title"
                        className="flex items-center gap-2 text-base font-bold text-amber-900"
                    >
                        <Users className="h-5 w-5" aria-hidden="true" />
                        เปลี่ยนบทบาทผู้ใช้
                    </h2>
                    <p className="mt-1 text-xs text-amber-800">
                        การเปลี่ยนบทบาทจะกระทบสิทธิการเข้าถึงทันที บันทึก audit trail พร้อม before/after
                    </p>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div>
                        <p className="text-xs font-bold text-slate-800">บัญชีที่เลือก</p>
                        <p
                            className="mt-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                            data-testid="change-role-user-label"
                        >
                            {userLabel}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-slate-500">{userId}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                            บทบาทปัจจุบัน:{' '}
                            <span className="font-semibold text-slate-700">{currentRole}</span>
                        </p>
                    </div>

                    <div>
                        <label
                            htmlFor="change-role-new"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            บทบาทใหม่ <span className="text-rose-600">*</span>
                        </label>
                        <select
                            id="change-role-new"
                            value={newRole}
                            onChange={(e) => setNewRole(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                            aria-required="true"
                            data-testid="change-role-select"
                        >
                            <option value="">เลือกบทบาท...</option>
                            {ROLE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        {sameRole ? (
                            <p className="mt-1 text-[11px] text-rose-600">
                                บทบาทใหม่ต้องไม่เหมือนบทบาทปัจจุบัน
                            </p>
                        ) : null}
                    </div>

                    <div>
                        <label
                            htmlFor="change-role-reason"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            เหตุผลของการเปลี่ยนบทบาท <span className="text-rose-600">*</span>
                        </label>
                        <textarea
                            id="change-role-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            placeholder="เช่น ย้ายทีม / promote (อย่างน้อย 10 ตัวอักษร)"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                            aria-required="true"
                            data-testid="change-role-reason"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">
                            ระบุอย่างน้อย 10 ตัวอักษร บันทึกใน audit log พร้อม before/after
                        </p>
                    </div>

                    {/* X5-FIX-D H-7: type-to-confirm mistype-resistance. Operator
                        must type CONFIRM before submit unlocks — mirrors the
                        ForceStatusModal pattern (lines 286-294). */}
                    <div>
                        <label
                            htmlFor="change-role-confirm"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            ยืนยันโดยพิมพ์คำว่า{' '}
                            <span className="font-mono font-bold text-amber-700">
                                {CONFIRM_TOKEN}
                            </span>{' '}
                            <span className="text-rose-600">*</span>
                        </label>
                        <input
                            id="change-role-confirm"
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder={CONFIRM_TOKEN}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                            autoComplete="off"
                            aria-required="true"
                            data-testid="change-role-confirm"
                        />
                        {confirmText && confirmMismatch ? (
                            <p className="mt-1 text-[11px] text-rose-600">
                                ข้อความไม่ตรงกับคำว่า {CONFIRM_TOKEN}
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
                        data-testid="change-role-submit"
                        className={cn(
                            'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white',
                            canSubmit
                                ? 'bg-amber-600 hover:bg-amber-700'
                                : 'cursor-not-allowed bg-amber-300',
                        )}
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        ยืนยันเปลี่ยนบทบาท
                    </button>
                </footer>
            </div>
        </div>
    );
}

export const CHANGE_ROLE_OPTIONS = ROLE_OPTIONS;

export default ChangeRoleModal;
