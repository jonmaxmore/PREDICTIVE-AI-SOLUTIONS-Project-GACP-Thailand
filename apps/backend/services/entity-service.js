// Domain: Entity helpers (Phase 67) — see plan
// the entity-model design note.
//
// Thin service layer over Prisma for the Entity / EntityMembership models
// added in Phase 62. Phase 67 introduces just enough to support:
//   - register flow: create personal INDIVIDUAL entity + OWNER membership
//   - future use cases (wizard, farm management, delegation) get
//     dedicated helpers as they land.
//
// Permission resolution intentionally lives in this single file so the
// EntityServiceDelegation extension (Phase 2 of plan) has one place to
// hook into.

'use strict';

const crypto = require('crypto');
const { prisma } = require('./prisma-database');
const { findUserByHealthIdSecurely } = require('./user-lookup-service');
const { computeLookupHmac, maskThaiIdsInText, maskThaiId } = require('../utils/field-encryption');
// S7 — grant reads/writes are ENTITY-dimension operations: every write
// stamps organizationId explicitly from the membership row (= the entity's
// org), so they run without the tenant scope. Otherwise (a) the tenant
// extension's CROSS_TENANT_WRITE guard 500s a cross-org OWNER's admin-API
// write, and (b) under TENANT_READ_ORG_SCOPE=true the grant snapshot reads
// get org-filtered to the CALLER's org and come back empty.
const { withoutTenantScope } = require('./tenant-context');
// M1.5 H1 — refusing a workspace claim is a security event, not a validation
// error: the row is how an admin later separates a squat attempt from a member
// fumbling the create form. ResourceType has no ENTITY member, so SYSTEM +
// resourceId=<entity id> keeps the write inside the documented vocabulary
// (middleware/audit-logger.js:59-67).
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');
const logger = require('../shared/logger');
// User.role vocabulary (canonical, lowercase) — distinct from the ROLES
// constant below, which is the EntityMember.role vocabulary (OWNER/ADMIN/…).
const { CANONICAL_ROLES, normalizeRole } = require('../shared/canonical-rbac');

// STAGE B2 (detokenize RFC) — keyed-HMAC lookup substrate for the personal
// INDIVIDUAL entity's national ID. Reuse the SAME `AUTH_LOOKUP_USE_HMAC` switch
// as the H-4 user-lookup (it is the same "use keyed HMAC for national-ID lookup"
// decision; already true on prod+staging). Flag OFF = today's unkeyed-SHA-256
// `thaiCitizenIdHash` behaviour, byte-for-byte.
function useHmacLookup() {
    return process.env.AUTH_LOOKUP_USE_HMAC === 'true';
}

const TYPES = Object.freeze({
    INDIVIDUAL: 'INDIVIDUAL',
    JURISTIC: 'JURISTIC',
    COMMUNITY_ENTERPRISE: 'COMMUNITY_ENTERPRISE',
});

const ROLES = Object.freeze({
    OWNER: 'OWNER',
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    VIEWER: 'VIEWER',
});

/**
 * Wave C PR-4 — canonical capability codes layered on top of the four
 * coarse roles. Every action gated by an entity-context check looks up
 * a code in this table and asks `assertCapability(role, code)`.
 *
 * The codes are stable strings; the role-to-codes map is documented
 * defaults that ensure*Entity / addMember seed onto
 * EntityMembership.permissions. A grant can be customised per-member
 * by mutating the permissions[] string array — same pattern as
 * Slack's per-channel custom permissions.
 *
 * Promote to a CustomRole table only when there's real pressure to
 * customise beyond the defaults — Wave D problem at the earliest.
 */
const CAPABILITIES = Object.freeze({
    SUBMIT_APPLICATION:    'SUBMIT_APPLICATION',
    APPROVE_APPLICATION:   'APPROVE_APPLICATION',
    PRINT_QR:              'PRINT_QR',
    EDIT_FARM:             'EDIT_FARM',
    INVITE_MEMBER:         'INVITE_MEMBER',
    REVOKE_MEMBER:         'REVOKE_MEMBER',
    VIEW_FINANCIAL:        'VIEW_FINANCIAL',
    EDIT_ENTITY_PROFILE:   'EDIT_ENTITY_PROFILE',
    TRANSFER_OWNERSHIP:    'TRANSFER_OWNERSHIP',
    DELETE_ENTITY:         'DELETE_ENTITY',

    // Farm-worker Wave B (plan doc farm-worker-permissions-plan-2026-07-02) —
    // farm-OPERATION codes mapped to real cultivation endpoints. FARM_EDIT
    // intentionally REUSES the pre-existing EDIT_FARM code above (no synonym).
    // BINDING: no FARM_DELETE / draft-delete code — destructive ops stay
    // owner-only in code (resolveFarmOwnerAccess / strict applicant pin).
    FARM_CREATE:           'FARM_CREATE',            // POST /farms (workspace context)
    CYCLE_CREATE:          'CYCLE_CREATE',           // POST /planting-cycles + plot create/delete (cycle-prep)
    UNIT_MANAGE:           'UNIT_MANAGE',            // plant-units generate/confirm/reconcile ("ลงแปลงปลูก")
    ACTIVITY_IRRIGATION:   'ACTIVITY_IRRIGATION',    // POST /:id/activities per-type (owner decision)
    ACTIVITY_FERTILIZER:   'ACTIVITY_FERTILIZER',
    ACTIVITY_PEST_CONTROL: 'ACTIVITY_PEST_CONTROL',
    ACTIVITY_WEED_CONTROL: 'ACTIVITY_WEED_CONTROL',
    ACTIVITY_INSPECTION:   'ACTIVITY_INSPECTION',
    ACTIVITY_INCIDENT:     'ACTIVITY_INCIDENT',
    ACTIVITY_OTHER:        'ACTIVITY_OTHER',
    HARVEST_RECORD:        'HARVEST_RECORD',         // POST /:id/harvest-batches (+ legacy /:id/harvest)
    QR_GENERATE:           'QR_GENERATE',            // plot-cycle QR generate
    RECORDS_MANAGE:        'RECORDS_MANAGE',         // site-analyses / training-records writes
    REPORT_SUBMIT:         'REPORT_SUBMIT',          // report-submissions
});

/**
 * Farm-worker Wave B — the grantable farm-operation taxonomy. This is the
 * ONLY set the OWNER permission admin API may GRANT/REVOKE per member
 * (workspace-management codes like INVITE_MEMBER stay role-bound in v1).
 * EDIT_FARM is included because it IS the farm-edit operation code.
 *
 * M1 D6 (2026-08-15): SUBMIT_APPLICATION joined this set so an OWNER can hand
 * the right to submit to ONE named member (AC3) — the permission-admin API
 * accepts only members of this set (member-permissions.js:194,251). Being
 * grantable is NOT the same as being a role default: see NOT_A_ROLE_DEFAULT
 * below, which keeps it out of the MANAGER bundle.
 */
const FARM_OPERATION_CAPABILITIES = Object.freeze([
    CAPABILITIES.FARM_CREATE,
    CAPABILITIES.EDIT_FARM,
    CAPABILITIES.SUBMIT_APPLICATION,
    CAPABILITIES.CYCLE_CREATE,
    CAPABILITIES.UNIT_MANAGE,
    CAPABILITIES.ACTIVITY_IRRIGATION,
    CAPABILITIES.ACTIVITY_FERTILIZER,
    CAPABILITIES.ACTIVITY_PEST_CONTROL,
    CAPABILITIES.ACTIVITY_WEED_CONTROL,
    CAPABILITIES.ACTIVITY_INSPECTION,
    CAPABILITIES.ACTIVITY_INCIDENT,
    CAPABILITIES.ACTIVITY_OTHER,
    CAPABILITIES.HARVEST_RECORD,
    CAPABILITIES.QR_GENERATE,
    CAPABILITIES.RECORDS_MANAGE,
    CAPABILITIES.REPORT_SUBMIT,
]);

/**
 * Grantable codes that must NEVER reach a role bundle through the spreads
 * below. A role that holds one lists it EXPLICITLY (OWNER/ADMIN do).
 *
 * SUBMIT_APPLICATION is here because the two properties are independent: it is
 * grantable per-member (M1 D6) while the standing owner decision keeps it off
 * MANAGER — "MANAGER can fill the wizard / save drafts but not submit"
 * (applications.js:516-518, pinned by applications-submit-capability-gate.test.js:158-163).
 * Without this exclusion the FARM_OPERATION_CAPABILITIES spread would have
 * silently granted every manager the right to submit.
 */
const NOT_A_ROLE_DEFAULT = Object.freeze([CAPABILITIES.SUBMIT_APPLICATION]);
const isRoleDefaultFarmOperation = (c) => !NOT_A_ROLE_DEFAULT.includes(c);

// MANAGER farm-operation defaults = everything except FARM_CREATE + EDIT_FARM
// (owner decision, plan line 22 — "MANAGER = ทั้งหมดยกเว้น FARM_EDIT/FARM_CREATE")
// and except the never-a-default codes above.
const MANAGER_FARM_OPERATIONS = Object.freeze(
    FARM_OPERATION_CAPABILITIES.filter(
        (c) => c !== CAPABILITIES.FARM_CREATE
            && c !== CAPABILITIES.EDIT_FARM
            && isRoleDefaultFarmOperation(c),
    ),
);

// OWNER/ADMIN hold every farm-operation code; EDIT_FARM and the
// never-a-default codes are listed explicitly in their bundles, so the spread
// drops them here rather than emitting the same string twice.
const OWNER_ADMIN_FARM_OPERATIONS = Object.freeze(
    FARM_OPERATION_CAPABILITIES.filter(
        (c) => c !== CAPABILITIES.EDIT_FARM && isRoleDefaultFarmOperation(c),
    ),
);

