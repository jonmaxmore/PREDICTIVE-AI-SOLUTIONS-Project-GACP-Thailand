/**
 * Tests for Prisma PDPA field-encryption extension.
 *
 * System deep-dive Tier 5 — DBA F-01 + Security C-1 (2026-05-15).
 *
 * Covers:
 *   1. Helper functions (encryptValue / decryptValue): round-trip,
 *      idempotency, legacy plaintext pass-through, null/undefined handling
 *   2. encryptUserDataPayload: only touches PHASE_1_PII_COLUMNS keys
 *   3. decryptUserRow: detects version prefix, leaves legacy plaintext alone
 *   4. createPdpaEncryptedClient: opt-in via env var; default is identity
 */

const path = require('path');

// Mock the field-encryption helpers BEFORE require so the extension picks
// up our deterministic mock. The real AES-GCM cipher is non-deterministic
// (random IV) — for unit tests we need stable output to assert against.
jest.mock('../../utils/field-encryption', () => ({
    encrypt: jest.fn((plain) => `ENC[${plain}]`),
    decrypt: jest.fn((cipher) => {
        const match = String(cipher).match(/^ENC\[(.*)\]$/);
        if (!match) {throw new Error('mock-decrypt-failure');}
        return match[1];
    }),
    hashData: jest.fn((v) => (v ? `HASH[${v}]` : null)),
}));

const {
    PHASE_1_PII_COLUMNS,
    PHASE_2_USER_PII_COLUMNS,
    PHASE_3_NATIONAL_ID_COLUMNS,
    DEFERRED_PII_COLUMNS,
    ENTITY_PII_COLUMNS,
    ENTITY_JSON_PII_COLUMNS,
    ALL_USER_PII_COLUMNS,
    CERTIFICATE_PII_COLUMNS,
    PURCHASE_INVOICE_PII_COLUMNS,
    ORGANIZATION_PII_COLUMNS,
    VERSION_PREFIX,
    encryptValue,
    decryptValue,
    encryptUserDataPayload,
    decryptUserRow,
    encryptCertificateDataPayload,
    decryptCertificateRow,
    encryptEntityDataPayload,
    decryptEntityRow,
    encryptPurchaseInvoiceDataPayload,
    decryptPurchaseInvoiceRow,
    encryptOrganizationDataPayload,
    decryptOrganizationRow,
    hashForLookup,
    createPdpaEncryptedClient,
} = require(path.join(__dirname, '..', '..', 'services', 'prisma-pdpa-extension.js'));

