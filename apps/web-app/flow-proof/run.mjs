#!/usr/bin/env node
/**
 * Flow-proof harness — single entry point.
 * Usage: see README.md in this directory (short, per the work brief §course-correction).
 *
 * Exit codes:
 *   0 — mode ran to completion AND (mode==full with zero FAIL) OR
 *       (mode is ui-api/dry-run AND FLOW_PROOF_ALLOW_PARTIAL=1, explicitly
 *       acknowledging a partial-scope run).
 *   1 — anything less than a full, clean proof, without that explicit
 *       acknowledgement (the project rules "ห้าม skip เงียบแล้วบอกว่าผ่าน" / class C4).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { probeAll } from './lib/env-probe.mjs';
import * as db from './lib/db.mjs';
import { redactBody, redactHeaders } from './lib/redact.mjs';
import { runDesignCheck } from './lib/design-check.mjs';
import { buildReportHtml, buildAppendixFragment } from './lib/report.mjs';
import { Blocked } from './lib/errors.mjs';
import { steps } from './steps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORK_ITEM = process.env.WORK_ITEM || 'flow-proof';
const REQUESTED_MODE = process.env.FLOW_PROOF_MODE || 'auto';
const DATABASE_URL = process.env.FLOW_PROOF_DATABASE_URL || process.env.DATABASE_URL || '';
const BACKEND_BASE = process.env.FLOW_PROOF_API_BASE || 'http://localhost:8000';
const FRONTEND_BASE = process.env.FLOW_PROOF_BASE_URL || 'http://localhost:3000';
const ALLOW_PARTIAL = process.env.FLOW_PROOF_ALLOW_PARTIAL === '1';
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const DATE_STR = new Date().toISOString().slice(0, 10);
const EVIDENCE_DIR = path.resolve(__dirname, '../../../evidence', WORK_ITEM, DATE_STR);
const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, 'screenshots');

function log(...args) { console.warn('[flow-proof]', ...args); }

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

/** Structural self-check for dry-run mode — verifies the harness itself, not the app. */
function structuralSelfCheck() {
  const problems = [];
  if (steps.length !== 8) problems.push(`expected 8 steps, found ${steps.length}`);
  for (const s of steps) {
    if (!s.id || !s.title || !s.roleLabel) problems.push(`step ${s.seq}: missing id/title/roleLabel`);
    if (typeof s.perform !== 'function') problems.push(`step ${s.seq}: missing perform()`);
    if (!Array.isArray(s.dbTables)) problems.push(`step ${s.seq}: dbTables must be an array`);
    for (const t of s.dbTables) {
      if (!db.ALLOWED_TABLES.has(t.table)) problems.push(`step ${s.seq}: table "${t.table}" not in ALLOWED_TABLES`);
    }
  }
  try {
    mkdirp(SCREENSHOT_DIR);
    fs.writeFileSync(path.join(EVIDENCE_DIR, '.write-test'), 'ok');
    fs.unlinkSync(path.join(EVIDENCE_DIR, '.write-test'));
  } catch (e) {
    problems.push(`evidence dir not writable: ${e.message}`);
  }
  return problems;
}

