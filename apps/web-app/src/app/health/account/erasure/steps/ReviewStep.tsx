'use client';

import { AlertTriangle, ShieldCheck, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/primitives/card';

/**
 * Step 1 — Review impact (legal-basis disclosure + preservation matrix).
 *
 * Extracted from `client-view.tsx` lines 289-437 per R6-C / R4 review M-2.
 * Pure presentational; orchestrator owns state + navigation.
 */
export interface ReviewStepProps {
    onContinue: () => void;
    onBack: () => void;
}

export function ReviewStep({ onContinue, onBack }: ReviewStepProps) {
    return (
        <Card className="rounded-2xl border-border bg-card">
            <CardHeader className="border-b border-border/50 px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    ขั้นที่ 1 ตรวจสอบผลกระทบ
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
                <p className="text-sm text-muted-foreground">
                    ก่อนเริ่มขั้นตอน กรุณาอ่านสรุปด้านล่างเพื่อเข้าใจว่าระบบ
                    จะลบ ทำให้ไม่สามารถระบุตัวตน หรือเก็บรักษาข้อมูลส่วนใดบ้าง
                    ตามที่กฎหมายกำหนด
                </p>

                <div className="space-y-3">
                    <div className="rounded-xl border border-leaf-300 bg-leaf-soft p-4">
                        <p className="text-sm font-bold text-primary-900">
                            เก็บรักษาตามกฎหมาย (PRESERVED)
                        </p>
                        <p className="mt-1 text-xs text-leaf-800">
                            เก็บไว้ครบถ้วน 7 ปี ตาม ม.87/3 ประมวลรัษฎากร
                            และมาตรา 31 พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-primary-900">
                            <li>
                                <code className="rounded bg-leaf-soft px-1 font-mono">Invoice</code>
                                {' '} ใบกำกับภาษี (ม.86/4 + ม.87/3)
                            </li>
                            <li>
                                <code className="rounded bg-leaf-soft px-1 font-mono">CreditNote</code>
                                {' '} ใบลดหนี้ (ม.86/10 + ม.87/3)
                            </li>
                            <li>
                                <code className="rounded bg-leaf-soft px-1 font-mono">DebitNote</code>
                                {' '} ใบเพิ่มหนี้ (ม.86/9 + ม.87/3)
                            </li>
                            <li>
                                <code className="rounded bg-leaf-soft px-1 font-mono">JournalEntry</code>
                                {' '}/{' '}
                                <code className="rounded bg-leaf-soft px-1 font-mono">JournalLine</code>
                                {' '} สมุดรายวันตาม TFRS for NPAEs
                            </li>
                            <li>
                                <code className="rounded bg-leaf-soft px-1 font-mono">PaymentTransaction</code>
                                {' '} บันทึก gateway / SCB
                            </li>
                            <li>
                                <code className="rounded bg-leaf-soft px-1 font-mono">AuditLog</code>
                                {' '} ห่วงโซ่ตรวจสอบที่แก้ไขไม่ได้
                                (e-Transactions Act §31)
                            </li>
                        </ul>
                    </div>

                    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                        <p className="text-sm font-bold text-sky-900">
                            ทำให้ไม่สามารถระบุตัวตน (ANONYMISED)
                        </p>
                        <p className="mt-1 text-xs text-sky-800">
                            คอลัมน์ PII ถูกลบ แต่แถวยังคงอยู่ (FK
                            ยังเชื่อมโยงกับ Invoice/Certificate
                            เพื่อให้การอ้างอิงไม่ขาด) ตามมาตรา 32 PDPA
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-sky-900">
                            <li>
                                <code className="rounded bg-sky-100 px-1 font-mono">User</code>{' '} ลบ healthId / providerId
                                / idCard / taxId / email / phoneNumber /
                                ที่อยู่ / companyName / representativeName
                                / communityName, ตั้ง firstName + lastName เป็นค่ามาตรฐาน
                                {' '}<code className="rounded bg-sky-100 px-1 font-mono">PDPA_ERASED</code>{' '}
                                และล้างรหัสผ่าน + 2FA
                            </li>
                            <li>
                                <code className="rounded bg-sky-100 px-1 font-mono">Application.formData</code>
                                {' '} ลบเฉพาะฟิลด์ PII (applicantName,
                                applicantPhone, applicantEmail, applicantAddress,
                                thaiId, nationalId, …) ส่วนข้อมูลไม่ระบุตัวตน
                                (areaSize, cropType) ยังคงอยู่
                            </li>
                            <li>
                                <code className="rounded bg-sky-100 px-1 font-mono">Certificate</code>
                                {' '} ลบ applicantName + address แต่
                                เลขที่ใบรับรอง + farmId + วันที่ยังอยู่ เพื่อ
                                ให้ระบบตรวจสอบ QR ยังยืนยันความถูกต้องของใบรับรองได้
                            </li>
                        </ul>
                    </div>

                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                        <p className="text-sm font-bold text-rose-900">
                            ลบถาวร (ERASED)
                        </p>
                        <p className="mt-1 text-xs text-rose-800">
                            ลบออกจากฐานข้อมูลถาวร ไม่มีหน้าที่ตามกฎหมายให้เก็บรักษา
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-900">
                            <li>
                                <code className="rounded bg-rose-100 px-1 font-mono">ApplicationDraft</code>
                                {' '} ร่างคำขอ ไม่มีอายุการเก็บรักษา
                            </li>
                            <li>
                                <code className="rounded bg-rose-100 px-1 font-mono">Notification</code>
                                {' '} การแจ้งเตือนเฉพาะผู้ใช้
                            </li>
                            <li>
                                Session tokens / refresh tokens / consent cookies
                            </li>
                        </ul>
                    </div>

                    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                            <p className="font-bold">หน้าต่างยืนยัน 24 ชั่วโมง</p>
                            <p className="text-xs">
                                เมื่อส่งคำขอแล้ว ระบบจะส่งการแจ้งเตือนพร้อมลิงก์ยืนยันในระบบ
                                ลิงก์มีอายุ 24 ชั่วโมง หลังจากนั้นจะหมดอายุ
                                และต้องเริ่มคำขอใหม่ มาตรการนี้ป้องกันการลบบัญชีจากการคลิกเดียวที่ไม่ได้ตั้งใจ
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={onBack}
                    >
                        ย้อนกลับ
                    </Button>
                    <Button
                        variant="destructive"
                        className="rounded-xl"
                        onClick={onContinue}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        ดำเนินการต่อ
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
