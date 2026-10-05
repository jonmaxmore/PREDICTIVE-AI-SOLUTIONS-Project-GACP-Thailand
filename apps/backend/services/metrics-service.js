const { prisma } = require('./prisma-database');
const { Prisma } = require('@prisma/client');
const logger = require('../shared/logger');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');

// Every users.role spelling for an applicant, in BOTH the legacy casing and the
// canonical one, so this query is correct on either side of migration
// 20260801000000_canonicalize_user_role. An uppercase-only filter would
// match nothing post-migration and fail silently, as an empty result.
const APPLICANT_ROLES = Object.freeze([CANONICAL_ROLES.HEALTH]);

class MetricsService {
    // #8 tenancy: the dashboard groupBy + $queryRaw are NOT scoped by the
    // tenant-prisma-extension (Prisma 5.22 doesn't intercept aggregate/groupBy in
    // $allModels query extensions, and $queryRaw bypasses it entirely), so they
    // leaked global byStatus/monthlyTrend/etc. to a tenant admin. These methods
    // now take an optional orgId and scope every read when it's provided
    // (backward-compat: no orgId → global, e.g. platform-admin/legacy callers).
    /**
     * Get Main Dashboard Statistics
     */
    async getDashboardStats(orgId = null) {
        try {
            const [
                totalApplications,
                statusGroups,
                plantGroups,
                provinceGroups,
                monthlyTrend,
            ] = await Promise.all([
                this.getTotalApplications(orgId),
                this.getStatusDistribution(orgId),
                this.getPlantTypeDistribution(orgId),
                this.getProvinceDistribution(orgId),
                this.getMonthlyTrend(orgId),
            ]);

            // Process Status Groups
            const byStatus = {};
            let pendingReview = 0;
            let pendingAudit = 0;
            let approved = 0;
            let rejected = 0;

            statusGroups.forEach(g => {
                const s = g.status;
                const c = g._count.status;
                byStatus[s] = c;

                // UAT gap: these buckets used non-canonical status names
                // (DOCUMENT_CHECKING / PAYMENT_1_PENDING / AUDIT_SCHEDULED …) that
                // never match a real Application.status, so pendingReview
                // undercounted and pendingAudit was hard-coded 0. Mapped to the
                // canonical WORKFLOW_STATES, split at DOC_APPROVED (doc-review
                // pipeline vs audit pipeline).
                if (['SUBMITTED', 'PENDING_DOC_FEE', 'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED'].includes(s)) { pendingReview += c; }
                if (['DOC_APPROVED', 'PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID', 'AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING'].includes(s)) { pendingAudit += c; }
                if (s === 'APPROVED') { approved += c; }
                if (s === 'REJECTED') { rejected += c; }
            });

            return {
                overview: {
                    totalApplications,
                    pendingReview,
                    pendingAudit, // now surfaced (was hard-coded 0) — canonical buckets above
                    approved,
                    rejected,
                },
                byStatus,
                byPlantType: plantGroups,
                byProvince: provinceGroups,
                monthlyTrend,
            };

        } catch (error) {
            logger.error('[Metrics] Failed to aggregate stats:', error);
            throw error;
        }
    }

    async getTotalApplications(orgId = null) {
        return await prisma.application.count({
            where: { isDeleted: false, ...(orgId ? { organizationId: orgId } : {}) },
        });
    }

    async getStatusDistribution(orgId = null) {
        return await prisma.application.groupBy({
            by: ['status'],
            _count: { status: true },
            where: { isDeleted: false, ...(orgId ? { organizationId: orgId } : {}) },
        });
    }

    async getPlantTypeDistribution(orgId = null) {
        // PostgreSQL JSON extraction
        // Assuming formData -> plantId
        try {
            const orgClause = orgId ? Prisma.sql`AND "organizationId" = ${orgId}` : Prisma.empty;
            const result = await prisma.$queryRaw`
                SELECT "formData"->>'plantId' as name, COUNT(*) as count
                FROM applications
                WHERE "isDeleted" = false AND "formData"->>'plantId' IS NOT NULL ${orgClause}
                GROUP BY "formData"->>'plantId'
                ORDER BY count DESC
                LIMIT 5;
            `;

            // Convert BigInt to Number if needed (Prisma returns BigInt for count)
            const map = {};
            result.forEach(r => {
                const count = Number(r.count);
                if (r.name) { map[r.name] = count; }
            });
            return map;
        } catch (e) {
            logger.warn('[Metrics] Plant stats failed (JSON query), returning empty:', e.message);
            return {};
        }
    }

    async getProvinceDistribution(orgId = null) {
        // Try getting province from User/HEALTH_USER for stability
        try {
            const orgClause = orgId ? Prisma.sql`AND a."organizationId" = ${orgId}` : Prisma.empty;
            // Detokenize STAGE 0 (RFC breaker 1, data-state-agnostic): the FK is
            // applications.healthId -> users.canonicalId. The old join on
            // u."healthId" only worked because canonicalId == healthId TODAY; it
            // breaks the moment the STAGE-A re-key sets canonicalId to the token
            // (applications.healthId follows via cascade, users.healthId does
            // NOT). Joining on canonicalId is correct in BOTH data states.
            const result = await prisma.$queryRaw`
                SELECT u.province as name, COUNT(a.id) as count
                FROM applications a
                JOIN users u ON a."healthId" = u."canonicalId"
                WHERE a."isDeleted" = false AND u.province IS NOT NULL ${orgClause}
                GROUP BY u.province
                ORDER BY count DESC
                LIMIT 5;
            `;

            const map = {};
            result.forEach(r => {
                const count = Number(r.count);
                if (r.name) { map[r.name] = count; }
            });
            return map;
        } catch (e) {
            logger.warn('[Metrics] Province stats failed:', e.message);
            return {};
        }
    }

