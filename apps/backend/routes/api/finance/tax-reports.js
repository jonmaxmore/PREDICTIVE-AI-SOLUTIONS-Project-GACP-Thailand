/**
 * Tax-reports routes — ภ.พ.30 Output-VAT preview + CSV export +
 * period-closable check (B19-C, 2026-05-16).
 *
 * Endpoints:
 *   GET /api/finance/tax-reports/output-vat?year=2026&month=5[&format=csv]
 *     - JSON preview by default; ?format=csv returns the RD e-Filing CSV.
 *   GET /api/finance/tax-reports/period-closable?year=2026&month=5
 *     - Returns { closable, lastPaidInvoiceDate, openInvoices, warnings }.
 *
 * Role guard:
 *   - finance_officer_dtam, finance_officer_platform, system_admin_dtam —
 *     READ only; both endpoints are GETs. field_inspector removed 2026-09-27.
 *   - The two finance roles get the same answer (operator 2026-09-11:
 *     "finance ต้องเห็นเหมือนกัน ... เพื่อแสดงความโปร่งใส").
 *
 * Audit trail:
 *   - Every call emits a VAT_REPORT_EXPORTED audit event (PAYMENT
 *     category, INFO severity) so DTAM auditors can trace who pulled
 *     filing-ready data and when. Required by Thai e-Transactions Act
 *     §31 (disclosure of financial records must be traceable).
 *
 * Org-scoping:
 *   - Calls are filtered by the actor's organizationId. Cross-tenant
 *     VAT views belong to platform-admin tooling, not here.
 *
 * Legal anchors (cited in service module):
 *   - ป.รัษฎากร ม.77/1 (10) — state revenue VAT-exempt.
 *   - ป.รัษฎากร ม.83/8 — e-filing monthly cadence (15th of next month).
 *   - ป.รัษฎากร ม.86/4 — full tax-invoice requirements.
 *   - ประกาศกรมสรรพากร ฉบับที่ 200/2562 — RD e-Filing CSV column spec.
 */

'use strict';

const express = require('express');

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireOrganization } = require('./finance-route-helpers');
const {
    auditLogger, AuditCategory, AuditSeverity, ResourceType,
} = require('../../../middleware/audit-logger');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { safeErrorMessage } = require('../../../shared/api-response');
const { getRequestIp } = require('../../../utils/client-ip');
const logger = require('../../../shared/logger');
const vatReportService = require('../../../services/vat-report-service');
const { getZonedParts } = require('../../../utils/working-days');

const router = express.Router();

// ด่านอ่าน — การเงินสองบทบาทเห็นรายงานภาษีชุดเดียวกัน (operator 2026-09-11) · ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27)
const ALLOWED_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

function requireTaxReportAccess(req, res, next) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!role || !ALLOWED_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            code: 'VAT_REPORT_FORBIDDEN',
            message: 'A finance or admin role is required',
        });
    }
    req.user.canonicalRole = role;
    return next();
}

/**
 * Parse a query param to a numeric integer with bounds. Returns
 * `null` when the value is missing so the caller can apply a default;
 * throws VALIDATION_ERROR on a present-but-out-of-range value so we
 * surface a precise 400 to the client.
 */
function parseBoundedInt(value, { min, max, name }) {
    if (value === undefined || value === null || value === '') {return null;}
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw Object.assign(
            new Error(`${name} must be an integer in [${min}, ${max}]`),
            { code: 'VALIDATION_ERROR' },
        );
    }
    return n;
}

function defaultYearAndMonth() {
    // Default to the current month — the finance officer will land on
    // the current month most of the time (preparing the next file).
    // The current Bangkok month — the ภ.พ.30 month (operator 2026-09-26).
    const { year, month } = getZonedParts(new Date());
    return { year, month };
}

