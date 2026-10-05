/**
 * Unit tests for PrismaAuthService audit fixes
 * Tests: B-01 password reset (retired — pinned absent), H-04 mock OCR gate, H-05 updateProfile whitelist
 */

const _bcrypt = require('bcryptjs');

// ── Prisma Mock ──
const mockPrismaUser = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
};

// Wave B Phase 67 — register() now also touches Organization, Entity,
// EntityMembership inside a transaction. Provide lightweight mocks so
// the OCR-gate tests still exercise the verification-status branch
// without 500-ing on `prisma.entity.findFirst is not a function`.
const mockPrismaOrganization = {
    findUnique: jest.fn().mockResolvedValue({ id: 'org-default', slug: 'default' }),
};
const mockPrismaEntity = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'ent-personal', type: 'INDIVIDUAL' }),
};
const mockPrismaEntityMembership = {
    upsert: jest.fn().mockResolvedValue({ id: 'mem-1', role: 'OWNER' }),
};

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: mockPrismaUser,
        organization: mockPrismaOrganization,
        entity: mockPrismaEntity,
        entityMembership: mockPrismaEntityMembership,
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        $transaction: jest.fn(async (fnOrArray) => {
            if (Array.isArray(fnOrArray)) {return Promise.all(fnOrArray);}
            return fnOrArray({
                user: mockPrismaUser,
                entity: mockPrismaEntity,
                entityMembership: mockPrismaEntityMembership,
                organization: mockPrismaOrganization,
            });
        }),
    },
}));

jest.mock('../../config/jwt-security', () => ({
    generateToken: jest.fn(() => 'mock-token'),
    generateRefreshToken: jest.fn(() => 'mock-refresh'),
}));

const mockRevokeAllUserTokens = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/token-revocation-service', () => ({
    revokeAllUserTokens: (...a) => mockRevokeAllUserTokens(...a),
}));

jest.mock('../../services/security-compliance', () => ({
    RBACService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn().mockImplementation(() => ({ user: mockPrismaUser })),
}));

// ── Import after mocks ──
const authService = require('../../services/prisma-auth-service');

