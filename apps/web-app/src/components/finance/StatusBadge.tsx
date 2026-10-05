'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * StatusBadge — GACP government-context status pill.
 *
 * Color palette is derived from finance-tokens.json `status` block
 * (Thai-government Ministry of Public Health / DTAM colors), NOT
 * the FlowAccount palette. Specifically:
 *  - PAID    => leaf (matches the green receipt accent)
 *  - PENDING => amber   (Thai gov "รอดำเนินการ" yellow)
 *  - OVERDUE => red     (urgent, RD-style alarm)
 *  - CANCELLED => gray  (neutral)
 *  - VERIFICATION => orange ("รอเก็บเงิน")
 *  - INFO    => indigo  (DTAM indigo from the gov-revenue receipt)
 *  - SUBSCRIPTION => violet (kept — gov-distinct purple)
 *  - DRAFT   => slate
 *
 * Custom label override falls back to the canonical status when not
 * provided so the badge can carry both meanings (color for finance
 * staff, plain Thai for applicants).
 */

export type StatusTone =
    | 'pending'
    | 'paid'
    | 'cancelled'
    | 'draft'
    | 'info'
    | 'overdue'
    | 'held'
    | 'subscription'
    | 'verifying';

// Palette derived from finance-tokens.json `status` block (Thai gov
// Ministry of Public Health context). Borders are deliberately
// slightly stronger than the FlowAccount-style pastel borders.
const TONE_CLASSES: Record<StatusTone, string> = {
    pending: 'bg-amber-50 text-amber-900 border-amber-300',
    paid: 'bg-leaf-soft text-primary-900 border-leaf-300',
    cancelled: 'bg-slate-100 text-slate-700 border-slate-300',
    overdue: 'bg-red-50 text-red-800 border-red-300',
    draft: 'bg-slate-50 text-slate-600 border-slate-200',
    info: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    held: 'bg-orange-50 text-orange-900 border-orange-300',
    subscription: 'bg-violet-50 text-violet-800 border-violet-200',
    verifying: 'bg-orange-50 text-orange-900 border-orange-300',
};

const STATUS_TO_TONE: Record<string, { tone: StatusTone; label: string }> = {
    // Invoice status
    PENDING: { tone: 'pending', label: 'รอดำเนินการ' },
    PAID: { tone: 'paid', label: 'ชำระแล้ว' },
    PAID_PENDING_RECEIPT: { tone: 'verifying', label: 'รอออกใบเสร็จ' },
    RECEIPT_ISSUED: { tone: 'paid', label: 'ออกใบเสร็จแล้ว' },
    OVERDUE: { tone: 'overdue', label: 'เกินกำหนด' },
    CANCELLED: { tone: 'cancelled', label: 'ยกเลิก' },
    REJECTED: { tone: 'cancelled', label: 'ปฏิเสธ' },
    PAYMENT_VERIFICATION_PENDING: { tone: 'verifying', label: 'รอตรวจสอบการชำระเงิน' },
    HELD: { tone: 'held', label: 'ถูกระงับ' },
    FORFEITED: { tone: 'draft', label: 'ถูกริบ' },
    DRAFT: { tone: 'draft', label: 'ร่าง' },
    AWAITING_PAYMENT: { tone: 'verifying', label: 'รอเก็บเงิน' },
    REFUNDED: { tone: 'info', label: 'คืนเงิน' },
    // Subscription status
    ACTIVE: { tone: 'paid', label: 'กำลังใช้งาน' },
    PENDING_PAYMENT: { tone: 'pending', label: 'รอชำระเงิน' },
    EXPIRED: { tone: 'draft', label: 'หมดอายุ' },
    // Generic
    APPROVED: { tone: 'paid', label: 'อนุมัติ' },
};

export interface StatusBadgeProps {
    /** Canonical status string. Case-insensitive. */
    status: string;
    /** Override the default Thai label. */
    label?: string;
    /** Force tone — overrides the lookup. */
    tone?: StatusTone;
    /** Optional tooltip text (rendered as title attribute). */
    title?: string;
    className?: string;
}

export function StatusBadge({
    status,
    label,
    tone,
    title,
    className,
}: StatusBadgeProps) {
    const normalized = String(status || '').toUpperCase();
    const lookup = STATUS_TO_TONE[normalized];
    const effectiveTone: StatusTone = tone || lookup?.tone || 'draft';
    if (!label && !lookup && normalized) {
        // Keep the raw enum out of the UI — surface it for developers only.
        console.warn(`StatusBadge: unmapped status "${normalized}"`);
    }
    const effectiveLabel = label || lookup?.label || 'ไม่ทราบสถานะ';
    return (
        <span
            className={cn(
                'inline-flex items-center whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold',
                TONE_CLASSES[effectiveTone],
                className,
            )}
            title={title}
        >
            {effectiveLabel}
        </span>
    );
}

export default StatusBadge;
