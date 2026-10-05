/**
 * PHASE 0 — S2 — C05 assign reviewer → C06 reviewer sends it back for revision.
 *
 * Plan: design note 2026-08-15-phase0-flow-proof (Task 6 + Task 7,
 * §III rows C05/C06). VERIFICATION ONLY — the stack is driven through the REAL UI
 * of the REAL roles (scheduler 3333333333333 → reviewer 1111111111111). No
 * /api/e2e/* backdoor (G-6), no money row is touched (G-4), no password is ever
 * written to a file (G-3 — every credential comes from the run command's env).
 *
 * Checkpoints (protocol §II — DB column + audit row + screen, all three or FAIL):
 *   C05  DOC_FEE_PAID → ASSIGNED_FOR_REVIEW + applications.reviewerId set.
 *        Audit expectation is **ad-hoc REVIEWER_ASSIGNED**, not canonical: the
 *        handler writes the row through applicationService.writeAssignmentColumns
 *        (scheduler-assign-reviewer-handler.js:146) instead of the canonical
 *        writer, so no APPLICATION_STATUS_TRANSITION is emitted — the known
 *        audit hole (plan Task 6.2). Per §II that is recorded, not failed;
 *        ZERO audit rows of any kind IS a failure and is asserted as one.
 *   C06  ASSIGNED_FOR_REVIEW → REVISION_REQUESTED with a mandatory comment
 *        (workflow-transitions-handler.js:96-101 rejects an empty one) and a
 *        stamped formData.revisionDueAt = +REVISION_SLA_DAYS working days
 *        (:245-259, SLA value business-rules.js:175). The plan says record the
 *        date, do not pin it (Thai-holiday calendar shifts it), so the spec
 *        asserts the stamp exists and lies in the future, and writes the measured
 *        weekday delta into evidence for the reader to judge.
 *
 * Known blocker this spec is written to survive HONESTLY (proven from the DB
 * before the run, evidence written at runtime as F-REVIEWER-DROPDOWN-EMPTY):
 * the assign modal's dropdown is fed by GET /provider/scheduler/reviewers, which
 * filters `role IN ('document_reviewer','auditor')` exactly
 * (provider-user-service.js:236-252 with the canonical constants at
 * scheduler-assign-reviewer-handler.js:267), while every seeded officer row
 * still carries the LEGACY uppercase spelling ('REVIEWER_AUDITOR', 'AUDITOR').
 * The UI is therefore expected to offer an EMPTY dropdown = the scheduler cannot
 * hand the job over by clicking. The spec opens the modal for real, photographs
 * it, records the finding, and only then closes the pipe through the very same
 * endpoint the modal itself posts to (providerApiPaths.schedulerAssignReviewer →
 * POST /api/provider/scheduler/reviewer-assignments), authenticated as the
 * scheduler's own session — the mission's allowed fallback, NOT a backdoor. If
 * the dropdown DOES contain the reviewer, the click path is taken instead and
 * the evidence says so.
 *
 * Preconditions (fail loudly, never skip): VARS.md carries FARMER_MAIN_APP /
 * FARMER_MAIN_ID from s01 and that application is at DOC_FEE_PAID (the
 * settlement spec runs first). Anything else = fail naming the real status.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { login, dump, auditDump, psql, readVars, saveVars, EV } from './helpers';

const SEG = 's02';
const OUT = join(EV, SEG);
mkdirSync(OUT, { recursive: true });

// Seed staff LOGIN IDs (the national-ID identifiers printed by the plan and by
// seed-gacp.js:96,123) — identifiers, never credentials. Passwords are env-only.
const SCHEDULER_LOGIN_ID = '3333333333333';
const REVIEWER_LOGIN_ID = '1111111111111';
const OFFICER_PW = process.env.PHASE0_SEED_PW_OFFICER || '';
const FARMER_PW = process.env.PHASE0_FARMER_PW || '';
// Same expression the run-config uses for the app origin (playwright.phase0.config.ts:34);
// page.request needs an absolute URL that goes through the SAME Next proxy the UI uses.
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

const REVISION_COMMENT =
  'Phase 0 C06 — เอกสารแนบไม่ครบ กรุณาแนบสำเนาโฉนด/เอกสารสิทธิ์ที่ดินฉบับชัดเจน และแก้ไขรายละเอียดแปลงปลูกให้ตรงกับพื้นที่จริง';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(OUT, name), fullPage: true });

const write = (name: string, body: string) => writeFileSync(join(OUT, name), body);

/** One row of the application, with the fields both checkpoints are judged on. */
function appRow(appId: string) {
  return JSON.parse(
    psql(`SELECT id, "applicationNumber", status, "reviewerId",
            "formData"->>'workflowState' AS workflow_state,
            "formData"->>'revisionDueAt' AS revision_due_at,
            "formData"->>'revisionRequestedAt' AS revision_requested_at,
            "formData"->>'revisionSlaDays' AS revision_sla_days
          FROM applications WHERE id='${appId}';`),
  )[0];
}

