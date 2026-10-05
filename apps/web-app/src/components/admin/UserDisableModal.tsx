'use client';

import * as React from 'react';
import { AlertTriangle, UserMinus, Loader2 } from 'lucide-react';
import { AdminB28Service } from '@/lib/services/admin-service-b28';
import { resolveErrorCode } from '@/lib/i18n/error-code-map';
import { cn } from '@/lib/utils';

/**
 * Y1-FIX-D — Thai error-code map for `PATCH /admin/users/:id/disable`
 * and `/enable` responses. Policy 5 of `docs/i18n-policy.md`. Backend
 * sources: `apps/backend/services/admin-user-service.js:279-310,316-342`.
 *
 * Exported for unit testing.
 */
export const USER_DISABLE_ERROR_MAP: Record<string, string> = {
    SELF_DISABLE_FORBIDDEN: 'ระบบไม่อนุญาตให้ผู้ดูแลระบบระงับบัญชีของตนเอง',
    USER_NOT_FOUND: 'ไม่พบบัญชีผู้ใช้ที่ระบุ อาจถูกลบหรือถูกย้าย',
    ALREADY_ACTIVE: 'บัญชีนี้เปิดใช้งานอยู่แล้ว ไม่ต้องเปิดใช้งานซ้ำ',
    USER_ALREADY_DISABLED: 'บัญชีนี้ถูกระงับอยู่แล้ว ไม่ต้องระงับซ้ำ',
    USER_HAS_PENDING_APPLICATIONS: 'ผู้ใช้นี้มีคำขอที่กำลังดำเนินการอยู่ กรุณาปิดงานก่อนจะระงับบัญชี',
    USER_IS_ASSIGNED: 'ผู้ใช้นี้กำลังถูกมอบหมายงานอยู่ กรุณายกเลิกการมอบหมายก่อน',
    PERMISSION_DENIED: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
    FORBIDDEN_ROLE: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
};

/**
 * UserDisableModal — disable or re-enable an account.
 *
 * Companion modal to ForceStatusModal for the admin /users surface.
 * Disable requires a reason ≥ 5 chars. Re-enable is a one-click
 * confirmation since it's reversible.
 *
 * Mobile (≤ md): full-screen overlay so the reason textarea has
 * enough room.
 */

export interface UserDisableModalProps {
    userId: string;
    userLabel: string;
    /** Current active state — flips between disable + re-enable copy. */
    isActive: boolean;
    open: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    /** Optional override for tests. */
    submitHandler?: (
        userId: string,
        reason: string,
        action: 'disable' | 'enable',
    ) => Promise<{ success: boolean; message?: string; error?: string; code?: string }>;
}

