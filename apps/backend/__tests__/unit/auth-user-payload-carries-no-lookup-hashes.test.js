'use strict';

/**
 * Staging view-pack 2026-10-06, defect D3, and the security review of 4985b4ce.
 * The health auth doors (register, login, GET /me, PATCH /me) handed the client the
 * whole User row through a deny-list: keyed-HMAC lookup columns, the canonical id,
 * the plaintext national ID (the PDPA extension decrypts on read), the ID-card laser
 * code and account-lock state. They now send an allowlisted shape.
 *
 * CLIENT_FIELDS is the contract: the keys the web (AuthUser readers, profile,
 * settings, dashboard, session helpers) and the mobile app (auth_repository_impl,
 * profile_screen) read from these responses, plus the masked identifiers. The user
 * row handed to the controller is every scalar column of the Prisma User model, read
 * from the generated client, so a column added later is covered without editing
 * this test.
 */

const mockAuthService = {};
jest.mock('../../services/prisma-auth-service', () => mockAuthService);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        authEvent: (...args) => ({ args }),
        logMany: async () => 0,
        logAuth: async () => {},
    },
}));
jest.mock('../../middleware/consent-manager', () => ({
    consentManager: { recordRegistrationConsents: async () => ({ auditEvents: [], failures: [] }) },
    RequiredConsents: [],
}));

const { Prisma } = require('@prisma/client');
const AuthController = require('../../controllers/auth-controller');

const NATIONAL_ID = '1100000000008';
const LASER_CODE = 'JT0123456789';
const TAX_ID = '0105500000001';

const CLIENT_FIELDS = new Set([
    'id', 'uuid', 'email', 'firstName', 'lastName', 'phoneNumber', 'role', 'accountType',
    'authType', 'status', 'accountTier', 'ministryVerified', 'ministryVerifiedAt',
    'address', 'province', 'district', 'subdistrict', 'zipCode',
    'companyName', 'representativeName', 'representativePosition', 'communityName',
    'isEmailVerified', 'twoFactorEnabled', 'twoFactorMethod', 'privacySettings', 'notificationSettings',
    'createdAt', 'lastLoginAt', 'healthId', 'idCard',
]);

function fullUserRow() {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'User');
    const row = {};
    for (const field of model.fields) {
        if (field.kind !== 'scalar' && field.kind !== 'enum') { continue; }
        if (field.type === 'String') { row[field.name] = `value-of-${field.name}`; }
        else if (field.type === 'Boolean') { row[field.name] = false; }
        else if (field.type === 'Int') { row[field.name] = 0; }
        else if (field.type === 'DateTime') { row[field.name] = new Date('2026-10-06T00:00:00Z'); }
        else { row[field.name] = null; }
    }
    return {
        ...row,
        id: 'user-1', organizationId: 'org-1', role: 'health', twoFactorEnabled: false,
        healthId: NATIONAL_ID, idCard: NATIONAL_ID, providerId: NATIONAL_ID, canonicalId: NATIONAL_ID,
        laserCode: LASER_CODE, taxId: TAX_ID, communityRegistrationNo: TAX_ID,
    };
}

function fakeRes() {
    const res = { statusCode: 200, body: null, cookie: () => res };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.set = () => res;
    res.setHeader = () => res;
    return res;
}

function expectClientShape(user) {
    expect(user.id).toBe('user-1');
    expect(Object.keys(user).filter((k) => !CLIENT_FIELDS.has(k))).toEqual([]);
    const text = JSON.stringify(user);
    for (const secret of [NATIONAL_ID, LASER_CODE, TAX_ID]) { expect(text).not.toContain(secret); }
}

describe('the health auth doors send an allowlisted user (D3 + security review)', () => {
    test('the stub row really holds what the test looks for', () => {
        const row = fullUserRow();
        expect(Object.keys(row)).toEqual(expect.arrayContaining(['healthIdHmac', 'canonicalId', 'laserCode', 'loginAttempts', 'createdByIp', 'legalHold']));
    });

    test('POST /auth/health/register', async () => {
        mockAuthService.registerHealthUser = async () => ({ status: 201, body: { message: 'ok', data: { user: fullUserRow() } } });
        const res = fakeRes();
        await AuthController.register({ body: {}, headers: {}, ip: '127.0.0.1' }, res);
        expect(res.statusCode).toBe(201);
        expectClientShape(res.body.data.user);
    });

    test('POST /auth/health/login: national ID masked, laser code absent', async () => {
        mockAuthService.login = async () => ({ user: fullUserRow(), token: 'access', refreshToken: 'refresh' });
        const res = fakeRes();
        await AuthController.login({ body: { identifier: NATIONAL_ID, password: 'x' }, headers: {}, ip: '127.0.0.1' }, res);
        expect(res.statusCode).toBe(200);
        const user = res.body.data.user;
        expectClientShape(user);
        expect(user.healthId).toBe('1-XXXX-XXXX-X-0008');
        expect(user.idCard).toBe('1-XXXX-XXXX-X-0008');
        expect(user).not.toHaveProperty('laserCode');
        expect(user.firstName).toBe('value-of-firstName');
        expect(user.role).toBe('health');
    });

    test('GET and PATCH /auth/health/me', async () => {
        mockAuthService.getProfile = async () => fullUserRow();
        mockAuthService.updateProfile = async () => fullUserRow();
        const me = fakeRes();
        await AuthController.getMe({ user: { id: 'user-1' }, headers: {} }, me);
        expectClientShape(me.body.data);
        expect(me.body.data.healthId).toBe('1-XXXX-XXXX-X-0008');
        const patched = fakeRes();
        await AuthController.updateProfile({ user: { id: 'user-1' }, body: { firstName: 'สมชาย' }, headers: {} }, patched);
        expectClientShape(patched.body.data);
    });
});
