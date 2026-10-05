/**
 * STAGE-formData — tests for utils/formdata-pii.js, the deep-walk national-ID
 * leaf encrypt/decrypt for Application.formData.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md.
 *
 * Pins:
 *   (a) encryptFormDataPii encrypts id_card / tax_id (+ camelCase set) including
 *       NESTED (formData.steps["N"], formData.applicantData), idempotent, leaves
 *       non-PII untouched, does NOT mutate the input.
 *   (b) the registrationNumber COLLISION is respected — productionInputs[]
 *       fertilizer registrationNumber stays plaintext (NOT in the PII set).
 *   (c) decryptFormDataPii is the exact inverse + idempotent on plaintext.
 *   (d) hasPlaintextPii detects a remaining plaintext leaf (backfill assertion).
 */

// Deterministic mock cipher so we can assert exact ciphertext + that encrypt is
// only ever called on real PII leaves.
jest.mock('../../utils/field-encryption', () => ({
    encrypt: jest.fn((plain) => `ENC[${plain}]`),
    decrypt: jest.fn((cipher) => {
        const match = String(cipher).match(/^ENC\[(.*)\]$/);
        if (!match) { return null; } // field-encryption.decrypt returns null on error
        return match[1];
    }),
}));

const fieldEncryption = require('../../utils/field-encryption');
const {
    VERSION_PREFIX,
    FORMDATA_PII_KEYS,
    encryptFormDataPii,
    decryptFormDataPii,
    hasPlaintextPii,
} = require('../../utils/formdata-pii');
// REUSE the real shared Mod-11 validator (the SAME one formdata-pii uses) so the
// fixtures below are GUARANTEED to be on the correct side of the Mod-11 net.
const { isThaiIdMod11Valid } = require('../../utils/thai-id-validator');

const enc = (plain) => `${VERSION_PREFIX}ENC[${plain}]`;

// Fixtures vetted against the real validator at module-load (fail fast if a
// future validator change moves one of these across the Mod-11 boundary).
// NOTE: 1100100100011 (used by the OTHER suites with a MOCKED cipher) does NOT
// pass real Mod-11, so these use genuinely Mod-11-valid IDs.
const VALID_NID = '1100000000008'; // passes Mod-11 (used across the suite)
const VALID_NID_2 = '0105561234560'; // passes Mod-11
const BAD_13_DIGIT = '1234567890123'; // 13 digits but FAILS Mod-11
const MS_TIMESTAMP_NUM = 1719600000000; // numeric ms-timestamp (NOT a string)
if (!isThaiIdMod11Valid(VALID_NID) || !isThaiIdMod11Valid(VALID_NID_2)) {
    throw new Error('test fixture drift: VALID_NID must pass Mod-11');
}
if (isThaiIdMod11Valid(BAD_13_DIGIT)) {
    throw new Error('test fixture drift: BAD_13_DIGIT must FAIL Mod-11');
}

beforeEach(() => {
    fieldEncryption.encrypt.mockClear();
    fieldEncryption.decrypt.mockClear();
});

describe('[STAGE-formData] FORMDATA_PII_KEYS', () => {
    it('contains the dump-confirmed snake_case keys + the camelCase national-ID set', () => {
        expect(FORMDATA_PII_KEYS).toEqual(expect.arrayContaining([
            'id_card', 'tax_id',
            'idCard', 'taxId', 'presidentIdCard', 'directorIdCard', 'communityRegNumber',
        ]));
    });
    it('contains the STAFF-ID keys (workflow handlers stamp req.user.providerId)', () => {
        expect(FORMDATA_PII_KEYS).toEqual(expect.arrayContaining([
            'reviewedBy', 'by', 'decidedBy', 'reviewerProviderId',
        ]));
    });
    it('does NOT contain the ambiguous registrationNumber (productionInputs collision)', () => {
        expect(FORMDATA_PII_KEYS).not.toContain('registrationNumber');
    });
    it('does NOT contain non-national-ID fields (phone, names, address, laserCode)', () => {
        for (const k of ['phone', 'phoneNumber', 'firstName', 'lastName', 'address', 'laserCode', 'laser_code']) {
            expect(FORMDATA_PII_KEYS).not.toContain(k);
        }
    });
});

