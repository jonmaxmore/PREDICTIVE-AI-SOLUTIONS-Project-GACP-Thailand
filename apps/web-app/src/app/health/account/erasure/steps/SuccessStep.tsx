'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/primitives/card';
import type { ErasureSummary } from '@/lib/services/pdpa-erasure-service';

/**
 * Step 4 — Success summary (post-confirm, with logout countdown).
 *
 * Extracted from `client-view.tsx` lines 670-767 per R6-C / R4 review M-2.
 * Pure presentational; orchestrator owns state + countdown effect.
 *
 * Helper `formatThaiDateTime` copied verbatim from client-view.tsx per
 * R3-B "copy don't import" precedent — keeps file deps flat.
 */
const THAI_MONTHS = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function formatThaiDateTime(iso: string | null | undefined): string {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543} เวลา ${hh}:${mm} น.`;
}

export interface SuccessStepProps {
    summary: ErasureSummary;
    preservedTables: ReadonlyArray<string>;
    countdown: number;
}

export function SuccessStep({
    summary,
    preservedTables,
    countdown,
}: SuccessStepProps) {
    return (
        <Card className="rounded-2xl border-leaf-300 bg-card">
            <CardHeader className="border-b border-leaf-300 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-primary-900">
                    <CheckCircle2 className="h-4 w-4" />
                    คำขอลบบัญชีเสร็จสมบูรณ์
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
                <p className="text-sm text-muted-foreground">
                    ระบบดำเนินการเรียบร้อย ข้อมูลส่วนบุคคลของท่านถูก
                    ทำให้ไม่สามารถระบุตัวตนได้แล้ว ตามมาตรา 32 PDPA
                    และระเบียนทางบัญชี/ใบรับรองยังคงเก็บไว้ตาม ม.87/3 ป.รัษฎากร
                </p>

                <dl className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted/30 p-4 text-xs sm:grid-cols-3">
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            บัญชีหลัก
                        </dt>
                        <dd className="mt-1 text-foreground">
                            {summary.anonymized.user
                                ? 'ทำให้ไม่ระบุตัวตนแล้ว'
                                : 'ไม่มีการเปลี่ยนแปลง'}
                        </dd>
                    </div>
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            คำขอที่ถูกล้าง
                        </dt>
                        <dd className="mt-1 text-foreground">
                            {summary.anonymized.applications.toLocaleString('th-TH')} รายการ
                        </dd>
                    </div>
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            ใบรับรองที่ถูกล้าง
                        </dt>
                        <dd className="mt-1 text-foreground">
                            {summary.anonymized.certificates.toLocaleString('th-TH')} รายการ
                        </dd>
                    </div>
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            ร่างคำขอที่ลบ
                        </dt>
                        <dd className="mt-1 text-foreground">
                            {summary.erased.applicationDrafts.toLocaleString('th-TH')} รายการ
                        </dd>
                    </div>
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            การแจ้งเตือนที่ลบ
                        </dt>
                        <dd className="mt-1 text-foreground">
                            {summary.erased.notifications.toLocaleString('th-TH')} รายการ
                        </dd>
                    </div>
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            ดำเนินการเมื่อ
                        </dt>
                        <dd className="mt-1 text-foreground">
                            {formatThaiDateTime(summary.executedAt)}
                        </dd>
                    </div>
                </dl>

                <div className="rounded-xl border border-leaf-300 bg-leaf-soft p-4">
                    <p className="text-sm font-bold text-primary-900">
                        ตารางที่ยังเก็บไว้ตามกฎหมาย
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-primary-900">
                        {preservedTables.map((name) => (
                            <li key={name}>
                                <code className="rounded bg-leaf-soft px-1 font-mono">
                                    {name}
                                </code>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-3 text-xs text-leaf-800">
                        อ้างอิง: PDPA ม.32, ม.87/3 ป.รัษฎากร,
                        พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544 §31
                    </p>
                </div>

                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                        ระบบจะออกจากระบบในอีก{' '}
                        <strong>{countdown}</strong> วินาที
                        ท่านจะถูกพากลับไปหน้าหลัก
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
