/**
 * BUG C — PDPA: the workspace members list must NOT render a co-member's full
 * 13-digit national ID unmasked.
 *
 * The members API returns the decrypted plaintext national ID (healthId). A
 * workspace OWNER seeing a co-member's FULL national ID is an unnecessary
 * disclosure. The fix is display-layer only (does NOT touch at-rest crypto):
 * render maskHealthIdCard(m.healthId) instead of the raw value.
 *
 * Convention: repo fs source-scan pin (no @testing-library/react; the page
 * fetches in a useEffect) + a pure-logic assertion on the mask helper.
 */

import fs from 'fs';
import path from 'path';
import { maskHealthIdCard } from '@/utils/validation';

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');

describe('BUG C — member national ID is masked in the members list', () => {
  it('maskHealthIdCard hides the last 3 digits of a 13-digit id', () => {
    // e.g. 1101700230711 → 1-1017-00230-**-* (birth-order + check digit hidden)
    const masked = maskHealthIdCard('1101700230711');
    expect(masked).toBe('1-1017-00230-**-*');
    // the full plaintext must NOT survive the mask
    expect(masked).not.toContain('230711');
    expect(masked).not.toBe('1101700230711');
  });

  it('the members page masks healthId (uses maskHealthIdCard, not the raw value)', () => {
    expect(PAGE).toMatch(/maskHealthIdCard\s*\(\s*m\.healthId\s*\)/);
    expect(PAGE).toMatch(/from ['"]@\/utils\/validation['"]/);
  });

  it('the members page does NOT render the raw {m.healthId} in the row copy', () => {
    // the pre-fix bug: `เลขบัตร: <span ...>{m.healthId}</span>`
    expect(PAGE).not.toMatch(/\{\s*m\.healthId\s*\}/);
  });
});
