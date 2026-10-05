/**
 * B2 (PDPA-LEAK cluster) part 1 — Certificate.revokedReason encrypt at rest.
 *
 * `revokedReason` is operator free text written plaintext at revoke
 * (certificate-service.js) and was NOT in any encrypt set → a Postgres dump
 * grep of \d{13} recovers a national ID a reviewer typed into the reason.
 *
 * Fix: add `revokedReason` to CERTIFICATE_PII_COLUMNS (whole-column, same as the
 * existing cert scalar encrypts). Encryption happens at the extension boundary on
 * write, so NO cert-service edit is needed. `revokedReason` is never
 * WHERE/orderBy/grouped (grep-verified 2026-07-06: the revocation feed filters on
 * revokedAt/status, computeTrustStatus reads it only as a truthiness flag), so
 * whole-column encrypt is query-safe.
 *
 * Part 2 (public projection masking) is in interoperability-revoked-reason-mask.test.js.
 */

const path = require('path');

jest.mock('../../utils/field-encryption', () => ({
    encrypt: jest.fn((plain) => `ENC[${plain}]`),
    decrypt: jest.fn((cipher) => {
        const match = String(cipher).match(/^ENC\[(.*)\]$/s);
        if (!match) { throw new Error('mock-decrypt-failure'); }
        return match[1];
    }),
    hashData: jest.fn((v) => (v ? `HASH[${v}]` : null)),
}));

const {
    CERTIFICATE_PII_COLUMNS,
    VERSION_PREFIX,
    encryptCertificateDataPayload,
    decryptCertificateRow,
    createPdpaEncryptedClient,
} = require(path.join(__dirname, '..', '..', 'services', 'prisma-pdpa-extension.js'));

describe('[B2] Certificate.revokedReason whole-column encrypt at rest', () => {
    it('revokedReason is in the certificate encrypt column set', () => {
        expect(CERTIFICATE_PII_COLUMNS).toContain('revokedReason');
        // Still contains the pre-existing scalar encrypts (no regression).
        expect(CERTIFICATE_PII_COLUMNS).toEqual(
            expect.arrayContaining(['address', 'issuedBy', 'signedBy']),
        );
        // applicantName stays DEFERRED (contains-searched in interoperability.js).
        expect(CERTIFICATE_PII_COLUMNS).not.toContain('applicantName');
    });

    it('encryptCertificateDataPayload wraps a revokedReason that carries a national ID', () => {
        const reason = 'พบสวมสิทธิ์ เลขบัตร 1100000000008 ไม่ตรงกับผู้ยื่น';
        const out = encryptCertificateDataPayload({
            id: 'cert-1',
            certificateNumber: 'CERT-2026-001',
            status: 'REVOKED',
            revokedReason: reason,
        });
        expect(out.revokedReason).toBe(`${VERSION_PREFIX}ENC[${reason}]`);
        // Non-PII display fields untouched.
        expect(out.certificateNumber).toBe('CERT-2026-001');
        expect(out.status).toBe('REVOKED');
    });

    it('decryptCertificateRow round-trips a revokedReason', () => {
        const original = { id: 'c-1', revokedReason: 'REGULATORY_DECISION 1100000000008' };
        expect(decryptCertificateRow(encryptCertificateDataPayload(original))).toEqual(original);
    });

    it('certificate.update hook encrypts revokedReason at rest, decrypts on read', async () => {
        const prev = process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        let config;
        createPdpaEncryptedClient({ $extends: (c) => { config = c; return {}; } });
        if (typeof prev === 'string') { process.env.ENABLE_PDPA_FIELD_ENCRYPTION = prev; }
        else { delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION; }

        const cap = {};
        const echoQuery = async (args) => {
            cap.persisted = JSON.parse(JSON.stringify(args.data));
            return JSON.parse(JSON.stringify(args.data));
        };
        const reason = 'ยกเลิก: เลขบัตร 1100000000008';
        const updated = await config.query.certificate.update({
            args: { data: { status: 'REVOKED', revokedReason: reason }, where: { id: 'cert-1' } },
            query: echoQuery,
        });
        // AT REST: whole-column ciphertext.
        expect(cap.persisted.revokedReason).toBe(`${VERSION_PREFIX}ENC[${reason}]`);
        // ON READ: decrypted by the hook's result-tree walker.
        expect(updated.revokedReason).toBe(reason);
    });

    it('REAL cipher — an ID in revokedReason is UNRECOVERABLE from a dump and round-trips', () => {
        const real = jest.requireActual('../../utils/field-encryption');
        const reason = 'พบสวมสิทธิ์ เลขบัตร 1100000000008';
        const atRest = `${VERSION_PREFIX}${real.encrypt(reason)}`;
        // The SPECIFIC national ID must not be recoverable from the at-rest blob.
        // (A naive \d{13} regex is flaky: random AES-GCM hex can coincidentally
        // contain a 13-decimal-digit run — but never the actual ID string.)
        expect(atRest).not.toContain('1100000000008');
        expect(real.decrypt(atRest.slice(VERSION_PREFIX.length))).toBe(reason);
    });
});
