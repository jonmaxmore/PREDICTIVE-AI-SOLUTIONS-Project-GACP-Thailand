/**
 * STAGE-formData — tests for the Application.formData national-ID leaf encrypt
 * backfill (scripts/pdpa/backfill-encrypt-formdata-pii.js).
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md.
 *
 * Covers:
 *   - runFormDataBackfill: encrypts the formData PII leaves in place, pages by
 *     id, skips rows with no plaintext leaf, idempotent (re-run = 0 updates),
 *     dry-run does not write, selects id + formData ONLY.
 *   - countRemainingPlaintext: counts apps still holding a plaintext national-ID
 *     leaf (the "0 plaintext remaining" assertion).
 */

// Deterministic mock cipher so encryptFormDataPii / hasPlaintextPii (the REAL
// helpers, injected into the script) produce assertable output.
jest.mock('../../utils/field-encryption', () => ({
    encrypt: jest.fn((plain) => `ENC[${plain}]`),
    decrypt: jest.fn((cipher) => {
        const match = String(cipher).match(/^ENC\[(.*)\]$/);
        if (!match) { return null; }
        return match[1];
    }),
}));

const path = require('path');
const {
    VERSION_PREFIX,
    encryptFormDataPii,
    hasPlaintextPii,
} = require('../../utils/formdata-pii');

const {
    APPLICATION_JSON_PII_COLUMNS,
    INVOICE_JSON_PII_COLUMNS,
    CERTIFICATE_SCALAR_PII_COLUMNS,
    ENTITY_SCALAR_PII_COLUMNS,
    ENTITY_JSON_PII_COLUMNS,
    PURCHASE_INVOICE_SCALAR_PII_COLUMNS,
    ORGANIZATION_SCALAR_PII_COLUMNS,
    runModelBackfill,
    runFormDataBackfill,
    countRemainingPlaintext,
    runScalarColumnBackfill,
    countRemainingScalarPlaintext,
} = require(path.join(__dirname, '..', '..', 'scripts', 'pdpa', 'backfill-encrypt-formdata-pii'));

// ROUND-2 — the script's `encryptValue` (whole-value scalar encrypt) comes from
// utils/formdata-pii.js (idempotent enc:v1: wrapper over the mocked cipher).
const { encryptValue: encryptScalarValue } = require('../../utils/formdata-pii');

const enc = (plain) => `${VERSION_PREFIX}ENC[${plain}]`;

const baseArgs = () => ({
    versionPrefix: VERSION_PREFIX,
    encryptFormDataPiiFn: encryptFormDataPii,
    hasPlaintextPiiFn: hasPlaintextPii,
    batchSize: 100,
    maxRows: Infinity,
    dryRun: false,
    verbose: false,
    logger: { log: jest.fn() },
});

