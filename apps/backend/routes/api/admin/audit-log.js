/**
 * Admin Audit Log Viewer — Iter 28 (B28-A admin tooling).
 *
 * Read-only paginated viewer over the AuditLog hash-chained table
 * (ADR-012). The provider-side equivalent at
 * routes/api/provider/handlers/audit-log-viewer-handler.js exposes the
 * SAME data but accepts a different (substring-style) filter set
 * tuned for that surface. This admin-side variant accepts the
 * Iter 28 structured filter set:
 *
 *   category        exact-match (AUTHENTICATION, APPLICATION, PAYMENT,
 *                   CERTIFICATE, ADMIN, SECURITY, SYSTEM)
 *   action          exact-match, upper-cased
 *   actorId         exact-match (admin searches by user id, not name)
 *   applicationId   filters to resourceType=APPLICATION + resourceId
 *   organizationId  tenant-scope override (admins can audit across tenants)
 *   from, to        ISO datetime range, inclusive
 *
 * Endpoints:
 *   GET  /api/admin/audit-log              JSON paginated list
 *   GET  /api/admin/audit-log/export.csv   CSV export (up to 50k rows)
 *
 * Auth: admin role only — enforced by the parent admin router
 * (routes/api/admin/index.js) via authenticateProvider + requireAdmin.
 * The route does NOT install its own role guard — that would shadow
 * the parent's guard and silently weaken auth.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { neutralizeCsvFormula } = require('../../../shared/csv-utils'); // C5-04 formula-injection guard
const auditTrailService = require('../../../services/audit-trail');
const logger = require('../../../shared/logger');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../middleware/audit-logger');
const { getRequestIp } = require('../../../utils/client-ip');
const { getZonedParts } = require('../../../utils/working-days');

const LIST_COLUMNS = [
    'id', 'logId', 'sequenceNumber', 'createdAt', 'category', 'action',
    'severity', 'actorId', 'actorType', 'actorEmail', 'actorRole',
    'resourceType', 'resourceId', 'ipAddress', 'metadata', 'result',
    'errorCode', 'errorMessage',
];

const CSV_COLUMNS = [
    'createdAt', 'logId', 'sequenceNumber', 'category', 'action',
    'severity', 'actorId', 'actorEmail', 'actorRole', 'resourceType',
    'resourceId', 'ipAddress', 'result', 'errorCode', 'errorMessage',
    'metadata',
];

const CSV_MAX_ROWS = 50_000;

function toInt(val, fallback, min, max) {
    const n = Number.parseInt(String(val || ''), 10);
    if (!Number.isFinite(n)) {return fallback;}
    return Math.min(Math.max(n, min), max);
}

function buildFiltersFromQuery(q) {
    return {
        category: q.category,
        // เคยขาดหายไปทั้งที่หน้าจอส่งมาทุกครั้ง ⇒ ผู้ดูแลเห็นชิป "ระดับ: ข้อผิดพลาด" ค้างอยู่
        // ขณะที่ตารางและไฟล์ CSV คืนทุกระดับ (วัดจริง 2026-09-07)
        severity: q.severity,
        action: q.action,
        actorId: q.actorId,
        applicationId: q.applicationId,
        organizationId: q.organizationId,
        dateRange: (q.from || q.to)
            ? { from: q.from, to: q.to }
            : undefined,
    };
}

function csvField(v) {
    if (v === null || v === undefined) {return '';}
    const s = neutralizeCsvFormula(typeof v === 'object' ? JSON.stringify(v) : String(v)); // C5-04
    if (/[,"\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * X5-FIX-A / M-5 (PDPA ม.24) — emit a single audit row to mark that an
 * admin VIEWED the audit log / exported it. PDPA ม.24 treats "viewing
 * personal data" as processing, so the act of opening this page is
 * itself processing and must be recorded. The row is best-effort:
 * failure must not block the read response (otherwise the admin
 * console would brown out on a transient audit-table issue). Capped
 * to ONE row per request — not per result row — to keep the chain
 * manageable.
 *
 * action: 'AUDIT_LOG_READ' | 'AUDIT_LOG_EXPORT'
 *
 * The audit row carries enough filter context to reconstruct WHAT the
 * admin was looking at without echoing free-form text PII back.
 */
async function writeAuditLogReadAudit(req, action, filterSummary) {
    try {
        await auditLogger.log({
            category: AuditCategory.ADMIN,
            action,
            severity: AuditSeverity.INFO,
            actorId: req.user?.id || 'SYSTEM',
            actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
            actorEmail: req.user?.email || null,
            actorType: 'ADMIN',
            resourceType: ResourceType.SYSTEM,
            resourceId: 'AUDIT_LOG',
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent'),
            metadata: filterSummary || {},
        });
    } catch (_error) {
        // Best effort logging only — read must not fail on audit-write
        // failure (the response payload is the primary user-visible
        // outcome; the missed audit row will be detected by chain
        // verification, not by failing the GET).
    }
}

