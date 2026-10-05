/**
 * Document Service
 *
 * Canonical home for SOP documents, document templates, report submissions,
 * and the read-side of draft documents embedded in Application.formData.
 * Built for Batch 15 of the prisma-bypass cleanup (2026-05-16) to replace
 * direct prisma access in:
 *
 *   - routes/api/documents/sop-documents.js
 *   - routes/api/documents/templates.js
 *   - routes/api/documents/report-submissions.js
 *   - routes/api/documents/documents.js (read-side over Application.formData)
 *
 * Service-boundary invariants:
 *   - `isDeleted: false` is enforced for every read on a soft-deletable
 *     model (SOPDocument, ReportSubmission, Certificate, Application).
 *   - Ownership predicate (`userId` for citizen-facing documents,
 *     `certificateId` ownership chain for submissions) is enforced here
 *     so a route bug cannot widen the filter.
 *   - DocumentTemplate is global config — no ownership predicate, but
 *     reads default to `status: 'ACTIVE'` unless the caller asks
 *     otherwise (template versions listing path).
 */

const { prisma } = require('./prisma-database');

// holder-access is required lazily (it loads farm-access and the permission engine).
const holderAccess = () => require('./holder-access');
const isHolderScope = (scope) => Boolean(scope) && typeof scope === 'object' && Array.isArray(scope.readIds);

class DocumentService {
    // ─────────────────────────────────────────────────────────────────────
    // SOPDocument
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/documents/sop-documents.js:31 prisma.sOPDocument.findMany
     */
    async listSopDocumentsForUser(userId) {
        return prisma.sOPDocument.findMany({
            where: { userId, isDeleted: false },
            orderBy: { updatedAt: 'desc' },
        });
    }

    /**
     * Replaces routes/api/documents/sop-documents.js:49 prisma.sOPDocument.findFirst
     */
    async findSopDocumentForUser(id, userId) {
        return prisma.sOPDocument.findFirst({
            where: { id, userId, isDeleted: false },
        });
    }

    /**
     * Replaces routes/api/documents/sop-documents.js:73 prisma.sOPDocument.create
     */
    async createSopDocument({ userId, sopType, title, formData }) {
        return prisma.sOPDocument.create({
            data: {
                userId,
                sopType,
                title,
                formData: formData || {},
                status: 'DRAFT',
            },
        });
    }

    /**
     * Replaces routes/api/documents/sop-documents.js:115 prisma.sOPDocument.update
     */
    async updateSopDocument(id, updateData) {
        return prisma.sOPDocument.update({
            where: { id },
            data: updateData,
        });
    }

