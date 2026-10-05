/**
 * Tests for PDPA Phase 1 backfill script.
 *
 * System deep-dive Tier 6 — DBA + Security + QA (2026-05-15).
 *
 * Covers:
 *   1. parseArgs — happy path + boundary validation + help/error exit
 *   2. rowNeedsBackfill — only flags rows with plaintext Phase-1 columns
 *      (skips already-encrypted, null, empty)
 *   3. buildUpdatePayload — touches only columns that need it; returns
 *      null when nothing to write (so the caller can skip the UPDATE)
 *   4. runBackfill orchestration — cursor pagination, idempotency,
 *      dry-run mode, maxRows cap, stats accuracy
 */

const path = require('path');

const {
    parseArgs,
    rowNeedsBackfill,
    buildUpdatePayload,
    runBackfill,
} = require(path.join(__dirname, '..', '..', 'scripts', 'pdpa', 'backfill-encrypt-user-pii'));

const PHASE_1_COLUMNS = [
    'idCard', 'taxId', 'laserCode', 'communityRegistrationNo',
    'address', 'province', 'district', 'subdistrict', 'zipCode',
];
const VERSION_PREFIX = 'enc:v1:';

// Mock encryption that's easy to assert against.
const mockEncryptValue = jest.fn((plain) => {
    if (plain === null || plain === undefined) {return plain;}
    if (typeof plain !== 'string') {return plain;}
    if (plain === '') {return plain;}
    if (plain.startsWith(VERSION_PREFIX)) {return plain;} // idempotent
    return `${VERSION_PREFIX}ENC[${plain}]`;
});

beforeEach(() => {
    mockEncryptValue.mockClear();
});

describe('[Tier 6] parseArgs', () => {
    it('returns defaults when no flags provided', () => {
        const args = parseArgs([]);
        expect(args).toEqual({
            dryRun: false,
            batchSize: 100,
            maxRows: Infinity,
            verbose: false,
        });
    });

    it('parses --dry-run / --verbose boolean flags', () => {
        const args = parseArgs(['--dry-run', '--verbose']);
        expect(args.dryRun).toBe(true);
        expect(args.verbose).toBe(true);
    });

    it('parses --batch-size with valid integer', () => {
        expect(parseArgs(['--batch-size', '500']).batchSize).toBe(500);
        expect(parseArgs(['--batch-size', '1']).batchSize).toBe(1);
        expect(parseArgs(['--batch-size', '5000']).batchSize).toBe(5000);
    });

    it('rejects --batch-size out of bounds or non-integer', () => {
        expect(() => parseArgs(['--batch-size', '0'])).toThrow(/batch-size/);
        expect(() => parseArgs(['--batch-size', '5001'])).toThrow(/batch-size/);
        expect(() => parseArgs(['--batch-size', '1.5'])).toThrow(/batch-size/);
        expect(() => parseArgs(['--batch-size', 'foo'])).toThrow(/batch-size/);
    });

    it('parses --max-rows with valid positive integer', () => {
        expect(parseArgs(['--max-rows', '1000']).maxRows).toBe(1000);
    });

    it('rejects --max-rows of 0 or negative', () => {
        expect(() => parseArgs(['--max-rows', '0'])).toThrow(/max-rows/);
        expect(() => parseArgs(['--max-rows', '-5'])).toThrow(/max-rows/);
    });

    it('rejects unknown flags', () => {
        expect(() => parseArgs(['--unknown'])).toThrow(/Unknown arg/);
    });
});

describe('[Tier 6] rowNeedsBackfill', () => {
    it('returns true when any Phase-1 column has plaintext (no version prefix)', () => {
        expect(rowNeedsBackfill({ idCard: '1100100100011' }, PHASE_1_COLUMNS, VERSION_PREFIX)).toBe(true);
        expect(rowNeedsBackfill({ idCard: null, address: '123 Main St' }, PHASE_1_COLUMNS, VERSION_PREFIX)).toBe(true);
    });

    it('returns false when all Phase-1 columns are already encrypted (have version prefix)', () => {
        expect(rowNeedsBackfill({
            idCard: 'enc:v1:abcd',
            taxId: 'enc:v1:efgh',
        }, PHASE_1_COLUMNS, VERSION_PREFIX)).toBe(false);
    });

    it('returns false when all Phase-1 columns are null or empty', () => {
        expect(rowNeedsBackfill({
            idCard: null,
            taxId: null,
            address: '',
        }, PHASE_1_COLUMNS, VERSION_PREFIX)).toBe(false);
    });

    it('ignores non-Phase-1 columns', () => {
        // healthId is NOT in Phase 1 — even if plaintext, must NOT trigger backfill.
        expect(rowNeedsBackfill({
            healthId: 'plaintext-secret',
        }, PHASE_1_COLUMNS, VERSION_PREFIX)).toBe(false);
    });
});