async function runLiveSteps() {
  const hasPinnedChromium = fs.existsSync(CHROMIUM_PATH);
  if (!hasPinnedChromium) {
    log(`WARNING: pinned chromium not found at ${CHROMIUM_PATH} — falling back to Playwright's default resolution (do NOT run "playwright install" per mandate; if this fails, that is the real, reportable blocker).`);
  }
  const browser = await chromium.launch(hasPinnedChromium ? { executablePath: CHROMIUM_PATH } : {});
  const context = await browser.newContext({ baseURL: FRONTEND_BASE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const state = {};
  const results = [];

  for (const step of steps) {
    const seqDir = `${String(step.seq).padStart(2, '0')}-${step.id}`;
    mkdirp(path.join(SCREENSHOT_DIR, seqDir));
    const startedAt = new Date().toISOString();
    const actions = [];
    const screenshots = [];
    const consoleErrors = [];
    const apiCalls = [];

    const onConsole = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)); };
    page.on('console', onConsole);

    const pending = new Map();
    const onRequest = (req) => {
      if (!/\/api\//.test(req.url())) return;
      const entry = {
        method: req.method(),
        path: new URL(req.url()).pathname,
        reqBody: redactBody(req.postData()),
        reqHeaders: redactHeaders(req.headers()),
        status: null,
        resBody: null,
        error: null,
        timestamp: new Date().toISOString(),
      };
      pending.set(req, entry);
      apiCalls.push(entry);
    };
    const onResponse = async (res) => {
      const entry = pending.get(res.request());
      if (!entry) return;
      entry.status = res.status();
      try {
        const text = await res.text();
        entry.resBody = redactBody(text);
      } catch {
        entry.resBody = '[body unavailable]';
      }
    };
    const onRequestFailed = (req) => {
      const entry = pending.get(req);
      if (!entry) return;
      entry.error = req.failure() ? req.failure().errorText : 'request failed (no detail)';
    };
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);

    // DB "before" snapshot — using state as of BEFORE this step's actions.
    const dbBefore = [];
    for (const t of step.dbTables) {
      const where = t.resolve(state);
      try {
        dbBefore.push({ table: t.table, where, rows: where ? db.snapshotTableMulti(DATABASE_URL, t.table, where) : db.snapshotTableRecent(DATABASE_URL, t.table, 5) });
      } catch (e) {
        dbBefore.push({ table: t.table, where, error: e.message });
      }
    }

    const ctx = {
      page,
      state,
      logAction(entry) { actions.push(entry); },
      lastBlockedActionDetail() {
        const b = [...actions].reverse().find((a) => a.blocked || a.ok === false);
        return b ? `${b.type}: ${b.detail}${b.error ? ' — ' + b.error : ''}` : null;
      },
      getApiCalls() { return apiCalls; },
      async shot(label) {
        const file = path.join(seqDir, `${label}.png`);
        try {
          await page.screenshot({ path: path.join(SCREENSHOT_DIR, file), fullPage: true });
          screenshots.push({ label, file: path.relative(EVIDENCE_DIR, path.join(SCREENSHOT_DIR, file)) });
        } catch (e) {
          actions.push({ type: 'screenshot', detail: label, ok: false, error: e.message });
        }
      },
    };

    let outcome;
    try {
      outcome = await step.perform(ctx);
      if (!outcome || !outcome.status) outcome = { status: 'FAIL', reason: 'step.perform() returned no status — harness bug' };
    } catch (e) {
      if (e instanceof Blocked) outcome = { status: 'BLOCKED', reason: e.message };
      else outcome = { status: 'FAIL', reason: `unexpected error: ${e.message}` };
    }

    // DB "after" snapshot — using state as UPDATED by this step (steps mutate
    // ctx.state directly, e.g. state.applicationId, as they learn real ids).
    const dbEntries = [];
    for (const t of step.dbTables) {
      const before = dbBefore.find((d) => d.table === t.table);
      const where = t.resolve(state);
      try {
        const afterRows = where ? db.snapshotTableMulti(DATABASE_URL, t.table, where) : db.snapshotTableRecent(DATABASE_URL, t.table, 5);
        if (before && !before.error && where) {
          dbEntries.push({ table: t.table, diff: db.diffRows(before.rows, afterRows) });
        } else {
          dbEntries.push({ table: t.table, diff: db.diffRows(before && !before.error ? before.rows : [], afterRows), note: where ? undefined : 'ไม่มี key กรองแถว — แสดง 5 แถวล่าสุดเพื่อบริบทเท่านั้น ไม่ใช่ diff เป้าหมาย' });
        }
      } catch (e) {
        dbEntries.push({ table: t.table, error: e.message });
      }
    }

    // Design check on whatever the final page state is (desktop, already the
    // context's default viewport). Then a lightweight mobile overflow pass.
    let design = null;
    try {
      design = await runDesignCheck(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      await ctx.shot('99-mobile-viewport');
      const mobileOverflow = await page.evaluate(() => {
        const el = document.documentElement;
        return { overflowX: el.scrollWidth > el.clientWidth + 4, overflowPx: el.scrollWidth - el.clientWidth };
      });
      design.mobile = mobileOverflow;
      await page.setViewportSize({ width: 1440, height: 900 });
    } catch (e) {
      actions.push({ type: 'design-check', detail: 'runDesignCheck', ok: false, error: e.message });
    }

    page.off('console', onConsole);
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);

    results.push({
      seq: step.seq,
      id: step.id,
      title: step.title,
      roleLabel: step.roleLabel,
      status: outcome.status,
      reason: outcome.reason,
      startedAt,
      endedAt: new Date().toISOString(),
      ui: { actions, screenshots, consoleErrors },
      api: apiCalls,
      db: dbEntries,
      design,
    });
    log(`step ${step.seq} ${step.id}: ${outcome.status} — ${outcome.reason}`);
  }

  await browser.close();
  return results;
}