export function UserDisableModal({
    userId,
    userLabel,
    isActive,
    open,
    onClose,
    onSuccess,
    submitHandler,
}: UserDisableModalProps) {
    const [reason, setReason] = React.useState('');
    const [confirmText, setConfirmText] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!open) {
            setReason('');
            setConfirmText('');
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    if (!open) return null;

    const action: 'disable' | 'enable' = isActive ? 'disable' : 'enable';
    const reasonTooShort = action === 'disable' && reason.trim().length < 5;
    // X5-FIX-D H-7: type-to-confirm mistype-resistance. Operator must
    // type the target action token (DISABLE/ENABLE) literally before
    // submit unlocks. Mirrors ForceStatusModal:286-294. The token is
    // distinct per direction so a stale token cannot replay across a
    // toggle.
    const CONFIRM_TOKEN = action === 'disable' ? 'DISABLE' : 'ENABLE';
    const confirmMismatch = confirmText.trim() !== CONFIRM_TOKEN;
    const canSubmit = !reasonTooShort && !confirmMismatch && !submitting;

    const title = action === 'disable' ? 'ระงับการใช้งานบัญชี' : 'เปิดการใช้งานบัญชีอีกครั้ง';
    const description =
        action === 'disable'
            ? 'ผู้ใช้จะไม่สามารถเข้าสู่ระบบได้จนกว่าจะเปิดการใช้งานอีกครั้ง'
            : 'ผู้ใช้จะสามารถเข้าสู่ระบบและทำงานในระบบได้ตามปกติ';

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            const handler =
                submitHandler ??
                (async (id: string, r: string, a: 'disable' | 'enable') => {
                    if (a === 'disable') return AdminB28Service.disableUser(id, r);
                    return AdminB28Service.enableUser(id);
                });
            const res = await handler(userId, reason.trim(), action);
            if (res.success) {
                onSuccess?.();
                onClose();
            } else {
                // Y1-FIX-D — Policy 5: Thai-friendly resolver.
                setError(
                    resolveErrorCode(res, USER_DISABLE_ERROR_MAP, 'ไม่สามารถดำเนินการได้'),
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
                no-noninteractive-element-interactions warnings. Mirrors
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
                aria-labelledby="user-disable-title"
                className="relative flex max-h-[100vh] w-full flex-col overflow-hidden bg-white shadow-2xl md:max-h-[90vh] md:w-full md:max-w-md md:rounded-2xl"
            >
                <header
                    className={cn(
                        'border-b px-5 py-4',
                        action === 'disable'
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-leaf-300 bg-leaf-soft',
                    )}
                >
                    <h2
                        id="user-disable-title"
                        className={cn(
                            'flex items-center gap-2 text-base font-bold',
                            action === 'disable' ? 'text-amber-900' : 'text-primary-900',
                        )}
                    >
                        <UserMinus className="h-5 w-5" aria-hidden="true" />
                        {title}
                    </h2>
                    <p
                        className={cn(
                            'mt-1 text-xs',
                            action === 'disable' ? 'text-amber-800' : 'text-leaf-800',
                        )}
                    >
                        {description}
                    </p>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div>
                        <p className="text-xs font-bold text-slate-800">บัญชีที่เลือก</p>
                        <p
                            className="mt-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                            data-testid="user-disable-label"
                        >
                            {userLabel}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-slate-500">{userId}</p>
                    </div>

                    {action === 'disable' ? (
                        <div>
                            <label
                                htmlFor="user-disable-reason"
                                className="mb-1 block text-xs font-bold text-slate-800"
                            >
                                เหตุผลที่ระงับ <span className="text-rose-600">*</span>
                            </label>
                            <textarea
                                id="user-disable-reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                rows={3}
                                placeholder="เช่น พบความผิดปกติในการเข้าใช้ระบบ (อย่างน้อย 5 ตัวอักษร)"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                                aria-required="true"
                            />
                            <p className="mt-1 text-[11px] text-slate-500">
                                ระบุอย่างน้อย 5 ตัวอักษร บันทึกใน audit log
                            </p>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-leaf-300 bg-leaf-soft p-3 text-xs text-primary-900">
                            <p className="flex items-center gap-1.5 font-bold">
                                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                                ยืนยันการเปิดใช้งาน
                            </p>
                            <p className="mt-1">
                                การเปิดใช้งานจะทำให้ผู้ใช้สามารถเข้าสู่ระบบได้ทันที
                            </p>
                        </div>
                    )}

                    {/* X5-FIX-D H-7: type-to-confirm mistype-resistance.
                        Operator must type the action token (DISABLE/ENABLE)
                        literally to unlock the submit button. Mirrors the
                        ForceStatusModal:286-294 pattern. The token rotates
                        per direction so a stale typed value cannot replay. */}
                    <div>
                        <label
                            htmlFor="user-disable-confirm"
                            className="mb-1 block text-xs font-bold text-slate-800"
                        >
                            ยืนยันโดยพิมพ์คำว่า{' '}
                            <span
                                className={cn(
                                    'font-mono font-bold',
                                    action === 'disable' ? 'text-amber-700' : 'text-leaf-700',
                                )}
                            >
                                {CONFIRM_TOKEN}
                            </span>{' '}
                            <span className="text-rose-600">*</span>
                        </label>
                        <input
                            id="user-disable-confirm"
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder={CONFIRM_TOKEN}
                            className={cn(
                                'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2',
                                action === 'disable'
                                    ? 'focus:ring-amber-300'
                                    : 'focus:ring-leaf-600',
                            )}
                            autoComplete="off"
                            aria-required="true"
                            data-testid="user-disable-confirm"
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
                        data-testid="user-disable-submit"
                        className={cn(
                            'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white',
                            action === 'disable'
                                ? canSubmit
                                    ? 'bg-amber-600 hover:bg-amber-700'
                                    : 'cursor-not-allowed bg-amber-300'
                                : canSubmit
                                  ? 'bg-leaf-700 hover:bg-leaf-800'
                                  : 'cursor-not-allowed bg-leaf-300',
                        )}
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        {action === 'disable' ? 'ระงับบัญชี' : 'เปิดใช้งาน'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

export default UserDisableModal;