async function logExport(req, payload) {
    try {
        await auditLogger.log({
            category: AuditCategory.PAYMENT,
            action: 'VAT_REPORT_EXPORTED',
            severity: AuditSeverity.INFO,
            actorId: req.user?.id || 'ANONYMOUS',
            actorEmail: req.user?.email || null,
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorType: req.user?.providerId ? 'PROVIDER' : 'USER',
            resourceType: ResourceType.PAYMENT,
            resourceId: 'VAT_OUTPUT_REPORT',
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata: payload || {},
        });
    } catch (err) {
        // Per ISO 27799 §7.10.4, an audit-log failure on a financial
        // disclosure is itself a security event — log loudly, but do
        // NOT block the response: the data has already been computed.
        logger.warn('[tax-reports] audit log failed (non-fatal):', err?.message);
    }
}

// GET /api/finance/tax-reports/output-vat?year=2026&month=5[&format=csv]
router.get(
    '/output-vat',
    authenticateProvider,
    requireTaxReportAccess,
    async (req, res) => {
        try {
            const yearParam = parseBoundedInt(req.query.year, { min: 2020, max: 2030, name: 'year' });
            const monthParam = parseBoundedInt(req.query.month, { min: 1, max: 12, name: 'month' });
            const defaults = defaultYearAndMonth();
            const year = yearParam ?? defaults.year;
            const month = monthParam ?? defaults.month;
            // Fail closed on a caller with no organization (L3, 2026-09-27).
            const organizationId = requireOrganization(req, res);
            if (!organizationId) { return undefined; }
            const wantCsv = String(req.query.format || '').toLowerCase() === 'csv';

            if (wantCsv) {
                const csv = await vatReportService.generateOutputVatReportCSV({
                    year, month, organizationId,
                });
                await logExport(req, {
                    year, month, format: 'csv', organizationId,
                });
                const filename = `vat-output-${year}-${String(month).padStart(2, '0')}.csv`;
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                return res.status(200).send(csv);
            }

            const report = await vatReportService.generateOutputVatReport({
                year, month, organizationId,
            });
            await logExport(req, {
                year,
                month,
                format: 'json',
                organizationId,
                rowCount: report.totals?.rowCount || 0,
                vatTotal: report.totals?.vatAmount || 0,
            });
            return res.json({ success: true, data: report });
        } catch (err) {
            if (err.code === 'VALIDATION_ERROR') {
                return res.status(400).json({
                    success: false,
                    error: 'VALIDATION_ERROR',
                    message: err.message,
                });
            }
            logger.error('[tax-reports] output-vat failed:', err?.message);
            return res.status(500).json({
                success: false,
                error: safeErrorMessage(err),
            });
        }
    },
);

// GET /api/finance/tax-reports/period-closable?year=2026&month=5
router.get(
    '/period-closable',
    authenticateProvider,
    requireTaxReportAccess,
    async (req, res) => {
        try {
            const yearParam = parseBoundedInt(req.query.year, { min: 2020, max: 2030, name: 'year' });
            const monthParam = parseBoundedInt(req.query.month, { min: 1, max: 12, name: 'month' });
            const defaults = defaultYearAndMonth();
            const year = yearParam ?? defaults.year;
            const month = monthParam ?? defaults.month;
            // Fail closed on a caller with no organization (L3, 2026-09-27).
            const organizationId = requireOrganization(req, res);
            if (!organizationId) { return undefined; }

            const result = await vatReportService.checkPeriodClosable({
                year, month, organizationId,
            });
            await logExport(req, {
                year,
                month,
                format: 'period-closable',
                organizationId,
                closable: result.closable,
                openInvoices: result.openInvoices,
            });
            return res.json({
                success: true,
                data: { year, month, ...result },
            });
        } catch (err) {
            if (err.code === 'VALIDATION_ERROR') {
                return res.status(400).json({
                    success: false,
                    error: 'VALIDATION_ERROR',
                    message: err.message,
                });
            }
            logger.error('[tax-reports] period-closable failed:', err?.message);
            return res.status(500).json({
                success: false,
                error: safeErrorMessage(err),
            });
        }
    },
);

module.exports = router;
