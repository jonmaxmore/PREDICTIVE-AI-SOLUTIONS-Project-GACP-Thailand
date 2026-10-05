/**
 * Round 3 (review 2026-10-03): the maskers must equal main a0ee3b68 exactly,
 * except that no match may reach into a canonical UUID. Oracle =
 * __tests__/fixtures/pii-mask-main-oracle (main's code verbatim + the shield).
 *   - input without a UUID: output === main(input)
 *   - input with UUIDs: output === restore(main(swap(input)))
 * Fixed-seed fuzz; synthetic numbers only.
 */

'use strict';

const { maskThaiIdsInText } = require('../../utils/field-encryption');
const { scrubString } = require('@gacp/error-reporting/scrub');
const oracle = require('../fixtures/pii-mask-main-oracle');

const MASKERS = [
    ['maskThaiIdsInText', maskThaiIdsInText, oracle.mainMaskThaiIdsInText],
    ['scrubString', scrubString, oracle.mainScrubString],
];

function makeRandom(seed) {
    let s = seed >>> 0;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}

function makeFuzz(seed) {
    const rnd = makeRandom(seed);
    const pick = (arr) => arr[rnd() % arr.length];
    const hex = (n) => { let o = ''; for (let i = 0; i < n; i++) { o += '0123456789abcdef'[rnd() & 15]; } return o; };
    const digits = (n, first = '123456789') => { let o = pick([...first]); for (let i = 1; i < n; i++) { o += String(rnd() % 10); } return o; };
    const thai = (s) => s.replace(/\d/g, (d) => String.fromCharCode(0x0E50 + Number(d)));
    const uuid = () => {
        const h = (rnd() % 3 === 0 ? digits(1) : hex(1)) + hex(31); // a third start with a digit
        const u = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[rnd() & 3]}${h.slice(17, 20)}-${h.slice(20)}`;
        return rnd() & 1 ? u : u.toUpperCase();
    };
    const id = () => {
        const d = digits(13);
        return pick([
            () => d,
            () => `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`,
            () => `${d[0]} ${d.slice(1, 5)} ${d.slice(5, 10)} ${d.slice(10, 12)} ${d[12]}`,
            () => `${d[0]}.${d.slice(1, 5)}.${d.slice(5, 10)}.${d.slice(10, 12)}.${d[12]}`,
            () => thai(d),
        ])();
    };
    const phone = () => {
        const m = `0${pick(['6', '8', '9'])}${digits(8, '0123456789')}`;
        const l = `02${digits(7, '0123456789')}`;
        return pick([
            () => m,
            () => `${m.slice(0, 3)}-${m.slice(3, 6)}-${m.slice(6)}`,
            () => `(02) ${l.slice(2, 5)} ${l.slice(5)}`,
            () => `${l.slice(0, 2)}-${l.slice(2, 5)}-${l.slice(5)}`,
            () => `+66 ${m.slice(1, 3)} ${m.slice(3, 6)} ${m.slice(6)}`,
            () => thai(m),
        ])();
    };
    const piece = () => pick([uuid, uuid, id, phone, () => hex(16), () => hex(32), () => `scan_${digits(13)}${hex(3)}.pdf`, () => 'abc', () => digits(rnd() % 20 + 1)])();
    const glue = () => pick(['', '', ' ', '-', '/', '_', '.']);
    return () => {
        let s = piece();
        const n = 1 + (rnd() % 3);
        for (let i = 0; i < n; i++) { s += glue() + piece(); }
        return pick([
            (x) => x,
            (x) => `/api/applications/${x}?q=${x}`,
            (x) => JSON.stringify({ note: x, id: x }),
            (x) => `ผู้ยื่น ${x} แจ้ง`,
        ])(s);
    };
}

const N = 30000;

describe.each(MASKERS)('%s equals main, with UUIDs shielded', (_name, actual, main) => {
    const expected = oracle.shielded(main);

    it(`${N} fixed-seed fuzz inputs: output === restore(main(swap(input)))`, () => {
        const next = makeFuzz(0xC0FFEE);
        const diffs = [];
        for (let i = 0; i < N; i++) {
            const input = next();
            if (actual(input) !== expected(input)) { diffs.push(input); }
        }
        expect({ diffs: diffs.length, first: diffs.slice(0, 3) }).toEqual({ diffs: 0, first: [] });
    });

    it('an input without a UUID gives exactly main\'s output', () => {
        const next = makeFuzz(0xBADA55);
        let checked = 0;
        const diffs = [];
        for (let i = 0; i < N && checked < 5000; i++) {
            const input = next();
            if (oracle.ORACLE_UUID.test(input)) { oracle.ORACLE_UUID.lastIndex = 0; continue; }
            oracle.ORACLE_UUID.lastIndex = 0;
            checked++;
            if (actual(input) !== main(input)) { diffs.push(input); }
        }
        expect(checked).toBeGreaterThan(1000);
        expect(diffs.slice(0, 3)).toEqual([]);
    });
});

describe('the two leaks the round-3 review reported', () => {
    const UUID_DIGIT_LEAD = '1f83a8bd-d396-4c75-8945-880ab07c5ded';
    const UUID_DIGIT_LEAD_2 = '54283e8c-d396-4c75-8945-880ab07c5ded';

    it('Sentry: a landline followed by a digit-leading UUID is scrubbed, UUID kept', () => {
        const out = scrubString(`โทร (02) 123 4567 ${UUID_DIGIT_LEAD}`);
        expect(out).not.toContain('123 4567');
        expect(out).toContain(UUID_DIGIT_LEAD);
    });

    it.each([
        ['maskThaiIdsInText', maskThaiIdsInText],
        ['scrubString', scrubString],
    ])('%s: a separated ID touching a digit-leading UUID edge is masked, UUID kept', (_n, fn) => {
        const out = fn(`/1 1000 00000 00 8${UUID_DIGIT_LEAD_2}`);
        expect(out).not.toContain('1 1000 00000 00 8');
        expect(out).toContain(UUID_DIGIT_LEAD_2);
    });

    it('scrubString: a separated phone touching a digit-leading UUID edge is scrubbed', () => {
        const out = scrubString(`โทร 081-234-567854283e8c-d396-4c75-8945-880ab07c5ded`);
        expect(out).not.toContain('081-234-5678');
    });
});
