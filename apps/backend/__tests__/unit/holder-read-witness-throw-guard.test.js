'use strict';

/**
 * HOLDER_READ_WITNESS=throw is refused in a deployed environment (Task 4 fix
 * round 1, Minor 4): several health paths still swallow their own read errors,
 * so a rejected read there would lose a write silently. In production, staging
 * and demo the mode falls back to shadow and a warning is logged; tests and
 * local runs keep 'throw'.
 */

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const logger = require('../../shared/logger');
const config = require('../../config/holder-read-witness');

const SAVED = {
    HOLDER_READ_WITNESS: process.env.HOLDER_READ_WITNESS,
    NODE_ENV: process.env.NODE_ENV,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
};

function setEnv(name, value) {
    if (value === undefined) { delete process.env[name]; } else { process.env[name] = value; }
}

function modeWith({ witness, nodeEnv, deployEnv }) {
    setEnv('HOLDER_READ_WITNESS', witness);
    setEnv('NODE_ENV', nodeEnv);
    setEnv('SENTRY_ENVIRONMENT', deployEnv);
    config.resetHolderReadWitnessModeCache();
    return config.holderReadWitnessMode();
}

afterEach(() => {
    for (const [name, value] of Object.entries(SAVED)) { setEnv(name, value); }
    config.resetHolderReadWitnessModeCache();
    logger.warn.mockClear();
});

describe('HOLDER_READ_WITNESS=throw guard', () => {
    test.each([
        ['NODE_ENV=production (demo runs production)', { nodeEnv: 'production' }],
        ['NODE_ENV=staging', { nodeEnv: 'staging' }],
        ['SENTRY_ENVIRONMENT=demo', { nodeEnv: 'development', deployEnv: 'demo' }],
        ['SENTRY_ENVIRONMENT=staging', { nodeEnv: 'development', deployEnv: 'staging' }],
    ])('%s: throw is downgraded to shadow, with a warning', (_label, env) => {
        expect(modeWith({ witness: 'throw', ...env })).toBe('shadow');
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toMatch(/refused in a deployed environment/);
    });

    test('test / local runs keep throw, and log nothing', () => {
        expect(modeWith({ witness: 'throw', nodeEnv: 'test' })).toBe('throw');
        expect(modeWith({ witness: 'throw', nodeEnv: 'development' })).toBe('throw');
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('shadow and off are untouched in a deployed environment', () => {
        expect(modeWith({ witness: 'shadow', nodeEnv: 'production' })).toBe('shadow');
        expect(modeWith({ witness: 'off', nodeEnv: 'production' })).toBe('off');
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

describe('the default mode (Task 6: throw in tests, shadow everywhere else)', () => {
    test('unset under NODE_ENV=test is throw, with no warning', () => {
        expect(modeWith({ witness: undefined, nodeEnv: 'test' })).toBe('throw');
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('an unknown value under NODE_ENV=test is throw too (never silently off)', () => {
        expect(modeWith({ witness: 'loud', nodeEnv: 'test' })).toBe('throw');
    });

    test.each([
        ['NODE_ENV unset', { nodeEnv: undefined }],
        ['NODE_ENV=development', { nodeEnv: 'development' }],
        ['NODE_ENV=production', { nodeEnv: 'production' }],
        ['NODE_ENV=staging', { nodeEnv: 'staging' }],
    ])('unset with %s is shadow, with no warning', (_label, env) => {
        expect(modeWith({ witness: undefined, ...env })).toBe('shadow');
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('a test run inside a deployed environment is still refused throw', () => {
        expect(modeWith({ witness: undefined, nodeEnv: 'test', deployEnv: 'staging' })).toBe('shadow');
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    test('an explicit shadow or off under NODE_ENV=test wins over the test default', () => {
        expect(modeWith({ witness: 'shadow', nodeEnv: 'test' })).toBe('shadow');
        expect(modeWith({ witness: 'off', nodeEnv: 'test' })).toBe('off');
    });
});