    /**
     * Replaces routes/api/documents/sop-documents.js:139 prisma.sOPDocument.update
     * (soft delete)
     */
    async softDeleteSopDocument(id) {
        return prisma.sOPDocument.update({
            where: { id },
            data: { isDeleted: true, deletedAt: new Date() },
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // DocumentTemplate (global registry)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/documents/templates.js:38 prisma.documentTemplate.findMany
     * Lists ACTIVE templates, ordered for the "latest version per code" rollup.
     */
    async listActiveTemplates() {
        return prisma.documentTemplate.findMany({
            where: { status: 'ACTIVE' },
            orderBy: [{ code: 'asc' }, { version: 'desc' }],
            select: {
                id: true,
                code: true,
                version: true,
                titleTH: true,
                titleEN: true,
                description: true,
                status: true,
                effectiveDate: true,
                paperSize: true,
                orientation: true,
                createdAt: true,
            },
        });
    }

    /**
     * Replaces routes/api/documents/templates.js:87 prisma.documentTemplate.findFirst
     * Get the latest ACTIVE template by code (optionally a specific version).
     */
    async findActiveTemplateByCode(code, version) {
        const where = { code, status: 'ACTIVE' };
        if (version !== undefined && version !== null && version !== '') {
            where.version = parseInt(version, 10);
        }
        return prisma.documentTemplate.findFirst({
            where,
            orderBy: { version: 'desc' },
        });
    }

    /**
     * Replaces routes/api/documents/templates.js:114 prisma.documentTemplate.findMany
     * All versions for a given code, newest first.
     */
    async listTemplateVersions(code) {
        return prisma.documentTemplate.findMany({
            where: { code },
            orderBy: { version: 'desc' },
            select: {
                id: true,
                code: true,
                version: true,
                titleTH: true,
                status: true,
                effectiveDate: true,
                retiredDate: true,
                createdAt: true,
                createdBy: true,
            },
        });
    }

    /**
     * Replaces routes/api/documents/templates.js:163 prisma.documentTemplate.findFirst
     * Find latest version (any status) — used to compute next version number
     * during create.
     */
    async findLatestTemplateVersion(code) {
        return prisma.documentTemplate.findFirst({
            where: { code },
            orderBy: { version: 'desc' },
        });
    }

    /**
     * Replaces routes/api/documents/templates.js:172 prisma.documentTemplate.updateMany
     * Deprecate all currently-ACTIVE rows for a code (called when creating a
     * new active version so only one ACTIVE exists per code).
     */
    async deprecateActiveTemplatesForCode(code) {
        return prisma.documentTemplate.updateMany({
            where: { code, status: 'ACTIVE' },
            data: { status: 'DEPRECATED', retiredDate: new Date() },
        });
    }

    /**
     * Replaces routes/api/documents/templates.js:178 prisma.documentTemplate.create
     */
    async createTemplate(data) {
        return prisma.documentTemplate.create({ data });
    }

    /**
     * Replaces routes/api/documents/templates.js:224 prisma.documentTemplate.update
     */
    async updateTemplate(id, data) {
        return prisma.documentTemplate.update({
            where: { id },
            data,
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // ReportSubmission (PT27 / PT28 / PT29 / PT30 / PT31 / PT32)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/documents/report-submissions.js:108 prisma.certificate.findMany
     * Active certificates owned by a user, used as the source set for the
     * report schedule.
     */
    async listActiveCertificatesForUser(scope) {
        // Spec 2026-09-30 §3.1: the certificates of the caller's holders.
        // No scope fails closed (no query).
        if (!isHolderScope(scope)) { return []; }
        return prisma.certificate.findMany({
            where: {
                ...holderAccess().holderReadWhere(scope, 'Certificate'),
                status: 'active',
                isDeleted: false,
            },
            select: {
                id: true,
                certificateNumber: true,
                farmName: true,
                cropType: true,
                issuedDate: true,
                expiryDate: true,
            },
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:141 prisma.reportSubmission.findMany
     * All submissions for a user in a specific Thai Buddhist year.
     */
    async listReportSubmissionsForUserYear(userId, reportYear) {
        return prisma.reportSubmission.findMany({
            where: {
                userId,
                reportYear,
                isDeleted: false,
            },
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:225-242
     * prisma.reportSubmission.findMany + prisma.reportSubmission.count
     */
    async listReportSubmissionsForUser({ userId, certificateId, reportType, year, status, page = 1, limit = 20 }) {
        const where = { userId, isDeleted: false };
        if (certificateId) { where.certificateId = certificateId; }
        if (reportType) { where.reportType = reportType; }
        if (year) { where.reportYear = parseInt(year, 10); }
        if (status) { where.status = status; }

        const [items, total] = await Promise.all([
            prisma.reportSubmission.findMany({
                where,
                orderBy: [{ reportYear: 'desc' }, { reportMonth: 'desc' }],
                skip: (parseInt(page, 10) - 1) * parseInt(limit, 10),
                take: parseInt(limit, 10),
                include: {
                    certificate: {
                        select: {
                            certificateNumber: true,
                            farmName: true,
                            cropType: true,
                        },
                    },
                },
            }),
            prisma.reportSubmission.count({ where }),
        ]);
        return { items, total };
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:265 prisma.reportSubmission.findFirst
     */
    async findReportSubmissionForUser(id, userId) {
        return prisma.reportSubmission.findFirst({
            where: { id, userId, isDeleted: false },
            include: {
                certificate: {
                    select: {
                        certificateNumber: true,
                        farmName: true,
                        cropType: true,
                    },
                },
            },
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:325 prisma.certificate.findFirst
     * Confirms a certificate belongs to the caller before accepting a report.
     */
    async findCertificateForUser(certificateId, scope) {
        if (!certificateId || !isHolderScope(scope)) { return null; }
        return prisma.certificate.findFirst({
            where: {
                id: certificateId,
                ...holderAccess().holderReadWhere(scope, 'Certificate'),
                isDeleted: false,
            },
            // The holder, so the report door can ask whether the caller may act for it.
            include: { application: { select: { entityId: true } } },
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:334 prisma.reportSubmission.findUnique
     * Duplicate-period check before inserting a new ReportSubmission row.
     */
    async findReportSubmissionByPeriod({ certificateId, reportType, reportMonth, reportYear }) {
        return prisma.reportSubmission.findUnique({
            where: {
                certificateId_reportType_reportMonth_reportYear: {
                    certificateId,
                    reportType,
                    reportMonth: parseInt(reportMonth, 10),
                    reportYear: parseInt(reportYear, 10),
                },
            },
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:355 prisma.reportSubmission.create
     */
    async createReportSubmission(data) {
        return prisma.reportSubmission.create({ data });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:408 prisma.reportSubmission.findFirst
     * Owner-scoped lookup used before update + delete.
     */
    async findOwnedReportSubmissionDraft(id, userId) {
        return prisma.reportSubmission.findFirst({
            where: { id, userId, isDeleted: false },
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:433 prisma.reportSubmission.update
     */
    async updateReportSubmission(id, data) {
        return prisma.reportSubmission.update({
            where: { id },
            data,
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:503 prisma.reportSubmission.update
     * Provider review path — status + reviewer fields only.
     */
    async reviewReportSubmission(id, { status, reviewedBy, reviewNote }) {
        return prisma.reportSubmission.update({
            where: { id },
            data: {
                status,
                reviewedAt: new Date(),
                reviewedBy,
                reviewNote: reviewNote || null,
            },
        });
    }

    /**
     * Replaces routes/api/documents/report-submissions.js:542 prisma.reportSubmission.update
     * Soft delete.
     */
    async softDeleteReportSubmission(id) {
        return prisma.reportSubmission.update({
            where: { id },
            data: { isDeleted: true, deletedAt: new Date() },
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Application.formData draftDocuments view (read-only)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/documents/documents.js:39 prisma.application.findMany
     * Listing of an applicant's recent applications with formData so the
     * route can flatten embedded draftDocuments. Owner-scoped + soft-delete
     * filtered at the service boundary.
     *
     * Detokenize STAGE A (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md,
     * breaker 3c): Application.healthId is an FK to User.canonicalId and stores
     * the keyed-HMAC TOKEN once APP_FK_USE_TOKEN is on (LIVE on prod
     * 2026-06-29). The old `(healthId)` signature was fed req.user.healthId —
     * the DECRYPTED PLAINTEXT national ID — which never matches the token, so
     * every applicant's document list came back empty. The scope now prefers
     * the `applicant: { id: userId }` relation join (User.id is a UUID that is
     * never re-keyed → correct in BOTH data states); the healthId fallback is
     * for callers holding the live FK key (canonicalId), NEVER the plaintext.
     * Empty scope fails closed (no broad query — matches the user-lookup
     * discipline).
     *
     * @param {{ userId?: string, healthId?: string }} scope
     */
    async listApplicantApplicationsForDraftDocs(scope = {}) {
        const userId = String((scope && scope.userId) || '').trim();
        const fkHealthId = String((scope && scope.healthId) || '').trim();
        const ownershipWhere = userId
            ? { applicant: { id: userId } }
            : (fkHealthId ? { healthId: fkHealthId } : null);
        if (!ownershipWhere) {
            return [];
        }
        // A health door passes its holder scope: the filings of the caller's holders
        // (spec 2026-09-30 §3.1). A caller with none keeps the ownership where.
        const holderScope = scope && scope.holderScope;
        const rowsWhere = holderScope && Array.isArray(holderScope.readIds)
            ? require('./holder-access').holderReadWhere(holderScope, 'Application')
            : ownershipWhere;
        return prisma.application.findMany({
            where: {
                ...rowsWhere,
                isDeleted: false,
            },
            select: {
                id: true,
                applicationNumber: true,
                formData: true,
            },
            take: 20,
            orderBy: { updatedAt: 'desc' },
        });
    }

    /**
     * BUG B — single draft-document detail for an applicant.
     *
     * A "document" is a draftDocuments[] entry embedded in Application.formData.
     * Ownership is enforced HERE by only ever scanning the caller's own
     * (owner-scoped, non-deleted) applications, so a cross-owner id is simply
     * absent → the route returns 404 (anti-IDOR — mirrors the list route scope
     * EXACTLY, no new scope invented). Returns null when not found.
     *
     * @param {{ userId?: string, healthId?: string }} scope — same STAGE-A
     *   token-safe ownership scope as listApplicantApplicationsForDraftDocs
     *   (relation join on User.id preferred; healthId = the FK token, never
     *   the plaintext national ID). Empty scope → null (fail-closed).
     */
    async findApplicantDraftDocument(scope, documentId) {
        const hasScope = Boolean(
            String((scope && scope.userId) || '').trim()
            || String((scope && scope.healthId) || '').trim(),
        );
        if (!hasScope || !documentId) { return null; }
        const applications = await this.listApplicantApplicationsForDraftDocs(scope);
        for (const app of applications) {
            const formData = app.formData && typeof app.formData === 'object' ? app.formData : {};
            const draftDocs = Array.isArray(formData.draftDocuments) ? formData.draftDocuments : [];
            for (const doc of draftDocs) {
                const id = doc.documentId || doc.id;
                if (id && String(id) === String(documentId)) {
                    return {
                        id,
                        fileName: doc.fileName || null,
                        fileUrl: doc.fileUrl || null,
                        documentType: doc.stepKey || 'application',
                        mimeType: doc.mimeType || null,
                        size: typeof doc.size === 'number' ? doc.size : null,
                        applicationId: app.id,
                        applicationNumber: app.applicationNumber,
                        uploadedAt: doc.uploadedAt || null,
                    };
                }
            }
        }
        return null;
    }
}

module.exports = new DocumentService();
