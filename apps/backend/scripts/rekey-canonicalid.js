#!/usr/bin/env node
/**
 * Detokenize STAGE A — re-key `users.canonicalId` from the national ID to the
 * keyed-HMAC token.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md (STAGE A — RE-KEY)
 *
 * WHAT IT DOES (in ONE transaction):
 *   1. Re-key the parent:
 *        UPDATE users SET "canonicalId" = COALESCE("healthIdHmac","providerIdHmac", id)
 *      The 3 FK children (applications.healthId, invoices.healthId,
 *      application_bundles.healthId → users.canonicalId) are ON UPDATE CASCADE,
 *      so they are rewritten atomically in the SAME statement — no FK dangles.
 *   2. Lockstep-rewrite the loose scalar `payment_slips.uploadedBy` (a stamped
 *        identifier, NOT an FK, so it does NOT cascade):
 *        UPDATE payment_slips SET "uploadedBy" = u."canonicalId"
 *          FROM users u WHERE payment_slips."uploadedBy" = u."canonicalIdLegacy"
 *      Matching on canonicalIdLegacy (the pre-re-key national ID) → the new
 *      token. Old slip rows stamped with the national ID become token-stamped;
 *      the ownership resolver's OR:[{canonicalId},{healthId},{id}] keeps any
 *      that slip through resolving.
 *   2b. STAGE A.2 — Lockstep-rewrite the SECOND loose scalar that STAGE A
 *        missed: `attachments.uploadedBy`. Same shape as the slip lockstep.
 *        The PaymentSlip-backed Attachment rows (resModel='PaymentSlip') were
 *        backfilled from payment_slips.uploadedBy (scripts/backfill-attachments.js)
 *        BEFORE STAGE A re-keyed the slip column, so they retained the raw
 *        national ID — a staging pg_dump grep found exactly these rows. This
 *        re-keys them in the SAME transaction as the slip + parent re-key:
 *        UPDATE attachments SET "uploadedBy" = u."canonicalId"
 *          FROM users u WHERE attachments."uploadedBy" = u."canonicalIdLegacy"
 *      Going forward the live write path already stamps the token (the slip
 *      upload stamps req.user.canonicalId = the token under APP_FK_USE_TOKEN,
 *      and the Attachment dual-write copies that value) — this lockstep only
 *      closes the HISTORICAL rows that predate STAGE A.
 *   3. FK-integrity assertions: 0 orphan rows in applications / invoices /
 *      application_bundles where child.healthId has no matching user.canonicalId.
 *
 * PRE-CONDITIONS (asserted, abort if not met):
 *   - canonicalIdLegacy is populated for every row whose canonicalId is about to
 *     change (the STAGE-0 migration backfilled it). Rollback depends on it.
 *   - The *Hmac columns are backfilled (H-4 Phase 1 backfill ran). A row with a
 *     national ID but NULL healthIdHmac AND NULL providerIdHmac would re-key to
 *     `id` (the COALESCE fallback) — flagged as a warning, not silently dropped.
 *
 * SAFETY / OPS:
 *   - Idempotent: re-running after a successful run is a no-op (source national-ID
 *     space and target HMAC space are disjoint, so the parent UPDATE matches
 *     nothing the second time; the slip UPDATE matches nothing once uploadedBy is
 *     already the token). Logs counts each run.
 *   - --dry-run: counts what WOULD change inside a transaction that is ROLLED
 *     BACK, writes nothing.
 *   - --rollback: UPDATE users SET "canonicalId" = COALESCE("canonicalIdLegacy",
 *     "canonicalId") — restores the pre-re-key value (COALESCE guards new users
 *     created after the re-key whose canonicalIdLegacy is NULL; they keep their
 *     token). The slip uploadedBy lockstep is reversed too, and so is the
 *     attachments.uploadedBy lockstep (STAGE A.2).
 *   - exit 1 on any assertion failure (so the operator never proceeds on a
 *     half-migrated DB).
 *
 * THIS SCRIPT IS NOT RUN BY STAGE 0. It ships INERT alongside the STAGE-0
 *    prep. STAGE A runs it (first --dry-run on STAGING per golden rules #2/#7,
 *    then live, baked in the same image that flips APP_FK_USE_TOKEN=true). DO
 *    NOT auto-run.
 *
 * Usage on the droplet (inside the backend container, low-traffic window):
 *   node apps/backend/scripts/rekey-canonicalid.js --dry-run
 *   node apps/backend/scripts/rekey-canonicalid.js
 *   node apps/backend/scripts/rekey-canonicalid.js --rollback
 *
 * Exit codes: 0 success (assertions held), 1 fatal / assertion failed.
 */

'use strict';

const path = require('path');

function parseArgs(argv) {
    return {
        dryRun: argv.includes('--dry-run'),
        rollback: argv.includes('--rollback'),
    };
}

