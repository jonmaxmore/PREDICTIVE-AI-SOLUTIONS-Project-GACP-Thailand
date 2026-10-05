/**
 * Seed integrity — every seeded OFFICER role must be a CANONICAL PROVIDER role.
 *
 * Provider-ID carpet UAT (2026-07-09) found seed-gacp.js seeded a COORDINATOR
 * officer, but COORDINATOR is NOT in PROVIDER_CANONICAL_ROLES and has no
 * normalizeRole() case, so the provider login rejects it with 403
 * INVALID_PROVIDER_ROLE — a dead account that can never authenticate.
 *
 * This static-source guard (no DB / no seed execution) parses the OFFICERS
 * array out of seed-gacp.js and asserts each role authenticates as a provider
 * role, so a non-canonical officer role can never be reintroduced silently.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isProviderRole } = require('../../shared/canonical-rbac');

const SEED_PATH = path.join(__dirname, '..', '..', 'prisma', 'seed-gacp.js');

// Extract the OFFICERS = [ ... ]; block, then pull each `role: 'XXX'`.
function seededOfficerRoles() {
  const src = fs.readFileSync(SEED_PATH, 'utf8');
  const start = src.indexOf('const OFFICERS = [');
  expect(start).toBeGreaterThan(-1);
  // The array ends at the first `];` after the declaration.
  const end = src.indexOf('];', start);
  expect(end).toBeGreaterThan(start);
  const block = src.slice(start, end);
  // Quote-agnostic: match both single- and double-quoted role literals so a
  // future re-add can't dodge the guard by switching quote style (no eslint
  // quotes rule forces single quotes here). Template-literal / constant role
  // values remain out of scope — those would fail loudly on first login.
  const roles = [...block.matchAll(/role:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return roles;
}

describe('seed-gacp.js OFFICERS — canonical provider roles only', () => {
  const roles = seededOfficerRoles();

  it('seeds at least the core officer roles', () => {
    // Sanity: the parse found roles and the array is non-trivial.
    expect(roles.length).toBeGreaterThanOrEqual(5);
  });

  it.each([...new Set(roles)])(
    'seeded officer role %s is a canonical provider role (would log in, not 403)',
    (role) => {
      expect(isProviderRole(role)).toBe(true);
    },
  );

  it('does NOT seed the removed COORDINATOR role (dead account regression)', () => {
    expect(roles).not.toContain('COORDINATOR');
  });
});
