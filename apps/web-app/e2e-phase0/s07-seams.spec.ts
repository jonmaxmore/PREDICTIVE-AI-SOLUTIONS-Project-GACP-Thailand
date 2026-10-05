/**
 * PHASE 0 — S7 — THE THREE SEAMS (plan Task 14 / 15 / 16).
 *
 * Plan: design note 2026-08-15-phase0-flow-proof
 *   §III/§IV — seams are NOT part of the main-line verdict, but they are
 *   MANDATORY evidence: "ทำไม่ได้ = เขียน BLOCKED พร้อมเหตุ ห้ามเงียบ" (:86).
 *
 * VERIFICATION ONLY. No app code is touched, no money row is written by hand
 * (G-4 — helpers.psql is SELECT-only), no /api/e2e/* backdoor is used (G-6).
 * Every door pressed here is a door the acting role can really press.
 *
 * ── Why this file owns a FRESH application ────────────────────────────────
 * All three seams strand an application in a state the main line must never be
 * in, so they run on their OWN farmer + their OWN application. FARMER_MAIN_APP
 * (VARS.md, written by s01) is read only to ASSERT we are not standing on it.
 *
 * ── The three seams, and what each one is asked to answer ─────────────────
 * REWRITTEN — final-review round (2026-08-18), Item 3. The F-REVISION-DOOR-
 * NO-QUOTATION fix (2972db04, already on this branch) changed what the
 * revision door does to a DRAFT: it now walks BOTH SSOT-legal hops in one
 * transaction (DRAFT→SUBMITTED→PENDING_DOC_FEE,
 * application-review-revision-methods.js:210-267) and fires the same
 * quotation issuance POST /applications/submit's own
 * isInitialSubmit branch makes (:309-318). That closes the hole SEAM A/C
 * originally pinned and removes the precondition SEAM B needed. Per this
 * file's own rule below ("when the hole is fixed, this test MUST go red and
 * be rewritten"), the three seams below are updated to the post-fix truth
 * rather than left describing a state that no longer exists.
 *
 * SEAM A (Task 14) — a DRAFT pushed through the revision door
 *   `PUT /api/applications/:id/revision` accepts DRAFT
 *   (application-review-revision-methods.js:63-80) and now walks both hops:
 *   DRAFT→SUBMITTED then SUBMITTED→PENDING_DOC_FEE, same actor role
 *   POST /applications/submit's own hop 2 uses (:239-267), and mints the
 *   quotation fire-and-forget (:309-318) — the same call
 *   /applications/submit's isInitialSubmit branch makes. The specimen this
 *   seam produces therefore lands at PENDING_DOC_FEE with quotations, not the
 *   bare unpayable SUBMITTED-with-zero-quotations row audit 2.9 originally
 *   found. QUESTION TO ANSWER BY PRESSING: does this application have any way
 *   to reach a payment? — now answered YES, by construction; the seam is
 *   CLOSED, and the assertions below pin the fixed behaviour instead of the
 *   hole.
 *
 * SEAM C (Task 15) — the main door, offered the SAME (now different) specimen
 *   Because SEAM A's specimen lands at PENDING_DOC_FEE (not bare SUBMITTED —
 *   see SEAM A above), `POST /api/applications/submit` on it hits the TRUE
 *   no-op echo branch (applications.js:657-661: "the DB already holds this
 *   status, nothing to write, nothing to audit"), not the SUBMITTED branch a
 *   few lines below it (applications.js:662-689) — that branch's own
 *   F-SUBMIT-ECHO-LIES fix (honest SUBMITTED/WAIT_PROCESSING, no
 *   self-heal-advance) is exercised by application-review-revision-methods
 *   coverage and applications.js's own submit tests, not reachable from THIS
 *   specimen anymore. QUESTION: does the screen agree with the truth? —
 *   answered by an even stronger case than "the lie is now honest": there is
 *   nothing left to lie about, because the DB already holds exactly what is
 *   echoed. See the SEAM-C test body for where this diverges from an earlier
 *   assumption that the specimen was still bare SUBMITTED at this point.
 *
 * SEAM B (Task 16) — quotations fail silently
 *   The auto-issue on submit is fire-and-forget: a rejection is swallowed into
 *   `logger.warn('[Applications Submit] quotation auto-issue failed…')`
 *   (applications.js:982-991). Fault injection is NOT available here — the plan's
 *   `REVOKE INSERT` (D-P2) does not bite on Supabase (owner bypass, Amendment B
 *   :452) and simulating it by editing app code is forbidden by this mission. So
 *   this test used to run the honest alternative: the SEAM-A application was a
 *   REAL, naturally-occurring specimen of "filed, but no quotation ever
 *   issued", audited for OBSERVABILITY — is there any screen or endpoint that
 *   tells the farmer, the accountant, or the audit trail?
 *   DISPOSITION (final-review round 2026-08-18): the F-REVISION-DOOR-NO-
 *   QUOTATION fix that closes SEAM A also removes SEAM B's precondition — a
 *   DRAFT resubmitted through the revision door no longer reaches a filed
 *   state with zero quotations. The only remaining producer of that shape is
 *   the BUNDLE submit door (application-bundles.js:523-556 — parks member
 *   applications at bare SUBMITTED by design, no per-member quotation).
 *   Reworking this specimen through a bundle create+submit UI/API flow was
 *   judged to inflate this fix round's scope (it has no prior helper or
 *   pattern anywhere in e2e-phase0/) and is DEFERRED, not silently dropped —
 *   the test below still runs, still names the specimen it finds, and
 *   records the disposition as evidence instead of asserting the now-false
 *   precondition. See the SEAM-B test body.
 *
 * ── Honesty rules obeyed here ─────────────────────────────────────────────
 * - No try/catch hides a blocked UI. Probes that are ALLOWED to come back empty
 *   (a repo search, a route that may 404) record their outcome; a UI step that
 *   must work and does not, throws.
 * - Every SEAM-B expectation is a PIN OF A HOLE, marked as such: it encodes the
 *   silence that exists TODAY. When the hole is fixed, this test MUST go red and
 *   be rewritten to assert the new alert surface. It is not a spec of desired
 *   behaviour.
 * - Credentials come from the run command only (G-3): PHASE0_FARMER_PW (the
 *   throwaway farmer this file registers) and PHASE0_SEED_PW_OFFICER (seed
 *   accountant 4444444444444 — an identifier, not a credential). No token or
 *   password is ever written to evidence.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  login, dump, auditDump, dumpErp, psql, thaiId, pngFixture, saveVars, readVars, EV, REPO,
  acceptCheckoutTermsIfShown,
  acceptQuotationsIfShown,
} from './helpers';

const SEG = 's07-seams';
const OUT = join(EV, SEG);
mkdirSync(OUT, { recursive: true });
const PNG = pngFixture(OUT);

// Same expression the run-config uses for the app origin
// (playwright.phase0.config.ts:34); page.request needs an absolute URL so it
// goes through the SAME Next proxy the browser uses.
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const FARMER_PW = process.env.PHASE0_FARMER_PW || '';
const OFFICER_PW = process.env.PHASE0_SEED_PW_OFFICER || '';
// Seed accountant LOGIN ID (seed-gacp.js:131 — role ACCOUNTANT). Identifier, not
// a credential.
const ACCOUNT_LOGIN_ID = '4444444444444';

// ── The seam farmer (plan interface key FARMER_A_ID / FARMER_A_APP) ──────────
const FARMER_A_ID = thaiId();
const EMAIL = `phase0.seams.${Date.now()}@example.test`;
const PHONE = `08${String(Math.floor(10000000 + Math.random() * 89999999))}`;
const FIRST = 'รอยต่อ';
const LAST = 'พิสูจน์ท่อ';

// Cross-test state (describe.serial): SEAM C and SEAM B stand on SEAM A's row.
let APP = '';
let APP_NO = '';
let FARMER_TOKEN = '';

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name), fullPage: true });
const write = (name: string, body: string) => writeFileSync(join(OUT, name), body);

/**
 * Rows this checkpoint created. NAIVE UTC string because audit_logs.timestamp is
 * `timestamp without time zone` holding UTC (same reasoning as s02:85-93).
 */
