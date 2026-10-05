/**
 * Canonical Workflow States
 * Single source of truth for frontend workflow state constants.
 * Matches backend workflow-transition-service.js states.
 *
 * Business Rules:
 * - Revision/CAR loops are UNLIMITED (no loop limits)
 * - Only constraint: 5-working-day revision deadline
 * - If deadline expires → EXPIRED → must start new application + new payment
 */

export const WORKFLOW_STATES = [
    'DRAFT',
    'SUBMITTED',
    'PENDING_DOC_FEE',
    'DOC_FEE_PAID',
    'ASSIGNED_FOR_REVIEW',
    'REVISION_REQUESTED',
    'DOC_APPROVED',
    'PENDING_AUDIT_FEE',
    'AUDIT_FEE_PAID',
    'AUDIT_CONFIRMED',
    'CAR_PENDING',
    'CAR_REVIEWING',
    'AUDIT_PASSED',
    'APPROVED',
    'CERTIFIED',
    'REJECTED',
    'EXPIRED',
    'CANCEL_EXPIRED',
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/**
 * Thai labels for workflow states — ป้ายสั้นบนตราสถานะ
 *
 * คำเรื่องเงินต้องเป็นคำเดียวกับที่พิมพ์บนใบเสร็จ (`payment-service.ts` PHASE_1/PHASE_2)
 * ก่อน 2026-09-11 ตารางนี้เป็น "ภาษาที่ห้า" ของเรื่องเดียวกัน: เรียกงวดที่ 1 ว่า
 * "ค่าธรรมเนียมเอกสาร" และงวดที่ 2 ว่า "ค่าตรวจ" โดยไม่มีเลขงวดเลย ทั้งที่ใบเสร็จ
 * เขียน "งวดที่ 1 ค่าบริการตรวจสอบเอกสาร" · ป้ายสั้นตัดคำอธิบายได้ แต่ตัดชื่อไม่ได้
 *
 * และ AUDIT_FEE_PAID เคยเขียนว่า "ชำระค่าตรวจแล้ว" — จริงแต่ไม่ตอบคำถามที่ผู้ยื่นถาม
 * ("แล้วตอนนี้รออะไร") · สิ่งที่เกิดขึ้นจริงตรงนั้นคือรอผู้จัดสรรงานนัดวัน
 */
export const STATUS_LABELS: Record<WorkflowState, string> = {
    DRAFT: 'ร่าง',
    SUBMITTED: 'ยื่นแล้ว',
    PENDING_DOC_FEE: 'รอชำระงวดที่ 1',
    DOC_FEE_PAID: 'ชำระงวดที่ 1 แล้ว',
    ASSIGNED_FOR_REVIEW: 'อยู่ระหว่างตรวจสอบ',
    REVISION_REQUESTED: 'ขอแก้ไข',
    DOC_APPROVED: 'เอกสารอนุมัติ',
    PENDING_AUDIT_FEE: 'รอชำระค่าบริการ',
    AUDIT_FEE_PAID: 'รอนัดวันตรวจแปลง',
    AUDIT_CONFIRMED: 'นัดตรวจแล้ว',
    CAR_PENDING: 'รอผู้สมัครแก้ไขข้อบกพร่อง',
    CAR_REVIEWING: 'ตรวจการแก้ไขข้อบกพร่อง',
    AUDIT_PASSED: 'ตรวจผ่าน',
    APPROVED: 'อนุมัติ',
    CERTIFIED: 'ออกใบรับรองแล้ว',
    REJECTED: 'ปฏิเสธ',
    EXPIRED: 'หมดอายุ',
    CANCEL_EXPIRED: 'ยกเลิก (หมดเวลา)',
};

/** Tailwind CSS badge classes for workflow states */
export const STATUS_COLORS: Record<WorkflowState, string> = {
    DRAFT: 'bg-zinc-100 text-zinc-600',
    SUBMITTED: 'bg-blue-50 text-blue-700',
    PENDING_DOC_FEE: 'bg-amber-50 text-amber-700',
    DOC_FEE_PAID: 'bg-leaf-soft text-leaf-700',
    ASSIGNED_FOR_REVIEW: 'bg-indigo-50 text-indigo-700',
    REVISION_REQUESTED: 'bg-red-50 text-red-700',
    DOC_APPROVED: 'bg-green-50 text-green-700',
    PENDING_AUDIT_FEE: 'bg-amber-50 text-amber-700',
    AUDIT_FEE_PAID: 'bg-teal-50 text-teal-700',
    AUDIT_CONFIRMED: 'bg-blue-50 text-blue-700',
    CAR_PENDING: 'bg-orange-50 text-orange-700',
    CAR_REVIEWING: 'bg-yellow-50 text-yellow-700',
    AUDIT_PASSED: 'bg-leaf-soft text-leaf-700',
    APPROVED: 'bg-green-100 text-green-800',
    CERTIFIED: 'bg-primary text-white',
    REJECTED: 'bg-red-100 text-red-800',
    EXPIRED: 'bg-gray-100 text-gray-500',
    CANCEL_EXPIRED: 'bg-gray-100 text-gray-500',
};

/** Helper to get label for a state (returns state itself if unknown) */
export function getStatusLabel(state: string): string {
    return STATUS_LABELS[state as WorkflowState] ?? state;
}

/** Helper to get badge class for a state */
export function getStatusColor(state: string): string {
    return STATUS_COLORS[state as WorkflowState] ?? 'bg-zinc-100 text-zinc-600';
}

/**
 * Maps canonical Tailwind CSS badge classes to semantic color names
 * used by the Badge primitive's `color` prop.
 *
 * Centralised here to avoid duplication across components.
 */
export const TAILWIND_TO_SEMANTIC_COLOR: Record<string, string> = {
    'bg-zinc-100 text-zinc-600': 'gray',
    'bg-blue-50 text-blue-700': 'blue',
    'bg-amber-50 text-amber-700': 'orange',
    'bg-leaf-soft text-leaf-700': 'teal',
    'bg-indigo-50 text-indigo-700': 'indigo',
    'bg-red-50 text-red-700': 'red',
    'bg-green-50 text-green-700': 'green',
    'bg-teal-50 text-teal-700': 'teal',
    'bg-orange-50 text-orange-700': 'orange',
    'bg-yellow-50 text-yellow-700': 'yellow',
    'bg-green-100 text-green-800': 'green',
    'bg-primary text-white': 'green',
    'bg-red-100 text-red-800': 'red',
    'bg-gray-100 text-gray-500': 'gray',
    'bg-sky-50 text-sky-700': 'blue',
};

/** Convert a workflow state to a semantic color name (e.g. 'green', 'red'). */
export function getSemanticColor(state: string): string {
    const twClass = STATUS_COLORS[state as WorkflowState];
    return twClass ? (TAILWIND_TO_SEMANTIC_COLOR[twClass] ?? 'gray') : 'gray';
}
