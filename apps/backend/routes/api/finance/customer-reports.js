/**
 * Customer Reports routes (B20-D, 2026-05-16).
 *
 * Endpoints (provider-facing):
 *   GET /api/finance/customer-statement?applicantHealthId=...&asOfDate=YYYY-MM-DD
 *   GET /api/finance/ar-aging?bookSide=DTAM|PLATFORM&asOfDate=YYYY-MM-DD[&format=csv]
 *
 * Role matrix:
 *   - ACCOUNT_DTAM     → sees DTAM-side data only (PLATFORM-side blanked)
 *   - ACCOUNT_PLATFORM → sees PLATFORM-side data only (DTAM-side blanked)
 *   - ADMIN            → sees both sides
 *   - AUDITOR          → sees both sides (read-only by route discipline)
 *   - Legacy ACCOUNT   → sees both (until B16-B migration completes)
 *
 *   For AR-Aging, ACCOUNT_DTAM is forced to bookSide=DTAM and
 *   ACCOUNT_PLATFORM is forced to bookSide=PLATFORM — any other value
 *   in the query is rejected with FORBIDDEN_BOOK_SIDE. The two sides
 *   are reconciled against different bank channels by different teams
 *   (per B16-C two-money-flow); cross-side reads are an audit defect.
 *
 * Org-scoping:
 *   Every read is constrained to `req.user.organizationId`. The
 *   services themselves require organizationId so a future cross-
 *   tenant viewer would have to be a platform-admin tool with its own
 *   audit category.
 *
 * Audit logging:
 *   Every successful read fires CUSTOMER_REPORT_EXPORTED with the
 *   report type + book-side filter in the metadata payload. Thai
 *   e-Transactions Act §31 requires payment-record disclosures to be
 *   traceable to the recipient. ISO 27799 §7.10.4 + PDPA ม.39
 *   reinforce the same for medical-adjacent records.
 *
 * PDPA basis:
 *   - PDPA ม.6 (data minimisation) — applicant healthId is ALWAYS
 *     returned masked (`####*******##`). The service module enforces
 *     this; the route layer cannot un-mask.
 *   - PDPA ม.27 (legitimate interest) — finance staff supporting a
 *     customer ticket are the lawful recipient.
 *   - PDPA ม.39 (audit trail of disclosures) — `logExport` below.
 */

'use strict';

const express = require('express');

const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireOrganization } = require('./finance-route-helpers');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');
const { normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { safeErrorMessage } = require('../../../shared/api-response');
const { getRequestIp } = require('../../../utils/client-ip');
const logger = require('../../../shared/logger');

const customerStatementService = require('../../../services/customer-statement-service');
const arAgingService = require('../../../services/ar-aging-service');

const router = express.Router();

// ── Role helpers ─────────────────────────────────────────────────────

// ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27)
const ALLOWED_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);

function requireCustomerReportAccess(req, res, next) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!role || !ALLOWED_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            code: 'CUSTOMER_REPORT_FORBIDDEN',
            message: 'ACCOUNT_DTAM, ACCOUNT_PLATFORM, AUDITOR, or ADMIN role required',
        });
    }
    return next();
}

/**
 * Map the canonical role to the set of book-sides the user is
 * permitted to see. Mirrors `resolveAllowedIssuerSides` in
 * payment-slip-service.js — kept locally so this route can compile
 * even when slip-service is being refactored.
 *
 * - ACCOUNT_DTAM     → ['DTAM']
 * - ACCOUNT_PLATFORM → ['PLATFORM']
 * - ADMIN / AUDITOR  → ['DTAM', 'PLATFORM']
 * - Legacy ACCOUNT   → ['DTAM', 'PLATFORM']
 */
/**
 * ── ฝ่ายการเงินทั้งสองฝั่งเห็นตัวเลขชุดเดียวกัน (operator 2026-09-11) ──────────
 *
 * *"finance ต้องเห็นเหมือนกัน หรือว่าตัวเลขที่ต้องมากระทบยอดต้องเท่ากัน เพื่อแสดง
 *   ความโปร่งใส คือทั้งคู่จะเห็น"*
 *
 * เดิมบัญชีกรมเห็นเฉพาะ DTAM บัญชีบริษัทเห็นเฉพาะ PLATFORM · สมมติฐานคือมีเงินสองก้อน
 * และแต่ละฝ่ายไม่ควรเห็นของอีกฝ่าย · ตอนนี้มีเงินก้อนเดียว การซ่อนจากฝั่งใดฝั่งหนึ่ง
 * แปลว่าฝั่งนั้นกระทบยอดไม่ได้เลย ซึ่งตรงข้ามกับเหตุผลที่แยกไว้แต่แรก
 *
 * (สวิตช์เดิมยังมีข้อบกพร่องซ้ำอยู่ด้วย: `FINANCE_OFFICER_PLATFORM` ปรากฏสองครั้ง
 *  สาขาที่สองจึงไม่เคยทำงาน — หายไปพร้อมการยุบนี้)
 */
