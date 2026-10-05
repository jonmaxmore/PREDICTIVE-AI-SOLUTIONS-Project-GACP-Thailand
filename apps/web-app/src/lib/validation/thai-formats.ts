/**
 * Thai-format input validators (frontend)
 *
 * The national-ID check digit is NOT re-implemented here. It is imported from
 * `@gacp/validation/thai-id-checksum`, the single implementation the backend
 * uses as well (F-G4-10).
 *
 * This file used to carry its own copy, justified by "pulling backend modules
 * into client code would drag prisma + node-only deps into the browser bundle"
 * — and by a mirror of `apps/backend/shared/utilities.js`, a file that no longer
 * exists. Neither holds now: the checksum module is a dependency-free leaf in the
 * shared workspace package, already bundled for the browser via
 * `next.config.ts` transpilePackages, exactly as `upload-rules` is.
 *
 * Module is `'use client'`-safe (no Node APIs).
 */

import { isThaiIdChecksumValid } from '@gacp/validation/thai-id-checksum';

// ─── Phone (Thai mobile) ─────────────────────────────────────────────────────

/**
 * Strip every non-digit character. Helpful before length / regex checks since
 * users frequently type "08-1234-5678", "081 234 5678", or "+66 81 234 5678".
 */
export function stripPhoneFormatting(input: string): string {
  return String(input || '').replace(/[^0-9]/g, '');
}

/**
 * Validate a Thai mobile number. Mirrors backend logic: must reduce to a 10-digit
 * string starting with 06 / 08 / 09. Returns true/false; never throws.
 *
 * NOTE: this does NOT validate landlines (02-, 03-, 04-, 05-, 07-) because
 * the GACP applicant flow only collects mobile numbers (for OTP/SMS notifications).
 */
export function isValidThaiPhone(input: string): boolean {
  if (!input) {return false;}
  const cleaned = stripPhoneFormatting(input);
  return /^(06|08|09)\d{8}$/.test(cleaned);
}

/**
 * Pretty-print a Thai mobile number as `0XX-XXX-XXXX`. Returns the input
 * unchanged if it's not a valid 10-digit number, so this is safe to call
 * during onChange (don't reformat partial input the user is still typing).
 */
export function formatThaiPhone(input: string): string {
  const cleaned = stripPhoneFormatting(input);
  if (cleaned.length !== 10) {return input;}
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
}

// ─── National ID (เลขบัตรประชาชน 13 หลัก) ─────────────────────────────────

/**
 * Validate Thai national ID (13 digits + the national check digit).
 *
 * Accepts strings with or without dash separators (e.g. `1-2345-67890-12-3`);
 * strips non-digits first, then defers to the shared rule.
 */
export function isValidThaiNationalId(input: string): boolean {
  if (!input) {return false;}
  const cleaned = String(input).replace(/[^0-9]/g, '');
  return isThaiIdChecksumValid(cleaned);
}

/**
 * Pretty-print as `X-XXXX-XXXXX-XX-X` (the canonical Thai government format).
 * Returns the input unchanged if not exactly 13 digits — safe for onChange.
 */
export function formatThaiNationalId(input: string): string {
  const cleaned = String(input || '').replace(/[^0-9]/g, '');
  if (cleaned.length !== 13) {return input;}
  return `${cleaned[0]}-${cleaned.slice(1, 5)}-${cleaned.slice(5, 10)}-${cleaned.slice(10, 12)}-${cleaned[12]}`;
}

// ─── Email ──────────────────────────────────────────────────────────────────

/**
 * Lightweight email format check. Not RFC-perfect (no spec is) but rejects
 * the common typos: missing @, leading/trailing dot, double dots, no TLD.
 * Server-side does the authoritative check via DNS / verification email.
 */
export function isValidEmail(input: string): boolean {
  if (!input) {return false;}
  const trimmed = String(input).trim();
  if (trimmed.length < 3 || trimmed.length > 254) {return false;}
  // Disallow consecutive dots, leading/trailing dot, missing local or domain part.
  if (/\.\./.test(trimmed)) {return false;}
  if (/^\.|\.$|@\.|\.@/.test(trimmed)) {return false;}
  // Standard practical pattern: local-part @ domain . tld(2+)
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmed);
}

// ─── Re-exports for convenience ─────────────────────────────────────────────

export const ThaiFormats = {
  isValidThaiPhone,
  formatThaiPhone,
  stripPhoneFormatting,
  isValidThaiNationalId,
  formatThaiNationalId,
  isValidEmail,
} as const;

export default ThaiFormats;
