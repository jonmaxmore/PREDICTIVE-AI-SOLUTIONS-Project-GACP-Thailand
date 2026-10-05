/**
 * Backfill Entity + EntityMembership for every existing User, then wire
 * existing Applications and Farms to the user's personal Entity.
 *
 * Phase 62 (Entity foundation) + Phase 66 (Application/Farm wiring).
 *
 * ─────────────────────────────────────────────────────────────────────
 * DETOKENIZE REWRITE (2026-07, bug verified live on staging)
 * ─────────────────────────────────────────────────────────────────────
 * This script was originally written assuming `User.healthId` and
 * `Application.healthId` are PLAINTEXT 13-digit national IDs. Since the
 * national-ID-at-rest work (see the project rules) that is no longer true:
 *
 *   (a) ENABLE_PDPA_FIELD_ENCRYPTION → `User.healthId` is stored `enc:v1:…`
 *       AES ciphertext. A RAW `new PrismaClient()` reads the CIPHERTEXT.
 *   (b) APP_FK_USE_TOKEN → `Application.healthId` holds a keyed-HMAC TOKEN
 *       (== `User.canonicalId`), NOT the national ID.
 *   (c) `Entity.thaiCitizenIdHash` = sha256(plaintext national id).
 *
 * The old logic `entity.findFirst({ thaiCitizenIdHash: hashId(healthId) })`
 * therefore hashed the CIPHERTEXT / TOKEN → never matched the real entity →
 * CREATED A DUPLICATE INDIVIDUAL entity per user, wired 0 apps, and pointed
 * farms at the wrong (duplicate) entity.
 *
 * The runtime resolves a user's personal INDIVIDUAL entity via their OWNER
 * INDIVIDUAL EntityMembership (services/entity-service.js
 * ensurePersonalIndividualEntity, lines ~220-228) — a stable, non-PII,
 * encoding-independent link. This script now mirrors that:
 *
 *   Step 1: resolve the user's existing personal INDIVIDUAL entity via their
 *           OWNER INDIVIDUAL membership. Create one ONLY when they have none
 *           (setting thaiCitizenIdHash from the DECRYPTED plaintext, the same
 *           way the runtime does). Never creates a duplicate. Idempotent.
 *   Step 2: resolve the app owner by `User.canonicalId = app.healthId` (token
 *           join — the SAME identifier), then set Application.entityId to that
 *           user's personal entity. NO hashing of Application.healthId.
 *   Step 3: `Farm.ownerId = User.id` → owner's personal entity via membership.
 *           NO hashing.
 *
 * The `prisma` passed in from main() is the PDPA-EXTENDED client from
 * services/prisma-database (its $allModels decrypt walker returns plaintext
 * `healthId`), so `hashId(user.healthId)` on the create path matches the
 * runtime's `thaiCitizenIdHash`. As a belt-and-suspenders guard, we also run
 * any lingering `enc:v1:` value through field-encryption.decrypt().
 *
 * Idempotent — safe to re-run. Provider users (auth via providerId, no
 * healthId) are skipped; they aren't legal applicants.
 *
 * Usage:
 *   node apps/backend/scripts/backfill-entities.js            # LIVE run
 *   node apps/backend/scripts/backfill-entities.js --dry-run  # read-only
 *   node apps/backend/scripts/backfill-entities.js --verbose  # per-row log
 *
 * Output ends with a summary count per step + a verify() re-count.
 */

'use strict';

const crypto = require('crypto');
const { decrypt } = require('../utils/field-encryption');

function hashId(id) {
    return crypto.createHash('sha256').update(String(id)).digest('hex');
}

/**
 * Return the DECRYPTED plaintext national id for a user.healthId value.
 *
 * The PDPA-extended client already decrypts on read, so most values arrive
 * plaintext. If an `enc:v1:` ciphertext leaks through (e.g. a caller injected
 * the raw basePrisma), decrypt it so the create-path hash matches the runtime.
 * Returns null when decryption fails (never a hash of ciphertext).
 */
