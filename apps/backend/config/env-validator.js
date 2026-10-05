/**
 * Environment validation for startup safety.
 *
 * Canonical identity naming:
 * - Health JWT: HEALTH_JWT_SECRET (legacy: HEALTH_JWT_SECRET, JWT_SECRET)
 * - Provider JWT: PROVIDER_JWT_SECRET (legacy: DTAM_JWT_SECRET)
 */

const { createLogger } = require('../shared/logger');
const logger = createLogger('env-validator');

const PRODUCTION_REQUIRED = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'REDIS_URL',
];

const PRODUCTION_RECOMMENDED = [
  'HMAC_KEY',
  'MASTER_ENCRYPTION_KEY',
  'BCRYPT_ROUNDS',
  'SESSION_SECRET',
  'COOKIE_DOMAIN',
  // Not listed: SENTRY_DSN. Error tracking (Sentry) was re-added 2026-10-02 by
  // operator decision, with PII scrubbing, and is OFF unless SENTRY_DSN is set
  // — so a missing DSN is the intended default, not a warning. When it IS set,
  // validateSentryDsn() below warns if it is not a usable DSN. Reader:
  // config/sentry.js; runbook: docs/operations/sentry-error-tracking.md.
];

function resolveHealthJwtSecret() {
  return process.env.HEALTH_JWT_SECRET || process.env.JWT_SECRET;
}

function resolveProviderJwtSecret() {
  return process.env.PROVIDER_JWT_SECRET || process.env.DTAM_JWT_SECRET;
}

/**
 * SENTRY_DSN is optional (unset = error tracking off). When it is set it must
 * look like a DSN — `https://<public key>@<host>/<project id>` — or the SDK
 * silently stays off and nobody notices. Returns a warning, never the value.
 */
function validateSentryDsn(raw = process.env.SENTRY_DSN) {
  const dsn = typeof raw === 'string' ? raw.trim() : '';
  if (!dsn) {return null;}
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.split('/').filter(Boolean).pop();
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.username && projectId && /^\d+$/.test(projectId)) {
      return null;
    }
  } catch {
    // fall through
  }
  return 'SENTRY_DSN is set but is not a usable DSN (https://<key>@<host>/<project id>) — error tracking will not start.';
}

function validateEnvironment(nodeEnv = process.env.NODE_ENV || 'development') {
  const isDevelopment = nodeEnv === 'development' || nodeEnv === 'test';
  const isProduction = nodeEnv === 'production';

  const result = {
    isValid: true,
    errors: [],
    warnings: [],
    mode: nodeEnv,
  };

  if (isProduction) {
    for (const variable of PRODUCTION_REQUIRED) {
      if (!process.env[variable]) {
        result.isValid = false;
        result.errors.push(`CRITICAL: ${variable} is required in production`);
      }
    }

    const healthJwtSecret = resolveHealthJwtSecret();
    const providerJwtSecret = resolveProviderJwtSecret();

    if (!healthJwtSecret) {
      result.isValid = false;
      result.errors.push(
        'CRITICAL: HEALTH_JWT_SECRET is required (fallbacks: HEALTH_JWT_SECRET or JWT_SECRET)',
      );
    }

    if (!providerJwtSecret) {
      result.isValid = false;
      result.errors.push(
        'CRITICAL: PROVIDER_JWT_SECRET is required (fallback: DTAM_JWT_SECRET)',
      );
    }

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (encryptionKey && encryptionKey.length < 32) {
      result.isValid = false;
      result.errors.push(`ENCRYPTION_KEY must be at least 32 chars (current: ${encryptionKey.length})`);
    }

    if (healthJwtSecret && healthJwtSecret.length < 32) {
      result.warnings.push(
        `Health JWT secret is shorter than 32 chars (${healthJwtSecret.length}).`,
      );
    }

    if (providerJwtSecret && providerJwtSecret.length < 32) {
      result.warnings.push(
        `Provider JWT secret is shorter than 32 chars (${providerJwtSecret.length}).`,
      );
    }

    for (const variable of PRODUCTION_RECOMMENDED) {
      if (!process.env[variable]) {
        result.warnings.push(`${variable} is not set (recommended).`);
      }
    }

    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl && (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1'))) {
      result.warnings.push('DATABASE_URL points to localhost. Verify this for production.');
    }

    const corsOrigin = process.env.CORS_ORIGIN;
    if (corsOrigin === '*') {
      result.isValid = false;
      result.errors.push('CORS_ORIGIN cannot be "*" in production.');
    }

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl && !redisUrl.startsWith('redis://')) {
      result.warnings.push('REDIS_URL format should start with redis://');
    }
  }

  const sentryDsnWarning = validateSentryDsn();
  if (sentryDsnWarning) {
    result.warnings.push(sentryDsnWarning);
  }

  if (isDevelopment) {
    if (!resolveHealthJwtSecret()) {
      result.warnings.push(
        'No health JWT secret found (HEALTH_JWT_SECRET/JWT_SECRET). Dev fallback will be used.',
      );
    }

    if (!resolveProviderJwtSecret()) {
      result.warnings.push(
        'No provider JWT secret found (PROVIDER_JWT_SECRET/DTAM_JWT_SECRET). Dev fallback will be used.',
      );
    }

    if (!process.env.ENCRYPTION_KEY) {
      result.warnings.push('ENCRYPTION_KEY not set. Dev fallback key will be used.');
    }
  }

  return result;
}

function logValidationResults(result) {
  const { mode, isValid, errors, warnings } = result;

  logger.info(`\n${'='.repeat(80)}`);
  logger.info('  ENVIRONMENT VALIDATION REPORT');
  logger.info(`  Mode: ${mode} | Status: ${isValid ? 'VALID' : 'INVALID'}`);
  logger.info(`${'='.repeat(80)}\n`);

  if (errors.length > 0) {
    logger.error('CRITICAL ERRORS:');
    errors.forEach((message) => logger.error(`  ${message}`));
    logger.error('');
  }

  if (warnings.length > 0) {
    logger.warn('WARNINGS:');
    warnings.forEach((message) => logger.warn(`  ${message}`));
    logger.warn('');
  }

  if (isValid && warnings.length === 0) {
    logger.info('Environment variables look good.\n');
  } else if (isValid) {
    logger.info('Environment is valid with warnings.\n');
  }

  if (!isValid && mode === 'production') {
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }
}

function initializeEnvironment() {
  const result = validateEnvironment();
  logValidationResults(result);
  return result;
}

function getSecret(key, defaultValue = null) {
  const value = process.env[key];
  if (!value && defaultValue === null) {
    throw new Error(`Required secret ${key} not found`);
  }
  return value || defaultValue;
}

module.exports = {
  validateEnvironment,
  validateSentryDsn,
  logValidationResults,
  initializeEnvironment,
  getSecret,
  PRODUCTION_REQUIRED,
  PRODUCTION_RECOMMENDED,
};
