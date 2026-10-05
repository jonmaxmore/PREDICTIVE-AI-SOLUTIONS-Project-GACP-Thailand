/**
 * PHASE 0 — S3 — C07 farmer resubmits (same reviewer) → C08 doc approve (งวด 2 chain)
 *
 * Plan: design note 2026-08-15-phase0-flow-proof (Task 8 + Task 9,
 * checkpoints C07 + C08 in §III). VERIFICATION ONLY — no app code is touched; the
 * spec drives the REAL UI on the running stack (Amendment B topology: next dev
 * :3000 → backend :8000 → Supabase), never /api/e2e/* (G-6), never mutates a money
 * row (G-4 — helpers.psql is SELECT-only), and fails honestly when a door is shut.
 *
 * Checkpoints (protocol §II — DB column + audit row + the screen of the role that
 * acted AND the role that should see the result):
 *
 *   C07  REVISION_REQUESTED → ASSIGNED_FOR_REVIEW through the applicant's own
 *        /applications/submit door (RESUBMIT_TARGET — applications.js:681-694,
 *        write at :928-951). THE POINT OF THIS CHECKPOINT is the column that must
 *        NOT move: `reviewerId`. "It goes back to the same reviewer" is implicit in
 *        this codebase — no reroute code exists, the guarantee is only that nothing
 *        clears the column — so the assertion is a literal before/after identity
 *        check, cross-checked against VARS.REVIEWER_ID when the upstream segment
 *        recorded it.
 *
 *   C08  ASSIGNED_FOR_REVIEW → DOC_APPROVED, which the SYSTEM then auto-chains to
 *        PENDING_AUDIT_FEE and mints the งวด-2 invoices with it
 *        (workflow-side-effects.js:119-194; ensurePhaseInvoices at :175). So the
 *        expected end state of a single reviewer click is PENDING_AUDIT_FEE +
 *        2 invoices with serviceType PHASE_2_STATE_FEE / PHASE_2_PLATFORM_FEE
 *        (phase-billing-service.js:54-90). Only the assigned reviewer may approve
 *        (REV-11 ownership gate — workflow-transitions-handler.js:150-157), so a
 *        successful approve is itself second proof that C07 kept the reviewer.
 *
 * HONESTY NOTE (Amendment C-3, same device as s01 C02): the wizard is entered
 * through the REAL farmer doors (/health/applications/<id> → "แก้ไขและส่งข้อมูลใหม่"
 * → "เริ่มแก้ไขคำขอ" → wizard re-entry), and every autosave POST it fires is counted
 * into evidence. The one field actually changed for this round is written through the
 * REAL applicant endpoint POST /api/applications/prepare (applications.js:1022) —
 * an applicant-owned door that only accepts DRAFT / REVISION_REQUESTED / CAR_PENDING
 * rows (EDITABLE_STATUSES, applications.js:212-236) — NOT the /api/e2e backdoor.
 * This is NOT a claim that "the farmer edited a field through the wizard UI"; the
 * wizard-autosave evidence file records what the wizard did and did not persist.
 *
 * Credentials come from the run command only (G-3): PHASE0_FARMER_PW (the s01
 * farmer) and PHASE0_SEED_PW_OFFICER (seed reviewer 1111111111111). Nothing
 * secret is written to any evidence file.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  login, dump, auditDump, dumpErp, psql, readVars, saveVars, EV,
  expectedPhaseFees, scopeCountOf,
} from './helpers';

const SEG = 's03';
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

interface AppRow {
  id: string;
  applicationNumber: string;
  status: string;
  reviewerId: string | null;
}
interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  serviceType: string;
  status: string;
  totalAmount: string;
}

/** Seed officer identity (Amendment B — reviewer). Password comes from env. */
const REVIEWER_LOGIN_ID = '1111111111111';