// ═══════════════════════════════════════════════════════════════════════
// B-01: Password Reset
// ═══════════════════════════════════════════════════════════════════════
describe('B-01: Password Reset', () => {
    beforeEach(() => jest.clearAllMocks());

    // requestPasswordReset was removed 2026-09-16 (operator: no forgot-password by
    // email or SMS) — no-self-service-password-reset.test.js pins the absence.
    it('the service exposes no way to request a reset', () => {
        expect(authService.requestPasswordReset).toBeUndefined();
    });

    // resetPasswordWithToken was removed 2026-09-17 (operator: "เราไม่มีการกู้บัญชี").
    // It redeemed the token staff issued from the directory; both ends are gone.
    // Checked by name pattern, not one name, so a renamed redeemer is caught too.
    it('the service exposes no way to redeem a reset token', () => {
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(authService));
        expect(methods).toContain('changePassword'); // positive control: the real class
        expect(methods.filter((name) => /reset|recover/i.test(name))).toEqual([]);

        const passwordManagement = require('../../services/auth/password-management');
        expect(Object.keys(passwordManagement)).toEqual(['changePassword']);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// H-05: updateProfile Whitelist
// ═══════════════════════════════════════════════════════════════════════
describe('H-05: updateProfile Whitelist', () => {
    beforeEach(() => jest.clearAllMocks());

    it('should allow whitelisted fields', async () => {
        mockPrismaUser.update.mockResolvedValue({ id: 'user-1', firstName: 'Updated' });

        await authService.updateProfile('user-1', {
            firstName: 'Updated',
            lastName: 'Name',
            phoneNumber: '0812345678',
        });

        expect(mockPrismaUser.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: {
                firstName: 'Updated',
                lastName: 'Name',
                phoneNumber: '0812345678',
            },
        });
    });

    it('should BLOCK role escalation attempt', async () => {
        mockPrismaUser.update.mockResolvedValue({ id: 'user-1' });

        await authService.updateProfile('user-1', {
            firstName: 'Legit',
            role: 'ADMIN', // ← malicious
        });

        const savedData = mockPrismaUser.update.mock.calls[0][0].data;
        expect(savedData.role).toBeUndefined();
        expect(savedData.firstName).toBe('Legit');
    });

    it('should BLOCK status manipulation', async () => {
        mockPrismaUser.update.mockResolvedValue({ id: 'user-1' });

        await authService.updateProfile('user-1', {
            firstName: 'Legit',
            status: 'ACTIVE', // ← malicious
            verificationStatus: 'APPROVED', // ← malicious
            isLocked: false, // ← malicious
        });

        const savedData = mockPrismaUser.update.mock.calls[0][0].data;
        expect(savedData.status).toBeUndefined();
        expect(savedData.verificationStatus).toBeUndefined();
        expect(savedData.isLocked).toBeUndefined();
    });

    it('should BLOCK password change via profile update', async () => {
        mockPrismaUser.update.mockResolvedValue({ id: 'user-1' });

        await authService.updateProfile('user-1', {
            firstName: 'Legit',
            password: 'hacked123', // ← malicious
        });

        const savedData = mockPrismaUser.update.mock.calls[0][0].data;
        expect(savedData.password).toBeUndefined();
    });

    it('should throw when no valid fields provided', async () => {
        await expect(authService.updateProfile('user-1', {
            role: 'ADMIN',
            isLocked: false,
        })).rejects.toThrow('No valid fields to update');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// H-04: Mock OCR Gate
// ═══════════════════════════════════════════════════════════════════════
describe('H-04: OCR Bypass Toggle (ENABLE_OCR_BYPASS)', () => {
    const originalEnv = process.env.ENABLE_OCR_BYPASS;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.ENABLE_OCR_BYPASS;
        } else {
            process.env.ENABLE_OCR_BYPASS = originalEnv;
        }
        jest.clearAllMocks();
    });

    it('should default to PENDING_VERIFICATION when bypass is off', async () => {
        delete process.env.ENABLE_OCR_BYPASS;

        const mockCreatedUser = {
            id: 'user-new',
            status: 'PENDING_VERIFICATION',
            verificationStatus: 'PENDING_VERIFICATION',
        };
        mockPrismaUser.create.mockResolvedValue(mockCreatedUser);

        await authService.register({
            identifier: '1234567890120',
            healthId: '1234567890120',
            password: 'test123456',
            firstName: 'Test',
            lastName: 'User',
            phoneNumber: '0812345678',
        });

        const createPayload = mockPrismaUser.create.mock.calls[0][0].data;
        // verificationStatus removed — field does not exist in Prisma schema
        expect(createPayload.status).toBe('PENDING_VERIFICATION');
    });

    it('should auto-approve when ENABLE_OCR_BYPASS=true (env bypass)', async () => {
        process.env.ENABLE_OCR_BYPASS = 'true';

        const mockCreatedUser = {
            id: 'user-new',
            status: 'ACTIVE',
            verificationStatus: 'APPROVED',
        };
        mockPrismaUser.create.mockResolvedValue(mockCreatedUser);

        await authService.register({
            identifier: '1234567890120',
            healthId: '1234567890120',
            password: 'test123456',
            firstName: 'Test',
            lastName: 'User',
            phoneNumber: '0812345678',
        });

        const createPayload = mockPrismaUser.create.mock.calls[0][0].data;
        // verificationStatus removed — field does not exist in Prisma schema
        expect(createPayload.status).toBe('ACTIVE');
    });

    it('should auto-approve ALL IDs when bypass is on (no ID-ending-in-9 exception)', async () => {
        process.env.ENABLE_OCR_BYPASS = 'true';

        const mockCreatedUser = {
            id: 'user-new',
            status: 'ACTIVE',
            verificationStatus: 'APPROVED',
        };
        mockPrismaUser.create.mockResolvedValue(mockCreatedUser);

        await authService.register({
            identifier: '1234567890129', // ends in 9 — should still be APPROVED now
            healthId: '1234567890129',
            password: 'test123456',
            firstName: 'Test',
            lastName: 'User',
            phoneNumber: '0812345678',
        });

        const createPayload = mockPrismaUser.create.mock.calls[0][0].data;
        // verificationStatus removed — field does not exist in Prisma schema
        expect(createPayload.status).toBe('ACTIVE');
    });
});
