'use strict';

/**
 * Partner access log (DTAM Next integration, 2026-07-08) — the audit trail of
 * WHICH partner read WHAT through the interoperability API. Before this, a
 * successful partner read wrote nothing (only key rejections were logged), so
 * partner access was not auditable.
 *
 * BEST-EFFORT, NEVER THROWS (assignment-ledger pattern): partner reads are
 * serving a downstream government program — a logging fault must not fail the
 * request. Platform-level table (no organizationId — partner requests carry
 * no tenant context by design).
 */

const { prisma } = require('./prisma-database');
// Plain logger import (NOT createLogger) — matches the interoperability
// router's style so the existing interop test suites' logger mocks apply.
const logger = require('../shared/logger');

async function recordPartnerAccess({ partnerId, method, path, code, entityType, entityId, status, ip }) {
    try {
        if (!partnerId) { return null; }
        return await prisma.partnerAccessLog.create({
            data: {
                partnerId: String(partnerId),
                method: String(method || 'GET'),
                path: String(path || '').slice(0, 500),
                code: code ? String(code).slice(0, 200) : null,
                entityType: entityType || null,
                entityId: entityId || null,
                status: Number.isFinite(status) ? status : null,
                ip: ip || null,
            },
        });
    } catch (err) {
        logger.warn(`[partner-access-log] write failed (non-fatal): ${err?.message}`);
        return null;
    }
}

module.exports = { recordPartnerAccess };
