/**
 * Task 4 fix round 4 (task-4-rereview-1.md, Important #1): a `terminate()`
 * that lands while `TesseractService.initialize()` is still awaiting
 * `Tesseract.createWorker()` must not leak the worker that createWorker
 * later resolves with. Before the fix, `terminate()` nulled `this.scheduler`
 * and the resumed `initialize()` threw a TypeError on `addWorker`, leaving
 * the fresh worker thread running forever.
 *
 * `Tesseract.createWorker` is replaced with a deferred promise resolving to a
 * fake worker (a `terminate` spy), so the race is deterministic and no real
 * tesseract thread starts in this file.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Tesseract = require('tesseract.js');

const { TesseractService } = require('../../../services/ocr/tesseract-service');
const { extractDocument } = require('../../../services/document-precheck/extract');

function deferred() {
    let resolve;
    const promise = new Promise((res) => { resolve = res; });
    return { promise, resolve };
}

function fakeWorker() {
    return { terminate: jest.fn().mockResolvedValue(undefined) };
}

/** Lets every already-queued microtask and one macrotask run. */
function flush() {
    return new Promise((resolve) => { setImmediate(resolve); });
}

let createWorkerSpy;

afterEach(() => {
    if (createWorkerSpy) {
        createWorkerSpy.mockRestore();
        createWorkerSpy = null;
    }
});

describe('TesseractService: terminate() while createWorker() is pending', () => {
    test('the worker createWorker resolves with is terminated and no scheduler is left', async () => {
        const pending = deferred();
        const worker = fakeWorker();
        createWorkerSpy = jest.spyOn(Tesseract, 'createWorker').mockReturnValue(pending.promise);

        const service = new TesseractService();
        const init = service.initialize();
        const initOutcome = init.then(() => null, (err) => err);

        await flush();
        expect(createWorkerSpy).toHaveBeenCalledTimes(1);

        await service.terminate();
        pending.resolve(worker);

        const err = await initOutcome;
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('TESSERACT_TERMINATED');
        expect(service.scheduler).toBeNull();
        expect(service.isInitialized).toBe(false);
    });

    test('extractDocument timing out during createWorker() rejects PRECHECK_TIMEOUT and still terminates the late worker', async () => {
        const pending = deferred();
        const worker = fakeWorker();
        createWorkerSpy = jest.spyOn(Tesseract, 'createWorker').mockReturnValue(pending.promise);

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-race-'));
        const pngPath = path.join(tmp, 'tiny.png');
        // Any non-empty bytes reach the OCR branch; OCR never runs because createWorker never resolves in time.
        fs.writeFileSync(pngPath, Buffer.from('not-really-a-png'));

        const unhandled = [];
        const onUnhandled = (reason) => { unhandled.push(reason); };
        process.on('unhandledRejection', onUnhandled);
        try {
            await expect(extractDocument(pngPath, 'image/png', { timeoutMs: 100 }))
                .rejects.toMatchObject({ code: 'PRECHECK_TIMEOUT' });
            expect(createWorkerSpy).toHaveBeenCalledTimes(1);

            pending.resolve(worker);
            await flush();
            await flush();

            expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
