/**
 * PDPC Breach Report PDF Generator (R4-B, Iter R4)
 *
 * Generates the official PDPC breach-notification PDF from a breach record
 * captured by `breach-notification-service.js` (R4-A). Used by the operator
 * to file a 72-hour PDPC report under PDPA ม.28 and the PDPC Notification
 * on Breach Reporting B.E. 2565 (2022).
 *
 * Public surface:
 *   - generatePdpcBreachReportPdf(breachRecord) → Promise<Buffer>
 *
 * Implementation notes:
 *   - HTML template lives at templates/pdpc-breach-notification.html. The
 *     template carries a "SKELETON — operator must verify" warning header.
 *   - Placeholder substitution uses a `{{KEY}}` regex (the pattern came from
 *     the email template engine, deleted 2026-09-16 with the email service).
 *   - `escapeHtml` is duplicated here as a private helper because
 *     pdf-generator.service.js does NOT export its helper. The RFC for R4-B
 *     explicitly authorises this local copy to avoid mutating the shared
 *     module.
 *   - Buddhist-Era date formatting copies the `formatBE` pattern from
 *     notification-fanout-service.js:90-102 (Intl.DateTimeFormat th-TH with
 *     era: 'long').
 *   - Validation runs BEFORE puppeteer is invoked — missing required field
 *     throws VALIDATION_ERROR synchronously so we never spin chromium for
 *     bad input.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const pdfGenerator = require('./pdf-generator.service');
const { DEFAULT_TIME_ZONE, getZonedParts } = require('../../utils/working-days');

const TEMPLATE_PATH = path.join(
    __dirname, 'templates', 'pdpc-breach-notification.html',
);

// ── HTML escape (XSS prevention) ─────────────────────────────────────────
// Delegates to the shared pdf-generator.service helper (exported since the
// SEC-001 hardening) so the escape map lives in exactly one place. Operator-
// supplied free-text fields are run through this before substitution.
const escapeHtml = pdfGenerator.escapeHtml;

// ── Buddhist-Era date formatter (mirrors notification-fanout-service.js) ──

function formatBEDate(date) {
    if (!date) { return ''; }
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) { return ''; }
    try {
        return new Intl.DateTimeFormat('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            era: 'long',
            timeZone: DEFAULT_TIME_ZONE,
        }).format(d);
    } catch (_e) {
        // Fallback for environments without full Intl support.
        const months = [
            'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
            'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
        ];
        const { day, month, year } = getZonedParts(d); // the Bangkok day
        return `${day} ${months[month - 1]} พ.ศ. ${year + 543}`;
    }
}

// ── Validation ───────────────────────────────────────────────────────────

const REQUIRED_FIELDS = Object.freeze(['breachId', 'detectedAt', 'affectedSubjectsCount']);

function makeValidationError(message) {
    const err = new Error(message);
    err.code = 'VALIDATION_ERROR';
    return err;
}

function assertBreachRecord(breachRecord) {
    if (!breachRecord || typeof breachRecord !== 'object') {
        throw makeValidationError('[pdpc-breach-report] breachRecord is required');
    }
    for (const field of REQUIRED_FIELDS) {
        const v = breachRecord[field];
        if (v === null || v === undefined || v === '') {
            throw makeValidationError(
                `[pdpc-breach-report] missing required field: ${field}`,
            );
        }
    }
}

// ── Placeholder map builder (pure — no I/O) ─────────────────────────────

const DEFAULT_DATA_CONTROLLER_NAME_TH = 'ระบบรับรอง GACP กรมการแพทย์แผนไทยและการแพทย์ทางเลือก (DTAM)';

/**
 * Build the placeholder map for the pdpc-breach-notification.html template
 * from a breach record. Pure function — no I/O. Exposed implicitly via the
 * single export; not part of the documented public surface.
 */
