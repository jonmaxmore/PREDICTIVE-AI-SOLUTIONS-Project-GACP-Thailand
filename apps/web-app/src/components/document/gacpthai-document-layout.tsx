'use client';

import React from 'react';
import './gacpthai-document-styles.css';
import { QrImage } from '@/components/ui/qr-image';
import { DEFAULT_PUBLIC_HOST } from '@/lib/verify/public-verify-url';

/**
 * Fix-round 1 (review 6712f985): the reviewer found
 * `apps/backend/services/pdf/invoice-template-service.js` (~line 1019-1024)
 * already encodes a REAL quotation QR into the printed PDF —
 * `${base}/health/payments?app=<applicationId>` — so the on-screen preview
 * should render that SAME url, not a fake placeholder (W3's original fix
 * removed the placeholder outright without knowing a real backend URL
 * already existed for this document type).
 *
 * `/health/payments?app=<id>` is also already a real frontend route (used
 * as a post-payment redirect target in
 * `app/health/applications/new/_steps/steps/invoice-step.tsx`), so this is
 * not a new endpoint being invented for the QR.
 *
 * Base-host resolution mirrors `CertificateService`'s client-side pattern
 * (browser origin is inherently trustworthy — this only ever runs in the
 * browser, `'use client'` document preview), sharing the SAME fallback
 * constant as the verify page / cert-detail / cert-list QR paths so a
 * misconfigured environment falls back to one host everywhere.
 */
export function buildDocumentPaymentQrUrl(applicationId: string | null | undefined): string | null {
    if (!applicationId) return null;
    const base =
        typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin.replace(/\/+$/, '')
            : DEFAULT_PUBLIC_HOST;
    return `${base}/health/payments?app=${encodeURIComponent(applicationId)}`;
}

/* ================================================================
   DtamDocumentLayout
   ----------------------------------------------------------------
   Shared A4 paper layout for the web quotation (ใบเสนอราคา). The
   name is historical: the document is issued by the company, never
   the ministry. The issuer block, the logo and its alt text are all
   required from the caller — there is no default issuer and no
   default logo here (fix/web-quotation-truth, 2026-09-28: the
   defaults printed the ministry's name, address, switchboard and
   seal).
   ================================================================ */

/** The issuer header, as the server sent it (quotation API `issuer`). */
export interface DocumentIssuerBlock {
    name: string;
    branch: string;
    address: string;
    taxId: string;
    email: string | null;
    /** The PDF header's contact line, printed as-is. */
    contact: string;
}

export interface DtamSignatureBlock {
    title: string;        // e.g. "ผู้รับบริการ"
    name?: string;        // e.g. "( นายปรีชา หนูทิม )"
    position?: string;    // e.g. "ผู้อำนวยการระบบรับรองมาตรฐาน GACP สมุนไพร"
    subPosition?: string; // e.g. "ปฏิบัติราชการแทน อธิบดีกรมฯ"
    companyName?: string; // e.g. "บริษัท สมุก ครูว จำกัด"
    showDate?: boolean;
}

export interface DtamDocumentLayoutProps {
    /** Title on the colored badge, e.g. "ใบเสนอราคา" */
    badgeTitle: string;
    /** Badge variant color */
    badgeVariant?: 'quotation' | 'invoice' | 'receipt' | 'application';
    /** Document ref info (right side of header) */
    documentRefs?: Array<{ label: string; value: string }>;
    /** Addressee info lines */
    addresseeLines?: Array<{ label: string; value: string }>;
    /** Main body description paragraph */
    bodyParagraph?: string;
    /** Main content (tables, etc.) */
    children: React.ReactNode;
    /** Signature blocks at bottom */
    signatures?: DtamSignatureBlock[];
    /** Footer notes array */
    footerNotes?: string[];
    /** Bank info lines */
    bankInfo?: string[];
    /** Show the QR block — only renders when `qrValue` is also given. */
    showQR?: boolean;
    /**
     * The URL the QR encodes (e.g. `buildDocumentPaymentQrUrl(applicationId)`
     * exported from this file). `showQR` alone renders nothing — this
     * component never fabricates a placeholder for a missing value.
     */
    qrValue?: string | null;
    /** Show print button */
    showPrintButton?: boolean;
    /** Header logo — required, no default. The company issues these documents,
     *  so callers pass the company logo; the ministry seal belongs on the
     *  certificate, not on a company's bill (operator 2026-09-06). */
    logoSrc: string;
    /** Alt text for that logo — required, travels WITH logoSrc. */
    logoAlt: string;
    /**
     * The issuer header from the server. `null`/absent = the header prints no
     * issuer text at all: a document never falls back to a guessed issuer.
     */
    issuer?: DocumentIssuerBlock | null;
}

