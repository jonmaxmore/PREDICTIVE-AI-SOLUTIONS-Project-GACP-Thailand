/**
 * Audit Trail Service (Unified)
 * บันทึก Log ทุกการเปลี่ยนแปลงข้อมูลในระบบ GACP
 *
 * Apple Audit Requirements:
 * - Immutable records (ห้ามลบ/แก้ไข)
 * - 5-year retention (ตามระเบียบ DTAM)
 * - Complete traceability
 *
 * @version 2.0.0 - PostgreSQL with Prisma
 */

const { prisma } = require('./prisma-database');
const { getRequestIp } = require('../utils/client-ip');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../middleware/audit-logger');

// Action types
const ACTIONS = {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    SOFT_DELETE: 'SOFT_DELETE',
    VIEW: 'VIEW',
    EXPORT: 'EXPORT',
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
    PASSWORD_CHANGE: 'PASSWORD_CHANGE',
    UPLOAD: 'UPLOAD',
    DOWNLOAD: 'DOWNLOAD',
    APPROVE: 'APPROVE',
    REJECT: 'REJECT',
    SUBMIT: 'SUBMIT',
};

// Entity types
const ENTITIES = {
    USER: 'User',
    FARM: 'Farm',
    APPLICATION: 'Application',
    DOCUMENT: 'Document',
    HARVEST_BATCH: 'HarvestBatch',
    PLANT_SPECIES: 'PlantSpecies',
    NOTIFICATION: 'Notification',
    PAYMENT: 'Payment',
    AUDIT: 'Audit',
    CERTIFICATE: 'Certificate',
};

// Severity levels
const SEVERITY = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    CRITICAL: 'CRITICAL',
};

function mapSeverityToAuditLogger(severity) {
    switch (severity) {
    case SEVERITY.WARNING:
        return AuditSeverity.WARNING;
    case SEVERITY.ERROR:
        return AuditSeverity.ERROR;
    case SEVERITY.CRITICAL:
        return AuditSeverity.CRITICAL;
    case SEVERITY.DEBUG:
    case SEVERITY.INFO:
    default:
        return AuditSeverity.INFO;
    }
}

function mapEntityToResourceType(entityType) {
    switch (entityType) {
    case ENTITIES.USER:
        return ResourceType.USER;
    case ENTITIES.APPLICATION:
        return ResourceType.APPLICATION;
    case ENTITIES.PAYMENT:
        return ResourceType.PAYMENT;
    case ENTITIES.CERTIFICATE:
        return ResourceType.CERTIFICATE;
    case ENTITIES.DOCUMENT:
        return ResourceType.DOCUMENT;
    default:
        return ResourceType.SYSTEM;
    }
}

function mapActionToCategory(action) {
    if (String(action).includes('LOGIN') || String(action).includes('LOGOUT') || String(action).includes('PASSWORD')) {
        return AuditCategory.AUTHENTICATION;
    }
    if (String(action).includes('PAYMENT')) {
        return AuditCategory.PAYMENT;
    }
    return AuditCategory.SYSTEM;
}

/**
 * Log an action to the audit trail
 * @param {Object} params
 */
async function logAction({
    action,
    entityType,
    entityId = null,
    entityUuid = null,
    userId = null,
    userEmail = null,
    userRole = null,
    ipAddress = null,
    userAgent = null,
    sessionId = null,
    oldValues = null,
    newValues = null,
    changedFields = [],
    description = null,
    metadata = null,
    applicationId = null,
    farmId = null,
    batchNumber = null,
    severity = SEVERITY.INFO,
}) {
    try {
        // Legacy API adapter: normalize old audit-trail payloads into the canonical
        // immutable audit logger schema to keep DB persistence working.
        return await auditLogger.log({
            category: mapActionToCategory(action),
            action: action || 'UNKNOWN',
            severity: mapSeverityToAuditLogger(severity),
            actorId: userId?.toString() || 'SYSTEM',
            actorEmail: userEmail,
            actorRole: userRole || 'UNKNOWN',
            actorType: userId ? 'USER' : 'SYSTEM',
            resourceType: mapEntityToResourceType(entityType),
            resourceId: entityUuid || entityId?.toString() || applicationId?.toString() || farmId?.toString() || batchNumber || 'UNKNOWN',
            ipAddress: ipAddress || 'unknown',
            userAgent: userAgent || 'unknown',
            metadata: {
                legacyAuditTrail: true,
                entityType,
                entityId: entityId?.toString() || null,
                entityUuid,
                sessionId,
                oldValues,
                newValues,
                changedFields,
                description,
                metadata,
                applicationId: applicationId?.toString() || null,
                farmId: farmId?.toString() || null,
                batchNumber,
            },
            result: severity === SEVERITY.ERROR || severity === SEVERITY.CRITICAL ? 'FAILURE' : 'SUCCESS',
            errorMessage: severity === SEVERITY.ERROR || severity === SEVERITY.CRITICAL ? (description || null) : null,
        });
    } catch (error) {
        // Log error but don't throw - audit should not break main flow
        console.error('[AuditService] Failed to log action:', error.message);
        return null;
    }
}

