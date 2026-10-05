/**
 * Shared helpers for the PHASE 0 FLOW-PROOF suite.
 *
 * Plan: design note 2026-08-15-phase0-flow-proof (Task 2.3).
 * Interfaces consumed by every spec: login / dump / auditDump / thaiId /
 * pngFixture / saveVars / readVars.
 *
 * psql() is deliberately read-only: G-4 forbids an agent from mutating money
 * rows, so the guard rejects anything that is not SELECT / \d and rejects any
 * table outside the allowlist. Do not relax either check.
 *
 * Passwords are never stored here — specs read them from the env vars
 * PHASE0_SEED_PW_APPLICANT / PHASE0_SEED_PW_OFFICER / PHASE0_SEED_PW_ADMIN (G-3).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const REPO = resolve(__dirname, '../../..');
export const EV = join(REPO, 'evidence/phase0');
const BACKEND = join(REPO, 'apps/backend'); // @prisma/client resolves here (generated at setup)
const ALLOWED = new Set(['applications','audit_logs','quotations','invoices','payment_slips',
  'payment_transactions','checkout_orders','certificates','users','stripe_webhook_events',
  'journal_entries','journal_lines','checkout_documents',
  'gps_verification_logs']); // start-marker evidence (migration 20260819000000)

// Amendment A topology: no Docker / no psql client. Rows are read straight from
// Supabase via the backend's generated Prisma client — node -e is run with
// cwd=apps/backend so require('@prisma/client') resolves; DATABASE_URL comes
// from the gitignored root .env. Output is JSON (one array of row objects).
function databaseUrl(): string {
  const line = readFileSync(join(REPO, '.env'), 'utf8')
    .split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL missing from .env');
  return line.slice('DATABASE_URL='.length).replace(/\r$/, '').trim();
}

export function psql(sql: string): string {
  if (!/^\s*SELECT/i.test(sql)) throw new Error('SELECT only — G-4');
  const t = sql.match(/FROM\s+"?([a-z_]+)"?/i)?.[1];
  if (t && !ALLOWED.has(t)) throw new Error(`table ${t} not in allowlist`);
  const runner = [
    'const {PrismaClient}=require("@prisma/client");',
    'const p=new PrismaClient();',
    'p.$queryRawUnsafe(process.argv[1])',
    '.then(r=>{process.stdout.write(JSON.stringify(r,(k,v)=>typeof v==="bigint"?Number(v):v,2));return p.$disconnect();})',
    '.then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});',
  ].join('');
  return execFileSync('node', ['-e', runner, sql], {
    cwd: BACKEND, encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl() },
  });
}
// ── FEE MODEL OF RECORD — single-issuer, W14 (operator ruling 2026-08-22,
// the change log; fee-service.js buildPhaseFee) ─────────────────────────────────
//   ค่าบริการ (service fee) = ราคาเต็ม(รัฐ) + ค่าแพลตฟอร์ม (10% ของรัฐ)
//   ยอดชำระ  (payable)     = ค่าบริการ + VAT 7% ของ "ค่าบริการทั้งก้อน"
// …charged PER CULTIVATION SCOPE (= unique formData.cultivationMethods, resolved by
// fee-service resolveCultivationScopeCount and stamped onto applications.totalAreaTypes
// by the draft writer — application-draft-query-methods.js; the wizard submit door
// application-submission-methods.js that also stamped it was deleted in R2 Task 10).
//
// The retired formula taxed the platform slice only and produced 5,535 / 27,535.
// The figures below were read back FROM THE SERVICE, not copied from a document:
//   (apps/backend) node -e "require('./modules/billing/internal/fee-service.js')…"
//   1 scope  → phase1 5,885   phase2 29,425
//   3 scopes → phase1 17,655  phase2 88,275
// Every component is linear in scopeCount — state is a multiple of 5,000, so neither
// the 10% nor the 7% ever rounds (fee-service.js: "ROUNDING: none is load-bearing") —
// which is why one per-scope row × n is exact at any n.
export const FEE_PER_SCOPE = {
  PHASE_1: { state: 5_000, platform: 500, vat: 385, total: 5_885 },
  PHASE_2: { state: 25_000, platform: 2_500, vat: 1_925, total: 29_425 },
} as const;
export type PhaseKey = keyof typeof FEE_PER_SCOPE;
export function expectedPhaseFees(phase: PhaseKey, scopeCount: number) {
  const per = FEE_PER_SCOPE[phase];
  return {
    scopeCount,
    state: per.state * scopeCount,
    platform: per.platform * scopeCount,
    vat: per.vat * scopeCount,
    total: per.total * scopeCount,
  };
}
/** ยอดรวมของใบเสนอราคา — the single W14 quotation row carries BOTH phases. */
export function expectedApplicationTotal(scopeCount: number) {
  return (FEE_PER_SCOPE.PHASE_1.total + FEE_PER_SCOPE.PHASE_2.total) * scopeCount;
}
/**
 * The scope count the BACKEND actually billed, read from the column it stamped at
 * submit — never inferred from a spec's own fixture. If the wizard and the fee
 * service disagree about what a scope is, this reads the fee service's answer, and
 * the exact-figure assertions still catch a wrong bill for that scope count.
 */