describe('[Tier 5] PDPA field-encryption helpers', () => {
    it('encryptValue prepends version prefix and is idempotent', () => {
        const plain = '1100100100011';
        const once = encryptValue(plain);
        expect(once).toBe(`${VERSION_PREFIX}ENC[${plain}]`);

        // Idempotent: encrypting an already-encrypted value is a no-op.
        const twice = encryptValue(once);
        expect(twice).toBe(once);
    });

    it('decryptValue returns plain for prefixed input and passes through legacy plaintext', () => {
        const plain = 'sensitive-id-card-img-ref';
        const encrypted = `${VERSION_PREFIX}ENC[${plain}]`;

        expect(decryptValue(encrypted)).toBe(plain);
        // Legacy plaintext (no version prefix) passes through unchanged.
        expect(decryptValue('legacy-plaintext-value')).toBe('legacy-plaintext-value');
    });

    it('decryptValue returns [PII_DECRYPT_FAILED] marker on cipher errors instead of leaking ciphertext', () => {
        // Provide a prefixed but malformed ciphertext.
        const malformed = `${VERSION_PREFIX}NOT_A_VALID_ENC_BLOCK`;
        expect(decryptValue(malformed)).toBe('[PII_DECRYPT_FAILED]');
    });

    it('decryptValue returns the marker when decrypt() RETURNS NULL (real behaviour — not just throw)', () => {
        // Bug 7.2: the REAL field-encryption.decrypt() catches internally and
        // returns `null` on any failure (rotated key / auth-tag mismatch /
        // corrupt ciphertext) — it NEVER throws. The marker test above passes
        // only because the MOCK throws (false-green): in production the catch
        // never fires and decryptValue silently returned the null, dropping the
        // fail-safe marker. Pin the real null-return path.
        const { decrypt } = require('../../utils/field-encryption');
        decrypt.mockReturnValueOnce(null);
        expect(decryptValue(`${VERSION_PREFIX}ENC[secret]`)).toBe('[PII_DECRYPT_FAILED]');
        // And undefined (defensive — same class):
        decrypt.mockReturnValueOnce(undefined);
        expect(decryptValue(`${VERSION_PREFIX}ENC[secret]`)).toBe('[PII_DECRYPT_FAILED]');
    });

    it('handles null/undefined/empty values without crashing', () => {
        expect(encryptValue(null)).toBeNull();
        expect(encryptValue(undefined)).toBeUndefined();
        expect(encryptValue('')).toBe('');
        expect(decryptValue(null)).toBeNull();
        expect(decryptValue(undefined)).toBeUndefined();
        expect(decryptValue('')).toBe('');
    });

    it('PHASE_1_PII_COLUMNS only includes columns confirmed safe (NOT used in WHERE)', () => {
        // Anchor list — anyone adding a column here MUST first confirm via
        // `grep "where:.*<column>" apps/backend/` that no caller filters by it.
        expect(PHASE_1_PII_COLUMNS).toEqual([
            'idCard',
            'taxId',
            'laserCode',
            'communityRegistrationNo',
            'address',
            'province',
            'district',
            'subdistrict',
            'zipCode',
        ]);
        // Specifically NOT included (would break WHERE queries):
        expect(PHASE_1_PII_COLUMNS).not.toContain('healthId');
        expect(PHASE_1_PII_COLUMNS).not.toContain('providerId');
    });

    it('encryptUserDataPayload encrypts the B3 active set (incl. national IDs), leaves non-PII + deferred plaintext', () => {
        const input = {
            id: 'user-1',
            email: 'farmer@example.test', // NOT in any list — plaintext
            healthId: '1100100100011', // STAGE B3 — national ID, NOW encrypted
            idCard: 'idcard-image-ref',
            taxId: '0123456789012',
            address: '123 Sukhumvit Rd',
            province: 'Bangkok', // DEFERRED (raw GROUP BY) — must stay plaintext
            firstName: 'สมชาย', // DEFERRED (contains-search) — must stay plaintext
        };
        const out = encryptUserDataPayload(input);

        // Non-PII fields pass through:
        expect(out.id).toBe('user-1');
        expect(out.email).toBe('farmer@example.test');
        // STAGE B3 — healthId (national ID) IS now encrypted:
        expect(out.healthId).toBe(`${VERSION_PREFIX}ENC[1100100100011]`);
        // Active display/national-ID columns are encrypted:
        expect(out.idCard).toBe(`${VERSION_PREFIX}ENC[idcard-image-ref]`);
        expect(out.taxId).toBe(`${VERSION_PREFIX}ENC[0123456789012]`);
        expect(out.address).toBe(`${VERSION_PREFIX}ENC[123 Sukhumvit Rd]`);
        // DEFERRED columns (searched/sorted/grouped on the raw value) stay plaintext:
        expect(out.province).toBe('Bangkok');
        expect(out.firstName).toBe('สมชาย');
    });

    it('decryptUserRow round-trips through encryptUserDataPayload', () => {
        const original = {
            id: 'user-1',
            email: 'farmer@example.test',
            idCard: 'idcard-image-ref',
            taxId: '0123456789012',
            address: '123 Sukhumvit Rd',
            province: 'Bangkok',
            district: 'Watthana',
            subdistrict: 'Khlong Toei Nuea',
            zipCode: '10110',
        };
        const encrypted = encryptUserDataPayload(original);
        const decrypted = decryptUserRow(encrypted);
        expect(decrypted).toEqual(original);
    });

    it('decryptUserRow tolerates rows with mixed legacy plaintext + new encrypted columns', () => {
        // Realistic mid-migration scenario: some rows still have plaintext
        // (pre-backfill), some have encrypted (post-backfill).
        const mixedRow = {
            id: 'user-1',
            idCard: 'enc:v1:ENC[idcard-new]', // already encrypted
            taxId: 'legacy-plaintext-tax-id', // not yet backfilled
            address: null, // never had a value
        };
        const out = decryptUserRow(mixedRow);
        expect(out.idCard).toBe('idcard-new');
        expect(out.taxId).toBe('legacy-plaintext-tax-id'); // pass-through, no decryption attempt
        expect(out.address).toBeNull();
    });

    it('createPdpaEncryptedClient returns the input client UNCHANGED when env var is not set', () => {
        const originalEnv = process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        const dummyClient = { user: { findUnique: jest.fn() } };
        const result = createPdpaEncryptedClient(dummyClient);
        expect(result).toBe(dummyClient); // exact same reference
        if (typeof originalEnv === 'string') {
            process.env.ENABLE_PDPA_FIELD_ENCRYPTION = originalEnv;
        }
    });

    it('createPdpaEncryptedClient calls $extends when env var is true', () => {
        const originalEnv = process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';
        const extended = { extended: true };
        const dummyClient = {
            $extends: jest.fn(() => extended),
        };
        const result = createPdpaEncryptedClient(dummyClient);
        expect(dummyClient.$extends).toHaveBeenCalledTimes(1);
        const extensionConfig = dummyClient.$extends.mock.calls[0][0];
        expect(extensionConfig.name).toBe('pdpa-field-encryption');
        expect(extensionConfig.query.user.create).toBeDefined();
        expect(extensionConfig.query.user.findMany).toBeDefined();
        // Iter 27 — Certificate model joined the encryption surface.
        expect(extensionConfig.query.certificate).toBeDefined();
        expect(extensionConfig.query.certificate.create).toBeDefined();
        expect(extensionConfig.query.certificate.findMany).toBeDefined();
        // STAGE B3 — Entity model joined the encrypt-on-write surface.
        expect(extensionConfig.query.entity).toBeDefined();
        expect(extensionConfig.query.entity.create).toBeDefined();
        expect(extensionConfig.query.entity.upsert).toBeDefined();
        expect(extensionConfig.query.entity.findMany).toBeDefined();
        // ROUND-2 — PurchaseInvoice model joined the encrypt-on-write surface.
        expect(extensionConfig.query.purchaseInvoice).toBeDefined();
        expect(extensionConfig.query.purchaseInvoice.create).toBeDefined();
        expect(extensionConfig.query.purchaseInvoice.upsert).toBeDefined();
        expect(extensionConfig.query.purchaseInvoice.findMany).toBeDefined();
        // ROUND-4 — Organization model joined the encrypt-on-write surface.
        expect(extensionConfig.query.organization).toBeDefined();
        expect(extensionConfig.query.organization.create).toBeDefined();
        expect(extensionConfig.query.organization.update).toBeDefined();
        expect(extensionConfig.query.organization.upsert).toBeDefined();
        expect(extensionConfig.query.organization.findMany).toBeDefined();
        expect(result).toBe(extended);
        if (typeof originalEnv === 'string') {
            process.env.ENABLE_PDPA_FIELD_ENCRYPTION = originalEnv;
        } else {
            delete process.env.ENABLE_PDPA_FIELD_ENCRYPTION;
        }
    });
});