const DEFAULT_PERMISSIONS_BY_ROLE = Object.freeze({
    OWNER: Object.freeze([
        CAPABILITIES.SUBMIT_APPLICATION,
        CAPABILITIES.APPROVE_APPLICATION,
        CAPABILITIES.PRINT_QR,
        CAPABILITIES.EDIT_FARM,
        CAPABILITIES.INVITE_MEMBER,
        CAPABILITIES.REVOKE_MEMBER,
        CAPABILITIES.VIEW_FINANCIAL,
        CAPABILITIES.EDIT_ENTITY_PROFILE,
        CAPABILITIES.TRANSFER_OWNERSHIP,
        CAPABILITIES.DELETE_ENTITY,
        // Wave B — OWNER holds every farm-operation code.
        ...OWNER_ADMIN_FARM_OPERATIONS,
    ]),
    ADMIN: Object.freeze([
        CAPABILITIES.SUBMIT_APPLICATION,
        CAPABILITIES.PRINT_QR,
        CAPABILITIES.EDIT_FARM,
        CAPABILITIES.INVITE_MEMBER,
        CAPABILITIES.REVOKE_MEMBER,
        CAPABILITIES.VIEW_FINANCIAL,
        CAPABILITIES.EDIT_ENTITY_PROFILE,
        // Wave B — ADMIN holds every farm-operation code.
        ...OWNER_ADMIN_FARM_OPERATIONS,
    ]),
    // Wave B — EDIT_FARM REMOVED from MANAGER per the binding owner decision
    // (plan line 22). It was defined-but-UNENFORCED before Wave B, so no
    // behaviour changes for any pre-Wave-B consumer. NOTE: memberships seeded
    // BEFORE this change carry EDIT_FARM in their legacy permissions[] array;
    // the Wave-B engine unions that array in, so pre-existing MANAGER rows
    // keep farm-edit until the OWNER REVOKEs it (REVOKE wins over legacy).
    MANAGER: Object.freeze([
        CAPABILITIES.PRINT_QR,
        ...MANAGER_FARM_OPERATIONS,
    ]),
    VIEWER: Object.freeze([]),
});

/**
 * Resolve whether a (role, capability) tuple is permitted under the
 * defaults. `permissions` overrides (a granular array on
 * EntityMembership) extend or restrict on top of this — caller passes
 * the array if it wants the membership-specific check.
 */
function assertCapability(role, capability, permissions) {
    if (!role) {
        const err = new Error('Capability check requires a role');
        err.code = 'CAPABILITY_DENIED';
        throw err;
    }
    if (Array.isArray(permissions) && permissions.includes(capability)) {
        return true;
    }
    const defaults = DEFAULT_PERMISSIONS_BY_ROLE[role];
    if (defaults && defaults.includes(capability)) {
        return true;
    }
    const err = new Error(`role ${role} lacks capability ${capability}`);
    err.code = 'CAPABILITY_DENIED';
    err.role = role;
    err.capability = capability;
    throw err;
}

function defaultPermissionsFor(role) {
    return [...(DEFAULT_PERMISSIONS_BY_ROLE[role] || [])];
}

function hashIdentifier(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function buildDisplayName(parts) {
    const { firstName, lastName, fallback } = parts || {};
    const full = `${(firstName || '').trim()} ${(lastName || '').trim()}`.trim();
    return full || fallback || 'Unnamed Entity';
}

/**
 * Slugify an arbitrary string for URL routing
 * (/health/workspaces/{slug}/...). Matches the SQL backfill in
 * 20260502010000_add_entity_slug/migration.sql:
 *   - lowercase
 *   - non-[a-z0-9] runs collapsed to '-'
 *   - leading / trailing '-' stripped
 *   - empty / Thai-only inputs return null so the caller can decide
 *     a fallback (typically 'entity-' + idPrefix)
 */
function slugify(value) {
    const base = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-+)|(-+$)/g, '');
    return base || null;
}

/**
 * Find the next available slug for `displayName`, optionally excluding
 * an entity id (so a rename doesn't collide with itself).
 *
 * Strategy: slugify(displayName) → if no collision, use it. Otherwise
 * append -2, -3, … until free. Same algorithm as the SQL backfill.
 */
async function nextAvailableSlug({ displayName, fallbackIdPrefix, excludeEntityId, tx }) {
    const client = tx || prisma;
    let base = slugify(displayName);
    if (!base) {
        base = `entity-${(fallbackIdPrefix || '').slice(0, 8) || 'unknown'}`;
    }
    let candidate = base;
    let suffix = 1;
    while (true) {
        const where = excludeEntityId
            ? { slug: candidate, NOT: { id: excludeEntityId } }
            : { slug: candidate };
        const existing = await client.entity.findFirst({ where, select: { id: true } });
        if (!existing) {return candidate;}
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }
}

/**
 * Find or create a personal INDIVIDUAL entity for a User, plus an OWNER
 * membership linking them. Idempotent — safe to call from any code path
 * that needs to ensure the user has a personal entity (registration,
 * profile completion, backfill).
 *
 * Pass an explicit `tx` (PrismaTransactionClient) when the caller is
 * already inside a transaction; otherwise this opens its own.
 *
 * @param {object} args
 * @param {object} args.user — must include id, healthId, organizationId, firstName, lastName, email
 * @param {import('@prisma/client').Prisma.TransactionClient} [args.tx]
 * @param {boolean} [args.isNewUser] — the caller just created this User row in
 *   this same transaction. Skips the OWNER-membership probe, which is provably
 *   empty for a user id that did not exist a statement ago (F-QA-01: one fewer
 *   cross-region round trip on every registration). The national-ID dedup
 *   lookup still runs — an entity can pre-exist the user.
 * @returns {Promise<{ entity: object, membership: object, fresh: boolean }>}
 */
async function ensurePersonalIndividualEntity({ user, tx, isNewUser = false }) {
    if (!user || !user.id) {
        throw new Error('user.id is required');
    }
    if (!user.healthId) {
        throw new Error('user.healthId is required to create a personal INDIVIDUAL entity');
    }
    if (!user.organizationId) {
        throw new Error('user.organizationId is required (ADR-014)');
    }

    const client = tx || prisma;
    const idHash = hashIdentifier(user.healthId);
    // STAGE B2 — keyed HMAC of the national ID, dual-written alongside the
    // legacy unkeyed `thaiCitizenIdHash` so the keyed-dedup lookup has a value
    // to find. computeLookupHmac matches User.healthIdHmac (H-4 Phase 1).
    const idHmac = computeLookupHmac(user.healthId);

    // STAGE B2 — prefer the stable EntityMembership(userId, OWNER, INDIVIDUAL)
    // link to resolve THIS user's existing personal entity. User.id is stable +
    // non-PII, so this removes the national-ID-hash dependency on the common
    // re-call path (registration self-heal etc.) and is flag-independent.
    // Wave B chunk 6 (drill-flagged): stable ordering — oldest row wins, so
    // duplicate candidates always resolve the same personal entity.
    const ownerMembership = isNewUser ? null : await client.entityMembership.findFirst({
        where: {
            userId: user.id,
            role: ROLES.OWNER,
            entity: { type: TYPES.INDIVIDUAL, isDeleted: false },
        },
        select: { entity: true },
        orderBy: { createdAt: 'asc' },
    });
    let entity = ownerMembership?.entity || null;

    if (!entity) {
        // No membership link yet (first create, or an entity backfilled without
        // a membership row). Fall back to the dedup hash lookup keyed on the
        // national ID — this is the one site where a hash lookup is genuinely
        // needed (the @@unique([type, thaiCitizenId*]) dedup invariant). Use the
        // keyed `thaiCitizenIdHmac` when the flag is on, else the legacy unkeyed
        // `thaiCitizenIdHash` (byte-for-byte today's behaviour). Guard the hmac
        // branch on a non-null value so an un-backfilled NULL column never
        // matches a NULL row.
        const dedupWhere = useHmacLookup() && idHmac
            ? { type: TYPES.INDIVIDUAL, thaiCitizenIdHmac: idHmac }
            : { type: TYPES.INDIVIDUAL, thaiCitizenIdHash: idHash };
        // Wave B chunk 6 — stable ordering (see ownerMembership note above).
        entity = await client.entity.findFirst({ where: dedupWhere, orderBy: { createdAt: 'asc' } });
    }

    let fresh = false;
    if (!entity) {
        const displayName = buildDisplayName({
            firstName: user.firstName,
            lastName: user.lastName,
            fallback: user.email || user.healthId,
        });
        const slug = await nextAvailableSlug({
            displayName,
            fallbackIdPrefix: user.id,
            tx: client,
        });
        entity = await client.entity.create({
            data: {
                type: TYPES.INDIVIDUAL,
                displayName,
                slug,
                thaiCitizenId: user.healthId,
                thaiCitizenIdHash: idHash,
                // STAGE B2 — additive dual-write; keep writing the legacy unkeyed
                // hash for back-compat / rollback (B3 drops it).
                thaiCitizenIdHmac: idHmac,
                status: 'ACTIVE',
                createdBy: user.id,
                organizationId: user.organizationId,
            },
        });
        fresh = true;
    }

    const membership = await client.entityMembership.upsert({
        where: { userId_entityId: { userId: user.id, entityId: entity.id } },
        update: { role: ROLES.OWNER, status: 'ACTIVE', acceptedAt: new Date() },
        create: {
            userId: user.id,
            entityId: entity.id,
            role: ROLES.OWNER,
            permissions: defaultPermissionsFor(ROLES.OWNER),
            status: 'ACTIVE',
            invitedBy: null,
            invitedAt: null,
            acceptedAt: new Date(),
            organizationId: user.organizationId,
        },
    });

    return { entity, membership, fresh };
}