const auditCutoff = () => new Date(Date.now() - 5000).toISOString().replace('Z', '');
function auditSince(appId: string, since: string) {
  return JSON.parse(
    psql(`SELECT id, action, "actorRole", "timestamp" FROM audit_logs
          WHERE "resourceId"='${appId}' AND "timestamp" >= '${since}'::timestamp
          ORDER BY "timestamp" DESC;`),
  ) as Array<{ id: string; action: string; actorRole: string | null }>;
}

const rows = (sql: string) => JSON.parse(psql(sql)) as Array<Record<string, unknown>>;
const quotationRows = (appId: string) =>
  rows(`SELECT id, "issuerType", status, "totalAmount" FROM quotations WHERE "applicationId"='${appId}';`);
const invoiceRows = (appId: string) =>
  rows(`SELECT id, "invoiceNumber", status, "totalAmount" FROM invoices WHERE "applicationId"='${appId}';`);
const checkoutRows = (appId: string) =>
  rows(`SELECT id, milestone, status, total_payable_amount FROM checkout_orders WHERE "applicationId"='${appId}';`);
const appRow = (appId: string) =>
  rows(`SELECT id, "applicationNumber", status, "formData"->>'workflowState' AS workflow_state
        FROM applications WHERE id='${appId}';`)[0] as { id: string; applicationNumber: string; status: string; workflow_state: string };

/** Upload the PNG fixture into the nth hidden file input; wait for its persist call.
 *  (Same shape as s01:47-56 — this POST is also what CREATES the DRAFT row, because
 *  /applications/draft-documents runs findOrCreateApplicationForHealth,
 *  applications.js:1082.) */