/**
 * Cutoff marker for "rows this checkpoint created": a NAIVE UTC string, because
 * audit_logs.timestamp is `timestamp without time zone` holding UTC (Prisma), so
 * a naive comparison cannot be skewed by the session TimeZone. 5s of slack
 * absorbs node↔DB clock drift — nothing else writes to this row in that window.
 */
function auditCutoff(): string {
  return new Date(Date.now() - 5000).toISOString().replace('Z', '');
}

/** Audit rows this checkpoint created (cutoff = the moment before the click). */
function auditSince(appId: string, since: string) {
  return JSON.parse(
    psql(`SELECT id, action, "actorRole", "timestamp" FROM audit_logs
          WHERE "resourceId"='${appId}' AND "timestamp" >= '${since}'::timestamp
          ORDER BY "timestamp" DESC;`),
  ) as Array<{ id: string; action: string }>;
}

/**
 * Log a provider in through the real login form and wait for the AUTHENTICATED
 * landing. helpers.login()'s `**\/provider\/**` wait also matches the login URL
 * itself (/auth/provider/login), so it returns before auth finishes — same trap
 * s01 documented on the health side. Returns the bearer token captured from the
 * login response (kept in memory only; never written to evidence — L2/G-3).
 */
async function providerLogin(page: Page, id: string, pw: string, tag: string) {
  const respP = page
    .waitForResponse(
      (r) => r.url().includes('/auth/provider/login') && r.request().method() === 'POST',
      { timeout: 120_000 },
    )
    .catch(() => null);
  await login(page, { kind: 'provider', id, pw });
  const resp = await respP;
  const body = resp ? await resp.json().catch(() => null) : null;
  const token: string = body?.data?.token || '';
  const userId: string = body?.data?.user?.id || '';
  write(
    `${tag}-login-response.txt`,
    `POST /auth/provider/login → status ${resp ? resp.status() : 'none'} ` +
      `success=${body?.success} tokenPresent=${Boolean(token)} userId=${userId || '-'}\n`,
  );
  try {
    // Provider login lands on /provider/dashboard (provider-login-page.tsx:105 →
    // auth-routes.ts:8) which then redirects to the role landing
    // (provider-role-config.ts:101,147).
    await page.waitForURL(/\/provider\/(dashboard|coordinator|reviewer|applications|work|audits)/, {
      timeout: 120_000,
    });
  } catch {
    await shot(page, `${tag}-login-stuck.png`);
    const alerts = await page.locator('[role=alert], .gov-auth-alert').allInnerTexts().catch(() => []);
    write(`${tag}-login-stuck.txt`, `url ${page.url()}\nalerts ${JSON.stringify(alerts)}\n`);
    throw new Error(`${tag}: provider login did not reach a /provider landing — see ${tag}-login-stuck.png`);
  }
  await page.waitForLoadState('domcontentloaded');
  return { token, userId };
}

