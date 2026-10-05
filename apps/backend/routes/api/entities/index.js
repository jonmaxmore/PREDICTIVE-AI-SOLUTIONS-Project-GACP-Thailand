/**
 * Entities Domain — Wave C
 *
 * The holder entities a user belongs to: `GET /mine` (the step-1 holder
 * picker's list), entity create / update, member invite / revoke, and the
 * per-member permission admin. There is no active workspace: reads follow
 * membership and every filing names its holder (spec
 * 2026-09-30-remove-workspace-mode; `POST /me/switch` was removed in R2 Task 12).
 *
 * Authentication: every route here uses `authenticateAny`. Provider users
 * hold no memberships, so they get an empty list.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateAny } = require('../../../middleware/auth-middleware');
const { safeErrorMessage } = require('../../../shared/api-response');
const entityService = require('../../../services/entity-service');
const { getEffectiveEntityPermissions } = require('../../../services/entity-effective-permissions-service');
const { getRequestIp } = require('../../../utils/client-ip');
const logger = require('../../../shared/logger');

// Farm-worker Wave B chunk 5 — OWNER-only per-member permission admin.
// Mounted BEFORE the generic member routes below; mergeParams gives the
// sub-router :id + :memberUserId.
router.use('/:id/members/:memberUserId/permissions', require('./member-permissions'));

function getUserAgent(req) {
    const ua = req.headers['user-agent'];
    return ua ? String(ua) : null;
}

const NO_CAPABILITY = Object.freeze({ edit: false, submit: false, createFarm: false });

/**
 * R2 Task 8 (spec 2026-09-30-remove-workspace-mode §3.2): what the caller may do
 * on one /mine row, from the effective-permissions engine (role ∪ permissions[]
 * ∪ GRANT − REVOKE), so the step-1 holder picker can offer only real choices.
 *   edit       = an ACTIVE membership that is not VIEWER
 *   submit     = SUBMIT_APPLICATION in the effective set
 *   createFarm = FARM_CREATE in the effective set
 * A PENDING invite grants nothing; the engine fails closed on a lookup failure.
 * @param {string} userId
 * @param {{ id: string, role: string, membershipStatus: string }} row
 * @returns {Promise<{ edit: boolean, submit: boolean, createFarm: boolean }>}
 */
async function capabilityFlagsFor(userId, row) {
    if (row.membershipStatus !== 'ACTIVE') { return { ...NO_CAPABILITY }; }
    const { effective } = await getEffectiveEntityPermissions({ userId, entityId: row.id });
    return {
        edit: row.role !== 'VIEWER',
        submit: effective.includes(entityService.CAPABILITIES.SUBMIT_APPLICATION),
        createFarm: effective.includes(entityService.CAPABILITIES.FARM_CREATE),
    };
}

/**
 * GET /api/entities/mine
 *
 * List the authenticated user's active entity memberships, flattened so the
 * frontend can render the holder picker without a second query.
 *
 * Query params:
 *   include=pending — also include PENDING invitations
 *
 * Response:
 *   { success, data: [{ id, type, displayName, role, status, isPersonal,
 *                       organizationId, permissions: [], membershipStatus,
 *                       can: { edit, submit, createFarm } }] }
 */