describe('[STAGE-formData] encryptFormDataPii', () => {
    it('(a) encrypts snake_case id_card / tax_id nested under formData.steps', () => {
        const formData = {
            steps: {
                1: { tax_id: '1234567890123', operator_name: 'สมชาย', phone_no: '0812345678' },
                4: { id_card: '1100100100011', first_name: 'A', email: 'a@b.com' },
            },
            workflowState: 'DRAFT',
        };
        const out = encryptFormDataPii(formData);
        expect(out.steps['1'].tax_id).toBe(enc('1234567890123'));
        expect(out.steps['4'].id_card).toBe(enc('1100100100011'));
        // non-PII untouched
        expect(out.steps['1'].operator_name).toBe('สมชาย');
        expect(out.steps['1'].phone_no).toBe('0812345678'); // 10-digit phone NOT encrypted
        expect(out.steps['4'].email).toBe('a@b.com');
        expect(out.workflowState).toBe('DRAFT');
    });

    it('(a) encrypts camelCase national-ID set under formData.applicantData', () => {
        const formData = {
            applicantData: {
                idCard: '1100100100011',
                taxId: '0105500000017',
                presidentIdCard: '2200200200022',
                directorIdCard: '3300300300033',
                communityRegNumber: '12345678901',
                firstName: 'สมหญิง',
                phone: '0898765432',
                address: '123 หมู่ 4',
            },
        };
        const out = encryptFormDataPii(formData);
        expect(out.applicantData.idCard).toBe(enc('1100100100011'));
        expect(out.applicantData.taxId).toBe(enc('0105500000017'));
        expect(out.applicantData.presidentIdCard).toBe(enc('2200200200022'));
        expect(out.applicantData.directorIdCard).toBe(enc('3300300300033'));
        expect(out.applicantData.communityRegNumber).toBe(enc('12345678901'));
        // non-PII untouched
        expect(out.applicantData.firstName).toBe('สมหญิง');
        expect(out.applicantData.phone).toBe('0898765432');
        expect(out.applicantData.address).toBe('123 หมู่ 4');
    });

    it('(b) leaves productionInputs[].registrationNumber (fertilizer code) plaintext', () => {
        const formData = {
            applicantData: { taxId: '0105500000017', registrationNumber: '0999999999999' },
            productionData: {
                productionInputs: [
                    { name: 'ปุ๋ยอินทรีย์', registrationNumber: 'กส.123/2566' },
                    { name: 'สารชีวภัณฑ์', registrationNumber: 'วช.456/2566' },
                ],
            },
        };
        const out = encryptFormDataPii(formData);
        // applicantData.taxId encrypted (national-ID-class)
        expect(out.applicantData.taxId).toBe(enc('0105500000017'));
        // applicantData.registrationNumber NOT in set → plaintext (juristic reg
        // covered by taxId; key excluded to avoid the productionInputs collision)
        expect(out.applicantData.registrationNumber).toBe('0999999999999');
        // productionInputs[].registrationNumber MUST stay plaintext (fertilizer)
        expect(out.productionData.productionInputs[0].registrationNumber).toBe('กส.123/2566');
        expect(out.productionData.productionInputs[1].registrationNumber).toBe('วช.456/2566');
        // encrypt called exactly ONCE (only taxId)
        expect(fieldEncryption.encrypt).toHaveBeenCalledTimes(1);
    });

    it('(a) is idempotent — already-encrypted leaves are not re-encrypted', () => {
        const formData = { steps: { 4: { id_card: enc('1100100100011') } } };
        const out = encryptFormDataPii(formData);
        expect(out.steps['4'].id_card).toBe(enc('1100100100011'));
        // encrypt NEVER called — leaf already prefixed
        expect(fieldEncryption.encrypt).not.toHaveBeenCalled();
    });

    it('(a) does NOT mutate the input object', () => {
        const formData = { steps: { 4: { id_card: '1100100100011' } } };
        const snapshot = JSON.parse(JSON.stringify(formData));
        encryptFormDataPii(formData);
        expect(formData).toEqual(snapshot); // input unchanged
    });

    it('(a) handles null / undefined / scalar formData as a safe no-op', () => {
        expect(encryptFormDataPii(null)).toBeNull();
        expect(encryptFormDataPii(undefined)).toBeUndefined();
        expect(encryptFormDataPii('x')).toBe('x');
        expect(encryptFormDataPii(42)).toBe(42);
    });

    it('skips null / empty-string PII leaf values (no encryption of empties)', () => {
        const formData = { applicantData: { idCard: '', taxId: null } };
        const out = encryptFormDataPii(formData);
        expect(out.applicantData.idCard).toBe('');
        expect(out.applicantData.taxId).toBeNull();
        expect(fieldEncryption.encrypt).not.toHaveBeenCalled();
    });
});