/**
 * Log from Express request context
 * @param {Object} req - Express request object
 * @param {Object} params - Audit parameters
 */
async function logFromRequest(req, params) {
    const user = req.user || {};

    return logAction({
        ...params,
        userId: user.id || user.uuid || params.userId,
        userEmail: user.email || params.userEmail,
        userRole: user.role || params.userRole,
        ipAddress: getRequestIp(req),
        userAgent: req.get('User-Agent'),
        sessionId: req.sessionID || req.headers['x-session-id'],
    });
}

// Removed (2026-06-08, dead-code cleanup): getAuditLogs() + getEntityHistory().
// Both were legacy readers that filtered the AuditLog table on pre-hash-chain
// columns (entityType / entityId / userId / farmId / severity) which no longer
// exist on the canonical model (it uses resourceType / resourceId / actorId).
// They had 0 callers across the repo and would have thrown a Prisma validation
// error if ever invoked. Use the canonical readers below instead
// (listAuditEvents / queryWithFilters / getTimelineForApplication).

// Canonical read-path helpers for the AuditLog table (hash-chained, ADR-012).
//
// All read access from HTTP handlers MUST go through this service. Direct
// prisma.auditLog.findMany/count calls in handler code bypass:
//   - the column whitelist (leaks unintended columns to the UI)
//   - pagination invariants (offset/limit normalization)
//   - the future home of any PDPA-aware row sanitization
//
// `audit-logger.js` remains the canonical writer. This file is the canonical
// reader. See apps/backend/services/audit-trail.js change-log for context.

// Columns that are always safe to surface (no PII by definition: hash-chain
// metadata, action shape, actor identifiers already captured by the writer).
// Handler-level callers may pass `allowedColumns` to further narrow this set.
const VIEWER_DEFAULT_COLUMNS = Object.freeze([
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
]);

const TIMELINE_DEFAULT_COLUMNS = Object.freeze([
    'id',
    'logId',
    'sequenceNumber',
    'action',
    'actorId',
    'actorRole',
    'createdAt',
    'metadata',
]);

function buildSelect(allowedColumns) {
    const cols = Array.isArray(allowedColumns) && allowedColumns.length > 0
        ? allowedColumns
        : VIEWER_DEFAULT_COLUMNS;
    return cols.reduce((acc, col) => {
        acc[col] = true;
        return acc;
    }, {});
}

function normalizePagination({ page, limit, maxLimit = 200 }) {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), maxLimit)
        : 50;
    return {
        page: safePage,
        limit: safeLimit,
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
    };
}

/**
 * Paginated list of audit events for the admin viewer / CSV export.
 *
 * Handlers should buildWhere from query params (existing helper module) and
 * pass it here. Pagination and column whitelisting are enforced inside this
 * service so handlers cannot drift apart.
 *
 * @param {Object} opts
 * @param {Object} opts.where - prisma-shaped where clause (already validated)
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.maxLimit=200]
 * @param {string[]} [opts.allowedColumns] - whitelist of columns to return
 * @param {Object} [opts.orderBy={ createdAt: 'desc' }]
 * @returns {Promise<{ rows: Array, total: number, page: number, limit: number }>}
 */
async function listAuditEvents({
    where = {},
    page = 1,
    limit = 50,
    maxLimit = 200,
    allowedColumns,
    orderBy = { createdAt: 'desc' },
} = {}) {
    const pagination = normalizePagination({ page, limit, maxLimit });
    const select = buildSelect(allowedColumns);

    const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            orderBy,
            skip: pagination.skip,
            take: pagination.take,
            select,
        }),
        prisma.auditLog.count({ where }),
    ]);

    return {
        rows,
        total,
        page: pagination.page,
        limit: pagination.limit,
    };
}

