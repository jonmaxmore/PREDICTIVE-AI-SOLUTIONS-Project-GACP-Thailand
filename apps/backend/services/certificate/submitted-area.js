const { storedAreaToSqm } = require('../../shared/area-utils');

/**
 * Square metres from a number a farmer typed into the wizard, plus whatever
 * unit that submission recorded.
 *
 * The wizard collects square metres now. Applications already in the queue
 * carry 'Rai' or 'Ngan', and they still mean what they meant — so this reads
 * the submitted unit rather than assuming.
 *
 * It refuses to guess. An area with no unit is ambiguous by a factor of 1,600,
 * and the number ends up on a certificate and in every capacity calculation
 * that reads the farm afterwards. Failing issuance is recoverable; a
 * certificate stating two and a half square kilometres for a 1,600 m² plot is
 * not.
 *
 * @param {number|string|null} value
 * @param {string|null} unit       the unit this submission recorded
 * @param {string} fieldName       where it came from, so the error is actionable
 * @returns {number} square metres
 */
function submittedAreaSqm(value, unit, fieldName) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        // Zero is zero in every unit. Refusing here would block issuance over
        // an optional field nobody filled in.
        return 0;
    }

    try {
        return storedAreaToSqm(amount, unit);
    } catch (error) {
        throw new Error(`${fieldName}: ${error.message}`);
    }
}

module.exports = { submittedAreaSqm };
