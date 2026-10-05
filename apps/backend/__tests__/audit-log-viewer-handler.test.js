/**
 * Unit tests for audit-log-viewer-handler — Wave B Phase 51 (G5).
 *
 * Pure-function tests for the where-builder + CSV escaper. Route-level
 * integration is exercised separately via the existing handler test
 * fixtures.
 */

'use strict';

const path = require('path');

const helpersPath = path.resolve(
    __dirname,
    '../routes/api/provider/handlers/audit-log-viewer-helpers.js',
);

function load() {
    jest.resetModules();
    return require(helpersPath);
}

describe('buildWhere', () => {
    it('returns empty object when no filters supplied', () => {
        const { buildWhere } = load();
        expect(buildWhere({})).toEqual({});
    });

    it('builds an OR over actorId/actorEmail for `actor`', () => {
        const { buildWhere } = load();
        expect(buildWhere({ actor: 'jon' })).toEqual({
            OR: [
                { actorId: { contains: 'jon', mode: 'insensitive' } },
                { actorEmail: { contains: 'jon', mode: 'insensitive' } },
            ],
        });
    });

    it('accepts a known category and uppercases it', () => {
        const { buildWhere } = load();
        expect(buildWhere({ category: 'application' })).toEqual({ category: 'APPLICATION' });
    });

    it('drops an unknown category silently', () => {
        const { buildWhere } = load();
        expect(buildWhere({ category: 'XXX' })).toEqual({});
    });

    it('accepts a known severity and uppercases it', () => {
        const { buildWhere } = load();
        expect(buildWhere({ severity: 'warning' })).toEqual({ severity: 'WARNING' });
    });

    it('drops an unknown severity silently', () => {
        const { buildWhere } = load();
        expect(buildWhere({ severity: 'banana' })).toEqual({});
    });

    it('builds a date range from `from` and `to`', () => {
        const { buildWhere } = load();
        const out = buildWhere({
            from: '2026-04-01T00:00:00Z',
            to: '2026-04-30T23:59:59Z',
        });
        expect(out.createdAt.gte).toEqual(new Date('2026-04-01T00:00:00Z'));
        expect(out.createdAt.lte).toEqual(new Date('2026-04-30T23:59:59Z'));
    });

    it('handles `from` only', () => {
        const { buildWhere } = load();
        expect(buildWhere({ from: '2026-05-01' })).toEqual({
            createdAt: { gte: new Date('2026-05-01') },
        });
    });

    it('drops invalid dates silently', () => {
        const { buildWhere } = load();
        expect(buildWhere({ from: 'not-a-date' })).toEqual({});
    });

    it('combines multiple filters', () => {
        const { buildWhere } = load();
        const out = buildWhere({
            actor: 'admin',
            category: 'PAYMENT',
            severity: 'ERROR',
            from: '2026-04-01T00:00:00Z',
        });
        expect(out.OR).toBeDefined();
        expect(out.category).toBe('PAYMENT');
        expect(out.severity).toBe('ERROR');
        expect(out.createdAt.gte).toEqual(new Date('2026-04-01T00:00:00Z'));
    });
});

describe('csvField', () => {
    it('returns empty string for null/undefined', () => {
        const { csvField } = load();
        expect(csvField(null)).toBe('');
        expect(csvField(undefined)).toBe('');
    });

    it('returns plain text unchanged when no special chars', () => {
        const { csvField } = load();
        expect(csvField('hello')).toBe('hello');
        expect(csvField(42)).toBe('42');
    });

    it('quotes fields containing comma', () => {
        const { csvField } = load();
        expect(csvField('a,b')).toBe('"a,b"');
    });

    it('quotes fields containing newlines', () => {
        const { csvField } = load();
        expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('escapes embedded quotes by doubling them', () => {
        const { csvField } = load();
        expect(csvField('say "hi"')).toBe('"say ""hi"""');
    });

    it('serialises objects via JSON.stringify (and quotes the result)', () => {
        const { csvField } = load();
        const out = csvField({ a: 1, b: 'x' });
        expect(out.startsWith('"')).toBe(true);
        expect(out).toContain('""a""');
    });
});
