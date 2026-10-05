/**
 * Tests for document-numbering helper.
 *
 * System deep-dive Tier 13 — Backend + Compliance + QA (2026-05-15).
 *
 * Covers:
 *   1. Year helpers — getBuddhistYear, getChristianYear (defensive Date check)
 *   2. Format builders — DTAM/Platform-tax-invoice/Platform-receipt
 *      (sequence validation, padding, year range guards)
 *   3. resolveSchemeFromServiceType — state vs platform routing
 *   4. buildDocumentNumberForServiceType — convenience wrapper
 *   5. parseDocumentNumber + isCanonicalDocumentNumber — round-trip + legacy detection
 */

const path = require('path');

const {
    SCHEMES,
    DEFAULT_SEQUENCE_PADDING,
    getBuddhistYear,
    getChristianYear,
    buildDtamReceiptNumber,
    buildPlatformTaxInvoiceNumber,
    buildPlatformReceiptNumber,
    resolveSchemeFromServiceType,
    buildDocumentNumberForServiceType,
    parseDocumentNumber,
    isCanonicalDocumentNumber,
} = require(path.join(__dirname, '..', '..', 'services', 'document-numbering'));

describe('[Tier 13] document-numbering — SCHEMES + constants', () => {
    it('SCHEMES is frozen and has the three canonical streams', () => {
        expect(SCHEMES).toEqual({
            DTAM_RECEIPT: 'DTAM_RECEIPT',
            PLATFORM_TAX_INVOICE: 'PLATFORM_TAX_INVOICE',
            PLATFORM_RECEIPT: 'PLATFORM_RECEIPT',
        });
        expect(Object.isFrozen(SCHEMES)).toBe(true);
    });

    it('DEFAULT_SEQUENCE_PADDING is 6 per Tier 12 spec §5', () => {
        expect(DEFAULT_SEQUENCE_PADDING).toBe(6);
    });
});

describe('[Tier 13] year helpers', () => {
    it('getBuddhistYear adds 543 to calendar year', () => {
        expect(getBuddhistYear(new Date('2026-05-15T00:00:00Z'))).toBe(2569);
        expect(getBuddhistYear(new Date('2025-12-31T00:00:00Z'))).toBe(2568);
        expect(getBuddhistYear(new Date('2026-01-01T00:00:00Z'))).toBe(2569);
    });

    it('getChristianYear returns calendar year unchanged', () => {
        expect(getChristianYear(new Date('2026-05-15T00:00:00Z'))).toBe(2026);
        expect(getChristianYear(new Date('2025-12-31T00:00:00Z'))).toBe(2025);
    });

    it('both helpers throw on invalid Date input', () => {
        expect(() => getBuddhistYear(new Date('not-a-date'))).toThrow(TypeError);
        expect(() => getChristianYear(new Date('not-a-date'))).toThrow(TypeError);
        expect(() => getBuddhistYear('2026-05-15')).toThrow(TypeError);
        expect(() => getChristianYear(null)).toThrow(TypeError);
    });

    it('defaults to current date when no argument given', () => {
        const thisYearCE = new Date().getFullYear();
        expect(getChristianYear()).toBe(thisYearCE);
        expect(getBuddhistYear()).toBe(thisYearCE + 543);
    });
});

