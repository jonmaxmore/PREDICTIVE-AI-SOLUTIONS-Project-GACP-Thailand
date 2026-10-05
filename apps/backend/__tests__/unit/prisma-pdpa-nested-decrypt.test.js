/**
 * STAGE B1 — Tests for the generic nested-relation PDPA decrypt walker.
 *
 * Context (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md, STAGE B):
 *   The per-model decrypt hooks (query.user.* / query.certificate.*) only
 *   decrypt the TOP-LEVEL row. A User loaded via a NESTED include from another
 *   model (application.findMany include applicant, invoice→applicant,
 *   entityMembership→user, certificate→user, ...) was NOT decrypted, so once
 *   B3 encrypts healthId/providerId those nested PII fields would come back as
 *   raw `enc:v1:...` ciphertext to ~25+ finance/reviewer/export read paths.
 *
 *   B1 adds a generic `$allModels.$allOperations` RESULT walker that, when
 *   ENABLE_PDPA_FIELD_ENCRYPTION==='true', recursively decrypts ANY string
 *   leaf carrying the self-identifying `enc:v1:` prefix — relation-name
 *   agnostic, covering all current + future nested includes with no
 *   enumeration. It must be INERT when the flag is off, idempotent, and never
 *   double-decrypt with the existing top-level hooks.
 *
 * These tests drive the design (TDD) and pin the contract:
 *   (a) flag OFF → walker never runs, result identical
 *   (b) flag ON + top-level user.findFirst enc:v1: healthId → decrypted
 *   (c) flag ON + application.findMany include applicant nested enc:v1: → decrypted
 *   (d) deeply nested (application→invoice→applicant) + arrays of users decrypted
 *   (e) non-encrypted strings + numbers/Decimals/Dates untouched
 *   (f) idempotent / no double-decrypt
 *   (g) cycle / shared ref doesn't infinite-loop
 */

const path = require('path');

// Deterministic mock cipher (mirrors the existing extension test) so we can
// assert exact decrypted output. `decrypt` throws on a non-matching block so
// we can prove the walker only ever calls it on real enc:v1: leaves.
jest.mock('../../utils/field-encryption', () => ({
    encrypt: jest.fn((plain) => `ENC[${plain}]`),
    decrypt: jest.fn((cipher) => {
        const match = String(cipher).match(/^ENC\[(.*)\]$/);
        if (!match) {throw new Error('mock-decrypt-failure');}
        return match[1];
    }),
    hashData: jest.fn((v) => (v ? `HASH[${v}]` : null)),
}));

const fieldEncryption = require('../../utils/field-encryption');

const modPath = path.join(
    __dirname, '..', '..', 'services', 'prisma-pdpa-extension.js',
);

const {
    VERSION_PREFIX,
    decryptResultTree,
    createPdpaEncryptedClient,
} = require(modPath);

// Helper: an encrypted leaf the way it appears in a DB row.
const enc = (plain) => `${VERSION_PREFIX}ENC[${plain}]`;

beforeEach(() => {
    fieldEncryption.decrypt.mockClear();
});

