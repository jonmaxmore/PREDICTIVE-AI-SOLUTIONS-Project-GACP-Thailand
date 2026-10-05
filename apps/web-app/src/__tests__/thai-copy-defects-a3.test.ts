import * as fs from 'fs';
import * as path from 'path';

/**
 * A3 (design-cleanup-2026-08-21) — Thai copy defects from the verified audit.
 *
 * Three defect classes, per the thai-ui-copy guideline:
 *   1. Missing space at the Thai/Latin boundary ("ของGACP" should be
 *      "ของ GACP") — 3 places.
 *   2. Em dash (—) used inside Thai copy instead of a plain space — 5
 *      places. `scripts/ci/check-thai-copy-style.js` (the repo's real
 *      enforcement gate) already catches em dashes INSIDE string/template
 *      literals (e.g. login-chooser.tsx), but has a structural blind spot
 *      for JSX text nodes split by `{expression}` containers, which is
 *      where the other 4 of these 5 live. This test covers exactly those
 *      file:line locations directly so the gap doesn't ship silently.
 *   3. Register mixing: health/payments/client-view.tsx used ท่าน where
 *      the app's register is คุณ everywhere else (lines ~347/409/411).
 *
 * EXCLUDED on purpose (do not add here): apps/web-app/src/app/health/
 * account/erasure/** (ท่าน is correct on that legal/PDPA surface) and the
 * footer i18n sections (owned by another in-flight change).
 */
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('[A3] Thai/Latin boundary spacing — "ของ GACP", not "ของGACP"', () => {
  const FILES: Record<string, string> = {
    start: read('app/health/start/client-view.tsx'),
    sopTemplates: read('app/health/sop-templates/client-view.tsx'),
    officialDocuments: read('app/health/official-documents/client-view.tsx'),
  };

  it('has a space between ของ and GACP in every affected file', () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(`${name}:${src.includes('ของGACP')}`).toBe(`${name}:false`);
      expect(`${name}:${src.includes('ของ GACP')}`).toBe(`${name}:true`);
    }
  });
});

describe('[A3] no em dash inside Thai copy (JSX-text cases the AST gate cannot see)', () => {
  // NOTE: these files legitimately keep em dashes in code COMMENTS (JSDoc,
  // //-lines) documenting non-Thai-copy history — that is explicitly
  // out of scope per the task ("do NOT touch em dashes in code comments").
  // So this asserts on the exact known defect substrings, not "file has
  // zero em dashes anywhere" (the naive whole-file version of this check
  // is exactly the false-positive trap check-thai-copy-style.js's own
  // test suite documents).
  const loginChooser = read('app/auth/_components/login-chooser.tsx');
  const generalLedgerViewer = read('app/provider/accounting/reports/GeneralLedgerViewer.tsx');
  const invoiceDetailModal = read('app/provider/accounting/invoice-detail-modal.tsx');
  const memberPermissionMatrix = read('app/health/workspaces/[slug]/members/member-permission-matrix.tsx');
  const reportModal = read('app/health/reports/report-modal.tsx');

  it('login-chooser: coming-soon notice body has no em dash before the reason clause', () => {
    expect(loginChooser).not.toContain('ไม่ได้ — ');
    expect(loginChooser).toContain('ไม่ได้ ${BLOCKER[providerKey]}');
  });

  it('GeneralLedgerViewer: account-code line has no em dash before the account name', () => {
    expect(generalLedgerViewer).not.toContain('{accountCode} — {data');
    expect(generalLedgerViewer).toContain('{accountCode} {data?.accountNameTh');
  });

  it('invoice-detail-modal: refund-confirm line has no em dash before the amount', () => {
    expect(invoiceDetailModal).not.toContain('{invoice.invoiceNumber} — {formatCurrency');
    expect(invoiceDetailModal).toContain('{invoice.invoiceNumber} {formatCurrency(invoice.amount)}');
  });

  it('member-permission-matrix: confirm dialog has no em dash before the member name', () => {
    expect(memberPermissionMatrix).not.toContain('” — {memberDisplayName}');
    expect(memberPermissionMatrix).toContain('” {memberDisplayName} ·');
  });

  it('report-modal: header line has no em dash before the farm name', () => {
    expect(reportModal).not.toContain('{modalData.year} — {modalData.farmName}');
    expect(reportModal).toContain('{modalData.year} {modalData.farmName}');
  });
});

describe('[A3] register consistency — health/payments uses คุณ, not ท่าน', () => {
  const paymentsSrc = read('app/health/payments/client-view.tsx');

  it('has no ท่าน left in the payments client-view (คุณ everywhere)', () => {
    expect(paymentsSrc.includes('ท่าน')).toBe(false);
  });

  it('still greets the user politely with คุณ in the fee-flow footnote and phase-1-paid banner', () => {
    expect(paymentsSrc).toContain('คุณจะได้รับ');
    expect(paymentsSrc).toContain('เอกสารของคุณ');
  });
});

describe('[A3] exclusions — legal/PDPA surface keeps ท่าน; footer files untouched here', () => {
  it('erasure page still uses ท่าน (out of scope for this batch)', () => {
    const erasureSrc = read('app/health/account/erasure/page.tsx');
    expect(erasureSrc.includes('ท่าน')).toBe(true);
  });
});
