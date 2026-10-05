/**
 * Review FAIL on 1a0dd8e8 (2026-10-03): the UUID fix exempted every 16+ hex run,
 * so a contiguous 13-digit ID glued to hex letters ("abc1100000000008") — masked
 * on main — leaked, and an ID glued in front of a UUID leaked AND the UUID was
 * still corrupted. Fixed in round 3 by the UUID shield: main's masking runs
 * unchanged with every canonical UUID swapped out (see pii-mask-main-oracle).
 *
 * Differential against main a0ee3b68: MAIN_RUN is main's THAI_ID_RUN_IN_TEXT
 * verbatim. Every input below was masked by main, and must still be masked.
 * Synthetic ID only (1100000000008).
 */

'use strict';

const { maskThaiIdsInText } = require('../../utils/field-encryption');
const { FILTERED, scrubString } = require('@gacp/error-reporting/scrub');

const MAIN_RUN = /(?<!\d)\d(?:[ .\-/,–—  ]*\d){12}(?!\d)/g;
const ID = '1100000000008';
const UUID = 'c82d4715-4c75-4994-8945-880ab07c5ded';
const UUID_DIGITS_AT_ENDS = '12345678-4c75-4994-8945-880ab07c5123';

const digitsOf = (s) => s.replace(/[^0-9]/g, '');
// The ID must not survive, not even with separators/letters between its digits.
function leaks(out, id = ID) {
    const plain = out.replace(UUID, '').replace(UUID_DIGITS_AT_ENDS, '');
    return plain.includes(id) || digitsOf(plain).includes(id);
}

const LEAKED_ON_HEAD = [
    `abc${ID}`,
    `${ID}abc`,
    `deadbeef${ID}`,
    `ID ${ID}fee`,
    `scan_${ID}abc.pdf`,
    `/files/abc${ID}`,
    `${ID}${UUID}`,
    `${UUID}${ID}`,
    `abcdef${ID}abcdef`,
    `${'a'.repeat(20)}${ID}${'b'.repeat(20)}`,
];

describe('differential vs main: every input main masked is still masked', () => {
    it.each(LEAKED_ON_HEAD)('maskThaiIdsInText %s', (input) => {
        expect(leaks(input.replace(MAIN_RUN, '#'))).toBe(false); // main masked this ID
        const out = maskThaiIdsInText(input);
        expect(leaks(out)).toBe(false);
    });

    it.each(LEAKED_ON_HEAD)('scrubString %s', (input) => {
        const out = scrubString(input);
        expect(leaks(out)).toBe(false);
        expect(out).toContain(FILTERED);
    });

    // Main leaked the ID beside UUID_DIGITS_AT_ENDS (the digit run reached into
    // the UUID); the rule below closes that too.
    it('an ID glued in front of a UUID: ID masked AND UUID intact', () => {
        for (const fn of [maskThaiIdsInText, scrubString]) {
            for (const u of [UUID, UUID_DIGITS_AT_ENDS, UUID.toUpperCase()]) {
                for (const input of [`${ID}${u}`, `${u}${ID}`, `x ${ID}${u} y`]) {
                    const out = fn(input);
                    expect(out).toContain(u);
                    expect(leaks(out.replace(u, ''))).toBe(false);
                }
            }
        }
    });

    it.each([
        ['abc0812345678'],
        ['0812345678fee'],
        ['deadbeef0812345678'],
        ['call0812345678abcdef0123456789'],
    ])('scrubString masks a phone glued to hex letters: %s', (input) => {
        expect(scrubString(input)).not.toContain('0812345678');
    });
});

// xorshift32, fixed seed — the same sample on every run.
function makeRandom(seed) {
    let s = seed >>> 0;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}

describe('property: a random ID beside a random UUID — ID masked, UUID intact', () => {
    const rnd = makeRandom(0x5eed1d);
    const hex = (n) => { let o = ''; for (let i = 0; i < n; i++) { o += '0123456789abcdef'[rnd() & 15]; } return o; };
    const digits = (n) => { let o = String(1 + (rnd() % 8)); for (let i = 1; i < n; i++) { o += String(rnd() % 10); } return o; };
    const uuid = () => { const h = hex(32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[rnd() & 3]}${h.slice(17, 20)}-${h.slice(20)}`; };
    const dashed = (d) => `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
    const SHAPES = [
        (id, u) => `${id}${u}`,
        (id, u) => `${u}${id}`,
        (id, u) => `${id} ${u}`,
        (id, u) => `${u}-${id}`,
        (id, u) => `${id}-${u}`,
        (id, u) => `${u} ${dashed(id)}`,
        (id, u) => `${dashed(id)} ${u}`,
        (id, u) => `{"q":"${id}","applicationId":"${u}"}`,
    ];
    const N = 20000;

    it.each([['maskThaiIdsInText', maskThaiIdsInText], ['scrubString', scrubString]])(`%s: ${N} cases, 0 failures`, (_name, fn) => {
        const failures = [];
        for (let i = 0; i < N; i++) {
            const id = digits(13);
            const u = rnd() & 1 ? uuid() : uuid().toUpperCase();
            const input = SHAPES[i % SHAPES.length](id, u);
            const out = fn(input);
            const rest = out.split(u).join('');
            if (!out.includes(u) || rest.includes(id) || digitsOf(rest).includes(id)) { failures.push(input); }
        }
        expect({ failures: failures.length, first: failures.slice(0, 3) }).toEqual({ failures: 0, first: [] });
    });
});
