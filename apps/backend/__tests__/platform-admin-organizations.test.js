/**
 * Contract tests for the platform-admin Organization API.
 *
 * No real DB — Prisma is mocked. The auth-middleware is mocked to inject
 * an ADMIN user so the handler chain runs end-to-end (validation,
 * withoutTenantScope wrapper, Prisma call shape, response shape).
 */

const express = require('express');
const request = require('supertest');

// ─── mocks (must be set before requiring the router) ────────────────────

const mockOrganization = {
  create: jest.fn(),
  findMany: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
};

const mockUser = {
  create: jest.fn(),
};

jest.mock('../services/prisma-database', () => ({
  prisma: { organization: mockOrganization, user: mockUser },
}));

jest.mock('../middleware/auth-middleware', () => {
  const passAdmin = (req, _res, next) => {
    req.user = { id: 'admin-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' };
    next();
  };
  const requireRole = () => (_req, _res, next) => next();
  return {
    authenticateProvider: passAdmin,
    requireRole,
  };
});

const router = require('../routes/api/platform-admin/organizations');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/platform-admin/organizations', router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/platform-admin/organizations', () => {
  const validBody = {
    name: 'DOA Chiang Mai',
    slug: 'doa-chiangmai',
    code: 'DOA_CMI',
    type: 'GOVERNMENT',
    contactEmail: 'cmi@doa.go.th',
  };

  it('creates an organization with valid input', async () => {
    mockOrganization.create.mockResolvedValueOnce({
      id: 'org-1',
      ...validBody,
      isolationTier: 'SHARED',
      status: 'ACTIVE',
      locale: 'th-TH',
      timezone: 'Asia/Bangkok',
      settings: {},
    });

    const res = await request(buildApp())
      .post('/api/platform-admin/organizations')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.slug).toBe('doa-chiangmai');
    expect(mockOrganization.create).toHaveBeenCalledTimes(1);
    const createArgs = mockOrganization.create.mock.calls[0][0];
    expect(createArgs.data.createdBy).toBe('admin-1');
    expect(createArgs.data.settings).toEqual({});
  });

  it('rejects an invalid slug (uppercase)', async () => {
    const res = await request(buildApp())
      .post('/api/platform-admin/organizations')
      .send({ ...validBody, slug: 'DOA-CMI' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
    expect(mockOrganization.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid code (lowercase)', async () => {
    const res = await request(buildApp())
      .post('/api/platform-admin/organizations')
      .send({ ...validBody, code: 'doa_cmi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ValidationError');
  });

  it('rejects unknown organization type', async () => {
    const res = await request(buildApp())
      .post('/api/platform-admin/organizations')
      .send({ ...validBody, type: 'PIRATE' });
    expect(res.status).toBe(400);
  });

  it('returns 409 on slug conflict (Prisma P2002)', async () => {
    const conflictErr = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['slug'] },
    });
    mockOrganization.create.mockRejectedValueOnce(conflictErr);

    const res = await request(buildApp())
      .post('/api/platform-admin/organizations')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Conflict');
    expect(res.body.target).toEqual(['slug']);
  });
});

describe('GET /api/platform-admin/organizations', () => {
  it('returns paginated list with cursor when more than limit', async () => {
    const fakeRows = Array.from({ length: 51 }, (_, i) => ({
      id: `org-${i}`,
      slug: `s-${i}`,
      code: `C_${i}`,
      name: `Org ${i}`,
      isDeleted: false,
    }));
    mockOrganization.findMany.mockResolvedValueOnce(fakeRows);

    const res = await request(buildApp())
      .get('/api/platform-admin/organizations')
      .query({ limit: 50 });

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(50);
    expect(res.body.data.nextCursor).toBe('org-49');
  });

  it('omits cursor when results fit in single page', async () => {
    mockOrganization.findMany.mockResolvedValueOnce([
      { id: 'org-1', slug: 's', code: 'C', name: 'Org', isDeleted: false },
    ]);
    const res = await request(buildApp()).get('/api/platform-admin/organizations');
    expect(res.body.data.nextCursor).toBeNull();
  });

  it('passes status + type filters to Prisma', async () => {
    mockOrganization.findMany.mockResolvedValueOnce([]);
    await request(buildApp())
      .get('/api/platform-admin/organizations')
      .query({ status: 'ACTIVE', type: 'COOPERATIVE' });
    const args = mockOrganization.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('ACTIVE');
    expect(args.where.type).toBe('COOPERATIVE');
    expect(args.where.isDeleted).toBe(false);
  });
});

