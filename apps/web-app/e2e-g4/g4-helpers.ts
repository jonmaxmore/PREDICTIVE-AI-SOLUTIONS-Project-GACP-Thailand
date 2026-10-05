/**
 * Shared identities, profiles and instrumentation for the G4 real-journey walk.
 *
 * The Phase-0 helpers are reused wholesale (login / psql / thaiId / dump / the
 * Stripe PromptPay settle rail) — G4 walks the same product through the same
 * doors, so forking them would let the two walks drift apart on what "the real
 * door" means. Only what is genuinely G4-specific lives here.
 *
 * Passwords are never stored in this file (L2). Each spec reads them from
 * G4_PW_A / G4_PW_B, which the run command exports from a scratchpad file.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

export const REPO = resolve(__dirname, '../../..');
export const EV = join(REPO, 'evidence/g4-rebuild-2026-08-25');
const BACKEND = join(REPO, 'apps/backend'); // @prisma/client resolves here

/**
 * The payment-terms disclosure on the checkout page, answered before every
 * press of เริ่มขั้นตอนชำระเงิน.
 *
 * Re-exported rather than re-written: this file's own rule (see the header) is
 * that the Phase-0 helpers are reused wholesale so the two walks cannot drift
 * apart on what "the real door" means, and the disclosure is one door pressed
 * by specs in both suites. One body, two import paths.
 */
export { acceptCheckoutTermsIfShown } from '../e2e-phase0/helpers';

/**
 * The quotation acceptance the payment gate requires, pressed on the
 * applicant's own screen (F-G4-64 final round R24).
 *
 * Same rule as the line above: one body, two import paths. The body lives in
 * the Phase-0 helpers because the Phase-0 checkout walks (s04, s07,
 * settlement-resilience) are the ones the gate would otherwise refuse; it is
 * exported from here so a G4 spec asks for it by the same name.
 */
export { acceptQuotationsIfShown } from '../e2e-phase0/helpers';

/**
 * The quotation row the PRODUCT reads, in SQL. ONE home for the three walks
 * that read it (a03, a05, C07).
 *
 * assertQuotationAcceptedForPayment returns `rows.platform || rows.dtam`
 * (apps/backend/services/billing/quotation-gate.js), and
 * findQuotationsByApplicationId builds those two by taking the FIRST row of each
 * issuerType in createdAt-ASC order (apps/backend/services/quotation-service.js).
 * That row is the one the order binds its snapshot hash to, the one
 * recordPhaseInvoiced stamps, and the one closure flips to INVOICED. A plain
 * `ORDER BY "createdAt" DESC LIMIT 1` reads a different row as soon as an
 * application also carries the pre-W14 DTAM row — the very case the accept loops
 * exist for — and on that row phase1InvoicedAt is null and the status never
 * leaves ACCEPTED, so a walk would fail against a row the product never touched.
 *
 * It lived in three copies, one per spec, with three copies of this rationale:
 * when findQuotationsByApplicationId changes its ordering, two of them would be
 * missed and two walks would silently read the wrong row — the exact failure the
 * constant exists to prevent.
 */
export const PRICED_ROW_ORDER = 'ORDER BY ("issuerType"=\'PLATFORM\') DESC, "createdAt" ASC LIMIT 1';

/**
 * Read rows over Supabase's TRANSACTION pooler, one connection at a time.
 *
 * The Phase-0 psql() helper reads .env and connects on port 5432 — Supabase's
 * SESSION-mode pooler, which caps the whole project at 15 clients. The backend
 * alone asks for 20 (prisma-database.js:74 `PRISMA_POOL_SIZE || 20`, tuning
 * written when the database was a local docker Postgres), so a walk that also
 * spawns a fresh client per read exhausts it and the app starts failing in ways
 * that look like application bugs: this is the true root of the documented
 * F-SUBMIT-500-FLAKY, and it timed out farmer A's registration on the first G4
 * attempt (EMAXCONNSESSION, observed 2026-08-25).
 *
 * Port 6543 is the transaction pooler: many short-lived clients are what it is
 * for. `pgbouncer=true` is required (Prisma must stop using prepared statements),
 * and connection_limit=1 keeps each read to a single client.
 *
 * SELECT-only, like the Phase-0 helper it replaces: an evidence walk reads the
 * database to check what the product wrote, and must never be the thing that
 * wrote it.
 */
