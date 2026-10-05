'use strict';

/**
 * The period-close guard must hold whichever module Node loads first.
 *
 * On main (and on this branch before the fix) there was a require cycle:
 *
 *   period-close-service → vat-report-service → journal-entry-service
 *     → journal-entry-period-guard → period-close-service
 *
 * Whichever side of the cycle loaded first handed the other a half-built
 * module:
 *   - period-close-service first: the guard kept period-close's EMPTY exports,
 *     found no isPeriodClosed, and let every entry post into a CLOSED period
 *     (fail-open);
 *   - server start-up order (journal-entry-service first): vat-report-service
 *     read ACCOUNTS from a half-built journal-entry-service and threw while
 *     loading, period-close kept vatReportService = null, and closePeriod
 *     silently skipped "no PENDING invoices in the period".
 *
 * Each case runs in a fresh node process, because the defect is the module
 * loader's order — a jest registry with mocks in it would not show it. The
 * database is a stub put into require.cache before anything loads.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const MARK = '@@PERIOD_GUARD_RESULT@@';

function inFreshNode(firstModules, body, opts = {}) {
    const script = `
        const fakePrisma = {
            periodClose: {
                // Every period is CLOSED for this test.
                findFirst: async () => ({ id: 'pc-1', status: 'CLOSED' }),
                update: async () => ({}),
                create: async () => ({ id: 'pc-new', year: 2026, month: 8, closedAt: new Date() }),
            },
            invoice: {
                // Three invoices still pending in the period being closed.
                count: async () => 3,
                findFirst: async () => null,
            },
            journalLine: { findMany: async () => [] },
            journalEntry: {
                // Records every entry actually written — a refused post writes none.
                create: async (a) => { global.__written.push(a.data && a.data.entryDate); return { id: 'je-1', ...a.data, lines: [] }; },
                findFirst: async () => null,
                findUnique: async () => null,
            },
            manualJournalEntryDraft: {
                create: async () => ({}),
                update: async () => ({}),
                findUnique: async () => ({
                    id: 'mje-1', status: 'APPROVED', organizationId: 'org-1',
                    postingDate: new Date('2026-08-15T03:00:00.000Z'), linesJson: [],
                }),
            },
            $transaction: async (fn) => (typeof fn === 'function' ? fn(fakePrisma) : Promise.all(fn)),
        };
        global.__written = [];
        const dbPath = require.resolve('./services/prisma-database');
        require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fakePrisma } };
        const failToLoad = ${JSON.stringify(opts.failToLoad || null)};
        if (failToLoad) {
            const Module = require('module');
            const origLoad = Module._load;
            Module._load = function (req) {
                if (req.endsWith(failToLoad)) { throw new Error('simulated load failure of ' + failToLoad); }
                return origLoad.apply(this, arguments);
            };
        }
        for (const m of ${JSON.stringify(firstModules)}) { require(m); }
        (async () => { ${body} })().then(
            (out) => { process.stdout.write('\\n${MARK}' + JSON.stringify(out)); process.exit(0); },
            (err) => { process.stderr.write(String(err && err.stack || err)); process.exit(1); },
        );
    `;
    const stdout = execFileSync(process.execPath, ['-e', script], {
        cwd: BACKEND_ROOT,
        env: { ...process.env, TZ: 'UTC' },
        encoding: 'utf8',
        timeout: 60_000,
    });
    return JSON.parse(stdout.slice(stdout.lastIndexOf(MARK) + MARK.length));
}

const POST_INTO_CLOSED_PERIOD = `
    const guard = require('./services/journal-entry-period-guard');
    try {
        await guard.checkPeriodOpen({ entryDate: new Date('2026-08-15T03:00:00.000Z'), organizationId: 'org-1' });
        return 'POSTED';
    } catch (e) {
        return e.code;
    }
`;

describe('a post into a CLOSED period is refused in every load order', () => {
    it.each([
        ['period-close-service first', ['./services/period-close-service']],
        ['server start-up order (journal-entry-service first)', ['./services/journal-entry-service']],
        ['the guard first', ['./services/journal-entry-period-guard']],
        ['vat-report-service first', ['./services/vat-report-service']],
    ])('%s', (_label, first) => {
        expect(inFreshNode(first, POST_INTO_CLOSED_PERIOD)).toBe('PERIOD_CLOSED');
    });
});

const POST_THROUGH_JOURNAL_ENTRY_SERVICE = `
    const jes = require('./services/journal-entry-service');
    try {
        await jes.recordPaymentEntry('inv-1', 1070, null, {
            invoiceNumber: 'TAX-PRD-2026-000001', serviceType: 'CERTIFICATION_CHECKOUT_M1',
            organizationId: 'org-1', paidAt: new Date('2026-08-15T03:00:00.000Z'),
        });
        return global.__written.length ? 'POSTED' : 'RETURNED_WITHOUT_WRITING';
    } catch (e) {
        return e.code;
    }
`;

const POST_MANUAL_ENTRY = `
    const mje = require('./services/manual-journal-entry-service');
    try {
        await mje.postManualEntry('mje-1', { actorId: 'u-1' });
        return 'POSTED';
    } catch (e) {
        return e.code;
    }
`;

describe('a payment posted THROUGH journal-entry-service into a CLOSED period is refused in every load order', () => {
    // Re-review 2, Minor 5: the guard-first order used to refuse at the guard
    // but POST through journal-entry-service, which held a half-built guard.
    it.each([
        ['period-close-service first', ['./services/period-close-service']],
        ['server start-up order (journal-entry-service first)', ['./services/journal-entry-service']],
        ['the guard first', ['./services/journal-entry-period-guard']],
        ['vat-report-service first', ['./services/vat-report-service']],
    ])('%s', (_label, first) => {
        expect(inFreshNode(first, POST_THROUGH_JOURNAL_ENTRY_SERVICE)).toBe('PERIOD_CLOSED');
    });
});

describe('a manual journal entry into a CLOSED period is refused', () => {
    it('postManualEntry reaches the guard and gets PERIOD_CLOSED', () => {
        expect(inFreshNode([], POST_MANUAL_ENTRY)).toBe('PERIOD_CLOSED');
    });
});

describe('the guard FAILS CLOSED when it or period-close cannot load (controller ruling 2026-09-26)', () => {
    it.each([
        ['period-close-service fails to load → the guard refuses', 'period-close-service', POST_INTO_CLOSED_PERIOD],
        ['period-close-service fails to load → journal-entry-service refuses', 'period-close-service', POST_THROUGH_JOURNAL_ENTRY_SERVICE],
        ['the guard fails to load → journal-entry-service refuses', 'journal-entry-period-guard', POST_THROUGH_JOURNAL_ENTRY_SERVICE],
        ['period-close-service fails to load → manual journal entry refuses', 'period-close-service', POST_MANUAL_ENTRY],
        ['the guard fails to load → manual journal entry refuses', 'journal-entry-period-guard', POST_MANUAL_ENTRY],
    ])('%s', (_label, failToLoad, body) => {
        const out = inFreshNode([], body, { failToLoad });
        expect(out).toBe('PERIOD_CHECK_UNAVAILABLE');
    });
});

describe('closing a period with PENDING invoices is refused in server start-up load order', () => {
    it('journal-entry-service loads first (as server.js does); closePeriod still sees the pending invoices', () => {
        const out = inFreshNode(['./services/journal-entry-service'], `
            // No close row exists yet for this period.
            require('./services/prisma-database').prisma.periodClose.findFirst = async () => null;
            const pc = require('./services/period-close-service');
            try {
                await pc.closePeriod({ year: 2026, month: 8, organizationId: 'org-1', actorId: 'u-1' });
                return 'CLOSED';
            } catch (e) {
                return e.code;
            }
        `);
        expect(out).toBe('PENDING_INVOICES_IN_PERIOD');
    });

    it('no module in the cycle throws while it loads in start-up order', () => {
        // Record every require of the three cycle modules that throws, while
        // journal-entry-service loads (as server.js does). On the old tree
        // vat-report-service threw "Cannot read properties of undefined
        // (reading 'VAT_PAYABLE_OUTPUT')" and period-close-service swallowed it.
        const out = inFreshNode([], `
            const Module = require('module');
            const orig = Module.prototype.require;
            const threw = [];
            Module.prototype.require = function (id) {
                try { return orig.apply(this, arguments); }
                catch (e) {
                    if (/vat-report-service|period-close-service|journal-entry-period-guard|journal-accounts/.test(id)) {
                        threw.push(id + ': ' + String(e.message).split('\\n')[0]);
                    }
                    throw e;
                }
            };
            require('./services/journal-entry-service');
            Module.prototype.require = orig;
            return threw;
        `);
        expect(out).toEqual([]);
    });
});
