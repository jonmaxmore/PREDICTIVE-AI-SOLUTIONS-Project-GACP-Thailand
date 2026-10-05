/**
 * STAGE-formData — extension-level tests for the Application.formData national-ID
 * leaf encrypt-on-write hook + the B1 auto-decrypt-on-read proof.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md.
 *
 * Pins:
 *   (c) WRITE: application.create/update/upsert encrypt the formData national-ID
 *       leaves when ENABLE_PDPA_FIELD_ENCRYPTION==='true'; byte-for-byte
 *       plaintext when the flag is OFF.
 *   (b) READ: a real `createPdpaEncryptedClient` application.findUnique whose
 *       stored formData carries enc:v1: leaves comes back DECRYPTED via the B1
 *       decryptResultTree walker — proving encrypt-on-write ⇒ free decrypt-on-read
 *       with NO application-specific read code.
 */

jest.mock('../../utils/field-encryption', () => ({
    encrypt: jest.fn((plain) => `ENC[${plain}]`),
    decrypt: jest.fn((cipher) => {
        const match = String(cipher).match(/^ENC\[(.*)\]$/);
        if (!match) { return null; }
        return match[1];
    }),
    hashData: jest.fn((v) => (v ? `HASH[${v}]` : null)),
}));

const {
    VERSION_PREFIX,
    createPdpaEncryptedClient,
    encryptApplicationDataPayload,
    encryptInvoiceDataPayload,
    APPLICATION_JSON_PII_COLUMNS,
    INVOICE_JSON_PII_COLUMNS,
} = require('../../services/prisma-pdpa-extension');

const enc = (plain) => `${VERSION_PREFIX}ENC[${plain}]`;

const ORIGINAL_FLAG = process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
afterAll(() => {
    if (ORIGINAL_FLAG === undefined) { delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION; }
    else { process.env.ENABLE_PDPA_FIELD_ENCRYPTION = ORIGINAL_FLAG; }
});

/**
 * Minimal fake Prisma client supporting $extends (real Prisma extension API is
 * exercised by the existing prisma-pdpa-extension tests; here we use a thin
 * stand-in compatible with how the extension registers query hooks).
 *
 * We instead use the REAL extension's query hook bodies by constructing the
 * extended client via createPdpaEncryptedClient on a base whose methods are
 * spies. Because the @prisma/client `$extends` is needed, and not available in
 * unit env, we test the two halves directly:
 *   - WRITE: encryptApplicationDataPayload (the exact function the hook calls on
 *     args.data / args.create / args.update).
 *   - READ: drive createPdpaEncryptedClient against a hand-rolled base client
 *     that implements $extends by wiring the registered hooks (see below).
 */

// A tiny $extends shim: createPdpaEncryptedClient calls
// prismaClient.$extends({ name, query }). We capture the query map and expose a
// driver that runs `query[model][op]({ args, query })` exactly like Prisma's
// dispatcher (most-specific model hook, else $allModels.$allOperations).
//
// IMPORTANT — Prisma's hook contract: the extension hook receives
// `({ args, query })` and invokes the NEXT layer with `query(args)` — i.e.
// `query` is a POSITIONAL function taking the (possibly mutated) args object,
// NOT `query({ args })`. The shim's `next` therefore takes positional `args`.
function makeExtendableBase(rawHandlers) {
    return {
        $extends({ query }) {
            const runModelOp = async (model, op, args) => {
                const perModel = query[model] && query[model][op];
                const catchAll = query.$allModels && query.$allModels.$allOperations;
                // next(args): the bottom of the chain — call the raw DB handler.
                const next = (a) => rawHandlers[model][op](a);
                if (perModel) {
                    return perModel({ args, query: next });
                }
                if (catchAll) {
                    return catchAll({ args, model, operation: op, query: next });
                }
                return next(args);
            };
            const buildModel = (model) => new Proxy({}, {
                get: (_t, op) => (args) => runModelOp(model, String(op), args),
            });
            return {
                application: buildModel('application'),
                applicationDraft: buildModel('applicationDraft'),
                invoice: buildModel('invoice'),
                user: buildModel('user'),
            };
        },
    };
}

