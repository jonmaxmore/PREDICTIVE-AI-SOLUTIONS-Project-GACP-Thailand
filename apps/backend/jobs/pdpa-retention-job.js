/**
 * PDPA Retention Enforcement Job
 *
 * Sprint 6 (healthId audit H6, 2026-05-15)
 *
 * Thai PDPA Section 37 requires that personal data be deleted (or rendered
 * non-identifying) once the retention purpose has expired. The `User.retainUntil`
 * column already records each user's expiry timestamp — 5 years by default, 7 years
 * for users who have had an invoice issued. Previously that column was written but
 * never READ — there was no automated process to enforce it.
 *
 * This job runs daily and ANONYMIZES expired users by:
 *   1. Clearing identity-bearing columns (healthId, providerId, idCard, taxId,
 *      communityRegistrationNo, firstName, lastName, email, phoneNumber, addresses)
 *   2. Clearing identifier HASH columns (healthIdHash, providerIdHash, idCardHash,
 *      taxIdHash, communityRegistrationNoHash) so even hash-based correlation is
 *      defeated.
 *   3. Marking `isAnonymized = true` and `anonymizedAt = now()` for audit traceability.
 *
 * LEGAL HOLD (R-HOTFIX-PDPA): rows with `User.legalHold = true`
 * (prisma/schema/auth.prisma:162) are NEVER touched by this sweep. Because step 2
 * nulls the hash columns as well, anonymization is irreversible and un-correlatable
 * — running it over a held record destroys exactly the evidence the hold exists to
 * preserve. The user-initiated erasure paths already refuse under a hold
 * (services/pdpa-service.js:291, services/pdpa-erasure-service.js:260,533 →
 * PDPA_LEGAL_HOLD); this cron path now matches them.
 *
 * The rule itself lives in shared/legal-hold-guard.js, not inline here, so the
 * next sweep anyone writes inherits it. This job applies both of its layers: the
 * `legalHoldExclusion()` predicate in the query, and an `isUnderLegalHold()`
 * re-check of the fetched row before the update so a hold placed mid-sweep wins.
 *
 * Operator decision, 2026-08-03: the skip is PERMANENT, not a deferral. A held row
 * is passed over however long ago `retainUntil` elapsed, and only a human clearing
 * the flag makes it eligible again. Accordingly this job never writes `retainUntil`
 * or `legalHold` — it has no mechanism to extend a retention window or release a
 * hold, and must not grow one.
 *
 * Scope: this job reads and writes `prisma.user`, and — for the same expired user —
 * the document pre-check text described below. The other models carrying a
 * `legalHold` column (see LEGAL_HOLD_MODELS) have no retention sweep of their own.
 *
 * DOCUMENT PRE-CHECK TEXT (document pre-check Task 10, 2026-09-28): a pre-check
 * stores the text read off the applicant's papers (`DocumentPrecheck.extractedText`)
 * and a short quote per observation (`DocumentPrecheckFlag.evidenceSnippet`); both
 * can hold the person's name, address and id numbers. For every user this sweep
 * anonymizes, both are set to null on every pre-check of that user's applications.
 * The pre-check row, its status and each observation's check/result/reasonTH/
 * confidence stay: they record that a check ran and what it said, and carry no
 * text off the page. An application under legal hold keeps its text
 * (`legalHoldExclusion()` on the application; services/document-precheck/clear-text.js,
 * shared with the user-initiated erasure). The clear runs BEFORE the user
 * update: if it fails, the user is left un-anonymized and counted in
 * `stats.errors`, so the next run retries both — never a user marked done with
 * the text still stored.
 *
 * No retention rule deletes ApplicationDocument rows or their files today; the
 * user's retention window is the only retention rule this codebase enforces,
 * so it is the rule the pre-check text follows.
 *
 * The row itself is NOT deleted — foreign-key relationships to Applications,
 * Invoices, Certificates etc. must remain intact for accounting/compliance history.
 * After anonymization the row exists only to satisfy referential integrity; the
 * person it referred to is no longer identifiable from the user record.
 *
 * COMPLETION MARKER (R-HOTFIX-PDPA step 2, 2026-08-03): `User.isAnonymized`
 * (NOT NULL, default false) and `User.anonymizedAt` are declared at
 * prisma/schema/auth.prisma:164-182 and created by migration
 * 20260803130000_add_user_anonymization_markers. Until that migration they were
 * referenced here but existed nowhere — the mocked unit suite accepted any field
 * name, so the sweep only failed once it met a real Postgres.
 *
 * The marker is what makes this job idempotent. Anonymization never moves
 * `retainUntil` (see the legal-hold note above), so an anonymized row would stay a
 * candidate and be re-swept every night, forever, with nothing recording that it
 * had already been done.
 *
 * Both sides now fail closed. A read that cannot apply the `isAnonymized` /
 * `legalHold` predicates aborts the whole run rather than falling back to an
 * unfiltered scan; a write that fails is counted in `stats.errors` and logged,
 * never retried with the markers stripped out. Completing the irreversible
 * null-out while losing the record of having done it is worse than failing.
 *
 * @module jobs/pdpa-retention-job
 */

