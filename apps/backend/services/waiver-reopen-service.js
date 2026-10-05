'use strict';

/**
 * Waiver-reopen service (owner ruling 2026-07-08).
 *
 * Policy: fees for submitted-for-review work are NON-refundable on staff
 * reject / auto-expiry — but a ONCE-per-application special case may reopen an
 * EXPIRED application REUSING the already-settled payment (no new invoice, no
 * refund, no new revenue event).
 *
 * SoD (เท่านั้น):
 *   1. the ASSIGNED inspector initiates — reviewerId for a revision-expired
 *      app, auditorId for a CAR-expired app (farmer contacts them off-system;
 *      contact evidence is a mandatory field). Timing is department
 *      discretion — NO system window (owner fork answer).
 *   2. a finance officer approves — either finance role (operator 2026-09-27:
 *      "การเงินได้ทั้งสองฝั่ง"), ADMIN excluded (mirror AUDIT-001), requester ≠
 *      approver, the live User row still ACTIVE in that role.
 *   3. execution = SYSTEM actor walking the SYSTEM-only EXPIRED→<origin>
 *      edge (mirror of #532 approve-slip/advance split).
 *
 * Full analysis + risk table: docs/handoffs/waiver-reopen-decision-2026-07-08.md.
 */

const { prisma } = require('./prisma-database');
const { getTenantContext } = require('./tenant-context');
const { writeApplicationStatus } = require('./application-status-writer');
const { statusTransitionAuditHook } = require('../middleware/audit-logger');
const { ISSUER_SIDE } = require('./finance/invoice-side');
const { isActiveWaiverApprover, WAIVER_APPROVAL_GROUP } = require('./waiver-approvers');
const workActivityService = require('./work-activity-service');
const { computePhaseSettlement } = require('./phase-billing-service');
const invoiceService = require('./invoice-service');
const { addWorkingDays } = require('../utils/working-days');
const { maskThaiIdsInText } = require('../utils/field-encryption');
const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { createLogger } = require('../shared/logger');

const logger = createLogger('waiver-reopen-service');

const SLA_DAYS = 5;
const REOPENABLE_ORIGINS = new Set(['REVISION_REQUESTED', 'CAR_PENDING']);

function err(message, statusCode, code) {
    const e = new Error(message);
    e.statusCode = statusCode;
    e.status = statusCode; // both spellings — sendServiceError reads either
    e.code = code;
    return e;
}

function asArray(v) { return Array.isArray(v) ? v : []; }
function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

/**
 * Derive the state the application EXPIRED from, from workflowHistory.
 * The four expiry writers stamp slightly different event shapes — normalize
 * across all of them. NEVER caller-supplied (risk #2 in the decision doc:
 * choosing CAR_PENDING for a revision-expired app skips the unpaid Phase-2
 * gate straight toward cert issuance).
 */
function deriveExpiredFromState(application) {
    const history = asArray(application.workflowHistory);
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const ev = asObject(history[i]);
        const to = String(ev.toStatus || ev.newStatus || '').toUpperCase();
        if (to === 'EXPIRED') {
            const from = String(ev.fromStatus || ev.previousStatus || '').toUpperCase();
            if (REOPENABLE_ORIGINS.has(from)) { return from; }
            return null; // expired from a non-reopenable state
        }
    }
    // Fallback: cancelReason stamped by the expiry writers (CAR_OVERDUE /
    // REVISION_OVERDUE) when the history event is missing/legacy-shaped.
    const cancelReason = String(asObject(application.formData).cancelReason || '').toUpperCase();
    if (cancelReason.includes('CAR')) { return 'CAR_PENDING'; }
    if (cancelReason.includes('REVISION')) { return 'REVISION_REQUESTED'; }
    return null;
}

/** The assigned inspector for the given origin state. */
function assignedInspectorId(application, origin) {
    return origin === 'CAR_PENDING' ? application.auditorId : application.reviewerId;
}

// Refund states that mean the money is (or is on its way) OUT — the fee is no
// longer reusable even though invoice.status stays 'paid' (refund-service
// records refunds ONLY in Invoice.metadata.refund; it never mutates status).
const ACTIVE_REFUND_STATUSES = new Set(['INITIATED', 'BANK_TRANSFER_PENDING', 'COMPLETED']);

