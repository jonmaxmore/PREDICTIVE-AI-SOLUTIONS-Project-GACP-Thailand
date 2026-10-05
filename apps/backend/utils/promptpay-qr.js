'use strict';

/**
 * PromptPay QR payload generator (server-side).
 *
 * Mirrors apps/web-app/src/lib/utils/promptpay-qr.ts so any backend surface
 * that needs to embed a scannable PromptPay QR (PDF receipts, invoice
 * documents, email body images) produces the exact same payload as the
 * frontend QR card.
 *
 * Spec: Bank of Thailand "Thai QR Payment" — an EMVCo Merchant-Presented Mode
 * QR Code Specification profile.
 *
 * @typedef {Object} PromptPayPayloadInput
 * @property {string} target — 13-digit citizen ID OR 10-digit Thai mobile.
 * @property {number} [amountTHB] — Amount in THB. Omit/0 for a static QR.
 */

const FIELD_PAYLOAD_FORMAT = '00';
const FIELD_POI_METHOD = '01';
const FIELD_MERCHANT_ACCOUNT_PROMPTPAY = '29';
const FIELD_TRANSACTION_CURRENCY = '53';
const FIELD_TRANSACTION_AMOUNT = '54';
const FIELD_COUNTRY_CODE = '58';
const FIELD_CRC = '63';

const PROMPTPAY_AID = 'A000000677010111';
const SUBFIELD_AID = '00';
const SUBFIELD_MOBILE = '01';
const SUBFIELD_CITIZEN_ID = '02';

const POI_STATIC = '11';
const POI_DYNAMIC = '12';
const CURRENCY_THB = '764';
const COUNTRY_TH = 'TH';

function tlv(id, value) {
    const length = String(value.length).padStart(2, '0');
    return `${id}${length}${value}`;
}

function crc16(payload) {
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
        crc ^= payload.charCodeAt(i) << 8;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

function normaliseTarget(target) {
    if (typeof target !== 'string') {return null;}
    const digits = target.replace(/\D/g, '');
    if (digits.length === 13) {
        return { subfieldId: SUBFIELD_CITIZEN_ID, value: digits };
    }
    if (digits.length === 10) {
        const national = digits.startsWith('0') ? digits.slice(1) : digits;
        return { subfieldId: SUBFIELD_MOBILE, value: `0066${national}` };
    }
    return null;
}

/**
 * Build the raw PromptPay QR payload. Returns null for unrecognised target IDs.
 * @param {PromptPayPayloadInput} input
 * @returns {string|null}
 */
function buildPromptPayPayload({ target, amountTHB } = {}) {
    const normalised = normaliseTarget(target);
    if (!normalised) {return null;}

    const hasAmount = typeof amountTHB === 'number' && Number.isFinite(amountTHB) && amountTHB > 0;

    const merchantInfo =
        tlv(SUBFIELD_AID, PROMPTPAY_AID) +
        tlv(normalised.subfieldId, normalised.value);

    let payload =
        tlv(FIELD_PAYLOAD_FORMAT, '01') +
        tlv(FIELD_POI_METHOD, hasAmount ? POI_DYNAMIC : POI_STATIC) +
        tlv(FIELD_MERCHANT_ACCOUNT_PROMPTPAY, merchantInfo) +
        tlv(FIELD_TRANSACTION_CURRENCY, CURRENCY_THB);

    if (hasAmount) {
        payload += tlv(FIELD_TRANSACTION_AMOUNT, amountTHB.toFixed(2));
    }

    payload += tlv(FIELD_COUNTRY_CODE, COUNTRY_TH);

    const checksum = crc16(`${payload}${FIELD_CRC}04`);
    return `${payload}${FIELD_CRC}04${checksum}`;
}

module.exports = {
    buildPromptPayPayload,
};
