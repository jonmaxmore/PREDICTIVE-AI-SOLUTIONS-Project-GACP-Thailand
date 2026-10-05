/**
 * Pure helpers for the audit-log viewer (Wave B Phase 51 / G5).
 * Split out from the handler so tests don't drag in the prisma client.
 */

'use strict';

const { neutralizeCsvFormula } = require('../../../../shared/csv-utils'); // C5-04 formula-injection guard

const VALID_CATEGORIES = new Set([
    'AUTHENTICATION', 'APPLICATION', 'PAYMENT', 'CERTIFICATE',
    'ADMIN', 'SECURITY', 'SYSTEM', 'AUDIT', 'TRACKED_FIELD',
]);

const VALID_SEVERITIES = new Set([
    'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW',
]);

const CSV_MAX_ROWS = 50_000;

function buildWhere(query) {
    const where = {};

    const actor = String(query.actor || '').trim();
    if (actor) {
        where.OR = [
            { actorId: { contains: actor, mode: 'insensitive' } },
            { actorEmail: { contains: actor, mode: 'insensitive' } },
        ];
    }

    const category = String(query.category || '').trim().toUpperCase();
    if (category && VALID_CATEGORIES.has(category)) {
        where.category = category;
    }

    const severity = String(query.severity || '').trim().toUpperCase();
    if (severity && VALID_SEVERITIES.has(severity)) {
        where.severity = severity;
    }

    const from = String(query.from || '').trim();
    const to = String(query.to || '').trim();
    if (from || to) {
        where.createdAt = {};
        if (from) {
            const d = new Date(from);
            if (!Number.isNaN(d.getTime())) {
                where.createdAt.gte = d;
            }
        }
        if (to) {
            const d = new Date(to);
            if (!Number.isNaN(d.getTime())) {
                where.createdAt.lte = d;
            }
        }
        if (Object.keys(where.createdAt).length === 0) {
            delete where.createdAt;
        }
    }

    return where;
}

function csvField(v) {
    if (v === null || v === undefined) {
        return '';
    }
    const s = neutralizeCsvFormula(typeof v === 'object' ? JSON.stringify(v) : String(v)); // C5-04
    if (/[,"\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

module.exports = {
    VALID_CATEGORIES,
    VALID_SEVERITIES,
    CSV_MAX_ROWS,
    buildWhere,
    csvField,
};
