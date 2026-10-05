/**
 * Unit Tests for Authentication Service
 * Tests critical auth functions: login, register, password validation
 */

const bcrypt = require('bcryptjs');

// Mock Prisma
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
    },
}));

// Mock JWT Config
jest.mock('../../config/jwt-security', () => ({
    generateToken: jest.fn(() => 'mock-jwt-token'),
    generateRefreshToken: jest.fn(() => 'mock-refresh-token'),
}));

// BE-AUTH-03-02: changePassword revokes all sessions
// (best-effort). Keep the REAL module (login/issueRefreshToken depends on its
// other exports) and override only revokeAllUserTokens so we can assert it.
jest.mock('../../services/token-revocation-service', () => ({
    ...jest.requireActual('../../services/token-revocation-service'),
    revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
}));

const { prisma } = require('../../services/prisma-database');
const tokenRevocation = require('../../services/token-revocation-service');
const authService = require('../../services/prisma-auth-service');

describe('PrismaAuthService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // LOGIN TESTS
    describe('login()', () => {
        const mockUser = {
            id: 'user-123',
            email: 'test@example.com',
            idCard: '1234567890123',
            password: '$2a$10$hashedpassword', // bcrypt hash
            accountType: 'INDIVIDUAL',
            // A real users row always carries status (NOT NULL); login refuses
            // anything but ACTIVE / PENDING_VERIFICATION (SECU-03).
            status: 'ACTIVE',
            isLocked: false,
            lockedUntil: null,
            loginAttempts: 0,
        };

        it('should return user and tokens on successful login', async () => {
            // Setup
            prisma.user.findFirst.mockResolvedValue(mockUser);
            prisma.user.update.mockResolvedValue(mockUser);
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

            // Execute
            const result = await authService.login('1234567890123', 'password123', 'INDIVIDUAL');

            // Assert
            expect(result).toHaveProperty('user');
            expect(result).toHaveProperty('token');
            expect(result).toHaveProperty('refreshToken');
            expect(result.token).toBe('mock-jwt-token');
        });

        it('should throw error when user not found', async () => {
            prisma.user.findFirst.mockResolvedValue(null);

            await expect(
                authService.login('9999999999999', 'password123', 'INDIVIDUAL'),
            ).rejects.toThrow();
        });

        it('should throw error when password is incorrect', async () => {
            prisma.user.findFirst.mockResolvedValue(mockUser);
            prisma.user.update.mockResolvedValue({ ...mockUser, loginAttempts: 1 });
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

            await expect(
                authService.login('1234567890123', 'wrongpassword', 'INDIVIDUAL'),
            ).rejects.toThrow('Invalid credentials');
        });

        it('should throw error when account is locked', async () => {
            const lockedUser = {
                ...mockUser,
                isLocked: true,
                lockedUntil: new Date(Date.now() + 15 * 60 * 1000), // 15 mins from now
            };
            prisma.user.findFirst.mockResolvedValue(lockedUser);

            await expect(
                authService.login('1234567890123', 'password123', 'INDIVIDUAL'),
            ).rejects.toThrow(/Account locked/);
        });

        it('should lock account after 5 failed attempts', async () => {
            const userWith4Attempts = { ...mockUser, loginAttempts: 4 };
            prisma.user.findFirst.mockResolvedValue(userWith4Attempts);
            prisma.user.update.mockResolvedValue({ ...userWith4Attempts, isLocked: true });
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

            await expect(
                authService.login('1234567890123', 'wrongpassword', 'INDIVIDUAL'),
            ).rejects.toThrow('Account locked due to too many failed attempts.');

            expect(prisma.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        isLocked: true,
                        loginAttempts: 5,
                    }),
                }),
            );
        });

        it('should reset login attempts on successful login', async () => {
            prisma.user.findFirst.mockResolvedValue(mockUser);
            prisma.user.update.mockResolvedValue(mockUser);
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

            await authService.login('1234567890123', 'password123', 'INDIVIDUAL');

            expect(prisma.user.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        loginAttempts: 0,
                        isLocked: false,
                    }),
                }),
            );
        });
    });

    // ISSUE TOKENS — shared minting site used by login() and any
    // future flow that establishes a session. Locks the
    // contract that both surfaces produce { user, token, refreshToken }.
    describe('issueTokensForAuthenticatedUser()', () => {
        it('mints access + refresh tokens for an already-verified user', async () => {
            const user = {
                id: 'user-xyz',
                role: 'HEALTH',
                authType: 'HEALTH_ID',
                accountType: 'INDIVIDUAL',
                organizationId: 'org-1',
                email: 'a@b.co',
                status: 'ACTIVE',
            };

            const result = await authService.issueTokensForAuthenticatedUser(user, {});

            expect(result.user).toBe(user);
            expect(result.token).toBe('mock-jwt-token');
            expect(result.refreshToken).toBe('mock-refresh-token');
            // public (HEALTH) secret — never the provider secret.
            expect(require('../../config/jwt-security').generateToken)
                .toHaveBeenCalledWith(expect.objectContaining({ id: 'user-xyz', organizationId: 'org-1' }), 'public');
        });

        it('signs with the provider secret for a provider role', async () => {
            const user = { id: 'u2', role: 'field_inspector', authType: 'PROVIDER_ID', status: 'ACTIVE' };

            await authService.issueTokensForAuthenticatedUser(user, {});

            expect(require('../../config/jwt-security').generateToken)
                .toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }), 'provider');
        });

        // R-A Task 2 (ThaID MFA bypass close): the predicate that gates the
        // password path's login() (twoFactorEnabled → mfaRequired challenge,
        // no tokens) now ALSO lives at this shared mint boundary. login()
        // already special-cases twoFactorEnabled BEFORE it ever calls this
        // method, so this branch is unreachable from that caller and its
        // behavior is unchanged (see the two tests above). It exists so any
        // OTHER caller that resolves identity by a different means — e.g.
        // the ThaID IdP path (auth-idp.js resolveThaidSession) — cannot mint
        // a full session for a 2FA-enrolled user by skipping login()'s check.
        it('returns mfaRequired (NO tokens minted) when the resolved user has twoFactorEnabled=true', async () => {
            const user = {
                id: 'user-2fa', role: 'HEALTH', authType: 'HEALTH_ID',
                twoFactorEnabled: true, twoFactorMethod: 'TOTP', status: 'ACTIVE',
            };

            const result = await authService.issueTokensForAuthenticatedUser(user, {});

            expect(result).toEqual({ user, mfaRequired: true, twoFactorMethod: 'TOTP' });
            expect(result.token).toBeUndefined();
            expect(result.refreshToken).toBeUndefined();
            expect(require('../../config/jwt-security').generateToken).not.toHaveBeenCalled();
        });

        it('defaults twoFactorMethod to TOTP when the user row has none set', async () => {
            const user = { id: 'user-2fa-2', role: 'HEALTH', authType: 'HEALTH_ID', twoFactorEnabled: true, status: 'ACTIVE' };

            const result = await authService.issueTokensForAuthenticatedUser(user, {});

            expect(result).toEqual({ user, mfaRequired: true, twoFactorMethod: 'TOTP' });
        });

        it('honors the legacy mfaEnabled fallback column (mid-migration DB)', async () => {
            const user = { id: 'user-legacy', role: 'HEALTH', authType: 'HEALTH_ID', mfaEnabled: true, status: 'ACTIVE' };

            const result = await authService.issueTokensForAuthenticatedUser(user, {});

            expect(result.mfaRequired).toBe(true);
            expect(result.token).toBeUndefined();
        });
    });


    // CHECK IDENTIFIER TESTS
    describe('checkIdentifierExists()', () => {
        it('should return true if identifier exists', async () => {
            prisma.user.findFirst.mockResolvedValue({ id: 'user-123' });

            const result = await authService.checkIdentifierExists('1234567890123', 'INDIVIDUAL');

            expect(result).toBe(true);
        });

        it('should return false if identifier does not exist', async () => {
            prisma.user.findFirst.mockResolvedValue(null);

            const result = await authService.checkIdentifierExists('9999999999999', 'INDIVIDUAL');

            expect(result).toBe(false);
        });

        it('should return false for empty identifier', async () => {
            const result = await authService.checkIdentifierExists('', 'INDIVIDUAL');

            expect(result).toBe(false);
            expect(prisma.user.findFirst).not.toHaveBeenCalled();
        });

        it('should use correct hash field for JURISTIC account type', async () => {
            prisma.user.findFirst.mockResolvedValue(null);

            await authService.checkIdentifierExists('1234567890123', 'JURISTIC');

            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: { taxIdHash: expect.any(String) },
            });
        });

        it('should use correct hash field for COMMUNITY_ENTERPRISE account type', async () => {
            prisma.user.findFirst.mockResolvedValue(null);

            await authService.checkIdentifierExists('CE-12345', 'COMMUNITY_ENTERPRISE');

            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: { communityRegistrationNoHash: expect.any(String) },
            });
        });
    });

    // CHANGE PASSWORD TESTS
    describe('changePassword()', () => {
        const mockUser = {
            id: 'user-123',
            password: '$2a$10$hashedoldpassword',
        };

        it('should change password successfully', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            prisma.user.update.mockResolvedValue(mockUser);
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
            jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2a$10$hashednewpassword');

            const result = await authService.changePassword('user-123', 'oldpass', 'NewStr0ng@Pass1');

            expect(result).toBe(true);
            // BE-AUTH-03-03 (session epoch): the update now ALSO stamps
            // sessionsRevokedAt so a stolen token minted before the change is
            // rejected at /refresh + auth-middleware. Assert the password + the
            // epoch Date (matcher instead of exact-object so the timestamp is
            // not pinned to a fixed value).
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'user-123' },
                data: {
                    password: '$2a$10$hashednewpassword',
                    sessionsRevokedAt: expect.any(Date),
                    // 2026-09-26: the right current password clears the per-account
                    // failure count (the login lockout columns), as a login does.
                    loginAttempts: 0,
                    isLocked: false,
                    lockedUntil: null,
                },
            });
            // BE-AUTH-03-02: existing sessions are revoked after the change.
            expect(tokenRevocation.revokeAllUserTokens).toHaveBeenCalledWith('user-123');
        });

        it('does not fail the change if session revoke throws (best-effort, BE-AUTH-03-02)', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            prisma.user.update.mockResolvedValue(mockUser);
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
            jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2a$10$hashednewpassword');
            tokenRevocation.revokeAllUserTokens.mockRejectedValueOnce(new Error('redis down'));

            await expect(
                authService.changePassword('user-123', 'oldpass', 'NewStr0ng@Pass1'),
            ).resolves.toBe(true);
        });

        it('should throw error if user not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            await expect(
                authService.changePassword('nonexistent', 'oldpass', 'newpass'),
            ).rejects.toThrow();
        });

        it('should throw error if old password is incorrect', async () => {
            prisma.user.findUnique.mockResolvedValue(mockUser);
            jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

            await expect(
                authService.changePassword('user-123', 'wrongoldpass', 'newpass'),
            ).rejects.toThrow('รหัสผ่านเดิมไม่ถูกต้อง');
        });
    });

    // GET PROFILE TESTS
    describe('getProfile()', () => {
        it('should return user profile', async () => {
            const mockUser = { id: 'user-123', firstName: 'Test', lastName: 'User' };
            prisma.user.findUnique.mockResolvedValue(mockUser);

            const result = await authService.getProfile('user-123');

            expect(result).toEqual(mockUser);
            expect(prisma.user.findUnique).toHaveBeenCalledWith({
                where: { id: 'user-123' },
            });
        });

        it('should return null if user not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            const result = await authService.getProfile('nonexistent');

            expect(result).toBeNull();
        });
    });
});
