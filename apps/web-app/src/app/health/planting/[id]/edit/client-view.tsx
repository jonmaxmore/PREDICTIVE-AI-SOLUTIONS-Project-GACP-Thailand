'use client';

/**
 * แก้ไขรอบปลูก — T2
 *
 * หน้านี้ไม่เคยมี: `updateCycle()` อยู่ในโค้ดฝั่งเว็บมาตลอดโดยไม่มีใครเรียก ⇒ กติกา
 * "แก้ได้จนตัด แล้วแช่แข็ง" (R11/R12) ไม่เคยถูกใช้จากเบราว์เซอร์เลย
 *
 * หลักของหน้านี้: **บอกก่อนพิมพ์ ไม่ใช่ปฏิเสธหลังกด** — ถ้ารอบปลูกถูกตัดแล้ว ช่องที่
 * แก้ไม่ได้จะอ่านอย่างเดียวตั้งแต่แรก พร้อมเหตุผลว่าทำไม ไม่ใช่ปล่อยให้กรอกจนเสร็จ
 * แล้วค่อยตอบ 409
 *
 * กติกาทั้งหมดอยู่ใน edit-cycle-state.ts — ที่นี่มีแต่การวาด
 */

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { plantingService } from '@/lib/services/planting-service';
import { IRRIGATION_OPTIONS, SOIL_TYPE_OPTIONS } from '@/constants/options';
import {
    pageState, buildPatch, saveState, frozenRefusalMessage,
    FIELD_LABEL_TH, FROZEN_AFTER_CUT,
    type Cycle,
} from './edit-cycle-state';

const FREEZE_REASON_TH: Record<string, string> = {
    HARVESTED: 'รอบปลูกนี้เก็บเกี่ยวเสร็จแล้ว',
    HAS_BATCHES: 'รอบปลูกนี้มีรุ่นเก็บเกี่ยวแล้ว',
};

export default function ClientView() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const cycleId = String(params?.id || '');

    const [cycle, setCycle] = React.useState<Cycle | null>(null);
    const [draft, setDraft] = React.useState<Partial<Cycle>>({});
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState(false);
    const [inFlight, setInFlight] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [saved, setSaved] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await plantingService.getCycleById(cycleId);
            if (cancelled) { return; }
            if (!res.success || !res.data) { setLoadError(true); setCycle(null); }
            else { setLoadError(false); setCycle(res.data as Cycle); }
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [cycleId]);

    const state = pageState({ loading, error: loadError, cycle });
    const frozen = state.kind === 'frozen';
    const patch = state.kind === 'editable' || state.kind === 'frozen'
        ? buildPatch(state.cycle, draft, frozen)
        : {};
    const gate = saveState(patch, inFlight);

    const onSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!gate.canSave) { return; }
        setInFlight(true); setError(null); setSaved(false);
        const res = await plantingService.updateCycle(cycleId, patch as Record<string, unknown>);
        setInFlight(false);
        if (!res.success) {
            // ตาข่ายชั้นสองสำหรับ CYCLE_FROZEN 409 — ประตูส่ง `fields` (คีย์อังกฤษ) มาใน
            // `res.meta.fields` · ถ้ามี ให้เขียนข้อความเองโดยแปลชื่อฟิลด์เป็นไทย ไม่ใช่โชว์
            // ข้อความดิบของประตูที่มีคีย์อังกฤษปนอยู่ · ที่เหลือใช้เหตุผลไทยที่ประตูส่งมา
            const frozenMsg = frozenRefusalMessage((res.meta as { fields?: unknown } | undefined)?.fields);
            setError(frozenMsg || res.error || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
            return;
        }
        setSaved(true);
        setDraft({});
        router.refresh();
    };

    if (state.kind === 'loading') {
        return <p className="p-4 text-sm text-muted-foreground">กำลังโหลด…</p>;
    }

    if (state.kind === 'unreadable') {
        return (
            <p role="status" data-testid="cycle-unreadable" className="p-4 text-sm text-amber-700">
                ตอนนี้ระบบอ่านข้อมูลรอบปลูกนี้ไม่ได้ — ไม่ได้แปลว่าไม่มีข้อมูล กรุณาลองใหม่อีกครั้ง
            </p>
        );
    }

/**
 * ช่องที่มีชุดคำมาตรฐานอยู่แล้ว — ตัวเลือกชุดเดียวกับวิซาร์ดคำขอ (constants/options.ts)
 * หน้านี้เคยเป็นช่องกรอกอิสระทั้งหมด (operator 2026-09-07: "ไม่ได้มีตัวเลือก และเป็นแบบ
 * กรอกหมดเลยหรอ") · ใช้ datalist ไม่ใช่ select เพราะค่าที่บันทึกไว้ก่อนหน้านี้เป็นคำอิสระ
 * และต้องยังแสดง/แก้ได้ ไม่ถูกบังคับให้หายไป
 */
const FIELD_DATALIST: Record<string, string> = {
    soilType: 'soil-type-options',
    irrigationType: 'irrigation-options',
};

    const value = (key: keyof Cycle) => String(draft[key] ?? state.cycle[key] ?? '');
    const set = (key: keyof Cycle) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft((d) => ({ ...d, [key]: ev.target.value }));

    return (
        <form onSubmit={onSave} className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4">
            <header className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold">แก้ไขรอบปลูก</h1>
                {frozen ? (
                    <p data-testid="cycle-frozen-notice" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        {FREEZE_REASON_TH[state.reason]} — ข้อมูลที่แสดงบนหน้าตรวจสอบย้อนกลับที่ผู้ซื้อสแกนดูได้
                        จึงแก้ไม่ได้แล้ว หากต้องแก้ไข กรุณาติดต่อเจ้าหน้าที่ · บันทึกภายในยังแก้ได้
                    </p>
                ) : (
                    <p className="text-sm text-muted-foreground">แก้ไขได้จนถึงวันเก็บเกี่ยว</p>
                )}
            </header>

            {(['cycleName', ...FROZEN_AFTER_CUT] as (keyof Cycle)[]).map((key) => (
                <label key={String(key)} className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">
                        {FIELD_LABEL_TH[String(key)]}
                        {frozen && <span className="ml-2 text-xs font-normal text-amber-800">แก้ไม่ได้แล้ว</span>}
                    </span>
                    <input
                        type="text" value={value(key)} onChange={set(key)}
                        readOnly={frozen} disabled={frozen}
                        data-testid={`cycle-${String(key)}`}
                        list={FIELD_DATALIST[String(key)] || undefined}
                        className="rounded border px-2 py-1 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                </label>
            ))}

            <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                    {FIELD_LABEL_TH.notes}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ไม่แสดงบนหน้าตรวจสอบย้อนกลับ
                    </span>
                </span>
                <textarea
                    value={value('notes')} onChange={set('notes')} rows={3}
                    data-testid="cycle-notes" className="rounded border px-2 py-1"
                />
            </label>

            <datalist id="soil-type-options">
                {SOIL_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.label} />))}
            </datalist>
            <datalist id="irrigation-options">
                {IRRIGATION_OPTIONS.map((o) => (<option key={o.value} value={o.label} />))}
            </datalist>

            {error && <p role="alert" data-testid="cycle-error" className="text-sm text-red-600">{error}</p>}
            {saved && <p role="status" data-testid="cycle-saved" className="text-sm text-green-700">บันทึกแล้ว</p>}

            <button
                type="submit" disabled={!gate.canSave} data-testid="cycle-save"
                className="self-start rounded bg-green-700 px-4 py-2 text-white disabled:opacity-50"
            >
                {inFlight ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
        </form>
    );
}