// Iter 28 (B28-A admin tooling) — queryWithFilters().
//
// The existing listAuditEvents() accepts a prebuilt `where` clause. That
// works for the provider-side viewer (which has its own helper module)
// but the new admin-side audit-log surface needs to construct a where
// clause from a richer filter set:
//   - category    (exact match, upper-cased)
//   - action      (exact match, upper-cased)
//   - actorId     (exact match — admins search by id, not by substring)
//   - dateRange   ({ from, to } ISO strings or Date objects)
//   - applicationId
//   - organizationId
//
// Encapsulating the where-builder here means the route handler stays
// thin AND tests can assert filter behaviour without spinning supertest.

const ADMIN_FILTER_VALID_CATEGORIES = new Set([
    'AUTHENTICATION', 'APPLICATION', 'PAYMENT', 'CERTIFICATE',
    'ADMIN', 'SECURITY', 'SYSTEM',
]);

// ระดับความสำคัญที่ audit-logger เขียนลงจริง (middleware/audit-logger.js:57-62)
// รายการปิดเหมือนหมวดหมู่ ด้วยเหตุผลเดียวกัน: คำที่ไม่ใช่ระดับ ต้องถูกทิ้ง ไม่ใช่ยัดลง
// เงื่อนไขจนได้ผลลัพธ์ว่างเปล่าแล้วผู้ดูแลอ่านว่า "ไม่มีเหตุการณ์"
const ADMIN_FILTER_VALID_SEVERITIES = new Set(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);

function _normalizeDate(input) {
    if (!input) {return null;}
    const d = input instanceof Date ? input : new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Build the prisma where-clause used by the admin audit-log viewer.
 * Pure function — no prisma access. Returned shape mirrors the
 * `where` argument of listAuditEvents.
 */
function buildAdminFilterWhere({
    category,
    severity,
    action,
    actorId,
    applicationId,
    organizationId,
    dateRange,
} = {}) {
    const where = {};

    const normalizedCategory = String(category || '').trim().toUpperCase();
    if (normalizedCategory && ADMIN_FILTER_VALID_CATEGORIES.has(normalizedCategory)) {
        where.category = normalizedCategory;
    }

    // หน้าจอมีตัวเลือกนี้และขึ้นชิปยืนยันว่ากรองแล้ว แต่เงื่อนไขไม่เคยอ่านมัน
    // (วัดจริง 2026-09-07: ?severity=ERROR คืน INFO 163 · WARNING 37 · ERROR 0
    //  และไฟล์ส่งออกคืนทั้งตาราง) — คลาสเดียวกับที่ admin/users.js เคยแก้ไปแล้ว
    const normalizedSeverity = String(severity || '').trim().toUpperCase();
    if (normalizedSeverity && ADMIN_FILTER_VALID_SEVERITIES.has(normalizedSeverity)) {
        where.severity = normalizedSeverity;
    }

    const normalizedAction = String(action || '').trim().toUpperCase();
    if (normalizedAction) {
        where.action = normalizedAction;
    }

    const trimmedActor = String(actorId || '').trim();
    if (trimmedActor) {
        where.actorId = trimmedActor;
    }

    if (applicationId) {
        const appId = String(applicationId).trim();
        if (appId) {
            // Application audit rows land under resourceType=APPLICATION
            // (most events) OR resourceType=PAYMENT|INVOICE with the
            // applicationId in metadata. The admin viewer focuses on the
            // primary application timeline so we filter on resourceId
            // directly — matching the existing getTimelineForApplication
            // contract.
            where.resourceType = 'APPLICATION';
            where.resourceId = appId;
        }
    }

    if (organizationId) {
        const orgId = String(organizationId).trim();
        if (orgId) {
            where.organizationId = orgId;
        }
    }

    if (dateRange) {
        const from = _normalizeDate(dateRange.from);
        const to = _normalizeDate(dateRange.to);
        if (from || to) {
            where.createdAt = {};
            if (from) {where.createdAt.gte = from;}
            if (to) {where.createdAt.lte = to;}
        }
    }

    return where;
}

/**
 * Admin-facing audit-log query with a structured filter set. Wraps
 * listAuditEvents so the column whitelist + pagination invariants
 * stay enforced.
 *
 * @param {Object} opts
 * @param {Object} [opts.filters]
 * @param {string} [opts.filters.category]
 * @param {string} [opts.filters.action]
 * @param {string} [opts.filters.actorId]
 * @param {string} [opts.filters.applicationId]
 * @param {string} [opts.filters.organizationId]
 * @param {Object} [opts.filters.dateRange]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=50]
 * @param {number} [opts.maxLimit=200]
 * @param {string[]} [opts.allowedColumns]
 * @returns {Promise<{ rows: Array, total: number, page: number, limit: number }>}
 */
async function queryWithFilters({
    filters = {},
    page = 1,
    limit = 50,
    maxLimit = 200,
    allowedColumns,
} = {}) {
    const where = buildAdminFilterWhere(filters);
    return listAuditEvents({
        where,
        page,
        limit,
        maxLimit,
        allowedColumns,
    });
}

/**
 * Unpaginated list for CSV/export. Capped at `maxRows` rows to prevent
 * unbounded result sets — callers must enforce a sensible upper bound.
 *
 * @param {Object} opts
 * @param {Object} opts.where
 * @param {number} opts.maxRows
 * @param {string[]} [opts.allowedColumns]
 * @param {Object} [opts.orderBy={ createdAt: 'desc' }]
 */
async function exportAuditEvents({
    where = {},
    maxRows,
    allowedColumns,
    orderBy = { createdAt: 'desc' },
} = {}) {
    if (!Number.isFinite(maxRows) || maxRows <= 0) {
        throw new Error('exportAuditEvents requires a positive maxRows cap');
    }
    const select = buildSelect(allowedColumns);
    return prisma.auditLog.findMany({
        where,
        orderBy,
        take: Math.floor(maxRows),
        select,
    });
}

/**
 * Ordered audit-log timeline for a single application (workflow viewer).
 *
 * Returns events in sequenceNumber-asc order, capped at `limit` rows
 * (default 500 — the same upper bound the handler previously enforced).
 *
 * @param {string} applicationId
 * @param {Object} [opts]
 * @param {number} [opts.limit=500]
 * @param {string[]} [opts.allowedColumns]
 */
async function getTimelineForApplication(applicationId, {
    limit = 500,
    allowedColumns,
} = {}) {
    if (!applicationId) {
        return [];
    }
    const safeLimit = Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 2000)
        : 500;

    return prisma.auditLog.findMany({
        where: {
            resourceType: 'APPLICATION',
            resourceId: String(applicationId),
        },
        orderBy: { sequenceNumber: 'asc' },
        take: safeLimit,
        select: buildSelect(allowedColumns || TIMELINE_DEFAULT_COLUMNS),
    });
}