describe('[Tier 13] buildDtamReceiptNumber', () => {
    it('produces canonical RCP-DTAM-{พศ}-{seq6} format', () => {
        const num = buildDtamReceiptNumber({ year: 2569, sequence: 123 });
        expect(num).toBe('RCP-DTAM-2569-000123');
    });

    it('derives year from referenceDate when `year` not provided', () => {
        const num = buildDtamReceiptNumber({
            referenceDate: new Date('2026-05-15T00:00:00Z'),
            sequence: 1,
        });
        expect(num).toBe('RCP-DTAM-2569-000001');
    });

    it('pads sequence to 6 digits by default; extends beyond 6 when needed', () => {
        expect(buildDtamReceiptNumber({ year: 2569, sequence: 1 })).toBe('RCP-DTAM-2569-000001');
        expect(buildDtamReceiptNumber({ year: 2569, sequence: 999999 })).toBe('RCP-DTAM-2569-999999');
        expect(buildDtamReceiptNumber({ year: 2569, sequence: 1000000 })).toBe('RCP-DTAM-2569-1000000');
    });

    it('honors custom padding', () => {
        const num = buildDtamReceiptNumber({ year: 2569, sequence: 5, padding: 4 });
        expect(num).toBe('RCP-DTAM-2569-0005');
    });

    it('rejects non-integer / non-positive sequence', () => {
        expect(() => buildDtamReceiptNumber({ year: 2569, sequence: 0 })).toThrow(RangeError);
        expect(() => buildDtamReceiptNumber({ year: 2569, sequence: -1 })).toThrow(RangeError);
        expect(() => buildDtamReceiptNumber({ year: 2569, sequence: 1.5 })).toThrow(TypeError);
        expect(() => buildDtamReceiptNumber({ year: 2569, sequence: 'abc' })).toThrow(TypeError);
        expect(() => buildDtamReceiptNumber({ year: 2569 })).toThrow(); // missing sequence
    });

    it('rejects sequence overflow (>9,999,999) — stream needs reset', () => {
        expect(() => buildDtamReceiptNumber({ year: 2569, sequence: 10_000_000 })).toThrow(RangeError);
    });

    it('rejects year that is not a valid พ.ศ. (must be >= 2500)', () => {
        expect(() => buildDtamReceiptNumber({ year: 2026, sequence: 1 })).toThrow(RangeError);
        expect(() => buildDtamReceiptNumber({ year: 2499, sequence: 1 })).toThrow(RangeError);
        expect(() => buildDtamReceiptNumber({ year: 10000, sequence: 1 })).toThrow(RangeError);
    });
});

describe('[Tier 13] buildPlatformTaxInvoiceNumber', () => {
    it('produces canonical TAX-PRD-{ค.ศ.}-{seq6} format', () => {
        expect(buildPlatformTaxInvoiceNumber({ year: 2026, sequence: 123 }))
            .toBe('TAX-PRD-2026-000123');
    });

    it('uses ค.ศ. (not พ.ศ.) — confirms Revenue Department convention', () => {
        const num = buildPlatformTaxInvoiceNumber({
            referenceDate: new Date('2026-05-15T00:00:00Z'),
            sequence: 7,
        });
        expect(num).toBe('TAX-PRD-2026-000007');
        // Critically: the year IS 2026, NOT 2569 — sanity check against
        // mistakenly passing พ.ศ. into a Platform document.
        expect(num).not.toContain('2569');
    });

    it('rejects year outside valid ค.ศ. range', () => {
        expect(() => buildPlatformTaxInvoiceNumber({ year: 1899, sequence: 1 })).toThrow(RangeError);
        expect(() => buildPlatformTaxInvoiceNumber({ year: 10000, sequence: 1 })).toThrow(RangeError);
    });

    it('accepts large but valid sequences', () => {
        expect(buildPlatformTaxInvoiceNumber({ year: 2026, sequence: 999999 }))
            .toBe('TAX-PRD-2026-999999');
    });
});

describe('[Tier 13] buildPlatformReceiptNumber', () => {
    it('produces canonical RCP-PRD-{ค.ศ.}-{seq6} format', () => {
        expect(buildPlatformReceiptNumber({ year: 2026, sequence: 123 }))
            .toBe('RCP-PRD-2026-000123');
    });

    it('is a different stream from tax invoice — same year + same sequence produces different document numbers', () => {
        // Critical: tax invoice and receipt are SEPARATE numbering streams.
        // A customer's tax invoice TAX-PRD-2026-000123 and the receipt for
        // the same payment RCP-PRD-2026-000123 are formally distinct documents.
        const tax = buildPlatformTaxInvoiceNumber({ year: 2026, sequence: 123 });
        const receipt = buildPlatformReceiptNumber({ year: 2026, sequence: 123 });
        expect(tax).not.toEqual(receipt);
        expect(tax.startsWith('TAX-PRD')).toBe(true);
        expect(receipt.startsWith('RCP-PRD')).toBe(true);
    });
});

