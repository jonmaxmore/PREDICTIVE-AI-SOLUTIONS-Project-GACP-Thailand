/**
 * Lot Label Template Service
 * Generates 100×100mm sticker labels for packaging lots with QR traceability.
 */

const path = require('path');
// The QR a sticker carries must point at THIS environment. config/public-urls
// refuses to guess in production for exactly this reason: a sticker is on a box
// and cannot be recalled.
const { traceBaseUrl } = require('../../config/public-urls');
const fs = require('fs');
const QRCode = require('qrcode');
const pdfGenerator = require('./pdf-generator.service');
const storageService = require('../storage-service');
const { publicTraceUrlFor } = require('../qrcode/public-trace-url');
const logger = require('../../shared/logger');
// Wave E.3-E: import THAI_MONTHS_SHORT from utils/thai-format.js to avoid
// duplicating the array. The local formatThaiDate is preserved (it
// zero-pads the day with String(d.getDate()).padStart(2, '0') — different
// from the canonical formatThaiDate which uses raw d.getDate(); output
// like "05 ธ.ค. 2568" matters for the 100×100mm sticker layout).
const { THAI_MONTHS_SHORT } = require('../../utils/thai-format');
const { getZonedParts } = require('../../utils/working-days');

const TEMPLATE_DIR = path.join(__dirname, 'templates');

// ── Date helpers ──────────────────────────────────────────────────────────────

// The packaged / expiry day is the Bangkok day, not the container clock's
// (CODE-01, audit 2026-09-17).
function formatThaiDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) {return '-';}
    const { year, month, day } = getZonedParts(d);
    const dd = String(day).padStart(2, '0');
    return `${dd} ${THAI_MONTHS_SHORT[month - 1]} ${year + 543}`;
}

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * Generate a single lot label PDF (100×100mm sticker).
 *
 * @param {Object} lot  - Prisma Lot record (include: batch.farm, batch.species)
 * @param {Object} [opts]
 * @param {boolean} [opts.upload=false]
 * @returns {Promise<Buffer>}
 */
async function generateLotLabelPdf(lot, opts = {}) {
    const upload = opts.upload === true;

    // URL ที่ QR พาไป — ค่าที่เก็บไว้ชนะ **เว้นแต่มันพาไปไม่ถึง** (localhost / 127.0.0.1 ฯลฯ)
    // แถวเก่าบนเครื่องที่ยังไม่ได้ตั้ง PUBLIC_TRACE_URL เก็บ http://localhost/trace/lot/… ไว้
    // และป้ายที่พิมพ์วันนี้เคยหยิบค่านั้นไปติดถุงตรง ๆ — QR ที่ออกจากมือไปแล้วเรียกคืนไม่ได้
    const trackingUrl = publicTraceUrlFor(lot.trackingUrl, `lot/${lot.id}`);

    const qrDataUrl = await QRCode.toDataURL(trackingUrl, {
        width: 300,
        margin: 1,
        color: { dark: '#1a5c38', light: '#ffffff' },
        errorCorrectionLevel: 'H',
    });

    // Resolve lot metadata
    const farmName = lot.batch?.farm?.farmName || lot.farmName || '-';
    const lotNumber = lot.lotNumber || lot.id?.slice(-12)?.toUpperCase() || '-';
    const packagedDate = lot.packagedAt ? formatThaiDate(lot.packagedAt) : formatThaiDate(lot.createdAt);
    const expiryDate = lot.expiryDate ? formatThaiDate(lot.expiryDate) : '-';
    const weight = lot.totalWeight ? `${lot.totalWeight} ${lot.unitWeight ? 'g' : 'g'}` : '-';

    const data = {
        LOT_NUMBER: lotNumber,
        QR_DATA_URL: qrDataUrl,
        FARM_NAME: farmName,
        PACKAGED_DATE: packagedDate,
        EXPIRY_DATE: expiryDate,
        WEIGHT: weight,
    };

    // Load template
    const templatePath = path.join(TEMPLATE_DIR, 'lot-label.html');
    const template = fs.readFileSync(templatePath, 'utf-8');
    const html = pdfGenerator.replaceTemplateVariables(template, data);

    // Generate PDF (100×100mm)
    const buffer = await pdfGenerator.generatePDF(html, {
        width: '100mm',
        height: '100mm',
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });

    if (upload) {
        const key = `labels/${lotNumber}.pdf`;
        try {
            await storageService.uploadBuffer(
                storageService.BUCKETS.pdfs,
                key,
                buffer,
                'application/pdf',
            );
            logger.info(`[LotLabel] Uploaded: ${key}`);
        } catch (err) {
            logger.warn('[LotLabel] Upload failed (returning buffer anyway):', err.message);
        }
    }

    return buffer;
}

/**
 * Generate a multi-page PDF with one lot label per page.
 *
 * @param {Object[]} lots - Array of Prisma Lot records
 * @returns {Promise<Buffer>}
 */
async function generateBatchLabelsPdf(lots) {
    if (!lots || lots.length === 0) {
        throw new Error('No lots provided for label generation');
    }

    // Build combined HTML with multiple label pages
    const templatePath = path.join(TEMPLATE_DIR, 'lot-label.html');
    const rawTemplate = fs.readFileSync(templatePath, 'utf-8');

    // Extract the inner body content (between <body> tags)
    const bodyMatch = rawTemplate.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const headMatch = rawTemplate.match(/<head[^>]*>([\s\S]*)<\/head>/i);
    if (!bodyMatch || !headMatch) {
        throw new Error('Invalid lot-label template structure');
    }

    const bodyTemplate = bodyMatch[1].trim();
    const headContent = headMatch[1];

    const labelPages = [];
    for (const lot of lots) {
        const trackingUrl = lot.trackingUrl
            || `${traceBaseUrl()}/trace/lot/${lot.id}`;

        const qrDataUrl = await QRCode.toDataURL(trackingUrl, {
            width: 300,
            margin: 1,
            color: { dark: '#1a5c38', light: '#ffffff' },
            errorCorrectionLevel: 'H',
        });

        const farmName = lot.batch?.farm?.farmName || lot.farmName || '-';
        const lotNumber = lot.lotNumber || lot.id?.slice(-12)?.toUpperCase() || '-';
        const packagedDate = lot.packagedAt ? formatThaiDate(lot.packagedAt) : formatThaiDate(lot.createdAt);
        const expiryDate = lot.expiryDate ? formatThaiDate(lot.expiryDate) : '-';
        const weight = lot.totalWeight ? `${lot.totalWeight} g` : '-';

        const page = pdfGenerator.replaceTemplateVariables(bodyTemplate, {
            LOT_NUMBER: lotNumber,
            QR_DATA_URL: qrDataUrl,
            FARM_NAME: farmName,
            PACKAGED_DATE: packagedDate,
            EXPIRY_DATE: expiryDate,
            WEIGHT: weight,
        });

        labelPages.push(page);
    }

    const combinedHtml = `<!DOCTYPE html>
<html lang="th">
<head>${headContent}</head>
<body>${labelPages.join('\n')}</body>
</html>`;

    const buffer = await pdfGenerator.generatePDF(combinedHtml, {
        width: '100mm',
        height: '100mm',
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });

    return buffer;
}

module.exports = {
    generateLotLabelPdf,
    generateBatchLabelsPdf,
    // Exposed for tests: the label date without Puppeteer.
    _internals: { formatThaiDate },
};