/**
 * Shared fail-closed settlement gate for BOTH reopen lanes (leniency approve +
 * WRONGFUL_EXPIRY batch): the origin phase must be paid on BOTH money sides
 * AND carry no live refund (carpet-bomb debug 2026-07-08: computePhaseSettlement
 * reads invoice.status alone, which a refund never changes — without the
 * refund check a platform-refunded fee could be "reused" for a reopen).
 */
async function assertPhaseSettledForOrigin(applicationId, origin) {
    const phase = origin === 'CAR_PENDING' ? 'PHASE_2' : 'PHASE_1';
    const invoices = await invoiceService.listSettlementsForApplication(applicationId);
    const settlement = computePhaseSettlement(invoices, phase);
    if (!settlement.phasePaid) {
        throw err(
            `ค่าธรรมเนียม ${phase} ยังไม่ชำระครบ/ถูกระงับ ใช้ค่าใช้จ่ายเดิมไม่ได้`,
            409, 'WAIVER_FEE_NOT_SETTLED',
        );
    }
    const rows = await prisma.invoice.findMany({
        where: { applicationId, serviceType: { startsWith: phase } },
        select: { serviceType: true, metadata: true },
    });
    const refunded = rows.find((r) => ACTIVE_REFUND_STATUSES.has(
        String(asObject(asObject(r?.metadata).refund).status || '').toUpperCase(),
    ));
    if (refunded) {
        throw err(
            `ค่าธรรมเนียม ${phase} มีการคืนเงิน (${refunded.serviceType}) ใช้ค่าใช้จ่ายเดิมไม่ได้`,
            409, 'WAIVER_FEE_NOT_SETTLED',
        );
    }
}

/**
 * Inspector opens a reopen request on an EXPIRED application.
 * Gate: ONLY the assigned inspector (reviewer for revision-expiry, auditor for
 * CAR-expiry). ADMIN/SCHEDULER are NOT in the path (ruling: เท่านั้น).
 */
