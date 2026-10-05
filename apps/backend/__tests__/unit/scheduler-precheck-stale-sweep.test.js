/**
 * The stale PENDING pre-check sweep is REGISTERED, not merely written.
 *
 * jobs/scheduler.js has carried two jobs that existed and never ran (the PDPA
 * sweep, see its block comment) — a sweep that is not registered is a sweep that
 * does not exist. This pins the block: every 5 minutes, Asia/Bangkok, the
 * callback drives runStalePrecheckSweep, and a failing sweep is logged, never
 * thrown out of the cron.
 */

'use strict';

const path = require('path');

const mockCronSchedule = jest.fn(() => ({ stop: jest.fn() }));
const mockSweep = jest.fn(async () => ({ scanned: 0, failed: 0, skipped: 0, errors: 0 }));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function loadScheduler() {
    jest.resetModules();
    jest.doMock('node-cron', () => ({ schedule: (...args) => mockCronSchedule(...args) }));
    jest.doMock('../../shared/logger', () => mockLogger);
    jest.doMock('../../jobs/revision-deadline-checker', () => ({ checkExpiredDeadlines: jest.fn(async () => ({})) }));
    jest.doMock('../../jobs/work-activity-sla-monitor', () => ({ checkOverdueActivities: jest.fn(async () => ({})) }));
    jest.doMock('../../cron/renewal-reminder-cron', () => ({ run: jest.fn(async () => ({})) }));
    jest.doMock('../../jobs/document-precheck-stale-sweep', () => ({
        runStalePrecheckSweep: (...args) => mockSweep(...args),
    }));
    return require(path.resolve(__dirname, '../../jobs/scheduler.js'));
}

function sweepBlock() {
    return mockCronSchedule.mock.calls.filter((call) => call[0] === '*/5 * * * *');
}

describe('scheduler — stale PENDING pre-check sweep', () => {
    beforeEach(() => {
        mockCronSchedule.mockClear();
        mockSweep.mockClear();
        mockLogger.error.mockClear();
    });

    test('one block, every 5 minutes, Asia/Bangkok, drives the sweep', async () => {
        const scheduler = loadScheduler();
        scheduler.start();
        const blocks = sweepBlock();
        expect(blocks).toHaveLength(1);
        expect(blocks[0][2]).toEqual({ timezone: 'Asia/Bangkok' });
        await blocks[0][1]();
        expect(mockSweep).toHaveBeenCalledTimes(1);
        scheduler.stop();
    });

    test('a failing sweep is logged, not thrown', async () => {
        mockSweep.mockRejectedValueOnce(new Error('db down'));
        const scheduler = loadScheduler();
        scheduler.start();
        await expect(sweepBlock()[0][1]()).resolves.toBeUndefined();
        expect(mockLogger.error).toHaveBeenCalled();
        scheduler.stop();
    });
});
