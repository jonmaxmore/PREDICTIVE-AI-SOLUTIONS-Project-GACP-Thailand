/**
 * STAGE B3 — Tests for the national-ID at-rest ENCRYPT backfill script
 * (scripts/pdpa/backfill-encrypt-national-id-pii.js).
 *
 * Covers:
 *   1. runEntityBackfill — encrypts Entity.thaiCitizenId in place, idempotent
 *      (skips already-encrypted + null), dry-run does not write, pages by id.
 *   2. countRemainingPlaintext — counts rows still holding plaintext across
 *      BOTH models (the "0 plaintext remaining" assertion).
 *   3. The decided encrypt set is what the script consumes (ALL_USER_PII_COLUMNS
 *      includes national IDs + excludes deferred; ENTITY_PII_COLUMNS = thaiCitizenId).
 */

const path = require('path');

const VERSION_PREFIX = 'enc:v1:';
const enc = (plain) => `${VERSION_PREFIX}ENC[${plain}]`;

// Deterministic mock cipher matching the other PDPA tests.
const mockEncryptValue = jest.fn((plain) => {
    if (plain === null || plain === undefined) {return plain;}
    if (typeof plain !== 'string') {return plain;}
    if (plain === '') {return plain;}
    if (plain.startsWith(VERSION_PREFIX)) {return plain;} // idempotent
    return enc(plain);
});

const {
    runEntityBackfill,
    countRemainingPlaintext,
    ENTITY_TYPE_INDIVIDUAL,
} = require(path.join(__dirname, '..', '..', 'scripts', 'pdpa', 'backfill-encrypt-national-id-pii'));

const ENTITY_COLUMNS = ['thaiCitizenId'];

beforeEach(() => {
    mockEncryptValue.mockClear();
});

describe('[STAGE B3] runEntityBackfill', () => {
    it('encrypts thaiCitizenId for INDIVIDUAL entities, scoped + by-id paging', async () => {
        const rows = [
            { id: 'e1', thaiCitizenId: '1100100100011' },
            { id: 'e2', thaiCitizenId: '2200200200022' },
        ];
        const client = {
            entity: {
                findMany: jest.fn()
                    .mockResolvedValueOnce(rows)
                    .mockResolvedValueOnce([]),
                update: jest.fn(async () => ({})),
            },
        };

        const stats = await runEntityBackfill({
            client,
            columns: ENTITY_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 100,
            maxRows: Infinity,
            dryRun: false,
            verbose: false,
            logger: { log: () => {} },
        });

        expect(stats.rowsUpdated).toBe(2);
        expect(client.entity.update).toHaveBeenCalledTimes(2);
        // Scoped to active INDIVIDUAL entities; selects the column + id only.
        const firstFind = client.entity.findMany.mock.calls[0][0];
        expect(firstFind.where).toEqual({ isDeleted: false, type: ENTITY_TYPE_INDIVIDUAL });
        expect(firstFind.orderBy).toEqual({ id: 'asc' });
        // The written payload is the encrypted value, keyed by id.
        expect(client.entity.update.mock.calls[0][0]).toEqual({
            where: { id: 'e1' },
            data: { thaiCitizenId: enc('1100100100011') },
        });
    });

    it('is idempotent — skips already-encrypted and null thaiCitizenId rows', async () => {
        const client = {
            entity: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([
                        { id: 'e1', thaiCitizenId: enc('already') }, // skip
                        { id: 'e2', thaiCitizenId: null }, // skip
                        { id: 'e3', thaiCitizenId: 'plaintext' }, // encrypt
                    ])
                    .mockResolvedValueOnce([]),
                update: jest.fn(async () => ({})),
            },
        };

        const stats = await runEntityBackfill({
            client,
            columns: ENTITY_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 100,
            maxRows: Infinity,
            dryRun: false,
            verbose: false,
            logger: { log: () => {} },
        });

        expect(stats.rowsUpdated).toBe(1);
        expect(stats.rowsSkipped).toBe(2);
        expect(client.entity.update).toHaveBeenCalledTimes(1);
        expect(client.entity.update.mock.calls[0][0].where.id).toBe('e3');
    });

    it('dry-run does not write', async () => {
        const client = {
            entity: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([{ id: 'e1', thaiCitizenId: 'plaintext' }]),
                update: jest.fn(),
            },
        };

        const stats = await runEntityBackfill({
            client,
            columns: ENTITY_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            encryptValueFn: mockEncryptValue,
            batchSize: 100,
            maxRows: Infinity,
            dryRun: true,
            verbose: false,
            logger: { log: () => {} },
        });

        expect(stats.rowsRequiringBackfill).toBe(1);
        expect(stats.rowsUpdated).toBe(0);
        expect(client.entity.update).not.toHaveBeenCalled();
    });
});

describe('[STAGE B3] countRemainingPlaintext — the "0 plaintext remaining" assertion', () => {
    it('returns 0/0 when every in-scope column is encrypted or null', async () => {
        const client = {
            user: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([
                        { id: 'u1', healthId: enc('x'), idCard: null, taxId: enc('y') },
                    ])
                    .mockResolvedValueOnce([]),
            },
            entity: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([{ id: 'e1', thaiCitizenId: enc('z') }])
                    .mockResolvedValueOnce([]),
            },
        };

        const remaining = await countRemainingPlaintext({
            client,
            userColumns: ['healthId', 'idCard', 'taxId'],
            entityColumns: ENTITY_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            batchSize: 100,
        });
        expect(remaining).toEqual({ user: 0, entity: 0 });
    });

    it('counts rows that still hold plaintext in the encrypt set', async () => {
        const client = {
            user: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([
                        { id: 'u1', healthId: 'STILL-PLAINTEXT' }, // counts
                        { id: 'u2', healthId: enc('ok') }, // does not
                    ])
                    .mockResolvedValueOnce([]),
            },
            entity: {
                findMany: jest.fn()
                    .mockResolvedValueOnce([{ id: 'e1', thaiCitizenId: 'PLAINTEXT' }]) // counts
                    .mockResolvedValueOnce([]),
            },
        };

        const remaining = await countRemainingPlaintext({
            client,
            userColumns: ['healthId'],
            entityColumns: ENTITY_COLUMNS,
            versionPrefix: VERSION_PREFIX,
            batchSize: 100,
        });
        expect(remaining).toEqual({ user: 1, entity: 1 });
        // Entity scan is scoped to active INDIVIDUAL entities.
        expect(client.entity.findMany.mock.calls[0][0].where).toEqual({
            isDeleted: false, type: ENTITY_TYPE_INDIVIDUAL,
        });
    });
});

describe('[STAGE B3] the script consumes the DECIDED encrypt set', () => {
    it('ALL_USER_PII_COLUMNS includes national IDs + excludes deferred; ENTITY = thaiCitizenId', () => {
        const ext = require(path.join(__dirname, '..', '..', 'services', 'prisma-pdpa-extension'));
        for (const c of ['healthId', 'providerId', 'idCard', 'taxId', 'communityRegistrationNo', 'laserCode']) {
            expect(ext.ALL_USER_PII_COLUMNS).toContain(c);
        }
        for (const c of ['province', 'firstName', 'lastName', 'phoneNumber']) {
            expect(ext.ALL_USER_PII_COLUMNS).not.toContain(c);
        }
        // juristicId added to the entity encrypt-set during the national-ID
        // rounds (close-natid); the assertion was stale (thaiCitizenId only).
        expect(ext.ENTITY_PII_COLUMNS).toEqual(['thaiCitizenId', 'juristicId']);
    });
});