function plaintextHealthId(value) {
    if (value === null || value === undefined) {return null;}
    const s = String(value);
    if (s.startsWith('enc:v1:')) {
        const dec = decrypt(s.slice('enc:v1:'.length));
        return dec || null;
    }
    // Defensive: some hooks store the bare `<iv>:<tag>:<ct>` form. Only try to
    // decrypt when it clearly isn't a 13-digit id (a real national id has no ':').
    if (s.includes(':') && !/^\d{13}$/.test(s)) {
        const dec = decrypt(s);
        if (dec) {return dec;}
    }
    return s;
}

function buildDisplayName(user) {
    const first = (user.firstName || '').trim();
    const last = (user.lastName || '').trim();
    const full = `${first} ${last}`.trim();
    if (full) {return full;}
    if (user.email) {return user.email;}
    return user.healthId || user.id;
}

/**
 * Resolve THIS user's personal INDIVIDUAL entity id the same way the runtime
 * does: via their OWNER INDIVIDUAL EntityMembership (stable, non-PII,
 * encoding-independent). This is the entity the workspace/personal-context
 * picks, so backfilled rows stay visible to the owner.
 *
 * When the user has NO such membership, create a fresh INDIVIDUAL entity +
 * OWNER membership (mirroring ensurePersonalIndividualEntity), setting
 * thaiCitizenIdHash from the DECRYPTED plaintext national id — never a hash
 * of the ciphertext. In dry-run, resolve-only: return null and write nothing.
 *
 * @param {object} prisma  injected client (PDPA-extended in prod)
 * @param {object} user    { id, healthId, organizationId, firstName?, lastName?, email? }
 * @param {object} opts     { dryRun }
 * @returns {Promise<string|null>} the personal entity id, or null when none
 *          exists and we didn't create one (dry-run / missing prerequisites).
 */
async function resolveUserPersonalEntity(prisma, user, { dryRun = false } = {}) {
    // 1) Runtime-authoritative link: the OWNER INDIVIDUAL membership.
    // Wave B chunk 6 — stable ordering (oldest wins) matching the runtime
    // resolvers, so the backfill picks the SAME personal entity they do.
    const ownerMembership = await prisma.entityMembership.findFirst({
        where: {
            userId: user.id,
            role: 'OWNER',
            entity: { type: 'INDIVIDUAL', isDeleted: false },
        },
        select: { entity: true },
        orderBy: { createdAt: 'asc' },
    });
    if (ownerMembership && ownerMembership.entity) {
        return ownerMembership.entity.id;
    }

    // No membership → the user genuinely has no personal entity yet. Only
    // create when we can do so consistently with the runtime (needs org +
    // a decryptable national id for the dedup hash).
    if (!user.healthId || !user.organizationId) {
        return null;
    }
    if (dryRun) {
        return null; // resolve-only; report WOULD_CREATE at the step level
    }

    const plaintext = plaintextHealthId(user.healthId);
    if (!plaintext) {
        // Never fall through to hashing ciphertext — that's the original bug.
        return null;
    }
    const idHash = hashId(plaintext);

    // Belt-and-suspenders dedup: an entity may exist from a prior partial run
    // without a membership row. Match it the runtime way (by thaiCitizenIdHash
    // of the PLAINTEXT id) before creating a new one.
    const existing = await prisma.entity.findFirst({
        where: { type: 'INDIVIDUAL', thaiCitizenIdHash: idHash },
        select: { id: true },
        // Wave B chunk 6 — deterministic pick (oldest candidate wins).
        orderBy: { createdAt: 'asc' },
    });

    let entityId;
    if (existing) {
        entityId = existing.id;
    } else {
        const entity = await prisma.entity.create({
            data: {
                type: 'INDIVIDUAL',
                displayName: buildDisplayName(user),
                thaiCitizenId: plaintext,
                thaiCitizenIdHash: idHash,
                status: 'ACTIVE',
                createdBy: user.id,
                organizationId: user.organizationId,
            },
        });
        entityId = entity.id;
    }

    await prisma.entityMembership.upsert({
        where: { userId_entityId: { userId: user.id, entityId } },
        update: { role: 'OWNER', status: 'ACTIVE', acceptedAt: new Date() },
        create: {
            userId: user.id,
            entityId,
            role: 'OWNER',
            status: 'ACTIVE',
            invitedBy: null,
            invitedAt: null,
            acceptedAt: new Date(),
            organizationId: user.organizationId,
        },
    });

    return entityId;
}

