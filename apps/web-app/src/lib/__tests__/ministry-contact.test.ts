/**
 * ministry-contact.test.ts — drift guard.
 *
 * The frontend MINISTRY_CONTACT must stay in sync with the backend
 * source of truth (`apps/backend/shared/ministry-contact.js`). If a
 * later PR changes one without the other, this test fails loud.
 *
 * We assert the exact phone number that was verified from the official
 * DTAM site footer on 2026-04-28 — `0-2591-7007`. Any future change
 * MUST update both modules and this assertion together.
 */

import {
  MINISTRY_CONTACT,
  ministryMailtoHref,
  ministryTelHref,
} from '../ministry-contact';

describe('MINISTRY_CONTACT (frontend mirror of backend canonical)', () => {
  it('phone matches DTAM-confirmed value 0-2591-7007', () => {
    expect(MINISTRY_CONTACT.phone).toBe('0-2591-7007');
  });

  it('email is the GACP contact mailbox, not the dummy domain', () => {
    expect(MINISTRY_CONTACT.email).toBe('contact@gacpth.com');
    expect(MINISTRY_CONTACT.email).not.toContain('gacp-thai');
  });

  it('ministry name + website match official DTAM strings', () => {
    expect(MINISTRY_CONTACT.ministry).toBe(
      'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
    );
    expect(MINISTRY_CONTACT.website).toBe('https://dtam.moph.go.th');
  });

  it('ministryTelHref converts dashed local format to E.164 +66', () => {
    expect(ministryTelHref()).toBe('tel:+6625917007');
  });

  it('ministryMailtoHref produces a valid mailto URL', () => {
    expect(ministryMailtoHref()).toBe(`mailto:${MINISTRY_CONTACT.email}`);
  });

  it('the constant object is frozen against accidental mutation at runtime', () => {
    expect(Object.isFrozen(MINISTRY_CONTACT)).toBe(true);
  });
});
