/**
 * Ministry of Public Health — DTAM contact constants.
 *
 * Single source of truth for footer/header contact details rendered on
 * invoices, receipts, tax invoices, quotations, and the React document
 * layout. Replaces hardcoded duplicate-email lines like
 *   "อีเมล contact@gacpth.com | อีเมล contact@gacpth.com"
 * which appeared on every issued tax document (P0-8 in the
 * 2026-04-28 system cohesion audit).
 *
 * Phone confirmed 2026-04-28 by reading the footer of the official
 * DTAM site (https://dtam.moph.go.th). Source: the `tel:` link on
 * the homepage. If DTAM relocates or changes the switchboard, update
 * here — every printed tax document will pick it up on next render.
 */

const MINISTRY_CONTACT = Object.freeze({
    // Official DTAM switchboard, verified against dtam.moph.go.th footer
    phone: '0-2591-7007',
    email: 'contact@gacpth.com',
    ministry: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
    ministryEn: 'Department of Thai Traditional and Alternative Medicine, Ministry of Public Health',
    address: '88/23 หมู่ 4 ตำบลตลาดขวัญ อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000',
    website: 'https://dtam.moph.go.th',
});

/**
 * One-line contact string for tax document footers.
 * Format: "โทร: <phone> | อีเมล: <email>"
 */
const MINISTRY_CONTACT_LINE = `โทร: ${MINISTRY_CONTACT.phone} | อีเมล: ${MINISTRY_CONTACT.email}`;

module.exports = {
    MINISTRY_CONTACT,
    MINISTRY_CONTACT_LINE,
};
