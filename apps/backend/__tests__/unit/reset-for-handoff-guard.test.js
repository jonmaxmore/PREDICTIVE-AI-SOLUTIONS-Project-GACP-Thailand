/**
 * reset-for-handoff.js — environment guard + confirmation gate.
 *
 * The script purges 43 tables including User. Before this suite it ran the
 * (45 until 2026-09-10 — PlantUnit และ PlantUnitEditHistory ถูกปลดระวางตาม R8)
 * whole DELETE_ORDER at require-time with no environment check and no
 * confirmation, and its own header documented `docker exec` against the
 * production container.
 *
 * Two independent gates are asserted here, and the point of splitting them is
 * that the confirmation token must NEVER unlock the environment guard:
 *   - environment guard: only development/test may run; production, staging and
 *     an unset NODE_ENV are all refused (fail-closed on the missing value).
 *   - confirmation gate: an explicit flag, an echoed database name via env, or
 *     an interactive typed answer. Nothing implicit.
 *
 * prisma is a hand-rolled mock in every test — no test touches a database.
 */

'use strict';

// Guards the require-time behaviour test below: if requiring the script still
// auto-ran the purge, these calls would be recorded against the mocked module.
const mockAutoRunDeletes = [];
jest.mock('../../services/prisma-database', () => {
    const client = new Proxy({}, {
        get(_target, prop) {
            if (prop === '$disconnect' || prop === '$connect') { return async () => {}; }
            if (typeof prop === 'symbol' || prop === 'then') { return undefined; }
            return {
                deleteMany: async () => { mockAutoRunDeletes.push(prop); return { count: 0 }; },
                count: async () => 0,
            };
        },
    });
    return { prisma: client };
});

const script = require('../../scripts/reset-for-handoff');

const {
    DELETE_ORDER,
    RESET_CONFIRM_FLAG,
    RESET_CONFIRM_ENV,
    EXIT_CODES,
    resetForHandoff,
    main,
} = script;

const TEST_DB_NAME = 'gacp_local';
const TEST_DATABASE_URL = `postgresql://user:pass@localhost:5432/${TEST_DB_NAME}?schema=public`;

function makeMockPrisma() {
    const deleteCalls = [];
    const countCalls = [];
    return new Proxy({}, {
        get(_target, prop) {
            if (prop === '__deleteCalls') { return deleteCalls; }
            if (prop === '__countCalls') { return countCalls; }
            if (prop === '$disconnect' || prop === '$connect') { return async () => {}; }
            if (typeof prop === 'symbol' || prop === 'then') { return undefined; }
            return {
                deleteMany: async () => { deleteCalls.push(prop); return { count: 1 }; },
                count: async () => { countCalls.push(prop); return 3; },
            };
        },
    });
}

function run(overrides = {}) {
    const prisma = overrides.prisma || makeMockPrisma();
    const lines = [];
    const options = {
        prisma,
        env: { DATABASE_URL: TEST_DATABASE_URL, ...(overrides.env || {}) },
        argv: overrides.argv || [],
        isTty: overrides.isTty === true,
        prompt: overrides.prompt || (async () => ''),
        log: (message) => lines.push(String(message)),
        error: (message) => lines.push(String(message)),
    };
    return { prisma, lines, options };
}

async function expectRefusal(overrides, expectedExitCode) {
    const { prisma, lines, options } = run(overrides);
    let caught = null;
    await expect(resetForHandoff(options)).rejects.toThrow(/refus/i);
    try {
        await resetForHandoff(options);
    } catch (err) {
        caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.exitCode).toBe(expectedExitCode);
    expect(prisma.__deleteCalls).toEqual([]);
    return { prisma, lines, caught };
}

