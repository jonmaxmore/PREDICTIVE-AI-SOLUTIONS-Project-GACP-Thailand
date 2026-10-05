/**
 * Prisma errors reach Sentry without the values they echo — measured with a real
 * Prisma client against a real Postgres, through the real SDK, at the wire.
 *
 * Privacy review 2026-10-02 (Critical 1): Prisma 5.22 error messages carry PII.
 *   - PrismaClientValidationError prints the call's whole argument tree: a bad
 *     `user.create` shipped firstName, lastName, address and passport verbatim.
 *   - A raw-query error (P2010) carries Postgres's own echo of the data:
 *     `DETAIL: Failing row contains (…)` and `Key (col)=(…) already exists`.
 *
 * The Express fixture (fixtures/sentry/express-error-app.js) runs as a child
 * process with SENTRY_DSN pointing at a local sink and SENTRY_FIXTURE_DATABASE_URL
 * at the test database; its routes throw those exact errors through next(err).
 * The test reads the envelopes the sink received.
 *
 * Needs a database (describeIfTestDatabase). Writes nothing outside its own
 * schema, which it drops afterwards.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d, getTestDatabase } = require('../../test-support/test-database');
const {
    startSink, startApp, call, waitFor, eventsIn,
} = require('../fixtures/sentry/wire');

jest.setTimeout(60000);

const SCHEMA = 'sentry_pii_probe';
const PERSON = {
    firstName: 'สมชายทดสอบหนึ่ง',
    lastName: 'ใจดีทดสอบ',
    address: '99 ถนนทดสอบ',
    passport: 'AA7654321',
};
const ROW_NAME = 'สมชาย ตรวจสอบ';
const ROW_ADDR = '12 ถนนตรวจ';
const DUP_NAME = 'สมศรี ซ้ำกัน';

function urlWithSchema(url, schema) {
    const u = new URL(url);
    u.searchParams.set('schema', schema);
    return u.toString();
}

d('Sentry + real Prisma errors (Postgres)', () => {
    const db = getTestDatabase();
    let admin;
    let sink;
    let app;

    beforeAll(async () => {
        admin = new PrismaClient({ datasources: { db: { url: db.url } } });
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await admin.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
        await admin.$executeRawUnsafe(
            `CREATE TABLE ${SCHEMA}.people (full_name text UNIQUE, addr text, n int CHECK (n > 0))`,
        );
        await admin.$executeRawUnsafe(`INSERT INTO ${SCHEMA}.people VALUES ('${DUP_NAME}', 'x', 1)`);

        sink = await startSink();
        app = await startApp({
            SENTRY_DSN: `http://publickey@127.0.0.1:${sink.port}/42`,
            SENTRY_ENVIRONMENT: 'test-sink',
            SENTRY_FIXTURE_DATABASE_URL: urlWithSchema(db.url, SCHEMA),
        });

        await call(app.port, 'POST', '/api/prisma/validation', { body: PERSON });
        await call(app.port, 'POST', '/api/prisma/raw', {
            body: { sql: `INSERT INTO ${SCHEMA}.people VALUES ('${ROW_NAME}', '${ROW_ADDR}', -1)` },
        });
        await call(app.port, 'POST', '/api/prisma/raw', {
            body: { sql: `INSERT INTO ${SCHEMA}.people VALUES ('${DUP_NAME}', 'y', 1)` },
        });
        await waitFor(() => eventsIn(sink.requests).length >= 3, 20000);
    });

    afterAll(async () => {
        if (app) {
            app.child.kill();
            await app.exited;
        }
        if (sink) {await sink.close();}
        if (admin) {
            await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
            await admin.$disconnect();
        }
    });

    function exceptions() {
        return eventsIn(sink.requests).map((e) => e.exception.values[e.exception.values.length - 1]);
    }

    it('three Prisma errors arrived', () => {
        const types = exceptions().map((x) => x.type).sort();
        expect(types).toEqual(['PrismaClientKnownRequestError', 'PrismaClientKnownRequestError', 'PrismaClientValidationError']);
    });

    it('no value from the argument tree or the failing row is anywhere on the wire', () => {
        const raw = sink.requests.map((r) => r.text).join('\n');
        for (const value of [...Object.values(PERSON), ROW_NAME, ROW_ADDR, DUP_NAME, 'สมชาย', 'สมศรี']) {
            expect(raw).not.toContain(value);
        }
    });

    it('the validation error keeps the operation and the summary line', () => {
        const validation = exceptions().find((x) => x.type === 'PrismaClientValidationError');
        expect(validation.value).toMatch(/^Invalid `user\.create\(\)` invocation: /);
        expect(validation.stacktrace.frames.length).toBeGreaterThan(0);
    });

    it('the raw-query errors keep the Postgres code and the constraint, not the data', () => {
        const raw = exceptions().filter((x) => x.type === 'PrismaClientKnownRequestError').map((x) => x.value);
        expect(raw.some((v) => v.includes('`23514`') && v.includes('people_n_check'))).toBe(true);
        expect(raw.some((v) => v.includes('`23505`') && v.includes('Key (full_name)=([Filtered])'))).toBe(true);
    });
});
