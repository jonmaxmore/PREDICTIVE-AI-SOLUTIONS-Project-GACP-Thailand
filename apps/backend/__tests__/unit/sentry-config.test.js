/**
 * config/sentry.js — what the backend initialises Sentry with, and where
 * server.js calls it.
 *
 * The wire behaviour (envelope contents, zero sends when off) is measured in
 * sentry-express-envelope.test.js against a real SDK in a child process. This
 * file pins the configuration contract and the server.js wiring order, which a
 * child-process fixture cannot see.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { readSentryConfig, buildSentryOptions, DEFAULT_TRACES_SAMPLE_RATE } = require('../../config/sentry');

describe('readSentryConfig — off unless a DSN is set', () => {
    it.each([
        ['missing', {}],
        ['empty', { SENTRY_DSN: '' }],
        ['whitespace', { SENTRY_DSN: '  \n' }],
    ])('is disabled when SENTRY_DSN is %s', (_label, env) => {
        expect(readSentryConfig(env)).toEqual({ enabled: false });
    });

    it('is enabled with the DSN trimmed', () => {
        const config = readSentryConfig({ SENTRY_DSN: ' https://k@o1.ingest.example.test/2 ' });
        expect(config.enabled).toBe(true);
        expect(config.dsn).toBe('https://k@o1.ingest.example.test/2');
    });
});

describe('readSentryConfig — release, environment, traces', () => {
    const DSN = 'https://k@o1.ingest.example.test/2';

    it('takes the release from the GIT_SHA the image was built with', () => {
        expect(readSentryConfig({ SENTRY_DSN: DSN, GIT_SHA: ' 37799f12a1b2 \n' }).release).toBe('37799f12a1b2');
        expect(readSentryConfig({ SENTRY_DSN: DSN, GIT_SHA: '' }).release).toBeUndefined();
        expect(readSentryConfig({ SENTRY_DSN: DSN }).release).toBeUndefined();
    });

    it('takes the environment from SENTRY_ENVIRONMENT, then the deploy slot, then NODE_ENV', () => {
        expect(readSentryConfig({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'demo', GACP_DEPLOY_SLOT: 'staging', NODE_ENV: 'production' }).environment).toBe('demo');
        expect(readSentryConfig({ SENTRY_DSN: DSN, GACP_DEPLOY_SLOT: 'staging', NODE_ENV: 'staging' }).environment).toBe('staging');
        expect(readSentryConfig({ SENTRY_DSN: DSN, NODE_ENV: 'production' }).environment).toBe('production');
        expect(readSentryConfig({ SENTRY_DSN: DSN }).environment).toBe('development');
    });

    it('samples 5% of traces by default', () => {
        expect(DEFAULT_TRACES_SAMPLE_RATE).toBe(0.05);
        expect(readSentryConfig({ SENTRY_DSN: DSN }).tracesSampleRate).toBe(0.05);
    });

    it('takes a traces rate between 0 and 1 from SENTRY_TRACES_SAMPLE_RATE', () => {
        expect(readSentryConfig({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: '0' }).tracesSampleRate).toBe(0);
        expect(readSentryConfig({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: '0.2' }).tracesSampleRate).toBe(0.2);
        expect(readSentryConfig({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: '1' }).tracesSampleRate).toBe(1);
    });

    it.each(['', 'abc', '-0.1', '1.5', 'NaN'])('falls back to the default for an unusable rate %p', (rate) => {
        expect(readSentryConfig({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: rate }).tracesSampleRate).toBe(0.05);
    });
});

describe('buildSentryOptions — the init options', () => {
    const fakeSentry = {
        onUnhandledRejectionIntegration: (opts) => ({ name: 'OnUnhandledRejection', opts }),
        makeNodeTransport: () => ({ send: async () => ({}), flush: async () => true }),
    };
    const options = buildSentryOptions(
        readSentryConfig({ SENTRY_DSN: 'https://k@o1.ingest.example.test/2', SENTRY_ENVIRONMENT: 'staging', GIT_SHA: 'abc' }),
        fakeSentry,
    );

    it('carries the scrubber and collects nothing personal', () => {
        expect(options.sendDefaultPii).toBe(false);
        expect(options.dataCollection).toMatchObject({
            userInfo: false,
            cookies: false,
            httpBodies: [],
            urlQueryParams: false,
            databaseQueryData: false,
            stackFrameVariables: false,
        });
        expect(options.traceLifecycle).toBe('static');
        expect(typeof options.transport).toBe('function');
        expect(typeof options.beforeSend).toBe('function');
        expect(typeof options.beforeSendTransaction).toBe('function');
        expect(typeof options.beforeBreadcrumb).toBe('function');
    });

    it('never captures local variables and does not profile', () => {
        expect(options.includeLocalVariables).toBe(false);
        expect(options).not.toHaveProperty('profileSessionSampleRate');
        expect(options).not.toHaveProperty('profilesSampleRate');
    });

    it('keeps Node\'s crash-on-unhandled-rejection behaviour (strict mode)', () => {
        expect(options.integrations).toEqual([{ name: 'OnUnhandledRejection', opts: { mode: 'strict' } }]);
    });

    it('passes dsn, environment, release and traces rate through', () => {
        expect(options).toMatchObject({
            dsn: 'https://k@o1.ingest.example.test/2',
            environment: 'staging',
            release: 'abc',
            tracesSampleRate: 0.05,
        });
    });
});

describe('server.js wiring', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

    it('initialises Sentry before Express is required, so the SDK can instrument it', () => {
        const init = source.indexOf('initSentry()');
        const express = source.indexOf("require('express')");
        expect(init).toBeGreaterThan(-1);
        expect(express).toBeGreaterThan(-1);
        expect(init).toBeLessThan(express);
    });

    it('attaches the Sentry error handler after the routes and before the global error handler', () => {
        const routes = source.indexOf("app.use('/api', apiNotFoundHandler)");
        const attach = source.indexOf('attachSentryErrorHandler(app');
        const globalHandler = source.indexOf('app.use((err, req, res, _next)');
        expect(attach).toBeGreaterThan(routes);
        expect(attach).toBeLessThan(globalHandler);
    });
});

describe('env-validator — SENTRY_DSN is optional, and checked only when set', () => {
    const { validateSentryDsn, validateEnvironment } = require('../../config/env-validator');
    const ORIGINAL = process.env.SENTRY_DSN;

    afterEach(() => {
        if (ORIGINAL === undefined) {delete process.env.SENTRY_DSN;}
        else {process.env.SENTRY_DSN = ORIGINAL;}
    });

    it('says nothing when it is unset or blank (off is the default, not a problem)', () => {
        expect(validateSentryDsn(undefined)).toBeNull();
        expect(validateSentryDsn('   ')).toBeNull();
    });

    it('accepts a DSN-shaped value', () => {
        expect(validateSentryDsn('https://abc123@o4501.ingest.example.test/4502')).toBeNull();
    });

    it.each(['not-a-dsn', 'https://o4501.ingest.example.test/4502', 'https://abc@o4501.ingest.example.test/', 'ftp://abc@host/1'])(
        'warns, without echoing the value, for %p',
        (value) => {
            const warning = validateSentryDsn(value);
            expect(warning).toMatch(/SENTRY_DSN/);
            expect(warning).not.toContain(value);
        },
    );

    it('surfaces the warning through validateEnvironment', () => {
        process.env.SENTRY_DSN = 'not-a-dsn';
        expect(validateEnvironment('development').warnings.some((w) => w.startsWith('SENTRY_DSN'))).toBe(true);
        delete process.env.SENTRY_DSN;
        expect(validateEnvironment('development').warnings.some((w) => w.startsWith('SENTRY_DSN'))).toBe(false);
    });
});

describe('secrets catalog — SENTRY_DSN', () => {
    const { SECRETS_CATALOG } = require('../../config/secrets');

    it('is catalogued as optional, non-sensitive, read by config/sentry.js', () => {
        expect(SECRETS_CATALOG.SENTRY_DSN).toMatchObject({ required: false, sensitive: false, usedIn: ['config/sentry.js'] });
    });
});

describe('web Dockerfile — the browser release is the same GIT_SHA as the server release', () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web-app', 'Dockerfile'), 'utf8');
    const builder = dockerfile.slice(0, dockerfile.indexOf('AS runner'));

    it('the builder stage takes GIT_SHA and bakes it as NEXT_PUBLIC_SENTRY_RELEASE', () => {
        expect(builder).toMatch(/^ARG GIT_SHA=""$/m);
        expect(builder).toMatch(/^ENV NEXT_PUBLIC_SENTRY_RELEASE=\$\{GIT_SHA\}$/m);
    });

    it('there is no second, separately-passed release build arg that could disagree', () => {
        expect(dockerfile).not.toMatch(/^ARG NEXT_PUBLIC_SENTRY_RELEASE/m);
    });

    it('the bake happens after the dependency install, so a new commit does not re-run it', () => {
        expect(builder.indexOf('ARG GIT_SHA')).toBeGreaterThan(builder.indexOf('pnpm install'));
    });
});
