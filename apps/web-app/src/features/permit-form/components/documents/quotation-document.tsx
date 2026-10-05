"use client";
import {
    DtamDocumentLayout,
    DtamItemsTable,
    type DtamSignatureBlock,
    type DtamTableItem,
} from "@/components/document/gacpthai-document-layout";
import type {
    QuotationCopy,
    QuotationIssuer,
    QuotationPayer,
    QuotationSignatory,
} from "@/lib/services/payment-service";

/* ================================================================
   QuotationDocument — ใบเสนอราคา
   Issued by the company. The issuer header, the opening paragraph, the
   payment line and the signatory are the SERVER's (GET
   /applications/:id/quotations `issuer` · `copy` · `signatory`, built by the
   same backend helpers as the quotation PDF) — this file holds none of that
   wording (fix/web-quotation-truth, 2026-09-28).
   ================================================================ */

interface QuotationDocumentProps {
    quotationNumber: string;
    quotationDate: string;
    /**
     * The day the offer stands until, already formatted (F-G4-64 final round
     * R21). The register holds this date itself — 7 วันทำการ นับจากวันที่ออก
     * (operator ruling re-confirmed 2026-09-27), never a hardcoded day count —
     * and past it the acceptance door refuses this document (QUOTATION_EXPIRED),
     * so the applicant who is asked to accept it is shown the deadline rather
     * than asked to count.
     */
    validUntil?: string;
    /** Used to build the QR's payment-link value — see buildDocumentPaymentQrUrl. */
    applicationId?: string;
    /**
     * The payer block exactly as the server resolved it (GET
     * /applications/:id/quotations `payer`, apps/backend/utils/applicant-resolver.js).
     * Labels and the printed id come from there; this component decides none of
     * them. `null` = the server sent none, and the block says so rather than
     * guessing from wizard state (which printed an individual's national ID).
     */
    payer: QuotationPayer | null;
    items: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
    }>;
    totalAmount: number;
    totalAmountText: string;
    /** Pre-VAT subtotal + VAT amount for the table foot (VAT as its own line). */
    subtotal?: number;
    vat?: number;
    /** The signatory the server sent — the same config the quotation PDF prints. */
    signatory: QuotationSignatory | null;
    /** The issuer header the server sent (the company). `null` = no issuer text. */
    issuer: QuotationIssuer | null;
    /** The opening paragraph + payment line the server sent (the PDF's wording). */
    copy: QuotationCopy | null;
    /**
     * What each service on the document covers, printed once under the table
     * (operator 2026-10-03). The words are the server's catalogue.
     */
    serviceNotes?: Array<{ name: string; coverage: string }>;
    /** The VAT line's caption as the server built it (served rate); absent = the table's own. */
    vatLabel?: string;
}

export default function QuotationDocument({
    quotationNumber,
    quotationDate,
    validUntil,
    // Part of the props contract, not printed on the document; the underscore
    // only satisfies no-unused-vars in this file (touched for the comment below).
    applicationId: _applicationId,
    payer,
    items,
    totalAmount,
    totalAmountText,
    subtotal,
    vat,
    signatory,
    issuer,
    copy,
    serviceNotes = [],
    vatLabel,
}: QuotationDocumentProps) {
    const tableItems: DtamTableItem[] = items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unit: "ต่อคำขอ",
    }));

    const signatures: DtamSignatureBlock[] = [
        {
            title: "ยืนยันคำขอรับการตรวจสอบและประเมิน",
            showDate: true,
        },
        // The issuer's signatory, from the server (L-091: this used to be one
        // hardcoded named person on every applicant's quotation).
        ...(signatory
            ? [{
                title: signatory.org,
                name: `( ${signatory.name} )`,
                ...(signatory.title1 ? { position: signatory.title1 } : {}),
                ...(signatory.title2 ? { subPosition: signatory.title2 } : {}),
                showDate: true,
            }]
            : []),
    ];

    // The payer block, verbatim from the server. The id row prints the server's
    // label and value as-is ("-" for a person: the national ID never reaches the
    // browser).
    const addresseeLines = payer
        ? [
            { label: "เรียน", value: payer.name },
            { label: `${payer.idLabel}:`, value: payer.idPrinted },
            { label: "ที่อยู่:", value: payer.address },
            { label: "ผู้ประสานงาน:", value: `${payer.contactName} โทรศัพท์ ${payer.phone}` },
        ]
        : [{ label: "เรียน", value: "-" }];

    return (
        <DtamDocumentLayout
            /* Company logo, not the ministry seal — this is a commercial document
               issued in the company's name (operator 2026-09-06). */
            logoSrc="/images/company-logo.png"
            logoAlt="โลโก้ผู้ออกเอกสาร"
            issuer={issuer}
            badgeTitle="ใบเสนอราคา"
            badgeVariant="quotation"
            documentRefs={[
                { label: "เลขที่เอกสาร", value: quotationNumber },
                { label: "วันที่เอกสาร", value: quotationDate },
                ...(validUntil ? [{ label: "ใช้ได้ถึง", value: validUntil }] : []),
            ]}
            addresseeLines={addresseeLines}
            {...(copy ? { bodyParagraph: copy.intro } : {})}
            signatures={signatures}
            // The payment line is the server's `copy.note` — the same sentence the
            // PDF prints (invoice-template-service.js buildPaymentChannelLine). This
            // file used to carry its own copy of it, and a paragraph that doubled
            // the retired ministry name and offered "พืชกัญชา" on every application.
            footerNotes={[
                validUntil
                    ? `หมายเหตุ: ใบเสนอราคานี้ใช้ได้ถึง ${validUntil}`
                    : "หมายเหตุ: ใบเสนอราคานี้มีผลบังคับใช้ตามวันที่ระบุด้านบน",
                ...(copy ? [`การชำระเงิน: ${copy.note}`] : []),
            ]}
        >
            {/* Verification note */}
            <div style={{ marginBottom: "8px", fontSize: "12pt" }}>
                <p>ทั้งนี้ท่านได้ตรวจสอบรายการจำนวนและราคาข้างต้นเรียบร้อยแล้ว</p>
            </div>

            <DtamItemsTable
                items={tableItems}
                {...(typeof subtotal === "number" ? { subtotal } : {})}
                {...(typeof vat === "number" ? { vat } : {})}
                {...(vatLabel ? { vatLabel } : {})}
                totalAmount={totalAmount}
                totalAmountText={totalAmountText}
            />

            {serviceNotes.length > 0 ? (
                <div style={{ marginTop: "8px", fontSize: "10pt" }}>
                    {serviceNotes.map((note) => (
                        <p key={note.name}>
                            <strong>{note.name}</strong> {note.coverage}
                        </p>
                    ))}
                </div>
            ) : null}
        </DtamDocumentLayout>
    );
}
