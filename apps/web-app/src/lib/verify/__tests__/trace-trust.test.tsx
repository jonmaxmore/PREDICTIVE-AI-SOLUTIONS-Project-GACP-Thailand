/**
 * trace-trust.test.tsx — Batch 1 (crypto-trust) FE C + adversarial M3 fix.
 *
 * CORE INVARIANT (M3): the public trace surfaces keep TWO signals SEPARATE.
 *   - certification STATUS (data.certificate.isValid) gates the green
 *     "GACP Certified" badge/hero/headline/timeline step.
 *   - the cryptographic QR-SEAL verdict (data.verification.valid) gates ONLY the
 *     seal caption (RSA-SHA256). FAIL-CLOSED: positive seal wording requires
 *     verification.valid === true.
 *
 * A certified product whose QR seal can't be confirmed must STILL read
 * "certified" (trust.certified true) — never flipped to a red invalid product —
 * with a SEPARATE neutral seal note. This is precisely the M3 regression: a
 * fully-certified active cycle (verification.valid false because cycles aren't
 * sealed at cycle granularity) was being shown as a red "Unverified QR" product.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveTraceTrust, traceVerificationCaption } from '../trace-trust';

const POS_RSA = 'ยืนยันความถูกต้องของรหัส QR ด้วยลายเซ็นดิจิทัล (RSA-SHA256)';
const SEAL_NEUTRAL = 'ยังไม่ได้ยืนยันลายเซ็นดิจิทัล';

describe('deriveTraceTrust — certification STATUS vs QR-SEAL are decoupled', () => {
    it('cert valid + seal verified → certified AND sealVerified', () => {
        const t = deriveTraceTrust(true, true);
        expect(t.certified).toBe(true);
        expect(t.sealVerified).toBe(true);
        expect(t.titleTH).toContain('ผ่านการรับรอง');
    });

    // M3 CORE: a certified product whose seal can't be confirmed must NOT be a
    // red/invalid product — it stays certified with seal-unverified.
    it('cert valid but seal NOT verified → STILL certified (NOT a red invalid product), seal not verified', () => {
        const t = deriveTraceTrust(true, false);
        expect(t.certified).toBe(true); // product badge stays green
        expect(t.sealVerified).toBe(false); // only the seal line is neutral
        expect(t.verified).toBe(true); // product-trust signal === certified, NOT the seal
        expect(t.titleTH).toContain('ผ่านการรับรอง');
        expect(t.titleTH).not.toContain('ยังไม่ได้รับการรับรอง');
    });

    it('seal verdict absent (undefined) → certified unaffected; seal simply not verified', () => {
        const t = deriveTraceTrust(true, undefined);
        expect(t.certified).toBe(true);
        expect(t.sealVerified).toBe(false);
    });

    it('cert invalid → NOT certified regardless of seal verdict', () => {
        expect(deriveTraceTrust(false, true).certified).toBe(false);
        expect(deriveTraceTrust(false, false).certified).toBe(false);
        expect(deriveTraceTrust(false, true).titleTH).toContain('ยังไม่ได้รับการรับรอง');
    });

    it('cert null/undefined → NOT certified', () => {
        expect(deriveTraceTrust(undefined, true).certified).toBe(false);
        expect(deriveTraceTrust(null, null).certified).toBe(false);
    });
});

describe('traceVerificationCaption — seal line gated SOLELY on the QR verdict', () => {
    it('seal verified → positive RSA-SHA256 claim', () => {
        const t = deriveTraceTrust(true, true);
        const html = renderToStaticMarkup(<p>{traceVerificationCaption(t)}</p>);
        expect(html).toContain(POS_RSA);
    });

    it('certified but seal NOT verified → NEUTRAL seal note, NOT a positive RSA claim and NOT a product invalidation', () => {
        const t = deriveTraceTrust(true, false);
        const html = renderToStaticMarkup(<p>{traceVerificationCaption(t)}</p>);
        expect(html).not.toContain(POS_RSA);
        expect(html).toContain(SEAL_NEUTRAL);
    });

    it('seal verdict absent → neutral seal note (the cycle-granularity case)', () => {
        const t = deriveTraceTrust(true, undefined);
        const html = renderToStaticMarkup(<p>{traceVerificationCaption(t)}</p>);
        expect(html).not.toContain(POS_RSA);
        expect(html).toContain(SEAL_NEUTRAL);
    });

    // The seal caption follows the seal verdict alone — even an UNCERTIFIED
    // product with a (hypothetically) valid seal would show the positive seal
    // line; the product badge is the separate certified gate.
    it('seal verified is independent of certification status', () => {
        const t = deriveTraceTrust(false, true);
        expect(t.sealVerified).toBe(true);
        const html = renderToStaticMarkup(<p>{traceVerificationCaption(t)}</p>);
        expect(html).toContain(POS_RSA);
    });
});