async function uploadNth(page: Page, n: number) {
  const wait = page.waitForResponse(
    (r) => r.url().includes('/applications/draft-documents') && r.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await page.locator('input[type="file"]').nth(n).setInputFiles(PNG);
  const res = await wait;
  const body = await res.json().catch(() => null);
  return { status: res.status(), fileUrl: body?.data?.fileUrl ?? null };
}

/** Log the seam farmer in through the real form and wait for the AUTHENTICATED
 *  landing. helpers.login's `**\/health\/**` wait also matches the login URL
 *  itself, so it returns before auth finishes (s01:104-112). Returns the bearer
 *  (memory only — never written to evidence, L2/G-3). */
async function farmerLogin(page: Page, tag: string): Promise<string> {
  const respP = page
    .waitForResponse((r) => r.url().includes('/auth/health/login') && r.request().method() === 'POST',
      { timeout: 120_000 })
    .catch(() => null);
  await login(page, { kind: 'health', id: FARMER_A_ID, pw: FARMER_PW });
  const resp = await respP;
  const body = resp ? await resp.json().catch(() => null) : null;
  const token: string = body?.data?.tokens?.accessToken || body?.data?.token || '';
  write(`${tag}-farmer-login.txt`,
    `POST /auth/health/login → status ${resp ? resp.status() : 'none'} success=${body?.success} tokenPresent=${Boolean(token)}\n`);
  await page.waitForURL(/\/health\/(dashboard|payments|applications|onboarding|start|profile)/, { timeout: 120_000 });
  await page.waitForLoadState('domcontentloaded');
  return token;
}

test.describe.serial('Phase0 S7 — seams A / C / B on their own application', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // SEAM A — a DRAFT walks in the revision door and comes out PENDING_DOC_FEE,
  //          with the quotation minted (both SSOT hops ran). Is
  //          there any way to pay? — yes, by construction. See the full
  //          rewritten header above (F-REVISION-DOOR-NO-QUOTATION fix).
  // ═══════════════════════════════════════════════════════════════════════════
  test('SEAM A — DRAFT through PUT /:id/revision lands PENDING_DOC_FEE with quotations; probe every pay door', async ({ page }) => {
    expect(FARMER_PW, 'PHASE0_FARMER_PW set in the run command (never committed — G-3)').toBeTruthy();
    saveVars('FARMER_A_ID', FARMER_A_ID);

    // ── register (real 4-step wizard; selectors verified in
    // (auth)/register/page.tsx:130,361,375,514 and driven live by s01:66-94) ──
    await page.goto('/register');
    await page.fill('#reg-identifier', FARMER_A_ID);
    await page.fill('#reg-firstName', FIRST);
    await page.fill('#reg-lastName', LAST);
    await page.getByRole('button', { name: /ถัดไป/ }).click();
    await page.fill('#reg-email', EMAIL);
    await page.fill('#reg-phone', PHONE);
    await page.getByRole('button', { name: /ถัดไป/ }).click();
    await page.fill('#reg-password', FARMER_PW);
    await page.fill('#reg-confirm-password', FARMER_PW);
    await page.getByRole('button', { name: /ถัดไป/ }).click();
    await page.locator('#reg-consent').check();
    await shot(page, 'SEAM-A-01-register-confirm.png');
    await page.getByRole('button', { name: /ยืนยันสมัครสมาชิก/ }).click();
    // One click fires TWO register POSTs, the loser 400s DUPLICATE_IDENTIFIER
    // (known F-REG-DUP, s01:88-93). Login below is the authority on success.
    await page.getByText(/ลงทะเบียนสำเร็จ/).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, 'SEAM-A-02-register-done.png');

    FARMER_TOKEN = await farmerLogin(page, 'SEAM-A');
    expect(FARMER_TOKEN, 'farmer bearer captured from the real login response').toBeTruthy();
    await shot(page, 'SEAM-A-03-dashboard.png');

    // ── build a DRAFT through the real wizard (step 1 consent → step 2 plant +
    // purpose + 3 uploads + cultivation). The uploads are what persist the row. ──
    await page.goto('/health/applications/new');
    await page.waitForURL('**/new/step/**', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    const consentBoxes = page.locator('input[type="checkbox"]');
    await consentBoxes.nth(0).check();
    await consentBoxes.nth(1).check();
    await page.getByRole('button', { name: /ถัดไป/ }).click();
    await page.waitForURL('**/new/step/2', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /กัญชา/ }).first().click();
    await page.getByRole('button', { name: /เพื่อการพาณิชย์ในประเทศ/ }).click();
    await expect(page.locator('input[type="file"]')).toHaveCount(3, { timeout: 20_000 });
    const m1 = [await uploadNth(page, 0), await uploadNth(page, 1), await uploadNth(page, 2)];
    await page.getByRole('button', { name: /กลางแจ้ง/ }).click();
    await shot(page, 'SEAM-A-04-wizard-step2.png');
    await page.waitForTimeout(6000);

    let draft: { id: string; status: string } | null = null;
    for (let i = 0; i < 12 && !draft; i++) {
      const found = rows(`SELECT id, status FROM applications WHERE "healthId"='${FARMER_A_ID}' ORDER BY "createdAt" DESC LIMIT 1;`);
      if (found.length) draft = found[0] as { id: string; status: string };
      else await page.waitForTimeout(2500);
    }
    if (!draft) {
      await shot(page, 'SEAM-A-04b-no-draft.png');
      throw new Error('SEAM A blocked before it began — no DRAFT row after the wizard step 2 (see SEAM-A-04b-no-draft.png)');
    }
    APP = draft.id;
    saveVars('FARMER_A_APP', APP);

    // Isolation guard (mission): this segment must never stand on the main line.
    const V = readVars();
    expect(APP, 'seam application is NOT FARMER_MAIN_APP — the main line must not be disturbed')
      .not.toBe(V.FARMER_MAIN_APP);

    dump(SEG, 'SEAM-A', 'before', APP); // expect DRAFT
    expect(appRow(APP).status, 'seam specimen starts as DRAFT').toBe('DRAFT');

    // Fill the draft to a submittable shape through the REAL applicant endpoint
    // POST /api/applications/prepare (applications.js:1022; NOT an /api/e2e
    // backdoor). applicationId is pinned so the write cannot be redirected to
    // another row (applications.js:221-235). Same Option-1 label as s01
    // (Amendment C-3): this is NOT a claim that the 9-step wizard passes by UI.
    const prepRes = await page.request.post(`${BASE}/api/applications/prepare`, {
      headers: { Authorization: `Bearer ${FARMER_TOKEN}` },
      data: {
        applicationId: APP,
        plantId: 'cannabis', serviceType: 'NEW', areaType: 'OUTDOOR',
        certificationPurposes: ['EXPORT'], cultivationMethods: ['outdoor'],
        applicantData: {
          applicantType: 'INDIVIDUAL', firstName: FIRST, lastName: LAST,
          idCard: FARMER_A_ID, phone: PHONE, address: '1/1 หมู่ 1 ต.สุเทพ อ.เมือง จ.เชียงใหม่',
        },
        farmData: {
          farmName: 'ฟาร์มรอยต่อ A', address: '1/1 หมู่ 1',
          province: 'เชียงใหม่', district: 'เมือง', subdistrict: 'สุเทพ',
          postalCode: '50200', totalAreaSize: '5',
          // totalAreaUnit is REQUIRED too, same class as s01's plot areaUnit
          // (s01-register-submit.spec.ts:236-241): certificate-service's
          // strict farm-area reader (farm-areaunit-default fix, Task 3)
          // refuses a unit-less farmData at mint, and
          // canonical-application-validator now requires it at both submit
          // doors (Task 2) — a unit-less farmData would 422 the revision-door
          // seam below. The real wizard always sets 'Sqm'
          // (farm-info-step.tsx:75); this Option-1 payload must too.
          totalAreaUnit: 'Sqm',
        },
        // areaUnit is REQUIRED (plot-areaunit fix — same reason a56465c6 fixed
        // s01:236-241; this file was missed then): the canonical validator
        // 422s a unit-less plot at both submit doors, so the revision-door
        // seam below would die on plot_area_units.0.unit without it.
        plots: [{ name: 'แปลง A', areaSize: '2', areaUnit: 'Sqm', solarSystem: 'outdoor' }],
        productionData: { propagationType: ['SEED'], plantParts: ['LEAF', 'FLOWER'] },
        harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN_DRY', storageSystem: 'COLD_STORAGE' },
        documents: m1.map((u, i) => ({
          type: `M1_DOC_${i + 1}`, name: `เอกสาร M1 #${i + 1}`,
          uploaded: true, url: u.fileUrl, metadata: { required: false },
        })),
      },
    });
    write('SEAM-A-prepare-response.txt', `POST /applications/prepare → status ${prepRes.status()} ok=${prepRes.ok()}\n`);
    expect(prepRes.ok(), 'POST /applications/prepare accepted the canonical fill').toBeTruthy();

    // ── THE SEAM: push the DRAFT through the revision door ──────────────────
    // This door is reachable by the applicant's own role (authenticateHealth —
    // application-workflow-handlers.js:420). There is NO UI button that calls it
    // for a DRAFT (the wizard's preview page calls POST /applications/submit,
    // preview/client-view.tsx:108), which is exactly the point of the seam: the
    // door exists on the API surface with no screen in front of it. Recorded as
    // a FINDING and driven by API per G-6's escape hatch.
    const beforeCut = auditCutoff();
    const revRes = await page.request.put(`${BASE}/api/applications/${APP}/revision`, {
      headers: { Authorization: `Bearer ${FARMER_TOKEN}` },
      data: { formData: {}, notes: 'seam-A' },
    });
    const revBody = await revRes.json().catch(() => null);
    APP_NO = String(revBody?.data?.applicationNumber || '');
    write('SEAM-A-revision-response.txt',
      `PUT /api/applications/${APP}/revision → status ${revRes.status()}\n${JSON.stringify(revBody, null, 2)}\n`);

    dump(SEG, 'SEAM-A', 'after', APP);
    auditDump(SEG, 'SEAM-A', APP);
    write('SEAM-A-audit-delta.txt', JSON.stringify(auditSince(APP, beforeCut), null, 2));

    // ── Does this application have any way to reach a payment? Press every door
    // the farmer really has, and record what each one answers. ───────────────
    // 1) the payments screen itself
    await page.goto(`/health/payments?app=${APP}&phase=1`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await shot(page, 'SEAM-A-05-payments-screen.png');
    const quotationSectionOnPayments = await page.locator('[data-testid="quotation-review-section"]').count();
    const payScreenText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
    write('SEAM-A-payments-screen.txt',
      `url ${page.url()}\nquotation-review-section nodes: ${quotationSectionOnPayments}\n\n--- visible text ---\n${payScreenText}\n`);

    // 2) the preview page — this row is PENDING_DOC_FEE (see the SEAM A
    //    assertions below) and PENDING_DOC_FEE is previewable
    //    (previewable-statuses.js:19-25); its money button is NOT
    //    status-gated to DRAFT: for PENDING_DOC_FEE, isInitialSubmit=false so
    //    handlePayment skips /submit and calls POST /payments/create
    //    directly (preview/client-view.tsx:97,107,127).
    await page.goto(`/health/applications/preview?id=${APP}`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'SEAM-A-06-preview.png');
    const payBtn = page.getByRole('button', { name: /ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่s*1|สร้างรายการชำระงวดที่\s*1/ });
    const payBtnCount = await payBtn.count();
    const payBtnEnabled = payBtnCount > 0 ? await payBtn.first().isEnabled() : false;
    const payBtnLabel = payBtnCount > 0 ? (await payBtn.first().innerText()).trim() : '(no button)';
    // A real press that mutates nothing: the sibling button that walks the farmer
    // to the invoice list (preview/client-view.tsx:416-424).
    const invoiceLink = page.getByRole('button', { name: /เปิดรายการใบแจ้งหนี้งวดที่\s*1/ });
    if (await invoiceLink.count()) {
      await invoiceLink.first().click();
      await page.waitForURL('**/health/payments**', { timeout: 60_000 });
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);
      await shot(page, 'SEAM-A-07-invoice-list-after-press.png');
    }

    // 3) the Stripe checkout door (Amendment D — the rail the project actually
    //    uses). PAYABLE_STATES.M1 includes PENDING_DOC_FEE (and SUBMITTED)
    //    (stripe-checkout-service.js:40), so this is where the answer lives.
    // F-G4-64 final round R24: the quotation gate is the first thing the
    // checkout door runs, so the acceptance is pressed before this probe.
    await acceptQuotationsIfShown(page, APP!, 'S07 SEAM-A M1 press');
    await page.goto(`/health/payments/checkout?app=${APP}&milestone=M1`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'SEAM-A-08-checkout-route.png');
    const startBtn = page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ });
    const startCount = await startBtn.count();
    let uiCheckout = 'route did not render the start button (checkout/page.tsx:33-36 notFound when NEXT_PUBLIC_CHECKOUT_UI_ENABLED!=="true") — FINDING, screen door absent';
    if (startCount > 0) {
      // F-G4-64: the press is disabled until the payment-terms disclosure is
      // answered (checkout/client-view.tsx). Inside this branch the checkout
      // page rendered, so the disclosure is on screen in one of its two shapes.
      await acceptCheckoutTermsIfShown(page, 'S07 SEAM-A M1 press');
      const respP = page.waitForResponse(
        (r) => r.url().includes('/payments/checkout') && r.request().method() === 'POST', { timeout: 90_000 },
      ).catch(() => null);
      await startBtn.first().click();
      const cr = await respP;
      const crBody = cr ? await cr.json().catch(() => null) : null;
      uiCheckout = `UI press → POST /payments/checkout status ${cr ? cr.status() : 'none'} body ${JSON.stringify(crBody)}`;
      await page.waitForTimeout(3000);
      await shot(page, 'SEAM-A-09-checkout-after-press.png');
    }
    // G-6 escape hatch: when the screen door is missing, close the pipe with the
    // endpoint the farmer's OWN role can call (authenticateHealth —
    // finance/payments.js:409) so the question is answered either way.
    let apiCheckout = 'not attempted (UI door answered)';
    if (startCount === 0) {
      const res = await page.request.post(`${BASE}/api/payments/checkout`, {
        headers: { Authorization: `Bearer ${FARMER_TOKEN}` },
        data: { applicationId: APP, milestone: 'M1' },
      });
      const body = await res.json().catch(() => null);
      apiCheckout = `POST /api/payments/checkout (farmer bearer) → status ${res.status()} body ${JSON.stringify(body)}`;
    }

    const quotes = quotationRows(APP);
    const orders = checkoutRows(APP);
    const invs = invoiceRows(APP);
    const after = appRow(APP);
    write('SEAM-A-money-surface.txt',
      `APPLICATION ${APP} (${after.applicationNumber}) status=${after.status} workflowState=${after.workflow_state}\n\n` +
      `Q1 payments screen: quotation-review-section nodes=${quotationSectionOnPayments}\n` +
      `Q2 preview money button: present=${payBtnCount > 0} enabled=${payBtnEnabled} label="${payBtnLabel}"\n` +
      `   (this row is already PENDING_DOC_FEE — see the SEAM A assertions below;\n` +
      `    pressing this button calls POST /payments/create, which accepts\n` +
      `    PENDING_DOC_FEE directly, payment-service-phase-flow.js:83. That press\n` +
      `    is performed in SEAM C, on purpose AFTER this evidence write, so it\n` +
      `    does not destroy anything SEAM C still needs.)\n` +
      `Q3 stripe checkout UI: ${uiCheckout}\n` +
      `Q4 stripe checkout API: ${apiCheckout}\n\n` +
      `DB quotations: ${quotes.length} rows ${JSON.stringify(quotes)}\n` +
      `DB checkout_orders: ${orders.length} rows ${JSON.stringify(orders)}\n` +
      `DB invoices: ${invs.length} rows ${JSON.stringify(invs)}\n`);

    // ── Seam assertions (the documented behaviour, proven on a live row) ─────
    // Rewritten final-review round (2026-08-18), Item 3: the
    // F-REVISION-DOOR-NO-QUOTATION fix (already on this branch) makes the
    // revision door walk BOTH SSOT-legal hops and mint quotations for a DRAFT
    // resubmit — the hole this seam originally pinned (bare SUBMITTED, zero
    // quotations, no way to pay) is CLOSED. These assertions now pin that
    // fixed behaviour instead of the hole.
    expect(revRes.status(), 'the revision door accepted a DRAFT').toBe(200);
    expect(revBody?.data?.status,
      'the revision door answers PENDING_DOC_FEE — both SSOT hops ran in one tx (application-review-revision-methods.js:210-267)')
      .toBe('PENDING_DOC_FEE');
    expect(after.status, 'the column really is PENDING_DOC_FEE — hop 2 ran, not just hop 1').toBe('PENDING_DOC_FEE');
    // W14 (operator ruling 2026-08-22): ONE issuer ⇒ ONE quotation row for the
    // whole price. The DTAM+PLATFORM pair this pin used to require is the retired
    // two-issuer shape (quotation-service.js:531-559). What the seam proves is
    // unchanged: the revision door DOES call quotation-service, so the specimen is
    // not left filed-but-unbillable.
    expect(quotes.length,
      'the revision door issued THE quotation — the same call /submit makes (:309-318); 0 = the filed-but-unbillable hole, 2 = the retired two-issuer split is back')
      .toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEAM C — the same specimen is offered to the MAIN door. Rewritten
  // final-review round (2026-08-18), Item 3: SEAM A's specimen now lands at
  // PENDING_DOC_FEE (the F-REVISION-DOOR-NO-QUOTATION fix, see SEAM A above),
  // so /submit hits the TRUE no-op echo branch (applications.js:657-661), not
  // the SUBMITTED branch this test originally exercised. The reply and the
  // column now AGREE — PENDING_DOC_FEE / PAY_PHASE_1, unchanged — because
  // there is nothing left to lie about. This diverges from the fix brief for
  // this specific test, which expected the specimen to still be bare
  // SUBMITTED at this point (status:'SUBMITTED' + WAIT_PROCESSING); reading
  // application-review-revision-methods.js directly (hop 2 commits
  // PENDING_DOC_FEE in the SAME transaction as hop 1, :239-267) and the
  // existing unit pin ("lands a DRAFT resubmit at PENDING_DOC_FEE … not bare
  // SUBMITTED", application-review-revision-methods.test.js) both confirm the
  // specimen cannot be bare SUBMITTED by the time this test runs. The
  // stronger truth-pins the brief asked to keep — DB status unchanged, 0 new
  // audit rows — hold exactly as before, and hold for an even simpler reason
  // now: this really is a no-op.
  // ═══════════════════════════════════════════════════════════════════════════
  test('SEAM C — POST /applications/submit on the PENDING_DOC_FEE specimen is a true no-op echo (reply and column agree)', async ({ page }) => {
    expect(APP, 'SEAM A produced the stranded application (this test cannot run without it)').toBeTruthy();
    expect(FARMER_PW, 'PHASE0_FARMER_PW set in the run command').toBeTruthy();

    dump(SEG, 'SEAM-C', 'before', APP);
    const before = appRow(APP);
    const beforeCut = auditCutoff();

    // A fresh browser context per test → log in again (real form) and take a
    // fresh bearer; the previous test's token lives in another context.
    FARMER_TOKEN = await farmerLogin(page, 'SEAM-C');
    expect(FARMER_TOKEN, 'farmer bearer captured').toBeTruthy();

    // Twice, to show the answer is a constant, not a one-off race.
    const replies: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const res = await page.request.post(`${BASE}/api/applications/submit`, {
        headers: { Authorization: `Bearer ${FARMER_TOKEN}` },
        data: { applicationId: APP },
      });
      const body = await res.json().catch(() => null);
      replies.push(`attempt ${i}: status ${res.status()} → ${JSON.stringify(body)}`);
      await page.waitForTimeout(1500);
    }
    const afterApi = appRow(APP);
    dump(SEG, 'SEAM-C', 'after', APP);
    auditDump(SEG, 'SEAM-C', APP);
    const newRows = auditSince(APP, beforeCut);
    write('SEAM-C-submit-responses.txt',
      `${replies.join('\n')}\n\nDB before: status=${before.status} workflowState=${before.workflow_state}\n` +
      `DB after : status=${afterApi.status} workflowState=${afterApi.workflow_state}\n` +
      `audit rows written since the first call: ${newRows.length}\n${JSON.stringify(newRows, null, 2)}\n`);

    // What the FARMER is shown next to that reply.
    await page.goto('/health/applications', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await shot(page, 'SEAM-C-01-applications-list.png');
    await page.goto(`/health/applications/preview?id=${APP}`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    // Cold-run lesson (red-1-cold-compile): domcontentloaded fires while the
    // preview still shows its "กำลังโหลดข้อมูลพรีวิว..." spinner
    // (client-view.tsx:167), so everything captured below — screenshot, screen
    // text, and the money-button probe — must wait the spinner out first or it
    // records a page that has not answered yet.
    await page.getByText('กำลังโหลดข้อมูลพรีวิว').first().waitFor({ state: 'hidden', timeout: 120_000 }).catch(() => {});
    await shot(page, 'SEAM-C-02-preview.png');
    const listText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
    write('SEAM-C-screen-text.txt', `url ${page.url()}\napplicationNumber ${afterApi.applicationNumber}\n\n${listText}\n`);

    // ── the true no-op, asserted ──────────────────────────────────────────
    // Rewritten final-review round (2026-08-18), Item 3: before this fix, the
    // specimen was bare SUBMITTED here and this block pinned the
    // F-SUBMIT-ECHO-LIES hole (a lie: PENDING_DOC_FEE/PAY_PHASE_1 echoed for a
    // row the DB still called SUBMITTED). The revision door's own two-hop fix
    // means the specimen is ALREADY PENDING_DOC_FEE by the time it reaches
    // here, so /submit's reply and the DB column now say the same thing for
    // an honest reason (applications.js:657-661's no-op branch), not a lie.
    const parsed = replies.map((r) => r.includes('"status":"PENDING_DOC_FEE"'));
    expect(parsed.every(Boolean), 'both /submit calls answered status=PENDING_DOC_FEE — matching the real DB state (applications.js:657-661)').toBe(true);
    expect(replies.every((r) => r.includes('"nextRequiredAction":"PAY_PHASE_1"')),
      'both answers told the applicant to pay phase 1 — still true, phase 1 is still unpaid').toBe(true);
    expect(afterApi.status, 'the column never moved — a true no-op writes nothing').toBe('PENDING_DOC_FEE');
    expect(newRows.filter((r) => r.action === 'APPLICATION_STATUS_TRANSITION').length,
      'no canonical status-transition row was written — there was no transition to make').toBe(0);

    // ── plan 15.3 — now press the button the farmer really sees on that screen.
    // For a PENDING_DOC_FEE row the preview button does NOT call /submit
    // (isInitialSubmit is false — preview/client-view.tsx:97); it calls
    // POST /payments/create, which accepts PENDING_DOC_FEE directly
    // (payment-service-phase-flow.js:83). Pressed LAST, on purpose: it changes
    // the row, so everything above had to be captured first.
    const seen: string[] = [];
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/applications/submit') || u.includes('/payments/create') || u.includes('/payments/checkout')) {
        seen.push(`${r.request().method()} ${new URL(u).pathname} → ${r.status()}`);
      }
    });
    const pressCut = auditCutoff();
    const payBtn = page.getByRole('button', { name: /ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่s*1|สร้างรายการชำระงวดที่\s*1/ });
    // Bounded wait, not an instant count: the button renders only after the
    // preview data lands. A button still absent AFTER this wait is the honest
    // recordable outcome (the dead-end finding), probed at the right time.
    const pressable = await payBtn.first().waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => payBtn.first().isEnabled())
      .catch(() => false);
    if (pressable) {
      await payBtn.first().click();
      await page.waitForTimeout(10_000);
      await shot(page, 'SEAM-C-03-after-money-press.png');
    }
    const afterPress = appRow(APP);
    dump(SEG, 'SEAM-C-press', 'after', APP);
    auditDump(SEG, 'SEAM-C-press', APP);
    dumpErp(SEG, 'SEAM-C-press', APP); // accounting-side record of whatever the press created
    write('SEAM-C-ui-press.txt',
      `preview money button pressable=${pressable}\nrequests fired: ${JSON.stringify(seen)}\n` +
      `landed on: ${page.url()}\n` +
      `DB after press: status=${afterPress.status} workflowState=${afterPress.workflow_state}\n` +
      `quotations=${quotationRows(APP).length} invoices=${invoiceRows(APP).length} checkout_orders=${checkoutRows(APP).length}\n` +
      `audit rows since press: ${JSON.stringify(auditSince(APP, pressCut), null, 2)}\n`);
    // No assertion on the press outcome: BOTH outcomes are findings (the money
    // door opens from an illegal state, or it refuses and the row is a dead end).
    // The artifact carries the verdict; asserting one of them would encode a
    // preference this mission has not been given.
    expect(seen.length + Number(pressable), 'the press attempt was recorded (button state + fired requests)').toBeGreaterThan(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEAM B — an application that is filed with NO quotation. Who is told?
  // DISPOSITION (final-review round, 2026-08-18, Item 3): the same
  // F-REVISION-DOOR-NO-QUOTATION fix that closes SEAM A also removes this
  // seam's precondition — see the file header. The body below still runs; it
  // checks the precondition live, and if the specimen now carries
  // quotations (the expected case, post-fix) it records the disposition as
  // evidence and returns WITHOUT asserting the stale PINS further down —
  // those pinned the silence around a shape that can no longer occur via
  // this door. The original probing logic is left in place (unreachable
  // today) for the day a bundle-door specimen replaces APP here.
  // ═══════════════════════════════════════════════════════════════════════════
  test('SEAM B — a filed application with zero quotations is invisible: no farmer, officer or audit surface reports it (deferred — see disposition if the precondition is unreachable)', async ({ page }) => {
    expect(APP, 'SEAM A produced the specimen').toBeTruthy();
    expect(OFFICER_PW, 'PHASE0_SEED_PW_OFFICER set in the run command (never committed — G-3)').toBeTruthy();

    // ── the specimen, as it stands right now ────────────────────────────────
    dump(SEG, 'SEAM-B', 'before', APP);
    const spec = appRow(APP);
    const quotes = quotationRows(APP);
    const invs = invoiceRows(APP);
    write('SEAM-B-specimen.txt',
      `specimen ${APP} (${spec.applicationNumber}) status=${spec.status} workflowState=${spec.workflow_state}\n` +
      `quotations=${quotes.length} ${JSON.stringify(quotes)}\ninvoices=${invs.length} ${JSON.stringify(invs)}\n` +
      `NB: this row never took the /submit initial-submit path, which is the ONLY\n` +
      `caller of quotationService.issueQuotationsForApplication (applications.js:982-991),\n` +
      `so it reproduces the END STATE of a silently failed auto-issue without any\n` +
      `fault injection and without touching app code.\n`);

    if (quotes.length !== 0) {
      write('SEAM-B-DISPOSITION.txt',
        `SEAM B's precondition (a filed application with ZERO quotations) can no longer\n` +
        `be produced via the revision door: the F-REVISION-DOOR-NO-QUOTATION fix\n` +
        `(2972db04, already on this branch) makes a DRAFT resubmitted through\n` +
        `PUT /applications/:id/revision mint the quotation before landing\n` +
        `PENDING_DOC_FEE (application-review-revision-methods.js:210-267,:309-318; see\n` +
        `also application-review-revision-methods.test.js "issues both quotations once\n` +
        `a DRAFT resubmit reaches PENDING_DOC_FEE"). Specimen ${APP} carries\n` +
        `${quotes.length} quotation row(s): ${JSON.stringify(quotes)}.\n\n` +
        `The only remaining producer of a filed-but-unbilled row is the BUNDLE submit\n` +
        `door (application-bundles.js:523-556), which parks member applications at\n` +
        `bare SUBMITTED with no per-member quotation BY DESIGN. Reworking this\n` +
        `specimen through a bundle create+submit UI/API flow was judged to inflate\n` +
        `this fix round's scope — e2e-phase0/ has no existing bundle-creation helper\n` +
        `or precedent — and is DEFERRED, not silently dropped (final-review round,\n` +
        `2026-08-18, Item 3 disposition).\n\n` +
        `This test ends here without asserting the PINS below: they pinned the\n` +
        `silence around a specimen shape this door can no longer produce, so\n` +
        `asserting them now would pin a false precondition, not a real finding.\n`);
      return;
    }

    // ── everything below only runs if a future specimen (e.g. a bundle-door
    // row) actually reaches this test with zero quotations again. ───────────
    expect(quotes.length, 'specimen is valid: a filed application carrying zero quotations').toBe(0);

    // ── 1. the farmer's own screen ──────────────────────────────────────────
    const token = await farmerLogin(page, 'SEAM-B');
    await page.goto(`/health/payments?app=${APP}&phase=1`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await shot(page, 'SEAM-B-01-farmer-payments.png');
    const sectionNodes = await page.locator('[data-testid="quotation-review-section"]').count();
    const farmerText = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
    const qRes = await page.request.get(`${BASE}/api/applications/${APP}/quotations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const qBody = await qRes.json().catch(() => null);
    write('SEAM-B-farmer-surface.txt',
      `screen: quotation-review-section nodes=${sectionNodes} (QuotationReviewSection.tsx:305 renders null when both sides are null)\n` +
      `GET /api/applications/${APP}/quotations → status ${qRes.status()} ${JSON.stringify(qBody)}\n\n` +
      `--- visible text on /health/payments ---\n${farmerText}\n`);

    // ── 2. the accountant's screens + the ONE exception feed they have ──────
    const provRespP = page
      .waitForResponse((r) => r.url().includes('/auth/provider/login') && r.request().method() === 'POST',
        { timeout: 120_000 })
      .catch(() => null);
    await login(page, { kind: 'provider', id: ACCOUNT_LOGIN_ID, pw: OFFICER_PW });
    const provResp = await provRespP;
    const provBody = provResp ? await provResp.json().catch(() => null) : null;
    const officerToken: string = provBody?.data?.token || '';
    write('SEAM-B-officer-login.txt',
      `POST /auth/provider/login (${ACCOUNT_LOGIN_ID}) → status ${provResp ? provResp.status() : 'none'} ` +
      `success=${provBody?.success} tokenPresent=${Boolean(officerToken)}\n`);
    // helpers.login's `**\/provider\/**` wait also matches /auth/provider/login
    // itself, so it can return before auth finishes (s02:104-110). Wait for a real
    // authenticated landing — the legacy ACCOUNT role has no landing of its own and
    // stays on /provider/dashboard (provider-role-config.ts:127-130).
    await page.waitForURL(/\/provider\/(dashboard|accounting|receipts|work)/, { timeout: 120_000 });
    expect(officerToken, 'accountant bearer captured from the real provider login').toBeTruthy();
    await page.goto('/provider/accounting', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);
    await shot(page, 'SEAM-B-02-accounting.png');
    // The only "something is wrong" tab an accountant has
    // (accounting-dashboard-client.tsx:632, TabNav.tsx:58-60 role="tab").
    const excTab = page.getByRole('tab', { name: /รายการผิดพลาด/ });
    const excTabCount = await excTab.count();
    if (excTabCount > 0) {
      await excTab.first().click();
      await page.waitForTimeout(2000);
      await shot(page, 'SEAM-B-03-accounting-exceptions.png');
    }
    const accountingText = (await page.locator('body').innerText().catch(() => '')).slice(0, 6000);
    // …and the feed behind it. listReceiptExceptions only reads three webhook
    // actions from audit_logs (invoice-service.js:636-650), all keyed to an
    // invoiceId — an application that never got a quotation cannot appear.
    const excRes = await page.request.get(`${BASE}/api/invoices/receipts/exceptions?limit=100`, {
      headers: { Authorization: `Bearer ${officerToken}` },
    });
    const excText = await excRes.text();
    const appearsInExceptions = excText.includes(APP) || (Boolean(APP_NO) && excText.includes(APP_NO));
    write('SEAM-B-officer-surface.txt',
      `GET /api/invoices/receipts/exceptions?limit=100 → status ${excRes.status()}\n` +
      `specimen ${APP} / ${APP_NO || '(no number captured)'} present in the response: ${appearsInExceptions}\n` +
      `response (first 4000 chars):\n${excText.slice(0, 4000)}\n\n` +
      `--- visible text on /provider/accounting (exceptions tab clicked: ${excTabCount > 0}) ---\n${accountingText}\n`);

    // ── 3. the audit trail ──────────────────────────────────────────────────
    const quotAudit = rows(
      `SELECT id, action, "actorRole", "timestamp" FROM audit_logs
       WHERE "resourceId"='${APP}' AND action ILIKE '%QUOT%' ORDER BY "timestamp" DESC;`,
    );
    auditDump(SEG, 'SEAM-B', APP);
    write('SEAM-B-audit-quotation-rows.txt',
      `audit_logs rows for ${APP} whose action mentions QUOT: ${quotAudit.length}\n${JSON.stringify(quotAudit, null, 2)}\n`);

    // ── 4. does ANY surface list "filed but unbilled"? Search, and record the
    //       search itself so the absence is checkable, not asserted from memory.
    const searches = [
      searchRepo('alert action name for a failed quotation issue',
        'QUOTATION_(ISSUE_)?FAILED|QUOTATION_AUTO_ISSUE|quotation_issue_failed',
        ['apps/backend']),
      searchRepo('any query for applications lacking a quotation/invoice',
        '(missing|without|no)[^\\n]{0,40}(quotation|invoice)',
        ['apps/backend/routes', 'apps/backend/services']),
      searchRepo('provider screens that mention quotations at all',
        'quotation|ใบเสนอราคา',
        ['apps/web-app/src/app/provider']),
      searchRepo('quotation reconciliation / orphan sweep',
        'quotation[^\\n]{0,60}(orphan|reconcil|sweep|backfill|retry)',
        ['apps/backend']),
    ];
    write('SEAM-B-search.txt',
      searches.map((s) =>
        `## ${s.label}\npattern: ${s.pattern}\npaths: ${s.paths.join(' ')}\ngit grep exit: ${s.exitCode}\nhits: ${s.hits.length}\n` +
        s.hits.slice(0, 40).map((h) => `  ${h}`).join('\n')).join('\n\n') + '\n');

    write('SEAM-B-verdict.txt',
      `QUESTION: after a filing whose quotations never appeared, is anyone told?\n\n` +
      `farmer  : quotation panel renders ${sectionNodes} node(s) — the panel hides itself when both sides are null\n` +
      `farmer  : GET …/quotations → ${JSON.stringify(qBody)}\n` +
      `officer : accountant exception feed status ${excRes.status()}, specimen present=${appearsInExceptions}\n` +
      `audit   : ${quotAudit.length} row(s) about quotations on this application\n` +
      `search  : alert-action name hits=${searches[0].hits.length}, "missing invoice/quotation" hits=${searches[1].hits.length}, ` +
      `provider screens mentioning quotations hits=${searches[2].hits.length}, reconciliation hits=${searches[3].hits.length}\n`);

    // ── PINS OF A HOLE (not a spec of desired behaviour) ────────────────────
    // Each expectation below encodes the silence that exists TODAY. When a fix
    // lands (an alert row, an accountant queue, a farmer warning), this test MUST
    // go red and be rewritten to assert that new surface.
    expect(sectionNodes, 'PIN: the farmer is shown nothing about the missing quotation').toBe(0);
    expect(qBody?.data?.dtam, 'PIN: DTAM quotation absent and reported only as null').toBeNull();
    expect(qBody?.data?.platform, 'PIN: PLATFORM quotation absent and reported only as null').toBeNull();
    // 401 would mean the probe never reached the feed — that must fail loudly
    // instead of passing the PIN below for the wrong reason. 403 is NOT excluded:
    // "the accountant may not even open the only exception feed" is itself the
    // finding, and it is recorded in SEAM-B-officer-surface.txt.
    expect(excRes.status(), 'the exception feed was queried as an authenticated officer').not.toBe(401);
    expect(appearsInExceptions, "PIN: the accountant's only exception feed cannot see this application").toBe(false);
    expect(quotAudit.length, 'PIN: the audit trail carries no row about the missing quotation').toBe(0);
    expect(searches[0].hits.length,
      'PIN: no alert/action name for a failed quotation issue exists anywhere in apps/backend').toBe(0);
  });
});

/**
 * A real repo search, recorded as evidence. `git grep` exits 1 with EMPTY stdout
 * when nothing matches — that empty result IS the finding, so it is returned and
 * written out. Any OTHER non-zero exit is re-thrown: a broken search must never
 * masquerade as "no such surface exists".
 */
function searchRepo(label: string, pattern: string, paths: string[]) {
  try {
    const out = execFileSync('git', ['grep', '-n', '-i', '-E', pattern, '--', ...paths],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return { label, pattern, paths, exitCode: 0, hits: out.trim().split('\n').filter(Boolean) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return { label, pattern, paths, exitCode: 1, hits: [] as string[] };
    throw err;
  }
}
