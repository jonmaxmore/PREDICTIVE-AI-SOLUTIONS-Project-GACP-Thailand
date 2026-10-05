/**
 * Thai Formatting Utilities
 *
 * Shared across PDF template services and routes.
 * Single source of truth for Thai date, currency, and number formatting.
 *
 * @module utils/thai-format
 */

// The day a document is dated is its Bangkok day. The containers run on UTC,
// so reading getDate()/getMonth()/getFullYear() printed the day before on
// everything issued between 00:00 and 06:59 in Bangkok (CODE-01, audit
// 2026-09-17). The calendar parts come from the working-days zone helper.
const { getZonedParts } = require('./working-days');

const THAI_MONTHS_SHORT = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const THAI_MONTHS_FULL = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * Format a date as compact Thai date string.
 * Example: "5 ธ.ค. 2568"
 */
function formatThaiDate(date) {
    if (!date) { return '-'; }
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) { return '-'; }
    const { year, month, day } = getZonedParts(d);
    return `${day} ${THAI_MONTHS_SHORT[month - 1]} ${year + 543}`;
}

/**
 * Format a date as full Thai date string.
 * Example: "5 ธันวาคม 2568"
 */
function formatThaiDateFull(date) {
    if (!date) { return '-'; }
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) { return '-'; }
    const { year, month, day } = getZonedParts(d);
    return `${day} ${THAI_MONTHS_FULL[month - 1]} ${year + 543}`;
}

/**
 * Format a number as Thai currency string (e.g. "5,000.00").
 */
function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
}

module.exports = {
    THAI_MONTHS_SHORT,
    THAI_MONTHS_FULL,
    formatThaiDate,
    formatThaiDateFull,
    formatCurrency,
};
