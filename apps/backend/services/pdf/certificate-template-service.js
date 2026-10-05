/**
 * Certificate Template Service
 * Generates official GACP certificate PDFs using the HTML template + Puppeteer.
 * Uploads the generated PDF to MinIO / local storage.
 *
 * B23 (PDF / document designer, 2026-05-16):
 *   - Switched template to A4 PORTRAIT (was landscape). Its palette lives in
 *     templates/certificate.html itself (CI green + ceremonial gold since the
 *     later redesign); it no longer reads any finance-tokens entry.
 *   - Added the full B23 placeholder set:
 *       CERT_NUMBER, CERT_NUMBER_TH, APPLICANT_NAME, APPLICANT_ID,
 *       CULTIVATION_METHODS, FARM_LOCATION,
 *       ISSUE_DATE_TH, EXPIRY_DATE_TH,
 *       SIGNER_NAME, SIGNER_POSITION,
 *       VERIFY_URL, QR_CODE_DATA_URL.
 *   - Certificate revision (2026-08-27): REVISION_LINE, printed under the
 *     number when revisionNo > 1 ("ฉบับแก้ไขครั้งที่ n · <revisedAt>"), ''
 *     at revision 1.
 *   - Exposed `buildCertificateContext` as a PURE function (no DB writes, no
 *     I/O) so unit tests can assert the placeholder map without spinning up
 *     Puppeteer.
 *   - Legacy placeholders ({{FARM_NAME}}, {{CROP_TYPE}}, …) are still emitted
 *     into the context so older renders that hold onto the previous template
 *     fragment never crash with a surviving placeholder warning.
 *
 * Number scheme:
 *   The certificate-service.js writer still owns the canonical
 *   `certificate.certificateNumber` column (format `GACP-TH-{พศ}-{hex6}`
 *   from PR-1.5). The B23 spec asks for a DTAM-namespaced display number;
 *   `buildDtamCertNumberDisplay` formats one from the same components
 *   without touching the DB column — it's purely a render-time projection.
 */

const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { getLogoDataUrl } = require('./pdf-assets');
const pdfGenerator = require('./pdf-generator.service');
const storageService = require('../storage-service');
const logger = require('../../shared/logger');
// Wave E.3-E: deduplicate Thai-month + Buddhist-year formatting.
// Previously this file defined its own THAI_MONTHS array + formatThaiDate
// function, which silently drifted from the canonical version in
// utils/thai-format.js. Output preserved exactly; sourcing changed only.
// formatThaiDate ("27 ส.ค. 2569") prints the revision date next to the
// certificate number; the same short form the public verify page shows.
const { formatThaiDateFull, formatThaiDate } = require('../../utils/thai-format');
// B23: Thai-numeral conversion + the DTAM-style date with พุทธศักราช
// spelling.  Both are pure functions, safe to inline into the render path.
const {
    arabicToThai,
    formatThaiDate: formatThaiDateNumeric,
} = require('../../utils/thai-numerals');
const { getZonedParts } = require('../../utils/working-days');

const TEMPLATE_DIR = path.join(__dirname, 'templates');

// ── Verify URL base ─────────────────────────────────────────────────────────
// Resolved from the shared single source (services/certificate-verify-url.js)
// so the QR payload written by certificate-service.js, the QR rendered here, and
// the visible URL footer can never drift apart. CERT_VERIFY_BASE_URL overrides.
const { certVerifyBaseUrl } = require('../certificate-verify-url');
const DEFAULT_VERIFY_BASE_URL = certVerifyBaseUrl();

// Default signer block — DTAM Director-General per government convention.
// Callers MAY override per-render via opts.signer; the default keeps legacy
// (no-signer-supplied) renders rendering a sensible authority block.
const DEFAULT_SIGNER = Object.freeze({
    name: 'อธิบดีกรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
    position: 'Director-General, Department of Thai Traditional and Alternative Medicine',
});

// ── Date helpers ──────────────────────────────────────────────────────────────

// formatThaiDateShort produces "DD/MM/YYYY" with Buddhist year. No month
// names involved, so no centralisation needed; kept local. The day is the
// Bangkok day, not the container clock's (CODE-01, audit 2026-09-17).
function formatThaiDateShort(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) {return '-';}
    const { year, month, day } = getZonedParts(d);
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const yyyy = year + 543;
    return `${dd}/${mm}/${yyyy}`;
}

// DTAM logo data URL — shared single source (services/pdf/pdf-assets.js)

// ── Pure helpers (testable without Puppeteer) ────────────────────────────────

