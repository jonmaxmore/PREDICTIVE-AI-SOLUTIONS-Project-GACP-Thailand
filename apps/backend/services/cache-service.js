/**
 * Cache Service
 * Redis-based caching layer for performance optimization
 * 
 * Features:
 * - Certificate validation caching
 * - Traceability query caching
 * - Master data caching
 * - Cache invalidation strategies
 */

// Try to load redis config, fallback to null if not available
let redis;
try {
    redis = require('../config/redis');
} catch (_e) {
    redis = null;
}
const logger = require('../shared/logger');

class CacheService {
    constructor() {
        this.redis = redis;
        this.defaultTTL = 3600; // 1 hour
        
        // Cache key prefixes
        this.prefixes = {
            CERTIFICATE: 'cert:',
            TRACEABILITY: 'trace:',
            MASTER_DATA: 'master:',
            FARM: 'farm:',
            APPLICATION: 'app:',
            ANALYTICS: 'analytics:',
        };
    }

    // GENERIC CACHE OPERATIONS

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any>} Cached value or null
     */
    async get(key) {
        try {
            const value = await this.redis.get(key);
            if (value) {
                logger.debug({ key }, 'Cache hit');
                return JSON.parse(value);
            }
            logger.debug({ key }, 'Cache miss');
            return null;
        } catch (error) {
            logger.error({ error, key }, 'Cache get error');
            return null;
        }
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds
     */
    async set(key, value, ttl = this.defaultTTL) {
        try {
            await this.redis.setex(key, ttl, JSON.stringify(value));
            logger.debug({ key, ttl }, 'Cache set');
        } catch (error) {
            logger.error({ error, key }, 'Cache set error');
        }
    }

    /**
     * Delete value from cache
     * @param {string} key - Cache key
     */
    async del(key) {
        try {
            await this.redis.del(key);
            logger.debug({ key }, 'Cache delete');
        } catch (error) {
            logger.error({ error, key }, 'Cache delete error');
        }
    }

    /**
     * Delete multiple keys by pattern
     * @param {string} pattern - Key pattern (e.g., 'cert:*')
     */
    async delPattern(pattern) {
        try {
            const keys = await this.redis.keys(pattern);
            if (keys.length > 0) {
                await this.redis.del(...keys);
                logger.debug({ pattern, count: keys.length }, 'Cache pattern delete');
            }
        } catch (error) {
            logger.error({ error, pattern }, 'Cache pattern delete error');
        }
    }

    /**
     * Get or set cache value
     * @param {string} key - Cache key
     * @param {Function} fetcher - Function to fetch data if cache miss
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<any>} Cached or fetched value
     */
    async getOrSet(key, fetcher, ttl = this.defaultTTL) {
        const cached = await this.get(key);
        if (cached !== null) {
            return cached;
        }

        const value = await fetcher();
        if (value !== null && value !== undefined) {
            await this.set(key, value, ttl);
        }
        return value;
    }

    // CERTIFICATE CACHE

    /**
     * Get cached certificate validation
     * @param {string} certificateNumber 
     * @returns {Promise<Object|null>}
     */
    async getCertificateValidation(certificateNumber) {
        const key = `${this.prefixes.CERTIFICATE}valid:${certificateNumber}`;
        return this.get(key);
    }

    /**
     * Cache certificate validation
     * @param {string} certificateNumber 
     * @param {Object} validationData 
     * @param {number} ttl - Default 1 hour
     */
    async setCertificateValidation(certificateNumber, validationData, ttl = 3600) {
        const key = `${this.prefixes.CERTIFICATE}valid:${certificateNumber}`;
        await this.set(key, validationData, ttl);
    }

    /**
     * Invalidate certificate cache
     * @param {string} certificateNumber 
     */
    async invalidateCertificate(certificateNumber) {
        await this.del(`${this.prefixes.CERTIFICATE}valid:${certificateNumber}`);
        await this.del(`${this.prefixes.CERTIFICATE}details:${certificateNumber}`);
    }

    // TRACEABILITY CACHE

    /**
     * Get cached traceability data
     * @param {string} qrCode 
     * @returns {Promise<Object|null>}
     */
    async getTraceabilityData(qrCode) {
        const key = `${this.prefixes.TRACEABILITY}${qrCode}`;
        return this.get(key);
    }

    /**
     * Cache traceability data
     * @param {string} qrCode 
     * @param {Object} traceData 
     * @param {number} ttl - Default 5 minutes (trace data changes frequently)
     */
    async setTraceabilityData(qrCode, traceData, ttl = 300) {
        const key = `${this.prefixes.TRACEABILITY}${qrCode}`;
        await this.set(key, traceData, ttl);
    }

    /**
     * Invalidate traceability cache for a batch/lot
     * @param {string} qrCode 
     */
    async invalidateTraceability(qrCode) {
        await this.del(`${this.prefixes.TRACEABILITY}${qrCode}`);
    }

    // MASTER DATA CACHE

    /**
     * Get cached master data
     * @param {string} dataType - e.g., 'plantSpecies', 'provinces'
     * @returns {Promise<Array|null>}
     */
    async getMasterData(dataType) {
        const key = `${this.prefixes.MASTER_DATA}${dataType}`;
        return this.get(key);
    }

    /**
     * Cache master data
     * @param {string} dataType 
     * @param {Array} data 
     * @param {number} ttl - Default 24 hours (master data rarely changes)
     */
    async setMasterData(dataType, data, ttl = 86400) {
        const key = `${this.prefixes.MASTER_DATA}${dataType}`;
        await this.set(key, data, ttl);
    }

    /**
     * Invalidate all master data caches
     */
    async invalidateMasterData() {
        await this.delPattern(`${this.prefixes.MASTER_DATA}*`);
    }

    // FARM CACHE

    /**
     * Get cached farm details
     * @param {string} farmId 
     * @returns {Promise<Object|null>}
     */
    async getFarmDetails(farmId) {
        const key = `${this.prefixes.FARM}${farmId}`;
        return this.get(key);
    }

    /**
     * Cache farm details
     * @param {string} farmId 
     * @param {Object} farmData 
     * @param {number} ttl - Default 30 minutes
     */
    async setFarmDetails(farmId, farmData, ttl = 1800) {
        const key = `${this.prefixes.FARM}${farmId}`;
        await this.set(key, farmData, ttl);
    }

    /**
     * Invalidate farm cache
     * @param {string} farmId 
     */
    async invalidateFarm(farmId) {
        await this.del(`${this.prefixes.FARM}${farmId}`);
    }

    // APPLICATION CACHE

    /**
     * Get cached application queue stats
     * @returns {Promise<Object|null>}
     */
    async getApplicationQueueStats() {
        const key = `${this.prefixes.APPLICATION}queue:stats`;
        return this.get(key);
    }

    /**
     * Cache application queue stats
     * @param {Object} stats 
     * @param {number} ttl - Default 5 minutes
     */
    async setApplicationQueueStats(stats, ttl = 300) {
        const key = `${this.prefixes.APPLICATION}queue:stats`;
        await this.set(key, stats, ttl);
    }

    /**
     * Invalidate application caches
     */
    async invalidateApplicationCache() {
        await this.delPattern(`${this.prefixes.APPLICATION}*`);
    }

    // ANALYTICS CACHE

    /**
     * Get cached analytics data
     * @param {string} metric - e.g., 'farmCount', 'certificationRate'
     * @param {string} period - e.g., 'daily', 'weekly', 'monthly'
     * @returns {Promise<Object|null>}
     */
    async getAnalytics(metric, period) {
        const key = `${this.prefixes.ANALYTICS}${metric}:${period}`;
        return this.get(key);
    }

    /**
     * Cache analytics data
     * @param {string} metric
     * @param {string} period
     * @param {Object} data
     * @param {number} ttl - Default 1 hour
     */
    async setAnalytics(metric, period, data, ttl = 3600) {
        const key = `${this.prefixes.ANALYTICS}${metric}:${period}`;
        await this.set(key, data, ttl);
    }

    /**
     * Invalidate every analytics cache entry.
     *
     * Wide pattern (`analytics:*`) covers both:
     *   - The structured `getAnalytics` / `setAnalytics` keys
     *     (e.g. `analytics:farmCount:daily`)
     *   - The free-form keys used by the routes layer
     *     (`analytics:dashboard`, `analytics:geo:farms:plantTypeX:certY:periodZ`)
     *
     * Caller responsibility: invoke after any mutation that changes the
     * inputs to those queries — Farm CRUD, Certificate issue/revoke,
     * Application status transitions. Cheap operation (Redis SCAN +
     * unlink), runs out-of-band of the request response.
     */
    async invalidateAnalyticsCache() {
        await this.delPattern(`${this.prefixes.ANALYTICS}*`);
    }

    // CACHE WARMING

    /**
     * Warm up frequently accessed caches
     * Call this on application startup
     */
    async warmUpCache() {
        logger.info('Starting cache warm-up');
        
        try {
            // Warm up master data
            const { prisma } = require('./prisma-database');
            
            // Plant species
            const plantSpecies = await prisma.plantSpecies.findMany({
                where: { isActive: true },
                select: { id: true, code: true, nameTH: true, nameEN: true },
            });
            await this.setMasterData('plantSpecies', plantSpecies);
            
            // Provinces
            const provinces = await prisma.farm.findMany({
                distinct: ['province'],
                select: { province: true },
                where: { isDeleted: false },
            });
            await this.setMasterData('provinces', provinces.map(p => p.province));
            
            logger.info('Cache warm-up completed');
        } catch (error) {
            logger.error({ error }, 'Cache warm-up failed');
        }
    }

    // CACHE STATISTICS

    /**
     * Get cache statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        try {
            const info = await this.redis.info('memory');
            const keys = await this.redis.keys('*');
            
            return {
                totalKeys: keys.length,
                memoryInfo: info,
                prefixes: {
                    certificates: keys.filter(k => k.startsWith(this.prefixes.CERTIFICATE)).length,
                    traceability: keys.filter(k => k.startsWith(this.prefixes.TRACEABILITY)).length,
                    masterData: keys.filter(k => k.startsWith(this.prefixes.MASTER_DATA)).length,
                    farms: keys.filter(k => k.startsWith(this.prefixes.FARM)).length,
                    applications: keys.filter(k => k.startsWith(this.prefixes.APPLICATION)).length,
                    analytics: keys.filter(k => k.startsWith(this.prefixes.ANALYTICS)).length,
                },
            };
        } catch (error) {
            logger.error({ error }, 'Cache stats error');
            return { error: error.message };
        }
    }

    /**
     * Clear all caches (use with caution)
     */
    async clearAll() {
        try {
            await this.redis.flushdb();
            logger.warn('All caches cleared');
        } catch (error) {
            logger.error({ error }, 'Cache clear error');
        }
    }
}

// Singleton instance
const cacheService = new CacheService();

module.exports = cacheService;
