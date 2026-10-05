'use strict';

/**
 * CSV / spreadsheet formula-injection neutralizer (CWE-1236, OWASP "CSV Injection").
 *
 * C5-04 (audit 2026-06-10): the finance/audit CSV exporters (daily-cash,
 * bank-reconciliation, trial-balance, ar-aging, vat-report, financial-export,
 * admin + provider audit-log) RFC-4180-quote their cells but do NOT neutralize
 * leading formula triggers. A cell whose first character is `=`, `+`, `-`, `@`,
 * TAB (\t) or CR (\r) is interpreted as a formula by Excel / Google Sheets /
 * LibreOffice — so attacker-controlled fields (applicant/farm names, notes,
 * reference numbers) can execute on the reviewer's machine when the export is
 * opened (data exfiltration, command exec via DDE).
 *
 * Defense: prefix such cells with a single quote so the spreadsheet renders them
 * as literal text. Call this BEFORE RFC-4180 quoting. Centralised here so the
 * dangerous-prefix set lives in exactly one auditable place.
 *
 * @param {string} str - the already-stringified cell value
 * @returns {string} the value, prefixed with `'` if it begins with a formula trigger
 */
function neutralizeCsvFormula(str) {
    if (typeof str !== 'string' || str.length === 0) {
        return str;
    }
    return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

module.exports = { neutralizeCsvFormula };
