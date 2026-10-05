'use client';

import { ShieldCheck } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/primitives/card';

/**
 * Always-visible legal-basis footer (PDPA + Revenue Code citation).
 *
 * Extracted from `client-view.tsx` lines 770-789 per R6-C / R4 review M-2.
 * Pure JSX; no props.
 */
export function LegalFooter() {
    return (
        <Card className="rounded-2xl border-border bg-muted/30">
            <CardContent className="space-y-2 p-5">
                <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    อ้างอิงทางกฎหมาย
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                    พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA){' '}
                     มาตรา 32 ให้สิทธิเจ้าของข้อมูลขอให้ลบหรือทำลายข้อมูล
                    หรือทำให้ข้อมูลส่วนบุคคลไม่สามารถระบุตัวบุคคลได้
                    เมื่อหมดความจำเป็นในการเก็บรักษาหรือเมื่อถอนความยินยอม
                    ทั้งนี้ มาตรา 24(6) ระบุว่าหน้าที่ตามกฎหมายอื่นมีผลเหนือ
                    สิทธิตามมาตรา 32 ระเบียนทางบัญชี/ภาษีที่ต้องเก็บตาม
                    ม.87/3 ประมวลรัษฎากร (≥ 5 ปี ตามคำแนะนำกรมสรรพากร
                    และ TFRS for NPAEs โดยเก็บจริง 7 ปี){' '}
                    จึงยังคงอยู่หลังการลบบัญชี ใบรับรอง GACP ยังเก็บไว้
                    ตามระเบียบกรมการแพทย์แผนไทย (5 ปีหลังหมดอายุ)
                </p>
            </CardContent>
        </Card>
    );
}
