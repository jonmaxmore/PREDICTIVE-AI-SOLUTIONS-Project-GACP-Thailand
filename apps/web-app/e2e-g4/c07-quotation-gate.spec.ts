/**
 * G4 · C07 — the gate refuses, in Thai, and then lets the applicant through.
 *
 * Spec 4 (F-G4-64): a payable application whose quotation is still PENDING
 * presses the pay door BEFORE accepting. The product must refuse and say why in
 * Thai. The applicant then accepts, and the same press is allowed as far as
 * creating the order.
 *
 * NOTHING IS PAID HERE. The spec says so, and it matters: this walk stops at the
 * created order and never authorises the PaymentIntent, so it can be re-run
 * without collecting money or moving its subject through the workflow. (The
 * order's PaymentIntent IS minted — that is what creating an order does — it is
 * simply never confirmed, so no money moves.)
 *
 * THE SUBJECT IS SEEDED DATA, not something this walk creates. It reads
 * `C07_APP` from VARS, falls back to querying the register for a payable
 * application of this farmer whose quotation is still PENDING, and FAILS with a
 * named reason when neither is present — a walk that cannot find its subject
 * must say so, not skip (coordinator ruling 9). The journey's own application is
 * excluded: C07 accepts and mints an order, and doing that to the application
 * a03/a05 are walking would rewrite the main journey's story.
 *
 * TWO THINGS HERE DIFFER FROM THE PLAN'S DRAFT, because HEAD behaves otherwise
 * and a walk asserts the product, not the plan:
 *
 *  1. The payments screen's pay entry — button AND the Thai refusal that
 *     replaces it — is rendered only when the applicant owes an unpaid invoice
 *     (`pendingAmount > 0`, app/health/payments/client-view.tsx). On the checkout
 *     rail no invoice exists until a checkout order is created
 *     (ensurePhaseInvoices returns skipped: 'CHECKOUT_RAIL'), so a fresh
 *     application shows ฿0 owed and NO entry block at all — see
 *     evidence/g4-rebuild-2026-08-25/a03/A03-payments.lqa.json, which contains
 *     the string "ชำระเงินออนไลน์" zero times. The screen half below therefore
 *     reads the debt FROM THE REGISTER and asserts the branch that debt requires:
 *     with an unpaid invoice the Thai refusal must be on screen, with none the
 *     entry block must be absent in every shape. Deciding that branch by looking
 *     at the screen would let a regression that deletes the refusal copy pass
 *     as "the known-absent block".
 *  2. The payment-terms acknowledgment has two shapes, because coordinator
 *     ruling 2 keeps ONE consent namespace: the tick box on the first charge,
 *     "คุณได้ยอมรับเงื่อนไขนี้ไว้แล้ว" on every later one. The first press below
 *     records the grant even though the charge is refused, so the second visit
 *     sees the second shape.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
import { FARMERS, pw, seg, shot, readVars, g4psql, g4Login, pickFarmer, REPO, PRICED_ROW_ORDER, acceptCheckoutTermsIfShown } from './g4-helpers';
import { lqaCapture } from './lqa';

const P = FARMERS[pickFarmer()];
const OUT = seg('c07');

/**
 * The newest payment-terms document published in THIS tree, without `.md`.
 *
 * The stamped version and the published document are two independent
 * artifacts: the filenames in docs/legal/ versus whatever the running server
 * resolved ConsentVersions.PAYMENT_TERMS to. Comparing them is the only way
 * this walk can catch a deployment still pinned to the superseded
 * docs/legal/payment-terms-th-v1.md through CONSENT_VERSION_PAYMENT_TERMS —
 * which is the exact regression the version bump exists to prevent, and which
 * a `/^payment-terms-th-v/` shape check passes without noticing.
 *
 * Same rule as apps/backend/__tests__/unit/
 * consent-version-matches-the-published-document.test.js, applied to the
 * running stack instead of to the constant.
 */