/**
 * S6 (Wave B adversarial-verify 2026-07-03) — clear every per-member
 * permission-grant row hanging off `membership` and audit the reset in the
 * SAME transaction (never a silent wipe). The BEFORE snapshot rides the
 * ENTITY_PERMISSION_RESET event.
 *
 * Why: the (userId, entityId) upsert REUSES the same membership row, so
 * grants written for one "employment" would silently re-attach on a
 * re-invite (resurrect-on-reinvite), survive a role change, and follow a
 * member through an ownership transfer (a promoted sole-OWNER carrying an
 * old REVOKE is un-fixable — the admin API self-guard blocks editing one's
 * own grid).
 *
 * No grants → clean no-op (no delete, no event).
 *
 * @param {object} client — tx-bound prisma client
 * @param {{ id: string, userId: string, entityId: string, organizationId: string }} membership
 * @param {{ actorUserId: string, trigger: string, ipAddress?: string, userAgent?: string }} ctx
 * @returns {Promise<{ cleared: number }>}
 */
async function clearMembershipGrants(client, membership, { actorUserId, trigger, ipAddress, userAgent }) {
    // S7 — snapshot read without the tenant scope: under
    // TENANT_READ_ORG_SCOPE=true a cross-org actor's context would filter
    // the rows to [] and the deleteMany below would be skipped (stale
    // grants surviving the revoke/transfer).
    const grants = await withoutTenantScope(() => client.entityMemberPermissionGrant.findMany({
        where: { membershipId: membership.id },
    }));
    if (!Array.isArray(grants) || grants.length === 0) {
        return { cleared: 0 };
    }
    await client.entityMemberPermissionGrant.deleteMany({
        where: { membershipId: membership.id },
    });
    await client.entityMembershipEvent.create({
        data: {
            actorUserId,
            entityId: membership.entityId,
            eventType: 'ENTITY_PERMISSION_RESET',
            targetUserId: membership.userId,
            metadata: {
                trigger,
                before: grants.map((g) => ({ permission: g.permission, effect: g.effect })),
                after: 'inherit',
            },
            ipAddress: ipAddress || null,
            userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
            organizationId: membership.organizationId,
        },
    });
    return { cleared: grants.length };
}

/**
 * Add another User to an Entity at a given role. Used when an OWNER
 * invites a co-manager (Phase 4+). Skips if the user is already a
 * member; updates the role if it differs.
 *
 * Caller is responsible for the inviter-permission check (must be
 * OWNER or ADMIN of the entity). Throws if role is not in ROLES.
 */
async function addMember({ entityId, userId, role, invitedBy, ipAddress, userAgent, tx }) {
    if (!Object.values(ROLES).includes(role)) {
        throw new Error(`role must be one of ${Object.values(ROLES).join(', ')}`);
    }

    // Wave D — write the membership upsert + audit row atomically when
    // we own the transaction. If a `tx` was passed in (caller is already
    // mid-transaction), respect that and don't open a nested one. The
    // audit row still happens via the same `tx`.
    const ownTx = !tx;
    const run = async (client) => {
        const entity = await client.entity.findUnique({
            where: { id: entityId },
            select: { id: true, organizationId: true, isDeleted: true },
        });
        if (!entity || entity.isDeleted) {
            throw new Error('entity not found');
        }

        // Inspect existing row before upsert so we can pick the right
        // event type. Two distinct cases for the audit log:
        //   * fresh row + invitedBy set     → INVITED   (status PENDING)
        //   * fresh row, no invitedBy       → no audit  (system / register path)
        //   * existing row, role changes    → ROLE_CHANGED
        //   * existing row, role same       → no audit  (idempotent re-call)
        const existing = await client.entityMembership.findUnique({
            where: { userId_entityId: { userId, entityId } },
            select: { id: true, role: true, status: true },
        });

        // An OWNER row is off-limits here, exactly as in revokeMember below.
        // The route only validates the REQUESTED role, so without this an ADMIN
        // could "invite" the sitting OWNER as MANAGER; the row already exists,
        // the update branch runs, and the workspace is left with no OWNER and
        // the attacker as the senior member. Ownership moves through
        // transferOwnership, which is the only flow that audits it as such.
        if (existing && existing.role === ROLES.OWNER) {
            const err = new Error('cannot change an OWNER membership — call transferOwnership first');
            err.code = 'CANNOT_DEMOTE_OWNER';
            throw err;
        }

        // Status is NOT the inviter's to set. The create branch opens an invite
        // as PENDING, but the update branch used to force ACTIVE, so inviting
        // the same person twice accepted the invitation on their behalf.
        // PENDING → ACTIVE belongs to acceptInvitation alone. The one move left
        // here is re-inviting a REVOKED member, which re-opens the invite as
        // PENDING so they must accept again rather than being silently restored.
        const nextStatus = existing?.status === 'REVOKED' ? 'PENDING' : existing?.status;

        const result = await client.entityMembership.upsert({
            where: { userId_entityId: { userId, entityId } },
            update: { role, status: nextStatus, permissions: defaultPermissionsFor(role) },
            create: {
                userId,
                entityId,
                role,
                permissions: defaultPermissionsFor(role),
                status: invitedBy ? 'PENDING' : 'ACTIVE',
                invitedBy: invitedBy || null,
                invitedAt: invitedBy ? new Date() : null,
                acceptedAt: invitedBy ? null : new Date(),
                organizationId: entity.organizationId,
            },
        });

        let eventType = null;
        let metadata = null;
        if (!existing) {
            if (invitedBy) {
                eventType = 'INVITED';
                metadata = { role };
            }
            // No invitedBy on a fresh row = system-seeded membership
            // (e.g., register flow auto-creating the personal entity's
            // OWNER row). Don't audit that — it's already covered by
            // the registration path's own audit hooks.
        } else if (existing.role !== role) {
            eventType = 'ROLE_CHANGED';
            metadata = { fromRole: existing.role, toRole: role };
        }

        if (eventType) {
            await client.entityMembershipEvent.create({
                data: {
                    actorUserId: invitedBy || userId,
                    entityId,
                    eventType,
                    targetUserId: userId,
                    metadata,
                    ipAddress: ipAddress || null,
                    userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                    organizationId: entity.organizationId,
                },
            });
        }

        // S6 — the upsert UPDATE branch re-activated a REVOKED row and/or
        // changed the role: grants written for the previous "employment" /
        // role must not resurrect or linger. A same-role ACTIVE idempotent
        // re-call clears nothing (mirrors the no-audit semantics above —
        // grants are never wiped without an audit row).
        if (existing && (existing.role !== role || existing.status !== 'ACTIVE')) {
            await clearMembershipGrants(client, {
                id: existing.id,
                userId,
                entityId,
                organizationId: entity.organizationId,
            }, {
                actorUserId: invitedBy || userId,
                trigger: existing.status !== 'ACTIVE' ? 'MEMBER_REINVITED' : 'MEMBER_ROLE_CHANGED',
                ipAddress,
                userAgent,
            });
        }

        return result;
    };

    return ownTx ? prisma.$transaction(run) : run(tx);
}

/**
 * Mark a member's status as REVOKED instead of hard-deleting so the
 * audit trail of who was a member when stays intact.
 *
 * The OWNER cannot be removed via this helper — call
 * `transferOwnership` first to demote the OWNER to ADMIN, then
 * `revokeMember` on the now-ADMIN row (or just leave them as ADMIN).
 */
async function revokeMember({ entityId, userId, actorUserId, ipAddress, userAgent, tx }) {
    // Wave D — the membership update + REVOKED audit row land in one
    // transaction so the row is never marked REVOKED without a
    // matching audit entry (and vice versa).
    const ownTx = !tx;
    const run = async (client) => {
        const membership = await client.entityMembership.findUnique({
            where: { userId_entityId: { userId, entityId } },
        });
        if (!membership) {return null;}
        if (membership.role === ROLES.OWNER) {
            const err = new Error('cannot revoke OWNER membership — call transferOwnership first');
            err.code = 'CANNOT_REVOKE_OWNER';
            throw err;
        }
        if (membership.status === 'REVOKED') {
            // Idempotent — re-revoking is a no-op, no audit row.
            return membership;
        }

        const updated = await client.entityMembership.update({
            where: { userId_entityId: { userId, entityId } },
            data: { status: 'REVOKED' },
        });

        await client.entityMembershipEvent.create({
            data: {
                actorUserId: actorUserId || userId, // self-revoke when no caller passed
                entityId,
                eventType: 'REVOKED',
                targetUserId: userId,
                metadata: { role: membership.role },
                ipAddress: ipAddress || null,
                userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                organizationId: membership.organizationId,
            },
        });

        // S6 — a later re-invite reuses this exact membership row (upsert on
        // the (userId, entityId) unique), so the grant rows must die WITH the
        // revocation or they silently resurrect. Same transaction; audited.
        await clearMembershipGrants(client, membership, {
            actorUserId: actorUserId || userId,
            trigger: 'MEMBER_REVOKED',
            ipAddress,
            userAgent,
        });
        return updated;
    };
    return ownTx ? prisma.$transaction(run) : run(tx);
}

