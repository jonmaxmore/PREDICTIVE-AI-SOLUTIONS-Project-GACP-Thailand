/**
 * F-PDF-COLD-START-TIMEOUT — pdf-generator.service warm-up + launch-dedupe.
 *
 * evidence/phase0/FINDINGS.md:177-178 (walk C15): the first PDF render after
 * a backend restart pays Puppeteer's browser-launch cost inline and can trip
 * puppeteer's own 30s launch timeout (attempt 1 = 503; attempts 2-4
 * succeeded once the singleton browser was already warm). Two pins:
 *
 *   (a) warmUp() launches the browser (+ renders a trivial page, priming
 *       setContent/font paths) eagerly, and is fail-soft — a broken/missing
 *       Chromium on a given deploy target must never throw out of warmUp(),
 *       because server.js's boot hook fires it without awaiting.
 *   (b) initialize() de-dupes concurrent launches so a real request that
 *       arrives while warm-up is still in flight reuses the SAME in-flight
 *       `puppeteer.launch()` call instead of racing a second one.
 *
 * puppeteer.launch is mocked throughout — no real Chromium involved.
 */

'use strict';

describe('F-PDF-COLD-START-TIMEOUT — pdf-generator.service', () => {
    let launchMock;

    function freshService() {
        jest.resetModules();
        launchMock = jest.fn();
        jest.doMock('puppeteer', () => ({
            launch: (...args) => launchMock(...args),
        }));
        // eslint-disable-next-line global-require
        return require('../../services/pdf/pdf-generator.service');
    }

    function fakeBrowser() {
        const page = {
            setRequestInterception: jest.fn().mockResolvedValue(undefined),
            on: jest.fn(),
            setContent: jest.fn().mockResolvedValue(undefined),
            pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 warm-up')),
            close: jest.fn().mockResolvedValue(undefined),
        };
        return { newPage: jest.fn().mockResolvedValue(page), _page: page };
    }

    afterEach(() => {
        jest.dontMock('puppeteer');
        jest.resetModules();
    });

    test('warmUp() launches the browser and primes the render path (setContent + page.pdf ran)', async () => {
        const pdfGenerator = freshService();
        const browser = fakeBrowser();
        launchMock.mockResolvedValue(browser);

        await pdfGenerator.warmUp();

        expect(launchMock).toHaveBeenCalledTimes(1);
        expect(browser.newPage).toHaveBeenCalledTimes(1);
        expect(browser._page.setContent).toHaveBeenCalledTimes(1);
        expect(browser._page.pdf).toHaveBeenCalledTimes(1);
    });

    test('warmUp() is fail-soft: puppeteer.launch rejects → warmUp resolves without throwing, one warn logged', async () => {
        const pdfGenerator = freshService();
        launchMock.mockRejectedValue(new Error('Failed to launch the browser process! spawn ENOENT'));
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(pdfGenerator.warmUp()).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0].join(' ')).toMatch(/\[PDF\] warm-up failed/);
        warnSpy.mockRestore();
    });

    test('initialize() de-dupes concurrent launches (warm-up racing a real request shares ONE puppeteer.launch call)', async () => {
        const pdfGenerator = freshService();
        const browser = fakeBrowser();
        let resolveLaunch;
        launchMock.mockImplementation(() => new Promise((resolve) => { resolveLaunch = resolve; }));

        const warmupCall = pdfGenerator.initialize();
        const racingRequestCall = pdfGenerator.initialize();
        resolveLaunch(browser);
        const [fromWarmup, fromRequest] = await Promise.all([warmupCall, racingRequestCall]);

        expect(launchMock).toHaveBeenCalledTimes(1);
        expect(fromWarmup).toBe(browser);
        expect(fromRequest).toBe(browser);
    });

    test('initialize() launches again on the NEXT call after a failed launch (no permanently-stuck lock)', async () => {
        const pdfGenerator = freshService();
        launchMock.mockRejectedValueOnce(new Error('spawn ENOENT'));
        const browser = fakeBrowser();
        launchMock.mockResolvedValueOnce(browser);

        await expect(pdfGenerator.initialize()).rejects.toThrow('spawn ENOENT');
        const resolved = await pdfGenerator.initialize();

        expect(launchMock).toHaveBeenCalledTimes(2);
        expect(resolved).toBe(browser);
    });
});
