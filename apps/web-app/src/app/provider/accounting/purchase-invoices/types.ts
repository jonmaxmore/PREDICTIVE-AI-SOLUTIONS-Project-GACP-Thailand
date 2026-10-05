/**
 * Local view-model types for the Purchase Invoice UI (R1-B).
 *
 * The service-layer / network-shape types
 * (`PurchaseInvoice`, `PurchaseInvoiceStatus`, etc.) live in
 * `@/lib/services/finance-orphans-service` and are owned by R1-A.
 * This module ONLY hosts UI-local view-model types: filter chips,
 * form input drafts, modal modes, and prop shapes for the local
 * client components. Keep service-layer types out of here.
 */
import type { PurchaseInvoiceStatus } from '@/lib/services/finance-orphans-service';

/**
 * Status-filter chip identifiers for the top of the list.
 * `ALL` is a UI-only sentinel that the client view translates to
 * "no status filter" before calling the service.
 */
export type StatusFilter = 'ALL' | PurchaseInvoiceStatus;

/**
 * Category select options — must mirror backend VALID_CATEGORIES at
 * `apps/backend/services/purchase-invoice-service.js:102-107`.
 * Duplicated here as a literal union so the form select is exhaustive
 * and TSC catches typos.
 */
export type PurchaseInvoiceCategory =
    | 'OFFICE_SUPPLIES'
    | 'PROFESSIONAL_SERVICES'
    | 'UTILITIES'
    | 'OTHER';

export const CATEGORY_OPTIONS: ReadonlyArray<{
    value: PurchaseInvoiceCategory;
    label: string;
}> = [
    { value: 'OFFICE_SUPPLIES', label: 'วัสดุสำนักงาน' },
    { value: 'PROFESSIONAL_SERVICES', label: 'บริการมืออาชีพ' },
    { value: 'UTILITIES', label: 'สาธารณูปโภค' },
    { value: 'OTHER', label: 'อื่น ๆ' },
];

/**
 * Form state for the create-invoice modal.
 * All numeric fields are kept as strings during entry so we can
 * preserve user typing (e.g. trailing dot for decimals) and only
 * parse on submit.
 */
export interface CreateInvoiceFormState {
    invoiceNumber: string;
    supplierName: string;
    supplierTaxId: string;
    supplierAddress: string;
    invoiceDate: string; // ISO yyyy-mm-dd (HTML date input)
    subtotal: string;
    vat: string;
    totalAmount: string;
    category: PurchaseInvoiceCategory;
    description: string;
    notes: string;
    attachmentId: string;
}

export const EMPTY_CREATE_FORM: CreateInvoiceFormState = {
    invoiceNumber: '',
    supplierName: '',
    supplierTaxId: '',
    supplierAddress: '',
    invoiceDate: '',
    subtotal: '',
    vat: '',
    totalAmount: '',
    category: 'OFFICE_SUPPLIES',
    description: '',
    notes: '',
    attachmentId: '',
};

/**
 * Per-field validation results emitted by the local form validator.
 * Empty string === valid. Keep messages in Thai for end-user surface.
 */
export interface CreateInvoiceFieldErrors {
    invoiceNumber: string;
    supplierName: string;
    supplierTaxId: string;
    invoiceDate: string;
    subtotal: string;
    vat: string;
    totalAmount: string;
    category: string;
}

export const EMPTY_FIELD_ERRORS: CreateInvoiceFieldErrors = {
    invoiceNumber: '',
    supplierName: '',
    supplierTaxId: '',
    invoiceDate: '',
    subtotal: '',
    vat: '',
    totalAmount: '',
    category: '',
};

/**
 * Aggregate top-level error shape emitted from the modal back to
 * the client view (server-side rejection messages get bubbled up
 * here too).
 */
export interface CreateInvoiceErrors {
    fields: CreateInvoiceFieldErrors;
    serverMessage: string | null;
    /** Highlight pair when backend returns UNBALANCED_TOTALS. */
    highlightTotalsMismatch: boolean;
}

export const EMPTY_ERRORS: CreateInvoiceErrors = {
    fields: EMPTY_FIELD_ERRORS,
    serverMessage: null,
    highlightTotalsMismatch: false,
};

/**
 * Mode for the review-actions menu — controls which side modal opens.
 */
export type ReviewActionMode = 'approve' | 'reject' | 'mark-paid' | null;