// Payment audit-trail helpers (B15-B, audit-evidence, 2026-05-16).
//
// Finance staff during monthly close — and DTAM auditors during the
// 5-yearly compliance inspection — need a chronological list of every
// payment-related event for a single application. The events are
// written via auditLogger.log() and scattered across
// resourceType=PAYMENT (historical payment-resource rows) and
// resourceType=INVOICE (invoice issuance/receipt). This helper joins
// them and walks the hash-chain to prove no row has been tampered
// with on the audit trail itself.
//
// Legal basis:
//   - Thai e-Transactions Act B.E. 2544 §12 + §26 — integrity of
//     electronic evidence. The hash-chain link check is the
//     mechanism that demonstrates the AuditLog row is intact between
//     write and read.
//   - ISO 27799:2016 §7.10.4 (Audit logging) — verification of log
//     integrity at read time, not just at write time.
//
// WHT (Withholding Tax) hook: corporate applicants will eventually
// need WHT certificates issued alongside receipts. Until that
// implementation lands (see config/invoice-issuers.js Tier 9), this
// helper stamps `withholdingTaxApplicable: false` on every payment
// event in its response — so a future schema-additive change can
// flip the flag without re-keying historical rows. The audit-trail
// returned by this method is therefore forward-compatible with the
// WHT certificate workflow once it ships.

const PAYMENT_AUDIT_ACTIONS = Object.freeze([
    'PAYMENT_RECONCILIATION_EXPORTED',
    'INVOICE_ISSUED',
    'INVOICE_PAID',
    'RECEIPT_ISSUED',
    'PAYMENT_TRANSACTION_RECORDED',
]);

