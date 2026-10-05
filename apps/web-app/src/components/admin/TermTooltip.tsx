'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * TermTooltip — small accessible tooltip for accountant/admin terms.
 *
 * Hover or focus the term to reveal a definition bubble. The native
 * `title` attribute is also set as a fallback for users who tab
 * through with a screen reader and for environments where the
 * tooltip CSS isn't picked up.
 *
 * Example:
 *   <TermTooltip term="งบทดลอง" definition="รายการบัญชีแยกประเภทที่แสดงยอดเดบิตและเครดิตคงเหลือก่อนปิดบัญชี" />
 */

const TERM_GLOSSARY: Record<string, string> = {
    งบทดลอง:
        'รายการบัญชีแยกประเภทที่แสดงยอดเดบิตและเครดิตคงเหลือก่อนปิดบัญชี ใช้ตรวจสอบสมการบัญชี',
    'งบดุล': 'แสดงสินทรัพย์ หนี้สิน และส่วนของเจ้าของ ณ วันที่ใด ๆ',
    'งบกำไรขาดทุน': 'แสดงรายได้และค่าใช้จ่ายในช่วงเวลาหนึ่ง บรรทัดสุดท้ายคือกำไรสุทธิ',
    'AR Aging': 'รายการลูกหนี้ค้างชำระแบ่งตามช่วงอายุหนี้ (0-30, 31-60, 60+ วัน)',
    'CAR': 'Corrective Action Request คำขอให้แก้ไขประเด็นที่พบในการตรวจประเมิน',
    'GACP': 'Good Agricultural and Collection Practices แนวทางปฏิบัติทางการเกษตรที่ดีและการเก็บเกี่ยว',
    'SLA': 'Service Level Agreement กรอบเวลาที่ระบบ/เจ้าหน้าที่ต้องดำเนินการตามมาตรฐาน',
    'Audit Log': 'บันทึกประวัติการกระทำในระบบทั้งหมด ใช้สำหรับตรวจสอบย้อนหลัง',
};

export interface TermTooltipProps {
    /** The term as it appears inline in the document. */
    term: string;
    /** Optional override of the gloss; falls back to TERM_GLOSSARY. */
    definition?: string;
    /** Visually mark the term with a dotted underline. Default true. */
    underline?: boolean;
    className?: string;
}

export function TermTooltip({
    term,
    definition,
    underline = true,
    className,
}: TermTooltipProps) {
    const gloss = definition || TERM_GLOSSARY[term] || term;
    const [open, setOpen] = React.useState(false);

    /**
     * X5-FIX-B H-9: a11y refactor.
     * Previously the outer <span> carried mouse/focus listeners with NO
     * role + the inner <span> claimed role="button" (which fires
     * jsx-a11y/no-static-element-interactions on the outer wrapper and
     * misrepresents the term as a "button" to screen readers — tooltip
     * triggers are definition affordances, not actions).
     *
     * Fix: outer wrapper is now a plain <span> with no listeners. The
     * inner trigger is a <button type="button"> so the mouse + keyboard
     * listeners ride on a native interactive element (Space/Enter
     * activation is free), role="button" is implicit + correct, and
     * aria-describedby continues to wire the tooltip panel.
     */
    return (
        <span
            className={cn('relative inline-flex items-center', className)}
        >
            <button
                type="button"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                aria-describedby={open ? `tooltip-${term}` : undefined}
                title={gloss}
                className={cn(
                    'cursor-help bg-transparent p-0 text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-1',
                    underline && 'underline decoration-slate-400 decoration-dotted underline-offset-4',
                )}
            >
                {term}
            </button>
            {open ? (
                <span
                    id={`tooltip-${term}`}
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-snug text-slate-700 shadow-lg"
                >
                    {gloss}
                </span>
            ) : null}
        </span>
    );
}

export default TermTooltip;
