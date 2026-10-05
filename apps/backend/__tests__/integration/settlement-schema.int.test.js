'use strict';
// B-REDSUITES #3 (2026-08-23): this suite had no database guard at all, unlike every
// other real-Postgres integration test in this tree, so it threw on PrismaClient
// connect instead of skipping. That is noise, not signal: a laptop with no Postgres
// reported it red on every run regardless of the code under test. It is gated the
// same way as the rest of the tree now — see the note below — and still runs for
// real against a database (DATABASE_URL=... npx jest settlement-schema.int -i).
const { PrismaClient } = require('@prisma/client');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('settlement schema (real Postgres)', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  test('stripe_webhook_events carries status/attempts/nextRetryAt', async () => {
    const id = 'evt_schema_' + Date.now();
    await prisma.stripeWebhookEvent.create({
      data: { id, type: 'test', payload: {}, status: 'RECEIVED', attempts: 0, nextRetryAt: new Date() },
    });
    const row = await prisma.stripeWebhookEvent.findUnique({ where: { id } });
    expect(row.status).toBe('RECEIVED');
    expect(row.attempts).toBe(0);
    await prisma.stripeWebhookEvent.delete({ where: { id } });
  });
});
