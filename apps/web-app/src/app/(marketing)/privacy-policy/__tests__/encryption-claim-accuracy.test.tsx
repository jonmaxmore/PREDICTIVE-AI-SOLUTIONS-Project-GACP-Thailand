/**
 * PDPA accuracy guard (readiness audit 2026-06-29, owner-approved P0 §11 fix).
 *
 * The privacy policy MUST NOT claim "Encryption at Rest" for stored personal
 * data while PDPA field-level encryption is OFF in production
 * (ENABLE_PDPA_FIELD_ENCRYPTION=false) and the national ID is stored as
 * plaintext — that is a PDPA §23/§37 misrepresentation. This test locks the
 * corrected, verifiable wording (TLS in-transit + field-encryption in
 * development) so the false at-rest claim cannot regress.
 *
 * NOTE: the former cross-border section (§7, "การส่งหรือโอนข้อมูลไปต่างประเทศ") was
 * removed entirely 2026-09-27 (operator ruling) — see
 * residency-claim-removed.test.tsx — so the sections after it renumbered and
 * this encryption claim is now §10, not §11.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacyPolicyPage from '../page';

describe('privacy-policy §10 encryption claim accuracy', () => {
  const html = renderToStaticMarkup(<PrivacyPolicyPage />);

  it('does NOT claim Encryption at Rest for stored data (field-encryption is off in prod)', () => {
    expect(html).not.toContain('Encryption at Rest');
    expect(html).not.toContain('ขณะจัดเก็บ (Encryption at Rest)');
  });

  it('states the verifiable TLS in-transit protection', () => {
    expect(html).toContain('TLS 1.2');
    expect(html).toMatch(/Encryption in Transit/);
  });

  it('discloses field-level encryption as in development (not yet active), honestly', () => {
    expect(html).toContain('Field-Level Encryption');
    expect(html).toMatch(/อยู่ระหว่างการพัฒนา/);
  });
});
