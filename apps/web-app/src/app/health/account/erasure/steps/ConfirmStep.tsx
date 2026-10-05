'use client';

import { AlertTriangle, Loader2, ShieldCheck, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';

/**
 * Step 3 — Confirm with token (requestId + token entry, supports URL pre-fill).
 *
 * Extracted from `client-view.tsx` lines 570-666 per R6-C / R4 review M-2.
 * Pure presentational; orchestrator owns state + service calls.
 *
 * URL pre-fill: when `hasUrlPrefill` is true, both inputs render readOnly
 * and the helper text is swapped — mirrors the R4-D self-report design.
 */
export interface ConfirmStepProps {
    requestId: string;
    token: string;
    onChangeRequestId: (next: string) => void;
    onChangeToken: (next: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
    submitting: boolean;
    hasUrlPrefill: boolean;
}

export function ConfirmStep({
    requestId,
    token,
    onChangeRequestId,
    onChangeToken,
    onConfirm,
    onCancel,
    submitting,
    hasUrlPrefill,
}: ConfirmStepProps) {
    return (
        <Card className="rounded-2xl border-destructive/30 bg-card">
            <CardHeader className="border-b border-destructive/20 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-destructive">
                    <ShieldCheck className="h-4 w-4" />
                    ขั้นที่ 3 ยืนยันด้วยลิงก์ในการแจ้งเตือน
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
                <p className="text-sm text-muted-foreground">
                    {hasUrlPrefill
                        ? 'ระบบดึงข้อมูลจากลิงก์ในการแจ้งเตือนของท่านแล้ว กดยืนยันลบบัญชีเพื่อดำเนินการ'
                        : 'กรอกหมายเลขคำขอและรหัสยืนยันที่ได้รับจากการแจ้งเตือนในระบบ'}
                </p>

                <div>
                    <label
                        htmlFor="erasure-request-id"
                        className="mb-1 block text-sm font-medium text-foreground"
                    >
                        หมายเลขคำขอ
                        <span className="text-destructive">*</span>
                    </label>
                    <Input
                        id="erasure-request-id"
                        type="text"
                        value={requestId}
                        onChange={(e) => onChangeRequestId(e.target.value)}
                        placeholder="pdpa-er-xxxxxxxxxxxxxxxx"
                        disabled={submitting || hasUrlPrefill}
                        readOnly={hasUrlPrefill}
                        autoComplete="off"
                        className="font-mono"
                    />
                </div>

                <div>
                    <label
                        htmlFor="erasure-token"
                        className="mb-1 block text-sm font-medium text-foreground"
                    >
                        รหัสยืนยัน
                        <span className="text-destructive">*</span>
                    </label>
                    <Input
                        id="erasure-token"
                        type="text"
                        value={token}
                        onChange={(e) => onChangeToken(e.target.value)}
                        placeholder="32 ตัวอักษร hex (ได้รับจากการแจ้งเตือนในระบบ)"
                        disabled={submitting || hasUrlPrefill}
                        readOnly={hasUrlPrefill}
                        autoComplete="off"
                        className="font-mono"
                    />
                </div>

                <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                        <strong>คำเตือน:</strong>{' '}
                        เมื่อกดยืนยัน ระบบจะทำให้บัญชีของท่านไม่สามารถระบุตัวตนได้
                        (soft-delete + anonymise) ข้อมูล PII จะถูกล้าง
                        แต่ระเบียนทางบัญชี/ใบรับรองที่กฎหมายกำหนดให้เก็บ
                        (ตาม ม.87/3 ป.รัษฎากร) ยังคงอยู่ การดำเนินการนี้
                        ไม่สามารถย้อนกลับได้
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={onCancel}
                        disabled={submitting || !requestId}
                    >
                        {submitting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        ยกเลิกคำขอ
                    </Button>
                    <Button
                        variant="destructive"
                        className="rounded-xl"
                        onClick={onConfirm}
                        disabled={submitting || !requestId || !token}
                    >
                        {submitting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        ยืนยันลบบัญชี
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
