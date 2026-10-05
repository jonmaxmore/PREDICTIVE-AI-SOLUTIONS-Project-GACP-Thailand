'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import {
    AuditService,
    type SchedulingQueueItem,
    type AuditorAvailability,
} from '@/lib/services/audit-service';
import { notifications } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { formatThaiDate } from '@/lib/format/thai-date';

/**
 * AssignAuditorModal — Iter 25 step 3.
 *
 * Wraps the audit-scheduling assignment workflow into a single
 * dialog. Inputs:
 *   • Date picker — defaults to today + 7 business days.
 *   • Slot picker — 09:00 (AM) or 13:00 (PM).
 *   • Auditor select — refreshes availability when the auditor or
 *     date window changes.
 *   • Small calendar widget — shades busy half-days for the
 *     selected auditor.
 *   • Location — prefilled from the application's farm address;
 *     editable in case the auditor needs to clarify.
 *   • Notes — free-form textarea.
 *
 * Submit flow: validate → POST /audit/scheduling/assign → toast +
 * close + `onAssigned()` so the parent queue can refresh.
 */

export interface AssignAuditorModalProps {
    open: boolean;
    application: SchedulingQueueItem | null;
    onClose: () => void;
    onAssigned: () => void;
}

interface AuditorOption {
    id: string;
    name: string;
}

const SLOTS: Array<{ value: 'AM' | 'PM'; label: string }> = [
    { value: 'AM', label: '09:00 น.' },
    { value: 'PM', label: '13:00 น.' },
];

/**
 * Add `n` business days (skipping Sat/Sun) to a Date. The scheduler
 * default of "7 business days from today" gives the applicant a
 * reasonable buffer to prepare for the field visit.
 */
function addBusinessDays(start: Date, n: number): Date {
    const d = new Date(start);
    let added = 0;
    while (added < n) {
        d.setDate(d.getDate() + 1);
        const day = d.getDay();
        if (day !== 0 && day !== 6) added += 1;
    }
    return d;
}

