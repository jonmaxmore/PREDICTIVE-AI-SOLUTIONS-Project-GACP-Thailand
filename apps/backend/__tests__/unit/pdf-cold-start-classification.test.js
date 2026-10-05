/**
 * F-PDF-COLD-START-TIMEOUT — pdf-generator.service.isColdStartError()
 *
 * Pure classifier: tells the certificate-download route which
 * `getCertificatePdf` failures are worth ONE retry (the Puppeteer browser
 * just needed to finish launching) versus genuine render/data errors that
 * would fail identically on a second attempt. See
 * evidence/phase0/FINDINGS.md:177-178.
 *
 * Narrowed 2026-08-20 (review follow-up): a bare `.includes('timeout')`
 * matched too much — any unrelated timeout bubbling up from a totally
 * different subsystem would have been (wrongly) retried, burning part of
 * the route's fixed total time budget on a failure retrying can never fix.
 * These cases pin the NARROWED contract: `name === 'TimeoutError'` (the
 * real puppeteer shape, also used by the route's own attempt-deadline
 * wrapper), OR launch-specific message vocabulary — NOT a generic word
 * match.
 */

'use strict';

const pdfGenerator = require('../../services/pdf/pdf-generator.service');

function errorWithName(name, message) {
    const err = new Error(message);
    err.name = name;
    return err;
}

describe('F-PDF-COLD-START-TIMEOUT — isColdStartError (narrowed)', () => {
    test.each([
        ['puppeteer TimeoutError by .name (covers both launch AND setContent/navigation timeouts)', errorWithName('TimeoutError', 'Navigation timeout of 30000 ms exceeded')],
        ['our own route-level attempt-deadline synthetic timeout (name=TimeoutError)', errorWithName('TimeoutError', 'certificate PDF generation exceeded the 25000ms attempt deadline')],
        ['browser launch failure', new Error('Failed to launch the browser process! spawn /usr/bin/chromium ENOENT')],
        ['launch-context "Timed out after Nms" phrasing', new Error('Timed out after 30000 ms while trying to connect to the browser!')],
    ])('%s → true (retry-worthy)', (_label, err) => {
        expect(pdfGenerator.isColdStartError(err)).toBe(true);
    });

    test.each([
        ['certificate not found (data error)', new Error('Certificate not found')],
        ['template/render TypeError', new TypeError("Cannot read properties of undefined (reading 'certificateNumber')")],
        ['no error object', null],
        ['undefined', undefined],
        // Narrowing regression cases — these previously matched the old
        // bare `.includes('timeout')` check and must NOT any more:
        ['generic unrelated "timeout" message, no TimeoutError name, no browser/launch context', new Error('Request timeout while calling downstream service')],
        ['"Timed out after Nms" WITHOUT browser/launch context', new Error('Timed out after 5000 ms waiting for the queue lock')],
        ['the word "timeout" alone is not enough', new Error('Payment gateway timeout')],
    ])('%s → false (not retry-worthy)', (_label, err) => {
        expect(pdfGenerator.isColdStartError(err)).toBe(false);
    });
});
