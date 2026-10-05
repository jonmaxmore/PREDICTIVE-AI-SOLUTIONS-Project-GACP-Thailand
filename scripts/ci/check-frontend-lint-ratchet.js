#!/usr/bin/env node
/**
 * check-frontend-lint-ratchet.js
 *
 * Preventive control (Tier 2 / Control 4 — docs/ci/preventive-controls.md).
 *
 * How this runs (2026-08-14): nothing runs it automatically. Its only invoker
 * was `.github/workflows/frontend-lint-ratchet.yml:49`, and GitHub Actions is
 * permanently unavailable (the change log 2026-08-14). It has no row in
 * scripts/ci/local-gate.sh or scripts/ci/full-gate-checks.txt, so the warning
 * ceiling below is enforced by whoever remembers to type the command — it can
 * currently ratchet UP unnoticed. That hole is recorded in
 * evidence/rules-audit-2026-08-14/raw-result.txt.
 *
 * Runs `pnpm --filter web-app run lint`, parses the warning count from the
 * eslint summary line, and compares it to the committed baseline in
 * scripts/ci/frontend-lint-baseline.json.
 *
 * Policy: ratchet-down. The committed count is a CEILING.
 *   - count <= baseline      => exit 0 (pass; suggest lowering baseline if strictly less)
 *   - count >  baseline      => exit 1 (fail with regression message)
 *
 * Why: the web-app once carried ~150 tailwind / any-typed warnings classified
 * as tech debt. Without a ratchet, new warnings sneak in one change at a time.
 * The baseline in scripts/ci/frontend-lint-baseline.json has since been walked
 * down to 0 (lastUpdated 2026-05-18), so any new warning is a regression.
 *
 * Lowering the baseline is an agent-safe direction; RAISING it is an operator
 * act with a the change log entry (the project rules L4/L6).
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'frontend-lint-baseline.json');

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`Baseline file not found: ${BASELINE_PATH}`);
    process.exit(2);
  }
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (typeof data.maxWarnings !== 'number') {
    console.error('Baseline file is missing numeric "maxWarnings" field.');
    process.exit(2);
  }
  return data;
}

function runLint() {
  // We run with PNPM directly because that's what CI uses.
  // --no-color so the output is parseable across environments.
  const result = spawnSync(
    'pnpm',
    ['--filter', 'web-app', 'run', 'lint'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      shell: process.platform === 'win32',
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  // ESLint exits non-zero when warnings exceed `--max-warnings` (the
  // web-app script passes `--max-warnings=50`). Either exit is fine for
  // us — we parse the output regardless and let the ratchet decide.
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    error: result.error,
  };
}

function parseWarningCount(output) {
  // Looks for the eslint summary line, e.g.:
  //"152 problems (0 errors, 152 warnings)"
  //"153 problems (1 error, 152 warnings)"
  // The parens use either "errors" or "error" / "warnings" or "warning".
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(
      /(\d+)\s+problems?\s+\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/,
    );
    if (m) {
      return {
        problems: Number(m[1]),
        errors: Number(m[2]),
        warnings: Number(m[3]),
      };
    }
  }
  // ESLint also sometimes prints just warnings or just errors; handle the
  // singular forms to be robust.
  for (const line of lines) {
    const mw = line.match(/\((\d+)\s+warnings?\)/);
    if (mw) return { problems: null, errors: null, warnings: Number(mw[1]) };
  }
  return null;
}

function main() {
  const baseline = readBaseline();
  console.log(
    `Frontend lint ratchet: baseline = ${baseline.maxWarnings} warning(s) ` +
      `(last updated ${baseline.lastUpdated || 'unknown'}).`,
  );

  console.log('Running: pnpm --filter web-app run lint ...');
  const lintRun = runLint();

  if (lintRun.error) {
    console.error('Failed to spawn pnpm:', lintRun.error.message);
    return 2;
  }

  const combined = lintRun.stdout + '\n' + lintRun.stderr;
  const parsed = parseWarningCount(combined);

  // ESLint prints a summary line only when there is at least one problem.
  // A clean run (0 errors, 0 warnings) exits 0 with no parseable summary —
  // treat that as zero warnings rather than a parse failure. (Previously this
  // path failed the gate the moment the web-app reached a clean lint state.)
  const resolved = parsed || (lintRun.status === 0
    ? { problems: 0, errors: 0, warnings: 0 }
    : null);

  if (!resolved) {
    console.error(
      'Could not parse ESLint summary line from lint output (lint exited non-zero). Last 40 lines:',
    );
    console.error(combined.split(/\r?\n/).slice(-40).join('\n'));
    return 2;
  }

  const { warnings, errors } = resolved;
  const baselineCount = baseline.maxWarnings;

  if (errors && errors > 0) {
    console.error(
      `Frontend lint ratchet: FAIL — ${errors} ESLint error(s) detected. ` +
        'Errors are never allowed regardless of warning ratchet.',
    );
    return 1;
  }

  if (warnings > baselineCount) {
    console.error(
      `\nFrontend lint ratchet: FAIL\n` +
        `  Lint warning regression: ${warnings} > ${baselineCount}\n` +
        `  New warnings were introduced. Either fix them, or — if they are ` +
        `intentional tech debt — justify in PR description and update ` +
        `${path.relative(REPO_ROOT, BASELINE_PATH).replace(/\\/g, '/')} ` +
        `with the new ceiling.\n`,
    );
    return 1;
  }

  if (warnings < baselineCount) {
    console.log(
      `Frontend lint ratchet: PASS — Lint warnings: ${warnings} / ${baselineCount} budget.\n` +
        `  ↓ Warning count is BELOW baseline. Consider lowering the ceiling.\n` +
        `    Edit ${path.relative(REPO_ROOT, BASELINE_PATH).replace(/\\/g, '/')} ` +
        `to set "maxWarnings": ${warnings} (and update "lastUpdated").`,
    );
    return 0;
  }

  console.log(
    `Frontend lint ratchet: PASS — Lint warnings: ${warnings} / ${baselineCount} budget.`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { parseWarningCount, readBaseline };
