import * as fs from 'fs';
import * as path from 'path';

/**
 * C6-02/03 guard (owner-directed, 2026-06-10): the public marketing surfaces must
 * NOT advertise the fabricated Certificate Fee (535) / annual Surveillance Fee
 * (2,675) — neither exists in the fee engine, the DB, or any workflow state — and
 * must not claim a card/PCI-DSS payment gateway. Fee figures must come from
 * GET /api/pricing/fees (fetchPublicFees), never hardcoded literals and never
 * a web constant (constants/fees.ts held literals until 2026-10-03). Locks the
 * reconciliation.
 */
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

/**
 * `landing` (page.tsx) left this map on 2026-08-14: the root became
 * `redirect('/auth')` (login front door — spec §3.3), so it prints no fee
 * figure at all and cannot "source them from the SSoT". The negative guards
 * below still cover it — a fabricated fee creeping back into the root would
 * fail them — and `root-redirect.test.tsx` pins that it stays a redirect,
 * which is what makes dropping it from the SSoT-import list honest rather
 * than convenient.
 */
const FILES: Record<string, string> = {
  landing: read('page.tsx'),
  pricing: read('pricing/page.tsx'),
  tos: read('terms-of-service/page.tsx'),
};

// Surfaces that actually render a fee figure, and therefore must read it from
// the served fees instead of typing a number or importing a constant.
const FEE_DISPLAY_FILES: Record<string, string> = {
  pricing: FILES.pricing,
  tos: FILES.tos,
};

describe('marketing fee surfaces — no fabricated fees (C6-02/03)', () => {
  it('drops the fabricated Certificate Fee / Surveillance Fee labels + amounts', () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(`${name}:${src.includes('Certificate Fee')}`).toBe(`${name}:false`);
      expect(`${name}:${src.includes('Surveillance Fee')}`).toBe(`${name}:false`);
      expect(`${name}:${src.includes("'535'")}`).toBe(`${name}:false`);
      expect(`${name}:${src.includes("'2675'")}`).toBe(`${name}:false`);
      expect(`${name}:${src.includes('2,675')}`).toBe(`${name}:false`);
    }
  });

  it('does not advertise a card / PCI-DSS payment gateway', () => {
    for (const [name, src] of Object.entries(FILES)) {
      expect(`${name}:${src.includes('PCI-DSS')}`).toBe(`${name}:false`);
      expect(`${name}:${src.includes('บัตรเครดิต')}`).toBe(`${name}:false`);
    }
  });

  it('sources fee figures from the served fees, not from a web constant', () => {
    for (const [name, src] of Object.entries(FEE_DISPLAY_FILES)) {
      expect(`${name}:${src.includes('await fetchPublicFees()')}`).toBe(`${name}:true`);
      expect(`${name}:${src.includes('@/constants/fees')}`).toBe(`${name}:false`);
    }
  });

  it('the landing surface displays no fee figure at all — it is the /auth redirect', () => {
    expect(FILES.landing).toContain("redirect('/auth')");
    expect(FILES.landing).not.toContain('fmtTHB');
    expect(FILES.landing).not.toContain('priceCurrency');
  });
});
