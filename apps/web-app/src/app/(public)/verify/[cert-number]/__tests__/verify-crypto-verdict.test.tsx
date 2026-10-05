/**
 * verify-crypto-verdict.test.tsx — Batch 1 (crypto-trust) FE B.
 *
 * The public cert-verify page now surfaces the backend crypto verdict
 * (data.integrity / data.signatureValid / data.sealed / data.publicKeyFingerprint)
 * ON TOP OF the existing status/expiry display. These contracts pin the
 * trust-critical behaviour:
 *
 *   1. status-valid BUT integrity TAMPERED / signatureValid:false → the hero
 *      flips RED ('เอกสารถูกแก้ไข' / 'TAMPERED'); the green-valid hero copy
 *      ('ใบรับรองถูกต้องและยังมีผลบังคับใช้') MUST NOT appear.
 *   2. integrity VALID + signatureValid:true → the verified chip
 *      ('ตรวจสอบลายเซ็นดิจิทัลแล้ว') appears; fingerprint (first 16 hex) shown.
 *   3. integrity UNSIGNED → amber legacy note appears; the green crypto chip
 *      does NOT — but the STATUS hero stays GREEN (heroTone:'success'), because a
 *      legacy unsigned cert is still a VALID cert (it must not render red-invalid).
 *   4. no integrity in data → NO positive crypto claim (no verified chip), but
 *      a status-valid cert still renders GREEN (heroTone:'success') so an
 *      FE-ahead-of-BE deploy never red-flags every valid cert.
 *   5. VALID + signatureValid:null (downgrade: tamper + recompute unkeyed hash +
 *      strip signature) → NO green chip (heroOk:false) + amber caution; the
 *      STATUS hero stays green but authenticity is shown unconfirmed.
 *
 * The page's GREEN status hero is driven by `view.heroTone === 'success'` (status
 * valid AND not crypto-tampered) — NOT by `heroOk` — so these heroTone assertions
 * ARE the page-hero contract.
 *
 * Convention: pure view-model (deriveVerifyView) + presentational sub-component
 * (CryptoVerdict) live in the sibling `verify-view` module (Next.js forbids
 * extra exports from a route's page.tsx), so we can renderToStaticMarkup them
 * without standing up the async server component / next/headers.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveVerifyView, CryptoVerdict } from '../verify-view';

const GREEN_HERO_TH = 'ใบรับรองถูกต้องและยังมีผลบังคับใช้';
const VERIFIED_CHIP_TH = 'ตรวจสอบลายเซ็นดิจิทัลแล้ว';
const TAMPERED_TH = 'เอกสารถูกแก้ไข';
const UNSIGNED_TH = 'ใบรับรองรุ่นเก่า ไม่มีลายเซ็นดิจิทัล';

describe('deriveVerifyView (cert verify view-model)', () => {
    it('status-valid + TAMPERED (hash mismatch) → danger tone, green hero overridden RED', () => {
        // TAMPERED comes from the key-INDEPENDENT hash recompute — the only
        // reliable red. signatureValid is irrelevant to this verdict.
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'TAMPERED', signatureValid: null, sealed: true },
        });
        expect(view.statusValid).toBe(true);   // status/expiry unchanged
        expect(view.heroOk).toBe(false);
        expect(view.heroTone).toBe('danger');  // hero flips RED
        expect(view.crypto.tone).toBe('danger');
    });

    it('status-valid + signatureValid:false (KEY ROTATION) → GREEN status hero + amber, NOT red', () => {
        // A verifying key that no longer matches the signing key makes a
        // perfectly valid cert report signatureValid:false. It must NOT render
        // red — the status hero stays green; only an amber "signature not
        // verified" caution is added. (Red is reserved for integrity:TAMPERED.)
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'VALID', signatureValid: false, sealed: true },
        });
        expect(view.statusValid).toBe(true);
        expect(view.heroOk).toBe(false);           // no green crypto chip
        expect(view.heroTone).toBe('success');     // status hero stays GREEN (not red)
        expect(view.crypto.tone).toBe('warning');  // amber caution
    });

    it('status-valid + VALID + signed → heroOk true, success tone, showVerifiedChip', () => {
        const view = deriveVerifyView({
            verified: true,
            data: {
                integrity: 'VALID',
                signatureValid: true,
                sealed: true,
                publicKeyFingerprint: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            },
        });
        expect(view.heroOk).toBe(true);
        expect(view.heroTone).toBe('success');
        expect(view.showVerifiedChip).toBe(true);
        expect(view.fingerprintShort).toBe('abcdef0123456789');
    });

    it('status-valid + UNSIGNED → heroTone success (GREEN status hero), no verified chip (M2: legacy cert not red-flagged)', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'UNSIGNED', signatureValid: null, sealed: false },
        });
        expect(view.statusValid).toBe(true);
        expect(view.heroOk).toBe(false);          // no green crypto chip
        expect(view.heroTone).toBe('success');    // but the STATUS hero stays GREEN — NOT red-invalid
        expect(view.crypto.tone).toBe('warning');
        expect(view.showVerifiedChip).toBe(false);
        expect(view.isUnsigned).toBe(true);
    });

    it('status-valid + VALID + signatureValid:null (DOWNGRADE) → no chip, warning crypto, GREEN status hero (M1)', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'VALID', signatureValid: null, sealed: false },
        });
        expect(view.statusValid).toBe(true);
        expect(view.heroOk).toBe(false);          // tamper+recompute+strip-sig must NOT earn the green chip
        expect(view.showVerifiedChip).toBe(false);
        expect(view.crypto.tone).toBe('warning'); // amber "signature not verified"
        expect(view.heroTone).toBe('success');    // status hero green; authenticity shown unconfirmed via amber note
    });

    it('status-valid + NO integrity field (FE deployed ahead of BE) → GREEN status hero, no crypto claim (M2 scenario B)', () => {
        const view = deriveVerifyView({ verified: true, data: { status: 'active' } });
        expect(view.statusValid).toBe(true);
        expect(view.heroTone).toBe('success');    // every valid cert must NOT render red-invalid pre-BE-deploy
        expect(view.hasIntegrity).toBe(false);
        expect(view.showVerifiedChip).toBe(false);
    });

    it('not-found / no integrity (verified:false) → no positive crypto claim, status hero not green', () => {
        const view = deriveVerifyView({ verified: false, data: { status: 'invalid' } });
        expect(view.showVerifiedChip).toBe(false);
        expect(view.heroOk).toBe(false);
        expect(view.heroTone).not.toBe('success');
        expect(view.crypto.tone).toBe('warning');
    });

    it('null result (fetch failed) → no crash, no positive claim', () => {
        const view = deriveVerifyView(null);
        expect(view.statusValid).toBe(false);
        expect(view.heroOk).toBe(false);
        expect(view.showVerifiedChip).toBe(false);
    });
});

describe('CryptoVerdict (presentational)', () => {
    it('TAMPERED renders the tampered copy and NOT the green-valid hero copy', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'TAMPERED', signatureValid: false, sealed: true },
        });
        const html = renderToStaticMarkup(<CryptoVerdict view={view} />);
        expect(html).toContain(TAMPERED_TH);
        expect(html).toContain('TAMPERED');
        expect(html).not.toContain(GREEN_HERO_TH);
        expect(html).not.toContain(VERIFIED_CHIP_TH);
    });

    it('VALID + signed renders the verified chip + short fingerprint', () => {
        const view = deriveVerifyView({
            verified: true,
            data: {
                integrity: 'VALID',
                signatureValid: true,
                sealed: true,
                publicKeyFingerprint: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            },
        });
        const html = renderToStaticMarkup(<CryptoVerdict view={view} />);
        expect(html).toContain(VERIFIED_CHIP_TH);
        expect(html).toContain('abcdef0123456789'); // first 16 hex for offline check
        expect(html).not.toContain(TAMPERED_TH);
    });

    it('UNSIGNED renders the amber legacy note and NOT the green crypto chip', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'UNSIGNED', signatureValid: null, sealed: false },
        });
        const html = renderToStaticMarkup(<CryptoVerdict view={view} />);
        expect(html).toContain(UNSIGNED_TH);
        expect(html).not.toContain(VERIFIED_CHIP_TH);
    });

    it('VALID + signatureValid:null (downgrade) → amber caution, NOT the green verified chip', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'VALID', signatureValid: null, sealed: false },
        });
        const html = renderToStaticMarkup(<CryptoVerdict view={view} />);
        expect(html).toContain('Signature not verified'); // amber caution
        expect(html).not.toContain(VERIFIED_CHIP_TH);      // never the green "verified" claim
        expect(html).toContain('bg-amber-50');
    });

    it('no integrity (status-valid, FE ahead of BE) → renders nothing (no positive claim, no false caution)', () => {
        const view = deriveVerifyView({ verified: true, data: { status: 'active' } });
        const html = renderToStaticMarkup(<CryptoVerdict view={view} />);
        expect(html).toBe(''); // hasIntegrity false → CryptoVerdict returns null
    });

    it('not-found → renders nothing positive (no verified chip)', () => {
        const view = deriveVerifyView({ verified: false, data: { status: 'invalid' } });
        const html = renderToStaticMarkup(<CryptoVerdict view={view} />);
        expect(html).not.toContain(VERIFIED_CHIP_TH);
        expect(html).not.toContain(TAMPERED_TH);
    });
});