function pooledUrl(): string {
  // The STACK UNDER TEST decides which database the walk reads — not this file.
  //
  // This used to read the repo-root .env directly and ignore the environment, so a
  // walk driven against any other database asserted against the wrong one. Measured
  // 2026-09-10 while walking the scratch stack (docs/ops/2026-09-04-dev-server-runbook.md
  // §4: backend :8010 against gacp_walk): the browser pressed gacp_walk while g4psql
  // read the Supabase demo pooler, so every DB assertion described a system nobody
  // had touched — and the walk would have passed or failed for reasons unrelated to
  // what was pressed.
  const fromEnv = (process.env.DATABASE_URL || '').trim();
  const raw = fromEnv || (() => {
    const line = readFileSync(join(REPO, '.env'), 'utf8')
      .split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (!line) throw new Error('DATABASE_URL missing from .env and not exported');
    return line.slice('DATABASE_URL='.length).replace(/\r$/, '').trim();
  })();

  const u = new URL(raw);
  // The 6543 + pgbouncer rewrite is Supabase's connection pooler, and only Supabase
  // has one. Forcing it onto a plain Postgres (the scratch stack publishes 55450)
  // points the walk at a port nothing listens on.
  if (/supabase/i.test(u.hostname)) {
    u.port = '6543';
    u.searchParams.set('pgbouncer', 'true');
    u.searchParams.set('connection_limit', '1');
  }
  return u.toString();
}

export function g4psql(sql: string): string {
  if (!/^\s*SELECT/i.test(sql)) throw new Error('SELECT only — an evidence walk never writes');
  const runner = [
    'const {PrismaClient}=require("@prisma/client");',
    'const p=new PrismaClient();',
    'p.$queryRawUnsafe(process.argv[1])',
    '.then(r=>{process.stdout.write(JSON.stringify(r,(k,v)=>typeof v==="bigint"?Number(v):v,2));return p.$disconnect();})',
    '.then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});',
  ].join('');
  return execFileSync('node', ['-e', runner, sql], {
    cwd: BACKEND, encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: pooledUrl() },
  });
}

/**
 * The two applicants of GOALS.md §G4.2.
 *
 * `purpose` and `cultivationMethods` carry the whole difference between them, and
 * they are the only two inputs that move the bill: the fee service charges per
 * UNIQUE cultivation method (fee-service.js resolveCultivationScopeCount), which
 * the submit stamps onto applications.totalAreaTypes. So farmer B is not "a bigger
 * farmer" — B is the same 200 m² grown three ways, and the ×3 in the price is the
 * system saying it must certify three growing environments, not three farms.
 *
 * The ids are minted per run with a real mod-11 checksum (thaiId), never reused:
 * a national ID is an identity, and pinning a literal one into a repo would put a
 * real person's number in git if the checksum ever collided with a live citizen.
 */
export type FarmerKey = 'A' | 'B';

export interface FarmerProfile {
  key: FarmerKey;
  varPrefix: string;
  firstName: string;
  lastName: string;
  /** certification purpose code — shared/certification-purposes.js (operator ruling 2026-10-05) */
  purpose: 'RESEARCH' | 'EXPORT' | 'PROCESSING';
  purposeLabelTH: string;
  /** CULTIVATION_OPTIONS ids — plant-selection-config.ts:233-256 */
  cultivationMethods: Array<'outdoor' | 'greenhouse' | 'indoor'>;
  cultivationLabelsTH: string[];
  /** Total farm area in square metres (G4.2: both farmers hold 200 m²). */
  totalAreaSqm: number;
  /** One plot per cultivation method — G4.2 gives B three areas, A one. */
  plots: Array<{ name: string; areaSqm: number; method: 'outdoor' | 'greenhouse' | 'indoor' }>;
  farmName: string;
  address: { houseNo: string; province: string; district: string; subdistrict: string; postalCode: string };
  passwordEnv: 'G4_PW_A' | 'G4_PW_B';
}