async function step1BackfillEntities(prisma, { dryRun = false, verbose = false, log = console.log } = {}) {
    log('Step 1 — backfill INDIVIDUAL Entity per User (via OWNER membership)');
    log('--------------------------------------------------');

    const users = await prisma.user.findMany({
        where: {
            isDeleted: false,
            healthId: { not: null },
        },
        select: {
            id: true,
            healthId: true,
            firstName: true,
            lastName: true,
            email: true,
            organizationId: true,
        },
    });

    log(`  found ${users.length} users with healthId`);

    let resolvedExisting = 0;
    let entitiesCreated = 0;
    let skipped = 0;
    let failed = 0;

    for (const user of users) {
        try {
            if (!user.organizationId) {
                skipped++;
                if (verbose) {log(`  SKIP ${user.id}: no organizationId`);}
                continue;
            }
            // Peek at the membership first so we can distinguish resolve vs create
            // in the summary (and honour dry-run without a write).
            const ownerMembership = await prisma.entityMembership.findFirst({
                where: {
                    userId: user.id,
                    role: 'OWNER',
                    entity: { type: 'INDIVIDUAL', isDeleted: false },
                },
                select: { entity: true },
                // Wave B chunk 6 — deterministic pick (oldest candidate wins).
                orderBy: { createdAt: 'asc' },
            });
            if (ownerMembership && ownerMembership.entity) {
                resolvedExisting++;
                if (verbose) {log(`  OK   ${user.id}: existing entity ${ownerMembership.entity.id}`);}
                continue;
            }

            if (dryRun) {
                entitiesCreated++; // WOULD create
                if (verbose) {log(`  WOULD_CREATE ${user.id}: no OWNER INDIVIDUAL membership`);}
                continue;
            }

            const entityId = await resolveUserPersonalEntity(prisma, user, { dryRun: false });
            if (entityId) {
                entitiesCreated++;
                if (verbose) {log(`  CREATED ${user.id}: entity ${entityId}`);}
            } else {
                skipped++;
                if (verbose) {log(`  SKIP ${user.id}: could not resolve/create (undecryptable healthId?)`);}
            }
        } catch (err) {
            failed++;
            log(`  FAIL ${user.id}: ${err.message}`);
        }
    }

    log(`  resolved existing:   ${resolvedExisting}`);
    log(`  entities created${dryRun ? ' (would)' : ''}: ${entitiesCreated}`);
    log(`  skipped:             ${skipped}`);
    log(`  failed:              ${failed}`);

    return { totalUsersWithHealthId: users.length, resolvedExisting, entitiesCreated, skipped, failed };
}