const { prisma } = require('../services/prisma-database');
const logger = require('../shared/logger');
const { maskThaiId } = require('../utils/field-encryption');
const { sessionEpochStamp } = require('../utils/session-epoch');
const { withoutTenantScope } = require('../services/tenant-context');
const {
    legalHoldExclusion,
    legalHoldSelection,
    isUnderLegalHold,
} = require('../shared/legal-hold-guard');
const { clearPrecheckText } = require('../services/document-precheck/clear-text');

/**
 * Anonymize users whose retention window has expired.
 *
 * The User table is a platform-global resource — the PDPA retention sweep
 * operates across every tenant by design (Section 37 enforcement applies to
 * any record whose retention window has expired, regardless of org). We
 * therefore wrap the entire sweep in `withoutTenantScope` so the Prisma
 * tenant-scope extension does not silently filter the result set down to
 * whatever ambient AsyncLocalStorage context a calling cron runner may have
 * (e.g. when invoked from a queue worker that established a tenant on the
 * previous tick). See ADR-014 / docs/adr/ADR-014-phase-3-handoff.md.
 *
 * @returns {Promise<{ scanned: number, anonymized: number, errors: number, legalHoldSkipped: number, precheckTextsCleared: number }>}
 */
async function runPdpaRetentionSweep() {
    return withoutTenantScope(() => runPdpaRetentionSweepInternal());
}

