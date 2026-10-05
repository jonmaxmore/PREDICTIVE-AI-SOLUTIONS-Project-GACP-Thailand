/**
 * G4 · A01 — farmer A registers for real, then drives the application wizard.
 *
 * GOALS.md §G4.0 rule 1: every row must come from a real press. Phase 0 did not meet
 * that bar for the wizard — it filled steps 3-9 through POST /api/applications/prepare
 * and said so in its own comment ("HONESTY (Amendment C-3): this is NOT the wizard
 * passed via UI end-to-end", e2e-phase0/s01-register-submit.spec.ts:216-223). The reason
 * recorded there was "step 5-9 GPS/cascading-selects", but the farm step accepts typed
 * coordinates (farm-info-step.tsx:275) and Playwright can grant real geolocation, so the
 * premise is worth testing before it is inherited.
 *
 * This spec therefore drives the wizard forward one step at a time and DUMPS what each
 * step actually renders. Where it advances, it advances by pressing. Where it cannot,
 * the dump names the control that stopped it — a finding about the product, not a reason
 * to route around the wizard.
 *
 * It is also an LQA pass (operator, 2026-08-25: language, Thai AND English): every screen
 * is captured in both languages and checked against the repo's own copy rules.
 *
 * Resumable by design: the applicant's identity is minted once into VARS and reused, and
 * registration is skipped when the account already exists. A twelve-stage journey gets
 * re-run in pieces, and a spec that registers a new farmer on each attempt would quietly
 * break "there are exactly two applicants" while every run still went green.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { FARMERS, assertPlotsSumToFarm, pw, seg, shot, saveVar, readVars, dumpControls, g4psql, g4Login, farmerId, waitForStepReady, pickFarmer } from './g4-helpers';
import { lqaCapture } from './lqa';
import { fillStep, answersFor } from './wizard-fill';
import { fillFarmInfoStep, fillProductionStep, fillQualityControlStep, fillDocumentsStep, fillReviewAndSubmit } from './wizard-steps';

const P = FARMERS[pickFarmer()];
const OUT = seg('a01');
const FIXTURES = seg('a01/fixtures');

const FARMER_ID = farmerId(P);
const EMAIL = (() => {
  const k = `${P.varPrefix}_EMAIL`;
  const existing = readVars()[k];
  if (existing) return existing;
  // The key names the farmer: farmer B's first walk (2026-08-27) was minted as
  // "g4.farmer.a…" because this literal never knew who it was registering.
  const v = `g4.farmer.${P.key.toLowerCase()}.${Date.now()}@gacp.local`;
  saveVar(k, v);
  return v;
})();
const PHONE = '0812345678';

/** Text this applicant typed. It stays Thai in English mode by definition — not a translation miss. */
const OWN = [P.firstName, P.lastName, P.farmName, P.address.province, P.address.district, P.address.subdistrict];

const ANSWERS = answersFor(P, FARMER_ID, EMAIL, PHONE);

/** Does this applicant already exist? Re-runs must not create a second farmer A. */
function alreadyRegistered(): boolean {
  const rows = JSON.parse(g4psql(`SELECT id FROM users WHERE "healthId"='${FARMER_ID}';`));
  return rows.length > 0;
}

