#!/usr/bin/env node
/**
 * PDPA remediation — mask the plaintext national/provider ID left in historical
 * `audit_logs` LOGIN_FAILURE rows written BEFORE the forward-path masking fix
 * (PR #440 / 2026-06-12).
 *
 * ## WHY THIS EXISTS
 * Provider-ID carpet UAT (2026-07-09) found LOGIN_FAILURE audit rows whose
 * `metadata.identifier` still holds a raw 13-digit ID:
 *     "{\"error\":\"Invalid credentials\",\"identifier\":\"4310100001149\"}"
 * The FORWARD path is already fixed — the login handler stores
 * maskIdentifier(id) = first-4 + '****' (controllers/auth-controller/
 * the auth handlers), so post-fix rows read "...\"identifier\":\"1100****\"".
 * This script re-keys ONLY the HISTORICAL rows that predate that fix, producing
 * the identical `NNNN****` shape for consistency.
 *
 * ## PRECISION (measured, do not widen)
 *   - Target: audit_logs rows action='LOGIN_FAILURE' whose inner metadata
 *     `identifier` is a bare /^[0-9]{13}$/. prod=32 rows, staging≈10.
 *   - The PAYMENT_* rows that a naive `metadata::text ~ '[0-9]{13}'` scan flags
 *     are FALSE POSITIVES — the 13 digits are the millisecond timestamp inside
 *     an invoiceId (INV-1780662006401-...), NOT a national ID. This script only
 *     touches the `identifier` leaf and only when it is a bare 13-digit, so it
 *     never mangles an invoiceId.
 *   - metadata is DOUBLE-ENCODED: a jsonb *string* holding JSON text (not a
 *     jsonb object), so `metadata->>'identifier'` is null in SQL — the leaf is
 *     reached by JSON.parse in Node, masked, then re-stringified (preserving the
 *     forward path's exact encoding).
 *
 * ## AUDIT HASH-CHAIN SAFETY (verified)
 * These rows sit BELOW the per-tenant verify floor AUDIT_CHAIN_VERIFY_FROM_SEQ
 * (prod=485 vs leak seq 5-92; staging=2101 vs 43-1120), so the nightly chain
 * sweep does not verify them and masking their metadata raises NO new
 * [AUDIT_CHAIN_ALERT] — the SAME established treatment as the earlier
 * detokenize / PDPA-rekey legacy mutations (services/audit-trail.js:720). We
 * deliberately do NOT recompute currentHash: doing so would break the link to
 * the next row and force a full re-chain of every subsequent row. Do NOT lower
 * the verify floor below these sequence numbers after running this.
 *
 * ## USAGE (SAFE-BY-DEFAULT: dry-run unless --apply)
 *   node scripts/pdpa/backfill-mask-audit-login-identifier.js            # dry-run
 *   node scripts/pdpa/backfill-mask-audit-login-identifier.js --apply    # writes
 *   node scripts/pdpa/backfill-mask-audit-login-identifier.js --apply --verbose
 * First live run MUST be a dry-run on STAGING (golden rule #2), then --apply on
 * staging, verify, then prod.
 */

'use strict';

const BARE_13 = /^[0-9]{13}$/;

/** Mask a login identifier the same way the forward path does: first-4 + ****.
 * Only masks a bare 13-digit national/provider ID; anything else (an email, an
 * already-masked value, a shorter code) is returned unchanged → idempotent. */
function maskIdentifier(identifier) {
  if (typeof identifier !== 'string' || !BARE_13.test(identifier)) {
    return identifier;
  }
  return `${identifier.substring(0, 4)}****`;
}

/** Given the value of a LOGIN_FAILURE metadata column (a JSON string OR an
 * object OR null), return { changed, value } where value is the masked metadata
 * in the SAME shape it came in (string→string, object→object). Pure + testable. */
function maskMetadataValue(metadata) {
  // Double-encoded: jsonb string holding JSON text (the live shape).
  if (typeof metadata === 'string') {
    let obj;
    try {
      obj = JSON.parse(metadata);
    } catch (_e) {
      return { changed: false, value: metadata }; // not JSON → leave untouched
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { changed: false, value: metadata };
    }
    const masked = maskIdentifier(obj.identifier);
    if (masked === obj.identifier) {
      return { changed: false, value: metadata };
    }
    return { changed: true, value: JSON.stringify({ ...obj, identifier: masked }) };
  }
  // Defensive: plain jsonb object (not the current live shape, but future-safe).
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const masked = maskIdentifier(metadata.identifier);
    if (masked === metadata.identifier) {
      return { changed: false, value: metadata };
    }
    return { changed: true, value: { ...metadata, identifier: masked } };
  }
  return { changed: false, value: metadata };
}

async function backfill({ prisma: injectedPrisma, dryRun = true, verbose = false, log = () => {} } = {}) {
  // Lazy-require prisma so unit tests can inject a fake without a DATABASE_URL.
  const prisma = injectedPrisma || require('../../services/prisma-database').prisma;

  // Candidate set: ALL LOGIN_FAILURE rows (a small, bounded set). No metadata
  // predicate in SQL — the metadata is a DOUBLE-ENCODED jsonb string, so a
  // SQL `->>` leaf match is impossible and a `metadata::text ~ '[0-9]{13}'`
  // scan would false-match invoiceId timestamps. ALL the precision lives in
  // maskMetadataValue (bare-13-digit `identifier` leaf, idempotent), which is
  // the single unit-tested chokepoint.
  const candidates = await prisma.auditLog.findMany({
    where: { action: 'LOGIN_FAILURE' },
    select: { id: true, sequenceNumber: true, metadata: true },
    orderBy: { sequenceNumber: 'asc' },
  });

  const summary = { scanned: candidates.length, masked: 0, skipped: 0, dryRun };
  for (const row of candidates) {
    const { changed, value } = maskMetadataValue(row.metadata);
    if (!changed) {
      summary.skipped += 1;
      continue;
    }
    summary.masked += 1;
    log({ phase: dryRun ? 'WOULD_MASK' : 'MASKED', id: row.id, seq: row.sequenceNumber });
    if (verbose) {
      log({ before: row.metadata, after: value });
    }
    if (!dryRun) {
      await prisma.auditLog.update({ where: { id: row.id }, data: { metadata: value } });
    }
  }
  return summary;
}

module.exports = { maskIdentifier, maskMetadataValue, backfill };

// CLI
if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = !argv.includes('--apply'); // SAFE DEFAULT: never writes without --apply
  const verbose = argv.includes('--verbose');
  backfill({ dryRun, verbose, log: (e) => console.log(JSON.stringify(e)) })
    .then((s) => {
      console.log(JSON.stringify({ done: true, ...s }));
      process.exit(0);
    })
    .catch((err) => {
      console.error('BACKFILL_FATAL', err && err.message);
      process.exit(1);
    });
}
