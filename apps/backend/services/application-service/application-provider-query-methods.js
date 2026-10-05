const { reviewerQueueWhere } = require('./reviewer-queue-where');
/**
 * application-provider-query-methods
 *
 * Encapsulates the queries that provider-side route handlers (queue listing,
 * assign action, workflow transitions, scheduler) previously issued directly
 * against the Prisma client. Extracted during the batch 10 Prisma-bypass
 * cleanup so routes always go through the service layer.
 *
 * NOTE: The visibility predicate (auditor-restricted) is the caller's
 * responsibility — it is built via `withVisibility(...)` in the routes and
 * passed in as `where`. That is intentional: visibility depends on the
 * authenticated user and the helper that produces it lives in
 * `shared/application-visibility`. The service is a thin pass-through so
 * the projection and pagination defaults can be centralised.
 */

/** Rows fetched per reviewer-queue read. */
const REVIEWER_QUEUE_PAGE_SIZE = 200;

/** Ceiling on a single read, so a caller cannot ask for the table in one go. */
const REVIEWER_QUEUE_MAX_PAGE_SIZE = 500;

/**
 * Pages one drain will walk before giving up and saying so. At the default page
 * size that is 20,000 applications for a single reviewer — far past anything
 * real, and a bound rather than a silence if it is ever reached.
 */
const REVIEWER_QUEUE_MAX_PAGES = 100;

/**
 * A whole number above zero, or the fallback. Guards the drain against a
 * `pageSize` of 0 or NaN, which would make every page "short" or every page
 * empty and turn the loop into either a lie or a spin.
 */
function positiveIntOr(value, fallback, ceiling) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number) || number <= 0) {
        return fallback;
    }
    return Math.min(number, ceiling);
}