async function runPdpaRetentionSweepInternal() {
    const now = new Date();
    const stats = { scanned: 0, anonymized: 0, errors: 0, legalHoldSkipped: 0, precheckTextsCleared: 0, failedUserIds: [] };

    // Find users whose retainUntil is in the past, who are not under legal hold, and
    // who have not already been anonymized. We process in batches of 200 to keep the
    // query and transaction sizes bounded even on a large user base.
    let cursor;
    while (true) {
        // FAIL CLOSED: this query intentionally has no `.catch()` fallback. The
        // previous fallback re-queried on `retainUntil` alone whenever the error
        // message mentioned `isAnonymized`, which dropped every other predicate —
        // including the legal-hold filter — and anonymized held rows anyway. If the
        // filters cannot be applied we must destroy nothing. The error propagates to
        // the scheduler's try/catch (jobs/scheduler.js:194), which logs and ends the run.
        const batch = await prisma.user.findMany({
            where: {
                retainUntil: { lte: now },
                // Guard layer 1: never select a row an operator has frozen. ANDed
                // with the date predicate above, so no `retainUntil` value however
                // ancient can bring a held row back into the candidate set.
                ...legalHoldExclusion(),
                // Skip rows a previous run already finished. The column is NOT NULL
                // with a default of false (prisma/schema/auth.prisma:181), so there
                // is no NULL state to also test for — and testing for one would be
                // worse than redundant: Prisma rejects a null predicate on a required
                // scalar before the query reaches Postgres, and this sweep has no
                // read-side fallback, so it would abort every nightly run outright.
                isAnonymized: false,
            },
            select: {
                id: true,
                healthId: true,
                providerId: true,
                retainUntil: true,
                ...legalHoldSelection(),
            },
            orderBy: { id: 'asc' },
            take: 200,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (!batch.length) {break;}
        stats.scanned += batch.length;

        for (const user of batch) {
            // Guard layer 2: re-check the row we actually fetched. A hold placed
            // between the findMany and the update would otherwise slip through, and
            // anonymization cannot be undone.
            if (isUnderLegalHold(user)) {
                stats.legalHoldSkipped += 1;
                logger.warn('[pdpa-retention] Skipping user under legal hold', { userId: user.id });
                continue;
            }

            try {
                logger.info('[pdpa-retention] Anonymizing user', {
                    userId: user.id,
                    healthIdMasked: maskThaiId(user.healthId),
                    retainUntil: user.retainUntil,
                });

                // First the pre-check text: a failure here throws into the catch
                // below before the user is marked anonymized, so the next run
                // retries both.
                stats.precheckTextsCleared += await clearPrecheckText(prisma, user.id);

                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        // Identity fields — null out plaintext.
                        healthId: null,
                        providerId: null,
                        idCard: null,
                        taxId: null,
                        communityRegistrationNo: null,
                        // Identifier hashes — null out so even pseudonymous correlation is defeated.
                        healthIdHash: null,
                        providerIdHash: null,
                        idCardHash: null,
                        taxIdHash: null,
                        communityRegistrationNoHash: null,
                        // Personal data fields.
                        firstName: null,
                        lastName: null,
                        email: null,
                        phoneNumber: null,
                        address: null,
                        province: null,
                        district: null,
                        subdistrict: null,
                        zipCode: null,
                        companyName: null,
                        representativeName: null,
                        representativePosition: null,
                        communityName: null,
                        // Auth fields — invalidate credentials.
                        // Closing-review NEW-1 (2026-05-15): the schema columns are
                        // `twoFactorSecret` / `twoFactorBackupCodes` / `twoFactorEnabled`
                        // (auth.prisma:115-117). The earlier `mfaSecret` / `mfaBackupCodes`
                        // names did NOT exist on the User model — Prisma would throw
                        // "Unknown arg `mfaSecret`" and the retention sweep would error
                        // out before completing anonymisation. The MFA HTTP routes at
                        // routes/api/identity/mfa.js still use the wrong names too
                        // (pre-existing systemic bug — flagged for follow-up).
                        password: 'PDPA_ANONYMIZED',
                        // SF-3: evict any tokens issued before anonymization.
                        sessionsRevokedAt: sessionEpochStamp(),
                        twoFactorSecret: null,
                        twoFactorBackupCodes: null,
                        twoFactorEnabled: false,
                        // Completion marker. NO `.catch()` retry: the marker-less
                        // retry that used to sit here fired whenever the error text
                        // merely MENTIONED these columns, and it finished the
                        // irreversible null-out while leaving the row unmarked — so
                        // the row was swept again the next night and nothing recorded
                        // that it had ever been anonymized. Both columns exist
                        // (migration 20260803130000_add_user_anonymization_markers);
                        // a failure here is a real failure and is counted below.
                        isAnonymized: true,
                        anonymizedAt: new Date(),
                    },
                });
                stats.anonymized += 1;
            } catch (err) {
                stats.errors += 1;
                stats.failedUserIds.push(user.id);
                logger.error('[pdpa-retention] Failed to anonymize user', { userId: user.id, error: err.message });
            }
        }

        cursor = batch[batch.length - 1].id;
        if (batch.length < 200) {break;}
    }

    // Operator decision 2026-08-03: one failing row must NOT abort the batch —
    // the other rows are past their PDPA retention window and must not be held
    // hostage by a single bad record. The cost of that choice is that a failure
    // would otherwise be a number in an info-level line nobody reads, so a run
    // that dropped any row reports at ERROR level and names the rows: "counted
    // quietly" is exactly the failure mode this whole work item exists to close.
    if (stats.errors > 0) {
        logger.error('[pdpa-retention] Sweep complete WITH FAILURES — these rows are still un-anonymized and will be retried on the next run', {
            ...stats,
            failedUserIds: stats.failedUserIds,
        });
    } else {
        logger.info('[pdpa-retention] Sweep complete', stats);
    }
    return stats;
}

module.exports = { runPdpaRetentionSweep, clearPrecheckText };
