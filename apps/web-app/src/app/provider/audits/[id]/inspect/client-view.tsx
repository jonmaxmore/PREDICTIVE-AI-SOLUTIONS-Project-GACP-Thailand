'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChecklistItem, type ChecklistItemValue } from '@/components/audit/ChecklistItem';
import {
    AuditService,
    type AuditDecisionValue,
    type ChecklistAnswer,
    type GpsPayload,
} from '@/lib/services/audit-service';
import { notifications } from '@/lib/notifications';
import { resolveMapViewerUrl } from '@/lib/config/map-tiles';
import { cn } from '@/lib/utils';

/**
 * InspectClient — Iter 25 step 4 island.
 *
 * State machine for the auditor field-app:
 *   'start' → 'checklist' → 'review' → 'decision' → 'done'
 *
 * Mobile-first design: pages stack vertically, controls have ≥44px
 * height, photos use the native camera intent. GPS is captured at
 * start via `navigator.geolocation.getCurrentPosition`.
 *
 * Auto-save: when a checklist item changes, we debounce 800ms then
 * push to the backend. The page also runs a 30-second timer that
 * flushes any dirty items even if the auditor stops interacting —
 * this matches the brief's "save draft every 30s" goal without
 * blocking the UI.
 */

type Stage = 'loading' | 'start' | 'checklist' | 'review' | 'decision' | 'done';

interface OnsiteContext {
    audit: {
        id: string;
        applicationId: string;
        applicationNumber: string;
        applicantName: string;
        farmAddress: string;
        farmLat?: number;
        farmLng?: number;
        scope?: string;
    };
    checklist: Array<{
        itemId: string;
        title: string;
        description: string;
        category?: string;
        required?: boolean;
    }>;
    startedAt?: string;
    savedAnswers?: Array<{
        itemId: string;
        answer: ChecklistAnswer;
        notes?: string;
        photoIds?: string[];
    }>;
}

function emptyValue(): ChecklistItemValue {
    return { answer: null, notes: '', photos: [] };
}

/**
 * Track a per-photo upload failure so the checklist row can surface a
 * retry button instead of silently dropping the file on a flaky 3G
 * connection (V3-B DM-4 follow-up — network tolerance for the field
 * auditor).
 */
interface FailedPhoto {
    id: string;
    file: File;
    error: string;
}

