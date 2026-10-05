'use strict';

/**
 * Green-mask assertion ratchet (change log 2026-08-05, "machine rigor — กัน
 * green-mask อัตโนมัติ").
 *
 * The literal "delete one assert line → test must go red" is unreliable: jest
 * passes a test that makes NO assertions, so removing the last assert usually
 * stays green (false positives everywhere). This gate instead pins the concrete
 * green-mask class that survives review — an assertion accepting BOTH a success
 * (2xx) AND an error (4xx/5xx) HTTP status, so it passes whether the hop worked
 * or failed. That is the exact e2e-golden pattern
 * (expect([200,400,404]).toContain(res.status)) flagged in the 2026-08-06
 * inventory.
 *
 * RATCHET (not a hard gate): the currently-known masks are grandfathered in
 * green-mask-baseline.json with a per-file count. The gate fails if any file's
 * mask count EXCEEDS its baseline (a NET-NEW mask) — so no PR can add one — and
 * the baseline can only be lowered as UAT-01 de-masks each hop (assert the real
 * 200 + resulting state). A pure-error array (e.g. [409, 422]) is a legit
 * negative assertion and is never counted. `.only` / `fit` / `fdescribe` are
 * ALWAYS a failure (0 baseline, checked before the allow-comment). Escape hatch
 * for a deliberate tolerant assertion: `// green-mask-allow: <reason>`.
 *
 * BEST-EFFORT ratchet — this is not a proof that no tolerant assertion exists.
 *
 * SCOPE (state it, so nobody infers a wider one): every *.{test,spec}.{js,jsx,
 * ts,tsx} in the repo except SKIP_DIRS below. Until 2026-08-06 this was a
 * four-directory allow-list covering 558 of 821 test files; the other 263 (32%)
 * were unscanned and the docstring said nothing about it. Scope is now pinned by
 * a test (green-mask-gate.test.js) that fails if it narrows again.
 *
 * KNOWN LIMITS (line-based scan; QA #808 — documented, not claimed closed):
 *   - a status array split across MULTIPLE lines, or extracted to a variable
 *     (`const codes=[200,404]; expect(codes)…`), evades the same-line match
 *   - a non-array range check (`status>=200 && status<500`) is out of scope
 *   - only the tolerant-status class is detected; a test that asserts nothing
 *     at all, or asserts something trivially true, is NOT this gate's business
 *   - decimal AND hex (0xC8) codes ARE caught — that one is closed, not a limit
 *
 * Deterministic, no test re-run, no new dependency.
 *   node scripts/ci/check-green-mask-assertions.js               # gate
 *   node scripts/ci/check-green-mask-assertions.js --update      # rewrite baseline (burn-down / initial)
 * Exit 0 = at or under baseline; 1 = a net-new mask or .only; 2 = usage error.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'green-mask-baseline.json');

// Directories that never hold project tests. EVERYTHING else under the repo is
// scanned.
//
// This used to be a four-entry allow-list (apps/web-app/e2e, apps/web-app/
// playwright, apps/backend/__tests__/integration, apps/backend/__tests__/unit).
// Measured 2026-08-06: that covered 558 of 821 test files — 263 files, 32% of
// the corpus, sat outside the gate, including apps/backend/__tests__/ itself,
// the directory sitting between the two subdirectories that WERE scanned. A
// mask added there was invisible while the gate reported green, and the
// docstring did not disclose the boundary. That is the exact phantom-guardrail
// shape this gate exists to catch, so the allow-list is gone (QA #808).
const SKIP_DIRS = new Set([
    'node_modules', '.git', '.next', 'build', 'dist', 'coverage',
    '.turbo', 'playwright-report', 'test-results', '.pnpm',
    // agent worktrees are full repo copies — scanning them double-counts every
    // grandfathered mask as NET-NEW (false FAIL on any local run with a live
    // worktree; the dir never exists on CI runners)
    'worktrees',
]);

const TEST_FILE_RE = /\.(test|spec)\.(js|jsx|ts|tsx)$/;
const ALLOW_RE = /green-mask-allow:/;
const ASSERT_LINE_RE = /\b(expect|toContain|toEqual|toStrictEqual|toMatchObject|arrayContaining)\b/;
const ARRAY_LITERAL_RE = /\[[^\]]*\]/g;

function collect(dir) {
    const abs = path.join(REPO_ROOT, dir);
    const out = [];
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) { continue; }
        const full = dir === '.' ? e.name : path.join(dir, e.name);
        if (e.isDirectory()) { out.push(...collect(full)); }
        else if (e.isFile() && TEST_FILE_RE.test(e.name)) { out.push(path.join(REPO_ROOT, full)); }
    }
    return out;
}

/** Every test/spec file in the repo, minus SKIP_DIRS. Exported so a test can pin
 *  the scope: if anyone narrows it back to a directory allow-list, that test
 *  goes red instead of the gate silently covering less. */
function allTestFiles() { return collect('.'); }

