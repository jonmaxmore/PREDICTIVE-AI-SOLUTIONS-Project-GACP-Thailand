/**
 * Jest test harness setup for the backend service.
 * - Normalises environment variables for integration tests
 * - Registers deterministic clean-up hooks for Prisma (PostgreSQL), Redis, and Express servers
 * - Reduces noisy console output while preserving warnings/errors
 */

const cleanupTasks = [];

function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    const message = error && error.code === 'MODULE_NOT_FOUND' ? 'not found' : error.message;
    console.warn(`[jest-setup] Optional module load skipped (${modulePath}): ${message}`);
    return null;
  }
}

function registerCleanup(task) {
  if (typeof task === 'function') {
    cleanupTasks.push(task);
  }
}

async function runCleanupTasks() {
  while (cleanupTasks.length) {
    const task = cleanupTasks.pop();
    try {
       
      await task();
    } catch (error) {
      console.warn(`[jest-setup] Cleanup task failed: ${error.message}`);
    }
  }
}

globalThis.registerBackendCleanup = registerCleanup;

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// A test run must never reach a live database.
//
// 2026-08-23: nine DTAM-REMIT journal entries totalling 45,000 THB were found in
// the production Supabase ledger — six of them written in a single day. They came
// from journal-entry-service.test.js, which does exactly what it says: it writes
// journal entries. Nothing was wrong with the test. This file normalised every
// environment variable that matters EXCEPT the one that decides which database the
// suite talks to, so the suite inherited the developer's .env and posted real
// double-entry rows into the real book. Money records cannot be un-posted; they had
// to be identified, exported and deleted by hand.
//
// The rule: only a database on this machine is a test database. Anything reachable
// over the network is somebody's real data, whoever set it up and for whatever
// reason.
//
// The remote URL is OVERWRITTEN with a local one, not deleted. Deleting it does not
// work and is worse than doing nothing: Prisma falls back to reading .env off disk
// when DATABASE_URL is absent from the environment, so unsetting the variable hands
// the suite straight back to the developer's live database while looking like a
// guard. Verified the hard way — the first version of this block deleted the
// variable and the very next test run posted another remittance entry to Supabase.
//
// If no local postgres is listening, integration tests fail on connection refused.
// That is the intended outcome: a red test you must deal with, rather than a green
// test that quietly wrote to production.
//
// ALLOW_REMOTE_TEST_DATABASE=1 exists for the one case where someone genuinely
// means it. It is not a convenience flag; set it and the suite can write to
// whatever it is pointed at.
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db', 'host.docker.internal']);
const LOCAL_TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://gacp:gacp@127.0.0.1:5432/gacp_e2e_test?schema=public';
if (process.env.ALLOW_REMOTE_TEST_DATABASE !== '1') {
  const current = process.env.DATABASE_URL;
  let host = null;
  if (current) {
    try {
      host = new URL(current).hostname;
    } catch {
      host = null; // unparseable is not provably local, so treat it as remote
    }
  }
  const isLocal = Boolean(host) && LOCAL_DB_HOSTS.has(host);

  if (!isLocal) {
    // An ABSENT DATABASE_URL is just as dangerous as a remote one, and this is the
    // part that is easy to get wrong: jest does not load .env, so the variable is
    // usually unset when this file runs — but @prisma/client loads .env itself when
    // it is imported, minutes later in module time, and injects the developer's live
    // URL into process.env. A guard that only acts on a remote-looking value sees an
    // empty variable here, concludes there is nothing to do, and the suite still ends
    // up on production. Pinning the value now is what makes Prisma's own .env loading
    // lose. Both earlier versions of this block failed exactly here, and each failure
    // cost another real journal entry.
    console.warn(
      current
        ? `[jest-setup] DATABASE_URL points at "${host || 'an unparseable host'}", which is not this machine.\n` +
            '[jest-setup] Redirecting the suite to a local test database: tests write real rows.\n' +
            '[jest-setup] Set TEST_DATABASE_URL for a different local target, or ALLOW_REMOTE_TEST_DATABASE=1 if you mean it.'
        : '[jest-setup] DATABASE_URL is unset; pinning it to a local test database so that\n' +
            '[jest-setup] @prisma/client cannot load a live URL out of .env when it is imported.',
    );
    process.env.DATABASE_URL = LOCAL_TEST_DATABASE_URL;
  }
}

