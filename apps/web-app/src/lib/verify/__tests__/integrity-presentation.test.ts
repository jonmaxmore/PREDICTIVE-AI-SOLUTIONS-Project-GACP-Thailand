/**
 * integrity-presentation.test.ts — single source of truth for translating the
 * backend cert-verify crypto verdict (`integrity` + `signatureValid`) into a
 * presentation triple (tone / heroOk / labels).
 *
 * Batch 1 (crypto-trust) FE. The cert-verify endpoint
 * (GET /api/v1/public/verify/:n) returns `data.integrity` ('VALID' | 'TAMPERED'
 * | 'UNSIGNED') and `data.signatureValid` (true | false | null-when-unsigned).
 * These tests pin the exact mapping so the verify page can never assert a
 * "crypto verified" hero without genuine evidence:
 *
 *   - VALID + signatureValid:true  → success / heroOk:true
 *   - VALID + signatureValid:false → warning / heroOk:false  (NOT danger — the
 *                                    verify key may not match the signing key
 *                                    after a rotation; red-flagging here would
 *                                    invalidate every legit cert. Amber caution.)
 *   - VALID + signatureValid:null  → warning / heroOk:false  (unsigned/unverified)
 *   - TAMPERED (any signature)     → danger / heroOk:false  (hash recompute —
 *                                    key-INDEPENDENT, the only reliable red)
 *   - UNSIGNED                     → warning / heroOk:false
 *   - undefined/null integrity     → warning / heroOk:false  (SAFE default)
 */

import { mapIntegrity } from '../integrity-presentation';

describe('mapIntegrity (cert crypto verdict → presentation)', () => {
    it('VALID + signatureValid:true → success, heroOk:true, verified labels', () => {
        const r = mapIntegrity('VALID', true);
        expect(r.tone).toBe('success');
        expect(r.heroOk).toBe(true);
        expect(r.labelTH).toBe('ตรวจสอบลายเซ็นดิจิทัลแล้ว');
        expect(r.labelEN).toBe('Digitally verified');
    });

    it('VALID + signatureValid:null (hash matched, NO verified signature) → warning, heroOk:false (DOWNGRADE-SAFE)', () => {
        // The documentHash is an UNKEYED sha256 over public fields — a DB-write
        // attacker can recompute it after tampering and strip the signature
        // (→ signatureValid:null). The green "Digitally verified" claim MUST
        // require signatureValid===true, so this case is amber, never green.
        const r = mapIntegrity('VALID', null);
        expect(r.tone).toBe('warning');
        expect(r.heroOk).toBe(false);
        expect(r.labelEN).toBe('Signature not verified');
    });

    it('TAMPERED → danger, heroOk:false, tampered labels', () => {
        const r = mapIntegrity('TAMPERED', null);
        expect(r.tone).toBe('danger');
        expect(r.heroOk).toBe(false);
        expect(r.labelTH).toBe('เอกสารถูกแก้ไข ไม่ตรงกับต้นฉบับ');
        expect(r.labelEN).toBe('TAMPERED — does not match the issued record');
    });

    it('VALID + signatureValid:false → warning, NOT danger (key rotation must not red-flag legit certs)', () => {
        // A verifying key that does not match the signing key (rotation /
        // re-provision — proven to occur on staging) makes signatureValid:false
        // for a perfectly valid cert. Red-flagging here would render every
        // legit government cert "TAMPERED". Only the hash recompute (integrity)
        // may drive red. This is amber "signature not verified".
        const r = mapIntegrity('VALID', false);
        expect(r.tone).toBe('warning');
        expect(r.heroOk).toBe(false);
        expect(r.labelEN).toBe('Signature not verified');
        expect(r.labelTH).not.toBe('เอกสารถูกแก้ไข ไม่ตรงกับต้นฉบับ');
    });

    it('signatureValid:false with UNSIGNED integrity → warning (no red on signature alone)', () => {
        const r = mapIntegrity('UNSIGNED', false);
        expect(r.tone).toBe('warning');
        expect(r.heroOk).toBe(false);
    });

    it('UNSIGNED → warning, heroOk:false, legacy labels', () => {
        const r = mapIntegrity('UNSIGNED', null);
        expect(r.tone).toBe('warning');
        expect(r.heroOk).toBe(false);
        expect(r.labelTH).toBe('ใบรับรองรุ่นเก่า ไม่มีลายเซ็นดิจิทัล');
        expect(r.labelEN).toBe('Legacy certificate — unsigned');
    });

    it('undefined integrity → warning, heroOk:false (NOT a positive verified claim)', () => {
        const r = mapIntegrity(undefined, undefined);
        expect(r.tone).toBe('warning');
        expect(r.heroOk).toBe(false);
        expect(r.labelTH).toBe('ไม่สามารถยืนยันลายเซ็นดิจิทัล');
        expect(r.labelEN).toBe('Signature not verified');
    });

    it('null integrity → warning, heroOk:false (same safe default)', () => {
        const r = mapIntegrity(null, null);
        expect(r.tone).toBe('warning');
        expect(r.heroOk).toBe(false);
    });

    it('unknown/garbage integrity string → safe warning default, never success', () => {
        const r = mapIntegrity('SOMETHING_NEW', true);
        expect(r.tone).toBe('warning');
        expect(r.heroOk).toBe(false);
    });
});