function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function AssignAuditorModal({
    open,
    application,
    onClose,
    onAssigned,
}: AssignAuditorModalProps) {
    const defaultDate = React.useMemo(
        () => toIsoDate(addBusinessDays(new Date(), 7)),
        [],
    );

    const [scheduledDate, setScheduledDate] = React.useState(defaultDate);
    const [slot, setSlot] = React.useState<'AM' | 'PM'>('AM');
    const [auditorId, setAuditorId] = React.useState('');
    const [location, setLocation] = React.useState('');
    const [notes, setNotes] = React.useState('');

    const [auditors, setAuditors] = React.useState<AuditorOption[]>([]);
    const [availability, setAvailability] = React.useState<AuditorAvailability | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [validationError, setValidationError] = React.useState<string | null>(null);
    // V2-C SC-1: surface the auditor-load failure so the modal isn't
    // silently empty. The previous implementation only `setAuditors` on
    // success — a 404 from the wrong URL left the select blank and the
    // scheduler had no way to recover. We now expose a Thai error +
    // retry button bound to `loadAuditors()`.
    const [errorLoadingAuditors, setErrorLoadingAuditors] = React.useState<string | null>(null);
    const [loadingAuditors, setLoadingAuditors] = React.useState(false);

    // Reset form when the modal opens for a new application.
    React.useEffect(() => {
        if (!open) return;
        setScheduledDate(defaultDate);
        setSlot('AM');
        setAuditorId('');
        setLocation(application?.farmAddress || '');
        setNotes('');
        setAvailability(null);
        setValidationError(null);
        setErrorLoadingAuditors(null);
    }, [open, application, defaultDate]);

    // Load the auditor directory on first open. Extracted so the retry
    // button can call the same code path.
    const loadAuditors = React.useCallback(async () => {
        setLoadingAuditors(true);
        setErrorLoadingAuditors(null);
        try {
            const res = await AuditService.getAuditors();
            if (res.success && Array.isArray(res.data)) {
                const mapped = res.data.map((a) => {
                    const displayName =
                        a.fullName ||
                        `${a.firstName || ''} ${a.lastName || ''}`.trim() ||
                        a.id;
                    return { id: a.id, name: displayName };
                });
                setAuditors(mapped);
                if (mapped.length === 0) {
                    setErrorLoadingAuditors(
                        'ไม่พบผู้ตรวจประเมินในระบบ กรุณาติดต่อผู้ดูแลระบบ',
                    );
                }
            } else {
                setAuditors([]);
                setErrorLoadingAuditors(
                    'ไม่สามารถโหลดรายชื่อผู้ตรวจได้ กรุณาลองอีกครั้ง',
                );
            }
        } catch {
            setAuditors([]);
            setErrorLoadingAuditors(
                'ไม่สามารถโหลดรายชื่อผู้ตรวจได้ กรุณาลองอีกครั้ง',
            );
        } finally {
            setLoadingAuditors(false);
        }
    }, []);

    React.useEffect(() => {
        if (!open) return;
        let cancelled = false;
        (async () => {
            await loadAuditors();
            if (cancelled) {
                // No state update needed — React will skip the unmounted
                // setState calls inside loadAuditors via the cancellation
                // boundary on the parent. Kept for symmetry with the
                // availability effect.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, loadAuditors]);

    // Refresh availability when the auditor or the scheduling date changes.
    React.useEffect(() => {
        if (!auditorId || !scheduledDate) {
            setAvailability(null);
            return;
        }
        let cancelled = false;
        // 14-day window centered on the picked date — small enough to
        // load fast, large enough to show "what other days work".
        const start = new Date(scheduledDate);
        start.setDate(start.getDate() - 3);
        const end = new Date(scheduledDate);
        end.setDate(end.getDate() + 14);
        (async () => {
            const res = await AuditService.getAuditorAvailability(
                auditorId,
                toIsoDate(start),
                toIsoDate(end),
            );
            if (!cancelled && res.success && res.data) {
                setAvailability(res.data);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [auditorId, scheduledDate]);

    const handleSubmit = async () => {
        if (!application) return;
        if (!auditorId) {
            setValidationError('กรุณาเลือกผู้ตรวจประเมิน');
            return;
        }
        if (!scheduledDate) {
            setValidationError('กรุณาเลือกวันที่นัดหมาย');
            return;
        }
        if (!location.trim()) {
            setValidationError('กรุณาระบุสถานที่ตรวจ');
            return;
        }
        setValidationError(null);
        setSubmitting(true);
        try {
            const res = await AuditService.assignAuditor({
                applicationId: application.applicationId,
                auditorId,
                scheduledDate,
                scheduledSlot: slot,
                location: location.trim(),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
            });
            if (!res.success) {
                throw new Error(res.error || 'ไม่สามารถจัดตารางได้');
            }
            notifications.show({
                title: 'จัดตารางเรียบร้อย',
                message: `มอบหมาย ${application.applicationNumber} ให้ผู้ตรวจแล้ว`,
                color: 'green',
            });
            onAssigned();
            onClose();
        } catch (err) {
            notifications.show({
                title: 'ไม่สามารถจัดตารางได้',
                message: err instanceof Error ? err.message : 'เกิดข้อผิดพลาด',
                color: 'red',
            });
        } finally {
            setSubmitting(false);
        }
    };

    // Build a 14-day calendar matrix for the availability widget.
    // V2-C SC-5: derive busy + overCap from the backend's actual shape
    // (`busySlots`, `overCapDays`). Busy = any booking that day. OverCap
    // = booking count >= service-side AUDITOR_MAX_PER_DAY (returned as
    // `overCapDays[i].day`). OverCap takes precedence (amber) over busy
    // (red) so the scheduler sees the harder constraint first.
    const calendarDays = React.useMemo(() => {
        const out: Array<{
            date: string;
            day: number;
            busy: boolean;
            overCap: boolean;
            isPicked: boolean;
        }> = [];
        const base = new Date(scheduledDate);
        base.setDate(base.getDate() - 3);
        const busyDays = new Set(
            (availability?.busySlots || [])
                .map((b) => (b.scheduledDate ? b.scheduledDate.slice(0, 10) : null))
                .filter((v): v is string => !!v),
        );
        const overCapSet = new Set(
            (availability?.overCapDays || []).map((d) => d.day),
        );
        for (let i = 0; i < 14; i += 1) {
            const d = new Date(base);
            d.setDate(d.getDate() + i);
            const iso = toIsoDate(d);
            out.push({
                date: iso,
                day: d.getDate(),
                busy: busyDays.has(iso),
                overCap: overCapSet.has(iso),
                isPicked: iso === scheduledDate,
            });
        }
        return out;
    }, [scheduledDate, availability]);

    // V2-C SC-4: notification-preview text. Mirror the applicant-facing
    // copy dispatched by audit-scheduling-service when AUDIT_SCHEDULED
    // fires (`audit-scheduling-service.js:483-496`). Render only when
    // both date and auditor are picked so the preview reflects the
    // committed selection, not partial input.
    const selectedAuditor = React.useMemo(
        () => auditors.find((a) => a.id === auditorId) || null,
        [auditors, auditorId],
    );
    const previewDateLabel = React.useMemo(() => {
        if (!scheduledDate) return '';
        return formatThaiDate(
            scheduledDate,
            { year: 'numeric', month: 'long', day: 'numeric' },
            scheduledDate,
        );
    }, [scheduledDate]);
    const previewSlotLabel = slot === 'AM' ? 'ช่วงเช้า (09:00 น.)' : 'ช่วงบ่าย (13:00 น.)';
    const showNotificationPreview =
        !!auditorId && !!scheduledDate && !!selectedAuditor;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[90vh] overflow-y-auto bg-white p-0 md:max-w-3xl">
                <div className="p-6">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-slate-900">
                            จัดตารางตรวจประเมินภาคสนาม
                        </DialogTitle>
                        {application ? (
                            <p className="mt-1 text-sm text-slate-600">
                                คำขอ <span className="font-semibold">{application.applicationNumber}</span> ·
                                ผู้สมัคร {application.applicantNameMasked}
                            </p>
                        ) : null}
                    </DialogHeader>

                    <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                        <div className="flex flex-col gap-1">
                            <label
                                htmlFor="assign-date"
                                className="text-xs font-semibold uppercase text-slate-600"
                            >
                                วันที่นัดหมาย
                            </label>
                            <input
                                id="assign-date"
                                type="date"
                                value={scheduledDate}
                                onChange={(e) => setScheduledDate(e.target.value)}
                                min={toIsoDate(new Date())}
                                className="h-11 rounded-lg border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600"
                                // X3-FIX-C H-11: focus first input when modal opens so the
                                // scheduler can immediately pick a date with the keyboard.
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
                                autoFocus
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase text-slate-600">
                                ช่วงเวลา
                            </span>
                            <div className="flex gap-2">
                                {SLOTS.map((s) => (
                                    <button
                                        key={s.value}
                                        type="button"
                                        onClick={() => setSlot(s.value)}
                                        className={cn(
                                            'h-11 flex-1 rounded-lg border text-sm font-medium transition-colors',
                                            slot === s.value
                                                ? 'border-leaf-700 bg-leaf-soft text-leaf-onSoft'
                                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                                        )}
                                        aria-pressed={slot === s.value}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-1 md:col-span-2">
                            <label
                                htmlFor="assign-auditor"
                                className="text-xs font-semibold uppercase text-slate-600"
                            >
                                ผู้ตรวจประเมิน
                            </label>
                            <select
                                id="assign-auditor"
                                value={auditorId}
                                onChange={(e) => setAuditorId(e.target.value)}
                                disabled={loadingAuditors || !!errorLoadingAuditors}
                                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 disabled:bg-slate-100 disabled:text-slate-500"
                            >
                                <option value="">
                                    {loadingAuditors
                                        ? 'กำลังโหลดรายชื่อผู้ตรวจ…'
                                        : 'เลือกผู้ตรวจ'}
                                </option>
                                {auditors.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                    </option>
                                ))}
                            </select>
                            {errorLoadingAuditors ? (
                                <div
                                    role="alert"
                                    className="mt-2 flex flex-col gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <p className="font-medium">{errorLoadingAuditors}</p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void loadAuditors();
                                        }}
                                        disabled={loadingAuditors}
                                        className="inline-flex h-8 items-center justify-center rounded-md border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60"
                                    >
                                        ลองโหลดอีกครั้ง
                                    </button>
                                </div>
                            ) : null}
                        </div>

                        {auditorId ? (
                            <div className="md:col-span-2">
                                <span className="mb-2 block text-xs font-semibold uppercase text-slate-600">
                                    ปฏิทินผู้ตรวจ (14 วัน)
                                </span>
                                {/*
                                  X3-FIX-C H-12: drop role="grid" (broken ARIA contract — children
                                  are bare <button>s without role="gridcell"/"row", no arrow-key
                                  navigation between cells). A full grid widget would need
                                  rows/cells/keyboard navigation per W3C ARIA APG; that is a
                                  multi-PR Radix Calendar migration. For now we render as
                                  role="group" so the wrapper is announced as a button group
                                  with its existing aria-label, rather than claiming grid
                                  semantics we don't actually implement.
                                */}
                                <div
                                    role="group"
                                    aria-label="ปฏิทินผู้ตรวจ 14 วัน"
                                    className="grid grid-cols-7 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2"
                                >
                                    {calendarDays.map((d) => {
                                        let stateLabel = 'ว่าง';
                                        if (d.overCap) stateLabel = 'เต็มโควต้า';
                                        else if (d.busy) stateLabel = 'ไม่ว่าง';
                                        return (
                                            <button
                                                key={d.date}
                                                type="button"
                                                data-date={d.date}
                                                data-state={
                                                    d.overCap
                                                        ? 'over-cap'
                                                        : d.busy
                                                            ? 'busy'
                                                            : 'free'
                                                }
                                                onClick={() => setScheduledDate(d.date)}
                                                className={cn(
                                                    'flex h-12 flex-col items-center justify-center rounded-md text-xs font-medium transition-colors',
                                                    d.isPicked
                                                        ? 'bg-leaf-700 text-white'
                                                        : d.overCap
                                                            ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                                            : d.busy
                                                                ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                                                                : 'bg-white text-slate-700 hover:bg-leaf-soft',
                                                )}
                                                aria-label={`${d.date} ${stateLabel}`}
                                            >
                                                <span className="text-sm font-semibold">{d.day}</span>
                                                <span className="text-[10px]">{stateLabel}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                                    <span className="inline-flex items-center gap-1">
                                        <span className="inline-block h-3 w-3 rounded bg-white ring-1 ring-slate-300" />
                                        ว่าง
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <span className="inline-block h-3 w-3 rounded bg-rose-100 ring-1 ring-rose-300" />
                                        ไม่ว่าง
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <span className="inline-block h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-300" />
                                        เต็มโควต้า ({availability?.cap ?? 2}/วัน)
                                    </span>
                                </div>
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-1 md:col-span-2">
                            <label
                                htmlFor="assign-location"
                                className="text-xs font-semibold uppercase text-slate-600"
                            >
                                สถานที่ตรวจ
                            </label>
                            <input
                                id="assign-location"
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="ที่อยู่แปลงที่จะตรวจ"
                                className="h-11 rounded-lg border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600"
                            />
                        </div>

                        <div className="flex flex-col gap-1 md:col-span-2">
                            <label
                                htmlFor="assign-notes"
                                className="text-xs font-semibold uppercase text-slate-600"
                            >
                                บันทึกเพิ่มเติม
                            </label>
                            <textarea
                                id="assign-notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={3}
                                placeholder="ระบุข้อมูลเพิ่มเติม เช่น เส้นทาง ผู้ประสานงาน เบอร์ติดต่อ"
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600"
                            />
                        </div>
                    </div>

                    {/* V2-C — overlap warning when the picked date is busy or
                        the auditor has already hit the daily cap. We surface
                        this BEFORE the submit button so the scheduler sees
                        the conflict before clicking. The service may still
                        accept the assignment (if slot differs), so this is
                        an advisory warning, not a hard block. */}
                    {auditorId && scheduledDate && (() => {
                        const isBusy = calendarDays.some(
                            (d) => d.date === scheduledDate && d.busy,
                        );
                        const isOverCap = calendarDays.some(
                            (d) => d.date === scheduledDate && d.overCap,
                        );
                        if (!isBusy && !isOverCap) return null;
                        return (
                            <div
                                role="status"
                                data-testid="conflict-warning"
                                className={cn(
                                    'mt-4 rounded-md border px-3 py-2 text-sm',
                                    isOverCap
                                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                                        : 'border-rose-200 bg-rose-50 text-rose-800',
                                )}
                            >
                                <p className="font-semibold">
                                    {isOverCap
                                        ? '⚠️ ผู้ตรวจมีนัดเต็มโควต้าในวันนี้แล้ว'
                                        : '⚠️ ผู้ตรวจมีนัดอยู่แล้วในวันที่เลือก'}
                                </p>
                                <p className="mt-1 text-xs">
                                    กรุณาตรวจสอบช่วงเวลาให้ไม่ทับซ้อนก่อนยืนยัน หรือเลือกวันอื่นในปฏิทินด้านบน
                                </p>
                            </div>
                        );
                    })()}

                    {/* V2-C SC-4 — notification preview. Shows the Thai SMS/LINE
                        copy the applicant will receive once the assignment is
                        committed. Only renders when both date and auditor are
                        picked so the preview reflects the actual selection. */}
                    {showNotificationPreview ? (
                        <div
                            data-testid="notification-preview"
                            className="mt-4 rounded-md border border-leaf-300 bg-leaf-soft px-3 py-2 text-sm text-primary-900"
                        >
                            <p className="text-xs font-semibold uppercase text-leaf-700">
                                📲 ผู้สมัครจะได้รับข้อความ
                            </p>
                            <p className="mt-1 leading-relaxed">
                                “นัดหมายตรวจประเมินภาคสนาม
                                {' '}
                                <span className="font-semibold">{previewDateLabel}</span>
                                {' '}
                                <span className="font-semibold">{previewSlotLabel}</span>
                                {' '}
                                ผู้ตรวจ
                                {' '}
                                <span className="font-semibold">{selectedAuditor?.name}</span>”
                            </p>
                        </div>
                    ) : null}

                    {validationError ? (
                        <p
                            role="alert"
                            className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
                        >
                            {validationError}
                        </p>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                        >
                            ยกเลิก
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="inline-flex h-11 items-center justify-center rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-leaf-800 disabled:bg-leaf-300"
                        >
                            {submitting ? 'กำลังบันทึก…' : 'ยืนยันจัดตาราง'}
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default AssignAuditorModal;