export const FARMERS: Record<FarmerKey, FarmerProfile> = {
  A: {
    key: 'A',
    varPrefix: 'FARMER_A',
    firstName: 'สมชาย',
    lastName: 'ใจดีมั่นคง',
    purpose: 'EXPORT',
    purposeLabelTH: 'ส่งออกเพื่อการค้า',
    cultivationMethods: ['outdoor'],
    cultivationLabelsTH: ['กลางแจ้ง'],
    totalAreaSqm: 200,
    plots: [{ name: 'แปลงกลางแจ้ง 1', areaSqm: 200, method: 'outdoor' }],
    farmName: 'ไร่ใจดีสมุนไพรไทย',
    address: { houseNo: '119/4 หมู่ 3', province: 'เชียงใหม่', district: 'เมือง', subdistrict: 'สุเทพ', postalCode: '50200' },
    passwordEnv: 'G4_PW_A',
  },
  B: {
    key: 'B',
    varPrefix: 'FARMER_B',
    firstName: 'มาลี',
    lastName: 'ศรีสุขเกษม',
    purpose: 'PROCESSING',
    purposeLabelTH: 'แปรรูปหรือจำหน่ายเพื่อการค้า',
    cultivationMethods: ['outdoor', 'greenhouse', 'indoor'],
    cultivationLabelsTH: ['กลางแจ้ง', 'โรงเรือน', 'อาคารควบคุม'],
    totalAreaSqm: 200,
    // 200 m² split three ways — the split is the point (G4.2 "ซอยเป็น 3 พื้นที่"),
    // so each growing environment gets its own plot and, after certification, its
    // own plot QR (planting T&T spec R17).
    plots: [
      { name: 'แปลงกลางแจ้ง', areaSqm: 80, method: 'outdoor' },
      { name: 'แปลงโรงเรือน', areaSqm: 70, method: 'greenhouse' },
      { name: 'แปลงอาคารควบคุม', areaSqm: 50, method: 'indoor' },
    ],
    farmName: 'สวนศรีสุขเกษตรอินทรีย์',
    address: { houseNo: '88/12 หมู่ 5', province: 'เชียงใหม่', district: 'เมือง', subdistrict: 'สุเทพ', postalCode: '50200' },
    passwordEnv: 'G4_PW_B',
  },
};

/** The plot areas must add up to the farm area, or the walk is proving a farm that cannot exist. */
export function assertPlotsSumToFarm(p: FarmerProfile) {
  const sum = p.plots.reduce((s, x) => s + x.areaSqm, 0);
  if (sum !== p.totalAreaSqm) {
    throw new Error(`farmer ${p.key}: plots sum to ${sum} m² but the farm is ${p.totalAreaSqm} m²`);
  }
  if (p.plots.length !== p.cultivationMethods.length) {
    throw new Error(`farmer ${p.key}: ${p.plots.length} plots for ${p.cultivationMethods.length} cultivation method(s)`);
  }
}

/**
 * Which farmer this run walks: G4_FARMER=A|B (default A). One switch, read once per spec,
 * so the same specs can walk farmer B on the current tree — the proof that a fresh
 * application mints no split-invoice pair under the checkout rail (F-G4-35/39).
 */
export function pickFarmer(): FarmerKey {
  const k = String(process.env.G4_FARMER || 'A').toUpperCase();
  if (k !== 'A' && k !== 'B') throw new Error(`G4_FARMER must be A or B (got "${k}")`);
  return k as FarmerKey;
}