/**
 * Mask a 13-digit Thai national ID for display on the certificate.
 *   '1234567890123'   → '1-2345-XXXXX-67-8'
 *   '1-2345-67890-12-3' → '1-2345-XXXXX-12-3'   (already-grouped input)
 *
 * Pre-PDPA precaution (ม.86/4 (3) ป.รัษฎากร precedent): a public certificate
 * is a downloadable PDF — exposing the full national ID would let anyone
 * with the cert PDF link enumerate the registered farmer. Mask the middle
 * five digits, mirroring the convention used on Thai utility bills.
 *
 * Non-13-digit inputs (juristic taxId, hyphenated already, COMMUNITY entity)
 * are returned unchanged so the render surfaces "looks wrong" cases to a
 * human reviewer rather than silently dropping the field.
 */
function maskNationalId(rawId) {
    if (rawId === null || rawId === undefined) {return '-';}
    const stripped = String(rawId).replace(/[^0-9]/g, '');
    if (stripped.length !== 13) {return String(rawId);}
    // 1-1-4-4-1 grouping per Revenue Dept; positions 6-10 → XXXXX.
    return `${stripped[0]}-${stripped.slice(1, 5)}-XXXXX-${stripped.slice(10, 12)}-${stripped[12]}`;
}

/**
 * Printed certificate number. New certificates (`TH-GACP 87/2568`) store the
 * printed form, so it passes through unchanged; this projects only LEGACY rows,
 * from a canonical `certificate.certificateNumber` value (e.g. `GACP-TH-2569-A3F7B2`).
 *
 *   buildDtamCertNumberDisplay('GACP-TH-2569-A3F7B2')
 *     → 'GACP-DTAM-2569-A3F7B2'
 *
 * If the input doesn't match the expected `GACP-TH-{year}-{suffix}` shape
 * the original string is returned untouched — this guards against legacy
 * imports + manually-edited certificate numbers.
 *
 * Why a render-time projection and not a column rewrite:
 *   certificate-service.js#199 inserts the canonical `GACP-TH-...` form into
 *   `Certificate.certificateNumber` (with @unique). Migrating that column
 *   would force backfilling all historical rows + breaking any URL that
 *   includes the cert number. The B23 brief calls for the DTAM-namespaced
 *   form on the rendered PDF only, so we project at render time and leave
 *   the storage scheme untouched.
 */
// Implementation lives in ../certificate-number-display.js, next to its inverse
// toCanonicalCertificateNumber (public lookups accept the printed form).
const { buildDtamCertNumberDisplay, toCertificateSlug } = require('../certificate-number-display');

/**
 * Compose a Thai farm-location line from the structured certificate fields.
 * The certificate model stores province / district / subDistrict / address
 * separately; the PDF body expects a single sentence.
 *
 *   buildFarmLocation({ province: 'เชียงราย', district: 'เมือง', subDistrict: 'รอบเวียง', address: 'หมู่ 1' })
 *     → 'หมู่ 1 ตำบลรอบเวียง อำเภอเมือง จังหวัดเชียงราย'
 */
function buildFarmLocation(cert) {
    const parts = [];
    const address = String(cert?.address || '').trim();
    const subDistrict = String(cert?.subDistrict || '').trim();
    const district = String(cert?.district || '').trim();
    const province = String(cert?.province || '').trim();

    if (address && address !== '-' && address !== 'Unknown') {parts.push(address);}
    if (subDistrict && subDistrict !== '-' && subDistrict !== 'Unknown') {
        parts.push(`ตำบล${subDistrict}`);
    }
    if (district && district !== '-' && district !== 'Unknown') {
        parts.push(`อำเภอ${district}`);
    }
    if (province && province !== '-' && province !== 'Unknown') {
        parts.push(`จังหวัด${province}`);
    }
    if (parts.length === 0) {return '-';}
    return parts.join(' ');
}

/**
 * Format the cultivation-methods line. The certificate model stores a
 * single `cropType` field today; the B23 brief allows a comma-separated
 * list. Accept either shape:
 *   - string → returned trimmed
 *   - array  → joined with ' / '
 *   - falsy  → '-'
 */
function formatCultivationMethods(value) {
    if (Array.isArray(value)) {
        const cleaned = value.map((v) => String(v || '').trim()).filter(Boolean);
        return cleaned.length > 0 ? cleaned.join(' / ') : '-';
    }
    const s = String(value || '').trim();
    return s || '-';
}

