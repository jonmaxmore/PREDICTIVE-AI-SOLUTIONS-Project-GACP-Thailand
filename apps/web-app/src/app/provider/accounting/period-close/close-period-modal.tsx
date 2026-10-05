'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconCalendarStats, IconCheck, IconX } from '@tabler/icons-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/primitives/dialog';
import { Button } from '@/components/ui/primitives/button';
import {
    PeriodCloseService,
    type ClosePeriodInput,
    type ClosePeriodResult,
} from '@/lib/services/finance-orphans-service';

interface ClosePeriodModalProps {
    open: boolean;
    onClose: () => void;
    /** Called after a successful close so the parent re-fetches. */
    onClosed: (result: ClosePeriodResult) => void;
}

/**
 * Backend error envelope shape this modal understands. Mirrors the
 * thrown `Error` shape produced by `finance-orphans-service.ts:ok()`
 * after R5-C — `.code` is the raw backend identifier, and
 * `.openInvoices` / `.warnings` / `.periodCloseId` are sibling fields
 * harvested from the envelope's top-level metadata.
 */
export interface ClosePeriodErrorShape {
    code?: string | undefined;
    message?: string;
    openInvoices?: number | undefined;
    warnings?: string[] | undefined;
    periodCloseId?: string | undefined;
}

export interface ClosePeriodErrorView {
    /** Thai-friendly message to render to the user. */
    message: string;
    /** Optional structured metadata for the modal's secondary surfaces. */
    meta: Record<string, unknown> | null;
}

/**
 * Pure error → view-model translator. Exported for unit testing so the
 * H-1 fixture ({code:'PENDING_INVOICES_IN_PERIOD', openInvoices:5})
 * can be asserted to produce "5 ใบ" rather than "หลาย ใบ".
 */
export function mapClosePeriodError(e: ClosePeriodErrorShape): ClosePeriodErrorView {
    const code = e.code || 'UNKNOWN';
    if (code === 'FUTURE_PERIOD') {
        return {
            message: 'เดือนนี้ยังไม่จบ ปิดงวดได้หลังวันที่ 1 ของเดือนถัดไป',
            meta: null,
        };
    }
    if (code === 'PENDING_INVOICES_IN_PERIOD') {
        // R5-C: envelope metadata now plumbs through, so the count
        // backend ships in `openInvoices` is actually reachable here.
        // Fall back to 0 only when the backend omits it.
        const count = typeof e.openInvoices === 'number' ? e.openInvoices : 0;
        return {
            message: `ยังมีใบแจ้งหนี้ค้างอยู่ในงวดนี้ ${count} ใบ กรุณาเคลียร์ก่อนปิดงวด (ภ.พ.30)`,
            meta: { openInvoices: e.openInvoices, warnings: e.warnings },
        };
    }
    if (code === 'ALREADY_CLOSED') {
        return {
            message: e.periodCloseId
                ? `งวดนี้ปิดไปแล้ว (id: ${e.periodCloseId}) กรุณารีเฟรชหน้าจอ`
                : 'งวดนี้ปิดไปแล้ว กรุณารีเฟรชหน้าจอ',
            meta: { periodCloseId: e.periodCloseId },
        };
    }
    if (code === 'VALIDATION_ERROR') {
        return {
            message: e.message || 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบปีและเดือน',
            meta: null,
        };
    }
    return {
        message: e.message || 'ปิดงวดไม่สำเร็จ กรุณาลองอีกครั้ง',
        meta: null,
    };
}

const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * Default to the PREVIOUS month — finance closes the month that just
 * ended (e.g. close April on May 1). Today's month is intentionally
 * unselectable because the backend rejects future/current periods
 * with FUTURE_PERIOD.
 */
function defaultPriorMonth(): { year: number; month: number } {
    const now = new Date();
    const yearAd = now.getUTCFullYear();
    const monthIdx = now.getUTCMonth(); // 0-11 — current month
    if (monthIdx === 0) {
        return { year: yearAd - 1, month: 12 };
    }
    return { year: yearAd, month: monthIdx };
}

