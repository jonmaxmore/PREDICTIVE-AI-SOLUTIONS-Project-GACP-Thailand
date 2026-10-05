#!/usr/bin/env node
/**
 * probe-gate.js — run the CI-eligible probes and decide whether the PR may pass.
 * Proposed destination: scripts/ci/probe-gate.js
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * the project rules (Law 3.5) says a counter increase is "CI fail". the project rules says
 * "CI fail ทันที". Neither was true: no workflow invoked scripts/check-done.sh or
 * anything under scripts/probes/ — the only hits under .github/ were two CODEOWNERS
 * ownership lines. the session start script printed a CACHED probe-results.json rather than
 * re-running. By the project rules's own meta-rule ("a rule with no probe pin is a draft
 * rule"), every probe-pinned Law was still a draft. This wires them in.
 *
 * ── THE TRAP THIS FILE MUST NOT FALL INTO ──────────────────────────────────────
 * A waiver list is the single most likely way to recreate the exact disease we are
 * curing: a protection that is present but does not protect. So:
 *   - a waiver with no expiry date            → FAIL (not skipped)
 *   - a waiver PAST its expiry                → FAIL (it stops covering; it does not
 *                                               "warn forever". Warning-only would be
 *                                               a phantom guardrail by construction.)
 *   - a waiver whose probe now PASSES         → FAIL, naming the line to delete
 *                                               (debt paid ⇒ the cover must be handed back;
 *                                               ratchet moves down only)
 *   - a probe file with no registry line      → FAIL (closes "checkers not plugged in"
 *                                               generically, not one probe at a time)
 *   - a registry line for a probe that is gone → FAIL
 *   - a malformed line                        → FAIL
 * Nothing here degrades to a silent pass. Same fail-loud contract as no-secret.sh.
 *
 * ── SCOPE HONESTY ──────────────────────────────────────────────────────────────
 * Only probes marked `ci` in the registry actually run here. Probes marked `manual`
 * do NOT run and a green gate says nothing about them — each carries a written
 * reason in the registry precisely so "not in CI" is a signed decision rather than
 * an oversight. A green probe-gate is NOT evidence the manual probes pass.
 *
 * Exit 0 = gate passes · Exit 1 = gate fails (reason printed)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// PROBE_GATE_ROOT / PROBE_REGISTRY exist so this file can be exercised before it is
// installed into scripts/ci/ — an agent may not write into the operator-owned
// scripts/probes/ tree (Law 3.12), and shipping an untested gate would itself be a
// phantom guardrail. CI sets neither; both default to the real layout.
const ROOT = process.env.PROBE_GATE_ROOT || path.resolve(__dirname, '..', '..');
const PROBES_DIR = path.join(ROOT, 'scripts', 'probes');
const REGISTRY = process.env.PROBE_REGISTRY || path.join(PROBES_DIR, 'probe-registry.txt');
// Must honour PROBE_OUT_DIR exactly as check-done.sh does. Getting this wrong means
// reading a STALE results file and judging a run that never happened — which is the
// precise failure already recorded against the session start script (it prints a cached
// probe-results.json of unknown age). Caught by testing this gate against the real
// repo before proposing it. Freshness is asserted below as well; agreement on the
// path is not enough on its own.
const RESULTS = path.join(process.env.PROBE_OUT_DIR || path.join(ROOT, 'evidence'), 'probe-results.json');
const WARN_DAYS = 14;

const errors = [];
const warns = [];
const notes = [];

// Today in UTC, date-only — no time-of-day ambiguity across runner timezones.
const TODAY = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const days = (d) => Math.round((d - TODAY) / 86400000);
const iso = (d) => d.toISOString().slice(0, 10);

function die(msg) {
  console.error(`\nprobe-gate: FAIL — ${msg}`);
  process.exit(1);
}

// ── 1. registry ───────────────────────────────────────────────────────────────
if (!fs.existsSync(REGISTRY)) die(`registry not found at ${path.relative(ROOT, REGISTRY)} — refusing to pass a gate with no registry`);

const entries = new Map();
fs.readFileSync(REGISTRY, 'utf8').split(/\r?\n/).forEach((raw, i) => {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return;
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length !== 5) {
    errors.push(`registry:${i + 1} malformed (expected 5 fields separated by |, got ${parts.length}): ${line}`);
    return;
  }
  const [name, run, waiver, signedBy, reason] = parts;

  // run ∈ ci | manual | manual-until:YYYY-MM-DD
  //   manual              = parked out of CI PERMANENTLY, for a standing reason
  //   manual-until:DATE   = parked TEMPORARILY; past DATE this gate goes red.
  // Without the second form, "temporarily manual" parks forever — the same
  // phantom, just moved from the waiver column into the run column.
  let runKind = run;
  let manualUntil = null;
  if (run.startsWith('manual-until')) {
    const m = /^manual-until:(\d{4}-\d{2}-\d{2})$/.exec(run);
    if (!m) {
      errors.push(`registry:${i + 1} 'manual-until' requires a date — write 'manual-until:YYYY-MM-DD', got '${run}'`);
      return;
    }
    manualUntil = new Date(m[1] + 'T00:00:00Z');
    if (Number.isNaN(manualUntil.getTime())) { errors.push(`registry:${i + 1} unparseable manual-until date '${m[1]}'`); return; }
    runKind = 'manual';
  } else if (!['ci', 'manual'].includes(run)) {
    errors.push(`registry:${i + 1} run must be 'ci', 'manual', or 'manual-until:YYYY-MM-DD', got '${run}'`);
    return;
  }

  // Parking a probe outside CI is cover, exactly as a waiver is. It needs a
  // signature and a reason for the same reason a waiver does.
  if (runKind === 'manual') {
    if (signedBy !== 'operator') {
      errors.push(`registry:${i + 1} keeping '${name}' out of CI must be signed by 'operator' (Law 3.12), got '${signedBy}'`);
      return;
    }
    if (!reason) { errors.push(`registry:${i + 1} '${name}' is parked out of CI with no written reason`); return; }
  }
  let expires = null;
  if (waiver !== '-') {
    const m = /^waived:(\d{4}-\d{2}-\d{2})$/.exec(waiver);
    if (!m) {
      errors.push(`registry:${i + 1} waiver must be '-' or 'waived:YYYY-MM-DD' (an expiry date is mandatory), got '${waiver}'`);
      return;
    }
    expires = new Date(m[1] + 'T00:00:00Z');
    if (Number.isNaN(expires.getTime())) { errors.push(`registry:${i + 1} unparseable date '${m[1]}'`); return; }
    if (signedBy !== 'operator') {
      errors.push(`registry:${i + 1} a waiver must be signed by 'operator' (Law 3.12 — an agent cannot sign its own waiver), got '${signedBy}'`);
      return;
    }
    if (!reason) { errors.push(`registry:${i + 1} a waiver needs a written reason`); return; }
  }
  if (entries.has(name)) { errors.push(`registry:${i + 1} duplicate entry for '${name}' — the registry is an SSOT (Law 3.6)`); return; }
  entries.set(name, { name, run: runKind, manualUntil, expires, signedBy, reason, line: i + 1 });
});

// ── 2. accountability: every probe file is accounted for, and vice versa ──────
const onDisk = fs.readdirSync(PROBES_DIR)
  .filter((f) => f.endsWith('.sh') && f !== '_lib.sh')
  .map((f) => f.replace(/\.sh$/, ''))
  .sort();

for (const p of onDisk) {
  if (!entries.has(p)) {
    errors.push(`scripts/probes/${p}.sh exists but has NO registry line — a checker that nobody decided about is the "exists but never runs" bug. Add a line marking it ci or manual (with a reason).`);
  }
}
for (const name of entries.keys()) {
  if (!onDisk.includes(name)) errors.push(`registry names '${name}' but scripts/probes/${name}.sh does not exist`);
}

// A temporary parking that outlived its date is cover nobody re-signed. Same
// rule as an expired waiver: it fails, it does not warn forever. Checked here,
// before any probe runs, because it needs no probe result to decide.
for (const e of entries.values()) {
  if (!e.manualUntil) continue;
  const left = days(e.manualUntil);
  if (left < 0) {
    errors.push(`${e.name}: parked out of CI as 'manual-until:${iso(e.manualUntil)}', which passed ${-left} day(s) ago (registry:${e.line}). Either wire it into CI, or have the operator re-sign a new date, or move it to permanent 'manual' with a standing reason. Reason on file: ${e.reason}`);
  } else if (left <= WARN_DAYS) {
    warns.push(`${e.name}: temporary 'manual' parking expires in ${left} day(s) (${iso(e.manualUntil)}) — after that this gate goes red`);
  } else {
    notes.push(`${e.name}: parked out of CI until ${iso(e.manualUntil)} (${left} day(s) left) — ${e.reason}`);
  }
}

if (errors.length) {
  console.error('probe-gate: registry problems\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}

// ── 3. run the ci-marked probes ──────────────────────────────────────────────
const ciProbes = [...entries.values()].filter((e) => e.run === 'ci').map((e) => e.name).sort();
const manualProbes = [...entries.values()].filter((e) => e.run === 'manual')
  .map((e) => (e.manualUntil ? `${e.name} (until ${iso(e.manualUntil)})` : e.name)).sort();

console.log(`probe-gate: running ${ciProbes.length} CI probe(s): ${ciProbes.join(' ')}`);
console.log(`probe-gate: NOT run here (signed 'manual'): ${manualProbes.join(' ')}`);
console.log('probe-gate: a green result says nothing about the manual set — see probe-registry.txt for each reason.\n');

// Freshness baseline: remember what was there BEFORE, so a run that silently fails
// to write cannot be judged against a leftover file from an earlier session.
const before = fs.existsSync(RESULTS) ? fs.statSync(RESULTS).mtimeMs : -1;
const startedAt = Date.now();

const res = spawnSync('bash', [path.join(ROOT, 'scripts', 'check-done.sh'), ...ciProbes], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
if (res.stdout) process.stdout.write(res.stdout);
if (res.error) die(`could not run check-done.sh: ${res.error.message}`);
if (!fs.existsSync(RESULTS)) die(`check-done.sh did not produce ${RESULTS} — cannot judge a run that left no record`);

const after = fs.statSync(RESULTS).mtimeMs;
if (after === before || after < startedAt - 1000) {
  die(`${RESULTS} was not rewritten by this run (mtime unchanged). Refusing to judge a PR against a cached result — that is exactly the stale-read bug this gate exists to prevent.`);
}

let parsed;
try { parsed = JSON.parse(fs.readFileSync(RESULTS, 'utf8')); }
catch (e) { die(`${path.relative(ROOT, RESULTS)} is not valid JSON (${e.message}) — refusing to pass on an unreadable result`); }

const status = new Map((parsed.results || []).map((r) => [r.probe, r.status]));
for (const p of ciProbes) {
  if (!status.has(p)) errors.push(`probe '${p}' was requested but produced no result — treat a missing result as a failure, never as a pass`);
}

// ── 4. adjudicate ────────────────────────────────────────────────────────────
for (const p of ciProbes) {
  const st = status.get(p);
  const e = entries.get(p);
  const waived = e.expires !== null;

  if (st === 'FAIL' && !waived) {
    errors.push(`${p}: FAIL and no operator waiver — this is the gate doing its job`);
  } else if (st === 'FAIL' && waived) {
    const left = days(e.expires);
    if (left < 0) {
      errors.push(`${p}: FAIL and its waiver EXPIRED ${-left} day(s) ago (registry:${e.line}, expiry ${iso(e.expires)}). A waiver that outlives its date protects nothing — either burn the debt or have the operator re-sign a new date.`);
    } else {
      notes.push(`${p}: FAIL but WAIVED by operator until ${iso(e.expires)} (${left} day(s) left) — ${e.reason}`);
      if (left <= WARN_DAYS) warns.push(`${p}: waiver expires in ${left} day(s) — after that this gate goes red`);
    }
  } else if (st === 'PASS' && waived) {
    errors.push(`${p}: PASSES but still carries a waiver at registry:${e.line}. The debt is paid — delete that line in this PR. Cover is handed back, never kept.`);
  } else if (st === 'BLOCKED' || st === 'PENDING') {
    notes.push(`${p}: ${st} — an honest state, not a pass. Not gating.`);
  }
}

// ── 5. verdict ───────────────────────────────────────────────────────────────
if (notes.length) console.log('\nprobe-gate notes:\n' + notes.map((n) => '  · ' + n).join('\n'));
if (warns.length) console.log('\n⚠️  probe-gate warnings:\n' + warns.map((w) => '  ! ' + w).join('\n'));

if (errors.length) {
  console.error('\nprobe-gate: FAIL\n' + errors.map((e) => '  ✗ ' + e).join('\n'));
  process.exit(1);
}
console.log(`\nprobe-gate: PASS — ${ciProbes.length} CI probe(s) adjudicated, ${notes.length} note(s), ${warns.length} warning(s)`);