export default function InspectClient({ applicationId }: { applicationId: string }) {
    const [stage, setStage] = React.useState<Stage>('loading');
    const [context, setContext] = React.useState<OnsiteContext | null>(null);
    const [values, setValues] = React.useState<Record<string, ChecklistItemValue>>({});
    const [gps, setGps] = React.useState<GpsPayload | null>(null);
    const [gpsError, setGpsError] = React.useState<string | null>(null);
    const [gpsFallbackUsed, setGpsFallbackUsed] = React.useState(false);
    const [decision, setDecision] = React.useState<AuditDecisionValue>('PASS');
    const [decisionSummary, setDecisionSummary] = React.useState('');
    const [criticalFindings, setCriticalFindings] = React.useState<string[]>(['']);
    const [submittingDecision, setSubmittingDecision] = React.useState(false);
    const [startingInspection, setStartingInspection] = React.useState(false);
    /**
     * Per-checklist-item failed photos. Keyed by itemId → list of
     * {id, file, error}. The ChecklistItem renders a retry pill for
     * each entry; clicking it calls handlePhotoRetry which re-runs
     * the upload and removes the entry on success.
     */
    const [failedPhotos, setFailedPhotos] = React.useState<
        Record<string, FailedPhoto[]>
    >({});

    // The route [id] is the applicationId; the real onsite AuditChecklist.id
    // is resolved server-side and returned as context.audit.id. Every write
    // (start/checklist/photo/decision/gps-verify) keys off THIS id.
    const auditId = context?.audit.id ?? null;

    // ── Initial load — fetch the audit context + saved drafts. ────────
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await AuditService.getOnsiteContext(applicationId);
            if (cancelled) return;
            if (res.success && res.data) {
                setContext(res.data);
                const seeded: Record<string, ChecklistItemValue> = {};
                for (const item of res.data.checklist) {
                    seeded[item.itemId] = emptyValue();
                }
                for (const saved of res.data.savedAnswers || []) {
                    seeded[saved.itemId] = {
                        answer: saved.answer,
                        notes: saved.notes || '',
                        photos: (saved.photoIds || []).map((id, i) => ({
                            id,
                            name: `photo-${i + 1}.jpg`,
                        })),
                    };
                }
                setValues(seeded);
                setStage(res.data.startedAt ? 'checklist' : 'start');
                if (res.data.startedAt) {
                    // A RESUMED visit lands on the checklist without ever passing the start
                    // button — and the start button is the only place this screen acquired a
                    // GPS fix. So a resumed session held gps === null for the whole visit, sent
                    // no position with any photograph, and the server refused every one of
                    // them (walk 2026-08-27: HTTP 500 on all five, which at the time did not
                    // even say why). Every photograph is bound to where it was taken; a resume
                    // must re-acquire that binding exactly as a start does. Not awaited: the
                    // auditor may answer items while the fix arrives, and tryUploadOne refuses
                    // to send a photo until one exists.
                    captureGps()
                        .then((fix) => { if (!cancelled) { setGps(fix); setGpsFallbackUsed(false); } })
                        .catch((err) => {
                            if (cancelled) return;
                            setGpsError(err instanceof Error ? err.message : 'ไม่สามารถอ่านพิกัด GPS ได้');
                        });
                }
            } else {
                notifications.show({
                    title: 'โหลดข้อมูลการตรวจไม่สำเร็จ',
                    message: res.error || 'ไม่สามารถโหลดข้อมูลได้',
                    color: 'red',
                });
                setStage('start');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [applicationId]);

    // ── Auto-save: debounce changes per item and flush every 30s. ─────
    const dirtyRef = React.useRef<Set<string>>(new Set());
    const valuesRef = React.useRef(values);
    valuesRef.current = values;

    React.useEffect(() => {
        if (stage !== 'checklist') return;
        const interval = window.setInterval(() => {
            if (!auditId) return;
            const toFlush = Array.from(dirtyRef.current);
            if (toFlush.length === 0) return;
            dirtyRef.current.clear();
            for (const id of toFlush) {
                const v = valuesRef.current[id];
                if (!v?.answer) continue;
                AuditService.submitChecklistItem(auditId, {
                    itemId: id,
                    answer: v.answer,
                    ...(v.notes ? { notes: v.notes } : {}),
                    photoIds: v.photos.map((p) => p.id),
                }).catch(() => {
                    /* best-effort save; surface errors only on explicit submit */
                });
            }
        }, 30_000);
        return () => window.clearInterval(interval);
    }, [stage, auditId]);

    const onChecklistChange = (itemId: string, next: ChecklistItemValue) => {
        setValues((prev) => ({ ...prev, [itemId]: next }));
        dirtyRef.current.add(itemId);
    };

    // ── GPS check-in for start screen. ────────────────────────────────
    // Timeout 10s matches the V3-B brief — slightly tighter than the
    // browser's default so a low-signal greenhouse falls through to
    // the DM-4 fallback affordance instead of spinning for 15-20s.
    const captureGps = (): Promise<GpsPayload> =>
        new Promise((resolve, reject) => {
            if (typeof navigator === 'undefined' || !navigator.geolocation) {
                reject(new Error('อุปกรณ์ไม่รองรับ GPS'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) =>
                    resolve({
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                        capturedAt: new Date().toISOString(),
                    }),
                (err) => reject(new Error(err.message || 'ไม่สามารถอ่านพิกัด GPS ได้')),
                { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
            );
        });

    /**
     * Push the start-inspection event to the backend using the supplied
     * GPS fix. Shared between the live GPS path and the DM-4 fallback
     * path so they cannot drift apart.
     *
     * When `fallback === true`, we tag the fix with a synthetic accuracy
     * of 0 (the farm's registered coordinate is by definition the
     * ground-truth centroid, not a noisy GPS sample) so the downstream
     * fraud-detection service can distinguish the two.
     */
    const startWithFix = async (fix: GpsPayload, fallback: boolean) => {
        if (!auditId) return;
        const res = await AuditService.startInspection(auditId, fix);
        if (!res.success) {
            throw new Error(res.error || 'ไม่สามารถเริ่มตรวจได้');
        }
        notifications.show({
            title: 'เริ่มตรวจเรียบร้อย',
            message: fallback
                ? 'ใช้พิกัดที่อยู่ฟาร์มเป็นจุดเริ่มต้นแล้ว'
                : 'บันทึกพิกัด GPS เริ่มต้นแล้ว',
            color: 'green',
        });
        // Task 10 (fixes B8): run the previously-dead physical-presence
        // fraud check now that the inspection has opened. Advisory
        // telemetry only, NOT a hard gate — the real evidence gate is
        // photos+checklist (onsite-evidence-gate.js). A failed call
        // (network/500) or an unresolvable farm location must never
        // block the auditor from proceeding, so this is deliberately
        // isolated in its own try/catch rather than sharing the outer
        // handler's try/catch (which would otherwise mislabel an already-
        // successful start as "เริ่มตรวจไม่สำเร็จ").
        if (auditId) {
            try {
                const verify = await AuditService.verifyGps(auditId, fix.latitude, fix.longitude);
                if (verify.success && verify.data && !verify.data.unknownFarmLocation && !verify.data.withinTolerance) {
                    notifications.show({
                        title: 'เตือน: อยู่นอกรัศมีฟาร์ม',
                        message: `ห่างจากพิกัดฟาร์มประมาณ ${Math.round(verify.data.distanceMeters ?? 0)} ม. (อนุญาต ${verify.data.toleranceMeters} ม.)`,
                        color: 'orange',
                    });
                }
            } catch {
                // Best-effort fraud signal — swallow and proceed (see note above).
            }
        }
        setStage('checklist');
    };

    const handleStart = async () => {
        if (!auditId) return;
        setGpsError(null);
        setStartingInspection(true);
        try {
            const fix = await captureGps();
            setGps(fix);
            setGpsFallbackUsed(false);
            await startWithFix(fix, false);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
            setGpsError(msg);
            notifications.show({
                title: 'เริ่มตรวจไม่สำเร็จ',
                message: msg,
                color: 'red',
            });
        } finally {
            setStartingInspection(false);
        }
    };

    /**
     * DM-4: GPS is denied / unavailable (low-signal greenhouse, indoor
     * facility, blocked permission). Fall back to the farm's registered
     * coordinates from `context.audit.farmLat/farmLng` so the auditor
     * isn't hard-stopped from starting work. The fallback is flagged
     * locally so the review screen + audit-trail label the start point
     * "พิกัดที่อยู่ฟาร์ม" instead of "GPS ภาคสนาม".
     */
    const handleStartWithFarmCoords = async () => {
        if (!auditId) return;
        if (!context?.audit.farmLat || !context?.audit.farmLng) {
            notifications.show({
                title: 'ไม่พบพิกัดที่อยู่ฟาร์ม',
                message: 'ฟาร์มยังไม่ได้ระบุพิกัดในใบสมัคร ติดต่อผู้ดูแลระบบ',
                color: 'red',
            });
            return;
        }
        setGpsError(null);
        setStartingInspection(true);
        try {
            const fix: GpsPayload = {
                latitude: context.audit.farmLat,
                longitude: context.audit.farmLng,
                accuracy: 0,
                capturedAt: new Date().toISOString(),
            };
            setGps(fix);
            setGpsFallbackUsed(true);
            await startWithFix(fix, true);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
            setGpsError(msg);
            notifications.show({
                title: 'เริ่มตรวจไม่สำเร็จ',
                message: msg,
                color: 'red',
            });
        } finally {
            setStartingInspection(false);
        }
    };

    /**
     * Photo upload with retry tracking. If the upload fails, the file
     * is held in `failedPhotos[itemId]` so the ChecklistItem can render
     * a retry pill — the auditor isn't silently losing evidence on a
     * flaky 3G connection. Successful uploads are appended to the
     * checklist item's `photos` and clear any matching failed entry.
     */
    const recordFailedPhoto = (itemId: string, file: File, message: string) => {
        const id = `${itemId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setFailedPhotos((prev) => ({
            ...prev,
            [itemId]: [...(prev[itemId] || []), { id, file, error: message }],
        }));
        notifications.show({
            title: 'อัปโหลดภาพไม่สำเร็จ',
            message: `${file.name} กดปุ่มลองอีกครั้งใต้รายการ`,
            color: 'red',
        });
    };

    const tryUploadOne = async (itemId: string, file: File): Promise<boolean> => {
        if (!auditId) return false;
        // No position, no photograph. `gps` is null on a resumed visit until the
        // re-acquire in the load effect lands, and null forever if the auditor denied
        // location — either way the server will refuse (PHOTO_GPS_REQUIRED, 400), and
        // it is better to acquire here and say so in Thai than to let the refusal be the
        // first the auditor hears of it. The fix is kept so the next photo reuses it.
        let position = gps;
        if (!position) {
            try {
                position = await captureGps();
                setGps(position);
                setGpsFallbackUsed(false);
                setGpsError(null);
            } catch (err) {
                const why = err instanceof Error ? err.message : 'ไม่สามารถอ่านพิกัด GPS ได้';
                setGpsError(why);
                recordFailedPhoto(itemId, file, `ยังไม่มีตำแหน่งของรูปนี้ คุณต้องอนุญาตให้แอปเข้าถึงตำแหน่งก่อน (${why})`);
                return false;
            }
        }
        try {
            const res = await AuditService.uploadPhoto(auditId, file, {
                itemId,
                gps: position,
            });
            if (res.success && res.data) {
                setValues((prev) => {
                    const cur = prev[itemId] || emptyValue();
                    return {
                        ...prev,
                        [itemId]: {
                            ...cur,
                            photos: [
                                ...cur.photos,
                                {
                                    id: res.data!.photoId,
                                    name: file.name,
                                    url: res.data!.url,
                                },
                            ],
                        },
                    };
                });
                dirtyRef.current.add(itemId);
                return true;
            }
            recordFailedPhoto(itemId, file, res.error || 'unknown error');
            return false;
        } catch (err) {
            recordFailedPhoto(itemId, file, err instanceof Error ? err.message : 'network error');
            return false;
        }
    };

    // ── Photo capture: parent uploads, ChecklistItem just renders. ────
    const handlePhotoCapture = async (itemId: string, files: FileList) => {
        const arr = Array.from(files);
        for (const f of arr) {
            await tryUploadOne(itemId, f);
        }
    };

    /**
     * Retry a single failed photo. Removes the entry from
     * `failedPhotos[itemId]` only if the retry succeeds; otherwise the
     * pill stays visible so the auditor can try again.
     */
    const handlePhotoRetry = async (itemId: string, failedId: string) => {
        const entry = (failedPhotos[itemId] || []).find((p) => p.id === failedId);
        if (!entry) return;
        const ok = await tryUploadOne(itemId, entry.file);
        if (ok) {
            setFailedPhotos((prev) => ({
                ...prev,
                [itemId]: (prev[itemId] || []).filter((p) => p.id !== failedId),
            }));
        }
    };

    /**
     * Discard a failed-photo pill without retrying (e.g. the auditor
     * decides the shot was bad and wants to re-take). Keeps the UI
     * uncluttered when the user has already moved on.
     */
    const handlePhotoDiscard = (itemId: string, failedId: string) => {
        setFailedPhotos((prev) => ({
            ...prev,
            [itemId]: (prev[itemId] || []).filter((p) => p.id !== failedId),
        }));
    };

    const progress = React.useMemo(() => {
        if (!context) return { done: 0, total: 0 };
        const total = context.checklist.length;
        const done = context.checklist.filter(
            (i) => values[i.itemId]?.answer != null,
        ).length;
        return { done, total };
    }, [context, values]);

    const submitDecision = async () => {
        if (!auditId) return;
        if (!decisionSummary.trim()) {
            notifications.show({
                title: 'กรุณาระบุสรุปผล',
                color: 'yellow',
            });
            return;
        }
        setSubmittingDecision(true);
        try {
            const res = await AuditService.submitDecision(auditId, {
                decision,
                summary: decisionSummary.trim(),
                criticalFindings: criticalFindings
                    .map((s) => s.trim())
                    .filter(Boolean),
            });
            if (!res.success) {
                throw new Error(res.error || 'ส่งผลไม่สำเร็จ');
            }
            setStage('done');
        } catch (err) {
            notifications.show({
                title: 'ส่งผลไม่สำเร็จ',
                message: err instanceof Error ? err.message : '',
                color: 'red',
            });
        } finally {
            setSubmittingDecision(false);
        }
    };

    if (stage === 'loading' || !context) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center px-4 text-slate-500">
                <p className="text-sm">กำลังโหลดข้อมูลการตรวจ…</p>
            </div>
        );
    }

    return (
        <div className="w-full px-4 py-4 md:py-6">
            <ContextHeader
                appNo={context.audit.applicationNumber}
                applicant={context.audit.applicantName}
                farmAddress={context.audit.farmAddress}
                stage={stage}
            />

            {stage === 'start' ? (
                <StartScreen
                    onStart={handleStart}
                    loading={startingInspection}
                    error={gpsError}
                    farmCoordinatesAvailable={
                        typeof context.audit.farmLat === 'number'
                            && typeof context.audit.farmLng === 'number'
                    }
                    onUseFarmCoordinates={handleStartWithFarmCoords}
                />
            ) : null}

            {stage === 'checklist' ? (
                <ChecklistScreen
                    items={context.checklist}
                    values={values}
                    progress={progress}
                    onChange={onChecklistChange}
                    onPhotoCapture={handlePhotoCapture}
                    failedPhotos={failedPhotos}
                    onPhotoRetry={handlePhotoRetry}
                    onPhotoDiscard={handlePhotoDiscard}
                    onContinue={() => setStage('review')}
                />
            ) : null}

            {stage === 'review' ? (
                <ReviewScreen
                    items={context.checklist}
                    values={values}
                    gps={gps}
                    gpsFallbackUsed={gpsFallbackUsed}
                    onBack={() => setStage('checklist')}
                    onContinue={() => setStage('decision')}
                />
            ) : null}

            {stage === 'decision' ? (
                <DecisionScreen
                    decision={decision}
                    summary={decisionSummary}
                    findings={criticalFindings}
                    submitting={submittingDecision}
                    onDecisionChange={setDecision}
                    onSummaryChange={setDecisionSummary}
                    onFindingsChange={setCriticalFindings}
                    onBack={() => setStage('review')}
                    onSubmit={submitDecision}
                />
            ) : null}

            {stage === 'done' ? <DoneScreen /> : null}
        </div>
    );
}

// ── Sub-screens ───────────────────────────────────────────────────────

function ContextHeader({
    appNo,
    applicant,
    farmAddress,
    stage,
}: {
    appNo: string;
    applicant: string;
    farmAddress: string;
    stage: Stage;
}) {
    const stageLabel: Record<Stage, string> = {
        loading: 'โหลด',
        start: '1 · เริ่มตรวจ',
        checklist: '2 · ตรวจรายการ',
        review: '3 · ทบทวน',
        decision: '4 · ตัดสินผล',
        done: '5 · เสร็จสิ้น',
    };
    return (
        <header className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold text-leaf-700">
                {stageLabel[stage]}
            </p>
            <h1 className="mt-1 text-lg font-bold text-slate-900 md:text-xl">
                คำขอ {appNo}
            </h1>
            <p className="text-sm text-slate-600">{applicant}</p>
            <p className="mt-1 text-xs text-slate-500">{farmAddress}</p>
        </header>
    );
}

function StartScreen({
    onStart,
    loading,
    error,
    farmCoordinatesAvailable,
    onUseFarmCoordinates,
}: {
    onStart: () => void;
    loading: boolean;
    error: string | null;
    /**
     * Whether the farm has registered lat/lng in its application form.
     * Drives whether the DM-4 fallback button is visible. False means
     * the legacy application predates the location-data field and the
     * auditor must rely on live GPS (or contact admin).
     */
    farmCoordinatesAvailable: boolean;
    /**
     * V3-B DM-4: invoked when the auditor explicitly chooses to use
     * the farm's registered address coordinates instead of live GPS.
     * Only surfaced after a GPS error so the happy path stays unchanged.
     */
    onUseFarmCoordinates: () => void;
}) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">พร้อมเริ่มตรวจประเมินภาคสนาม?</h2>
            <p className="mt-2 text-sm text-slate-600">
                ระบบจะบันทึกพิกัด GPS ของจุดที่คุณยืนอยู่เพื่อยืนยันการตรวจ ณ สถานที่จริง
            </p>
            <button
                type="button"
                onClick={onStart}
                disabled={loading}
                className="mt-6 inline-flex h-14 w-full items-center justify-center rounded-xl bg-leaf-700 px-6 text-base font-bold text-white shadow-sm transition-colors hover:bg-leaf-800 disabled:bg-leaf-300 md:w-auto md:min-w-[280px]"
            >
                {loading ? 'กำลังอ่านพิกัด…' : 'เริ่มตรวจ'}
            </button>
            {error ? (
                <div
                    role="alert"
                    className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-left text-sm text-rose-800"
                >
                    <p className="font-medium">{error}</p>
                    {farmCoordinatesAvailable ? (
                        <>
                            <p className="mt-2 text-xs text-rose-700">
                                หากอยู่ในโรงเรือนหรือพื้นที่สัญญาณอ่อน
                                สามารถใช้พิกัดที่ลงทะเบียนไว้ในใบสมัครแทนได้
                            </p>
                            {/* X3-FIX-A / S-NEW-2 (sub-fix) — explicit
                                min-h-[44px] + min-w-[44px] WCAG 2.5.5
                                touch target. The fallback button is the
                                last-resort affordance after GPS denial,
                                so a fat-finger miss on a tablet shouldn't
                                strand the auditor mid-inspection. */}
                            <button
                                type="button"
                                onClick={onUseFarmCoordinates}
                                disabled={loading}
                                data-testid="gps-fallback-button"
                                className="mt-3 inline-flex min-h-[44px] w-full min-w-[44px] items-center justify-center rounded-lg border-2 border-amber-500 bg-amber-50 px-4 text-sm font-bold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 disabled:opacity-60 md:w-auto md:min-w-[260px]"
                            >
                                ใช้พิกัดที่อยู่ฟาร์มแทน
                            </button>
                        </>
                    ) : (
                        <p className="mt-2 text-xs text-rose-700">
                            ฟาร์มยังไม่ได้บันทึกพิกัดในใบสมัคร
                            ติดต่อผู้ดูแลระบบเพื่อขอความช่วยเหลือ
                        </p>
                    )}
                </div>
            ) : null}
        </section>
    );
}

function ChecklistScreen({
    items,
    values,
    progress,
    onChange,
    onPhotoCapture,
    failedPhotos,
    onPhotoRetry,
    onPhotoDiscard,
    onContinue,
}: {
    items: OnsiteContext['checklist'];
    values: Record<string, ChecklistItemValue>;
    progress: { done: number; total: number };
    onChange: (itemId: string, next: ChecklistItemValue) => void;
    onPhotoCapture: (itemId: string, files: FileList) => void | Promise<void>;
    failedPhotos: Record<string, FailedPhoto[]>;
    onPhotoRetry: (itemId: string, failedId: string) => void | Promise<void>;
    onPhotoDiscard: (itemId: string, failedId: string) => void;
    onContinue: () => void;
}) {
    const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
    const allDone = progress.done === progress.total;
    return (
        <section className="space-y-4">
            <div className="sticky top-0 z-10 -mx-4 bg-slate-50 px-4 py-3 md:rounded-lg md:px-4">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-700">
                        ความคืบหน้า {progress.done}/{progress.total}
                    </p>
                    <span className="text-xs font-bold text-leaf-700">{pct}%</span>
                </div>
                {/* X3-FIX-A / M-8 — promote the inert visual bar to a
                    proper ARIA progressbar. Previously screen-readers
                    only heard the surrounding text ("ความคืบหน้า X/Y")
                    + the bare "{pct}%" — they couldn't track the bar's
                    underlying meter semantics. role + valuenow/min/max
                    is the W3C-canonical pattern. The inner emerald fill
                    stays aria-hidden because the role + values on the
                    outer track now carry the full announcement. */}
                <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="ความคืบหน้าการตรวจ / Inspection progress"
                    data-testid="inspect-progress-bar"
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"
                >
                    <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                        aria-hidden="true"
                    />
                </div>
            </div>

            <div className="space-y-3 md:space-y-4">
                {items.map((item, idx) => (
                    <div key={item.itemId} className="space-y-2">
                        <ChecklistItem
                            itemId={item.itemId}
                            index={idx + 1}
                            title={item.title}
                            description={item.description}
                            {...(item.category !== undefined ? { category: item.category } : {})}
                            {...(item.required !== undefined ? { required: item.required } : {})}
                            value={values[item.itemId] || emptyValue()}
                            onChange={(next) => onChange(item.itemId, next)}
                            onPhotoCapture={(files) => onPhotoCapture(item.itemId, files)}
                        />
                        {(failedPhotos[item.itemId] || []).length > 0 ? (
                            <div
                                role="alert"
                                data-testid={`failed-photos-${item.itemId}`}
                                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                            >
                                <p className="font-semibold">
                                    อัปโหลดภาพไม่สำเร็จ ({(failedPhotos[item.itemId] || []).length})
                                </p>
                                <ul className="mt-2 space-y-2">
                                    {(failedPhotos[item.itemId] || []).map((fp) => (
                                        <li
                                            key={fp.id}
                                            className="flex flex-col gap-2 rounded-md border border-amber-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-xs font-medium text-slate-800">
                                                    {fp.file.name}
                                                </p>
                                                <p className="truncate text-[11px] text-slate-500">
                                                    {fp.error}
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => onPhotoRetry(item.itemId, fp.id)}
                                                    data-testid={`retry-photo-${fp.id}`}
                                                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-amber-500 bg-amber-100 px-3 text-xs font-bold text-amber-900 hover:bg-amber-200 sm:flex-none"
                                                >
                                                    ลองอีกครั้ง
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onPhotoDiscard(item.itemId, fp.id)}
                                                    data-testid={`discard-photo-${fp.id}`}
                                                    className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
                                                    aria-label="ยกเลิกภาพนี้"
                                                >
                                                    ยกเลิก
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={onContinue}
                disabled={!allDone}
                className={cn(
                    'inline-flex h-14 w-full items-center justify-center rounded-xl px-6 text-base font-bold shadow-sm transition-colors',
                    allDone
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-slate-200 text-slate-500',
                )}
            >
                {allDone
                    ? 'ทบทวนผลการตรวจ'
                    : `ตรวจให้ครบก่อน (เหลือ ${progress.total - progress.done} ข้อ)`}
            </button>
        </section>
    );
}

function ReviewScreen({
    items,
    values,
    gps,
    gpsFallbackUsed,
    onBack,
    onContinue,
}: {
    items: OnsiteContext['checklist'];
    values: Record<string, ChecklistItemValue>;
    gps: GpsPayload | null;
    /**
     * V3-B DM-4: surfaces a visible badge on the review screen so the
     * auditor (and the downstream reviewer) can see that the start
     * GPS came from the farm's registered coordinates, not a live
     * fix. The audit-trail flag is kept locally — wiring it through
     * the backend's fraud-detection signal is a future iteration.
     */
    gpsFallbackUsed: boolean;
    onBack: () => void;
    onContinue: () => void;
}) {
    const summary = {
        yes: items.filter((i) => values[i.itemId]?.answer === 'YES').length,
        no: items.filter((i) => values[i.itemId]?.answer === 'NO').length,
        na: items.filter((i) => values[i.itemId]?.answer === 'NA').length,
    };
    const totalPhotos = items.reduce(
        (acc, i) => acc + (values[i.itemId]?.photos.length || 0),
        0,
    );
    const mapViewerUrl = gps ? resolveMapViewerUrl(gps.latitude, gps.longitude) : null;
    return (
        <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">สรุปผลการตรวจ</h2>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <SummaryCell label="ใช่" value={summary.yes} tone="emerald" />
                    <SummaryCell label="ไม่ใช่" value={summary.no} tone="rose" />
                    <SummaryCell label="ไม่เกี่ยวข้อง" value={summary.na} tone="slate" />
                </dl>
                <p className="mt-3 text-xs text-slate-500">
                    ภาพถ่ายหลักฐานทั้งหมด {totalPhotos} ภาพ
                </p>
            </div>

            {gps ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">พิกัดเริ่มตรวจ</h3>
                        {gpsFallbackUsed ? (
                            <span
                                data-testid="gps-fallback-badge"
                                className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                            >
                                ใช้พิกัดที่อยู่ฟาร์ม
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-1 select-all font-mono text-xs text-slate-600">
                        {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)}
                        {gpsFallbackUsed
                            ? ' · พิกัดที่ลงทะเบียน'
                            : ` · ความแม่นยำ ±${gps.accuracy.toFixed(0)}ม.`}
                    </p>
                    {/* "เปิดดูในแผนที่" used to point at openstreetmap.org with the
                        farm's exact coordinates in the URL. Clicking it handed a
                        foreign map operator the precise location of a Thai farm
                        under audit, plus the auditor's IP. The link now renders
                        only when the operator has configured a map they control
                        (NEXT_PUBLIC_MAP_VIEWER_URL); otherwise the coordinates
                        above are selectable and the auditor can use whatever tool
                        they already have on their own device. */}
                    {mapViewerUrl ? (
                        <a
                            href={mapViewerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block text-xs font-semibold text-leaf-700 underline"
                        >
                            เปิดดูในแผนที่
                        </a>
                    ) : null}
                </div>
            ) : null}

            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">รายการตรวจ</h3>
                <ul className="divide-y divide-slate-100">
                    {items.map((i, idx) => {
                        const v = values[i.itemId];
                        return (
                            <li key={i.itemId} className="flex items-start gap-3 py-2">
                                <span className="mt-0.5 text-xs font-bold text-slate-400">
                                    {idx + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-slate-800">
                                        {i.title}
                                    </p>
                                    {v?.notes ? (
                                        <p className="text-xs text-slate-500">{v.notes}</p>
                                    ) : null}
                                </div>
                                <span
                                    className={cn(
                                        'shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                                        v?.answer === 'YES'
                                            && 'border-leaf-300 bg-leaf-soft text-leaf-onSoft',
                                        v?.answer === 'NO'
                                            && 'border-rose-300 bg-rose-50 text-rose-800',
                                        v?.answer === 'NA'
                                            && 'border-slate-300 bg-slate-100 text-slate-700',
                                    )}
                                >
                                    {v?.answer || '-'}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-between">
                <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700"
                >
                    กลับไปแก้ไข
                </button>
                <button
                    type="button"
                    onClick={onContinue}
                    className="inline-flex h-12 items-center justify-center rounded-lg bg-leaf-700 px-6 text-sm font-bold text-white"
                >
                    ไปที่หน้าตัดสินผล
                </button>
            </div>
        </section>
    );
}

function SummaryCell({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone: 'emerald' | 'rose' | 'slate';
}) {
    const toneCls =
        tone === 'emerald'
            ? 'bg-leaf-soft text-leaf-onSoft'
            : tone === 'rose'
                ? 'bg-rose-50 text-rose-800'
                : 'bg-slate-100 text-slate-700';
    return (
        <div className={cn('rounded-lg p-3', toneCls)}>
            <dt className="text-xs font-semibold">{label}</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
        </div>
    );
}

function DecisionScreen({
    decision,
    summary,
    findings,
    submitting,
    onDecisionChange,
    onSummaryChange,
    onFindingsChange,
    onBack,
    onSubmit,
}: {
    decision: AuditDecisionValue;
    summary: string;
    findings: string[];
    submitting: boolean;
    onDecisionChange: (d: AuditDecisionValue) => void;
    onSummaryChange: (s: string) => void;
    onFindingsChange: (f: string[]) => void;
    onBack: () => void;
    onSubmit: () => void;
}) {
    const updateFinding = (idx: number, val: string) => {
        const next = [...findings];
        next[idx] = val;
        onFindingsChange(next);
    };
    const addFinding = () => onFindingsChange([...findings, '']);
    const removeFinding = (idx: number) =>
        onFindingsChange(findings.filter((_, i) => i !== idx));

    return (
        <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900">ตัดสินผลการตรวจ</h2>
                <fieldset className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                    <legend className="sr-only">เลือกผลการตัดสิน</legend>
                    {(
                        [
                            { value: 'PASS', label: 'ผ่าน', tone: 'emerald' },
                            { value: 'NEEDS_REVIEW', label: 'ต้องทบทวน', tone: 'amber' },
                            { value: 'FAIL', label: 'ไม่ผ่าน', tone: 'rose' },
                        ] as Array<{ value: AuditDecisionValue; label: string; tone: string }>
                    ).map((opt) => {
                        const active = decision === opt.value;
                        const toneCls =
                            opt.tone === 'emerald'
                                ? active
                                    ? 'border-leaf-700 bg-leaf-soft text-leaf-onSoft'
                                    : 'border-slate-300 bg-white text-slate-700'
                                : opt.tone === 'amber'
                                    ? active
                                        ? 'border-amber-600 bg-amber-50 text-amber-800'
                                        : 'border-slate-300 bg-white text-slate-700'
                                    : active
                                        ? 'border-rose-600 bg-rose-50 text-rose-800'
                                        : 'border-slate-300 bg-white text-slate-700';
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => onDecisionChange(opt.value)}
                                className={cn(
                                    'min-h-[52px] rounded-lg border-2 px-3 py-2 text-base font-semibold transition-colors',
                                    toneCls,
                                )}
                                aria-pressed={active}
                            >
                                {opt.label}
                            </button>
                        );
                    })}
                </fieldset>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <label className="block">
                    <span className="text-sm font-semibold text-slate-900">สรุปผลการตรวจ</span>
                    <textarea
                        value={summary}
                        onChange={(e) => onSummaryChange(e.target.value)}
                        rows={4}
                        placeholder="สรุปผลการตรวจประเมินภาคสนาม"
                        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600"
                    />
                </label>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">
                        ข้อค้นพบสำคัญ (Critical Findings)
                    </h3>
                    <button
                        type="button"
                        onClick={addFinding}
                        className="text-xs font-semibold text-leaf-700 underline"
                    >
                        เพิ่มรายการ
                    </button>
                </div>
                <ul className="mt-3 space-y-2">
                    {findings.map((f, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                            <textarea
                                value={f}
                                onChange={(e) => updateFinding(idx, e.target.value)}
                                rows={2}
                                placeholder="ระบุข้อค้นพบ"
                                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            />
                            {findings.length > 1 ? (
                                <button
                                    type="button"
                                    onClick={() => removeFinding(idx)}
                                    // DM-2 (V3-C): WCAG 2.5.5 tap-target ≥ 44×44.
                                    className="inline-flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
                                    aria-label="ลบรายการ"
                                >
                                    ×
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-between">
                <button
                    type="button"
                    onClick={onBack}
                    disabled={submitting}
                    className="inline-flex h-12 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700"
                >
                    กลับไปทบทวน
                </button>
                <button
                    type="button"
                    onClick={onSubmit}
                    disabled={submitting}
                    className="inline-flex h-12 items-center justify-center rounded-lg bg-leaf-700 px-6 text-sm font-bold text-white disabled:bg-leaf-300"
                >
                    {submitting ? 'กำลังส่ง…' : 'ส่งผลการตรวจ'}
                </button>
            </div>
        </section>
    );
}

function DoneScreen() {
    return (
        <section className="rounded-xl border border-leaf-300 bg-leaf-soft p-8 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-leaf-soft text-3xl font-bold text-leaf-onSoft">
                ✓
            </div>
            <h2 className="mt-4 text-xl font-bold text-primary-900">
                ส่งผลการตรวจเรียบร้อย
            </h2>
            <p className="mt-2 text-sm text-leaf-800">
                ระบบจะแจ้งผู้สมัครอัตโนมัติ
            </p>
            {/* X3-FIX-A / H-4 — prominent back-to-queue CTA. Pre-X3 the
                done screen ended on a textual notice with no clear exit
                path, so AUDITOR had to use the browser back button to
                re-reach the queue. Anchored as a real <Link> so it works
                without JS; bilingual label so EN reviewers shadowing the
                TH auditor still recognise the exit. min-h-[44px] enforces
                WCAG 2.5.5 (Apple HIG tap target). */}
            <Link
                href="/provider/audits"
                data-testid="done-screen-back-to-queue"
                className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-leaf-700 px-6 py-3 text-sm font-bold text-white hover:bg-leaf-800"
            >
                กลับไปยังคิวงาน / Back to queue
            </Link>
        </section>
    );
}
