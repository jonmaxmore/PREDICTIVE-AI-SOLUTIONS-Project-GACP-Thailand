/**
 * B1 (PDPA-LEAK cluster, carpet-bomb-inversion-audit-2026-07-06) —
 * Invoice.notes is a plaintext, unmasked national-ID sink.
 *
 * Operators type an applicant's 13-digit ID into a hold/forfeit/release reason
 * or receipt note (services/invoice/invoice-finance-ops.js holdInvoice/
 * releaseHold/forfeitRevenue + services/invoice-service.js issueReceipt), which
 * is appended VERBATIM to the plain-scalar `Invoice.notes` column → a DB dump
 * grep of \d{13} recovers it. The Mod-11 JSON value-net cannot see it because
 * the ID lands MID-STRING in free text (like ApplicationComment.content).
 *
 * FIX: WHOLE-COLUMN encrypt `Invoice.notes` at rest via the existing invoice
 * encrypt hook (mirrors ApplicationComment.content). `notes` is never
 * searched / sorted / grouped (grep-verified: the only `notes:{contains}` is on
 * prisma.QUOTE, not Invoice), so encrypting the whole string is query-safe.
 *
 * Uses the same deterministic field-encryption mock as
 * prisma-pdpa-extension.test.js so ciphertext is stable to assert against.
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
    INVOICE_PII_COLUMNS,
    INVOICE_JSON_PII_COLUMNS,
    VERSION_PREFIX,
    encryptInvoiceDataPayload,
    createPdpaEncryptedClient,
} = require(path.join(__dirname, '..', '..', 'services', 'prisma-pdpa-extension.js'));

describe('[B1] Invoice.notes whole-column encrypt (national-ID free-text sink)', () => {
    it('INVOICE_PII_COLUMNS = [notes] (the operator free-text scalar sink)', () => {
        expect(INVOICE_PII_COLUMNS).toEqual(['notes']);
        // The JSON metadata column list is a SEPARATE concern (WHT tax ID leaf).
        expect(INVOICE_JSON_PII_COLUMNS).toEqual(['metadata']);
    });

    it('encrypts the WHOLE notes string at rest — a mid-string 13-digit ID becomes ciphertext', () => {
        const data = {
            status: 'HELD',
            notes: 'ก่อนหน้า\n[HOLD 2026-07-06T00:00:00.000Z] เลขบัตร 1100000000008 ไม่ตรงกับใบสมัคร',
        };
        const out = encryptInvoiceDataPayload(data);
        // WHOLE-COLUMN ciphertext — the mid-sentence ID is inside the wrapped blob.
        // (The deterministic ENC[...] mock passes plaintext through, so the raw
        // 13-digit run is still visible HERE; the real AES-GCM cipher produces hex
        // with no recoverable run. The whole-column wrap is what makes it safe.)
        expect(out.notes).toBe(
            `${VERSION_PREFIX}ENC[ก่อนหน้า\n[HOLD 2026-07-06T00:00:00.000Z] เลขบัตร 1100000000008 ไม่ตรงกับใบสมัคร]`,
        );
        // Non-covered fields pass through.
        expect(out.status).toBe('HELD');
    });

    it('still walks metadata (WHT tax ID) alongside the notes scalar', () => {
        const data = {
            notes: 'receipt note',
            metadata: { whtCertificate: { issuedByTaxId: '0105561234560' } },
        };
        const out = encryptInvoiceDataPayload(data);
        expect(out.notes).toBe(`${VERSION_PREFIX}ENC[receipt note]`);
        expect(out.metadata.whtCertificate.issuedByTaxId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
    });

    it('leaves a null / absent notes untouched and returns the SAME reference when nothing is covered', () => {
        expect(encryptInvoiceDataPayload({ id: 'inv-1', notes: null }).notes).toBeNull();
        const bare = { status: 'pending', subtotal: 500 };
        expect(encryptInvoiceDataPayload(bare)).toBe(bare); // same ref — flag-OFF parity
    });

    it('is idempotent — an already-encrypted notes value is not double-wrapped', () => {
        const already = `${VERSION_PREFIX}ENC[already]`;
        expect(encryptInvoiceDataPayload({ notes: already }).notes).toBe(already);
    });
});

describe('[B1] invoice hook — encrypt notes at rest, decrypt on read (round-trip)', () => {
    function buildExtended() {
        const prev = process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        let config;
        const fakeClient = { $extends: (c) => { config = c; return { __extended: true }; } };
        createPdpaEncryptedClient(fakeClient);
        if (typeof prev === 'string') { process.env.ENABLE_PDPA_FIELD_ENCRYPTION = prev; }
        else { delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION; }
        return config;
    }
    const echoQuery = (capture) => async (args) => {
        capture.persisted = JSON.parse(JSON.stringify(args.data));
        return JSON.parse(JSON.stringify(args.data));
    };

    it('invoice.update encrypts notes at rest, returns decrypted on read', async () => {
        const config = buildExtended();
        const cap = {};
        const reason = 'ยกเลิกเพราะเลขบัตร 1100000000008 ปลอม';
        const updated = await config.query.invoice.update({
            args: { data: { status: 'FORFEITED', notes: reason }, where: { id: 'inv-1' } },
            query: echoQuery(cap),
        });
        // AT REST: whole-column ciphertext.
        expect(cap.persisted.notes).toBe(`${VERSION_PREFIX}ENC[${reason}]`);
        // ON READ: the hook decrypts the returned tree.
        expect(updated.notes).toBe(reason);
        expect(updated.status).toBe('FORFEITED');
    });

    it('invoice.updateMany (receipt-issue path) encrypts notes at rest', async () => {
        const config = buildExtended();
        const cap = {};
        await config.query.invoice.updateMany({
            args: { data: { notes: 'x 1100000000008 y' }, where: { id: 'inv-1', receiptNumber: null } },
            query: echoQuery(cap),
        });
        expect(cap.persisted.notes).toBe(`${VERSION_PREFIX}ENC[x 1100000000008 y]`);
    });

    it('invoice.findMany decrypts notes on read (legacy plaintext rows pass through)', async () => {
        const config = buildExtended();
        const rows = await config.query.invoice.findMany({
            args: { where: { applicationId: 'app-1' } },
            query: async () => ([
                { id: 'i1', notes: `${VERSION_PREFIX}ENC[held: 1100000000008]` },
                { id: 'i2', notes: 'legacy plaintext note' },
            ]),
        });
        expect(rows[0].notes).toBe('held: 1100000000008');
        expect(rows[1].notes).toBe('legacy plaintext note');
    });
});

describe('[B1] REAL AES-256-GCM cipher — a 13-digit ID in notes is UNRECOVERABLE from a dump', () => {
    // The deterministic ENC[...] mock passes plaintext through, so it cannot
    // prove the actual "unrecoverable from a Postgres dump" property. Pull the
    // REAL field-encryption cipher via requireActual and drive encryptValue's
    // real path (NODE_ENV=test → catalog ENCRYPTION_KEY fallback), closing the
    // mock-vs-reality gap this repo has been bitten by before.
    it('the enc:v1: at-rest value has no recoverable \\d{13} run and round-trips', () => {
        const real = jest.requireActual('../../utils/field-encryption');
        const notes = 'ก่อนหน้า\n[HOLD] เลขบัตร 1100000000008 ไม่ตรงกับใบสมัคร';
        const atRest = `${VERSION_PREFIX}${real.encrypt(notes)}`;
        // The SPECIFIC national ID must not be recoverable from the at-rest blob.
        // (A naive \d{13} regex is flaky: random AES-GCM hex can coincidentally
        // contain a 13-decimal-digit run — but never the actual ID string.)
        expect(atRest.startsWith(VERSION_PREFIX)).toBe(true);
        expect(atRest).not.toContain('1100000000008');
        // Round-trips back to the exact free text.
        expect(real.decrypt(atRest.slice(VERSION_PREFIX.length))).toBe(notes);
    });
});
