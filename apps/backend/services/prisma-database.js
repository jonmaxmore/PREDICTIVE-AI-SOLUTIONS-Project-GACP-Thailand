/**
 * Prisma Database Service - Docker Production Only
 * No local database fallback - strictly containerized
 * @version 3.0.0 - GACP Thai Standard
 */

let PrismaClient;
let _prismaStubbed = false;

// True under jest (jest always sets JEST_WORKER_ID) or explicit test env.
const IS_TEST_ENV = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

// Engine-less noop stub: every model/method access resolves to null, so
// requiring this module under test never needs a generated client, a
// DATABASE_URL, or a running Postgres. Shared by every test-env fallback
// branch below — production/dev branches still hard-exit (Docker-only stance).
const noopPrisma = new Proxy({}, {
  get: () => new Proxy(() => Promise.resolve(null), {
    get: () => () => Promise.resolve(null),
  }),
});

function stubForTests() {
  module.exports = { prisma: noopPrisma };
  _prismaStubbed = true;
}

try {
  PrismaClient = require('@prisma/client').PrismaClient;
} catch (_e) {
  if (IS_TEST_ENV) {
    // In test env: export the proxy stub so tests don't crash
    stubForTests();
  } else {
    console.error('FATAL: @prisma/client not generated. Run: npx prisma generate');
    process.exit(1);
  }
}

if (!_prismaStubbed) {

const { createLogger } = require('../shared/logger');
const logger = createLogger('prisma-database');

// Docker Production Only - No local fallback
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    if (IS_TEST_ENV) {
        // Engine-less test mode: fall through to the noop stub instead of exiting.
        stubForTests();
    } else {
        logger.error('FATAL: DATABASE_URL environment variable is required');
        logger.error('   This system runs ONLY in Docker containers');
        logger.error('   Please ensure docker-compose.yml sets DATABASE_URL correctly');
        process.exit(1);
    }
} else if (!DATABASE_URL.includes('postgres') && !DATABASE_URL.includes('postgresql')) {
    // Validate Docker environment
    if (IS_TEST_ENV) {
        stubForTests();
    } else {
        logger.error('FATAL: Invalid DATABASE_URL format');
        process.exit(1);
    }
}

if (!_prismaStubbed) {

logger.info('PRISMA INIT - Docker Production Mode');
logger.info('   URL:', DATABASE_URL.replace(/:[^:@]+@/, ':***@'));

// Connection pool tuning (default is only 5 connections — far too low)
const POOL_SIZE = parseInt(process.env.PRISMA_POOL_SIZE, 10) || 20;
const POOL_TIMEOUT = parseInt(process.env.PRISMA_POOL_TIMEOUT, 10) || 15;
const poolParams = `connection_limit=${POOL_SIZE}&pool_timeout=${POOL_TIMEOUT}`;
const pooledUrl = DATABASE_URL + (DATABASE_URL.includes('?') ? '&' : '?') + poolParams;

logger.info(`   Pool: ${POOL_SIZE} connections, ${POOL_TIMEOUT}s timeout`);

// F-TX-DEFAULT-5S (Phase 0 walk-2 2026-08-19): Prisma's 5-second
// interactive-transaction default aborted three separate REAL-walk hops over
// Supabase latency — the checkout settle (F-SETTLE-TX-LOST, fixed per-call),
// the onsite decision + cert mint (P2028), and the work-inbox
// APPROVED→CERTIFIED advance ("Transaction not found" mid-tx). Every one of
// those txs bundles a status write + canonical audit + side-effects, which is
// the normal shape here — so raise the DEFAULT for every interactive tx on
// this shared client instead of patching call-sites one by one. Explicit
// per-call options (e.g. SETTLEMENT.TX_TIMEOUT_MS) still override.
const TRANSACTION_OPTIONS = { timeout: 30000, maxWait: 10000 };

// Prisma Client with production settings
const basePrisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['error', 'warn'],
    datasources: {
        db: {
            url: pooledUrl,
        },
    },
    transactionOptions: TRANSACTION_OPTIONS,
});

// Tenant scoping (ADR-014, Phase 2). The extension is a no-op when no tenant
// context is bound — scripts, migrations, and tests behave exactly as before.
// Tenant context is bound by middleware/tenant-context-middleware.js once
// per authenticated request.
const { tenantInjectExtension } = require('./tenant-prisma-extension');
// Soft-delete auto-filter (Wave A Phase 16, G11). Default-hides tombstoned
// rows on read/aggregate/updateMany operations. Opt-out via withDeletedRows()
// or by passing where.isDeleted explicitly. See soft-delete-extension.js.
const { softDeleteFilterExtension } = require('./soft-delete-extension');
// PDPA field-encryption (Tier 5). Transparent AES-256-GCM at-rest encryption
// for Phase-1 User PII columns. No-op when ENABLE_PDPA_FIELD_ENCRYPTION!='true'
// (returns the input client unchanged), so default behavior is unchanged
// until ops flips the env var ON post-backfill. Applied LAST so the
// encryption wrappers see the already-tenant-scoped + soft-delete-filtered
// query stream.
const { createPdpaEncryptedClient } = require('./prisma-pdpa-extension');
// Plot permanent code (มกษ. 3502-2561 ข้อ 8(1)). Mints Plot.plotCode on any create /
// createMany / upsert-create that did not bring one, so a plot cannot come into existence
// without the identifier its field sign is printed from — whichever route created it. Its
// position in this chain is not load-bearing: the hook only ADDS a field none of the other
// three extensions read, and on the (essentially never) collision retry it re-runs the rest of
// the chain, whose injections are idempotent on the same args. See plot-code-extension.js.
const { plotCodeExtension } = require('./plot-code-extension');
const prisma = createPdpaEncryptedClient(
    basePrisma
        .$extends(plotCodeExtension)
        .$extends(tenantInjectExtension)
        .$extends(softDeleteFilterExtension),
);

