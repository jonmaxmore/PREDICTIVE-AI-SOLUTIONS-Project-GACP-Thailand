/**
 * Invoice / Receipt Template Service
 * Generates official financial documents using HTML templates + Puppeteer.
 * Replaces the legacy PDFKit-based pdf-service.js for invoice/receipt generation.
 */

const path = require('path');
const pdfGenerator = require('./pdf-generator.service');
const storageService = require('../storage-service');
const logger = require('../../shared/logger');
const { formatThaiDate, formatThaiDateFull, formatCurrency } = require('../../utils/thai-format');
// The printed tax year is the Bangkok year of the document date (CODE-01).
const { getZonedParts } = require('../../utils/working-days');
// MINISTRY_CONTACT_LINE (shared/ministry-contact.js) is NOT imported here any
// more (fix/invoice-pdf-truth, 2026-09-27): these documents are issued by the
// company, never the ministry, and printing the ministry's switchboard here
// told the company's own customers to call the wrong party. The one
// remaining legitimate reader of MINISTRY_CONTACT_LINE is
// shared/terminal-letter-template.js — the ministry's own decision letter,
// which really is issued in the ministry's name. See buildCompanyContactLine()
// below for what this file prints instead.
// Quotation validity fallback text, read from the same config the row's own
// `validUntil` is computed from (quotation-service.js) — used ONLY when no
// stored row is handed over, so this document never prints a hardcoded day
// count that could drift from the operator's ruling (config/business-rules.js
// PAYMENT.QUOTATION_VALIDITY_BUSINESS_DAYS).
const { PAYMENT } = require('../../config/business-rules');
// The checksum-guarded printable-id rule (`isPrintableJuristicTaxId`) moved to
// utils/applicant-resolver.js with the payer labels (payer-block-by-type,
// 2026-09-27): this file prints what the resolver decided, it decides nothing.

// Invoice due date uses CALENDAR days (not business days).
// Rationale: invoices follow standard commercial terms, not office-hour policies.
// The 5-business-day rule applies only to revision deadlines (working-days-service).
const INVOICE_DUE_CALENDAR_DAYS = 7;

const { getLogoDataUrl, getCompanyLogoDataUrl } = require('./pdf-assets');

const TEMPLATE_DIR = path.join(__dirname, 'templates');

const { numberToThaiText } = require('../../utils/number-to-thai-text');
// Tier 12 fix (re-applied 2026-05-16): issuer info (legal name, tax ID,
// address, branch) comes from canonical `config/invoice-issuers.js` — NEVER
// hardcoded in the HTML template. Tax invoice is always issued by PLATFORM
// (per ม.86/4 ป.รัษฎากร — VAT-registered entity); state receipt is always
// issued by DTAM (government revenue, VAT-exempt — Revenue Code does not
// permit issuing a full tax invoice for government revenue).
//
// Single Issuer Compliance Fix (2026-05-16): templates no longer combine
// two issuers' lines in a single document. Each render path now resolves
// exactly one issuer (DTAM or PLATFORM) and emits totals / payment-info
// rows for that side only. ม.86 ป.รัษฎากร — one document, one seller.
const {
    getInvoiceIssuer,
    ISSUER_TYPES,
    PLATFORM_ISSUER,
} = require('../../config/invoice-issuers');
// B16-D (2026-05-16): receipt-numbering service supplies Thai-numeral
// formatting for the DTAM receipt template and the Thai-month + BE-year
// date format common to both templates.
const receiptNumbering = require('../receipt-numbering-service');
const { storedCultivationScopeCount } = require('../../shared/application-scope');
const { ERROR_CODES, getMessage } = require('../../shared/error-codes');
// One reader of "what does this instalment ask for", shared with the quotation
// API line items so the screen and the document cannot disagree.
const {
    instalmentPayable, rowScopeCount, scopeNamesFor, shareAcrossScopes,
    thaiLabelForMethod,
} = require('../quotation-line-items');
// "รายละเอียดสินค้า" detail block (owner request 2026-06-25) — plant,
// cultivation systems, scope count, phase, application no, farm/plot.
const { buildProductDetailLines } = require('./product-detail-builder');
// The plant's Thai name for the quotation paragraph — the closed vocabulary
// pinned to the plant_species seed (never a default plant).
const { plantNameTH } = require('../../config/plant-species-slugs');

// Escape user-controlled strings (farm/plot names flow into the detail block)
// before they reach the PDF HTML. Service labels are controlled, but the
// product detail carries applicant input.
const {
    serviceFor,
    serviceForServiceType,
    servicesForApplication,
    vatLine,
    purposeWord,
    isRenewalFiling,
} = require('../../shared/instalment-service-names');

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Render the detail lines as a compact sub-block under a line-item description.
function renderDetailLinesHtml(lines) {
    if (!lines.length) { return ''; }
    return '<div style="font-size:10px;color:#555;font-weight:normal;margin-top:3px;line-height:1.6">'
        + lines.map(escapeHtml).join('<br>')
        + '</div>';
}
function renderProductDetailHtml(application, opts) {
    return renderDetailLinesHtml(buildProductDetailLines(application, opts));
}
// B16-D (2026-05-16): single source of truth for ASCII → Thai-numeral
// transliteration on PDF display fields. The DB / API forms always stay
// ASCII for cross-system grep — Thai numerals appear ONLY on the rendered
// PDF (per RECEIPT-DESIGN-SPEC.md + Thai accounting style guide).
const {
    arabicToThai,
    formatThaiCurrency,
    formatThaiDate: formatThaiDateNumeric,
    formatThaiTaxId,
    thaiToArabic,
} = require('../../utils/thai-numerals');

/**
 * Resolve issuer info for a template fill-in from the canonical config.
 * Parses the `(สำนักงานใหญ่)` / `(สาขาที่ ...)` suffix from legalNameTH
 * because ม.86/4 (1) requires the branch designation to be shown.
 */