export function pw(profile: FarmerProfile): string {
  const v = process.env[profile.passwordEnv];
  if (!v) throw new Error(`${profile.passwordEnv} must be exported by the run command (never committed — L2)`);
  return v;
}

/**
 * The national ID this farmer is walking under — minted ONCE and then reused.
 *
 * A twelve-stage journey will not be walked in a single unbroken run: a stage will
 * fail, get fixed, and be re-run. If the identity were minted per run, every re-run
 * would register another farmer, and GOALS §G4.2 — which says there are exactly two
 * applicants — would quietly stop being true while every individual spec still
 * passed. So the id is written to VARS on first mint and read back forever after,
 * and the walk becomes resumable instead of merely repeatable.
 */
export function farmerId(p: FarmerProfile): string {
  const key = `${p.varPrefix}_ID`;
  const existing = readVars()[key];
  if (existing && /^\d{13}$/.test(existing)) return existing;
  const d = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  d.push((11 - (d.reduce((s, n, i) => s + n * (13 - i), 0) % 11)) % 10); // mod-11 checksum
  const id = d.join('');
  saveVar(key, id);
  return id;
}

/**
 * Build a real, readable PDF for one document slot.
 *
 * The first G4 attempt uploaded a 70-byte 1×1 transparent PNG into all three ภท. permit
 * slots and the product accepted every one (see the walk findings). Leaving it there would
 * have broken the walk's own premise: GOALS §G4.0 rule 2 says the officers must work ONLY
 * from what the farmer submitted, and a reviewer cannot read a blank pixel — an approval
 * of an invisible document proves nothing about the review step.
 *
 * Each page is stamped in Thai as demo data, so a file that looks like a ministry permit
 * says on its face that it is not one.
 */
export function documentFixture(
  outDir: string,
  slot: { code: string; title: string; description?: string },
  p: FarmerProfile,
  nationalId: string,
): string {
  mkdirSync(outDir, { recursive: true });
  const safe = slot.code.replace(/[^\w.ก-๙]/g, '_');
  const out = join(outDir, `${safe}.pdf`);
  const payload = JSON.stringify({
    code: slot.code,
    title: slot.title,
    description: slot.description || '',
    applicant: `${p.firstName} ${p.lastName}`,
    nationalId,
    farmName: p.farmName,
    address: `${p.address.houseNo} ต.${p.address.subdistrict} อ.${p.address.district} จ.${p.address.province} ${p.address.postalCode}`,
    purpose: p.purposeLabelTH,
  });
  execFileSync('node', ['scripts/g4/make-document-fixture.js', out, payload], {
    cwd: BACKEND, encoding: 'utf8',
  });
  return out;
}

/**
 * Where an authenticated applicant / officer is allowed to land after login.
 *
 * Both predicates check the PATHNAME PREFIX, because substring regexes here have now
 * produced the same bug twice: Phase-0's helper matched `**‍/health/**` against
 * /auth/health/login, and this file's first provider pattern matched /\/provider\//
 * against /auth/provider/login — each returned "logged in" while still ON the login
 * page, and the next guarded navigation bounced. A landing is a URL whose path STARTS
 * with the portal root; the login pages all live under /auth/.
 */
const HEALTH_LANDING = (url: URL) => url.pathname.startsWith('/health/');
const PROVIDER_LANDING = (url: URL) => url.pathname.startsWith('/provider');
// An ADMIN officer logs in through the same provider form but lands under /admin
// (provider-role-config providerLandingPath) — the C01 revoke walk found the
// /provider-only predicate timing out on a login that had in fact succeeded.
const OFFICER_LANDING = (url: URL) => PROVIDER_LANDING(url) || url.pathname.startsWith('/admin');