process.env.STORAGE_TYPE = 'local';
process.env.STORAGE_LOCAL_PATH = './test-uploads';
process.env.ENABLE_QUEUE = 'false';
process.env.ENABLE_CACHE = 'false';
// shared/encryption.js throws at module load when ENCRYPTION_KEY is unset.
// __tests__/unit/encryption.test.js requires the module directly, so the
// suite hard-fails before any test runs (jest can't load the file). The
// env var is the only thing missing — fixing it here keeps the test
// hermetic without needing a docker-compose harness.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-chars-long-1';

// The test run gets its OWN signing key, outside the repository.
//
// 2026-08-26: it did not, and that cost a real certificate. Integration suites that mint
// certificates against a real database reached apps/backend/keys — the box's actual
// signing key — and a key there that could not be decrypted was regenerated on the spot.
// `npx jest` therefore rotated the certifying authority, and GACP-TH-2569-CAE820, signed
// the previous afternoon through a pressed journey, became permanently unverifiable.
//
// Pointing the whole run at a directory under the OS temp dir keeps what those tests
// actually need — real RSA signing and verification, not stubs — while making it
// impossible for a test to touch the key real certificates depend on. The directory is
// stable rather than per-run so a key generated by one suite still verifies in the next,
// and signature-service refuses apps/backend/keys outright under NODE_ENV=test, so a new
// test that bypasses this fails loudly instead of silently rotating the key again.
//
// 2026-09-11: the directory was one fixed path for the whole box, so two checkouts of
// this repo (a worktree beside the main tree) shared ONE key while each generated its
// own dev passphrase — the second tree's run then failed every certificate test with
// `bad decrypt`, and the honest refusal in signature-service is what stopped it from
// "fixing" that by overwriting the first tree's key. Scoping the directory by repo path
// keeps every property above (under the OS temp dir, stable across runs, never
// apps/backend/keys) and removes the collision.
const SIGNING_KEY_SCOPE = require('crypto')
  .createHash('sha256')
  .update(require('path').resolve(__dirname))
  .digest('hex')
  .slice(0, 12);
process.env.SIGNING_KEY_DIR = process.env.SIGNING_KEY_DIR
  || require('path').join(require('os').tmpdir(), `gacp-jest-signing-key-${SIGNING_KEY_SCOPE}`);

// Prisma (PostgreSQL) cleanup
const prisma = safeRequire('@prisma/client');
const redisService = safeRequire('./services/redis-service');

if (prisma) {
  registerCleanup(async () => {
    try {
      const { PrismaClient } = prisma;
      const client = new PrismaClient();
      await client.$disconnect();
    } catch (e) {
      console.warn(`[jest-setup] Prisma cleanup: ${e.message}`);
    }
  });
}

if (redisService && typeof redisService.disconnect === 'function') {
  registerCleanup(async () => {
    await redisService.disconnect();
  });
}

registerCleanup(async () => {
  const server = global.__APP_SERVER__;
  if (server && typeof server.close === 'function') {
    await new Promise(resolve => server.close(resolve));
  }
});

const originalConsole = { ...console };

global.console = {
  ...console,
  error: originalConsole.error,
  warn: originalConsole.warn,
  info: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

afterAll(async () => {
  await runCleanupTasks();
  global.console = originalConsole;
  jest.useRealTimers();
  jest.clearAllTimers();
  jest.clearAllMocks();
  await new Promise(resolve => setTimeout(resolve, 250));
});

jest.setTimeout(30000);
