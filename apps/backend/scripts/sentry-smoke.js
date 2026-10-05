#!/usr/bin/env node
'use strict';

/**
 * Sentry smoke test — sends ONE clearly marked test error through the same
 * initSentry() and Express error handler that server.js uses, and reports what
 * was actually sent.
 *
 *   node scripts/sentry-smoke.js            (inside the backend container, or with
 *                                            SENTRY_DSN exported in your shell)
 *
 * The DSN comes from the environment (config/sentry.js) and is never printed.
 * The request carries a FAKE national ID and email in its path, body and
 * headers, and the error message embeds them; the output shows the message as
 * it left the process (scrubbed), the event id, and the HTTP status Sentry's
 * ingest answered. Look the event id up in the Sentry project to confirm the
 * fake values are absent there too.
 *
 * Exit 0 = ingest accepted the event and no fake value was in the envelope.
 * Exit 1 = ingest refused it, or a fake value was found. Exit 2 = no DSN set.
 *
 * Runbook: docs/operations/sentry-error-tracking.md
 */

const http = require('http');
const { initSentry, attachSentryErrorHandler, readSentryConfig } = require('../config/sentry');

const FAKE_NATIONAL_ID = '1-2345-67890-12-3';
const FAKE_EMAIL = 'test@example.com';
const FAKE_VALUES = [FAKE_NATIONAL_ID, '1234567890123', FAKE_EMAIL];

async function main() {
    const config = readSentryConfig();
    if (!config.enabled) {
        process.stderr.write('SENTRY_DSN is not set: error tracking is off, nothing to test.\n');
        return 2;
    }

    const sent = [];
    let Sentry = null;
    // Wraps the SDK's own network transport. initSentry wraps THIS in the
    // scrubbing transport, so what is recorded here is what goes on the wire.
    const recordingTransport = (options) => {
        const inner = Sentry.makeNodeTransport(options);
        return {
            send: async (envelope) => {
                const response = await inner.send(envelope);
                sent.push({ envelope, statusCode: response && response.statusCode });
                return response;
            },
            flush: (timeout) => inner.flush(timeout),
        };
    };
    Sentry = require('@sentry/node');
    initSentry({ transport: recordingTransport });

     
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.post('/sentry-smoke/:nationalId', (req) => {
        throw new Error(`[TEST] Sentry smoke test, ignore — ทดสอบ ${req.params.nationalId} ${req.body.email}`);
    });
    attachSentryErrorHandler(app, Sentry);
     
    app.use((err, _req, res, _next) => res.status(500).json({ code: 'INTERNAL_SERVER_ERROR' }));

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address();
    await new Promise((resolve, reject) => {
        const body = JSON.stringify({ email: FAKE_EMAIL, nationalId: FAKE_NATIONAL_ID });
        const req = http.request({
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `/sentry-smoke/${FAKE_NATIONAL_ID}?email=${encodeURIComponent(FAKE_EMAIL)}`,
            headers: { 'content-type': 'application/json', 'x-national-id': FAKE_NATIONAL_ID },
        }, (res) => { res.resume(); res.on('end', resolve); });
        req.on('error', reject);
        req.end(body);
    });
    await Sentry.flush(15000);
    server.close();

    const eventItem = sent
        .flatMap(({ envelope, statusCode }) => envelope[1].map(([header, payload]) => ({ header, payload, statusCode })))
        .find((item) => item.header.type === 'event');
    const raw = JSON.stringify(sent.map((s) => s.envelope));
    const leaked = FAKE_VALUES.filter((v) => raw.includes(v));
    const exception = eventItem && eventItem.payload.exception && eventItem.payload.exception.values[0];

    const report = {
        eventId: eventItem ? eventItem.payload.event_id : null,
        ingestHttpStatus: eventItem ? eventItem.statusCode : null,
        environment: config.environment,
        release: config.release || null,
        exceptionType: exception ? exception.type : null,
        exceptionValueAsSent: exception ? exception.value : null,
        fakeValuesInEnvelope: leaked,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    await Sentry.close(5000);
    return report.ingestHttpStatus === 200 && leaked.length === 0 ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`sentry-smoke failed: ${err && err.message}\n`);
    process.exitCode = 1;
});