function resolveViewerSides(req) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    switch (role) {
        case CANONICAL_ROLES.FINANCE_OFFICER_DTAM:
        case CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM:
        case CANONICAL_ROLES.SYSTEM_ADMIN_DTAM:
            return ['DTAM', 'PLATFORM'];
        default:
            return [];
    }
}

async function logExport(req, reportType, payload) {
    try {
        await auditLogger.log({
            category: AuditCategory.PAYMENT,
            action: 'CUSTOMER_REPORT_EXPORTED',
            severity: AuditSeverity.INFO,
            actorId: req.user?.id || 'ANONYMOUS',
            actorEmail: req.user?.email || null,
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorType: req.user?.providerId ? 'PROVIDER' : 'USER',
            resourceType: ResourceType.PAYMENT,
            resourceId: `CUSTOMER_REPORT:${reportType}`,
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata: { reportType, ...(payload || {}) },
        });
    } catch (err) {
        // PDPA ม.39 + ISO 27799 §7.10.4 — disclosure-failure audit
        // is itself a security event. Log loudly but do NOT block the
        // response since the data is already computed.
        logger.warn('[customer-reports] audit log failed (non-fatal):', err?.message);
    }
}

// ── GET /customer-statement ──────────────────────────────────────────

router.get('/customer-statement', authenticateProvider, requireCustomerReportAccess, async (req, res) => {
    try {
        const organizationId = requireOrganization(req, res);
        if (!organizationId) { return undefined; }

        const { applicantHealthId, asOfDate } = req.query || {};
        if (!applicantHealthId) {
            return res.status(400).json({
                success: false,
                error: 'APPLICANT_HEALTH_ID_REQUIRED',
                message: 'applicantHealthId query parameter is required',
            });
        }
        const asOf = asOfDate ? new Date(asOfDate) : new Date();
        if (Number.isNaN(asOf.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_ASOF_DATE',
                message: `Invalid asOfDate "${asOfDate}"`,
            });
        }

        const viewerSides = resolveViewerSides(req);
        const statement = await customerStatementService.generateCustomerStatement({
            applicantHealthId,
            asOfDate: asOf,
            organizationId,
            viewerSides,
        });

        await logExport(req, 'CUSTOMER_STATEMENT', {
            applicantHealthIdMasked: statement.applicant?.healthIdMasked || null,
            viewerSides,
            asOfDate: asOf.toISOString(),
            applicationCount: statement.applications.length,
        });

        return res.json({ success: true, data: statement });
    } catch (error) {
        if (error.code === 'VALIDATION_ERROR') {
            return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
        }
        logger.error('[customer-reports] customer-statement failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// ── GET /ar-aging ────────────────────────────────────────────────────

router.get('/ar-aging', authenticateProvider, requireCustomerReportAccess, async (req, res) => {
    try {
        const organizationId = requireOrganization(req, res);
        if (!organizationId) { return undefined; }

        const { bookSide, asOfDate, format } = req.query || {};
        const requestedSide = String(bookSide || '').trim().toUpperCase();
        if (!requestedSide) {
            return res.status(400).json({
                success: false,
                error: 'BOOK_SIDE_REQUIRED',
                message: 'bookSide query parameter is required (DTAM | PLATFORM)',
            });
        }
        if (!asOfDate) {
            return res.status(400).json({
                success: false,
                error: 'ASOF_DATE_REQUIRED',
                message: 'asOfDate query parameter is required (YYYY-MM-DD)',
            });
        }

        const allowedSides = resolveViewerSides(req);
        if (!allowedSides.includes(requestedSide)) {
            return res.status(403).json({
                success: false,
                error: 'FORBIDDEN_BOOK_SIDE',
                code: 'FORBIDDEN_BOOK_SIDE',
                message: `Role cannot view bookSide=${requestedSide}`,
            });
        }

        const asOf = new Date(asOfDate);
        if (Number.isNaN(asOf.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_ASOF_DATE',
                message: `Invalid asOfDate "${asOfDate}"`,
            });
        }

        if (format === 'csv') {
            const csv = await arAgingService.generateArAgingReportCSV({
                asOfDate: asOf,
                bookSide: requestedSide,
                organizationId,
            });
            await logExport(req, 'AR_AGING', {
                bookSide: requestedSide,
                asOfDate: asOf.toISOString(),
                format: 'csv',
            });
            const filename = `ar-aging-${requestedSide}-${asOfDate}.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.status(200).send(csv);
        }

        const report = await arAgingService.generateArAgingReport({
            asOfDate: asOf,
            bookSide: requestedSide,
            organizationId,
        });
        await logExport(req, 'AR_AGING', {
            bookSide: requestedSide,
            asOfDate: asOf.toISOString(),
            format: 'json',
            rowCount: report.rowCount,
            totalOutstanding: report.totalOutstanding,
        });
        return res.json({ success: true, data: report });
    } catch (error) {
        if (error.code === 'VALIDATION_ERROR' || error.code === 'BOOK_SIDE_REQUIRED') {
            return res.status(400).json({ success: false, error: error.code, message: error.message });
        }
        logger.error('[customer-reports] ar-aging failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