async function step2BackfillApplications(prisma, { dryRun = false, verbose = false, log = console.log } = {}) {
    log('');
    log('Step 2 — wire Application.entityId + submitterId (token join, NO hash)');
    log('--------------------------------------------------');

    const applications = await prisma.application.findMany({
        where: {
            entityId: null,
            isDeleted: false,
        },
        select: {
            id: true,
            healthId: true,
        },
    });

    log(`  found ${applications.length} applications missing entityId`);

    let updated = 0;
    let missingOwner = 0;
    let missingEntity = 0;
    let failed = 0;

    for (const app of applications) {
        try {
            // Application.healthId FKs to User.canonicalId (the SAME token under
            // APP_FK_USE_TOKEN). Resolve the owner by that token — NEVER hash it.
            const user = await prisma.user.findFirst({
                where: { canonicalId: app.healthId, isDeleted: false },
                select: {
                    id: true, healthId: true, organizationId: true,
                    firstName: true, lastName: true, email: true,
                },
            });
            if (!user) {
                missingOwner++;
                if (verbose) {log(`  MISSING_OWNER application ${app.id}: no User.canonicalId = ${app.healthId}`);}
                continue;
            }

            const entityId = await resolveUserPersonalEntity(prisma, user, { dryRun });
            if (!entityId) {
                missingEntity++;
                if (verbose) {log(`  MISSING_ENTITY application ${app.id}: owner ${user.id} has no personal entity`);}
                continue;
            }

            if (dryRun) {
                updated++; // WOULD update
                if (verbose) {log(`  WOULD_UPDATE application ${app.id} → entity ${entityId}, submitter ${user.id}`);}
                continue;
            }

            await prisma.application.update({
                where: { id: app.id },
                data: { entityId, submitterId: user.id },
            });
            updated++;
            if (verbose) {log(`  UPDATED application ${app.id} → entity ${entityId}, submitter ${user.id}`);}
        } catch (err) {
            failed++;
            log(`  FAIL application ${app.id}: ${err.message}`);
        }
    }

    log(`  updated${dryRun ? ' (would)' : ''}: ${updated}`);
    log(`  missing owner:  ${missingOwner} (no User.canonicalId = app.healthId token)`);
    log(`  missing entity: ${missingEntity} (owner has no personal INDIVIDUAL entity)`);
    log(`  failed:         ${failed}`);

    return { totalApplications: applications.length, updated, missingOwner, missingEntity, failed };
}

async function step3BackfillFarms(prisma, { dryRun = false, verbose = false, log = console.log } = {}) {
    log('');
    log('Step 3 — wire Farm.entityId from ownerId (User.id → membership, NO hash)');
    log('--------------------------------------------------');

    const farms = await prisma.farm.findMany({
        where: {
            entityId: null,
            isDeleted: false,
        },
        select: {
            id: true,
            ownerId: true,
        },
    });

    log(`  found ${farms.length} farms missing entityId`);

    let updated = 0;
    let missingOwner = 0;
    let missingEntity = 0;
    let failed = 0;

    for (const farm of farms) {
        try {
            // Farm.ownerId references User.id directly — resolve the owner, then
            // their personal INDIVIDUAL entity via membership. NO hash lookup.
            const owner = await prisma.user.findUnique({
                where: { id: farm.ownerId },
                select: {
                    id: true, healthId: true, organizationId: true,
                    firstName: true, lastName: true, email: true,
                },
            });
            if (!owner || !owner.healthId) {
                missingOwner++;
                if (verbose) {log(`  MISSING_OWNER farm ${farm.id}: ownerId ${farm.ownerId}`);}
                continue;
            }

            const entityId = await resolveUserPersonalEntity(prisma, owner, { dryRun });
            if (!entityId) {
                missingEntity++;
                if (verbose) {log(`  MISSING_ENTITY farm ${farm.id}: owner ${owner.id} has no personal entity`);}
                continue;
            }

            if (dryRun) {
                updated++; // WOULD update
                if (verbose) {log(`  WOULD_UPDATE farm ${farm.id} → entity ${entityId}`);}
                continue;
            }

            await prisma.farm.update({
                where: { id: farm.id },
                data: { entityId },
            });
            updated++;
            if (verbose) {log(`  UPDATED farm ${farm.id} → entity ${entityId}`);}
        } catch (err) {
            failed++;
            log(`  FAIL farm ${farm.id}: ${err.message}`);
        }
    }

    log(`  updated${dryRun ? ' (would)' : ''}: ${updated}`);
    log(`  missing owner:  ${missingOwner}`);
    log(`  missing entity: ${missingEntity}`);
    log(`  failed:         ${failed}`);

    return { totalFarms: farms.length, updated, missingOwner, missingEntity, failed };
}

