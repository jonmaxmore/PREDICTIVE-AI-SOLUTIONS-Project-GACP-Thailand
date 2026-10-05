/**
 * Single-file HTML report builder. Inline CSS, relative image paths only —
 * must open directly from disk (file://) with no server, no external asset
 * fetch (the gacp-view-in-the-loop guideline: "operator เปิด
 * trace/ภาพดูเอง").
 */
import { redactString } from './redact.mjs';

/**
 * Escapes for HTML AND redacts PII-shaped substrings (the project rules 3.3) — a
 * second, blanket redaction pass at the render boundary, independent of
 * whatever an individual step/action already did (e.g. steps.mjs/ui-helpers.mjs
 * mask password values explicitly, but a fill-action `detail` string like
 * `reg-identifier = "6726994697391"` was found NOT masked anywhere upstream
 * during this harness's own live test run — fixed here so no future action
 * type can reintroduce the same leak).
 */
function esc(s) {
  return redactString(String(s === undefined || s === null ? '' : s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusBadge(status) {
  const cls = { PASS: 'badge-pass', BLOCKED: 'badge-blocked', FAIL: 'badge-fail', SIMULATED: 'badge-sim', 'N/A': 'badge-na' }[status] || 'badge-na';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function renderActions(actions) {
  if (!actions || actions.length === 0) return '<p class="muted">(ไม่มี action ที่บันทึก)</p>';
  return `<ol class="actions">${actions.map((a) => `
    <li class="${a.ok ? 'action-ok' : 'action-fail'}">
      <strong>${esc(a.type)}</strong> — ${esc(a.detail)}
      ${a.ok ? '' : `<div class="err">${esc(a.error)}</div>`}
    </li>`).join('')}</ol>`;
}

function renderScreenshots(shots) {
  if (!shots || shots.length === 0) return '<p class="muted">(ไม่มี screenshot)</p>';
  return `<div class="shots">${shots.map((s) => `
    <figure>
      <img src="${esc(s.file)}" alt="${esc(s.label)}" loading="lazy" />
      <figcaption>${esc(s.label)}</figcaption>
    </figure>`).join('')}</div>`;
}

function renderApi(calls) {
  if (!calls || calls.length === 0) return '<p class="muted">(ไม่มี API call ที่ตรงเงื่อนไขระหว่าง step นี้)</p>';
  return `<table class="api-table"><thead><tr><th>เวลา</th><th>Method</th><th>Path</th><th>Status</th><th>Request body (redacted)</th><th>Response body (redacted)</th></tr></thead><tbody>
    ${calls.map((c) => `<tr>
      <td>${esc(c.timestamp)}</td>
      <td>${esc(c.method)}</td>
      <td>${esc(c.path)}</td>
      <td class="${c.status && c.status < 400 ? 'ok' : 'bad'}">${esc(c.status ?? c.error ?? 'no response')}</td>
      <td><pre>${esc(JSON.stringify(c.reqBody, null, 2))}</pre></td>
      <td><pre>${esc(JSON.stringify(c.resBody, null, 2))}</pre></td>
    </tr>`).join('')}
  </tbody></table>`;
}

function renderDb(dbEntries) {
  if (!dbEntries || dbEntries.length === 0) return '<p class="muted">(ไม่มี DB snapshot สำหรับ step นี้)</p>';
  return dbEntries.map((d) => {
    if (d.error) {
      return `<div class="db-block"><h4>ตาราง <code>${esc(d.table)}</code></h4><p class="err">DB read error: ${esc(d.error)}</p></div>`;
    }
    const diff = d.diff;
    const changedRows = diff.added.length + diff.changed.length + diff.removed.length;
    return `<div class="db-block">
      <h4>ตาราง <code>${esc(d.table)}</code> — ${changedRows === 0 ? '<span class="muted">ไม่มีการเปลี่ยนแปลง</span>' : `<span class="ok">เปลี่ยน ${changedRows} แถว</span>`}</h4>
      ${diff.added.length ? `<p><strong>เพิ่มใหม่ (${diff.added.length}):</strong></p><pre>${esc(JSON.stringify(diff.added, null, 2))}</pre>` : ''}
      ${diff.changed.length ? `<p><strong>เปลี่ยนแปลง (${diff.changed.length}):</strong></p><pre>${esc(JSON.stringify(diff.changed, null, 2))}</pre>` : ''}
      ${diff.removed.length ? `<p><strong>ลบ (${diff.removed.length}):</strong></p><pre>${esc(JSON.stringify(diff.removed, null, 2))}</pre>` : ''}
    </div>`;
  }).join('');
}

function renderDesign(d) {
  if (!d) return '<p class="muted">(ไม่ได้รันการตรวจดีไซน์ในสถานะนี้ของ step)</p>';
  const rows = [
    ['Design tokens ตรงกับ globals.css', d.tokenMismatches.length === 0, `${d.tokenChecked - d.tokenMismatches.length}/${d.tokenChecked} ตรง`],
    ['Font หลัก', d.fontOk, `expected "${d.expectedFont}" — ได้ "${d.actualFont}"`],
    ['ไม่มี horizontal overflow', !d.overflowX, d.overflowX ? `ล้น ${d.overflowPx}px` : 'ไม่ล้น'],
    ['ไม่มี interactive element ที่ยุบเหลือ 0px', d.collapsedInteractive.length === 0, `${d.collapsedInteractive.length} ตัวยุบ / ${d.interactiveCount} ตัวตรวจ`],
  ];
  return `<table class="design-table"><tbody>
    ${rows.map(([label, ok, detail]) => `<tr class="${ok ? 'ok-row' : 'bad-row'}"><td>${ok ? '✓' : '✗'}</td><td>${esc(label)}</td><td>${esc(detail)}</td></tr>`).join('')}
  </tbody></table>
  ${d.tokenMismatches.length ? `<pre>${esc(JSON.stringify(d.tokenMismatches, null, 2))}</pre>` : ''}
  ${d.collapsedInteractive.length ? `<pre>${esc(JSON.stringify(d.collapsedInteractive, null, 2))}</pre>` : ''}`;
}

function renderStep(step) {
  return `
  <section class="step" id="step-${step.seq}">
    <h2><span class="seq">${step.seq}</span> ${esc(step.title)} ${statusBadge(step.status)}</h2>
    <p class="role">Role: ${esc(step.roleLabel)} · เริ่ม ${esc(step.startedAt)} · จบ ${esc(step.endedAt)}</p>
    <p class="reason"><strong>สรุป:</strong> ${esc(step.reason)}</p>

    <div class="layer">
      <h3>1) หน้าบ้าน (UI) — action log</h3>
      ${renderActions(step.ui.actions)}
      ${renderScreenshots(step.ui.screenshots)}
      ${step.ui.consoleErrors && step.ui.consoleErrors.length
        ? `<details><summary>console errors (${step.ui.consoleErrors.length})</summary><pre>${esc(step.ui.consoleErrors.join('\n'))}</pre></details>`
        : '<p class="muted">ไม่มี console error</p>'}
    </div>

    <div class="layer">
      <h3>2) หลังบ้าน (API) — request/response จริงระหว่าง step นี้</h3>
      ${renderApi(step.api)}
    </div>

    <div class="layer">
      <h3>3) ดาต้าเบส — snapshot ก่อน/หลัง (diff)</h3>
      ${renderDb(step.db)}
    </div>

    <div class="layer">
      <h3>4) ดีไซน์ — ตรวจอัตโนมัติ</h3>
      ${renderDesign(step.design)}
    </div>
  </section>`;
}

function renderSummary(steps) {
  const counts = { PASS: 0, BLOCKED: 0, FAIL: 0, SIMULATED: 0 };
  for (const s of steps) counts[s.status] = (counts[s.status] || 0) + 1;
  return `
  <section class="summary">
    <h2>สรุปผล</h2>
    <table class="summary-table">
      <tr><th>PASS</th><td>${counts.PASS}</td></tr>
      <tr><th>BLOCKED</th><td>${counts.BLOCKED}</td></tr>
      <tr><th>FAIL</th><td>${counts.FAIL}</td></tr>
      <tr><th>SIMULATED</th><td>${counts.SIMULATED}</td></tr>
      <tr><th>รวม step</th><td>${steps.length}</td></tr>
    </table>
    <table class="summary-table">
      <thead><tr><th>#</th><th>Step</th><th>Status</th></tr></thead>
      <tbody>
        ${steps.map((s) => `<tr><td>${s.seq}</td><td><a href="#step-${s.seq}">${esc(s.title)}</a></td><td>${statusBadge(s.status)}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>`;
}

const CSS = `
  :root { --leaf-700:#18803f; --primary:#0d4a2e; --border:#d7ddd8; --bad:#b3261e; --ok:#146333; }
  * { box-sizing: border-box; }
  body { font-family: 'Sukhumvit Set','Sarabun','Noto Sans Thai',sans-serif; margin:0; background:#f4f6f4; color:#1a2620; }
  header { background: var(--primary); color:#fff; padding: 24px 32px; }
  header h1 { margin:0 0 8px; font-size:22px; }
  header p { margin:2px 0; font-size:13px; opacity:.9; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; }
  .modebox { background:#fff; border:1px solid var(--border); border-radius:8px; padding:16px; margin-bottom:24px; }
  .modebox table { width:100%; border-collapse: collapse; font-size:13px; }
  .modebox td, .modebox th { padding:4px 8px; text-align:left; border-bottom:1px solid #eee; }
  .step { background:#fff; border:1px solid var(--border); border-radius:10px; padding:20px 24px; margin-bottom:20px; }
  .step h2 { margin-top:0; font-size:18px; display:flex; align-items:center; gap:10px; }
  .seq { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; background:var(--leaf-700); color:#fff; font-size:13px; }
  .role, .reason { font-size:13px; color:#444; }
  .layer { margin-top:16px; border-top:1px dashed var(--border); padding-top:12px; }
  .layer h3 { font-size:14px; margin:0 0 8px; color:var(--primary); }
  .badge { font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; }
  .badge-pass { background:#e3f5e9; color:var(--ok); }
  .badge-blocked { background:#fff3cd; color:#7a5b00; }
  .badge-fail { background:#fde3e1; color:var(--bad); }
  .badge-sim { background:#e6ecff; color:#25348c; }
  .badge-na { background:#eee; color:#555; }
  .shots { display:flex; flex-wrap:wrap; gap:12px; margin-top:8px; }
  .shots figure { margin:0; width:280px; }
  .shots img { width:100%; border:1px solid var(--border); border-radius:6px; display:block; }
  .shots figcaption { font-size:11px; color:#555; margin-top:4px; }
  .actions { padding-left:20px; font-size:13px; }
  .actions li { margin-bottom:4px; }
  .action-fail { color:var(--bad); }
  .action-fail .err { font-size:12px; background:#fdf1f0; border-radius:4px; padding:4px 8px; margin-top:2px; }
  table.api-table, table.design-table, table.summary-table { width:100%; border-collapse:collapse; font-size:12px; }
  table.api-table th, table.api-table td, table.summary-table th, table.summary-table td { border:1px solid var(--border); padding:6px 8px; vertical-align:top; text-align:left; }
  table.api-table pre { max-width:320px; max-height:180px; overflow:auto; margin:0; font-size:11px; }
  .ok { color:var(--ok); font-weight:700; }
  .bad { color:var(--bad); font-weight:700; }
  .db-block { margin-bottom:12px; }
  .db-block pre { background:#f7f8f6; padding:8px; border-radius:6px; overflow:auto; font-size:11px; }
  table.design-table td:first-child { width:24px; text-align:center; }
  .ok-row { color:var(--ok); } .bad-row { color:var(--bad); }
  .muted { color:#888; font-size:12px; }
  .footer-summary { background:#fff; border:1px solid var(--border); border-radius:10px; padding:20px 24px; }
  .footer-summary table { border-collapse:collapse; }
  .footer-summary th, .footer-summary td { padding:4px 10px; }
  pre { white-space:pre-wrap; word-break:break-word; }
`;

function renderFooterSummary(layerSummary, heading) {
  return `
  <section class="footer-summary">
    <h2>${esc(heading || 'สรุป PASS/FAIL รายชั้น')}</h2>
    <table>
      <tr><th>ชั้น</th><th>PASS</th><th>BLOCKED</th><th>FAIL</th><th>หมายเหตุ</th></tr>
      ${['ui', 'api', 'db', 'design'].map((layer) => {
        const s = layerSummary[layer];
        return `<tr><td>${esc(layer.toUpperCase())}</td><td>${s.pass}</td><td>${s.blocked}</td><td>${s.fail}</td><td>${esc(s.note || '')}</td></tr>`;
      }).join('')}
    </table>
  </section>`;
}

/**
 * A self-contained HTML fragment (no <html>/<head>) for a real, executed run
 * of the 8 steps that is NOT the report's official mode result — used when
 * the official mode is dry-run (backend unreachable) but the frontend alone
 * could still be driven for real, so the operator gets genuine click/API/DB/
 * design evidence for whatever portion of the app IS reachable, clearly
 * separated from the dry-run's pass/fail accounting.
 */
export function buildAppendixFragment({ heading, description, steps, layerSummary }) {
  return `
  <hr style="margin:40px 0;border:none;border-top:3px double var(--border);" />
  <section class="appendix-intro">
    <h2>${esc(heading)}</h2>
    <p>${esc(description)}</p>
  </section>
  ${renderSummary(steps)}
  ${steps.map(renderStep).join('\n')}
  ${renderFooterSummary(layerSummary, 'สรุป PASS/FAIL รายชั้น (ภาคผนวก)')}`;
}

export function buildReportHtml({ generatedAt, mode, modeReason, requestedMode, probes, steps, layerSummary, workItem, notes, appendixHtml }) {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>Flow-proof report — ${esc(workItem)} — ${esc(generatedAt)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Flow-proof harness — เกษตรกรสมัคร → ... → ผู้บริโภคสแกน QR</h1>
  <p>generated ${esc(generatedAt)} · work-item: ${esc(workItem)}</p>
  <p>mode ที่รันจริง: <strong>${esc(mode.toUpperCase())}</strong> (${esc(requestedMode === 'auto' ? 'auto-detected' : 'explicit: ' + requestedMode)})</p>
</header>
<main>
  <div class="modebox">
    <h2>Environment probe (ผลจริง ณ เวลารัน)</h2>
    <table>
      <tr><th>DB</th><td>${probes.dbProbe.ok ? 'REACHABLE' : 'UNREACHABLE'}</td><td>${esc(probes.dbProbe.detail)}</td></tr>
      <tr><th>Backend (${esc(probes.backendBase)})</th><td>${probes.backendProbe.ok ? 'REACHABLE' : 'UNREACHABLE'}</td><td>${esc(probes.backendProbe.detail)}</td></tr>
      <tr><th>Frontend (${esc(probes.frontendBase)})</th><td>${probes.frontendProbe.ok ? 'REACHABLE' : 'UNREACHABLE'}</td><td>${esc(probes.frontendProbe.detail)}</td></tr>
    </table>
    <p><strong>เหตุผลที่เลือกโหมดนี้:</strong> ${esc(modeReason)}</p>
    ${notes && notes.length ? `<p><strong>หมายเหตุ:</strong></p><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </div>

  ${renderSummary(steps)}

  ${steps.map(renderStep).join('\n')}

  ${renderFooterSummary(layerSummary)}
  ${appendixHtml || ''}
</main>
</body>
</html>`;
}
