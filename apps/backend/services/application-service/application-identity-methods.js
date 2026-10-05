const { maskThaiId } = require('../../utils/field-encryption');
const { useFkToken } = require('../../shared/fk-token');
// Wave A chunk 4 (2026-07-02) — workspace scope for applicant queries.
const { getEntityContext } = require('../entity-context');
const {
    findUserByHealthIdSecurely: defaultFindUserByHealthIdSecurely,
} = require('../user-lookup-service');

// Detokenize STAGE 0 (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md):
// resolveHealthIdentity returns the value that callers write into
// Application.healthId — and Application.healthId is an FK to User.canonicalId.
// It must therefore equal canonicalId. Flag OFF (today, pre-re-key) → return the
// `healthId` column, which == canonicalId == the national ID, byte-for-byte
// today. Flag ON (post-re-key) → return the `canonicalId` column (the token), so
// the written FK matches the re-keyed parent. Both selects always fetch BOTH
// columns so this is purely a return-value switch — no extra round-trip.
function fkValue({ healthId, canonicalId }) {
    return useFkToken() ? (canonicalId ?? healthId) : healthId;
}

/**
 * Canonical health-identity resolver used by every health-side route handler
 * (saveDraft, submitApplication, draft GET, listings, workflow, finance, etc.).
 *
 * ## Sprint 6 healthId-audit Phase B-M5 — Hash-first lookup
 *
 * Before this refactor the resolver used a plaintext WHERE on `User.healthId`.
 * That works today but **breaks** the moment PDPA Phase D encrypts the
 * `healthId` column — non-deterministic AES-GCM means the same plaintext
 * produces different ciphertext on each write, so a plaintext WHERE never
 * matches.
 *
 * The new logic mirrors what `services/prisma-auth-service.js login()` and
 * `services/user-lookup-service.js findUserByHealthIdSecurely()` already do:
 *
 *   - UUID `identityRef` (or `options.userId`) → query by `User.id`
 *     (FK column, stays plaintext, no encryption planned).
 *   - 13-digit numeric `identityRef` / `options.healthId` →
 *     `findUserByHealthIdSecurely()` which prefers `healthIdHash` (SHA-256)
 *     and transparently falls back to plaintext for legacy rows where
 *     `healthIdHash` is still NULL.
 *   - Otherwise → throw (matches prior behaviour; callers expect a throw,
 *     not a null return).
 *
 * Return shape `{ userId, healthId }` and the public signature are unchanged
 * because 16+ callers depend on them (see `grep resolveHealthIdentity`).
 *
 * ## Refactor 2026-06-05 (carpet) — destructure-safe closures
 *
 * These were previously object methods that called each other via `this.`
 * (e.g. `this.normalizeIdentityValue(...)`). That made destructuring the
 * service unsafe: `const { resolveHealthIdentity } = applicationService` then
 * calling it bare dropped the `this` binding and threw
 * "this.normalizeIdentityValue is not a function" at runtime (the live carpet
 * found this as a 500 on GET /api/applications/revision-deadline/:id). They are
 * now plain closures that reference each other directly, so both bound
 * (`svc.resolveHealthIdentity(...)`) and destructured calls work identically.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THAI_ID_PATTERN = /^\d{13}$/;

function isUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isThaiId(value) {
    return typeof value === 'string' && THAI_ID_PATTERN.test(value);
}

function createApplicationIdentityMethods({
    prisma,
    logger,
    // Injected so tests can stub the hash-first lookup without reaching into
    // user-lookup-service internals. Defaults to the canonical helper.
    findUserByHealthIdSecurely = defaultFindUserByHealthIdSecurely,
} = {}) {
    function normalizeIdentityValue(value) {
        const normalized = String(value || '').trim();
        return normalized || null;
    }

    async function resolveHealthIdentity(identityRef, options = {}) {
        const healthId = normalizeIdentityValue(options.healthId);
        const explicitUserId = normalizeIdentityValue(options.userId || identityRef);

        // ── Path 1 — caller supplied a healthId (from JWT scope) ────────
        // Use the canonical hash-first helper. Survives PDPA Phase D
        // encryption of `User.healthId` (queries `healthIdHash`).
        if (healthId) {
            const userByHealthId = await findUserByHealthIdSecurely(healthId, {
                select: { id: true, healthId: true, canonicalId: true },
                client: prisma,
            });

            if (!userByHealthId?.id || !userByHealthId?.healthId) {
                throw new Error('Health account not found for this healthId');
            }

            if (explicitUserId && explicitUserId !== userByHealthId.id) {
                logger.warn('[ApplicationService.resolveHealthIdentity] Token userId mismatch with healthId scope', {
                    explicitUserId,
                    resolvedUserId: userByHealthId.id,
                    healthIdMasked: maskThaiId(healthId),
                });
            }

            return {
                userId: userByHealthId.id,
                // FK value written into Application.healthId — token when the
                // re-key flag is on (see fkValue / STAGE 0 note above).
                healthId: fkValue(userByHealthId),
            };
        }

        if (!explicitUserId) {
            throw Object.assign(new Error('Health identity is required and must include healthId'), { statusCode: 401 });
        }

        // ── Path 2 — caller supplied a UUID (User.id FK) ───────────────
        // `User.id` is an FK column, stays plaintext under PDPA. Single
        // primary-key lookup; this is the common case for health route
        // handlers that pass `req.user.id`.
        if (isUuid(explicitUserId)) {
            const userById = await prisma.user.findFirst({
                where: { id: explicitUserId, isDeleted: false },
                select: { id: true, healthId: true, canonicalId: true },
            });

            if (userById?.id && userById?.healthId) {
                return {
                    userId: userById.id,
                    healthId: fkValue(userById),
                };
            }

            if (userById?.id && !userById?.healthId) {
                throw Object.assign(new Error('Health account must have healthId'), { statusCode: 401 });
            }

            // Fall through to throw — no plaintext `healthId` fallback for
            // a UUID input, since UUIDs cannot collide with the Thai-ID
            // numeric space.
            throw Object.assign(new Error('Health identity is required and must include healthId'), { statusCode: 401 });
        }

        // ── Path 3 — caller supplied a 13-digit ID in the `identityRef`
        //            positional slot (legacy tokens that placed `healthId`
        //            in `id`). Route through the canonical hash-first
        //            helper so PDPA Phase D encryption does not break it.
        if (isThaiId(explicitUserId)) {
            const userByLegacyHealthId = await findUserByHealthIdSecurely(explicitUserId, {
                select: { id: true, healthId: true, canonicalId: true },
                client: prisma,
            });

            if (userByLegacyHealthId?.id && userByLegacyHealthId?.healthId) {
                logger.warn('[ApplicationService.resolveHealthIdentity] Fallback identity mapping applied', {
                    providedIdMasked: maskThaiId(explicitUserId),
                    resolvedUserId: userByLegacyHealthId.id,
                });
                return {
                    userId: userByLegacyHealthId.id,
                    healthId: fkValue(userByLegacyHealthId),
                };
            }
        }

        // Otherwise — not a UUID, not a 13-digit ID, no `options.healthId`
        // — refuse to do a broad lookup. Matches the user-lookup-service
        // discipline of "no fallback to broad query".
        throw Object.assign(new Error('Health identity is required and must include healthId'), { statusCode: 401 });
    }

    // Backward-compatible alias (to be removed after full migration)
    async function resolveHealthUserIdentity(identityRef, options = {}) {
        return resolveHealthIdentity(identityRef, options);
    }

    async function resolveHealthUserId(identityRef, options = {}) {
        const identity = await resolveHealthIdentity(identityRef, options);
        return identity.userId;
    }

    async function resolveHealthId(identityRef, options = {}) {
        const identity = await resolveHealthIdentity(identityRef, options);
        return identity.healthId;
    }

    // Backward-compatible aliases (to be removed after full migration)
    async function resolveHEALTH_USERUserId(identityRef, options = {}) {
        return resolveHealthUserId(identityRef, options);
    }

    async function resolveHEALTH_USERHealthId(identityRef, options = {}) {
        return resolveHealthId(identityRef, options);
    }

    function buildHealthWhereClause(identityRef, options = {}) {
        const healthId = normalizeIdentityValue(options.healthId);
        const explicitUserId = normalizeIdentityValue(options.userId || identityRef);

        // ── Wave A chunk 4 — workspace scope (farm-worker permissions) ──
        // When the caller EXPLICITLY acts under a workspace (x-active-entity-id
        // header → active-entity-middleware validated an ACTIVE membership and
        // bound `personal:false`), the applicant pin must RELAX to entity
        // scope. The read-side prisma extension already ANDs
        // `entityId: <active entity>` into Application reads, so keeping the
        // applicant pin here would intersect a co-member's identity with the
        // owner's rows → guaranteed-empty set. Spoofed headers never reach
        // this code (middleware 403s non-members), and we still require SOME
        // caller identity so the "no broad query" discipline holds.
        // Personal default contexts (`personal:true` — solo farmers) keep the
        // legacy where byte-for-byte.
        //
        // Wave A fix M2 (adversarial-verify 2026-07-02): DESTRUCTIVE ops must
        // NOT ride the relaxed workspace where — a co-member could soft-delete
        // the owner's draft (permanent-grade; no DRAFT_DELETE in the Wave-B
        // taxonomy). Callers of destructive methods (deleteDraft) pass
        // `strictApplicantPin: true` to skip the relax branch: reads stay
        // relaxed, destructive draft ops stay personal.
        const entityCtx = getEntityContext();
        if (
            options.strictApplicantPin !== true
            && (explicitUserId || healthId) && entityCtx?.entityId && entityCtx.personal === false
        ) {
            return { entityId: entityCtx.entityId };
        }

        // Detokenize STAGE 0 (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md,
        // breaker 3c): PREFER the `applicant:{id}` relation branch whenever a
        // stable UUID userId is available. Application.healthId is an FK to
        // User.canonicalId; filtering by `{ healthId: <value> }` compares the FK
        // against req.user.healthId (the national ID), which STOPS matching the
        // moment the STAGE-A re-key flips Application.healthId to the token. The
        // relation branch joins on User.id (never re-keyed) → the same ownership
        // scope, correct in BOTH data states (national ID today, token after the
        // re-key). It is also strictly equal-or-tighter than the value-WHERE: it
        // matches exactly the rows owned by this user. Routes pass req.user.id as
        // identityRef, so this is the live path.
        if (explicitUserId && isUuid(explicitUserId)) {
            return {
                applicant: {
                    id: explicitUserId,
                    isDeleted: false,
                },
            };
        }

        // No stable UUID — fall back to the legacy value-WHERE on the FK column.
        // Reached only by callers that supply a healthId but no userId (e.g. unit
        // tests / legacy positional callers). Correct pre-re-key; such callers
        // must migrate to passing a userId before STAGE A flips the data.
        if (healthId) {
            return { healthId };
        }

        if (options.strictHealthId === true) {
            return null;
        }

        // Non-UUID explicit identifier with no healthId — refuse a broad query
        // (matches the prior discipline of "no fallback to broad lookup").
        return null;
    }

    // Backward-compatible alias (to be removed after full migration)
    function buildHEALTH_USERWhereClause(identityRef, options = {}) {
        return buildHealthWhereClause(identityRef, options);
    }

    return {
        normalizeIdentityValue,
        resolveHealthIdentity,
        resolveHealthUserIdentity,
        resolveHealthUserId,
        resolveHealthId,
        resolveHEALTH_USERUserId,
        resolveHEALTH_USERHealthId,
        buildHealthWhereClause,
        buildHEALTH_USERWhereClause,
    };
}

module.exports = { createApplicationIdentityMethods };
