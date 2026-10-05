/**
 * PDPA / GDPR — subject access + erasure for health users.
 *
 * Thai PDPA (Personal Data Protection Act, B.E. 2562/2019) gives data
 * subjects the right to:
 *   - Section 30: receive a copy of their personal data
 *   - Section 33: erasure / right to be forgotten
 *
 * The catch for GACP: certified applications, audit findings, and the
 * audit trail itself are regulated records. Once a certificate is
 * issued, DTAM keeps the underlying file for at least 5 years after the
 * certificate expires (`User.retainUntil` defaults to now + 5 years).
 * "Erasure" of those records is a regulated-records violation, not a
 * privacy compliance win — so the delete path soft-deletes the user
 * and pseudonymises the PII, but keeps the workflow records linked
 * to a tombstone.
 *
 * @module services/pdpa-service
 */

const bcrypt = require('bcryptjs');
const { prisma } = require('./prisma-database');
const { createLogger } = require('../shared/logger');
// S5: soft-deleting a user is a credential mutation — the epoch stamp evicts
// their live 12h JWT (siblings pdpa-erasure-service + pdpa-retention-job
// already stamp; this path was the odd one out).
const { sessionEpochStamp } = require('../utils/session-epoch');

const logger = createLogger('pdpa-service');

const PDPA_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Build a complete personal-data dump for the authenticated user.
 *
 * Returned shape is JSON-serializable so the route can stream it
 * straight to the client. Sensitive secrets (password hash, MFA secret,
 * password-reset token, hashed identifiers) are stripped — exporting
 * those would weaken the user's account, not give them their data.
 *
 * @param {string} userId
 * @returns {Promise<object>}
 */
/**
 * A PDPA export is the data SUBJECT's own data (s.30), keyed on the filer/owner
 * columns by law, not on the holder: it is the one health read the holder scope
 * does not decide. A health door's export registers that key for the read
 * witness (holder-access.dataSubjectReadWhere); a caller with no holder scope
 * (staff, jobs) reads by the same key, unregistered.
 */
function subjectOwnWhere(scope, model, where) {
    if (!scope || !Array.isArray(scope.readIds)) { return where; }
    return require('./holder-access').dataSubjectReadWhere(model, where);
}

