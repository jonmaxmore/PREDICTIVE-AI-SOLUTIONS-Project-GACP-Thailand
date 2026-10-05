import { PURPOSE_CODES, purposeOptionLabel } from '@/lib/certification-purposes';
import { THAI_TIME_ZONE } from '@/lib/format/thai-date';
export interface PreviewDocument {
  type?: string | undefined;
  name?: string | undefined;
  uploaded?: boolean;
  url?: string | undefined;
  fileUrl?: string | undefined;
  metadata?: Record<string, unknown> | null;
}

/**
 * F-G4-51 — one milestone of the single-invoice checkout rail, as the preview
 * route summarises it (backend: routes/api/preview/preview-financial-utils.js
 * summarizeCheckoutInvoices). Null when the applicant has no checkout invoice
 * for that milestone yet; every field is optional because an unpaid invoice
 * carries no receipt.
 */
export interface CheckoutPhaseSummary {
  invoiceNumber?: string | null;
  status?: string | null;
  isPaid?: boolean;
  paidAt?: string | null;
  receiptNumber?: string | null;
  receiptIssuedAt?: string | null;
  totalAmount?: number | null;
}

/**
 * One side (ภาครัฐ / แพลตฟอร์ม) of the retired per-phase quote+invoice pair.
 * `status` is what decides whether the row is still LIVE: a CANCELLED invoice
 * is history, not a document the applicant has to act on (B-F3).
 */
export interface LegacyPhaseDocuments {
  quote?: { quoteNumber?: string; status?: string } | null;
  invoice?: { invoiceNumber?: string; status?: string } | null;
}

export interface PreviewData {
  applicationId: string;
  status: string;
  nextRequiredAction?: string;
  canFinalizeSubmission?: boolean;
  selectionInfo?: {
    plantId?: string | null;
    serviceType?: string | null;
    purpose?: string | null;
    cultivationMethods?: string[];
  };
  health?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  applicant?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  farmInfo: {
    areaType?: string;
    standardCode?: string;
    areaSize?: number | string;
    areaUnit?: string;
    plantType?: string;
    location?: string;
    farmName?: string;
  };
  productionInfo: {
    plantingDate?: string;
    harvestDate?: string;
    estimatedYield?: number;
  };
  documents: PreviewDocument[];
  attachments?: PreviewDocument[];
  summary: {
    totalSteps: number;
    completedSteps: number;
    isComplete: boolean;
    missingFields: string[];
  };
  payment: {
    /** round 4: a renewal — one charge, no instalment 1 (phase1Amount is null). */
    isRenewal?: boolean;
    phase1Amount: number | null;
    phase1Status: string;
    phase2Amount: number;
    scopeCount?: number;
    totalEstimated: number;
    breakdown?: {
      phase1?: {
        stateAmount: number;
        platformAmount: number;
        phaseTotal: number;
        stateStatus: string;
        platformStatus: string;
        isPhasePaid: boolean;
      };
      phase2?: {
        stateAmount: number;
        platformAmount: number;
        phaseTotal: number;
        stateStatus: string;
        platformStatus: string;
        isPhasePaid: boolean;
      };
      totals?: {
        stateTotal: number;
        platformTotal: number;
        grandTotal: number;
      };
    };
    /**
     * F-G4-51 — the phase-1 / phase-2 state of the ONE-invoice checkout rail.
     * Optional: an older backend (or a cached response) simply has no such
     * key, and the page then falls back to payment.breakdown / phase1Status.
     */
    checkout?: {
      phase1: CheckoutPhaseSummary | null;
      phase2: CheckoutPhaseSummary | null;
    };
  };
  financialDocuments?: {
    quote?: {
      id: string;
      quoteNumber: string;
      status?: string;
      validUntil?: string;
    } | null;
    invoice?: {
      id: string;
      invoiceNumber: string;
      status?: string;
      dueDate?: string;
      totalAmount?: number;
    } | null;
    phase1?: {
      state?: LegacyPhaseDocuments;
      platform?: LegacyPhaseDocuments;
    };
    requiredInvoices?: Array<{
      invoiceId?: string;
      invoiceNumber?: string;
      component?: string;
      status?: string;
      isPaid?: boolean;
      amount?: number;
    }>;
  };
  fullFormSnapshot?: {
    applicationMeta?: {
      applicationId?: string;
      applicationNumber?: string;
      standardCode?: string;
      areaType?: string;
      serviceType?: string;
      status?: string;
      createdAt?: string;
      updatedAt?: string;
    };
    rawFormData?: Record<string, unknown>;
    fieldCount?: number;
    fields?: Array<{ path: string; value?: unknown; displayValue?: string }>;
    attachments?: Array<{ type?: string; name?: string; url?: string }>;
  };
}