describe('[STAGE B1] decryptResultTree — generic nested decrypt walker', () => {
    it('(b) decrypts a flat top-level row (existing behavior preserved)', () => {
        const row = {
            id: 'user-1',
            healthId: enc('1100100100011'),
            firstName: enc('สมชาย'),
            email: 'farmer@example.test', // plaintext, untouched
        };
        const out = decryptResultTree(row);
        expect(out.healthId).toBe('1100100100011');
        expect(out.firstName).toBe('สมชาย');
        expect(out.email).toBe('farmer@example.test');
    });

    it('(c) decrypts PII inside a nested include (application → applicant)', () => {
        const result = {
            id: 'app-1',
            status: 'SUBMITTED',
            applicant: {
                id: 'user-1',
                healthId: enc('1100100100011'),
                firstName: enc('สมชาย'),
                lastName: enc('ทดสอบ'),
                phoneNumber: enc('0812345678'),
            },
        };
        const out = decryptResultTree(result);
        expect(out.applicant.healthId).toBe('1100100100011');
        expect(out.applicant.firstName).toBe('สมชาย');
        expect(out.applicant.lastName).toBe('ทดสอบ');
        expect(out.applicant.phoneNumber).toBe('0812345678');
        // Non-PII parent fields untouched.
        expect(out.status).toBe('SUBMITTED');
    });

    it('(c2) decrypts an Entity nested relation (relation-name-agnostic, RFC scope addition)', () => {
        const result = {
            id: 'app-1',
            entity: {
                id: 'ent-1',
                thaiCitizenId: enc('1100100100011'),
                name: 'Farm Co',
            },
        };
        const out = decryptResultTree(result);
        expect(out.entity.thaiCitizenId).toBe('1100100100011');
        expect(out.entity.name).toBe('Farm Co');
    });

    it('(d) decrypts deeply nested relations + arrays of users', () => {
        const result = [
            {
                id: 'app-1',
                invoice: {
                    id: 'inv-1',
                    healthId: enc('1100100100011'),
                    applicant: {
                        id: 'user-1',
                        healthId: enc('1100100100011'),
                        firstName: enc('สมชาย'),
                    },
                },
                reviewers: [
                    { id: 'u-2', providerId: enc('DTAM-001'), lastName: enc('ก') },
                    { id: 'u-3', providerId: enc('DTAM-002'), lastName: enc('ข') },
                ],
            },
            {
                id: 'app-2',
                applicant: { id: 'user-9', healthId: enc('9999999999999') },
            },
        ];
        const out = decryptResultTree(result);
        expect(out[0].invoice.healthId).toBe('1100100100011');
        expect(out[0].invoice.applicant.firstName).toBe('สมชาย');
        expect(out[0].reviewers[0].providerId).toBe('DTAM-001');
        expect(out[0].reviewers[1].lastName).toBe('ข');
        expect(out[1].applicant.healthId).toBe('9999999999999');
    });

    it('(e) leaves non-encrypted strings, numbers, booleans, Decimals, Dates, null untouched', () => {
        // A stand-in for a Prisma Decimal: a class instance that is NOT a plain
        // object. The walker must NOT descend into it.
        class FakeDecimal {
            constructor(v) { this.s = v; }
            toString() { return this.s; }
        }
        const decimalLeaf = new FakeDecimal('27675.00');
        const dateLeaf = new Date('2026-06-29T00:00:00.000Z');
        const result = {
            id: 'inv-1',
            amount: decimalLeaf,
            createdAt: dateLeaf,
            count: 42,
            paid: true,
            note: 'a plain string, no prefix',
            empty: '',
            nothing: null,
            missing: undefined,
            bankRef: 'enc:v0:not-our-prefix', // wrong version, must pass through
        };
        const out = decryptResultTree(result);
        expect(out.amount).toBe(decimalLeaf); // same ref, not descended/copied
        expect(out.createdAt).toBe(dateLeaf);
        expect(out.count).toBe(42);
        expect(out.paid).toBe(true);
        expect(out.note).toBe('a plain string, no prefix');
        expect(out.empty).toBe('');
        expect(out.nothing).toBeNull();
        expect(out.bankRef).toBe('enc:v0:not-our-prefix');
        // decrypt() must NEVER have been called — no enc:v1: leaf present.
        expect(fieldEncryption.decrypt).not.toHaveBeenCalled();
    });

    it('(f) is idempotent — running on already-decrypted plaintext is a no-op (no double-decrypt)', () => {
        const row = { id: 'u-1', healthId: enc('1100100100011') };
        const once = decryptResultTree(row);
        expect(once.healthId).toBe('1100100100011');
        const callsAfterFirst = fieldEncryption.decrypt.mock.calls.length;
        // Walk the already-plaintext result again.
        const twice = decryptResultTree(once);
        expect(twice.healthId).toBe('1100100100011');
        // No further decrypt calls — plaintext has no enc:v1: prefix.
        expect(fieldEncryption.decrypt.mock.calls.length).toBe(callsAfterFirst);
    });

    it('(g) a cycle / shared reference does not infinite-loop', () => {
        const a = { id: 'a', healthId: enc('1100100100011') };
        const b = { id: 'b', firstName: enc('สมชาย') };
        a.partner = b;
        b.partner = a; // cycle
        a.self = a; // direct self-ref
        let out;
        expect(() => { out = decryptResultTree(a); }).not.toThrow();
        expect(out.healthId).toBe('1100100100011');
        expect(out.partner.firstName).toBe('สมชาย');
    });

    it('(g2) a shared (non-cyclic) reference seen twice is still decrypted', () => {
        const shared = { id: 'u-1', healthId: enc('1100100100011') };
        const result = { left: shared, right: shared };
        const out = decryptResultTree(result);
        // Same object referenced twice — decrypted once (seen-set), still correct.
        expect(out.left.healthId).toBe('1100100100011');
        expect(out.right.healthId).toBe('1100100100011');
    });

    it('respects a max-depth guard without throwing on pathological nesting', () => {
        // Build a chain deeper than the guard; the deepest leaf may stay
        // encrypted but the walker must not throw or hang.
        let node = { healthId: enc('deep') };
        const root = node;
        for (let i = 0; i < 500; i++) {
            node.child = { healthId: enc(`lvl-${i}`) };
            node = node.child;
        }
        expect(() => decryptResultTree(root)).not.toThrow();
        // Shallow levels are decrypted.
        expect(root.healthId).toBe('deep');
    });
});

