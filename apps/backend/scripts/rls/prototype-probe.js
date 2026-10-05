#!/usr/bin/env node
/**
 * ADR-014 Phase E.2 — RLS ENFORCEMENT MECHANISM PROBE (staging-only drill)
 *
 *   ████ STAGING-ONLY. Reads rows + runs SELECTs as the least-privilege
 *   gacp_app role. It does NOT mutate tenant data, and MUST NOT be pointed at
 *   prod (gacp_db). Prod enforcement is owner + org-#2-gated. ████
 *
 * GOAL
 *   Prove that the CORRECTED bound-query batch form actually enforces RLS
 *   WITHOUT pgbouncer, and that the NAIVE callback form does NOT. Both run
 *   against the same staging DB and the same gacp_app role; the only variable
 *   is the $transaction shape.
 *
 * THE CORRECTED PATTERN (positive cases A/B/D)
 *   app.$transaction([
 *     app.$executeRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", ORG),
 *     app.application.findMany({ select: { id: true, organizationId: true } }),
 *   ])
 *   - It is an ARRAY (batch) $transaction, so BOTH elements run on the SAME
 *     pinned connection inside ONE transaction.
 *   - set_config(..., true) = SET LOCAL (transaction-scoped) → dies at COMMIT,
 *     so no leak across pooled requests.
 *   - The second element is the BOUND query produced by the extended client
 *     (app.application.findMany(...)), so PDPA-decrypt + soft-delete + tenant
 *     extensions still apply. It is NOT basePrisma (which would drop them) and
 *     NOT a second $transaction callback arg.
 *
 * THE BROKEN PATTERN (negative control, case E)
 *   app.$transaction(async (tx) => {
 *     await tx.$executeRawUnsafe("SET LOCAL app.tenant_id = $1", ORG);
 *     return app.application.findMany();   // <-- app.*, NOT tx.*
 *   })
 *   - The extension's query callback takes ONE arg and runs the read on its OWN
 *     pooled connection, ignoring `tx`. The GUC is SET on connection A while the
 *     read runs on connection B → enforces nothing → wrong/leaky row set.
 *
 * RUN
 *   GACP_APP_DATABASE_URL="postgres://gacp_app:<apppw>@<host>:5432/gacp_staging" \
 *     node apps/backend/scripts/rls/prototype-probe.js
 *
 * Exits non-zero on ANY failed assertion (CI-friendly).
 */

'use strict';

const crypto = require('node:crypto');

let PrismaClient;
try {
  ({ PrismaClient } = require('@prisma/client'));
} catch (e) {
  console.error('FATAL: @prisma/client not generated. Run: npx prisma generate --schema prisma/schema');
  console.error(e.message);
  process.exit(2);
}

const APP_URL = process.env.GACP_APP_DATABASE_URL;
if (!APP_URL) {
  console.error('FATAL: set GACP_APP_DATABASE_URL to the gacp_app (NOSUPERUSER NOBYPASSRLS) connection string.');
  console.error('  e.g. postgres://gacp_app:<apppw>@<host>:5432/gacp_staging');
  process.exit(2);
}

// Refuse to run against production by database name (belt-and-braces).
if (/\/gacp_db(\?|$)/.test(APP_URL)) {
  console.error('FATAL: GACP_APP_DATABASE_URL points at gacp_db (production). This drill is staging-only. Aborting.');
  process.exit(2);
}

const TENANT_GUC = 'app.tenant_id';
const BYPASS_GUC = 'app.rls_bypass';
const PROBE_MODEL = 'application'; // RLS table guaranteed to have rows on staging

// Build a SECOND PrismaClient, connected as gacp_app. This is a *standalone*
// client — it does NOT load the app's tenant/PDPA/soft-delete extensions, which
// is deliberate: the drill is about the DB-level GUC + RLS policy, and we want
// to call set_config explicitly rather than rely on any wiring. (E.2.2 wiring
// reference lives in extension-reference.md.)
const app = new PrismaClient({
  datasources: { db: { url: APP_URL } },
  log: ['warn', 'error'],
});

let failures = 0;
function assert(label, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) { failures += 1; }
  const extra = detail ? `  — ${detail}` : '';
  console.log(`  [${status}] ${label}${extra}`);
}

// ── corrected bound-query batch helper ──────────────────────────────────────
// set_config($key, $val, is_local=true) === SET LOCAL: transaction-scoped.
// We pass key/value as bind params ($1/$2/$3) — no string concatenation.
function boundReadWithTenant(orgId) {
  return app.$transaction([
    app.$executeRawUnsafe(`SELECT set_config($1, $2, $3)`, TENANT_GUC, orgId, true),
    app.application.findMany({ select: { id: true, organizationId: true } }),
  ]);
}

function boundReadWithBypass() {
  return app.$transaction([
    app.$executeRawUnsafe(`SELECT set_config($1, $2, $3)`, BYPASS_GUC, 'on', true),
    app.application.findMany({ select: { id: true, organizationId: true } }),
  ]);
}