/**
 * Log in through the real form and WAIT UNTIL AUTH HAS ACTUALLY LANDED.
 *
 * The Phase-0 login helper waits on the glob `**‍/health/**`, which also matches the
 * login page's own URL `/auth/health/login` — so it returns while the request is
 * still in flight. s01 documents this and works around it inline; every spec that
 * did not got bounced back to the login page on its next navigation, which is
 * exactly how the first G4 wizard attempt failed (redirect to
 * /auth/health/login?redirect=%2Fhealth%2Fapplications%2Fnew).
 *
 * Waiting for a real landing URL — never the login URL — is the difference between
 * "the form was filled" and "the session exists".
 */
/**
 * Put a value into a form field the way a person does — one keystroke at a time.
 *
 * `page.fill()` does NOT survive on this product's forms. Measured on the health login
 * page, 2026-09-10, against the tree at ac3f3a21:
 *
 *     after page.fill        13 characters
 *     after fill + blur       0 characters      ← the field empties itself
 *     after typing + blur    13 characters
 *
 * The fields are react-hook-form controlled inputs: `fill` writes the DOM value, but the
 * form state never receives it, and the next re-render (which blur triggers) restores the
 * empty state it still believes in. The submit then posts nothing and the page simply
 * stays put — which is exactly how every g4 walk died at `g4Login`, with a 120 s
 * navigation timeout and no clue on screen.
 *
 * Worth knowing beyond the walk: anything that sets these fields programmatically rather
 * than by keystroke — a password manager, browser autofill — may lose the value the same
 * way. That is a product question, filed separately; this helper only makes the walk
 * press the door the way a farmer presses it.
 */
export async function typeInto(page: Page, selector: string, value: string): Promise<void> {
  const field = page.locator(selector);
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.click();
  await field.fill('');
  await field.pressSequentially(String(value), { delay: 15 });
  await field.blur();
}

