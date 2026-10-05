/**
 * X2-FIX-D M-20 (DR-EXT-1 + DR-SOW-1) — per-application owner gate.
 *
 * Why this exists:
 *   X2-D audit (`docs/handoffs/iter-X2/X2-D.md` §6 + §8) flagged that
 *   the revision-deadline extension and SOW/checklist POST routes used
 *   the role-only `providerOnly` gate without checking whether the
 *   calling provider is assigned to the specific application. That
 *   meant any DOC_REVIEWER / AUDITOR / SCHEDULER / ACCOUNT_* user
 *   could extend deadlines or write SOWs against applications they
 *   were not the assigned reviewer / auditor for.
 *
 * Policy:
 *   - ADMIN always passes (break-glass + maintenance).
 *   - Otherwise the caller must hold one of:
 *       application.reviewerId === req.user.id        (assigned reviewer)
 *       application.auditorId  === req.user.id        (assigned auditor)
 *       formData.PROVIDERAssignment.reviewerId === req.user.id (legacy
 *           JSON path — pre-Wave A Phase 44 assignments).
 *   - Otherwise 403 with a Thai user-visible message that matches the
 *     REV-11 error string for consistency.
 *
 * Returns:
 *   - { ok: true, application } if the caller is allowed
 *   - { ok: false, status, body } if not — the route should
 *     `return res.status(status).json(body)` directly.
 *
 * This is a pure helper (no Express coupling) so the per-route handlers
 * can compose it with their existing validation / shape-coercion logic
 * without an additional middleware layer.
 */

'use strict';

const { CANONICAL_ROLES, normalizeRole } = require('./canonical-rbac');

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Resolve whether the caller is the assigned reviewer or auditor for the
 * application. Pass the Prisma row loaded with at least
 * `{ id, reviewerId, auditorId, formData }` (formData is optional).
 *
 * @param {object} application   Prisma Application row.
 * @param {object} user          Express req.user (must have id, canonicalRole|role).
 * @returns {{ ok: true } | { ok: false, status: number, body: object }}
 */
function assertCallerIsAssignedToApplication(application, user) {
    if (!application) {
        return {
            ok: false,
            status: 404,
            body: { success: false, error: 'Application not found' },
        };
    }

    const canonicalRole = normalizeRole(user?.canonicalRole || user?.role);
    if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM) {
        return { ok: true };
    }

    const callerId = user?.id;
    if (!callerId) {
        return {
            ok: false,
            status: 401,
            body: { success: false, error: 'Unauthorized' },
        };
    }

    if (application.reviewerId && application.reviewerId === callerId) {
        return { ok: true };
    }
    if (application.auditorId && application.auditorId === callerId) {
        return { ok: true };
    }

    // Legacy formData fallback — covers assignments made before Wave A
    // Phase 44 populated the canonical column. Matches the REV-11
    // fallback in workflow-transitions-handler.js:148-156. Accepts the
    // legacy id under either user.id (newer clients) or
    // user.providerId (older clients that wrote the providerId).
    const formData = asObject(application.formData);
    const PROVIDERAssignment = asObject(formData.PROVIDERAssignment);
    const legacyReviewerId = PROVIDERAssignment.reviewerId;
    if (legacyReviewerId) {
        if (legacyReviewerId === callerId) {
            return { ok: true };
        }
        if (user?.providerId && legacyReviewerId === user.providerId) {
            return { ok: true };
        }
    }

    return {
        ok: false,
        status: 403,
        body: {
            success: false,
            error: 'ไม่มีสิทธิ์ดำเนินการ คุณไม่ใช่ผู้ตรวจที่ได้รับมอบหมายสำหรับคำขอนี้',
        },
    };
}

module.exports = {
    assertCallerIsAssignedToApplication,
};
