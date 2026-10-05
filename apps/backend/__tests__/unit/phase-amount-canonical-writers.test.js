/**
 * Phase Amount Canonical Writers — Static Drift Check
 *
 * Asserts that every code-path writer of `Application.phase1Amount` /
 * `Application.phase2Amount` sources its value from
 * `feeService...phase{1,2}.total` (or `.phaseTotal`), NOT
 * `.stateAmount`.
 *
 * BACKGROUND
 * The canonical-billing-amount fix (`fix/phase-amount-caller-canonical-
 * semantics`, commit 5ce0649) established that `Application.phase{1,2}
 * Amount` is canonically the FULL phase total — what the user is actually
 * charged at the gateway (state fee + 10% platform fee + 7% VAT on
 * platform). Five writers exist; some used `.total`, some used
 * `.stateAmount`. Pre-canonical-PR they coincided (fee-service returned
 * `total === stateAmount`); post-canonical they will diverge by 535 / 2675.
 *
 * This proactive drift check breaks if a future writer reaches for
 * `.stateAmount` again, or if a new writer is added that bypasses the
 * canonical pattern.
 *
 * KNOWN-DRIFT EXCLUSIONS (origin/main, 2026-04-28)
 *
 * Two files are explicitly excluded from the strict assertion below
 * because the canonical PR has not yet merged to main. Once it merges
 * (commit 5ce0649 reaches main), remove them from KNOWN_DRIFT_EXCLUSIONS
 * and the assertion will activate for them too:
 *
 *   - apps/backend/routes/api/preview/preview.js                 line 85,86
 *   - apps/backend/services/application-service/
 *     application-review-revision-methods.js                     line 49
 *
 * (See the canonical PR commit message for the full audit.)
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BACKEND_ROOT = path.join(REPO_ROOT, 'apps/backend');

// Every known writer of Application.phase{1,2}Amount.
// Keep this list in lockstep with the audit in commit 5ce0649's body.
const WRITER_FILES = [
  'services/payment-service-phase-flow.js',
  'services/application-service/application-submission-methods.js',
  'services/application-service/application-draft-query-methods.js',
  // routes/api/preview/preview.js left this list 2026-09-30 (P-GET): the
  // preview GET computes the phase totals and returns them; it no longer
  // writes them onto the application row.
  // application-review-revision-methods.js left this list in Wave 0: its
  // phase-amount writer lived in reviewApplication(), deleted as dead code
  // (zero production callers — docs/payment-refactor/legacy-payment-audit.md).
];

// Files known to drift on origin/main today, slated for fix in canonical PR.
// Remove an entry here once that file's writer is migrated to .total /
// .phaseTotal in main.
const KNOWN_DRIFT_EXCLUSIONS = new Set([
  // routes/api/preview/preview.js removed 2026-09-30 (P-GET): no longer a writer.
  // application-review-revision-methods.js was removed from this list in
  // Wave 0: its phase-amount writer lived in reviewApplication(), which was
  // deleted as dead code (zero production callers).
]);

// Match assignments of phase{1,2}Amount that read from .stateAmount.
// Examples this catches:
//   phase1Amount: fees.phase1.stateAmount
//   feePatch.phase1Amount = phase1Amount; <-- not caught (intermediate var)
//   updateData.phase2Amount = phase2Fee.stateAmount; <-- caught
// We intentionally only look at the literal phase{1,2}Amount = X.stateAmount
// pattern. A more thorough check would trace intermediate variables, but
// the bar here is "no fresh reader writes phase{1,2}Amount = .stateAmount
// directly", which is the actual drift mode we worry about.
const STATE_AMOUNT_DIRECT_WRITE = /phase[12]Amount\s*[:=]\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.stateAmount\b/;

// Match assignments of phase{1,2}Amount that read from a full-phase-total
// source. Acceptable canonical write pattern.
//   - `.total` / `.phaseTotal`     — direct read of a fee-service phase result
//   - `.phase{1,2}Total`           — GAP-5 (2026-07-08): payment-service-phase-
//     flow now sources phase amounts through resolveLockedPhaseTotals(), which
//     returns { phase1Total, phase2Total } copied from the accepted quotation
//     (frozen price-of-record) or the recompute — both full phase totals, never
//     stateAmount. This is the same full-total invariant, one indirection down.
const TOTAL_WRITE = /phase[12]Amount\s*[:=]\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.(?:total|phaseTotal|phase[12]Total)\b/;

describe('phase-amount canonical writers — static drift check', () => {
  test.each(WRITER_FILES)(
    'writer %s exists (audit list is up to date)',
    relPath => {
      const absPath = path.join(BACKEND_ROOT, relPath);
      expect(fs.existsSync(absPath)).toBe(true);
    },
  );

  describe('canonical writers (must read from .total / .phaseTotal)', () => {
    const canonical = WRITER_FILES.filter(f => !KNOWN_DRIFT_EXCLUSIONS.has(f));

    test.each(canonical)(
      '%s: writes phase{1,2}Amount from .total or .phaseTotal',
      relPath => {
        const src = fs.readFileSync(path.join(BACKEND_ROOT, relPath), 'utf8');
        // The file MUST contain at least one canonical write.
        expect(TOTAL_WRITE.test(src)).toBe(true);
      },
    );

    test.each(canonical)(
      '%s: does NOT write phase{1,2}Amount from .stateAmount (canonical drift)',
      relPath => {
        const src = fs.readFileSync(path.join(BACKEND_ROOT, relPath), 'utf8');
        // No `phase{1,2}Amount = X.stateAmount` direct writes allowed.
        expect(STATE_AMOUNT_DIRECT_WRITE.test(src)).toBe(false);
      },
    );
  });

  // The 'known-drift writers' block went with its last entry (preview.js,
  // 2026-09-30): an empty test.each table is an error, and there is nothing
  // left to track. Re-add the block if a writer is ever parked here again.

  test('no NEW writer of phase{1,2}Amount has been introduced (audit list completeness)', () => {
    // Static-grep the whole apps/backend/services and apps/backend/routes
    // tree for `phase{1,2}Amount\s*[:=]` patterns and verify that every
    // hit lives in a file already in WRITER_FILES (or is a known
    // non-write context like a Prisma where-clause read or a logger
    // statement).
    //
    // Exclusions:
    //   - tests (anything under __tests__)
    //   - the schema directory itself (Prisma)
    //   - .d.ts type declarations
    //   - feePatch / updateData object construction noise (we only flag
    //     direct property assignments that pair with a value source)
    const SCAN_DIRS = [
      path.join(BACKEND_ROOT, 'services'),
      path.join(BACKEND_ROOT, 'routes'),
    ];

    function* walkJs(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') {continue;}
          yield* walkJs(full);
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
          if (entry.name.endsWith('.d.ts')) {continue;}
          yield full;
        }
      }
    }

    // Pattern: writes that look like `<lhs>.phase{1,2}Amount = <expr>` or
    // an object-literal `phase{1,2}Amount: <expr>` where <expr> is NOT
    // an intermediate variable like `phase1Amount` itself or a literal
    // null. We're hunting for fresh sources of truth — direct reads from
    // a fee-service result.
    const FEE_SERVICE_WRITE = /phase[12]Amount\s*[:=]\s*(?:[A-Za-z_$][\w$]*\.)+(?:total|phaseTotal|stateAmount)\b/;

    const writerSet = new Set(
      WRITER_FILES.map(f => path.normalize(path.join(BACKEND_ROOT, f))),
    );

    const offenders = [];
    for (const dir of SCAN_DIRS) {
      if (!fs.existsSync(dir)) {continue;}
      for (const file of walkJs(dir)) {
        const norm = path.normalize(file);
        const src = fs.readFileSync(file, 'utf8');
        if (FEE_SERVICE_WRITE.test(src) && !writerSet.has(norm)) {
          offenders.push(path.relative(BACKEND_ROOT, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
