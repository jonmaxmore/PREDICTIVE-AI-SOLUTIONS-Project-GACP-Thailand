'use strict';

/**
 * Allocates the stored certificate number `TH-GACP {n}/{ปี พ.ศ.}`.
 *
 * `n` comes from the same ReceiptSequence series the finance documents use,
 * bucket (prefix 'TH-GACP', Buddhist year): one upsert-increment under a row lock,
 * so concurrent issuers never draw the same number and a year starts again at 1.
 * Handed the issuance transaction's client, the increment rolls back with a
 * failed issuance (no gap); a gap from any other abort is tolerated, never reused.
 *
 * The year is the Bangkok business year of the issue instant (shared/harvest-identifiers
 * thaiYear), the same instant the printed issue date reads.
 */

const { thaiYear } = require('../shared/harvest-identifiers');
const { allocateSequenceCounter } = require('./receipt-sequence-counter');
const { CERT_NUMBER_PREFIX, formatCertificateNumber } = require('./certificate-number-display');

/**
 * @param {object} args
 * @param {object} args.client       Prisma client or interactive transaction client
 * @param {Date}   [args.issuedDate] defaults to now
 * @returns {Promise<string>} e.g. 'TH-GACP 1/2569'
 */
async function allocateCertificateNumber({ client, issuedDate = new Date() }) {
    const year = thaiYear(issuedDate);
    const sequence = await allocateSequenceCounter(client, CERT_NUMBER_PREFIX, year);
    return formatCertificateNumber(sequence, year);
}

module.exports = { allocateCertificateNumber };