async function verify(prisma, { log = console.log } = {}) {
    log('');
    log('Verify');
    log('--------------------------------------------------');

    const users = await prisma.user.count({ where: { isDeleted: false, healthId: { not: null } } });
    const individualEntities = await prisma.entity.count({ where: { type: 'INDIVIDUAL' } });
    const ownerMemberships = await prisma.entityMembership.count({ where: { role: 'OWNER' } });
    const appsWithEntity = await prisma.application.count({ where: { entityId: { not: null }, isDeleted: false } });
    const appsWithoutEntity = await prisma.application.count({ where: { entityId: null, isDeleted: false } });
    const farmsWithEntity = await prisma.farm.count({ where: { entityId: { not: null }, isDeleted: false } });
    const farmsWithoutEntity = await prisma.farm.count({ where: { entityId: null, isDeleted: false } });

    log(`  users with healthId:           ${users}`);
    log(`  INDIVIDUAL entities:           ${individualEntities}`);
    log(`  OWNER memberships:             ${ownerMemberships}`);
    log(`  applications with entityId:    ${appsWithEntity}`);
    log(`  applications WITHOUT entityId: ${appsWithoutEntity}`);
    log(`  farms with entityId:           ${farmsWithEntity}`);
    log(`  farms WITHOUT entityId:        ${farmsWithoutEntity}`);

    // NOTE: individualEntities can be < users (juristic-only applicants, provider
    // users with no personal entity), so we assert OWNER memberships cover every
    // user (each user gets exactly one personal-entity OWNER row) and that no
    // application / farm was left unwired. This is re-run-safe.
    const ok = (
        ownerMemberships >= users &&
        appsWithoutEntity === 0 &&
        farmsWithoutEntity === 0
    );

    if (!ok) {
        log('VERIFY FAILED — counts do not match expected.');
        return { ok: false, users, individualEntities, ownerMemberships, appsWithoutEntity, farmsWithoutEntity };
    }
    log('verify OK');
    return { ok: true, users, individualEntities, ownerMemberships, appsWithoutEntity, farmsWithoutEntity };
}

function parseArgs(argv = []) {
    return {
        dryRun: argv.includes('--dry-run'),
        verbose: argv.includes('--verbose'),
    };
}

async function run(prisma, { dryRun = false, verbose = false, log = console.log } = {}) {
    log('Phase 62 + 66 — backfill Entity, Application, Farm');
    log('==================================================');
    log(dryRun ? '*** DRY RUN — no writes will be performed ***' : '*** LIVE RUN ***');

    const step1 = await step1BackfillEntities(prisma, { dryRun, verbose, log });
    const step2 = await step2BackfillApplications(prisma, { dryRun, verbose, log });
    const step3 = await step3BackfillFarms(prisma, { dryRun, verbose, log });
    // In dry-run the writes never happened, so a post-run verify would "fail"
    // by design — skip it and report intended actions instead.
    const verification = dryRun ? { ok: true, skipped: true } : await verify(prisma, { log });

    return { dryRun, step1, step2, step3, verify: verification };
}

async function main() {
    const { dryRun, verbose } = parseArgs(process.argv.slice(2));
    // Use the PDPA-EXTENDED client so User.healthId reads back DECRYPTED — the
    // whole point of the detokenize fix. Required lazily so `require`-ing this
    // module for tests never touches services/prisma-database (which exits when
    // DATABASE_URL is unset).
    const { prisma } = require('../services/prisma-database');
    try {
        const result = await run(prisma, { dryRun, verbose });
        const failed = !result.dryRun && result.verify && result.verify.ok === false;
        if (failed) {
            process.exitCode = 1;
        }
    } catch (err) {
        console.error('fatal:', err);
        process.exitCode = 2;
    } finally {
        await prisma.$disconnect().catch(() => {});
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    hashId,
    plaintextHealthId,
    buildDisplayName,
    resolveUserPersonalEntity,
    step1BackfillEntities,
    step2BackfillApplications,
    step3BackfillFarms,
    verify,
    parseArgs,
    run,
};
