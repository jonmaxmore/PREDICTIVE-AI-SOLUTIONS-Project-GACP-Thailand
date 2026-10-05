/**
 * Detokenize STAGE B2 — Entity.thaiCitizenId keyed-HMAC lookup substrate.
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md
 *      ("REQUIRED scope addition" — Entity.thaiCitizenId is a SECOND plaintext
 *       national ID looked up by an UNKEYED SHA-256 thaiCitizenIdHash that is
 *       brute-forceable from a dump with NO key).
 *
 * Proves the four B2 contract points (mirroring h4-hmac-lookup-flag.test.js):
 *   (a) ensurePersonalIndividualEntity create DUAL-WRITES thaiCitizenIdHmac =
 *       computeLookupHmac(healthId) ALONGSIDE the legacy unkeyed
 *       thaiCitizenIdHash (additive; legacy hash still written for rollback).
 *   (b) create/dedup prefers the stable EntityMembership(userId, OWNER,
 *       INDIVIDUAL) link. (The per-request personal-entity lookups this file
 *       also pinned, in active-entity-middleware and
 *       findPersonalEntityForHealthIdentity, were removed in R2 Task 12.)
 *   (c) flag OFF (default) = legacy unkeyed-hash behaviour unchanged (the
 *       create/dedup fallback reads thaiCitizenIdHash; never thaiCitizenIdHmac).
 *   (d) computeLookupHmac(healthId) matches the H-4 value (=== hashData by
 *       default, no dedicated key).
 */

const crypto = require('crypto');

// Flag starts OFF; individual tests toggle it explicitly.
delete process.env.AUTH_LOOKUP_USE_HMAC;
delete process.env.AUTH_LOOKUP_HMAC_KEY;

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entity: { findFirst: jest.fn(), create: jest.fn() },
        entityMembership: { findFirst: jest.fn(), upsert: jest.fn() },
    },
}));

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const { prisma } = require('../../services/prisma-database');
const entityService = require('../../services/entity-service');
const { computeLookupHmac, hashData } = require('../../utils/field-encryption');

const HEALTH_ID = '1100000000008';
const LEGACY_HASH = crypto.createHash('sha256').update(HEALTH_ID).digest('hex');
const USER = {
    id: 'user-1',
    healthId: HEALTH_ID,
    organizationId: 'org-1',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    email: 'somchai@gacpth.com',
};

afterEach(() => {
    delete process.env.AUTH_LOOKUP_USE_HMAC;
    jest.clearAllMocks();
});

describe('STAGE B2 — (d) computeLookupHmac matches the H-4 keyed value', () => {
    it('computeLookupHmac(healthId) === hashData(healthId) by default (no dedicated key)', () => {
        const hmac = computeLookupHmac(HEALTH_ID);
        expect(hmac).toBe(hashData(HEALTH_ID));
        // It is NOT the legacy unkeyed raw SHA-256 — disjoint value spaces.
        expect(hmac).not.toBe(LEGACY_HASH);
    });
});

describe('STAGE B2 — (a) ensurePersonalIndividualEntity dual-writes thaiCitizenIdHmac', () => {
    it('writes thaiCitizenIdHmac = computeLookupHmac(healthId) ALONGSIDE the legacy thaiCitizenIdHash', async () => {
        prisma.entityMembership.findFirst.mockResolvedValue(null); // no existing link
        prisma.entity.findFirst.mockResolvedValue(null);           // no existing entity
        prisma.entity.create.mockResolvedValue({ id: 'ent-personal', type: 'INDIVIDUAL' });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1', role: 'OWNER' });

        const out = await entityService.ensurePersonalIndividualEntity({ user: USER });

        expect(out.fresh).toBe(true);
        expect(prisma.entity.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                type: 'INDIVIDUAL',
                thaiCitizenId: HEALTH_ID,
                thaiCitizenIdHash: LEGACY_HASH,           // legacy unkeyed still written
                thaiCitizenIdHmac: computeLookupHmac(HEALTH_ID), // keyed, dual-written
                organizationId: 'org-1',
                createdBy: 'user-1',
            }),
        });
    });
});

describe('STAGE B2 — (b) create/dedup prefers the stable OWNER membership link', () => {
    it('resolves the existing personal entity via EntityMembership(userId, OWNER, INDIVIDUAL) without any hash lookup', async () => {
        prisma.entityMembership.findFirst.mockResolvedValue({ entity: { id: 'ent-existing', type: 'INDIVIDUAL' } });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });

        const out = await entityService.ensurePersonalIndividualEntity({ user: USER });

        expect(out.fresh).toBe(false);
        expect(out.entity).toMatchObject({ id: 'ent-existing' });
        // The membership link short-circuits BOTH the national-ID hash lookup
        // and the create.
        expect(prisma.entity.findFirst).not.toHaveBeenCalled();
        expect(prisma.entity.create).not.toHaveBeenCalled();
        expect(prisma.entityMembership.findFirst).toHaveBeenCalledWith({
            where: {
                userId: 'user-1',
                role: 'OWNER',
                entity: { type: 'INDIVIDUAL', isDeleted: false },
            },
            select: { entity: true },
            // Wave B chunk 6 — deterministic pick (oldest candidate wins).
            orderBy: { createdAt: 'asc' },
        });
    });
});

describe('STAGE B2 — (c) flag OFF = legacy unkeyed-hash dedup behaviour', () => {
    it('with no membership link and flag OFF, dedup falls back to the unkeyed thaiCitizenIdHash (never thaiCitizenIdHmac)', async () => {
        // flag OFF (default)
        prisma.entityMembership.findFirst.mockResolvedValue(null);
        prisma.entity.findFirst.mockResolvedValue({ id: 'ent-existing-by-hash' });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });

        const out = await entityService.ensurePersonalIndividualEntity({ user: USER });

        expect(out.fresh).toBe(false);
        expect(prisma.entity.findFirst).toHaveBeenCalledWith({
            where: { type: 'INDIVIDUAL', thaiCitizenIdHash: LEGACY_HASH },
            // Wave B chunk 6 — deterministic pick (oldest candidate wins).
            orderBy: { createdAt: 'asc' },
        });
        expect(prisma.entity.create).not.toHaveBeenCalled();
    });

    it('with no membership link and flag ON, dedup uses the keyed thaiCitizenIdHmac', async () => {
        process.env.AUTH_LOOKUP_USE_HMAC = 'true';
        prisma.entityMembership.findFirst.mockResolvedValue(null);
        prisma.entity.findFirst.mockResolvedValue({ id: 'ent-existing-by-hmac' });
        prisma.entityMembership.upsert.mockResolvedValue({ id: 'mem-1' });

        const out = await entityService.ensurePersonalIndividualEntity({ user: USER });

        expect(out.fresh).toBe(false);
        expect(prisma.entity.findFirst).toHaveBeenCalledWith({
            where: { type: 'INDIVIDUAL', thaiCitizenIdHmac: computeLookupHmac(HEALTH_ID) },
            // Wave B chunk 6 — deterministic pick (oldest candidate wins).
            orderBy: { createdAt: 'asc' },
        });
    });
});