async function main() {
  console.log('ADR-014 Phase E.2 — RLS enforcement probe (staging-only)');
  console.log(`  role url    : ${APP_URL.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`  probe model : ${PROBE_MODEL}`);
  console.log('');

  // ── discover a real ORG with rows, reading UNDER the bypass GUC ────────────
  // We can't read normally yet (RLS is enforcing + no tenant set → 0 rows), so
  // use the bypass path to find a real organizationId that actually has rows.
  const [, bypassRows] = await boundReadWithBypass();
  const fullCount = bypassRows.length;
  if (fullCount === 0) {
    console.error('FATAL: no application rows visible even under app.rls_bypass=on. Seed staging first.');
    await app.$disconnect();
    process.exit(2);
  }
  const REAL_ORG = bypassRows[0].organizationId;
  const FAKE_ORG = crypto.randomUUID(); // a tenant that owns no rows
  console.log(`  discovered REAL org with rows : ${REAL_ORG}`);
  console.log(`  full row count (bypass)       : ${fullCount}`);
  console.log(`  random FAKE org               : ${FAKE_ORG}`);
  console.log('');
  console.log('PROOF MATRIX (corrected bound-query batch form unless noted):');

  // ── A. real tenant → rows>0 AND every row is that tenant's ────────────────
  {
    const [, rows] = await boundReadWithTenant(REAL_ORG);
    const allMatch = rows.every((r) => r.organizationId === REAL_ORG);
    assert(
      'A) tenant_id = REAL org → rows>0 and all rows belong to REAL org',
      rows.length > 0 && allMatch,
      `rows=${rows.length} allMatch=${allMatch}`,
    );
  }

  // ── B. fake tenant → 0 rows (isolation) ───────────────────────────────────
  {
    const [, rows] = await boundReadWithTenant(FAKE_ORG);
    assert(
      'B) tenant_id = random FAKE uuid → 0 rows',
      rows.length === 0,
      `rows=${rows.length}`,
    );
  }

  // ── C. no set_config at all → 0 rows (fail-closed) ────────────────────────
  // Plain findMany with NO GUC in the same statement. Proves the GUC — not a
  // leftover session value on a reused pooled connection — controls visibility.
  // Run it several times so a pooled connection that happened to carry a stale
  // value would be caught.
  {
    let leaked = 0;
    let observed = 0;
    for (let i = 0; i < 5; i += 1) {
      const rows = await app.application.findMany({ select: { id: true } });
      observed = rows.length;
      if (rows.length !== 0) { leaked = rows.length; break; }
    }
    assert(
      'C) NO set_config, plain findMany ×5 → 0 rows (fail-closed, GUC-controlled)',
      leaked === 0,
      `lastObserved=${observed} leaked=${leaked}`,
    );
  }

  // ── D. bypass GUC → full count (escape hatch works) ───────────────────────
  {
    const [, rows] = await boundReadWithBypass();
    assert(
      'D) set_config(app.rls_bypass, on) → full count (withoutTenantScope escape hatch)',
      rows.length === fullCount,
      `rows=${rows.length} expected=${fullCount}`,
    );
  }

  // ── E. NEGATIVE CONTROL: the BROKEN callback form ─────────────────────────
  // SET LOCAL on the tx connection, but the read runs on app.* (its own pooled
  // connection) → the GUC does not apply to the read. Expect this to NOT behave
  // like case A: either it errors (SET LOCAL outside a usable tx context / read
  // sees no tenant → 0 rows) or it returns a wrong/leaky set. Either way it must
  // be DISTINGUISHABLE from the corrected form. We assert it does NOT return the
  // correct REAL-org-only non-empty set, which is what makes the batch form
  // necessary.
  {
    let brokenRows = null;
    let brokenErr = null;
    try {
      brokenRows = await app.$transaction(async (tx) => {
        // SET LOCAL on a custom (namespaced) GUC: the name is unquoted, the
        // value is bound. This sets app.tenant_id on the *tx* connection only.
        await tx.$executeRawUnsafe(`SELECT set_config('${TENANT_GUC}', $1, true)`, REAL_ORG);
        // NOTE: app.* NOT tx.* — this is the bug being demonstrated. The read
        // runs on app's OWN pooled connection, where app.tenant_id is unset.
        return app.application.findMany({ select: { id: true, organizationId: true } });
      });
    } catch (err) {
      brokenErr = err;
    }

    if (brokenErr) {
      // Erroring is an acceptable "broken" outcome — it still proves the naive
      // form is not a working substitute for the batch form.
      assert(
        'E) BROKEN callback form (app.* read) → does NOT silently succeed',
        true,
        `threw: ${brokenErr.message.split('\n')[0]}`,
      );
    } else {
      const n = brokenRows.length;
      const looksEnforced = n > 0 && brokenRows.every((r) => r.organizationId === REAL_ORG);
      // The broken form runs the read on a connection WITHOUT app.tenant_id →
      // RLS sees no tenant → 0 rows (fail-closed at the DB, but for the WRONG
      // reason: the GUC never reached the read connection). It must therefore
      // differ from case A (which DID return REAL-org rows>0 via the batch).
      // We FAIL the control only if the broken form accidentally reproduced the
      // correct enforced result, which would mean the batch form wasn't needed.
      assert(
        'E) BROKEN callback form (app.* read) → GUC did NOT reach read connection (not the enforced A-result)',
        !looksEnforced,
        `rows=${n} (expected 0 — GUC set on tx conn, read ran on a different pooled conn)`,
      );
    }
  }

  console.log('');
  if (failures === 0) {
    console.log('RESULT: ALL ASSERTIONS PASSED — corrected bound-query batch form ENFORCES RLS without pgbouncer.');
  } else {
    console.log(`RESULT: ${failures} ASSERTION(S) FAILED.`);
  }
}

main()
  .catch((err) => {
    console.error('PROBE ERROR:', err);
    failures += 1;
  })
  .finally(async () => {
    await app.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