describe('[STAGE-formData] encrypt-on-write (encryptApplicationDataPayload)', () => {
    it('(c) encrypts formData national-ID leaves on a create payload', () => {
        const data = {
            healthId: '1100100100011', // a scalar column — NOT in formData, untouched here
            status: 'DRAFT',
            formData: {
                steps: { 1: { tax_id: '1234567890123' }, 4: { id_card: '1100100100011' } },
                applicantData: { idCard: '5500500500055', firstName: 'สมชาย' },
            },
        };
        const out = encryptApplicationDataPayload(data);
        expect(out.formData.steps['1'].tax_id).toBe(enc('1234567890123'));
        expect(out.formData.steps['4'].id_card).toBe(enc('1100100100011'));
        expect(out.formData.applicantData.idCard).toBe(enc('5500500500055'));
        expect(out.formData.applicantData.firstName).toBe('สมชาย');
        // top-level non-formData columns untouched by THIS helper
        expect(out.healthId).toBe('1100100100011');
        expect(out.status).toBe('DRAFT');
    });

    it('(c) is a no-op when the payload has no formData key', () => {
        const data = { status: 'DOC_APPROVED', updatedBy: 'u-1' };
        expect(encryptApplicationDataPayload(data)).toEqual(data);
    });

    it('(c) handles a { set: <obj> } JSON write helper shape', () => {
        const data = { formData: { set: { applicantData: { idCard: '1100100100011' } } } };
        const out = encryptApplicationDataPayload(data);
        expect(out.formData.set.applicantData.idCard).toBe(enc('1100100100011'));
    });
});

describe('[GAP 1] encryptApplicationDataPayload — workflowHistory + previewData', () => {
    it('exports the application JSON column list', () => {
        expect(APPLICATION_JSON_PII_COLUMNS).toEqual(['formData', 'workflowHistory', 'previewData']);
    });

    it('encrypts a national-ID actorId in workflowHistory AND still encrypts formData', () => {
        const data = {
            status: 'DOC_APPROVED',
            formData: { applicantData: { idCard: '1100000000008' } },
            // workflowHistory is a SEPARATE top-level Json column (GAP 1). The
            // value-net catches the 13-digit Mod-11 actor national ID under
            // `actorId` even though that key is NOT in the formData allowlist.
            workflowHistory: [
                { event: 'DOC_APPROVED', actorId: '1100000000008', actorRole: 'AUDITOR', timestamp: 1719600000000 },
            ],
        };
        const out = encryptApplicationDataPayload(data);
        // GAP 1 fix — workflowHistory leaf encrypted.
        expect(out.workflowHistory[0].actorId).toBe(enc('1100000000008'));
        expect(out.workflowHistory[0].event).toBe('DOC_APPROVED'); // non-ID untouched
        expect(out.workflowHistory[0].actorRole).toBe('AUDITOR'); // non-ID untouched
        expect(out.workflowHistory[0].timestamp).toBe(1719600000000); // numeric ts untouched
        // formData still encrypted (regression guard for the original behaviour).
        expect(out.formData.applicantData.idCard).toBe(enc('1100000000008'));
        expect(out.status).toBe('DOC_APPROVED');
    });

    it('encrypts a previewData snapshot national ID', () => {
        const data = { previewData: { applicantData: { taxId: '0105561234560' } } };
        const out = encryptApplicationDataPayload(data);
        expect(out.previewData.applicantData.taxId).toBe(enc('0105561234560'));
    });

    it('returns the SAME reference when no covered column is present', () => {
        const data = { status: 'CERTIFIED', updatedBy: 'u-1' };
        expect(encryptApplicationDataPayload(data)).toBe(data);
    });
});

describe('[GAP 2] encryptInvoiceDataPayload — Invoice.metadata WHT tax ID', () => {
    it('exports the invoice JSON column list', () => {
        expect(INVOICE_JSON_PII_COLUMNS).toEqual(['metadata']);
    });

    it('encrypts the 13-digit issuedByTaxId under metadata.whtCertificate (value-net, any key)', () => {
        const data = {
            status: 'paid',
            metadata: {
                whtCertificate: {
                    certificateNumber: 'WHT-2026-001',
                    issuedByTaxId: '0105561234560', // WHT counterparty 13-digit TIN
                    whtAmount: 75,
                    source: 'BUYER_ISSUED',
                },
            },
        };
        const out = encryptInvoiceDataPayload(data);
        expect(out.metadata.whtCertificate.issuedByTaxId).toBe(enc('0105561234560'));
        // non-ID metadata untouched.
        expect(out.metadata.whtCertificate.certificateNumber).toBe('WHT-2026-001');
        expect(out.metadata.whtCertificate.whtAmount).toBe(75);
        expect(out.metadata.whtCertificate.source).toBe('BUYER_ISSUED');
        expect(out.status).toBe('paid');
    });

    it('is a no-op when there is no metadata key (returns same reference)', () => {
        const data = { status: 'pending', subtotal: 500 };
        expect(encryptInvoiceDataPayload(data)).toBe(data);
    });
});