/**
 * Build the verify URL for the QR + visible footer line.
 * If the certificate row already has a `qrData` (set by certificate-service.js
 * on creation), prefer that so the QR scan target never drifts from what's
 * stored.  Otherwise fall back to CERT_VERIFY_BASE_URL/{certNumber}.
 */
function buildVerifyUrl(cert) {
    // เคารพค่าที่แช่ไว้ "เมื่อมันพาไปถึงได้จริง" — ใบที่ออกก่อนตั้งค่า public URL บนเครื่องนั้น
    // แช่ที่อยู่ท้องถิ่นเอาไว้ (วัดจริง 2026-09-07: 5 จาก 7 ใบเป็น http://127.0.0.1:8099/verify/…)
    // กฎเดียวกับ QR ของล็อต: ค่าที่เป็นไปไม่ได้ในโลกจริง ไม่ใช่ข้อเท็จจริงที่ต้องเคารพ
    const { publicVerifyUrlFor } = require('../qrcode/public-trace-url');
    return publicVerifyUrlFor(cert?.qrData, cert?.certificateNumber);
}

/**
 * Pure: build the placeholder map for the certificate.html template from
 * a Certificate record + optional signer info.
 *
 * No DB queries, no I/O, no QR generation — callers pass the QR data URL
 * in via the third arg.  This lets unit tests exercise the full mapping
 * without spinning up Puppeteer or QRCode.toDataURL.
 *
 * @param {object} cert        Prisma Certificate record (or shape-equivalent)
 * @param {object} [signer]    { name, position } — defaults to DTAM Director-General
 * @param {object} [opts]
 * @param {string} [opts.qrCodeDataUrl]  pre-generated QR PNG data URL
 * @param {string} [opts.verifyUrl]      override for the visible URL
 * @returns {object} flat placeholder map ready for replaceTemplateVariables
 */