export function DtamDocumentLayout({
    badgeTitle,
    badgeVariant = 'quotation',
    documentRefs,
    addresseeLines,
    bodyParagraph,
    children,
    signatures,
    footerNotes,
    bankInfo,
    showQR = true,
    qrValue = null,
    showPrintButton = true,
    logoSrc,
    logoAlt,
    issuer = null,
}: DtamDocumentLayoutProps) {
    const handlePrint = () => window.print();

    return (
        <div className="dtam-doc-wrapper">
            {/* Print Button */}
            {showPrintButton && (
                <div className="dtam-doc-print-hide" style={{ maxWidth: '210mm', margin: '0 auto 16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                        type="button"
                        onClick={handlePrint}
                        className="cursor-pointer rounded-lg border-none bg-green-800 px-6 py-3 text-sm font-semibold text-white"
                    >
                        พิมพ์เอกสาร / ดาวน์โหลด PDF
                    </button>
                </div>
            )}

            {/* A4 Document */}
            <div className="dtam-doc-page" id="dtam-document">
                {/* ---- Header ---- */}
                <div className="dtam-doc-header">
                    <div className="dtam-doc-header-left">
                        {/* Header logo — the caller's (see logoSrc). */}
                        <div className="dtam-doc-logo">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={logoSrc}
                                alt={logoAlt}
                                width={56}
                                height={56}
                                style={{ objectFit: 'contain' }}
                            />
                        </div>

                        {issuer ? (
                            <div className="dtam-doc-dept-info">
                                <div className="dtam-doc-dept-name">{issuer.name}</div>
                                <div className="dtam-doc-dept-parent">({issuer.branch})</div>
                                <div className="dtam-doc-dept-address">{issuer.address}</div>
                                <div className="dtam-doc-dept-contact">{issuer.contact}</div>
                                <div className="dtam-doc-dept-contact">เลขประจำตัวผู้เสียภาษี {issuer.taxId}</div>
                            </div>
                        ) : null}
                    </div>

                    {/* Document Type Badge */}
                    <div className={`dtam-doc-badge dtam-doc-badge--${badgeVariant}`}>
                        {badgeTitle}
                    </div>
                </div>

                {/* ---- Document References (right-aligned) ---- */}
                {documentRefs && documentRefs.length > 0 && (
                    <div className="dtam-doc-ref-block">
                        {documentRefs.map((ref, i) => (
                            <div key={i}>
                                {ref.label}: <strong>{ref.value}</strong>
                            </div>
                        ))}
                    </div>
                )}

                {/* ---- Addressee Info ---- */}
                {addresseeLines && addresseeLines.length > 0 && (
                    <div className="dtam-doc-info-grid">
                        {addresseeLines.map((line, i) => (
                            <div key={i} className="dtam-doc-info-row">
                                <span className="dtam-doc-info-label">{line.label}</span>
                                <span>{line.value}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* ---- Body Paragraph ---- */}
                {bodyParagraph && (
                    <div style={{ marginBottom: '16px', fontSize: '12pt' }}>
                        <p>{bodyParagraph}</p>
                    </div>
                )}

                {/* ---- Main Content (tables, forms, etc.) ---- */}
                {children}

                {/* ---- Signatures ---- */}
                {signatures && signatures.length > 0 && (
                    <div className="dtam-doc-signatures">
                        {signatures.map((sig, i) => (
                            <div key={i} className="dtam-doc-signature-col">
                                <div className="sig-title">{sig.title}</div>
                                <div className="sig-dots">.............................................</div>
                                <div className="sig-name">{sig.name || '(...............................................)'}</div>
                                {sig.position && <div className="sig-position">ตำแหน่ง {sig.position}</div>}
                                {sig.subPosition && <div className="sig-position">{sig.subPosition}</div>}
                                {sig.companyName && <div className="sig-position">{sig.companyName}</div>}
                                {(sig.showDate !== false) && <div className="sig-date">วันที่........../............./.............</div>}
                            </div>
                        ))}
                    </div>
                )}

                {/* ---- Footer Notes ---- */}
                {(footerNotes || bankInfo) && (
                    <div className="dtam-doc-footer">
                        {footerNotes?.map((note, i) => (
                            <div key={i}>{note}</div>
                        ))}
                        {bankInfo?.map((line, i) => (
                            <div key={`bank-${i}`}>{line}</div>
                        ))}
                    </div>
                )}

                {/* ---- QR Code ----
                    W3 (real-qr-codes, 2026-08-22) originally removed a
                    literal "[QR Code]" placeholder captioned "please scan"
                    here — a fake QR, nothing a phone could ever scan.
                    Fix-round 1 (review 6712f985): the reviewer found the
                    backend PDF for this SAME document already encodes a
                    real `/health/payments?app=<id>` QR
                    (apps/backend/services/pdf/invoice-template-service.js),
                    so the preview renders that real value via <QrImage>
                    instead of staying placeholder-free. Still never
                    fabricates a placeholder when `qrValue` is absent. */}
                {showQR && qrValue && (
                    <div className="dtam-doc-footer-qr">
                        <QrImage
                            value={qrValue}
                            alt="QR สำหรับชำระเงินและตรวจสอบคำขอ GACP"
                            size={96}
                        />
                        <div style={{ fontSize: '11pt' }}>สแกนเพื่อชำระเงิน / ตรวจสอบคำขอ</div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ================================================================
   DtamItemsTable — Standard items table used by quotation/invoice
   ================================================================ */

export interface DtamTableItem {
    description: string;
    quantity: number;
    unit?: string;
    unitPrice: number;
}

interface DtamItemsTableProps {
    items: DtamTableItem[];
    totalAmount: number;
    totalAmountText: string;
    /**
     * Pre-VAT subtotal (รวมเป็นเงิน) and the VAT amount (ภาษีมูลค่าเพิ่ม 7%). A tax
     * document must show VAT as its own line computed on the subtotal — not baked
     * into each line (operator 2026-09-06: "vat คำนวนสุดท้าย หลังยอดรวม"). When both
     * are given the table prints subtotal → VAT → grand total; when omitted it keeps
     * the single-total layout for callers that have not migrated.
     */
    subtotal?: number;
    vat?: number;
    /** The VAT row's caption when the caller has the server's (served rate). */
    vatLabel?: string;
    formatAmount?: (n: number) => string;
}

const defaultFormat = (n: number) =>
    new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function DtamItemsTable({
    items,
    totalAmount,
    totalAmountText,
    subtotal,
    vat,
    vatLabel = 'ภาษีมูลค่าเพิ่ม 7%',
    formatAmount = defaultFormat,
}: DtamItemsTableProps) {
    const showVatBreakdown = typeof subtotal === 'number' && typeof vat === 'number';
    return (
        <table className="dtam-doc-table">
            <thead>
                <tr>
                    <th style={{ width: '8%' }}>ลำดับที่</th>
                    <th>รายการ</th>
                    <th style={{ width: '10%' }}>จำนวน</th>
                    <th style={{ width: '10%' }}>หน่วย</th>
                    <th style={{ width: '14%' }}>ราคา/<br />หน่วย</th>
                    <th style={{ width: '14%' }}>จำนวนเงิน<br />(บาท)</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item, index) => (
                    <tr key={index}>
                        <td className="text-center">{index + 1}.</td>
                        <td>{item.description}</td>
                        <td className="text-center">{item.quantity}</td>
                        <td className="text-center">{item.unit || 'ต่อคำขอ'}</td>
                        <td className="text-right">{formatAmount(item.unitPrice)},-</td>
                        <td className="text-right">{formatAmount(item.quantity * item.unitPrice)}</td>
                    </tr>
                ))}
                {showVatBreakdown && (
                    <>
                        <tr className="subtotal-row">
                            <td colSpan={4} />
                            <td className="text-center">รวมเป็นเงิน</td>
                            <td className="text-right">{formatAmount(subtotal as number)}</td>
                        </tr>
                        <tr className="vat-row">
                            <td colSpan={4} />
                            <td className="text-center">{vatLabel}</td>
                            <td className="text-right">{formatAmount(vat as number)}</td>
                        </tr>
                    </>
                )}
                <tr className="total-row">
                    <td colSpan={4} className="text-center">
                        ({totalAmountText})
                    </td>
                    <td className="text-center">จำนวนเงินทั้งสิ้น</td>
                    <td className="text-right">{formatAmount(totalAmount)},-</td>
                </tr>
            </tbody>
        </table>
    );
}

export default DtamDocumentLayout;