async function assembleUserDataExport(userId, { holderScope = null } = {}) {
    if (!userId) {
        throw new Error('userId is required');
    }

    // Resolve identity first. The schema mixes two FK columns:
    //   * id          → ApplicationDraft, Certificate, Notification,
    //                   ReportSubmission, Farm.ownerId
    //   * canonicalId → Application, Invoice (via healthId column)
    // Fetching the user up front lets us hand each query the right key
    // and fail fast if the user disappeared between auth and export.
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            uuid: true,
            canonicalId: true,
            healthId: true,
            email: true,
            phoneNumber: true,
            firstName: true,
            lastName: true,
            accountType: true,
            role: true,
            authType: true,
            ministryVerified: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            privacySettings: true,
            notificationSettings: true,
            organizationId: true,
            // Soft-delete metadata so the user can see whether a prior
            // delete request is in flight.
            isDeleted: true,
            deletedAt: true,
            retainUntil: true,
            legalHold: true,
        },
    });

    if (!user) {
        throw new Error('User not found');
    }

    // PDPA Phase D defence-in-depth (Sprint 6 healthId-audit):
    // `user.canonicalId` is the FK target for Application.healthId / Invoice.healthId
    // (see schema/auth.prisma:30 — `canonicalId String @unique`). It is NOT the
    // same column as `User.healthId` (Thai national ID, scheduled for Phase 2
    // encryption per prisma-pdpa-extension docstring).
    //
    // The FK columns Application.healthId and Invoice.healthId reference
    // User.canonicalId and are NOT in PHASE_1_PII_COLUMNS — they are
    // plaintext-safe FK strings, kept as-is per Phase D scope. We pass
    // `canonicalId` here, NOT `user.healthId`, to make that explicit so
    // that the PDPA-export flow itself does not regress to a plaintext
    // healthId WHERE the moment Phase 2 encryption ships.
    //
    // Guard: if canonicalId is missing (data integrity bug — every user row
    // should have it), short-circuit the FK-keyed queries rather than emit
    // an open-ended findMany. Returning [] is safe: no Applications/Invoices
    // can exist that reference a missing canonicalId, by FK constraint.
    const fkKey = user.canonicalId;

    // Single round-trip per relation. We deliberately don't use prisma's
    // nested `include:` on the user record — for a heavy user (50 farms,
    // 200 audit-log rows) that explodes memory before serialisation.
    const [
        applications,
        drafts,
        farms,
        certificates,
        invoices,
        notifications,
        reportSubmissions,
    ] = await Promise.all([
        fkKey ? prisma.application.findMany({
            where: { ...subjectOwnWhere(holderScope, 'Application', { healthId: fkKey }), isDeleted: false },
            select: {
                id: true,
                applicationNumber: true,
                serviceType: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                formData: true,
                workflowHistory: true,
                entityId: true,
            },
        }) : Promise.resolve([]),
        prisma.applicationDraft.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                currentStep: true,
                formData: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                version: true,
            },
        }),
        prisma.farm.findMany({
            where: { ...subjectOwnWhere(holderScope, 'Farm', { ownerId: user.id }), isDeleted: false },
            select: {
                id: true,
                farmName: true,
                farmType: true,
                address: true,
                province: true,
                district: true,
                subDistrict: true,
                postalCode: true,
                latitude: true,
                longitude: true,
                totalArea: true,
                cultivationArea: true,
                areaUnit: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
        prisma.certificate.findMany({
            where: { ...subjectOwnWhere(holderScope, 'Certificate', { userId: user.id }), isDeleted: false },
            select: {
                id: true,
                certificateNumber: true,
                applicationId: true,
                farmName: true,
                applicantName: true,
                cropType: true,
                province: true,
                district: true,
                status: true,
                issuedDate: true,
                expiryDate: true,
            },
        }),
        fkKey ? prisma.invoice.findMany({
            where: { ...subjectOwnWhere(holderScope, 'Invoice', { healthId: fkKey }) },
            select: {
                id: true,
                invoiceNumber: true,
                serviceType: true,
                applicationId: true,
                createdAt: true,
                updatedAt: true,
            },
        }) : Promise.resolve([]),
        prisma.notification.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                type: true,
                category: true,
                title: true,
                message: true,
                isRead: true,
                // N6 — a subject-access export that says "read: true" without saying WHEN
                // withholds half the fact, and the stamp is the half that matters when a
                // deadline was counted from delivery. The column was always there.
                readAt: true,
                createdAt: true,
                metadata: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 500, // Cap export size; the user can request more separately.
        }),
        prisma.reportSubmission.findMany({
            where: { userId: user.id },
            select: {
                id: true,
                certificateId: true,
                reportType: true,
                reportMonth: true,
                reportYear: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
    ]);

    return {
        exportedAt: new Date().toISOString(),
        regulation: 'Thai PDPA Section 30 / GDPR Article 15',
        subject: user,
        applications,
        drafts,
        farms,
        certificates,
        invoices,
        notifications,
        reportSubmissions,
        notice: 'รายการข้อมูลบางส่วนอาจถูกระงับการลบไว้เนื่องจากเป็นเอกสารที่ต้องเก็บรักษาตามกฎหมาย ดูฟิลด์ subject.retainUntil',
    };
}

/**
 * Soft-delete the user. Returns shape:
 *   { ok: true, retainUntil: ISO-string, hardDeleteEligibleAt: ISO-string }
 *
 * Logic:
 *   - if legalHold is set → refuse with PDPA_LEGAL_HOLD
 *   - if retainUntil > now (regulatory record retention) → soft-delete the
 *     user (isDeleted=true) but keep retainUntil as-is; the row will be
 *     purged by the periodic retention sweep when retainUntil passes
 *   - otherwise → soft-delete with retainUntil = now + 30d grace period
 *
 * Workflow records (Application, Certificate, AuditLog) are NOT touched
 * by this function. They remain referenced by userId, which we keep on
 * the soft-deleted row so audit trails resolve. Future retention sweep
 * may pseudonymise the user (blank email/phone/name, keep id) once
 * retainUntil passes.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.password — current password, verified before deletion
 * @param {string} [args.reason] — user-supplied reason text
 * @param {string} [args.deletedByIp]
 * @returns {Promise<object>}
 */
async function softDeleteUser({ userId, password, reason }) {
    if (!userId) { throw new Error('userId is required'); }
    if (!password) {
        const err = new Error('Password confirmation required');
        err.code = 'PDPA_PASSWORD_REQUIRED';
        throw err;
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            password: true,
            isDeleted: true,
            legalHold: true,
            retainUntil: true,
        },
    });

    if (!user) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
    }
    if (user.isDeleted) {
        const err = new Error('Account is already scheduled for deletion');
        err.code = 'PDPA_ALREADY_DELETED';
        throw err;
    }
    if (user.legalHold) {
        const err = new Error('Account cannot be deleted while a legal hold is active. Contact DTAM compliance.');
        err.code = 'PDPA_LEGAL_HOLD';
        throw err;
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
        const err = new Error('Password does not match');
        err.code = 'INVALID_CREDENTIALS';
        throw err;
    }

    const now = new Date();
    const graceUntil = new Date(now.getTime() + PDPA_GRACE_PERIOD_MS);

    // Two retention regimes share this column:
    //   1. regulatory retention (default 5 years from registration) — keep as-is
    //   2. PDPA grace period (30 days) — used only when no regulatory hold
    //
    // We pick whichever is FURTHER in the future. A user with no certified
    // applications will have retainUntil ~ creation+5y; we keep that — the
    // row stays soft-deleted but the regulatory clock continues. Hard delete
    // becomes eligible when retainUntil passes (a separate sweep job, out
    // of scope for this PR).
    const existingRetainUntil = user.retainUntil ? new Date(user.retainUntil) : null;
    const nextRetainUntil = existingRetainUntil && existingRetainUntil > graceUntil
        ? existingRetainUntil
        : graceUntil;

    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            isDeleted: true,
            deletedAt: now,
            deletedBy: userId,
            deleteReason: reason ? String(reason).slice(0, 500) : 'PDPA Section 33 — user-initiated erasure',
            retainUntil: nextRetainUntil,
            // S5: evict the deleted user's live tokens immediately — without
            // this their 12h JWT kept working after their own erasure request.
            sessionsRevokedAt: sessionEpochStamp(),
        },
        select: {
            id: true,
            isDeleted: true,
            deletedAt: true,
            retainUntil: true,
        },
    });

    logger.info(`[PDPA] User ${userId} soft-deleted; retainUntil=${updated.retainUntil?.toISOString()}`);

    return {
        ok: true,
        userId: updated.id,
        deletedAt: updated.deletedAt?.toISOString(),
        retainUntil: updated.retainUntil?.toISOString(),
        hardDeleteEligibleAt: updated.retainUntil?.toISOString(),
        graceUntil: graceUntil.toISOString(),
    };
}

module.exports = {
    assembleUserDataExport,
    softDeleteUser,
    PDPA_GRACE_PERIOD_MS,
};
