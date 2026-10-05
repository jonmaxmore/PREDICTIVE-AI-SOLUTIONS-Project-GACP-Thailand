'use strict';

/**
 * M-3 (PR2 Tier C review, 2026-09-29): the DTAM remittance report is gone, and
 * `GET /api/invoices/export?type=gov_remittance` must say so — a 400 with a
 * registered code — instead of quietly answering with the monthly revenue report
 * under a request that asked for something else.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: { invoice: { findMany: jest.fn(async () => []) } },
}));

const { exportCSV } = require('../../services/financial-export-service');
const { ERROR_CODES } = require('../../shared/error-codes');

test('type=gov_remittance → 400 EXPORT_REPORT_TYPE_RETIRED, no file', async () => {
    await expect(exportCSV('gov_remittance', 9, 2026, {}))
        .rejects.toMatchObject({ code: 'EXPORT_REPORT_TYPE_RETIRED', status: 400, statusCode: 400 });
});

test('the code is catalogued as a 400', () => {
    expect(ERROR_CODES.EXPORT_REPORT_TYPE_RETIRED).toMatchObject({ code: 'EXPORT_REPORT_TYPE_RETIRED', httpStatus: 400 });
});

test.each([['monthly', /^monthly_revenue_2026_09\.csv$/], ['tax', /^tax_report_2026_09\.csv$/]])(
    'type=%s still exports',
    async (type, name) => {
        const out = await exportCSV(type, 9, 2026, {});
        expect(out.filename).toMatch(name);
    },
);