const PAYMENT_TRAIL_COLUMNS = Object.freeze([
    'id',
    'logId',
    'sequenceNumber',
    'createdAt',
    'category',
    'action',
    'severity',
    'actorId',
    'actorRole',
    'actorEmail',
    'actorType',
    'resourceType',
    'resourceId',
    'metadata',
    'result',
    'errorCode',
    'errorMessage',
    'previousHash',
    'currentHash',
]);

/**
 * Verify that an ordered list of audit rows forms an unbroken
 * hash-chain — every row's `previousHash` matches the prior row's
 * `currentHash`. The rows must be sorted by `sequenceNumber asc`
 * before being passed in; mis-ordering would falsely report breaks.
 *
 * Returns a result object rather than throwing because finance
 * tooling needs to render the trail even when a break is found —
 * the broken segment itself is forensic evidence.
 *
 * @param {Array<{ sequenceNumber: number, previousHash: string, currentHash: string, logId: string }>} rows
 * @returns {{ verified: boolean, breaks: Array<{ at: number, logId: string, expected: string, found: string }> }}
 */
function verifyHashChain(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { verified: true, breaks: [] };
    }
    const breaks = [];
    // For the first row in the window we cannot assert the previous
    // link (it may legitimately point to a row outside the window).
    // We only verify intra-window links — the audit-logger's own
    // verifyChain() covers the full-history pass when needed.
    for (let i = 1; i < rows.length; i += 1) {
        const prev = rows[i - 1];
        const curr = rows[i];
        if (curr.previousHash !== prev.currentHash) {
            breaks.push({
                at: curr.sequenceNumber,
                logId: curr.logId,
                expected: prev.currentHash,
                found: curr.previousHash,
            });
        }
    }
    return { verified: breaks.length === 0, breaks };
}

/**
 * Fetch the chronological payment audit-trail for one application.
 *
 * Joins three resource scopes:
 *   1. resourceType=APPLICATION + payment-related action (covers
 *      status-machine writes that touched the payment phase)
 *   2. resourceType=PAYMENT + metadata.applicationId matches (historical
 *      payment-resource rows carry applicationId in metadata so an
 *      auditor can find every payment event)
 *   3. resourceType=INVOICE + metadata.applicationId matches (invoice
 *      issuance / receipt / hold / release events)
 *
 * Returns rows in `sequenceNumber asc` order across all three
 * scopes — the sequence is global per-tenant, so cross-resource
 * ordering is well-defined.
 *
 * @param {string} applicationId
 * @param {object} [opts]
 * @param {number} [opts.limit=1000]
 * @param {boolean} [opts.verifyChain=true]
 * @returns {Promise<{ events: Array<object>, chain: { verified: boolean, breaks: Array }, withholdingTaxApplicable: false }>}
 */
async function getPaymentAuditTrail(applicationId, {
    limit = 1000,
    verifyChain: verifyChainOpt = true,
} = {}) {
    if (!applicationId) {
        return {
            events: [],
            chain: { verified: true, breaks: [] },
            // WHT remains unimplemented (config/invoice-issuers.js Tier
            // 9). Stamping the flag on the response keeps the contract
            // stable for the corporate-customer billing rollout —
            // future versions will flip per-event when WHT applies.
            withholdingTaxApplicable: false,
        };
    }

    const safeLimit = Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 5000)
        : 1000;

    const select = PAYMENT_TRAIL_COLUMNS.reduce((acc, col) => {
        acc[col] = true;
        return acc;
    }, {});

    // We OR together the three scopes in one prisma call so the rows
    // come back already merged + sorted by sequenceNumber. The
    // metadata-path JSON filter relies on the GIN index on
    // AuditLog.metadata (see schema/audit.prisma).
    const events = await prisma.auditLog.findMany({
        where: {
            OR: [
                {
                    resourceType: 'APPLICATION',
                    resourceId: String(applicationId),
                    action: { in: PAYMENT_AUDIT_ACTIONS },
                },
                {
                    resourceType: 'PAYMENT',
                    metadata: { path: ['applicationId'], equals: String(applicationId) },
                },
                {
                    resourceType: 'INVOICE',
                    metadata: { path: ['applicationId'], equals: String(applicationId) },
                },
            ],
        },
        orderBy: { sequenceNumber: 'asc' },
        take: safeLimit,
        select,
    });

    const chain = verifyChainOpt
        ? verifyHashChain(events)
        : { verified: null, breaks: [] };

    return {
        events: events.map((evt) => ({
            ...evt,
            // Per-row WHT hook. Always false today; the field exists
            // so corporate-WHT rollout can flip it without breaking
            // historical record consumers. See top-of-file comment +
            // config/invoice-issuers.js Tier 9.
            withholdingTaxApplicable: false,
        })),
        chain,
        withholdingTaxApplicable: false,
    };
}