test.describe.serial('G4 A01 — farmer A: register → wizard', () => {
  test('A01 register through the real 4-step form, then log in', async ({ page }) => {
    assertPlotsSumToFarm(P);
    const password = pw(P);

    if (alreadyRegistered()) {
      // Not a skip: the walk still proves the account works by logging into it.
      writeFileSync(join(OUT, 'A01-resumed.txt'), `farmer A already registered — resuming into the existing account\n`);
      await g4Login(page, { kind: 'health', id: FARMER_ID, pw: password });
      await shot(page, OUT, 'A01-04-landed.png');
      await lqaCapture(page, OUT, 'A01-04-landing', OWN);
      return;
    }

    await page.goto('/register');
    await lqaCapture(page, OUT, 'A01-01-register-step1', OWN);
    await page.fill('#reg-identifier', FARMER_ID);
    await page.fill('#reg-firstName', P.firstName);
    await page.fill('#reg-lastName', P.lastName);
    await shot(page, OUT, 'A01-01-personal.png');
    await page.getByRole('button', { name: /ถัดไป/ }).click();

    await lqaCapture(page, OUT, 'A01-02-register-step2-contact', OWN);
    await page.fill('#reg-email', EMAIL);
    await page.fill('#reg-phone', PHONE);
    await page.getByRole('button', { name: /ถัดไป/ }).click();

    await lqaCapture(page, OUT, 'A01-03-register-step3-password', OWN);
    await page.fill('#reg-password', password);
    await page.fill('#reg-confirm-password', password);
    await page.getByRole('button', { name: /ถัดไป/ }).click();

    await page.locator('#reg-consent').check();
    await shot(page, OUT, 'A01-02-confirm.png');
    await lqaCapture(page, OUT, 'A01-04-register-step4-confirm', OWN);

    // Record the REQUEST as well as the response. The first G4 attempt failed with a 400
    // the UI reported as "Request timeout. Please try again" — a message that named the
    // wrong cause and left nothing to diagnose (the true cause was Supabase session-pooler
    // exhaustion). What the browser actually sent is the only thing that separates a bad
    // payload from a backend that could not answer.
    const regHits: string[] = [];
    page.on('response', async (r) => {
      if (!r.url().includes('/auth/health/register') || r.request().method() !== 'POST') return;
      let sent: unknown = null;
      try {
        sent = JSON.parse(r.request().postData() || '{}');
        for (const k of ['password', 'confirmPassword']) {
          if (sent && typeof sent === 'object' && k in (sent as Record<string, unknown>)) {
            (sent as Record<string, unknown>)[k] = '<redacted>';
          }
        }
      } catch { sent = r.request().postData()?.slice(0, 200) ?? null; }
      const body = await r.text().catch(() => '');
      regHits.push(`status ${r.status()}\n  sent: ${JSON.stringify(sent)}\n  got : ${body.slice(0, 600)}`);
    });
    await page.getByRole('button', { name: /ยืนยันสมัครสมาชิก/ }).click();
    await page.getByText(/ลงทะเบียนสำเร็จ/).waitFor({ timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const alerts = await page.locator('[role=alert], .gov-auth-alert').allInnerTexts().catch(() => []);
    writeFileSync(
      join(OUT, 'A01-register-response.txt'),
      `register POSTs on one click: ${regHits.length}\n${regHits.join('\n')}\n\non-screen alerts: ${JSON.stringify(alerts)}\n`,
    );
    await shot(page, OUT, 'A01-03-registered.png');

    await g4Login(page, { kind: 'health', id: FARMER_ID, pw: password });
    await shot(page, OUT, 'A01-04-landed.png');
    await lqaCapture(page, OUT, 'A01-04-landing', OWN);

    const rows = JSON.parse(g4psql(`SELECT id, role, status FROM users WHERE "healthId"='${FARMER_ID}';`));
    writeFileSync(join(OUT, 'A01-user-row.txt'), JSON.stringify(rows, null, 2));
    expect(rows.length, 'exactly one applicant row exists for this national ID').toBe(1);
  });

  test('A02 drive the wizard: consent → plant (EXPORT, กลางแจ้ง) → as far as pressing takes it', async ({ page }) => {
    await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });

    const timings: string[] = [];
    await page.goto('/health/applications/new');
    await page.waitForURL('**/new/step/**', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');

    // ── step 1 · consent ──────────────────────────────────────────────────────
    // Wait for the step to finish mounting BEFORE reading or pressing. Skipping this
    // is how the first attempt failed: it counted zero checkboxes behind the loading
    // spinner, consented to nothing, and was correctly refused by the wizard.
    const t1 = await waitForStepReady(page);
    timings.push(`step 1 (consent) ready in ${t1}ms`);
    await dumpControls(page, OUT, 'A02-step1-consent.json');
    await lqaCapture(page, OUT, 'A02-wizard-step1-consent', OWN);

    const consents = page.locator('input[type="checkbox"]');
    const nConsent = await consents.count();
    expect(nConsent, 'the consent step renders at least one thing to consent to').toBeGreaterThan(0);
    for (let i = 0; i < nConsent; i++) await consents.nth(i).check();
    await shot(page, OUT, 'A02-05-consent.png');

    await page.getByRole('button', { name: /ถัดไป/ }).click();
    try {
      await page.waitForURL('**/new/step/2', { timeout: 200_000 });
    } catch {
      // Do not retry, and do not force it forward. Record what the user would be
      // looking at and stop — a step that refuses to advance is the finding.
      await shot(page, OUT, 'A02-05b-consent-STUCK.png');
      const alerts = await page.locator('[role=alert]').allInnerTexts().catch(() => []);
      writeFileSync(join(OUT, 'A02-STUCK-step1.txt'),
        `pressing ถัดไป on the consent step did not reach step 2\n` +
        `url: ${page.url()}\ncheckboxes found: ${nConsent}\non-screen alerts: ${JSON.stringify(alerts)}\n`);
      throw new Error(`wizard step 1 refused to advance — see A02-STUCK-step1.txt (alerts: ${JSON.stringify(alerts)})`);
    }
    await waitForStepReady(page);

    // ── step 2 · plant + purpose + M1 documents + cultivation ─────────────────
    // Where farmer A and farmer B diverge, and the ONLY place the bill is decided:
    // the fee service charges per unique cultivation method.
    timings.push('step 2 (plant) reached');
    await dumpControls(page, OUT, 'A02-step2-plant-before.json');
    await lqaCapture(page, OUT, 'A02-wizard-step2-plant', OWN);
    await page.getByRole('button', { name: /กัญชา/ }).first().click();
    await page.getByRole('button', { name: new RegExp(P.purposeLabelTH) }).click();

    // Real, readable Thai PDFs — one per ภท. slot, carrying this applicant's own details.
    // The first attempt uploaded a 70-byte 1×1 pixel into all three and the product took
    // it; that is recorded as a product finding, but the walk must still hand the document
    // reviewer something a human can actually read (GOALS §G4.0 rule 2).
    await expect(page.locator('input[type="file"]')).toHaveCount(3, { timeout: 30_000 });
    const m1 = await fillStep(page, {
      step: 'A02-step2-documents', profile: P, answers: ANSWERS,
      nationalId: FARMER_ID, outDir: OUT, fixtureDir: FIXTURES,
    });
    writeFileSync(join(OUT, 'A02-m1-uploads.txt'), JSON.stringify(m1.uploaded, null, 2));
    expect(m1.uploaded.length, 'all three ภท. document slots received a real PDF').toBe(3);

    for (const label of P.cultivationLabelsTH) {
      await page.getByRole('button', { name: new RegExp(label) }).click();
    }
    await shot(page, OUT, 'A02-06-plant-complete.png');
    await dumpControls(page, OUT, 'A02-step2-plant-after.json');
    await page.waitForTimeout(6000); // the wizard autosaves on a 3s debounce

    // The DRAFT row is the proof the wizard persisted anything at all.
    //
    // A cached id is only reused when it still belongs to THIS farmer. The cache exists so
    // a re-run resumes instead of minting a second application, but FARMER_A_ID is
    // regenerated per run while FARMER_A_APP was not re-checked — so a second walk carried
    // yesterday's application forward beside today's farmer, and A03 read that row and
    // found it CERTIFIED where it expected PENDING_DOC_FEE. The two VARS describe one
    // farmer or they describe nobody; ownership is what ties them together, so ownership is
    // what the cache has to prove before it is trusted.
    let APP = readVars()[`${P.varPrefix}_APP`] || '';
    if (APP) {
      const owned = JSON.parse(g4psql(
        `SELECT id FROM applications WHERE id='${APP}' AND "healthId"='${FARMER_ID}';`,
      ));
      if (!owned.length) { APP = ''; }
    }
    for (let i = 0; i < 12 && !APP; i++) {
      const rows = JSON.parse(g4psql(`SELECT id, status FROM applications WHERE "healthId"='${FARMER_ID}' ORDER BY "createdAt" DESC LIMIT 1;`));
      if (rows.length) { APP = rows[0].id; saveVar(`${P.varPrefix}_APP`, APP); }
      else await page.waitForTimeout(2500);
    }
    expect(APP, 'the wizard created a DRAFT application row from real presses').toBeTruthy();

    // ── steps 3..N · press forward, recording what each step renders ───────────
    // No assertion on how far this gets: the point is to LEARN where the real wizard
    // stops, with the DOM as the witness. The walk is completed by the next spec once
    // these dumps say what each step needs.
    const walked: string[] = [];
    let submitOutcome: { status?: string; total: number; vat: number } | null = null;
    for (let step = 3; step <= 12; step++) {
      const before = page.url();
      const tReady = await waitForStepReady(page).catch(() => -1);
      timings.push(`step ${step} ready in ${tReady}ms`);
      const d = await dumpControls(page, OUT, `A02-step${step}.json`);
      await shot(page, OUT, `A02-step${step}.png`);
      await lqaCapture(page, OUT, `A02-wizard-step${step}`, OWN);
      walked.push(
        `step ${step} @ ${d.url}\n` +
        `  headings: ${d.headings.join(' | ')}\n` +
        `  required : ${d.fields.filter((f) => f.required).map((f) => f.id || f.name || f.label).join(', ') || '(none flagged required)'}\n` +
        `  fields   : ${d.fields.map((f) => `${f.tag}${f.type ? ':' + f.type : ''}#${f.id || f.name || '?'}`).join(', ')}\n` +
        `  buttons  : ${d.buttons.map((b) => `${b.text}${b.disabled ? '(disabled)' : ''}`).join(' | ')}\n` +
        `  alerts   : ${d.alerts.join(' | ') || '-'}\n`,
      );
      // Answer what this applicant can truthfully answer. A required control with no
      // answer available halts the walk — it is a question for a human, and inventing a
      // value would turn a green run into fiction (operator ruling, 2026-08-25).
      //
      // Steps 5 and 6 get bespoke drivers built from their own source: their dropdowns
      // are Radix comboboxes, their number/file inputs have no label association, and
      // step 5's district control MORPHS after the province is chosen — choreography a
      // generic filler misreads (it once uploaded a document into the water section).
      if (/\/step\/5$/.test(page.url())) {
        // A driver failure must still leave the walk log and a screenshot behind — the
        // last run threw here and took its own evidence with it, leaving a stale log
        // that misreported the state of the step.
        try {
          const acts = await fillFarmInfoStep(page, P, FARMER_ID, OUT, FIXTURES);
          walked.push(acts.map((a) => `  ${a}`).join('\n') + '\n');
        } catch (err) {
          await shot(page, OUT, `A02-step${step}-DRIVER-FAILED.png`);
          walked.push(`  → STOPPED: step-5 driver failed: ${String((err as Error).message).split('\n')[0].slice(0, 200)}\n`);
          break;
        }
      } else if (/\/step\/6$/.test(page.url())) {
        try {
          const acts = await fillProductionStep(page, P, OUT);
          walked.push(acts.map((a) => `  ${a}`).join('\n') + '\n');
        } catch (err) {
          await shot(page, OUT, `A02-step${step}-DRIVER-FAILED.png`);
          walked.push(`  → STOPPED: step-6 driver failed: ${String((err as Error).message).split('\n')[0].slice(0, 200)}\n`);
          break;
        }
      } else if (/\/step\/7$/.test(page.url())) {
        try {
          const acts = await fillQualityControlStep(page, OUT);
          walked.push(acts.map((a) => `  ${a}`).join('\n') + '\n');
        } catch (err) {
          await shot(page, OUT, `A02-step${step}-DRIVER-FAILED.png`);
          walked.push(`  → STOPPED: step-7 driver failed: ${String((err as Error).message).split('\n')[0].slice(0, 200)}\n`);
          break;
        }
      } else if (/\/step\/8$/.test(page.url())) {
        try {
          const acts = await fillDocumentsStep(page, P, FARMER_ID, OUT, FIXTURES);
          walked.push(acts.map((a) => `  ${a}`).join('\n') + '\n');
        } catch (err) {
          await shot(page, OUT, `A02-step${step}-DRIVER-FAILED.png`);
          walked.push(`  → STOPPED: step-8 driver failed: ${String((err as Error).message).split('\n')[0].slice(0, 200)}\n`);
          break;
        }
      } else if (/\/step\/9$/.test(page.url())) {
        // The last step submits through the preview page and ends the wizard — the loop's
        // own "press ถัดไป" step no longer applies past this point.
        try {
          const { log: acts, submitted } = await fillReviewAndSubmit(page, OUT);
          walked.push(acts.map((a) => `  ${a}`).join('\n') + '\n');
          await shot(page, OUT, submitted ? 'A02-step9-SUBMITTED.png' : 'A02-step9-BLOCKED.png');
          if (submitted) {
            // The DB is the authority on what the press actually did.
            const rows = JSON.parse(g4psql(
              `SELECT status, "applicationNumber", "cultivationScopeCount" FROM applications WHERE "healthId"='${FARMER_ID}' ORDER BY "createdAt" DESC LIMIT 1;`,
            ));
            walked.push(`  หลังยื่น: status=${rows[0]?.status} เลขคำขอ=${rows[0]?.applicationNumber} scope=${rows[0]?.cultivationScopeCount}\n`);
            let quotes: Array<{ subtotal: string; vat: string; totalAmount: string }> = [];
            for (let i = 0; i < 7 && quotes.length < 1; i++) {
              quotes = JSON.parse(g4psql(`SELECT subtotal, vat, "totalAmount" FROM quotations WHERE "applicationId" IN (SELECT id FROM applications WHERE "healthId"='${FARMER_ID}');`));
              if (quotes.length < 1) await page.waitForTimeout(2000);
            }
            walked.push(`  ใบเสนอราคา: ${JSON.stringify(quotes)}\n`);
            submitOutcome = { status: rows[0]?.status, total: Number(quotes[0]?.totalAmount), vat: Number(quotes[0]?.vat) };
          }
        } catch (err) {
          await shot(page, OUT, `A02-step${step}-DRIVER-FAILED.png`);
          walked.push(`  → step-9/submit: ${String((err as Error).message).split('\n')[0].slice(0, 250)}\n`);
        }
        // Money pins live OUTSIDE the driver's try/catch: farmer B's first walk (2026-08-27)
        // turned a failed pin into the log line "→ step-9/submit: quotation total = 35,310 …"
        // and the test stayed green — a swallowed assertion is a green mask. The price is
        // per cultivation scope (G4.2: farmer A 1 scope, farmer B 3): 5,885 + 29,425 = 35,310
        // each, VAT 7% of the whole service fee = 2,310 each; the retired platform-only-VAT
        // formula would say 33,070 per scope.
        if (submitOutcome) {
          const scope = P.cultivationMethods.length;
          expect(submitOutcome.status, 'submit walked DRAFT→SUBMITTED→PENDING_DOC_FEE').toBe('PENDING_DOC_FEE');
          expect(submitOutcome.total, `quotation total = 35,310 × ${scope} scope(s)`).toBe(35_310 * scope);
          expect(submitOutcome.vat, `VAT = 2,310 × ${scope} scope(s)`).toBe(2_310 * scope);
          walked.push(`  money pin: total ${submitOutcome.total} = 35,310 × ${scope}, VAT ${submitOutcome.vat} = 2,310 × ${scope}\n`);
        }
        break;
      } else {
        const fill = await fillStep(page, {
          step: `A02-step${step}`, profile: P, answers: ANSWERS,
          nationalId: FARMER_ID, outDir: OUT, fixtureDir: FIXTURES,
        });
        if (fill.filled.length || fill.uploaded.length) {
          walked.push(
            `  filled   : ${fill.filled.map((f) => `${f.label}="${f.value}"`).join(', ') || '-'}\n` +
            `  uploaded : ${fill.uploaded.map((u) => `${u.slot} ← ${u.file}`).join(', ') || '-'}\n`,
          );
        }
        if (fill.unanswered.length) {
          await shot(page, OUT, `A02-step${step}-UNANSWERED.png`);
          walked.push(`  → STOPPED: required controls this walk has no answer for: ${
            fill.unanswered.map((u) => `${u.label} (${u.kind})`).join(' | ')}\n`);
          break;
        }
      }
      await page.waitForTimeout(1500); // let autosave settle before advancing

      const next = page.getByRole('button', { name: /ถัดไป|ต่อไป/ }).first();
      if (!(await next.isVisible().catch(() => false)) || !(await next.isEnabled().catch(() => false))) {
        walked.push('  → STOPPED: no enabled "ถัดไป" on this step\n');
        break;
      }
      await next.click();
      // Wait for the navigation itself, not a timer. A fixed 2.5 s once declared farmer
      // B's step 5 "STUCK" while Next dev was still compiling step 6 under load — the
      // product had accepted the press; the walk had not waited for the answer. Only a
      // URL that is still the same after a real wait is a refusal.
      const moved = await page
        .waitForURL((u) => u.toString() !== before, { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      if (!moved && page.url() === before) {
        // A refusal is only usable if the user is told WHAT to fix. Capture the screen
        // AFTER the press — the pre-press dump cannot show a message the press produced.
        await shot(page, OUT, `A02-step${step}-STUCK.png`);
        const after = await dumpControls(page, OUT, `A02-step${step}-after-press.json`);
        const invalid = await page.locator('[aria-invalid="true"], .border-destructive, [data-invalid="true"]')
          .allInnerTexts().catch(() => []);
        walked.push(
          `  → STOPPED: pressing ถัดไป did not leave ${before}\n` +
          `     message shown to the user after the press: ${after.alerts.length ? after.alerts.join(' | ') : '(NONE — silent refusal)'}\n` +
          `     fields marked invalid: ${invalid.length ? invalid.join(' | ').slice(0, 200) : '(none marked)'}\n` +
          `     empty required fields: ${after.fields.filter((f) => f.required && !f.value).map((f) => f.label || f.id).join(', ') || '(none)'}\n`,
        );
        break;
      }
    }
    writeFileSync(join(OUT, 'A02-wizard-walk.txt'), walked.join('\n'));
    writeFileSync(join(OUT, 'A02-final-url.txt'), page.url());
    writeFileSync(join(OUT, 'A02-step-timings.txt'), `${timings.join('\n')}\n`);
  });
});
