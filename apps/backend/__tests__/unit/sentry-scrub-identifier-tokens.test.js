/**
 * The error-report scrubber must not cut an identifier out of a report.
 *
 * Defect (2026-10-03, on main a0ee3b68): the national-ID and phone shapes in
 * packages/error-reporting/src/scrub.js accept a single dash between digits, so
 * digits spread over the groups of a UUID (or bounded by the letters of a hex
 * hash) matched and were replaced by [Filtered] — the application id in an error
 * message, and whole URL path segments, were lost from the report.
 * Fixed-seed sample: the same ids on every run.
 */

'use strict';

const { FILTERED, scrubString, scrubUrl } = require('@gacp/error-reporting/scrub');

function makeIds(seed) {
    let s = seed >>> 0;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
    const hex = (n) => { let o = ''; for (let i = 0; i < n; i++) { o += '0123456789abcdef'[rnd() & 15]; } return o; };
    const uuid = () => {
        const h = hex(32);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[rnd() & 3]}${h.slice(17, 20)}-${h.slice(20)}`;
    };
    return { hex, uuid };
}

const SAMPLE = 50000;
const REPORTED_UUID = 'c82d4715-4c75-4994-8945-880ab07c5ded';
// 10 digits over UUID groups, bounded by letters: the 0-form phone shape.
const PHONE_SHAPED_UUID = '7a3e9b1f-c081-2345-6789-def012abc345';

function countCorrupted(gen, fn) {
    let bad = 0;
    for (let i = 0; i < SAMPLE; i++) {
        const id = gen();
        if (fn(id) !== id) { bad++; }
    }
    return bad;
}

describe('scrubString leaves identifiers intact', () => {
    it(`corrupts 0 of ${SAMPLE} fixed-seed UUIDs`, () => {
        const { uuid } = makeIds(0x12345678);
        expect(countCorrupted(uuid, scrubString)).toBe(0);
    });

    // A hex id holding a digit run that IS a number shape (13 digits, or a
    // 0x phone) is scrubbed — a number glued to hex letters must never leak.
    it.each([[32], [64]])(`corrupts 0 of ${SAMPLE} fixed-seed %i-char hex ids without a 9+ digit run`, (len) => {
        const { hex } = makeIds(0x9e3779b9 + len);
        const gen = () => { let h; do { h = hex(len); } while (/\d{9}/.test(h)); return h; };
        expect(countCorrupted(gen, scrubString)).toBe(0);
    });

    it('keeps the reported UUID and a phone-shaped UUID in a message', () => {
        for (const id of [REPORTED_UUID, PHONE_SHAPED_UUID]) {
            const text = `application ${id} not found`;
            expect(scrubString(text)).toBe(text);
        }
    });

    it('keeps a UUID path segment of a URL', () => {
        const url = `https://api.example.test/api/applications/${REPORTED_UUID}/documents`;
        expect(scrubUrl(url)).toBe(url);
    });
});

describe('scrubString still removes a real number beside a UUID', () => {
    it.each([
        ['plain ID', '1100000000008'],
        ['dashed ID', '1-1000-00000-00-8'],
        ['Thai-digit ID', '๑๑๐๐๐๐๐๐๐๐๐๐๘'],
        ['mobile', '081-234-5678'],
    ])('%s', (_label, raw) => {
        for (const text of [`${raw} ${REPORTED_UUID}`, `${REPORTED_UUID} ${raw}`, `${REPORTED_UUID}-${raw}`]) {
            const out = scrubString(text);
            expect(out).toContain(REPORTED_UUID);
            expect(out).toContain(FILTERED);
            expect(out).not.toContain(raw);
        }
    });
});