export function scopeCountOf(applicationId: string): number {
  const rows = JSON.parse(psql(
    `SELECT "totalAreaTypes" FROM applications WHERE id='${applicationId}';`,
  )) as Array<{ totalAreaTypes: number | null }>;
  const n = Number(rows[0]?.totalAreaTypes ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function dump(seg: string, cp: string, phase: 'before'|'after', appId: string) {
  mkdirSync(join(EV, seg), { recursive: true });
  writeFileSync(join(EV, seg, `${cp}-db-${phase}.txt`),
    psql(`SELECT id, "applicationNumber", status, "reviewerId", "auditorId", "schedulerId",
      version, "updatedAt", "formData"->>'workflowState' AS workflow_state
      FROM applications WHERE id='${appId}';`));
}
export function auditDump(seg: string, cp: string, appId: string) {
  writeFileSync(join(EV, seg, `${cp}-audit.txt`),
    psql(`SELECT * FROM audit_logs WHERE "resourceId"='${appId}' ORDER BY timestamp DESC LIMIT 5;`));
}
// Amendment C: ERP-integrity dump for a payment settle checkpoint. status+audit+screen
// do NOT see the accounting — this does. The app posts a balanced journal + receipt on
// slip approve (payment-slip-service.js:1199,1309) but has a documented edge where the
// journal can be missing (:1192), so every payment hop must VERIFY, never assume. Columns
// verified against prisma/schema/billing.prisma. Criterion (per §II C-1): a journal that
// is absent / unbalanced (totalDebit≠totalCredit) / a broken money equation / a missing
// receipt = payment-checkpoint FAIL (an ERP leak — exactly what Phase 0 must catch, L3/G1).
export function dumpErp(seg: string, cp: string, appId: string) {
  const dir = join(EV, seg); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${cp}-erp-invoices.txt`), psql(
    `SELECT id, "invoiceNumber", "applicationId", status, "totalAmount", "receiptNumber", "receiptStatus"
     FROM invoices WHERE "applicationId"='${appId}' ORDER BY "invoiceNumber";`));
  writeFileSync(join(dir, `${cp}-erp-journal.txt`), psql(
    `SELECT je.id, je.reference, je."entryDate", je."totalDebit", je."totalCredit",
       (je."totalDebit" = je."totalCredit") AS entry_balanced,
       COALESCE((SELECT SUM(jl.debit) FROM journal_lines jl WHERE jl."entryId"=je.id),0) AS lines_debit,
       COALESCE((SELECT SUM(jl.credit) FROM journal_lines jl WHERE jl."entryId"=je.id),0) AS lines_credit
     FROM journal_entries je
     WHERE je.reference IN (SELECT "invoiceNumber" FROM invoices WHERE "applicationId"='${appId}')
     ORDER BY je."entryDate";`));
  writeFileSync(join(dir, `${cp}-erp-journal-lines.txt`), psql(
    `SELECT jl."entryId", jl."lineNumber", jl."accountCode", jl."accountName", jl.issuer, jl.debit, jl.credit, jl."taxableAmount"
     FROM journal_lines jl
     WHERE jl."entryId" IN (SELECT je.id FROM journal_entries je
       WHERE je.reference IN (SELECT "invoiceNumber" FROM invoices WHERE "applicationId"='${appId}'))
     ORDER BY jl."entryId", jl."lineNumber";`));
  writeFileSync(join(dir, `${cp}-erp-checkout-eq.txt`), psql(
    `SELECT id, milestone, status, platform_fee_net, platform_fee_vat, platform_fee_gross, total_payable_amount,
       (total_payable_amount = platform_fee_gross) AS eq_total,
       (platform_fee_gross = platform_fee_net + platform_fee_vat) AS eq_gross
     FROM checkout_orders WHERE "applicationId"='${appId}';`));
}

// ── Stripe TEST-mode PromptPay settle (Amendment D, proven 2026-08-16) ──────────
// The FE checkout has no pay step (F-GATEWAY-UI), so C04 drives the settle the way
// a working UI would: create+confirm the PromptPay PaymentIntent, then open its
// next_action.data (test_payment) URL and click "Authorize test payment" — the
// view-in-the-loop equivalent of the customer scanning the QR. PI → succeeded →
// stripe listen forwards payment_intent.succeeded → checkout-settlement-service.
const STRIPE_CLI = process.env.STRIPE_CLI_PATH
  || 'C:/Users/charo/AppData/Local/Microsoft/WinGet/Packages/Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe/stripe.exe';
function stripeKey(): string {
  const line = readFileSync(join(REPO, '.env'), 'utf8')
    .split('\n').find((l) => l.startsWith('STRIPE_SECRET_KEY='));
  if (!line) throw new Error('STRIPE_SECRET_KEY missing from .env');
  return line.slice('STRIPE_SECRET_KEY='.length).replace(/\r$/, '').trim();
}
function stripeCli(args: string[]): string {
  return execFileSync(STRIPE_CLI, [...args, '--api-key', stripeKey()], { encoding: 'utf8' });
}
// Confirm an app-created PromptPay PaymentIntent (pi_…) with a test PromptPay
// payment method; returns its test_payment authorize URL.
export function stripeConfirmPromptPay(piId: string): string {
  const pm = stripeCli(['payment_methods', 'create', '--type', 'promptpay',
    '-d', 'billing_details[email]=test@gacp.local']).match(/pm_[A-Za-z0-9]+/)?.[0];
  if (!pm) throw new Error('failed to create promptpay payment method');
  const conf = stripeCli(['payment_intents', 'confirm', piId, '-d', `payment_method=${pm}`,
    '-d', 'return_url=http://localhost:3000/health/payments']);
  const data = conf.match(/https:\/\/payments\.stripe\.com\/payment_methods\/test_payment[^"\s]+/)?.[0];
  if (!data) throw new Error('no test_payment URL; PI ' + (conf.match(/"status": "[a-z_]+"/)?.[0] ?? '?'));
  return data;
}
// Open the test_payment page and click "Authorize test payment" → PI succeeds.
export async function stripeTestAuthorize(page: Page, dataUrl: string) {
  await page.goto(dataUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /authorize test payment/i }).first().click();
  await page.waitForTimeout(4000); // Stripe transitions the PI to succeeded
}
/**
 * Answer the payment-terms disclosure on the checkout page, in whichever of its
 * two shapes this applicant is drawn, BEFORE pressing เริ่มขั้นตอนชำระเงิน.
 *
 * F-G4-64 made that press conditional on the disclosure being answered: the
 * button is `disabled={creating || !termsAnswered}`
 * (src/app/health/payments/checkout/client-view.tsx), so a walk that clicks
 * without ticking sits on actionTimeout against a permanently disabled control
 * and dies as "element is not enabled", naming nothing.
 *
 * Two shapes, because the grant is one UserConsent row per (user,
 * PAYMENT_TERMS): the first press ticks `checkout-terms-checkbox`, and from the
 * second press on the page renders `checkout-terms-recorded` INSTEAD. A helper
 * that knew only the box would time out one press into any walk that pays
 * twice.
 *
 * Not a green mask: the disclosure must be on screen in ONE of the two shapes
 * or this throws, and when the box is drawn it is asserted checked afterwards —
 * so a box that silently refuses the tick fails here rather than at the press.
 */
export async function acceptCheckoutTermsIfShown(page: Page, where = 'checkout'): Promise<'ticked' | 'already-on-file'> {
  const box = page.getByTestId('checkout-terms-checkbox');
  const onFile = page.getByTestId('checkout-terms-recorded');
  await expect(box.or(onFile), 'the checkout page discloses the payment terms').toBeVisible({ timeout: 60_000 });
  if (await box.isVisible().catch(() => false)) {
    if (!(await box.isChecked())) { await box.check(); }
    await expect(box, 'the payment-terms disclosure is accepted before the press').toBeChecked();
    return 'ticked';
  }
  // eslint-disable-next-line no-console
  console.log(`[terms] ${where}: payment terms already on file — the box is replaced by the recorded line`);
  return 'already-on-file';
}

/**
 * Accept every quotation the application holds, on the applicant's own screen,
 * BEFORE any press that creates a payment (F-G4-64 final round R24 / finding
 * S21).
 *
 * `createCheckoutForApplication` runs the quotation gate BEFORE the terms gate
 * (services/checkout/stripe-checkout-service.js) and the gate has no skip
 * branch (services/billing/quotation-gate.js), so a Phase-0 walk that only
 * ticked the payment-terms box was refused with QUOTATION_NOT_ACCEPTED before
 * the disclosure was ever consulted. The G4 walk already does this by hand
 * (e2e-g4/a03-pay-phase1.spec.ts); this is that block, named, so the two suites
 * cannot drift on what "accept the quotation" means.
 *
 * 100% UI, and not a green mask:
 *   - the card must be on screen and settled (`:not([aria-busy])`), or this
 *     throws — an application with no quotation of record fails here BY NAME,
 *     which is itself the finding the gate exists for;
 *   - after the presses, every card must read ยอมรับแล้ว / ออกใบแจ้งหนี้แล้ว, so a
 *     button that silently refuses fails here rather than at the payment press;
 *   - zero buttons is reported out loud (an earlier run already accepted), the
 *     same rule the walks apply to alreadyPaid.
 *
 * Leaves the browser on /health/payments?app=<id>.
 */
export async function acceptQuotationsIfShown(page: Page, applicationId: string, where = 'payments'): Promise<'accepted' | 'already-accepted'> {
  await page.goto(`/health/payments?app=${applicationId}`, { timeout: 200_000 });
  await page.waitForLoadState('domcontentloaded');
  const card = page.locator('[data-testid="quotation-review-section"]:not([aria-busy="true"])');
  await expect(
    card,
    'the quotation card answered — a quotation of record exists for this application',
  ).toBeVisible({ timeout: 60_000 });

  const acceptBtns = card.getByRole('button', { name: /ยอมรับใบเสนอราคา/ });
  const count = await acceptBtns.count();
  for (let i = 0; i < count; i++) {
    // Always index 0: the pressed button is replaced by the accepted pill, so
    // the next unpressed one becomes the first again.
    await acceptBtns.first().click();
    await page.waitForTimeout(1500);
  }
  if (count === 0) {
    // eslint-disable-next-line no-console
    console.log(`[quotation] ${where}: already accepted by an earlier run — verifying, not re-accepting`);
  }

  // The screen's own answer that the acceptance stuck. The register is checked
  // by the specs that own the money assertions.
  await expect(
    card.getByRole('button', { name: /ยอมรับใบเสนอราคา/ }),
    'every quotation on this application is accepted before the payment press',
  ).toHaveCount(0, { timeout: 30_000 });
  await expect(
    card.getByText(/ยอมรับแล้ว|ออกใบแจ้งหนี้แล้ว/).first(),
    'the card reports the acceptance it just recorded',
  ).toBeVisible({ timeout: 30_000 });
  return count > 0 ? 'accepted' : 'already-accepted';
}

export function thaiId(): string { // mod-11 checksum (แบบเดียวกับ e2e-golden-scenario.spec.ts:26-32)
  const d = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  d.push((11 - (d.reduce((s, n, i) => s + n * (13 - i), 0) % 11)) % 10);
  return d.join('');
}
export function pngFixture(dir: string): string { // 1x1 PNG สำหรับ upload เอกสาร/สลิป
  const p = join(dir, 'fixture.png');
  writeFileSync(p, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64'));
  return p;
}
export function saveVars(k: string, v: string) { appendFileSync(join(EV, 'VARS.md'), `${k}=${v}\n`); }
export function readVars(): Record<string, string> {
  return Object.fromEntries(readFileSync(join(EV, 'VARS.md'), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
export async function login(page: Page, o: { kind: 'health'|'provider'; id: string; pw: string }) {
  if (o.kind === 'health') { // selector จริง: health-login-page.tsx:270,299
    await page.goto('/auth/health/login');
    await page.fill('#identifier', o.id); await page.fill('#password', o.pw);
    await page.click('button[type="submit"]'); await page.waitForURL('**/health/**');
  } else {                    // provider-login-page.tsx:189,211
    await page.goto('/auth/provider/login');
    await page.fill('#provider-id', o.id); await page.fill('#provider-password', o.pw);
    await page.click('button[type="submit"]'); await page.waitForURL('**/provider/**');
  }
}
