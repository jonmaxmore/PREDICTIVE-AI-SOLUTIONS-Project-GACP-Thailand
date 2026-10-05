/**
 * seed-all.js — idempotent CONFIG-data bootstrap for a fresh deployment.
 *
 * WHY THIS EXISTS
 *   Production deploy runs only `prisma migrate deploy`. Migrations create the
 *   schema plus a handful of inline-seeded operational tables (organizations,
 *   role_groups, stage_activity_configs, sla_policies, …) but they do NOT
 *   populate the runtime *config* tables — those live in standalone
 *   `prisma/seed-*.js` files that nothing in the deploy path ever runs.
 *
 *   A genuinely fresh database therefore comes up missing:
 *     - system_configs        (feature flags, support contact)   ← seed-config.js
 *     - certification_standards + requirements                   ← seed-standards.js
 *     - supplementary_criteria                                   ← seed-criteria.js
 *     - plant_species + document_requirements                    ← seed-plants.js
 *     - wizard_step_configs    (the 9-step application wizard)   ← seed-wizard.js
 *     - receipt_sequences      (billing counters)                ← seed-receipt-sequences.js
 *   …which silently breaks the applicant wizard, plant/standard pickers and
 *   receipt numbering. This orchestrator runs exactly those config seeds, in
 *   dependency-safe order, as part of the deploy.
 *
 * WHAT IT DELIBERATELY DOES NOT RUN
 *   - seed-gacp.js          — bootstraps the default org + admin/staff users,
 *                             but its upserts RESET seeded users' passwords on
 *                             every run. That is fine as a one-time bootstrap
 *                             (`npx prisma db seed`) but must never run on every
 *                             release, so it is excluded here.
 *   - seed-real-fees.js / seed-approve.js / seed-test-*.js — these are DEMO data
 *                             generators (they create fake applications /
 *                             certificates). They must never touch production.
 *
 * SAFETY
 *   - First-run guard: if the config tables are already populated the script is
 *     a no-op (exit 0), so it is safe to wire into every deploy and safe to run
 *     against the live, already-seeded database. Pass --force to re-seed anyway.
 *   - Every seed it runs is idempotent (upsert, or scoped delete-then-recreate),
 *     so even a forced re-run never duplicates rows.
 *   - Stop-on-first-failure: a failing seed aborts the run with a non-zero exit
 *     so the deploy pipeline surfaces the problem instead of half-seeding.
 *
 * USAGE
 *   node prisma/seed-all.js            # seed only if the DB looks unseeded
 *   node prisma/seed-all.js --force    # run every config seed regardless
 *
 *   In the container (matches the migrate-deploy invocation):
 *     docker compose --env-file .env.production -f docker-compose.production.yml \
 *       run --rm backend sh -lc "cd /app/apps/backend && node prisma/seed-all.js"
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

// Config seeds, in dependency-safe order. All are global (no org/user FK) and
// idempotent. Run as child processes so each keeps its own PrismaClient
// lifecycle (connect + $disconnect) exactly as when invoked by hand.
const CONFIG_SEEDS = [
  'seed-config.js',
  'seed-standards.js',
  'seed-criteria.js',
  'seed-plants.js',
  'seed-wizard.js',
  'seed-receipt-sequences.js',
  'seed-chart-of-accounts.js',
];

// Sentinel counts — if ALL are non-zero the DB is already configured and we
// skip (protecting any operator edits to these tables). Keyed by Prisma model
// accessor (verified against the seeds that write them).
const SENTINELS = [
  ['systemConfig', 'system_configs'],
  ['certificationStandard', 'certification_standards'],
  ['supplementaryCriterion', 'supplementary_criteria'],
  ['plantSpecies', 'plant_species'],
  ['wizardStepConfig', 'wizard_step_configs'],
];

async function alreadySeeded(prisma) {
  const counts = {};
  for (const [accessor, table] of SENTINELS) {
    // accessor is a hardcoded Prisma model name from SENTINELS, never user input
    counts[table] = await prisma[accessor].count();
  }
  const summary = SENTINELS.map(([, table]) => `${table}=${counts[table]}`).join(' ');
  const seeded = SENTINELS.every(([, table]) => counts[table] > 0);
  return { seeded, summary };
}

function runSeed(file) {
  const seedPath = path.join(__dirname, file);
  const backendRoot = path.resolve(__dirname, '..');
  console.log(`\n──────── ${file} ────────`);
  const result = spawnSync('node', [seedPath], {
    stdio: 'inherit',
    cwd: backendRoot, // mirror `node prisma/seed-*.js` run from apps/backend
  });
  if (result.status !== 0) {
    const reason = result.error ? result.error.message : `exit code ${result.status}`;
    throw new Error(`${file} failed (${reason})`);
  }
}

async function main() {
  const force = process.argv.includes('--force');
  const prisma = new PrismaClient();

  try {
    const { seeded, summary } = await alreadySeeded(prisma);
    console.log(`[seed-all] config sentinels: ${summary}`);

    if (seeded && !force) {
      console.log('[seed-all] database already configured — nothing to do (pass --force to re-seed).');
      return;
    }
    if (seeded && force) {
      console.log('[seed-all] --force: re-running all config seeds over an already-seeded DB (idempotent).');
    } else {
      console.log('[seed-all] fresh/partial config detected — running config seeds.');
    }
  } finally {
    await prisma.$disconnect();
  }

  // Child seeds open their own clients; disconnect ours before spawning so we
  // do not hold an extra pooled connection while they run.
  for (const file of CONFIG_SEEDS) {
    runSeed(file);
  }

  console.log('\n[seed-all] all config seeds completed.');
}

main().catch((err) => {
  console.error(`\n[seed-all] FAILED: ${err.message}`);
  process.exit(1);
});