function buildPlaceholders(breachRecord) {
    const detectedAt = breachRecord.detectedAt
        ? new Date(breachRecord.detectedAt) : null;
    const reportedAt = breachRecord.reportedAt
        ? new Date(breachRecord.reportedAt) : new Date();
    // R4 review H-1: 72-hour PDPC clock runs from detectedAt, not reportedAt.
    // The form's "กำหนดการรายงานต่อ สคส. (72 ชม.)" cell MUST show the deadline,
    // not the report-creation timestamp, or a reviewing PDPC officer cannot
    // verify the controller met the statutory clock.
    const pdpc72hDeadline = detectedAt
        ? new Date(detectedAt.getTime() + 72 * 3600 * 1000)
        : null;

    return {
        BREACH_ID: breachRecord.breachId || '-',
        DETECTED_AT_TH: detectedAt ? formatBEDate(detectedAt) : '-',
        REPORTED_AT_TH: formatBEDate(reportedAt),
        PDPC_72H_DEADLINE_TH: pdpc72hDeadline ? formatBEDate(pdpc72hDeadline) : '-',
        DATA_CONTROLLER_NAME_TH:
            breachRecord.dataControllerNameTH || DEFAULT_DATA_CONTROLLER_NAME_TH,
        DATA_CONTROLLER_DPO_EMAIL:
            breachRecord.dataControllerDpoEmail || 'dpo@gacpth.com',
        BREACH_TYPE_TH: breachRecord.breachTypeTH || '-',
        AFFECTED_SUBJECTS_COUNT: String(breachRecord.affectedSubjectsCount ?? '-'),
        AFFECTED_PII_CATEGORIES_TH: breachRecord.affectedPiiCategoriesTH || '-',
        RISK_ASSESSMENT_TH: breachRecord.riskAssessmentTH || '-',
        CONTAINMENT_ACTIONS_TH: breachRecord.containmentActionsTH || '-',
        REMEDIAL_ACTIONS_TH: breachRecord.remedialActionsTH || '-',
        SUBJECT_NOTIFICATION_DESCRIPTION_TH:
            breachRecord.subjectNotificationDescriptionTH || '-',
    };
}

/**
 * Substitute `{{KEY}}` placeholders into the template. Every value passes
 * through `escapeHtml` so operator-supplied free-text fields cannot inject
 * markup or script tags into the rendered PDF.
 */
function renderTemplate(template, placeholders) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        if (!Object.prototype.hasOwnProperty.call(placeholders, key)) {
            // Leave surviving placeholders in place so the
            // pdf-generator.service render-time guard surfaces them as a
            // warning rather than silently dropping the marker.
            return match;
        }
        return escapeHtml(placeholders[key]);
    });
}

// ── Template loader (read once, cache in module scope) ──────────────────

let _templateCache = null;
function readTemplate() {
    if (_templateCache === null) {
        _templateCache = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    }
    return _templateCache;
}

// ── Public surface ─────────────────────────────────────────────────────

/**
 * Generate the PDPC breach-notification PDF for a single breach record.
 *
 * @param {object} breachRecord
 * @param {string} breachRecord.breachId                          REQUIRED
 * @param {string|Date} breachRecord.detectedAt                    REQUIRED
 * @param {number} breachRecord.affectedSubjectsCount              REQUIRED
 * @param {string|Date} [breachRecord.reportedAt]
 * @param {string} [breachRecord.dataControllerNameTH]
 * @param {string} [breachRecord.dataControllerDpoEmail]
 * @param {string} [breachRecord.breachTypeTH]
 * @param {string} [breachRecord.affectedPiiCategoriesTH]
 * @param {string} [breachRecord.riskAssessmentTH]
 * @param {string} [breachRecord.containmentActionsTH]
 * @param {string} [breachRecord.remedialActionsTH]
 * @param {string} [breachRecord.subjectNotificationDescriptionTH]
 * @returns {Promise<Buffer>} PDF buffer
 * @throws {Error & { code: 'VALIDATION_ERROR' }} when a required field is missing
 */
async function generatePdpcBreachReportPdf(breachRecord) {
    // Validate BEFORE touching the template or puppeteer so bad input fails
    // synchronously without spinning chromium.
    assertBreachRecord(breachRecord);

    const placeholders = buildPlaceholders(breachRecord);
    const template = readTemplate();
    const html = renderTemplate(template, placeholders);

    return pdfGenerator.generatePDF(html, {
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
}

module.exports = {
    generatePdpcBreachReportPdf,
};