/** A THOUSANDS-SEPARATED number written INSIDE a quoted token — '5,535', "33,210".
 *
 * Money, not a status. Without this the classifier reads 535 and 210 out of a Thai
 * baht assertion and reports a 5xx mixed with a 2xx on a test that asserts no status
 * at all. The separator must be inside the quotes: `[200,404]` is two bare array
 * elements and the comma is the array's own punctuation, so it stays a status pair.
 * No HTTP status is ever written with a separator, so this cannot hide a real mask. */
const QUOTED_TOKEN_RE = /'[^']*'|"[^"]*"|`[^`]*`/g;
const SEPARATED_NUMBER_RE = /\d{1,3}(?:,\d{3})+/g;

/** True if the array-literal text mixes a 2xx with a 4xx/5xx status code
 * (decimal 200 or hex 0xC8 both count). */
function mixesSuccessAndError(arrayText) {
    // Blank out money amounts before reading status codes — inside quotes only.
    const text = arrayText.replace(QUOTED_TOKEN_RE, (tok) => tok.replace(SEPARATED_NUMBER_RE, ' '));
    const nums = [
        ...(text.match(/\b\d{3}\b/g) || []).map(Number),
        ...(text.match(/\b0x[0-9a-f]+\b/gi) || []).map((h) => parseInt(h, 16)),
    ];
    return nums.some((n) => n >= 200 && n < 300) && nums.some((n) => n >= 400 && n < 600);
}

/** Per-file findings: { tolerant: [{line,text}], only: [{line,text}] }. */
function scanFile(file) {
    const tolerant = [];
    const only = [];
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        // Focus (.only / fit / fdescribe) is ALWAYS a failure — checked BEFORE the
        // allow-comment early-return so a `// green-mask-allow` can never neutralise
        // a focused test (QA #808).
        if (/\b(describe|it|test)\.only\s*\(|\bf(it|describe)\s*\(/.test(line)) {
            only.push({ line: i + 1, text: line.trim().slice(0, 120) });
        }
        if (ALLOW_RE.test(line)) { return; }
        if (ASSERT_LINE_RE.test(line)) {
            for (const arr of line.match(ARRAY_LITERAL_RE) || []) {
                if (mixesSuccessAndError(arr)) { tolerant.push({ line: i + 1, text: line.trim().slice(0, 120) }); break; }
            }
        }
    });
    return { tolerant, only };
}

function scanAll() {
    const byFile = {};
    for (const file of allTestFiles()) {
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
        byFile[rel] = scanFile(file);
    }
    return byFile;
}

function main() {
    const update = process.argv.includes('--update');
    const scan = scanAll();
    const scannedCount = Object.keys(scan).length;
    if (!scannedCount) { console.error('[green-mask] FAIL: no test/spec files found — the scanner is broken, not the corpus'); process.exit(2); }

    if (update) {
        const baseline = {};
        for (const [rel, f] of Object.entries(scan)) { if (f.tolerant.length) { baseline[rel] = f.tolerant.length; } }
        fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
        const total = Object.values(baseline).reduce((a, b) => a + b, 0);
        console.log(`[green-mask] baseline written: ${total} grandfathered tolerant-status mask(s) across ${Object.keys(baseline).length} file(s).`);
        process.exit(0);
    }

    let baseline = {};
    try { baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }
    catch { console.error('[green-mask] FAIL: no baseline — run with --update once to grandfather current masks'); process.exit(2); }

    const violations = [];
    for (const [rel, f] of Object.entries(scan)) {
        const allowed = baseline[rel] || 0;
        if (f.tolerant.length > allowed) {
            violations.push(`${rel}: ${f.tolerant.length} tolerant-status mask(s) > baseline ${allowed} — NET-NEW`);
            f.tolerant.slice(allowed).forEach((h) => violations.push(`    +${rel}:${h.line}  ${h.text}`));
        }
        f.only.forEach((h) => violations.push(`${rel}:${h.line}  [.only] a focused test hides the rest of the suite`));
    }
    // Stale baseline entries (file dropped below its allowance) → nudge to burn down.
    for (const [rel, allowed] of Object.entries(baseline)) {
        const cur = (scan[rel] && scan[rel].tolerant.length) || 0;
        if (cur < allowed) { console.log(`[green-mask] burn-down: ${rel} now ${cur} < baseline ${allowed} — run --update to lock the gain.`); }
    }

    if (violations.length) {
        console.error('[green-mask] FAIL — net-new masks / .only (assert the real 2xx + state, or // green-mask-allow: <reason>):');
        violations.forEach((v) => console.error(`  ${v}`));
        process.exit(1);
    }
    const total = Object.values(baseline).reduce((a, b) => a + b, 0);
    console.log(`[green-mask] PASS — ${scannedCount} file(s) scanned; no net-new masks (baseline ${total}, burn-down tracked for UAT-01).`);
    process.exit(0);
}

if (require.main === module) { main(); }
module.exports = { mixesSuccessAndError, scanFile, scanAll, allTestFiles, SKIP_DIRS };