test.describe.serial('Phase0 S2 — C05 assign reviewer → C06 revision requested', () => {
  test('C05 — scheduler assigns the reviewer (DOC_FEE_PAID → ASSIGNED_FOR_REVIEW + reviewerId)', async ({ page }) => {
    const V = readVars();
    const APP = V.FARMER_MAIN_APP;
    expect(APP, 'FARMER_MAIN_APP present in evidence/phase0/VARS.md (written by s01)').toBeTruthy();
    expect(OFFICER_PW, 'PHASE0_SEED_PW_OFFICER set in the run command (never committed — G-3)').toBeTruthy();

    // ── precondition: the pipe must genuinely be at DOC_FEE_PAID ──
    // The assign handler itself 409s otherwise (scheduler-assign-reviewer-handler.js:88-93);
    // failing here names the REAL status instead of letting the UI fail vaguely.
    const before = appRow(APP);
    expect(before, `application row ${APP} exists`).toBeTruthy();
    write(
      'C05-precondition.txt',
      `application ${APP} (${before.applicationNumber}) status=${before.status} ` +
        `workflowState=${before.workflow_state} reviewerId=${before.reviewerId ?? 'null'}\n`,
    );
    expect(
      before.status,
      `C05 precondition: the application must be DOC_FEE_PAID before a reviewer can be assigned — it is ${before.status} (settlement spec must run first)`,
    ).toBe('DOC_FEE_PAID');
    const APP_NO: string = before.applicationNumber;

    // Reviewer identity straight from the DB: the dropdown's option VALUE is the
    // user uuid (coordinator/client-view.tsx:554) while the login id is the
    // national id, so the uuid is the only thing that links the two.
    const reviewer = JSON.parse(
      psql(`SELECT id, "providerId", role, "firstName", "lastName", status, "organizationId"
            FROM users WHERE "providerId"='${REVIEWER_LOGIN_ID}';`),
    )[0];
    expect(reviewer, `seed reviewer ${REVIEWER_LOGIN_ID} exists in users`).toBeTruthy();
    write(
      'C05-reviewer-identity.txt',
      `reviewer uuid=${reviewer.id} role=${reviewer.role} status=${reviewer.status} ` +
        `name=${reviewer.firstName} ${reviewer.lastName} org=${reviewer.organizationId}\n`,
    );

    dump(SEG, 'C05', 'before', APP);
    const t0 = auditCutoff(); // rows at/after this are C05's

    // ── the scheduler drives the real coordinator screen ──
    const sch = await providerLogin(page, SCHEDULER_LOGIN_ID, OFFICER_PW, 'C05');
    await page.goto('/provider/coordinator');
    await page.waitForLoadState('domcontentloaded');
    // The default tab IS the "รอจ่ายงาน" queue = readyForReview = DOC_FEE_PAID only
    // (coordinator/client-view.tsx:115,266 · scheduler-dashboard-handler.js:70-72).
    await expect(
      page.getByText(APP_NO, { exact: true }).first(),
      'the DOC_FEE_PAID application is visible in the coordinator รอจ่ายงาน queue',
    ).toBeVisible({ timeout: 60_000 });
    await shot(page, 'C05-01-coordinator-queue-before.png');

    // Row card = the queue item container (coordinator/client-view.tsx:406-408).
    const rowCard = page.locator('div.group').filter({ hasText: APP_NO }).first();
    await rowCard.getByRole('button', { name: /จ่ายงานตรวจ/ }).click();

    // Named so it can never collide with another dialog on the page; the name
    // comes from aria-labelledby → the h3 (coordinator/client-view.tsx:525,529).
    const modal = page.getByRole('dialog', { name: /จ่ายงานตรวจเอกสาร/ });
    await expect(modal, 'reviewer-assignment modal opened (client-view.tsx:522-527)').toBeVisible({ timeout: 30_000 });
    await shot(page, 'C05-02-assign-modal.png');

    // The <select> id is generated by useId() (client-view.tsx:542) → not stable;
    // scope by the dialog instead.
    const select = modal.locator('select');
    await expect(select, 'reviewer dropdown rendered').toBeVisible({ timeout: 30_000 });
    const options = await select.locator('option').evaluateAll((els) =>
      els.map((el) => ({
        value: (el as HTMLOptionElement).value,
        label: (el as HTMLOptionElement).textContent || '',
      })),
    );
    const selectable = options.filter((o) => o.value !== '');
    write(
      'C05-reviewer-options.txt',
      `GET /api/provider/scheduler/reviewers fed the modal with ${selectable.length} selectable option(s)\n` +
        JSON.stringify(options, null, 2) + '\n',
    );

    const uiOffersReviewer = selectable.some((o) => o.value === reviewer.id);
    let assignedVia: 'ui' | 'api-fallback' = 'ui';

    if (uiOffersReviewer) {
      const assignResp = page
        .waitForResponse(
          (r) => r.url().includes('/scheduler/reviewer-assignments') && r.request().method() === 'POST',
          { timeout: 120_000 },
        )
        .catch(() => null);
      await select.selectOption(reviewer.id);
      await shot(page, 'C05-03-reviewer-selected.png');
      await modal.getByRole('button', { name: /ยืนยันจ่ายงาน/ }).click();
      const ar = await assignResp;
      write(
        'C05-assign-response.txt',
        `path=UI click · POST /api/provider/scheduler/reviewer-assignments → status ${ar ? ar.status() : 'none'}\n`,
      );
      expect(ar?.status(), 'the UI assign click was accepted by the backend').toBe(200);
    } else {
      // ── FINDING: the front door is shut. Photograph it, write it down, then
      // close the pipe through the SAME endpoint the modal posts to, as the
      // scheduler's own session (mission rule: no /api/e2e, role-legal only). ──
      assignedVia = 'api-fallback';
      await shot(page, 'C05-03-FINDING-empty-reviewer-dropdown.png');
      write(
        'C05-FINDING-reviewer-dropdown-empty.txt',
        [
          'F-REVIEWER-DROPDOWN-EMPTY — the scheduler CANNOT hand a case to a reviewer through the UI.',
          `url: ${page.url()}`,
          `modal: "จ่ายงานตรวจเอกสาร" for ${APP_NO}; selectable reviewer options = ${selectable.length}`,
          `expected option value (reviewer uuid): ${reviewer.id} — reviewer users.role = ${reviewer.role}`,
          'cause (read from code, confirmed against the DB before the run):',
          '  GET /api/provider/scheduler/reviewers filters role IN (document_reviewer, auditor)',
          '  — scheduler-assign-reviewer-handler.js:267-270 → provider-user-service.js:236-252 (exact match),',
          '  while the seeded officer rows still hold the legacy uppercase spellings',
          '  (REVIEWER_AUDITOR / AUDITOR). normalizeRole() is applied on the WRITE path',
          '  (handler:104-110) but never on this READ path, so the dropdown is empty.',
          'effect: C05 has no UI door. The confirm button stays disabled (client-view.tsx:564).',
          'fallback used to keep the flow proof moving (NOT a backdoor): POST',
          '  /api/provider/scheduler/reviewer-assignments — the exact endpoint the modal calls',
          '  (provider-api.ts:12), sent with the scheduler\'s own session.',
        ].join('\n') + '\n',
      );

      // Auth exactly as the browser would: the request goes to the SAME Next
      // /api proxy the UI uses, which strips cookies and hands the backend an
      // Authorization header (app/api/[...path]/route.ts:14-38) — the bearer
      // below is the scheduler's own login token. The csrf header is sent for
      // the case the request ever travels cookie-first (csrf-middleware.js:103-111,
      // api-client.ts:197-214); through the proxy the backend sees no auth cookie
      // and skips the check (:106).
      const cookies = await page.context().cookies();
      const csrf = cookies.find((c) => c.name === 'csrf_token')?.value || '';
      const res = await page.request.post(`${BASE}/api/provider/scheduler/reviewer-assignments`, {
        headers: {
          Authorization: `Bearer ${sch.token}`,
          'x-csrf-token': csrf,
          'Content-Type': 'application/json',
        },
        data: { applicationId: APP, reviewerId: reviewer.id },
      });
      const resBody = await res.text();
      write(
        'C05-assign-response.txt',
        `path=API fallback (see C05-FINDING-reviewer-dropdown-empty.txt)\n` +
          `POST /api/provider/scheduler/reviewer-assignments → status ${res.status()}\n${resBody}\n`,
      );
      expect(res.status(), 'the scheduler-legal assign endpoint accepted the assignment').toBe(200);
    }

    // ── screen of the acting role, after ──
    await page.goto('/provider/coordinator');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    const stillQueued = await page
      .locator('div.group')
      .filter({ hasText: APP_NO })
      .getByRole('button', { name: /จ่ายงานตรวจ/ })
      .count();
    await shot(page, 'C05-04-coordinator-queue-after.png');
    write(
      'C05-coordinator-after.txt',
      `assigned via: ${assignedVia}\n` +
        `"จ่ายงานตรวจ" buttons still offered for ${APP_NO} in the รอจ่ายงาน queue: ${stillQueued} ` +
        `(0 = the case left the DOC_FEE_PAID queue)\n`,
    );

    // ── checkpoint C05: DB + audit ──
    dump(SEG, 'C05', 'after', APP);
    auditDump(SEG, 'C05', APP);
    const after = appRow(APP);
    const rows = auditSince(APP, t0);
    const canonical = rows.filter((r) => r.action === 'APPLICATION_STATUS_TRANSITION');
    const adHoc = rows.filter((r) => r.action !== 'APPLICATION_STATUS_TRANSITION');
    write(
      'C05-audit-classification.txt',
      `audit rows created by C05 (>= ${t0}): ${rows.length}\n` +
        `  canonical APPLICATION_STATUS_TRANSITION: ${canonical.length}\n` +
        `  ad-hoc: ${adHoc.length} [${adHoc.map((r) => r.action).join(', ')}]\n` +
        `plan Task 6.2 expects the ad-hoc REVIEWER_ASSIGNED row and NO canonical row ` +
        `(the status is written outside the canonical writer — handler:146). Recorded, not failed.\n` +
        JSON.stringify(rows, null, 2) + '\n',
    );

    expect(after.status, 'C05 status = ASSIGNED_FOR_REVIEW').toBe('ASSIGNED_FOR_REVIEW');
    expect(after.reviewerId, 'C05 applications.reviewerId = the assigned reviewer uuid').toBe(reviewer.id);
    expect(
      rows.length,
      'C05 audit: at least one row exists for this hop — zero rows of any kind = the fail-open hole (§II, application-status-writer.js:74-87)',
    ).toBeGreaterThanOrEqual(1);

    // s03 checks the case comes back to THIS reviewer after the farmer resubmits.
    saveVars('REVIEWER_ID', String(after.reviewerId));
  });

  test('C06 — reviewer receives the case and sends it back for revision (+revisionDueAt)', async ({ page }) => {
    const V = readVars();
    const APP = V.FARMER_MAIN_APP;
    expect(APP, 'FARMER_MAIN_APP present in VARS.md').toBeTruthy();
    expect(OFFICER_PW, 'PHASE0_SEED_PW_OFFICER set in the run command').toBeTruthy();

    const before = appRow(APP);
    expect(
      before.status,
      `C06 precondition: the case must be ASSIGNED_FOR_REVIEW — it is ${before.status}`,
    ).toBe('ASSIGNED_FOR_REVIEW');
    const APP_NO: string = before.applicationNumber;

    await providerLogin(page, REVIEWER_LOGIN_ID, OFFICER_PW, 'C06');

    // ── C05's receiving screen (§II item 3: the side that should see the result) ──
    // The reviewer queue is scoped to reviewerId (reviewer-queue-where.js:46-67),
    // so the case showing up here IS the proof the assignment reached a human.
    await page.goto('/provider/reviewer');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByText(APP_NO, { exact: true }).first(),
      'C05 receiving screen: the assigned case appears in the reviewer own queue',
    ).toBeVisible({ timeout: 60_000 });
    await shot(page, 'C05-05-reviewer-queue.png');

    // ── C06 — the reviewer's own decision screen ──
    await page.goto(`/provider/applications/${APP}`);
    await page.waitForLoadState('domcontentloaded');
    const panel = page.getByTestId('action-panel-reviewer');
    await expect(
      panel,
      'the reviewer action panel is rendered (page.tsx:420-463 — needs ASSIGNED_FOR_REVIEW + a review-capable role)',
    ).toBeVisible({ timeout: 60_000 });
    await shot(page, 'C06-01-detail-before.png');

    dump(SEG, 'C06', 'before', APP);
    const t0 = auditCutoff();

    await page.getByTestId('action-request-revision').click(); // page.tsx:450
    // Radix Dialog: the accessible name is the Modal `title`
    // (overlays.tsx:28-31 ← review-decision-modal.tsx:54).
    const modal = page.getByRole('dialog', { name: /ขอให้แก้ไขเอกสาร/ });
    await expect(modal, 'revision modal opened (review-decision-modal.tsx:49-55)').toBeVisible({ timeout: 30_000 });
    // The comment is MANDATORY: an empty one is rejected client-side
    // (review-decision-modal.tsx:44-46) and server-side
    // (workflow-transitions-handler.js:96-101).
    await page.getByTestId('review-comment-textarea').fill(REVISION_COMMENT);
    await shot(page, 'C06-02-revision-modal.png');

    const transitionResp = page
      .waitForResponse(
        (r) => r.url().includes('/workflow-transitions') && r.request().method() === 'POST',
        { timeout: 120_000 },
      )
      .catch(() => null);
    await modal.getByRole('button', { name: /ส่งคำขอแก้ไข/ }).click();
    const tr = await transitionResp;
    const trBody = tr ? await tr.text().catch(() => '') : '';
    write(
      'C06-transition-response.txt',
      `POST /api/provider/applications/${APP}/workflow-transitions {toState: REVISION_REQUESTED} → ` +
        `status ${tr ? tr.status() : 'none'}\n${trBody}\n`,
    );
    expect(
      tr?.status(),
      'the revision request was accepted (403 here = REV-11 ownership, 400 = missing comment — handler:96-101,150-157)',
    ).toBe(200);

    await page.waitForTimeout(3000);
    await shot(page, 'C06-03-detail-after.png');

    // ── checkpoint C06: DB + audit ──
    dump(SEG, 'C06', 'after', APP);
    auditDump(SEG, 'C06', APP);
    const after = appRow(APP);
    const rows = auditSince(APP, t0);
    const canonical = rows.filter((r) => r.action === 'APPLICATION_STATUS_TRANSITION');

    // The deadline: measured, not pinned. addWorkingDays() is Thai-holiday aware
    // (workflow-transitions-handler.js:247-251), so the calendar delta varies —
    // the weekday count is written down for the reader instead of asserted.
    const dueAt = after.revision_due_at ? new Date(after.revision_due_at) : null;
    const stampedAt = after.revision_requested_at ? new Date(after.revision_requested_at) : null;
    let weekdays = -1;
    if (dueAt && stampedAt) {
      weekdays = 0;
      const cursor = new Date(stampedAt);
      while (cursor < dueAt) {
        cursor.setDate(cursor.getDate() + 1);
        const d = cursor.getDay();
        if (d !== 0 && d !== 6) weekdays++;
      }
    }
    write(
      'C06-revision-deadline.txt',
      `status=${after.status}\nreviewerId=${after.reviewerId}\n` +
        `revisionRequestedAt=${after.revision_requested_at}\nrevisionDueAt=${after.revision_due_at}\n` +
        `revisionSlaDays (as stamped by the app)=${after.revision_sla_days}\n` +
        `weekdays between stamp and due (weekend-only calculation, holidays NOT excluded here)=${weekdays}\n` +
        `plan expectation: 5 working days (business-rules.js:175 REVISION_DEADLINE_BUSINESS_DAYS)\n`,
    );
    write(
      'C06-audit-classification.txt',
      `audit rows created by C06 (>= ${t0}): ${rows.length}\n` +
        `  canonical APPLICATION_STATUS_TRANSITION: ${canonical.length}\n` +
        JSON.stringify(rows, null, 2) + '\n',
    );

    expect(after.status, 'C06 status = REVISION_REQUESTED').toBe('REVISION_REQUESTED');
    expect(after.revision_due_at, 'C06 formData.revisionDueAt stamped').toBeTruthy();
    expect(
      dueAt!.getTime() > Date.now(),
      `C06 revisionDueAt is in the future (${after.revision_due_at})`,
    ).toBe(true);
    expect(
      canonical.length,
      'C06 audit: the canonical APPLICATION_STATUS_TRANSITION row §III expects for this hop',
    ).toBeGreaterThanOrEqual(1);
  });

  test('C06 screen — the farmer sees the case sent back, with the deadline', async ({ page }) => {
    const V = readVars();
    const APP = V.FARMER_MAIN_APP;
    const FARMER_ID = V.FARMER_MAIN_ID;
    expect(FARMER_ID, 'FARMER_MAIN_ID present in VARS.md (from s01)').toBeTruthy();
    expect(FARMER_PW, 'PHASE0_FARMER_PW set in the run command').toBeTruthy();

    const row = appRow(APP);
    const APP_NO: string = row.applicationNumber;

    await login(page, { kind: 'health', id: FARMER_ID, pw: FARMER_PW });
    await page.waitForURL(/\/health\/(dashboard|payments|applications|onboarding|start|profile)/, {
      timeout: 120_000,
    });
    await page.waitForLoadState('domcontentloaded');

    await page.goto('/health/applications');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByText(APP_NO, { exact: true }).first(),
      'the farmer list shows the application',
    ).toBeVisible({ timeout: 60_000 });
    // Stage label for REVISION_REQUESTED → 'แก้ไขเอกสารตามข้อเสนอแนะ'
    // (health-dashboard-stage.ts:57, mapped at client-view.tsx:318). Matching the
    // shared prefix keeps this from breaking on the copy's trailing words.
    await expect(
      page.getByText(/แก้ไขเอกสาร/).first(),
      'C06 farmer-side screen: the case is shown as sent back for revision',
    ).toBeVisible({ timeout: 60_000 });
    await shot(page, 'C06-04-farmer-applications.png');

    const listText = await page.locator('body').innerText();
    write(
      'C06-farmer-screen.txt',
      `url ${page.url()}\napplication ${APP_NO} status(DB)=${row.status} revisionDueAt(DB)=${row.revision_due_at}\n` +
        `--- rendered text containing the application code ---\n` +
        listText
          .split('\n')
          .filter((l) => l.includes(APP_NO) || /แก้ไขเอกสาร|เหลืออีก|เลยกำหนด|วัน/.test(l))
          .slice(0, 40)
          .join('\n') + '\n',
    );
  });
});