describe('[STAGE-formData] STAFF-ID keys (workflow handler providerId stamps)', () => {
    it('(a) encrypts reviewedBy / by / decidedBy / reviewerProviderId by KEY', () => {
        const formData = {
            reviewedBy: VALID_NID,
            workflowHistory: [
                { toState: 'DOC_APPROVED', by: VALID_NID, at: MS_TIMESTAMP_NUM },
                { toState: 'AUDIT_PASSED', decidedBy: VALID_NID_2, at: MS_TIMESTAMP_NUM + 1 },
            ],
            revisionRequest: { reviewerProviderId: VALID_NID, comment: 'แก้เอกสาร' },
        };
        const out = encryptFormDataPii(formData);
        expect(out.reviewedBy).toBe(enc(VALID_NID));
        expect(out.workflowHistory[0].by).toBe(enc(VALID_NID));
        expect(out.workflowHistory[1].decidedBy).toBe(enc(VALID_NID_2));
        expect(out.revisionRequest.reviewerProviderId).toBe(enc(VALID_NID));
        // non-PII alongside untouched (enum state, free-text comment, numeric ts)
        expect(out.workflowHistory[0].toState).toBe('DOC_APPROVED');
        expect(out.workflowHistory[0].at).toBe(MS_TIMESTAMP_NUM);
        expect(out.revisionRequest.comment).toBe('แก้เอกสาร');
    });

    it('(a) encrypts a carRequest nested decidedBy leaf', () => {
        const formData = { carRequest: { decidedBy: VALID_NID, deadline: MS_TIMESTAMP_NUM } };
        const out = encryptFormDataPii(formData);
        expect(out.carRequest.decidedBy).toBe(enc(VALID_NID));
        expect(out.carRequest.deadline).toBe(MS_TIMESTAMP_NUM);
    });
});

describe('[STAGE-formData] Mod-11 value safety-net (key-agnostic)', () => {
    it('(b) encrypts a valid national-ID STRING under an ARBITRARY key (witnessId)', () => {
        const formData = { auditMeta: { witnessId: VALID_NID, note: 'พยาน' } };
        const out = encryptFormDataPii(formData);
        // encrypted via the Mod-11 net despite `witnessId` not being in the key set
        expect(out.auditMeta.witnessId).toBe(enc(VALID_NID));
        expect(out.auditMeta.note).toBe('พยาน');
    });

    it('(b) encrypts a valid national-ID STRING under a totally unknown key', () => {
        const formData = { someUnknownKey: VALID_NID_2 };
        const out = encryptFormDataPii(formData);
        expect(out.someUnknownKey).toBe(enc(VALID_NID_2));
    });

    it('(c) does NOT encrypt a 13-digit string that FAILS Mod-11 (under arbitrary key)', () => {
        const formData = { auditMeta: { witnessId: BAD_13_DIGIT } };
        const out = encryptFormDataPii(formData);
        expect(out.auditMeta.witnessId).toBe(BAD_13_DIGIT); // plaintext, untouched
        expect(fieldEncryption.encrypt).not.toHaveBeenCalled();
    });

    it('(d) does NOT encrypt a NUMBER value (ms-timestamp), even if 13-digit-shaped', () => {
        const formData = { workflowHistory: [{ at: MS_TIMESTAMP_NUM, seq: 1719600000000 }] };
        const out = encryptFormDataPii(formData);
        expect(out.workflowHistory[0].at).toBe(MS_TIMESTAMP_NUM);
        expect(typeof out.workflowHistory[0].at).toBe('number');
        expect(fieldEncryption.encrypt).not.toHaveBeenCalled();
    });

    it('(e) leaves a non-13-digit string untouched (10-digit phone / short codes)', () => {
        const formData = { applicantData: { phone: '0812345678', code: '12345' } };
        const out = encryptFormDataPii(formData);
        expect(out.applicantData.phone).toBe('0812345678');
        expect(out.applicantData.code).toBe('12345');
        expect(fieldEncryption.encrypt).not.toHaveBeenCalled();
    });

    it('(f) is idempotent — an already-enc:v1: arbitrary-key leaf is not re-encrypted', () => {
        const formData = { auditMeta: { witnessId: enc(VALID_NID) } };
        const out = encryptFormDataPii(formData);
        expect(out.auditMeta.witnessId).toBe(enc(VALID_NID));
        expect(fieldEncryption.encrypt).not.toHaveBeenCalled();
    });

    it('round-trips a Mod-11-net-encrypted arbitrary-key leaf back to plaintext', () => {
        const formData = { auditMeta: { witnessId: VALID_NID } };
        const roundTripped = decryptFormDataPii(encryptFormDataPii(formData));
        expect(roundTripped.auditMeta.witnessId).toBe(VALID_NID);
    });
});

