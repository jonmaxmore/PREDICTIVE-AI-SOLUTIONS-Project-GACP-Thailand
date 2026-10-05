'use strict';

/**
 * Shared by the Sentry wire tests: a local HTTP sink standing in for Sentry's
 * ingest, the Express fixture app run as a child process, and envelope readers.
 * Nothing here touches the scrubber — the tests read what reached the sink.
 */

const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const APP = path.join(__dirname, 'express-error-app.js');
const RECORDER = path.join(__dirname, 'outbound-recorder.js');

function startSink() {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            let body = Buffer.concat(chunks);
            if (req.headers['content-encoding'] === 'gzip') {
                body = zlib.gunzipSync(body);
            }
            requests.push({ url: req.url, text: body.toString('utf8') });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{}');
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({
            port: server.address().port,
            requests,
            close: () => new Promise((r) => server.close(r)),
        }));
    });
}

function startApp(extraEnv) {
    const env = { ...process.env, NODE_ENV: 'test', ...extraEnv };
    for (const key of ['SENTRY_DSN', 'SENTRY_ENVIRONMENT', 'SENTRY_TRACES_SAMPLE_RATE', 'GIT_SHA', 'SENTRY_FIXTURE_DATABASE_URL']) {
        if (!(key in extraEnv)) {delete env[key];}
    }
    const child = spawn(process.execPath, ['-r', RECORDER, APP], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    return new Promise((resolve, reject) => {
        let buffered = '';
        child.stdout.on('data', (d) => {
            buffered += d;
            const line = buffered.split('\n').find((l) => l.startsWith('{'));
            if (line) {resolve({ port: JSON.parse(line).port, child, exited, stderr: () => stderr });}
        });
        child.on('exit', (code) => reject(new Error(`fixture exited (${code}) before listening:\n${stderr}`)));
    });
}

function call(port, method, urlPath, { body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            host: '127.0.0.1',
            port,
            method,
            path: urlPath,
            headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        if (payload) {req.write(payload);}
        req.end();
    });
}

async function waitFor(predicate, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) {return true;}
        await new Promise((r) => setTimeout(r, 50));
    }
    return false;
}

/** Envelope = header line, then (item header line, item payload line) pairs. */
function itemsIn(sinkRequests, type) {
    const items = [];
    for (const { text } of sinkRequests) {
        const lines = text.split('\n').filter(Boolean);
        for (let i = 1; i + 1 < lines.length; i += 2) {
            const itemHeader = JSON.parse(lines[i]);
            if (itemHeader.type === type) {items.push(JSON.parse(lines[i + 1]));}
        }
    }
    return items;
}

function eventsIn(sinkRequests) {
    return itemsIn(sinkRequests, 'event');
}

module.exports = { startSink, startApp, call, waitFor, itemsIn, eventsIn };