async function loadPrisma(injected) {
    if (injected) {return injected;}
    const mod = require(path.resolve(__dirname, '../services/prisma-database'));
    const prisma = mod && mod.prisma ? mod.prisma : null;
    if (!prisma) {throw new Error('prisma client unavailable');}
    return prisma;
}

async function loadHelpers(injected) {
    if (injected) {return injected;}
    const { withoutTenantScope } = require(path.resolve(__dirname, '../services/tenant-context'));
    return { withoutTenantScope };
}

/**
 * Count rows that still violate the parent↔child FK invariant. ANY of these > 0
 * after a real run means the re-key left dangling FKs — must be zero.
 *
 * @returns {Promise<Array<{table: string, orphans: number}>>}
 */
async function assertFkIntegrity(tx) {
    const offenders = [];
    const checks = [
        { table: 'applications', sql: `SELECT COUNT(*)::bigint AS c FROM "applications" a LEFT JOIN "users" u ON a."healthId" = u."canonicalId" WHERE a."healthId" IS NOT NULL AND u."canonicalId" IS NULL` },
        { table: 'invoices', sql: `SELECT COUNT(*)::bigint AS c FROM "invoices" i LEFT JOIN "users" u ON i."healthId" = u."canonicalId" WHERE i."healthId" IS NOT NULL AND u."canonicalId" IS NULL` },
        { table: 'application_bundles', sql: `SELECT COUNT(*)::bigint AS c FROM "application_bundles" b LEFT JOIN "users" u ON b."healthId" = u."canonicalId" WHERE b."healthId" IS NOT NULL AND u."canonicalId" IS NULL` },
    ];
    for (const chk of checks) {
        const rows = await tx.$queryRawUnsafe(chk.sql);
        const orphans = rows && rows[0] ? Number(rows[0].c) : 0;
        if (orphans > 0) {offenders.push({ table: chk.table, orphans });}
    }
    return offenders;
}

/**
 * Rows that would re-key to `id` because BOTH *Hmac columns are NULL while a
 * national ID is present — surfaced as a warning so the operator can backfill
 * *Hmac first instead of poisoning canonicalId with a UUID for a real account.
 */
async function findMissingHmac(tx) {
    const rows = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::bigint AS c FROM "users"
         WHERE "isDeleted" = false
           AND ("healthId" IS NOT NULL OR "providerId" IS NOT NULL)
           AND "healthIdHmac" IS NULL AND "providerIdHmac" IS NULL`,
    );
    return rows && rows[0] ? Number(rows[0].c) : 0;
}

/**
 * Rows whose canonicalId is about to change but have NO escrow value — rollback
 * would be impossible for them. Must be 0 before a real forward run.
 */
async function findMissingLegacyEscrow(tx) {
    const rows = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::bigint AS c FROM "users"
         WHERE "canonicalIdLegacy" IS NULL
           AND "canonicalId" <> COALESCE("healthIdHmac","providerIdHmac", id)`,
    );
    return rows && rows[0] ? Number(rows[0].c) : 0;
}