export interface PreviewApiResponse {
  success: boolean;
  preview?: PreviewData;
  error?: string;
}

export interface FinalizeApiResponse {
  success: boolean;
  error?: string;
}

export const PAID_STATUSES = new Set(['PAID', 'SUCCESS', 'RECEIPT_ISSUED']);
export const SERVICE_TYPE_LABELS: Record<string, string> = {
  NEW: 'ขอรับรองใหม่',
  RENEWAL: 'ต่ออายุใบรับรอง',
  MODIFY: 'แก้ไขข้อมูลใบรับรอง',
  REPLACEMENT: 'ขอใบแทน',
};

/** Labels come from the one vocabulary (lib/certification-purposes.ts) — never retyped here. */
export const PURPOSE_LABELS: Record<string, string> = Object.fromEntries(
  PURPOSE_CODES.map((code) => [code, purposeOptionLabel(code)]),
);

export const METHOD_LABELS: Record<string, string> = {
  outdoor: 'กลางแจ้ง',
  greenhouse: 'โรงเรือน',
  indoor: 'อาคาร/โรงเรือนระบบปิด',
  OUTDOOR: 'กลางแจ้ง',
  GREENHOUSE: 'โรงเรือน',
  INDOOR: 'อาคาร/โรงเรือนระบบปิด',
};

/**
 * B-F2 — what the applicant should do next, in words they can act on.
 *
 * The backend answers `nextRequiredAction` with an internal enum
 * (routes/api/preview/preview.js) and the footer chip printed it raw:
 * "ขั้นตอนถัดไป: PAY_PHASE_1". An action this page has no words for renders NO
 * chip at all — a raw key is not an instruction.
 */
export const NEXT_ACTION_LABELS: Record<string, string> = {
  PAY_PHASE_1: 'ชำระเงินงวดที่ 1',
  PAY_PHASE_2: 'ชำระเงินงวดที่ 2',
  WAIT_DOC_REVIEW: 'รอผลการตรวจเอกสาร',
  WAIT_AUDIT_SCHEDULE: 'รอนัดหมายตรวจประเมิน',
  WAIT_RECEIPT_PHASE_2: 'รอออกใบเสร็จงวดที่ 2',
};

/**
 * The Thai instruction for a next-required action, or null when this page has
 * no words for it.
 *
 * The OWN-property check is load-bearing (same rule as the public verify page's
 * statusReasonCopy): the table is a plain object, so an action reading
 * '__proto__' or 'constructor' resolved to an INHERITED value of
 * Object.prototype instead of undefined. That value is not a string — React
 * throws on rendering it, and the applicant gets a blank page where a preview
 * should be. An action counts only when the table owns the key.
 */
export function nextActionLabel(action?: string | null): string | null {
  if (!action) return null;
  return Object.prototype.hasOwnProperty.call(NEXT_ACTION_LABELS, action)
    ? (NEXT_ACTION_LABELS[action] ?? null)
    : null;
}

/**
 * B-F4 — the legacy finance pill printed the stored English status
 * ('PENDING', 'RECEIPT_ISSUED'). The rows are written in mixed case
 * ('pending' from the preview writer, 'PAID' from settlement), so the lookup
 * normalises case; a status with no Thai wording renders no pill.
 */
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอชำระ',
  PAID: 'ชำระแล้ว',
  SUCCESS: 'ชำระแล้ว',
  RECEIPT_ISSUED: 'ออกใบเสร็จแล้ว',
  CANCELLED: 'ยกเลิกแล้ว',
};

function normalizeStatus(status?: string | null): string {
  return String(status || '').trim().toUpperCase();
}

/** The Thai wording for an invoice status, or null when there is none. */
export function invoiceStatusLabel(status?: string | null): string | null {
  return INVOICE_STATUS_LABELS[normalizeStatus(status)] || null;
}

