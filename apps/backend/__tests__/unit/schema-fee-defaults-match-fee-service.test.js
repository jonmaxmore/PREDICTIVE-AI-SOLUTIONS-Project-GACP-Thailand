/**
 * The fee defaults written into the schema must be the fees the fee service computes.
 *
 * Application.phase1Amount and phase2Amount carry column defaults. They were 5535 and
 * 27675 — the single-scope totals under the formula that taxed only the platform slice,
 * retired on 2026-08-22 when the operator ruled VAT applies to the whole service fee. The
 * current single-scope totals are 5885 and 29425.
 *
 * The main path does not use the defaults: application-draft-query-methods.js:70-71 sets
 * both from feeService. That is exactly why this drifted unnoticed for three days — a
 * default nothing reads is a number nobody checks, right up until something omits the
 * column and quietly charges a farmer the old price.
 *
 * So this test does not assert the literals. It reads the schema and compares against what
 * the fee service actually produces, which means the two cannot drift again: change the fee
 * model without changing the schema and this fails, and vice versa.
 *
 * The deeper question — whether a money column should carry a default at all, given that a
 * default turns "nobody computed a price" into "here is a price" — is recorded in the
 * report rather than answered here, because removing it makes the column required at every
 * insert and that needs every insert found first.
 */
const fs = require('fs');
const path = require('path');
const feeService = require('../../modules/billing/internal/fee-service');

const SCHEMA_PATH = path.join(__dirname, '../../prisma/schema/application.prisma');

function readColumnDefault(source, column) {
  // e.g. `phase1Amount    Int       @default(5535)`
  const line = source
    .split('\n')
    .find((l) => new RegExp(`^\\s*${column}\\s`).test(l));
  if (!line) return null;
  const match = line.match(/@default\((\d+)\)/);
  return match ? Number(match[1]) : null;
}

describe('Application fee column defaults track the fee service', () => {
  const source = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const singleScope = { scopeCount: 1 };

  it('phase1Amount default equals the single-scope phase 1 total', () => {
    const expected = feeService.calculatePhase1Fee({}, singleScope).phaseTotal;
    expect(readColumnDefault(source, 'phase1Amount')).toBe(expected);
  });

  it('phase2Amount default equals the single-scope phase 2 total', () => {
    const expected = feeService.calculatePhase2Fee({}, singleScope).phaseTotal;
    expect(readColumnDefault(source, 'phase2Amount')).toBe(expected);
  });

  it('the confirmed figures are what the fee service produces, so this test is anchored to something real', () => {
    // If these two ever change, the operator changed the fee model and the schema must
    // follow — the assertions above are what make that automatic rather than remembered.
    expect(feeService.calculatePhase1Fee({}, singleScope).phaseTotal).toBe(5885);
    expect(feeService.calculatePhase2Fee({}, singleScope).phaseTotal).toBe(29425);
  });

  it('no comment in the schema still describes VAT as applying to the platform fee alone', () => {
    // The retired formula was "state + 10% platform + 7% VAT on platform". Leaving that
    // wording beside a corrected number is worse than leaving the number wrong: it tells
    // the next reader the old model is current.
    const feeCommentBlock = source
      .split('\n')
      .filter((l) => /^\s*\/{2,3}/.test(l))
      .join('\n');
    expect(feeCommentBlock).not.toMatch(/VAT\s+on\s+platform/i);
    expect(feeCommentBlock).not.toMatch(/7%\s*VAT\s*on\s*(the\s*)?platform/i);
  });
});
