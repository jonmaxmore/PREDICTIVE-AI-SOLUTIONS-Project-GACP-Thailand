export type InvoiceStatus =
    | "PENDING"
    | "PAID"
    | "OVERDUE"
    | "CANCELLED"
    | "PAYMENT_VERIFICATION_PENDING"
    | "PAID_PENDING_RECEIPT"
    | "RECEIPT_ISSUED"
    | "HELD"
    | "FORFEITED";

/**
 * ── walletA / walletB ถูกถอด 2026-09-11 ───────────────────────────────────────
 * operator: *"เราไม่มี wallet A/B แล้ว"* · เดิม walletA = ค่าธรรมเนียมรัฐที่บริษัท
 * เป็นหนี้กรม · walletB = ส่วนที่บริษัทเก็บไว้ · ตอนนี้ค่าบริการเป็นก้อนเดียวและเป็น
 * รายได้ของบริษัททั้งหมด ไม่มีหนี้ที่ต้องนำส่ง จึงไม่มีสองกระเป๋าให้แยก
 */
export interface RevenueSummary {
    vatCollected: number;
    totalRevenue: number;
    paidCount: number;
    byPhase: {
        phase1: { revenue: number; count: number };
        phase2: { revenue: number; count: number };
    };
}

export interface InvoiceItem {
    id: string;
    invoiceNumber: string;
    applicationNumber: string;
    healthName: string;
    amount: number;
    status: InvoiceStatus | string;
    erpStatus?: string;
    dueDate: string;
    paidAt?: string;
    createdAt: string;
    notes?: string;
    items?: unknown;
    /** 'DTAM' (legacy state fee) | 'PLATFORM' — derived by the backend, same for every viewer */
    issuerSide?: string;
}

export interface RawInvoice {
    id: string;
    invoiceNumber: string;
    applicationNumber?: string;
    application?: {
        applicationNumber?: string;
    };
    health?: {
        firstName?: string;
        lastName?: string;
        companyName?: string;
    };
    applicant?: {
        firstName?: string;
        lastName?: string;
        companyName?: string;
    };
    totalAmount?: number;
    status: InvoiceStatus | string;
    erpStatus?: string;
    dueDate: string;
    paidAt?: string;
    createdAt: string;
    notes?: string;
    items?: unknown;
    issuerSide?: string;
}

export interface PaymentException {
    id: string;
    action: string;
    severity: string;
    createdAt: string;
    invoiceId?: string | null;
    transactionId?: string | null;
    message?: string | null;
}

export interface PaymentSummary {
    totalRevenue: number;
    pendingAmount: number;
    overdueAmount: number;
    monthlyRevenue: number;
    invoiceCount: { total: number; pending: number; paid: number; overdue: number };
}

export const DEFAULT_SUMMARY: PaymentSummary = {
    totalRevenue: 0,
    pendingAmount: 0,
    overdueAmount: 0,
    monthlyRevenue: 0,
    invoiceCount: { total: 0, pending: 0, paid: 0, overdue: 0 },
};

export const DEFAULT_REVENUE: RevenueSummary = {
    vatCollected: 0, totalRevenue: 0, paidCount: 0,
    byPhase: { phase1: { revenue: 0, count: 0 }, phase2: { revenue: 0, count: 0 } },
};

/**
 * Re-exported, not re-implemented: this was a byte-identical second copy of the reading
 * in payment-service.ts. Two copies of a money vocabulary are two things that can drift,
 * and the drift is invisible until a farmer or an accountant sees the wrong word.
 */
export { normalizeInvoiceStatus } from '@/lib/services/payment-service';
