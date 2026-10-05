/**
 * formatTHB — X4-FIX-B H-5
 *
 * Canonical Thai Baht formatter for the entire web-app. Replaces the
 * THREE divergent formatters identified by the X4-B audit:
 *
 *   1. `accounting-service.ts` `formatTHB(amount, withSymbol)` —
 *      `"1,234.56 ฿"` suffix, 2 decimal places, the most common shape
 *      across the finance-chrome culture (9 files).
 *   2. `accounting/page.tsx` `new Intl.NumberFormat('th-TH', { style:
 *      'currency', currency: 'THB' }).format(amt)` — `"฿1,234"`
 *      prefix, 0 decimal places, the Intl default for `th-TH`.
 *   3. `receipts/page.tsx` `invoice.totalAmount.toLocaleString() + ' ฿'`
 *      — `"1,234 ฿"` suffix, no fixed decimal precision.
 *
 * After X4 the canonical signature is:
 *
 *     formatTHB(amount, { decimals?: 0 | 2, prefix?: boolean })
 *
 * Defaults match the existing receipt convention (`2dp + suffix ฿`)
 * because that is the format printed on physical Thai government
 * receipts (Office of Government Procurement style). For dashboards
 * that prefer a tighter "฿1,234,567" prefix-0dp shape we expose
 * `formatTHBShort` as a shortcut.
 *
 * X4-FIX-C will migrate the divergent callers; this file lands first
 * so the migration target is unambiguous.
 *
 * Inputs accepted:
 *   - `number` (incl. `NaN` and `Infinity` — both treated as 0)
 *   - `string` (numeric — parsed via `Number(str)`; if it cannot be
 *     coerced, defaults to 0 to mirror the existing accounting-service
 *     `Number.isFinite` guard at line 493)
 *   - `null | undefined` (treated as 0 — defensive against partial
 *     server payloads)
 *
 * Output: a plain `string` ready to slot into `<td>` / `<dd>` / `<p>`.
 * The locale is fixed to `th-TH` so the grouping is `1,234,567.89`
 * (Thai uses Western-style thousand separators per Royal Institute,
 * not Lao-style 1.234.567).
 */

export type FormatTHBOptions = {
    /** 0 or 2 decimal places. Default: 2. */
    decimals?: 0 | 2;
    /**
     * `true`  → "฿1,234.56" (prefix — government receipt convention)
     * `false` → "1,234.56 ฿" (suffix — finance-chrome / dashboard
     *           default). Default: `false`.
     */
    prefix?: boolean;
};

const DEFAULT_OPTIONS: Required<FormatTHBOptions> = {
    decimals: 2,
    prefix: false,
};

function coerce(amount: number | string | null | undefined): number {
    if (amount === null || amount === undefined) return 0;
    const n = typeof amount === 'number' ? amount : Number(amount);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Format a baht value as a localized Thai-baht string.
 *
 * Examples (2dp + suffix — default):
 *   formatTHB(0)           → "0.00 ฿"
 *   formatTHB(0.5)         → "0.50 ฿"
 *   formatTHB(1000)        → "1,000.00 ฿"
 *   formatTHB(12345.678)   → "12,345.68 ฿"   (banker's rounding via Intl)
 *
 * Examples (0dp + prefix):
 *   formatTHB(12345.67, { decimals: 0, prefix: true })
 *                          → "฿12,346"
 */
export function formatTHB(
    amount: number | string | null | undefined,
    options?: FormatTHBOptions,
): string {
    const { decimals, prefix } = { ...DEFAULT_OPTIONS, ...options };
    const value = coerce(amount);

    // Use Intl.NumberFormat for the body (grouping + decimals).
    // We don't use `style: 'currency'` here because the th-TH currency
    // format places the symbol BEFORE the number (`฿1,234`) and we
    // want explicit control over symbol position via `prefix`.
    const body = new Intl.NumberFormat('th-TH', {
        style: 'decimal',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(value);

    return prefix ? `฿${body}` : `${body} ฿`;
}

/**
 * Short-form variant: 0 decimal places, prefix `฿`. Used by dashboards
 * that want a tighter readout (e.g. KPI tiles where 2dp is noise).
 *
 *   formatTHBShort(12345.67) → "฿12,346"
 */
export function formatTHBShort(
    amount: number | string | null | undefined,
): string {
    return formatTHB(amount, { decimals: 0, prefix: true });
}

export default formatTHB;