/**
 * Farm-worker Wave B chunk 5 — write / clear a per-member permission grant
 * row, transactionally with its EntityMembershipEvent audit row (same
 * atomicity convention as addMember / revokeMember: the grant never lands
 * without its audit entry and vice versa).
 *
 * Caller-side guards (OWNER-only, self-guard, taxonomy validation) live in
 * the route — this helper enforces only the data invariants:
 *   - target must hold an ACTIVE membership on the entity
 *     (throws code TARGET_NOT_MEMBER → route maps to 404)
 *   - grantedBy stamps the actor's User.id UUID (NEVER a national ID)
 *   - organizationId mirrors the membership row (ADR-014)
 *   - M5 (PII ingress): `reason` is operator-typed FREE TEXT persisted to
 *     TWO sinks (grants.reason String + entity_membership_events.metadata
 *     Json) — NEITHER model has a PDPA extension hook, so an embedded
 *     13-digit national ID would land in plaintext (national-ID-at-rest
 *     regression). Mask standalone 13-digit runs AT THIS SOURCE
 *     (maskThaiIdsInText), covering every caller. Hook decision (grep
 *     evidence 2026-07-03): all 7 entityMembershipEvent.metadata writers
 *     live in THIS file and every other metadata value is a role/permission
 *     enum or a User.id UUID — `reason` is the only free-text ingress, so
 *     masking here suffices and no Json extension hook is registered.
 *
 * @returns {Promise<{ membership: object, before: string, after: string }>}
 */
async function setMemberPermissionGrant({
    entityId, targetUserId, permission, effect, reason,
    actorUserId, ipAddress, userAgent, tx,
}) {
    if (!entityId) {throw new Error('entityId is required');}
    if (!targetUserId) {throw new Error('targetUserId is required');}
    if (!permission) {throw new Error('permission is required');}
    if (effect !== 'GRANT' && effect !== 'REVOKE') {
        throw new Error("effect must be 'GRANT' or 'REVOKE'");
    }
    // M5 — mask BEFORE either sink sees the value (source chokepoint).
    reason = maskThaiIdsInText(reason);

    const ownTx = !tx;
    const run = async (client) => {
        const membership = await client.entityMembership.findUnique({
            where: { userId_entityId: { userId: targetUserId, entityId } },
        });
        if (!membership || membership.status !== 'ACTIVE') {
            const err = new Error('target is not an active member of this entity');
            err.code = 'TARGET_NOT_MEMBER';
            throw err;
        }

        // Capture the prior state for the audit "before" (inherit if none).
        let before = 'inherit';
        const prior = await client.entityMemberPermissionGrant.findUnique({
            where: { membershipId_permission: { membershipId: membership.id, permission } },
        });
        if (prior) {before = prior.effect;}

        await client.entityMemberPermissionGrant.upsert({
            where: { membershipId_permission: { membershipId: membership.id, permission } },
            update: { effect, reason: reason || null, grantedBy: actorUserId || null },
            create: {
                membershipId: membership.id,
                permission,
                effect,
                reason: reason || null,
                grantedBy: actorUserId || null,
                organizationId: membership.organizationId,
            },
        });

        await client.entityMembershipEvent.create({
            data: {
                actorUserId: actorUserId || targetUserId,
                entityId,
                eventType: effect === 'GRANT' ? 'ENTITY_PERMISSION_GRANTED' : 'ENTITY_PERMISSION_REVOKED',
                targetUserId,
                metadata: { permission, effect, reason: reason || null, before, after: effect },
                ipAddress: ipAddress || null,
                userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                organizationId: membership.organizationId,
            },
        });

        return { membership, before, after: effect };
    };
    // S7 — run outside the tenant scope: organizationId is stamped
    // explicitly from the membership row (the ENTITY's org), which the
    // extension's cross-tenant write guard would otherwise reject for a
    // cross-org OWNER (CROSS_TENANT_WRITE → 500).
    return withoutTenantScope(() => (ownTx ? prisma.$transaction(run) : run(tx)));
}

/**
 * Revert a member's permission to inherit (delete the grant row).
 * Idempotent: P2025 (row already absent) is success — "no grant" IS the
 * target state. Audits ENTITY_PERMISSION_RESET in the same transaction.
 */
async function resetMemberPermissionGrant({
    entityId, targetUserId, permission, actorUserId, ipAddress, userAgent, tx,
}) {
    if (!entityId) {throw new Error('entityId is required');}
    if (!targetUserId) {throw new Error('targetUserId is required');}
    if (!permission) {throw new Error('permission is required');}

    const ownTx = !tx;
    const run = async (client) => {
        const membership = await client.entityMembership.findUnique({
            where: { userId_entityId: { userId: targetUserId, entityId } },
        });
        if (!membership || membership.status !== 'ACTIVE') {
            const err = new Error('target is not an active member of this entity');
            err.code = 'TARGET_NOT_MEMBER';
            throw err;
        }

        let before = 'inherit';
        try {
            const removed = await client.entityMemberPermissionGrant.delete({
                where: { membershipId_permission: { membershipId: membership.id, permission } },
            });
            if (removed) {before = removed.effect || before;}
        } catch (err) {
            if (err && err.code !== 'P2025') {
                throw err;
            }
        }

        await client.entityMembershipEvent.create({
            data: {
                actorUserId: actorUserId || targetUserId,
                entityId,
                eventType: 'ENTITY_PERMISSION_RESET',
                targetUserId,
                metadata: { permission, effect: 'INHERIT', before, after: 'inherit' },
                ipAddress: ipAddress || null,
                userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                organizationId: membership.organizationId,
            },
        });

        return { membership, before, after: 'inherit' };
    };
    // S7 — see setMemberPermissionGrant (entity-dimension operation).
    return withoutTenantScope(() => (ownTx ? prisma.$transaction(run) : run(tx)));
}

/**
 * Accept a PENDING invitation. Wave D — closes the UX gap where
 * `addMember` created PENDING rows but no flow existed for the
 * invitee to convert their own row to ACTIVE (the only existing path
 * was the inviting admin re-invoking addMember, which is wrong UX).
 *
 * Atomic: status flip + ACCEPTED audit row in one transaction.
 *
 * Failure codes:
 *   NOT_INVITED — no membership row at all
 *   NOT_PENDING — row exists but status is ACTIVE / REVOKED
 *
 * @param {object} args
 * @param {string} args.entityId
 * @param {string} args.userId — the invitee, typically req.user.id
 */
async function acceptInvitation({ entityId, userId, ipAddress, userAgent, tx }) {
    if (!entityId) {throw new Error('entityId is required');}
    if (!userId) {throw new Error('userId is required');}
    const ownTx = !tx;
    const run = async (client) => {
        const membership = await client.entityMembership.findUnique({
            where: { userId_entityId: { userId, entityId } },
        });
        if (!membership) {
            const err = new Error('no invitation found for this user on this entity');
            err.code = 'NOT_INVITED';
            throw err;
        }
        if (membership.status !== 'PENDING') {
            const err = new Error(`invitation status is ${membership.status}, cannot accept`);
            err.code = 'NOT_PENDING';
            err.status = membership.status;
            throw err;
        }

        const now = new Date();
        const updated = await client.entityMembership.update({
            where: { userId_entityId: { userId, entityId } },
            data: { status: 'ACTIVE', acceptedAt: now },
        });
        await client.entityMembershipEvent.create({
            data: {
                actorUserId: userId, // the invitee accepts on their own behalf
                entityId,
                eventType: 'ACCEPTED',
                targetUserId: userId,
                metadata: { role: membership.role },
                ipAddress: ipAddress || null,
                userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                organizationId: membership.organizationId,
            },
        });
        return updated;
    };
    return ownTx ? prisma.$transaction(run) : run(tx);
}

/**
 * Decline a PENDING invitation. Marks status=REVOKED with
 * metadata.reason='DECLINED' so the audit log can distinguish
 * "admin revoked" from "invitee declined".
 *
 * Same failure codes as acceptInvitation.
 */
async function declineInvitation({ entityId, userId, ipAddress, userAgent, tx }) {
    if (!entityId) {throw new Error('entityId is required');}
    if (!userId) {throw new Error('userId is required');}
    const ownTx = !tx;
    const run = async (client) => {
        const membership = await client.entityMembership.findUnique({
            where: { userId_entityId: { userId, entityId } },
        });
        if (!membership) {
            const err = new Error('no invitation found for this user on this entity');
            err.code = 'NOT_INVITED';
            throw err;
        }
        if (membership.status !== 'PENDING') {
            const err = new Error(`invitation status is ${membership.status}, cannot decline`);
            err.code = 'NOT_PENDING';
            err.status = membership.status;
            throw err;
        }

        const updated = await client.entityMembership.update({
            where: { userId_entityId: { userId, entityId } },
            data: { status: 'REVOKED' },
        });
        await client.entityMembershipEvent.create({
            data: {
                actorUserId: userId,
                entityId,
                eventType: 'REVOKED',
                targetUserId: userId,
                metadata: { role: membership.role, reason: 'DECLINED' },
                ipAddress: ipAddress || null,
                userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                organizationId: membership.organizationId,
            },
        });
        return updated;
    };
    return ownTx ? prisma.$transaction(run) : run(tx);
}

/**
 * List the user's currently-PENDING invitations. Used by
 * `GET /api/entities/invitations` so the frontend can surface a
 * "you have N pending invitations" UI.
 *
 * Returns one row per pending membership with the entity name + the
 * inviter's display info so the UI can render "Alice invited you to
 * 'ABC Co. Ltd.' as MANAGER" without a second round-trip.
 */
