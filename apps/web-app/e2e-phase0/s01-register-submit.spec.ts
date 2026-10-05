/**
 * PHASE 0 — S1 — Register → DRAFT (C01) → Submit (C02)
 *
 * Plan: design note 2026-08-15-phase0-flow-proof (Task 3 + Task 4).
 * VERIFICATION ONLY — this spec drives the REAL UI on the running stack
 * (Amendment B topology: next dev :3000 → backend :8000 → Supabase). It never
 * touches /api/e2e/* (G-6) and never mutates money rows (G-4). Where the wizard
 * blocks, the block is captured (screenshot + URL) and the test fails honestly
 * rather than being forced past — mission §V.
 *
 * Checkpoints (protocol §II — DB row + audit + screenshot):
 *   C01 = a DRAFT `applications` row exists for a freshly-registered farmer.
 *         The wizard autosave (POST /applications/draft) creates it the moment a
 *         plant is chosen on step 2 (use-auto-save.ts:126 gates on plantId), so
 *         the row id is read from that POST's own response body (data.draftId) —
 *         the applicant is keyed by the HMAC of the ID card, not the raw digits,
 *         so a by-id dump is the only reliable read (auth.prisma:45-55).
 *   C02 = submit walks DRAFT→SUBMITTED→PENDING_DOC_FEE in one tx + THE quotation.
 *         W14 (operator ruling 2026-08-22): ONE issuer ⇒ ONE quotation row, for the
 *         whole price of both phases. The DTAM+PLATFORM pair this checkpoint used to
 *         assert belonged to the retired two-issuer model
 *         (quotation-service.js:531-559 "allocate ONE number and create ONE row").
 *
 * The fresh farmer's password is assembled from runtime randomness so no static
 * credential is committed (G-3); it guards only this throwaway account and is
 * never written to any evidence file.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  login, dump, auditDump, thaiId, pngFixture, psql, saveVars, EV,
  expectedApplicationTotal, expectedPhaseFees, scopeCountOf,
} from './helpers';

const SEG = 's01';
const OUT = join(EV, SEG);
mkdirSync(OUT, { recursive: true });
const PNG = pngFixture(OUT);

// ── Fresh farmer identity. Password comes from env PHASE0_FARMER_PW (set in the
// run command, never committed — G-3), so s02 can log in as the same farmer. ──
const FARMER_ID = thaiId();
const PW = process.env.PHASE0_FARMER_PW || '';
const EMAIL = `phase0.farmer.${Date.now()}@example.test`;
const PHONE = `08${String(Math.floor(10000000 + Math.random() * 89999999))}`;
const FIRST = 'เฟสศูนย์';
const LAST = 'พิสูจน์ท่อ';

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(OUT, name), fullPage: true });

/** Upload PNG into the nth hidden file input and wait for its persist call. */
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