describe('[Tier 6] buildUpdatePayload', () => {
    it('encrypts every plaintext Phase-1 column and leaves others alone', () => {
        const row = {
            id: 'u1',
            idCard: '1100100100011',
            taxId: '0123456789012',
            healthId: 'should-not-touch',
            address: '123 Sukhumvit',
        };
        const payload = buildUpdatePayload(row, PHASE_1_COLUMNS, mockEncryptValue, VERSION_PREFIX);
        expect(payload).toEqual({
            idCard: 'enc:v1:ENC[1100100100011]',
            taxId: 'enc:v1:ENC[0123456789012]',
            address: 'enc:v1:ENC[123 Sukhumvit]',
        });
        expect(payload).not.toHaveProperty('healthId');
        expect(payload).not.toHaveProperty('id');
    });

    it('returns null when no column needs writing (all already encrypted)', () => {
        const row = {
            idCard: 'enc:v1:already-encrypted',
            taxId: 'enc:v1:also-encrypted',
        };
        const payload = buildUpdatePayload(row, PHASE_1_COLUMNS, mockEncryptValue, VERSION_PREFIX);
        expect(payload).toBeNull();
    });

    it('returns null when all Phase-1 columns are null/empty', () => {
        const row = { idCard: null, taxId: null, address: '' };
        const payload = buildUpdatePayload(row, PHASE_1_COLUMNS, mockEncryptValue, VERSION_PREFIX);
        expect(payload).toBeNull();
    });

    it('mixes encrypted + plaintext (mid-migration row) — only writes the plaintext ones', () => {
        const row = {
            idCard: 'enc:v1:already',
            taxId: 'still-plaintext',
        };
        const payload = buildUpdatePayload(row, PHASE_1_COLUMNS, mockEncryptValue, VERSION_PREFIX);
        expect(payload).toEqual({ taxId: 'enc:v1:ENC[still-plaintext]' });
        expect(payload).not.toHaveProperty('idCard');
    });
});

describe('[Tier 6] runBackfill — orchestration', () => {
    const mkRow = (id, overrides = {}) => ({
        id,
        idCard: `card-${id}`,
        taxId: null,
        address: null,
        ...overrides,
    });

    it('cursor-paginates and stops when a short page is returned (no infinite loop)', async () => {
        const allRows = [mkRow('u1'), mkRow('u2'), mkRow('u3')];
        let callCount = 0;
        const client = {
            user: {
                findMany: jest.fn(async (_args) => {
                    callCount += 1;
                    if (callCount === 1) {return allRows.slice(0, 2);} // full page
                    if (callCount === 2) {return allRows.slice(2);}    // short page → loop exits
                    return [];
                }),
                update: jest.fn(async () => ({})),
            },
        };

        const stats = await runBackfill({
            client,
            columns: PHASE_1_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 2,
            maxRows: Infinity,
            dryRun: false,
            verbose: false,
            logger: { log: () => {} },
        });

        expect(stats.pagesScanned).toBe(2);
        expect(stats.rowsScanned).toBe(3);
        expect(stats.rowsUpdated).toBe(3);
        expect(client.user.update).toHaveBeenCalledTimes(3);
        // The 2nd findMany call must include cursor + skip=1.
        const secondCallArgs = client.user.findMany.mock.calls[1][0];
        expect(secondCallArgs.cursor).toEqual({ id: 'u2' });
        expect(secondCallArgs.skip).toBe(1);
    });

    it('skips rows that are already fully encrypted (idempotency)', async () => {
        const client = {
            user: {
                findMany: jest.fn().mockResolvedValueOnce([
                    { id: 'u1', idCard: 'enc:v1:already', taxId: null, address: null },
                    { id: 'u2', idCard: 'plaintext-card', taxId: null, address: null },
                ]).mockResolvedValueOnce([]),
                update: jest.fn(async () => ({})),
            },
        };

        const stats = await runBackfill({
            client,
            columns: PHASE_1_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 100,
            maxRows: Infinity,
            dryRun: false,
            verbose: false,
            logger: { log: () => {} },
        });

        expect(stats.rowsUpdated).toBe(1);
        expect(stats.rowsSkipped).toBe(1);
        expect(client.user.update).toHaveBeenCalledTimes(1);
        expect(client.user.update.mock.calls[0][0].where.id).toBe('u2');
    });

    it('dry-run does not write to DB', async () => {
        const client = {
            user: {
                findMany: jest.fn().mockResolvedValueOnce([
                    mkRow('u1'), mkRow('u2'),
                ]).mockResolvedValueOnce([]),
                update: jest.fn(async () => ({})),
            },
        };

        const stats = await runBackfill({
            client,
            columns: PHASE_1_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 100,
            maxRows: Infinity,
            dryRun: true,
            verbose: false,
            logger: { log: () => {} },
        });

        expect(stats.rowsRequiringBackfill).toBe(2);
        expect(stats.rowsUpdated).toBe(0);
        expect(client.user.update).not.toHaveBeenCalled();
    });

    it('respects maxRows cap', async () => {
        const allRows = [mkRow('u1'), mkRow('u2'), mkRow('u3'), mkRow('u4'), mkRow('u5')];
        let pos = 0;
        const client = {
            user: {
                findMany: jest.fn(async (args) => {
                    const take = args.take;
                    const slice = allRows.slice(pos, pos + take);
                    pos += slice.length;
                    return slice;
                }),
                update: jest.fn(async () => ({})),
            },
        };

        const stats = await runBackfill({
            client,
            columns: PHASE_1_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 100,
            maxRows: 3,
            dryRun: false,
            verbose: false,
            logger: { log: () => {} },
        });

        expect(stats.rowsScanned).toBe(3);
        expect(stats.rowsUpdated).toBe(3);
    });

    it('only filters non-deleted users (isDeleted=false on findMany WHERE)', async () => {
        const client = {
            user: {
                findMany: jest.fn().mockResolvedValueOnce([]),
                update: jest.fn(),
            },
        };

        await runBackfill({
            client,
            columns: PHASE_1_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 100,
            maxRows: Infinity,
            dryRun: false,
            verbose: false,
            logger: { log: () => {} },
        });

        const firstCallArgs = client.user.findMany.mock.calls[0][0];
        expect(firstCallArgs.where.isDeleted).toBe(false);
        expect(firstCallArgs.orderBy).toEqual({ id: 'asc' });
    });
});
