const {
    authenticateProvider,
    logger,
    PERMISSIONS,
    requireCanonicalPermission,
    toInt,
    obj,
    arr,
    dt,
    prisma,
} = require('./shared');
const applicationService = require('../../../../services/application-service');
const { sortBySlaPriority } = require('../../../../services/application-service/reviewer-queue-order');
// สถานะที่ดึงมาและวิธีแบ่งกอง ประกาศไว้ที่เดียว — ที่เดียวกับที่คำสั่งค้นใช้
const { REVIEWER_QUEUE_PARTITIONS } = require('../../../../services/application-service/reviewer-queue-where');
const { toReviewerQueueItem } = require('./queue-utils');
const { startOfLocalDay } = require('../../../../utils/working-days');

/**
 * C3 ("งานนี้พาสไปที่ใคร"): batch-resolve the assignedBy user ids on a set of
 * reviewer queue items to display names, mutating `assignedByName` in place. The
 * reviewer queue rows show "มอบหมายโดย <name>" so the reviewer knows the job's
 * origin. Best-effort: a lookup failure leaves the names null (the UI degrades
 * gracefully) and logs the cause (golden rule #3 — never swallow blind).
 */
async function attachAssignedByNames(items) {
    const ids = [...new Set(items.map((item) => item.assignedById).filter(Boolean))];
    if (ids.length === 0) {
        return;
    }
    try {
        const users = await prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, firstName: true, lastName: true },
        });
        const nameById = new Map(
            users.map((u) => [u.id, [u.firstName, u.lastName].map((v) => String(v || '').trim()).filter(Boolean).join(' ').trim() || null]),
        );
        for (const item of items) {
            if (item.assignedById) {
                item.assignedByName = nameById.get(item.assignedById) || null;
            }
        }
    } catch (error) {
        logger.warn('[provider] reviewer/dashboard assigned-by name resolution failed:', error.message);
    }
}


const reviewerDashboard = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_DOC_REVIEW),
    async (req, res) => {
        try {
            const now = new Date();
            const page = toInt(req.query.page, 1, 1, 100000);
            const limit = toInt(req.query.limit, 20, 1, 200);
            const offset = (page - 1) * limit;
            const todayStart = startOfLocalDay(now); // 00:00 today in Bangkok
            // REV-01 (hardening-iter1 fix): the canonical reviewer identity is the user
            // UUID, matched against the Application.reviewerId column — mirroring the
            // save-progress ownership check below (L164). The old code compared the
            // legacy formData.PROVIDERAssignment.reviewerId (a UUID) against
            // req.user.providerId (a 13-digit id) → could never match → the reviewer's
            // primary dashboard was ALWAYS empty even with validly-assigned work.
            const currentReviewerId = req.user.id;

            // Scoped in the query and read in cursor-anchored pages. This used
            // to fetch the whole pipeline (`take: 1000`, every row with its
            // formData and workflowHistory JSON) and filter here — which
            // transferred a thousand full application payloads to keep a
            // handful, and made the limit a silent ceiling: past a thousand
            // queued applications the rest were never fetched, so they never
            // reached this filter and never appeared on the dashboard of the
            // reviewer they were assigned to. Both ownership branches moved
            // into the WHERE together; see reviewer-queue-where.js.
            const { items: myApplications, truncated } = await applicationService.listAllReviewerQueueApplications({
                reviewerId: currentReviewerId,
            });

            if (truncated) {
                // The drain hit its page budget, so this dashboard is a prefix
                // of the reviewer's queue rather than the whole of it. Say so in
                // the log and in the response — a partial queue presented as
                // complete is the exact failure `take: 1000` used to cause.
                logger.warn('[provider] reviewer/dashboard queue truncated at the page budget for reviewer %s', currentReviewerId);
            }

            // Ordered by who runs out of time first, not by who arrived first.
            // Safe to do here rather than in SQL precisely because the drain
            // above returns the complete set: sorting a truncated window by
            // urgency looks authoritative and is wrong. The deadline lives in
            // formData JSON, which Postgres cannot order by without an index
            // that does not exist. See reviewer-queue-order.js.
            const queue = sortBySlaPriority(
                myApplications.map((application) => toReviewerQueueItem(application, now)),
            );
            // C3: resolve "มอบหมายโดย" display names in ONE batched lookup across the
            // reviewer's queue (mutates queue items; the partitioned arrays below share them).
            await attachAssignedByNames(queue);
            // แบ่งกองจากรายการเดียวกับที่คำสั่งค้นใช้ดึง — เขียนสถานะซ้ำไว้ตรงนี้เมื่อไร
            // สองฝั่งก็เริ่มเดินคนละทาง และสถานะที่ตกหล่นจะถูกดึงมาแล้วไม่โผล่ที่ไหนเลย
            const inPartition = (key) => queue.filter(
                (item) => REVIEWER_QUEUE_PARTITIONS[key].includes(item.workflowState),
            );
            const pendingReview = inPartition('pendingReview');
            const awaitingRevision = inPartition('awaitingRevision');
            const approvedWaitingPhase2 = inPartition('approvedWaitingPhase2');

            // Counted over the reviewer's own applications. It previously ran
            // over all thousand rows, which only worked because all thousand
            // were in memory; the actorId test below is what actually selects
            // this reviewer's decisions, and an application they acted on today
            // is one assigned to them.
            const reviewedToday = myApplications.reduce((count, application) => {
                const workflowHistory = arr(application.workflowHistory);
                return count + workflowHistory.filter((event) => {
                    const eventTime = dt(event?.timestamp);
                    if (!eventTime) {
                        return false;
                    }
                    return eventTime >= todayStart
                        && eventTime <= now
                        && String(event?.actorId || '') === String(req.user.id || '')
                        && ['WORKFLOW_TRANSITION', 'WORKFLOW_FORCE_TRANSITION'].includes(String(event?.action || ''))
                        && ['REVISION_REQUESTED', 'DOC_APPROVED'].includes(String(event?.toState || ''));
                }).length;
            }, 0);

            const awaitingTotal = awaitingRevision.length;
            const dueIn48h = awaitingRevision.filter((item) => item.sla.dueSoon).length;
            const overdue = awaitingRevision.filter((item) => item.sla.isOverdue).length;

            const queueType = String(req.query.queue || 'pending').toLowerCase();
            let selectedQueue = pendingReview;
            if (queueType === 'revision') {
                selectedQueue = awaitingRevision;
            } else if (queueType === 'approved') {
                selectedQueue = approvedWaitingPhase2;
            }

            return res.json({
                success: true,
                data: {
                    queues: {
                        pendingReview: {
                            total: pendingReview.length,
                            items: pendingReview,
                        },
                        awaitingRevision: {
                            total: awaitingTotal,
                            items: awaitingRevision,
                        },
                        approvedWaitingPhase2: {
                            total: approvedWaitingPhase2.length,
                            items: approvedWaitingPhase2,
                        },
                    },
                    calendar: {
                        revisionDeadlines: awaitingRevision
                            .filter((item) => item.revisionDueAt)
                            .map((item) => ({
                                applicationId: item.id,
                                applicationNumber: item.applicationNumber,
                                applicantName: item.applicantName,
                                dueAt: item.revisionDueAt,
                                overdue: item.sla.isOverdue,
                                dueSoon: item.sla.dueSoon,
                            })),
                    },
                    kpi: {
                        reviewedToday,
                        pending: pendingReview.length,
                        dueIn48h,
                        overdueOrExpired: overdue + inPartition('overdueOrExpired').length,
                    },
                    selectedQueue: {
                        queue: queueType,
                        pagination: {
                            total: selectedQueue.length,
                            page,
                            limit,
                            totalPages: Math.max(1, Math.ceil(selectedQueue.length / limit)),
                            // False in every real case. True means the reviewer
                            // has more work than one drain will read, and the
                            // counts above describe a prefix of their queue —
                            // which the dashboard must state rather than imply
                            // completeness it does not have.
                            truncated,
                        },
                        items: selectedQueue.slice(offset, offset + limit),
                    },
                },
            });
        } catch (error) {
            logger.error('[provider] reviewer/dashboard failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch reviewer dashboard',
            });
        }
    },
];

