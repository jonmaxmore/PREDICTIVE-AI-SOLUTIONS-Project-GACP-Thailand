/**
 * PHASE 0 — S6 — C13 final approval → C14 CERTIFIED → C15 the farmer holds the paper
 *
 * Plan: design note 2026-08-15-phase0-flow-proof (Task 13, §III
 * rows C13/C14/C15). VERIFICATION ONLY — no app code is touched; the spec drives
 * the REAL UI on the running stack (Amendment B topology: next dev :3000 →
 * backend :8000 → Supabase), never /api/e2e/* (G-6), never mutates a money row
 * (G-4 — helpers.psql is SELECT-only), and fails honestly when a door is shut.
 *
 * Checkpoints (protocol §II — DB column + audit row + the screen of the role that
 * acted AND the role that should see the result):
 *
 *   C13  AUDIT_PASSED → APPROVED, taken from the auditor's OWN screen: the
 *        "อนุมัติ" tab of /provider/audits (client-view.tsx:314-317) renders the
 *        final-approval queue (final-approval-list.tsx:81-133) whose "อนุมัติ"
 *        button POSTs /api/provider/auditor/applications/<id>/final-approvals
 *        (provider-api.ts:21 → auditor.js:91-173). The queue itself is every
 *        AUDIT_PASSED row (application-provider-query-methods.js:623-636) — the
 *        shared Supabase holds other people's rows too, so every locator below is
 *        pinned to THIS application's applicationNumber, never .first() on a bare
 *        button.
 *
 *   C14  APPROVED → CERTIFIED. The plan says no dedicated FE button was found;
 *        that claim is RE-TESTED here on three real auditor surfaces before any
 *        fallback is allowed (recorded in C14-ui-doors.txt either way):
 *          a) /provider/audits/<APP>      — auditor job sheet (audits/[id]/page.tsx:558-582
 *             only renders เริ่มตรวจ / PASS / MINOR / MAJOR / REJECT, and only while
 *             canSubmitDecision)
 *          b) /provider/applications/<APP> — the action panel is gated on canReview
 *             (page.tsx:420-463: request-revision + approve-documents only)
 *          c) /provider/work[?tab=queue] → /provider/work/<activityId> — the generic
 *             work inbox DOES carry a next-state select (work/[id]/client-view.tsx:517-534)
 *             whose Thai label for CERTIFIED is "ออกใบรับรองแล้ว" (:119). If a work
 *             activity for this application offers CERTIFIED, that IS a real UI door
 *             and it is used.
 *        Only when all three are shut: FINDING F-UI-CERT (file + screenshots) and the
 *        pipe is closed through the endpoint the SAME auditor role legitimately owns —
 *        POST /api/provider/applications/<APP>/workflow-transitions {toState:CERTIFIED}
 *        (edge APPROVED->CERTIFIED is granted to CANONICAL_ROLES.FIELD_INSPECTOR:
 *        workflow-transition-service.js:76 + :156). That is NOT a backdoor: it is the
 *        exact route the missing button would have called.
 *
 *   C15  (view) The farmer's own three screens + the public one:
 *        /health/certificates (card = certificates.farmName, shaped as siteName in
 *        certificates.js:141) → /health/certificates/<certId> (detail + PDF CTA,
 *        [id]/client-view.tsx:206,291-298) → the PDF bytes themselves
 *        (GET /api/certificates/<id>/download, certificates.js:280-330, streams
 *        Content-Type application/pdf) → the public verify surface
 *        (/verify portal → /api/interoperability/v1/verification, and the deep link
 *        /verify/<certNo> that the app's own share/QR builds —
 *        certificate-service.ts:114-117).
 *
 *   M1 holder check (mission): who the paper NAMES is read from the row and from
 *        every surface, and written to C15-holder-identity.txt. The production rule
 *        is certificate-service.js:1489-1497 — entity.displayName when the
 *        application/farm carries an Entity, else the frozen person name with
 *        holderType=LEGACY_PERSON. So a person-shaped holder is NOT asserted away
 *        here: it is recorded with the rule that produced it (FINDING material),
 *        while what IS asserted is that the column was written at issuance and that
 *        the farm identity — not a person — is what the applicant's card shows.
 *
 * Credentials come from the run command only (G-3): PHASE0_FARMER_PW (the s01
 * farmer) and PHASE0_SEED_PW_OFFICER (seed auditor 2222222222222). No token and no
 * password is ever written to an evidence file.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { login, dump, auditDump, psql, readVars, saveVars, EV } from './helpers';

const SEG = 's06';
const OUT = join(EV, SEG);
mkdirSync(OUT, { recursive: true });

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name), fullPage: true });
const rows = <T>(sql: string): T[] => JSON.parse(psql(sql)) as T[];
const one = <T>(sql: string): T | undefined => rows<T>(sql)[0];
/** Canonical status-transition rows for this application (the fail-open hole is
 *  application-status-writer.js:74-87 — a hop CAN commit with no row, so count). */