function createApplicationProviderQueryMethods({ prisma }) {
    return {
        /**
         * Provider queue listing. Caller supplies the visibility-filtered
         * `where` and the projection narrow `select`. Returns up to `take` rows.
         */
        async listProviderQueue({ where, select, take = 1000, orderBy = { createdAt: 'asc' } } = {}) {
            return prisma.application.findMany({
                where,
                select,
                orderBy,
                take,
            });
        },

        /**
         * Count applications for a visibility-filtered where. Used to assemble
         * the queue summary cards (pending / in-review / awaiting-docs).
         */
        async countProviderQueue(where) {
            return prisma.application.count({ where });
        },

        /**
         * Locate an application by id OR applicationNumber, scoped to
         * isDeleted: false. Used by the assign action where the route param can
         * be either form.
         */
        async findByIdOrApplicationNumber(idOrNumber) {
            return prisma.application.findFirst({
                where: {
                    OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                    isDeleted: false,
                },
            });
        },

        /**
         * Locate an application by id OR applicationNumber with a visibility
         * filter applied by the caller. Returns a `select`-narrowed slice.
         * Used by workflow-transitions-handler.js and scheduler post handlers.
         */
        async findVisibleByIdOrNumber({ idOrNumber, visibilityWhere, select } = {}) {
            return prisma.application.findFirst({
                where: {
                    ...visibilityWhere,
                    OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                    isDeleted: false,
                },
                select,
            });
        },

        /**
         * Generic findFirst with caller-supplied where + select. The route
         * is responsible for the predicate (visibility, OR clauses, etc.).
         * Useful where the predicate is already assembled and a separate
         * service-side method would only duplicate the call shape. Kept on
         * the service so the prisma client stays out of the route file.
         */
        async findFirstWithWhere({ where, select } = {}) {
            return prisma.application.findFirst({ where, select });
        },

        /**
         * Find existing audit schedules for an auditor inside a time window —
         * used to detect collisions when a new audit is being scheduled.
         * Filters out terminal states (REJECTED/CANCELLED/CANCEL_EXPIRED) so a
         * cancelled audit can never collide with a fresh booking.
         */
        async findAuditorScheduleCandidates({ auditorId, excludeApplicationId, windowStart, windowEnd } = {}) {
            return prisma.application.findMany({
                where: {
                    isDeleted: false,
                    id: { not: excludeApplicationId },
                    auditorId,
                    scheduledDate: { gte: windowStart, lte: windowEnd },
                    status: { notIn: ['REJECTED', 'CANCELLED', 'CANCEL_EXPIRED'] },
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    scheduledDate: true,
                    formData: true,
                },
            });
        },

        /**
         * Re-fetch an application after writeApplicationStatus has run, since
         * the canonical writer does not expose a `select` option but
         * downstream code paths in workflow / scheduler routes need a
         * projected row.
         */
        async getById(applicationId, { select } = {}) {
            const query = { where: { id: applicationId } };
            if (select) {
                query.select = select;
            }
            return prisma.application.findUnique(query);
        },

        /**
         * Update only the supplied columns on the application row. Reserved
         * for use cases where the status is NOT changing — any status
         * transition must still flow through writeApplicationStatus. Examples
         * here: attaching a reviewer column without a status change, stamping
         * a derived column after an asynchronous side effect, etc. (This used
         * to cite the third-party calendar-event stamp; that export was removed —
         * see scheduler-audit-schedules-post-handler.js.)
         */
        async updateApplicationColumns(applicationId, data, { select } = {}) {
            const query = { where: { id: applicationId }, data };
            if (select) {
                query.select = select;
            }
            return prisma.application.update(query);
        },

        /**
         * Append a workflow assignment by adjusting both `formData.PROVIDERAssignment`
         * (legacy JSON path) and the canonical `reviewerId` column without
         * spawning a separate status transition. The scheduler-assign-reviewer
         * handler always pairs this with a buildTransitionUpdate(), but the
         * Prisma write itself is a plain row update — exposed here so the
         * route does not reach into prisma.application.update directly.
         */
        async writeAssignmentColumns(applicationId, { data, select } = {}) {
            return prisma.application.update({
                where: { id: applicationId },
                data,
                select,
            });
        },

        /**
         * Whether the ApplicationComment model is generated on the current
         * Prisma client. Useful when the route wants to distinguish "model
         * missing on legacy schema" from "model present but create failed".
         */
        isApplicationCommentModelAvailable() {
            return Boolean(prisma?.applicationComment
                && typeof prisma.applicationComment.create === 'function');
        },

        /**
         * Persist an ApplicationComment row for revision/CAR transitions.
         * Returns null when the model is unavailable (legacy schema), so the
         * route can fall back to a warning log without throwing.
         */
        async createApplicationCommentIfAvailable({ applicationId, authorId, role, content, internalOnly = false } = {}) {
            if (!this.isApplicationCommentModelAvailable()) {
                return null;
            }
            // C2-class data-loss fix: the old create named 4 non-existent columns
            // (auditorId/commentText/type/attachments) → PrismaClientValidationError,
            // swallowed by the caller's .catch → the revision/CAR audit comment was
            // SILENTLY never persisted. Real ApplicationComment columns are
            // authorId/role/content (+ required organizationId, ADR-014 no default).
            // The revision type/items are already preserved in the transition
            // metadata/formData by the caller, so they are not duplicated here.
            const app = await prisma.application.findUnique({
                where: { id: applicationId },
                select: { organizationId: true },
            });
            if (!app?.organizationId) {
                return null;
            }
            return prisma.applicationComment.create({
                data: {
                    applicationId,
                    authorId,
                    role: role || 'PROVIDER',
                    content,
                    // Wave-3 chatter: internal-only staff notes are gated OUT of
                    // every applicant read (internalOnly:false filter). Defaults
                    // to false so all existing callers (revision/CAR comments)
                    // stay applicant-visible exactly as before.
                    internalOnly: internalOnly === true,
                    organizationId: app.organizationId,
                },
            });
        },

        // Batch 11 — Audit cluster reads
        //
        // The methods below back the audit-scheduling routes
        // (routes/api/audit/*.js). The route handlers used to call
        // prisma.application.findMany / findFirst / update directly; that
        // bypassed the soft-delete + tenant filters and made it possible
        // for a future schema drift to leak the workflow state of an
        // application that had been redacted under Thai PDPA Act B.E. 2562
        // s.33 (right to erasure) or ISO 27799:2016 § 7.10 (audit log
        // tamper-evidence). Centralising here keeps the canonical filters
        // (`isDeleted: false`, `withVisibility(...)`) at one boundary.

        /**
         * Audit listing — applications that are in or past the audit phase.
         * The route layer maps each row to the AuditList UI shape and never
         * sees the raw model. `isDeleted: false` is enforced here so the
         * route cannot accidentally surface a soft-deleted application.
         */
        async listAuditQueue({ statusIn, take = 100 } = {}) {
            return prisma.application.findMany({
                where: {
                    status: { in: statusIn },
                    isDeleted: false,
                },
            // ชื่อผู้ยื่นต้องมากับแถว ไม่ใช่ให้ประตูเดาเอง · ประตูรายละเอียด
            // (/api/audits/:id) ดึงมาถูกอยู่แล้ว ประตูรายการจึงเคยโชว์ 'N/A' ทั้งที่
            // ข้อมูลอยู่ห่างไป include เดียว
            // entity มาก่อน person: นิติบุคคลถือใบรับรองในชื่อของตัวเอง
            include: {
                applicant: { select: { firstName: true, lastName: true } },
                entity: { select: { displayName: true, type: true } },
                // auditorId คือคอลัมน์ผู้รับมอบหมายตัวจริง · headAuditor เป็นคนละบทบาท
                auditor: { select: { firstName: true, lastName: true } },
                headAuditor: { select: { firstName: true, lastName: true } },
            },
                orderBy: { createdAt: 'desc' },
                take,
            });
        },

        /**
         * Audits awaiting a scheduling slot. Used by /api/audits/pending-schedule.
         */
        async listPendingScheduleAudits({ take = 50 } = {}) {
            return prisma.application.findMany({
                where: {
                    status: { in: ['AUDIT_FEE_PAID'] },
                    isDeleted: false,
                },
                            // ชื่อผู้ยื่นต้องมากับแถว ไม่ใช่ให้ประตูเดาเอง · ประตูรายละเอียด
            // (/api/audits/:id) ดึงมาถูกอยู่แล้ว ประตูรายการจึงเคยโชว์ 'N/A' ทั้งที่
            // ข้อมูลอยู่ห่างไป include เดียว
            // entity มาก่อน person: นิติบุคคลถือใบรับรองในชื่อของตัวเอง
            include: {
                applicant: { select: { firstName: true, lastName: true } },
                entity: { select: { displayName: true, type: true } },
                // auditorId คือคอลัมน์ผู้รับมอบหมายตัวจริง · headAuditor เป็นคนละบทบาท
                auditor: { select: { firstName: true, lastName: true } },
                headAuditor: { select: { firstName: true, lastName: true } },
            },
                orderBy: { createdAt: 'asc' },
                take,
            });
        },

        /**
         * Audits already scheduled, optionally filtered by date window for
         * the calendar view.
         */
        async listScheduledAudits({ startDate, endDate, take = 100 } = {}) {
            const where = {
                status: { in: ['AUDIT_CONFIRMED', 'CAR_REVIEWING'] },
                isDeleted: false,
            };
            if (startDate && endDate) {
                where.scheduledDate = {
                    gte: new Date(startDate),
                    lte: new Date(endDate),
                };
            }
            return prisma.application.findMany({
                where,
                            // ชื่อผู้ยื่นต้องมากับแถว ไม่ใช่ให้ประตูเดาเอง · ประตูรายละเอียด
            // (/api/audits/:id) ดึงมาถูกอยู่แล้ว ประตูรายการจึงเคยโชว์ 'N/A' ทั้งที่
            // ข้อมูลอยู่ห่างไป include เดียว
            // entity มาก่อน person: นิติบุคคลถือใบรับรองในชื่อของตัวเอง
            include: {
                applicant: { select: { firstName: true, lastName: true } },
                entity: { select: { displayName: true, type: true } },
                // auditorId คือคอลัมน์ผู้รับมอบหมายตัวจริง · headAuditor เป็นคนละบทบาท
                auditor: { select: { firstName: true, lastName: true } },
                headAuditor: { select: { firstName: true, lastName: true } },
            },
                orderBy: { scheduledDate: 'asc' },
                take,
            });
        },

        /**
         * Tenant- and visibility-scoped audit detail lookup. The caller
         * provides the assembled where (already containing
         * organizationId + withVisibility filter) so this method stays a
         * thin pass-through that includes the applicant.
         */
        async findAuditDetail({ where } = {}) {
            return prisma.application.findFirst({
                where,
                // Narrow select: this row is serialised to the provider audit
                // detail screen. `applicant: true` would ship the applicant's
                // bcrypt hash and TOTP secret to every auditor.
                include: {
                    applicant: {
                        select: {
                            id: true, firstName: true, lastName: true, email: true, phoneNumber: true,
                        },
                    },
                },
            });
        },

        /**
         * Applications eligible for auditor reassignment — those in any
         * in-flight audit state. The route maps each row to the
         * Reassignable UI shape; we keep `isDeleted: false` and the
         * status filter at the service boundary.
         */
        async listReassignableAudits() {
            return prisma.application.findMany({
                where: {
                    status: {
                        // Waiver-reopen (2026-07-08): EXPIRED included — see reviewer mirror.
                        in: ['AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING', 'EXPIRED'],
                    },
                    isDeleted: false,
                },
                include: {
                    applicant: {
                        select: { firstName: true, lastName: true },
                    },
                    // ใครถืองานอยู่ — จอมอบหมายงานใหม่เคยอ่านชื่อจากสำเนาใน formData
                    // แล้วขึ้นว่า "ยังไม่มอบหมาย" ทั้งที่ auditorId มีค่า
                    auditor: {
                        select: { id: true, firstName: true, lastName: true },
                    },
                },
                orderBy: { updatedAt: 'asc' },
            });
        },

        /**
         * Applications eligible for DOCUMENT REVIEWER reassignment — those
         * whose document review is in flight, i.e. the reviewerId is the active
         * binding: ASSIGNED_FOR_REVIEW or REVISION_REQUESTED (the reviewer stays
         * bound through the 5-working-day revision window). The reviewer mirror
         * of listReassignableAudits; same shape + `isDeleted: false` boundary.
         */
        async listReassignableReviewers() {
            return prisma.application.findMany({
                where: {
                    // Waiver-reopen (2026-07-08): EXPIRED included — mirror of the POST
                    // gate + the auditor list (initiator dead-spot, risk #8).
                    status: { in: ['ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED', 'EXPIRED'] },
                    isDeleted: false,
                },
                include: {
                    applicant: {
                        select: { firstName: true, lastName: true },
                    },
                    // เหตุผลเดียวกับฝั่งผู้ตรวจแปลง — บั๊กเดียวกันคนละไฟล์
                    reviewer: {
                        select: { id: true, firstName: true, lastName: true },
                    },
                },
                orderBy: { updatedAt: 'asc' },
            });
        },

        /**
         * Tenant-scoped lookup used by audit-reassign and audits.js. Caller
         * supplies the where (which already encodes the orgId filter and
         * optional withVisibility predicate).
         */
        async findAuditApplication({ where, include } = {}) {
            return prisma.application.findFirst({
                where,
                include,
            });
        },

        /**
         * Used by /api/fraud-detection/dashboard.
         */
        async countApplicationsByStatus(status) {
            return prisma.application.count({
                where: { status },
            });
        },

        /**
         * Locate documents linked to an application — used by the
         * fraud-detection per-application document scan. Soft-deletion at
         * the document level is enforced inside the ApplicationDocument
         * Prisma model (no `isDeleted` column on that table at time of
         * writing); narrowing happens here so the route never gets a
         * broader projection than needed.
         */
        async listApplicationDocumentsForFraudScan(applicationId, { organizationId } = {}) {
            // Optional tenant scope via the parent application (ApplicationDocument
            // has no organizationId of its own). When the caller passes its org,
            // a cross-tenant applicationId yields [] instead of leaking another
            // tenant's document metadata. Omitting it preserves prior behaviour.
            return prisma.applicationDocument.findMany({
                where: {
                    applicationId,
                    ...(organizationId ? { application: { organizationId } } : {}),
                },
            });
        },

        // Batch 14 — Provider/admin wave 2 reads + writes
        //
        // The methods below back the second wave of provider-handlers
        // refactors: auditor/scheduler dashboards, urgent-monitor sweep,
        // final-approval workflow, the provider-side applications listing
        // and detail endpoints, and the legacy inspection-start/audit-
        // decision/reject-to-auditor paths. Every call here is a
        // behaviour-preserving wrapper around exactly the shape the route
        // used to issue — soft-delete + visibility predicates live with
        // the caller because they depend on `req.user` and are produced
        // by shared/application-visibility.withVisibility(...).

        /**
         * Provider-listing path (route accepts caller-supplied projection +
         * pagination). Replaces prisma.application.findMany +
         * prisma.application.count at
         * routes/api/provider/applications.js:122/148.
         */
        async listProviderApplicationsPage({ where, select, orderBy = { createdAt: 'desc' }, skip = 0, take = 50 } = {}) {
            const [rows, total] = await Promise.all([
                prisma.application.findMany({
                    where,
                    select,
                    orderBy,
                    skip,
                    take,
                }),
                prisma.application.count({ where }),
            ]);
            return { rows, total };
        },

        /**
         * Detail view for the provider /applications/:id endpoint. The
         * caller supplies both the visibility-aware where and the select
         * (whether the ApplicationComment subselect is included is a
         * caller concern — see legacy fallback in routes/api/provider/applications.js).
         *
         * Replaces prisma.application.findFirst at
         * routes/api/provider/applications.js:253 + :275.
         */
        async findProviderApplicationDetail({ where, select } = {}) {
            return prisma.application.findFirst({ where, select });
        },

        /**
         * Application-id visibility probe. Returns a thin slice the
         * `/:applicationId/activities` endpoint uses to gate access before
         * loading the WorkActivity timeline (Wave A Phase 23 / G4 cont).
         *
         * Replaces prisma.application.findFirst at
         * routes/api/provider/applications.js:356.
         */
        async findVisibleApplicationIdSlice({ where } = {}) {
            return prisma.application.findFirst({
                where,
                select: { id: true },
            });
        },

        /**
         * Stuck-in-status sweep for the scheduler urgent-monitor screen.
         * Cap is fixed at 50 to bound the JSON payload — the screen lists
         * up to 50 oldest stuck applications, sorted by updatedAt asc.
         *
         * Replaces prisma.application.findMany at
         * routes/api/provider/scheduler.js:51.
         */
        async listStuckApplications({ stuckStatuses, cutoff, take = 50 } = {}) {
            return prisma.application.findMany({
                where: {
                    status: { in: stuckStatuses },
                    updatedAt: { lt: cutoff },
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    updatedAt: true,
                    createdAt: true,
                    applicant: { select: { firstName: true, lastName: true } },
                },
                orderBy: { updatedAt: 'asc' },
                take,
            });
        },

        /**
         * Per-auditor active-assignment counter. Returns 0 if the count
         * fails — the route layer wants this to be non-fatal so a single
         * malformed auditor row cannot break the workload widget.
         *
         * Replaces prisma.application.count at
         * routes/api/provider/scheduler.js:176.
         */
        async countAuditorActiveAuditAssignments(auditorId) {
            try {
                return await prisma.application.count({
                    where: {
                        auditorId, // Application's auditor FK is `auditorId` (not assignedAuditorId — that's on ScopeOfWork/AuditChecklist); the wrong key made these counts silently return 0 via the catch, so the scheduler workload card showed 0 for everyone

                        status: {
                            in: [
                                'AUDIT_FEE_PAID',
                                'AUDIT_CONFIRMED',
                                'AUDIT_PASSED',
                                'CAR_REVIEWING',
                            ],
                        },
                        isDeleted: false,
                    },
                });
            } catch {
                return 0;
            }
        },

        /**
         * Completed-audits-in-window counter for the auditor workload card.
         *
         * Replaces prisma.application.count at
         * routes/api/provider/scheduler.js:192.
         */
        async countAuditorCompletedAuditsSince(auditorId, since) {
            try {
                return await prisma.application.count({
                    where: {
                        auditorId, // Application's auditor FK is `auditorId` (not assignedAuditorId — that's on ScopeOfWork/AuditChecklist); the wrong key made these counts silently return 0 via the catch, so the scheduler workload card showed 0 for everyone

                        status: { in: ['APPROVED', 'CERTIFICATE_ISSUED'] },
                        updatedAt: { gte: since },
                        isDeleted: false,
                    },
                });
            } catch {
                return 0;
            }
        },

        /**
         * Look up an application for the scheduler send-reminder endpoint
         * (drops the applicant profile and the reminder-relevant fields
         * only). Used to validate the application exists in a reminder-
         * eligible status before pushing a notification to the farmer.
         *
         * Replaces prisma.application.findFirst at
         * routes/api/provider/scheduler.js:251.
         */
        async findReminderTargetApplication(idOrNumber) {
            return prisma.application.findFirst({
                where: {
                    OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    healthId: true,
                    formData: true,
                    applicant: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                },
            });
        },

        /**
         * Final-approval queue listing for AUDIT_PASSED applications. Used
         * by the head-auditor dashboard (routes/api/provider/auditor.js).
         *
         * Replaces prisma.application.findMany at
         * routes/api/provider/auditor.js:46.
         *
         * X3-FIX-D / AUD-FA-OBV (2026-05-18) — ARCHITECTURAL DECISION FLAG
         * ---------------------------------------------------------------
         * Current behaviour: returns ALL `AUDIT_PASSED` applications
         * cross-tenant. No visibility filter, no `auditorId` narrowing.
         *
         * Why this is currently SAFE:
         *   (1) GET route gate — X2-FIX-D M-18 narrowed
         *       `/api/provider/auditor/final-approval-queue` to
         *       `requireRole(ROLE_GROUPS.AUDITORS)` on top of the
         *       canonical workflow-transition permission. DR + SCHEDULER
         *       cannot reach this read even though they hold the perm.
         *       Verified at `routes/api/provider/auditor.js:59-86`.
         *   (2) WRITE path narrowed — POST
         *       `/api/provider/auditor/applications/:id/final-approvals`
         *       and `/reject-to-auditor` BOTH wrap the lookup in
         *       `withVisibility(..., req.user)` (`auditor.js:103-107` +
         *       `:151-156`), so an AUDITOR can SEE the bench but cannot
         *       write a final-approval decision on an application
         *       they're not visible-to.
         *
         * What it leaks today:
         *   — One AUDITOR sees other AUDITORs' AUDIT_PASSED pending
         *     final approvals (read-only case list, no PII beyond
         *     applicationNumber + applicant first/last name + dates).
         *
         * Product decision pending (shared-bench vs personal-queue):
         *   (a) SHARED-BENCH model — current behaviour. Any AUDITOR can
         *       pick up any AUDIT_PASSED case for final approval. Good
         *       for load-balancing + back-up; weak on accountability +
         *       cross-tenant compartmentalisation.
         *   (b) PERSONAL-QUEUE model — narrow this lookup with
         *       `withVisibility(req.user)` so each AUDITOR sees only
         *       cases where `auditorId === self`. Good for clear
         *       ownership; requires a SCHEDULER-controlled bench-reassign
         *       affordance for cases where the original AUDITOR is
         *       unavailable.
         *
         * Out of scope for X3 (RBAC + visual fix iteration). Tracked for
         * X3.5 + X6 sign-off review.
         *
         * TODO(X3.5): Product decision required — see docs/handoffs/iter-X3/X3-D.md AUD-FA-OBV finding
         */
        async listFinalApprovalQueue({ organizationId } = {}) {
            // organizationId is REQUIRED (fail closed): an unscoped call lists every
            // organisation's files, which the approver cannot open anyway.
            if (!organizationId) { return []; }
            return prisma.application.findMany({
                where: { isDeleted: false, status: 'AUDIT_PASSED', organizationId },
                orderBy: { updatedAt: 'asc' },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    updatedAt: true,
                    createdAt: true,
                    applicant: { select: { firstName: true, lastName: true } },
                },
            });
        },

        /**
         * Final-approval and reject-to-auditor lookup with caller-supplied
         * visibility predicate. The select stays narrow because both
         * routes only need `id / applicationNumber / status / formData /
         * workflowHistory` to compute the transition update.
         *
         * Replaces prisma.application.findFirst at
         * routes/api/provider/auditor.js:93 + :143.
         */
        async findApplicationForFinalApproval({ where } = {}) {
            return prisma.application.findFirst({
                where,
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    workflowHistory: true,
                    // auditorId feeds the ISO 17065 §7.6 two-person check in
                    // buildTransitionUpdate (certifier must differ from evaluator).
                    auditorId: true,
                },
            });
        },

        /**
         * Auditor dashboard primary listing. Replaces prisma.application.findMany
         * at routes/api/provider/handlers/auditor-dashboard-handler.js:32.
         *
         * The `where` is shaped by the caller (auditorId scoping + status
         * filter). Limit kept at the legacy 1000 cap because the
         * dashboard paginates client-side over the assembled queue.
         */
        async listAuditorDashboardApplications({ where, take = 1000 } = {}) {
            return prisma.application.findMany({
                where,
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    phase2Status: true,
                    auditorId: true,
                    scheduledDate: true,
                    formData: true,
                    workflowHistory: true,
                    createdAt: true,
                    updatedAt: true,
                    applicant: { select: { firstName: true, lastName: true } },
                },
                orderBy: [{ scheduledDate: 'asc' }, { updatedAt: 'desc' }],
                take,
            });
        },

        /**
         * Scheduler dashboard primary listing. Replaces prisma.application.findMany
         * at routes/api/provider/handlers/scheduler-dashboard-handler.js:24.
         */
        async listSchedulerDashboardApplications({ where, take = 1000 } = {}) {
            return prisma.application.findMany({
                where,
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    phase2Status: true,
                    auditorId: true,
                    scheduledDate: true,
                    formData: true,
                    workflowHistory: true,
                    createdAt: true,
                    updatedAt: true,
                    applicant: { select: { firstName: true, lastName: true } },
                },
                orderBy: { updatedAt: 'desc' },
                take,
            });
        },

        /**
         * Auditor lookup against `id` set. Used by both auditor + scheduler
         * dashboards to resolve auditorId → display name.
         *
         * Replaces prisma.user.findMany at:
         *   - routes/api/provider/handlers/auditor-dashboard-handler.js:70
         *   - routes/api/provider/handlers/scheduler-dashboard-handler.js:64
         */
        async listAuditorsByIds(auditorIds) {
            if (!Array.isArray(auditorIds) || auditorIds.length === 0) {return [];}
            return prisma.user.findMany({
                where: { id: { in: auditorIds } },
                select: { id: true, firstName: true, lastName: true },
            });
        },

        /**
         * Locate the application slice the auditor inspection-start +
         * audit-decision handlers need (status + auditorId + formData +
         * workflowHistory + healthId).
         *
         * Replaces prisma.application.findFirst at:
         *   - routes/api/provider/handlers/auditor-inspection-start-handler.js:31
         *   - routes/api/provider/handlers/auditor-audit-decision-handler.js:51
         */
        async findAuditDecisionApplication(idOrNumber) {
            return prisma.application.findFirst({
                where: {
                    OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    healthId: true,
                    status: true,
                    auditorId: true,
                    // Separation of duties at decision time (operator ruling 2026-10-05).
                    reviewerId: true,
                    formData: true,
                    workflowHistory: true,
                },
            });
        },

        /**
         * Persist the inspection-start update (formData + workflowHistory)
         * without changing `status`. Returns a narrow projection because
         * the route layer only needs the updated formData/applicationNumber.
         *
         * Replaces prisma.application.update at
         * routes/api/provider/handlers/auditor-inspection-start-handler.js:79.
         */
        async writeInspectionStart(applicationId, { data } = {}) {
            return prisma.application.update({
                where: { id: applicationId },
                data,
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    updatedAt: true,
                },
            });
        },

        /**
         * Re-fetch a narrow projection after writeApplicationStatus(). Used
         * by the auditor audit-decision handler — writeApplicationStatus
         * does not expose a `select` option so the caller has to round-trip
         * once more to get the post-transition shape it returns to clients.
         *
         * Replaces prisma.application.findUnique at
         * routes/api/provider/handlers/auditor-audit-decision-handler.js:200.
         */
        async findAuditDecisionPostWriteSlice(applicationId) {
            return prisma.application.findUnique({
                where: { id: applicationId },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    updatedAt: true,
                },
            });
        },

        /**
         * WorkActivity timeline for an application — provider-applications.js
         * exposes this as the read-only audit-trail strip on the detail page.
         *
         * Replaces prisma.workActivity.findMany at
         * routes/api/provider/applications.js:366.
         */
        async listWorkActivitiesForApplication(applicationId) {
            return prisma.workActivity.findMany({
                where: { applicationId },
                orderBy: [{ createdAt: 'asc' }],
                include: {
                    assignedUser: { select: { id: true, firstName: true, lastName: true } },
                    completer: { select: { id: true, firstName: true, lastName: true } },
                },
            });
        },

        /**
         * Replaces routes/api/provider/handlers/analytics.js:26
         * prisma.application.groupBy — actor × status performance roll-up
         * for the provider analytics dashboard.
         */
        async groupApplicationsByActorAndStatus({ start, end } = {}) {
            return prisma.application.groupBy({
                by: ['updatedBy', 'status'],
                where: {
                    isDeleted: false,
                    updatedAt: { gte: start, lte: end },
                    updatedBy: { not: null },
                },
                _count: { _all: true },
            });
        },

        /**
         * Replaces routes/api/provider/handlers/reviewer.js:29
         * prisma.application.findMany — broad reviewer-queue listing
         * across the document-review pipeline states. Caller filters
         * down to "applications assigned to me" via formData.PROVIDERAssignment.
         */
        async listReviewerQueueApplicationsPage({
            reviewerId = null,
            cursor = null,
            pageSize = REVIEWER_QUEUE_PAGE_SIZE,
        } = {}) {
            return prisma.application.findMany({
                where: reviewerQueueWhere({ reviewerId }),
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    // UAT gap: the canonical reviewerId column was omitted, so the
                    // REV-01 column-branch in reviewer.js was dead (always fell back
                    // to formData.PROVIDERAssignment). Select it so the canonical
                    // ownership filter works (column-only assign paths won't vanish).
                    reviewerId: true,
                    formData: true,
                    createdAt: true,
                    updatedAt: true,
                    workflowHistory: true,
                    applicant: {
                        select: { firstName: true, lastName: true },
                    },
                },
                // A *total* order. `createdAt` alone is not one: two applications
                // submitted in the same millisecond tie, and a tie makes the page
                // boundary ambiguous, so a cursor over it drops and repeats rows.
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                // One row beyond the page. The spare answers "is there more?"
                // without spending a round trip that comes back empty, and it is
                // what lets `truncated` be exact instead of a guess.
                take: pageSize + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
        },

        /**
         * Every application in one reviewer's queue, read in cursor-anchored
         * pages.
         *
         * This replaces `listReviewerQueueApplications({ take: 1000 })`. Scoping
         * that query to a single reviewer removed most of its damage but not the
         * shape of it: `take` was still a ceiling, and an unreported ceiling
         * lies. Give one reviewer more than a thousand open applications and the
         * thousand-and-first was not fetched, not counted in any KPI, and not on
         * the dashboard of the person responsible for it. Nothing errored and
         * nothing warned — the work was simply gone.
         *
         * Cursors rather than `skip`/offset: offset re-scans every row it steps
         * over, and it drifts, because rows inserted between two reads shift the
         * window and the reader steps past rows it never saw. A cursor is
         * anchored to a row, so the next page resumes exactly where the last
         * one stopped.
         *
         * The drain is bounded — an unbounded loop over a table is a way to take
         * the server down — but the bound is honest. Reaching it sets
         * `truncated`, so the dashboard can say the queue is not all here
         * instead of quietly presenting a prefix as the whole.
         *
         * @returns {Promise<{items: Array<object>, truncated: boolean}>}
         */
        async listAllReviewerQueueApplications({
            reviewerId = null,
            pageSize = REVIEWER_QUEUE_PAGE_SIZE,
            maxPages = REVIEWER_QUEUE_MAX_PAGES,
        } = {}) {
            const size = positiveIntOr(pageSize, REVIEWER_QUEUE_PAGE_SIZE, REVIEWER_QUEUE_MAX_PAGE_SIZE);
            const pageBudget = positiveIntOr(maxPages, REVIEWER_QUEUE_MAX_PAGES, REVIEWER_QUEUE_MAX_PAGES);

            const items = [];
            let cursor = null;

            for (let page = 0; page < pageBudget; page += 1) {
                // Sequential by nature: each page's cursor is the previous
                // page's last row, so these cannot be issued in parallel.
                const batch = await this.listReviewerQueueApplicationsPage({ reviewerId, cursor, pageSize: size });

                const hasMore = batch.length > size;
                const kept = hasMore ? batch.slice(0, size) : batch;
                items.push(...kept);

                if (!hasMore) {
                    return { items, truncated: false };
                }
                cursor = kept[kept.length - 1].id;
            }

            return { items, truncated: true };
        },

        /**
         * Replaces routes/api/provider/handlers/reviewer.js:184
         * prisma.application.findFirst — narrow lookup for the save-
         * progress endpoint (id OR applicationNumber, narrow projection).
         */
        async findApplicationByIdOrNumberFormDataSlice(idOrNumber) {
            return prisma.application.findFirst({
                where: {
                    OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                    isDeleted: false,
                },
                // reviewerId is the canonical reviewer-ownership column (consumed
                // by reviewer.js save-progress after the JSON fallback removal).
                select: { id: true, formData: true, reviewerId: true },
            });
        },

        /**
         * Replaces routes/api/provider/handlers/reviewer.js:224
         * prisma.application.update — save reviewer-progress slice.
         * Status is unchanged so this stays off the canonical writer.
         */
        async updateReviewerProgress(applicationId, { updatedBy, formData }) {
            return prisma.application.update({
                where: { id: applicationId },
                data: { updatedBy, formData },
                select: { id: true, formData: true, updatedAt: true },
            });
        },

        /**
         * Replaces routes/api/provider/handlers/scheduler-audit-schedules-get-handler.js:43
         * prisma.application.findMany — scheduler dashboard queue listing
         * with applicant.farms included.
         */
        async listSchedulerScheduleApplications({ where, take = 1000 } = {}) {
            return prisma.application.findMany({
                where,
                include: {
                    applicant: {
                        select: {
                            firstName: true,
                            lastName: true,
                            farms: {
                                select: {
                                    id: true,
                                    farmName: true,
                                    province: true,
                                    district: true,
                                    address: true,
                                    latitude: true,
                                    longitude: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { scheduledDate: 'asc' },
                take,
            });
        },

        /**
         * Replaces routes/api/provider/handlers/scheduler-audits-route-optimization-handler.js:26
         * prisma.application.findMany — single-day window for an auditor,
         * include applicant.farms for GPS lookup.
         */
        async listAuditorRouteApplications({ auditorId, start, end } = {}) {
            return prisma.application.findMany({
                where: {
                    isDeleted: false,
                    auditorId,
                    scheduledDate: { gte: start, lte: end },
                    status: { not: 'CANCELLED' },
                },
                include: {
                    applicant: {
                        select: {
                            farms: {
                                select: {
                                    id: true,
                                    farmName: true,
                                    address: true,
                                    province: true,
                                    district: true,
                                    latitude: true,
                                    longitude: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { scheduledDate: 'asc' },
            });
        },

        /**
         * Replaces routes/api/provider/handlers/workflow-audit-timelines-handler.js:38
         * prisma.application.findFirst — narrow projection for the audit
         * timeline read endpoint (id OR applicationNumber).
         */
        async findApplicationByIdOrNumberTimelineSlice(idOrNumber) {
            return prisma.application.findFirst({
                where: {
                    OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    workflowHistory: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        },

        /**
         * Replaces routes/api/provider/handlers/workflow-revision-expirations-handler.js:35
         * prisma.application.findFirst — narrow projection for the
         * revision-expiration check (id OR applicationNumber).
         */
        async findApplicationByIdOrNumberWorkflowSlice(idOrNumber) {
            return prisma.application.findFirst({
                where: {
                    OR: [{ id: idOrNumber }, { applicationNumber: idOrNumber }],
                    isDeleted: false,
                },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                    workflowHistory: true,
                },
            });
        },

        /**
         * Replaces routes/api/provider/handlers/workflow-revision-expirations-handler.js:119
         * prisma.application.findUnique — post-writeApplicationStatus
         * re-fetch with the response projection.
         */
        async getApplicationExpirationSlice(applicationId) {
            return prisma.application.findUnique({
                where: { id: applicationId },
                select: {
                    id: true,
                    applicationNumber: true,
                    status: true,
                    formData: true,
                },
            });
        },
    };
}

module.exports = { createApplicationProviderQueryMethods };