describe('[STAGE-formData] decryptFormDataPii', () => {
    it('(c) is the exact inverse of encryptFormDataPii (nested round-trip)', () => {
        const formData = {
            steps: { 1: { tax_id: '1234567890123' }, 4: { id_card: '1100100100011' } },
            applicantData: { idCard: '5500500500055', firstName: 'สมชาย' },
        };
        const roundTripped = decryptFormDataPii(encryptFormDataPii(formData));
        expect(roundTripped).toEqual(formData);
    });

    it('(c) is idempotent / no-op on plaintext (no decrypt call)', () => {
        const formData = { applicantData: { idCard: '1100100100011' } };
        const out = decryptFormDataPii(formData);
        expect(out.applicantData.idCard).toBe('1100100100011');
        expect(fieldEncryption.decrypt).not.toHaveBeenCalled();
    });

    it('(c) surfaces [PII_DECRYPT_FAILED] on a cipher failure (fail-safe)', () => {
        const formData = { applicantData: { idCard: `${VERSION_PREFIX}corrupt-not-our-format` } };
        const out = decryptFormDataPii(formData);
        expect(out.applicantData.idCard).toBe('[PII_DECRYPT_FAILED]');
    });
});

describe('[STAGE-formData] hasPlaintextPii', () => {
    it('(d) detects a plaintext national-ID leaf nested in steps', () => {
        expect(hasPlaintextPii({ steps: { 4: { id_card: '1100100100011' } } }, VERSION_PREFIX)).toBe(true);
    });
    it('(d) detects a plaintext leaf under applicantData', () => {
        expect(hasPlaintextPii({ applicantData: { taxId: '0105500000017' } }, VERSION_PREFIX)).toBe(true);
    });
    it('(d) returns false when every PII leaf is already encrypted', () => {
        const encrypted = encryptFormDataPii({
            steps: { 4: { id_card: '1100100100011' } },
            applicantData: { taxId: '0105500000017' },
        });
        expect(hasPlaintextPii(encrypted, VERSION_PREFIX)).toBe(false);
    });
    it('(d) returns false when there are no PII leaves at all', () => {
        expect(hasPlaintextPii({ steps: { 1: { operator_name: 'A' } }, applicantData: { firstName: 'B' } }, VERSION_PREFIX)).toBe(false);
    });
    it('(d) ignores the fertilizer productionInputs registrationNumber (not a PII key)', () => {
        const formData = { productionData: { productionInputs: [{ registrationNumber: 'กส.1/2566' }] } };
        expect(hasPlaintextPii(formData, VERSION_PREFIX)).toBe(false);
    });
    it('(g) detects a plaintext Mod-11 national-ID STRING leaf under an ARBITRARY key', () => {
        // honest "0 plaintext remaining" assertion: the value-net leaf must count.
        expect(hasPlaintextPii({ auditMeta: { witnessId: VALID_NID } }, VERSION_PREFIX)).toBe(true);
    });
    it('(g) detects a plaintext staff-ID leaf (workflowHistory[].by)', () => {
        expect(hasPlaintextPii({ workflowHistory: [{ by: VALID_NID }] }, VERSION_PREFIX)).toBe(true);
    });
    it('(g) does NOT flag a 13-digit string that FAILS Mod-11 under an arbitrary key', () => {
        expect(hasPlaintextPii({ auditMeta: { witnessId: BAD_13_DIGIT } }, VERSION_PREFIX)).toBe(false);
    });
    it('(g) does NOT flag a numeric ms-timestamp leaf', () => {
        expect(hasPlaintextPii({ workflowHistory: [{ at: 1719600000000 }] }, VERSION_PREFIX)).toBe(false);
    });
    it('(d) handles null / scalar formData', () => {
        expect(hasPlaintextPii(null, VERSION_PREFIX)).toBe(false);
        expect(hasPlaintextPii('x', VERSION_PREFIX)).toBe(false);
        expect(hasPlaintextPii(undefined, VERSION_PREFIX)).toBe(false);
    });
});