function newestPublishedPaymentTerms(): string {
  const versioned = readdirSync(join(REPO, 'docs', 'legal'))
    .map((file) => /^payment-terms-th-v(\d+(?:\.\d+)*)\.md$/.exec(file))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ file: m[0], parts: (m[1] ?? '').split('.').map(Number) }));
  versioned.sort((a, b) => {
    const width = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < width; i += 1) {
      const diff = (b.parts[i] || 0) - (a.parts[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  const newest = versioned[0];
  if (!newest) {
    // Not a walk failure to shrug at: with no published document there is
    // nothing to compare the stamped version against, and the assertion would
    // silently become vacuous. Say what is missing.
    throw new Error('no docs/legal/payment-terms-th-v*.md in the tree — C07 cannot check the stamped disclosure version');
  }
  return newest.file.replace(/\.md$/, '');
}

// No test.setTimeout here on purpose. playwright.g4.config.ts budgets 30 minutes
// per test and sets navigationTimeout: 200_000 because `next dev` compiles each
// route on first hit; this walk makes four navigations across two routes plus a
// login, an lqaCapture and several g4psql node spawns. Lowering that budget to
// five minutes made a cold stack die as "Test timeout exceeded" and read as a
// product failure on a walk that costs a live stack plus `stripe listen` to press.
test('C07 the pay door is shut until the quotation is accepted, then it opens', async ({ page }) => {
  const vars = readVars();
  const FARMER_ID = vars[`${P.varPrefix}_ID`] ?? '';
  const JOURNEY_APP = vars[`${P.varPrefix}_APP`] ?? '';
  expect(FARMER_ID, `${P.varPrefix}_ID in VARS (written by a01)`).toBeTruthy();
  expect(JOURNEY_APP, `${P.varPrefix}_APP in VARS (written by a01)`).toBeTruthy();

  // The subject: an application of THIS farmer that is payable at M1
  // (PAYABLE_STATES.M1 — stripe-checkout-service.js) and whose quotation is
  // still PENDING. Read from the register, never assumed.
  const pinned = vars.C07_APP ?? '';
  const candidates = JSON.parse(g4psql(
    `SELECT a.id, a.status, q."quotationNumber" AS qno, q.status AS qstatus
       FROM applications a JOIN quotations q ON q."applicationId" = a.id
      WHERE a."healthId" = (SELECT "healthId" FROM applications WHERE id='${JOURNEY_APP}')
        AND a.id <> '${JOURNEY_APP}'
        AND a.status IN ('SUBMITTED','PENDING_DOC_FEE')
        AND q.status = 'PENDING' AND q."isDeleted"=false
      ORDER BY a."createdAt" DESC LIMIT 1;`));
  writeFileSync(join(OUT, 'C07-subject.txt'), JSON.stringify({ pinned, candidates }, null, 2));
  if (!pinned) {
    expect(
      candidates.length,
      'no payable application with a PENDING quotation exists for this farmer — seed one (or set C07_APP in VARS) before running C07',
    ).toBeGreaterThan(0);
  }
  const APP: string = pinned || candidates[0].id;

  await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });

  // ── the door, shut ────────────────────────────────────────────────────────
  await page.goto(`/health/payments?app=${APP}`);
  await page.waitForLoadState('domcontentloaded');

  // What the screen DOES offer: the quotation, with its accept button.
  const card = page.getByTestId('quotation-review-section');
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  const acceptBtn = card.getByRole('button', { name: /ยอมรับใบเสนอราคา/ });
  await expect(acceptBtn.first(), 'the screen offers the acceptance').toBeVisible({ timeout: 60_000 });

  // What it must NOT offer: a way to pay.
  await expect(
    // Labelled "ชำระเงินออนไลน์" until operator decision 6 (2026-09-17, audit
    // UXUI-X01): the screen behind it cannot take a payment yet.
    page.getByRole('link', { name: 'สร้างรายการชำระเงิน' }),
    'no pay link is offered while the quotation is unaccepted',
  ).toHaveCount(0);

  // And where it explains itself, the explanation names the quotation.
  //
  // WHICH BRANCH IS OWED IS DECIDED BY THE REGISTER, NOT BY THE SCREEN. The
  // pay-entry block is debt-gated (header comment 1): `pendingAmount > 0` where
  // pendingAmount sums the UNPAID, NON-CANCELLED invoices the payments API
  // returns for this application (app/health/payments/client-view.tsx, and
  // lib/services/payment-service.ts for the paid/cancelled vocabulary). Asking
  // the screen whether it rendered the notice and then asserting the notice
  // only when it did makes a regression that DELETES the refusal copy
  // indistinguishable from the known-absent block — the walk stays green
  // either way. So the debt is read first, and each side is an assertion:
  //   owed > 0  → the notice MUST be there;
  //   owed = 0  → the whole entry block must be absent, in every one of its
  //               shapes, so an entry that appears without debt is caught too.
  // (Both branches also assume the checkout UI flag is on, which this walk
  // already requires: the checkout route 404s without it, and the press below
  // would fail first.)
  const owedRow = JSON.parse(g4psql(
    `SELECT COALESCE(SUM("totalAmount"), 0)::float8 AS owed, count(*)::int AS n FROM invoices
      WHERE "applicationId"='${APP}' AND "isDeleted"=false
        AND upper(status) NOT IN ('PAID','PAID_PENDING_RECEIPT','RECEIPT_ISSUED','APPROVED','CANCELLED');`))[0];
  const owed = Number(owedRow.owed) || 0;
  const refusalNotice = page.getByText(/ยอมรับใบเสนอราคาก่อน จึงจะสร้างรายการชำระเงินได้/);
  // Every shape the debt-gated entry block can take, so "absent" means absent
  // rather than "the one sentence I looked for is absent". Two notes on the
  // wording: the สร้างรายการชำระเงิน link is asserted separately above and the
  // block's own h3 and status line are deliberately NOT listed here, because
  // they only render beside that link; and the two sentences the wizard's
  // invoice step also uses (invoice-step.tsx) are matched with enough of their
  // payments-page tail to belong to this page only.
  const payEntryNotices = page.getByText(
    /ตรวจสอบใบเสนอราคาไม่สำเร็จ ระบบจึงยังไม่เปิดปุ่มสร้างรายการชำระเงิน|ยอมรับใบเสนอราคาก่อน จึงจะสร้างรายการชำระเงินได้|ใบเสนอราคาของคำขอนี้ไม่สามารถกดยอมรับได้แล้ว|ระบบกำลังออกใบเสนอราคาของคำขอนี้ กดปุ่มรีเฟรชด้านบน/,
  );
  writeFileSync(join(OUT, 'C07-pay-entry.txt'), JSON.stringify({
    applicationId: APP,
    payLinkOffered: false,
    unpaidInvoices: owedRow,
    expected: owed > 0
      ? 'ยอดรอชำระ > 0, so the pay-entry block renders and must name the quotation as the cause'
      : 'ยอดรอชำระ = 0, so no pay-entry block may render at all (checkout rail mints the invoice with the order)',
  }, null, 2));
  if (owed > 0) {
    await expect(
      refusalNotice.first(),
      'this application owes an unpaid invoice, so the payments screen must name the quotation as the cause',
    ).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(
      payEntryNotices,
      'nothing is owed, so no pay-entry block may render on the payments screen',
    ).toHaveCount(0);
  }
  await shot(page, OUT, 'C07-01-pay-button-withheld.png');
  await lqaCapture(page, OUT, 'C07-withheld', [P.firstName, P.lastName, P.farmName]);

  // The backend refuses too, not only the screen: go straight to the checkout
  // URL, which is what a bookmark or a hand-typed link would do.
  const ordersBefore = JSON.parse(g4psql(
    `SELECT count(*)::int AS n FROM checkout_orders WHERE "applicationId"='${APP}';`))[0];
  await page.goto(`/health/payments/checkout?app=${APP}&milestone=M1`);
  await page.waitForLoadState('domcontentloaded');
  await acceptCheckoutTermsIfShown(page, 'C07 refused press');
  await page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ }).click();
  // Verbatim from CHECKOUT_ERROR_MAP.QUOTATION_NOT_ACCEPTED
  // (app/health/payments/checkout/client-view.tsx) — the code is English on the
  // wire and becomes Thai in that one map, so this is the sentence an applicant
  // actually reads.
  await expect(
    page.getByText(/กดยอมรับใบเสนอราคาที่หน้ารายการชำระเงินก่อน/).first(),
    'the backend refusal reaches the applicant in Thai',
  ).toBeVisible({ timeout: 60_000 });
  await shot(page, OUT, 'C07-02-backend-refuses-in-thai.png');

  // And it minted nothing. Compared against the count taken before the press
  // rather than asserted to be zero: an order left over from the drain window
  // (coordinator ruling 5) is exactly what must NOT become a bypass, and the
  // claim being made is "a refused checkout leaves no order behind".
  const ordersAfter = JSON.parse(g4psql(
    `SELECT count(*)::int AS n FROM checkout_orders WHERE "applicationId"='${APP}';`))[0];
  writeFileSync(join(OUT, 'C07-orders-around-refusal.txt'), JSON.stringify({ ordersBefore, ordersAfter }, null, 2));
  expect(ordersAfter.n, 'a refused checkout leaves no order behind').toBe(ordersBefore.n);

  // ── the door, opened by the applicant's own press ──────────────────────────
  await page.goto(`/health/payments?app=${APP}`);
  await page.waitForLoadState('domcontentloaded');
  // NOT `card.waitFor({ state: 'visible' })` followed by a one-shot count():
  // the card's LOADING branch carries the SAME data-testid as the loaded one
  // (QuotationReviewSection renders the skeleton with aria-busy="true"), and
  // this page mounts it with `quotations` still null, so that wait is satisfied
  // by the skeleton. Counting buttons on the skeleton reads 0 and this walk
  // would report the product as offering no acceptance it does offer. The
  // retrying assertion below is the same one the first visit already uses.
  await expect(acceptBtn.first(), 'the card still offers the acceptance').toBeVisible({ timeout: 60_000 });
  // Every acceptable card, not just the first: a pre-W14 application carries a
  // DTAM row as well and the gate demands both.
  const acceptCount = await acceptBtn.count();
  for (let i = 0; i < acceptCount; i++) {
    await acceptBtn.first().click();
    await page.waitForTimeout(1500);
  }

  let q: { status: string; acceptedAt: string | null; hash: string | null; qno: string } | null = null;
  for (let i = 0; i < 10 && q?.status !== 'ACCEPTED'; i++) {
    const rows = JSON.parse(g4psql(
      `SELECT status, "acceptedAt", "acceptedSnapshotHash" AS hash, "quotationNumber" AS qno FROM quotations
        WHERE "applicationId"='${APP}' AND "isDeleted"=false ${PRICED_ROW_ORDER};`));
    q = rows[0] ?? null;
    if (q?.status !== 'ACCEPTED') await page.waitForTimeout(1500);
  }
  writeFileSync(join(OUT, 'C07-quotation.txt'), JSON.stringify(q, null, 2));
  expect(q?.status, 'the press was recorded').toBe('ACCEPTED');
  expect(q?.acceptedAt, 'with the instant it happened').toBeTruthy();
  expect(q?.hash, 'and it recorded WHAT was accepted, not only that it was').toBeTruthy();
  expect(q?.qno, 'the register names the document that was accepted').toBeTruthy();
  await shot(page, OUT, 'C07-03-accepted.png');

  // The same door now opens, as far as creating the order. No payment is made.
  await page.goto(`/health/payments/checkout?app=${APP}&milestone=M1`);
  await page.waitForLoadState('domcontentloaded');
  await acceptCheckoutTermsIfShown(page, 'C07 allowed press');
  await page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ }).click();
  await expect(page.getByText(/สร้างรายการสำเร็จ รอชำระเงิน/).first()).toBeVisible({ timeout: 120_000 });
  // The page names the document the charge collects against — the number the
  // register holds for it, not a shape that any quotation number would satisfy.
  await expect(
    page.getByText(String(q?.qno ?? '')).first(),
    'the screen names the quotation this charge collects against',
  ).toBeVisible();
  await shot(page, OUT, 'C07-04-order-created-unpaid.png');

  const order = JSON.parse(g4psql(
    `SELECT status, milestone, quotation_id, quotation_snapshot_hash, payment_terms_version, payment_terms_accepted_at
       FROM checkout_orders WHERE "applicationId"='${APP}' ORDER BY "createdAt" DESC LIMIT 1;`))[0];
  // The consent this charge was created under, read from the ONE ledger
  // (coordinator ruling 2: ConsentVersions.PAYMENT_TERMS + UserConsent).
  const consent = JSON.parse(g4psql(
    `SELECT c.version, c.granted FROM user_consents c
       JOIN users u ON u.id = c."userId"
       JOIN applications a ON a."healthId" = u."canonicalId"
      WHERE a.id='${APP}' AND c.category='PAYMENT_TERMS' LIMIT 1;`))[0];
  writeFileSync(join(OUT, 'C07-order.txt'), JSON.stringify({ order, consent }, null, 2));
  expect(order.status, 'created, and deliberately NOT paid in this walk').toBe('PENDING_PAYMENT');
  expect(order.quotation_id, 'the order names the quotation it collects against').toBeTruthy();
  expect(order.quotation_snapshot_hash, 'and the exact figures that were accepted').toBe(q!.hash);
  // Two separate claims, and neither can stand in for the other.
  //
  // (a) ONE namespace: the money row stamps the version the consent ledger
  //     holds. This is equal by construction today (payment-terms-gate.js
  //     copies the order's version from that same row), which is the point —
  //     it pins the construction.
  // (b) THE VERSION IS THE PUBLISHED ONE. A shape check like
  //     /^payment-terms-th-v/ passes for the SUPERSEDED
  //     docs/legal/payment-terms-th-v1.md, so a deployment still pinned to v1
  //     through CONSENT_VERSION_PAYMENT_TERMS would sail through the one
  //     assertion written to catch it (proved by running the matcher:
  //     evidence/f-g4-64-task-11/red-output-fix-r1.txt). The comparison is
  //     therefore against the newest document in THIS tree. If ops must pin an
  //     older version deliberately, this walk goes red and says so — that is
  //     the intended outcome, because the stamped version is the no-refund
  //     evidence on a money row.
  expect(consent?.granted, 'the applicant holds a granted payment-terms consent').toBe(true);
  expect(order.payment_terms_version, 'one consent namespace: the order stamps the version the ledger holds')
    .toBe(consent.version);
  expect(
    order.payment_terms_version,
    'the stamped disclosure is the newest published payment-terms document, not a superseded pin',
  ).toBe(newestPublishedPaymentTerms());
  expect(order.payment_terms_accepted_at, 'with the instant the applicant accepted it').toBeTruthy();
});
