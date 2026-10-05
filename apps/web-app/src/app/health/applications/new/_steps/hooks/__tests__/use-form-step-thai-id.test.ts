/**
 * F-G4-10 — step 4 of the wizard judges a national ID by the real check digit.
 *
 * Before this fix `validateIdentifier13` was `/^\d{13}$/` and nothing else, so a
 * farmer could type an invented number into the application that becomes the
 * certificate, while the SAME number would have been refused at sign-up.
 *
 * The valid anchors here are real published Thai 13-digit numbers (the tax IDs
 * this platform prints on the receipts it issues). Every invalid number is
 * DERIVED from one of them by a single mutation, never invented by pattern.
 */

import {
    createFieldErrorCollector,
    validateThaiIdChecksum,
} from '../use-form-step';
import { isThaiIdChecksumValid, thaiIdCheckDigit } from '@gacp/validation/thai-id-checksum';

/** DTAM's own tax ID — printed on every government revenue receipt this platform issues. */
const VALID_ID = '0994000036540';
/** The platform company's tax ID — printed on every full tax invoice. */
const VALID_ID_2 = '0105568045932';

const WRONG_CHECK_DIGIT = VALID_ID.slice(0, 12) + String((Number(VALID_ID[12]) + 1) % 10);

const TRANSPOSED = (() => {
    for (let i = 0; i < 11; i += 1) {
        if (VALID_ID[i] === VALID_ID[i + 1]) continue;
        const chars = VALID_ID.split('');
        [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
        return chars.join('');
    }
    throw new Error('no transposable adjacent pair in the anchor ID');
})();

beforeAll(() => {
    // If a later edit made these "invalid" numbers valid, the suite would prove
    // nothing while still going green. Assert the fixtures first.
    expect(isThaiIdChecksumValid(VALID_ID)).toBe(true);
    expect(isThaiIdChecksumValid(VALID_ID_2)).toBe(true);
    expect(isThaiIdChecksumValid(WRONG_CHECK_DIGIT)).toBe(false);
    expect(isThaiIdChecksumValid(TRANSPOSED)).toBe(false);
});

function validate(value: unknown, label?: string) {
    const errors: Record<string, string> = {};
    validateThaiIdChecksum(errors, 'idCard', value, label);
    return errors;
}

describe('step 4 — national ID validation', () => {
    it('accepts real published numbers', () => {
        expect(validate(VALID_ID)).toEqual({});
        expect(validate(VALID_ID_2)).toEqual({});
    });

    it('accepts the dashed form printed on the card', () => {
        const v = VALID_ID;
        expect(validate(`${v[0]}-${v.slice(1, 5)}-${v.slice(5, 10)}-${v.slice(10, 12)}-${v[12]}`)).toEqual({});
    });

    it('REJECTS a wrong check digit — the case F-G4-10 is about', () => {
        expect(validate(WRONG_CHECK_DIGIT)).toHaveProperty('idCard');
    });

    it('REJECTS a single transposed pair', () => {
        expect(validate(TRANSPOSED)).toHaveProperty('idCard');
    });

    it('REJECTS every adjacent transposition of a real published number', () => {
        for (let i = 0; i < 11; i += 1) {
            if (VALID_ID_2[i] === VALID_ID_2[i + 1]) continue;
            const chars = VALID_ID_2.split('');
            [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
            const mutated = chars.join('');
            expect({ i, mutated, rejected: 'idCard' in validate(mutated) })
                .toEqual({ i, mutated, rejected: true });
        }
    });

    it('REJECTS the wrong length', () => {
        expect(validate(VALID_ID.slice(0, 12))).toHaveProperty('idCard');
        expect(validate(`${VALID_ID}0`)).toHaveProperty('idCard');
    });

    it('REJECTS 13 non-digits rather than accepting them as "13 characters"', () => {
        expect(validate('abcdefghijklm')).toHaveProperty('idCard');
    });

    it('stays silent on an empty value — that is `require`\'s job', () => {
        expect(validate('')).toEqual({});
        expect(validate(null)).toEqual({});
        expect(validate(undefined)).toEqual({});
        expect(validate('   ')).toEqual({});
    });

    it('accepts any prefix once its derived check digit is appended', () => {
        const prefix = '110010000100';
        expect(validate(prefix + String(thaiIdCheckDigit(prefix)))).toEqual({});
        expect(validate(prefix + String((thaiIdCheckDigit(prefix) + 1) % 10))).toHaveProperty('idCard');
    });
});

describe('the message the farmer reads', () => {
    it('names the cause and the next action', () => {
        const message = validate(WRONG_CHECK_DIGIT).idCard;
        expect(message).toContain('เลขบัตรประชาชน');
        expect(message).toContain('หลักสุดท้าย');  // cause
        expect(message).toContain('คุณสามารถ');    // next action
    });

    it('uses no em dash, per the Thai copy rules', () => {
        expect(validate(WRONG_CHECK_DIGIT).idCard).not.toContain('—');
        expect(validate(VALID_ID.slice(0, 12)).idCard).not.toContain('—');
    });

    it('quotes the label the form used, so a company is not told about a citizen card', () => {
        const message = validate(WRONG_CHECK_DIGIT, 'เลขประจำตัวผู้เสียภาษี').idCard;
        expect(message).toContain('เลขประจำตัวผู้เสียภาษี');
        expect(message).not.toContain('เลขบัตรประชาชน');
    });
});

describe('the step banner', () => {
    it('reports the WRONG VALUE, not "complete required fields"', () => {
        // A filled-in ID that fails its check digit is not a blank box. Telling
        // that farmer to "complete" the field sends them hunting for an empty one.
        const v = createFieldErrorCollector();
        v.require('firstName', 'สมชาย');
        v.healthId('idCard', WRONG_CHECK_DIGIT);
        const banner = v.apply();
        expect(banner).toContain('หลักสุดท้าย');
        expect(banner).not.toContain('Please complete');
    });

    it('still reports missing required fields when a box really is blank', () => {
        const v = createFieldErrorCollector();
        v.require('firstName', '');
        expect(v.apply()).toBe('Please complete highlighted required fields.');
    });

    it('returns null when everything is valid', () => {
        const v = createFieldErrorCollector();
        v.require('firstName', 'สมชาย');
        v.healthId('idCard', VALID_ID);
        expect(v.apply()).toBeNull();
    });

    it('two collectors do not leak value-errors into each other', () => {
        const bad = createFieldErrorCollector();
        bad.healthId('idCard', WRONG_CHECK_DIGIT);
        bad.apply();

        const fresh = createFieldErrorCollector();
        fresh.require('firstName', '');
        expect(fresh.apply()).toBe('Please complete highlighted required fields.');
    });
});