function buildCertificateContext(cert, signer, opts = {}) {
    if (!cert || typeof cert !== 'object') {
        throw new TypeError('[certificate-template-service] cert is required');
    }

    const certNumberAscii = cert.certificateNumber || '-';
    const certNumberDtam = buildDtamCertNumberDisplay(certNumberAscii);
    const certNumberTh = arabicToThai(certNumberDtam);

    const resolvedSigner = (signer && typeof signer === 'object')
        ? {
            name: signer.name || DEFAULT_SIGNER.name,
            position: signer.position || DEFAULT_SIGNER.position,
        }
        : DEFAULT_SIGNER;

    const verifyUrl = opts.verifyUrl || buildVerifyUrl(cert);

    const issueDate = cert.issuedDate ? new Date(cert.issuedDate) : new Date();
    const expiryDate = cert.expiryDate ? new Date(cert.expiryDate) : null;

    // Cultivation: prefer explicit `cultivationMethods` (B23 shape), then
    // fall back to the legacy `cropType` scalar so existing rows still render.
    const cultivation = formatCultivationMethods(
        cert.cultivationMethods != null ? cert.cultivationMethods : cert.cropType,
    );

    const applicantId = maskNationalId(
        cert.applicantId
        || cert.applicantNationalId
        || cert.applicant?.nationalId
        || cert.applicant?.taxId,
    );

    // Certificate revision (spec 2026-08-27 §PDF): a corrected certificate
    // keeps its number and prints "ฉบับแก้ไขครั้งที่ n · <revisedAt>" under
    // it. revisionNo counts signed contents (1 = original), so the printed
    // correction number is revisionNo - 1. Rows from before the revision
    // columns exist have no revisionNo and print nothing.
    const revisionNo = Number(cert.revisionNo) || 1;
    const revisionLine = revisionNo > 1
        ? `ฉบับแก้ไขครั้งที่ ${revisionNo - 1} · ${formatThaiDate(cert.revisedAt)}`
        : '';

    return {
        // ── B23 placeholders (canonical) ─────────────────────────────
        CERT_NUMBER: certNumberDtam, // displayed as `GACP-DTAM-…`
        CERT_NUMBER_TH: certNumberTh,
        REVISION_LINE: revisionLine, // '' at revision 1 (the element hides itself)
        // M1: the certificate is held by the farm/entity — print the holder
        // name (certification.prisma:34). Rows issued before the backfill have
        // no holderDisplayName and keep printing the legacy applicant name.
        // The placeholder key stays APPLICANT_NAME so the template HTML and
        // every legacy render path are untouched.
        APPLICANT_NAME: cert.holderDisplayName || cert.applicantName || '-',
        APPLICANT_ID: applicantId,
        CULTIVATION_METHODS: cultivation,
        FARM_LOCATION: buildFarmLocation(cert),
        ISSUE_DATE_TH: formatThaiDateNumeric(issueDate),
        EXPIRY_DATE_TH: expiryDate ? formatThaiDateNumeric(expiryDate) : '-',
        SIGNER_NAME: resolvedSigner.name,
        SIGNER_POSITION: resolvedSigner.position,
        VERIFY_URL: verifyUrl,
        QR_CODE_DATA_URL: opts.qrCodeDataUrl || '',

        // ── Shared assets ────────────────────────────────────────────
        MINISTRY_LOGO_DATA_URL: opts.ministryLogoDataUrl || '',

        // ── Legacy placeholders kept for backward compatibility ──────
        // Previous template (pre-B23) used these; some E2E tests still
        // assert against them. Mapping them here means the legacy callers
        // (e.g. seed-approve.js fallback render) don't regress.
        FARM_NAME: cert.farmName || '-',
        CROP_TYPE: cultivation,
        DISTRICT: cert.district || '-',
        PROVINCE: cert.province || '-',
        ISSUED_DATE_TH: formatThaiDateFull(issueDate),
        EXPIRY_DATE_TH_LEGACY: expiryDate ? formatThaiDateFull(expiryDate) : '-',
        ISSUED_DATE_SHORT: formatThaiDateShort(issueDate),
        STANDARD_NAME: cert.standardName || 'GACP Thailand',
        QR_DATA_URL: opts.qrCodeDataUrl || '',
        VERIFICATION_CODE: cert.verificationCode || '-',
    };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate an official GACP Certificate PDF.
 *
 * @param {Object} cert  - Prisma Certificate record (from certificate-service.js)
 * @param {Object} [opts]
 * @param {boolean} [opts.upload=true]  - Upload to MinIO after generation
 * @param {object}  [opts.signer]       - { name, position } override
 * @returns {Promise<Buffer>}  PDF buffer
 */
async function generateCertificatePdf(cert, opts = {}) {
    const upload = opts.upload !== false;

    // 1. Generate QR code data URL.  Indigo on white, high error correction
    //    so the printed cert survives a fax / scan + re-print roundtrip.
    const verifyUrl = buildVerifyUrl(cert);
    const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl, {
        width: 220,
        margin: 2,
        color: { dark: '#00663d', light: '#ffffff' }, // canvas deep green (design canvas 2026-09-07)
        errorCorrectionLevel: 'H',
    });

    // 2. Build template context (pure — no I/O after QR generation above).
    const data = buildCertificateContext(cert, opts.signer, {
        qrCodeDataUrl,
        ministryLogoDataUrl: getLogoDataUrl(),
        verifyUrl,
    });

    // 3. Read template + inject variables
    const templatePath = path.join(TEMPLATE_DIR, 'certificate.html');
    const template = fs.readFileSync(templatePath, 'utf-8');
    const html = pdfGenerator.replaceTemplateVariables(template, data);

    // 4. Generate PDF via Puppeteer (A4 PORTRAIT for B23 — was landscape).
    const buffer = await pdfGenerator.generatePDF(html, {
        format: 'A4',
        landscape: false,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });

    // 5. Upload to MinIO / local storage
    if (upload) {
        const key = `${toCertificateSlug(cert.certificateNumber)}.pdf`;
        try {
            await storageService.uploadBuffer(
                storageService.BUCKETS.certificates,
                key,
                buffer,
                'application/pdf',
            );
            logger.info(`[CertTemplate] Uploaded certificate: ${key}`);
        } catch (err) {
            logger.warn('[CertTemplate] Upload failed (returning buffer anyway):', err.message);
        }
    }

    return buffer;
}

/**
 * Get a signed download URL for a previously generated certificate.
 *
 * @param {string} certificateNumber
 * @returns {Promise<string>} URL
 */
async function getCertificateDownloadUrl(certificateNumber) {
    const key = `${toCertificateSlug(certificateNumber)}.pdf`;
    return storageService.getSignedDownloadUrl(storageService.BUCKETS.certificates, key);
}

module.exports = {
    generateCertificatePdf,
    getCertificateDownloadUrl,
    // B23 — exported so callers (status writers, audit-pass hooks, tests)
    // can build the placeholder map without going through Puppeteer.
    buildCertificateContext,
    buildDtamCertNumberDisplay,
    buildFarmLocation,
    formatCultivationMethods,
    maskNationalId,
    buildVerifyUrl,
    DEFAULT_SIGNER,
};
