/**
 * BE-#4 — certificate content-integrity hash.
 *
 * The issuer stamps a SHA-256 documentHash over the certificate's canonical
 * DATA (not the PDF bytes; the PDF is regenerated on-demand from this data).
 * The public verifier can recompute and compare to detect post-issuance
 * tampering. Hash-level integrity — no RSA key required.
 *
 * These exercise the pure helper + verifyDocumentIntegrity without touching the
 * DB or Puppeteer.
 */

const certificateService = require('../../services/certificate-service');
const { buildCertificateDocumentHash, verifyDocumentIntegrity } = certificateService;

const BASE = Object.freeze({
    certificateNumber: 'GACP-TH-2569-A3F7B2',
    verificationCode: 'A1B2C3D4',
    applicationId: 'app-1',
    userId: 'user-1',
    farmId: 'farm-1',
    farmName: 'ฟาร์มสมุนไพรสมชาย',
    applicantName: 'สมชาย ใจดี',
    cropType: 'กัญชา / Cannabis sativa L.',
    farmSize: 5.5,
    province: 'เชียงราย',
    district: 'เมือง',
    subDistrict: 'รอบเวียง',
    standardName: 'GACP Thailand',
    standardId: 'GACP-TH',
    validityYears: 3,
    issuedDate: new Date('2026-05-16T03:00:00Z'),
    expiryDate: new Date('2029-05-16T03:00:00Z'),
    issuedBy: 'provider-1',
});

describe('BE-#4 buildCertificateDocumentHash', () => {
    it('produces a versioned keyed HMAC (hmac-sha256:<hex>), deterministic across calls', () => {
        const a = buildCertificateDocumentHash(BASE);
        const b = buildCertificateDocumentHash(BASE);
        expect(a).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
        expect(a).toBe(b);
    });

    it('changes when ANY legally-binding field is altered (tamper detection)', () => {
        const base = buildCertificateDocumentHash(BASE);
        for (const field of [
            'certificateNumber', 'applicantName', 'farmName', 'farmId',
            'province', 'expiryDate', 'issuedBy',
        ]) {
            const mutated = { ...BASE };
            mutated[field] = field === 'expiryDate'
                ? new Date('2030-01-01T00:00:00Z')
                : `${BASE[field]}-FORGED`;
            expect(buildCertificateDocumentHash(mutated)).not.toBe(base);
        }
    });

    it('normalises dates — a Date and its ISO string hash identically', () => {
        const asDates = buildCertificateDocumentHash(BASE);
        const asIso = buildCertificateDocumentHash({
            ...BASE,
            issuedDate: BASE.issuedDate.toISOString(),
            expiryDate: BASE.expiryDate.toISOString(),
        });
        expect(asIso).toBe(asDates);
    });

    it('ignores non-canonical fields (downloadCount, status, etc.)', () => {
        const base = buildCertificateDocumentHash(BASE);
        const withNoise = buildCertificateDocumentHash({
            ...BASE, downloadCount: 42, status: 'active', verificationCount: 7,
        });
        expect(withNoise).toBe(base);
    });
});

describe('BE-#4 verifyDocumentIntegrity', () => {
    it('VALID when the stored hash matches the live fields', () => {
        const documentHash = buildCertificateDocumentHash(BASE);
        expect(verifyDocumentIntegrity({ ...BASE, documentHash }))
            .toEqual({ status: 'VALID', documentHash });
    });

    it('TAMPERED when a field changed after the hash was stored', () => {
        const documentHash = buildCertificateDocumentHash(BASE);
        const res = verifyDocumentIntegrity({ ...BASE, farmName: 'Different Farm', documentHash });
        expect(res.status).toBe('TAMPERED');
        expect(res.expected).toBe(documentHash);
        expect(res.actual).not.toBe(documentHash);
    });

    it('UNSIGNED for a legacy cert with no documentHash, or a null cert', () => {
        expect(verifyDocumentIntegrity({ ...BASE }).status).toBe('UNSIGNED');
        expect(verifyDocumentIntegrity(null).status).toBe('UNSIGNED');
    });
});

// ── #619: documentHash must be KEYED — naive recompute-forgery is blocked ─────
describe('#619 documentHash is a keyed HMAC (recompute-forgery blocked)', () => {
    const nodeCrypto = require('crypto');

    // The digest an attacker with DB access but NO server key can compute — this
    // is EXACTLY what buildCertificateDocumentHash returned before #619.
    function attackerUnkeyedHash(c) {
        const toIso = (d) => (d ? new Date(d).toISOString() : null);
        const canonical = {
            certificateNumber: c.certificateNumber, verificationCode: c.verificationCode,
            applicationId: c.applicationId, userId: c.userId, farmId: c.farmId,
            farmName: c.farmName, applicantName: c.applicantName, cropType: c.cropType,
            farmSize: c.farmSize, province: c.province, district: c.district,
            subDistrict: c.subDistrict, standardName: c.standardName, standardId: c.standardId,
            validityYears: c.validityYears, issuedDate: toIso(c.issuedDate),
            expiryDate: toIso(c.expiryDate), issuedBy: c.issuedBy,
        };
        return nodeCrypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    }

    it('the stored hash is NOT the unkeyed SHA-256 an attacker can recompute (was #619)', () => {
        const stored = buildCertificateDocumentHash(BASE);
        // Pre-#619 these were byte-identical → a DB editor could forge a VALID cert.
        expect(stored).not.toBe(attackerUnkeyedHash(BASE));
        expect(stored.startsWith('hmac-sha256:')).toBe(true);
    });

    it('a post-cutover cert whose keyed hash no longer matches → TAMPERED', () => {
        // attacker edits a legally-binding field; the stored keyed hash cannot be
        // recomputed to match without the server key.
        const cert = { ...BASE, documentHash: buildCertificateDocumentHash(BASE), farmSize: 9999 };
        expect(verifyDocumentIntegrity(cert).status).toBe('TAMPERED');
    });

    it('a bare-hex (unkeyed) documentHash is UNSIGNED, never VALID (closes the #619 downgrade)', () => {
        // An unkeyed SHA-256 gives ZERO integrity under the #619 threat model, so
        // it must NOT read VALID — even when its content currently matches. The RSA
        // signature is the real control; the hash chip stays off until backfilled.
        const legacy = { ...BASE, documentHash: attackerUnkeyedHash(BASE) };
        expect(verifyDocumentIntegrity(legacy).status).toBe('UNSIGNED');
    });

    it('downgrade forgery is blocked: tampered fields + a matching bare-hex hash → UNSIGNED (not VALID)', () => {
        // The exact #619 downgrade: an actor with DB write tampers a legally-binding
        // field AND stores the UNKEYED sha256 of the tampered content (no prefix).
        // Pre-fix the legacy path recomputed-and-matched → VALID (forged). Now the
        // non-keyed hash is refused outright → UNSIGNED.
        const forged = { ...BASE, farmName: 'FORGED FARM' };
        forged.documentHash = attackerUnkeyedHash(forged);
        expect(verifyDocumentIntegrity(forged).status).toBe('UNSIGNED');
    });
});
