// Wave C PR C-3 — slugify + nextAvailableSlug helpers in entity-service.

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entity: { findFirst: jest.fn() },
    },
}));

const { prisma } = require('../../services/prisma-database');
const entityService = require('../../services/entity-service');

describe('Wave C PR C-3 — slugify', () => {
    const { slugify } = entityService;

    it('lowercases ASCII and joins with hyphens', () => {
        expect(slugify('Smoke Test Co. Ltd.')).toBe('smoke-test-co-ltd');
    });

    it('returns null for empty / whitespace-only input', () => {
        expect(slugify('')).toBeNull();
        expect(slugify(null)).toBeNull();
        expect(slugify('   ')).toBeNull();
    });

    it('drops Thai characters (URL-only purpose)', () => {
        expect(slugify('สมชาย ทดสอบ')).toBeNull();
    });

    it('keeps ASCII letters mixed with Thai', () => {
        expect(slugify('????? Phase67')).toBe('phase67');
    });

    it('strips leading and trailing hyphens', () => {
        expect(slugify('--abc-co--')).toBe('abc-co');
    });

    it('collapses repeated punctuation', () => {
        expect(slugify('A & B / C')).toBe('a-b-c');
    });
});

describe('Wave C PR C-3 — nextAvailableSlug', () => {
    const { nextAvailableSlug } = entityService;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns the slugified base when no collision', async () => {
        prisma.entity.findFirst.mockResolvedValue(null);
        const out = await nextAvailableSlug({ displayName: 'ABC Co.', fallbackIdPrefix: 'abc' });
        expect(out).toBe('abc-co');
    });

    it('appends -2 / -3 on collisions', async () => {
        prisma.entity.findFirst
            .mockResolvedValueOnce({ id: 'ent-x' })  // abc-co taken
            .mockResolvedValueOnce({ id: 'ent-y' })  // abc-co-2 taken
            .mockResolvedValueOnce(null);            // abc-co-3 free
        const out = await nextAvailableSlug({ displayName: 'ABC Co.', fallbackIdPrefix: 'abc' });
        expect(out).toBe('abc-co-3');
        expect(prisma.entity.findFirst).toHaveBeenCalledTimes(3);
    });

    it('uses fallback prefix when displayName has no ASCII', async () => {
        prisma.entity.findFirst.mockResolvedValue(null);
        const out = await nextAvailableSlug({
            displayName: 'สมชาย ทดสอบ',
            fallbackIdPrefix: 'abcd1234efgh',
        });
        expect(out).toBe('entity-abcd1234');
    });

    it('excludes the same entity from collision check (rename safety)', async () => {
        prisma.entity.findFirst.mockResolvedValue(null);
        await nextAvailableSlug({
            displayName: 'ABC Co.',
            excludeEntityId: 'ent-self',
        });
        expect(prisma.entity.findFirst).toHaveBeenCalledWith({
            where: { slug: 'abc-co', NOT: { id: 'ent-self' } },
            select: { id: true },
        });
    });
});
