/**
 * BACK-01 (audit 2026-09-17), part (b): how many bytes one request may make the
 * server read and parse before anyone has checked who sent it.
 *
 * server.js parsed every JSON and urlencoded body up to 10 MB, on every path,
 * ahead of the rate limiter and authentication, and then handed the result to
 * the input-inspection middleware. Nothing the API does needs that: the largest
 * JSON body in the tree is the herb-knowledge bulk import (SSRU content, about
 * 266 KB for 308 rows — apps/backend/scripts/herb-content/data), and every file
 * travels as multipart through multer, which these parsers never touch.
 *
 * This drives the real parser stack (middleware/body-parsers.js, which server.js
 * mounts) with real request streams through an express Router — no listening
 * socket — and checks the bytes, not the configuration object.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Readable } = require('stream');
const express = require('express');
const { mountBodyParsers } = require('../../middleware/body-parsers');

const KB = 1024;
const MB = 1024 * KB;
const BACKEND = path.resolve(__dirname, '..', '..');

/** A request stream the parsers can read, shaped like what node hands express. */
function requestFor(url, { contentType, body }) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const req = Readable.from([bytes], { objectMode: false });
    req.method = 'POST';
    req.url = url;
    req.originalUrl = url;
    req.headers = {
        'content-type': contentType,
        'content-length': String(bytes.length),
    };
    return req;
}

/** Run one request through the mounted parsers; resolve with the error (or null) and the request. */
function parse(url, opts, mount = mountBodyParsers) {
    const router = express.Router();
    mount(router);
    const req = requestFor(url, opts);
    const res = {};
    return new Promise((resolve) => {
        router.handle(req, res, (err) => resolve({ err: err || null, req }));
    });
}

/** A JSON document of (about) `size` bytes whose single string field fills it. */
function jsonOfSize(size) {
    const overhead = '{"note":""}'.length;
    return JSON.stringify({ note: 'x'.repeat(size - overhead) });
}

/** A herb bulk-import body of `rows` rows shaped like the SSRU files (~860 bytes each). */
function herbImportBody(rows) {
    const row = {
        category: 'CULTIVATION',
        title: 'การเตรียมดินก่อนปลูก ขมิ้นชัน',
        content: 'ไถพรวนดินให้ร่วนซุย ตากดินไว้ 7-14 วัน เพื่อกำจัดวัชพืชและเชื้อโรค '.repeat(3),
        source: 'AI_DRAFT:SSRU-2026',
    };
    return JSON.stringify({ rows: Array.from({ length: rows }, () => row) });
}

describe('BACK-01 — ordinary API paths read at most 1 MB of JSON or form data', () => {
    it('a 1.5 MB JSON body is refused with 413 before it is parsed', async () => {
        const { err, req } = await parse('/api/auth/health/register', {
            contentType: 'application/json',
            body: jsonOfSize(1.5 * MB),
        });

        expect(err).not.toBeNull();
        expect(err.status).toBe(413);
        expect(err.type).toBe('entity.too.large');
        // body-parser 1.x (express 4) sets req.body = {} before it looks at the
        // body; what matters is that nothing from the request landed in it.
        expect(req.body ?? {}).toEqual({});
    });

    it('a 900 KB JSON body is parsed, and its exact bytes are kept for webhook signatures', async () => {
        const body = jsonOfSize(900 * KB);
        const { err, req } = await parse('/api/webhooks/stripe', {
            contentType: 'application/json',
            body,
        });

        expect(err).toBeNull();
        expect(req.body.note).toHaveLength(900 * KB - '{"note":""}'.length);
        expect(Buffer.isBuffer(req.rawBody)).toBe(true);
        expect(req.rawBody.toString('utf8')).toBe(body);
    });

    it('a 1.5 MB urlencoded body is refused with 413', async () => {
        const { err } = await parse('/api/example/form', {
            contentType: 'application/x-www-form-urlencoded',
            body: `state=${'a'.repeat(1.5 * MB)}`,
        });

        expect(err).not.toBeNull();
        expect(err.status).toBe(413);
    });

    it('a small urlencoded form still parses', async () => {
        const { err, req } = await parse('/api/example/form', {
            contentType: 'application/x-www-form-urlencoded',
            body: 'code=abc&state=xyz',
        });

        expect(err).toBeNull();
        expect(req.body).toEqual({ code: 'abc', state: 'xyz' });
    });

    it('the larger allowance is not reachable from a neighbouring herb path', async () => {
        const { err } = await parse('/api/herbs/TURMERIC/entries', {
            contentType: 'application/json',
            body: jsonOfSize(1.5 * MB),
        });

        expect(err).not.toBeNull();
        expect(err.status).toBe(413);
    });
});

describe('BACK-01 — the herb bulk import keeps the room its 2,000-row cap needs', () => {
    it.each([
        '/api/herbs/TURMERIC/entries/import',
        '/api/v1/herbs/TURMERIC/entries/import',
    ])('%s parses a 2,000-row import (over 1 MB)', async (url) => {
        const body = herbImportBody(2000);
        expect(Buffer.byteLength(body)).toBeGreaterThan(1 * MB);

        const { err, req } = await parse(url, { contentType: 'application/json', body });

        expect(err).toBeNull();
        expect(req.body.rows).toHaveLength(2000);
    });

    it('but not an unbounded one: 6 MB is refused with 413', async () => {
        const { err } = await parse('/api/herbs/TURMERIC/entries/import', {
            contentType: 'application/json',
            body: jsonOfSize(6 * MB),
        });

        expect(err).not.toBeNull();
        expect(err.status).toBe(413);
    });
});

describe('server.js runs these parsers', () => {
    /**
     * Booting server.js opens database and Redis connections, so, as in
     * server-staging-debug-surfaces.test.js, take the real body-parsing block out
     * of server.js and run it against a router. If server.js goes back to its
     * own 10 MB parsers, this block parses the body and the test fails.
     */
    function mountServerJsParsers(router) {
        const src = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
        const start = src.indexOf('\n// Middleware\n');
        const end = src.indexOf('\n// Input Sanitization');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const serverRequire = (id) => require(id.startsWith('.') ? path.join(BACKEND, id) : id);
        vm.runInNewContext(src.slice(start, end), { app: router, express, require: serverRequire });
    }

    it('a 1.5 MB JSON body is refused with 413', async () => {
        const { err } = await parse('/api/auth/health/register', {
            contentType: 'application/json',
            body: jsonOfSize(1.5 * MB),
        }, mountServerJsParsers);

        expect(err).not.toBeNull();
        expect(err.status).toBe(413);
    });

    it('a Stripe-sized JSON body is parsed with its raw bytes kept', async () => {
        const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
        const { err, req } = await parse('/api/webhooks/stripe', {
            contentType: 'application/json',
            body,
        }, mountServerJsParsers);

        expect(err).toBeNull();
        expect(req.body.id).toBe('evt_1');
        expect(req.rawBody.toString('utf8')).toBe(body);
    });
});

describe('multipart is left to multer', () => {
    it('a multipart body is not read by these parsers at all', async () => {
        const { err, req } = await parse('/api/farms', {
            contentType: 'multipart/form-data; boundary=x',
            body: `--x\r\nContent-Disposition: form-data; name="a"\r\n\r\n${'b'.repeat(2 * MB)}\r\n--x--\r\n`,
        });

        expect(err).toBeNull();
        expect(req.body ?? {}).toEqual({});
        expect(req.readableEnded).toBe(false);
    });
});