// Periodic hash-chain integrity sweep (audit gap #14 (B),
// carpet-bomb-inversion-audit-2026-07-06 #27).
//
// verifyChain was a DEAD control: it only ran when someone READ the trail with
// the option — no cron, endpoint, or startup check ever ran it, so a post-write
// edit to an immutable audit row (flipping an AUDITOR REJECT→APPROVE, changing a
// paid amount in metadata) was never surfaced. This runs verifyChain over each
// tenant's recent window on a schedule (wired into jobs/scheduler.js) and emits
// a loud, greppable [AUDIT_CHAIN_ALERT] on any break so log-based alerting
// picks it up.
//
// Per-tenant (ADR-014): each organization owns an independent GENESIS-rooted
// chain, so we enumerate tenants (groupBy) and verify each in isolation.
// Bounded: verifies only the last `windowSize` sequence numbers per tenant so
// the daily O(n) scan stays cheap under 5-year retention; the write-time hash
// chain still protects the full history, and an on-demand full verifyChain
// (startSequence: 1) remains available for a forensic deep-check.
//
// BASELINE FLOOR (fix/audit-batch3) — env AUDIT_CHAIN_VERIFY_FROM_SEQ.
// Legacy history carries PRE-EXISTING BENIGN breaks below the v2 cut-over:
// PDPA re-key / detokenize scripts mutated audit-log columns without
// recomputing currentHash (standing HASH_MISMATCH), and some legacy rows have
// dropped sequence numbers (LINK_MISMATCH). Verifying the recent window over
// that legacy tail would emit [AUDIT_CHAIN_ALERT] EVERY night on benign breaks
// — alarm-fatigue that masks a REAL tamper. `fromSequence` (default from env
// AUDIT_CHAIN_VERIFY_FROM_SEQ; unset/NaN → 0) is an absolute FLOOR: when > 0 the
// per-tenant scan starts at max(windowStart, fromSequence), so pre-cutover
// breaks below the baseline never trigger an alert. When 0/unset behavior is
// UNCHANGED (full recent window) — opt-in + backward-compatible. Boundary link:
// startSequence > 1 makes auditLogger.verifyChain anchor its link check to the
// first in-window row's previousHash (audit-logger.js), so the first post-
// baseline row is NOT falsely reported as a LINK_MISMATCH.
//
// DEPLOY RUNBOOK (ops follow-ups — not implemented here beyond the fromSequence
// gate):
//   1. At deploy, set AUDIT_CHAIN_VERIFY_FROM_SEQ to the then-current
//      max(sequenceNumber) so the cron baselines to the clean v2-forward chain.
//      Query once: SELECT MAX("sequenceNumber") FROM "AuditLog";
//   2. Wire [AUDIT_CHAIN_ALERT] to real alerting (an in-country, self-hosted
//      aggregator or a log-match rule — no foreign SaaS: PDPA) — it
//      is console.error today; a break must page, not just sit in logs.
//   3. A weekly FULL-chain scan (windowSize:0, fromSequence:0) is a future
//      follow-up for deep forensic coverage below the baseline.

const AUDIT_CHAIN_VERIFY_WINDOW = 5000;

/**
 * Resolve the baseline sequence floor. An explicit non-negative number wins;
 * otherwise default from env AUDIT_CHAIN_VERIFY_FROM_SEQ (parseInt; unset / NaN
 * / negative → 0 = no floor).
 */
