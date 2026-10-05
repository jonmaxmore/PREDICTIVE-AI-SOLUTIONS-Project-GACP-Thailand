/**
 * F-G4-10 — the SERVER refuses an invented national ID on the submit path.
 *
 * The wizard's browser-side check is a courtesy that answers instantly. This is
 * the door that decides what reaches a certificate, and it is reachable without
 * the browser at all: `curl` a canonical formData at POST /applications/submit
 * and the wizard's opinion never runs. Before this fix the canonical step-4
 * schema said `requiredString('เลขบัตรประชาชน').min(13)` — a string-LENGTH floor,
 * so a made-up 13-digit number, a 20-digit number, and 13 letters all passed.
 *
 * The valid IDs below are REAL published Thai 13-digit numbers, never invented —
 * that matters because a fixture built with the same function under test would
 * stay "valid" even if that function broke. The invalid ones are DERIVED from
 * the valid ones by a single transposition or a single changed check digit.
 */

'use strict';

const {
    validateCanonicalSubmission,
    normalizeCanonicalToSteps,
    CANONICAL_STEP_SCHEMAS,
} = require('../../validation/canonical-application-validator');
const { thaiIdCheckDigit, isThaiIdChecksumValid } = require('@gacp/validation/thai-id-checksum');
const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');

/**
 * A real published, checksum-valid Thai 13-digit number — เลขประจำตัวผู้เสียภาษี
 * ของกรมการแพทย์แผนไทยฯ, kept here as a **test vector**, not as a value the
 * system uses. It used to be read from `DTAM_ISSUER` in config/invoice-issuers.js,
 * which was removed 2026-09-11 when the operator ruled there is one issuer.
 *
 * It stays because the property this test needs is a property of the NUMBER —
 * a real published check digit, so a broken checksum implementation cannot make
 * the fixture agree with it — not of the role the ministry once had here. Same
 * reasoning, same number, as `thai-id-checksum.test.js`.
 */
const VALID_ID = '0994000036540';

/** Same number with its check digit bumped by one — the classic single-digit typo. */
const WRONG_CHECK_DIGIT = VALID_ID.slice(0, 12) + String((Number(VALID_ID[12]) + 1) % 10);