async function listPendingInvitations({ userId, tx }) {
    if (!userId) {throw new Error('userId is required');}
    const client = tx || prisma;
    const rows = await client.entityMembership.findMany({
        where: { userId, status: 'PENDING' },
        orderBy: { invitedAt: 'desc' },
        include: {
            entity: {
                select: {
                    id: true, type: true, slug: true, displayName: true,
                    isDeleted: true, status: true,
                },
            },
        },
    });
    // Drop rows whose entity has been deleted out from under the
    // pending invite — defensive, shouldn't happen in normal flow.
    const live = rows.filter((r) => r.entity && !r.entity.isDeleted && r.entity.status !== 'DELETED');

    // Resolve inviter display names in one batch.
    const inviterIds = [...new Set(live.map((r) => r.invitedBy).filter(Boolean))];
    const inviters = inviterIds.length === 0
        ? []
        : await client.user.findMany({
            where: { id: { in: inviterIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
        });
    const inviterById = new Map(inviters.map((u) => [u.id, u]));

    return live.map((r) => {
        const inv = r.invitedBy ? inviterById.get(r.invitedBy) : null;
        return {
            entityId: r.entity.id,
            slug: r.entity.slug || null,
            type: r.entity.type,
            displayName: r.entity.displayName,
            role: r.role,
            invitedAt: r.invitedAt,
            invitedBy: inv
                ? {
                    id: inv.id,
                    displayName: [inv.firstName, inv.lastName].filter(Boolean).join(' ') || inv.email || null,
                }
                : null,
        };
    });
}

/**
 * Transfer the OWNER role from one User to another, atomically.
 *
 * Wave D — closes the production gap where revokeMember refused to
 * remove the OWNER but no transfer flow existed (so the workspace
 * was stuck if the OWNER left). Used by
 * `POST /api/entities/:id/transfer-ownership`.
 *
 * Both users must hold ACTIVE EntityMembership rows on the same
 * entity. The transfer:
 *   1. Demotes the current OWNER to ADMIN with the ADMIN default
 *      permission set (the previous custom permissions[] are
 *      replaced — ownership transfer is intentionally a clean break).
 *   2. Promotes the new OWNER, replacing whatever role they had
 *      (ADMIN / MANAGER / VIEWER) with OWNER + the OWNER default
 *      permission set.
 *
 * Both writes happen inside a single transaction so a crash mid-
 * transfer never leaves the workspace owner-less.
 *
 * Caller-permission check (`assertCapability` for TRANSFER_OWNERSHIP)
 * lives in the route handler, not here — same pattern as
 * `addMember` / `revokeMember`.
 *
 * @param {object} args
 * @param {string} args.entityId
 * @param {string} args.fromUserId — current OWNER (typically req.user.id)
 * @param {string} args.toUserId   — incoming OWNER, must be active member
 * @param {string} [args.ipAddress] — request IP for the audit row
 * @param {string} [args.userAgent] — request user-agent for the audit row
 * @returns {Promise<{ from: object, to: object, audit: object }>}
 *          updated memberships + the EntityMembershipEvent row written
 *          inside the same transaction.
 */
async function transferOwnership({ entityId, fromUserId, toUserId, ipAddress, userAgent }) {
    if (!entityId) {throw new Error('entityId is required');}
    if (!fromUserId) {throw new Error('fromUserId is required');}
    if (!toUserId) {throw new Error('toUserId is required');}
    if (fromUserId === toUserId) {
        const err = new Error('cannot transfer ownership to yourself');
        err.code = 'SAME_USER';
        throw err;
    }

    return prisma.$transaction(async (tx) => {
        // Confirm the current OWNER row.
        const current = await tx.entityMembership.findUnique({
            where: { userId_entityId: { userId: fromUserId, entityId } },
        });
        if (!current || current.status !== 'ACTIVE' || current.role !== ROLES.OWNER) {
            const err = new Error('caller is not the active OWNER of this entity');
            err.code = 'NOT_OWNER';
            throw err;
        }

        // Confirm the incoming user is already an ACTIVE member. We
        // intentionally don't auto-invite here — the new OWNER must
        // already be on the workspace so there's no "promote a
        // stranger" foot-gun.
        const incoming = await tx.entityMembership.findUnique({
            where: { userId_entityId: { userId: toUserId, entityId } },
        });
        if (!incoming || incoming.status !== 'ACTIVE') {
            const err = new Error('toUserId is not an active member of this entity');
            err.code = 'TARGET_NOT_MEMBER';
            throw err;
        }
        if (incoming.role === ROLES.OWNER) {
            // Defensive: an entity should only ever have one OWNER, but
            // catch the case where two slipped in somehow.
            const err = new Error('toUserId is already an OWNER');
            err.code = 'TARGET_ALREADY_OWNER';
            throw err;
        }

        const now = new Date();
        const demoted = await tx.entityMembership.update({
            where: { userId_entityId: { userId: fromUserId, entityId } },
            data: {
                role: ROLES.ADMIN,
                permissions: defaultPermissionsFor(ROLES.ADMIN),
                acceptedAt: now,
            },
        });
        const promoted = await tx.entityMembership.update({
            where: { userId_entityId: { userId: toUserId, entityId } },
            data: {
                role: ROLES.OWNER,
                permissions: defaultPermissionsFor(ROLES.OWNER),
                acceptedAt: now,
            },
        });

        // Wave D — write the audit row inside the same transaction so
        // a transfer either lands fully (memberships + audit) or rolls
        // back fully. Looking up the entity's organizationId here so
        // tenancy stays correct even if the entity hops orgs (it can't
        // today, but ADR-014 keeps that invariant explicit).
        const entityOrg = await tx.entity.findUnique({
            where: { id: entityId },
            select: { organizationId: true },
        });
        const audit = await tx.entityMembershipEvent.create({
            data: {
                actorUserId: fromUserId,
                entityId,
                eventType: 'OWNERSHIP_TRANSFER',
                targetUserId: toUserId,
                metadata: {
                    fromUserId,
                    toUserId,
                    demotedFrom: ROLES.OWNER,
                    demotedTo: ROLES.ADMIN,
                    promotedFrom: incoming.role, // could be ADMIN, MANAGER, VIEWER
                    promotedTo: ROLES.OWNER,
                },
                ipAddress: ipAddress || null,
                userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                organizationId: entityOrg?.organizationId || current.organizationId,
            },
        });

        // S6 — ownership transfer is a CLEAN BREAK (the permissions[] arrays
        // above are already replaced with the new role defaults): clear the
        // per-member grant rows on BOTH sides too. Without this, a promoted
        // sole-OWNER carrying an old REVOKE could never fix it (the admin
        // API self-guard blocks editing one's own grid → deadlock), and the
        // demoted OWNER would keep grants written against their old role.
        await clearMembershipGrants(tx, current, {
            actorUserId: fromUserId, trigger: 'OWNERSHIP_TRANSFER', ipAddress, userAgent,
        });
        await clearMembershipGrants(tx, incoming, {
            actorUserId: fromUserId, trigger: 'OWNERSHIP_TRANSFER', ipAddress, userAgent,
        });
        return { from: demoted, to: promoted, audit };
    });
}

/**
 * List membership-lifecycle audit events for an entity, newest first.
 * Used by GET /api/entities/:id/audit-log (Wave D).
 *
 * Caller-permission check (must be a member) lives in the route, not
 * here.
 *
 * @param {object} args
 * @param {string} args.entityId
 * @param {number} [args.limit] default 50, hard cap 200
 * @param {import('@prisma/client').Prisma.TransactionClient} [args.tx]
 */
async function listMembershipEvents({ entityId, limit = 50, tx }) {
    if (!entityId) {throw new Error('entityId is required');}
    const client = tx || prisma;
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const events = await client.entityMembershipEvent.findMany({
        where: { entityId },
        orderBy: { createdAt: 'desc' },
        take,
        include: {
            actorUser:  { select: { id: true, healthId: true, firstName: true, lastName: true } },
            targetUser: { select: { id: true, healthId: true, firstName: true, lastName: true } },
        },
    });
    return events.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        eventType: e.eventType,
        actor: e.actorUser
            ? {
                id: e.actorUser.id,
                healthId: maskThaiId(e.actorUser.healthId),
                displayName: [e.actorUser.firstName, e.actorUser.lastName].filter(Boolean).join(' ') || null,
            }
            : null,
        target: e.targetUser
            ? {
                id: e.targetUser.id,
                healthId: maskThaiId(e.targetUser.healthId),
                displayName: [e.targetUser.firstName, e.targetUser.lastName].filter(Boolean).join(' ') || null,
            }
            : null,
        metadata: e.metadata || null,
        ipAddress: e.ipAddress || null,
        userAgent: e.userAgent || null,
    }));
}

/**
 * List members for an entity, shaped for the `GET /api/entities/:id/members`
 * response. Replaces the direct `prisma.entityMembership.findMany` call in
 * `routes/api/entities/index.js` (was at line 299).
 *
 * Returns rows with the user flattened in and `displayName` derived from
 * firstName/lastName/email so the route layer doesn't need to know about
 * the User table column projection.
 *
 * @param {object} args
 * @param {string} args.entityId
 * @param {import('@prisma/client').Prisma.TransactionClient} [args.tx]
 */
