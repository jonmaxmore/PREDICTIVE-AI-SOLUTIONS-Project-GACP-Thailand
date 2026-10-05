/**
 * Frontend Logger Utility
 *
 * Strips debug/info logs in production builds to prevent
 * leaking internal state to browser DevTools.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Auth token refreshed');   // stripped in prod
 *   logger.warn('Deprecation warning');    // kept in prod
 *   logger.error('API call failed', err);  // kept in prod
 */

const isDev = process.env.NODE_ENV !== 'production';

/* eslint-disable no-console */
export const logger = {
    /** Debug info — stripped in production */
    info: (...args: unknown[]) => {
        if (isDev) { console.log('[GACP]', ...args); }
    },
    /** Debug log — stripped in production */
    log: (...args: unknown[]) => {
        if (isDev) { console.log('[GACP]', ...args); }
    },
    /** Warnings — always shown */
    warn: (...args: unknown[]) => {
        console.warn('[GACP]', ...args);
    },
    /** Errors — always shown */
    error: (...args: unknown[]) => {
        console.error('[GACP]', ...args);
    },
};
/* eslint-enable no-console */

export default logger;
