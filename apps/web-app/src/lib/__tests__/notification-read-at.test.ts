/**
 * N6 — the letter says when it was opened.
 *
 * The design filed this as blocked on a migration. It was not: `readAt` has been on
 * the model all along (prisma/schema/system.prisma:20), both mark-read doors stamp it,
 * and the inbox query returns whole rows — so the value was already travelling to the
 * browser and nothing displayed it. Same shape as the T8 mistake in the same batch:
 * a column that exists, a surface that never asks.
 */
import { describe, expect, it } from '@jest/globals';
import { readAtOf } from '../notification-rank';

describe('readAtOf', () => {
    it('reads an ISO stamp', () => {
        expect(readAtOf({ readAt: '2026-09-05T08:30:00.000Z' } as never)?.toISOString())
            .toBe('2026-09-05T08:30:00.000Z');
    });

    it('reads a Date as it comes', () => {
        const d = new Date('2026-09-05T08:30:00.000Z');
        expect(readAtOf({ readAt: d } as never)?.getTime()).toBe(d.getTime());
    });

    it('an unread letter has no answer, and does not invent one', () => {
        for (const row of [{}, { readAt: null }, { readAt: '' }, { readAt: undefined }]) {
            expect(readAtOf(row as never)).toBeNull();
        }
    });

    it('an unparseable stamp is null, never an Invalid Date printed at the reader', () => {
        expect(readAtOf({ readAt: 'ไม่ใช่วันที่' } as never)).toBeNull();
        expect(readAtOf({ readAt: 12 } as never)).toBeNull();
    });

    it('null for a missing row rather than throwing inside a render', () => {
        expect(readAtOf(null as never)).toBeNull();
        expect(readAtOf(undefined as never)).toBeNull();
    });
});