describe('[Iter 27] PDPA Phase 2 + Certificate encryption surface', () => {
    it('PHASE_2_USER_PII_COLUMNS anchor unchanged (historical list)', () => {
        // Anchor list — kept verbatim as the historical Iter-27 audit record.
        // STAGE B3 NO LONGER uses this list as-is at runtime: phoneNumber /
        // firstName / lastName are all DEFERRED (searched/sorted on the raw
        // value) and removed from the active ALL_USER_PII_COLUMNS set.
        expect(PHASE_2_USER_PII_COLUMNS).toEqual([
            'phoneNumber',
            'firstName',
            'lastName',
        ]);
    });

    it('STAGE B3 active set = (Phase1 ∪ Phase2 ∪ Phase3) MINUS deferred', () => {
        // Phase-1 display columns minus province (deferred) are all present.
        for (const c of ['idCard', 'taxId', 'laserCode', 'communityRegistrationNo',
            'address', 'district', 'subdistrict', 'zipCode']) {
            expect(ALL_USER_PII_COLUMNS).toContain(c);
        }
        // STAGE B3 — national-ID columns NOW in the encrypt set.
        expect(PHASE_3_NATIONAL_ID_COLUMNS).toEqual([
            'healthId', 'providerId', 'idCard', 'taxId', 'communityRegistrationNo', 'laserCode',
        ]);
        expect(ALL_USER_PII_COLUMNS).toContain('healthId');
        expect(ALL_USER_PII_COLUMNS).toContain('providerId');
        // No duplicates (idCard/taxId/communityRegistrationNo appear in both
        // Phase 1 and Phase 3 — the active set de-dupes).
        expect(ALL_USER_PII_COLUMNS.length).toBe(new Set(ALL_USER_PII_COLUMNS).size);
    });

    it('DEFERRED columns are NOT in the active encrypt list (would break search/sort/group)', () => {
        // The whole point of STEP 1 — these are searched/sorted/grouped on the
        // raw value, so encrypting them silently breaks those queries.
        expect(DEFERRED_PII_COLUMNS).toEqual(['province', 'firstName', 'lastName', 'phoneNumber']);
        for (const c of DEFERRED_PII_COLUMNS) {
            expect(ALL_USER_PII_COLUMNS).not.toContain(c);
        }
        // email stays excluded (heavily WHERE-filtered; needs an emailHash path).
        expect(ALL_USER_PII_COLUMNS).not.toContain('email');
        // Certificate.applicantName is DEFERRED (contains-search in interoperability.js).
        expect(CERTIFICATE_PII_COLUMNS).not.toContain('applicantName');
    });

    it('encryptUserDataPayload leaves DEFERRED phoneNumber/firstName/lastName as plaintext', () => {
        const out = encryptUserDataPayload({
            id: 'user-1',
            email: 'farmer@example.test', // NOT encrypted
            phoneNumber: '0812345678', // DEFERRED — WHERE-equality (entity-service)
            firstName: 'สมชาย', // DEFERRED — contains-search
            lastName: 'ทดสอบ', // DEFERRED — contains-search
        });
        expect(out.email).toBe('farmer@example.test'); // plaintext
        expect(out.phoneNumber).toBe('0812345678'); // plaintext (deferred)
        expect(out.firstName).toBe('สมชาย'); // plaintext (deferred)
        expect(out.lastName).toBe('ทดสอบ'); // plaintext (deferred)
    });

    it('Certificate scope encrypts address + issuedBy + signedBy + revokedReason + deleteReason (applicantName deferred)', () => {
        // ROUND-2 (close-natid-round2) — issuedBy + signedBy ADDED.
        // B2 (PDPA-LEAK cluster) — revokedReason ADDED (operator free-text sink).
        // SHOULD-B2b — deleteReason ADDED (reversal-void twin of revokedReason).
        expect(CERTIFICATE_PII_COLUMNS).toEqual(['address', 'issuedBy', 'signedBy', 'revokedReason', 'deleteReason']);
        const out = encryptCertificateDataPayload({
            id: 'cert-1',
            certificateNumber: 'CERT-2026-001',
            applicantName: 'สมชาย', // DEFERRED — contains-search (interoperability.js:249)
            address: '123 Sukhumvit',
            cropType: 'cannabis',
            issuedBy: '1100100100011', // ROUND-2 — national-ID-class issuer identity
            signedBy: '1100100100011',
        });
        // Non-PII display fields + deferred applicantName pass through.
        expect(out.certificateNumber).toBe('CERT-2026-001');
        expect(out.cropType).toBe('cannabis');
        expect(out.applicantName).toBe('สมชาย'); // plaintext (deferred)
        // address + issuedBy + signedBy encrypted.
        expect(out.address).toBe(`${VERSION_PREFIX}ENC[123 Sukhumvit]`);
        expect(out.issuedBy).toBe(`${VERSION_PREFIX}ENC[1100100100011]`);
        expect(out.signedBy).toBe(`${VERSION_PREFIX}ENC[1100100100011]`);
    });

    it('decryptCertificateRow round-trips through encryptCertificateDataPayload (incl issuedBy/signedBy)', () => {
        const original = {
            id: 'cert-1',
            certificateNumber: 'CERT-2026-001',
            address: '123 Sukhumvit',
            issuedBy: '1100100100011',
            signedBy: '1100100100011',
        };
        expect(decryptCertificateRow(encryptCertificateDataPayload(original))).toEqual(original);
    });

    it('STAGE B3 / ROUND-2 — Entity scope encrypts thaiCitizenId + juristicId + payload-leaf + round-trips', () => {
        // ROUND-2 — juristicId ADDED to the scalar set.
        expect(ENTITY_PII_COLUMNS).toEqual(['thaiCitizenId', 'juristicId']);
        const out = encryptEntityDataPayload({
            id: 'ent-1',
            type: 'JURISTIC',
            displayName: 'Acme Co.', // NOT encrypted
            juristicId: '0105561234560', // ROUND-2 — national-ID-class registration number
            juristicIdHash: 'raw-sha256', // hash columns NOT encrypted
            thaiCitizenId: '1100100100011',
            thaiCitizenIdHash: 'raw-sha256',
            thaiCitizenIdHmac: 'keyed-hmac',
        });
        expect(out.displayName).toBe('Acme Co.');
        expect(out.juristicIdHash).toBe('raw-sha256');
        expect(out.thaiCitizenIdHash).toBe('raw-sha256');
        expect(out.thaiCitizenIdHmac).toBe('keyed-hmac');
        expect(out.thaiCitizenId).toBe(`${VERSION_PREFIX}ENC[1100100100011]`);
        expect(out.juristicId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
        // Round-trip via the single-row helper (scalar columns).
        const original = {
            id: 'ent-1', type: 'JURISTIC',
            thaiCitizenId: '1100100100011', juristicId: '0105561234560',
        };
        expect(decryptEntityRow(encryptEntityDataPayload(original))).toEqual(original);
    });

    it('ROUND-2 — Entity.payload JSON leaf encrypts nested director/president idCard (Mod-11 net)', () => {
        const out = encryptEntityDataPayload({
            id: 'ent-1',
            type: 'JURISTIC',
            payload: {
                companyType: 'LTD', // non-PII — untouched
                director: {
                    name: 'Somchai',
                    idCard: '1100000000008', // valid Mod-11 national ID → encrypted
                    phone: '0812345678', // 10-digit, not 13 → untouched
                },
            },
        });
        // The encrypt-on-write builds a NEW payload object (encryptFormDataPii
        // does not mutate); the nested idCard leaf is wrapped, siblings untouched.
        expect(out.payload.companyType).toBe('LTD');
        expect(out.payload.director.name).toBe('Somchai');
        expect(out.payload.director.phone).toBe('0812345678');
        expect(out.payload.director.idCard).toBe(`${VERSION_PREFIX}ENC[1100000000008]`);
    });

    it('ROUND-2 — Entity.payload handles the Prisma { set: ... } write shape', () => {
        const out = encryptEntityDataPayload({
            id: 'ent-1',
            payload: { set: { president: { idCard: '0105561234560' } } },
        });
        expect(out.payload.set.president.idCard).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
    });

    it('hashForLookup uses HMAC and returns null for empty input', () => {
        expect(hashForLookup('alice@example.test')).toBe('HASH[alice@example.test]');
        expect(hashForLookup('')).toBeNull();
        expect(hashForLookup(null)).toBeNull();
        expect(hashForLookup(undefined)).toBeUndefined();
        // Non-string input passes through unchanged (defensive — caller bug).
        expect(hashForLookup(42)).toBe(42);
    });
});

describe('[ROUND-2 close-natid-round2] PurchaseInvoice.supplierTaxId encryption surface', () => {
    it('PURCHASE_INVOICE_PII_COLUMNS = [supplierTaxId] (NOT the hmac/number columns)', () => {
        expect(PURCHASE_INVOICE_PII_COLUMNS).toEqual(['supplierTaxId']);
        // The keyed lookup column + invoiceNumber stay searchable → NOT encrypted.
        expect(PURCHASE_INVOICE_PII_COLUMNS).not.toContain('supplierTaxIdHmac');
        expect(PURCHASE_INVOICE_PII_COLUMNS).not.toContain('invoiceNumber');
    });

    it('encryptPurchaseInvoiceDataPayload encrypts supplierTaxId only, leaves hmac/name plaintext', () => {
        const out = encryptPurchaseInvoiceDataPayload({
            id: 'pi-1',
            invoiceNumber: 'INV-SUP-2026-001', // NOT encrypted (searchable)
            supplierName: 'Acme Supplies', // NOT encrypted
            supplierTaxId: '0105561234560',
            supplierTaxIdHmac: 'keyed-hmac', // lookup column — NOT encrypted
        });
        expect(out.invoiceNumber).toBe('INV-SUP-2026-001');
        expect(out.supplierName).toBe('Acme Supplies');
        expect(out.supplierTaxIdHmac).toBe('keyed-hmac');
        expect(out.supplierTaxId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
    });

    it('decryptPurchaseInvoiceRow round-trips through encryptPurchaseInvoiceDataPayload', () => {
        const original = { id: 'pi-1', invoiceNumber: 'INV-1', supplierTaxId: '0105561234560' };
        expect(decryptPurchaseInvoiceRow(encryptPurchaseInvoiceDataPayload(original))).toEqual(original);
    });

    it('ENTITY_JSON_PII_COLUMNS = [payload] (the only Entity Json column)', () => {
        expect(ENTITY_JSON_PII_COLUMNS).toEqual(['payload']);
    });
});

describe('[ROUND-4 close-natid-round4] Organization.taxId encryption surface', () => {
    it('ORGANIZATION_PII_COLUMNS = [taxId] (NOT taxIdHash / slug / code)', () => {
        expect(ORGANIZATION_PII_COLUMNS).toEqual(['taxId']);
        // The keyed lookup column + the searchable identity columns stay
        // searchable/unique → NOT encrypted.
        expect(ORGANIZATION_PII_COLUMNS).not.toContain('taxIdHash');
        expect(ORGANIZATION_PII_COLUMNS).not.toContain('slug');
        expect(ORGANIZATION_PII_COLUMNS).not.toContain('code');
        expect(ORGANIZATION_PII_COLUMNS).not.toContain('name');
    });

    it('encryptOrganizationDataPayload encrypts taxId only, leaves taxIdHash/name/slug plaintext', () => {
        const out = encryptOrganizationDataPayload({
            id: 'org-1',
            name: 'กรมส่งเสริมการเกษตร', // NOT encrypted (display)
            slug: 'doa-cmi', // NOT encrypted (routing)
            code: 'DOA_CMI', // NOT encrypted (internal code)
            taxId: '0105561234560',
            taxIdHash: 'keyed-hmac', // lookup column — NOT encrypted
        });
        expect(out.name).toBe('กรมส่งเสริมการเกษตร');
        expect(out.slug).toBe('doa-cmi');
        expect(out.code).toBe('DOA_CMI');
        expect(out.taxIdHash).toBe('keyed-hmac');
        expect(out.taxId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
    });

    it('decryptOrganizationRow round-trips through encryptOrganizationDataPayload', () => {
        const original = { id: 'org-1', name: 'Acme Org', taxId: '0105561234560' };
        expect(decryptOrganizationRow(encryptOrganizationDataPayload(original))).toEqual(original);
    });

    it('encryptOrganizationDataPayload leaves a null/absent taxId untouched', () => {
        expect(encryptOrganizationDataPayload({ id: 'org-1', taxId: null }).taxId).toBeNull();
        expect('taxId' in encryptOrganizationDataPayload({ id: 'org-1' })).toBe(false);
    });

    it('decryptOrganizationRow tolerates mixed legacy plaintext + encrypted taxId', () => {
        expect(decryptOrganizationRow({ id: 'o-1', taxId: 'enc:v1:ENC[0105561234560]' }).taxId)
            .toBe('0105561234560');
        // Legacy plaintext (pre-backfill) passes through unchanged.
        expect(decryptOrganizationRow({ id: 'o-2', taxId: '0105561234560' }).taxId)
            .toBe('0105561234560');
    });
});

describe('[ROUND-2] $extends hook — encrypt-on-write + decrypt-on-read round-trip', () => {
    // Drive the ACTUAL per-model hooks the extension registers, with a fake
    // prisma whose $extends captures the query config and a fake `query` fn
    // that simulates the DB returning what was written (so we can assert
    // ciphertext-at-rest on write AND plaintext-on-read).
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

    // The create hook decrypts the RETURNED tree IN PLACE (decryptResultTree
    // mutates). The fake `query` therefore DEEP-CLONES what it "persists" before
    // returning the row, so the captured `persisted` (at-rest) snapshot is not
    // retro-mutated back to plaintext by the read-side decrypt of `created`.
    const echoQuery = (capture) => async (args) => {
        capture.persisted = JSON.parse(JSON.stringify(args.data));
        return JSON.parse(JSON.stringify(args.data));
    };

    it('purchaseInvoice.create encrypts supplierTaxId at rest, returns decrypted on read', async () => {
        const config = buildExtended();
        const cap = {};
        const created = await config.query.purchaseInvoice.create({
            args: { data: { supplierTaxId: '0105561234560', invoiceNumber: 'INV-1' } },
            query: echoQuery(cap),
        });
        // AT REST: the value handed to the DB is ciphertext.
        expect(cap.persisted.supplierTaxId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
        // ON READ: the create hook decrypts the returned tree.
        expect(created.supplierTaxId).toBe('0105561234560');
        expect(created.invoiceNumber).toBe('INV-1');
    });

    it('certificate.create encrypts issuedBy/signedBy at rest, returns decrypted on read', async () => {
        const config = buildExtended();
        const cap = {};
        const created = await config.query.certificate.create({
            args: { data: { issuedBy: '1100000000008', signedBy: '1100000000008', certificateNumber: 'C-1' } },
            query: echoQuery(cap),
        });
        expect(cap.persisted.issuedBy).toBe(`${VERSION_PREFIX}ENC[1100000000008]`);
        expect(cap.persisted.signedBy).toBe(`${VERSION_PREFIX}ENC[1100000000008]`);
        expect(created.issuedBy).toBe('1100000000008');
        expect(created.signedBy).toBe('1100000000008');
    });

    it('organization.create encrypts taxId at rest, returns decrypted on read', async () => {
        const config = buildExtended();
        const cap = {};
        const created = await config.query.organization.create({
            args: { data: { taxId: '0105561234560', slug: 'doa-cmi', name: 'Acme Org' } },
            query: echoQuery(cap),
        });
        // AT REST: the value handed to the DB is ciphertext.
        expect(cap.persisted.taxId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
        // ON READ: the create hook decrypts the returned tree.
        expect(created.taxId).toBe('0105561234560');
        expect(created.slug).toBe('doa-cmi');
        expect(created.name).toBe('Acme Org');
    });

    it('organization.update encrypts taxId at rest, returns decrypted on read', async () => {
        const config = buildExtended();
        const cap = {};
        const updated = await config.query.organization.update({
            args: { data: { taxId: '0105561234560' }, where: { id: 'org-1' } },
            query: echoQuery(cap),
        });
        expect(cap.persisted.taxId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
        expect(updated.taxId).toBe('0105561234560');
    });

    // Wave-3 verify F2 — chatter. ApplicationComment.content is FREE TEXT a
    // staffer can paste a national ID into. The Mod-11 value-net only catches
    // whole-value 13-digit leaves, so an ID mid-sentence would slip through —
    // hence WHOLE-COLUMN encrypt (content is never searched/sorted/grouped).
    it('applicationComment.create encrypts content at rest, returns decrypted on read', async () => {
        const config = buildExtended();
        const cap = {};
        const created = await config.query.applicationComment.create({
            args: {
                data: {
                    applicationId: 'app-1',
                    authorId: 'uuid-1',
                    role: 'DOCUMENT_REVIEWER',
                    content: 'เอกสารหน้า 3 เลขบัตร 1100000000008 ไม่ตรงกับใบสมัคร',
                    internalOnly: true,
                },
            },
            query: echoQuery(cap),
        });
        // AT REST: the WHOLE content string is ciphertext (mid-sentence ID included).
        expect(cap.persisted.content).toBe(
            `${VERSION_PREFIX}ENC[เอกสารหน้า 3 เลขบัตร 1100000000008 ไม่ตรงกับใบสมัคร]`,
        );
        // Non-PII columns untouched — internalOnly stays a queryable boolean.
        expect(cap.persisted.internalOnly).toBe(true);
        expect(cap.persisted.role).toBe('DOCUMENT_REVIEWER');
        expect(cap.persisted.authorId).toBe('uuid-1');
        // ON READ: the create hook decrypts the returned tree.
        expect(created.content).toBe('เอกสารหน้า 3 เลขบัตร 1100000000008 ไม่ตรงกับใบสมัคร');
    });

    it('applicationComment.findMany decrypts content on read (list view)', async () => {
        const config = buildExtended();
        const rows = await config.query.applicationComment.findMany({
            args: { where: { applicationId: 'app-1', internalOnly: false } },
            query: async () => ([
                { id: 'c1', content: `${VERSION_PREFIX}ENC[ขอเอกสารเพิ่ม]`, internalOnly: false },
                { id: 'c2', content: 'legacy plaintext row', internalOnly: false },
            ]),
        });
        expect(rows[0].content).toBe('ขอเอกสารเพิ่ม');
        // Legacy plaintext (pre-hook rows) passes through unchanged.
        expect(rows[1].content).toBe('legacy plaintext row');
    });

    it('entity.create encrypts juristicId scalar + payload.director.idCard leaf at rest, decrypts on read', async () => {
        const config = buildExtended();
        const cap = {};
        const created = await config.query.entity.create({
            args: {
                data: {
                    type: 'JURISTIC',
                    juristicId: '0105561234560',
                    payload: { director: { idCard: '1100000000008', name: 'Somchai' } },
                },
            },
            query: echoQuery(cap),
        });
        // AT REST — scalar + nested JSON leaf both ciphertext.
        expect(cap.persisted.juristicId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
        expect(cap.persisted.payload.director.idCard).toBe(`${VERSION_PREFIX}ENC[1100000000008]`);
        expect(cap.persisted.payload.director.name).toBe('Somchai'); // untouched
        // ON READ — decryptResultTree walks the whole tree incl nested JSON.
        expect(created.juristicId).toBe('0105561234560');
        expect(created.payload.director.idCard).toBe('1100000000008');
        expect(created.payload.director.name).toBe('Somchai');
    });
});

describe('[ROUND-2] flag-OFF inertness — every new helper is byte-for-byte unchanged', () => {
    const FLAG = 'ENABLE_PDPA_FIELD_ENCRYPTION';
    let prevFlag;
    beforeEach(() => { prevFlag = process.env[FLAG]; delete process.env[FLAG]; });
    afterEach(() => { if (typeof prevFlag === 'string') { process.env[FLAG] = prevFlag; } });

    it('createPdpaEncryptedClient returns the SAME client reference (no $extends) when flag OFF', () => {
        // The flag gate is the SINGLE on/off switch: with it OFF the factory is a
        // pure identity, so NONE of the ROUND-2/ROUND-4 per-model hooks
        // (purchaseInvoice, organization, entity payload, certificate
        // issuedBy/signedBy) are ever installed → writes/reads are byte-for-byte
        // the legacy plaintext behaviour.
        const dummy = { user: {}, certificate: {}, entity: {}, purchaseInvoice: {}, organization: {} };
        const result = createPdpaEncryptedClient(dummy);
        expect(result).toBe(dummy);
    });

    it('ROUND-4 — encrypt/decrypt org helpers are pure data transforms (flag-independent)', () => {
        // The helpers themselves do not read the flag (the flag only gates whether
        // the extension installs the hooks). Their behaviour is the deterministic
        // by-column transform regardless of flag state — asserted here so the
        // flag-OFF describe documents that the helper is inert ONLY because the
        // factory never calls it (the gate), not because the helper self-checks.
        const enc = encryptOrganizationDataPayload({ id: 'o', taxId: '0105561234560' });
        expect(enc.taxId).toBe(`${VERSION_PREFIX}ENC[0105561234560]`);
        expect(decryptOrganizationRow(enc).taxId).toBe('0105561234560');
    });
});