async function createReopenRequest({ applicationId, user, reason, reasonCode = 'LENIENCY' }) {
    const trimmedReason = String(reason || '').trim();
    if (trimmedReason.length < 20) {
        throw err('ต้องระบุหลักฐานการติดต่อและเหตุผล (อย่างน้อย 20 ตัวอักษร)', 400, 'WAIVER_REASON_REQUIRED');
    }
    // MUST-1 (adversarial verify 2026-07-08): the petition lane is
    // LENIENCY-only. WRONGFUL_EXPIRY rows are created EXCLUSIVELY by
    // batchReinstateWrongfulExpiry (ops, bugRef-accountable) — accepting it
    // here would let an inspector+accountant reopen forever via the
    // platform-fault lane after the leniency is spent (the 060000 migration
    // removed the DB backstop for repeated WRONGFUL_EXPIRY approvals).
    if (reasonCode !== 'LENIENCY') {
        throw err(`Invalid reasonCode: ${reasonCode} — petition lane is LENIENCY-only`, 400, 'WAIVER_REASON_CODE_INVALID');
    }

    const application = await prisma.application.findFirst({
        where: { id: applicationId, isDeleted: false },
    });
    if (!application) { throw err('Application not found', 404, 'NOT_FOUND'); }
    if (String(application.status).toUpperCase() !== 'EXPIRED') {
        throw err('เปิดเคสอนุโลมได้เฉพาะใบสมัครที่ถูกยกเลิกอัตโนมัติ (EXPIRED) เท่านั้น', 409, 'WAIVER_NOT_EXPIRED');
    }

    const origin = deriveExpiredFromState(application);
    if (!origin) {
        throw err('ใบสมัครนี้ไม่ได้หมดอายุจากขั้นตอนแก้ไข/CAR เปิดเคสอนุโลมไม่ได้', 409, 'WAIVER_ORIGIN_UNKNOWN');
    }

    // SoD gate 1: only the ASSIGNED inspector for this origin.
    const role = normalizeRole(user?.canonicalRole || user?.role);
    const allowedRole = origin === 'CAR_PENDING'
        ? role === CANONICAL_ROLES.FIELD_INSPECTOR
        : role === CANONICAL_ROLES.DOCUMENT_REVIEWER;
    if (!allowedRole) {
        throw err('เฉพาะผู้ตรวจที่รับผิดชอบใบสมัครนี้เท่านั้นที่ยื่นเรื่องได้', 403, 'WAIVER_ROLE_FORBIDDEN');
    }
    const inspectorId = assignedInspectorId(application, origin);
    if (!inspectorId || inspectorId !== user.id) {
        throw err('เฉพาะผู้ตรวจที่ได้รับมอบหมายใบสมัครนี้เท่านั้นที่ยื่นเรื่องได้', 403, 'WAIVER_NOT_ASSIGNED');
    }
    // Hardening batch 2026-07-09: the petitioner's LIVE User row must be
    // ACTIVE + not deleted (JWT alone outlives a suspension whose path skipped
    // the sessionsRevokedAt stamp). No org filter needed — the assignment pin
    // above already binds this user to the application.
    const requesterRow = await prisma.user.findFirst({
        where: { id: user.id, status: 'ACTIVE', isDeleted: false },
        select: { id: true },
    });
    if (!requesterRow) {
        throw err('บัญชีผู้ยื่นเรื่องไม่อยู่ในสถานะปฏิบัติงาน ยื่นเรื่องไม่ได้', 403, 'WAIVER_REQUESTER_NOT_ACTIVE');
    }

    // Guards (also DB-enforced by partial uniques — these checks give the
    // friendly 409 instead of a P2002).
    // Q1 lane separation (owner ruling 2026-07-08): the once-only limit counts
    // ONLY approved LENIENCY reopens. A WRONGFUL_EXPIRY reinstate is the
    // platform correcting its own bug — the farmer did nothing wrong and must
    // keep their single leniency chance intact.
    const openPending = await prisma.waiverReopenRequest.findFirst({
        where: { applicationId: application.id, status: 'PENDING' },
        select: { id: true },
    });
    if (openPending) {
        throw err('มีคำขออนุโลมของใบสมัครนี้รอการอนุมัติอยู่แล้ว', 409, 'WAIVER_ALREADY_PENDING');
    }
    const usedLeniency = await prisma.waiverReopenRequest.findFirst({
        where: { applicationId: application.id, status: 'APPROVED', reasonCode: 'LENIENCY' },
        select: { id: true },
    });
    if (usedLeniency && reasonCode === 'LENIENCY') {
        throw err('ใบสมัครนี้เคยได้รับการอนุโลมแล้ว (เปิดได้ครั้งเดียว) ต้องยื่นคำขอใหม่', 409, 'WAIVER_ALREADY_USED');
    }

    const request = await prisma.waiverReopenRequest.create({
        data: {
            organizationId: application.organizationId,
            applicationId: application.id,
            requestedBy: user.id,
            requesterRole: role,
            expiredFromState: origin,
            reasonCode,
            // PII invariant: free text may carry a national ID — mask at write.
            reason: maskThaiIdsInText(trimmedReason),
            status: 'PENDING',
        },
    });

    // Hardening batch 2026-07-09: surface the petition in the unified
    // /provider/work inbox as a WAIVER_APPROVAL item (the app stays EXPIRED, so
    // createForStage never fires). BEST-EFFORT — a queue-item failure must never
    // block the farmer's petition; the approver notifications + daily SLA job
    // remain the backstops. candidateGroup = WAIVER_APPROVAL_GROUP, the shared
    // group of both finance roles (operator 2026-09-27 (B) "การเงินได้ทั้งสองฝั่ง"),
    // so either role sees and can claim it. BE authoritative: assertApprover decides.
    try {
        await workActivityService.createAdHocActivity({
            prisma,
            applicationId: application.id,
            workType: 'WAIVER_APPROVAL',
            candidateGroup: WAIVER_APPROVAL_GROUP,
            triggeredAtStage: 'EXPIRED',
            organizationId: application.organizationId,
            dueAt: addWorkingDays(new Date(), SLA_DAYS), // decision SLA, mirrors waiver-sla-escalation-job
            note: request.id,
        });
    } catch (queueErr) {
        logger.warn(`[waiver] WAIVER_APPROVAL queue item failed (non-fatal) for ${request.id}: ${queueErr?.message}`);
    }

    logger.info(`[waiver] reopen request ${request.id} created for ${application.applicationNumber} (${origin}) by ${user.id}`);
    return { request, application };
}

// ผู้อนุมัติ: การเงินทั้งสองฝั่ง (operator 2026-09-27 — "การเงินได้ทั้งสองฝั่ง")
// allow-list ตามบทบาทเท่านั้น: ผู้ดูแลระบบ/ผู้ตรวจแปลงไม่อยู่ในรายการ (mirror AUDIT-001)
const APPROVER_ROLES = new Set([CANONICAL_ROLES.FINANCE_OFFICER_DTAM, CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]);

