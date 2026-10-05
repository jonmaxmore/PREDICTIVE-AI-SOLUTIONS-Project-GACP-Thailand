#!/usr/bin/env node
'use strict';

/**
 * check-backup-cron-wired — the daily DB-backup cron must be WIRED into the
 * deploy path that is ACTUALLY EXECUTED.
 *
 * A12 (2026-08-05): `scripts/backup/install-cron.sh` (which writes
 * /etc/cron.d/gacp-backup) existed for months, but NO deploy path ever invoked
 * it — so the droplet ran with ZERO automated DB backups. This guard is the
 * repo-side preventive control for that "exists but never runs" class.
 *
 * Retarget 2026-08-14 (rules audit wave 1B): it used to assert only
 * scripts/deploy/deploy-production.sh. With GitHub Actions permanently gone, the
 * deploy that actually runs on the box is scripts/deploy/deploy-staging.sh —
 * `docs/operations/runbooks/build-images-on-the-box.md:57`
 * (`sudo IMAGE_TAG=local-… bash scripts/deploy/deploy-staging.sh`) and
 * `docs/operations/runbooks/deploy-staging-manual.md:70`. A guard that watched a
 * script nobody runs was the same phantom it was written to prevent, so both
 * executed deploy paths are now checked. deploy-production.sh stays in the list
 * because the rotation runbooks still drive it
 * (docs/operations/runbooks/rotate-database-credential.md, secret-rotation-full.md).
 *
 * It intentionally does NOT (and cannot) check the live host — that a backup
 * file actually appears is a host-side monitoring concern (a >25h-stale alert,
 * A3). This check only enforces that the deploy *installs* the schedule.
 *
 * exit 0 = wired · exit 1 = not wired (regression) · exit 2 = expected files missing
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INSTALLER = path.join(ROOT, 'scripts', 'backup', 'install-cron.sh');

// Every deploy script a live runbook tells an operator to execute. Adding a new
// deploy entry point means adding it here — a deploy path outside this list is
// a path that can drop the backup schedule unseen, which is the A12 incident.
const DEPLOY_PATHS = [
    {
        rel: 'scripts/deploy/deploy-staging.sh',
        driver: 'docs/operations/runbooks/build-images-on-the-box.md:57 · deploy-staging-manual.md:70 (the on-box deploy in use)',
    },
    {
        rel: 'scripts/deploy/deploy-production.sh',
        driver: 'docs/operations/runbooks/rotate-database-credential.md · secret-rotation-full.md (production, operator-run per ADR-017)',
    },
];

if (!fs.existsSync(INSTALLER)) {
    console.error('[backup-cron-wired] BLOCKED: scripts/backup/install-cron.sh is missing — the installer this guard protects does not exist.');
    process.exit(2);
}

const missing = DEPLOY_PATHS.filter((d) => !fs.existsSync(path.join(ROOT, d.rel)));
if (missing.length > 0) {
    missing.forEach((d) => console.error(`[backup-cron-wired] BLOCKED: ${d.rel} is missing (driven by ${d.driver}).`));
    console.error('[backup-cron-wired] A deploy script named here but absent means this guard is checking nothing — fix the list or restore the script.');
    process.exit(2);
}

// The deploy must reference the installer AND actually run it (not merely
// mention it in a comment). Require a non-comment line that invokes it.
function invokesInstaller(source) {
    return source
        .split('\n')
        .some((line) => {
            const code = line.replace(/#.*$/, ''); // strip trailing comment
            return /backup\/install-cron\.sh/.test(code) && /(^|[\s"'`(])(sudo\s+)?["'`$]*\S*install-cron\.sh/.test(code);
        });
}

const unwired = [];
for (const d of DEPLOY_PATHS) {
    const source = fs.readFileSync(path.join(ROOT, d.rel), 'utf8');
    if (invokesInstaller(source)) {
        console.log(`[backup-cron-wired] OK: ${d.rel} invokes install-cron.sh`);
    } else {
        unwired.push(d);
    }
}

if (unwired.length > 0) {
    console.error('[backup-cron-wired] FAIL: deploy path(s) that do NOT invoke scripts/backup/install-cron.sh:');
    unwired.forEach((d) => {
        console.error(`  - ${d.rel}`);
        console.error(`      executed by: ${d.driver}`);
    });
    console.error('  The daily DB-backup cron (/etc/cron.d/gacp-backup) must be installed by every deploy,');
    console.error('  or a fresh/rebuilt host runs with no automated backups (A12). Add an idempotent call, e.g.:');
    console.error('    "$PROJECT_DIR/scripts/backup/install-cron.sh"');
    process.exit(1);
}

console.log(`[backup-cron-wired] PASS: all ${DEPLOY_PATHS.length} executed deploy paths install the daily backup schedule.`);
process.exit(0);
