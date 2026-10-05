'use strict';
/**
 * No issuer value in quotation-service may be `undefined`.
 *
 * 2026-09-27: `ISSUER.DTAM` became `undefined` when invoice-issuers dropped DTAM
 * (3fc6a56a). The Prisma query `issuerType: { in: [undefined, 'PLATFORM'] }` then
 * failed on every real database, and every checkout answered QUOTATION_NOT_ISSUED.
 * The real-Postgres proof is __tests__/integration/quotation-issuance-real-postgres.test.js;
 * this is the fast guard that runs with no database.
 */
const quotationService = require('../../services/quotation-service');

describe('quotation-service issuer maps', () => {
    it('ISSUER has no undefined value and issues the company only', () => {
        const { ISSUER } = quotationService;
        for (const [key, value] of Object.entries(ISSUER)) {
            expect({ key, value }).toEqual({ key, value: expect.any(String) });
        }
        expect(Object.values(ISSUER)).toEqual(['PLATFORM']);
    });

    it('QT_PREFIX has no undefined key or value, and admits only issuers in ISSUER', () => {
        const { QT_PREFIX } = quotationService._internals;
        expect(QT_PREFIX).toBeDefined();
        const issuers = new Set(Object.values(quotationService.ISSUER));
        for (const [key, value] of Object.entries(QT_PREFIX)) {
            expect(key).not.toBe('undefined');
            expect(issuers.has(key)).toBe(true);
            expect(typeof value).toBe('string');
        }
        expect(QT_PREFIX).toEqual({ PLATFORM: 'QT-PRD' });
    });

    it('the legacy DTAM reader value is an explicit string, not a lookup', () => {
        expect(quotationService._internals.LEGACY_DTAM_ISSUER).toBe('DTAM');
    });
});