describe('GET /api/platform-admin/organizations/:id', () => {
  it('returns organization when found', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce({
      id: 'org-1',
      slug: 'foo',
      isDeleted: false,
    });
    const res = await request(buildApp()).get('/api/platform-admin/organizations/org-1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('org-1');
  });

  it('returns 404 for missing org', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce(null);
    const res = await request(buildApp()).get('/api/platform-admin/organizations/nope');
    expect(res.status).toBe(404);
  });

  it('returns 404 for soft-deleted org', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce({
      id: 'org-1', isDeleted: true,
    });
    const res = await request(buildApp()).get('/api/platform-admin/organizations/org-1');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/platform-admin/organizations/:id', () => {
  it('updates allowed fields', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce({
      id: 'org-1', slug: 'foo', isDeleted: false,
    });
    mockOrganization.update.mockResolvedValueOnce({
      id: 'org-1', slug: 'foo', name: 'New Name', status: 'SUSPENDED',
    });

    const res = await request(buildApp())
      .patch('/api/platform-admin/organizations/org-1')
      .send({ name: 'New Name', status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUSPENDED');
    const updateArgs = mockOrganization.update.mock.calls[0][0];
    expect(updateArgs.data.name).toBe('New Name');
    expect(updateArgs.data.updatedBy).toBe('admin-1');
  });

  it('rejects invalid status', async () => {
    const res = await request(buildApp())
      .patch('/api/platform-admin/organizations/org-1')
      .send({ status: 'DISSOLVED' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when target org does not exist', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce(null);
    const res = await request(buildApp())
      .patch('/api/platform-admin/organizations/nope')
      .send({ name: 'X' });
    expect(res.status).toBe(404);
    expect(mockOrganization.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/platform-admin/organizations/:id/users', () => {
  const baseOrg = {
    id: 'org-1',
    slug: 'doa-cmi',
    code: 'DOA_CMI',
    status: 'ACTIVE',
    isDeleted: false,
  };
  const validUser = {
    email: 'admin@doa.go.th',
    firstName: 'Somchai',
    lastName: 'Saetang',
    role: 'system_admin_dtam',
    // เลขบนบัตรราชการ — ผู้ดูแลกรอกให้ (มติ operator 2026-09-12)
    // เดิมประตูสร้างรหัสสังเคราะห์ `DOA_CMI_5BB283` เอง ซึ่งประตูล็อกอินปฏิเสธ
    // บัญชีที่สร้างจึงใช้ไม่ได้ทุกใบ
    providerId: '1234567890123',
  };

  it('creates a user with auto-generated password and returns it once', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce(baseOrg);
    mockUser.create.mockImplementationOnce(({ data }) =>
      Promise.resolve({
        id: 'u-1',
        ...data,
        // password is hashed; tests should not see plaintext
      }),
    );

    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/org-1/users')
      .send(validUser);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.generatedPassword).toBe('string');
    expect(res.body.data.generatedPassword.length).toBeGreaterThanOrEqual(20);
    expect(res.body.data.user.password).toBeUndefined();
    // รหัสเข้าสู่ระบบคือเลขที่ผู้ดูแลกรอก ไม่ใช่รหัสที่ระบบคิดขึ้นเอง
    expect(res.body.data.user.providerId).toBe('1234567890123');
    // The request sends the UPPERCASE wire value (zod enum, unchanged); the
    // row — and therefore the echo — is canonical, same as every other
    // endpoint that returns user.role from the canonicalised column.
    expect(res.body.data.user.role).toBe('system_admin_dtam');
    expect(res.body.data.user.organizationId).toBe('org-1');
    expect(res.body.data.loginHint.portal).toBe('PROVIDER');

    const createArgs = mockUser.create.mock.calls[0][0];
    // password must be hashed, not the same as generated
    expect(createArgs.data.password).not.toBe(res.body.data.generatedPassword);
    expect(createArgs.data.password.length).toBeGreaterThan(40); // bcrypt
    expect(createArgs.data.accountType).toBe('PROVIDER');
    expect(createArgs.data.status).toBe('ACTIVE');
    expect(createArgs.data.ministryVerified).toBe(true);

    // ชั้นที่เงียบ: ถ้าไม่เขียนคอลัมน์ค้นหา บัญชีจะ "สร้างสำเร็จ" แต่ประตูล็อกอินหาไม่เจอ
    // (คอลัมน์ providerId แบบข้อความถูกเข้ารหัสตอนเขียน ทางสำรองจึงไม่แมตช์)
    expect(typeof createArgs.data.providerIdHash).toBe('string');
    expect(createArgs.data.providerIdHash.length).toBeGreaterThan(20);
  });

  it('ปฏิเสธเลขที่ไม่ใช่ 13 หลัก — กติกาเดียวกับประตูล็อกอิน', async () => {
    for (const bad of ['DOA_CMI_5BB283', '12345', '', '123456789012345']) {
      const res = await request(buildApp())
        .post('/api/platform-admin/organizations/org-1/users')
        .send({ ...validUser, providerId: bad });
      expect(res.status).toBe(400);
    }
  });

  it('รับเลขที่มีขีดคั่น แล้วเก็บแบบไม่มีขีด — เหมือนที่ประตูล็อกอินทำ', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce(baseOrg);
    mockUser.create.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'u-3', ...data }));

    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/org-1/users')
      .send({ ...validUser, providerId: '1-2345-67890-12-3' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.providerId).toBe('1234567890123');
  });

  it('uses caller-supplied password and does NOT echo it back', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce(baseOrg);
    mockUser.create.mockResolvedValueOnce({ id: 'u-2' });

    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/org-1/users')
      .send({ ...validUser, password: 'my-strong-bootstrap-password-1' });

    expect(res.status).toBe(201);
    expect(res.body.data.generatedPassword).toBeNull();
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('rejects passwords shorter than 12 chars', async () => {
    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/org-1/users')
      .send({ ...validUser, password: 'short' });
    expect(res.status).toBe(400);
    expect(mockUser.create).not.toHaveBeenCalled();
  });

  it('rejects unknown role', async () => {
    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/org-1/users')
      .send({ ...validUser, role: 'ROOT' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when org does not exist', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce(null);
    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/nope/users')
      .send(validUser);
    expect(res.status).toBe(404);
    expect(mockUser.create).not.toHaveBeenCalled();
  });

  it('returns 409 when org is suspended or archived', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce({ ...baseOrg, status: 'SUSPENDED' });
    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/org-1/users')
      .send(validUser);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/SUSPENDED/);
  });

  it('returns 409 on duplicate email (Prisma P2002)', async () => {
    mockOrganization.findUnique.mockResolvedValueOnce(baseOrg);
    const conflictErr = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['email'] },
    });
    mockUser.create.mockRejectedValueOnce(conflictErr);

    const res = await request(buildApp())
      .post('/api/platform-admin/organizations/org-1/users')
      .send(validUser);

    expect(res.status).toBe(409);
    expect(res.body.target).toEqual(['email']);
  });
});
