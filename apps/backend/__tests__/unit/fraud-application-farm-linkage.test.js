'use strict';

/**
 * Linkage Option 1 (2026-06-08) — fraud duplicate-farm ID-card / photo checks
 * resolve a farm's applications via the Entity link
 * (Application.entityId === Farm.entityId) with an owner-chain fallback
 * (Farm.ownerId → User.canonicalId → Application.healthId).
 *
 * Previously _checkIdCardDuplicates / _checkPhotoDuplicates queried
 * `Application.farmId` (no such column) and `include: { application: { include:
 * { farm } } }` (no such relation), so they threw PrismaClientValidationError and
 * were degraded to no-ops (#379). This pins the corrected, non-throwing shape.
 */

const { createFraudDuplicateFarmMethods } = require('../../services/fraud-detection/duplicate-farm-methods');

function make(overrides = {}) {
  const prisma = {
    application: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    applicationDocument: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const methods = createFraudDuplicateFarmMethods({ prisma, cacheService: { set: jest.fn() }, logger });
  methods._maskIdNumber = () => 'MASK';
  return { methods, prisma };
}

describe('fraud Application↔Farm linkage (Option 1)', () => {
  it('_applicationIdsForFarm resolves via entityId (primary) and short-circuits the owner path', async () => {
    const application = { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]) };
    const { methods, prisma } = make({ application });

    const ids = await methods._applicationIdsForFarm({ id: 'f1', entityId: 'e1', ownerId: 'o1' });

    expect(ids).toEqual(['a1', 'a2']);
    expect(application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityId: 'e1', isDeleted: false }) }),
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('_applicationIdsForFarm falls back to the owner chain when entityId is null', async () => {
    const application = { findMany: jest.fn().mockResolvedValue([{ id: 'a9' }]) };
    const user = { findUnique: jest.fn().mockResolvedValue({ canonicalId: 'C-123' }) };
    const { methods } = make({ application, user });

    const ids = await methods._applicationIdsForFarm({ id: 'f1', entityId: null, ownerId: 'o1' });

    expect(ids).toEqual(['a9']);
    expect(user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1' } }));
    expect(application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ healthId: 'C-123', isDeleted: false }) }),
    );
  });

  it('_applicationIdsForFarm returns [] when there is no entity and no resolvable owner', async () => {
    const { methods } = make();
    expect(await methods._applicationIdsForFarm({ id: 'f1', entityId: null, ownerId: null })).toEqual([]);
  });

  it('_checkIdCardDuplicates never queries Application.farmId nor includes application.farm', async () => {
    const application = { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]) };
    const applicationDocument = {
      findMany: jest.fn()
        .mockResolvedValueOnce([{ idNumber: '1234567890123' }])                       // own ID docs
        .mockResolvedValueOnce([{ idNumber: '1234567890123', applicationId: 'OTHER' }]), // dup elsewhere
    };
    const { methods } = make({ application, applicationDocument });

    const findings = await methods._checkIdCardDuplicates({ id: 'f1', entityId: 'e1', ownerId: 'o1' });

    for (const call of applicationDocument.findMany.mock.calls) {
      expect(call[0].where || {}).not.toHaveProperty('farmId');
      expect(JSON.stringify(call[0])).not.toContain('"farm"');
    }
    expect(findings).toEqual([{ idNumber: 'MASK', usedInApplications: [{ applicationId: 'OTHER' }] }]);
  });

  it('_checkPhotoDuplicates resolves via appIds and groups exact-hash matches', async () => {
    const application = { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]) };
    const applicationDocument = {
      findMany: jest.fn()
        .mockResolvedValueOnce([{ id: 'p1', photoHash: 'H' }])                           // own photos
        .mockResolvedValueOnce([{ id: 'p2', photoHash: 'H', applicationId: 'OTHER' }]),   // same hash elsewhere
    };
    const { methods } = make({ application, applicationDocument });

    const findings = await methods._checkPhotoDuplicates({ id: 'f1', entityId: 'e1' });

    expect(findings).toEqual([
      { photoId: 'p1', similarPhotos: [{ photoId: 'p2', applicationId: 'OTHER', similarity: 'EXACT_MATCH' }] },
    ]);
  });
});