/** ฝั่งของผู้ตัดสินที่บันทึกลงแถวคำขอ/ประวัติ/ร่องรอยตรวจสอบ — ตามบทบาทจริง ไม่ใช่ค่าคงที่ */
function approverSideOf(role) {
    return role === CANONICAL_ROLES.FINANCE_OFFICER_DTAM ? ISSUER_SIDE.DTAM : ISSUER_SIDE.PLATFORM;
}

/** SoD gate 2 helper: a finance officer (either role), not ADMIN, not the requester. */
async function assertApprover(user, request) {
    const role = normalizeRole(user?.canonicalRole || user?.role);
    if (!APPROVER_ROLES.has(role)) {
        // Covers ADMIN/PLATFORM_ADMIN (mirror AUDIT-001) and every
        // non-finance role in one fail-closed check.
        throw err('เฉพาะเจ้าหน้าที่การเงินเท่านั้นที่ตัดสินคำขออนุโลมได้', 403, 'WAIVER_APPROVER_ROLE');
    }
    if (request.requestedBy === user.id) {
        throw err('ผู้ยื่นเรื่องอนุมัติเรื่องของตัวเองไม่ได้', 403, 'WAIVER_SELF_APPROVAL');
    }
    // Hardening batch 2026-07-09: verify the LIVE User row, not just the JWT.
    // The batch lane (S2) already requires an ACTIVE waiver approver (either finance role); the HTTP
    // approve/deny lane trusted the token — a suspended/demoted accountant
    // whose deactivation skipped the sessionsRevokedAt stamp could keep
    // deciding waivers for up to the token TTL. approverSide lands in the
    // hash-chained audit trail, so the assertion must be true at decide time.
    if (!(await isActiveWaiverApprover(user.id, request.organizationId, role))) {
        throw err('เฉพาะเจ้าหน้าที่การเงินที่ยังปฏิบัติงานอยู่เท่านั้นที่ตัดสินคำขออนุโลมได้', 403, 'WAIVER_APPROVER_NOT_ACTIVE');
    }
    return role;
}

/**
 * A finance officer (either role) approves: the atomic 6-leg reopen.
 *  1. CAS — application is still EXPIRED
 *  2. settlement assert for the ORIGIN phase (fail-closed on HELD/FORFEITED)
 *  3. transition EXPIRED→origin as SYSTEM (assertTransition strict)
 *  4. restamp due-date twins with the holiday-aware engine (fresh 5 days)
 *  5. clear reminder stamps + expiry residue; re-seed RevisionDeadline
 *  6. mark the request APPROVED — all in ONE transaction with the hash-chain
 *     audit hook (missing any leg = re-expired within the hour or a stuck row).
 */
async function approveReopenRequest({ requestId, user, note }) {
    const request = await prisma.waiverReopenRequest.findFirst({ where: { id: requestId } });
    if (!request) { throw err('Reopen request not found', 404, 'NOT_FOUND'); }
    if (request.status !== 'PENDING') {
        throw err(`คำขอนี้ถูกตัดสินแล้ว (${request.status})`, 409, 'WAIVER_ALREADY_DECIDED');
    }
    // Tenant fail-closed (MUST-4 + carpet-bomb S3): the approver may only
    // decide requests of their own organization (anti-probe 404, mirrors #533
    // read-SoD). An approver with NO resolvable org fails CLOSED — the old
    // `user?.organizationId &&` short-circuit silently bypassed the wall.
    if (!user?.organizationId || request.organizationId !== user.organizationId) {
        throw err('Reopen request not found', 404, 'NOT_FOUND');
    }
    const approverRole = await assertApprover(user, request);

    const application = await prisma.application.findFirst({
        where: { id: request.applicationId, isDeleted: false },
    });
    if (!application) { throw err('Application not found', 404, 'NOT_FOUND'); }
    if (String(application.status).toUpperCase() !== 'EXPIRED') {
        // Race with an admin break-glass or another path — fail closed.
        throw err(`ใบสมัครไม่อยู่ในสถานะ EXPIRED แล้ว (${application.status})`, 409, 'WAIVER_STATE_DRIFT');
    }

    const origin = request.expiredFromState;
    if (!REOPENABLE_ORIGINS.has(origin)) {
        throw err(`Snapshot state ${origin} is not reopenable`, 409, 'WAIVER_ORIGIN_UNKNOWN');
    }

    // Leg 2 — the fee being reused must REALLY be settled for the origin phase.
    await assertPhaseSettledForOrigin(application.id, origin);

    const { dueAt } = await _executeReopen({
        request, application, origin,
        decidedBy: user.id,
        decisionNote: note,
        auditMetadata: {
            waiverRequestId: request.id,
            reasonCode: request.reasonCode,
            requestedBy: request.requestedBy,
            approvedBy: user.id,
            approverSide: approverSideOf(approverRole),
        },
    });

    logger.info(`[waiver] reopen APPROVED ${request.id}: ${application.applicationNumber} EXPIRED→${origin}, due ${dueAt.toISOString()}`);
    return { request: { ...request, status: 'APPROVED' }, application, origin, dueAt };
}

