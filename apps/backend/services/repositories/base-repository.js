/**
 * Base Repository Pattern — Data Access Abstraction Layer
 *
 * Provides a standard interface for CRUD operations that:
 * 1. Decouples business logic from Prisma ORM specifics
 * 2. Enables easier unit testing (inject mock repository)
 * 3. Centralizes common patterns (soft delete, pagination, auditing)
 *
 * Usage:
 *   const repo = new BaseRepository('application');
 *   const app = await repo.findById('uuid');
 *   const list = await repo.findMany({ status: 'APPROVED' }, { page: 1, limit: 20 });
 *
 * @module services/repositories/base-repository
 */

const { prisma } = require('../prisma-database');
const { createLogger } = require('../../shared/logger');

class BaseRepository {
    /**
     * @param {string} modelName — Prisma model name (e.g. 'application', 'farm', 'user')
     * @param {object} options
     * @param {boolean} [options.softDelete=true] — Use isDeleted flag instead of hard delete
     * @param {string[]} [options.searchFields] — Fields to include in text search
     */
    constructor(modelName, options = {}) {
        this.modelName = modelName;
        this.model = prisma[modelName];
        this.softDelete = options.softDelete !== false;
        this.searchFields = options.searchFields || [];
        this.logger = createLogger(`repository:${modelName}`);

        if (!this.model) {
            throw new Error(`Prisma model "${modelName}" not found. Check schema.`);
        }
    }

    /**
     * Find a single record by ID
     * @param {string} id
     * @param {object} [include] — Prisma include relations
     */
    async findById(id, include = undefined) {
        const where = { id };
        if (this.softDelete) {where.isDeleted = false;}
        return this.model.findFirst({ where, include });
    }

    /**
     * Find a single record matching conditions
     * @param {object} where — Prisma where clause
     * @param {object} [include] — Prisma include relations
     */
    async findOne(where, include = undefined) {
        if (this.softDelete) {where = { ...where, isDeleted: false };}
        return this.model.findFirst({ where, include });
    }

    /**
     * Find multiple records with pagination
     * @param {object} where — Prisma where clause
     * @param {object} [options]
     * @param {number} [options.page=1]
     * @param {number} [options.limit=50]
     * @param {object} [options.orderBy]
     * @param {object} [options.include]
     */
    async findMany(where = {}, options = {}) {
        const { page = 1, limit = 50, orderBy = { createdAt: 'desc' }, include } = options;

        if (this.softDelete) {where = { ...where, isDeleted: false };}

        const [data, total] = await Promise.all([
            this.model.findMany({
                where,
                orderBy,
                include,
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.model.count({ where }),
        ]);

        return {
            data,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    /**
     * Count records matching conditions
     * @param {object} where — Prisma where clause
     */
    async count(where = {}) {
        if (this.softDelete) {where = { ...where, isDeleted: false };}
        return this.model.count({ where });
    }

    /**
     * Create a new record
     * @param {object} data — Record data
     */
    async create(data) {
        const record = await this.model.create({ data });
        this.logger.info(`Created ${this.modelName}: ${record.id}`);
        return record;
    }

    /**
     * Update a record by ID
     * @param {string} id
     * @param {object} data — Fields to update
     */
    async update(id, data) {
        const record = await this.model.update({ where: { id }, data });
        this.logger.info(`Updated ${this.modelName}: ${id}`);
        return record;
    }

    /**
     * Soft delete (set isDeleted=true) or hard delete
     * @param {string} id
     */
    async delete(id) {
        if (this.softDelete) {
            await this.model.update({ where: { id }, data: { isDeleted: true } });
            this.logger.info(`Soft-deleted ${this.modelName}: ${id}`);
        } else {
            await this.model.delete({ where: { id } });
            this.logger.info(`Hard-deleted ${this.modelName}: ${id}`);
        }
    }

    /**
     * Execute operations within a Prisma transaction
     * @param {Function} fn — async (tx) => { ... }
     */
    async transaction(fn) {
        return prisma.$transaction(fn);
    }

    /**
     * Check if a record exists
     * @param {object} where
     */
    async exists(where) {
        if (this.softDelete) {where = { ...where, isDeleted: false };}
        const count = await this.model.count({ where });
        return count > 0;
    }
}

module.exports = BaseRepository;
