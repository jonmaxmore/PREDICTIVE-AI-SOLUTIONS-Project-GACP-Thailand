'use strict';

/**
 * Certificate number allocation against a REAL Postgres: concurrent allocators
 * on the shared ReceiptSequence row never draw the same running number.
 * Runs only when the run-level guard verified a usable test database
 * (test-support/test-database.js); otherwise it self-skips, and says so.
 */

const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('certificate number allocation on real Postgres', () => {
    const YEAR_DATE = new Date('2031-06-01T05:00:00Z'); // BE 2574, a year no other test draws from
    let prisma;
    // Its own small pool: the 20 allocations queue on 5 connections instead of each
    // grabbing one next to every other worker's, which exhausts a shared server.
    beforeAll(() => {
        const { PrismaClient } = require('@prisma/client');
        const url = new URL(process.env.DATABASE_URL);
        url.searchParams.set('connection_limit', '5');
        url.searchParams.set('pool_timeout', '30');
        prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    });
    afterAll(async () => {
        try {
            await prisma.receiptSequence.deleteMany({ where: { prefix: 'TH-GACP', year: 2574 } });
        } finally {
            await prisma.$disconnect();
        }
    });

    test('20 concurrent allocations give 20 distinct numbers, 1..20, no padding', async () => {
        const { allocateCertificateNumber } = require('../../services/certificate-number-allocator');
        await prisma.receiptSequence.deleteMany({ where: { prefix: 'TH-GACP', year: 2574 } });
        const got = await Promise.all(
            Array.from({ length: 20 }, () => allocateCertificateNumber({ client: prisma, issuedDate: YEAR_DATE })),
        );
        expect(new Set(got).size).toBe(20);
        const ns = got.map((n) => Number(n.match(/^TH-GACP (\d+)\/2574$/)[1])).sort((a, b) => a - b);
        expect(ns[0]).toBe(1);
        expect(ns[19]).toBe(20);
    });
});