/**
 * The atomic reopen executor shared by the LENIENCY approval path and the
 * Q1 WRONGFUL_EXPIRY batch reinstate. One transaction, six legs — see the
 * approveReopenRequest doc block. `request` must be a PENDING row.
 */
async function _executeReopen({ request, application, origin, decidedBy, decisionNote, auditMetadata }) {
    const approverSide = auditMetadata.approverSide;
    const now = new Date();
    const nowIso = now.toISOString();
    const dueAt = addWorkingDays(now, SLA_DAYS); // Thai-holiday-aware, ICT (#646 engine)
    const dueIso = dueAt.toISOString();
    const formData = asObject(application.formData);
    const history = asArray(application.workflowHistory);

    const isCar = origin === 'CAR_PENDING';
    const dueStamps = isCar
        ? { carDueAt: dueIso, car_due_at: dueIso, carRequestedAt: nowIso, car_requested_at: nowIso }
        : { revisionDueAt: dueIso, revision_due_at: dueIso, revisionRequestedAt: nowIso, revision_requested_at: nowIso };

    const reopenEvent = {
        timestamp: nowIso,
        action: 'WAIVER_REOPEN',
        fromStatus: 'EXPIRED',
        toStatus: origin,
        waiverRequestId: request.id,
        reasonCode: request.reasonCode,
        requestedBy: request.requestedBy,
        approvedBy: decidedBy,
        approverSide,
    };

    await prisma.$transaction(async (tx) => {
        // Leg 6a — decide the request first INSIDE the tx. The where clause
        // includes status:'PENDING' (MUST-2): a racing decide (approve/deny)
        // that already flipped the row makes this update match 0 rows → P2025
        // → the whole reopen rolls back. Without the guard, a deny racing a
        // committed approve could flip APPROVED→DENIED, VACATING the
        // once-per-application partial-unique while the app stays reopened —
        // a later re-expiry would then permit a second reopen (ruling
        // violation). The LENIENCY partial-unique remains the backstop
        // against two concurrent leniency approves committing.
        await tx.waiverReopenRequest.update({
            where: { id: request.id, status: 'PENDING' },
            data: {
                status: 'APPROVED',
                decidedBy,
                decidedAt: now,
                approverSide,
                decisionNote: decisionNote ? maskThaiIdsInText(String(decisionNote).trim()) : null,
            },
        });

        // Hardening batch 2026-07-09: close the WAIVER_APPROVAL queue item
        // atomically with the decision (nothing else closes it — the writer
        // never cancels prior-stage activities). 0-row match = safe no-op
        // (batch lane + requests created before the queue item existed).
        await workActivityService.completeAdHocActivity({
            prisma: tx,
            applicationId: application.id,
            workType: 'WAIVER_APPROVAL',
            triggeredAtStage: 'EXPIRED',
            completedBy: decidedBy,
            note: 'WAIVER_APPROVED',
        });

        // Legs 1+3+4+5 — the canonical writer walks the SYSTEM-only edge with
        // strict assertion; expectedVersion CAS guards the EXPIRED read above.
        await writeApplicationStatus({
            prisma: tx,
            applicationId: application.id,
            fromStatus: 'EXPIRED',
            toStatus: origin,
            actorId: 'SYSTEM',
            actorRole: 'system',
            reason: `WAIVER_REOPEN:${request.reasonCode}`,
            assertTransition: true,
            expectedVersion: application.version,
            // No cert side effects can fire on these edges, but keep the
            // explicit guard for symmetry with the admin paths.
            autoIssueCertificate: false,
            onAudit: statusTransitionAuditHook({ tx, metadata: auditMetadata }),
            additionalData: {
                updatedBy: decidedBy,
                workflowHistory: [...history, reopenEvent],
                formData: {
                    ...formData,
                    ...dueStamps,
                    // fresh clock ⇒ re-arm BOTH reminder pairs + clear expiry residue
                    revisionReminder24hSentAt: null,
                    revisionReminder48hSentAt: null,
                    carReminder24hSentAt: null,
                    carReminder48hSentAt: null,
                    cancelReason: null,
                    canceledExpiredAt: null,
                    // Hardening batch 2026-07-09: the original clear covered only the
                    // cron.js/route-handler expiry lanes. Also null the checker-lane
                    // marker (_autoExpired — jobs/revision-deadline-checker.js) and the
                    // guard-lane pair (expiredAt/expiredReason — revision-deadline-guard),
                    // or a reinstated ACTIVE app permanently asserts a stale auto-expiry
                    // (misleads identify-wrongful-expiry-cohort's formData.expiredAt
                    // fallback + row forensics after a second expiry via another lane).
                    _autoExpired: null,
                    expiredAt: null,
                    expiredReason: null,
                    waiverReopenedAt: nowIso,
                    waiverRequestId: request.id,
                },
            },
        });

        // Leg 5b — re-seed the RevisionDeadline row the hourly checker scans
        // (@unique per application: update-or-create, never duplicate).
        await tx.revisionDeadline.upsert({
            where: { applicationId: application.id },
            update: { revisionDue: dueAt, status: 'PENDING', updatedBy: decidedBy },
            create: {
                applicationId: application.id,
                organizationId: application.organizationId,
                revisionDue: dueAt,
                status: 'PENDING',
                createdBy: decidedBy,
                updatedBy: decidedBy,
            },
        });
    });

    return { dueAt };
}

