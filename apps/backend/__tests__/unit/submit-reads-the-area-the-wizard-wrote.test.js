/**
 * F-APPV2-01 — the submit gate asked for a field no screen writes.
 *
 * Measured on a real browser walk 2026-09-06: the six-step wizard stores ลักษณะพื้นที่ at
 * `formData.farmData.areaTypes` (กทล.๑ ส่วนที่ ๒ is a checkbox row) and never writes
 * `formData.cultivationMethods` — `setCultivationMethods` exists in the store and no step
 * calls it, with a comment at use-application-flow-store.ts saying the question moved to
 * step 3. The validator demanded `cultivation_methods`, so EVERY filing was refused at the
 * submit door with 422 APPLICATION_INCOMPLETE naming "รูปแบบการปลูก" — a field the
 * applicant could not find on any screen because it is not on one.
 *
 * That is the v1-hard-lock class again: a gate asking for what the screen never writes.
 *
 * The fix cannot be validator-only. `cultivation_methods` is also what the price is built
 * from, so accepting the ticks at the gate while the fee engine still looked elsewhere
 * would let a filing pass and then be billed for fewer types than it declared — worse than
 * a refusal. Both doors read the same declaration now, which is what the operator's
 * 2026-09-06 ruling requires ("ถ้าเลือก 3 รูปแบบการปลูก ราคาก็คือ 3 รูปแบบ").
 */
'use strict';

const {
    validateCanonicalSubmission,
} = require('../../validation/canonical-application-validator');
const {
    resolveCultivationScopes,
} = require('../../modules/billing/internal/fee-service');

/** Everything a filing needs to be judged, except the cultivation declaration. */
function filingWith(extra) {
    return {
        plantId: 'cannabis',
        serviceType: 'new_application',
        certificationPurposes: ['EXPORT'],
        applicantData: {
            applicantType: 'INDIVIDUAL',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            nationalId: '1234567890123',
        },
        ...extra,
    };
}

/**
 * Every field path the validator refused, across all steps.
 *
 * `validateCanonicalSubmission` returns a map of step number → issues, so a test that
 * looked at one step would miss a refusal raised on another — and the whole point here is
 * WHICH field is being demanded, not how many.
 */
function errorsFor(formData) {
    const byStep = validateCanonicalSubmission(formData) || {};
    return Object.values(byStep)
        .flat()
        .map((issue) => String((issue && (issue.path || issue.field)) || issue));
}

describe('the submit gate reads what step 3 actually wrote', () => {
    test("a filing that ticked ลักษณะพื้นที่ is no longer refused for 'รูปแบบการปลูก'", () => {
        const errors = errorsFor(filingWith({ farmData: { areaTypes: ['OUTDOOR', 'GREENHOUSE'] } }));
        expect(errors.join(' ')).not.toMatch(/cultivation_methods/);
    });

    test('a filing that ticked NOTHING anywhere is still refused — silence is not a declaration', () => {
        const errors = errorsFor(filingWith({ farmData: {} }));
        expect(errors.join(' ')).toMatch(/cultivation_methods/);
    });

    test('the legacy key still satisfies the gate on its own', () => {
        const errors = errorsFor(filingWith({ cultivationMethods: ['INDOOR'] }));
        expect(errors.join(' ')).not.toMatch(/cultivation_methods/);
    });
});

describe('the gate and the price read the SAME declaration', () => {
    // The failure this pins is not a refused filing — it is an ACCEPTED one billed for
    // fewer types than it declared, which no error message would ever announce.
    test.each([
        [['OUTDOOR', 'GREENHOUSE', 'INDOOR'], 3],
        [['OUTDOOR'], 1],
    ])('%j ticks → the gate passes and the price counts %i', (areaTypes, expected) => {
        const formData = filingWith({ farmData: { areaTypes } });

        expect(errorsFor(formData).join(' ')).not.toMatch(/cultivation_methods/);
        expect(resolveCultivationScopes({ formData })).toHaveLength(expected);
    });
});
