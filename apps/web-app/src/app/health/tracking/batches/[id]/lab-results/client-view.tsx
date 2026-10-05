'use client';

/**
 * แนบผลวิเคราะห์ (COA) ให้รุ่นเก็บเกี่ยว — T10
 *
 * มีช่องอัปโหลดไฟล์กับหัวกระดาษของรายงานเท่านั้น · **ไม่มีช่องกรอกค่า THC/CBD/ความชื้น**
 * ตามมติ operator 2026-09-05: "เราจะไม่ได้พิมพ์บอกค่าเท่าไหร่ เราจะอัพโหลดผลแลป"
 * ไฟล์คือแหล่งความจริงเดียว และการตัดสินผ่าน/ไม่ผ่านเป็นของห้องปฏิบัติการ
 *
 * กติกาของหน้าอยู่ใน lab-results-state.ts ทั้งหมด — ที่นี่มีแต่การวาด
 */

import * as React from 'react';
import { useParams } from 'next/navigation';
import { plantingService } from '@/lib/services/planting-service';
import {
    submitState, reportBadge, listState, MIN_LAB_NAME_LENGTH,
    type LabReport, type UploadForm,
} from './lab-results-state';

const EMPTY_FORM: UploadForm = {
    file: null, labName: '', reportNumber: '', reportedAt: '', verificationCode: '',
};

const REFUSAL_TH: Record<string, string> = {
    NO_FILE: 'กรุณาเลือกไฟล์ผลวิเคราะห์',
    NO_LAB_NAME: `กรุณาระบุชื่อห้องปฏิบัติการ (อย่างน้อย ${MIN_LAB_NAME_LENGTH} ตัวอักษร)`,
    IN_FLIGHT: 'กำลังอัปโหลด กรุณารอสักครู่',
};