/**
 * Q1 platform-fault lane (owner ruling 2026-07-08): batch-reinstate
 * wrongfully-expired applications — "แพลตฟอร์มต้องไม่ได้กำไรจาก bug ตัวเอง".
 *
 * Differences from the LENIENCY path, by design:
 *   * NO farmer petition, NO inspector initiation, NO discretionary friction —
 *     the farmer did nothing wrong; the platform corrects itself proactively.
 *   * does NOT consume the once-per-application leniency (partial unique is
 *     LENIENCY-scoped; see 20260708060000 migration).
 *   * MANDATORY accountability trail: bugRef (which bug), batch approver
 *     (who), per-case rows + hash-chain audit metadata (how many) — the
 *     good-faith evidence if the batch is ever examined.
 *
 * Settlement/origin gates are IDENTICAL to the leniency path (fail-closed).
 * Per-application failures are isolated into `skipped` — one bad row must
 * not stop the rest of the cohort's remediation.
 */
async function batchReinstateWrongfulExpiry({ applicationIds, approver, bugRef, note, dryRun = false }) {
    if (!approver?.id) {
        throw err('batch approver is required (accountability trail)', 400, 'WAIVER_BATCH_APPROVER_REQUIRED');
    }
    const trimmedBugRef = String(bugRef || '').trim();
    if (!trimmedBugRef) {
        throw err('bugRef is required (which defect caused the wrongful expiry)', 400, 'WAIVER_BATCH_BUGREF_REQUIRED');
    }
    const ids = asArray(applicationIds).filter(Boolean);
    if (ids.length === 0) {
        throw err('applicationIds must be a non-empty array', 400, 'WAIVER_BATCH_EMPTY');
    }

    // S2 (adversarial verify): _executeReopen stamps approverSide into the
    // request row, workflowHistory, and hash-chained audit metadata — so the
    // approver MUST actually be an ACTIVE finance officer (either role —
    // operator 2026-09-27), or the tamper-evident trail asserts an approval
    // that never happened. Mirrors assertApprover minus the self-approval
    // check (the batch lane's requestedBy IS the approver by design —
    // platform self-correction).
    const approverRole = normalizeRole(approver.canonicalRole || approver.role);
    if (!APPROVER_ROLES.has(approverRole)
        || String(approver.status || '').toUpperCase() !== 'ACTIVE') {
        throw err('batch approver must be an ACTIVE finance officer', 403, 'WAIVER_BATCH_APPROVER_INVALID');
    }

    const report = {
        bugRef: trimmedBugRef, approver: approver.id, dryRun,
        reinstated: [], wouldReinstate: [], skipped: [],
    };

    // S7: honor a bound tenant context as an explicit org wall on the lookup
    // (MUST-4 doctrine — the service filter is the authoritative wall; the
    // ops script binds runWithTenantContext per org).
    const tenantCtx = getTenantContext();

    for (const appId of ids) {
        try {
            const application = await prisma.application.findFirst({
                where: {
                    OR: [{ id: appId }, { applicationNumber: appId }],
                    isDeleted: false,
                    ...(tenantCtx?.organizationId ? { organizationId: tenantCtx.organizationId } : {}),
                },
            });
            if (!application) { throw err(`Application ${appId} not found`, 404, 'NOT_FOUND'); }
            // L6 (security review 2026-09-27): the approver decides only for their
            // own organization — never cross-tenant, and never with no organization.
            if (!approver.organizationId || application.organizationId !== approver.organizationId) {
                throw err('batch approver must belong to the application\'s organization', 403, 'WAIVER_BATCH_APPROVER_INVALID');
            }
            if (String(application.status).toUpperCase() !== 'EXPIRED') {
                throw err(`ไม่อยู่ในสถานะ EXPIRED (${application.status})`, 409, 'WAIVER_NOT_EXPIRED');
            }
            const origin = deriveExpiredFromState(application);
            if (!origin) { throw err('origin state unknown', 409, 'WAIVER_ORIGIN_UNKNOWN'); }

            // Same fail-closed + refund-aware settlement gate as the leniency path.
            await assertPhaseSettledForOrigin(application.id, origin);

            // One open request at a time still applies (partial unique).
            const openPending = await prisma.waiverReopenRequest.findFirst({
                where: { applicationId: application.id, status: 'PENDING' },
                select: { id: true },
            });
            if (openPending) {
                throw err('มีคำขออนุโลมค้างอยู่ ตัดสินคำขอเดิมก่อน', 409, 'WAIVER_ALREADY_PENDING');
            }

            // S3 idempotency: this bug was already remediated for this app —
            // an unchanged cohort re-run (or a re-expiry for the farmer's own
            // reasons) must not re-reinstate under the same platform-fault
            // banner. A DIFFERENT bugRef still passes (owner: unlimited for
            // different platform faults). Checked before the dryRun branch so
            // previews surface it too.
            const alreadyRemediated = await prisma.waiverReopenRequest.findFirst({
                where: {
                    applicationId: application.id,
                    status: 'APPROVED',
                    reasonCode: 'WRONGFUL_EXPIRY',
                    decisionNote: `BATCH:${trimmedBugRef}`,
                },
                select: { id: true },
            });
            if (alreadyRemediated) {
                throw err(`bugRef ${trimmedBugRef} ถูกใช้คืนสถานะใบสมัครนี้ไปแล้ว`, 409, 'WAIVER_BUGREF_ALREADY_REMEDIATED');
            }

            if (dryRun) {
                report.wouldReinstate.push({
                    applicationNumber: application.applicationNumber,
                    origin,
                });
                continue;
            }

            const request = await prisma.waiverReopenRequest.create({
                data: {
                    organizationId: application.organizationId,
                    applicationId: application.id,
                    requestedBy: approver.id,
                    requesterRole: 'system_batch',
                    expiredFromState: origin,
                    reasonCode: 'WRONGFUL_EXPIRY',
                    reason: maskThaiIdsInText(
                        `PLATFORM-FAULT BATCH REINSTATE — bug: ${trimmedBugRef}` + (note ? ` | ${String(note).trim()}` : ''),
                    ),
                    status: 'PENDING',
                },
            });

            let dueAt;
            try {
                ({ dueAt } = await _executeReopen({
                    request, application, origin,
                    decidedBy: approver.id,
                    decisionNote: `BATCH:${trimmedBugRef}`,
                    auditMetadata: {
                        waiverRequestId: request.id,
                        reasonCode: 'WRONGFUL_EXPIRY',
                        batchRef: trimmedBugRef,
                        approvedBy: approver.id,
                        approverSide: approverSideOf(approverRole),
                    },
                }));
            } catch (execErr) {
                // S1 (adversarial verify): the PENDING row was created OUTSIDE
                // the reopen tx — if the tx fails (e.g. CAS conflict) that
                // orphan wedges the app: batch re-runs skip on
                // WAIVER_ALREADY_PENDING, the farmer's leniency petition 409s,
                // and the SLA job escalates it daily. Clean it up (guarded on
                // status PENDING so a racing decide is never deleted).
                await prisma.waiverReopenRequest
                    .deleteMany({ where: { id: request.id, status: 'PENDING' } })
                    .catch((cleanupErr) => {
                        logger.error(`[waiver] batch orphan-row cleanup failed for ${request.id}: ${cleanupErr?.message}`);
                    });
                throw execErr;
            }

            report.reinstated.push({
                applicationNumber: application.applicationNumber,
                origin,
                dueAt: dueAt.toISOString(),
                requestId: request.id,
            });
        } catch (e) {
            report.skipped.push({ applicationId: appId, code: e.code || 'ERROR', message: e.message });
        }
    }

    logger.info(`[waiver] WRONGFUL_EXPIRY batch (${trimmedBugRef}) by ${approver.id}${dryRun ? ' [DRY-RUN]' : ''}: reinstated=${report.reinstated.length} would=${report.wouldReinstate.length} skipped=${report.skipped.length}`);
    return report;
}

