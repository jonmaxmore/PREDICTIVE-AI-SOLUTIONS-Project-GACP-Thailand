/**
 * How many years ONE certificate is valid for, read from its own dates.
 *
 * This page used to print "อายุใบรับรอง (3 ปี)" from a constant for every
 * certificate. Since operator 2026-09-11 (backend CERTIFICATE.VALIDITY_YEARS = 1,
 * services/certificate-service.js addLocalYears) a new certificate lasts 1 year,
 * while one issued before that date keeps the 3-year expiry the retired path
 * wrote. The generic copy (constants/service-facts.ts) states today's rule; a
 * page that shows one certificate states that certificate's span.
 *
 * Whole years, rounded, so a leap day or a Bangkok/UTC midnight edge cannot turn
 * 1 into 0.99. null when either date is missing or unreadable, or the span is
 * under half a year: the page then names no number rather than guess one.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365.2425;

export function certificateValidityYears(
    issuedDate: string | null | undefined,
    expiryDate: string | null | undefined,
): number | null {
    if (!issuedDate || !expiryDate) return null;
    const issued = Date.parse(issuedDate);
    const expiry = Date.parse(expiryDate);
    if (!Number.isFinite(issued) || !Number.isFinite(expiry)) return null;
    const years = Math.round((expiry - issued) / DAY_MS / YEAR_DAYS);
    return years >= 1 ? years : null;
}
