/**
 * Trace Service — Extracted from routes/api/trace.js
 *
 * Contains all database queries and response-building logic
 * for the public traceability API.
 *
 * Route file (trace.js) should only handle HTTP concerns:
 *   request parsing → call service → send response
 */
// Use server singleton first; fallback to prisma-database service (shared singleton)
const prisma = require('../../server').prisma || require('../prisma-database').prisma;
const qrcodeService = require('../qrcode/qrcode-service');
const { traceBaseUrl } = require('../../config/public-urls');
const { getRequestIp } = require('../../utils/client-ip');
const crypto = require('crypto');

// ─── Constants ──────────────────────────────────────────────
// PR-1.8 wrote this guard first and gave the reason: production must provide the
// trace URL explicitly, because falling back to a written-down domain silently
// sends staging-issued QR codes to the production verify domain. The guard is
// unchanged; it just lives in config/public-urls now, so the five other services
// that had NO such guard get it too, and the domain is written down once.
const TRACE_BASE_URL = traceBaseUrl();
const PLOT_HARVEST_META_PREFIX = 'PLOT_HARVEST_META:';
const TRACE_NOT_FOUND_MESSAGE = 'ไม่พบข้อมูล Trace สำหรับรหัสนี้ในระบบ';

const FDA_REFERRAL = {
    name: 'Thai Food and Drug Administration (FDA Thailand)',
    nameEN: 'Thai Food and Drug Administration (FDA)',
    phone: '1556',
    website: 'https://www.fda.moph.go.th',
    scopeNote: 'สำหรับข้อมูลด้านความปลอดภัย ผลข้างเคียง หรืออันตรกิริยาระหว่างยา กรุณาติดต่อ อย.',
    scopeNoteEN: 'For safety information, adverse effects, or drug interactions, please contact FDA.',
};

const SAFETY_DISCLAIMER = {
    medicalAdvice: 'This system provides GACP certification and traceability information only.',
    medicalAdviceEN: 'This system provides GACP certification and traceability information only.',
    dtamScope: 'DTAM certifies agricultural practices (GACP) only, not medical safety.',
    dtamScopeEN: 'DTAM certifies agricultural practices (GACP) only, not medical safety.',
    reportAdverse: 'If you experience adverse effects, report to FDA at 1556 or via the Yellow Card system.',
    reportAdverseEN: 'If you experience adverse effects, please report to FDA at 1556 or via Yellow Card system.',
};

const { createLogger } = require('../../shared/logger');
const { DEFAULT_TIME_ZONE } = require('../../utils/working-days');
const logger = createLogger('trace-service');

// ─── Helpers ────────────────────────────────────────────────

function formatCultivationType(type) {
    const map = {
        'OUTDOOR': 'กลางแจ้ง (Outdoor)',
        'GREENHOUSE': 'โรงเรือน (Greenhouse)',
        'INDOOR': 'อินดอร์/ระบบปิด (Indoor)',
        'MIXED': 'ผสมผสาน (Mixed)',
        'outdoor': 'กลางแจ้ง (Outdoor)',
        'greenhouse': 'โรงเรือน (Greenhouse)',
        'indoor': 'อินดอร์/ระบบปิด (Indoor)',
    };
    return map[type] || type || 'ไม่ระบุ';
}