export default function ClientView() {
    const params = useParams<{ id: string }>();
    const batchId = String(params?.id || '');

    const [form, setForm] = React.useState<UploadForm>(EMPTY_FORM);
    const [reports, setReports] = React.useState<LabReport[] | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState(false);
    const [inFlight, setInFlight] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        const res = await plantingService.listLabResults(batchId);
        // อ่านไม่ได้ ≠ ไม่มี — สองอย่างนี้ต้องแสดงต่างกัน (tnt-data-scope หลักข้อ 4)
        if (!res.success) { setLoadError(true); setReports(null); }
        else { setLoadError(false); setReports((res.data as LabReport[]) || []); }
        setLoading(false);
    }, [batchId]);

    React.useEffect(() => { void load(); }, [load]);

    const gate = submitState(form, inFlight);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!gate.canSubmit || !form.file) {
            setError(REFUSAL_TH[gate.reason || 'NO_FILE'] || null);
            return;
        }
        setInFlight(true);
        setError(null);
        // ส่งเฉพาะคีย์ที่มีค่าจริง — `exactOptionalPropertyTypes` ถือว่า `undefined`
        // ที่ส่งมากับคีย์ ต่างจากการไม่มีคีย์นั้น และการส่งช่องว่างไปให้ประตูก็ไม่มีความหมาย
        const res = await plantingService.uploadLabResult(batchId, {
            file: form.file,
            labName: form.labName.trim(),
            ...(form.reportNumber.trim() ? { reportNumber: form.reportNumber.trim() } : {}),
            ...(form.reportedAt ? { reportedAt: form.reportedAt } : {}),
            ...(form.verificationCode.trim() ? { verificationCode: form.verificationCode.trim() } : {}),
        });
        setInFlight(false);
        if (!res.success) {
            // ประตูส่งคำปฏิเสธเป็นภาษาไทยมาเองพร้อมสาเหตุ — แสดงของเขา อย่าทับด้วยข้อความกลาง ๆ
            setError(res.error || 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่');
            return;
        }
        setForm(EMPTY_FORM);
        await load();
    };

    const list = listState({ loading, error: loadError, reports });

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
            <header className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold">ผลวิเคราะห์ของรุ่นเก็บเกี่ยว</h1>
                <p className="text-sm text-muted-foreground">
                    แนบใบรายงานผลวิเคราะห์ (COA) ที่ได้จากห้องปฏิบัติการ —
                    ระบบเก็บไฟล์ไว้ทั้งใบ ไม่ต้องพิมพ์ค่าผลตรวจเอง
                </p>
            </header>

            <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg border p-4">
                <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">ไฟล์ผลวิเคราะห์ (PDF หรือรูปถ่าย)</span>
                    <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        data-testid="coa-file"
                        onChange={(ev) => setForm((f) => ({ ...f, file: ev.target.files?.[0] || null }))}
                    />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">ชื่อห้องปฏิบัติการ</span>
                    <input
                        type="text" value={form.labName} data-testid="coa-lab-name"
                        onChange={(ev) => setForm((f) => ({ ...f, labName: ev.target.value }))}
                        className="rounded border px-2 py-1"
                    />
                </label>

                <div className="grid gap-4 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-sm">
                        <span>เลขที่รายงาน</span>
                        <input type="text" value={form.reportNumber} data-testid="coa-report-number"
                            onChange={(ev) => setForm((f) => ({ ...f, reportNumber: ev.target.value }))}
                            className="rounded border px-2 py-1" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span>วันที่ออกรายงาน</span>
                        <input type="date" value={form.reportedAt} data-testid="coa-reported-at"
                            onChange={(ev) => setForm((f) => ({ ...f, reportedAt: ev.target.value }))}
                            className="rounded border px-2 py-1" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                        <span>รหัสตรวจสอบรายงาน</span>
                        <input type="text" value={form.verificationCode} data-testid="coa-verification-code"
                            onChange={(ev) => setForm((f) => ({ ...f, verificationCode: ev.target.value }))}
                            className="rounded border px-2 py-1" />
                    </label>
                </div>

                {error && <p role="alert" data-testid="coa-error" className="text-sm text-red-600">{error}</p>}

                <button
                    type="submit" data-testid="coa-submit" disabled={!gate.canSubmit}
                    className="self-start rounded bg-green-700 px-4 py-2 text-white disabled:opacity-50"
                >
                    {inFlight ? 'กำลังอัปโหลด…' : 'แนบผลวิเคราะห์'}
                </button>
            </form>

            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">รายงานที่แนบไว้</h2>

                {list.kind === 'loading' && <p className="text-sm text-muted-foreground">กำลังโหลด…</p>}

                {list.kind === 'unreadable' && (
                    <p data-testid="coa-unreadable" role="status" className="text-sm text-amber-700">
                        ตอนนี้ระบบอ่านรายการผลวิเคราะห์ไม่ได้ — ไม่ได้แปลว่าไม่มี กรุณาลองใหม่อีกครั้ง
                    </p>
                )}

                {list.kind === 'empty' && (
                    <p data-testid="coa-empty" className="text-sm text-muted-foreground">
                        ยังไม่มีผลวิเคราะห์สำหรับรุ่นนี้
                    </p>
                )}

                {list.kind === 'ready' && (
                    <ul className="flex flex-col gap-3">
                        {list.reports.map((r) => {
                            const badge = reportBadge(r);
                            return (
                                <li key={r.id} className="flex flex-col gap-1 rounded border p-3">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <a href={r.fileUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                                            {r.fileName || 'ใบรายงานผลวิเคราะห์'}
                                        </a>
                                        <span className={badge.tone === 'verified' ? 'text-xs text-green-700' : 'text-xs text-muted-foreground'}>
                                            {badge.labelTH}
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {r.labName}
                                        {r.reportNumber ? ` · เลขที่ ${r.reportNumber}` : ''}
                                        {r.verificationCode ? ` · รหัสตรวจสอบ ${r.verificationCode}` : ''}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
}
