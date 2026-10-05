/**
 * PHASE 0 — S5 — C11 นัดลงพื้นที่ → C12 ผลตรวจ PASS (ผ่านประตูหลักฐานลงพื้นที่จริง)
 *
 * Plan: design note 2026-08-15-phase0-flow-proof (Task 11 + Task 12,
 * checkpoints C11 + C12 in §III). VERIFICATION ONLY — no app code is touched; the
 * spec drives the REAL UI on the running stack (Amendment B topology: next dev
 * :3000 → backend :8000 → Supabase), never /api/e2e/* and never a seed/force script
 * (G-6), never mutates a money row (G-4 — helpers.psql is SELECT-only), and fails
 * honestly when a door is shut. Every hop below is a real click; there is NO API
 * fallback anywhere in this file.
 *
 * Checkpoints (protocol §II — DB column + audit row + the screen of the role that
 * acted AND the role that should see the result):
 *
 *   C11  AUDIT_FEE_PAID → AUDIT_CONFIRMED. SCHEDULER 3333333333333 assigns AUDITOR
 *        2222222222222 from /provider/scheduler/queue ("จัดตาราง" →
 *        AssignAuditorModal → POST /api/audit/scheduling/assign — client-view.tsx:240-247,
 *        AssignAuditorModal.tsx:214-221, route scheduling.js:89-104). Service writes
 *        formData.auditSchedule (inspectionMode ONSITE by default) and the auditorId
 *        column in one Serializable tx (audit-scheduling-service.js:511-522,541-557).
 *        SAME tx also CREATES the AuditChecklist row the whole onsite-evidence flow
 *        keys off (audit-scheduling-service.js:565-583) — that row is created EMPTY
 *        (no photos, no checklist items), which is exactly the precondition C12's
 *        fail-closed proof needs.
 *
 *   C12  AUDIT_CONFIRMED → AUDIT_PASSED, in TWO parts:
 *
 *        C12-gate (the point of this segment — proves the cert-integrity fix that
 *        merged 2026-08-17 is really fail-closed on the running stack): the auditor
 *        presses the job-sheet's "ผ่าน (PASS)" button (page.tsx:568-570 — rendered
 *        because canSubmitDecision is true at AUDIT_CONFIRMED, queue-utils.js:194)
 *        BEFORE any onsite evidence exists. That path
 *        (POST /api/provider/auditor/applications/:id/audit-decisions — provider-api.ts:19)
 *        runs writeApplicationStatus + the cert auto-mint hook inside ONE transaction
 *        (auditor-audit-decision-handler.js:251-283 → application-status-writer.js:968-985
 *        → certificate-service.generateCertificate), and generateCertificate calls the
 *        choke-point gate assertOnsiteEvidenceSufficient (certificate-service.js:311)
 *        which REFUSES with INSUFFICIENT_PHOTOS / INCOMPLETE_CHECKLIST
 *        (onsite-evidence-gate.js:93-109). Because the refusal happens inside the tx,
 *        the AUDIT_PASSED write must roll back. So the criteria here are: the request
 *        is NOT accepted, the row is STILL AUDIT_CONFIRMED, and NO certificate exists.
 *        (Known shape, recorded not asserted: the refusal surfaces to the auditor as a
 *        generic 500 "Failed to record audit decision" — handler catch at :359-365 —
 *        not as the gate's own code. That is a UX/observability FINDING for the
 *        segment note, not a flow failure.)
 *
 *        C12-pass: the auditor then walks the ONLY real inspection door — the ONSITE
 *        tab "เครื่องมือภาคสนาม" (page.tsx:432-436) → "เริ่มตรวจประเมินภาคสนาม"
 *        (data-testid="onsite-inspect-entry", page.tsx:521-527) → the field app:
 *        เริ่มตรวจ (GPS check-in POST /audit/onsite/:auditId/start, onsite.js:434 —
 *        which then fires the physical-presence check GET .../gps-verify, onsite.js:588
 *        via inspect/client-view.tsx:231-240) → อัปโหลดภาพหลักฐาน (POST .../photo,
 *        onsite.js:529; ChecklistItem file input at ChecklistItem.tsx:199-215) →
 *        ตอบแบบตรวจครบทุกข้อ (POST .../checklist, onsite.js:471) → ส่งผลการตรวจ PASS
 *        (POST .../decision, onsite.js:663 → audit-onsite-service.submitDecision, which
 *        re-runs the same gate at :838 before writing AUDIT_PASSED).
 *        Expected end state: status AUDIT_PASSED + a `certificates` row minted HERE
 *        (application-status-writer.js:968-985). Plan §III C12 + ruling D2 say the mint
 *        point is arguably wrong (should be at CERTIFIED) — Phase 0 RECORDS that, never
 *        fixes it.
 *
 * GATE CONSTANTS (read from the backend source, not invented): ≥5 photos
 * (audit-onsite-service.js:151 DEFAULT_MIN_PHOTOS) and every item of
 * CHECKLIST_TEMPLATE_2026 (audit-onsite-service.js:166-203, 24 items) must be
 * persisted. The spec answers whatever the UI renders (the inspect page renders the
 * template 1:1 — onsite.js:345-351), so if the template changes the spec still
 * answers all of it; if MIN photos changes the decision fails honestly with the
 * gate's own 422.
 *
 * CHECKLIST PERSISTENCE: inspect/client-view.tsx:148-169 flushes dirty answers on a
 * 30-SECOND INTERVAL only (no debounce, and submitDecision does not flush), and a
 * failed flush is swallowed (:163-165). So the spec answers, waits for the flush,
 * RELOADS the page and re-reads the answers from the server (savedAnswers seeding at
 * :117-127) — the reloaded screen is the server's truth, not the local state — and
 * re-answers whatever did not persist. That loop is bounded; it fails honestly.
 *
 * DEVICE STUB (declared, not hidden): the auditor's browser context is created with
 * Playwright's geolocation permission + a fixed fix. That stubs the DEVICE SENSOR the
 * same way the physical auditor's phone provides one; it bypasses no application
 * check — the app's own presence check (gps-verify) still runs and its verdict is
 * captured to evidence.
 *
 * Credentials come from the run command only (G-3): PHASE0_SEED_PW_OFFICER (seed
 * scheduler 3333333333333 + auditor 2222222222222) and PHASE0_FARMER_PW (the s01
 * farmer, for the applicant-side screen of C12). No secret is written to any file.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { login, dump, auditDump, psql, pngFixture, readVars, saveVars, EV } from './helpers';

const SEG = 's05';
const OUT = join(EV, SEG);
mkdirSync(OUT, { recursive: true });
const PNG = pngFixture(OUT);

/** Seed officer identities (Amendment B §Seed creds). Passwords come from env. */
const SCHEDULER_LOGIN_ID = '3333333333333';
const AUDITOR_LOGIN_ID = '2222222222222';