export async function g4Login(
  page: Page,
  o: { kind: 'health' | 'provider'; id: string; pw: string },
) {
  if (o.kind === 'health') {
    await page.goto('/auth/health/login');
    await typeInto(page, '#identifier', o.id);
    await typeInto(page, '#password', o.pw);
    await page.click('button[type="submit"]');
    await page.waitForURL(HEALTH_LANDING, { timeout: 120_000 });
  } else {
    await page.goto('/auth/provider/login');
    await typeInto(page, '#provider-id', o.id);
    await typeInto(page, '#provider-password', o.pw);
    await page.click('button[type="submit"]');
    await page.waitForURL(OFFICER_LANDING, { timeout: 120_000 });
  }
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Wait until a wizard step has actually rendered its controls.
 *
 * Each step mounts behind "กำลังเตรียมข้อมูลขั้นตอน..." while it loads. Reading or
 * pressing before that clears does not fail loudly — it silently sees an empty step:
 * the first G4 wizard attempt counted ZERO consent checkboxes, ticked nothing, pressed
 * ถัดไป, and was then correctly refused by the product. The walk blamed the wizard for a
 * wait its own harness never did.
 *
 * Returns how long the step took to become usable, so a slow step is reported as a
 * measured number rather than an impression.
 */
export async function waitForStepReady(page: Page, timeoutMs = 180_000): Promise<number> {
  const t0 = Date.now();
  const spinner = page.getByText(/กำลังเตรียมข้อมูลขั้นตอน/);
  await spinner.waitFor({ state: 'detached', timeout: timeoutMs }).catch(() => {});

  // Wait for the STEP's own content, not the page chrome.
  //
  // The first version waited for `button:not([disabled])`, which the wizard's header
  // satisfies instantly — the close button and the step chips are always mounted. So it
  // returned while the step body was still a spinner, and everything downstream read an
  // empty step: zero consent checkboxes, nothing ticked, and the product then correctly
  // refused to advance. The walk looked like a wizard bug twice before the wait was the
  // thing at fault. A readiness check that the page satisfies before it is ready is worse
  // than no check, because it reports success.
  await page.waitForFunction(() => {
    const doc = document;
    if (doc.body.innerText.includes('กำลังเตรียมข้อมูลขั้นตอน')) return false;
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    // A form control anywhere in the step body…
    if ([...doc.querySelectorAll('input, select, textarea')].some(visible)) return true;
    // …or the step's own forward control, which the header never has.
    return [...doc.querySelectorAll('button')]
      .some((b) => visible(b) && /ถัดไป|ต่อไป|บันทึกและไปขั้นตอน/.test(b.textContent || ''));
  }, undefined, { timeout: timeoutMs, polling: 250 });

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  return Date.now() - t0;
}

/**
 * Record what the BROWSER says while the walk presses.
 *
 * A React error boundary shows the user "เกิดข้อผิดพลาด · ลองใหม่อีกครั้ง" and swallows
 * the stack; the walk then reports "control not found" for a page that has crashed. The
 * console is where the real cause is, so every spec keeps it.
 */
export function captureConsole(page: Page, outDir: string, name: string) {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      lines.push(`[${msg.type()}] ${msg.text().slice(0, 500)}`);
    }
  });
  page.on('pageerror', (err) => {
    lines.push(`[pageerror] ${err.message}\n${(err.stack || '').split('\n').slice(0, 6).join('\n')}`);
  });
  return () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${name}-console.txt`), lines.join('\n') + '\n');
    return lines;
  };
}

export function seg(name: string): string {
  const d = join(EV, name);
  mkdirSync(d, { recursive: true });
  return d;
}

export async function shot(page: Page, dir: string, file: string) {
  await page.screenshot({ path: join(dir, file), fullPage: true });
}

export function saveVar(k: string, v: string) {
  mkdirSync(EV, { recursive: true });
  appendFileSync(join(EV, 'VARS.md'), `${k}=${v}\n`);
}

export function readVars(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(join(EV, 'VARS.md'), 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

/**
 * Dump every control the current wizard step actually renders.
 *
 * This exists because the Phase-0 walk did NOT drive the wizard: it filled steps
 * 3-9 through POST /api/applications/prepare and said so in its own comments
 * ("HONESTY (Amendment C-3): this is NOT the wizard passed via UI end-to-end").
 * G4 is supposed to press the real thing, so the first job is to find out what the
 * real thing renders — read from the live DOM, not inferred from the TSX, because
 * a control that is conditionally hidden reads identically in source either way.
 */
export async function dumpControls(page: Page, dir: string, file: string) {
  const data = await page.evaluate(() => {
    const labelFor = (el: Element): string => {
      const id = (el as HTMLInputElement).id;
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l?.textContent) return l.textContent.trim().slice(0, 80);
      }
      const wrap = el.closest('label');
      if (wrap?.textContent) return wrap.textContent.trim().slice(0, 80);
      const aria = el.getAttribute('aria-label');
      return aria ? aria.trim().slice(0, 80) : '';
    };
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const fields = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type || '',
        id: (el as HTMLInputElement).id || '',
        name: (el as HTMLInputElement).name || '',
        required: (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true',
        value: (el as HTMLInputElement).type === 'password' ? '<redacted>' : String((el as HTMLInputElement).value ?? '').slice(0, 40),
        options: el.tagName === 'SELECT'
          ? Array.from((el as HTMLSelectElement).options).slice(0, 12).map((o) => `${o.value}|${o.textContent?.trim().slice(0, 30)}`)
          : undefined,
        label: labelFor(el),
      }));
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .map((el) => ({
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        disabled: (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
        pressed: el.getAttribute('aria-pressed') ?? undefined,
      }))
      .filter((b) => b.text);
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .filter(visible)
      .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90));
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .filter(visible)
      .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160));
    return { url: location.pathname + location.search, headings, fields, buttons, alerts };
  });
  writeFileSync(join(dir, file), JSON.stringify(data, null, 2));
  return data;
}