// Connection state tracking for sync getStatus.
// Keep a small failure window to avoid flapping all APIs to 503 on transient probes.
const connectionState = {
    connected: false,
    since: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
};

// Connection retry logic for Docker startup
async function connectWithRetry(maxRetries = 10, delayMs = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await prisma.$connect();
            logger.info('Connected to PostgreSQL via Prisma (Docker)');
            // Update connection state for getStatus()
            connectionState.connected = true;
            connectionState.since = new Date().toISOString();
            connectionState.lastSuccessAt = new Date().toISOString();
            connectionState.lastFailureAt = null;
            connectionState.consecutiveFailures = 0;
            return true;
        } catch (error) {
            logger.error(`Failed to connect to PostgreSQL (Attempt ${attempt}/${maxRetries}): ${error.message}`);
            
            if (attempt === maxRetries) {
                logger.error('Max retries reached. Database connection failed.');
                logger.error('   Please ensure:');
                logger.error('   1. Docker container "gacp-postgres" is running');
                logger.error('   2. DATABASE_URL in docker-compose.yml is correct');
                logger.error('   3. No firewall blocking port 5432 between containers');
                process.exit(1);
            }
            
            logger.info(`Retrying in ${delayMs / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return false;
}

// Health check function
async function checkHealthRaw() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'connected', type: 'postgresql' };
    } catch (error) {
        return { status: 'disconnected', error: error.message };
    }
}

// Graceful shutdown — handled by server.js gracefulShutdown()
// Do NOT register SIGINT/SIGTERM here to avoid racing with server.js.
async function disconnect() {
    if (prisma) {
        await prisma.$disconnect();
        logger.info('Prisma disconnected');
    }
}

// Backward compatibility
async function connect() {
    return connectWithRetry();
}

// Update cached connection state whenever health is requested
async function checkHealth() {
    const result = await checkHealthRaw();
    const nowIso = new Date().toISOString();
    const isConnected = result.status === 'connected';

    if (isConnected) {
        connectionState.connected = true;
        connectionState.lastSuccessAt = nowIso;
        connectionState.lastFailureAt = null;
        connectionState.consecutiveFailures = 0;
        if (!connectionState.since) {
            connectionState.since = nowIso;
        }
        return result;
    }

    connectionState.lastFailureAt = nowIso;
    connectionState.consecutiveFailures += 1;

    // Before first successful connection, report unavailable immediately.
    if (!connectionState.lastSuccessAt) {
        connectionState.connected = false;
        return result;
    }

    // After startup, require multiple consecutive failures and a grace period
    // before marking DB unavailable for request gating.
    const failureWindowMs = Date.now() - new Date(connectionState.lastSuccessAt).getTime();
    const shouldMarkDisconnected =
        connectionState.consecutiveFailures >= 3 && failureWindowMs > 15000;

    if (shouldMarkDisconnected) {
        connectionState.connected = false;
    }

    return result;
}

// Synchronous getStatus for middleware (returns cached state)
function getStatus() {
    return connectionState.connected;
}

// Legacy accessor retained for old route modules.
function getClient() {
    return prisma;
}

// Alias for routes/api/index.js
const healthCheck = checkHealth;

module.exports = {
    prisma,
    TRANSACTION_OPTIONS, // interactive-tx defaults (F-TX-DEFAULT-5S) — pinned by __tests__/unit/prisma-tx-defaults.test.js (source-scan; loading this module in a unit test would construct a real client)
    // Un-extended PrismaClient — bypasses tenant scoping, soft-delete filter,
    // AND the PDPA field-encryption extension. Used by maintenance scripts
    // that need raw row access (e.g. scripts/pdpa/backfill-encrypt-user-pii.js
    // manually encrypts PII via encryptValue() before writing, so it must
    // NOT pass through the encrypting extension again). Do NOT use from
    // request handlers — they need the tenant + soft-delete guards.
    basePrisma,
    connect,
    connectWithRetry,
    checkHealth,
    healthCheck, // Backward compatibility
    getClient,   // Backward compatibility
    getStatus,   // Backward compatibility
    disconnect,  // Called by server.js gracefulShutdown
};
} // end engine-less guard (DATABASE_URL missing/invalid under test)
} // end if (!_prismaStubbed)
