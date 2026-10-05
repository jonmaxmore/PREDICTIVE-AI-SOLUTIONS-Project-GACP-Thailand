/**
 * close-period-modal — error mapping unit tests (Iter R5-C).
 *
 * Closes R1 review H-1: previously the modal rendered "หลาย ใบ" (the
 * Thai word for "many") because envelope metadata was stripped at the
 * api-client trust boundary. R5-C plumbs `openInvoices` through, and
 * this test asserts the modal now renders the actual count
 * ("5 ใบ" for the H-1 fixture).
 *
 * Radix Dialog portals away in jsdom, so we test the pure
 * `mapClosePeriodError` helper directly — it owns 100% of the
 * error → display-message translation and is exported for this purpose.
 */

import { describe, expect, it } from '@jest/globals';
import { mapClosePeriodError } from '../close-period-modal';

describe('mapClosePeriodError', () => {
    describe('PENDING_INVOICES_IN_PERIOD (H-1 fixture)', () => {
        it('renders "5 ใบ" when backend returns openInvoices=5', () => {
            const view = mapClosePeriodError({
                code: 'PENDING_INVOICES_IN_PERIOD',
                message: 'There are 5 invoices in this period',
                openInvoices: 5,
                warnings: ['INV-2026-04-001', 'INV-2026-04-002'],
            });
            expect(view.message).toContain('5 ใบ');
            // No regression: should NOT contain the old workaround text.
            expect(view.message).not.toContain('หลาย ใบ');
            expect(view.meta).toEqual({
                openInvoices: 5,
                warnings: ['INV-2026-04-001', 'INV-2026-04-002'],
            });
        });

        it('falls back to "0 ใบ" when openInvoices is missing', () => {
            const view = mapClosePeriodError({
                code: 'PENDING_INVOICES_IN_PERIOD',
                message: 'Pending invoices',
            });
            expect(view.message).toContain('0 ใบ');
            expect(view.message).toContain('ภ.พ.30');
        });

        it('includes the ภ.พ.30 hint in the message', () => {
            const view = mapClosePeriodError({
                code: 'PENDING_INVOICES_IN_PERIOD',
                openInvoices: 3,
            });
            expect(view.message).toContain('ภ.พ.30');
        });
    });

    describe('ALREADY_CLOSED', () => {
        it('renders the periodCloseId when provided', () => {
            const view = mapClosePeriodError({
                code: 'ALREADY_CLOSED',
                periodCloseId: 'pc-abc-123',
            });
            expect(view.message).toContain('pc-abc-123');
            expect(view.message).toContain('ปิดไปแล้ว');
        });

        it('omits the id segment when periodCloseId is missing', () => {
            const view = mapClosePeriodError({
                code: 'ALREADY_CLOSED',
            });
            expect(view.message).toContain('ปิดไปแล้ว');
            expect(view.message).not.toContain('id:');
        });
    });

    describe('FUTURE_PERIOD', () => {
        it('returns the Thai future-period hint', () => {
            const view = mapClosePeriodError({ code: 'FUTURE_PERIOD' });
            expect(view.message).toContain('เดือนนี้ยังไม่จบ');
            expect(view.meta).toBeNull();
        });
    });

    describe('VALIDATION_ERROR', () => {
        it('returns the backend message when provided', () => {
            const view = mapClosePeriodError({
                code: 'VALIDATION_ERROR',
                message: 'month must be between 1 and 12',
            });
            expect(view.message).toBe('month must be between 1 and 12');
        });

        it('falls back to a generic Thai message when message is missing', () => {
            const view = mapClosePeriodError({ code: 'VALIDATION_ERROR' });
            expect(view.message).toContain('ข้อมูลไม่ถูกต้อง');
        });
    });

    describe('UNKNOWN / fallback', () => {
        it('uses the backend message when present', () => {
            const view = mapClosePeriodError({
                code: 'SOMETHING_WEIRD',
                message: 'Unexpected upstream condition',
            });
            expect(view.message).toBe('Unexpected upstream condition');
        });

        it('falls back to the generic Thai close-failure message', () => {
            const view = mapClosePeriodError({});
            expect(view.message).toContain('ปิดงวดไม่สำเร็จ');
        });
    });
});