describe('[STAGE-formData] runFormDataBackfill', () => {
    it('encrypts formData PII leaves in place, pages by id, skips clean rows', async () => {
        const rows = [
            { id: 'a1', formData: { steps: { 4: { id_card: '1100100100011' } } } },
            { id: 'a2', formData: { applicantData: { taxId: '0105500000017', firstName: 'A' } } },
            { id: 'a3', formData: { applicantData: { firstName: 'B' } } }, // no PII → skipped
            { id: 'a4', formData: { applicantData: { idCard: enc('5500500500055') } } }, // already enc → skipped
        ];
        const updates = [];
        const client = {
            application: {
                findMany: jest.fn()
                    .mockResolvedValueOnce(rows)
                    .mockResolvedValueOnce([]),
                update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return {}; }),
            },
        };

        const stats = await runFormDataBackfill({ ...baseArgs(), client });

        expect(stats.rowsScanned).toBe(4);
        expect(stats.rowsRequiringBackfill).toBe(2); // a1 + a2
        expect(stats.rowsUpdated).toBe(2);
        expect(stats.rowsSkipped).toBe(2); // a3 (no PII) + a4 (already enc)

        // selects id + ALL covered application JSON columns (gap-close: formData
        // + workflowHistory + previewData), never a plaintext leaf.
        const firstFind = client.application.findMany.mock.calls[0][0];
        expect(firstFind.select).toEqual({
            id: true, formData: true, workflowHistory: true, previewData: true,
        });
        expect(firstFind.where).toEqual({ isDeleted: false });

        // a1: id_card encrypted; a2: taxId encrypted, firstName untouched
        const a1 = updates.find((u) => u.id === 'a1');
        const a2 = updates.find((u) => u.id === 'a2');
        expect(a1.data.formData.steps['4'].id_card).toBe(enc('1100100100011'));
        expect(a2.data.formData.applicantData.taxId).toBe(enc('0105500000017'));
        expect(a2.data.formData.applicantData.firstName).toBe('A');
    });

    it('dry-run does NOT write but still counts rows that would be backfilled', async () => {
        const rows = [{ id: 'a1', formData: { applicantData: { idCard: '1100100100011' } } }];
        const client = {
            application: {
                findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]),
                update: jest.fn(),
            },
        };
        const stats = await runFormDataBackfill({ ...baseArgs(), client, dryRun: true });
        expect(stats.rowsRequiringBackfill).toBe(1);
        expect(stats.rowsUpdated).toBe(0);
        expect(client.application.update).not.toHaveBeenCalled();
    });

    it('is idempotent — a second pass over already-encrypted rows updates nothing', async () => {
        const encryptedRow = { id: 'a1', formData: encryptFormDataPii({ applicantData: { idCard: '1100100100011' } }) };
        const client = {
            application: {
                findMany: jest.fn().mockResolvedValueOnce([encryptedRow]).mockResolvedValueOnce([]),
                update: jest.fn(),
            },
        };
        const stats = await runFormDataBackfill({ ...baseArgs(), client });
        expect(stats.rowsRequiringBackfill).toBe(0);
        expect(stats.rowsUpdated).toBe(0);
        expect(client.application.update).not.toHaveBeenCalled();
    });

    it('respects maxRows', async () => {
        const rows = [
            { id: 'a1', formData: { applicantData: { idCard: '1' } } },
            { id: 'a2', formData: { applicantData: { idCard: '2' } } },
        ];
        const client = {
            application: {
                findMany: jest.fn(async ({ take }) => rows.slice(0, take)),
                update: jest.fn(async () => ({})),
            },
        };
        const stats = await runFormDataBackfill({ ...baseArgs(), client, maxRows: 1 });
        expect(stats.rowsScanned).toBe(1);
    });
});