/** A cancelled invoice is history: it asks nothing of the applicant. */
const CANCELLED_STATUS = 'CANCELLED';
/** A quote that was cancelled or turned down is likewise dead. */
const DEAD_QUOTE_STATUSES = new Set([CANCELLED_STATUS, 'REJECTED']);

/**
 * Exported so the C05 walk can decide which branch of the page it should be
 * looking at using THIS rule rather than a re-typed status literal of its own.
 */
export function isLiveLegacyInvoice(invoice?: { status?: string } | null): boolean {
  return Boolean(invoice) && normalizeStatus(invoice?.status) !== CANCELLED_STATUS;
}

/**
 * The quote half of the same rule, exported for the same reason: the C05 walk
 * counts legacy QUOTE rows as well, and hasLiveLegacyPhase1Documents below ORs
 * them in — a walk that judged quote liveness with its own status literal would
 * pick the other branch of the page than the page itself does.
 */
export function isLiveLegacyQuote(quote?: { status?: string } | null): boolean {
  return Boolean(quote) && !DEAD_QUOTE_STATUSES.has(normalizeStatus(quote?.status));
}

/**
 * B-F3 — does this application still carry a LIVE document of the retired
 * per-side phase-1 pair?
 *
 * The old test was "any of the six slots is non-null", which counted voided
 * rows as live: an application whose ghost split invoices had been cancelled
 * and whose money really moved through the checkout rail was shown four dead
 * slots instead of its own receipt.
 */
export function hasLiveLegacyPhase1Documents(
  financialDocuments?: PreviewData['financialDocuments'],
): boolean {
  const phase1 = financialDocuments?.phase1;
  return isLiveLegacyQuote(phase1?.state?.quote)
    || isLiveLegacyInvoice(phase1?.state?.invoice)
    || isLiveLegacyQuote(phase1?.platform?.quote)
    || isLiveLegacyInvoice(phase1?.platform?.invoice)
    || isLiveLegacyQuote(financialDocuments?.quote)
    || isLiveLegacyInvoice(financialDocuments?.invoice);
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
  }).format(amount || 0);
}

export function formatDate(dateString?: string) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('th-TH', {
    timeZone: THAI_TIME_ZONE,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function statusTone(status?: string) {
  const value = String(status || '').toUpperCase();
  if (value === 'PAID' || value === 'RECEIPT_ISSUED') return 'bg-leaf-soft text-leaf-700 border-leaf-300';
  if (value === 'PENDING') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-foreground border-border';
}

export function resolveLabel(value: string | undefined | null, map: Record<string, string>) {
  if (!value) return '-';
  const normalized = String(value).trim();
  return map[normalized] || normalized;
}

export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value || '-';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function normalizePreviewDocuments(preview: PreviewData | null): PreviewDocument[] {
  if (!preview) return [];

  const docs = Array.isArray(preview.documents) ? preview.documents : [];
  const attachments = Array.isArray(preview.attachments) ? preview.attachments : [];
  const snapshotAttachments: PreviewDocument[] = Array.isArray(preview.fullFormSnapshot?.attachments)
    ? preview.fullFormSnapshot.attachments.map((attachment) => ({
      type: attachment.type,
      name: attachment.name,
      url: attachment.url,
      uploaded: true,
    }))
    : [];
  const allAttachments = [
    ...attachments,
    ...snapshotAttachments,
  ];

  const attachmentByType = new Map<string, PreviewDocument>();
  const usedAttachmentKeys = new Set<string>();
  for (const item of allAttachments) {
    const key = String(item.type || item.name || '').trim();
    if (key && !attachmentByType.has(key)) {
      attachmentByType.set(key, item);
    }
  }

  const merged: PreviewDocument[] = docs.map((doc) => {
    const key = String(doc.type || doc.name || '').trim();
    const attachment = key ? attachmentByType.get(key) : undefined;
    if (key) {
      usedAttachmentKeys.add(key);
    }
    return {
      ...doc,
      url: doc.url || attachment?.url,
    };
  });

  for (const attachment of allAttachments) {
    const key = String(attachment.type || attachment.name || '').trim();
    if (key && usedAttachmentKeys.has(key)) {
      continue;
    }
    merged.push({
      type: attachment.type,
      name: attachment.name,
      url: attachment.url || attachment.fileUrl,
      fileUrl: attachment.fileUrl,
      uploaded: true,
      metadata: attachment.metadata || null,
    });
  }

  return merged;
}