router.get('/', async (req, res) => {
    try {
        const page = toInt(req.query.page, 1, 1, 100000);
        const limit = toInt(req.query.limit, 50, 1, 200);
        const filters = buildFiltersFromQuery(req.query);
        const { rows, total } = await auditTrailService.queryWithFilters({
            filters,
            page,
            limit,
            maxLimit: 200,
            allowedColumns: LIST_COLUMNS,
        });
        // PDPA ม.24 read-side audit (M-5). Best-effort, post-success.
        await writeAuditLogReadAudit(req, 'AUDIT_LOG_READ', {
            page,
            limit,
            resultCount: rows.length,
            filters: {
                category: filters.category || null,
                // บันทึกว่าผู้ดูแลเปิดดูด้วยตัวกรองอะไร — ระดับความสำคัญเคยหายไปจากบันทึกนี้
                // ด้วย เพราะไม่มีใครอ่านมันตั้งแต่ต้นทาง
                severity: filters.severity || null,
                action: filters.action || null,
                actorId: filters.actorId || null,
                applicationId: filters.applicationId || null,
                organizationId: filters.organizationId || null,
                from: filters.dateRange?.from || null,
                to: filters.dateRange?.to || null,
            },
        });
        // Nest rows + pagination INSIDE `data` so pagination survives the FE
        // apiClient envelope-collapse (which keeps only body.data on success).
        // Mirrors the /admin/users pattern. The page does not consume `filters`.
        return res.json({
            success: true,
            data: {
                rows,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.max(1, Math.ceil(total / limit)),
                },
            },
        });
    } catch (error) {
        logger.error('[admin/audit-log] list failed:', error?.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to load audit log',
        });
    }
});

router.get('/export.csv', async (req, res) => {
    try {
        const filters = buildFiltersFromQuery(req.query);
        const where = auditTrailService.buildAdminFilterWhere(filters);
        const rows = await auditTrailService.exportAuditEvents({
            where,
            maxRows: CSV_MAX_ROWS,
            allowedColumns: CSV_COLUMNS,
        });
        // PDPA ม.24 read-side audit (M-5). Mark CSV exports specifically so
        // the audit timeline can distinguish a 50k-row dump from a paged
        // viewer hit.
        await writeAuditLogReadAudit(req, 'AUDIT_LOG_EXPORT', {
            resultCount: rows.length,
            maxRows: CSV_MAX_ROWS,
            filters: {
                category: filters.category || null,
                // บันทึกว่าผู้ดูแลเปิดดูด้วยตัวกรองอะไร — ระดับความสำคัญเคยหายไปจากบันทึกนี้
                // ด้วย เพราะไม่มีใครอ่านมันตั้งแต่ต้นทาง
                severity: filters.severity || null,
                action: filters.action || null,
                actorId: filters.actorId || null,
                applicationId: filters.applicationId || null,
                organizationId: filters.organizationId || null,
                from: filters.dateRange?.from || null,
                to: filters.dateRange?.to || null,
            },
        });

        const header = [
            'timestamp', 'logId', 'sequenceNumber', 'category', 'action',
            'severity', 'actorId', 'actorEmail', 'actorRole',
            'resourceType', 'resourceId', 'ipAddress', 'result',
            'errorCode', 'errorMessage', 'metadata',
        ];
        const lines = [header.join(',')];
        for (const r of rows) {
            lines.push([
                csvField(r.createdAt && r.createdAt.toISOString
                    ? r.createdAt.toISOString()
                    : r.createdAt),
                csvField(r.logId),
                csvField(r.sequenceNumber),
                csvField(r.category),
                csvField(r.action),
                csvField(r.severity),
                csvField(r.actorId),
                csvField(r.actorEmail),
                csvField(r.actorRole),
                csvField(r.resourceType),
                csvField(r.resourceId),
                csvField(r.ipAddress),
                csvField(r.result),
                csvField(r.errorCode),
                csvField(r.errorMessage),
                csvField(r.metadata),
            ].join(','));
        }
        // UTF-8 BOM so Excel opens Thai metadata correctly.
        const body = '﻿' + lines.join('\r\n') + '\r\n';
        const filename = `admin-audit-log-${getZonedParts(new Date()).isoDate}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(body);
    } catch (error) {
        logger.error('[admin/audit-log] csv export failed:', error?.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to export audit log',
        });
    }
});

module.exports = router;
