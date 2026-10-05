'use client';

import { useEffect, useState } from 'react';
import { IconLockOpen, IconX } from '@tabler/icons-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/primitives/dialog';
import { Button } from '@/components/ui/primitives/button';
import {
    PeriodCloseService,
    type PeriodCloseRecord,
} from '@/lib/services/finance-orphans-service';

interface ReopenPeriodModalProps {
    open: boolean;
    /** The CLOSED row the user is trying to reopen. */
    record: PeriodCloseRecord | null;
    /**
     * [R6-B] Current user id for the SoD pre-flight check.
     * When provided AND equal to `record.closedBy`, the modal short-circuits
     * submit with a Thai SoD message instead of round-tripping to the backend
     * (which would respond with SELF_REOPEN_FORBIDDEN). Optional so existing
     * call sites compile unchanged; callers may pass `useAuth().user?.id`.
     */
    currentUserId?: string | null;
    onClose: () => void;
    onReopened: (record: PeriodCloseRecord) => void;
}

const MIN_REASON_CHARS = 10;

/**
 * [R6-B / R7-D] Pure SoD pre-flight predicate. Exported for unit testing
 * so the segregation-of-duties rule can be asserted without a DOM
 * (Radix Dialog portals away in jsdom and the project does not pull in
 * @testing-library/react — see __tests__/close-period-modal.test.tsx for
 * the same pattern).
 *
 * Returns `true` only when BOTH ids are non-empty AND equal. A null
 * `currentUserId` (signed-out / loading auth) or null `record.closedBy`
 * (server-side bug or never-closed row) must NOT trigger the warning —
 * the backend remains the source of truth for SELF_REOPEN_FORBIDDEN and
 * will still reject mismatches on the round-trip.
 */
export function isSelfReopen(
    currentUserId: string | null | undefined,
    record: Pick<PeriodCloseRecord, 'closedBy'> | null | undefined,
): boolean {
    return Boolean(
        currentUserId && record?.closedBy && currentUserId === record.closedBy,
    );
}

/**
 * Reopen-period modal — ADMIN-only.
 *
 * Server enforces:
 *   - reason ≥ 10 chars
 *   - actorId !== periodClose.closedBy (SELF_REOPEN_FORBIDDEN)
 * Both surfaced as inline Thai messages here. [R6-B] The SoD check is now
 * pre-flighted client-side when `currentUserId` is provided, saving the
 * SELF_REOPEN_FORBIDDEN round-trip.
 */
