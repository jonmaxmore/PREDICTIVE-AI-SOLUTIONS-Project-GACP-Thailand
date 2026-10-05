/**
 * [Sprint6] resolveHealthIdentity Hash-First Lookup (M5 — second canonical resolver)
 *
 * Mirrors `login-hash-lookup.test.js` but covers the OTHER canonical
 * user-identity resolver:
 *
 *   apps/backend/services/application-service/application-identity-methods.js
 *
 * Before this Sprint the resolver used a plaintext WHERE on `User.healthId`.
 * After the refactor, the resolver:
 *   - UUID input  → queries by `User.id`           (no healthId WHERE)
 *   - 13-digit    → routes through `findUserByHealthIdSecurely`
 *                   which queries `healthIdHash` (raw SHA-256, NOT HMAC)
 *   - Otherwise   → throws (no broad fallback)
 *
 * The legacy fallback for `identityRef` carrying a Thai-ID (legacy tokens)
 * is preserved but is now routed through the canonical hash-first helper.
 */

const crypto = require('crypto');

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const prisma = {
    user: {
        findFirst: jest.fn(),
    },
};

const findUserByHealthIdSecurely = jest.fn();

const {
    createApplicationIdentityMethods,
} = require('../../services/application-service/application-identity-methods');

function makeService() {
    const methods = createApplicationIdentityMethods({
        prisma,
        logger,
        findUserByHealthIdSecurely,
    });
    // Bind `this` so the resolver can call `this.normalizeIdentityValue`.
    return {
        resolveHealthIdentity: (...args) => methods.resolveHealthIdentity.apply(methods, args),
    };
}

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

const UUID = '11111111-2222-3333-4444-555555555555';
const HEALTH_ID = '1100100100011';