describe('[Tier 13] resolveSchemeFromServiceType', () => {
    it('STATE service types route to DTAM_RECEIPT', () => {
        expect(resolveSchemeFromServiceType('PHASE_1_STATE_FEE')).toBe(SCHEMES.DTAM_RECEIPT);
        expect(resolveSchemeFromServiceType('PHASE_2_STATE_FEE')).toBe(SCHEMES.DTAM_RECEIPT);
    });

    it('PLATFORM service types route to PLATFORM_TAX_INVOICE (primary scheme)', () => {
        expect(resolveSchemeFromServiceType('PHASE_1_PLATFORM_FEE')).toBe(SCHEMES.PLATFORM_TAX_INVOICE);
        expect(resolveSchemeFromServiceType('PHASE_2_PLATFORM_FEE')).toBe(SCHEMES.PLATFORM_TAX_INVOICE);
    });

    it('is case-insensitive', () => {
        expect(resolveSchemeFromServiceType('phase_1_state_fee')).toBe(SCHEMES.DTAM_RECEIPT);
        expect(resolveSchemeFromServiceType('Phase_1_Platform_Fee')).toBe(SCHEMES.PLATFORM_TAX_INVOICE);
    });

    it('throws TypeError on unknown serviceType', () => {
        expect(() => resolveSchemeFromServiceType('UNKNOWN')).toThrow(TypeError);
        expect(() => resolveSchemeFromServiceType('')).toThrow(TypeError);
        expect(() => resolveSchemeFromServiceType(null)).toThrow(TypeError);
        expect(() => resolveSchemeFromServiceType(undefined)).toThrow(TypeError);
    });
});

describe('[Tier 13] buildDocumentNumberForServiceType (convenience wrapper)', () => {
    it('STATE service type produces DTAM receipt number (พ.ศ.)', () => {
        const num = buildDocumentNumberForServiceType({
            serviceType: 'PHASE_1_STATE_FEE',
            sequence: 1,
            referenceDate: new Date('2026-05-15T00:00:00Z'),
        });
        expect(num).toBe('RCP-DTAM-2569-000001');
    });

    it('PLATFORM service type defaults to tax invoice (ค.ศ.)', () => {
        const num = buildDocumentNumberForServiceType({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            sequence: 1,
            referenceDate: new Date('2026-05-15T00:00:00Z'),
        });
        expect(num).toBe('TAX-PRD-2026-000001');
    });

    it('PLATFORM service type with asReceipt=true produces RCP-PRD-... instead of TAX-PRD-...', () => {
        const num = buildDocumentNumberForServiceType({
            serviceType: 'PHASE_1_PLATFORM_FEE',
            sequence: 1,
            referenceDate: new Date('2026-05-15T00:00:00Z'),
            asReceipt: true,
        });
        expect(num).toBe('RCP-PRD-2026-000001');
    });

    it('STATE + asReceipt=true is still DTAM receipt (asReceipt only affects PLATFORM)', () => {
        const num = buildDocumentNumberForServiceType({
            serviceType: 'PHASE_1_STATE_FEE',
            sequence: 1,
            referenceDate: new Date('2026-05-15T00:00:00Z'),
            asReceipt: true,
        });
        // DTAM only has one stream — asReceipt is a no-op for STATE
        expect(num).toBe('RCP-DTAM-2569-000001');
    });
});