describe('[STAGE B1] flag gating + extension wiring', () => {
    const ORIGINAL = process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
    afterEach(() => {
        if (typeof ORIGINAL === 'string') {
            process.env.ENABLE_PDPA_FIELD_ENCRYPTION = ORIGINAL;
        } else {
            delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        }
    });

    it('(a) flag OFF → createPdpaEncryptedClient returns the client UNCHANGED (walker never wired)', () => {
        delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        const client = { user: { findUnique: jest.fn() } };
        expect(createPdpaEncryptedClient(client)).toBe(client);
    });

    it('(a2) flag ON → $extends config carries a $allModels.$allOperations result walker', () => {
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        const extended = { extended: true };
        const client = { $extends: jest.fn(() => extended) };
        const result = createPdpaEncryptedClient(client);
        expect(client.$extends).toHaveBeenCalledTimes(1);
        const cfg = client.$extends.mock.calls[0][0];
        expect(cfg.query.$allModels).toBeDefined();
        expect(typeof cfg.query.$allModels.$allOperations).toBe('function');
        expect(result).toBe(extended);
    });

    it('(a3) the wired $allOperations handler decrypts the result of query()', async () => {
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        const extended = { extended: true };
        const client = { $extends: jest.fn(() => extended) };
        createPdpaEncryptedClient(client);
        const cfg = client.$extends.mock.calls[0][0];
        const handler = cfg.query.$allModels.$allOperations;
        const dbResult = {
            id: 'app-1',
            applicant: { id: 'u-1', healthId: enc('1100100100011') },
        };
        const query = jest.fn(async () => dbResult);
        const out = await handler({
            model: 'Application',
            operation: 'findMany',
            args: {},
            query,
        });
        expect(query).toHaveBeenCalledWith({});
        expect(out.applicant.healthId).toBe('1100100100011');
    });

    it('(b) flag ON → user.create encrypts national-ID columns by-column in args.data', async () => {
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        const extended = { extended: true };
        const client = { $extends: jest.fn(() => extended) };
        createPdpaEncryptedClient(client);
        const cfg = client.$extends.mock.calls[0][0];

        const args = {
            data: {
                id: 'u-1',
                email: 'farmer@example.test',
                healthId: '1100100100011',
                providerId: 'DTAM-001',
                idCard: 'idcard-ref',
                province: 'Bangkok', // DEFERRED — must remain plaintext
                firstName: 'สมชาย', // DEFERRED — must remain plaintext
            },
        };
        // query() echoes the (already-encrypted) data back so we can also see
        // the result-tree decrypt round-trips.
        const query = jest.fn(async (a) => ({ ...a.data }));
        const out = await cfg.query.user.create({ args, query });

        // The payload Prisma actually receives has the national IDs encrypted...
        const sent = query.mock.calls[0][0].data;
        expect(sent.healthId).toBe(enc('1100100100011'));
        expect(sent.providerId).toBe(enc('DTAM-001'));
        expect(sent.idCard).toBe(enc('idcard-ref'));
        // ...but DEFERRED + non-PII columns are sent in the clear.
        expect(sent.province).toBe('Bangkok');
        expect(sent.firstName).toBe('สมชาย');
        expect(sent.email).toBe('farmer@example.test');
        // ...and the RESULT the caller gets back is decrypted again (B1 walker).
        expect(out.healthId).toBe('1100100100011');
        expect(out.providerId).toBe('DTAM-001');
    });

    it('(b2) flag ON → entity.create encrypts thaiCitizenId by-column, not the hash columns', async () => {
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        const extended = { extended: true };
        const client = { $extends: jest.fn(() => extended) };
        createPdpaEncryptedClient(client);
        const cfg = client.$extends.mock.calls[0][0];
        expect(cfg.query.entity).toBeDefined();

        const args = {
            data: {
                id: 'ent-1',
                type: 'INDIVIDUAL',
                displayName: 'Somchai',
                thaiCitizenId: '1100100100011',
                thaiCitizenIdHash: 'raw-sha256-stays',
                thaiCitizenIdHmac: 'keyed-hmac-stays',
            },
        };
        const query = jest.fn(async (a) => ({ ...a.data }));
        const out = await cfg.query.entity.create({ args, query });

        const sent = query.mock.calls[0][0].data;
        expect(sent.thaiCitizenId).toBe(enc('1100100100011'));
        // The lookup hash columns are NOT encrypted (they must stay queryable).
        expect(sent.thaiCitizenIdHash).toBe('raw-sha256-stays');
        expect(sent.thaiCitizenIdHmac).toBe('keyed-hmac-stays');
        expect(sent.displayName).toBe('Somchai');
        // Result decrypted on the way back out.
        expect(out.thaiCitizenId).toBe('1100100100011');
    });

    it('(c-nested) flag ON → entity.findMany result with a nested entity include round-trips decrypted', async () => {
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        const extended = { extended: true };
        const client = { $extends: jest.fn(() => extended) };
        createPdpaEncryptedClient(client);
        const cfg = client.$extends.mock.calls[0][0];
        // Application.findMany include entity → covered by the $allModels walker.
        const handler = cfg.query.$allModels.$allOperations;
        const dbResult = [
            { id: 'app-1', entity: { id: 'ent-1', thaiCitizenId: enc('1100100100011') } },
        ];
        const query = jest.fn(async () => dbResult);
        const out = await handler({ model: 'Application', operation: 'findMany', args: {}, query });
        expect(out[0].entity.thaiCitizenId).toBe('1100100100011');
    });
});