/** Gate constant, single-sourced from audit-onsite-service.js:151 (DEFAULT_MIN_PHOTOS). */
const MIN_PHOTOS = 5;

/**
 * Device GPS used when the application carries no farm coordinates. The onsite
 * service treats an unknown farm location as advisory only
 * (verifyGpsAgainstFarm → unknownFarmLocation, audit-onsite-service.js:355-366), so
 * this only has to be a valid fix; the real farm coords are preferred when present.
 */
const DEVICE_GPS_FALLBACK = { latitude: 18.7883, longitude: 98.9853 }; // เชียงใหม่ (s01 farm province)

const shot = (p: Page, name: string) => p.screenshot({ path: join(OUT, name), fullPage: true });
const rows = <T>(sql: string): T[] => JSON.parse(psql(sql)) as T[];
const one = <T>(sql: string): T | undefined => rows<T>(sql)[0];
const bkk = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
/** Every audit_logs row for this application (protocol §II: no row at all = FAIL). */
const auditRowCount = (app: string): number =>
  rows<{ id: string }>(`SELECT id FROM audit_logs WHERE "resourceId"='${app}';`).length;

interface AppRow {
  id: string;
  applicationNumber: string;
  status: string;
  auditorId: string | null;
  schedulerId: string | null;
}
interface CertRow {
  id: string;
  certificateNumber: string;
  status: string;
  applicationId: string;
}

/** One recorded API response (status only + which checklist item, never a body with a token). */
interface Hit {
  method: string;
  url: string;
  status: number;
  itemCode?: string | undefined;
}

/**
 * Provider login through the REAL login page (helpers.login), then wait for a real
 * authenticated landing — helpers.login's `**\/provider\/**` glob also matches the
 * login URL itself, so it returns before auth finishes (same caveat as s01/s03).
 * Returns the logged-in user's uuid from the login response (auth-provider.js:262-264);
 * the token is deliberately never read into a file (L2/G-3).
 */
async function providerLogin(p: Page, id: string, pw: string, tag: string): Promise<string> {
  const respP = p
    .waitForResponse(
      (r) => r.url().includes('/auth/provider/login') && r.request().method() === 'POST',
      { timeout: 90_000 },
    )
    .catch(() => null);
  await login(p, { kind: 'provider', id, pw });
  const r = await respP;
  const b = r ? await r.json().catch(() => null) : null;
  try {
    await p.waitForURL(/\/provider\/(dashboard|audits|scheduler|applications|work|coordinator)/, {
      timeout: 120_000,
    });
  } catch {
    await shot(p, `${tag}-login-stuck.png`);
    throw new Error(`${tag}: provider login did not reach a /provider landing — see ${tag}-login-stuck.png`);
  }
  await p.waitForLoadState('domcontentloaded');
  const userId = String(b?.data?.user?.id || '');
  writeFileSync(
    join(OUT, `${tag}-login.txt`),
    `${bkk()}\nlogin status ${r ? r.status() : 'none'} success=${b?.success} tokenPresent=${Boolean(
      b?.data?.tokens?.accessToken || b?.data?.token,
    )}\nuserId: ${userId}\n`,
  );
  return userId;
}