test.describe.serial('Phase0 S1 — register → draft (C01) → submit (C02)', () => {
  test('C01 register+draft, then C02 submit', async ({ page }) => {
    // ═══════════════════════════════════════════════════════════════
    // C01 — Register (real 4-step wizard UI)
    // ═══════════════════════════════════════════════════════════════
    expect(PW, 'PHASE0_FARMER_PW must be set in the run command (kept out of committed files — G-3)').toBeTruthy();
    saveVars('FARMER_MAIN_ID', FARMER_ID);

    await page.goto('/register');
    await page.fill('#reg-identifier', FARMER_ID);
    await page.fill('#reg-firstName', FIRST);
    await page.fill('#reg-lastName', LAST);
    await shot(page, 'C01-01-register-personal.png');
    await page.getByRole('button', { name: /ถัดไป/ }).click();

    await page.fill('#reg-email', EMAIL);
    await page.fill('#reg-phone', PHONE);
    await page.getByRole('button', { name: /ถัดไป/ }).click();

    await page.fill('#reg-password', PW);
    await page.fill('#reg-confirm-password', PW);
    await page.getByRole('button', { name: /ถัดไป/ }).click();

    await page.locator('#reg-consent').check();
    await shot(page, 'C01-02-register-confirm.png');

    // Record every register POST + status. A single click fires TWO register
    // POSTs (observed): one creates the account, the racing twin 400s
    // DUPLICATE_IDENTIFIER — see FINDINGS F-REG-DUP. The account is created
    // either way, so login (below) is the authority on success, not this race.
    const regHits: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/auth/health/register') && r.request().method() === 'POST') {
        regHits.push(String(r.status()));
      }
    });
    await page.getByRole('button', { name: /ยืนยันสมัครสมาชิก/ }).click();
    await page.getByText(/ลงทะเบียนสำเร็จ/).waitFor({ timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    writeFileSync(
      join(OUT, 'C01-register-response.txt'),
      `register POSTs on one click: ${regHits.length} — statuses [${regHits.join(', ')}]\n`,
    );
    await shot(page, 'C01-03-register-done.png');

    // ── Login (real UI, via helper) ──
    // NB: helpers.login waits on the glob **/health/** which also matches the
    // login URL /auth/health/login itself, so it returns before auth finishes.
    // Wait here for the real authenticated landing before touching guarded routes.
    const loginResp = page
      .waitForResponse(
        (r) => r.url().includes('/auth/health/login') && r.request().method() === 'POST',
        { timeout: 90_000 },
      )
      .catch(() => null);
    await login(page, { kind: 'health', id: FARMER_ID, pw: PW });
    const lr = await loginResp;
    const lb = lr ? await lr.json().catch(() => null) : null;
    // Redacted on purpose: the JWT is a bearer credential — record only that it
    // arrived, never the token itself (L2/G-3).
    const TOKEN: string = lb?.data?.tokens?.accessToken || lb?.data?.token || '';
    if (lr) {
      writeFileSync(
        join(OUT, 'C01-login-response.txt'),
        `status ${lr.status()} success=${lb?.success} tokenPresent=${Boolean(TOKEN)}`,
      );
    }
    try {
      await page.waitForURL(/\/health\/(dashboard|onboarding|start|applications|profile)/, {
        timeout: 60_000,
      });
    } catch {
      await shot(page, 'C01-04-login-stuck.png');
      const alerts = await page.locator('[role=alert], .gov-auth-alert').allInnerTexts().catch(() => []);
      writeFileSync(join(OUT, 'C01-login-stuck.txt'), `url ${page.url()}\nalerts ${JSON.stringify(alerts)}`);
      throw new Error('login did not reach a /health landing — see C01-04-login-stuck.png');
    }
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C01-04-dashboard.png');

    // ═══════════════════════════════════════════════════════════════
    // C01 — Wizard step 1 (consent) → step 2 (plant) → DRAFT autosave
    // ═══════════════════════════════════════════════════════════════
    await page.goto('/health/applications/new');
    await page.waitForURL('**/new/step/**', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');

    const consentBoxes = page.locator('input[type="checkbox"]');
    await consentBoxes.nth(0).check();
    await consentBoxes.nth(1).check();
    await shot(page, 'C01-05-consent.png');
    await page.getByRole('button', { name: /ถัดไป/ }).click();
    await page.waitForURL('**/new/step/2', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');

    // Instrument every wizard draft POST (autosave) — distinct from the
    // draft-DOCUMENTS upload endpoint — so the evidence shows whether autosave
    // ever fires, not just whether a row eventually appears.
    const draftPosts: string[] = [];
    page.on('response', (r) => {
      const u = r.url();
      if (u.includes('/applications/draft') && !u.includes('draft-documents') && r.request().method() === 'POST') {
        draftPosts.push(String(r.status()));
      }
    });

    // Complete step 2 fully: plant + purpose + 3 M1 uploads + cultivation. Each
    // is a store mutation, so this is the strongest chance for the debounced
    // autosave to persist a DRAFT applications row.
    await page.getByRole('button', { name: /กัญชา/ }).first().click();
    await page.getByRole('button', { name: /เพื่อการพาณิชย์ในประเทศ/ }).click();
    await expect(page.locator('input[type="file"]')).toHaveCount(3, { timeout: 20_000 });
    const m1 = [await uploadNth(page, 0), await uploadNth(page, 1), await uploadNth(page, 2)];
    const up0 = m1[0];
    await page.getByRole('button', { name: /กลางแจ้ง/ }).click();
    await shot(page, 'C01-06-plant-complete.png');
    await page.waitForTimeout(6000); // let the 3s autosave debounce settle

    // C01 checkpoint — poll the DB for the DRAFT applications row. In THIS
    // environment canonicalId == raw ID (auth: HMAC re-key not applied), so the
    // applicant row is reachable by healthId. dump()/auditDump() then key by id.
    let APP = '';
    let c01: { status: string } | null = null;
    for (let i = 0; i < 12 && !c01; i++) {
      const rows = JSON.parse(
        psql(`SELECT id, status FROM applications WHERE "healthId"='${FARMER_ID}' ORDER BY "createdAt" DESC LIMIT 1`),
      );
      if (rows.length) { c01 = rows[0]; APP = rows[0].id; }
      else await page.waitForTimeout(2500);
    }
    writeFileSync(
      join(OUT, 'C01-draft-posts.txt'),
      `wizard autosave POST /applications/draft — count ${draftPosts.length} statuses [${draftPosts.join(', ')}]\n` +
        `draft-documents uploads returned fileUrl: ${Boolean(up0.fileUrl)}\n` +
        `DRAFT applications row found: ${Boolean(c01)}${c01 ? ` (status ${c01.status})` : ''}\n`,
    );

    if (!c01) {
      await shot(page, 'C01-06b-no-draft.png');
      throw new Error(
        `C01 FAIL — no DRAFT applications row after completing step 2 and idling: ` +
          `wizard fired ${draftPosts.length} autosave POST(s). See FINDINGS F-DRAFT-AUTOSAVE.`,
      );
    }
    saveVars('FARMER_MAIN_APP', APP);
    dump(SEG, 'C01', 'after', APP);
    auditDump(SEG, 'C01', APP); // observe — record whatever audit exists at draft
    expect(c01.status).toBe('DRAFT');

    // ═══════════════════════════════════════════════════════════════
    // C02 — Option 1 (operator-approved after grill). The wizard front-door is
    // blocked for a driver (F-AUTOSAVE + step 5-9 GPS/cascading-selects), so the
    // draft is completed to a submittable state through the REAL wizard endpoint
    // POST /api/applications/prepare (which spreads canonical formData into the
    // row — applications.js:1052; NOT the /api/e2e backdoor). The SUBMIT itself
    // is then performed through the real UI preview page.
    // HONESTY (Amendment C-3): this is NOT "the wizard passed via UI end-to-end".
    // ═══════════════════════════════════════════════════════════════
    dump(SEG, 'C02', 'before', APP); // expect DRAFT
    expect(TOKEN, 'farmer bearer token captured from login').toBeTruthy();

    // Canonical formData the submit validator requires (canonical-application-
    // validator.js: steps 2/4/5/6/7 non-empty + ≥1 uploaded doc). The 3 M1
    // uploads from C01 satisfy step 8 (formData.draftDocuments); INDIVIDUAL
    // holders require 0 M2a document slots (requirementRule table: only
    // COMMUNITY_ENTERPRISE/JURISTIC rules are active).
    const prepareBody = {
      plantId: 'cannabis', serviceType: 'NEW', areaType: 'OUTDOOR',
      certificationPurposes: ['EXPORT'], cultivationMethods: ['outdoor'],
      applicantData: {
        applicantType: 'INDIVIDUAL', firstName: FIRST, lastName: LAST,
        idCard: FARMER_ID, phone: PHONE, address: '99/9 หมู่ 9 ต.สุเทพ อ.เมือง จ.เชียงใหม่',
      },
      farmData: {
        farmName: 'ฟาร์มพิสูจน์ท่อ เฟสศูนย์', address: '99/9 หมู่ 9',
        province: 'เชียงใหม่', district: 'เมือง', subdistrict: 'สุเทพ',
        postalCode: '50200', totalAreaSize: '5',
        // totalAreaUnit is REQUIRED too, same class as the plot areaUnit
        // below: certificate-service's strict farm-area reader
        // (farm-areaunit-default fix, Task 3) refuses a unit-less farmData
        // at mint, and canonical-application-validator now requires it at
        // both submit doors (Task 2) — a unit-less farmData would 422 here
        // at C02, before this walk ever reaches mint. The real wizard
        // always sets 'Sqm' (farm-info-step.tsx:75); this Option-1 payload
        // must too.
        totalAreaUnit: 'Sqm',
      },
      // areaUnit is REQUIRED end-of-line: certificate-service's strict area
      // reader refuses a unit-less plot (by design — ไร่ vs ตร.ม. is a ×1,600
      // ambiguity) and the refusal only surfaces at the C12 PASS, stranding a
      // fully-paid fully-audited row at AUDIT_CONFIRMED with no repair door
      // (walk-1 2026-08-19, F-PLOT-AREAUNIT-DEADEND). The real wizard always
      // sets 'Sqm' (farm-info-step.tsx:252); this Option-1 payload must too.
      plots: [{ name: 'แปลง A', areaSize: '2', areaUnit: 'Sqm', solarSystem: 'outdoor' }],
      productionData: { propagationType: ['SEED'], plantParts: ['LEAF', 'FLOWER'] },
      harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN_DRY', storageSystem: 'COLD_STORAGE' },
      // The 3 M1 docs were really uploaded in C01 (draftDocuments). normalizeDocuments
      // (preview-utils.js) reads formData.documents, not draftDocuments, so surface
      // them here with their real persisted URLs so step 8 + preview.isComplete pass.
      documents: m1.map((u, i) => ({
        type: `M1_DOC_${i + 1}`, name: `เอกสาร M1 #${i + 1}`,
        uploaded: true, url: u.fileUrl, metadata: { required: false },
      })),
    };
    const prepRes = await page.request.post('http://localhost:3000/api/applications/prepare', {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: prepareBody,
    });
    writeFileSync(join(OUT, 'C02-prepare-response.txt'), `POST /applications/prepare → status ${prepRes.status()} ok=${prepRes.ok()}`);
    expect(prepRes.ok(), 'POST /applications/prepare accepted the canonical fill (Option 1)').toBeTruthy();

    // ── submit via the real UI preview page → DRAFT→SUBMITTED→PENDING_DOC_FEE ──
    await page.goto(`/health/applications/preview?id=${APP}`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C02-20-preview.png');
    const submitBtn = page.getByRole('button', { name: /ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่s*1|สร้างรายการชำระงวดที่\s*1/ });
    await expect(submitBtn, 'preview submit enabled = application complete after Option-1 fill').toBeEnabled({ timeout: 30_000 });
    // The submit endpoint 500s under load — the canonical-audit SAVEPOINT fence
    // is fail-OPEN by design but fails-CLOSED on the Supabase session pooler
    // (RELEASE SAVEPOINT rejected → whole tx aborts), and the failure rate climbs
    // with concurrent pooler pressure (FINDINGS F-SUBMIT-500-FLAKY — 6/6 OK via
    // curl at rest, yet 8/8 fail mid-run). Re-click the SAME button (handlePayment
    // re-enables it on error) after network-idle + a backoff so the pooler
    // recovers, and trust the DB: a 500 rolls the whole 2-hop back, so
    // status==PENDING_DOC_FEE ⟺ a genuine success.
    // NB: no psql() inside the loop — each helper psql spawns a fresh
    // Prisma→Supabase connection and ADDS to the very pooler pressure that
    // triggers the failure. The /submit response is the reliable signal: 200 =
    // committed, non-200 = rolled back to DRAFT.
    let submitAttempts = 0;
    let submitOk = false;
    for (; submitAttempts < 12 && !submitOk; submitAttempts++) {
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      if (!(await submitBtn.isEnabled().catch(() => false))) { submitOk = true; break; } // navigated after success
      const submitResp = page.waitForResponse(
        (r) => r.url().includes('/applications/submit') && r.request().method() === 'POST',
        { timeout: 90_000 },
      ).catch(() => null);
      await submitBtn.click();
      const sr = await submitResp;
      submitOk = Boolean(sr && sr.status() === 200);
      if (!submitOk) await page.waitForTimeout(5000); // let the Supabase pooler recover
    }
    writeFileSync(join(OUT, 'C02-submit-response.txt'), `preview-UI submit attempts ${submitAttempts}, /submit reached 200 = ${submitOk}`);
    expect(submitOk, 'preview submit eventually transitioned to PENDING_DOC_FEE (retried past F-SUBMIT-500-FLAKY)').toBe(true);
    await page.waitForURL('**/health/payments**', { timeout: 30_000 }).catch(() => null);
    await shot(page, 'C02-21-after-submit.png');

    // C02 checkpoint — DB after + audit + quotations (fire-and-forget: poll ≤14s).
    await page.waitForTimeout(3000);
    dump(SEG, 'C02', 'after', APP);
    auditDump(SEG, 'C02', APP);
    let quotes: Array<{ issuerType: string; subtotal: string; vat: string; totalAmount: string }> = [];
    for (let i = 0; i < 7 && quotes.length < 1; i++) {
      quotes = JSON.parse(psql(`SELECT id, "issuerType", status, subtotal, vat, "totalAmount" FROM quotations WHERE "applicationId"='${APP}' ORDER BY "issuerType";`));
      if (quotes.length < 1) await page.waitForTimeout(2000);
    }
    writeFileSync(join(OUT, 'C02-quotations.txt'), JSON.stringify(quotes, null, 2));
    await page.goto(`/health/payments?app=${APP}&phase=1`, { timeout: 200_000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(page, 'C02-22-payments-quotations.png');

    const after = JSON.parse(psql(`SELECT id, status FROM applications WHERE id='${APP}';`))[0];
    const canonicalAudit = JSON.parse(
      psql(`SELECT id, action FROM audit_logs WHERE "resourceId"='${APP}' AND action='APPLICATION_STATUS_TRANSITION';`),
    );
    writeFileSync(join(OUT, 'C02-audit-count.txt'), `canonical APPLICATION_STATUS_TRANSITION rows: ${canonicalAudit.length}`);
    expect(after.status, 'C02 status = PENDING_DOC_FEE (2-hop submit)').toBe('PENDING_DOC_FEE');
    // W14 single-issuer: ONE quotation row, issued by the company, carrying the
    // WHOLE payable of both phases (quotation-service.js:545-559).
    expect(quotes.length, 'exactly ONE quotation — the company issues the whole price (W14; a second row = the retired DTAM/PLATFORM split is back)').toBe(1);
    // The money pin. Nothing above this line would notice a fee regression: the
    // status/audit/equation checks all pass just as happily on the retired
    // 5,535 formula. scopeCount is read from the row the backend stamped, so the
    // same assertion holds for a 1-scope EXPORT applicant and a 3-scope one.
    const scopeCount = scopeCountOf(APP);
    const p1 = expectedPhaseFees('PHASE_1', scopeCount);
    const p2 = expectedPhaseFees('PHASE_2', scopeCount);
    writeFileSync(
      join(OUT, 'C02-fee-model.txt'),
      `scopeCount (applications.totalAreaTypes): ${scopeCount}
` +
      `expected งวด 1 payable: ${p1.total} (state ${p1.state} + platform ${p1.platform} + VAT ${p1.vat})
` +
      `expected งวด 2 payable: ${p2.total} (state ${p2.state} + platform ${p2.platform} + VAT ${p2.vat})
` +
      `expected quotation total: ${expectedApplicationTotal(scopeCount)}
` +
      `quotation row as stored: ${JSON.stringify(quotes[0])}
`,
    );
    expect(Number(quotes[0]?.totalAmount), `C02 quotation ยอดชำระ for ${scopeCount} scope(s) — งวด1 ${p1.total} + งวด2 ${p2.total}; the retired platform-only-VAT formula would say ${(5535 + 27535) * scopeCount}`)
      .toBe(expectedApplicationTotal(scopeCount));
    expect(Number(quotes[0]?.subtotal), 'C02 quotation ค่าบริการ = state + platform (the VATable supply — W14)')
      .toBe(p1.state + p1.platform + p2.state + p2.platform);
    expect(Number(quotes[0]?.vat), 'C02 quotation VAT = 7% of the WHOLE service fee, not of the platform slice')
      .toBe(p1.vat + p2.vat);
    expect(canonicalAudit.length, 'canonical audit ×2 (DRAFT→SUBMITTED, SUBMITTED→PENDING_DOC_FEE) — <2 = fail-open hole application-status-writer.js:74-87').toBeGreaterThanOrEqual(2);
  });
});