export function ReopenPeriodModal({
    open,
    record,
    currentUserId = null,
    onClose,
    onReopened,
}: ReopenPeriodModalProps) {
    const [reason, setReason] = useState<string>('');
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setReason('');
        setErrorMsg(null);
        setSubmitting(false);
    }, [open, record?.id]);

    const trimmed = reason.trim();
    const reasonValid = trimmed.length >= MIN_REASON_CHARS;
    // [R6-B] SoD pre-flight — flag when the current user is the same person
    // who closed this period. We disable the submit button AND short-circuit
    // handleSubmit so the user gets immediate feedback without a network
    // round-trip. Matches the backend SELF_REOPEN_FORBIDDEN guard exactly.
    // [R7-D] Predicate extracted to module-level `isSelfReopen` for testing.
    const selfReopen = isSelfReopen(currentUserId, record);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!record) return;
        if (selfReopen) {
            setErrorMsg(
                'คุณคือผู้ปิดงวดนี้ กรุณาให้ ADMIN ท่านอื่นเปิดงวด (แยกหน้าที่ตาม TFRS for NPAEs ch.2)',
            );
            return;
        }
        if (!reasonValid) {
            setErrorMsg(`กรุณาระบุเหตุผลอย่างน้อย ${MIN_REASON_CHARS} ตัวอักษร (เป็นหลักฐานในการตรวจสอบภายหลัง)`);
            return;
        }
        setSubmitting(true);
        setErrorMsg(null);
        try {
            const updated = await PeriodCloseService.reopenPeriod(record.id, { reason: trimmed });
            onReopened(updated);
            onClose();
        } catch (err) {
            const e = err as Error & { code?: string };
            const code = e.code || 'UNKNOWN';
            if (code === 'SELF_REOPEN_FORBIDDEN') {
                setErrorMsg(
                    'ผู้ปิดงวดไม่สามารถเปิดงวดของตนเองได้ (แยกหน้าที่ตาม TFRS for NPAEs ch.2) กรุณาให้ ADMIN ท่านอื่นดำเนินการ',
                );
            } else if (code === 'INVALID_STATE') {
                setErrorMsg('งวดนี้ไม่อยู่ในสถานะ CLOSED แล้ว กรุณารีเฟรชหน้าจอ');
            } else if (code === 'NOT_FOUND') {
                setErrorMsg('ไม่พบรายการปิดงวดนี้ (อาจถูกลบไปแล้ว)');
            } else if (code === 'VALIDATION_ERROR') {
                setErrorMsg(e.message || 'เหตุผลไม่ผ่านการตรวจสอบ');
            } else {
                setErrorMsg(e.message || 'เปิดงวดไม่สำเร็จ กรุณาลองอีกครั้ง');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg overflow-hidden rounded-lg border-none p-0 shadow-lg">
                <DialogHeader className="bg-amber-600 p-6 text-white">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                        <IconLockOpen size={22} />
                        เปิดงวดบัญชี (ADMIN เท่านั้น)
                    </DialogTitle>
                    <p className="mt-1 text-xs text-amber-50">
                        เปิดเฉพาะกรณีจำเป็น เช่น พบรายการตกหล่นต้องการบันทึกย้อนหลัง ระบบจะบันทึก audit log ทุกครั้ง
                    </p>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-5 p-6">
                    {record ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            <p className="font-semibold">งวดที่จะเปิด</p>
                            <p className="mt-1">
                                ปี <strong className="font-mono">{record.year}</strong> เดือน{' '}
                                <strong className="font-mono">{String(record.month).padStart(2, '0')}</strong>
                            </p>
                            {record.closedAt ? (
                                <p className="mt-1 text-xs">
                                    ปิดเมื่อ {new Date(record.closedAt).toLocaleString('th-TH')}
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    <div>
                        <label
                            htmlFor="reopen-reason"
                            className="mb-1 block text-xs font-semibold text-muted-foreground"
                        >
                            เหตุผลในการเปิดงวด <span className="text-rose-600">*</span>
                        </label>
                        <textarea
                            id="reopen-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={4}
                            placeholder={`อย่างน้อย ${MIN_REASON_CHARS} ตัวอักษร เช่น "พบใบกำกับภาษีซื้อตกหล่น เดือน 04/2026 จาก Supplier A ต้องบันทึกย้อนหลัง"`}
                            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                            disabled={submitting}
                            maxLength={500}
                            aria-invalid={trimmed.length > 0 && !reasonValid}
                            aria-describedby="reopen-reason-help"
                            // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (X4-FIX-D H-11).
                            autoFocus
                        />
                        <p
                            id="reopen-reason-help"
                            className="mt-1 text-xs text-muted-foreground"
                        >
                            {trimmed.length}/{500}  ต้องอย่างน้อย {MIN_REASON_CHARS} ตัวอักษร
                        </p>
                    </div>

                    {selfReopen ? (
                        <div
                            role="alert"
                            data-testid="self-reopen-warning"
                            className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800"
                        >
                            คุณคือผู้ปิดงวดนี้ กรุณาให้ ADMIN ท่านอื่นเปิดงวด (แยกหน้าที่ตาม TFRS for NPAEs ch.2)
                        </div>
                    ) : null}

                    {errorMsg && !selfReopen ? (
                        <div
                            role="alert"
                            className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800"
                        >
                            {errorMsg}
                        </div>
                    ) : null}

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={submitting}
                        >
                            <IconX className="mr-1 h-4 w-4" />
                            ยกเลิก
                        </Button>
                        <Button
                            type="submit"
                            className="bg-amber-600 text-white hover:bg-amber-700"
                            disabled={submitting || !reasonValid || selfReopen}
                        >
                            <IconLockOpen className="mr-1 h-4 w-4" />
                            {submitting ? 'กำลังเปิดงวด…' : 'ยืนยันเปิดงวด'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default ReopenPeriodModal;
