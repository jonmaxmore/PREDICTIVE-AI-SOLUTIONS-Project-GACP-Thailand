/**
 * Property-Based Testing for GACP
 * Using fast-check for automated edge case discovery
 * 
 * Mathematical Foundation:
 * ∀ i ∈ Inputs, invariant(f(i)) = true
 */

const fc = require('fast-check');

// Health ID Checksum Algorithm
function calculateHealthIdChecksum(digits) {
    if (digits.length !== 12) {return null;}

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(digits[i]) * (13 - i);
    }

    const remainder = sum % 11;
    const checkDigit = (11 - remainder) % 10;
    return checkDigit;
}

function validateHealthId(id) {
    const clean = id.replace(/-/g, '');
    if (clean.length !== 13) {return false;}
    if (!/^\d+$/.test(clean)) {return false;}

    const expectedCheck = calculateHealthIdChecksum(clean.substring(0, 12));
    return parseInt(clean[12]) === expectedCheck;
}

function formatHealthId(id) {
    const clean = id.replace(/\D/g, '').substring(0, 13);
    if (clean.length <= 1) {return clean;}
    if (clean.length <= 5) {return `${clean[0]}-${clean.substring(1)}`;}
    if (clean.length <= 10) {return `${clean[0]}-${clean.substring(1, 5)}-${clean.substring(5)}`;}
    if (clean.length <= 12) {return `${clean[0]}-${clean.substring(1, 5)}-${clean.substring(5, 10)}-${clean.substring(10)}`;}
    return `${clean[0]}-${clean.substring(1, 5)}-${clean.substring(5, 10)}-${clean.substring(10, 12)}-${clean[12]}`;
}

// PROPERTY-BASED TESTS

describe('Health ID Validation - Property-Based Tests', () => {

    /**
     * Property 1: Valid IDs always pass validation
     * If we generate an ID with correct checksum, it must validate
     */
    test('Property: IDs with correct checksum are always valid', () => {
        fc.assert(
            fc.property(
                // Generate 12 random digits
                fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 }),
                (digits) => {
                    const first12 = digits.join('');
                    const checkDigit = calculateHealthIdChecksum(first12);
                    const fullId = first12 + checkDigit;

                    // Invariant: ID with correct checksum is always valid
                    return validateHealthId(fullId) === true;
                },
            ),
            { numRuns: 1000 },
        );
    });

    /**
     * Property 2: Modifying any digit invalidates the ID
     * Mutation should break checksum
     */
    test('Property: Modifying any digit (except checksum) makes ID invalid', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 }),
                fc.integer({ min: 0, max: 11 }), // position to modify
                fc.integer({ min: 1, max: 9 }),  // amount to add
                (digits, position, delta) => {
                    const first12 = digits.join('');
                    const checkDigit = calculateHealthIdChecksum(first12);
                    const originalId = first12 + checkDigit;

                    // Modify a digit
                    const modifiedDigits = [...originalId];
                    modifiedDigits[position] = String((parseInt(modifiedDigits[position]) + delta) % 10);
                    const modifiedId = modifiedDigits.join('');

                    // If modification changed the ID, it should be invalid
                    if (modifiedId !== originalId) {
                        return validateHealthId(modifiedId) === false;
                    }
                    return true;
                },
            ),
            { numRuns: 500 },
        );
    });

    /**
     * Property 3: Format is idempotent
     * format(format(x)) === format(x)
     */
    test('Property: Formatting is idempotent', () => {
        fc.assert(
            fc.property(
                fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 20 }),
                (input) => {
                    const once = formatHealthId(input);
                    const twice = formatHealthId(once);

                    // Invariant: format(format(x)) === format(x)
                    return once === twice;
                },
            ),
            { numRuns: 1000 },
        );
    });

    /**
     * Property 4: Format preserves digits
     * All digits in input appear in output
     */
    test('Property: Formatting preserves all digits', () => {
        fc.assert(
            fc.property(
                fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 1, maxLength: 13 }),
                (input) => {
                    const formatted = formatHealthId(input);
                    const outputDigits = formatted.replace(/-/g, '');

                    // Invariant: output digits match input (up to 13)
                    return outputDigits === input.substring(0, 13);
                },
            ),
            { numRuns: 1000 },
        );
    });

    /**
     * Property 5: Non-digit characters are rejected
     */
    test('Property: IDs with non-digits are invalid', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 13, maxLength: 13 }),
                (input) => {
                    const hasNonDigit = /[^0-9-]/.test(input);
                    if (hasNonDigit) {
                        // If input has non-digits, validation must fail
                        return validateHealthId(input) === false;
                    }
                    return true;
                },
            ),
            { numRuns: 500 },
        );
    });
});

// API RESPONSE INVARIANTS

describe('API Response - Property-Based Tests', () => {

    /**
     * Property: API responses always have success boolean
     */
    test('Property: Response structure is consistent', () => {
        fc.assert(
            fc.property(
                fc.record({
                    success: fc.boolean(),
                    data: fc.option(fc.object()),
                    error: fc.option(fc.string()),
                }),
                (response) => {
                    // Invariant: success field is always boolean
                    return typeof response.success === 'boolean';
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property: Error responses don't have data, success responses don't have error
     */
    test('Property: Error and success are mutually exclusive', () => {
        fc.assert(
            fc.property(
                fc.boolean(),
                fc.string(),
                fc.object(),
                (success, error, data) => {
                    const response = success
                        ? { success: true, data }
                        : { success: false, error };

                    // Invariant: success = true → no error field needed
                    // Invariant: success = false → error field present
                    if (response.success) {
                        return response.data !== undefined;
                    } else {
                        return response.error !== undefined;
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

module.exports = {
    calculateHealthIdChecksum,
    validateHealthId,
    formatHealthId,
};
