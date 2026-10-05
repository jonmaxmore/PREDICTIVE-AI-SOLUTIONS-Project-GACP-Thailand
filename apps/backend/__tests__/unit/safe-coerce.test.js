/**
 * safe-coerce shared helpers — defensive coercion contract.
 *
 * Used across the service layer for untrusted input (route bodies, JSON
 * columns, third-party callbacks). Pure functions, no I/O — so a unit
 * test is the right level. Future "cleanup" that tightens the contracts
 * (e.g., changing the integer fallback semantics, treating arrays as
 * objects) breaks downstream callers; this test fails first.
 */

const { safeInt, safeObject, safeArray, safeDate } = require('../../shared/safe-coerce');

describe('safe-coerce', () => {
    describe('safeInt', () => {
        it('parses string-encoded integers', () => {
            expect(safeInt('5', 0)).toBe(5);
            expect(safeInt('  42 ', 0)).toBe(42);
        });

        it('returns the fallback for non-finite / non-numeric input', () => {
            expect(safeInt('abc', 7)).toBe(7);
            expect(safeInt(null, 7)).toBe(7);
            expect(safeInt(undefined, 7)).toBe(7);
            expect(safeInt('', 7)).toBe(7);
            expect(safeInt(NaN, 7)).toBe(7);
            expect(safeInt(Infinity, 7)).toBe(7);
        });

        it('clamps to [min, max] when input is in range', () => {
            // default min=1, max=200
            expect(safeInt('5', 0)).toBe(5);
            expect(safeInt('500', 0)).toBe(200);  // clamped down
            expect(safeInt('0', 0)).toBe(1);      // clamped up to default min
        });

        it('honors custom min / max', () => {
            expect(safeInt('15', 1, 10, 20)).toBe(15);
            expect(safeInt('5', 1, 10, 20)).toBe(10);  // below custom min
            expect(safeInt('30', 1, 10, 20)).toBe(20); // above custom max
        });

        it('truncates floats (parseInt semantics)', () => {
            expect(safeInt('5.9', 0)).toBe(5);
            expect(safeInt(5.9, 0)).toBe(5);
        });

        it('clamps the fallback itself when finite numbers go out of bounds', () => {
            // The fallback path is only taken on non-finite; once finite,
            // clamping wins. This test pins that behavior.
            expect(safeInt('-5', 999)).toBe(1);  // -5 finite → clamps to min
        });
    });

    describe('safeObject', () => {
        it('returns the input when it is a plain object', () => {
            const obj = { a: 1 };
            expect(safeObject(obj)).toBe(obj); // same reference
            expect(safeObject({})).toEqual({});
        });

        it('returns {} for arrays (arrays are not "objects" for this helper)', () => {
            expect(safeObject([])).toEqual({});
            expect(safeObject([1, 2, 3])).toEqual({});
        });

        it('returns {} for null / undefined / primitives', () => {
            expect(safeObject(null)).toEqual({});
            expect(safeObject(undefined)).toEqual({});
            expect(safeObject('')).toEqual({});
            expect(safeObject('hello')).toEqual({});
            expect(safeObject(0)).toEqual({});
            expect(safeObject(false)).toEqual({});
        });
    });

    describe('safeArray', () => {
        it('returns the input when it is an array', () => {
            const arr = [1, 2, 3];
            expect(safeArray(arr)).toBe(arr); // same reference
            expect(safeArray([])).toEqual([]);
        });

        it('returns [] for non-arrays (including objects with a .length)', () => {
            expect(safeArray(null)).toEqual([]);
            expect(safeArray(undefined)).toEqual([]);
            expect(safeArray({})).toEqual([]);
            expect(safeArray({ length: 3 })).toEqual([]); // duck-typed length is NOT enough
            expect(safeArray('abc')).toEqual([]);          // strings have .length too
            expect(safeArray(42)).toEqual([]);
        });
    });

    describe('safeDate', () => {
        it('parses ISO 8601 strings to Date', () => {
            const d = safeDate('2026-05-05T10:00:00Z');
            expect(d).toBeInstanceOf(Date);
            expect(d.toISOString()).toBe('2026-05-05T10:00:00.000Z');
        });

        it('parses Date objects (idempotent)', () => {
            const original = new Date('2026-05-05T10:00:00Z');
            const d = safeDate(original);
            expect(d).toBeInstanceOf(Date);
            expect(d.getTime()).toBe(original.getTime());
        });

        it('returns null for invalid date input', () => {
            expect(safeDate('not-a-date')).toBeNull();
            expect(safeDate(undefined)).toBeNull();
            expect(safeDate({})).toBeNull();
            expect(safeDate(NaN)).toBeNull();
        });

        it('handles numeric epoch input', () => {
            const d = safeDate(0);
            expect(d).toBeInstanceOf(Date);
            expect(d.getTime()).toBe(0);
        });
    });
});
