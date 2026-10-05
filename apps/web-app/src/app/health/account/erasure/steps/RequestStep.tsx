'use client';

import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/primitives/card';
import { Textarea } from '@/components/ui/primitives/textarea';

/**
 * Step 2 — Submit request (reason input + submit).
 *
 * Extracted from `client-view.tsx` lines 441-499 per R6-C / R4 review M-2.
 * Pure presentational; orchestrator owns state + service calls.
 */
export interface RequestStepProps {
    reason: string;
    onChangeReason: (next: string) => void;
    onSubmit: () => void;
    onBack: () => void;
    submitting: boolean;
}

export function RequestStep({
    reason,
    onChangeReason,
    onSubmit,
    onBack,
    submitting,
}: RequestStepProps) {
    return (
        <Card className="rounded-2xl border-destructive/30 bg-card">
            <CardHeader className="border-b border-destructive/20 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-destructive">
                    <Trash2 className="h-4 w-4" />
                    ขั้นที่ 2 กรอกเหตุผล + ส่งคำขอ
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
                <p className="text-sm text-muted-foreground">
                    กรุณาระบุเหตุผลที่ต้องการลบบัญชี (ไม่บังคับ)
                    จากนั้นกดส่งคำขอ ระบบจะส่งการแจ้งเตือนพร้อมลิงก์ยืนยันในระบบภายในไม่กี่นาที
                </p>
                <div>
                    <label
                        htmlFor="erasure-reason"
                        className="mb-1 block text-sm font-medium text-foreground"
                    >
                        เหตุผล (ไม่บังคับ สูงสุด 500 ตัวอักษร)
                    </label>
                    <Textarea
                        id="erasure-reason"
                        value={reason}
                        onChange={(e) => onChangeReason(e.target.value)}
                        placeholder="เช่น ไม่ใช้ระบบแล้ว / เปลี่ยนผู้ขอรับรอง / ความเป็นส่วนตัว"
                        maxLength={500}
                        disabled={submitting}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                        ข้อมูลนี้จะถูกบันทึกในประวัติการตรวจสอบ (AuditLog)
                        เพื่อใช้ปรับปรุงระบบเท่านั้น
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={onBack}
                        disabled={submitting}
                    >
                        ย้อนกลับ
                    </Button>
                    <Button
                        variant="destructive"
                        className="rounded-xl"
                        onClick={onSubmit}
                        disabled={submitting}
                    >
                        {submitting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        ส่งคำขอลบบัญชี
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