describe('[STAGE-formData] flag OFF — byte-for-byte unchanged', () => {
    it('(c) returns the input client unchanged; no encrypt/decrypt', () => {
        delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        const base = { marker: 'BASE' };
        const client = createPdpaEncryptedClient(base);
        expect(client).toBe(base); // same reference — extension is inert
    });
});

describe('[STAGE-formData] flag ON — write encrypts, read auto-decrypts (B1 proof)', () => {
    beforeEach(() => { process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true'; });

    it('(c)+(b) create stores encrypted leaves; findUnique returns them decrypted', async () => {
        // The "DB" — what the base client actually persists / returns.
        const store = {};
        const rawHandlers = {
            application: {
                create: (args) => {
                    // args.data is what the encrypt hook produced — persist it.
                    // Deep-clone on BOTH store and return to simulate the DB
                    // round-trip (real Prisma serializes to Postgres, so the
                    // persisted row and the returned row do NOT share object
                    // identity — without this the in-place decryptResultTree
                    // walk on the result would also mutate the "stored" copy).
                    store[args.data.id] = JSON.parse(JSON.stringify(args.data));
                    return Promise.resolve(JSON.parse(JSON.stringify(args.data)));
                },
                findUnique: (args) => Promise.resolve(store[args.where.id] ? JSON.parse(JSON.stringify(store[args.where.id])) : null),
            },
            user: {},
        };
        const base = makeExtendableBase(rawHandlers);
        const client = createPdpaEncryptedClient(base);

        const createInput = {
            id: 'app-1',
            formData: {
                steps: { 4: { id_card: '1100100100011' } },
                applicantData: { taxId: '0105500000017', firstName: 'สมชาย' },
            },
        };
        const created = await client.application.create({ data: createInput });

        // PROOF 1 (write): the persisted row holds CIPHERTEXT leaves.
        expect(store['app-1'].formData.steps['4'].id_card).toBe(enc('1100100100011'));
        expect(store['app-1'].formData.applicantData.taxId).toBe(enc('0105500000017'));
        expect(store['app-1'].formData.applicantData.firstName).toBe('สมชาย'); // non-PII plaintext

        // The create RESULT is also walked → returned decrypted to the caller.
        expect(created.formData.steps['4'].id_card).toBe('1100100100011');
        expect(created.formData.applicantData.taxId).toBe('0105500000017');

        // PROOF 2 (read): findUnique auto-decrypts the stored ciphertext via B1.
        const read = await client.application.findUnique({ where: { id: 'app-1' } });
        expect(read.formData.steps['4'].id_card).toBe('1100100100011');
        expect(read.formData.applicantData.taxId).toBe('0105500000017');
        expect(read.formData.applicantData.firstName).toBe('สมชาย');
    });

    it('(c)+(b) applicationDraft.create encrypts formData leaves; findUnique decrypts (transient wizard draft)', async () => {
        const store = {};
        const rawHandlers = {
            applicationDraft: {
                create: (args) => { store[args.data.id] = JSON.parse(JSON.stringify(args.data)); return Promise.resolve(JSON.parse(JSON.stringify(args.data))); },
                findUnique: (args) => Promise.resolve(store[args.where.id] ? JSON.parse(JSON.stringify(store[args.where.id])) : null),
            },
            user: {},
        };
        const client = createPdpaEncryptedClient(makeExtendableBase(rawHandlers));
        await client.applicationDraft.create({ data: { id: 'draft-1', formData: { applicantData: { id_card: '1100100100011', firstName: 'สมชาย' } } } });
        // write: the persisted draft holds CIPHERTEXT in the national-ID leaf, plaintext name.
        expect(store['draft-1'].formData.applicantData.id_card).toBe(enc('1100100100011'));
        expect(store['draft-1'].formData.applicantData.firstName).toBe('สมชาย');
        // read: auto-decrypts via the $allModels walker.
        const read = await client.applicationDraft.findUnique({ where: { id: 'draft-1' } });
        expect(read.formData.applicantData.id_card).toBe('1100100100011');
    });

    it('(b) findUnique on a row stored directly with enc:v1: leaves decrypts them (no write code)', async () => {
        const store = {
            'app-2': {
                id: 'app-2',
                formData: { applicantData: { presidentIdCard: enc('2200200200022'), directorIdCard: enc('3300300300033') } },
            },
        };
        const rawHandlers = {
            // Clone on return to simulate the DB round-trip (the in-place
            // decrypt walk must not mutate the test's `store`).
            application: { findUnique: (args) => Promise.resolve(JSON.parse(JSON.stringify(store[args.where.id]))) },
            user: {},
        };
        const client = createPdpaEncryptedClient(makeExtendableBase(rawHandlers));
        const read = await client.application.findUnique({ where: { id: 'app-2' } });
        expect(read.formData.applicantData.presidentIdCard).toBe('2200200200022');
        expect(read.formData.applicantData.directorIdCard).toBe('3300300300033');
    });

    it('(GAP 1) update encrypts workflowHistory actorId; findFirst returns it decrypted (B1)', async () => {
        const store = {};
        const rawHandlers = {
            application: {
                update: (args) => {
                    store[args.where.id] = JSON.parse(JSON.stringify(args.data));
                    return Promise.resolve(JSON.parse(JSON.stringify(args.data)));
                },
                findFirst: (args) => Promise.resolve(store[args.where.id] ? JSON.parse(JSON.stringify(store[args.where.id])) : null),
            },
            user: {},
        };
        const client = createPdpaEncryptedClient(makeExtendableBase(rawHandlers));

        // NOTE: no `status` field in this update (lint rule
        // gacp/no-direct-application-status-write forbids a direct status write
        // on prisma.application.update) — we only need to exercise the
        // workflowHistory JSON-leaf encrypt here.
        await client.application.update({
            where: { id: 'app-wh' },
            data: {
                workflowHistory: [{ event: 'DOC_APPROVED', actorId: '1100000000008', timestamp: 1719600000000 }],
            },
        });

        // WRITE: stored workflowHistory holds CIPHERTEXT in the actor national ID.
        expect(store['app-wh'].workflowHistory[0].actorId).toBe(enc('1100000000008'));
        expect(store['app-wh'].workflowHistory[0].event).toBe('DOC_APPROVED');

        // READ (B1): findFirst auto-decrypts the workflowHistory leaf.
        const read = await client.application.findFirst({ where: { id: 'app-wh' } });
        expect(read.workflowHistory[0].actorId).toBe('1100000000008');
        expect(read.workflowHistory[0].event).toBe('DOC_APPROVED');
    });

    it('(GAP 2) invoice.update encrypts metadata.whtCertificate.issuedByTaxId; findMany decrypts (B1)', async () => {
        const store = {};
        const rawHandlers = {
            invoice: {
                update: (args) => {
                    store[args.where.id] = JSON.parse(JSON.stringify(args.data));
                    return Promise.resolve(JSON.parse(JSON.stringify(args.data)));
                },
                findMany: () => Promise.resolve(Object.values(store).map((r) => JSON.parse(JSON.stringify(r)))),
            },
            user: {},
        };
        const client = createPdpaEncryptedClient(makeExtendableBase(rawHandlers));

        await client.invoice.update({
            where: { id: 'inv-1' },
            data: {
                metadata: { whtCertificate: { certificateNumber: 'WHT-1', issuedByTaxId: '0105561234560' } },
            },
        });

        // WRITE: stored metadata holds CIPHERTEXT in the WHT tax ID.
        expect(store['inv-1'].metadata.whtCertificate.issuedByTaxId).toBe(enc('0105561234560'));
        expect(store['inv-1'].metadata.whtCertificate.certificateNumber).toBe('WHT-1');

        // READ (B1): findMany auto-decrypts (covers the listWhtCertificates path).
        const [read] = await client.invoice.findMany({ where: { status: 'paid' } });
        expect(read.metadata.whtCertificate.issuedByTaxId).toBe('0105561234560');
        expect(read.metadata.whtCertificate.certificateNumber).toBe('WHT-1');
    });
});