async function listMembersForEntity({ entityId, tx }) {
    if (!entityId) {throw new Error('entityId is required');}
    const client = tx || prisma;
    const members = await client.entityMembership.findMany({
        where: { entityId },
        include: {
            user: { select: { id: true, healthId: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: [{ role: 'asc' }, { acceptedAt: 'asc' }],
    });
    // healthId is the plaintext 13-digit citizen ID once the PDPA extension has
    // decrypted it on read. Mask HERE, at the service boundary, so no caller
    // ever holds a raw peer national ID: this list goes to every member of the
    // workspace regardless of role, so a VIEWER was receiving the OWNER's.
    return members.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        healthId: m.user?.healthId ? maskThaiId(m.user.healthId) : null,
        displayName: [m.user?.firstName, m.user?.lastName].filter(Boolean).join(' ') || m.user?.email || '-',
        email: m.user?.email || null,
        role: m.role,
        permissions: m.permissions || [],
        status: m.status,
        invitedBy: m.invitedBy,
        invitedAt: m.invitedAt,
        acceptedAt: m.acceptedAt,
    }));
}

/**
 * M1.5 H2 — shape an Entity row for a member-facing response.
 *
 * Three fields on an Entity carry a raw 13-digit Thai national ID (the PII
 * registry files them side by side — formdata-pii.js:183-184):
 *   • `thaiCitizenId` — encrypted at rest, DECRYPTED on read by the PDPA
 *     extension (prisma-pdpa-extension.js:246-266), so every read hands the
 *     caller plaintext.
 *   • `payload.director.idCard` — plaintext, built by buildJuristicPayload.
 *   • `payload.president.idCard` — plaintext, built by buildCommunityPayload
 *     (M1.5 audit CRITICAL-1: same class, same rule).
 *
 * Both went out over `GET /api/entities/:id` to every member of the workspace,
 * VIEWER included. Mask HERE, at the same service boundary and by the same
 * convention as listMembersForEntity above: for EVERY role, OWNER included.
 * A workspace has more than one OWNER-shaped reader over its lifetime, and the
 * value is not needed to render any screen.
 *
 * Returns a COPY — the Prisma row the caller holds is left intact for any
 * internal use (hashing, comparison) that legitimately needs the raw value.
 * Tolerates the INDIVIDUAL shape (`payload: null`) and the
 * COMMUNITY_ENTERPRISE shape (no `director` key).
 *
 * @param {object|null} entity
 * @returns {object|null} the same shape with the two ID carriers masked
 */
function presentEntityForMember(entity) {
    if (!entity || typeof entity !== 'object') {return entity;}

    const masked = { ...entity };

    if (masked.thaiCitizenId) {
        masked.thaiCitizenId = maskThaiId(masked.thaiCitizenId);
    }

    const payload = entity.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        let nextPayload = payload;
        for (const key of ['director', 'president']) {
            const person = nextPayload[key];
            if (person && typeof person === 'object' && person.idCard) {
                nextPayload = {
                    ...nextPayload,
                    [key]: { ...person, idCard: maskThaiId(person.idCard) },
                };
            }
        }
        if (nextPayload !== payload) {
            masked.payload = nextPayload;
        }
    }

    return masked;
}

/**
 * List every Entity the user is currently an ACTIVE member of, plus their
 * role on each. Used by `GET /api/entities/mine` (Wave C PR-1) — the data
 * that drives the workspace switcher dropdown.
 *
 * Set `includePending: true` to also return PENDING invitations. The
 * default omits them so the picker doesn't accidentally let someone act
 * as an entity they haven't accepted yet.
 *
 * Returns rows with the entity flattened in (id, type, displayName, …)
 * plus role + status from the membership. `isPersonal` is set when the
 * entity's identifier hash matches the user's healthId hash.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} [args.healthId] — used to flag the personal INDIVIDUAL entity
 * @param {boolean} [args.includePending]
 * @param {import('@prisma/client').Prisma.TransactionClient} [args.tx]
 */
async function listMembershipsForUser({ userId, healthId, includePending = false, tx }) {
    if (!userId) {throw new Error('userId is required');}
    const client = tx || prisma;

    const statusFilter = includePending ? { in: ['ACTIVE', 'PENDING'] } : 'ACTIVE';

    const memberships = await client.entityMembership.findMany({
        where: { userId, status: statusFilter },
        include: {
            entity: {
                select: {
                    id: true,
                    type: true,
                    displayName: true,
                    slug: true,
                    status: true,
                    thaiCitizenIdHash: true,
                    // STAGE B2 — also project the keyed column so the isPersonal
                    // flag compares against the right one under the flag.
                    thaiCitizenIdHmac: true,
                    juristicId: true,
                    communityRegNo: true,
                    isDeleted: true,
                    organizationId: true,
                },
            },
        },
        orderBy: { createdAt: 'asc' },
    });

    // STAGE B2 — `isPersonal` is a pure DISPLAY flag (drives the "personal"
    // badge in the workspace switcher). Keep the existing healthId-gated
    // semantics byte-for-byte. Compute BOTH the legacy unkeyed hash and the
    // keyed HMAC of the caller's healthId; match a row if EITHER column equals
    // the corresponding token. This is correct in every data-state:
    //   * flag OFF / un-backfilled  → matches via the legacy thaiCitizenIdHash
    //     (identical to today's behaviour).
    //   * flag ON / backfilled      → matches via the keyed thaiCitizenIdHmac.
    //   * flag ON / NOT-yet-backfilled (hmac NULL) → still matches via the
    //     legacy hash, so the badge never flickers off during the backfill
    //     window.
    const personalHash = healthId ? hashIdentifier(healthId) : null;
    const personalHmac = healthId ? computeLookupHmac(healthId) : null;

    return memberships
        .filter(m => m.entity && !m.entity.isDeleted)
        .map(m => ({
            id: m.entity.id,
            type: m.entity.type,
            displayName: m.entity.displayName,
            slug: m.entity.slug || null,
            status: m.entity.status,
            organizationId: m.entity.organizationId,
            role: m.role,
            membershipStatus: m.status,
            permissions: m.permissions || [],
            isPersonal:
                m.entity.type === TYPES.INDIVIDUAL
                && (
                    (personalHash !== null && m.entity.thaiCitizenIdHash === personalHash)
                    || (personalHmac !== null && m.entity.thaiCitizenIdHmac === personalHmac)
                ),
        }));
}

/**
 * listMembershipsForUser + lazy self-heal (2026-06-11).
 *
 * Registration is the ONLY caller of ensurePersonalIndividualEntity, so any
 * HEALTH user created OUTSIDE that flow (seed scripts, e2e-controller's raw
 * prisma.user.create, admin/backfill scripts) has ZERO memberships and lands
 * in the workspace switcher's "ไม่มีพื้นที่ใช้งาน" dead end — found live on
 * staging (5 seeded users; prod verified clean, real applicants register
 * through the healing path already).
 *
 * Heal lazily on the read: zero memberships + HEALTH user with healthId and
 * organizationId → ensurePersonalIndividualEntity (idempotent find-or-create
 * + membership upsert) → re-list. Any failure fails OPEN to the empty list
 * (same behavior as before, with the cause logged).
 */
async function listMembershipsForUserWithHeal({ userId, healthId, includePending = false }) {
    const memberships = await listMembershipsForUser({ userId, healthId, includePending });
    if (memberships.length > 0) {
        return memberships;
    }
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true, role: true, healthId: true, organizationId: true,
                firstName: true, lastName: true, email: true,
            },
        });
        // users.role is canonical (migration 20260801000000): the uppercase
        // comparison this guard used to make was always-false post-migration,
        // which silently disabled the personal-entity self-heal.
        //
        // W4 2026-08-22 — and then the same trap sprang the other way. This
        // guard read the RAW column, so ONE writer that had never been
        // canonicalised (prisma/seed-gacp.js wrote role: 'HEALTH') was enough
        // to disable the heal again for every account it created: no personal
        // entity → no application draft → the whole wizard 400s on its first
        // document upload. Whether a heal runs must not hinge on a writer's
        // spelling, so normalise the value the way every RBAC gate does
        // (normalizeRole maps 'HEALTH' → 'health' and returns null for a
        // non-role, so nothing else widens). The DB QUERY filters stay
        // canonical-only — this is an in-memory comparison, not a filter.
        if (!user || normalizeRole(user.role) !== CANONICAL_ROLES.HEALTH || !user.healthId || !user.organizationId) {
            return memberships;
        }
        await ensurePersonalIndividualEntity({ user });
        return await listMembershipsForUser({
            userId,
            healthId: healthId || user.healthId,
            includePending,
        });
    } catch (healError) {
        logger.error('[entity-service] personal-entity self-heal failed:', healError?.message);
        return memberships;
    }
}

/**
 * Append a row to entity_context_switches. Called from the workspace-switcher
 * client whenever the active entity changes; also called by the active-entity
 * middleware (Wave C PR-2) on the very first request after login when the
 * default fires.
 *
 * Best-effort: failures here log a warning but never throw — losing an audit
 * row is unfortunate, blocking the user's switch is worse.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string|null} args.fromEntityId
 * @param {string} args.toEntityId
 * @param {string} args.organizationId
 * @param {string} [args.ipAddress]
 * @param {string} [args.userAgent]
 * @param {string} [args.source] HEADER | URL_SLUG | DEFAULT
 * @param {import('@prisma/client').Prisma.TransactionClient} [args.tx]
 */
async function recordContextSwitch({
    userId,
    fromEntityId,
    toEntityId,
    organizationId,
    ipAddress,
    userAgent,
    source = 'HEADER',
    tx,
}) {
    if (!userId || !toEntityId || !organizationId) {return null;}
    const client = tx || prisma;
    try {
        return await client.entityContextSwitch.create({
            data: {
                userId,
                fromEntityId: fromEntityId || null,
                toEntityId,
                organizationId,
                ipAddress: ipAddress || null,
                userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
                source,
            },
        });
    } catch (_err) {
        // Don't propagate — audit failure must not break the switch.
        // The caller logs at warn level if this returns null.
        return null;
    }
}