/** A finance officer (either role) denies (same gate); the request is closed with a note. */
async function denyReopenRequest({ requestId, user, note }) {
    const request = await prisma.waiverReopenRequest.findFirst({ where: { id: requestId } });
    if (!request) { throw err('Reopen request not found', 404, 'NOT_FOUND'); }
    if (request.status !== 'PENDING') {
        throw err(`คำขอนี้ถูกตัดสินแล้ว (${request.status})`, 409, 'WAIVER_ALREADY_DECIDED');
    }
    // Tenant fail-closed (MUST-4 + carpet-bomb S3): mirror the approve-side
    // org check — no org resolvable = fail CLOSED, never bypass.
    if (!user?.organizationId || request.organizationId !== user.organizationId) {
        throw err('Reopen request not found', 404, 'NOT_FOUND');
    }
    const approverRole = await assertApprover(user, request);
    const trimmed = String(note || '').trim();
    if (trimmed.length < 10) {
        throw err('ต้องระบุเหตุผลการปฏิเสธ (อย่างน้อย 10 ตัวอักษร)', 400, 'WAIVER_DENY_NOTE_REQUIRED');
    }

    // status:'PENDING' in the where (MUST-2): a deny racing a committed
    // approve matches 0 rows → P2025, instead of flipping APPROVED→DENIED
    // and vacating the once-per-application partial-unique.
    const updated = await prisma.waiverReopenRequest.update({
        where: { id: request.id, status: 'PENDING' },
        data: {
            status: 'DENIED',
            decidedBy: user.id,
            decidedAt: new Date(),
            approverSide: approverSideOf(approverRole),
            decisionNote: maskThaiIdsInText(trimmed),
        },
    });

    // Hardening batch 2026-07-09: close the WAIVER_APPROVAL queue item on deny
    // too (0-row match = safe no-op for legacy/pre-feature requests).
    // BEST-EFFORT (adversarial-verify note): this runs on the root client AFTER
    // the deny committed — an infra fault here must not 500 a deny that already
    // took effect. The lingering item self-heals (matched by tuple on the next
    // decide, or manually claimable/closable by any 'account'-group member).
    try {
        await workActivityService.completeAdHocActivity({
            prisma,
            applicationId: request.applicationId,
            workType: 'WAIVER_APPROVAL',
            triggeredAtStage: 'EXPIRED',
            completedBy: user.id,
            note: 'WAIVER_DENIED',
        });
    } catch (queueErr) {
        logger.warn(`[waiver] WAIVER_APPROVAL close failed (non-fatal) on deny ${request.id}: ${queueErr?.message}`);
    }

    logger.info(`[waiver] reopen DENIED ${request.id} by ${user.id}`);
    return { request: updated };
}

/**
 * Pending queue for the finance approval screen (both finance roles).
 * MUST-4: explicitly org-filtered here — WaiverReopenRequest read-scoping via
 * the tenant extension is flag-gated (ENT-01), so the service filter is the
 * authoritative wall (mirrors #533).
 */
async function listPendingReopenRequests({ organizationId } = {}) {
    // Carpet-bomb S3: fail CLOSED — without an org the old spread silently
    // returned EVERY org's pending queue (free-text contact evidence = PII).
    // Mirrors the finance sibling (payment-slips.js NO_ORGANIZATION 400).
    if (!organizationId) {
        throw err('organizationId is required for the pending queue', 400, 'NO_ORGANIZATION');
    }
    return prisma.waiverReopenRequest.findMany({
        where: {
            status: 'PENDING',
            organizationId,
        },
        orderBy: { createdAt: 'asc' },
        include: {
            application: {
                select: { id: true, applicationNumber: true, status: true },
            },
        },
    });
}

module.exports = {
    createReopenRequest,
    approveReopenRequest,
    denyReopenRequest,
    listPendingReopenRequests,
    batchReinstateWrongfulExpiry,
    deriveExpiredFromState,
    REOPENABLE_ORIGINS,
};