function _resolveBaselineFromSequence(explicit) {
    if (explicit !== undefined && explicit !== null) {
        const n = Number(explicit);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    const parsed = parseInt(process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ, 10);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

/**
 * FU-2 (full-system audit follow-up, 2026-07-07) — per-tenant baseline floors.
 *
 * `sequenceNumber` is PER-TENANT (@@unique([organizationId, sequenceNumber]))
 * but the env floor is GLOBAL: a NEW tenant's fresh chain (seq 1..N, all below
 * the floor) gets startSequence = max(windowStart, floor) > tail — the sweep
 * verifies NOTHING for that org, so a tampered row there never alerts
 * (live-demonstrated on staging 2026-07-07 with the drill org's chain).
 *
 * SystemConfig key `audit_chain_baselines` = JSON map { orgId: floor }.
 * When the row exists and parses to a plain object, each tenant's floor is
 * map[orgId] ?? 0 — fresh chains have no pre-cutover legacy breaks, so 0 (full
 * window) is the correct default for unlisted orgs. When the row is absent,
 * malformed, or unreadable, returns null and the caller falls back to the
 * legacy global explicit/env floor — backward compatible + never blocks the
 * control on a config problem.
 *
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function _loadPerTenantBaselines() {
    try {
        if (!prisma?.systemConfig?.findUnique) { return null; }
        const row = await prisma.systemConfig.findUnique({
            where: { key: 'audit_chain_baselines' },
            select: { value: true },
        });
        if (!row) { return null; }
        let value = row.value;
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch { return null; }
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
        return null;
    } catch (_error) {
        // Fail-open to the legacy env floor — a config-read blip must not
        // stop the nightly integrity sweep.
        return null;
    }
}

/**
 * Sweep every tenant's recent audit-chain window and alert on integrity breaks.
 *
 * @param {Object} [opts]
 * @param {number} [opts.windowSize=5000] — verify the last N sequence numbers
 *   per tenant. Pass 0 to verify the full chain (startSequence 1) per tenant.
 * @param {number} [opts.fromSequence] — absolute baseline floor (v2-cutover).
 *   Defaults from env AUDIT_CHAIN_VERIFY_FROM_SEQ. When > 0 the per-tenant scan
 *   starts at max(windowStart, fromSequence) so pre-existing benign breaks below
 *   the baseline never alert. 0/unset → unchanged full recent-window behavior.
 * @returns {Promise<{ orgsChecked: number, breaksFound: number, baseline: number, orgs: Array }>}
 */
async function runScheduledChainVerification({ windowSize = AUDIT_CHAIN_VERIFY_WINDOW, fromSequence } = {}) {
    const baseline = _resolveBaselineFromSequence(fromSequence);
    // FU-2 precedence (adversarial-verify MUST-3): an EXPLICIT fromSequence is
    // deliberate caller intent (forensic full scans pass {windowSize:0,
    // fromSequence:0}) and wins over everything — the map is not even
    // consulted. Otherwise the per-tenant SystemConfig map applies when
    // seeded; null map → legacy env floor.
    const explicitFloor = fromSequence !== undefined && fromSequence !== null;
    const perTenantBaselines = explicitFloor ? null : await _loadPerTenantBaselines();

    // Enumerate per-tenant chains + their tail sequence in one grouped query.
    const tenants = await prisma.auditLog.groupBy({
        by: ['organizationId'],
        _max: { sequenceNumber: true },
    });

    const summary = {
        orgsChecked: 0,
        breaksFound: 0,
        baseline,
        baselineSource: perTenantBaselines ? 'per-tenant' : 'global',
        orgs: [],
    };

    for (const tenant of tenants) {
        const organizationId = tenant.organizationId;
        const tail = tenant?._max?.sequenceNumber || 0;
        // Per-tenant floor when the map exists (unlisted org → 0 = full window;
        // a fresh chain has no pre-cutover legacy breaks to skip); otherwise
        // the legacy global floor.
        const mappedFloor = perTenantBaselines ? Number(perTenantBaselines[organizationId]) : NaN;
        const tenantBaseline = perTenantBaselines
            ? (Number.isFinite(mappedFloor) && mappedFloor > 0 ? Math.floor(mappedFloor) : 0)
            : baseline;
        // Recent-window start, then raise it to the baseline floor. The baseline
        // (> 1) makes verifyChain anchor its boundary link to the first in-window
        // row rather than GENESIS, so no false LINK_MISMATCH at the floor.
        const windowStart = windowSize > 0 ? Math.max(1, tail - windowSize + 1) : 1;
        const startSequence = Math.max(windowStart, tenantBaseline);
        summary.orgsChecked += 1;

        let result;
        try {
            result = await auditLogger.verifyChain({ organizationId, startSequence });
        } catch (error) {
            // Isolate per-tenant failures — a DB blip verifying one chain must
            // not abort the sweep for the others. Record + alert, keep going.
            console.error('[AUDIT_CHAIN_ALERT] chain verification errored', {
                organizationId,
                startSequence,
                endSequence: tail,
                error: error?.message || String(error),
            });
            summary.orgs.push({
                organizationId,
                startSequence,
                endSequence: tail,
                verified: null,
                error: error?.message || String(error),
            });
            continue;
        }

        const orgResult = {
            organizationId,
            startSequence,
            endSequence: tail,
            verified: result.verified,
            linkMismatches: result.linkMismatches,
            hashMismatches: result.hashMismatches,
        };
        summary.orgs.push(orgResult);

        if (!result.verified) {
            summary.breaksFound += result.corruptedLogs.length;
            // ALERT — an append-only audit row was mutated/broken. Compliance
            // incident (ISO 27799 §7.10; Thai e-Transactions Act §12/§26).
            // Emit loudly with the tenant + a bounded sample of corrupted rows.
            console.error('[AUDIT_CHAIN_ALERT] audit hash-chain integrity break detected', {
                organizationId,
                startSequence,
                endSequence: tail,
                linkMismatches: result.linkMismatches,
                hashMismatches: result.hashMismatches,
                corruptedLogs: result.corruptedLogs.slice(0, 20),
            });
        }
    }

    // Report the baseline so ops can see the sweep is scoped to v2-forward.
    // A clean run stays at info (no cry-wolf); a REAL break at/above the baseline
    // is still surfaced loudly above via [AUDIT_CHAIN_ALERT] + this error line.
    const baselineNote = baseline > 0 ? ` from baseline seq ${baseline}` : '';
    if (summary.breaksFound === 0) {
        console.info(`[AuditChainVerify] Verified ${summary.orgsChecked} tenant chain(s)${baselineNote}; no breaks.`);
    } else {
        console.error(
            `[AuditChainVerify] ${summary.breaksFound} break(s) across ${summary.orgsChecked} tenant chain(s)${baselineNote}.`,
        );
    }

    return summary;
}

// Removed (2026-06-08, dead-code cleanup): getUserActivity() — legacy reader
// filtering AuditLog on the non-existent `userId` column (canonical model uses
// `actorId`); 0 callers, would have thrown on use.

/**
 * Get statistics for audit logs
 */
async function getAuditStats(days = 7) {
    const startDate = new Date();
    startDate.setTime(startDate.getTime() - days * 24 * 60 * 60 * 1000); // instant arithmetic, no calendar read

    const [
        totalLogs,
        actionCounts,
        severityCounts,
    ] = await Promise.all([
        prisma.auditLog.count({
            where: { createdAt: { gte: startDate } },
        }),
        prisma.auditLog.groupBy({
            by: ['action'],
            where: { createdAt: { gte: startDate } },
            _count: true,
        }),
        prisma.auditLog.groupBy({
            by: ['severity'],
            where: { createdAt: { gte: startDate } },
            _count: true,
        }),
    ]);

    return {
        period: `${days} days`,
        total: totalLogs,
        byAction: actionCounts.reduce((acc, { action, _count }) => {
            acc[action] = _count;
            return acc;
        }, {}),
        bySeverity: severityCounts.reduce((acc, { severity, _count }) => {
            acc[severity] = _count;
            return acc;
        }, {}),
    };
}

module.exports = {
    logAction,
    logFromRequest,
    getAuditStats,
    // Canonical read-path helpers (handlers must use these instead of
    // calling prisma.auditLog.findMany/count directly).
    listAuditEvents,
    exportAuditEvents,
    getTimelineForApplication,
    // Iter 28 admin-tooling audit-log filters.
    buildAdminFilterWhere,
    queryWithFilters,
    ADMIN_FILTER_VALID_CATEGORIES,
    // Payment audit-trail (B15-B, 2026-05-16). Hash-chain integrity is
    // verified on read — see verifyHashChain comment for legal basis.
    getPaymentAuditTrail,
    verifyHashChain,
    // Periodic hash-chain integrity sweep (audit gap #14 (B)) — wired into the
    // node-cron scheduler (jobs/scheduler.js). Alerts on any tenant chain break.
    runScheduledChainVerification,
    PAYMENT_AUDIT_ACTIONS,
    PAYMENT_TRAIL_COLUMNS,
    VIEWER_DEFAULT_COLUMNS,
    TIMELINE_DEFAULT_COLUMNS,
    ACTIONS,
    ENTITIES,
    SEVERITY,
};
