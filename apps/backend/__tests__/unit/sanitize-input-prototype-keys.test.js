'use strict';

/**
 * A JSON key "__proto__" must not become the prototype of req.body.
 *
 * PR #858 security review (INFO, pre-existing on main): sanitizeValue copied every
 * key with `sanitized[key] = …`. JSON.parse makes "__proto__" an ordinary OWN key,
 * but assigning it onto a fresh `{}` runs the __proto__ setter instead, so the
 * attacker's object became req.body's prototype. Measured: own keys ['notes'],
 * yet `req.body.role === 'ADMIN'` through inheritance. Any handler that checks own
 * keys and then reads by property (or spreads defaults under the body) is exposed.
 *
 * Walked through the real express.json() parser and the real middleware, the way
 * server.js mounts them. The response carries only booleans and key names.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

const logger = require('../../shared/logger');
const { sanitizeInput, sanitizeValue } = require('../../middleware/sanitize-input');

function appThatReportsTheBody() {
    const app = express();
    app.use(express.json());
    app.use(sanitizeInput);
    app.post('/probe', (req, res) => {
        const body = req.body;
        res.json({
            inheritedRole: 'role' in body && !Object.prototype.hasOwnProperty.call(body, 'role'),
            role: body.role === undefined ? null : body.role,
            ownKeys: Object.keys(body),
            ownProto: Object.prototype.hasOwnProperty.call(body, '__proto__'),
            prototypeIsObject: Object.getPrototypeOf(body) === Object.prototype,
            nestedInheritedRole: Boolean(body.farm) && 'role' in body.farm
                && !Object.prototype.hasOwnProperty.call(body.farm, 'role'),
        });
    });
    return app;
}

const post = (raw) => request(appThatReportsTheBody())
    .post('/probe')
    .set('Content-Type', 'application/json')
    .send(raw);

beforeEach(() => jest.clearAllMocks());

describe('a "__proto__" key in a JSON body does not become the prototype of req.body', () => {
    it('top level: req.body inherits no role and keeps Object.prototype', async () => {
        const res = await post('{"notes":"ตรวจแล้ว","__proto__":{"role":"ADMIN"}}');

        expect(res.status).toBe(200);
        expect(res.body.inheritedRole).toBe(false);
        expect(res.body.role).toBeNull();
        expect(res.body.ownProto).toBe(false);
        expect(res.body.prototypeIsObject).toBe(true);
        expect(res.body.ownKeys).toEqual(['notes']);
    });

    it('nested: an object inside the body is protected the same way', async () => {
        const res = await post('{"farm":{"name":"สวนสมใจ","__proto__":{"role":"ADMIN"}}}');

        expect(res.status).toBe(200);
        expect(res.body.nestedInheritedRole).toBe(false);
    });

    it('the dropped key is logged, so the attempt is still observed', async () => {
        await post('{"notes":"x","__proto__":{"role":"ADMIN"}}');

        expect(logger.warn).toHaveBeenCalledTimes(1);
        const [, meta] = logger.warn.mock.calls[0];
        expect(meta.detections).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'body.__proto__', type: 'PROTOTYPE_KEY' }),
        ]));
    });
});

describe('sanitizeValue never copies a prototype-shaped key', () => {
    it.each(['__proto__', 'constructor', 'prototype'])('"%s" is not copied onto the result', (key) => {
        const parsed = JSON.parse(`{"keep":"ok","${key}":{"role":"ADMIN"}}`);
        const detections = [];

        const out = sanitizeValue(parsed, 'body', detections);

        expect(Object.keys(out)).toEqual(['keep']);
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
        expect(out.role).toBeUndefined();
        expect(detections).toEqual([expect.objectContaining({ path: `body.${key}`, type: 'PROTOTYPE_KEY' })]);
    });

    it('ordinary keys and values pass through untouched (the middleware still only observes)', () => {
        const parsed = JSON.parse('{"farmName":"สวนสมใจ -- แปลงที่ 1","plots":[{"areaUnit":"rai","area":3}]}');

        expect(sanitizeValue(parsed, 'body', [])).toEqual(parsed);
    });
});