/**
 * REV-05: Save draft review progress per-step.
 * Allows a reviewer to mark steps as reviewed and save notes
 * without needing to complete all 9 steps in one sitting.
 *
 * PATCH /api/provider/reviewer/:id/progress
 * Body: { step: 1-9, verified: true/false, notes: "..." }
 */
const reviewSaveProgress = [
    authenticateProvider,
    requireCanonicalPermission(PERMISSIONS.APPLICATION_DOC_REVIEW),
    async (req, res) => {
        try {
            const idOrNumber = String(req.params.id || '').trim();
            const step = Number(req.body?.step);
            const verified = !!req.body?.verified;
            const notes = String(req.body?.notes || '').trim();
            // Record the canonical user UUID (matches the ownership check at :173
            // and the codebase-wide reviewedBy convention), not the 13-digit providerId.
            const currentReviewerId = req.user.id;

            if (!idOrNumber || !Number.isFinite(step) || step < 1 || step > 9) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid application id and step (1-9) are required',
                });
            }

            const application = await applicationService.findApplicationByIdOrNumberFormDataSlice(idOrNumber);

            if (!application) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            const formData = obj(application.formData);

            // Ownership check — canonical Application.reviewerId column (single
            // source of truth; legacy formData.PROVIDERAssignment.reviewerId
            // fallback removed after backfill — see scripts/backfill-reviewer-id.js).
            if (application.reviewerId && application.reviewerId !== req.user.id) {
                return res.status(403).json({
                    success: false,
                    error: 'ไม่มีสิทธิ์ดำเนินการ คุณไม่ใช่ผู้ตรวจที่ได้รับมอบหมาย',
                });
            }

            // Build updated reviewProgress and reviewedSteps
            const reviewProgress = obj(formData.reviewProgress);
            reviewProgress[`step${step}`] = {
                verified,
                notes,
                reviewedAt: new Date().toISOString(),
                reviewedBy: currentReviewerId,
            };

            // Compute reviewedSteps array from verified entries
            const reviewedSteps = [];
            for (let s = 1; s <= 9; s++) {
                if (obj(reviewProgress[`step${s}`]).verified) {
                    reviewedSteps.push(s);
                }
            }

            const updated = await applicationService.updateReviewerProgress(application.id, {
                updatedBy: req.user.id,
                formData: {
                    ...formData,
                    reviewProgress,
                    reviewedSteps,
                },
            });

            return res.json({
                success: true,
                data: {
                    id: updated.id,
                    reviewedSteps,
                    reviewProgress: obj(updated.formData).reviewProgress,
                    completedCount: reviewedSteps.length,
                    totalSteps: 9,
                    isComplete: reviewedSteps.length === 9,
                },
            });
        } catch (error) {
            logger.error('[provider] reviewer/progress save failed:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to save review progress',
            });
        }
    },
];

module.exports = {
    reviewerDashboard,
    reviewSaveProgress,
};