/** Same number with one adjacent pair transposed. */
const TRANSPOSED = (() => {
    for (let i = 0; i < 11; i += 1) {
        if (VALID_ID[i] === VALID_ID[i + 1]) {continue;}
        const chars = VALID_ID.split('');
        [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
        return chars.join('');
    }
    throw new Error('no transposable adjacent pair in the anchor ID');
})();

beforeAll(() => {
    // Guard the fixtures themselves, so a later edit cannot quietly turn these
    // "invalid" numbers into valid ones and make the suite prove nothing.
    expect(isThaiIdChecksumValid(VALID_ID)).toBe(true);
    expect(isThaiIdChecksumValid(WRONG_CHECK_DIGIT)).toBe(false);
    expect(isThaiIdChecksumValid(TRANSPOSED)).toBe(false);
    expect(TRANSPOSED).not.toBe(VALID_ID);
});

function step4(applicant) {
    return CANONICAL_STEP_SCHEMAS[4].safeParse(
        normalizeCanonicalToSteps({ applicantData: applicant })['4'],
    );
}

function messagesOf(result) {
    return result.success ? [] : result.error.issues.map((i) => i.message).join(' | ');
}

const individual = (idCard) => ({
    applicantType: 'INDIVIDUAL',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    idCard,
    phone: '0812345678',
    address: '1 หมู่ 1 ตำบลบางรัก',
});

describe('INDIVIDUAL — the national ID on the application', () => {
    it('accepts a checksum-valid number', () => {
        const result = step4(individual(VALID_ID));
        expect(messagesOf(result)).toEqual([]);
        expect(result.success).toBe(true);
    });

    it('REJECTS a number whose check digit is wrong', () => {
        const result = step4(individual(WRONG_CHECK_DIGIT));
        expect(result.success).toBe(false);
        expect(messagesOf(result)).toContain('หลักสุดท้าย');
    });

    it('REJECTS a single transposed pair', () => {
        const result = step4(individual(TRANSPOSED));
        expect(result.success).toBe(false);
    });

    it('REJECTS 13 letters — what `.min(13)` used to wave through', () => {
        expect(step4(individual('abcdefghijklm')).success).toBe(false);
    });

    it('REJECTS a 20-digit number — `.min(13)` is a floor, not a length', () => {
        expect(step4(individual('12345678901234567890')).success).toBe(false);
    });

    it('REJECTS 12 digits', () => {
        expect(step4(individual(VALID_ID.slice(0, 12))).success).toBe(false);
    });

    it('accepts the dashed form a farmer copies off the card', () => {
        const v = VALID_ID;
        const dashed = `${v[0]}-${v.slice(1, 5)}-${v.slice(5, 10)}-${v.slice(10, 12)}-${v[12]}`;
        expect(step4(individual(dashed)).success).toBe(true);
    });
});

describe('JURISTIC — the company number carries the same check digit', () => {
    const juristic = (extra) => ({
        applicantType: 'JURISTIC',
        companyName: 'บริษัท ทดสอบ จำกัด',
        registrationNumber: PLATFORM_ISSUER.registrationNo,
        directorName: 'สมหญิง ใจงาม',
        ...extra,
    });

    it('accepts a real published corporate tax ID', () => {
        expect(step4(juristic({ taxId: PLATFORM_ISSUER.taxId })).success).toBe(true);
    });

    it('REJECTS an invented tax ID', () => {
        const bad = PLATFORM_ISSUER.taxId.slice(0, 12)
            + String((Number(PLATFORM_ISSUER.taxId[12]) + 1) % 10);
        expect(isThaiIdChecksumValid(bad)).toBe(false);
        const result = step4(juristic({ taxId: bad }));
        expect(result.success).toBe(false);
        expect(messagesOf(result)).toContain('เลขประจำตัวผู้เสียภาษี');
    });

    it('REJECTS an invented director national ID', () => {
        expect(step4(juristic({ directorIdCard: WRONG_CHECK_DIGIT })).success).toBe(false);
    });

    it('still accepts a JURISTIC applicant that omits the optional IDs', () => {
        // These fields are not required by the wizard today. Closing the checksum
        // hole must not newly 422 drafts that were complete when they were saved.
        expect(step4(juristic({})).success).toBe(true);
    });
});

describe('COMMUNITY — the legitimate NON-checksum identifier', () => {
    const community = (extra) => ({
        applicantType: 'COMMUNITY',
        communityName: 'วิสาหกิจชุมชนบ้านทดสอบ',
        presidentName: 'สมศักดิ์ ดีงาม',
        communityRegNumber: '1-2-01/2569',
        ...extra,
    });

    it('does NOT run the national-ID checksum over the DOAE registration number', () => {
        // DOAE never published a check digit for the 11-digit วิสาหกิจชุมชน
        // registration number. Applying the citizen-ID rule to it would reject
        // every legitimate community enterprise in Thailand.
        expect(step4(community({})).success).toBe(true);
        expect(step4(community({ communityRegNumber: '99999999999' })).success).toBe(true);
    });

    it('DOES check the president\'s national ID when one is given', () => {
        expect(step4(community({ presidentIdCard: VALID_ID })).success).toBe(true);
        expect(step4(community({ presidentIdCard: WRONG_CHECK_DIGIT })).success).toBe(false);
    });
});

describe('whole-submission path', () => {
    const completeFormData = (idCard) => ({
        applicantData: individual(idCard),
        plantId: 'plant-1',
        cultivationMethods: ['OUTDOOR'],
        farmData: {
            farmName: 'ฟาร์มทดสอบ',
            address: '1 หมู่ 1',
            province: 'นนทบุรี',
            plots: [{ plotName: 'แปลง 1', areaSize: 100, areaUnit: 'Sqm' }],
        },
    });

    it('a bad ID makes the whole submission invalid and names step 4', () => {
        const result = validateCanonicalSubmission(
            completeFormData(WRONG_CHECK_DIGIT),
            [{ uploaded: true, url: 'https://example.test/doc.pdf' }],
        );
        expect(result.isValid).toBe(false);
        expect(result.missingFields.some((f) => f.startsWith('step4.id_card'))).toBe(true);
    });

    it('the same submission with a valid ID has no step-4 complaint', () => {
        const result = validateCanonicalSubmission(
            completeFormData(VALID_ID),
            [{ uploaded: true, url: 'https://example.test/doc.pdf' }],
        );
        expect(result.errorsByStep['4']).toBeUndefined();
    });
});

describe('the client and the server judge by the SAME rule', () => {
    it('agree on every derived mutation of a real published ID', () => {
        // The wizard hook imports checkThaiId from the same module this validator
        // requires, so "agreeing" here means literally one implementation. The
        // test asserts the outcome anyway: if someone re-forks the client copy,
        // this is the shape of the assertion that would catch a divergence.
        const cases = [VALID_ID, WRONG_CHECK_DIGIT, TRANSPOSED];
        for (const id of cases) {
            const serverAccepts = step4(individual(id)).success;
            const ruleSaysValid = isThaiIdChecksumValid(id);
            expect({ id, serverAccepts }).toEqual({ id, serverAccepts: ruleSaysValid });
        }
    });

    it('a derived check digit is what makes any prefix acceptable', () => {
        const prefix = '110010000100';
        const good = prefix + String(thaiIdCheckDigit(prefix));
        const bad = prefix + String((thaiIdCheckDigit(prefix) + 1) % 10);
        expect(step4(individual(good)).success).toBe(true);
        expect(step4(individual(bad)).success).toBe(false);
    });
});
