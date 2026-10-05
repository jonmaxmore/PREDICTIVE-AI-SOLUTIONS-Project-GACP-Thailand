/**
 * SHOULD-B2b (audit batch-2, carried from Batch-1 verify) —
 * Certificate.deleteReason encrypt at rest.
 *
 * The A2 audit-pass-reversal void (certificate-service.js
 * revokeCertificateForApplication) writes the operator comment into BOTH
 * `revokedReason` AND `deleteReason` ("Audit pass reversed: <comment>").
 * `revokedReason` is already in CERTIFICATE_PII_COLUMNS (encrypted at rest), but
 * `deleteReason` was NOT → a Postgres dump grep of \d{13} recovers a national ID
 * an operator typed into the reversal comment.
 *
 * Fix: add `deleteReason` to CERTIFICATE_PII_COLUMNS (whole-column, same as
 * `revokedReason`). Encryption happens at the extension write hook, so NO
 * cert-service edit is needed. Grep-verified 2026-07-06: `Certificate.deleteReason`
 * is never used in a WHERE / orderBy / groupBy / distinct (the only writer is
 * cert-service:1022 `data.deleteReason`), so whole-column encrypt is query-safe.
 * Legacy rows pass through the B1 read walker unchanged.
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

describe('[B2b] Certificate.deleteReason whole-column encrypt at rest', () => {
    it('deleteReason is in the certificate encrypt column set', () => {
        expect(CERTIFICATE_PII_COLUMNS).toContain('deleteReason');
        // No regression: the pre-existing scalar encrypts remain.
        expect(CERTIFICATE_PII_COLUMNS).toEqual(
            expect.arrayContaining(['address', 'issuedBy', 'signedBy', 'revokedReason']),
        );
    });

    it('encryptCertificateDataPayload wraps a deleteReason that carries a national ID', () => {
        const reason = 'Audit pass reversed: เลขบัตร 1100000000008 ไม่ตรง';
        const out = encryptCertificateDataPayload({
            id: 'cert-1',
            certificateNumber: 'CERT-2026-001',
            isDeleted: true,
            deleteReason: reason,
        });
        expect(out.deleteReason).toBe(`${VERSION_PREFIX}ENC[${reason}]`);
        // Non-PII display fields untouched.
        expect(out.certificateNumber).toBe('CERT-2026-001');
        expect(out.isDeleted).toBe(true);
    });

    it('decryptCertificateRow round-trips a deleteReason', () => {
        const original = { id: 'c-1', deleteReason: 'Audit pass reversed: 1100000000008' };
        expect(decryptCertificateRow(encryptCertificateDataPayload(original))).toEqual(original);
    });

    it('certificate.update hook encrypts deleteReason at rest, decrypts on read', async () => {
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
        const reason = 'Audit pass reversed: 1100000000008';
        const updated = await config.query.certificate.update({
            args: {
                data: { isDeleted: true, deleteReason: reason, revokedReason: reason },
                where: { id: 'cert-1' },
            },
            query: echoQuery,
        });
        // AT REST: whole-column ciphertext (both deleteReason and revokedReason).
        expect(cap.persisted.deleteReason).toBe(`${VERSION_PREFIX}ENC[${reason}]`);
        expect(cap.persisted.revokedReason).toBe(`${VERSION_PREFIX}ENC[${reason}]`);
        // ON READ: decrypted by the hook's result-tree walker.
        expect(updated.deleteReason).toBe(reason);
    });

    it('REAL cipher — an ID in deleteReason is enc:v1: at rest and UNRECOVERABLE from a dump', () => {
        const real = jest.requireActual('../../utils/field-encryption');
        const reason = 'Audit pass reversed: เลขบัตร 1100000000008';
        const atRest = `${VERSION_PREFIX}${real.encrypt(reason)}`;
        expect(atRest.startsWith(VERSION_PREFIX)).toBe(true);
        expect(atRest).not.toContain('1100000000008');
        expect(real.decrypt(atRest.slice(VERSION_PREFIX.length))).toBe(reason);
    });
});
