/**
 * @jest-environment node
 */
/**
 * src/lib/config/sentry.ts is the ONE place the web app reads Sentry settings
 * from the environment (privacy review 2026-10-02, Minor 5).
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { sentryServerRuntimeEnv } from '@/lib/config/sentry';

const SAVED = { ...process.env };

afterEach(() => {
    for (const k of ['SENTRY_ENVIRONMENT', 'GIT_SHA']) {
        if (SAVED[k] === undefined) delete process.env[k];
        else process.env[k] = SAVED[k];
    }
});

describe('sentryServerRuntimeEnv', () => {
    it('reads SENTRY_ENVIRONMENT and GIT_SHA at call time, trimmed', () => {
        process.env.SENTRY_ENVIRONMENT = ' staging ';
        process.env.GIT_SHA = 'abc123\n';
        expect(sentryServerRuntimeEnv()).toMatchObject({ environment: 'staging', release: 'abc123' });
    });

    it('treats blank as unset', () => {
        process.env.SENTRY_ENVIRONMENT = '  ';
        delete process.env.GIT_SHA;
        const env = sentryServerRuntimeEnv();
        expect(env.environment).toBeUndefined();
        expect(env.release).toBeUndefined();
    });
});

describe('no Sentry module reads process.env itself', () => {
    it('src/lib/sentry/*.ts and the instrumentation files go through src/lib/config/sentry.ts', () => {
        const root = path.join(__dirname, '..', '..', '..');
        const files = [
            ...fs.readdirSync(path.join(root, 'lib', 'sentry')).filter((f) => f.endsWith('.ts')).map((f) => path.join(root, 'lib', 'sentry', f)),
            path.join(root, 'instrumentation-client.ts'),
        ];
        for (const file of files) {
            expect({ file: path.basename(file), reads: /process\.env/.test(fs.readFileSync(file, 'utf8')) }).toEqual({ file: path.basename(file), reads: false });
        }
    });
});