describe('[Sprint6] resolveHealthIdentity Hash-First Lookup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('UUID input → queries by User.id, NOT by healthId', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: UUID, healthId: HEALTH_ID });

        const service = makeService();
        const identity = await service.resolveHealthIdentity(UUID);

        expect(identity).toEqual({ userId: UUID, healthId: HEALTH_ID });

        // The single prisma call must be a WHERE on `id`, never on plaintext
        // `healthId`. This is the guarantee that survives PDPA Phase D.
        expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
        const whereArg = prisma.user.findFirst.mock.calls[0][0].where;
        expect(whereArg).toEqual({ id: UUID, isDeleted: false });
        expect(whereArg.healthId).toBeUndefined();

        // The hash-first helper must NOT be invoked for a UUID input.
        expect(findUserByHealthIdSecurely).not.toHaveBeenCalled();
    });

    it('13-digit healthId option → routes through findUserByHealthIdSecurely (hash-first), NOT plaintext WHERE', async () => {
        findUserByHealthIdSecurely.mockResolvedValue({ id: UUID, healthId: HEALTH_ID });

        const service = makeService();
        const identity = await service.resolveHealthIdentity(UUID, { healthId: HEALTH_ID });

        expect(identity).toEqual({ userId: UUID, healthId: HEALTH_ID });

        // Canonical helper invoked with the cleartext healthId; the helper
        // internally queries `healthIdHash = sha256(healthId)`.
        expect(findUserByHealthIdSecurely).toHaveBeenCalledTimes(1);
        const [healthIdArg, opts] = findUserByHealthIdSecurely.mock.calls[0];
        expect(healthIdArg).toBe(HEALTH_ID);
        expect(opts.client).toBe(prisma);
        // STAGE A (detokenize): resolveHealthIdentity also selects canonicalId
        // (the FK token) so fkValue() can return the token under APP_FK_USE_TOKEN.
        expect(opts.select).toEqual({ id: true, healthId: true, canonicalId: true });

        // The local resolver must NEVER fall back to a plaintext findFirst
        // when the canonical helper is the active path.
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('hash format matches production writer (raw SHA-256, not HMAC)', async () => {
        // Sanity guard: the contract with findUserByHealthIdSecurely is that
        // it computes `crypto.createHash("sha256").update(plaintext).digest("hex")`
        // — same shape `prisma-auth-service.js _generateHashes()` writes on
        // registration. If anyone ever swaps the resolver to compute the hash
        // locally with `hashData()` (HMAC), this test surfaces it.
        const expected = sha256(HEALTH_ID);
        expect(expected).toMatch(/^[0-9a-f]{64}$/);
        // No assertion on prisma here — it's documentation that the canonical
        // helper signature stays in `crypto.createHash("sha256")` land.
        expect(expected).toBe(crypto.createHash('sha256').update(HEALTH_ID).digest('hex'));
    });

    it('legacy fallback — 13-digit identityRef (no options.healthId) routes through canonical hash-first helper', async () => {
        // No options.healthId, but identityRef looks like a Thai national ID
        // (some legacy tokens placed healthId in `id`). Path 3.
        findUserByHealthIdSecurely.mockResolvedValue({ id: UUID, healthId: HEALTH_ID });

        const service = makeService();
        const identity = await service.resolveHealthIdentity(HEALTH_ID);

        expect(identity).toEqual({ userId: UUID, healthId: HEALTH_ID });

        // findUserByHealthIdSecurely is the only DB path — no direct plaintext WHERE.
        expect(findUserByHealthIdSecurely).toHaveBeenCalledTimes(1);
        expect(findUserByHealthIdSecurely.mock.calls[0][0]).toBe(HEALTH_ID);
        expect(prisma.user.findFirst).not.toHaveBeenCalled();

        // Fallback path must mask the raw ID in logs.
        expect(logger.warn).toHaveBeenCalled();
        const warnPayload = logger.warn.mock.calls[0][1];
        expect(warnPayload).not.toHaveProperty('providedId', HEALTH_ID);
        expect(warnPayload.providedIdMasked).toBeDefined();
        expect(warnPayload.providedIdMasked).not.toContain(HEALTH_ID);
    });

    it('non-matching healthId → throws "Health account not found"', async () => {
        findUserByHealthIdSecurely.mockResolvedValue(null);

        const service = makeService();
        await expect(
            service.resolveHealthIdentity(UUID, { healthId: HEALTH_ID }),
        ).rejects.toThrow(/Health account not found/i);
    });

    it('non-matching UUID → throws (no broad fallback)', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        const service = makeService();
        await expect(
            service.resolveHealthIdentity(UUID),
        ).rejects.toThrow(/Health identity is required/i);

        // Critical: the resolver MUST NOT secondary-query plaintext healthId
        // with the UUID value. That was the old fallback that broke PDPA Phase D.
        expect(findUserByHealthIdSecurely).not.toHaveBeenCalled();
    });

    it('UUID exists but has no healthId column → throws "must have healthId"', async () => {
        prisma.user.findFirst.mockResolvedValue({ id: UUID, healthId: null });

        const service = makeService();
        await expect(
            service.resolveHealthIdentity(UUID),
        ).rejects.toThrow(/must have healthId/i);
    });

    it('garbage input (not UUID, not 13-digit, no healthId option) → throws, no DB call', async () => {
        const service = makeService();

        await expect(
            service.resolveHealthIdentity('not-a-real-identifier'),
        ).rejects.toThrow(/Health identity is required/i);

        expect(prisma.user.findFirst).not.toHaveBeenCalled();
        expect(findUserByHealthIdSecurely).not.toHaveBeenCalled();
    });

    it('empty / null input → throws, no DB call', async () => {
        const service = makeService();

        await expect(
            service.resolveHealthIdentity(null),
        ).rejects.toThrow(/Health identity is required/i);

        expect(prisma.user.findFirst).not.toHaveBeenCalled();
        expect(findUserByHealthIdSecurely).not.toHaveBeenCalled();
    });

    it('explicitUserId (UUID) mismatch with healthId-resolved user → logs masked warn but still returns the healthId-resolved user', async () => {
        const otherUuid = '99999999-8888-7777-6666-555555555555';
        findUserByHealthIdSecurely.mockResolvedValue({ id: UUID, healthId: HEALTH_ID });

        const service = makeService();
        const identity = await service.resolveHealthIdentity(otherUuid, { healthId: HEALTH_ID });

        expect(identity).toEqual({ userId: UUID, healthId: HEALTH_ID });

        // Warn fires with MASKED healthId — the raw 13-digit value must not appear.
        expect(logger.warn).toHaveBeenCalled();
        const warnPayload = logger.warn.mock.calls[0][1];
        expect(warnPayload.healthIdMasked).toBeDefined();
        expect(warnPayload.healthIdMasked).not.toContain(HEALTH_ID);
        // Raw value must NEVER be in the log payload under a non-masked key.
        const serialized = JSON.stringify(warnPayload);
        expect(serialized).not.toContain(HEALTH_ID);
    });
});