/**
 * Resolve a user's effective role on an entity by reading EntityMembership.
 * Returns null when the user has no active membership.
 *
 * Phase 2 of the plan extends this with EntityServiceDelegation lookup
 * (consulting-company access). Today it only checks direct memberships.
 */
async function getUserRoleOnEntity({ entityId, userId, tx }) {
    const client = tx || prisma;
    const m = await client.entityMembership.findUnique({
        where: { userId_entityId: { userId, entityId } },
        select: { role: true, status: true },
    });
    if (!m || m.status !== 'ACTIVE') {return null;}
    return m.role;
}

const {
    validateJuristic,
    validateCommunityEnterprise,
} = require('./applicant-validation');

function buildJuristicPayload(applicantData) {
    const a = applicantData || {};
    // Whitelisted, structured payload — not a passthrough — so the schema
    // stays predictable for downstream readers (PDF, certificate, audit).
    return {
        companyType: a.companyType || null,
        registrationNumber: a.registrationNumber || null,
        registeredCapital: a.registeredCapital || null,
        address: {
            full: a.companyAddress || null,
            province: a.province || null,
            district: a.district || null,
            subdistrict: a.subdistrict || null,
            postalCode: a.postalCode || null,
        },
        director: {
            name: a.directorName || null,
            idCard: a.directorIdCard || null,
            phone: a.directorPhone || null,
            email: a.directorEmail || null,
            position: a.directorPosition || null,
        },
        contact: {
            name: a.contactName || null,
            phone: a.contactPhone || a.companyPhone || null,
            email: a.contactEmail || null,
        },
    };
}

function buildCommunityPayload(applicantData) {
    const a = applicantData || {};
    return {
        registrationDate: a.communityRegDate || null,
        memberCount: typeof a.memberCount === 'number' ? a.memberCount : null,
        address: {
            full: a.communityAddress || null,
            province: a.province || null,
            district: a.district || null,
            subdistrict: a.subdistrict || null,
            postalCode: a.postalCode || null,
        },
        president: {
            name: a.presidentName || null,
            idCard: a.presidentIdCard || null,
            phone: a.presidentPhone || null,
        },
        contact: {
            name: a.contactName || null,
            phone: a.contactPhone || null,
            email: a.contactEmail || null,
        },
    };
}

// ── M1.5 H1 — the registration number is not a key ──────────────────────────
// A company tax ID and a DOAE community number are PUBLIC. Finding an existing
// Entity by one proves nothing about who is asking, so the ONLY reuse allowed
// is the entity's own OWNER retrying (double-click / retry from
// workspaces/new/page.tsx:65). Everyone else is refused — and the refusal is
// the admin-visible signal that someone tried to walk into a workspace they do
// not belong to. Spec: design note 2026-08-15-m1.5-hardening-design §H1.
const CLAIM_REFUSED_ACTION = 'ENTITY_CLAIM_REFUSED';
const CLAIM_REFUSED_CODE = 'ENTITY_ALREADY_REGISTERED';

// The message has to name the caller's real next step, which differs by where
// they already stand — telling a pending invitee to "ask for an invite" sends
// them in a circle.
const CLAIM_REFUSAL_MESSAGES = Object.freeze({
    STRANGER: Object.freeze({
        [TYPES.JURISTIC]: 'นิติบุคคลนี้ลงทะเบียนแล้ว — ขอคำเชิญจากเจ้าของ workspace',
        [TYPES.COMMUNITY_ENTERPRISE]: 'วิสาหกิจชุมชนนี้ลงทะเบียนแล้ว — ขอคำเชิญจากเจ้าของ workspace',
    }),
    PENDING: 'คุณมีคำเชิญค้างอยู่ — กดยอมรับที่หน้า workspace',
    ACTIVE_MEMBER: 'คุณเป็นสมาชิกอยู่แล้ว — สลับ workspace แทนการลงทะเบียนใหม่',
});

function claimRefusalMessage({ entityType, membership }) {
    const status = membership?.status || null;
    if (status === 'PENDING') {return CLAIM_REFUSAL_MESSAGES.PENDING;}
    if (status === 'ACTIVE') {return CLAIM_REFUSAL_MESSAGES.ACTIVE_MEMBER;}
    // No row, or a spent one (REVOKED / DECLINED): an invite is the way back in.
    return CLAIM_REFUSAL_MESSAGES.STRANGER[entityType] || CLAIM_REFUSAL_MESSAGES.STRANGER[TYPES.JURISTIC];
}

/**
 * Shared gate for both ensure* helpers when the registration number already
 * resolves to an Entity. Returns the caller's membership when they are its
 * ACTIVE OWNER (idempotent retry); otherwise writes a best-effort refusal row
 * and throws 409 ENTITY_ALREADY_REGISTERED.
 *
 * @returns {Promise<object>} the OWNER membership
 */
async function assertClaimAllowedOnExistingEntity({ user, entity, entityType, registrationHash, client }) {
    const membership = await client.entityMembership.findUnique({
        where: { userId_entityId: { userId: user.id, entityId: entity.id } },
    });

    if (membership && membership.role === ROLES.OWNER && membership.status === 'ACTIVE') {
        return membership;
    }

    // Best-effort, exactly like application-submit-guard.js:71 — an audit outage
    // must not turn a 409 into a 500, and must never swallow the refusal itself.
    try {
        await auditLogger.log({
            category: AuditCategory.SECURITY,
            action: CLAIM_REFUSED_ACTION,
            severity: AuditSeverity.WARNING,
            actorId: user.id,
            actorType: 'USER',
            // actorRole / resourceType / resourceId are NOT NULL on AuditLog
            // (prisma/schema/audit.prisma:22,25,28,29) and log() swallows insert
            // errors — a null here would silently DROP the refusal row.
            actorRole: membership?.role || 'UNKNOWN',
            resourceType: ResourceType.SYSTEM,
            resourceId: entity.id,
            organizationId: user.organizationId,
            result: 'FAILURE',
            errorCode: CLAIM_REFUSED_CODE,
            errorMessage: 'entity claim refused: caller is not the ACTIVE OWNER of the registered entity',
            metadata: {
                // HASH ONLY. The raw registration number is the thing being
                // probed with; it must never land in the log.
                registrationHash,
                entityType,
                // These two are what separates a real squat attempt (null) from
                // a member fumbling the create form (PENDING / ACTIVE).
                membershipStatus: membership?.status || null,
                role: membership?.role || null,
            },
        });
    } catch (auditErr) {
        logger.error('[Entity] claim-refusal audit write failed', {
            entityId: entity.id,
            error: auditErr?.message,
        });
    }

    const err = new Error(claimRefusalMessage({ entityType, membership }));
    err.status = 409;
    err.statusCode = 409;
    err.code = CLAIM_REFUSED_CODE;
    throw err;
}

/**
 * Find or create a JURISTIC Entity from wizard `applicantData`. Run after
 * the user picks "นิติบุคคล" in step 4 and the form has the company tax ID.
 *
 * Idempotent FOR THE OWNER — keyed on `juristicIdHash` so the same company tax
 * ID maps to the same Entity across retries / multiple submissions. A caller
 * who is NOT that entity's ACTIVE OWNER gets 409 ENTITY_ALREADY_REGISTERED
 * instead of being upserted into ownership (M1.5 H1).
 *
 * @param {object} args
 * @param {object} args.user — { id, organizationId } at minimum
 * @param {object} args.applicantData — wizard step-4 payload
 * @param {import('@prisma/client').Prisma.TransactionClient} [args.tx]
 * @returns {Promise<{ entity: object, membership: object, fresh: boolean }>}
 */
async function ensureJuristicEntity({ user, applicantData, tx }) {
    if (!user?.id) {throw new Error('user.id is required');}
    if (!user?.organizationId) {throw new Error('user.organizationId is required (ADR-014)');}

    const validation = validateJuristic(applicantData);
    if (!validation.valid) {
        const err = new Error(`JURISTIC validation failed: ${validation.errors.map(e => e.message).join('; ')}`);
        err.code = 'APPLICANT_VALIDATION_FAILED';
        err.validationErrors = validation.errors;
        throw err;
    }

    const client = tx || prisma;
    const taxId = String(applicantData.taxId).trim();
    const idHash = hashIdentifier(taxId);

    const existing = await client.entity.findFirst({
        where: { type: TYPES.JURISTIC, juristicIdHash: idHash },
    });

    // M1.5 H1 — the number is already spoken for: only its OWNER may reuse it.
    if (existing) {
        const membership = await assertClaimAllowedOnExistingEntity({
            user,
            entity: existing,
            entityType: TYPES.JURISTIC,
            registrationHash: idHash,
            client,
        });
        return { entity: existing, membership, fresh: false };
    }

    const displayName = String(applicantData.companyName).trim();
    const slug = await nextAvailableSlug({
        displayName,
        fallbackIdPrefix: taxId,
        tx: client,
    });
    const entity = await client.entity.create({
        data: {
            type: TYPES.JURISTIC,
            displayName,
            slug,
            juristicId: taxId,
            juristicIdHash: idHash,
            payload: buildJuristicPayload(applicantData),
            status: 'ACTIVE',
            createdBy: user.id,
            organizationId: user.organizationId,
        },
    });

    // Reached only for an Entity created one statement ago on this same client,
    // so no membership row can exist: the upsert's update branch is unreachable
    // and the creator is the OWNER. Spec §H1 keeps this path "เหมือนเดิม".
    const membership = await client.entityMembership.upsert({
        where: { userId_entityId: { userId: user.id, entityId: entity.id } },
        update: { role: ROLES.OWNER, status: 'ACTIVE', acceptedAt: new Date() },
        create: {
            userId: user.id,
            entityId: entity.id,
            role: ROLES.OWNER,
            permissions: defaultPermissionsFor(ROLES.OWNER),
            status: 'ACTIVE',
            invitedBy: null,
            invitedAt: null,
            acceptedAt: new Date(),
            organizationId: user.organizationId,
        },
    });

    return { entity, membership, fresh: true };
}