async function rekey({ prisma: injectedPrisma, helpers: injectedHelpers, dryRun = false, rollback = false, log = () => {} } = {}) {
    const prisma = await loadPrisma(injectedPrisma);
    const { withoutTenantScope } = await loadHelpers(injectedHelpers);

    return withoutTenantScope(async () => {
        // Run inside a single transaction so a partial failure leaves no
        // half-migrated state. In --dry-run we deliberately THROW a sentinel to
        // force a rollback after counting.
        const DRY_RUN_ABORT = Symbol('dry-run-abort');
        const result = {
            ranAt: new Date().toISOString(),
            mode: rollback ? 'rollback' : 'forward',
            dryRun,
            usersRekeyed: 0,
            slipsRewritten: 0,
            attachmentsRewritten: 0,
            missingHmac: 0,
            missingLegacyEscrow: 0,
            fkOffenders: [],
            assertionHeld: null,
        };

        try {
            await prisma.$transaction(async (tx) => {
                if (rollback) {
                    // Reverse the slip lockstep FIRST (it depends on the current
                    // token value still being in users.canonicalId).
                    const slip = await tx.$executeRawUnsafe(
                        `UPDATE "payment_slips" ps SET "uploadedBy" = u."canonicalIdLegacy"
                         FROM "users" u
                         WHERE ps."uploadedBy" = u."canonicalId"
                           AND u."canonicalIdLegacy" IS NOT NULL`,
                    );
                    result.slipsRewritten = Number(slip) || 0;
                    // STAGE A.2: reverse the attachments lockstep too (also keyed
                    // on the current token still being in users.canonicalId).
                    const att = await tx.$executeRawUnsafe(
                        `UPDATE "attachments" a SET "uploadedBy" = u."canonicalIdLegacy"
                         FROM "users" u
                         WHERE a."uploadedBy" = u."canonicalId"
                           AND u."canonicalIdLegacy" IS NOT NULL`,
                    );
                    result.attachmentsRewritten = Number(att) || 0;
                    // Restore canonicalId from escrow (COALESCE guards post-re-key
                    // users whose canonicalIdLegacy is NULL — they keep the token).
                    const users = await tx.$executeRawUnsafe(
                        `UPDATE "users" SET "canonicalId" = COALESCE("canonicalIdLegacy","canonicalId")
                         WHERE "canonicalIdLegacy" IS NOT NULL
                           AND "canonicalId" <> "canonicalIdLegacy"`,
                    );
                    result.usersRekeyed = Number(users) || 0;
                } else {
                    // Forward re-key. Pre-flight assertions inside the tx.
                    result.missingHmac = await findMissingHmac(tx);
                    result.missingLegacyEscrow = await findMissingLegacyEscrow(tx);
                    if (result.missingLegacyEscrow > 0) {
                        throw new Error(
                            `${result.missingLegacyEscrow} row(s) would change canonicalId with NO canonicalIdLegacy escrow — `
                            + 'run the STAGE-0 migration backfill first (rollback would be impossible for them).',
                        );
                    }

                    // 1. Re-key parent (cascades to the 3 FK children).
                    const users = await tx.$executeRawUnsafe(
                        `UPDATE "users" SET "canonicalId" = COALESCE("healthIdHmac","providerIdHmac", id)
                         WHERE "canonicalId" <> COALESCE("healthIdHmac","providerIdHmac", id)`,
                    );
                    result.usersRekeyed = Number(users) || 0;

                    // 2. Lockstep-rewrite the loose scalar payment_slips.uploadedBy
                    //    (matched on the escrowed pre-re-key value → new token).
                    const slip = await tx.$executeRawUnsafe(
                        `UPDATE "payment_slips" ps SET "uploadedBy" = u."canonicalId"
                         FROM "users" u
                         WHERE ps."uploadedBy" = u."canonicalIdLegacy"
                           AND u."canonicalIdLegacy" IS NOT NULL
                           AND u."canonicalIdLegacy" <> u."canonicalId"`,
                    );
                    result.slipsRewritten = Number(slip) || 0;

                    // 2b. STAGE A.2 lockstep — the SECOND loose scalar
                    //     attachments.uploadedBy (PaymentSlip-backed Attachment
                    //     rows backfilled from the slip column BEFORE STAGE A;
                    //     same escrow-keyed re-key as the slip lockstep above).
                    const att = await tx.$executeRawUnsafe(
                        `UPDATE "attachments" a SET "uploadedBy" = u."canonicalId"
                         FROM "users" u
                         WHERE a."uploadedBy" = u."canonicalIdLegacy"
                           AND u."canonicalIdLegacy" IS NOT NULL
                           AND u."canonicalIdLegacy" <> u."canonicalId"`,
                    );
                    result.attachmentsRewritten = Number(att) || 0;
                }

                // 3. FK-integrity assertions (both modes).
                result.fkOffenders = await assertFkIntegrity(tx);
                result.assertionHeld = result.fkOffenders.length === 0;
                if (!result.assertionHeld) {
                    throw new Error(
                        `FK integrity assertion FAILED: ${JSON.stringify(result.fkOffenders)} — transaction rolled back.`,
                    );
                }

                log({ phase: 'TX_COMPLETE', ...result });

                if (dryRun) {
                    // Force rollback — nothing is persisted in a dry run.
                    throw DRY_RUN_ABORT;
                }
            });
        } catch (err) {
            if (err === DRY_RUN_ABORT) {
                result.assertionHeld = result.fkOffenders.length === 0;
                result.rolledBack = true;
                return result;
            }
            throw err;
        }

        return result;
    });
}

async function main() {
    const { dryRun, rollback } = parseArgs(process.argv.slice(2));
    try {
        const result = await rekey({
            dryRun,
            rollback,
            log: (entry) => console.log(JSON.stringify(entry)),
        });
        console.log(JSON.stringify(result));
        if (result.missingHmac > 0 && !rollback) {
            console.warn(
                `[rekey-canonicalid] WARNING: ${result.missingHmac} active row(s) have a national ID but NO *Hmac — `
                + 'these re-key to the UUID id (COALESCE fallback). Backfill *Hmac first if that is not intended.',
            );
        }
        if (result.assertionHeld !== true && !dryRun) {
            console.error('[rekey-canonicalid] ASSERTION FAILED — DB left unchanged (transaction rolled back).');
            process.exit(1);
        }
        process.exit(0);
    } catch (err) {
        console.error(`rekey-canonicalid: fatal ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { rekey, assertFkIntegrity, findMissingHmac, findMissingLegacyEscrow, parseArgs };