function resolveIssuerForTemplate(serviceType) {
    try {
        const issuer = getInvoiceIssuer(serviceType);
        const nameMatch = String(issuer.legalNameTH || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        const cleanName = nameMatch ? nameMatch[1].trim() : (issuer.legalNameTH || '');
        const branch = nameMatch ? nameMatch[2].trim() : 'สำนักงานใหญ่';
        const address = [issuer.addressLine1, issuer.addressLine2]
            .filter(Boolean).join(' ');
        return {
            name: cleanName || 'ผู้ออก',
            taxId: issuer.taxId || '-',
            branch,
            address: address || '-',
            // Pass through the discriminator so callers (totals-row +
            // payment-info builders) don't have to re-parse serviceType.
            issuerType: issuer.type,
            chargesVat: !!issuer.chargesVat,
        };
    } catch (_e) {
        // Unknown serviceType — fall back to a sentinel that QA notices in UAT
        // rather than crashing the receipt download path.
        return {
            name: 'PENDING_FINANCE_CONFIRMATION',
            taxId: '-',
            branch: 'สำนักงานใหญ่',
            address: '-',
            issuerType: null,
            chargesVat: false,
        };
    }
}

/**
 * Resolve the issuer for a document from its serviceType.
 *
 * W14 (operator ruling 2026-08-22, the change log c28355ea): there is only ONE
 * issuer left — the company. It issues ใบเสนอราคา, ใบวางบิล and ใบเสร็จ; the
 * farmer pays it; it settles with DTAM outside this system. So every recognised
 * application service type resolves to PLATFORM (the company), and the
 * DTAM branch that used to produce a VAT-exempt government-revenue document is
 * gone.
 *
 * The function is KEPT rather than deleted: the render paths call it to get the
 * issuer key they hand to buildTotalsRowsHtml / buildPaymentInfoHtml, and a
 * document that is not an application invoice at all must still be able to
 * answer `null` rather than being forced into an issuer it does not have.
 */
function detectIssuerSide(serviceType) {
    const s = String(serviceType || '').toUpperCase();
    if (s.includes('STATE_FEE')
        || s.includes('PLATFORM_FEE')
        || s.includes('AUDIT')
        || s.startsWith('SUBSCRIPTION_')) {
        return ISSUER_TYPES.PLATFORM;
    }
    return null;
}

/**
 * Build the totals table rows for an invoice / receipt body. DTAM (state)
 * receipts show ONLY ยอดรวม + รวมทั้งสิ้น (government revenue is VAT-exempt
 * per ม.77/1 (10) ป.รัษฎากร). PLATFORM tax invoices / receipts show
 * ยอดรวม + VAT 7% + รวมทั้งสิ้น. The two sides MUST NOT be combined on a
 * single document per ม.86 + ม.86/4 ป.รัษฎากร (one document = one seller).
 *
 * @param {string} issuerType — ISSUER_TYPES.DTAM or ISSUER_TYPES.PLATFORM
 * @param {object} amounts    — { subtotal, vat, total }
 * @param {string} [variant]  — 'invoice' or 'receipt' (controls the grand
 *                              row label: "ยอดที่ต้องชำระทั้งสิ้น" vs
 *                              "ยอดที่รับชำระทั้งสิ้น")
 */
function buildTotalsRowsHtml(issuerType, amounts, variant = 'invoice') {
    const subtotal = formatCurrency(amounts.subtotal || 0);
    const vat = formatCurrency(amounts.vat || 0);
    const total = formatCurrency(amounts.total || 0);
    const grandLabel = variant === 'receipt'
        ? 'ยอดที่รับชำระทั้งสิ้น'
        : 'ยอดที่ต้องชำระทั้งสิ้น';

    // W14 — ONE issuer, so ONE shape of totals block. The VAT-exempt variant
    // that used to be printed for DTAM is removed: the company sells a service
    // and charges 7% VAT on the whole ค่าบริการ (ม.86/4 ป.รัษฎากร). A document
    // that showed no VAT line would now understate the tax actually charged.
    // `issuerType` is retained in the signature because callers pass it and a
    // future second issuer would need it again — it no longer branches.
    return `
        <tr>
          <td>ค่าบริการ / Service fee</td>
          <td>${subtotal} บาท</td>
        </tr>
        <tr>
          <td>${escapeHtml(vatLine(PLATFORM_ISSUER.vatRate).name)} / VAT</td>
          <td>${vat} บาท</td>
        </tr>
        <tr class="grand">
          <td>${grandLabel}</td>
          <td>${total} บาท</td>
        </tr>`;
}

/**
 * Build the payment-info two-column HTML for an invoice. Pulls bank
 * channel from `config/invoice-issuers.js` so the destination account
 * always matches the issuer in the header — never DTAM's account on a
 * PLATFORM invoice (which would route platform receivables into the
 * state-revenue ledger and violate ม.86 ป.รัษฎากร — one document, one
 * receiver). PENDING sentinels surface untouched so QA spots gaps.
 */
function buildPaymentInfoHtml(_issuerType) {
    // Stripe-only (operator 2026-09-06: "เราจ่ายเงินผ่าน strip เท่านั้น"). No bank
    // transfer — the document carries no manual-payment channel; the applicant
    // pays through the system's payment page and the receipt is issued
    // automatically on Stripe settlement. Replaces the getBankAccountForIssuer
    // block (part of the retired bank-slip subsystem).
    //
    // Fix round 1 (2026-09-26, review Minor-1): the "PromptPay" name below used
    // to be a hardcoded literal — a second independent copy of the exact fact
    // `bankLine` (buildPlatformQuotationMeta, below) derives from
    // CHECKOUT_PAYMENT_METHOD_TYPES via checkoutMethodLabelTH()/-EN(). This
    // line keeps its own (English) wording but now reads the same list, via
    // the English sibling of that same map: a method the rail starts/stops
    // offering with no name in it fails loud, on both lines, instead of
    // drifting only one of them.
    return `
    <div class="pay-grid">
      <div class="pay-field">
        <div class="lbl">การชำระเงิน / Payment</div>
        <div>${escapeHtml(buildPaymentChannelLine())}</div>
        <div class="payment-note-small">ใบเสร็จรับเงินออกอัตโนมัติเมื่อชำระเงินสำเร็จ</div>
      </div>
    </div>`;
}

// ── Service type labels ───────────────────────────────────────────────────────
function serviceTypeLabel(serviceType, { application } = {}) {
    // fix/fee-line-descriptions (operator 2026-10-03): the serviceType checkout mints
    // (CERTIFICATION_CHECKOUT_M1/M2) is named from the one catalogue, renewal-aware —
    // a renewal is billed on M2 but is its own service. It used to fall through to
    // the generic fallback below and print "ค่าบริการ GACP" on every real invoice.
    const catalogued = serviceForServiceType(serviceType, { isRenewal: isRenewalFiling(application) });
    if (catalogued) { return catalogued.name; }
    const map = {
        PHASE_1_STATE_FEE: 'ค่าธรรมเนียมรัฐ ขั้นที่ 1 (ตรวจเอกสาร)',
        APPLICATION_FEE: 'ค่าธรรมเนียมยื่นคำขอ GACP',
        PHASE_1_PLATFORM_FEE: 'ค่าบริการแพลตฟอร์ม ขั้นที่ 1',
        PHASE_2_STATE_FEE: 'ค่าธรรมเนียมรัฐ ขั้นที่ 2 (ตรวจประเมิน)',
        AUDIT_FEE: 'ค่าธรรมเนียมการตรวจประเมิน',
        PHASE_2_AUDIT: 'ค่าธรรมเนียมตรวจประเมิน ขั้นที่ 2',
        PHASE2_AUDIT: 'ค่าธรรมเนียมตรวจประเมิน ขั้นที่ 2',
        PHASE_2_PLATFORM_FEE: 'ค่าบริการแพลตฟอร์ม ขั้นที่ 2',
        SUBSCRIPTION_PREMIUM_MONTHLY: 'ค่าสมาชิกแผน Premium (รายเดือน)',
        SUBSCRIPTION_PREMIUM_YEARLY: 'ค่าสมาชิกแผน Premium (รายปี)',
        SUBSCRIPTION_ENTERPRISE_MONTHLY: 'ค่าสมาชิกแผน Enterprise (รายเดือน)',
        SUBSCRIPTION_ENTERPRISE_YEARLY: 'ค่าสมาชิกแผน Enterprise (รายปี)',
    };
    // The `*_STATE_FEE` / `AUDIT_FEE` / `APPLICATION_FEE` rows above are the
    // legacy pre-split STATE fee (retired separately — left untouched here).
    // Every OTHER charge is the company's own ค่าบริการ (operator ruling
    // 2026-09-11: "ต่อไปนี้จะไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการ
    // ทั้งหมด"). The fallback below is what actually prints on today's real
    // invoices: checkout mints serviceType `CERTIFICATION_CHECKOUT_<milestone>`
    // (stripe-checkout-service.checkoutInvoiceServiceType), which this map does
    // not carry a row for — it used to fall through to "ค่าธรรมเนียม GACP", the
    // one wrong word on an otherwise-correct document (fix/invoice-pdf-truth,
    // 2026-09-27; reproduced live on INV-CO-CAFF6646-M1).
    // An unmapped type names no service it cannot vouch for: the bare word.
    return map[String(serviceType || '').toUpperCase()] || 'ค่าบริการ';
}

// Returns true when the invoice is for a subscription order (vs an
// application fee). Used to skip phase-based line-item generation and
// the application-number header label.
function isSubscriptionInvoice(invoice) {
    if (invoice.subscriptionId) {return true;}
    return String(invoice.serviceType || '').toUpperCase().startsWith('SUBSCRIPTION_');
}

// What goes in the "Application Number" header slot. For subscription
// invoices we don't have an application — show the subscription tier +
// cycle so the receipt has a recognisable identifier instead of "-".
function applicationLabelFor(invoice) {
    if (invoice.application?.applicationNumber) {return invoice.application.applicationNumber;}
    if (invoice.applicationId) {return invoice.applicationId;}
    if (isSubscriptionInvoice(invoice)) {
        const sub = invoice.subscription;
        if (sub?.tier && sub?.billingCycle) {
            return `Subscription · ${sub.tier} ${sub.billingCycle}`;
        }
        return 'Subscription order';
    }
    return '-';
}

// ── Build items table rows HTML ───────────────────────────────────────────────
//
// W14 (operator ruling 2026-08-22, the change log c28355ea): the `issuerSide`
// parameter is REMOVED. It used to filter line items so a DTAM document did not
// also print the PLATFORM service-fee line — the combination ม.86 ป.รัษฎากร
// prohibits when there are two sellers. There is one seller now, so every line
// belongs on the one document and there is nothing to filter out.
function buildItemsRows(invoice) {
    // Subscription invoices are a single line — no phase split, no VAT
    // breakdown. Always belong to PLATFORM (per service-type classifier).
    if (isSubscriptionInvoice(invoice)) {
        const desc = serviceTypeLabel(invoice.serviceType);
        const amount = Number(invoice.totalAmount) || 0;
        return `<tr>
          <td>1</td>
          <td>${desc}</td>
          <td class="r">1</td>
          <td class="r">${formatCurrency(amount)}</td>
          <td class="r">${formatCurrency(amount)}</td>
        </tr>`;
    }

    // Application-fee invoices: each invoice is single-side (its serviceType
    // decides the side), so render ONE line from the invoice's OWN stored
    // amounts. The stored subtotal/vat/totalAmount were computed per-scope at
    // creation (modules/billing fee-service × scopeCount); recomputing here via
    // the flat `buildTaxInvoiceLineItems(phase)` ignored scope and understated
    // the document (e.g. printed 535 on a 1,605 invoice). Source of truth =
    // the invoice row, never a re-derivation.
    // W14 — no line is VAT-exempt any more. Every line on every document is
    // part of the company's own ค่าบริการ, so the "(ยกเว้น VAT)" annotation and
    // the state-side amount derivation are both gone. Keeping either would
    // print a VAT-exempt claim on a line that was in fact taxed.
    const desc = serviceTypeLabel(invoice.serviceType, { application: invoice.application });
    const amts = deriveInvoiceAmounts(invoice);
    const vatLabel = '';
    // "รายละเอียดสินค้า" — per-scope state/platform amounts divide evenly
    // (state×scope, platform=10%×state) so subtotal/scopeCount is exact.
    const scopeCount = storedCultivationScopeCount(invoice.application);
    const perScope = (scopeCount && amts.subtotal) ? Math.round(amts.subtotal / scopeCount) : null;
    const detailHtml = renderProductDetailHtml(invoice.application, {
        phase: invoice.serviceType,
        scopeCount,
        perScope,
    });
    // The line shows the pre-VAT subtotal as the unit price; the row total is
    // the subtotal (the VAT, if any, is shown in the totals block below).
    return `<tr>
      <td>1</td>
      <td>${escapeHtml(desc)} ${vatLabel}${detailHtml}</td>
      <td class="r">1</td>
      <td class="r">${formatCurrency(amts.subtotal)}</td>
      <td class="r">${formatCurrency(amts.subtotal)}</td>
    </tr>`;
}

// Single source of truth for what a document should display: the invoice row's
// own stored amounts (per-scope correct from creation). When `subtotal`/`vat`
// weren't persisted on a legacy row, reverse-derive them from `totalAmount`
// (VAT-inclusive) so the printed numbers always reconcile to the charged total.
//
// W14 — the `isStateSide` branch that forced vat=0 is gone: there is no
// VAT-exempt state-side document any more.
//
// A STORED VALUE WINS, INCLUDING ZERO. This is the difference between "no VAT
// was charged" and "we do not know what the VAT was", and conflating them
// fabricates tax on a document. The phase-invoice mint still writes a STATE
// component with vat=0 (all of a phase's VAT is carried on its PLATFORM
// component so the two sum to the right total); reverse-deriving that zero
// would print ~327 THB of VAT on a 5,000 THB line that was never taxed.
// Only a genuinely ABSENT vat is reverse-derived.
function deriveInvoiceAmounts(invoice) {
    const total = Number(invoice.totalAmount) || 0;
    const storedVat = invoice.vat === null || invoice.vat === undefined
        ? null
        : Number(invoice.vat);
    const vat = Number.isFinite(storedVat)
        ? storedVat
        : Math.round((total * 7) / 107);
    const storedSubtotal = invoice.subtotal === null || invoice.subtotal === undefined
        ? null
        : Number(invoice.subtotal);
    const subtotal = Number.isFinite(storedSubtotal) && storedSubtotal > 0
        ? storedSubtotal
        : (total - vat);
    return { subtotal, vat, total };
}

// ── Resolve payer info from invoice ──────────────────────────────────────────
// The payer block on every finance document — name label, name, id label and
// the printed id — comes from ONE place, utils/applicant-resolver.js (operator
// rule 2026-09-27, "อนุมัติ"):
//
//   INDIVIDUAL            the national ID is never printed, full or partial
//   JURISTIC              Entity.juristicId, only when checksum-valid + leading '0'
//   COMMUNITY_ENTERPRISE  Entity.communityRegNo; the tax invoice's buyer tax id is "-"
//
// This file reads `nameLabelBilingual` / `idLabelBilingual` / `idPrinted` /
// `buyerTaxIdPrinted` off the resolver's answer and prints them verbatim. It
// holds no label text and no printable-id rule of its own: before this change
// it had a two-way label switch with no community branch (L-092) and a second
// printable-id guard, and the quotation printed a third, unguarded `payer.id`
// (L-084 — an individual's national ID under "เลขประจำตัวผู้เสียภาษี").
const { resolveApplicantInfo: resolvePayerInfo } = require('../../utils/applicant-resolver');

/**
 * The printed id in Thai digits, for the Thai-numeral documents (tax invoice,
 * credit/debit note): a 13-digit tax id in the 1-4-5-2-1 grouping, any other
 * shape (an 11-digit community registration number) digit-for-digit.
 */
function thaiDigitsId(idPrinted) {
    if (!idPrinted || idPrinted === '-') { return '-'; }
    return arabicToThai(formatThaiTaxId(idPrinted));
}

/**
 * The company contact line printed on invoice/receipt/tax-invoice/credit-
 * note/debit-note footers — replaces MINISTRY_CONTACT_LINE (fix/invoice-pdf-
 * truth, 2026-09-27; same shape buildPlatformQuotationMeta already uses for
 * the quotation since 2026-09-11).
 *
 * The phone is not decided yet (operator skipped it, 2026-09-26): when
 * PLATFORM_ISSUER.contactPhone is PENDING or empty, no phone prints at all —
 * never a placeholder, and never the ministry's number.
 */
function buildCompanyContactLine() {
    const phone = PLATFORM_ISSUER.contactPhone;
    const bits = [
        phone && !String(phone).startsWith('PENDING') ? `โทร: ${phone}` : null,
        PLATFORM_ISSUER.contactEmail ? `อีเมล: ${PLATFORM_ISSUER.contactEmail}` : null,
    ].filter(Boolean);
    return bits.join(' | ');
}

// ── B16-D approver-block helpers ─────────────────────────────────────────────
//
// Every auto-signed receipt embeds the approver's identity + signing
// timestamp INSIDE the PDF (and therefore INSIDE the SHA-256 pre-image the
// RSA signature covers). Any tamper on these strings invalidates the
// signature, which is exactly the integrity guarantee ISO 27799 §7.2.3 asks
// for.
//
// With no `approver` (every paper today) the block is neutral: "-" in the
// approver box, and NO line on the signer block — the seller company's name
// under the signer role stands alone. It used to print "ระบบออกเอกสารอัตโนมัติ",
// which is the paper talking about the system (review round 2, operator ruling:
// a document speaks to the customer, never about the system). No invented person.
//
// APPROVER_SIGNER_LINE_HTML is the signer-block line: the approver's name when
// one signed, nothing otherwise (raw HTML, the name escaped here).
function buildApproverFields(approver) {
    if (!approver) {
        return {
            APPROVER_NAME: '-',
            APPROVER_SIGNER_LINE_HTML: '',
            APPROVER_POSITION: '-',
            APPROVER_ROLE: '-',
            APPROVER_SIGNED_AT_TH: '-',
        };
    }
    const signedAt = approver.approvedAt instanceof Date
        ? approver.approvedAt
        : (approver.approvedAt ? new Date(approver.approvedAt) : new Date());
    return {
        APPROVER_NAME: approver.name || '-',
        APPROVER_SIGNER_LINE_HTML: approver.name ? `<div class="name">${escapeHtml(approver.name)}</div>` : '',
        // ผู้ออกเอกสารรายเดียว ⇒ ตำแหน่งผู้อนุมัติชุดเดียว (operator 2026-09-11)
        APPROVER_POSITION: approver.position || 'หัวหน้าบัญชี',
        APPROVER_ROLE: approver.role || 'FINANCE_OFFICER_PLATFORM',
        APPROVER_SIGNED_AT_TH: formatThaiDateNumeric(signedAt),
    };
}

/**
 * Build the template-substitution map for a receipt render. Pure (no DB,
 * no I/O) so unit tests can assert the placeholder dictionary directly.
 *
 * Returns BOTH ASCII forms and Thai-numeral forms:
 *   ASCII   ({{RECEIPT_NUMBER}}, {{ISSUE_DATE}}, …)  →  used in the
 *           "Reference Number" footer line for cross-system grep.
 *   Thai-numeral ({{RECEIPT_NUMBER_TH}}, {{ISSUE_DATE_TH}}, …) → used in
 *           the visible body of the receipt.
 *
 * @param {object} invoice             Prisma Invoice record
 * @param {object} [approver]          { id, name, role, position, approvedAt }
 * @returns {object} flat key → string map for replaceTemplateVariables
 */
function buildReceiptContext(invoice, approver) {
    const issueDate = invoice.receiptIssuedAt || invoice.paidAt || new Date();
    const amount = Number(invoice.totalAmount) || 0;
    // ยอดก่อน VAT / VAT มาจากตัวเลขที่เก็บไว้บนใบเอง (ถูกต้องรายรูปแบบตั้งแต่ตอนสร้าง)
    // deriveInvoiceAmounts ถอด VAT กลับให้แถวรุ่นเก่าที่ยังไม่มีช่องแยก เพื่อให้ตัวเลขไทย
    // ที่แสดงกระทบยอดกับ totalAmount ได้ · ไม่มีฝั่งที่ยกเว้น VAT แล้ว จึงส่ง false เสมอ
    const { subtotal, vat } = deriveInvoiceAmounts(invoice, false);
    const receiptNumberAscii = invoice.receiptNumber || '-';

    // We don't fiscal-shift PLATFORM here because PLATFORM tax invoices key
    // off CE calendar-year per ภ.พ.30 VAT filing rules.
    const issueDateObj = issueDate instanceof Date ? issueDate : new Date(issueDate);
    const beYear = getZonedParts(issueDateObj).year + 543;
    // Fix (2026-09-27): the buyer tax id used to be read off `invoice.applicant?.taxId`,
    // a dead legacy User column that is never selected, so a company always
    // printed '-'. It is resolved from the entity, the same source as PAYER_ID.
    // The buyer tax id is a company's only, checksum-guarded — decided by the
    // resolver (`buyerTaxIdPrinted`), printed here.
    const receiptPayer = resolvePayerInfo(invoice);
    const payerTaxId = receiptPayer.buyerTaxIdPrinted;
    return {
        // ASCII — stable identifiers, foot-of-page reference, JSON / API.
        RECEIPT_NUMBER: receiptNumberAscii,
        ISSUE_DATE: formatThaiDate(issueDateObj),
        SUBTOTAL: formatCurrency(subtotal),
        TOTAL: formatCurrency(amount),
        VAT: formatCurrency(vat),
        // Thai-numeral display — visible body. arabicToThai is a no-op on
        // non-digit characters so '-' / placeholder text passes through.
        RECEIPT_NUMBER_TH: arabicToThai(receiptNumberAscii),
        ISSUE_DATE_TH: formatThaiDateNumeric(issueDateObj),
        YEAR_BE_TH: arabicToThai(beYear),
        SUBTOTAL_TH: formatThaiCurrency(subtotal),
        VAT_TH: formatThaiCurrency(vat),
        TOTAL_TH: formatThaiCurrency(amount),
        PAYER_TAX_ID_TH: thaiDigitsId(payerTaxId),
        // The same buyer tax id in Arabic digits, grouped 1-4-5-2-1, for the
        // receipt / tax invoice paper (its body prints Arabic numerals like the
        // invoice). "-" for anyone but a company.
        BUYER_TAX_ID: payerTaxId && payerTaxId !== '-' ? thaiToArabic(formatThaiTaxId(payerTaxId)) : '-',
        // Approver block — gated by the optional opts.approver argument.
        ...buildApproverFields(approver),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared render+upload boilerplate for every official-document generator
 * (invoice / receipt / tax-invoice / quotation / credit-note / debit-note).
 * Each previously inlined the identical sequence: readTemplateCached →
 * replaceTemplateVariables → generatePDF (A4, 10mm margins) → optional upload.
 * DRY-extracted (targeted refactor 2026-06-05) — generatePDF options verified
 * identical across all call sites; only the template file, upload key, and log
 * label vary. Behaviour-preserving.
 *
 * @param {string} templateFile  filename under TEMPLATE_DIR (e.g. 'invoice.html')
 * @param {Object} data          replaceTemplateVariables substitution map
 * @param {Object} [opts]
 * @param {boolean} [opts.upload=true]
 * @param {string}  [opts.uploadKey]  storage key (skipped if upload=false / unset)
 * @param {string}  [opts.logLabel='PdfTemplate']
 * @param {boolean} [opts.htmlOnly=false]  testability hook (fix/invoice-pdf-
 *        truth, 2026-09-27) — return the substituted HTML string instead of
 *        a rendered PDF Buffer, so unit tests can assert the exact text the
 *        real template + real data would produce without launching
 *        Puppeteer (pdf-parse's pdfjs-dist needs --experimental-vm-modules,
 *        which the jest CJS transform doesn't provide). Production callers
 *        never pass this — the returned shape only changes when a caller
 *        explicitly opts in.
 * @returns {Promise<Buffer|string>}
 */
async function renderTemplateToPdf(templateFile, data, {
    upload = true, uploadKey, logLabel = 'PdfTemplate', htmlOnly = false,
} = {}) {
    const templatePath = path.join(TEMPLATE_DIR, templateFile);
    const template = pdfGenerator.readTemplateCached(templatePath);
    const html = pdfGenerator.replaceTemplateVariables(template, data);

    if (htmlOnly) { return html; }

    const buffer = await pdfGenerator.generatePDF(html, {
        format: 'A4',
        landscape: false,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    if (upload && uploadKey) {
        try {
            await storageService.uploadBuffer(storageService.BUCKETS.pdfs, uploadKey, buffer, 'application/pdf');
            logger.info(`[${logLabel}] Uploaded: ${uploadKey}`);
        } catch (err) {
            logger.warn(`[${logLabel}] Upload failed (returning buffer anyway):`, err.message);
        }
    }

    return buffer;
}

/**
 * Generate an official Invoice PDF.
 *
 * @param {Object} invoice  Prisma Invoice record (include Applicant / application.applicant)
 * @param {Object} [opts]
 * @param {boolean} [opts.upload=true]
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(invoice, opts = {}) {
    const upload = opts.upload !== false;
    const payer = resolvePayerInfo(invoice);

    const serviceType = String(invoice.serviceType || '').toUpperCase();
    const isPhase2 = serviceType.includes('PHASE_2') || serviceType.includes('AUDIT');

    // Single Issuer Compliance Fix (2026-05-16): resolve exactly ONE
    // issuer for this invoice. Per ม.86 ป.รัษฎากร an invoice cannot
    // simultaneously announce two sellers; we render the side that owns
    // this serviceType. Subscription / legacy invoices default to
    // PLATFORM (commercial service path).
    const issuerSide = detectIssuerSide(serviceType) || ISSUER_TYPES.PLATFORM;
    // ผู้ออกเอกสารรายเดียว — ไม่มีสาขา `*_STATE_FEE` ให้เลือกอีกแล้ว
    const issuerServiceType = isPhase2 ? 'PHASE_2_PLATFORM_FEE' : 'PHASE_1_PLATFORM_FEE';
    const issuer = resolveIssuerForTemplate(issuerServiceType);

    // Issuer-side amounts come from the INVOICE ROW (per-scope correct from
    // creation), not the flat phase `breakdown` — the breakdown ignored
    // scopeCount and understated multi-scope invoices (printed 535 on a 1,605
    // invoice). STATE is VAT-exempt; PLATFORM (incl. subscription) carries 7%.
    // ไม่มีฝั่งที่ยกเว้น VAT อีกแล้ว (operator 2026-09-11) — ทุกใบคิด VAT
    const {
        subtotal: subtotalForIssuer,
        vat: vatForIssuer,
        total: totalForIssuer,
    } = deriveInvoiceAmounts(invoice, false);

    const dueDate = invoice.dueDate
        ? formatThaiDate(invoice.dueDate)
        : formatThaiDate(new Date(new Date(invoice.createdAt).getTime() + INVOICE_DUE_CALENDAR_DAYS * 24 * 3600 * 1000));

    const data = {
        ISSUER_LOGO_DATA_URL: getCompanyLogoDataUrl(),
        // Operator ruling (finance-documents-three-rulings): 3 documents, not
        // 4 — this one is "ใบวางบิล / ใบแจ้งหนี้", not bare "ใบแจ้งหนี้"
        // (fix/invoice-pdf-truth, 2026-09-27).
        DOC_TYPE_TH: 'ใบวางบิล / ใบแจ้งหนี้',
        DOC_TYPE_EN: 'INVOICE',
        DOC_NUMBER: invoice.invoiceNumber || '-',
        ISSUE_DATE: formatThaiDate(invoice.createdAt),
        DUE_DATE: dueDate,
        APPLICATION_NUMBER: applicationLabelFor(invoice),
        PAYER_NAME_LABEL: payer.nameLabelBilingual,
        PAYER_NAME: payer.name,
        PAYER_ID_LABEL: payer.idLabelBilingual,
        PAYER_ID: payer.idPrinted,
        PAYER_ADDRESS: payer.address,
        ITEMS_ROWS: buildItemsRows(invoice),
        // ม.86 ป.รัษฎากร (one document = one seller): issuer block goes
        // into the header, payment-info goes into the footer — both
        // resolved from `config/invoice-issuers.js` for this side ONLY.
        ISSUER_NAME_TH: issuer.name,
        ISSUER_TAX_ID: issuer.taxId,
        ISSUER_BRANCH: issuer.branch,
        ISSUER_ADDRESS: issuer.address,
        TOTALS_ROWS_HTML: buildTotalsRowsHtml(
            issuerSide,
            { subtotal: subtotalForIssuer, vat: vatForIssuer, total: totalForIssuer },
            'invoice',
        ),
        PAYMENT_INFO_HTML: buildPaymentInfoHtml(issuerSide),
        INVOICE_DUE_DAYS: String(INVOICE_DUE_CALENDAR_DAYS),
        TOTAL_AMOUNT: formatCurrency(totalForIssuer),
        TOTAL_AMOUNT_TEXT: numberToThaiText(totalForIssuer),
        COMPANY_CONTACT_LINE: buildCompanyContactLine(),
    };

    return renderTemplateToPdf('invoice.html', data, {
        upload,
        uploadKey: `invoices/${invoice.invoiceNumber}.pdf`,
        logLabel: 'InvoiceTemplate',
        htmlOnly: opts.htmlOnly,
    });
}

/**
 * What the paper prints under "วิธีชำระ / Method". The row stores a rail code
 * (checkout settlement writes 'STRIPE'; older paths wrote others). Every payment
 * is taken through the system's payment page and the rail does not record which
 * method the payer chose there, so every known rail code prints the one thing
 * that is true: "ชำระผ่านระบบ". An unknown code prints "-", never itself — the
 * paper speaks to the customer and names no provider.
 */
const RAIL_CODES_PAID_THROUGH_THE_SYSTEM = Object.freeze(new Set([
    'STRIPE', 'PROMPTPAY', 'CARD', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'QR_CASH', 'QR', 'ONLINE',
]));
function paymentMethodPrinted(invoice) {
    const code = String(invoice?.paymentMethod || '').trim().toUpperCase();
    return RAIL_CODES_PAID_THROUGH_THE_SYSTEM.has(code) ? 'ชำระผ่านระบบ' : '-';
}

/**
 * The buyer's registration row, when the payer-block rule (utils/applicant-
 * resolver.js) prints an id that is not the buyer tax id — today that is a
 * community enterprise's registration number (a company's id IS its tax id, a
 * person prints no id). Label and value both come from the resolver; this
 * decides only whether the row is needed.
 */
function buyerRegistrationRowHtml(payer) {
    if (!payer || payer.idPrinted === '-' || payer.idPrinted === payer.buyerTaxIdPrinted) { return ''; }
    return `<div class="field">
        <span class="lbl">${escapeHtml(payer.idLabelBilingual)}</span><br>
        <span class="val">${escapeHtml(payer.idPrinted)}</span>
      </div>`;
}

/**
 * ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป — the third finance document, ONE paper
 * (operator-approved design docs/design/2026-09-05-finance-documents-design.md
 * §1 row 3 + §3.3). Both invoice-service.generateReceiptPdf callers — the staff
 * route GET /api/invoices/:id/receipt/pdf and the applicant's own
 * GET /api/invoices/my/:id/receipt/pdf — render this and nothing else.
 *
 * Until 2026-09-29 there were two templates: receipt.html (titled ใบเสร็จรับเงิน
 * only, printing the rail code 'STRIPE' as the payment method) served by both
 * routes, and tax-invoice.html, which carried the ม.86/4 blocks but was served
 * by no route. Neither was the ruled document; both are gone.
 *
 * The number is the TAX-PRD number the settlement stored, printed exactly as
 * stored. No stored number → refused (RECEIPT_NOT_ISSUED): this paper never
 * falls back to the invoice number, because a tax invoice without its own
 * number is not one. A retired `*_STATE_FEE` row is refused too
 * (INVALID_ISSUER_SIDE): one seller, one VAT number, and a row whose service
 * type says it is someone else's revenue must not carry it.
 *
 * Payer block: utils/applicant-resolver.js — the company's tax id only
 * (`buyerTaxIdPrinted`, grouped 1-4-5-2-1); a person or a community enterprise
 * prints "-", never a national ID.
 *
 * @param {Object} invoice  invoice-service.getForDocument row
 * @param {Object} [opts]
 * @param {boolean} [opts.upload=true]
 * @param {boolean} [opts.htmlOnly=false]  see renderTemplateToPdf
 * @returns {Promise<Buffer|string>}
 */
async function generateReceiptTaxInvoicePdf(invoice, opts = {}) {
    const upload = opts.upload !== false;
    const serviceType = String(invoice.serviceType || '').toUpperCase();
    if (serviceType.includes('STATE_FEE')) {
        const err = new Error(
            '[generateReceiptTaxInvoicePdf] Cannot issue ใบกำกับภาษี for retired STATE service type '
            + `"${serviceType}". Since 2026-09-11 there is one issuer and no state-fee document; a row `
            + 'carrying it predates the ruling — reprice it onto the company rail rather than rendering it.',
        );
        err.code = 'INVALID_ISSUER_SIDE';
        err.expected = 'PLATFORM';
        err.actual = 'DTAM';
        err.serviceType = serviceType;
        throw err;
    }
    if (!String(invoice.receiptNumber || '').trim()) {
        throw Object.assign(new Error('Receipt not issued yet'), { statusCode: 409, code: 'RECEIPT_NOT_ISSUED' });
    }

    const payer = resolvePayerInfo(invoice);
    const issuer = resolveIssuerForTemplate(
        serviceType.includes('PHASE_2') || serviceType.includes('AUDIT')
            ? 'PHASE_2_PLATFORM_FEE'
            : 'PHASE_1_PLATFORM_FEE',
    );
    const { subtotal, vat, total } = deriveInvoiceAmounts(invoice);
    // One date format on the paper (full month name, Bangkok — design specimen);
    // a missing date prints "-", never today's date.
    const documentDate = invoice.receiptIssuedAt || invoice.paidAt || null;
    const paidAt = invoice.paidAt || invoice.receiptIssuedAt || null;
    const formatted = receiptNumbering.formatReceiptVariablesForIssuer(receiptNumbering.ISSUER.PLATFORM, {
        receiptNumber: invoice.receiptNumber,
        issueDate: documentDate,
        amount: total,
    });

    const data = {
        ISSUER_LOGO_DATA_URL: getCompanyLogoDataUrl(),
        ISSUER_NAME_TH: issuer.name,
        ISSUER_TAX_ID: issuer.taxId,
        ISSUER_BRANCH: issuer.branch,
        ISSUER_ADDRESS: issuer.address,
        COMPANY_CONTACT_LINE: buildCompanyContactLine(),
        INVOICE_NUMBER: invoice.invoiceNumber || '-',
        APPLICATION_NUMBER: applicationLabelFor(invoice),
        PAYER_NAME_LABEL: payer.nameLabelBilingual,
        PAYER_NAME: payer.name,
        PAYER_ADDRESS: payer.address,
        ITEMS_ROWS: buildItemsRows(invoice),
        TOTALS_ROWS_HTML: buildTotalsRowsHtml(ISSUER_TYPES.PLATFORM, { subtotal, vat, total }, 'receipt'),
        TOTAL_AMOUNT_TEXT: formatted.amountText || numberToThaiText(total),
        PAYMENT_METHOD: paymentMethodPrinted(invoice),
        // Design §3.3 "อ้างอิงการชำระ": the stored rows carry no customer-facing
        // payment number of their own (a checkout order has only its UUID and the
        // provider's intent id, and neither may be printed), so the reference is
        // the invoice number the payment settled — the number the customer paid
        // against on the payment page.
        PAYMENT_REFERENCE: invoice.invoiceNumber || '-',
        BUYER_REGISTRATION_ROW_HTML: buyerRegistrationRowHtml(payer),
        // RECEIPT_NUMBER (as stored), BUYER_TAX_ID, APPROVER_SIGNER_LINE_HTML.
        ...buildReceiptContext(invoice, opts.approver),
        ISSUE_DATE: formatThaiDateFull(documentDate),
        PAID_DATE: formatThaiDateFull(paidAt),
    };

    return renderTemplateToPdf('receipt-tax-invoice.html', data, {
        upload,
        uploadKey: `receipts/${invoice.receiptNumber}.pdf`,
        logLabel: 'ReceiptTaxInvoiceTemplate',
        htmlOnly: opts.htmlOnly,
    });
}

/**
 * ── DTAM_QUOTATION_META ถูกลบ 2026-09-11 ──────────────────────────────────────
 * เดิมเป็นหัวกระดาษของใบเสนอราคา "ฝั่งกรม": ชื่อกอง ที่อยู่กรม ผู้ลงนามของกรม
 * **บัญชีธนาคารของกรม (กรุงไทย 4750134376) และเลขประจำตัวผู้เสียภาษีของกรม
 * (0994000036540)** ฝังไว้ตรง ๆ ในโค้ด
 *
 * operator 2026-09-11: *"เลขที่ประจำตัวผู้เสียภาษี เป็นของบริษัทค่าเดียว ในใบเสนอราคา
 * ใบวางบิล และใบเสร็จ ก็จะเป็นของบริษัททั้งหมด"*
 *
 * ⇒ ไม่มีเอกสารการเงินใบใดออกในนามกรม · หัวกระดาษทุกใบมาจาก
 * `buildPlatformQuotationMeta()` ซึ่งอ่านตัวตนบริษัทจาก config/invoice-issuers.js
 * (ไม่ใช่ตัวเลขที่พิมพ์ไว้ในโค้ด)
 */

/**
 * หัวกระดาษของใบเสนอราคา ใบวางบิล และใบเสร็จ — **ของบริษัทรายเดียว**
 *
 * operator 2026-09-11: *"เลขที่ประจำตัวผู้เสียภาษี เป็นของบริษัทค่าเดียว ในใบเสนอราคา
 * ใบวางบิล และใบเสร็จ ก็จะเป็นของบริษัททั้งหมด"*
 *
 * ── สี่อย่างที่แก้พร้อมกัน (ทั้งหมดเป็นของกรมที่ค้างอยู่บนเอกสารบริษัท) ──
 *   • `division` เคยเป็น `บริษัท ${issuer.name}` แต่ชื่อขึ้นต้นด้วย "บริษัท" อยู่แล้ว
 *     ⇒ พิมพ์ออกมาเป็น "บริษัท บริษัท พรีดิกทีฟ…"
 *   • `contact` เคยเป็น MINISTRY_CONTACT_LINE — เบอร์ switchboard ของกรม
 *     บนเอกสารของบริษัท คือการบอกลูกค้าให้โทรหาคนที่ไม่ได้ออกใบให้เขา
 *   • `docRev` เคยเป็น "rev. 18 ธันวาคม 2566" ซึ่งเป็นเลขรุ่นของแบบฟอร์มราชการ
 *   • `bankLine` เคยบอกให้ติดต่อฝ่ายการเงินเรื่องเลขบัญชี — แต่การจ่ายเงินเป็น
 *     Stripe เท่านั้น (operator 2026-09-06) ไม่มีการโอนเข้าบัญชี
 *
 * one-fee residue sweep (2026-09-26): `bankLine` still said the customer pays
 * by credit/debit CARD. The rail offers PromptPay only
 * (services/checkout/stripe-checkout-service.js CHECKOUT_PAYMENT_METHOD_TYPES)
 * — card is refused by name on the web copy (constants/service-facts.ts
 * PAYMENT_CHANNEL_TH). The Thai name is read off the SAME offered-methods
 * list the web mirror test pins (frontend-service-facts-mirror.test.js
 * METHOD_NAME_TH), never a new literal — a method added to the rail with no
 * name here fails loud instead of drifting silently.
 */
const { CHECKOUT_PAYMENT_METHOD_TYPES } = require('../checkout/stripe-checkout-service');
const QUOTATION_METHOD_NAME_TH = Object.freeze({ promptpay: 'พร้อมเพย์', card: 'บัตร' });
function checkoutMethodLabelTH() {
    return [...CHECKOUT_PAYMENT_METHOD_TYPES]
        .map((method) => QUOTATION_METHOD_NAME_TH[method] || method)
        .join('/');
}
/**
 * Fix round 1 (2026-09-26, review Minor-1): `buildPaymentInfoHtml` (above)
 * used to hardcode its own English "PromptPay QR" sentence — a second,
 * independent copy of the exact fact `bankLine` derives via
 * `checkoutMethodLabelTH()`. English mirror of that same map/list, so the
 * receipt/invoice payment-info block and the quotation's bankLine both name
 * whatever the rail actually offers, from the same source, in each line's own
 * language — never a hand-typed duplicate either one could drift from.
 */
const QUOTATION_METHOD_NAME_EN = Object.freeze({ promptpay: 'PromptPay', card: 'card' });
function checkoutMethodLabelEN() {
    return [...CHECKOUT_PAYMENT_METHOD_TYPES]
        .map((method) => QUOTATION_METHOD_NAME_EN[method] || method)
        .join('/');
}
/**
 * The one payment-channel sentence every company document prints (invoice /
 * receipt payment block, the quotation's pay line, and the web quotation via
 * the quotation API `copy.note`). Named off CHECKOUT_PAYMENT_METHOD_TYPES, so a
 * method the rail starts or stops offering changes it everywhere at once.
 */
function buildPaymentChannelLine() {
    return `ชำระผ่านระบบด้วย ${checkoutMethodLabelEN()} QR ที่หน้าชำระเงินของระบบ`;
}
function buildPlatformQuotationMeta() {
    const issuer = resolveIssuerForTemplate('PHASE_1_PLATFORM_FEE');
    // PLATFORM_ISSUER comes from the top-level require above — this used to
    // be a second, local `require('../../config/invoice-issuers')` here,
    // functionally identical but a needless duplicate (fix/invoice-pdf-truth,
    // 2026-09-27, review round 1).
    const phone = PLATFORM_ISSUER.contactPhone;
    const contactBits = [
        phone && !String(phone).startsWith('PENDING') ? `โทร ${phone}` : null,
        PLATFORM_ISSUER.contactEmail ? `อีเมล ${PLATFORM_ISSUER.contactEmail}` : null,
    ].filter(Boolean);
    return {
        // บรรทัดบนหัวกระดาษคือ "สาขา" ไม่ใช่ชื่อบริษัทซ้ำอีกรอบ — แบบฟอร์มเดิมออกแบบให้
        // บรรทัดนี้เป็นชื่อกองภายใต้กรม · บริษัทไม่มีกอง มีแต่สาขา
        division: `(${issuer.branch})`,
        deptName: issuer.name,
        address: issuer.address,
        contact: contactBits.join(' · ') || '-',
        docRev: '',
        signatoryOrg: `ในนาม ${issuer.name}`,
        signatoryName: 'ผู้มีอำนาจลงนาม',
        signatoryTitle1: 'กรรมการผู้มีอำนาจ',
        signatoryTitle2: '',
        rateAuthority: issuer.name,
        bankAccountName: issuer.name,
        // ชำระผ่านระบบด้วย${METHOD} — ไม่มีการโอนเข้าบัญชีธนาคาร (operator 2026-09-06)
        bankLine: `ชำระผ่านระบบด้วย${checkoutMethodLabelTH()} ที่หน้าชำระเงินของคำขอ`,
        taxId: issuer.taxId,
    };
}

/**
 * The quotation's signatory block — the one the PDF prints (SIGNATORY_*),
 * handed to the web through the quotation API so the screen shows the same
 * signatory instead of a hardcoded named person (the audit ledger L-091).
 *
 * @returns {{org: string, name: string, title1: string, title2: string}}
 */
function buildQuotationSignatory() {
    const meta = buildPlatformQuotationMeta();
    return {
        org: meta.signatoryOrg,
        name: meta.signatoryName,
        title1: meta.signatoryTitle1,
        title2: meta.signatoryTitle2,
    };
}

/**
 * The issuer block of the quotation — the company, from config/invoice-issuers.js
 * through getInvoiceIssuer (fix/web-quotation-truth, operator-approved
 * 2026-09-28). The quotation API hands it to the web, which printed the retired
 * ministry header (name, 88/23 ถนนติวานนท์, 0-2591-7007, contact@) while the PDF
 * printed the company.
 *
 * `contact` is the PDF header's own line (buildPlatformQuotationMeta().contact):
 * one string, one phone-PENDING check — the web prints it where the PDF does
 * (fix round 1, review M-1), so a phone set in config appears on both.
 *
 * @returns {{name: string, taxId: string, address: string, email: string|null, branch: string, contact: string}}
 */
function buildQuotationIssuer() {
    const issuer = resolveIssuerForTemplate('PHASE_1_PLATFORM_FEE');
    const { contact } = buildPlatformQuotationMeta();
    let email = null;
    try {
        email = getInvoiceIssuer('PHASE_1_PLATFORM_FEE').contactEmail || null;
    } catch (_e) {
        email = null;
    }
    return {
        name: issuer.name,
        taxId: issuer.taxId,
        address: issuer.address,
        email,
        branch: issuer.branch,
        contact,
    };
}

/**
 * The quotation's opening paragraph — ONE wording for the PDF (quotation.html
 * {{QUOTATION_INTRO}}) and the web (quotation API `copy.intro`).
 *
 * The plant is the application's own (formData.plantId, the wizard slug) named
 * by config/plant-species-slugs.js plantNameTH, which is pinned to the
 * plant_species seed. No plant on the application = no plant printed: the
 * template used to hardcode "พืชกัญชา", so a ginger quotation offered cannabis.
 */
function buildQuotationIntro(application) {
    const meta = buildPlatformQuotationMeta();
    const fd = (application && typeof application.formData === 'object' && application.formData) || {};
    const plant = plantNameTH(fd.plantId || fd.plantType);
    const ofPlant = plant ? `ของพืช${plant}` : '';
    // fix/fee-line-descriptions: the paragraph used to name the charge a seventh way
    // ("ค่าบริการตรวจประเมินและรับรองมาตรฐาน…"). The lines below name each service from
    // the catalogue, so the paragraph names none and points at them.
    return `${meta.deptName} ${meta.division} มีความยินดีที่จะเสนอราคาค่าบริการสำหรับการขอรับรองมาตรฐาน`
        + `การเพาะปลูกและเก็บเกี่ยวที่ดี${ofPlant} (Good Agricultural and Collection Practices) ดังรายการต่อไปนี้`;
}

/**
 * The quotation's wording as the quotation API sends it: `intro` (the opening
 * paragraph) and `note` (the payment line). The PDF prints the same two.
 *
 * @returns {{intro: string, note: string, services: object}}
 */
function buildQuotationCopy(application) {
    return {
        intro: buildQuotationIntro(application),
        note: buildPaymentChannelLine(),
        // fix/fee-line-descriptions — what each instalment of THIS application is called
        // and covers (a renewal has no งวดที่ 1), so the web prints the PDF's words.
        services: servicesForApplication(application, PLATFORM_ISSUER.vatRate),
    };
}

/**
 * Build a refusal for a quotation document, with its HTTP status and its
 * applicant-facing copy READ FROM the catalogue (shared/error-codes.js) rather
 * than repeated here — the same contract services/billing/quotation-gate.js
 * uses, so the route layer can map it without knowing this module.
 *
 * @param {string} code  a catalogued error code
 * @returns {Error & {code:string, status:number, statusCode:number}}
 */
/**
 * What ONE printed quotation line is a charge FOR.
 *
 * operator 2026-09-07, closing the question of whether the applicant should see the
 * amount broken into its parts:
 *
 *   *"ไม่ต้อง เราแยกตามบริการ เช่น ค่าบริการตรวจสอบเอกสาร สำหรับขออนุญาต รูปแบบการปลูก
 *     แบบกลางแจ้ง … เรื่ององค์ประกอบบัญชี จะไปคุยกันเอง"*
 *
 * Until then a W14 whole-phase row printed THREE components — ค่าธรรมเนียมกรม,
 * ค่าบริการแพลตฟอร์ม, ภาษีมูลค่าเพิ่ม — multiplied by the cultivation types, so three
 * declared types produced nine lines. Those three are the seller's internal split, and
 * W14 already ruled there is ONE seller; what the applicant bought is one service per
 * cultivation type. So a whole-phase row is one component now, named by its service.
 *
 * This does NOT touch the tax document. ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป has its own
 * builders (generateReceiptTaxInvoicePdf, buildTotalsRowsHtml) and must keep VAT on its own line by law.
 * A ใบเสนอราคา may quote the payable per service, and now does.
 *
 * A pre-W14 per-side row is left exactly as it was: its `amount` is that side's own money
 * and its caption already says so. Those documents were issued before this ruling and have
 * to reopen as they were sent.
 *
 * @param {object} args
 * @param {number} args.phase                  1 or 2
 * @param {object|null} args.wholePhaseLine    {serviceFee, vat} เมื่อแถวตั้งราคาทั้งงวด
 * @param {number} args.phaseTotal             ตัวเลขของแถวเองสำหรับงวดนี้
 * @param {boolean} [args.isRenewal]           a renewal carries one service, not an instalment
 * @returns {Array<{caption:string, coverage:string, total:number, key?:string}>}
 */
function buildQuotationComponents({ phase, wholePhaseLine, phaseTotal, isRenewal = false } = {}) {
    // fix/fee-line-descriptions (operator 2026-10-03): both shapes are named from the one
    // catalogue, and carry what the service covers for the small text under the line.
    const service = serviceFor(phase, { isRenewal });
    if (wholePhaseLine) {
        return [{
            caption: service.name,
            coverage: service.coverage,
            // `key` makes each printed line read that scope's OWN payable out of the row's
            // frozen breakdown, so the lines sum to the phase figure instead of sharing it.
            key: 'phaseTotal',
            total: Number(wholePhaseLine.serviceFee || 0) + Number(wholePhaseLine.vat || 0),
        }];
    }
    // เดิมมีสองคำบรรยาย — ของฝั่งกรม ("ค่ารับรองผลการประเมิน…") กับของฝั่งบริษัท
    // ("ค่าบริการแพลตฟอร์มและภาษีมูลค่าเพิ่ม") · เหลือผู้ออกเอกสารรายเดียว และคำว่า
    // "แพลตฟอร์ม" ก็ไม่มีความหมายอีกเมื่อไม่มีอีกฝั่งให้เทียบ
    return [{
        caption: service.name,
        coverage: service.coverage,
        total: phaseTotal,
    }];
}

/**
 * The numbered lines a quotation or a billing note prints — pure, so the ruling that
 * governs them can be tested without rendering a PDF.
 *
 * Operator ruling 2026-09-06: *"ในเสนอราคา และใบวางบิลก็ต้องลงรายละเอียดด้วย เช่น
 * 1.ค่าธรรมเนียมขออนุญาต แบบกลางแจ้ง งวดที่ 1 หากมี 3 รูปแบบในใบเสนอราคาต้องมีบอกเป็น 1 2 3
 * แล้วราคาก็เอามารวมกัน"*. Each line therefore names the cultivation TYPE in the form's own
 * Thai and the INSTALMENT it belongs to — the document used to say "ระบบ OUTDOOR", the
 * internal enum in Thai clothes, and to name the STAGE (ตรวจประเมิน), which is what the
 * money buys rather than which of the two payments this is.
 *
 * AMOUNTS. Where the quotation row carries a per-type breakdown, the line prints that
 * type's own figure and the total is the sum of the lines. Without one the amount is still
 * the phase figure shared across the scopes, because a document already issued must reopen
 * exactly as it was sent — a tax document that cannot be reproduced is lost evidence, not
 * clean code (the W14-boundary lesson). A breakdown that does not cover every scope falls
 * back for ALL of them rather than printing a zero beside a real charge: a shared figure is
 * wrong-but-honest, a zero is a false statement about what is owed.
 *
 * @param {object} args
 * @param {Array}  args.scopes      resolved scopes ({method} or {generic, label})
 * @param {Array}  args.components  [{caption, total, key?}] — what the money is made of
 * @param {number} args.phase       1 or 2 (the component caption names the instalment; kept for callers)
 * @param {Array}  [args.scopeBreakdown]  per-type amounts frozen on the quotation row
 * @returns {Array<{no:number, description:string, coverage:string, amount:number, method:?string}>}
 */
function buildQuotationItemLines({ scopes, components, phase: _phase, scopeBreakdown, isRenewal = false } = {}) {
    const scopeList = Array.isArray(scopes) && scopes.length ? scopes : [{ generic: true, label: '' }];
    const componentList = Array.isArray(components) ? components : [];
    const scopeCount = scopeList.length;

    // A filing that declared no ลักษณะพื้นที่ is priced for one anonymous scope, and the
    // pricing calls it SCOPE_1. That is an internal placeholder, not a cultivation type:
    // printed through the Thai map it would read "แบบSCOPE_1" — the enum on a tax
    // document, which is the thing this ruling removes. It is unnameable, so it is
    // labelled like any other unnameable scope.
    const isPlaceholder = (method) => /^SCOPE_\d+$/i.test(String(method || ''));

    // A line the application can still name says which cultivation type it is; a line it
    // cannot name says only which of the row's lines it is (ruling 12, 2026-08-28).
    //
    // 2026-09-07: the ruling's own words are "ค่าบริการตรวจสอบเอกสาร สำหรับขออนุญาต
    // รูปแบบการปลูกแบบกลางแจ้ง" — so the line says what the money is FOR (ขออนุญาต /
    // ต่ออายุ) and spells "รูปแบบการปลูก" out in full. The unnameable case already read
    // "รูปแบบการปลูกที่ 1"; the nameable one used to read the bare "แบบกลางแจ้ง", so the
    // two halves of the same column disagreed about what they were naming.
    const purpose = purposeWord({ isRenewal });
    const forWhatOf = (scope, index) => {
        if (scope && scope.generic) { return String(scope.label || ''); }
        if (!scope || !scope.method || isPlaceholder(scope.method)) {
            return `สำหรับ${purpose} รูปแบบการปลูกที่ ${index + 1}`;
        }
        return `สำหรับ${purpose} รูปแบบการปลูกแบบ${thaiLabelForMethod(scope.method)}`;
    };

    const byMethod = new Map(
        (Array.isArray(scopeBreakdown) ? scopeBreakdown : [])
            .filter((line) => line && line.method)
            .map((line) => [String(line.method).toUpperCase(), line]),
    );
    // Every scope must be covered, or none of them is used — see the header.
    const breakdownCovers = byMethod.size > 0
        && scopeList.every((scope) => !scope.generic
            && !isPlaceholder(scope.method)
            && byMethod.has(String(scope.method || '').toUpperCase()));

    const shares = componentList.map((component) => shareAcrossScopes(component.total, scopeCount));

    const lines = [];
    let no = 0;
    scopeList.forEach((scope, scopeIdx) => {
        componentList.forEach((component, compIdx) => {
            no += 1;
            const declared = breakdownCovers
                ? byMethod.get(String(scope.method || '').toUpperCase())
                : null;
            const fromBreakdown = declared && component.key !== undefined
                ? Number(declared[component.key])
                : NaN;
            const amount = Number.isFinite(fromBreakdown) ? fromBreakdown : shares[compIdx][scopeIdx];
            const forWhat = forWhatOf(scope, scopeIdx);
            lines.push({
                no,
                method: scope.generic ? null : (scope.method || null),
                // The catalogue name already says which instalment it is ("งวดที่ 1 …");
                // a renewal's name says none, because it has no instalments.
                description: [component.caption, forWhat].filter(Boolean).join(' '),
                coverage: component.coverage || '',
                amount,
            });
        });
    });
    return lines;
}

function quotationDocumentError(code) {
    const row = ERROR_CODES[code];
    if (!row) {
        logger.error('[invoice-template] refusal code is not in the catalogue', { code });
        return Object.assign(new Error(getMessage('INTERNAL_SERVER_ERROR', 'th')), {
            code: 'INTERNAL_SERVER_ERROR', status: 500, statusCode: 500,
        });
    }
    return Object.assign(new Error(row.messageTh), {
        code, status: row.httpStatus, statusCode: row.httpStatus,
    });
}

/**
 * Render ONE per-phase ใบเสนอราคา (quotation) PDF replicating the official DTAM
 * form. Phase 1 = ค่าตรวจสอบและประเมิน (5,000/type); Phase 2 = ค่ารับรองผล
 * (25,000/type). One line per selected cultivation type (Indoor/Greenhouse/
 * Outdoor), same price per type. issuerSide selects DTAM (state, VAT-exempt) or
 * PLATFORM (platform fee + VAT).
 *
 * F-G4-64: when the caller passes the stored `quotationRow`, the amounts are
 * THAT ROW'S — its frozen `acceptedSnapshot` once accepted, else its own
 * `installments` — and the fee service is not consulted at all. The document the
 * applicant holds must be the document the row holds. Only a call with no row
 * (legacy callers) prices the document from the canonical fee math.
 *
 * A row that does not price the requested phase (a renewal carries PHASE_2 only)
 * raises QUOTATION_PHASE_NOT_PRICED rather than rendering a numbered document
 * whose total is zero.
 *
 * @param {object} p { application, issuerSide, phase, quotationRow }  phase 1 (default) | 2
 * @param {object} [opts] { upload=false, quotationNumber }
 * @throws {Error & {code:'INVALID_ISSUER_SIDE'|'QUOTATION_PHASE_NOT_PRICED'}}
 */
async function generateQuotationPdf({ application, issuerSide, phase, quotationRow }, opts = {}) {
    const upload = opts.upload === true;
    const ph = Number(phase) === 2 ? 2 : 1;
    // ม.86 ป.รัษฎากร — หนึ่งเอกสาร หนึ่งผู้ขาย · มีผู้ออกเอกสารรายเดียวแล้ว แต่ยังปฏิเสธ
    // ค่าที่ไม่รู้จัก: การยุบสาขาต้องไม่ทำให้ค่าที่พิมพ์ผิดกลายเป็นเอกสารที่ถูกต้อง
    if (issuerSide !== ISSUER_TYPES.PLATFORM) {
        const err = new Error(
            '[generateQuotationPdf] Missing or invalid issuerSide — must be '
            + `"${ISSUER_TYPES.PLATFORM}".`,
        );
        err.code = 'INVALID_ISSUER_SIDE';
        throw err;
    }

    const { calculateApplicationFees, collectUniqueCultivationMethods } = require('../../modules/billing');
    const payer = resolvePayerInfo(application);

    // F-G4-64 — when the caller hands us the stored row, the PDF is a rendering
    // of that row: the frozen acceptedSnapshot once the applicant has accepted,
    // else the row's own instalments. Recomputing here is channel C of
    // synthesis.md 3.3: the document the applicant holds stops matching the row
    // that priced it.
    const frozen = quotationRow?.acceptedSnapshot?.installments?.length
        ? quotationRow.acceptedSnapshot
        : null;
    const storedLines = frozen
        ? frozen.installments
        : (Array.isArray(quotationRow?.installments) && quotationRow.installments.length
            ? quotationRow.installments
            : null);
    // How many lines the document has, and what each is called.
    //
    // Ruling 12 (2026-08-28): the COUNT is the row's own — its frozen snapshot's
    // scopeCount, else its instalments' — and the application's CURRENT
    // cultivation methods only NAME the lines. Printing one line per current
    // method while dividing by the row's count let a revision move the money: a
    // row accepted at three methods, revised to one, rendered a phase-1 total of
    // 5,885 where the row says 17,655. When the two counts disagree every line
    // is named generically, because no line can stand for a method any more.
    const applicationMethods = collectUniqueCultivationMethods(application?.formData || {});
    const scopeCount = rowScopeCount(quotationRow)
        || (storedCultivationScopeCount(application) ?? 0)
        || applicationMethods.length
        || 1;
    const scopes = scopeNamesFor(scopeCount, applicationMethods);

    // The money this phase asks for, and its per-scope split.
    //
    // From a stored row it is THAT ROW'S OWN money for the phase
    // (quotation-line-items.instalmentPayable): the state fee on a pre-W14 DTAM
    // document, the platform fee + VAT on a pre-W14 PLATFORM one, and the whole
    // phase on a W14 single-issuer row. The retired rule here read the split
    // instead, so a W14 quotation printed the platform fee alone while the row,
    // the API line items and the card footer all named the full price
    // (coordinator ruling 2026-08-28: render the row; the fee service still
    // decides what is CHARGED).
    //
    // Only when no row is handed over at all does the fee service price the
    // document, per side, exactly as before.
    let phaseTotal;
    if (storedLines) {
        const line = storedLines.find((it) => it.phase === `PHASE_${ph}`);
        if (!line) {
            // A renewal prices PHASE_2 only. Emitting a numbered money document
            // whose total is 0.00 THB is worse than refusing to render one.
            throw quotationDocumentError('QUOTATION_PHASE_NOT_PRICED');
        }
        phaseTotal = instalmentPayable(line);
    } else {
        const fees = calculateApplicationFees(application?.formData || {}, { scopeCount });
        const phaseFee = ph === 2 ? fees.phase2 : fees.phase1;
        // ค่าบริการก้อนเดียว + VAT — ไม่มีสองฝั่งให้เลือกอีกแล้ว (operator 2026-09-11)
        phaseTotal = phaseFee.phaseTotal;
    }
    // แถวนี้ตั้งราคาทั้งงวดไว้หรือไม่ — ถ้าใช่ เอกสารพิมพ์บรรทัดเดียวที่เป็นยอดทั้งงวด
    //
    // เดิมตรงนี้ตรวจสามช่อง (state + platform + vat) เพื่อแยกแถวยุค W14 ออกจากแถวยุคก่อน
    // ที่ `amount` ถือเงินของฝั่งตัวเองอย่างเดียว · การแยกส่วนถูกยกเลิก 2026-09-11
    // เหลือค่าบริการกับ VAT ⇒ เงื่อนไขคือ "ผลบวกของสองช่องเท่ากับยอดของงวด"
    const wholePhaseLine = (() => {
        if (!storedLines) { return null; }
        const line = storedLines.find((it) => it.phase === `PHASE_${ph}`);
        const serviceFee = Number(line?.serviceFeeAmount || 0);
        const vat = Number(line?.vatAmount || 0);
        if (!(serviceFee > 0 && vat > 0)) { return null; }
        if (Math.abs((serviceFee + vat) - phaseTotal) >= 0.01) { return null; }
        return { serviceFee, vat };
    })();

    /**
     * The components one printed line is split into, in document order. One
     * entry (the row's own money) for a per-side document; three for a W14
     * whole-phase row. Every caption names the stage it belongs to, and the VAT
     * caption names its BASE — under W14 the VAT is charged on the state fee
     * plus the platform fee (operator ruling 2026-08-22), which is the same
     * wording the checkout line items carry.
     */
    const isRenewal = isRenewalFiling(application);
    const components = buildQuotationComponents({
        phase: ph, wholePhaseLine, phaseTotal, isRenewal,
    });
    // WHAT each line says and what it costs — buildQuotationItemLines owns both, so the
    // 2026-09-06 ruling ("แบบกลางแจ้ง งวดที่ 1", and the total is the SUM of the lines) is
    // testable without rendering a PDF. It reads the row's frozen per-type breakdown when
    // there is one and falls back to sharing the phase figure when there is not, so a
    // document issued before the breakdown existed reopens byte-identical.
    const storedBreakdown = storedLines
        ? (storedLines.find((it) => it.phase === `PHASE_${ph}`) || {}).scopeBreakdown
        : null;
    const itemLines = buildQuotationItemLines({
        scopes,
        components,
        phase: ph,
        scopeBreakdown: storedBreakdown,
        isRenewal,
    });

    const itemsRows = itemLines.map((line) => {
        // Every line carries what its service covers (operator 2026-10-03); the product
        // summary stays on the first row only (the rows already break the price down
        // per cultivation system, so compact:true skips the systems + per-scope lines —
        // 2026-06-25 owner request). coverage:false because the line prints its own.
        const lines = [line.coverage].concat(line.no === 1
            ? buildProductDetailLines(application, { phase: `PHASE_${ph}`, compact: true, coverage: false })
            : []).filter(Boolean);
        const detailHtml = renderDetailLinesHtml(lines);
        return `<tr>
          <td class="c">${line.no}.</td>
          <td>${escapeHtml(line.description)}${detailHtml}</td>
          <td class="c">1</td>
          <td class="c">คำขอ</td>
          <td class="r">${formatCurrency(line.amount)}</td>
          <td class="r">${formatCurrency(line.amount)}</td>
        </tr>`;
    }).join('\n');
    // The document's total stays the ROW's frozen figure for this phase. Under the
    // additive model the lines sum to exactly that; keeping the row's own number means a
    // rounding difference could never make a document contradict the price it was
    // accepted at.
    const grandTotal = phaseTotal;

    const meta = buildPlatformQuotationMeta();
    const quotationCopy = buildQuotationCopy(application);

    // QR → in-system payment link (NOT the promptpay-qr service). Best-effort.
    let qrDataUrl = '';
    try {
        const qrcodeService = require('../qrcode/qrcode-service');
        // config/public-urls owns the env names and refuses to guess in production.
        // 2026-09-06: this was CALLED but never imported, so every quotation PDF threw
        // ReferenceError here and the surrounding catch swallowed it — the QR has been
        // silently missing from every quotation the platform has ever issued. The catch
        // stays, because a QR that cannot be built must not stop the document; what was
        // wrong is that it was hiding a typo, not a QR failure.
        const { appBaseUrl } = require('../../config/public-urls');
        const base = appBaseUrl();
        const payUrl = `${base}/health/payments?app=${encodeURIComponent(application?.id || '')}`;
        qrDataUrl = await qrcodeService.generateDataUrl(`quote-${application?.id || 'x'}-p${ph}`, { url: payUrl, width: 96 });
    } catch (_e) {
        qrDataUrl = '';
    }

    const issueDate = new Date();
    // คำนำหน้าเลขเอกสารเหลือชุดเดียว — QT-DTAM ไม่มีอีกแล้ว
    const docNumber = opts.quotationNumber
        || frozen?.quotationNumber
        || `QT-PRD-P${ph}-${getZonedParts(issueDate).year + 543}-${String(Date.now()).slice(-6)}`; // Bangkok year

    // The printed validity deadline: the ROW's own `validUntil` when one is
    // handed over (the only live call site always has one — the route 404s
    // first), else the config day count as text — never a hardcoded "30 วัน".
    const validUntilText = quotationRow?.validUntil
        ? formatThaiDate(new Date(quotationRow.validUntil))
        : `${PAYMENT.QUOTATION_VALIDITY_BUSINESS_DAYS} วันทำการ นับจากวันที่ออกเอกสาร`;

    const data = {
        ISSUER_LOGO_DATA_URL: getCompanyLogoDataUrl(),
        DOC_REV: meta.docRev,
        ISSUER_DIVISION: meta.division,
        ISSUER_NAME_TH: meta.deptName,
        ISSUER_ADDRESS: meta.address,
        ISSUER_CONTACT: meta.contact,
        // Payer block from the resolver (operator rule 2026-09-27): the entity's
        // name, the type's id label, and the printed id — never a national ID
        // (L-084). Contact name/phone are the ones the application names, which
        // the wizard writes only under formData.applicantData (L-088).
        CUSTOMER_COMPANY: payer.name || '-',
        CUSTOMER_ORG: application?.formData?.farmName || application?.formData?.organizationName || '-',
        CUSTOMER_TAXID_LABEL: payer.idLabel,
        CUSTOMER_TAXID: payer.idPrinted,
        CUSTOMER_ADDRESS: payer.address || '-',
        CUSTOMER_CONTACT: payer.contactName || '-',
        CUSTOMER_PHONE: payer.contactPhone || '-',
        DOC_NUMBER: docNumber,
        DOC_DATE: formatThaiDate(issueDate),
        VALID_UNTIL: validUntilText,
        ITEMS_ROWS: itemsRows,
        AMOUNT_WORDS: numberToThaiText(grandTotal),
        GRAND_TOTAL: formatCurrency(grandTotal),
        SIGNATORY_ORG: meta.signatoryOrg,
        SIGNATORY_NAME: meta.signatoryName,
        SIGNATORY_TITLE_1: meta.signatoryTitle1,
        SIGNATORY_TITLE_2: meta.signatoryTitle2,
        SUBMIT_DATE: application?.submittedAt ? formatThaiDate(application.submittedAt) : '________',
        RATE_AUTHORITY: meta.rateAuthority,
        RATE_DATE: '________',
        BANK_ACCOUNT_NAME: meta.bankAccountName,
        BANK_LINE: meta.bankLine,
        ISSUER_TAX_ID: meta.taxId,
        QR_DATA_URL: qrDataUrl,
        // The paragraph and the pay line, from the builders the quotation API
        // also serves to the web (fix/web-quotation-truth).
        QUOTATION_INTRO: quotationCopy.intro,
        PAYMENT_NOTE: quotationCopy.note,
    };

    return renderTemplateToPdf('quotation.html', data, {
        upload,
        uploadKey: `quotations/${docNumber}.pdf`,
        logLabel: `QuotationTemplate(${issuerSide}-P${ph})`,
    });
}

/**
 * Build the template-substitution map for a credit-/debit-note render.
 * Pure (no DB, no I/O) so unit tests can assert the placeholder dictionary
 * directly without spinning up Puppeteer.
 *
 * Credit notes (ใบลดหนี้) and debit notes (ใบเพิ่มหนี้) are PLATFORM VAT
 * adjustment documents under ม.86/10 ป.รัษฎากร — each references the ORIGINAL
 * ใบกำกับภาษี (tax invoice) it adjusts. State-fee revenue is VAT-exempt and
 * never issues these, so the issuer is ALWAYS the PLATFORM company resolved
 * from `config/invoice-issuers.js` (never hardcoded). credit-note.html and
 * debit-note.html share an identical placeholder set, so one builder serves
 * both — the caller supplies the doc-type labels + number.
 *
 * @param {Object} note         Prisma CreditNote/DebitNote (include originalInvoice)
 * @param {Object} meta         { docNumber, docTypeTh, docTypeEn }
 * @param {Object} [approver]   { name, role, position, approvedAt }
 * @returns {Object} flat key → string map for replaceTemplateVariables
 */
function buildAdjustmentNoteContext(note, meta, approver) {
    const orig = note.originalInvoice || {};
    const serviceType = String(orig.serviceType || '').toUpperCase();
    const isPhase2 = serviceType.includes('PHASE_2') || serviceType.includes('AUDIT');
    // ม.86/10: a credit/debit note adjusts a full tax invoice → the issuer is
    // the VAT-registered PLATFORM entity, never DTAM (government revenue is
    // VAT-exempt and issues no tax invoice to adjust).
    const issuer = resolveIssuerForTemplate(
        isPhase2 ? 'PHASE_2_PLATFORM_FEE' : 'PHASE_1_PLATFORM_FEE',
    );

    const subtotal = Number(note.subtotal) || 0;
    const vat = Number(note.vat) || 0;
    const total = Number(note.totalAmount) || 0;

    const issueDateRaw = note.issuedAt || note.createdAt || new Date();
    const issueDate = issueDateRaw instanceof Date ? issueDateRaw : new Date(issueDateRaw);
    const beYear = getZonedParts(issueDate).year + 543;

    const origDateRaw = orig.paidAt || orig.createdAt || null;
    const origDate = origDateRaw
        ? (origDateRaw instanceof Date ? origDateRaw : new Date(origDateRaw))
        : null;

    // Single adjustment line: the original supply, restated as the adjusted
    // amount. The free-text {{REASON}} carries the ม.86/10-required reason.
    //
    // fix/fee-line-descriptions round 2 (operator 2026-10-03): the note names the line,
    // and says what it covers, exactly as the invoice it adjusts does — renewal-aware,
    // because the document read (find{Credit,Debit}NoteForDocument) selects the original
    // invoice's application formData. A phase note keeps its phase name.
    const lineLabel = serviceTypeLabel(orig.serviceType, { application: orig.application }) || 'การปรับปรุงมูลค่าตามใบกำกับภาษีเดิม';
    const lineService = serviceForServiceType(orig.serviceType, { isRenewal: isRenewalFiling(orig.application) });
    const lineCoverage = lineService ? renderDetailLinesHtml([lineService.coverage]) : '';
    const taxItemsRows = `<tr>
          <td>1</td>
          <td>${escapeHtml(lineLabel)}${lineCoverage}</td>
          <td class="r">${formatCurrency(subtotal)}</td>
          <td class="r">${formatCurrency(vat)}</td>
          <td class="r">${formatCurrency(total)}</td>
        </tr>`;

    // The payer is the ORIGINAL invoice's applying entity, through the same
    // resolver as every other finance document (operator rule 2026-09-27,
    // L-083). The billing snapshot (`billingName`/`billingAddress`) is not the
    // source: no writer in this repo ever populates it, so every note printed
    // "-" for the buyer. The services' findById selects
    // originalInvoice.application with PAYER_APPLICATION_SELECT.
    const payer = resolvePayerInfo(orig);
    return {
        ISSUER_LOGO_DATA_URL: getCompanyLogoDataUrl(),
        DOC_NUMBER: meta.docNumber || '-',
        DOC_TYPE_TH: meta.docTypeTh,
        DOC_TYPE_EN: meta.docTypeEn,
        ISSUE_DATE: formatThaiDate(issueDate),
        ISSUE_DATE_TH: formatThaiDateNumeric(issueDate),
        YEAR_BE_TH: arabicToThai(beYear),
        // The visible "เลขที่ / No." line reuses RECEIPT_NUMBER_TH per the
        // shared template macro — point it at THIS document's number.
        RECEIPT_NUMBER_TH: arabicToThai(meta.docNumber || '-'),
        // Issuer (PLATFORM) — resolved from canonical config, never hardcoded.
        ISSUER_NAME_TH: issuer.name,
        ISSUER_TAX_ID: issuer.taxId,
        ISSUER_BRANCH: issuer.branch,
        ISSUER_ADDRESS: issuer.address,
        // Reference to the original ใบกำกับภาษี (mandatory under ม.86/10).
        ORIGINAL_INVOICE_NUMBER: orig.invoiceNumber || '-',
        ORIGINAL_INVOICE_DATE: origDate ? formatThaiDate(origDate) : '-',
        PAYER_NAME_LABEL: payer.nameLabelBilingual,
        PAYER_NAME: payer.name,
        PAYER_ID_LABEL: payer.idLabelBilingual,
        PAYER_ID_TH: thaiDigitsId(payer.idPrinted),
        PAYER_ADDRESS: payer.address,
        REASON: note.reason || '-',
        TAX_ITEMS_ROWS: taxItemsRows,
        SUBTOTAL_TH: formatThaiCurrency(subtotal),
        VAT_TH: formatThaiCurrency(vat),
        TOTAL_TH: formatThaiCurrency(total),
        TOTAL_AMOUNT_TEXT: numberToThaiText(total),
        COMPANY_CONTACT_LINE: buildCompanyContactLine(),
        // Approver block — embedded inside the SHA-256 pre-image the RSA
        // signature covers (ISO 27799 §7.2.3). PLATFORM side (isStateFee=false).
        ...buildApproverFields(approver, false),
    };
}

/**
 * Render an adjustment note (credit OR debit) to a PDF Buffer. Both share
 * credit-note.html / debit-note.html which have an identical placeholder set.
 *
 * @param {Object} note   Prisma CreditNote/DebitNote (include originalInvoice)
 * @param {Object} cfg    { docNumber, docTypeTh, docTypeEn, templateFile, uploadDir }
 * @param {Object} [opts] { upload=true, approver }
 * @returns {Promise<Buffer>}
 */
async function renderAdjustmentNotePdf(note, cfg, opts = {}) {
    const upload = opts.upload !== false;
    const data = buildAdjustmentNoteContext(
        note,
        { docNumber: cfg.docNumber, docTypeTh: cfg.docTypeTh, docTypeEn: cfg.docTypeEn },
        opts.approver,
    );

    return renderTemplateToPdf(cfg.templateFile, data, {
        upload,
        uploadKey: `${cfg.uploadDir}/${cfg.fileStem || cfg.docNumber}.pdf`,
        logLabel: 'AdjustmentNoteTemplate',
    });
}

/**
 * Generate an official Credit Note (ใบลดหนี้) PDF — ม.86/10 ป.รัษฎากร.
 * @param {Object} creditNote  Prisma CreditNote (include originalInvoice)
 * @param {Object} [opts]      { upload=true, approver }
 * @returns {Promise<Buffer>}
 */
async function generateCreditNotePdf(creditNote, opts = {}) {
    return renderAdjustmentNotePdf(creditNote, {
        // A DRAFT has no number yet (allocated at issue) — it prints "ร่าง",
        // and its file is keyed by id so two drafts never share one.
        docNumber: creditNote.creditNoteNumber || 'ร่าง',
        fileStem: creditNote.creditNoteNumber || `draft-${creditNote.id}`,
        docTypeTh: 'ใบลดหนี้',
        docTypeEn: 'CREDIT NOTE',
        templateFile: 'credit-note.html',
        uploadDir: 'credit-notes',
    }, opts);
}

/**
 * Generate an official Debit Note (ใบเพิ่มหนี้) PDF — ม.86/9 ป.รัษฎากร.
 * @param {Object} debitNote  Prisma DebitNote (include originalInvoice)
 * @param {Object} [opts]     { upload=true, approver }
 * @returns {Promise<Buffer>}
 */
async function generateDebitNotePdf(debitNote, opts = {}) {
    return renderAdjustmentNotePdf(debitNote, {
        docNumber: debitNote.debitNoteNumber || 'ร่าง', // DRAFT: no number until issue
        fileStem: debitNote.debitNoteNumber || `draft-${debitNote.id}`,
        docTypeTh: 'ใบเพิ่มหนี้',
        docTypeEn: 'DEBIT NOTE',
        templateFile: 'debit-note.html',
        uploadDir: 'debit-notes',
    }, opts);
}

module.exports = {
    // M5 (operator ruling 2026-08-23, "ไม่มีเคสยกเว้น vat") — exported so the VAT
    // wording can be asserted without spinning up Puppeteer.
    generateInvoicePdf,
    generateReceiptTaxInvoicePdf,
    generateQuotationPdf,
    generateCreditNotePdf,
    generateDebitNotePdf,
    // Exported for unit tests — assert the placeholder dictionary without
    // spinning up Puppeteer.
    buildAdjustmentNoteContext,
    // B16-D — exported for tests (and for the receipt-auto-sign-service
    // tests that mock the PDF render but want to assert what the template
    // variables resolved to).
    buildReceiptContext,
    buildApproverFields,
    // Single Issuer Compliance Fix (2026-05-16) — exported so tests can
    // assert the per-side totals/payment HTML without spinning up
    // Puppeteer. They build the issuer-specific row markup used by the
    // invoice / receipt / quotation templates.
    buildTotalsRowsHtml,
    buildPaymentInfoHtml,
    detectIssuerSide,
    // one-fee residue sweep (2026-09-26) — exported so the bankLine channel
    // text can be asserted without spinning up Puppeteer.
    buildPlatformQuotationMeta,
    // payer-block-by-type (2026-09-27) — the signatory the quotation API hands
    // the web, from the same config as the PDF.
    buildQuotationSignatory,
    // fix/web-quotation-truth (2026-09-28) — the issuer block and the wording
    // (intro + payment note) the quotation API hands the web, from the same
    // builders the quotation PDF prints.
    buildQuotationIssuer,
    buildQuotationCopy,
    buildPaymentChannelLine,
    // fix/invoice-pdf-truth (2026-09-27) — exported so the company contact
    // line + the charge label can be asserted without spinning up Puppeteer.
    buildCompanyContactLine,
    serviceTypeLabel,
    // W14 — exported so the "a stored zero is not a missing value" rule can be
    // asserted directly rather than inferred from rendered HTML.
    deriveInvoiceAmounts,
    buildQuotationItemLines,
    buildQuotationComponents,
};