/**
 * Find or create a COMMUNITY_ENTERPRISE Entity from wizard `applicantData`.
 * Same pattern as ensureJuristicEntity — including the M1.5 H1 claim guard —
 * but keyed on the DOAE community registration number (`communityRegNo`).
 */
async function ensureCommunityEntity({ user, applicantData, tx }) {
    if (!user?.id) {throw new Error('user.id is required');}
    if (!user?.organizationId) {throw new Error('user.organizationId is required (ADR-014)');}

    const validation = validateCommunityEnterprise(applicantData);
    if (!validation.valid) {
        const err = new Error(`COMMUNITY_ENTERPRISE validation failed: ${validation.errors.map(e => e.message).join('; ')}`);
        err.code = 'APPLICANT_VALIDATION_FAILED';
        err.validationErrors = validation.errors;
        throw err;
    }

    const client = tx || prisma;
    const regNo = String(applicantData.communityRegNumber).trim();
    const idHash = hashIdentifier(regNo);

    const existing = await client.entity.findFirst({
        where: { type: TYPES.COMMUNITY_ENTERPRISE, communityRegNoHash: idHash },
    });

    // M1.5 H1 — the DOAE number is already spoken for: only its OWNER may reuse it.
    if (existing) {
        const membership = await assertClaimAllowedOnExistingEntity({
            user,
            entity: existing,
            entityType: TYPES.COMMUNITY_ENTERPRISE,
            registrationHash: idHash,
            client,
        });
        return { entity: existing, membership, fresh: false };
    }

    const displayName = String(applicantData.communityName).trim();
    const slug = await nextAvailableSlug({
        displayName,
        fallbackIdPrefix: regNo,
        tx: client,
    });
    const entity = await client.entity.create({
        data: {
            type: TYPES.COMMUNITY_ENTERPRISE,
            displayName,
            slug,
            communityRegNo: regNo,
            communityRegNoHash: idHash,
            payload: buildCommunityPayload(applicantData),
            status: 'ACTIVE',
            createdBy: user.id,
            organizationId: user.organizationId,
        },
    });

    // Same as the JURISTIC path: brand-new entity on this client, so the
    // upsert's update branch is unreachable. Spec §H1 keeps this "เหมือนเดิม".
    const membership = await client.entityMembership.upsert({
        where: { userId_entityId: { userId: user.id, entityId: entity.id } },
        update: { role: ROLES.OWNER, status: 'ACTIVE', acceptedAt: new Date() },
        create: {
            userId: user.id,
            entityId: entity.id,
            role: ROLES.OWNER,
            permissions: defaultPermissionsFor(ROLES.OWNER),
            status: 'ACTIVE',
            invitedBy: null,
            invitedAt: null,
            acceptedAt: new Date(),
            organizationId: user.organizationId,
        },
    });

    return { entity, membership, fresh: true };
}

// M1.5 H1 — the wizard-glue dispatcher that used to live here (applicantData →
// ensureJuristicEntity / ensureCommunityEntity) is deleted. It turned whatever
// applicantType + registration number a client posted into an Entity the caller
// owned, and its single production caller — the /prepare legacy-materialise
// branch — only woke up when the active-entity middleware fail-opened.
// Workspaces are created through POST /api/entities alone now. Spec §H1.

/**
 * Read an Entity by id (or slug) including the caller's membership.
 * Returns null when the user has no active membership — the caller
 * surfaces 404, never 403, so an attacker can't probe entity ids.
 */
async function getEntityForMember({ entityId, slug, userId, tx }) {
    const client = tx || prisma;
    const where = entityId ? { id: entityId } : slug ? { slug } : null;
    if (!where) {return null;}
    const entity = await client.entity.findFirst({
        where: { ...where, isDeleted: false },
        include: {
            members: {
                where: { userId, status: 'ACTIVE' },
                select: { role: true, permissions: true, status: true },
            },
        },
    });
    if (!entity || entity.members.length === 0) {return null;}
    return {
        entity,
        membership: entity.members[0],
    };
}

/**
 * Update an entity's displayName / payload. Re-slugs when displayName
 * changes (suffixed via nextAvailableSlug to avoid collisions). Caller
 * must assert EDIT_ENTITY_PROFILE capability before calling.
 */
async function updateEntityProfile({ entityId, displayName, payload, tx }) {
    const client = tx || prisma;
    const data = {};
    if (typeof displayName === 'string' && displayName.trim()) {
        data.displayName = displayName.trim();
        data.slug = await nextAvailableSlug({
            displayName: data.displayName,
            fallbackIdPrefix: entityId,
            excludeEntityId: entityId,
            tx: client,
        });
    }
    if (payload && typeof payload === 'object') {
        data.payload = payload;
    }
    if (Object.keys(data).length === 0) {return null;}
    return client.entity.update({ where: { id: entityId }, data });
}

/**
 * Create a non-INDIVIDUAL entity from the workspace-create form.
 * Caller passes `type` (JURISTIC | COMMUNITY_ENTERPRISE) and the
 * relevant subset of applicantData; we reuse ensureJuristicEntity /
 * ensureCommunityEntity so the validation + payload-shape stay
 * consistent with the wizard path.
 *
 * Throws if `type === INDIVIDUAL` — those are register-time only.
 */
async function createWorkspaceEntity({ user, type, applicantData, tx }) {
    const upper = String(type || '').trim().toUpperCase();
    if (upper === TYPES.JURISTIC) {
        return ensureJuristicEntity({ user, applicantData, tx });
    }
    if (upper === TYPES.COMMUNITY_ENTERPRISE) {
        return ensureCommunityEntity({ user, applicantData, tx });
    }
    if (upper === TYPES.INDIVIDUAL) {
        const err = new Error('INDIVIDUAL workspaces are auto-created at register');
        err.code = 'INVALID_WORKSPACE_TYPE';
        throw err;
    }
    const err = new Error(`Unknown workspace type: ${type}`);
    err.code = 'INVALID_WORKSPACE_TYPE';
    throw err;
}

/**
 * Resolve an invitee identifier (citizen ID / email / phone) to a
 * User. Returns null when the channel doesn't match a user — the
 * caller surfaces a "user not found" warning rather than auto-creating.
 *
 * Type defaults to 'healthId' which is the primary identifier in this
 * codebase; email and phone are secondary fallback channels added in
 * Wave C PR-4 to avoid the "mistyped citizen ID silently invites the
 * wrong person" failure mode.
 *
 * Returns:
 *   { user, ambiguous: false } — exactly one match
 *   { user: null, ambiguous: true } — multiple matches (caller should ask)
 *   null — no match
 */
async function findInviteeByIdentifier({ type, value, tx }) {
    const client = tx || prisma;
    const channel = String(type || 'healthId').toLowerCase();
    const v = String(value || '').trim();
    if (!v) {return null;}

    if (channel === 'healthid' || channel === 'health_id') {
        const user = await findUserByHealthIdSecurely(v, {
            select: { id: true, healthId: true, firstName: true, lastName: true, email: true },
            client,
        });
        return user ? { user, ambiguous: false } : null;
    }
    if (channel === 'email') {
        const matches = await client.user.findMany({
            where: { email: v, isDeleted: false },
            select: { id: true, healthId: true, firstName: true, lastName: true, email: true },
            take: 2,
        });
        if (matches.length === 0) {return null;}
        if (matches.length > 1) {return { user: null, ambiguous: true };}
        return { user: matches[0], ambiguous: false };
    }
    if (channel === 'phone') {
        const matches = await client.user.findMany({
            // C2-class: the User column is `phoneNumber`, not `phone` → the
            // phone-invite branch 500'd (the healthId/email branches were correct).
            where: { phoneNumber: v, isDeleted: false },
            select: { id: true, healthId: true, firstName: true, lastName: true, email: true },
            take: 2,
        });
        if (matches.length === 0) {return null;}
        if (matches.length > 1) {return { user: null, ambiguous: true };}
        return { user: matches[0], ambiguous: false };
    }
    const err = new Error(`unknown invite channel: ${channel}`);
    err.code = 'INVALID_INVITE_CHANNEL';
    throw err;
}

module.exports = {
    TYPES,
    ROLES,
    CAPABILITIES,
    FARM_OPERATION_CAPABILITIES,
    DEFAULT_PERMISSIONS_BY_ROLE,
    assertCapability,
    defaultPermissionsFor,
    ensurePersonalIndividualEntity,
    ensureJuristicEntity,
    ensureCommunityEntity,
    createWorkspaceEntity,
    updateEntityProfile,
    addMember,
    revokeMember,
    setMemberPermissionGrant,
    resetMemberPermissionGrant,
    acceptInvitation,
    declineInvitation,
    listPendingInvitations,
    transferOwnership,
    listMembershipEvents,
    getUserRoleOnEntity,
    getEntityForMember,
    listMembershipsForUser,
    listMembershipsForUserWithHeal,
    listMembersForEntity,
    presentEntityForMember,
    recordContextSwitch,
    findInviteeByIdentifier,
    slugify,
    nextAvailableSlug,
};
