/**
 * Tests for closed-period lock enforcement (Iter 24, 2026-05-16).
 *
 * Anchors:
 *   - journal-entry-period-guard.checkPeriodOpen throws PERIOD_CLOSED when
 *     entryDate lands in a CLOSED period.
 *   - journal-entry-service.recordPaymentEntry surfaces PERIOD_CLOSED for
 *     a back-dated payment to a closed period.
 *   - Posting with meta.allowClosedPeriod=true bypasses the guard (ADMIN
 *     recovery path).
 *   - manual-journal-entry-service.postManualEntry rejects an APPROVED
 *     draft whose postingDate lands in a closed period.
 */

'use strict';

describe('[Iter 24] period-close lock enforcement', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('journal-entry-period-guard.checkPeriodOpen', () => {
        test('throws PERIOD_CLOSED when isPeriodClosed returns true', async () => {
            jest.doMock('../../services/period-close-service', () => ({
                isPeriodClosed: jest.fn(async () => true),
            }));
            const guard = require('../../services/journal-entry-period-guard');
            try {
                await guard.checkPeriodOpen({
                    entryDate: new Date('2026-04-15T10:00:00Z'),
                    organizationId: 'org-1',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('PERIOD_CLOSED');
                expect(err.year).toBe(2026);
                expect(err.month).toBe(4);
                // adversarial-verify finding 5: the error carries its HTTP status
                // so sendServiceError-based routes (credit/debit-notes) map 409.
                expect(err.statusCode).toBe(409);
            }
        });

        test('returns silently when period is open', async () => {
            jest.doMock('../../services/period-close-service', () => ({
                isPeriodClosed: jest.fn(async () => false),
            }));
            const guard = require('../../services/journal-entry-period-guard');
            await expect(guard.checkPeriodOpen({
                entryDate: new Date('2026-04-15T10:00:00Z'),
                organizationId: 'org-1',
            })).resolves.toBeUndefined();
        });

        test('bypassed when allowClosedPeriod=true', async () => {
            const isPeriodClosed = jest.fn(async () => true);
            jest.doMock('../../services/period-close-service', () => ({ isPeriodClosed }));
            const guard = require('../../services/journal-entry-period-guard');
            await expect(guard.checkPeriodOpen({
                entryDate: new Date('2026-04-15T10:00:00Z'),
                organizationId: 'org-1',
                allowClosedPeriod: true,
            })).resolves.toBeUndefined();
            expect(isPeriodClosed).not.toHaveBeenCalled();
        });

        test('fails CLOSED when period-close-service has no isPeriodClosed (controller ruling 2026-09-26)', async () => {
            jest.doMock('../../services/period-close-service', () => ({
                // Missing isPeriodClosed — the guard must REFUSE, never wave the post through.
            }));
            const guard = require('../../services/journal-entry-period-guard');
            await expect(guard.checkPeriodOpen({
                entryDate: new Date('2026-04-15T10:00:00Z'),
                organizationId: 'org-1',
            })).rejects.toMatchObject({ code: 'PERIOD_CHECK_UNAVAILABLE', statusCode: 503 });
        });

        test('fails CLOSED when period-close-service throws while loading', async () => {
            jest.doMock('../../services/period-close-service', () => {
                throw new Error('simulated load failure');
            });
            const guard = require('../../services/journal-entry-period-guard');
            await expect(guard.checkPeriodOpen({
                entryDate: new Date('2026-04-15T10:00:00Z'),
                organizationId: 'org-1',
            })).rejects.toMatchObject({ code: 'PERIOD_CHECK_UNAVAILABLE' });
        });

        test('the ADMIN recovery flag still bypasses even when period-close cannot load', async () => {
            jest.doMock('../../services/period-close-service', () => {
                throw new Error('simulated load failure');
            });
            const guard = require('../../services/journal-entry-period-guard');
            await expect(guard.checkPeriodOpen({
                entryDate: new Date('2026-04-15T10:00:00Z'),
                organizationId: 'org-1',
                allowClosedPeriod: true,
            })).resolves.toBeUndefined();
        });

        test('returns silently for invalid date', async () => {
            const isPeriodClosed = jest.fn(async () => true);
            jest.doMock('../../services/period-close-service', () => ({ isPeriodClosed }));
            const guard = require('../../services/journal-entry-period-guard');
            await expect(guard.checkPeriodOpen({
                entryDate: 'not a date',
                organizationId: 'org-1',
            })).resolves.toBeUndefined();
        });

        test('Bug 7.4 — PROPAGATES (fail-CLOSED) when isPeriodClosed throws on a DB error', async () => {
            // A DB error while checking the period must BLOCK the post (fail
            // CLOSED), never fail open. The old guard had `.catch(() => false)`
            // which swallowed the error and let the entry into a possibly-closed
            // period. The throw must reach the caller so it maps to 503.
            jest.doMock('../../services/period-close-service', () => ({
                isPeriodClosed: jest.fn(async () => {
                    throw Object.assign(new Error('period-close DB unreachable'), {
                        code: 'PERIOD_CHECK_UNAVAILABLE',
                    });
                }),
            }));
            const guard = require('../../services/journal-entry-period-guard');
            await expect(guard.checkPeriodOpen({
                entryDate: new Date('2026-04-15T10:00:00Z'),
                organizationId: 'org-1',
            })).rejects.toMatchObject({ code: 'PERIOD_CHECK_UNAVAILABLE' });
        });
    });

    describe('journal-entry-service.recordPaymentEntry — period guard integration', () => {
        test('throws PERIOD_CLOSED for back-dated payment to closed period', async () => {
            // Provide a stub prisma so the entry would otherwise proceed
            // to persistence. The guard fires BEFORE the persist call so
            // we expect PERIOD_CLOSED to surface first.
            jest.doMock('../../services/prisma-database', () => ({
                prisma: {
                    journalEntry: {
                        create: jest.fn().mockResolvedValue({ id: 'should-not-reach' }),
                    },
                },
            }));
            jest.doMock('../../services/period-close-service', () => ({
                isPeriodClosed: jest.fn(async ({ year, month }) => year === 2026 && month === 4),
            }));
            const service = require('../../services/journal-entry-service');

            try {
                await service.recordPaymentEntry(
                    'invoice-1',
                    535,
                    { platformFee: 500, vat: 35 },
                    {
                        invoiceNumber: 'TAX-PRD-2026-000001',
                        serviceType: 'PHASE_1_PLATFORM_FEE',
                        paidAt: new Date('2026-04-20T10:00:00Z'),
                        organizationId: 'org-1',
                    },
                );
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('PERIOD_CLOSED');
                expect(err.year).toBe(2026);
                expect(err.month).toBe(4);
                // adversarial-verify finding 5: the error carries its HTTP status
                // so sendServiceError-based routes (credit/debit-notes) map 409.
                expect(err.statusCode).toBe(409);
            }
        });

        test('bypassed by meta.allowClosedPeriod=true (ADMIN recovery path)', async () => {
            const journalCreate = jest.fn().mockResolvedValue({
                id: 'je-recovery-1',
                lines: [],
            });
            jest.doMock('../../services/prisma-database', () => ({
                prisma: {
                    journalEntry: { create: journalCreate },
                },
            }));
            const isPeriodClosed = jest.fn(async () => true);
            jest.doMock('../../services/period-close-service', () => ({ isPeriodClosed }));
            const service = require('../../services/journal-entry-service');

            const result = await service.recordPaymentEntry(
                'invoice-recovery',
                535,
                { platformFee: 500, vat: 35 },
                {
                    invoiceNumber: 'TAX-PRD-2026-000099',
                    serviceType: 'PHASE_1_PLATFORM_FEE',
                    paidAt: new Date('2026-04-20T10:00:00Z'),
                    organizationId: 'org-1',
                    allowClosedPeriod: true,
                },
            );

            expect(result).toBeTruthy();
            // The bypass means we don't ask the guard at all.
            expect(isPeriodClosed).not.toHaveBeenCalled();
            // And the persist call did fire.
            expect(journalCreate).toHaveBeenCalledTimes(1);
        });

        test('proceeds when period is open', async () => {
            const journalCreate = jest.fn().mockResolvedValue({
                id: 'je-open-1',
                lines: [],
            });
            jest.doMock('../../services/prisma-database', () => ({
                prisma: {
                    journalEntry: { create: journalCreate },
                },
            }));
            jest.doMock('../../services/period-close-service', () => ({
                isPeriodClosed: jest.fn(async () => false),
            }));
            const service = require('../../services/journal-entry-service');

            const result = await service.recordPaymentEntry(
                'invoice-open',
                535,
                { platformFee: 500, vat: 35 },
                {
                    invoiceNumber: 'TAX-PRD-2026-000010',
                    serviceType: 'PHASE_1_PLATFORM_FEE',
                    paidAt: new Date('2026-04-20T10:00:00Z'),
                    organizationId: 'org-1',
                },
            );

            expect(result).toBeTruthy();
            expect(journalCreate).toHaveBeenCalledTimes(1);
        });
    });

    describe('manual-journal-entry-service.postManualEntry — period guard integration', () => {
        // Build a Prisma mock just enough to walk the postManualEntry path
        // until the period guard fires.
        function buildPrismaWithApprovedDraft(postingDate, organizationId = 'org-1') {
            const draft = {
                id: 'draft-1',
                draftNumber: 'MJE-2026-000001',
                description: 'Accrual reversal',
                postingDate,
                reason: 'monthly accrual reversal',
                status: 'APPROVED',
                linesJson: [
                    { lineNumber: 1, accountCode: '1110-001', debit: 100, credit: 0 },
                    { lineNumber: 2, accountCode: '4110', debit: 0, credit: 100 },
                ],
                totalDebit: 100,
                totalCredit: 100,
                createdBy: 'user-creator',
                approvedBy: 'user-approver',
                approvedAt: new Date(),
                organizationId,
            };
            const draftModel = {
                // create is checked by resolvePrisma() for client-readiness
                // even though we never invoke it on this path.
                create: jest.fn(),
                findUnique: jest.fn(async () => draft),
                update: jest.fn(async ({ data }) => ({ ...draft, ...data })),
            };
            const journalEntryModel = {
                create: jest.fn(async ({ data }) => ({
                    id: 'je-manual-1', ...data, lines: [],
                })),
            };
            return {
                prisma: {
                    manualJournalEntryDraft: draftModel,
                    journalEntry: journalEntryModel,
                    $transaction: jest.fn(async (cb) => cb({
                        manualJournalEntryDraft: draftModel,
                        journalEntry: journalEntryModel,
                    })),
                },
                draftModel,
                journalEntryModel,
            };
        }

        test('rejects post when postingDate lands in CLOSED period', async () => {
            const harness = buildPrismaWithApprovedDraft(new Date('2026-04-15T10:00:00Z'));
            jest.doMock('../../services/prisma-database', () => ({ prisma: harness.prisma }));
            jest.doMock('../../services/period-close-service', () => ({
                isPeriodClosed: jest.fn(async ({ year, month }) => year === 2026 && month === 4),
            }));
            const service = require('../../services/manual-journal-entry-service');

            try {
                await service.postManualEntry('draft-1', { actorId: 'u-poster' });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('PERIOD_CLOSED');
            }
            // Guard fires BEFORE the $transaction — no journal entry created.
            expect(harness.journalEntryModel.create).not.toHaveBeenCalled();
        });

        test('proceeds to post when postingDate is in OPEN period', async () => {
            const harness = buildPrismaWithApprovedDraft(new Date('2026-05-10T10:00:00Z'));
            jest.doMock('../../services/prisma-database', () => ({ prisma: harness.prisma }));
            jest.doMock('../../services/period-close-service', () => ({
                isPeriodClosed: jest.fn(async () => false),
            }));
            const service = require('../../services/manual-journal-entry-service');

            const result = await service.postManualEntry('draft-1', { actorId: 'u-poster' });
            expect(result.entry.id).toBeTruthy();
            expect(harness.journalEntryModel.create).toHaveBeenCalledTimes(1);
        });

        test('bypassed by allowClosedPeriod=true (ADMIN recovery path)', async () => {
            const harness = buildPrismaWithApprovedDraft(new Date('2026-04-15T10:00:00Z'));
            jest.doMock('../../services/prisma-database', () => ({ prisma: harness.prisma }));
            const isPeriodClosed = jest.fn(async () => true);
            jest.doMock('../../services/period-close-service', () => ({ isPeriodClosed }));
            const service = require('../../services/manual-journal-entry-service');

            const result = await service.postManualEntry('draft-1', {
                actorId: 'u-poster',
                allowClosedPeriod: true,
            });
            expect(result.entry.id).toBeTruthy();
            expect(isPeriodClosed).not.toHaveBeenCalled();
            expect(harness.journalEntryModel.create).toHaveBeenCalledTimes(1);
        });
    });
});
