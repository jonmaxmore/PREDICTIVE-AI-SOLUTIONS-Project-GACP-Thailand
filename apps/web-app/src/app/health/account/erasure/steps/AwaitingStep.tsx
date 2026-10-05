'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/primitives/card';

/**
 * Step 2.5 — Awaiting state (post-request, pre-confirm interlude).
 *
 * Extracted from `client-view.tsx` lines 503-566 per R6-C / R4 review M-2.
 * Pure presentational; orchestrator owns state + service calls.
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

export interface AwaitingStepProps {
    requestId: string;
    expiresAt: string;
    onCancel: () => void;
    onGotoConfirm: () => void;
    submitting: boolean;
}

export function AwaitingStep({
    requestId,
    expiresAt,
    onCancel,
    onGotoConfirm,
    submitting,
}: AwaitingStepProps) {
    return (
        <Card className="rounded-2xl border-amber-300 bg-card">
            <CardHeader className="border-b border-amber-200 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-amber-900">
                    <AlertTriangle className="h-4 w-4" />
                    ส่งคำขอแล้ว ตรวจสอบการแจ้งเตือนในระบบ
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
                <p className="text-sm text-muted-foreground">
                    ระบบได้ส่งคำขอลบบัญชีของท่านแล้ว
                    กรุณาตรวจสอบการแจ้งเตือนในระบบและกดลิงก์ยืนยันภายใน 24 ชั่วโมง
                </p>

                <dl className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-muted/30 p-4 text-xs sm:grid-cols-2">
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            หมายเลขคำขอ
                        </dt>
                        <dd className="mt-1 break-all font-mono text-foreground">
                            {requestId || '-'}
                        </dd>
                    </div>
                    <div>
                        <dt className="font-bold text-muted-foreground">
                            ลิงก์หมดอายุ
                        </dt>
                        <dd className="mt-1 text-foreground">
                            {formatThaiDateTime(expiresAt)}
                        </dd>
                    </div>
                </dl>

                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                        ตรวจสอบการแจ้งเตือนในระบบและกดลิงก์ยืนยัน หรือกรอกหมายเลขคำขอ
                        + รหัสยืนยันด้านล่างหากต้องการดำเนินการต่อในแท็บนี้
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={onCancel}
                        disabled={submitting}
                    >
                        {submitting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        ยกเลิกคำขอ
                    </Button>
                    <Button
                        variant="destructive"
                        className="rounded-xl"
                        onClick={onGotoConfirm}
                        disabled={submitting}
                    >
                        กรอกรหัสยืนยัน
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
