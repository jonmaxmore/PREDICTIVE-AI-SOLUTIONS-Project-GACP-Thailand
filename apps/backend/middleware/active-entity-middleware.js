/**
 * Active-Entity Middleware (Wave C, PR C-2)
 *
 * Resolves the workspace the user is currently acting as for an
 * authenticated request and binds it to the async-local entity context.
 * Mirrors tenant-context-middleware.js — same shape, different scope.
 *
 * Resolution order (each request, fast path first):
 *   1. `x-active-entity-id` header — the picker and the API client both
 *      send this. Validated against EntityMembership for `req.user.id`.
 *   2. Default: the user's personal INDIVIDUAL Entity (matched by
 *      thaiCitizenIdHash = SHA-256(user.healthId)) — gives clients that
 *      haven't shipped the picker yet a sane default and preserves
 *      backward compat for existing handlers.
 *
 * Behaviour outside an active scope:
 *   - if req.user is missing → no entity scope; request proceeds. The
 *     read-side Prisma extension will not filter (returns rows as-is).
 *   - header present but not in user's active memberships → 403. This
 *     is the localStorage-tampering defence.
 *   - header present and valid → req.activeEntity = {id, role}; the
 *     storage scope wraps next() so all downstream Prisma reads on
 *     entity-scoped models filter by this entityId.
 *
 * Mounted globally in routes/api/index.js after the auth middlewares
 * and after tenantContextMiddleware.
 */

'use strict';

const crypto = require('node:crypto');
const { runWithEntityContext } = require('../services/entity-context');
const { prisma } = require('../services/prisma-database');
const { computeLookupHmac } = require('../utils/field-encryption');
const { createLogger } = require('../shared/logger');

const logger = createLogger('active-entity-middleware');
const HEADER_NAME = 'x-active-entity-id';

