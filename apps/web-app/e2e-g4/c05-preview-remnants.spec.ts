/**
 * C05 — the applicant's preview page after the two remnant fixes (ledger F-G4-50, F-G4-51).
 *
 * The preview is only served for a pre-certification application (previewable-statuses.js),
 * so this spec opens the farmer's NEWEST application in such a state. It never creates one:
 * a01 does that through the real wizard. If none exists it fails and says so.
 *
 *   F-G4-50 — no English capital enum ('OUTDOOR') anywhere; the cultivation methods appear
 *             once, as Thai labels, in "ข้อมูลจากขั้นตอนที่ 1".
 *   F-G4-51 — the phase-1 finance block matches the rail the application is actually billed
 *             on, and prints no raw status enum either way:
 *               checkout rail  → "การชำระเงินงวดที่ 1" with the checkout state of the phase
 *               live legacy rows and no checkout invoice → the four-slot
 *                                "เอกสารการเงินงวดที่ 1" block, with Thai status pills
 *             Which branch is right is READ FROM THE DATABASE first (below) — asserting one
 *             branch unconditionally would fail on a correct page, or pass on a wrong one.
 *
 * Runs as the G4_FARMER (A default); id from VARS, password from the runner's env.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { FARMERS, pw, seg, shot, readVars, g4psql, g4Login, pickFarmer, REPO } from './g4-helpers';
import {
  NEXT_ACTION_LABELS,
  PAID_STATUSES,
  isLiveLegacyInvoice,
  isLiveLegacyQuote,
} from '../src/app/health/applications/preview/preview-page-config';

const P = FARMERS[pickFarmer()];
const OUT = seg(P.key === 'A' ? 'c05' : `c05-${P.key.toLowerCase()}`);

/**
 * The backend is CommonJS and lives outside this app's TS project, so its
 * constants are loaded, not imported. Only dependency-free modules are read
 * here: nothing on these four paths opens a database client, and nothing on
 * them loads apps/backend/.env into this process (a walk whose credentials come
 * from the run command must not have them overwritten at import time).
 */
const requireBackend = createRequire(__filename);

/**
 * The states in which the backend will serve a preview at all — asked of the route's own
 * list instead of retyped here, because a spec that keeps its own copy silently stops
 * covering the states the product adds (this copy was already missing
 * PHASE_1_SLIP_UNDER_REVIEW). The module exports the Set itself.
 */
const PREVIEWABLE = [...(requireBackend(join(REPO, 'apps/backend/routes/api/preview/previewable-statuses.js')) as Set<string>)];

/** The retired per-side phase-1 service types, from the service that defines them. */
const { getServiceTypesForPhaseComponent } = requireBackend(join(REPO, 'apps/backend/services/phase-billing-service.js')) as {
  getServiceTypesForPhaseComponent: (phase: string, component: string) => string[];
};
const LEGACY_PHASE1_SERVICE_TYPES = [
  ...getServiceTypesForPhaseComponent('PHASE_1', 'STATE'),
  ...getServiceTypesForPhaseComponent('PHASE_1', 'PLATFORM'),
];

/** The checkout rail's own milestone vocabulary ('M1' | 'M2'). */
const { MILESTONES } = requireBackend(join(REPO, 'apps/backend/shared/checkout-status.js')) as { MILESTONES: string[] };

/**
 * The notes tags that mark the retired per-phase preview QUOTES, from the
 * dependency-free module that owns them. Not read from preview-financial-utils
 * itself: that file requires services/prisma-database, which builds a real
 * PrismaClient and (through @prisma/client) loads apps/backend/.env into this
 * process's env — a walk whose passwords come from the run command must not let
 * a spec file quietly overwrite them at import time.
 */
const {
  PHASE1_STATE_PREVIEW_TAG,
  PHASE1_PLATFORM_PREVIEW_TAG,
} = requireBackend(join(REPO, 'apps/backend/routes/api/preview/preview-legacy-doc-tags.js')) as {
  PHASE1_STATE_PREVIEW_TAG: string;
  PHASE1_PLATFORM_PREVIEW_TAG: string;
};

const sqlList = (values: string[]) => values.map((v) => `'${v}'`).join(',');