const canonicalCount = (app: string): number =>
  rows<{ id: string }>(
    `SELECT id FROM audit_logs WHERE "resourceId"='${app}' AND action='APPLICATION_STATUS_TRANSITION';`,
  ).length;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface AppRow {
  id: string;
  applicationNumber: string;
  status: string;
  auditorId: string | null;
}
interface CertRow {
  id: string;
  certificateNumber: string;
  status: string;
  farmName: string | null;
  applicantName: string | null;
  holderDisplayName: string | null;
  holderType: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
}

/** Seed officer identity (Amendment B — auditor). Password comes from env. */
const AUDITOR_LOGIN_ID = '2222222222222';

test.describe.serial('Phase0 S6 — C13 final approval → C14 CERTIFIED → C15 farmer + public view', () => {
  test('C13 AUDIT_PASSED→APPROVED on the auditor screen, C14 →CERTIFIED, C15 cert visible + PDF + public verify', async ({
    page,
    browser,
  }) => {
    const V = readVars();
    // String(... ?? '') keeps the values typed as string under the repo's
    // noUncheckedIndexedAccess; the truthiness expectations below are the real guard.
    const APP = String(V.FARMER_MAIN_APP ?? '');
    const FARMER_ID = String(V.FARMER_MAIN_ID ?? '');
    const FARMER_PW = process.env.PHASE0_FARMER_PW || '';
    const OFFICER_PW = process.env.PHASE0_SEED_PW_OFFICER || '';
    expect(APP, 'FARMER_MAIN_APP present in VARS (written by s01)').toBeTruthy();
    expect(FARMER_ID, 'FARMER_MAIN_ID present in VARS (written by s01)').toBeTruthy();
    expect(FARMER_PW, 'PHASE0_FARMER_PW set in the run command (never committed — G-3)').toBeTruthy();
    expect(OFFICER_PW, 'PHASE0_SEED_PW_OFFICER set in the run command (never committed — G-3)').toBeTruthy();

    // ═══════════════════════════════════════════════════════════════
    // C13 — precondition + before-dump
    // ═══════════════════════════════════════════════════════════════
    dump(SEG, 'C13', 'before', APP);
    const before = one<AppRow>(
      `SELECT id, "applicationNumber", status, "auditorId" FROM applications WHERE id='${APP}';`,
    );
    const certBefore = rows<CertRow>(
      `SELECT id, "certificateNumber", status, "farmName", "applicantName",
        "holderDisplayName", "holderType", "issuedDate", "expiryDate"
       FROM certificates WHERE "applicationId"='${APP}' ORDER BY "issuedDate";`,
    );
    writeFileSync(
      join(OUT, 'C13-precondition.txt'),
      `application: ${JSON.stringify(before, null, 2)}\n` +
        `certificates already on this application BEFORE C13 (the current code mints at the\n` +
        `AUDIT_PASSED write — application-status-writer cert hook; plan §III C12 / ruling D2):\n` +
        `${JSON.stringify(certBefore, null, 2)}\n`,
    );
    // Honest precondition: reaching AUDIT_PASSED is the upstream segment's job.
    // If the row is elsewhere, this segment must fail here and name the real state.
    expect(
      before?.status,
      `C13 precondition — the row sits at AUDIT_PASSED (C12 output); observed ${before?.status}`,
    ).toBe('AUDIT_PASSED');
    const APP_NO = String(before?.applicationNumber || '');
    expect(APP_NO, 'the application carries an applicationNumber to pin the queue row by').toBeTruthy();

    // ── auditor context (own video; a hand-made context does not inherit the
    // config `use`, so baseURL is taken from the project config, not hardcoded) ──
    const BASE = String(test.info().project.use.baseURL || '');
    expect(BASE, 'baseURL resolved from playwright.phase0.config.ts').toBeTruthy();
    const audCtx = await browser.newContext({
      baseURL: BASE,
      recordVideo: { dir: join(OUT, 'video-auditor') },
    });
    const aud = await audCtx.newPage();
    const audLoginResp = aud
      .waitForResponse(
        (r) => r.url().includes('/auth/provider/login') && r.request().method() === 'POST',
        { timeout: 90_000 },
      )
      .catch(() => null);
    await login(aud, { kind: 'provider', id: AUDITOR_LOGIN_ID, pw: OFFICER_PW });
    const alr = await audLoginResp;
    const alb = alr ? await alr.json().catch(() => null) : null;
    // Redacted on purpose: the JWT is a bearer credential — record only that it
    // arrived, never the token itself (L2/G-3).
    const AUD_TOKEN: string = alb?.data?.tokens?.accessToken || alb?.data?.token || '';
    const AUDITOR_USER_ID: string = alb?.data?.user?.id || '';
    try {
      // helpers.login's **/provider/** glob also matches the login URL itself, so
      // wait for a real authenticated landing before touching guarded routes.
      await aud.waitForURL(/\/provider\/(dashboard|audits|work|applications|reviewer|scheduler)/, {
        timeout: 120_000,
      });
    } catch {
      await shot(aud, 'C13-00-auditor-login-stuck.png');
      throw new Error('auditor login did not reach a /provider landing — see C13-00-auditor-login-stuck.png');
    }
    await aud.waitForLoadState('domcontentloaded');
    writeFileSync(
      join(OUT, 'C13-auditor-login.txt'),
      `login status ${alr ? alr.status() : 'none'} tokenPresent=${Boolean(AUD_TOKEN)}\n` +
        `logged-in auditor userId: ${AUDITOR_USER_ID}\n` +
        `applications.auditorId:   ${before?.auditorId}\n` +
        `same person: ${Boolean(AUDITOR_USER_ID) && AUDITOR_USER_ID === before?.auditorId}\n` +
        '(recorded, not asserted — the authoritative gate is that the final-approval POST below is\n' +
        'accepted, which withVisibility grants only to an auditor who can see this row: auditor.js:105-112)\n',
    );
    expect(AUD_TOKEN, 'auditor bearer token captured from the login response').toBeTruthy();

    // ── the auditor's own screen: /provider/audits → tab "อนุมัติ" ──
    await aud.goto('/provider/audits', { timeout: 200_000 });
    await aud.waitForLoadState('domcontentloaded');
    await aud.waitForTimeout(4000); // dashboard + final-approval-queue fetches
    await shot(aud, 'C13-01-auditor-dashboard.png');
    const finalTab = aud.getByRole('tab', { name: /อนุมัติ/ });
    await expect(finalTab, 'the auditor dashboard exposes the final-approval tab (audits/client-view.tsx:314-317)')
      .toBeVisible({ timeout: 60_000 });
    await finalTab.click();
    await aud.waitForTimeout(2000);
    await shot(aud, 'C13-02-final-approval-queue.png');

    // Pin the row to THIS application (shared DB — other AUDIT_PASSED rows are in
    // the same queue). The innermost div that carries both the applicationNumber
    // and an "อนุมัติ" button IS the queue row (final-approval-list.tsx:84-131).
    const queueRow = aud
      .locator('div')
      .filter({ hasText: new RegExp(escapeRe(APP_NO)) })
      .filter({ has: aud.getByRole('button', { name: 'อนุมัติ', exact: true }) })
      .last();
    await expect(
      queueRow,
      `C13 — ${APP_NO} is listed in the auditor's final-approval queue (listFinalApprovalQueue = every AUDIT_PASSED row)`,
    ).toBeVisible({ timeout: 60_000 });
    const rowText = (await queueRow.innerText().catch(() => '')).slice(0, 800);

    const canonicalBeforeC13 = canonicalCount(APP);
    const approveResp = aud
      .waitForResponse(
        (r) => r.url().includes('/final-approvals') && r.request().method() === 'POST',
        { timeout: 120_000 },
      )
      .catch(() => null);
    await queueRow.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    const ar = await approveResp;
    const arBody = ar ? (await ar.text().catch(() => '')).slice(0, 2000) : '';
    writeFileSync(
      join(OUT, 'C13-final-approval-response.txt'),
      `queue row text:\n${rowText}\n\n` +
        `POST /api/provider/auditor/applications/${APP}/final-approvals → status ${ar ? ar.status() : 'none'}\n${arBody}\n`,
    );

    // The route runs a single tx (auditor.js:126-152); poll rather than assume.
    let statusC13 = '';
    for (let i = 0; i < 12 && statusC13 !== 'APPROVED'; i++) {
      statusC13 = one<{ status: string }>(`SELECT status FROM applications WHERE id='${APP}';`)?.status ?? '';
      if (statusC13 !== 'APPROVED') await aud.waitForTimeout(3000);
    }
    await aud.waitForTimeout(2000);
    await aud.reload({ timeout: 200_000 }).catch(() => null);
    await aud.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(aud, 'C13-03-auditor-after-approve.png');

    dump(SEG, 'C13', 'after', APP);
    auditDump(SEG, 'C13', APP);
    const canonicalAfterC13 = canonicalCount(APP);
    writeFileSync(
      join(OUT, 'C13-summary.txt'),
      `status: ${before?.status} → ${statusC13}\n` +
        `canonical APPLICATION_STATUS_TRANSITION rows: ${canonicalBeforeC13} → ${canonicalAfterC13}\n`,
    );
    expect(ar?.status(), 'C13 — the final-approval POST was accepted from the auditor screen').toBe(200);
    expect(statusC13, 'C13 status = APPROVED (auditor.js:126-152 via the final-approval queue button)').toBe('APPROVED');
    expect(
      canonicalAfterC13 - canonicalBeforeC13,
      'C13 canonical audit row for →APPROVED — 0 new rows = the fail-open hole (application-status-writer.js:74-87)',
    ).toBeGreaterThanOrEqual(1);

    // ═══════════════════════════════════════════════════════════════
    // C14 — APPROVED → CERTIFIED (UI doors probed first, then the auditor's
    //       own endpoint if — and only if — every door is shut)
    // ═══════════════════════════════════════════════════════════════
    dump(SEG, 'C14', 'before', APP);
    const canonicalBeforeC14 = canonicalCount(APP);
    const doorNotes: string[] = [];

    // (a) the auditor job sheet
    await aud.goto(`/provider/audits/${APP}`, { timeout: 200_000 });
    await aud.waitForLoadState('domcontentloaded');
    await aud.waitForTimeout(3000);
    await shot(aud, 'C14-01-auditor-job-sheet.png');
    const jobSheetActions = await aud
      .getByTestId('auditor-action-buttons')
      .innerText()
      .catch(() => '(no auditor-action-buttons block rendered)');
    const certifyBtnAudits = await aud
      .getByRole('button', { name: /ออกใบรับรอง|CERTIFIED/i })
      .count();
    doorNotes.push(
      `(a) /provider/audits/${APP}\n` +
        `    auditor-action-buttons block: ${JSON.stringify(jobSheetActions)}\n` +
        `    buttons matching /ออกใบรับรอง|CERTIFIED/i: ${certifyBtnAudits}`,
    );

    // (b) the provider application detail page
    await aud.goto(`/provider/applications/${APP}`, { timeout: 200_000 });
    await aud.waitForLoadState('domcontentloaded');
    await aud.waitForTimeout(3000);
    await shot(aud, 'C14-02-provider-application-detail.png');
    const reviewerPanel = await aud.getByTestId('action-panel-reviewer').count();
    const readonlyNotice = await aud.getByTestId('action-panel-readonly-notice').count();
    const certifyBtnDetail = await aud
      .getByRole('button', { name: /ออกใบรับรอง|CERTIFIED/i })
      .count();
    doorNotes.push(
      `(b) /provider/applications/${APP}\n` +
        `    action-panel-reviewer present: ${reviewerPanel} · readonly-notice present: ${readonlyNotice}\n` +
        `    buttons matching /ออกใบรับรอง|CERTIFIED/i: ${certifyBtnDetail}`,
    );

    // (c) the generic work inbox — the ONE surface that carries a next-state select
    let uiCertifyUsed = false;
    let workDoneStatus = 'none';
    for (const url of ['/provider/work', '/provider/work?tab=queue']) {
      if (uiCertifyUsed) break;
      await aud.goto(url, { timeout: 200_000 });
      await aud.waitForLoadState('domcontentloaded');
      await aud.waitForTimeout(3500); // queue fetch
      await shot(aud, `C14-03-work-${url.includes('queue') ? 'queue' : 'my'}.png`);
      const workRow = aud.getByRole('link', { name: new RegExp(escapeRe(APP_NO)) }).first();
      const rowVisible = await workRow
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      doorNotes.push(`(c) ${url} — work row for ${APP_NO} visible: ${rowVisible}`);
      if (!rowVisible) continue;

      await workRow.click();
      await aud.waitForURL('**/provider/work/**', { timeout: 200_000 });
      await aud.waitForLoadState('domcontentloaded');
      await aud.waitForTimeout(2500);
      await shot(aud, 'C14-04-work-activity-detail.png');
      const select = aud.getByTestId('next-state-select');
      const hasSelect = await select
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      const values = hasSelect
        ? await select.locator('option').evaluateAll((els) =>
            els.map((e) => (e as HTMLOptionElement).value).filter(Boolean),
          )
        : [];
      doorNotes.push(
        `    work-activity detail ${aud.url()}\n` +
          `    next-state-select rendered: ${hasSelect} · options: [${values.join(', ')}]`,
      );
      if (!values.includes('CERTIFIED')) continue;

      // A REAL UI door exists — use it (mission G-6: the API fallback is only for a
      // shut door). NB work.js advances via writeApplicationStatus directly, which
      // still writes the canonical audit row but runs no workflow side-effects.
      await select.selectOption('CERTIFIED');
      const commentBox = aud.getByPlaceholder('ระบุเหตุผล / รายละเอียด');
      if (await commentBox.count()) {
        await commentBox.fill('Phase 0 C14 — ออกใบรับรองจากงานในกล่องงานผู้ตรวจ');
      }
      const doneResp = aud
        .waitForResponse(
          (r) => r.url().includes('/work/') && r.url().includes('/done') && r.request().method() === 'POST',
          { timeout: 120_000 },
        )
        .catch(() => null);
      await aud.getByRole('button', { name: /ปิดงาน \+ เลื่อน/ }).click();
      const dr = await doneResp;
      workDoneStatus = dr ? String(dr.status()) : 'none';
      uiCertifyUsed = true;
      doorNotes.push(`    USED THIS DOOR — POST .../work/<id>/done {advanceStatus:CERTIFIED} → ${workDoneStatus}`);
      await aud.waitForTimeout(3000);
      await shot(aud, 'C14-05-work-after-advance.png');
    }

    // Fallback — only when every door above was shut.
    let apiFallbackStatus = 'not-used';
    if (!uiCertifyUsed) {
      writeFileSync(
        join(OUT, 'C14-FINDING-no-ui-door.txt'),
        `FINDING F-UI-CERT — the last hop of the pipeline (APPROVED → CERTIFIED) has NO button.\n\n` +
          `Probed as the logged-in auditor (${AUDITOR_LOGIN_ID}) on ${new Date().toISOString()}:\n` +
          `${doorNotes.join('\n')}\n\n` +
          `Screens: C14-01-auditor-job-sheet.png · C14-02-provider-application-detail.png ·\n` +
          `C14-03-work-my.png / C14-03-work-queue.png\n\n` +
          `The edge itself is legal and auditor-owned — ALLOWED_TRANSITIONS APPROVED->CERTIFIED\n` +
          `(workflow-transition-service.js:76) and ROLE_TRANSITIONS AUDITOR 'APPROVED->CERTIFIED' (:156).\n` +
          `So the pipe is closed below through the exact endpoint the missing button would call:\n` +
          `POST /api/provider/applications/<APP>/workflow-transitions {"toState":"CERTIFIED"} —\n` +
          `NOT an /api/e2e backdoor (G-6). What is missing is the door, not the right.\n`,
      );
      const certResp = await aud.request.post(`/api/provider/applications/${APP}/workflow-transitions`, {
        headers: { Authorization: `Bearer ${AUD_TOKEN}` },
        data: {
          toState: 'CERTIFIED',
          comment: 'Phase 0 C14 — ปิดท่อขั้นสุดท้าย (ไม่มีประตู UI สำหรับ hop นี้ — FINDING F-UI-CERT)',
        },
      });
      apiFallbackStatus = String(certResp.status());
      writeFileSync(
        join(OUT, 'C14-api-fallback-response.txt'),
        `POST /api/provider/applications/${APP}/workflow-transitions {toState: CERTIFIED} → status ${apiFallbackStatus}\n` +
          `${(await certResp.text().catch(() => '')).slice(0, 2000)}\n`,
      );
    }

    let statusC14 = '';
    for (let i = 0; i < 12 && statusC14 !== 'CERTIFIED'; i++) {
      statusC14 = one<{ status: string }>(`SELECT status FROM applications WHERE id='${APP}';`)?.status ?? '';
      if (statusC14 !== 'CERTIFIED') await aud.waitForTimeout(3000);
    }
    dump(SEG, 'C14', 'after', APP);
    auditDump(SEG, 'C14', APP);
    const canonicalAfterC14 = canonicalCount(APP);

    // The certificate row of record (minted upstream at AUDIT_PASSED per the current
    // code; generateCertificate in auditor.js:143-147 is idempotent belt-and-braces).
    const cert = one<CertRow>(
      `SELECT id, "certificateNumber", status, "farmName", "applicantName",
        "holderDisplayName", "holderType", "issuedDate", "expiryDate"
       FROM certificates WHERE "applicationId"='${APP}' ORDER BY "issuedDate" DESC LIMIT 1;`,
    );
    writeFileSync(
      join(OUT, 'C14-ui-doors.txt'),
      `C14 APPROVED→CERTIFIED — UI door probe (mission: try the UI FIRST, fall back only if shut)\n` +
        `${doorNotes.join('\n')}\n\n` +
        `UI door used: ${uiCertifyUsed} (work-inbox /done status ${workDoneStatus})\n` +
        `API fallback used: ${!uiCertifyUsed} (status ${apiFallbackStatus})\n` +
        `status after C14: ${statusC14}\n` +
        `canonical APPLICATION_STATUS_TRANSITION rows: ${canonicalBeforeC14} → ${canonicalAfterC14}\n` +
        `certificate row: ${JSON.stringify(cert, null, 2)}\n`,
    );
    if (cert?.id) {
      saveVars('FARMER_MAIN_CERT_ID', cert.id);
      saveVars('FARMER_MAIN_CERT_NO', cert.certificateNumber);
    }
    await aud.goto(`/provider/audits/${APP}`, { timeout: 200_000 }).catch(() => null);
    await aud.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(aud, 'C14-06-auditor-after-certified.png');
    await audCtx.close(); // flush the auditor video before the assertions below

    expect(statusC14, 'C14 status = CERTIFIED (auditor-owned edge APPROVED->CERTIFIED)').toBe('CERTIFIED');
    expect(
      canonicalAfterC14 - canonicalBeforeC14,
      'C14 canonical audit row for →CERTIFIED — 0 new rows = the fail-open hole (application-status-writer.js:74-87)',
    ).toBeGreaterThanOrEqual(1);
    expect(cert?.id, 'a certificate row exists for this application (plan §IV pass criterion)').toBeTruthy();
    const CERT_ID = String(cert?.id ?? '');
    const CERT_NO = String(cert?.certificateNumber ?? '');
    const FARM_NAME = String(cert?.farmName ?? '');
    expect(CERT_NO, 'the certificate carries a certificateNumber').toBeTruthy();

    // ═══════════════════════════════════════════════════════════════
    // C15 — the farmer's own screens (list → detail → PDF) + public verify
    // ═══════════════════════════════════════════════════════════════
    const farmerLoginResp = page
      .waitForResponse(
        (r) => r.url().includes('/auth/health/login') && r.request().method() === 'POST',
        { timeout: 90_000 },
      )
      .catch(() => null);
    await login(page, { kind: 'health', id: FARMER_ID, pw: FARMER_PW });
    const flr = await farmerLoginResp;
    const flb = flr ? await flr.json().catch(() => null) : null;
    // Redacted on purpose: the JWT is a bearer credential — record only that it
    // arrived, never the token itself (L2/G-3). It is needed because the PDF
    // endpoint is authenticateHealth and the api proxy forwards an explicit
    // Authorization header first (api/[...path]/route.ts:33-35).
    const FARMER_TOKEN: string = flb?.data?.tokens?.accessToken || flb?.data?.token || '';
    writeFileSync(
      join(OUT, 'C15-farmer-login.txt'),
      `status ${flr ? flr.status() : 'none'} success=${flb?.success} tokenPresent=${Boolean(FARMER_TOKEN)}\n`,
    );
    try {
      await page.waitForURL(/\/health\/(dashboard|payments|applications|certificates|onboarding|start|profile)/, {
        timeout: 120_000,
      });
    } catch {
      await shot(page, 'C15-00-farmer-login-stuck.png');
      throw new Error('farmer login did not reach a /health landing — see C15-00-farmer-login-stuck.png');
    }
    await page.waitForLoadState('domcontentloaded');

    // (1) the list screen — the card title is certificates.farmName, shaped as
    //     siteName by certificates.js:141 (this is the M1 surface: the FARM is
    //     what the applicant sees as the subject of the paper).
    await page.goto('/health/certificates', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500); // /api/certificates/my
    await shot(page, 'C15-01-certificate-list.png');
    const certCard = page
      .locator('div')
      .filter({ hasText: new RegExp(escapeRe(CERT_NO)) })
      .filter({ has: page.getByRole('link', { name: /ดูใบรับรอง/ }) })
      .last();
    const cardVisible = await certCard
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    const cardText = cardVisible ? (await certCard.innerText().catch(() => '')).slice(0, 1200) : '';
    const listErrorCard = await page.getByTestId('cert-list-error').count();
    const listEmptyCard = await page.getByTestId('cert-list-empty').count();
    writeFileSync(
      join(OUT, 'C15-list-screen.txt'),
      `url: ${page.url()}\n` +
        `card for ${CERT_NO} visible: ${cardVisible}\n` +
        `cert-list-error card present: ${listErrorCard} · cert-list-empty card present: ${listEmptyCard}\n` +
        `card text:\n${cardText}\n`,
    );

    // (2) the detail screen through the farmer's own link
    if (cardVisible) {
      await certCard.getByRole('link', { name: /ดูใบรับรอง/ }).click();
    } else {
      // Recorded above; still open the canonical detail route so the failure is
      // documented WITH the detail evidence rather than instead of it.
      await page.goto(`/health/certificates/${CERT_ID}`, { timeout: 200_000 });
    }
    await page.waitForURL(`**/health/certificates/${CERT_ID}`, { timeout: 200_000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await shot(page, 'C15-02-certificate-detail.png');
    const successCard = await page.getByTestId('cert-success-card').count();
    const detailText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
    const verifyHref = await page
      .locator('a[href*="/verify/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);

    // (3) the PDF — click the farmer's own CTA (view-in-the-loop), then verify the
    //     BYTES through the same endpoint the button calls (certificates.js:280-330).
    // The CTA fetches the PDF then clicks a synthetic <a download> on a blob URL
    // ([id]/client-view.tsx:129-147, certificate-service.ts:125-153). Chromium can
    // drop that download when revokeObjectURL races it, so the event is RECORDED,
    // never asserted — the byte-level check below is the real proof.
    const downloadEvent = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    await page.getByRole('button', { name: /ดาวน์โหลดใบรับรอง \(PDF\)/ }).click();
    const dl = await downloadEvent;
    let savedFromUi = '';
    if (dl) {
      savedFromUi = join(OUT, `C15-certificate-${CERT_NO}-from-ui.pdf`);
      await dl.saveAs(savedFromUi).catch(() => {
        savedFromUi = '(download event fired but saveAs failed)';
      });
    }
    await page.waitForTimeout(1500);
    await shot(page, 'C15-03-certificate-detail-after-download.png');
    const uiDownloadError = await page.getByText('ไม่สามารถดาวน์โหลดใบรับรองได้').count();

    expect(FARMER_TOKEN, 'farmer bearer token captured from the login response').toBeTruthy();
    const pdfRes = await page.request.get(`/api/certificates/${CERT_ID}/download`, {
      headers: { Authorization: `Bearer ${FARMER_TOKEN}` },
    });
    const pdfBody = pdfRes.ok() ? await pdfRes.body() : Buffer.alloc(0);
    if (pdfBody.length) {
      writeFileSync(join(OUT, `C15-certificate-${CERT_NO}.pdf`), pdfBody);
    }
    writeFileSync(
      join(OUT, 'C15-detail-and-pdf.txt'),
      `detail url: ${page.url()}\n` +
        `cert-success-card present: ${successCard}\n` +
        `share/verify link href on the detail page: ${verifyHref}\n` +
        `UI download button: download event fired = ${Boolean(dl)}${savedFromUi ? ` → ${savedFromUi}` : ''}\n` +
        `UI download error box visible: ${uiDownloadError}\n` +
        `GET /api/certificates/${CERT_ID}/download → status ${pdfRes.status()} ` +
        `content-type ${pdfRes.headers()['content-type']} bytes ${pdfBody.length}\n` +
        `pdf magic: ${pdfBody.subarray(0, 5).toString('latin1')}\n\n` +
        `detail screen text (first 4000 chars):\n${detailText}\n`,
    );

    // (4) public verify — the deep link the app's own share/QR builds
    //     (certificate-service.ts:114-117), then the working portal form.
    const deep = await page.goto(`/verify/${CERT_NO}`, { timeout: 200_000 }).catch(() => null);
    // -1 = the navigation itself threw (no response at all), which must NOT read as
    // "fine" in the assertion below.
    const deepStatus = deep ? deep.status() : -1;
    const deepOk = deepStatus >= 200 && deepStatus < 400;
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(page, 'C15-04-public-verify-deeplink.png');

    await page.goto('/verify', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C15-05-public-verify-portal.png');
    await page.fill('#certificate-number', CERT_NO);
    const verifyResp = page
      .waitForResponse(
        (r) => r.url().includes('/v1/verification') && r.request().method() === 'GET',
        { timeout: 90_000 },
      )
      .catch(() => null);
    await page.getByRole('button', { name: 'ตรวจสอบใบรับรอง', exact: true }).click();
    const vr = await verifyResp;
    const vrBody = vr ? (await vr.text().catch(() => '')).slice(0, 2000) : '';
    await page.waitForTimeout(2500);
    await shot(page, 'C15-06-public-verify-result.png');
    const verifyPanelText = (await page.locator('article').first().innerText().catch(() => '')).slice(0, 2000);

    // (5) the backend's own public verification page — the surface that names the
    //     HOLDER publicly (auth/public.js:203-244 via routes/api/index.js:107).
    const pubRes = await page.request.get(`/api/public/verify/${CERT_NO}/page`);
    const pubHtml = (await pubRes.text().catch(() => '')).slice(0, 6000);
    writeFileSync(
      join(OUT, 'C15-public-verify.txt'),
      `deep link GET /verify/${CERT_NO} → HTTP ${deepStatus}\n` +
        `(the app builds exactly this URL for its QR + "แชร์ใบรับรอง" button —\n` +
        ` web-app/src/lib/services/certificate-service.ts:114-117; detail-page href was ${verifyHref})\n\n` +
        `portal /verify → GET /api/interoperability/v1/verification?certificateNumber=${CERT_NO}\n` +
        `status ${vr ? vr.status() : 'none'}\n${vrBody}\n\n` +
        `portal result panel text:\n${verifyPanelText}\n\n` +
        `backend SSR page GET /api/public/verify/${CERT_NO}/page → status ${pubRes.status()}\n` +
        `${pubHtml}\n`,
    );

    // ── M1: who does the paper name? Record every surface next to the rule. ──
    const holderOnCard = Boolean(FARM_NAME) && cardText.includes(FARM_NAME);
    const holderOnDetail = FARM_NAME ? detailText.includes(FARM_NAME) : false;
    const personOnCard = cert?.applicantName ? cardText.includes(String(cert.applicantName)) : false;
    writeFileSync(
      join(OUT, 'C15-holder-identity.txt'),
      `M1 check — "the farm holds the certificate, the person merely submits"\n` +
        `production rule: certificate-service.js:1489-1497 (entity.displayName when the application/farm\n` +
        `carries an Entity, else the frozen person name with holderType=LEGACY_PERSON)\n\n` +
        `certificates row:\n` +
        `  certificateNumber : ${CERT_NO}\n` +
        `  farmName          : ${cert?.farmName}\n` +
        `  applicantName     : ${cert?.applicantName}   (frozen history column)\n` +
        `  holderDisplayName : ${cert?.holderDisplayName}\n` +
        `  holderType        : ${cert?.holderType}\n\n` +
        `screens:\n` +
        `  farmer list card shows farmName        : ${holderOnCard}\n` +
        `  farmer detail page shows farmName      : ${holderOnDetail}\n` +
        `  farmer list card shows the person name : ${personOnCard}\n` +
        `  public SSR page (holder row) is in C15-public-verify.txt\n\n` +
        `NOTE (FINDING material, not asserted): holderType=LEGACY_PERSON means this application carried\n` +
        `no Entity, so the M1 fallback named the PERSON on the certificate. Whether an INDIVIDUAL\n` +
        `applicant should get an auto-created entity is a design question outside this verification run.\n` +
        `NOTE 2 (FINDING material): /api/certificates/:id returns the RAW certificate row, which has\n` +
        `farmName and no siteName column (certification.prisma:28), while the detail page renders\n` +
        `cert.siteName ([id]/client-view.tsx:265-272) — the list route is the one that maps\n` +
        `siteName: cert.farmName (certificates.js:141). If "farmer detail page shows farmName" is\n` +
        `false above, that mapping gap is the reason, not missing data.\n`,
    );

    // ── C15 assertions (evidence for every surface is already on disk above) ──
    expect(cardVisible, `C15 — the farmer's own list screen shows certificate ${CERT_NO}`).toBe(true);
    expect(
      listErrorCard,
      'the certificate list rendered data, not the fetch-error card (cert-list-error)',
    ).toBe(0);
    expect(
      Boolean(FARM_NAME) && cardText.includes(FARM_NAME),
      'C15 M1 — the card names the FARM (certificates.farmName, shaped as siteName by certificates.js:141)',
    ).toBe(true);
    expect(cert?.holderDisplayName, 'M1 holder column written at issuance (certificate-service.js:394,1493)').toBeTruthy();
    expect(successCard, 'C15 — the certificate detail screen rendered (cert-success-card)').toBeGreaterThanOrEqual(1);
    expect(detailText.includes(CERT_NO), 'C15 — the detail screen shows this certificate number').toBe(true);
    expect(uiDownloadError, "C15 — the farmer's download CTA raised no error box").toBe(0);
    expect(pdfRes.status(), 'C15 — GET /api/certificates/<id>/download served the PDF').toBe(200);
    expect(
      String(pdfRes.headers()['content-type'] || ''),
      'C15 — the download is a real application/pdf stream (certificates.js:322)',
    ).toContain('application/pdf');
    expect(pdfBody.subarray(0, 4).toString('latin1'), 'C15 — the downloaded bytes are a PDF (%PDF magic)').toBe('%PDF');
    expect(vr?.status(), 'C15 — the public portal reached the verification API').toBe(200);
    expect(
      verifyPanelText.includes(CERT_NO),
      'C15 — the public verify portal answered for THIS certificate number',
    ).toBe(true);
    expect(
      verifyPanelText,
      'C15 — the public verdict is a trust status, not an error (สถานะความเชื่อถือ — trust-verifier-portal.tsx:268)',
    ).toContain('สถานะความเชื่อถือ');
    expect(pubRes.status(), 'C15 — the backend public verification page renders (auth/public.js:203)').toBe(200);
    // Asserted LAST on purpose: every other C15 surface is already proven and its
    // evidence written. This is the app's OWN QR/share URL — a 404 here means the
    // printed certificate points the public at a dead page (FINDING F-VERIFY-DEEPLINK).
    expect(
      deepOk,
      `C15 — the deep link /verify/${CERT_NO} that the QR + "แชร์ใบรับรอง" button build resolves ` +
        `(observed HTTP ${deepStatus}; web-app has only src/app/verify/page.tsx — no [certificateNumber] ` +
        'segment, so this is FINDING F-VERIFY-DEEPLINK: see C15-public-verify.txt + C15-04-public-verify-deeplink.png)',
    ).toBe(true);
  });
});
