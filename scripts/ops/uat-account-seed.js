#!/usr/bin/env node
/**
 * scripts/ops/uat-account-seed.js
 *
 * ROTATES THE PASSWORD ONLY on the fixed set of canonical UAT/test accounts
 * that `apps/backend/prisma/seed-gacp.js` already creates (staging included —
 * that file is documented there as "the ONLY seed file for user accounts").
 * It never creates a user and never touches any other row: every write is an
 * `update` (never `upsert`/`create`), keyed on the exact same `*Hash` column
 * seed-gacp.js itself uses for lookup (`providerIdHash` / `healthIdHash` =
 * sha256(plaintext id) — the `hashId()` helper below is copied verbatim from
 * `apps/backend/prisma/seed-gacp.js:44-46` so the lookup is provably
 * identical, not re-derived).
 *
 * Why this file exists instead of editing seed-gacp.js: that script hardcodes
 * its passwords with no env override (checked 2026-08-06,
 * apps/backend/prisma/seed-gacp.js:38-42 — 'Gacp@2025' / 'Test@12345' /
 * 'Admin@12345', all three sitting in git history in plaintext), and this
 * walkthrough kit needs a FRESH random password per run instead of reusing
 * defaults anyone with repo read access already knows. Rather than editing a
 * file another workstream owns, this is a standalone script doing the one
 * additional thing needed (password-only rotation) through the SAME Prisma
 * User model, run inside the `gacp-backend-staging` container (docker-compose
 * .staging.yml:63) where `@prisma/client` is already generated and
 * `DATABASE_URL` already points at the staging DB — see
 * scripts/ops/run-walkthrough.sh, which is the only intended caller.
 *
 * Invocation (by run-walkthrough.sh only — never run this by hand against a
 * database you are not sure is staging):
 *   WALK_UAT_PASSWORD_MAP='{"farmer":"...","reviewer":"...",...}' \
 *     node uat-account-seed.js
 *
 * Safety:
 *   - Fixed allowlist of 6 canonical (id, hashField) pairs below — nothing
 *     else is ever addressed; no wildcard/range query.
 *   - `update`, not `upsert`: if a row is missing (a fresh/never-seeded
 *     environment) Prisma throws P2025, this script logs
 *     "skip: not seeded on this environment" and moves on — it will not
 *     create a user.
 *   - Never logs a password — only role + id + rotated|skip|error.
 *
 * Diagnostics (2026-08-07, added after the first real staging run): the
 * container this runs in is whatever image is currently deployed
 * (`docker-compose.staging.yml:63`'s `gacp-backend-staging`), which can be
 * OLDER than this script's own git commit — the 2026-08-06 first run hit a
 * ~22-Jul image. Every failure mode below is therefore printed as an
 * unambiguous, grep-able `SEEDED ok: <role>` / `FAILED: <role> - <reason>`
 * line (never a silent skip) and the run's exit code reflects whether ANY
 * role actually got a new password — see `main()`'s bottom section.
 */
'use strict';

// ── Dependency check (loud, not a bare Node stack trace) ──────────────────
// A materially older deployed image (see file header) may predate one of
// these two deps being added to apps/backend/package.json — `require()`
// failing here would otherwise crash before ANY per-role line is printed,
// leaving the caller with zero diagnostic signal for why every role failed.
let PrismaClient;
let bcrypt;
let crypto;
try {
  ({ PrismaClient } = require('@prisma/client'));
  bcrypt = require('bcryptjs');
  crypto = require('crypto');
} catch (e) {
  console.error(`FATAL: dependency missing in this container — ${(e && e.message) || e}`);
  // CANONICAL_ACCOUNTS is defined below the requires normally, but the role
  // list itself is not a dependency, so we can still name every role here.
  for (const role of ['farmer', 'reviewer', 'auditor', 'scheduler', 'account', 'admin']) {
    console.log(`FAILED: ${role} - dependency missing in this container, see FATAL line above`);
  }
  process.exitCode = 1;
  return; // eslint-disable-line no-restricted-syntax -- top-level in a CommonJS
  // script body is fine for `return`; kept instead of throw so the FATAL/
  // FAILED lines above are the last thing printed, not an uncaught-exception
  // stack trace on top of them.
}

// Copied verbatim from apps/backend/prisma/seed-gacp.js:44-46 — if that helper
// ever changes, this lookup goes stale and needs updating in lockstep.
function hashId(id) {
  return crypto.createHash('sha256').update(id).digest('hex');
}

// 1:1 with apps/backend/prisma/seed-gacp.js — APPLICANTS[0]:69, ADMIN:87,
// OFFICERS providerId 1111111111111:96, 2222222222222:104, 3333333333333:123,
// 4444444444444:131. Keep in lockstep with scripts/ops/gen-uat-passwords.js's
// ROLES table (that script's comment carries the same citations).
const CANONICAL_ACCOUNTS = [
  { role: 'farmer', idField: 'healthId', id: '1186494077533', hashField: 'healthIdHash' },
  { role: 'reviewer', idField: 'providerId', id: '1111111111111', hashField: 'providerIdHash' },
  { role: 'auditor', idField: 'providerId', id: '2222222222222', hashField: 'providerIdHash' },
  { role: 'scheduler', idField: 'providerId', id: '3333333333333', hashField: 'providerIdHash' },
  { role: 'account', idField: 'providerId', id: '4444444444444', hashField: 'providerIdHash' },
  { role: 'admin', idField: 'providerId', id: '9876543210987', hashField: 'providerIdHash' },
];