    async getMonthlyTrend(orgId = null) {
        // Last 12 months
        try {
            const orgClause = orgId ? Prisma.sql`AND "organizationId" = ${orgId}` : Prisma.empty;
            const result = await prisma.$queryRaw`
                SELECT
                    TO_CHAR("createdAt", 'MM') as month,
                    COUNT(*) as applications,
                    SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved
                FROM applications
                WHERE "isDeleted" = false
                  AND "createdAt" > NOW() - INTERVAL '1 year' ${orgClause}
                GROUP BY TO_CHAR("createdAt", 'MM')
                ORDER BY month ASC;
            `;

            return result.map(r => ({
                month: Number(r.month),
                applications: Number(r.applications),
                approved: Number(r.approved),
            }));
        } catch (e) {
            logger.warn('[Metrics] Monthly Trend failed:', e.message);
            return [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Reports cluster (provider dashboard route /api/reports/*)
    //
    // Batch 15 (2026-05-16): the per-route /reports/farms,
    // /reports/applications and /reports/analytics aggregations used to
    // issue direct prisma calls from the route handler. They now go
    // through these methods so the soft-delete / aggregate-only column
    // surface is enforced in one place.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/documents/reports.js:70 prisma.farm.count
     */
    async countActiveFarms(orgId = null) {
        // groupBy/aggregate/count are NOT auto-scoped by the tenant extension
        // (it hooks findMany/findFirst/count only when TENANT_READ_ORG_SCOPE is on,
        // and never groupBy) — scope per-call-site like #382 getDashboardStats.
        return prisma.farm.count({ where: { isDeleted: false, ...(orgId ? { organizationId: orgId } : {}) } });
    }

    /**
     * Replaces routes/api/documents/reports.js:71 prisma.farm.groupBy
     */
    async groupFarmsByProvince({ take, orgId = null } = {}) {
        return prisma.farm.groupBy({
            by: ['province'],
            where: { isDeleted: false, ...(orgId ? { organizationId: orgId } : {}) },
            _count: { province: true },
            orderBy: { _count: { province: 'desc' } },
            ...(take ? { take } : {}),
        });
    }

    /**
     * Replaces routes/api/documents/reports.js:112 prisma.application.groupBy
     */
    async groupApplicationsByStatus(orgId = null) {
        return prisma.application.groupBy({
            by: ['status'],
            where: { ...(orgId ? { organizationId: orgId } : {}) },
            _count: { status: true },
        });
    }

    /**
     * Replaces routes/api/documents/reports.js:152-200 (analytics fan-out).
     * Returns the five aggregated reads the analytics endpoint needs in a
     * single Promise.all so callers don't have to remember the soft-delete
     * + role-scope predicates per query.
     */
    async getAnalyticsAggregates({ prevStart, now, orgId = null }) {
        // #8 tenancy: org-scope the org-owned models. groupBy/aggregate/count are NOT
        // auto-scoped by the tenant extension, so scope per-call-site (same class as
        // #382/#394). User (HEALTH applicants) has NO organizationId → left global by
        // design. null orgId (e.g. PLATFORM_ADMIN) = cross-tenant totals.
        const orgFilter = orgId ? { organizationId: orgId } : {};
        const [applicationsWindow, invoicesWindow, applicantsWindow, activeCertificates, farmsByProvince] = await Promise.all([
            prisma.application.findMany({
                where: {
                    isDeleted: false,
                    ...orgFilter,
                    createdAt: { gte: prevStart, lte: now },
                },
                select: {
                    createdAt: true,
                    updatedAt: true,
                    scheduledDate: true,
                    status: true,
                    serviceType: true,
                    areaType: true,
                },
            }),
            prisma.invoice.findMany({
                where: {
                    isDeleted: false,
                    ...orgFilter,
                    createdAt: { gte: prevStart, lte: now },
                },
                select: {
                    createdAt: true,
                    status: true,
                    totalAmount: true,
                },
            }),
            prisma.user.findMany({
                where: {
                    isDeleted: false,
                    createdAt: { gte: prevStart, lte: now },
                    role: { in: [...APPLICANT_ROLES] },
                },
                select: {
                    createdAt: true,
                },
            }),
            prisma.certificate.count({
                where: {
                    // Certificate.status is stored lowercase ('active' — schema
                    // @default); 'ACTIVE' matched 0 rows so activeCertificates
                    // always read 0 (UAT case-mismatch gap).
                    status: 'active',
                    ...orgFilter,
                    expiryDate: { gt: now },
                },
            }),
            prisma.farm.groupBy({
                by: ['province'],
                where: { isDeleted: false, ...orgFilter },
                _count: { province: true },
                orderBy: { _count: { province: 'desc' } },
                take: 5,
            }),
        ]);

        return { applicationsWindow, invoicesWindow, applicantsWindow, activeCertificates, farmsByProvince };
    }

    /**
     * Replaces routes/api/documents/reports.js:242 prisma.user.count
     * Soft-deleted health users are excluded.
     */
    async countActiveHealthApplicants() {
        return prisma.user.count({
            where: {
                isDeleted: false,
                role: { in: [...APPLICANT_ROLES] },
            },
        });
    }
}

module.exports = new MetricsService();
