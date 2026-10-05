/**
 * Financial Reports routes (B19-B, 2026-05-16) — TFRS for NPAEs core
 * statements served from the JournalEntry / JournalLine layer.
 *
 * Endpoints:
 *   GET /api/finance/reports/trial-balance?asOfDate=YYYY-MM-DD[&format=csv]
 *   GET /api/finance/reports/profit-and-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /api/finance/reports/balance-sheet?asOfDate=YYYY-MM-DD
 *   GET /api/finance/reports/general-ledger?accountCode=4110-001
 *                                          [&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *                                          [&limit=100&offset=0]
 *
 * Scope:
 *   - These reports cover ONLY the PLATFORM's books (the commercial-side
 *     ledger maintained by Predictive AI). DTAM's state-fee ledger lives
 *     in กรมบัญชีกลาง's own systems per the B16-C two-money-flow model:
 *     STATE-fee cash flows applicant → Treasury directly and never lands
 *     on the platform's books. The trial-balance and statement services
 *     EXCLUDE 9xxx suspense accounts so this scope is enforced at the
 *     data-aggregation layer, not just the route layer.
 *
 * Authorisation:
 *   - finance_officer_dtam, finance_officer_platform, system_admin_dtam —
 *     READ only; every endpoint here is a GET. field_inspector removed 2026-09-27.
 *   - The two finance roles get the same answer (operator 2026-09-11:
 *     "finance ต้องเห็นเหมือนกัน ... ตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน
 *     เพื่อแสดงความโปร่งใส") — one fee, one issuer, one set of books.
 *
 * Org-scoping:
 *   - Every report is scoped to `req.user.organizationId`. Cross-tenant
 *     access requires a separate platform-admin tool (out of scope).
 *
 * Audit logging:
 *   - Every successful read is logged with action FINANCE_REPORT_EXPORTED
 *     and the report type in the metadata payload. Thai e-Transactions
 *     Act §31 requires financial-record disclosures to be traceable to
 *     the recipient; ISO 27799 §7.10.4 mandates the same for medical-
 *     adjacent data.
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch. 5 (Accounting Cycle) — งบทดลอง.
 *   - TFRS for NPAEs ch. 6 (Financial Reporting Framework) — งบแสดงฐานะ
 *     การเงิน + งบกำไรขาดทุน.
 *   - TFRS for NPAEs ch. 18 (รายได้) — revenue recognition.
 *   - TFRS for NPAEs ch. 19 (ค่าใช้จ่าย) — expense recognition.
 *   - TAS 1 (Presentation of Financial Statements) §54 — line-item
 *     ordering and natural-side display.
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

const trialBalanceService = require('../../../services/trial-balance-service');
const statementsService = require('../../../services/financial-statements-service');
const ledgerService = require('../../../services/general-ledger-service');

const router = express.Router();

// ด่านอ่าน — การเงินสองบทบาทเห็นงบชุดเดียวกัน (operator 2026-09-11)
const ALLOWED_ROLES = new Set([
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
]);
// ผู้ตรวจประเมินไม่อยู่ในชุดอ่านเรื่องเงิน (operator 2026-09-27)

function requireFinanceReportAccess(req, res, next) {
    const role = normalizeRole(req.user?.canonicalRole || req.user?.role);
    if (!role || !ALLOWED_ROLES.has(role)) {
        return res.status(403).json({
            success: false,
            error: 'Forbidden',
            code: 'FINANCE_REPORT_FORBIDDEN',
            message: 'A finance or admin role is required',
        });
    }
    return next();
}

async function logExport(req, reportType, payload) {
    try {
        await auditLogger.log({
            category: AuditCategory.PAYMENT,
            action: 'FINANCE_REPORT_EXPORTED',
            severity: AuditSeverity.INFO,
            actorId: req.user?.id || 'ANONYMOUS',
            actorEmail: req.user?.email || null,
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorType: req.user?.providerId ? 'PROVIDER' : 'USER',
            resourceType: ResourceType.PAYMENT,
            resourceId: `FINANCE_REPORT:${reportType}`,
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata: { reportType, ...(payload || {}) },
        });
    } catch (err) {
        // Per ISO 27799 §7.10.4, audit failure is itself a security
        // event. Log loudly but don't block the response — the data is
        // already computed.
        logger.warn('[finance-reports] audit log failed (non-fatal):', err?.message);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// GET /trial-balance
// ──────────────────────────────────────────────────────────────────────────
router.get('/trial-balance', authenticateProvider, requireFinanceReportAccess, async (req, res) => {
    try {
        const organizationId = requireOrganization(req, res);
        if (!organizationId) {return;}

        const { asOfDate, format, includeZeroBalances } = req.query || {};
        if (!asOfDate) {
            return res.status(400).json({
                success: false,
                error: 'ASOF_DATE_REQUIRED',
                message: 'asOfDate query parameter is required (YYYY-MM-DD)',
            });
        }

        if (format === 'csv') {
            const csv = await trialBalanceService.generateTrialBalanceCSV({
                asOfDate,
                organizationId,
            });
            await logExport(req, 'TRIAL_BALANCE', { asOfDate, format: 'csv' });
            const filename = `trial-balance-${asOfDate}.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.status(200).send(csv);
        }

        const report = await trialBalanceService.generateTrialBalance({
            asOfDate,
            organizationId,
            includeZeroBalances: includeZeroBalances === 'true',
        });
        await logExport(req, 'TRIAL_BALANCE', {
            asOfDate,
            format: 'json',
            balanced: report.balanced,
            rowCount: report.rows.length,
        });
        return res.json({ success: true, data: report });
    } catch (error) {
        if (error.code === 'VALIDATION_ERROR') {
            return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
        }
        logger.error('[finance-reports] trial-balance failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// ──────────────────────────────────────────────────────────────────────────
// GET /profit-and-loss
// ──────────────────────────────────────────────────────────────────────────
router.get('/profit-and-loss', authenticateProvider, requireFinanceReportAccess, async (req, res) => {
    try {
        const organizationId = requireOrganization(req, res);
        if (!organizationId) {return;}

        const { from, to } = req.query || {};
        if (!from || !to) {
            return res.status(400).json({
                success: false,
                error: 'DATE_RANGE_REQUIRED',
                message: 'from and to query parameters are required (YYYY-MM-DD)',
            });
        }

        const report = await statementsService.generateProfitAndLoss({
            startDate: from,
            endDate: to,
            organizationId,
        });
        await logExport(req, 'PROFIT_AND_LOSS', {
            from,
            to,
            netProfit: report.netProfit,
            revenueTotal: report.revenue.total,
            expenseTotal: report.expense.total,
        });
        return res.json({ success: true, data: report });
    } catch (error) {
        if (error.code === 'VALIDATION_ERROR') {
            return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
        }
        logger.error('[finance-reports] profit-and-loss failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// ──────────────────────────────────────────────────────────────────────────
// GET /balance-sheet
// ──────────────────────────────────────────────────────────────────────────
router.get('/balance-sheet', authenticateProvider, requireFinanceReportAccess, async (req, res) => {
    try {
        const organizationId = requireOrganization(req, res);
        if (!organizationId) {return;}

        const { asOfDate } = req.query || {};
        if (!asOfDate) {
            return res.status(400).json({
                success: false,
                error: 'ASOF_DATE_REQUIRED',
                message: 'asOfDate query parameter is required (YYYY-MM-DD)',
            });
        }

        const report = await statementsService.generateBalanceSheet({
            asOfDate,
            organizationId,
        });
        await logExport(req, 'BALANCE_SHEET', {
            asOfDate,
            balanced: report.balanced,
            assetTotal: report.assets.total,
            liabilityTotal: report.liabilities.total,
            equityTotal: report.equity.total,
        });
        return res.json({ success: true, data: report });
    } catch (error) {
        if (error.code === 'VALIDATION_ERROR') {
            return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
        }
        logger.error('[finance-reports] balance-sheet failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// ──────────────────────────────────────────────────────────────────────────
// GET /general-ledger
// ──────────────────────────────────────────────────────────────────────────
router.get('/general-ledger', authenticateProvider, requireFinanceReportAccess, async (req, res) => {
    try {
        const organizationId = requireOrganization(req, res);
        if (!organizationId) {return;}

        const { accountCode, from, to, limit, offset } = req.query || {};
        if (!accountCode) {
            return res.status(400).json({
                success: false,
                error: 'ACCOUNT_CODE_REQUIRED',
                message: 'accountCode query parameter is required (e.g. 4110-001)',
            });
        }

        const report = await ledgerService.queryGeneralLedger({
            accountCode,
            startDate: from || null,
            endDate: to || null,
            organizationId,
            limit: Number(limit) || 500,
            offset: Number(offset) || 0,
        });
        await logExport(req, 'GENERAL_LEDGER', {
            accountCode,
            from: from || null,
            to: to || null,
            rowCount: report.pagination.returned,
            totalRows: report.pagination.totalRows,
        });
        return res.json({ success: true, data: report });
    } catch (error) {
        if (error.code === 'VALIDATION_ERROR') {
            return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: error.message });
        }
        logger.error('[finance-reports] general-ledger failed:', error?.message);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
