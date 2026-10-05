const { PrismaClient } = require('@prisma/client');
// Env-only: never ship a hardcoded DSN fallback (was a committed secret-looking
// literal that matched no real DB). Operator must pass SHADOW_ADMIN_URL explicitly.
const url = process.env.SHADOW_ADMIN_URL;
if (!url) {
    console.error('SHADOW_ADMIN_URL is required (e.g. postgresql://USER:PW@localhost:5432/postgres). Refusing to run without it.');
    process.exit(1);
}
const target = process.env.SHADOW_DB_NAME || 'gacp_drift_shadow';
const c = new PrismaClient({ datasources: { db: { url } } });
(async () => {
    try {
        try { await c.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${target}"`); } catch (_) {}
        await c.$executeRawUnsafe(`CREATE DATABASE "${target}"`);
        console.log(`shadow ready: ${target}`);
    } catch (e) {
        console.error('failed:', e.message);
        process.exitCode = 1;
    } finally {
        await c.$disconnect();
    }
})();