describe('[STAGE-formData] countRemainingPlaintext', () => {
    it('returns 0 after a full backfill, >0 when a plaintext leaf remains', async () => {
        const remainingRows = [
            { id: 'a1', formData: encryptFormDataPii({ applicantData: { idCard: '1100100100011' } }) }, // clean
            { id: 'a2', formData: { steps: { 1: { tax_id: '1234567890123' } } } }, // still plaintext
        ];
        const client = {
            application: {
                findMany: jest.fn().mockResolvedValueOnce(remainingRows).mockResolvedValueOnce([]),
            },
        };
        const remaining = await countRemainingPlaintext({
            client,
            versionPrefix: VERSION_PREFIX,
            hasPlaintextPiiFn: hasPlaintextPii,
        });
        expect(remaining).toBe(1); // only a2
    });

    it('returns 0 when every app is encrypted', async () => {
        const rows = [
            { id: 'a1', formData: encryptFormDataPii({ applicantData: { idCard: '1100100100011' } }) },
            { id: 'a2', formData: { applicantData: { firstName: 'no-pii' } } },
        ];
        const client = {
            application: {
                findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]),
            },
        };
        const remaining = await countRemainingPlaintext({
            client,
            versionPrefix: VERSION_PREFIX,
            hasPlaintextPiiFn: hasPlaintextPii,
        });
        expect(remaining).toBe(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// GAP 1 — workflowHistory (+ previewData) backfill coverage on applications.
// ───────────────────────────────────────────────────────────────────────────
describe('[GAP 1] application backfill encrypts workflowHistory + previewData leaves', () => {
    const baseModelArgs = () => ({
        versionPrefix: VERSION_PREFIX,
        encryptFormDataPiiFn: encryptFormDataPii,
        hasPlaintextPiiFn: hasPlaintextPii,
        batchSize: 100,
        maxRows: Infinity,
        dryRun: false,
        verbose: false,
        logger: { log: jest.fn() },
    });

    it('exports the covered column lists', () => {
        expect(APPLICATION_JSON_PII_COLUMNS).toEqual(['formData', 'workflowHistory', 'previewData']);
        expect(INVOICE_JSON_PII_COLUMNS).toEqual(['metadata']);
    });

    it('encrypts a national ID in workflowHistory (actorId) AND in formData; minimal UPDATE data', async () => {
        const rows = [
            {
                id: 'a1',
                // GAP-1 carrier — a 13-digit Mod-11-valid actor national ID in
                // workflowHistory (value-net catches it; key `actorId` is not in
                // the formData allowlist).
                formData: { applicantData: { idCard: '1100000000008' } },
                workflowHistory: [
                    { event: 'DOC_APPROVED', actorId: '1100000000008', timestamp: 1719600000000 },
                ],
                previewData: null,
            },
            // workflowHistory-ONLY carrier: no formData PII, but a staff
            // providerId national ID stamped in history under `by`.
            {
                id: 'a2',
                formData: { applicantData: { firstName: 'no-pii' } },
                workflowHistory: [{ event: 'REVISION_REQUESTED', by: '0105561234560' }],
                previewData: null,
            },
            // previewData carrier (render snapshot of formData).
            {
                id: 'a3',
                formData: null,
                workflowHistory: null,
                previewData: { applicantData: { idCard: '1100000000008' } },
            },
        ];
        const updates = [];
        const client = {
            application: {
                findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]),
                update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return {}; }),
            },
        };

        const stats = await runFormDataBackfill({ ...baseModelArgs(), client });

        expect(stats.rowsRequiringBackfill).toBe(3);
        expect(stats.rowsUpdated).toBe(3);

        const a1 = updates.find((u) => u.id === 'a1');
        expect(a1.data.formData.applicantData.idCard).toBe(enc('1100000000008'));
        expect(a1.data.workflowHistory[0].actorId).toBe(enc('1100000000008'));
        expect(a1.data.workflowHistory[0].event).toBe('DOC_APPROVED'); // non-ID untouched
        expect(a1.data.workflowHistory[0].timestamp).toBe(1719600000000); // numeric ts untouched
        // previewData was null on a1 → NOT in the minimal UPDATE data.
        expect('previewData' in a1.data).toBe(false);

        const a2 = updates.find((u) => u.id === 'a2');
        expect(a2.data.workflowHistory[0].by).toBe(enc('0105561234560'));
        // formData had no PII → not part of the UPDATE.
        expect('formData' in a2.data).toBe(false);

        const a3 = updates.find((u) => u.id === 'a3');
        expect(a3.data.previewData.applicantData.idCard).toBe(enc('1100000000008'));
    });

    it('countRemainingPlaintext sees a plaintext workflowHistory leaf', async () => {
        const rows = [
            { id: 'a1', formData: null, workflowHistory: [{ actorId: '1100000000008' }], previewData: null },
        ];
        const client = {
            application: {
                findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]),
            },
        };
        const remaining = await countRemainingPlaintext({
            client,
            versionPrefix: VERSION_PREFIX,
            hasPlaintextPiiFn: hasPlaintextPii,
        });
        expect(remaining).toBe(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// GAP 2 — Invoice.metadata backfill coverage (WHT counterparty tax ID).
// ───────────────────────────────────────────────────────────────────────────
describe('[GAP 2] invoice backfill encrypts metadata.whtCertificate.issuedByTaxId', () => {
    const baseModelArgs = () => ({
        versionPrefix: VERSION_PREFIX,
        encryptFormDataPiiFn: encryptFormDataPii,
        hasPlaintextPiiFn: hasPlaintextPii,
        batchSize: 100,
        maxRows: Infinity,
        dryRun: false,
        verbose: false,
        logger: { log: jest.fn() },
    });

    it('encrypts the 13-digit tax ID under metadata.whtCertificate via runModelBackfill', async () => {
        const rows = [
            {
                id: 'inv-1',
                metadata: {
                    whtCertificate: {
                        certificateNumber: 'WHT-2026-001',
                        issuedByTaxId: '0105561234560', // Mod-11-valid 13-digit
                        whtAmount: 75,
                    },
                },
            },
            { id: 'inv-2', metadata: { hold: { reason: 'review' } } }, // no national ID → skipped
        ];
        const updates = [];
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]),
            update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return {}; }),
        };

        const stats = await runModelBackfill({
            ...baseModelArgs(),
            delegate,
            columns: INVOICE_JSON_PII_COLUMNS,
            label: 'invoices',
        });

        // select is id + metadata only.
        expect(delegate.findMany.mock.calls[0][0].select).toEqual({ id: true, metadata: true });

        expect(stats.rowsRequiringBackfill).toBe(1);
        expect(stats.rowsUpdated).toBe(1);
        const inv1 = updates.find((u) => u.id === 'inv-1');
        expect(inv1.data.metadata.whtCertificate.issuedByTaxId).toBe(enc('0105561234560'));
        // non-ID metadata untouched.
        expect(inv1.data.metadata.whtCertificate.certificateNumber).toBe('WHT-2026-001');
        expect(inv1.data.metadata.whtCertificate.whtAmount).toBe(75);
    });

    it('countRemainingPlaintext over invoice.metadata returns 1 for a plaintext tax ID, 0 once encrypted', async () => {
        const plaintextRows = [{ id: 'inv-1', metadata: { whtCertificate: { issuedByTaxId: '0105561234560' } } }];
        const encryptedRows = [{
            id: 'inv-1',
            metadata: encryptFormDataPii({ whtCertificate: { issuedByTaxId: '0105561234560' } }),
        }];

        const remainingPlaintext = await countRemainingPlaintext({
            delegate: { findMany: jest.fn().mockResolvedValueOnce(plaintextRows).mockResolvedValueOnce([]) },
            columns: INVOICE_JSON_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            hasPlaintextPiiFn: hasPlaintextPii,
        });
        expect(remainingPlaintext).toBe(1);

        const remainingEncrypted = await countRemainingPlaintext({
            delegate: { findMany: jest.fn().mockResolvedValueOnce(encryptedRows).mockResolvedValueOnce([]) },
            columns: INVOICE_JSON_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            hasPlaintextPiiFn: hasPlaintextPii,
        });
        expect(remainingEncrypted).toBe(0);
    });

    it('is idempotent on already-encrypted invoice metadata', async () => {
        const encryptedRow = {
            id: 'inv-1',
            metadata: encryptFormDataPii({ whtCertificate: { issuedByTaxId: '0105561234560' } }),
        };
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([encryptedRow]).mockResolvedValueOnce([]),
            update: jest.fn(),
        };
        const stats = await runModelBackfill({
            ...baseModelArgs(),
            delegate,
            columns: INVOICE_JSON_PII_COLUMNS,
            label: 'invoices',
        });
        expect(stats.rowsRequiringBackfill).toBe(0);
        expect(delegate.update).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// ROUND-2 (close-natid-round2) — by-column SCALAR backfill for Certificate /
// Entity / PurchaseInvoice + Entity payload JSON-leaf + cross-model 0-assert.
// ───────────────────────────────────────────────────────────────────────────
describe('[ROUND-2] runScalarColumnBackfill (Certificate / Entity / PurchaseInvoice)', () => {
    const scalarArgs = () => ({
        versionPrefix: VERSION_PREFIX,
        encryptValueFn: encryptScalarValue,
        batchSize: 100,
        maxRows: Infinity,
        dryRun: false,
        verbose: false,
        logger: { log: jest.fn() },
    });

    it('exports the ROUND-2 column lists', () => {
        // SHOULD-#4: the certificate scalar list now ALSO covers revokedReason +
        // deleteReason (whole-column encrypted-forward by the extension) so the
        // backfill encrypts legacy rows AND the all-clear assertion counts them.
        expect(CERTIFICATE_SCALAR_PII_COLUMNS).toEqual(['issuedBy', 'signedBy', 'revokedReason', 'deleteReason']);
        expect(ENTITY_SCALAR_PII_COLUMNS).toEqual(['thaiCitizenId', 'juristicId']);
        expect(ENTITY_JSON_PII_COLUMNS).toEqual(['payload']);
        expect(PURCHASE_INVOICE_SCALAR_PII_COLUMNS).toEqual(['supplierTaxId']);
    });

    it('certificate: encrypts issuedBy/signedBy in place, skips clean + already-encrypted, selects id+cols only', async () => {
        const rows = [
            { id: 'c1', issuedBy: '1100000000008', signedBy: '1100000000008' },
            { id: 'c2', issuedBy: enc('1100000000008'), signedBy: enc('1100000000008') }, // already enc → skip
            { id: 'c3', issuedBy: null, signedBy: null }, // no plaintext → skip
        ];
        const updates = [];
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]),
            update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return {}; }),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(), delegate, columns: CERTIFICATE_SCALAR_PII_COLUMNS, label: 'certificates',
        });
        // SHOULD-#4: the cert scalar list now also covers revokedReason + deleteReason.
        expect(delegate.findMany.mock.calls[0][0].select).toEqual({
            id: true, issuedBy: true, signedBy: true, revokedReason: true, deleteReason: true,
        });
        expect(delegate.findMany.mock.calls[0][0].where).toEqual({ isDeleted: false });
        expect(stats.rowsRequiringBackfill).toBe(1);
        expect(stats.rowsUpdated).toBe(1);
        expect(stats.rowsSkipped).toBe(2);
        const c1 = updates.find((u) => u.id === 'c1');
        expect(c1.data.issuedBy).toBe(enc('1100000000008'));
        expect(c1.data.signedBy).toBe(enc('1100000000008'));
    });

    it('certificate: dry-run counts but does not write', async () => {
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([{ id: 'c1', issuedBy: '1100000000008', signedBy: null }]).mockResolvedValueOnce([]),
            update: jest.fn(),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(), delegate, columns: CERTIFICATE_SCALAR_PII_COLUMNS, label: 'certificates', dryRun: true,
        });
        expect(stats.rowsRequiringBackfill).toBe(1);
        expect(stats.rowsUpdated).toBe(0);
        expect(delegate.update).not.toHaveBeenCalled();
    });

    it('certificate: idempotent — second pass over encrypted rows writes nothing', async () => {
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([{ id: 'c1', issuedBy: enc('1100000000008'), signedBy: enc('1100000000008') }]).mockResolvedValueOnce([]),
            update: jest.fn(),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(), delegate, columns: CERTIFICATE_SCALAR_PII_COLUMNS, label: 'certificates',
        });
        expect(stats.rowsRequiringBackfill).toBe(0);
        expect(delegate.update).not.toHaveBeenCalled();
    });

    it('entity: encrypts thaiCitizenId + juristicId (scalar); payload covered by runModelBackfill (JSON-leaf)', async () => {
        // scalar pass
        const scalarUpdates = [];
        const scalarDelegate = {
            findMany: jest.fn().mockResolvedValueOnce([
                { id: 'e1', thaiCitizenId: '1100000000008', juristicId: null },
                { id: 'e2', thaiCitizenId: null, juristicId: '0105561234560' },
            ]).mockResolvedValueOnce([]),
            update: jest.fn(async ({ where, data }) => { scalarUpdates.push({ id: where.id, data }); return {}; }),
        };
        const scalarStats = await runScalarColumnBackfill({
            ...scalarArgs(), delegate: scalarDelegate, columns: ENTITY_SCALAR_PII_COLUMNS, label: 'entities (scalar)',
        });
        expect(scalarStats.rowsUpdated).toBe(2);
        expect(scalarUpdates.find((u) => u.id === 'e1').data.thaiCitizenId).toBe(enc('1100000000008'));
        expect(scalarUpdates.find((u) => u.id === 'e2').data.juristicId).toBe(enc('0105561234560'));

        // JSON-leaf pass over Entity.payload (director.idCard caught by Mod-11 net)
        const jsonUpdates = [];
        const jsonDelegate = {
            findMany: jest.fn().mockResolvedValueOnce([
                { id: 'e1', payload: { director: { idCard: '1100000000008', name: 'Somchai' } } },
                { id: 'e2', payload: { companyType: 'LTD' } }, // no national ID → skip
            ]).mockResolvedValueOnce([]),
            update: jest.fn(async ({ where, data }) => { jsonUpdates.push({ id: where.id, data }); return {}; }),
        };
        const jsonStats = await runModelBackfill({
            versionPrefix: VERSION_PREFIX,
            encryptFormDataPiiFn: encryptFormDataPii,
            hasPlaintextPiiFn: hasPlaintextPii,
            batchSize: 100, maxRows: Infinity, dryRun: false, verbose: false, logger: { log: jest.fn() },
            delegate: jsonDelegate, columns: ENTITY_JSON_PII_COLUMNS, label: 'entities (payload)',
        });
        expect(jsonDelegate.findMany.mock.calls[0][0].select).toEqual({ id: true, payload: true });
        expect(jsonStats.rowsRequiringBackfill).toBe(1);
        expect(jsonUpdates.find((u) => u.id === 'e1').data.payload.director.idCard).toBe(enc('1100000000008'));
        expect(jsonUpdates.find((u) => u.id === 'e1').data.payload.director.name).toBe('Somchai'); // untouched
    });

    it('purchase-invoice: encrypts supplierTaxId AND derives supplierTaxIdHmac from the PLAINTEXT', async () => {
        const updates = [];
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([
                { id: 'pi-1', supplierTaxId: '0105561234560' },
                { id: 'pi-2', supplierTaxId: enc('0105561234560') }, // already enc → skip (no hmac re-derive)
            ]).mockResolvedValueOnce([]),
            update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return {}; }),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(),
            delegate,
            columns: PURCHASE_INVOICE_SCALAR_PII_COLUMNS,
            label: 'purchase-invoices',
            // mirror main()'s derive: HMAC from the plaintext TIN, computed BEFORE
            // the scalar value is encrypted (here a deterministic stand-in).
            deriveExtraData: (row) => {
                const raw = row.supplierTaxId;
                if (typeof raw === 'string' && raw.length > 0 && !raw.startsWith(VERSION_PREFIX)) {
                    return { supplierTaxIdHmac: `HMAC[${raw}]` };
                }
                return {};
            },
        });
        expect(stats.rowsRequiringBackfill).toBe(1);
        const pi1 = updates.find((u) => u.id === 'pi-1');
        // supplierTaxId encrypted at rest, hmac derived from the plaintext.
        expect(pi1.data.supplierTaxId).toBe(enc('0105561234560'));
        expect(pi1.data.supplierTaxIdHmac).toBe('HMAC[0105561234560]');
    });

    it('countRemainingScalarPlaintext: 1 when a plaintext scalar remains, 0 once encrypted', async () => {
        const plaintext = await countRemainingScalarPlaintext({
            delegate: { findMany: jest.fn().mockResolvedValueOnce([{ id: 'c1', issuedBy: '1100000000008', signedBy: enc('x') }]).mockResolvedValueOnce([]) },
            columns: CERTIFICATE_SCALAR_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
        });
        expect(plaintext).toBe(1);

        const clean = await countRemainingScalarPlaintext({
            delegate: { findMany: jest.fn().mockResolvedValueOnce([{ id: 'c1', issuedBy: enc('1100000000008'), signedBy: null }]).mockResolvedValueOnce([]) },
            columns: CERTIFICATE_SCALAR_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
        });
        expect(clean).toBe(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// SHOULD-#4 (batch-2 adversarial-verify fast-follow) — the certificate scalar
// backfill list must cover revokedReason + deleteReason (both whole-column
// encrypted-forward by the extension's CERTIFICATE_PII_COLUMNS). Before this
// fix the list was ['issuedBy','signedBy'], so a naive operator run reported
// "0 plaintext certificates" (countRemainingScalarPlaintext iterates the SAME
// list) while a Postgres dump still recovered legacy plaintext deleteReason /
// revokedReason — a FALSE-GREEN. The list drives BOTH the encrypt loop and the
// all-clear count, so covering the columns fixes encrypt + assertion together.
// ───────────────────────────────────────────────────────────────────────────
describe('[SHOULD-#4] certificate revokedReason/deleteReason backfill coverage', () => {
    const scalarArgs = () => ({
        versionPrefix: VERSION_PREFIX,
        encryptValueFn: encryptScalarValue,
        batchSize: 100,
        maxRows: Infinity,
        dryRun: false,
        verbose: false,
        logger: { log: jest.fn() },
    });

    it('CERTIFICATE_SCALAR_PII_COLUMNS covers revokedReason AND deleteReason', () => {
        expect(CERTIFICATE_SCALAR_PII_COLUMNS).toContain('revokedReason');
        expect(CERTIFICATE_SCALAR_PII_COLUMNS).toContain('deleteReason');
        // still covers the original two.
        expect(CERTIFICATE_SCALAR_PII_COLUMNS).toContain('issuedBy');
        expect(CERTIFICATE_SCALAR_PII_COLUMNS).toContain('signedBy');
    });

    it('encrypts a legacy plaintext revokedReason AND deleteReason via the exported list', async () => {
        const updates = [];
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([
                // A pre-fix row: issuer already encrypted, but the reason columns
                // are legacy plaintext (the extension only encrypts them going
                // forward). The whole free-text column is encrypted (an operator
                // may type a national ID mid-sentence).
                {
                    id: 'c1',
                    issuedBy: enc('1100000000008'),
                    signedBy: enc('1100000000008'),
                    revokedReason: 'ปลอมแปลงโดย 1101700230705',
                    deleteReason: 'ยกเลิกซ้ำ',
                },
            ]).mockResolvedValueOnce([]),
            update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return {}; }),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(), delegate, columns: CERTIFICATE_SCALAR_PII_COLUMNS, label: 'certificates',
        });
        // select now includes the reason columns.
        expect(delegate.findMany.mock.calls[0][0].select).toEqual({
            id: true, issuedBy: true, signedBy: true, revokedReason: true, deleteReason: true,
        });
        expect(stats.rowsRequiringBackfill).toBe(1);
        const c1 = updates.find((u) => u.id === 'c1');
        // both legacy plaintext reason columns encrypted; already-encrypted
        // issuer/signer are NOT rewritten (idempotent per-column gate).
        expect(c1.data.revokedReason).toBe(enc('ปลอมแปลงโดย 1101700230705'));
        expect(c1.data.deleteReason).toBe(enc('ยกเลิกซ้ำ'));
        expect('issuedBy' in c1.data).toBe(false);
        expect('signedBy' in c1.data).toBe(false);
    });

    it('countRemainingScalarPlaintext counts a legacy plaintext revokedReason (no more false-green)', async () => {
        const plaintext = await countRemainingScalarPlaintext({
            delegate: {
                findMany: jest.fn().mockResolvedValueOnce([
                    { id: 'c1', issuedBy: enc('x'), signedBy: enc('x'), revokedReason: 'plaintext', deleteReason: null },
                ]).mockResolvedValueOnce([]),
            },
            columns: CERTIFICATE_SCALAR_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
        });
        expect(plaintext).toBe(1);

        const clean = await countRemainingScalarPlaintext({
            delegate: {
                findMany: jest.fn().mockResolvedValueOnce([
                    { id: 'c1', issuedBy: enc('x'), signedBy: enc('x'), revokedReason: enc('reason'), deleteReason: null },
                ]).mockResolvedValueOnce([]),
            },
            columns: CERTIFICATE_SCALAR_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
        });
        expect(clean).toBe(0);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// ROUND-4 (close-natid-round4) — Organization.taxId by-column SCALAR backfill +
// taxIdHash derive-extra + cross-model 0-assert.
// ───────────────────────────────────────────────────────────────────────────
describe('[ROUND-4] Organization.taxId scalar backfill (+ taxIdHash derive)', () => {
    const scalarArgs = () => ({
        versionPrefix: VERSION_PREFIX,
        encryptValueFn: encryptScalarValue,
        batchSize: 100,
        maxRows: Infinity,
        dryRun: false,
        verbose: false,
        logger: { log: jest.fn() },
    });

    it('exports the ROUND-4 column list', () => {
        expect(ORGANIZATION_SCALAR_PII_COLUMNS).toEqual(['taxId']);
    });

    it('encrypts taxId AND derives taxIdHash from the PLAINTEXT; skips clean + already-encrypted; selects id+col only', async () => {
        const updates = [];
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([
                { id: 'o1', taxId: '0105561234560' },
                { id: 'o2', taxId: enc('0105561234560') }, // already enc → skip (no hash re-derive)
                { id: 'o3', taxId: null }, // no plaintext → skip
            ]).mockResolvedValueOnce([]),
            update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, data }); return {}; }),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(),
            delegate,
            columns: ORGANIZATION_SCALAR_PII_COLUMNS,
            label: 'organizations',
            // mirror main()'s derive: taxIdHash from the plaintext TIN, computed
            // BEFORE the scalar value is encrypted (deterministic stand-in here).
            deriveExtraData: (row) => {
                const raw = row.taxId;
                if (typeof raw === 'string' && raw.length > 0 && !raw.startsWith(VERSION_PREFIX)) {
                    return { taxIdHash: `HMAC[${raw}]` };
                }
                return {};
            },
        });
        // select is id + taxId only (never a plaintext WHERE).
        expect(delegate.findMany.mock.calls[0][0].select).toEqual({ id: true, taxId: true });
        expect(delegate.findMany.mock.calls[0][0].where).toEqual({ isDeleted: false });
        expect(stats.rowsRequiringBackfill).toBe(1);
        expect(stats.rowsUpdated).toBe(1);
        expect(stats.rowsSkipped).toBe(2);
        const o1 = updates.find((u) => u.id === 'o1');
        expect(o1.data.taxId).toBe(enc('0105561234560'));
        expect(o1.data.taxIdHash).toBe('HMAC[0105561234560]');
    });

    it('dry-run counts but does not write', async () => {
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([{ id: 'o1', taxId: '0105561234560' }]).mockResolvedValueOnce([]),
            update: jest.fn(),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(), delegate, columns: ORGANIZATION_SCALAR_PII_COLUMNS, label: 'organizations', dryRun: true,
        });
        expect(stats.rowsRequiringBackfill).toBe(1);
        expect(stats.rowsUpdated).toBe(0);
        expect(delegate.update).not.toHaveBeenCalled();
    });

    it('is idempotent — second pass over an already-encrypted taxId writes nothing', async () => {
        const delegate = {
            findMany: jest.fn().mockResolvedValueOnce([{ id: 'o1', taxId: enc('0105561234560') }]).mockResolvedValueOnce([]),
            update: jest.fn(),
        };
        const stats = await runScalarColumnBackfill({
            ...scalarArgs(), delegate, columns: ORGANIZATION_SCALAR_PII_COLUMNS, label: 'organizations',
        });
        expect(stats.rowsRequiringBackfill).toBe(0);
        expect(delegate.update).not.toHaveBeenCalled();
    });

    it('countRemainingScalarPlaintext over organizations: 1 plaintext, 0 once encrypted', async () => {
        const plaintext = await countRemainingScalarPlaintext({
            delegate: { findMany: jest.fn().mockResolvedValueOnce([{ id: 'o1', taxId: '0105561234560' }]).mockResolvedValueOnce([]) },
            columns: ORGANIZATION_SCALAR_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
        });
        expect(plaintext).toBe(1);
        const clean = await countRemainingScalarPlaintext({
            delegate: { findMany: jest.fn().mockResolvedValueOnce([{ id: 'o1', taxId: enc('0105561234560') }]).mockResolvedValueOnce([]) },
            columns: ORGANIZATION_SCALAR_PII_COLUMNS,
            versionPrefix: VERSION_PREFIX,
        });
        expect(clean).toBe(0);
    });
});