export function ClosePeriodModal({ open, onClose, onClosed }: ClosePeriodModalProps) {
    const initial = useMemo(defaultPriorMonth, []);
    const [year, setYear] = useState<number>(initial.year);
    const [month, setMonth] = useState<number>(initial.month);
    const [notes, setNotes] = useState<string>('');
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [errorMeta, setErrorMeta] = useState<Record<string, unknown> | null>(null);

    // Reset form whenever the dialog re-opens.
    useEffect(() => {
        if (!open) return;
        const fresh = defaultPriorMonth();
        setYear(fresh.year);
        setMonth(fresh.month);
        setNotes('');
        setErrorMsg(null);
        setErrorMeta(null);
        setSubmitting(false);
    }, [open]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        setErrorMsg(null);
        setErrorMeta(null);
        const trimmedNotes = notes.trim();
        const payload: ClosePeriodInput = {
            year,
            month,
            ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        };
        try {
            const result = await PeriodCloseService.closePeriod(payload);
            onClosed(result);
            onClose();
        } catch (err) {
            const e = err as Error & ClosePeriodErrorShape;
            const view = mapClosePeriodError({
                code: e.code,
                message: e.message,
                openInvoices: e.openInvoices,
                warnings: e.warnings,
                periodCloseId: e.periodCloseId,
            });
            setErrorMsg(view.message);
            setErrorMeta(view.meta);
        } finally {
            setSubmitting(false);
        }
    };

    const yearOptions = useMemo(() => {
        const current = new Date().getFullYear();
        const out: number[] = [];
        for (let y = current; y >= 2024; y--) out.push(y);
        return out;
    }, []);

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg overflow-hidden rounded-lg border-none p-0 shadow-lg">
                {/* X4-FIX-D H-7 — raw bg-emerald-700 → semantic bg-primary token. */}
                <DialogHeader className="bg-primary p-6 text-primary-foreground">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                        <IconCalendarStats size={22} />
                        ปิดงวดบัญชี
                    </DialogTitle>
                    <p className="mt-1 text-xs text-primary-foreground/80">
                        เลือกปี/เดือนที่ต้องการปิด งวดต้องผ่านพ้นไปแล้วทั้งเดือน (ม.5 TFRS for NPAEs)
                    </p>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-5 p-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label
                                htmlFor="close-year"
                                className="mb-1 block text-xs font-semibold text-muted-foreground"
                            >
                                ปี (ค.ศ.)
                            </label>
                            <select
                                id="close-year"
                                value={year}
                                onChange={(e) => setYear(Number(e.target.value))}
                                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-leaf-600"
                                disabled={submitting}
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (X4-FIX-D H-11).
                                autoFocus
                            >
                                {yearOptions.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label
                                htmlFor="close-month"
                                className="mb-1 block text-xs font-semibold text-muted-foreground"
                            >
                                เดือน
                            </label>
                            <select
                                id="close-month"
                                value={month}
                                onChange={(e) => setMonth(Number(e.target.value))}
                                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-leaf-600"
                                disabled={submitting}
                            >
                                {THAI_MONTHS.map((label, idx) => (
                                    <option key={label} value={idx + 1}>
                                        {String(idx + 1).padStart(2, '0')} — {label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label
                            htmlFor="close-notes"
                            className="mb-1 block text-xs font-semibold text-muted-foreground"
                        >
                            หมายเหตุ (ไม่บังคับ)
                        </label>
                        <textarea
                            id="close-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            placeholder="เช่น ปิดหลังตรวจสอบรายการครบถ้วน, ผ่าน วิภา (Senior accountant)"
                            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-leaf-600"
                            disabled={submitting}
                            maxLength={500}
                        />
                    </div>

                    {errorMsg ? (
                        <div
                            role="alert"
                            className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800"
                        >
                            <p className="font-semibold">ปิดงวดไม่สำเร็จ</p>
                            <p className="mt-1">{errorMsg}</p>
                            {errorMeta?.warnings && Array.isArray(errorMeta.warnings) && errorMeta.warnings.length > 0 ? (
                                <ul className="mt-2 list-inside list-disc text-xs">
                                    {(errorMeta.warnings as string[]).map((w, i) => (
                                        <li key={i}>{w}</li>
                                    ))}
                                </ul>
                            ) : null}
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
                            // X4-FIX-D H-9 + H-7 — irreversible-action button bumped to
                            // 44px (WCAG 2.5.5) and brand-token-routed via bg-primary.
                            className="min-h-[44px] min-w-[44px] bg-primary text-primary-foreground hover:bg-primary/90"
                            disabled={submitting}
                        >
                            <IconCheck className="mr-1 h-4 w-4" />
                            {submitting ? 'กำลังปิดงวด…' : 'ปิดงวด'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default ClosePeriodModal;