function summarizeLayers(results) {
  const summary = { ui: { pass: 0, blocked: 0, fail: 0 }, api: { pass: 0, blocked: 0, fail: 0 }, db: { pass: 0, blocked: 0, fail: 0 }, design: { pass: 0, blocked: 0, fail: 0 } };
  for (const r of results) {
    // UI: pass if every logged action succeeded (or none failed unexpectedly).
    const uiHardFail = r.ui.actions.some((a) => a.ok === false && !a.blocked);
    const uiBlocked = r.ui.actions.some((a) => a.ok === false && a.blocked) || r.ui.actions.length === 0;
    if (uiHardFail) summary.ui.fail += 1; else if (uiBlocked) summary.ui.blocked += 1; else summary.ui.pass += 1;

    if (r.api.length === 0) summary.api.blocked += 1;
    else if (r.api.some((c) => c.status == null)) summary.api.blocked += 1;
    else if (r.api.every((c) => c.status < 400)) summary.api.pass += 1;
    else summary.api.fail += 1;

    const dbErrors = r.db.filter((d) => d.error);
    const dbChanged = r.db.filter((d) => d.diff && (d.diff.added.length || d.diff.changed.length || d.diff.removed.length));
    if (r.db.length === 0) { /* no relevant table for this step — not counted either way */ }
    else if (dbErrors.length === r.db.length) summary.db.blocked += 1;
    else if (dbChanged.length > 0) summary.db.pass += 1;
    else summary.db.blocked += 1;

    if (!r.design) summary.design.blocked += 1;
    else if (r.design.pass) summary.design.pass += 1;
    else summary.design.fail += 1;
  }
  return summary;
}