const BCRYPT_ROUNDS = 12; // matches apps/backend/prisma/seed-gacp.js:37

// Module-scope so the trailing `.finally()` below can always attempt a
// disconnect, even though `prisma` itself is only constructed inside
// `main()` (constructing it can fail in a container whose deployed image
// predates part of the schema — see main()'s try/catch).
let prisma;

// A validation-shaped error (unknown field/argument, wrong model) means the
// deployed Prisma Client's schema differs from what this script assumes —
// exactly the "old image, slightly different model" case the mission called
// out — rather than a data problem. Distinguished from P2025 (row genuinely
// absent) so the printed reason tells the operator which one it was instead
// of both collapsing into one generic "error".
function isSchemaMismatch(e) {
  if (!e) return false;
  if (e.name === 'PrismaClientValidationError') return true;
  if (e.name === 'PrismaClientInitializationError') return true;
  const msg = String(e.message || '');
  return /Unknown argument|Unknown field|Unknown arg `|does not exist on type|Cannot read prop.*of undefined \(reading 'update'\)/i.test(msg);
}

async function main() {
  let passwordMap;
  try {
    passwordMap = JSON.parse(process.env.WALK_UAT_PASSWORD_MAP || '{}');
  } catch (e) {
    console.error('WALK_UAT_PASSWORD_MAP is not valid JSON — aborting, no writes attempted.');
    for (const acct of CANONICAL_ACCOUNTS) console.log(`FAILED: ${acct.role} - WALK_UAT_PASSWORD_MAP was not valid JSON`);
    process.exitCode = 1;
    return;
  }

  try {
    prisma = new PrismaClient();
  } catch (e) {
    console.error(`FATAL: could not construct PrismaClient in this container — ${(e && e.message) || e}`);
    for (const acct of CANONICAL_ACCOUNTS) console.log(`FAILED: ${acct.role} - PrismaClient init failed, see FATAL line above`);
    process.exitCode = 1;
    return;
  }

  let rotated = 0;
  let skipped = 0;
  let errored = 0;
  const passwordsSupplied = Object.keys(passwordMap).filter((k) => passwordMap[k]).length;

  for (const acct of CANONICAL_ACCOUNTS) {
    const password = passwordMap[acct.role];
    if (!password) {
      console.log(`FAILED: ${acct.role} - no password supplied in WALK_UAT_PASSWORD_MAP`);
      skipped += 1;
      continue;
    }
    try {
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      if (!prisma.user) {
        throw Object.assign(new Error(`prisma.user is undefined — this container's Prisma Client has no "user" model`), { name: 'PrismaClientValidationError' });
      }
      await prisma.user.update({
        where: { [acct.hashField]: hashId(acct.id) },
        data: { password: hash },
      });
      console.log(`SEEDED ok: ${acct.role} (${acct.idField}=${acct.id})`);
      rotated += 1;
    } catch (e) {
      if (e && e.code === 'P2025') {
        console.log(`FAILED: ${acct.role} - not seeded on this environment (${acct.idField}=${acct.id}) — run apps/backend/prisma/seed-gacp.js first`);
        skipped += 1;
      } else if (isSchemaMismatch(e)) {
        console.log(`FAILED: ${acct.role} - schema mismatch: this container's Prisma Client does not recognize "${acct.hashField}" or the User model as this script expects (deployed image likely predates the current schema) — ${(e && e.message) || e}`);
        errored += 1;
      } else {
        console.log(`FAILED: ${acct.role} - ${(e && e.message) || e}`);
        errored += 1;
      }
    }
  }

  console.log(`done: rotated=${rotated} skipped=${skipped} errored=${errored}`);

  // Loud, not silent (mission requirement): a run that supplied passwords for
  // every role but rotated NONE of them means every WALK_<ROLE>_PW the caller
  // exports afterward is guaranteed to mismatch the database — the
  // walkthrough spec's login step will then fail for every role, exactly
  // like a genuine per-account error would, so it must set the same exit
  // code. A PARTIAL rotation (some roles ok, some not-yet-seeded) still
  // exits 0 — see file header: other roles' passwords are real, only the
  // unseeded ones' logins will legitimately be skipped downstream.
  if (rotated === 0 && passwordsSupplied > 0) {
    console.error(`FATAL: 0/${passwordsSupplied} accounts rotated — every WALK_<ROLE>_PW this run exports will NOT match the database; every role's walkthrough login will fail. See the FAILED lines above for why.`);
    process.exitCode = 1;
  } else if (errored > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('fatal:', (e && e.message) || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) {
      // Best-effort — a disconnect failure here must not overwrite whatever
      // exit code the rotation loop above already set.
      await prisma.$disconnect().catch(() => {});
    }
  });