test.describe.serial('Phase0 S3 — C07 resubmit to the same reviewer → C08 approve → งวด 2', () => {
  test('C07 REVISION_REQUESTED→ASSIGNED_FOR_REVIEW (reviewerId unchanged), C08 →PENDING_AUDIT_FEE + phase-2 invoices', async ({
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
    // C07 — precondition + before-dump
    // ═══════════════════════════════════════════════════════════════
    dump(SEG, 'C07', 'before', APP);
    const before = one<AppRow>(
      `SELECT id, "applicationNumber", status, "reviewerId" FROM applications WHERE id='${APP}';`,
    );
    writeFileSync(join(OUT, 'C07-precondition.txt'), JSON.stringify(before, null, 2));
    expect(before?.status, 'C07 precondition — the row sits at REVISION_REQUESTED (C06 output)').toBe(
      'REVISION_REQUESTED',
    );
    expect(
      before?.reviewerId,
      'C07 precondition — a reviewer is assigned (C05 output); this is the column under test',
    ).toBeTruthy();
    if (V.REVIEWER_ID) {
      // Cross-check only when the upstream segment recorded the key: the
      // unconditional criterion is the before/after identity asserted below.
      expect(before!.reviewerId, 'assigned reviewer == VARS.REVIEWER_ID (recorded by the C05/C06 segment)').toBe(
        V.REVIEWER_ID,
      );
    }
    const APP_NO = String(before!.applicationNumber || '');

    // ── farmer login through the real UI; keep the bearer for the /prepare edit ──
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
    // arrived, never the token itself (L2/G-3).
    const TOKEN: string = flb?.data?.tokens?.accessToken || flb?.data?.token || '';
    writeFileSync(
      join(OUT, 'C07-farmer-login.txt'),
      `status ${flr ? flr.status() : 'none'} success=${flb?.success} tokenPresent=${Boolean(TOKEN)}`,
    );
    try {
      // helpers.login's **/health/** glob also matches the login URL itself, so
      // wait for a real authenticated landing before touching guarded routes.
      await page.waitForURL(/\/health\/(dashboard|payments|applications|onboarding|start|profile)/, {
        timeout: 120_000,
      });
    } catch {
      await shot(page, 'C07-00-farmer-login-stuck.png');
      throw new Error('farmer login did not reach a /health landing — see C07-00-farmer-login-stuck.png');
    }
    await page.waitForLoadState('domcontentloaded');
    expect(TOKEN, 'farmer bearer token captured from the login response').toBeTruthy();

    // ── the farmer's own doors: detail → edit → wizard re-entry ──
    await page.goto(`/health/applications/${APP}`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C07-01-farmer-detail-revision.png');

    // resolveActionTarget maps SUBMIT_REVISION → /health/applications/<id>/edit
    // (application-detail-page-helpers.ts:132). Probe for the real link; when it is
    // absent that is a UI finding, recorded with the URL, and the run continues on
    // the same farmer-reachable route (mission G-6 rule for a missing button).
    const editLink = page.getByRole('link', { name: /แก้ไขและส่งข้อมูลใหม่/ });
    const editLinkVisible = await editLink
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    writeFileSync(
      join(OUT, 'C07-ui-doors.txt'),
      `detail url: ${page.url()}\n` +
        `link "แก้ไขและส่งข้อมูลใหม่" visible on the applicant detail page: ${editLinkVisible}\n` +
        (editLinkVisible
          ? ''
          : 'FINDING — the applicant detail page offered no revision door; navigated straight to ' +
            `/health/applications/${APP}/edit (same route the config points at).\n`),
    );
    if (editLinkVisible) {
      await editLink.click();
    } else {
      await page.goto(`/health/applications/${APP}/edit`, { timeout: 200_000 });
    }
    await page.waitForURL('**/edit', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C07-02-edit-page.png');

    // Count every wizard autosave POST from here on (distinct from the
    // draft-DOCUMENTS endpoint) so the evidence says what the wizard persisted.
    const draftPosts: string[] = [];
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/applications/draft') && !u.includes('draft-documents') && r.request().method() === 'POST') {
        draftPosts.push(String(r.status()));
      }
    });

    const startEdit = page.getByRole('button', { name: /เริ่มแก้ไขคำขอ/ });
    await expect(
      startEdit,
      'the REVISION_REQUESTED edit page exposes the real "เริ่มแก้ไขคำขอ" door (edit/client-view.tsx:427-431)',
    ).toBeVisible({ timeout: 60_000 });
    await startEdit.click();
    await page.waitForURL('**/new/step/**', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C07-03-wizard-edit-reentry.png');
    await page.waitForTimeout(6000); // let the wizard's 3s autosave debounce settle

    // ── the one field this round changes, through the applicant's own endpoint ──
    // Read the CURRENT farmData first and send it back whole with one value
    // changed: /prepare shallow-spreads the payload into formData, so a partial
    // farmData object would blank the rest of the farm block.
    const farmRow = one<{ farm_data: Record<string, unknown> | null }>(
      `SELECT "formData"->'farmData' AS farm_data FROM applications WHERE id='${APP}';`,
    );
    const farmData = (farmRow?.farm_data ?? {}) as Record<string, unknown>;
    const previousFarmName = String(farmData.farmName ?? '');
    const revisedFarmName = `${previousFarmName} (แก้ไขตามข้อสังเกตผู้ตรวจ)`;
    const prepRes = await page.request.post('/api/applications/prepare', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { applicationId: APP, farmData: { ...farmData, farmName: revisedFarmName } },
    });
    const editedRow = one<{ farm_name: string | null }>(
      `SELECT "formData"->'farmData'->>'farmName' AS farm_name FROM applications WHERE id='${APP}';`,
    );
    writeFileSync(
      join(OUT, 'C07-wizard-autosave.txt'),
      `wizard autosave POST /applications/draft while in edit re-entry — count ${draftPosts.length} ` +
        `statuses [${draftPosts.join(', ')}]\n` +
        `field edit routed through POST /api/applications/prepare → status ${prepRes.status()} ok=${prepRes.ok()}\n` +
        `farmData.farmName: "${previousFarmName}" → "${editedRow?.farm_name ?? ''}"\n`,
    );
    expect(prepRes.ok(), 'POST /api/applications/prepare accepted the correction on the REVISION_REQUESTED row').toBe(
      true,
    );
    expect(editedRow?.farm_name, 'the correction really landed on THIS application row').toBe(revisedFarmName);

    // ── resubmit through the real preview UI (the applicant's submit door) ──
    await page.goto(`/health/applications/preview?id=${APP}`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C07-04-preview-resubmit.png');
    // Label for REVISION_REQUESTED — preview/client-view.tsx:443-444.
    const resubmitBtn = page.getByRole('button', { name: /ส่งคำขอแก้ไข/ });
    // ── FINDING F-PREVIEW-REVISION-CLOSED (found by this run, 2026-08-18) ──
    // The applicant's resubmit button lives ONLY on the preview page, but the
    // preview API refuses REVISION_REQUESTED: PREVIEWABLE_STATUSES =
    // {DRAFT, SUBMITTED, PENDING_DOC_FEE, PHASE_1_SLIP_UNDER_REVIEW, DOC_FEE_PAID}
    // (apps/backend/routes/api/preview/previewable-statuses.js:19-25) while
    // EDITABLE_STATUSES lets the farmer edit in REVISION_REQUESTED / CAR_PENDING
    // (routes/api/applications/applications.js:186). So the farmer can correct the
    // file and can never reach the door that sends it back → the revision loop is
    // open-ended in the UI. Mission §V: record it, then close the pipe through the
    // endpoint the button itself calls (same farmer bearer, no /api/e2e/*).
    const uiDoorOpen = await resubmitBtn
      .isEnabled({ timeout: 25_000 })
      .catch(() => false);
    if (!uiDoorOpen) {
      const previewApi = await page.request.get(`/api/applications/${APP}/prepare`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }).catch(() => null);
      const previewBody = previewApi ? (await previewApi.text().catch(() => '')).slice(0, 400) : '';
      writeFileSync(
        join(OUT, 'C07-FINDING-preview-blocks-revision.txt'),
        'F-PREVIEW-REVISION-CLOSED — the applicant cannot resubmit through the UI\n' +
          `application ${APP} status REVISION_REQUESTED (editable per applications.js:186)\n` +
          `preview page rendered: "Application is not in previewable state"\n` +
          `preview API GET /api/applications/${APP}/prepare -> ${previewApi ? previewApi.status() : 'n/a'}\n` +
          `body: ${previewBody}\n` +
          'cause: previewable-statuses.js:19-25 has no REVISION_REQUESTED (nor CAR_PENDING),\n' +
          '       and preview/client-view.tsx:425-450 is the only place the resubmit button exists.\n' +
          'effect: reviewer sends the file back -> farmer edits -> no door back to the reviewer.\n' +
          'this run closes the pipe with the SAME endpoint the button posts to, as mission §V allows.\n',
      );
      await shot(page, 'C07-04b-preview-blocked-FINDING.png');
    }

    const canonicalBeforeC07 = canonicalCount(APP);
    // /applications/submit intermittently 500s under Supabase session-pooler
    // pressure (FINDINGS F-SUBMIT-500-FLAKY, documented in s01): the canonical-audit
    // SAVEPOINT fence fails CLOSED on the pooler and rolls the whole tx back. Retry
    // the SAME real button and let the DB be the authority — a rolled-back attempt
    // leaves the row at REVISION_REQUESTED, so ASSIGNED_FOR_REVIEW ⟺ real success.
    let attempts = 0;
    let resubmitOk = false;
    let lastStatus = 'none';
    for (; attempts < 8 && !resubmitOk; attempts++) {
      if (!uiDoorOpen) {
        // UI door shut (F-PREVIEW-REVISION-CLOSED) — post to the very endpoint the
        // button posts to, with the farmer's own bearer. Same authority, same guard.
        const sr = await page.request.post('/api/applications/submit', {
          headers: { Authorization: `Bearer ${TOKEN}` },
          data: { applicationId: APP },
        }).catch(() => null);
        lastStatus = sr ? `${sr.status()} (api-fallback)` : 'none (api-fallback)';
        resubmitOk = Boolean(sr && sr.status() === 200);
        if (resubmitOk) break;
        await page.waitForTimeout(5000);
        const nowApi = one<{ status: string }>(`SELECT status FROM applications WHERE id='${APP}';`);
        if (nowApi?.status === 'ASSIGNED_FOR_REVIEW') { resubmitOk = true; break; }
        continue;
      }
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      const respP = page
        .waitForResponse(
          (r) => r.url().includes('/applications/submit') && r.request().method() === 'POST',
          { timeout: 90_000 },
        )
        .catch(() => null);
      await resubmitBtn.click();
      const sr = await respP;
      lastStatus = sr ? String(sr.status()) : 'none';
      resubmitOk = Boolean(sr && sr.status() === 200);
      if (resubmitOk) break;
      await page.waitForTimeout(5000); // let the pooler recover
      const now = one<{ status: string }>(`SELECT status FROM applications WHERE id='${APP}';`);
      if (now?.status === 'ASSIGNED_FOR_REVIEW') {
        resubmitOk = true; // committed even though the response tail failed
        break;
      }
      await page.goto(`/health/applications/preview?id=${APP}`, { timeout: 200_000 });
      await page.waitForLoadState('domcontentloaded');
    }
    writeFileSync(
      join(OUT, 'C07-submit-response.txt'),
      `preview-UI resubmit attempts ${attempts + 1}, last POST /applications/submit status ${lastStatus}, ` +
        `accepted = ${resubmitOk}\n`,
    );
    await page.waitForURL(`**/health/applications/${APP}`, { timeout: 30_000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(page, 'C07-05-farmer-after-resubmit.png');

    // ── C07 checkpoint: column + audit + screen ──
    dump(SEG, 'C07', 'after', APP);
    auditDump(SEG, 'C07', APP);
    const afterC07 = one<AppRow>(
      `SELECT id, "applicationNumber", status, "reviewerId" FROM applications WHERE id='${APP}';`,
    );
    const canonicalAfterC07 = canonicalCount(APP);
    writeFileSync(
      join(OUT, 'C07-reviewer-identity.txt'),
      `status:      ${before!.status} → ${afterC07?.status}\n` +
        `reviewerId:  ${before!.reviewerId} → ${afterC07?.reviewerId}\n` +
        `unchanged:   ${before!.reviewerId === afterC07?.reviewerId}\n` +
        `VARS.REVIEWER_ID cross-check ran: ${Boolean(V.REVIEWER_ID)}\n` +
        `canonical APPLICATION_STATUS_TRANSITION rows: ${canonicalBeforeC07} → ${canonicalAfterC07}\n`,
    );
    expect(
      resubmitOk,
      uiDoorOpen
        ? 'C07 — the resubmit was accepted through the real preview UI'
        : 'C07 — UI door shut (F-PREVIEW-REVISION-CLOSED); resubmit accepted through the same endpoint the button posts to',
    ).toBe(true);
    expect(afterC07?.status, 'C07 status = ASSIGNED_FOR_REVIEW (RESUBMIT_TARGET applications.js:683)').toBe(
      'ASSIGNED_FOR_REVIEW',
    );
    expect(
      afterC07?.reviewerId,
      'C07 HEART — reviewerId is byte-identical after the resubmit (it goes back to the SAME reviewer)',
    ).toBe(before!.reviewerId);
    expect(
      canonicalAfterC07 - canonicalBeforeC07,
      'C07 canonical audit row for the resubmit hop — 0 new rows = the fail-open hole (application-status-writer.js:74-87)',
    ).toBeGreaterThanOrEqual(1);

    // ═══════════════════════════════════════════════════════════════
    // C08 — the SAME reviewer approves the documents; the system chains งวด 2
    // ═══════════════════════════════════════════════════════════════
    // Separate browser context: the farmer session stays alive in `page` so the
    // applicant-side screen can be captured after the approve. Video is requested
    // explicitly because a hand-made context does not inherit the config's `use`.
    const revCtx = await browser.newContext({ recordVideo: { dir: join(OUT, 'video-reviewer') } });
    const rev = await revCtx.newPage();
    const revLoginResp = rev
      .waitForResponse(
        (r) => r.url().includes('/auth/provider/login') && r.request().method() === 'POST',
        { timeout: 90_000 },
      )
      .catch(() => null);
    await login(rev, { kind: 'provider', id: REVIEWER_LOGIN_ID, pw: OFFICER_PW });
    const rlr = await revLoginResp;
    const rlb = rlr ? await rlr.json().catch(() => null) : null;
    const REVIEWER_USER_ID: string = rlb?.data?.user?.id || '';
    try {
      await rev.waitForURL(/\/provider\/(dashboard|reviewer|applications|work)/, { timeout: 120_000 });
    } catch {
      await shot(rev, 'C08-00-reviewer-login-stuck.png');
      throw new Error('reviewer login did not reach a /provider landing — see C08-00-reviewer-login-stuck.png');
    }
    await rev.waitForLoadState('domcontentloaded');
    writeFileSync(
      join(OUT, 'C08-reviewer-login.txt'),
      `login status ${rlr ? rlr.status() : 'none'} tokenPresent=${Boolean(
        rlb?.data?.tokens?.accessToken || rlb?.data?.token,
      )}\n` +
        `logged-in reviewer userId: ${REVIEWER_USER_ID}\n` +
        `applications.reviewerId:   ${afterC07?.reviewerId}\n` +
        `same person: ${Boolean(REVIEWER_USER_ID) && REVIEWER_USER_ID === afterC07?.reviewerId}\n`,
    );

    // Task 8.4 — the case is back in the same reviewer's queue.
    await rev.goto('/provider/reviewer', { timeout: 200_000 });
    await rev.waitForLoadState('domcontentloaded');
    await rev.waitForTimeout(4000); // queue fetch
    await shot(rev, 'C08-01-reviewer-queue.png');
    const inQueue = APP_NO
      ? await rev
          .getByText(APP_NO, { exact: false })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 })
          .then(() => true)
          .catch(() => false)
      : false;
    writeFileSync(
      join(OUT, 'C08-reviewer-queue.txt'),
      `queue url: ${rev.url()}\napplicationNumber ${APP_NO} visible in the reviewer queue: ${inQueue}\n` +
        '(recorded, not asserted — the authoritative ownership proof is that the approve below is ' +
        'accepted, which REV-11 grants only to the assigned reviewer: workflow-transitions-handler.js:150-157)\n',
    );

    dump(SEG, 'C08', 'before', APP);
    const canonicalBeforeC08 = canonicalCount(APP);
    await rev.goto(`/provider/applications/${APP}`, { timeout: 200_000 });
    await rev.waitForLoadState('domcontentloaded');
    await shot(rev, 'C08-02-detail-before.png');

    const approveBtn = rev.getByTestId('action-approve-documents');
    await expect(
      approveBtn,
      'the reviewer action panel is open on an ASSIGNED_FOR_REVIEW case (provider/applications/[id]/page.tsx:454-460)',
    ).toBeVisible({ timeout: 60_000 });
    await approveBtn.click();
    const commentBox = rev.getByTestId('review-comment-textarea');
    await expect(commentBox, 'approve modal opened (review-decision-modal.tsx:127-136)').toBeVisible({
      timeout: 30_000,
    });
    await commentBox.fill('Phase 0 C08 — เอกสารครบถ้วนตามที่ขอแก้ไข อนุมัติเอกสาร');
    await shot(rev, 'C08-03-approve-modal.png');

    const transResp = rev
      .waitForResponse(
        (r) => r.url().includes('/workflow-transitions') && r.request().method() === 'POST',
        { timeout: 120_000 },
      )
      .catch(() => null);
    await rev.getByRole('button', { name: /ยืนยันอนุมัติ/ }).click();
    const tr = await transResp;
    const trBody = tr ? (await tr.text().catch(() => '')).slice(0, 2000) : '';
    writeFileSync(
      join(OUT, 'C08-transition-response.txt'),
      `POST .../workflow-transitions {toState: DOC_APPROVED} → status ${tr ? tr.status() : 'none'}\n${trBody}\n`,
    );

    // The auto-chain (DOC_APPROVED → PENDING_AUDIT_FEE) + ensurePhaseInvoices run
    // server-side inside the same request; poll rather than assume.
    let finalStatus = '';
    for (let i = 0; i < 12 && finalStatus !== 'PENDING_AUDIT_FEE'; i++) {
      finalStatus = one<{ status: string }>(`SELECT status FROM applications WHERE id='${APP}';`)?.status ?? '';
      if (finalStatus !== 'PENDING_AUDIT_FEE') await page.waitForTimeout(3000);
    }

    let phase2: InvoiceRow[] = [];
    for (let i = 0; i < 10 && phase2.length < 2; i++) {
      phase2 = rows<InvoiceRow>(
        `SELECT id, "invoiceNumber", "serviceType", status, "totalAmount" FROM invoices
         WHERE "applicationId"='${APP}' AND "serviceType" IN ('PHASE_2_STATE_FEE','PHASE_2_PLATFORM_FEE')
         ORDER BY "serviceType";`,
      );
      if (phase2.length < 2) await page.waitForTimeout(3000);
    }
    const allInvoices = rows<InvoiceRow>(
      `SELECT id, "invoiceNumber", "serviceType", status, "totalAmount" FROM invoices
       WHERE "applicationId"='${APP}' ORDER BY "serviceType";`,
    );
    // THE quotation is issued ONCE per application lifecycle at first submit
    // (applications.js:982-991) and carries both phases' installments — so งวด 2 has
    // no new quotation row. Dumped for the record, not asserted.
    const quotes = rows<{ id: string; issuerType: string; status: string; totalAmount: string }>(
      `SELECT id, "issuerType", status, "totalAmount" FROM quotations WHERE "applicationId"='${APP}' ORDER BY "issuerType";`,
    );

    dump(SEG, 'C08', 'after', APP);
    auditDump(SEG, 'C08', APP);
    dumpErp(SEG, 'C08', APP); // no settle happened here — kept as the invoice/ERP snapshot at mint time
    const canonicalAfterC08 = canonicalCount(APP);
    writeFileSync(
      join(OUT, 'C08-phase2-billing.txt'),
      `status after approve: ${finalStatus} (expected PENDING_AUDIT_FEE — SYSTEM auto-chain ` +
        'workflow-side-effects.js:151-163)\n' +
        `canonical APPLICATION_STATUS_TRANSITION rows: ${canonicalBeforeC08} → ${canonicalAfterC08}\n` +
        `phase-2 invoices (${phase2.length}):\n${JSON.stringify(phase2, null, 2)}\n` +
        `all invoices on this application:\n${JSON.stringify(allInvoices, null, 2)}\n` +
        `quotations (issued once at first submit, installments carry งวด 2):\n${JSON.stringify(quotes, null, 2)}\n`,
    );
    // Hand the งวด-2 payables to the next segment BEFORE asserting, so the value is
    // recorded even if an assertion below fails.
    const stateInv = phase2.find((i) => i.serviceType === 'PHASE_2_STATE_FEE');
    const platformInv = phase2.find((i) => i.serviceType === 'PHASE_2_PLATFORM_FEE');
    if (stateInv) saveVars('PHASE2_INVOICE_STATE_ID', stateInv.id);
    if (platformInv) saveVars('PHASE2_INVOICE_PLATFORM_ID', platformInv.id);
    if (stateInv || platformInv) saveVars('PHASE2_MILESTONE', 'M2');

    // Screens: the reviewer's own view after the decision, then the applicant's
    // payments page which must now show งวด 2.
    await rev.reload({ timeout: 200_000 }).catch(() => null);
    await rev.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(rev, 'C08-04-reviewer-detail-after.png');
    await revCtx.close(); // flush the reviewer video before the assertions below
    await page.goto(`/health/payments?app=${APP}&phase=2`, { timeout: 200_000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(page, 'C08-05-farmer-payments-phase2.png');

    expect(tr?.status(), 'C08 — the approve POST was accepted (REV-11: only the assigned reviewer may)').toBe(200);
    expect(
      finalStatus,
      'C08 end state = PENDING_AUDIT_FEE — one reviewer click, DOC_APPROVED then the SYSTEM auto-chain',
    ).toBe('PENDING_AUDIT_FEE');
    expect(
      canonicalAfterC08 - canonicalBeforeC08,
      'C08 canonical audit ×2 (→DOC_APPROVED, →PENDING_AUDIT_FEE) — fewer = the fail-open audit hole',
    ).toBeGreaterThanOrEqual(2);
    expect(
      phase2.length,
      'C08 mints BOTH งวด-2 invoices (PHASE_2_STATE_FEE + PHASE_2_PLATFORM_FEE) — without them the applicant cannot pay งวด 2',
    ).toBe(2);
    // The money pin for งวด 2. "positive payable" passed on the retired
    // platform-only-VAT formula too (27,535) and would pass on any wrong number at
    // all — the point of walking a real farmer is that the bill is EXACTLY right.
    //
    // The phase split across the two invoice components (application-phase-invoice-
    // methods.js:436-459): STATE carries stateAmount with vatAmount 0 (the DTAM
    // portion is not the company's VATable supply on this document), PLATFORM
    // carries platformAmount + the VAT OF THE WHOLE service fee. They sum to the
    // payable. scopeCount is read from the column the backend stamped, so this holds
    // for a 1-scope and a 3-scope applicant alike (1 → 25,000 + 4,425 = 29,425;
    // 3 → 75,000 + 13,275 = 88,275).
    const scope2 = scopeCountOf(APP);
    const fee2 = expectedPhaseFees('PHASE_2', scope2);
    writeFileSync(
      join(OUT, 'C08-fee-model.txt'),
      `scopeCount (applications.totalAreaTypes): ${scope2}
` +
      `expected งวด 2 payable: ${fee2.total} = state ${fee2.state} + platform ${fee2.platform} + VAT ${fee2.vat}
` +
      `state invoice totalAmount:    ${stateInv?.totalAmount}
` +
      `platform invoice totalAmount: ${platformInv?.totalAmount}
`,
    );
    expect(Number(stateInv?.totalAmount ?? 0), `งวด-2 state invoice = ${fee2.state} for ${scope2} scope(s) (VAT-free component)`)
      .toBe(fee2.state);
    expect(Number(platformInv?.totalAmount ?? 0), `งวด-2 platform invoice = platform ${fee2.platform} + VAT ${fee2.vat} = ${fee2.platform + fee2.vat} (VAT is 7% of the WHOLE service fee — W14)`)
      .toBe(fee2.platform + fee2.vat);
    expect(
      Number(stateInv?.totalAmount ?? 0) + Number(platformInv?.totalAmount ?? 0),
      `งวด-2 payable = ${fee2.total} for ${scope2} scope(s) — the figure the farmer is about to be charged on the Stripe rail`,
    ).toBe(fee2.total);
  });
});