test.describe.serial('Phase0 S5 — C11 assign onsite audit → C12 PASS behind the onsite-evidence gate', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // C11 — SCHEDULER assigns the AUDITOR: AUDIT_FEE_PAID → AUDIT_CONFIRMED
  // ═══════════════════════════════════════════════════════════════════════════
  test('C11 scheduler assigns auditor from the queue → AUDIT_CONFIRMED + auditSchedule', async ({ browser }) => {
    const V = readVars();
    const APP = String(V.FARMER_MAIN_APP ?? '');
    const OFFICER_PW = process.env.PHASE0_SEED_PW_OFFICER || '';
    expect(APP, 'FARMER_MAIN_APP present in VARS (written by s01)').toBeTruthy();
    expect(OFFICER_PW, 'PHASE0_SEED_PW_OFFICER set in the run command (never committed — G-3)').toBeTruthy();

    dump(SEG, 'C11', 'before', APP);
    const before = one<AppRow>(
      `SELECT id, "applicationNumber", status, "auditorId", "schedulerId" FROM applications WHERE id='${APP}';`,
    );
    const auditRowsBefore = auditRowCount(APP);
    writeFileSync(join(OUT, 'C11-precondition.txt'), `${bkk()}\n${JSON.stringify(before, null, 2)}\n`);
    // Hard precondition: assignAuditor refuses anything that is not AUDIT_FEE_PAID
    // (audit-scheduling-service.js:449-455). If the upstream segment did not land the
    // งวด-2 settle, this segment cannot start and says so instead of forcing anything.
    expect(before?.status, 'C11 precondition — the row sits at AUDIT_FEE_PAID (output of the งวด-2 settle segment)').toBe(
      'AUDIT_FEE_PAID',
    );
    const APP_NO = String(before?.applicationNumber || '');
    expect(APP_NO, 'applicationNumber readable (the queue row is found by this number)').toBeTruthy();

    // ── auditor session first: its uuid is what the assign dropdown is keyed by ──
    // (AssignAuditorModal.tsx:383-387 renders <option value={user.id}>; the 13-digit
    // providerId never reaches the DOM, so the honest way to pick THE auditor the
    // mission names is to log in as them and use the id their own session reports.)
    const audCtx = await browser.newContext({ recordVideo: { dir: join(OUT, 'video-auditor-c11') } });
    const aud = await audCtx.newPage();
    const AUDITOR_USER_ID = await providerLogin(aud, AUDITOR_LOGIN_ID, OFFICER_PW, 'C11-auditor');
    expect(AUDITOR_USER_ID, 'auditor session reports its own user id').toBeTruthy();
    saveVars('AUDITOR_USER_ID', AUDITOR_USER_ID);

    // ── scheduler session ──
    const schCtx = await browser.newContext({ recordVideo: { dir: join(OUT, 'video-scheduler-c11') } });
    const sch = await schCtx.newPage();
    const SCHEDULER_USER_ID = await providerLogin(sch, SCHEDULER_LOGIN_ID, OFFICER_PW, 'C11-scheduler');

    const queueResp = sch
      .waitForResponse(
        (r) => r.url().includes('/audit/scheduling/queue') && r.request().method() === 'GET',
        { timeout: 120_000 },
      )
      .catch(() => null);
    await sch.goto('/provider/scheduler/queue', { timeout: 200_000 });
    await sch.waitForLoadState('domcontentloaded');
    const qr = await queueResp;
    const qBody = qr ? (await qr.text().catch(() => '')).slice(0, 1500) : '';
    writeFileSync(
      join(OUT, 'C11-queue-response.txt'),
      `${bkk()}\nGET /audit/scheduling/queue (default filter AUDIT_FEE_PAID — client-view.tsx:78-80)\n` +
        `status ${qr ? qr.status() : 'none'}\n${qBody}\n`,
    );
    await sch.waitForTimeout(2000);
    await shot(sch, 'C11-01-scheduler-queue.png');

    // The queue row for THIS application (DataTable renders a real <tr> — DataTable.tsx:97,162).
    const row = sch.getByRole('row').filter({ hasText: APP_NO });
    await expect(
      row,
      `the scheduler queue lists ${APP_NO} (if not: the app is not AUDIT_FEE_PAID for this org — see C11-queue-response.txt)`,
    ).toHaveCount(1, { timeout: 60_000 });
    await row.getByRole('button', { name: 'จัดตาราง' }).click();

    const auditorSelect = sch.locator('#assign-auditor');
    await expect(auditorSelect, 'AssignAuditorModal opened (AssignAuditorModal.tsx:371-388)').toBeVisible({
      timeout: 60_000,
    });
    // Auditor directory load (GET /provider/scheduler/auditors — audit-service.ts:239).
    await sch.waitForTimeout(3000);
    const options = await auditorSelect.locator('option').evaluateAll((els) =>
      els.map((e) => ({ value: (e as HTMLOptionElement).value, label: (e.textContent || '').trim() })),
    );
    writeFileSync(join(OUT, 'C11-auditor-options.txt'), `${bkk()}\n${JSON.stringify(options, null, 2)}\n`);
    expect(
      options.some((o) => o.value === AUDITOR_USER_ID),
      `the assign dropdown offers the mission's auditor (${AUDITOR_LOGIN_ID}) — see C11-auditor-options.txt`,
    ).toBe(true);
    await auditorSelect.selectOption(AUDITOR_USER_ID);

    // Location is mandatory client-side (AssignAuditorModal.tsx:207-210); it is prefilled
    // from the queue row's farmAddress and only filled in when the queue carried none.
    const locationInput = sch.locator('#assign-location');
    const prefilledLocation = (await locationInput.inputValue()).trim();
    if (!prefilledLocation) {
      await locationInput.fill('ตรวจ ณ แปลงปลูกตามที่อยู่ในคำขอ (Phase 0 C11)');
    }
    await sch.locator('#assign-notes').fill('Phase 0 C11 — นัดตรวจประเมินภาคสนาม');
    await shot(sch, 'C11-02-assign-modal.png');

    // Submit. The service refuses weekends/Thai public holidays (NON_WORKING_DAY,
    // audit-scheduling-service.js:401-407) and a full auditor day (AUDITOR_BUSY /
    // AUDITOR_OVER_CAP), and the modal stays open on failure (AssignAuditorModal.tsx:232-238)
    // — so a rejection is answered the way a scheduler answers it: pick the next day in
    // the SAME date field and press again. Bounded; every attempt is recorded.
    const attempts: string[] = [];
    let assigned = false;
    for (let i = 0; i < 6 && !assigned; i++) {
      const dateValue = await sch.locator('#assign-date').inputValue();
      const respP = sch
        .waitForResponse(
          (r) => r.url().includes('/audit/scheduling/assign') && r.request().method() === 'POST',
          { timeout: 120_000 },
        )
        .catch(() => null);
      await sch.getByRole('button', { name: /ยืนยันจัดตาราง/ }).click();
      const r = await respP;
      const body = r ? (await r.text().catch(() => '')).slice(0, 800) : '';
      attempts.push(`attempt ${i + 1} · scheduledDate=${dateValue} → status ${r ? r.status() : 'none'}\n${body}`);
      assigned = Boolean(r && r.status() === 201);
      if (!assigned) {
        const next = new Date(`${dateValue}T00:00:00`);
        next.setDate(next.getDate() + 1);
        const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(
          next.getDate(),
        ).padStart(2, '0')}`;
        await sch.locator('#assign-date').fill(iso);
        await sch.waitForTimeout(2000);
      }
    }
    writeFileSync(
      join(OUT, 'C11-assign-response.txt'),
      `${bkk()}\nPOST /api/audit/scheduling/assign (scheduling.js:89-104)\n${attempts.join('\n\n')}\n`,
    );
    await shot(sch, 'C11-03-after-assign.png');
    expect(assigned, 'the assign call was accepted (201) — see C11-assign-response.txt for every attempt').toBe(true);

    // ── C11 checkpoint: DB + audit row + screens ──
    await sch.waitForTimeout(3000);
    dump(SEG, 'C11', 'after', APP);
    auditDump(SEG, 'C11', APP);
    const after = one<AppRow>(
      `SELECT id, "applicationNumber", status, "auditorId", "schedulerId" FROM applications WHERE id='${APP}';`,
    );
    const schedule = one<{ audit_schedule: Record<string, unknown> | null }>(
      `SELECT id, "formData"->'auditSchedule' AS audit_schedule FROM applications WHERE id='${APP}';`,
    );
    const auditRowsAfter = auditRowCount(APP);
    writeFileSync(
      join(OUT, 'C11-audit-schedule.txt'),
      `${bkk()}\nrow after assign:\n${JSON.stringify(after, null, 2)}\n\n` +
        `formData.auditSchedule (audit-scheduling-service.js:511-522):\n${JSON.stringify(
          schedule?.audit_schedule,
          null,
          2,
        )}\n\naudit_logs rows for this application: ${auditRowsBefore} → ${auditRowsAfter}\n` +
        `scheduler userId: ${SCHEDULER_USER_ID}\nauditor userId: ${AUDITOR_USER_ID}\n`,
    );

    expect(after?.status, 'C11 status = AUDIT_CONFIRMED').toBe('AUDIT_CONFIRMED');
    expect(after?.auditorId, 'auditorId column = the auditor that was picked in the modal').toBe(AUDITOR_USER_ID);
    const sched = (schedule?.audit_schedule || null) as Record<string, unknown> | null;
    expect(sched, 'formData.auditSchedule written (there is no separate appointment table)').toBeTruthy();
    expect(String(sched?.inspectionMode || ''), 'the appointment is ONSITE (default when the modal sends no mode)').toBe(
      'ONSITE',
    );
    expect(String(sched?.scheduledDate || ''), 'auditSchedule carries the appointment date').toBeTruthy();
    expect(
      auditRowsAfter,
      'at least one audit_logs row was written for this hop (protocol §II — no row at all = FAIL; ' +
        'plan §III marks C11 “observe”, so the KIND of row is recorded in C11-audit.txt, not asserted)',
    ).toBeGreaterThan(auditRowsBefore);

    // Screen of the role that acted: the queue after the assign (the row leaves the
    // AUDIT_FEE_PAID filter — client-view.tsx:121-125).
    await sch.reload({ timeout: 200_000 });
    await sch.waitForLoadState('domcontentloaded');
    await sch.waitForTimeout(4000);
    await shot(sch, 'C11-04-queue-after.png');

    // Screen of the role that should see the result: the auditor's own queue (plan 11.2).
    await aud.goto('/provider/audits', { timeout: 200_000 });
    await aud.waitForLoadState('domcontentloaded');
    await aud.waitForTimeout(5000);
    await shot(aud, 'C11-05-auditor-queue.png');
    const visibleToAuditor = await aud
      .getByText(APP_NO, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    writeFileSync(
      join(OUT, 'C11-summary.txt'),
      `${bkk()}\nC11 AUDIT_FEE_PAID → AUDIT_CONFIRMED\n` +
        `pressed: /provider/scheduler/queue → "จัดตาราง" → AssignAuditorModal → "ยืนยันจัดตาราง"\n` +
        `application: ${APP} (${APP_NO})\nauditor: ${AUDITOR_USER_ID} (login ${AUDITOR_LOGIN_ID})\n` +
        `applicationNumber visible on /provider/audits for that auditor: ${visibleToAuditor} (recorded, not asserted — ` +
        'the authoritative proof is the auditorId column + the job sheet the auditor can open in C12)\n',
    );

    await audCtx.close();
    await schCtx.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C12 — fail-closed gate proof, then the real onsite walk → AUDIT_PASSED + cert
  // ═══════════════════════════════════════════════════════════════════════════
  test('C12 premature PASS is refused, then onsite evidence → PASS → AUDIT_PASSED + certificate', async ({
    browser,
  }) => {
    const V = readVars();
    const APP = String(V.FARMER_MAIN_APP ?? '');
    const FARMER_ID = String(V.FARMER_MAIN_ID ?? '');
    const OFFICER_PW = process.env.PHASE0_SEED_PW_OFFICER || '';
    const FARMER_PW = process.env.PHASE0_FARMER_PW || '';
    expect(APP, 'FARMER_MAIN_APP present in VARS').toBeTruthy();
    expect(OFFICER_PW, 'PHASE0_SEED_PW_OFFICER set in the run command (G-3)').toBeTruthy();
    expect(FARMER_PW, 'PHASE0_FARMER_PW set in the run command (G-3) — the applicant screen is part of §II').toBeTruthy();

    dump(SEG, 'C12', 'before', APP);
    const before = one<AppRow>(
      `SELECT id, "applicationNumber", status, "auditorId", "schedulerId" FROM applications WHERE id='${APP}';`,
    );
    const certsBefore = rows<CertRow>(
      `SELECT id, "certificateNumber", status, "applicationId" FROM certificates WHERE "applicationId"='${APP}';`,
    );
    const auditRowsBefore = auditRowCount(APP);
    writeFileSync(
      join(OUT, 'C12-precondition.txt'),
      `${bkk()}\n${JSON.stringify(before, null, 2)}\ncertificates already on this application: ` +
        `${certsBefore.length}\n${JSON.stringify(certsBefore, null, 2)}\n`,
    );
    expect(before?.status, 'C12 precondition — the row sits at AUDIT_CONFIRMED (C11 output)').toBe('AUDIT_CONFIRMED');
    expect(
      certsBefore.length,
      'C12 precondition — no certificate exists yet, so the gate proof below is meaningful',
    ).toBe(0);

    // Farm coordinates from the application itself when it has them; the device fix is
    // otherwise the declared fallback (see header — DEVICE STUB).
    const loc = one<{ location_data: Record<string, unknown> | null }>(
      `SELECT id, "formData"->'locationData' AS location_data FROM applications WHERE id='${APP}';`,
    );
    const farmLat = typeof loc?.location_data?.latitude === 'number' ? (loc.location_data.latitude as number) : null;
    const farmLng = typeof loc?.location_data?.longitude === 'number' ? (loc.location_data.longitude as number) : null;
    const fix = {
      latitude: farmLat ?? DEVICE_GPS_FALLBACK.latitude,
      longitude: farmLng ?? DEVICE_GPS_FALLBACK.longitude,
    };
    writeFileSync(
      join(OUT, 'C12-device-gps.txt'),
      `${bkk()}\nformData.locationData: ${JSON.stringify(loc?.location_data)}\n` +
        `device fix handed to the browser context: ${JSON.stringify(fix)} ` +
        `(source: ${farmLat !== null && farmLng !== null ? 'application farm coordinates' : 'declared fallback'})\n`,
    );

    const audCtx = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: fix,
      recordVideo: { dir: join(OUT, 'video-auditor-c12') },
    });
    const aud = await audCtx.newPage();

    // Record every onsite/decision API response this session makes (status only —
    // never a body that could carry a credential).
    const hits: Hit[] = [];
    aud.on('response', (r) => {
      const u = r.url();
      if (!/\/api\/audit\/onsite\/|\/audit-decisions$/.test(u)) return;
      const hit: Hit = { method: r.request().method(), url: u.replace(/^https?:\/\/[^/]+/, ''), status: r.status() };
      if (/\/checklist$/.test(u) && hit.method === 'POST') {
        try {
          const parsed = JSON.parse(r.request().postData() || '{}') as { items?: Array<{ itemCode?: string }> };
          hit.itemCode = parsed.items?.[0]?.itemCode;
        } catch {
          hit.itemCode = undefined;
        }
      }
      hits.push(hit);
    });

    await providerLogin(aud, AUDITOR_LOGIN_ID, OFFICER_PW, 'C12-auditor');

    // ───────────────────────────────────────────────────────────────────────
    // C12-gate — press PASS with ZERO onsite evidence. MUST be refused.
    // ───────────────────────────────────────────────────────────────────────
    await aud.goto(`/provider/audits/${APP}`, { timeout: 200_000 });
    await aud.waitForLoadState('domcontentloaded');
    await aud.waitForTimeout(6000); // job sheet + auditor dashboard fetches (page.tsx:60-116)
    await shot(aud, 'C12-01-job-sheet.png');

    const passBtn = aud.getByRole('button', { name: /ผ่าน \(PASS\)/ });
    await expect(
      passBtn,
      'the job sheet offers "ผ่าน (PASS)" at AUDIT_CONFIRMED (page.tsx:566-570, queue-utils.js:194). ' +
        'If this is missing the gate cannot be probed through the UI — that itself is a FINDING; ' +
        'see C12-01-job-sheet.png',
    ).toBeVisible({ timeout: 60_000 });
    await passBtn.click();

    const notesBox = aud.getByPlaceholder('ระบุรายละเอียดผลการตัดสิน');
    await expect(notesBox, 'decision modal opened (audit-decision-modal.tsx:146-156)').toBeVisible({ timeout: 30_000 });
    await notesBox.fill('Phase 0 C12 — กด PASS ก่อนมีหลักฐานลงพื้นที่ เพื่อพิสูจน์ประตู fail-closed');
    await shot(aud, 'C12-02-premature-pass-modal.png');

    const gateResp = aud
      .waitForResponse((r) => r.url().includes('/audit-decisions') && r.request().method() === 'POST', {
        timeout: 120_000,
      })
      .catch(() => null);
    await aud.getByRole('button', { name: /ยืนยัน PASS/ }).click();
    const gr = await gateResp;
    const gBody = gr ? (await gr.text().catch(() => '')).slice(0, 1200) : '';
    await aud.waitForTimeout(3000);
    await shot(aud, 'C12-03-premature-pass-refused.png');

    const midStatus = one<AppRow>(`SELECT id, "applicationNumber", status, "auditorId", "schedulerId" FROM applications WHERE id='${APP}';`);
    const midCerts = rows<CertRow>(
      `SELECT id, "certificateNumber", status, "applicationId" FROM certificates WHERE "applicationId"='${APP}';`,
    );
    auditDump(SEG, 'C12-gate', APP);
    writeFileSync(
      join(OUT, 'C12-gate-premature-pass.txt'),
      `${bkk()}\nPRESSED: /provider/audits/${APP} → "ผ่าน (PASS)" → "ยืนยัน PASS" with NO onsite evidence recorded\n` +
        `POST /api/provider/auditor/applications/${APP}/audit-decisions → status ${gr ? gr.status() : 'none'}\n` +
        `${gBody}\n\n` +
        `application status after the refusal: ${midStatus?.status}\n` +
        `certificates after the refusal: ${midCerts.length}\n\n` +
        'expected mechanism: auditor-audit-decision-handler.js:251-283 runs the status write + the cert ' +
        'auto-mint hook in ONE tx; certificate-service.js:311 calls assertOnsiteEvidenceSufficient which ' +
        'refuses (onsite-evidence-gate.js:93-109 — INSUFFICIENT_PHOTOS/INCOMPLETE_CHECKLIST), so the whole ' +
        'tx rolls back. NOTE for the segment note.md: the auditor sees a generic 500 ' +
        '"Failed to record audit decision" (handler catch :359-365), not the gate code — observability FINDING.\n',
    );

    expect(
      Boolean(gr && gr.status() === 200),
      'FAIL-CLOSED: a PASS with no onsite evidence must NOT be accepted (this is the cert-integrity gate)',
    ).toBe(false);
    expect(midStatus?.status, 'FAIL-CLOSED: the refused PASS rolled back — the row is still AUDIT_CONFIRMED').toBe(
      'AUDIT_CONFIRMED',
    );
    expect(midCerts.length, 'FAIL-CLOSED: no certificate was minted by the refused PASS').toBe(0);

    // Drop the decision modal (component state only) by reloading the job sheet, so the
    // tab strip is reachable again without guessing at overlay selectors.
    await aud.reload({ timeout: 200_000 });
    await aud.waitForLoadState('domcontentloaded');
    await aud.waitForTimeout(6000); // job sheet + auditor dashboard fetches again

    // ───────────────────────────────────────────────────────────────────────
    // C12-pass — the real onsite door: ONSITE tab → inspect flow
    // ───────────────────────────────────────────────────────────────────────
    const onsiteTab = aud.getByRole('tab', { name: /เครื่องมือภาคสนาม|Field Tools/ });
    await expect(
      onsiteTab,
      'the ONSITE tab is present, i.e. the appointment really is inspectionMode ONSITE (page.tsx:432-436)',
    ).toBeVisible({ timeout: 60_000 });
    await onsiteTab.click();
    const inspectEntry = aud.getByTestId('onsite-inspect-entry');
    await expect(inspectEntry, 'the single onsite entry point (page.tsx:521-527)').toBeVisible({ timeout: 30_000 });
    await shot(aud, 'C12-04-onsite-tab.png');

    const contextResp = aud
      .waitForResponse((r) => /\/audit\/onsite\/application\/.+\/context/.test(r.url()), { timeout: 120_000 })
      .catch(() => null);
    await inspectEntry.click();
    await aud.waitForURL(/\/provider\/audits\/.+\/inspect/, { timeout: 200_000 });
    await aud.waitForLoadState('domcontentloaded');
    const cr = await contextResp;
    writeFileSync(
      join(OUT, 'C12-onsite-context.txt'),
      `${bkk()}\nGET /api/audit/onsite/application/${APP}/context (onsite.js:296) → status ${cr ? cr.status() : 'none'}\n` +
        '(404 AUDIT_NOT_FOUND here would mean the scheduler assign did not create the AuditChecklist row — ' +
        'audit-scheduling-service.js:565-583)\n',
    );

    // REWRITTEN after the first real walk reached this screen (2026-08-19):
    // the code-derived expectation "the field app opens on its start screen"
    // is FALSE on the running stack. GET /context reports
    // startedAt = AuditChecklist.createdAt (onsite.js:352) and that row is
    // born at scheduler-assign (audit-scheduling-service.js:565-583), so
    // inspect/client-view.tsx:128 (`setStage(startedAt ? 'checklist' : 'start')`)
    // resumes EVERY freshly assigned audit at the checklist. The "เริ่มตรวจ"
    // GPS check-in (POST /start → startInspection) and the physical-presence
    // advisory (GET /gps-verify) are unreachable from the UI — FINDING
    // F-ONSITE-GPS-CHECKIN-UNREACHABLE, recorded below. Both doors are probed
    // so this spec stays honest if the app later makes the check-in mandatory.
    const startBtn = aud.getByRole('button', { name: /^เริ่มตรวจ$|กำลังอ่านพิกัด/ });
    const checklistFirst = aud.locator('article[data-checklist-id]').first();
    await expect(
      startBtn.or(checklistFirst),
      'the field app opened on either its start screen or the checklist stage',
    ).toBeVisible({ timeout: 90_000 });
    const startScreenShown = await startBtn.isVisible().catch(() => false);
    await shot(aud, 'C12-05-inspect-entry-stage.png');
    if (startScreenShown) {
      const startResp = aud
        .waitForResponse((r) => /\/audit\/onsite\/.+\/start$/.test(r.url()) && r.request().method() === 'POST', {
          timeout: 120_000,
        })
        .catch(() => null);
      const gpsVerifyResp = aud
        .waitForResponse((r) => /\/audit\/onsite\/.+\/gps-verify/.test(r.url()), { timeout: 120_000 })
        .catch(() => null);
      await startBtn.click();
      const sr = await startResp;
      const sBody = sr ? (await sr.text().catch(() => '')).slice(0, 600) : '';
      const gv = await gpsVerifyResp;
      const gvBody = gv ? (await gv.text().catch(() => '')).slice(0, 600) : '';
      writeFileSync(
        join(OUT, 'C12-start-and-gps-verify.txt'),
        `${bkk()}\nstart screen SHOWN — POST .../start (onsite.js:434) → status ${sr ? sr.status() : 'none'}\n${sBody}\n\n` +
          `GET .../gps-verify (onsite.js:588 — physical-presence check, advisory by design) → ` +
          `status ${gv ? gv.status() : 'none'}\n${gvBody}\n`,
      );
      expect(
        Boolean(sr && sr.status() === 200),
        'the inspection opened with a GPS check-in — see C12-start-and-gps-verify.txt',
      ).toBe(true);
    } else {
      writeFileSync(
        join(OUT, 'C12-start-and-gps-verify.txt'),
        `${bkk()}\nFINDING F-ONSITE-GPS-CHECKIN-UNREACHABLE — the field app NEVER showed the start screen.\n` +
          `mechanism: GET /context startedAt = AuditChecklist.createdAt (onsite.js:352); that row is created by\n` +
          `the scheduler assign itself (audit-scheduling-service.js:565-583), so client-view.tsx:128 resumes at\n` +
          `'checklist' for every assigned audit. POST /start (startInspection — the GPS check-in write) and\n` +
          `GET /gps-verify (the physical-presence advisory) are therefore UNREACHABLE from the UI: an onsite\n` +
          `inspection can be completed with NO recorded check-in coordinate. Recorded, not fixed — the fix is\n` +
          `a product decision (a real "started" marker vs createdAt) outside this verification run.\n` +
          `screen: C12-05-inspect-entry-stage.png (checklist stage, ${await aud.locator('article[data-checklist-id]').count()} items rendered)\n`,
      );
    }

    const articles = aud.locator('article[data-checklist-id]');
    await expect(articles.first(), 'the checklist screen rendered (ChecklistItem.tsx:102-105)').toBeVisible({
      timeout: 60_000,
    });
    const itemCount = await articles.count();
    expect(itemCount, 'the inspect page renders the canonical checklist template (onsite.js:345-351)').toBeGreaterThan(0);
    await shot(aud, 'C12-06-checklist-empty.png');

    // ── evidence photos: MIN_PHOTOS real uploads through the item file inputs ──
    const photoResults: string[] = [];
    let photosAccepted = 0;
    for (let i = 0; i < MIN_PHOTOS; i++) {
      const art = articles.nth(i % itemCount);
      const itemId = (await art.getAttribute('data-checklist-id')) || `#${i}`;
      const photoResp = aud
        .waitForResponse((r) => /\/audit\/onsite\/.+\/photo$/.test(r.url()) && r.request().method() === 'POST', {
          timeout: 120_000,
        })
        .catch(() => null);
      await art.locator('input[type="file"]').setInputFiles(PNG);
      const pr = await photoResp;
      const pBody = pr ? (await pr.text().catch(() => '')).slice(0, 400) : '';
      if (pr && pr.status() === 200) photosAccepted += 1;
      photoResults.push(`photo ${i + 1} → item ${itemId} → status ${pr ? pr.status() : 'none'} ${pBody}`);
      await aud.waitForTimeout(1500);
    }
    writeFileSync(
      join(OUT, 'C12-photos.txt'),
      `${bkk()}\nPOST /api/audit/onsite/:auditId/photo (onsite.js:529) ×${MIN_PHOTOS}\n` +
        `gate minimum = ${MIN_PHOTOS} (audit-onsite-service.js:151 DEFAULT_MIN_PHOTOS)\n` +
        `accepted: ${photosAccepted}/${MIN_PHOTOS}\n${photoResults.join('\n')}\n`,
    );
    expect(photosAccepted, `all ${MIN_PHOTOS} evidence photos were accepted — see C12-photos.txt`).toBe(MIN_PHOTOS);
    await shot(aud, 'C12-07-photos-attached.png');

    // ── checklist answers, verified against the SERVER by reloading ──
    const answerUnanswered = async (): Promise<number> => {
      const n = await articles.count();
      let clicked = 0;
      for (let i = 0; i < n; i++) {
        const art = articles.nth(i);
        const already = await art.locator('button[role="radio"][aria-checked="true"]').count();
        if (already > 0) continue;
        // "ใช่" = YES → PASS (ChecklistItem.tsx:55-63; audit-service.ts:119-123). exact:true
        // because "ไม่ใช่" contains "ใช่".
        await art.getByRole('radio', { name: 'ใช่', exact: true }).click();
        clicked += 1;
      }
      return clicked;
    };
    const countAnswered = async (): Promise<number> => {
      const n = await articles.count();
      let done = 0;
      for (let i = 0; i < n; i++) {
        if ((await articles.nth(i).locator('button[role="radio"][aria-checked="true"]').count()) > 0) done += 1;
      }
      return done;
    };

    const roundLog: string[] = [];
    let persisted = 0;
    for (let round = 1; round <= 3 && persisted < itemCount; round++) {
      const clicked = await answerUnanswered();
      if (round === 1) await shot(aud, 'C12-08-checklist-answered.png');
      // The page only flushes on its 30s interval (inspect/client-view.tsx:148-169), so
      // wait for the flush POSTs rather than assuming; bounded at 80s per round.
      const deadline = Date.now() + 80_000;
      const okCodes = () => new Set(hits.filter((h) => h.itemCode && h.status === 200).map((h) => h.itemCode));
      while (Date.now() < deadline && okCodes().size < itemCount) {
        await aud.waitForTimeout(3000);
      }
      const flushed = okCodes().size;
      // Reload: the reloaded screen is seeded from the server's savedAnswers
      // (inspect/client-view.tsx:117-127), so what survives a reload IS persisted.
      await aud.reload({ timeout: 200_000 });
      await aud.waitForLoadState('domcontentloaded');
      // With no persisted start marker (GpsVerificationLog unprovisioned — see
      // _resolveStartedAt / F-ONSITE-STARTEDAT-LIES), a reload honestly lands
      // back on the start screen; press เริ่มตรวจ again and the checklist
      // re-seeds from the server's savedAnswers — which is exactly the
      // persistence proof this reload exists to make.
      const startAgain = aud.getByRole('button', { name: /^เริ่มตรวจ$|กำลังอ่านพิกัด/ });
      await expect(
        startAgain.or(articles.first()),
        'start screen or checklist back after reload',
      ).toBeVisible({ timeout: 120_000 });
      if (await startAgain.isVisible().catch(() => false)) {
        await startAgain.click();
      }
      await expect(articles.first(), 'checklist screen back after reload').toBeVisible({ timeout: 120_000 });
      await aud.waitForTimeout(3000);
      persisted = await countAnswered();
      roundLog.push(
        `round ${round}: clicked ${clicked} · checklist POSTs accepted so far ${flushed}/${itemCount} · ` +
          `answers surviving reload ${persisted}/${itemCount}`,
      );
    }
    writeFileSync(
      join(OUT, 'C12-checklist.txt'),
      `${bkk()}\nPOST /api/audit/onsite/:auditId/checklist (onsite.js:471) — the field app flushes dirty answers ` +
        'on a 30s interval only and swallows flush failures (inspect/client-view.tsx:148-169), so each round ' +
        're-answers whatever did not survive a reload.\n' +
        `${roundLog.join('\n')}\n\nall recorded onsite API responses:\n${JSON.stringify(hits, null, 2)}\n`,
    );
    await shot(aud, 'C12-09-checklist-persisted.png');
    expect(
      persisted,
      `every checklist item persisted server-side (${persisted}/${itemCount}) — the gate requires the full ` +
        'template (onsite-evidence-gate.js:102-109); see C12-checklist.txt',
    ).toBe(itemCount);

    // ── review → decision PASS ──
    await aud.getByRole('button', { name: /ทบทวนผลการตรวจ/ }).click();
    await expect(aud.getByRole('button', { name: /ไปที่หน้าตัดสินผล/ }), 'review screen (inspect/client-view.tsx:907-913)').toBeVisible({
      timeout: 60_000,
    });
    await shot(aud, 'C12-10-review.png');
    await aud.getByRole('button', { name: /ไปที่หน้าตัดสินผล/ }).click();

    const passOption = aud.getByRole('button', { name: 'ผ่าน', exact: true });
    await expect(passOption, 'decision screen (inspect/client-view.tsx:978-1012)').toBeVisible({ timeout: 60_000 });
    await passOption.click();
    await aud.getByPlaceholder('สรุปผลการตรวจประเมินภาคสนาม').fill(
      'Phase 0 C12 — ตรวจประเมินภาคสนามครบทุกข้อ มีภาพหลักฐานและบันทึกพิกัดครบ ผลการตรวจผ่าน',
    );
    await shot(aud, 'C12-11-decision.png');

    const decisionResp = aud
      .waitForResponse((r) => /\/audit\/onsite\/.+\/decision$/.test(r.url()) && r.request().method() === 'POST', {
        timeout: 180_000,
      })
      .catch(() => null);
    await aud.getByRole('button', { name: /ส่งผลการตรวจ/ }).click();
    const dr = await decisionResp;
    const dBody = dr ? (await dr.text().catch(() => '')).slice(0, 1200) : '';
    writeFileSync(
      join(OUT, 'C12-decision-response.txt'),
      `${bkk()}\nPOST /api/audit/onsite/:auditId/decision {decision: PASS} (onsite.js:663)\n` +
        `status ${dr ? dr.status() : 'none'}\n${dBody}\n\n` +
        '422 INSUFFICIENT_PHOTOS / INCOMPLETE_CHECKLIST here would mean the evidence above did not reach ' +
        'the gate (audit-onsite-service.js:838).\n',
    );
    await aud.waitForTimeout(4000);
    await shot(aud, 'C12-12-decision-submitted.png');
    expect(Boolean(dr && dr.status() === 200), 'the PASS was accepted once real onsite evidence existed').toBe(true);
    await expect(
      aud.getByTestId('done-screen-back-to-queue'),
      'the field app reached its done screen (inspect/client-view.tsx:1109-1115)',
    ).toBeVisible({ timeout: 60_000 });

    // ── C12 checkpoint: DB + audit + certificate ──
    let finalStatus = '';
    for (let i = 0; i < 10 && finalStatus !== 'AUDIT_PASSED'; i++) {
      finalStatus = one<{ status: string }>(`SELECT status FROM applications WHERE id='${APP}';`)?.status ?? '';
      if (finalStatus !== 'AUDIT_PASSED') await aud.waitForTimeout(3000);
    }
    let certs: CertRow[] = [];
    for (let i = 0; i < 10 && certs.length === 0; i++) {
      certs = rows<CertRow>(
        `SELECT id, "certificateNumber", status, "applicationId" FROM certificates WHERE "applicationId"='${APP}';`,
      );
      if (certs.length === 0) await aud.waitForTimeout(3000);
    }
    dump(SEG, 'C12', 'after', APP);
    auditDump(SEG, 'C12', APP);
    const auditRowsAfter = auditRowCount(APP);
    writeFileSync(
      join(OUT, 'C12-certificate.txt'),
      `${bkk()}\nstatus after PASS: ${finalStatus}\n` +
        `audit_logs rows for this application: ${auditRowsBefore} → ${auditRowsAfter}\n` +
        `certificates rows (${certs.length}):\n${JSON.stringify(certs, null, 2)}\n\n` +
        'RECORDED, NOT FIXED (plan §III C12 + ruling D2 / the gap map): the certificate is minted at ' +
        'AUDIT_PASSED by the writer hook (application-status-writer.js:968-985), i.e. BEFORE the ' +
        'APPROVED/CERTIFIED hops. Phase 0 only documents this; the fix is a separate ticket.\n',
    );
    expect(finalStatus, 'C12 status = AUDIT_PASSED').toBe('AUDIT_PASSED');
    expect(
      auditRowsAfter,
      'audit rows were written for this hop (protocol §II — none at all = FAIL)',
    ).toBeGreaterThan(auditRowsBefore);
    expect(certs.length, 'a certificate row exists after the PASS (current code mints here — ruling D2 notes it is the wrong place)').toBeGreaterThanOrEqual(1);
    const certNumber = String(certs[0]?.certificateNumber || '');
    if (certNumber) saveVars('CERT_NUMBER', certNumber);

    // Screen of the role that should see the result (protocol §II): the applicant.
    const farmCtx = await browser.newContext({ recordVideo: { dir: join(OUT, 'video-farmer-c12') } });
    const farmer = await farmCtx.newPage();
    await login(farmer, { kind: 'health', id: FARMER_ID, pw: FARMER_PW });
    await farmer.waitForURL(/\/health\/(dashboard|payments|applications|onboarding|start|profile)/, {
      timeout: 120_000,
    });
    await farmer.goto('/health/applications', { timeout: 200_000 });
    await farmer.waitForLoadState('domcontentloaded');
    await farmer.waitForTimeout(5000);
    await shot(farmer, 'C12-13-farmer-applications.png');
    await farmer.goto('/health/certificates', { timeout: 200_000 }).catch(() => null);
    await farmer.waitForLoadState('domcontentloaded').catch(() => null);
    await farmer.waitForTimeout(4000);
    await shot(farmer, 'C12-14-farmer-certificates.png');

    writeFileSync(
      join(OUT, 'C12-summary.txt'),
      `${bkk()}\nC12 AUDIT_CONFIRMED → AUDIT_PASSED\n` +
        `part 1 (fail-closed proof): "ผ่าน (PASS)" pressed on /provider/audits/${APP} with no evidence → ` +
        `HTTP ${gr ? gr.status() : 'none'}, row stayed AUDIT_CONFIRMED, 0 certificates\n` +
        `part 2 (real walk): ONSITE tab → inspect → เริ่มตรวจ (GPS) → ${MIN_PHOTOS} photos → ` +
        `${itemCount}/${itemCount} checklist items persisted → PASS → HTTP ${dr ? dr.status() : 'none'}\n` +
        `end state: ${finalStatus} · certificates ${certs.length} (${certNumber})\n` +
        'applicant screens captured: C12-13-farmer-applications.png, C12-14-farmer-certificates.png ' +
        '(captured, not asserted — C15 is a later segment)\n',
    );

    await farmCtx.close();
    await audCtx.close();
  });
});