function hashIdentifier(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// STAGE B2 (detokenize RFC) — reuse the same `AUTH_LOOKUP_USE_HMAC` switch as
// the H-4 user-lookup. Only governs the FALLBACK hash branch below; the primary
// path uses the stable, flag-independent userId link.
function useHmacLookup() {
    return process.env.AUTH_LOOKUP_USE_HMAC === 'true';
}

/**
 * Resolve the user's personal INDIVIDUAL entity for the default (no-header)
 * active-entity scope.
 *
 * STAGE B2 — PRIMARY path: the stable EntityMembership(userId, OWNER,
 * INDIVIDUAL) link. `req.user.id` is a non-PII UUID that the request already
 * holds, so this removes the per-request national-ID-hash dependency entirely
 * (the unkeyed `thaiCitizenIdHash` was brute-forceable from a dump with NO key).
 * Phase-68 invariant: every health user has exactly one personal INDIVIDUAL
 * entity with an OWNER membership (created at register / lazily self-healed).
 *
 * FALLBACK (pre-Phase-68 rows where the entity exists but the OWNER membership
 * row is missing): the national-ID hash lookup, using the keyed
 * `thaiCitizenIdHmac` when AUTH_LOOKUP_USE_HMAC is on (else the legacy unkeyed
 * `thaiCitizenIdHash` — byte-for-byte today's behaviour). The hmac branch is
 * guarded on a non-null computed value so an un-backfilled NULL column never
 * matches a NULL row.
 */
async function findPersonalEntity(reqUser) {
    // Primary: stable userId → OWNER membership on an INDIVIDUAL entity.
    // Wave B chunk 6 (drill-flagged): findFirst over a non-unique candidate
    // set — pin a stable ordering (oldest row wins) so a user with duplicate
    // candidates always resolves the SAME personal workspace per request.
    if (reqUser?.id) {
        const ownerMembership = await prisma.entityMembership.findFirst({
            where: {
                userId: reqUser.id,
                role: 'OWNER',
                entity: { type: 'INDIVIDUAL', isDeleted: false },
            },
            select: { entityId: true },
            orderBy: { createdAt: 'asc' },
        });
        if (ownerMembership?.entityId) {
            return { id: ownerMembership.entityId };
        }
    }

    // Fallback: legacy national-ID hash lookup for rows with no membership link.
    if (!reqUser?.healthId) {return null;}
    if (useHmacLookup()) {
        const idHmac = computeLookupHmac(reqUser.healthId);
        if (idHmac) {
            const byHmac = await prisma.entity.findFirst({
                where: { type: 'INDIVIDUAL', thaiCitizenIdHmac: idHmac, isDeleted: false },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
            });
            if (byHmac) {return byHmac;}
        }
    }
    const idHash = hashIdentifier(reqUser.healthId);
    return prisma.entity.findFirst({
        where: { type: 'INDIVIDUAL', thaiCitizenIdHash: idHash, isDeleted: false },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });
}

async function resolveActiveEntity(req) {
    const reqUser = req.user;
    if (!reqUser?.id) {return null;}

    const headerValue = req.headers[HEADER_NAME];
    const headerEntityId = typeof headerValue === 'string'
        ? headerValue.trim()
        : Array.isArray(headerValue) ? String(headerValue[0] || '').trim() : '';

    if (headerEntityId) {
        // Fast path — single index hit on (userId, entityId) unique.
        const membership = await prisma.entityMembership.findUnique({
            where: { userId_entityId: { userId: reqUser.id, entityId: headerEntityId } },
            select: { role: true, status: true, entity: { select: { type: true } } },
        });
        if (!membership || membership.status !== 'ACTIVE') {
            return { kind: 'mismatch', headerEntityId };
        }
        // Wave A chunk 4 — `personal:false` marks an EXPLICIT workspace
        // choice (the picker sent the header; membership just validated
        // ACTIVE). buildHealthWhereClause relaxes the applicant pin to
        // entity scope only for these contexts.
        //
        // Wave A fix S1 (adversarial-verify 2026-07-02): the FE PERSISTS the
        // picker choice and auto-sends the header for everyone — so header-
        // presence alone must NOT mark a workspace. When the header names the
        // user's OWN personal INDIVIDUAL entity (role OWNER on an INDIVIDUAL
        // entity — the exact predicate findPersonalEntity's primary path
        // uses), keep `personal:true` so buildHealthWhereClause keeps the
        // strict applicant pin (incl. the applicant.isDeleted guard) for solo
        // farmers. A non-OWNER membership on someone else's INDIVIDUAL entity
        // is a real workspace and stays personal:false.
        const isOwnPersonalEntity =
            membership.role === 'OWNER' && membership.entity?.type === 'INDIVIDUAL';
        return {
            kind: 'ok',
            entityId: headerEntityId,
            role: membership.role,
            personal: isOwnPersonalEntity,
        };
    }

    // No header → default to personal INDIVIDUAL Entity. `personal:true`
    // keeps every legacy query path byte-identical for solo farmers.
    const personal = await findPersonalEntity(reqUser);
    if (!personal) {return null;}
    return { kind: 'ok', entityId: personal.id, role: 'OWNER', personal: true };
}

function activeEntityMiddleware() {
    return async function activeEntity(req, res, next) {
        try {
            const resolved = await resolveActiveEntity(req);

            if (!resolved) {
                // Unauthenticated, public, or no personal entity — let
                // the request through without an entity scope.
                return next();
            }

            if (resolved.kind === 'mismatch') {
                logger.warn(
                    `[active-entity] header rejected: user=${req.user.id} `
                    + `header=${resolved.headerEntityId}`,
                );
                return res.status(403).json({
                    success: false,
                    error: 'Forbidden',
                    message: 'Active entity does not match an active membership',
                    code: 'ACTIVE_ENTITY_MISMATCH',
                });
            }

            req.activeEntity = {
                entityId: resolved.entityId,
                role: resolved.role,
                personal: resolved.personal === true,
            };
            return runWithEntityContext(req.activeEntity, () => next());
        } catch (error) {
            logger.error('[active-entity] resolution failed:', error.message);
            // Don't 500 on a best-effort context resolution — fall through
            // and let the route handle it (or the read-extension default
            // to "no filter" for this request).
            return next();
        }
    };
}

module.exports = {
    activeEntityMiddleware,
    HEADER_NAME,
    // exported for unit tests
    __resolveActiveEntity: resolveActiveEntity,
    __hashIdentifier: hashIdentifier,
};