test('C05 preview page carries no raw enum and no dead legacy finance slots', async ({ page }) => {
  test.setTimeout(300_000);
  const vars = readVars();
  const FARMER_ID = vars[`${P.varPrefix}_ID`] || '';
  expect(FARMER_ID, `${P.varPrefix}_ID in VARS (written by a01)`).toBeTruthy();

  const rows = JSON.parse(g4psql(
    `SELECT id, status, "phase1Status", "areaType" FROM applications WHERE "healthId"='${FARMER_ID}' AND "isDeleted"=false `
    + `AND status IN (${sqlList(PREVIEWABLE)}) ORDER BY "createdAt" DESC LIMIT 1;`,
  )) as Array<{ id: string; status: string; phase1Status: string | null; areaType: string | null }>;
  expect(rows.length, `farmer ${P.key} has a previewable application (run a01 first)`).toBe(1);
  const app = rows[0] as { id: string; status: string; phase1Status: string | null; areaType: string | null };
  console.log(`[C05] application ${app.id} status=${app.status} phase1Status=${app.phase1Status} areaType=${app.areaType}`);

  // Which finance branch the page OUGHT to render, read off the money rows themselves.
  // A checkout invoice is minted with its order in ONE transaction and linked back
  // (stripe-checkout-service.js), so the order rows are how the walk finds them without
  // loading the backend's prisma client into this process.
  //
  // The retired pair is a QUOTE *and* an invoice per side, and the page's
  // hasLiveLegacyPhase1Documents counts a live quote on its own. Reading invoices
  // only, this walk predicted the checkout branch for an application whose
  // four-slot block is on screen because of its quotes — and then asserted the
  // absence of the very block the applicant was looking at.
  const financeRows = JSON.parse(g4psql(
    `SELECT 'legacy_invoice' AS kind, i.status AS status FROM invoices i `
    + `WHERE i."applicationId"='${app.id}' AND i."isDeleted"=false `
    + `AND i."serviceType" IN (${sqlList(LEGACY_PHASE1_SERVICE_TYPES)}) `
    + `UNION ALL `
    + `SELECT 'legacy_quote' AS kind, q.status AS status FROM quotes q `
    + `WHERE q."applicationId"='${app.id}' AND q."isDeleted"=false `
    + `AND (q.notes LIKE '%${PHASE1_STATE_PREVIEW_TAG}%' OR q.notes LIKE '%${PHASE1_PLATFORM_PREVIEW_TAG}%') `
    + `UNION ALL `
    + `SELECT 'checkout_' || o.milestone AS kind, i.status AS status `
    + `FROM checkout_orders o JOIN invoices i ON i.id = o."invoiceId" `
    + `WHERE o."applicationId"='${app.id}' AND i."isDeleted"=false;`,
  )) as Array<{ kind: string; status: string | null }>;

  const statusOf = (row: { status: string | null }) => String(row.status || '');
  const isPaidStatus = (row: { status: string | null }) => PAID_STATUSES.has(statusOf(row).toUpperCase());

  // Liveness is judged by the page's own rules, not by status literals retyped here.
  const legacyInvoices = financeRows.filter((r) => r.kind === 'legacy_invoice');
  const legacyLive = [
    ...legacyInvoices.filter((r) => isLiveLegacyInvoice({ status: statusOf(r) })),
    ...financeRows.filter((r) => r.kind === 'legacy_quote' && isLiveLegacyQuote({ status: statusOf(r) })),
  ];
  const checkoutM1 = financeRows.filter((r) => r.kind === `checkout_${MILESTONES[0]}`);
  const checkoutM1Paid = checkoutM1.some(isPaidStatus);
  // The branch mirrors the page (client-view.tsx `hasLegacyPhase1Docs`): the
  // document of record is the rail the money MOVED on. A checkout row that was
  // never paid does not displace a live legacy document; only a PAID one does.
  const legacyBranch = legacyLive.length > 0 && !checkoutM1Paid;
  // Deliberately an OVER-estimate: any sign that phase 1 was settled — on
  // either rail — suppresses the "not paid yet" assertions below, so this walk
  // can never demand the unpaid wording from a page that is right to say paid.
  const paid = checkoutM1Paid
    || legacyInvoices.some(isPaidStatus)
    || PAID_STATUSES.has(String(app.phase1Status || '').toUpperCase());
  console.log(`[C05] finance rows: legacy live=${legacyLive.length} checkout ${MILESTONES[0]}=${checkoutM1.length} `
    + `(paid=${checkoutM1Paid}) → branch=${legacyBranch ? 'legacy 4-slot' : 'checkout'} paid=${paid}`);

  await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });
  await page.goto(`/health/applications/preview?id=${app.id}`);
  await expect(page.getByRole('heading', { name: 'ข้อมูลจากขั้นตอนที่ 1' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('heading', {
    name: legacyBranch ? 'เอกสารการเงินงวดที่ 1' : 'การชำระเงินงวดที่ 1',
  })).toBeVisible({ timeout: 60_000 });
  await shot(page, OUT, 'C05-01-preview.png');

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // F-G4-50: the stored single enum never reaches the screen; the Thai labels do, once each.
  expect(body).not.toContain('OUTDOOR');
  expect(body).not.toContain('GREENHOUSE');
  expect(body).not.toContain('INDOOR');
  expect(body).not.toContain('รูปแบบการปลูก -');
  // F-G4-51, either branch: no stored status enum is ever printed at the applicant.
  expect(body).not.toContain('PENDING');
  expect(body).not.toContain('RECEIPT_ISSUED');
  expect(body).not.toContain('CANCELLED');
  // B-F2, either branch: nor is the internal next-action enum. The keys come
  // from the page's own table, so an action added later is covered without this
  // walk being edited — and the walk cannot drift from the page's vocabulary.
  for (const action of Object.keys(NEXT_ACTION_LABELS)) {
    expect(body, `raw action enum ${action} must never reach the applicant`).not.toContain(action);
  }

  if (legacyBranch) {
    // Real legacy rows stay visible — the fix hides dead slots, not data.
    expect(body).toContain('เอกสารการเงินงวดที่ 1');
    expect(body).not.toContain('การชำระเงินงวดที่ 1');
  } else {
    expect(body).not.toContain('เอกสารการเงินงวดที่ 1');
    expect(body).toContain(paid ? 'ชำระแล้ว' : 'ยังไม่ชำระ');
    if (!paid) {
      expect(body).toContain('ชำระได้ที่หน้าชำระเงินหลังยื่นคำขอ');
      expect(body).toContain('ยังไม่ชำระงวดที่ 1');
      // The instruction the applicant can act on, built from the page's own
      // label table: an unpaid phase 1 is asked for in Thai, never as a key.
      expect(body).toContain(`ขั้นตอนถัดไป: ${NEXT_ACTION_LABELS.PAY_PHASE_1}`);
    }
  }
  console.log(`[C05] pressed: preview of ${app.id} — no raw enum, `
    + `${legacyBranch ? 'legacy rows still shown' : 'no legacy slots'}, phase-1 state = ${paid ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}`);
});