async function main() {
  mkdirp(EVIDENCE_DIR);
  mkdirp(SCREENSHOT_DIR);

  log(`work-item=${WORK_ITEM} evidence-dir=${EVIDENCE_DIR}`);
  log('=== ENVIRONMENT PROBE ===');
  const probes = await probeAll({ databaseUrl: DATABASE_URL, backendBase: BACKEND_BASE, frontendBase: FRONTEND_BASE });
  log(`DB       (${DATABASE_URL ? 'set' : 'UNSET'}): ${probes.dbProbe.ok ? 'REACHABLE' : 'UNREACHABLE'} — ${probes.dbProbe.detail}`);
  log(`Backend  (${BACKEND_BASE}): ${probes.backendProbe.ok ? 'REACHABLE' : 'UNREACHABLE'} — ${probes.backendProbe.detail}`);
  log(`Frontend (${FRONTEND_BASE}): ${probes.frontendProbe.ok ? 'REACHABLE' : 'UNREACHABLE'} — ${probes.frontendProbe.detail}`);

  const mode = REQUESTED_MODE === 'auto' ? probes.mode : REQUESTED_MODE;
  const autoSelected = REQUESTED_MODE === 'auto';
  log(`=== MODE: ${mode.toUpperCase()} (${autoSelected ? 'auto-detected' : 'explicit'}) ===`);

  if (mode === 'full' && !(probes.dbProbe.ok && probes.backendProbe.ok && probes.frontendProbe.ok)) {
    console.error('FATAL: mode=full requires DB + backend + frontend all reachable. Missing:');
    if (!probes.dbProbe.ok) console.error(`  - DB: ${probes.dbProbe.detail}`);
    if (!probes.backendProbe.ok) console.error(`  - backend (${BACKEND_BASE}): ${probes.backendProbe.detail}`);
    if (!probes.frontendProbe.ok) console.error(`  - frontend (${FRONTEND_BASE}): ${probes.frontendProbe.detail}`);
    process.exit(1);
  }
  if (mode === 'ui-api' && !(probes.backendProbe.ok && probes.frontendProbe.ok)) {
    console.error('FATAL: mode=ui-api requires backend + frontend reachable. Missing:');
    if (!probes.backendProbe.ok) console.error(`  - backend (${BACKEND_BASE}): ${probes.backendProbe.detail}`);
    if (!probes.frontendProbe.ok) console.error(`  - frontend (${FRONTEND_BASE}): ${probes.frontendProbe.detail}`);
    process.exit(1);
  }

  if (mode === 'dry-run') {
    const modeReason = autoSelected
      ? `เลือกอัตโนมัติเพราะ backend หรือ frontend ยังไม่รัน (backend=${probes.backendProbe.ok}, frontend=${probes.frontendProbe.ok}) — "ยังไม่มี service" ตามนิยามโหมด (ค)`
      : 'ถูกสั่งรันแบบ dry-run โดยตรง (FLOW_PROOF_MODE=dry-run)';
    log(modeReason);
    const problems = structuralSelfCheck();
    if (problems.length > 0) {
      console.error('FATAL: dry-run structural self-check failed:');
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }

    // Structural check passed. If the frontend alone happens to be
    // reachable (backend down), ALSO run the real 8 steps for real —
    // genuine clicks/API capture/DB reads against whatever portion of the
    // app truly works — as a clearly separate appendix. This does NOT
    // change the official mode (dry-run) or its exit-code semantics: the
    // official run made no DB/backend claim, so it stays honest either way.
    let appendixHtml = '';
    if (probes.frontendProbe.ok) {
      log('frontend reachable — running the 8 steps for real as a SUPPLEMENTARY appendix (not the official dry-run result; backend is unreachable so BLOCKED is expected throughout)');
      const liveResults = await runLiveSteps();
      const liveLayerSummary = summarizeLayers(liveResults);
      appendixHtml = buildAppendixFragment({
        heading: 'ภาคผนวก: การรันจริงเพิ่มเติม (ไม่ใช่ผลของโหมด dry-run)',
        description: 'frontend รันอยู่จริงในเครื่องนี้ (Next.js dev server) แต่ backend รันไม่ได้ (ดูเหตุผลใน probe ด้านบน) จึงคาดว่าทุก step จะ BLOCKED ที่จุดที่ต้องพึ่ง backend — ส่วนนี้พิสูจน์ว่าเบราว์เซอร์จริงกด/กรอกฟอร์มจริง และ layer ที่ไม่ต้องพึ่ง backend (เช่น หน้าเพจโหลดจริง, design-check) ทำงานจริง',
        steps: liveResults,
        layerSummary: liveLayerSummary,
      });
    }

    const html = buildReportHtml({
      generatedAt: new Date().toISOString(),
      mode: 'dry-run',
      modeReason,
      requestedMode: REQUESTED_MODE,
      probes: { ...probes, backendBase: BACKEND_BASE, frontendBase: FRONTEND_BASE },
      steps: steps.map((s) => ({
        seq: s.seq, title: s.title, roleLabel: s.roleLabel, status: 'N/A',
        reason: 'DRY-RUN (โหมดที่รายงานอย่างเป็นทางการ): ไม่ได้รันจริงในส่วนนี้ — โครงสร้าง step นี้ถูกตรวจแล้วเท่านั้น (real execution ถ้ามี อยู่ในภาคผนวกด้านล่าง)',
        startedAt: '', endedAt: '',
        ui: { actions: [], screenshots: [], consoleErrors: [] }, api: [], db: [], design: null,
      })),
      layerSummary: {
        ui: { pass: 0, blocked: steps.length, fail: 0, note: 'dry-run (official)' },
        api: { pass: 0, blocked: steps.length, fail: 0, note: 'dry-run (official)' },
        db: { pass: 0, blocked: steps.length, fail: 0, note: 'dry-run (official)' },
        design: { pass: 0, blocked: steps.length, fail: 0, note: 'dry-run (official)' },
      },
      workItem: WORK_ITEM,
      notes: [
        'โหมดที่รายงานอย่างเป็นทางการคือ DRY-RUN — ไม่ถือเป็นหลักฐานว่า business flow ทำงานจริง',
        ...(appendixHtml ? ['มีภาคผนวกการรันจริง (frontend เท่านั้น) ต่อท้ายรายงานนี้ — เลื่อนลงไปดู'] : []),
      ],
      appendixHtml,
    });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.html'), html);

    log(`dry-run structural self-check: OK — report written to ${path.join(EVIDENCE_DIR, 'report.html')}`);
    if (autoSelected && !ALLOW_PARTIAL) {
      console.error('EXIT NON-ZERO: full/ui-api mode prerequisites were not met (backend/frontend not running) — this is a real capability gap, not a silent skip. Set FLOW_PROOF_ALLOW_PARTIAL=1 to acknowledge an intentional dry-run-only CI invocation.');
      process.exitCode = 1;
    }
    return;
  }

  // mode is 'full' or 'ui-api' with prerequisites met — run the real steps.
  const results = await runLiveSteps();
  const layerSummary = summarizeLayers(results);

  const notes = [];
  if (mode === 'ui-api') notes.push('โหมด ui-api: DB ไม่พร้อม — ผลชั้น DB ในรายงานนี้เป็น BLOCKED/ไม่มีข้อมูลโดยธรรมชาติของโหมด ไม่ใช่ข้อบกพร่องของ flow');

  const html = buildReportHtml({
    generatedAt: new Date().toISOString(),
    mode,
    modeReason: autoSelected ? 'เลือกอัตโนมัติจากผล probe จริงข้างต้น' : `ถูกสั่งรันแบบ explicit (FLOW_PROOF_MODE=${mode})`,
    requestedMode: REQUESTED_MODE,
    probes: { ...probes, backendBase: BACKEND_BASE, frontendBase: FRONTEND_BASE },
    steps: results,
    layerSummary,
    workItem: WORK_ITEM,
    notes,
  });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.html'), html);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'results.json'), JSON.stringify(results, null, 2));
  log(`report written: ${path.join(EVIDENCE_DIR, 'report.html')}`);

  const anyFail = results.some((r) => r.status === 'FAIL');
  const anyBlocked = results.some((r) => r.status === 'BLOCKED');
  if (mode === 'full' && !anyFail && !anyBlocked) {
    log('RESULT: full mode, all 8 steps PASS — exit 0');
    process.exitCode = 0;
  } else if (ALLOW_PARTIAL) {
    log(`RESULT: mode=${mode}, FLOW_PROOF_ALLOW_PARTIAL=1 acknowledges partial scope — exit 0`);
    process.exitCode = 0;
  } else {
    console.error(`EXIT NON-ZERO: mode=${mode}${anyFail ? ', at least one step FAILed' : ''}${anyBlocked ? ', at least one step BLOCKED' : ''} — not a full clean proof. Set FLOW_PROOF_ALLOW_PARTIAL=1 to acknowledge intentionally.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL: flow-proof harness crashed:', e.stack);
  process.exitCode = 1;
});
