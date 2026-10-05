/**
 * PromptPay QR payload generator.
 *
 * Implements the Bank of Thailand "Thai QR Payment" standard (an EMVCo
 * Merchant-Presented Mode QR Code Specification profile). The output is the
 * raw payload string — feed it to `qrcode` (or any EMVCo-compatible renderer)
 * to produce a scannable image.
 *
 * Supports both PromptPay target ID formats:
 *   - 13-digit citizen ID (national ID number)
 *   - 10-digit mobile number (will be normalised to E.164 +66xxxxxxxxx)
 *
 * Reference layout (TLV fields):
 *   00 — Payload Format Indicator                ("01")
 *   01 — Point of Initiation Method               ("11" static / "12" dynamic)
 *   29 — Merchant Account Info (PromptPay)
 *     00 — AID                                    ("A000000677010111")
 *     01 — Mobile (00669xxxxxxxx) OR
 *     02 — Citizen ID (13 digits)
 *   53 — Transaction Currency                    ("764" = THB ISO 4217)
 *   54 — Transaction Amount                       (e.g. "1234.56", omitted if no amount)
 *   58 — Country Code                             ("TH")
 *   63 — CRC                                      (CRC-16/CCITT-FALSE of everything preceding, incl. "6304")
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

function tlv(id: string, value: string): string {
    const length = value.length.toString().padStart(2, '0');
    return `${id}${length}${value}`;
}

/**
 * CRC-16/CCITT-FALSE (poly=0x1021, init=0xFFFF, no reflection, no XOR-out).
 * Returns 4-character upper-case hex.
 */
function crc16(payload: string): string {
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

/**
 * Normalise the PromptPay target identifier.
 * - 13-digit numeric → citizen ID, used as-is.
 * - 10-digit numeric → mobile, prefixed with "0066" and stripped of leading 0.
 *   Per BOT spec the mobile sub-field is 13 chars: 0066 + 9-digit national mobile.
 * Returns `{ subfieldId, value }` or null if the input is not a recognised format.
 */
function normaliseTarget(target: string): { subfieldId: string; value: string } | null {
    const digits = target.replace(/\D/g, '');
    if (digits.length === 13) {
        return { subfieldId: SUBFIELD_CITIZEN_ID, value: digits };
    }
    if (digits.length === 10) {
        // Strip leading 0 (Thai national format) and prepend country code.
        const national = digits.startsWith('0') ? digits.slice(1) : digits;
        return { subfieldId: SUBFIELD_MOBILE, value: `0066${national}` };
    }
    return null;
}

export interface PromptPayPayloadInput {
    /** Citizen ID (13 digits) or mobile number (10 digits, with or without dashes). */
    target: string;
    /** Amount in THB. Omit (or pass 0) for a static "any amount" QR. */
    amountTHB?: number | null;
}

/**
 * Build the raw PromptPay QR payload. Returns null if the target ID is invalid.
 */
export function buildPromptPayPayload({ target, amountTHB }: PromptPayPayloadInput): string | null {
    const normalised = normaliseTarget(target);
    if (!normalised) return null;

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
        payload += tlv(FIELD_TRANSACTION_AMOUNT, amountTHB!.toFixed(2));
    }

    payload += tlv(FIELD_COUNTRY_CODE, COUNTRY_TH);

    // CRC is computed over the payload PLUS the CRC field's id+length ("6304").
    const checksum = crc16(`${payload}${FIELD_CRC}04`);
    return `${payload}${FIELD_CRC}04${checksum}`;
}