describe('reset-for-handoff — environment guard (cannot be bypassed)', () => {
    it('RED 1: refuses NODE_ENV=production and issues no delete', async () => {
        const { caught } = await expectRefusal(
            { env: { NODE_ENV: 'production' } },
            EXIT_CODES.ENVIRONMENT_BLOCKED,
        );
        expect(caught.message).toMatch(/production/i);
    });

    it('RED 2: refuses NODE_ENV=staging and issues no delete', async () => {
        const { caught } = await expectRefusal(
            { env: { NODE_ENV: 'staging' } },
            EXIT_CODES.ENVIRONMENT_BLOCKED,
        );
        expect(caught.message).toMatch(/staging/i);
    });

    it('RED 3: fail-closed — refuses when NODE_ENV is unset', async () => {
        await expectRefusal({ env: {} }, EXIT_CODES.ENVIRONMENT_BLOCKED);
    });

    it('RED 3b: fail-closed — refuses when NODE_ENV is an empty string', async () => {
        await expectRefusal({ env: { NODE_ENV: '   ' } }, EXIT_CODES.ENVIRONMENT_BLOCKED);
    });

    it('RED 3c: fail-closed — refuses an unrecognised NODE_ENV (allowlist, not denylist)', async () => {
        await expectRefusal({ env: { NODE_ENV: 'prod-like' } }, EXIT_CODES.ENVIRONMENT_BLOCKED);
    });

    it('the confirmation token does NOT unlock the environment guard', async () => {
        await expectRefusal(
            {
                env: { NODE_ENV: 'production', [RESET_CONFIRM_ENV]: TEST_DB_NAME },
                argv: [RESET_CONFIRM_FLAG],
                isTty: true,
                prompt: async () => TEST_DB_NAME,
            },
            EXIT_CODES.ENVIRONMENT_BLOCKED,
        );
    });

    it('main() returns a non-zero exit code when the environment is blocked', async () => {
        const { options } = run({ env: { NODE_ENV: 'production' }, argv: [RESET_CONFIRM_FLAG] });
        const code = await main(options);
        expect(code).toBe(EXIT_CODES.ENVIRONMENT_BLOCKED);
        expect(code).not.toBe(0);
    });
});

describe('reset-for-handoff — confirmation gate', () => {
    it('RED 4: refuses without confirmation and issues no delete', async () => {
        await expectRefusal({ env: { NODE_ENV: 'development' } }, EXIT_CODES.NOT_CONFIRMED);
    });

    it('refuses a non-TTY run (docker exec) that carries no flag and no env token', async () => {
        const { caught } = await expectRefusal(
            { env: { NODE_ENV: 'development' }, isTty: false },
            EXIT_CODES.NOT_CONFIRMED,
        );
        expect(caught.message).toContain(RESET_CONFIRM_FLAG);
        expect(caught.message).toContain(RESET_CONFIRM_ENV);
    });

    it('refuses when the echoed database name does not match the target', async () => {
        await expectRefusal(
            { env: { NODE_ENV: 'development', [RESET_CONFIRM_ENV]: 'some_other_db' } },
            EXIT_CODES.NOT_CONFIRMED,
        );
    });

    it('refuses when the interactive answer does not match the database name', async () => {
        await expectRefusal(
            { env: { NODE_ENV: 'development' }, isTty: true, prompt: async () => 'yes' },
            EXIT_CODES.NOT_CONFIRMED,
        );
    });

    it('accepts the echoed database name via env (works under docker exec, no TTY)', async () => {
        const { prisma, options } = run({
            env: { NODE_ENV: 'development', [RESET_CONFIRM_ENV]: TEST_DB_NAME },
            isTty: false,
        });
        const result = await resetForHandoff(options);
        expect(result.confirmedVia).toBe('env');
        expect(prisma.__deleteCalls).toHaveLength(DELETE_ORDER.length);
    });

    it('accepts an interactive answer that matches the database name', async () => {
        const { prisma, options } = run({
            env: { NODE_ENV: 'development' },
            isTty: true,
            prompt: async () => `  ${TEST_DB_NAME}  `,
        });
        const result = await resetForHandoff(options);
        expect(result.confirmedVia).toBe('prompt');
        expect(prisma.__deleteCalls).toHaveLength(DELETE_ORDER.length);
    });

    it('shows the table count and the target database name before deleting anything', async () => {
        const { lines, options } = run({
            env: { NODE_ENV: 'development' },
            isTty: true,
            prompt: async () => TEST_DB_NAME,
        });
        await resetForHandoff(options);
        const plan = lines.join('\n');
        expect(plan).toContain(TEST_DB_NAME);
        expect(plan).toContain(String(DELETE_ORDER.length));
    });
});

describe('reset-for-handoff — negative control (Law 3.13 draft)', () => {
    it('RED 5: development + confirmation still purges every table in DELETE_ORDER', async () => {
        const { prisma, options } = run({
            env: { NODE_ENV: 'development' },
            argv: [RESET_CONFIRM_FLAG],
        });
        const result = await resetForHandoff(options);

        const expected = DELETE_ORDER.map((model) => model.charAt(0).toLowerCase() + model.slice(1));
        expect(prisma.__deleteCalls).toEqual(expected);
        expect(prisma.__deleteCalls).toHaveLength(43);
        expect(result.totalDeleted).toBe(43);
        expect(result.confirmedVia).toBe('flag');
    });

    it('main() returns exit code 0 on a confirmed development run', async () => {
        const { options } = run({
            env: { NODE_ENV: 'development' },
            argv: [RESET_CONFIRM_FLAG],
        });
        await expect(main(options)).resolves.toBe(EXIT_CODES.OK);
    });
});

describe('reset-for-handoff — require-time safety', () => {
    it('requiring the module runs nothing (no delete at import)', () => {
        expect(mockAutoRunDeletes).toEqual([]);
    });
});
