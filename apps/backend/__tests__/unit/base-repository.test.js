/**
 * Unit tests for BaseRepository.
 * Tests match actual BaseRepository API (findById, findOne, findMany, create, update, delete, count, exists, transaction).
 */

const BaseRepository = require('../../services/repositories/base-repository');

// Mock logger
jest.mock('../../shared/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

// Mock Prisma client
jest.mock('../../services/prisma-database', () => {
    const mockModel = {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
    };
    return {
        prisma: {
            testModel: mockModel,
            $transaction: jest.fn((fn) => fn({ testModel: mockModel })),
        },
    };
});

const { prisma } = require('../../services/prisma-database');

describe('BaseRepository', () => {
    let repo;

    beforeEach(() => {
        repo = new BaseRepository('testModel');
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('sets model name and model reference', () => {
            expect(repo.modelName).toBe('testModel');
            expect(repo.model).toBe(prisma.testModel);
        });

        it('throws if model does not exist', () => {
            expect(() => new BaseRepository('nonExistentModel')).toThrow('Prisma model "nonExistentModel" not found');
        });
    });

    describe('findById', () => {
        it('calls findFirst with id and soft-delete filter', async () => {
            const mockRecord = { id: '123', name: 'Test' };
            prisma.testModel.findFirst.mockResolvedValue(mockRecord);

            const result = await repo.findById('123');
            expect(prisma.testModel.findFirst).toHaveBeenCalledWith({
                where: { id: '123', isDeleted: false },
                include: undefined,
            });
            expect(result).toEqual(mockRecord);
        });
    });

    describe('findOne', () => {
        it('calls findFirst with provided filter + soft-delete', async () => {
            const mockRecord = { id: '1', email: 'test@test.com' };
            prisma.testModel.findFirst.mockResolvedValue(mockRecord);

            const result = await repo.findOne({ email: 'test@test.com' });
            expect(prisma.testModel.findFirst).toHaveBeenCalledWith({
                where: { email: 'test@test.com', isDeleted: false },
                include: undefined,
            });
            expect(result).toEqual(mockRecord);
        });
    });

    describe('findMany', () => {
        it('returns paginated results with metadata', async () => {
            const mockRecords = [{ id: '1' }, { id: '2' }];
            prisma.testModel.findMany.mockResolvedValue(mockRecords);
            prisma.testModel.count.mockResolvedValue(10);

            const result = await repo.findMany({ status: 'ACTIVE' }, { page: 1, limit: 2 });
            expect(result).toEqual({
                data: mockRecords,
                total: 10,
                page: 1,
                limit: 2,
                totalPages: 5,
            });
        });
    });

    describe('create', () => {
        it('calls create with provided data', async () => {
            const data = { name: 'New Item' };
            const mockCreated = { id: '1', name: 'New Item' };
            prisma.testModel.create.mockResolvedValue(mockCreated);

            const result = await repo.create(data);
            expect(prisma.testModel.create).toHaveBeenCalledWith({ data });
            expect(result).toEqual(mockCreated);
        });
    });

    describe('update', () => {
        it('calls update with id and data', async () => {
            const mockUpdated = { id: '1', name: 'Updated' };
            prisma.testModel.update.mockResolvedValue(mockUpdated);

            const result = await repo.update('1', { name: 'Updated' });
            expect(prisma.testModel.update).toHaveBeenCalledWith({
                where: { id: '1' },
                data: { name: 'Updated' },
            });
            expect(result).toEqual(mockUpdated);
        });
    });

    describe('delete (soft)', () => {
        it('soft deletes by setting isDeleted=true', async () => {
            prisma.testModel.update.mockResolvedValue({ id: '1', isDeleted: true });

            await repo.delete('1');
            expect(prisma.testModel.update).toHaveBeenCalledWith({
                where: { id: '1' },
                data: { isDeleted: true },
            });
        });
    });

    describe('count', () => {
        it('counts records matching filter with soft-delete', async () => {
            prisma.testModel.count.mockResolvedValue(42);

            const result = await repo.count({ status: 'ACTIVE' });
            expect(prisma.testModel.count).toHaveBeenCalledWith({
                where: { status: 'ACTIVE', isDeleted: false },
            });
            expect(result).toBe(42);
        });
    });

    describe('exists', () => {
        it('returns true when records exist', async () => {
            prisma.testModel.count.mockResolvedValue(1);

            const result = await repo.exists({ email: 'test@test.com' });
            expect(result).toBe(true);
        });

        it('returns false when no records exist', async () => {
            prisma.testModel.count.mockResolvedValue(0);

            const result = await repo.exists({ email: 'none@test.com' });
            expect(result).toBe(false);
        });
    });

    describe('transaction', () => {
        it('wraps callback in prisma $transaction', async () => {
            const callback = jest.fn().mockResolvedValue('result');
            prisma.$transaction.mockImplementation((fn) => fn(prisma));

            const result = await repo.transaction(callback);
            expect(prisma.$transaction).toHaveBeenCalled();
            expect(result).toBe('result');
        });
    });
});
