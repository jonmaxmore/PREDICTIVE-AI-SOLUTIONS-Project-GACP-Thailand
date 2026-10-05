/**
 * Backlog Task 4 (owed): two `initialize()` calls overlapping on ONE TesseractService.
 *
 * Before the guard, the second call passed the `isInitialized` check (still false
 * while the first awaited createWorker), created a SECOND scheduler over the first
 * and a second worker — the first scheduler and its worker were dropped with nobody
 * left to terminate them. The guard: a call made while an initialisation is in
 * flight awaits that same initialisation.
 *
 * `Tesseract.createWorker` / `createScheduler` are replaced so no real tesseract
 * thread starts in this file.
 */

'use strict';

const Tesseract = require('tesseract.js');
const { TesseractService } = require('../../../services/ocr/tesseract-service');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
const fakeWorker = () => ({ terminate: jest.fn().mockResolvedValue(undefined) });
const fakeScheduler = () => ({ addWorker: jest.fn(), terminate: jest.fn().mockResolvedValue(undefined) });
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

let createWorkerSpy;
let createSchedulerSpy;

beforeEach(() => {
    createSchedulerSpy = jest.spyOn(Tesseract, 'createScheduler').mockImplementation(fakeScheduler);
});
afterEach(() => {
    createWorkerSpy.mockRestore();
    createSchedulerSpy.mockRestore();
});

describe('TesseractService.initialize() called twice before the first finishes', () => {
    test('the second call awaits the first: one scheduler, one worker, both resolve', async () => {
        const pending = deferred();
        const worker = fakeWorker();
        createWorkerSpy = jest.spyOn(Tesseract, 'createWorker').mockReturnValue(pending.promise);

        const service = new TesseractService();
        const first = service.initialize();
        await flush();
        const second = service.initialize();
        await flush();

        expect(createWorkerSpy).toHaveBeenCalledTimes(1);
        expect(createSchedulerSpy).toHaveBeenCalledTimes(1);

        pending.resolve(worker);
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
        expect(service.isInitialized).toBe(true);
        expect(service.scheduler.addWorker).toHaveBeenCalledTimes(1);
        expect(service.scheduler.addWorker).toHaveBeenCalledWith(worker);
    });

    test('a failed initialisation fails both callers, and a later call tries again', async () => {
        const pending = deferred();
        // Any call past the ones this test expects must not start a REAL worker thread.
        createWorkerSpy = jest.spyOn(Tesseract, 'createWorker')
            .mockRejectedValue(new Error('unexpected extra createWorker call'))
            .mockReturnValueOnce(pending.promise);

        const service = new TesseractService();
        const first = service.initialize().then(() => null, (e) => e);
        await flush();
        const second = service.initialize().then(() => null, (e) => e);
        pending.reject(new Error('worker failed to start'));

        const [e1, e2] = await Promise.all([first, second]);
        expect(e1).toBeInstanceOf(Error);
        expect(e2).toBe(e1);
        expect(createWorkerSpy).toHaveBeenCalledTimes(1);

        const worker = fakeWorker();
        createWorkerSpy.mockResolvedValueOnce(worker);
        await service.initialize();
        expect(createWorkerSpy).toHaveBeenCalledTimes(2);
        expect(service.isInitialized).toBe(true);
    });

    test('terminate() mid-initialisation aborts BOTH waiting callers and still terminates the late worker', async () => {
        const pending = deferred();
        const worker = fakeWorker();
        createWorkerSpy = jest.spyOn(Tesseract, 'createWorker').mockReturnValue(pending.promise);

        const service = new TesseractService();
        const first = service.initialize().then(() => null, (e) => e);
        await flush();
        const second = service.initialize().then(() => null, (e) => e);
        await service.terminate();
        pending.resolve(worker);

        const [e1, e2] = await Promise.all([first, second]);
        expect(e1 && e1.code).toBe('TESSERACT_TERMINATED');
        expect(e2 && e2.code).toBe('TESSERACT_TERMINATED');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(createWorkerSpy).toHaveBeenCalledTimes(1);
        expect(service.scheduler).toBeNull();
    });
});
