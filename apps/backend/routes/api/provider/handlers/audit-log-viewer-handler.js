/**
 * Audit Log Viewer — Wave B Phase 51 (G5).
 *
 * Read-only paginated viewer over the existing AuditLog hash-chained
 * table (ADR-012). The data already exists; this surface just makes
 * it discoverable to admins instead of "I'll write you a SQL query."
 *
 * Endpoints:
 *   GET  /api/provider/admin/audit-log
 *   GET  /api/provider/admin/audit-log/export.csv
 *
 * Both endpoints accept the same filters as query params:
 *   actor     — substring match on actorId OR actorEmail
 *   category  — exact match (AUTHENTICATION, APPLICATION, PAYMENT, ...)
 *   severity  — exact match (INFO, WARNING, ERROR, CRITICAL)
 *   from      — ISO datetime, inclusive
 *   to        — ISO datetime, inclusive
 *
 * The list endpoint additionally accepts page (default 1) and limit
 * (default 50, max 200). The CSV export omits pagination — it streams
 * up to 50,000 rows for the same filter set, which is the practical
 * upper bound for a Thai-cert-portal tenant.
 *
 * Tenancy: every query is scoped by req.user.organizationId via
 * tenant-scope-aware Prisma. AuditLog is in TENANT_SCOPED_MODELS.
 *
 * Authorisation: admin role only. Middleware chain:
 *   authenticateProvider → requireRole(adminRoles)
 */

'use strict';

const {
    logger,
    toInt,
    authenticateProvider,
    requireRole,
    adminRoles,
} = require('./shared');
const {
    buildWhere,
    csvField,
    CSV_MAX_ROWS,
} = require('./audit-log-viewer-helpers');
const auditTrailService = require('../../../../services/audit-trail');
const { getZonedParts } = require('../../../../utils/working-days');

// Column whitelist for the JSON list endpoint — matches the historical shape
// returned by the handler before the read-path was consolidated through the
// service. Keep frontend-facing keys identical.
const LIST_COLUMNS = [
    'id',
    'logId',
    'sequenceNumber',
    'createdAt',
    'category',
    'action',
    'severity',
    'actorId',
    'actorType',
    'actorEmail',
    'actorRole',
    'resourceType',
    'resourceId',
    'ipAddress',
    'metadata',
    'result',
    'errorCode',
    'errorMessage',
];

// CSV export omits `id`/`actorType` and keeps the legacy column order.
const CSV_COLUMNS = [
    'createdAt',
    'logId',
    'sequenceNumber',
    'category',
    'action',
    'severity',
    'actorId',
    'actorEmail',
    'actorRole',
    'resourceType',
    'resourceId',
    'ipAddress',
    'result',
    'errorCode',
    'errorMessage',
    'metadata',
];

async function listAuditLog(req, res) {
    try {
        const page = toInt(req.query.page, 1, 1, 100000);
        const limit = toInt(req.query.limit, 50, 1, 200);
        const where = buildWhere(req.query);

        const { rows, total } = await auditTrailService.listAuditEvents({
            where,
            page,
            limit,
            maxLimit: 200,
            allowedColumns: LIST_COLUMNS,
            orderBy: { createdAt: 'desc' },
        });

        return res.json({
            success: true,
            data: rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
            filters: {
                actor: req.query.actor || null,
                category: req.query.category || null,
                severity: req.query.severity || null,
                from: req.query.from || null,
                to: req.query.to || null,
            },
        });
    } catch (error) {
        logger.error('[audit-log-viewer] list failed:', error?.message);
        return res.status(500).json({ success: false, error: 'Failed to load audit log' });
    }
}

async function exportAuditLogCsv(req, res) {
    try {
        const where = buildWhere(req.query);
        const rows = await auditTrailService.exportAuditEvents({
            where,
            maxRows: CSV_MAX_ROWS,
            allowedColumns: CSV_COLUMNS,
            orderBy: { createdAt: 'desc' },
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
                csvField(r.createdAt?.toISOString()),
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

        // UTF-8 BOM so Excel opens Thai text correctly.
        const body = '﻿' + lines.join('\r\n') + '\r\n';
        const filename = `audit-log-${getZonedParts(new Date()).isoDate}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(body);
    } catch (error) {
        logger.error('[audit-log-viewer] csv export failed:', error?.message);
        return res.status(500).json({ success: false, error: 'Failed to export audit log' });
    }
}

const adminAuditLogList = [
    authenticateProvider,
    requireRole(adminRoles),
    listAuditLog,
];

const adminAuditLogCsv = [
    authenticateProvider,
    requireRole(adminRoles),
    exportAuditLogCsv,
];

module.exports = {
    adminAuditLogList,
    adminAuditLogCsv,
};