router.get('/mine', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const includePending = String(req.query.include || '').toLowerCase().includes('pending');
        // WithHeal: lazily creates the personal INDIVIDUAL entity for HEALTH
        // users that were created outside the registration flow (seeds, e2e,
        // scripts) and therefore have zero memberships — see entity-service.
        const memberships = await entityService.listMembershipsForUserWithHeal({
            userId,
            healthId: req.user?.healthId || null,
            includePending,
        });

        const rows = await Promise.all(memberships.map(async (row) => ({
            ...row,
            can: await capabilityFlagsFor(userId, row),
        })));

        return res.json({ success: true, data: rows });
    } catch (error) {
        logger.error('[Entities Mine] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

// PR C-4 — workspace management surface

// M1.5 H2 — the three workspace endpoints below (POST / at :217, GET /:id at
// :260, PATCH /:id at :294) all shape their response here, so the national-ID
// mask goes in ONE place and covers all three by design. The create/update
// echoes are masked too: the caller just submitted those digits, so nothing is
// lost. The masked carriers are the ones presentEntityForMember names
// (thaiCitizenId, payload.director.idCard, payload.president.idCard).
// Masking itself lives at the service boundary — same convention, same helper
// family as listMembersForEntity (entity-service.js).
function shapeEntityResponse(entity, membership) {
    const safe = entityService.presentEntityForMember(entity);
    return {
        id: safe.id,
        type: safe.type,
        slug: safe.slug || null,
        displayName: safe.displayName,
        status: safe.status,
        organizationId: safe.organizationId,
        payload: safe.payload || null,
        juristicId: safe.juristicId || null,
        communityRegNo: safe.communityRegNo || null,
        thaiCitizenId: safe.thaiCitizenId || null,
        role: membership?.role || null,
        permissions: membership?.permissions || [],
        createdAt: safe.createdAt,
        updatedAt: safe.updatedAt,
    };
}

/**
 * GET /api/entities/invitations
 *
 * Wave D — list the caller's currently-PENDING workspace invitations
 * with the inviter's name and the role being offered. Drives the
 * "Pending invitations" section on /health/workspaces.
 *
 * NOTE: defined BEFORE `/:id` so Express doesn't treat "invitations"
 * as an entity id.
 *
 * Response: { success, data: Array<{
 *   entityId, slug, type, displayName, role, invitedAt,
 *   invitedBy: { id, displayName } | null
 * }> }
 */
router.get('/invitations', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}
        const data = await entityService.listPendingInvitations({ userId });
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Entities Invitations List] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * POST /api/entities
 *
 * Create a new JURISTIC or COMMUNITY_ENTERPRISE workspace. INDIVIDUAL
 * entities are auto-created at register; this endpoint refuses them.
 *
 * Body: { type: 'JURISTIC' | 'COMMUNITY_ENTERPRISE', applicantData: {...} }
 */
router.post('/', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}
        const orgId = req.user.organizationId;
        if (!orgId) {return res.status(400).json({ success: false, error: 'Missing organizationId on token' });}

        const { type, applicantData } = req.body || {};
        const result = await entityService.createWorkspaceEntity({
            user: { id: userId, organizationId: orgId },
            type,
            applicantData: applicantData || {},
        });

        return res.json({
            success: true,
            data: shapeEntityResponse(result.entity, { role: 'OWNER', permissions: entityService.defaultPermissionsFor('OWNER') }),
        });
    } catch (error) {
        if (error.code === 'APPLICANT_VALIDATION_FAILED') {
            return res.status(400).json({ success: false, error: 'Validation failed', validationErrors: error.validationErrors });
        }
        if (error.code === 'INVALID_WORKSPACE_TYPE') {
            return res.status(400).json({ success: false, error: error.message });
        }
        // M1.5 H1 — the registration number already belongs to a workspace the
        // caller does not own. Without this arm the refusal fell into the generic
        // catch below as a 500 and the front end could never show the real reason
        // (or the "ask the owner for an invite" way out). error.message is the
        // service's own Thai guidance and carries no registration number.
        if (error.status === 409 || error.code === 'ENTITY_ALREADY_REGISTERED') {
            return res.status(409).json({ success: false, code: error.code, error: error.message });
        }
        logger.error('[Entities Create] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * GET /api/entities/:id
 *
 * Look up an entity by id (UUID) or slug. Returns 404 unless the
 * caller has an ACTIVE membership — never 403 (no probing).
 */
router.get('/:id', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const idOrSlug = String(req.params.id || '').trim();
        // UUID-ish? else treat as slug.
        const isUuid = /^[0-9a-f-]{8}-[0-9a-f-]{4,}/i.test(idOrSlug);
        const found = await entityService.getEntityForMember({
            entityId: isUuid ? idOrSlug : null,
            slug: isUuid ? null : idOrSlug,
            userId,
        });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        return res.json({ success: true, data: shapeEntityResponse(found.entity, found.membership) });
    } catch (error) {
        logger.error('[Entities Get] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * PATCH /api/entities/:id
 *
 * Rename / update payload. Caller must have EDIT_ENTITY_PROFILE
 * (OWNER + ADMIN by default).
 *
 * Body: { displayName?, payload? }
 */
router.patch('/:id', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const found = await entityService.getEntityForMember({ entityId, userId });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        try {
            entityService.assertCapability(found.membership.role, 'EDIT_ENTITY_PROFILE', found.membership.permissions);
        } catch (_capErr) {
            return res.status(403).json({ success: false, error: 'Forbidden', capability: 'EDIT_ENTITY_PROFILE' });
        }

        const { displayName, payload } = req.body || {};
        const updated = await entityService.updateEntityProfile({ entityId, displayName, payload });
        if (!updated) {return res.status(400).json({ success: false, error: 'No changes provided' });}

        return res.json({ success: true, data: shapeEntityResponse(updated, found.membership) });
    } catch (error) {
        logger.error('[Entities Patch] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * GET /api/entities/:id/my-permissions
 *
 * Farm-worker Wave C chunk 1 — a member's SELF-view of their own effective
 * farm-operation permissions. The Wave-B admin GET
 * (…/members/:memberUserId/permissions) is OWNER-only, so a worker cannot
 * read their own effective set — but the FE needs it to gate operation
 * buttons (BE stays authoritative; this is UX-only visibility).
 *
 * Guards: requester must hold an ACTIVE membership on :id → 404 otherwise
 * (anti-probing, same convention as the sibling member routes).
 *
 * Response: { entityId, role, personal, effective } — REUSES
 * getEffectiveEntityPermissions (grants applied live, REVOKE wins; the S7
 * withoutTenantScope grant read lives inside the engine). NO grants
 * breakdown here — that stays the OWNER's admin view.
 *
 * `personal` = the requester's OWN personal INDIVIDUAL entity (role OWNER
 * on an INDIVIDUAL entity — the exact Wave-A S1 predicate the
 * removed active-entity middleware used). A worker invited INTO someone else's
 * INDIVIDUAL entity gets personal:false (real workspace, by design).
 */
router.get('/:id/my-permissions', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const found = await entityService.getEntityForMember({ entityId, userId });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        const { effective } = await getEffectiveEntityPermissions({ userId, entityId });

        const personal =
            found.membership.role === 'OWNER' && found.entity.type === 'INDIVIDUAL';

        return res.json({
            success: true,
            data: {
                entityId,
                role: found.membership.role,
                personal,
                effective,
            },
        });
    } catch (error) {
        logger.error('[Entities MyPermissions] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * GET /api/entities/:id/members
 *
 * List members of an entity. Caller must be a member.
 */
router.get('/:id/members', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const found = await entityService.getEntityForMember({ entityId, userId });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        const data = await entityService.listMembersForEntity({ entityId });
        return res.json({ success: true, data });
    } catch (error) {
        logger.error('[Entities Members List] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * POST /api/entities/:id/members
 *
 * Invite a new member by healthId (primary), email, or phone.
 *
 * Body: {
 *   inviteIdentifier: { type: 'healthId' | 'email' | 'phone', value: string },
 *   role: 'ADMIN' | 'MANAGER' | 'VIEWER'
 * }
 *
 * The OWNER role cannot be granted via invite — transfer-ownership is
 * a separate flow (Wave D). Caller must have INVITE_MEMBER capability.
 */
router.post('/:id/members', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const found = await entityService.getEntityForMember({ entityId, userId });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        try {
            entityService.assertCapability(found.membership.role, 'INVITE_MEMBER', found.membership.permissions);
        } catch (_capErr) {
            return res.status(403).json({ success: false, error: 'Forbidden', capability: 'INVITE_MEMBER' });
        }

        const { inviteIdentifier, role } = req.body || {};
        const upperRole = String(role || '').trim().toUpperCase();
        if (!['ADMIN', 'MANAGER', 'VIEWER'].includes(upperRole)) {
            return res.status(400).json({ success: false, error: 'role must be ADMIN | MANAGER | VIEWER (OWNER granted via transfer-ownership only)' });
        }

        // ADMIN can invite MANAGER + VIEWER, but NOT another ADMIN.
        if (upperRole === 'ADMIN' && found.membership.role !== 'OWNER') {
            return res.status(403).json({ success: false, error: 'Only OWNER can invite ADMIN' });
        }

        const resolved = await entityService.findInviteeByIdentifier(inviteIdentifier || {});
        if (!resolved) {
            return res.status(404).json({ success: false, error: 'Invitee not found', identifier: inviteIdentifier });
        }
        if (resolved.ambiguous) {
            return res.status(409).json({
                success: false,
                error: 'Multiple users match this identifier — use a citizen ID or contact admin',
                code: 'AMBIGUOUS_INVITEE',
            });
        }

        const membership = await entityService.addMember({
            entityId,
            userId: resolved.user.id,
            role: upperRole,
            invitedBy: userId,
            // Wave D — pass request context so the INVITED / ROLE_CHANGED
            // audit row written inside addMember's transaction carries
            // IP + UA for compliance.
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
        });

        // External-services cleanup T1 (2026-08-19, operator decision
        // shared/notification-view.js:16-19): the email-out courtesy nudge
        // was DELETED. The in-app /health/workspaces pending-invite list
        // (the `membership` row above) is the sole authoritative invite
        // channel — it was already true per the comment this replaced.

        return res.json({
            success: true,
            data: {
                membershipId: membership.id,
                userId: membership.userId,
                role: membership.role,
                permissions: membership.permissions,
                status: membership.status,
                invitedBy: membership.invitedBy,
                invitedAt: membership.invitedAt,
            },
        });
    } catch (error) {
        if (error.code === 'INVALID_INVITE_CHANNEL') {
            return res.status(400).json({ success: false, error: error.message });
        }
        // Mirrors the DELETE handler's CANNOT_REVOKE_OWNER response below: the
        // OWNER row is not editable through the member endpoints at all, in
        // either direction. Same 409, so the UI can treat them alike.
        if (error.code === 'CANNOT_DEMOTE_OWNER') {
            return res.status(409).json({ success: false, error: error.message, code: 'CANNOT_DEMOTE_OWNER' });
        }
        logger.error('[Entities Invite] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * DELETE /api/entities/:id/members/:userId
 *
 * Revoke a member. OWNER cannot be revoked — transfer-ownership first.
 * Caller must have REVOKE_MEMBER capability.
 */
router.delete('/:id/members/:memberUserId', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const memberUserId = String(req.params.memberUserId || '').trim();

        const found = await entityService.getEntityForMember({ entityId, userId });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        try {
            entityService.assertCapability(found.membership.role, 'REVOKE_MEMBER', found.membership.permissions);
        } catch (_capErr) {
            return res.status(403).json({ success: false, error: 'Forbidden', capability: 'REVOKE_MEMBER' });
        }

        const result = await entityService.revokeMember({
            entityId,
            userId: memberUserId,
            actorUserId: userId,
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
        });
        if (!result) {
            return res.status(404).json({ success: false, error: 'Membership not found' });
        }

        return res.json({ success: true, data: { revoked: true, membershipId: result.id } });
    } catch (error) {
        if (error.code === 'CANNOT_REVOKE_OWNER' || /cannot revoke OWNER/.test(error.message || '')) {
            return res.status(409).json({ success: false, error: error.message, code: 'CANNOT_REVOKE_OWNER' });
        }
        logger.error('[Entities Revoke] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * POST /api/entities/:id/transfer-ownership
 *
 * Wave D — transfer the OWNER role to another active member of the
 * entity. The caller (current OWNER) is demoted to ADMIN; the target
 * is promoted to OWNER. Both updates land in a single Prisma
 * transaction so the entity is never owner-less mid-transfer.
 *
 * Body: { toUserId: string }  — the User.id of the incoming OWNER.
 *
 * Failure codes:
 *   400 SAME_USER            — toUserId equals caller
 *   400 MISSING_TARGET       — body missing toUserId
 *   403 CAPABILITY_DENIED    — caller is not OWNER (TRANSFER_OWNERSHIP)
 *   404 NOT_FOUND            — entity not found, or caller not a member
 *   409 NOT_OWNER            — caller's role is not OWNER (defensive,
 *                              TRANSFER_OWNERSHIP gate already covers
 *                              this but we double-check inside the txn)
 *   409 TARGET_NOT_MEMBER    — toUserId is not an active member
 *   409 TARGET_ALREADY_OWNER — defensive
 */
router.post('/:id/transfer-ownership', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const toUserId = String(req.body?.toUserId || '').trim();
        if (!toUserId) {
            return res.status(400).json({
                success: false,
                error: 'toUserId is required',
                code: 'MISSING_TARGET',
            });
        }
        if (toUserId === userId) {
            return res.status(400).json({
                success: false,
                error: 'cannot transfer ownership to yourself',
                code: 'SAME_USER',
            });
        }

        const found = await entityService.getEntityForMember({ entityId, userId });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        try {
            entityService.assertCapability(
                found.membership.role,
                'TRANSFER_OWNERSHIP',
                found.membership.permissions,
            );
        } catch (_capErr) {
            return res.status(403).json({
                success: false,
                error: 'Forbidden',
                code: 'CAPABILITY_DENIED',
                capability: 'TRANSFER_OWNERSHIP',
            });
        }

        const result = await entityService.transferOwnership({
            entityId,
            fromUserId: userId,
            toUserId,
            // Wave D — pass request context so the audit row written
            // inside the same transaction has IP + UA for compliance.
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
        });

        return res.json({
            success: true,
            data: {
                fromMembership: { id: result.from.id, userId: result.from.userId, role: result.from.role },
                toMembership: { id: result.to.id, userId: result.to.userId, role: result.to.role },
            },
        });
    } catch (error) {
        // entity-service helper throws with stable .code on the
        // domain failure cases — surface them as 4xx instead of 500.
        if (error.code === 'NOT_OWNER'
            || error.code === 'TARGET_NOT_MEMBER'
            || error.code === 'TARGET_ALREADY_OWNER'
            || error.code === 'SAME_USER') {
            return res.status(409).json({
                success: false,
                error: error.message,
                code: error.code,
            });
        }
        logger.error('[Entities TransferOwnership] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * POST /api/entities/:id/accept-invitation
 *
 * Wave D — invitee converts their own PENDING membership row to
 * ACTIVE. No capability gate (the row is theirs); 401 only if not
 * authenticated. Writes ACCEPTED audit row inside the same
 * transaction as the status flip.
 *
 * Failure codes:
 *   404 NOT_INVITED    — caller has no membership on this entity
 *   409 NOT_PENDING    — membership exists but is ACTIVE / REVOKED
 */
router.post('/:id/accept-invitation', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const updated = await entityService.acceptInvitation({
            entityId,
            userId,
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
        });
        return res.json({
            success: true,
            data: {
                membershipId: updated.id,
                role: updated.role,
                status: updated.status,
                acceptedAt: updated.acceptedAt,
            },
        });
    } catch (error) {
        if (error.code === 'NOT_INVITED') {
            return res.status(404).json({ success: false, error: error.message, code: error.code });
        }
        if (error.code === 'NOT_PENDING') {
            return res.status(409).json({
                success: false, error: error.message, code: error.code, status: error.status,
            });
        }
        logger.error('[Entities Accept] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * POST /api/entities/:id/decline-invitation
 *
 * Wave D — invitee rejects their own PENDING membership. Sets
 * status=REVOKED with metadata.reason='DECLINED' so the audit log
 * distinguishes "admin revoked" from "invitee declined". Same
 * failure codes as accept-invitation.
 */
router.post('/:id/decline-invitation', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const updated = await entityService.declineInvitation({
            entityId,
            userId,
            ipAddress: getRequestIp(req),
            userAgent: getUserAgent(req),
        });
        return res.json({
            success: true,
            data: { membershipId: updated.id, status: updated.status },
        });
    } catch (error) {
        if (error.code === 'NOT_INVITED') {
            return res.status(404).json({ success: false, error: error.message, code: error.code });
        }
        if (error.code === 'NOT_PENDING') {
            return res.status(409).json({
                success: false, error: error.message, code: error.code, status: error.status,
            });
        }
        logger.error('[Entities Decline] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * GET /api/entities/:id/audit-log
 *
 * Wave D — return the recent membership-lifecycle events for the
 * entity (transfer-ownership, plus invite / revoke once those writers
 * are wired). Used by the workspace UI's "Recent activity" panel and
 * by compliance review.
 *
 * Caller must be an active member of the entity. No capability gate
 * beyond that: any member can see who joined / left / transferred.
 * If we add finer-grained controls later (e.g., hide IPs from VIEWER),
 * gate here.
 *
 * Query params:
 *   ?limit=N (default 50, hard cap 200)
 *
 * Response: { success, data: Array<{
 *   id, createdAt, eventType,
 *   actor: { id, healthId, displayName } | null,
 *   target: { id, healthId, displayName } | null,
 *   metadata: Json | null,
 *   ipAddress, userAgent
 * }> }
 */
router.get('/:id/audit-log', authenticateAny, async (req, res) => {
    try {
        const userId = req.user?.id || req.user?.userId;
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}

        const entityId = String(req.params.id || '').trim();
        const found = await entityService.getEntityForMember({ entityId, userId });
        if (!found) {return res.status(404).json({ success: false, error: 'Not Found' });}

        const events = await entityService.listMembershipEvents({
            entityId,
            limit: req.query.limit,
        });
        return res.json({ success: true, data: events });
    } catch (error) {
        logger.error('[Entities AuditLog] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

module.exports = router;
