/**
 * BE-#8 — storage must NOT silently downgrade to pod-local disk in production.
 *
 * When STORAGE_PROVIDER=minio and NODE_ENV=production, a missing-credentials
 * condition or a runtime upload failure must THROW (so cert/invoice issuance
 * surfaces the error) instead of quietly writing to a single replica's
 * ephemeral disk. Dev/test keep the convenient local fallback, and an explicit
 * STORAGE_ALLOW_LOCAL_FALLBACK=true escape hatch restores the old behaviour.
 *
 * The provider/cloud-enabled flags are read at module load, so each case loads
 * the module in isolation with the env it needs.
 */

let mockPutObject;
jest.mock('minio', () => ({
    Client: jest.fn().mockImplementation(() => ({
        putObject: (...args) => mockPutObject(...args),
    })),
}));
jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
// Keep the local-fallback cases from writing real files into public/uploads —
// stub the disk-write surface (the assertions only care about the returned
// `storage` field / thrown error, never the file's existence).
jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    return {
        ...real,
        existsSync: () => true,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
    };
});

const ENV_KEYS = [
    'STORAGE_PROVIDER', 'NODE_ENV', 'STORAGE_ALLOW_LOCAL_FALLBACK',
    'S3_ACCESS_KEY', 'S3_SECRET_KEY',
];

function loadStorageWith(env) {
    const saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; }
    for (const k of ENV_KEYS) { delete process.env[k]; }
    Object.assign(process.env, env);
    let mod;
    jest.isolateModules(() => { mod = require('../../services/storage-service'); });
    const restore = () => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) { delete process.env[k]; }
            else { process.env[k] = saved[k]; }
        }
    };
    return { mod, restore };
}

beforeEach(() => { mockPutObject = jest.fn(async () => ({ etag: 'ok' })); });

describe('BE-#8 storage-service — no silent downgrade in production', () => {
    it('THROWS STORAGE_CLOUD_UNAVAILABLE when prod+minio but credentials missing', async () => {
        const { mod, restore } = loadStorageWith({
            STORAGE_PROVIDER: 'minio', NODE_ENV: 'production',
            // no S3 creds
        });
        try {
            await expect(mod.uploadBuffer('gacp-pdfs', 'a/b.pdf', Buffer.from('x')))
                .rejects.toMatchObject({ code: 'STORAGE_CLOUD_UNAVAILABLE' });
        } finally { restore(); }
    });

    it('THROWS STORAGE_UPLOAD_FAILED when prod+minio upload errors (no local fallback)', async () => {
        mockPutObject = jest.fn(async () => { throw new Error('connection refused'); });
        const { mod, restore } = loadStorageWith({
            STORAGE_PROVIDER: 'minio', NODE_ENV: 'production',
            S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's',
        });
        try {
            await expect(mod.uploadBuffer('gacp-pdfs', 'a/b.pdf', Buffer.from('x')))
                .rejects.toMatchObject({ code: 'STORAGE_UPLOAD_FAILED' });
        } finally { restore(); }
    });

    it('KEEPS local fallback in test/dev (provider=minio, no creds) — returns storage:local', async () => {
        const { mod, restore } = loadStorageWith({
            STORAGE_PROVIDER: 'minio', NODE_ENV: 'test',
        });
        try {
            const res = await mod.uploadBuffer('gacp-pdfs', 'a/b.pdf', Buffer.from('x'));
            expect(res.storage).toBe('local');
        } finally { restore(); }
    });

    it('honours STORAGE_ALLOW_LOCAL_FALLBACK=true in production (opt-out escape hatch)', async () => {
        const { mod, restore } = loadStorageWith({
            STORAGE_PROVIDER: 'minio', NODE_ENV: 'production',
            STORAGE_ALLOW_LOCAL_FALLBACK: 'true',
        });
        try {
            const res = await mod.uploadBuffer('gacp-pdfs', 'a/b.pdf', Buffer.from('x'));
            expect(res.storage).toBe('local');
        } finally { restore(); }
    });

    it('local provider (no cloud) is unaffected — returns storage:local', async () => {
        const { mod, restore } = loadStorageWith({
            STORAGE_PROVIDER: 'local', NODE_ENV: 'production',
        });
        try {
            const res = await mod.uploadBuffer('gacp-pdfs', 'a/b.pdf', Buffer.from('x'));
            expect(res.storage).toBe('local');
        } finally { restore(); }
    });
});
