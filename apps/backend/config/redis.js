/**
 * Redis Client (ioredis)
 *
 * Simple, reliable Redis connection for:
 * - Cache service (cache-service.js)
 * - Rate limiter (middleware/rate-limiter.js)
 * - Idempotency (middleware/idempotency.js)
 *
 * Uses REDIS_URL from environment (e.g. redis://redis:6379)
 * Falls back gracefully to null if Redis is unavailable.
 */

const Redis = require('ioredis');
const logger = require('../shared/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let client = null;

// In test mode, skip opening a real Redis socket at module load — it leaves
// a connecting TCP handle that prevents Jest workers from exiting gracefully
// ("worker has failed to exit gracefully"). Production paths are unchanged.
if (process.env.NODE_ENV !== 'test') {
  try {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) {
          logger.warn('[Redis] Max retries reached — giving up reconnection');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 5000); // Exponential backoff, max 5s
      },
      lazyConnect: false,
      enableReadyCheck: true,
      connectTimeout: 10000,
    });

    client.on('connect', () => {
      logger.info('[Redis] Connected to ' + REDIS_URL.replace(/\/\/.*@/, '//<credentials>@'));
    });

    client.on('ready', () => {
      logger.info('[Redis] Ready — accepting commands');
    });

    client.on('error', (err) => {
      logger.error('[Redis] Connection error:', err.message);
    });

    client.on('close', () => {
      logger.warn('[Redis] Connection closed');
    });
  } catch (err) {
    logger.error('[Redis] Failed to create client:', err.message);
    client = null;
  }
}

module.exports = client;