describe('[Tier 13] parseDocumentNumber', () => {
    it('round-trips through builders for all three schemes', () => {
        const dtam = buildDtamReceiptNumber({ year: 2569, sequence: 42 });
        expect(parseDocumentNumber(dtam)).toEqual({
            scheme: SCHEMES.DTAM_RECEIPT,
            year: 2569,
            sequence: 42,
        });

        const taxInv = buildPlatformTaxInvoiceNumber({ year: 2026, sequence: 99 });
        expect(parseDocumentNumber(taxInv)).toEqual({
            scheme: SCHEMES.PLATFORM_TAX_INVOICE,
            year: 2026,
            sequence: 99,
        });

        const rcpPlat = buildPlatformReceiptNumber({ year: 2026, sequence: 7 });
        expect(parseDocumentNumber(rcpPlat)).toEqual({
            scheme: SCHEMES.PLATFORM_RECEIPT,
            year: 2026,
            sequence: 7,
        });
    });

    it('returns null on legacy / non-canonical numbers (so callers can detect)', () => {
        // Legacy format from application-phase-invoice-methods.js buildInvoiceNumber
        expect(parseDocumentNumber('INV-P1-ST-2569-ABC123-XX-YY')).toBeNull();
        expect(parseDocumentNumber('INVOICE-2024-001')).toBeNull();
        expect(parseDocumentNumber('')).toBeNull();
        expect(parseDocumentNumber(null)).toBeNull();
        expect(parseDocumentNumber(undefined)).toBeNull();
        expect(parseDocumentNumber('random-garbage')).toBeNull();
    });

    it('rejects malformed canonical-looking strings (defensive)', () => {
        // Wrong year length
        expect(parseDocumentNumber('RCP-DTAM-25-000001')).toBeNull();
        // Year too long
        expect(parseDocumentNumber('RCP-DTAM-25690-000001')).toBeNull();
        // Sequence too short
        expect(parseDocumentNumber('RCP-DTAM-2569-001')).toBeNull();
        // Wrong prefix
        expect(parseDocumentNumber('RCP-XXX-2569-000001')).toBeNull();
    });
});

describe('[Tier 13] isCanonicalDocumentNumber — legacy vs canonical detection', () => {
    it('returns true for canonical numbers from all three schemes', () => {
        expect(isCanonicalDocumentNumber('RCP-DTAM-2569-000001')).toBe(true);
        expect(isCanonicalDocumentNumber('TAX-PRD-2026-000001')).toBe(true);
        expect(isCanonicalDocumentNumber('RCP-PRD-2026-000001')).toBe(true);
    });

    it('returns false for legacy / unrelated formats', () => {
        expect(isCanonicalDocumentNumber('INV-P1-ST-2569-ABC-XX-YY')).toBe(false);
        expect(isCanonicalDocumentNumber('something-else')).toBe(false);
        expect(isCanonicalDocumentNumber('')).toBe(false);
    });
});

describe('[Tier 13] cross-stream invariants', () => {
    it('DTAM and Platform same sequence produce different document numbers (no collision)', () => {
        const dtam = buildDtamReceiptNumber({ year: 2569, sequence: 100 });
        // Same calendar year — Platform would use 2026
        const platform = buildPlatformTaxInvoiceNumber({ year: 2026, sequence: 100 });
        expect(dtam).not.toEqual(platform);
        // Both parse back correctly
        expect(parseDocumentNumber(dtam).scheme).toBe(SCHEMES.DTAM_RECEIPT);
        expect(parseDocumentNumber(platform).scheme).toBe(SCHEMES.PLATFORM_TAX_INVOICE);
    });

    it('Year boundary (1 January) — sequence resets next year', () => {
        // Modeling: callers reset their sequence allocator at year boundary.
        // This test anchors the EXPECTED behavior (helper just formats; the
        // actual reset is a caller / DB-sequence concern documented in the
        // file header).
        const lastOf2026 = buildPlatformTaxInvoiceNumber({ year: 2026, sequence: 999999 });
        const firstOf2027 = buildPlatformTaxInvoiceNumber({ year: 2027, sequence: 1 });
        expect(lastOf2026).toBe('TAX-PRD-2026-999999');
        expect(firstOf2027).toBe('TAX-PRD-2027-000001');
        expect(parseDocumentNumber(firstOf2027).sequence).toBe(1);
    });
});