function formatThaiDate(date) {
    if (!date) { return null; }
    try {
        const d = new Date(date);
        return d.toLocaleDateString('th-TH', {
            timeZone: DEFAULT_TIME_ZONE,
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    } catch (_e) {
        return null;
    }
}
// generateQRCodeString(prefix) lived here — `TR-<base36 time>-<8 hex>`, with CY
// and BT variants. Removed 2026-09-05 (operator: "รวมเป็น uuid อย่างเดียว"): the
// time component narrowed a guess to whatever was created in that second, which
// is a weaker public address than the UUID the rest of the trace stack mints,
// for no gain. Verified against the real database first — no row carried one.

function parseJsonMetaFromNotes(notes, prefix) {
    if (!notes || typeof notes !== 'string') { return null; }
    const idx = notes.indexOf(prefix);
    if (idx === -1) { return null; }
    const jsonStr = notes.substring(idx + prefix.length).trim();
    try {
        const parsed = JSON.parse(jsonStr);
        return typeof parsed === 'object' ? parsed : null;
    } catch (_e) {
        return null;
    }
}

function normalizeSourceFromPayload(payload) {
    const defaults = {
        farm: { farmId: null, farmName: null },
        cycle: { cycleId: null, cycleName: null },
        plot: { cyclePlotId: null, plotId: null, plotName: null },
    };
    if (!payload) { return defaults; }
    try {
        const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
        return {
            farm: { ...defaults.farm, ...(p.farm || {}) },
            cycle: { ...defaults.cycle, ...(p.cycle || {}) },
            plot: { ...defaults.plot, ...(p.plot || {}) },
        };
    } catch (_e) {
        return defaults;
    }
}

// H2: fail-CLOSED. `valid` is true ONLY when the integrity check was actually
// available AND returned a true verdict. A null/undefined result, an
// unavailable result, or a result whose `valid` is null/false → valid:false.
// A genuinely-sealed entity always returns `valid` as a real boolean, so this
// never breaks a legit sealed entity — it only closes the fail-open hole where
// an unconfirmable result was reported to a public scanner as "QR code verified".
function buildIntegrityPayload(result) {
    const sealed = !!result && result.available === true && result.valid === true;
    if (!result || result.available !== true) {
        return {
            available: false,
            valid: false,
            scanCount: (result && result.scanCount) || 0,
            firstScan: null,
            lastScan: null,
            message: 'QR code not sealed / integrity unavailable',
        };
    }
    return {
        available: true,
        valid: sealed,
        scanCount: result.scanCount || 1,
        firstScan: result.firstScan || null,
        lastScan: result.lastScan || null,
        message: sealed ? 'QR code verified' : 'QR code integrity check failed',
    };
}

async function logPublicTraceAccess(req, entityType, entityId, metadata = {}) {
    try {
        // Route through the canonical audit-logger instead of writing
        // directly to prisma.auditLog. The previous direct create was
        // doubly broken:
        //   1. Missing organizationId (NOT NULL in schema) — public trace
        //      route has no tenant context, the tenant-prisma-extension
        //      can't inject. Same root cause as PRs #199 and #200.
        //   2. Missing hash-chain fields (logId, sequenceNumber,
        //      previousHash, currentHash, hashAlgorithm) AND using the
        //      wrong column names (entityType/entityId — the schema has
        //      resourceType/resourceId). Even with organizationId,
        //      Prisma would have rejected the payload for missing required
        //      columns.
        // The .catch silently swallowed both failures, so every public
        // trace access has been silently dropping its audit row since
        // forever. The canonical logger handles all of this — including
        // the default-org fallback added in PR #199 for unauthenticated
        // call sites.
        const { auditLogger, AuditCategory, AuditSeverity, ResourceType } =
            require('../../middleware/audit-logger');
        await auditLogger.log({
            category: AuditCategory.SYSTEM,
            action: 'PUBLIC_TRACE_ACCESS',
            severity: AuditSeverity.INFO,
            actorId: 'ANONYMOUS',
            actorRole: 'PUBLIC',
            actorType: 'SYSTEM',
            resourceType: ResourceType.SYSTEM,
            resourceId: String(entityId),
            ipAddress: getRequestIp(req),
            userAgent: req.get('user-agent') || 'unknown',
            metadata: {
                ...metadata,
                entityType,
                timestamp: new Date().toISOString(),
            },
        });
    } catch (_e) {
        logger.debug('Audit log skipped (table may not exist)');
    }
}

function buildStandardReferrals() {
    return {
        safety: FDA_REFERRAL,
        medicalEmergency: {
            phone: '1669',
            note: 'No additional note',
        },
    };
}

// ─── Core Query Functions ───────────────────────────────────

function buildCertificateSnapshot(cert) {
    if (!cert) { return null; }
    const isValid = cert.status === 'ACTIVE' && new Date(cert.expiryDate) > new Date();
    return {
        number: cert.certificateNumber,
        standard: cert.standardName || 'GACP',
        issuedDate: cert.issuedDate,
        issuedDateTH: formatThaiDate(cert.issuedDate),
        expiryDate: cert.expiryDate,
        expiryDateTH: formatThaiDate(cert.expiryDate),
        status: cert.status,
        isValid,
    };
}

function buildFarmSnapshot(farm) {
    if (!farm) { return null; }
    return {
        name: farm.farmName,
        type: farm.farmType,
        location: `${farm.district || ''}, ${farm.province || ''}`.replace(/^, |, $/g, ''),
    };
}

// H3: shared certificate gate. Single source of truth for "is this cert valid,
// and if not, what 410 body should the public trace surface return". Used by the
// generic resolver AND the dedicated batch/lot routes so the gate logic (incl.
// the LOWERCASE status casing fix — certs are stored 'active', not 'ACTIVE')
// lives in exactly one place.
//
//   gated === true ONLY when a cert EXISTS but is invalid (revoked/expired/etc).
//   A null cert (un-certified trace) is NOT gated → callers keep returning 200.
//
// minimalBody(type) returns the SAME shape the dedicated batch route's 410 body
// uses, so the generic resolver and the route stay byte-compatible.
function evaluateCertGate(cert) {
    const statusRaw = String(cert?.status || '').toUpperCase();
    const certExpired = !!cert?.expiryDate && new Date(cert.expiryDate) < new Date();
    const isValid = !!cert && statusRaw === 'ACTIVE' && !certExpired;
    const gated = !!cert && !isValid;
    const statusLower = statusRaw.toLowerCase() || 'invalid';
    return {
        gated,
        isValid,
        certExpired,
        status: statusLower,
        minimalBody(type) {
            return {
                success: false,
                type,
                verification: {
                    valid: false,
                    scannedAt: new Date().toISOString(),
                    reason: certExpired ? 'certificate_expired' : `certificate_${statusLower}`,
                },
                certificate: {
                    reference: cert.certificateNumber,
                    status: statusLower,
                    issuedDate: cert.issuedDate,
                    expiryDate: cert.expiryDate,
                },
                message: certExpired
                    ? 'ใบรับรองหมดอายุแล้ว / Certificate has expired'
                    : 'ใบรับรองไม่อยู่ในสถานะใช้งาน / Certificate is not active',
            };
        },
    };
}

// ─── Full Handler Logic: GET /plot-cycle/:qrCode ────────────

/**
 * Resolve trace data for a plot-cycle QR code.
 * Extracts full business logic from the route handler so that
 * routes/api/trace.js only handles HTTP concerns.
 *
 * @param {string} qrCode - The QR code to look up
 * @param {{ requestIp: string, userAgent: string, originalUrl: string }} ctx
 * @returns {Promise<{ status: number, body: object }>}
 */

module.exports = {
    prisma,
    qrcodeService,
    getRequestIp,
    logger,
    TRACE_BASE_URL,
    PLOT_HARVEST_META_PREFIX,
    TRACE_NOT_FOUND_MESSAGE,
    FDA_REFERRAL,
    SAFETY_DISCLAIMER,
    formatCultivationType,
    formatThaiDate,
    parseJsonMetaFromNotes,
    normalizeSourceFromPayload,
    buildIntegrityPayload,
    logPublicTraceAccess,
    buildStandardReferrals,
    buildCertificateSnapshot,
    buildFarmSnapshot,
    evaluateCertGate,
};
