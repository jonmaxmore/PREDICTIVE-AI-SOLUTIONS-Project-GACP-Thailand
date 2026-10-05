const createPrismaMock = () => ({
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
});

describe('audit-trail service', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('maps legacy logAction payload to canonical audit logger', async () => {
    const prismaMock = createPrismaMock();
    const canonicalLog = jest.fn().mockResolvedValue({ id: 'audit-1' });

    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn(() => '127.0.0.1') }));
    jest.doMock('../../middleware/audit-logger', () => ({
      auditLogger: { log: canonicalLog },
      AuditCategory: { AUTHENTICATION: 'AUTHENTICATION', PAYMENT: 'PAYMENT', SYSTEM: 'SYSTEM' },
      AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
      ResourceType: {
        USER: 'USER',
        APPLICATION: 'APPLICATION',
        PAYMENT: 'PAYMENT',
        CERTIFICATE: 'CERTIFICATE',
        DOCUMENT: 'DOCUMENT',
        SYSTEM: 'SYSTEM',
      },
    }));

    const { logAction, ENTITIES, SEVERITY } = require('../../services/audit-trail');

    const result = await logAction({
      action: 'LOGIN_FAILED',
      entityType: ENTITIES.USER,
      entityId: 123,
      userId: 456,
      userEmail: 'user@example.com',
      userRole: 'HEALTH',
      ipAddress: '10.0.0.1',
      userAgent: 'jest-agent',
      sessionId: 'sess-1',
      description: 'login failed',
      severity: SEVERITY.ERROR,
      metadata: { source: 'test' },
    });

    expect(result).toEqual({ id: 'audit-1' });
    expect(canonicalLog).toHaveBeenCalledTimes(1);
    expect(canonicalLog).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'AUTHENTICATION',
        action: 'LOGIN_FAILED',
        severity: 'ERROR',
        actorId: '456',
        actorEmail: 'user@example.com',
        actorRole: 'HEALTH',
        actorType: 'USER',
        resourceType: 'USER',
        resourceId: '123',
        ipAddress: '10.0.0.1',
        userAgent: 'jest-agent',
        result: 'FAILURE',
        errorMessage: 'login failed',
        metadata: expect.objectContaining({
          legacyAuditTrail: true,
          entityType: ENTITIES.USER,
          entityId: '123',
          sessionId: 'sess-1',
          metadata: { source: 'test' },
        }),
      }),
    );
  });

  test('returns null and preserves non-blocking behavior when canonical logger fails', async () => {
    const prismaMock = createPrismaMock();
    const canonicalLog = jest.fn().mockRejectedValue(new Error('audit write failed'));

    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn(() => '127.0.0.1') }));
    jest.doMock('../../middleware/audit-logger', () => ({
      auditLogger: { log: canonicalLog },
      AuditCategory: { AUTHENTICATION: 'AUTHENTICATION', PAYMENT: 'PAYMENT', SYSTEM: 'SYSTEM' },
      AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
      ResourceType: {
        USER: 'USER',
        APPLICATION: 'APPLICATION',
        PAYMENT: 'PAYMENT',
        CERTIFICATE: 'CERTIFICATE',
        DOCUMENT: 'DOCUMENT',
        SYSTEM: 'SYSTEM',
      },
    }));

    const { logAction, ENTITIES } = require('../../services/audit-trail');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await logAction({
      action: 'UPDATE',
      entityType: ENTITIES.APPLICATION,
      entityId: 'app-1',
    });

    expect(result).toBeNull();
    expect(canonicalLog).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[AuditService] Failed to log action:', 'audit write failed');

    errorSpy.mockRestore();
  });

  // Canonical read-path helpers — listAuditEvents / exportAuditEvents /
  // getTimelineForApplication. Handlers must call these instead of
  // touching prisma.auditLog directly (see audit-log-viewer-handler.js and
  // workflow-audit-timelines-handler.js).
  describe('listAuditEvents', () => {
    function loadService() {
      const prismaMock = createPrismaMock();
      jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
      jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn() }));
      jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn() },
        AuditCategory: { AUTHENTICATION: 'AUTHENTICATION', PAYMENT: 'PAYMENT', SYSTEM: 'SYSTEM' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
        ResourceType: { USER: 'USER', APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
      }));
      return { prismaMock, service: require('../../services/audit-trail') };
    }

    test('applies pagination math (skip/take) from page+limit and returns total', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prismaMock.auditLog.count.mockResolvedValue(42);

      const result = await service.listAuditEvents({
        where: { category: 'APPLICATION' },
        page: 3,
        limit: 10,
        allowedColumns: ['id', 'action'],
      });

      expect(result).toEqual({
        rows: [{ id: 'a' }, { id: 'b' }],
        total: 42,
        page: 3,
        limit: 10,
      });

      const findArgs = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(findArgs.where).toEqual({ category: 'APPLICATION' });
      expect(findArgs.skip).toBe(20); // (3 - 1) * 10
      expect(findArgs.take).toBe(10);
      expect(findArgs.orderBy).toEqual({ createdAt: 'desc' });
      expect(findArgs.select).toEqual({ id: true, action: true });

      // Count is filtered by the same where clause — no separate filter drift.
      expect(prismaMock.auditLog.count).toHaveBeenCalledWith({ where: { category: 'APPLICATION' } });
    });

    test('caps oversized limit at maxLimit (prevents unbounded reads)', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      prismaMock.auditLog.count.mockResolvedValue(0);

      await service.listAuditEvents({ page: 1, limit: 9999, maxLimit: 200 });

      const findArgs = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(findArgs.take).toBe(200);
    });

    test('whitelists columns via select (no leakage of unexpected fields)', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      prismaMock.auditLog.count.mockResolvedValue(0);

      await service.listAuditEvents({
        page: 1,
        limit: 10,
        allowedColumns: ['logId', 'createdAt'],
      });

      const findArgs = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(findArgs.select).toEqual({ logId: true, createdAt: true });
      // Critically, prisma is never asked for sensitive columns we didn't whitelist.
      expect(findArgs.select.metadata).toBeUndefined();
      expect(findArgs.select.ipAddress).toBeUndefined();
    });

    test('falls back to default columns when allowedColumns omitted', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      prismaMock.auditLog.count.mockResolvedValue(0);

      await service.listAuditEvents({ page: 1, limit: 10 });

      const findArgs = prismaMock.auditLog.findMany.mock.calls[0][0];
      for (const col of service.VIEWER_DEFAULT_COLUMNS) {
        expect(findArgs.select[col]).toBe(true);
      }
    });
  });

  describe('exportAuditEvents', () => {
    function loadService() {
      const prismaMock = createPrismaMock();
      jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
      jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn() }));
      jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn() },
        AuditCategory: { AUTHENTICATION: 'AUTHENTICATION', PAYMENT: 'PAYMENT', SYSTEM: 'SYSTEM' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
        ResourceType: { USER: 'USER', APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
      }));
      return { prismaMock, service: require('../../services/audit-trail') };
    }

    test('enforces maxRows cap and whitelists columns', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([{ logId: 'L1' }]);

      const rows = await service.exportAuditEvents({
        where: { severity: 'ERROR' },
        maxRows: 50_000,
        allowedColumns: ['logId', 'createdAt'],
      });

      expect(rows).toEqual([{ logId: 'L1' }]);
      const args = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(args.take).toBe(50_000);
      expect(args.where).toEqual({ severity: 'ERROR' });
      expect(args.select).toEqual({ logId: true, createdAt: true });
    });

    test('throws when maxRows is missing or non-positive', async () => {
      const { service } = loadService();
      await expect(service.exportAuditEvents({})).rejects.toThrow(/maxRows/i);
      await expect(service.exportAuditEvents({ maxRows: 0 })).rejects.toThrow(/maxRows/i);
      await expect(service.exportAuditEvents({ maxRows: -1 })).rejects.toThrow(/maxRows/i);
    });
  });

  describe('getTimelineForApplication', () => {
    function loadService() {
      const prismaMock = createPrismaMock();
      jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
      jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn() }));
      jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn() },
        AuditCategory: { APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
        AuditSeverity: { INFO: 'INFO' },
        ResourceType: { APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
      }));
      return { prismaMock, service: require('../../services/audit-trail') };
    }

    test('queries by APPLICATION resource scoped to the id, ordered by sequenceNumber asc', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([
        { id: '1', sequenceNumber: 1 },
        { id: '2', sequenceNumber: 2 },
      ]);

      const rows = await service.getTimelineForApplication('app-abc');

      expect(rows).toHaveLength(2);
      const args = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ resourceType: 'APPLICATION', resourceId: 'app-abc' });
      expect(args.orderBy).toEqual({ sequenceNumber: 'asc' });
      expect(args.take).toBe(500); // default cap
    });

    test('returns empty array (no DB hit) when applicationId is falsy', async () => {
      const { prismaMock, service } = loadService();
      const rows = await service.getTimelineForApplication(null);
      expect(rows).toEqual([]);
      expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
    });

    test('clamps caller-supplied limit to a sane upper bound', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      await service.getTimelineForApplication('app-1', { limit: 999_999 });
      const args = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(args.take).toBe(2000); // hard cap inside the service
    });
  });

  // B15-B audit-evidence (2026-05-16): payment-trail helper used by
  // finance month-close + DTAM 5-yearly inspection. Verifies the
  // join across APPLICATION/PAYMENT/INVOICE resourceTypes, the
  // hash-chain integrity check on read, and the WHT-applicable
  // sentinel that keeps the response shape forward-compatible with
  // corporate-customer billing.
  describe('getPaymentAuditTrail', () => {
    function loadService() {
      const prismaMock = createPrismaMock();
      jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
      jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn() }));
      jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn() },
        AuditCategory: { PAYMENT: 'PAYMENT', APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', CRITICAL: 'CRITICAL' },
        ResourceType: {
          APPLICATION: 'APPLICATION',
          PAYMENT: 'PAYMENT',
          INVOICE: 'INVOICE',
          SYSTEM: 'SYSTEM',
        },
      }));
      return { prismaMock, service: require('../../services/audit-trail') };
    }

    test('returns empty trail (no DB hit) when applicationId is falsy', async () => {
      const { prismaMock, service } = loadService();
      const result = await service.getPaymentAuditTrail(null);
      expect(result.events).toEqual([]);
      expect(result.chain).toEqual({ verified: true, breaks: [] });
      expect(result.withholdingTaxApplicable).toBe(false);
      expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
    });

    test('joins three resource scopes and orders by sequenceNumber asc', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([
        {
          id: '1', logId: 'L1', sequenceNumber: 10,
          action: 'PAYMENT_SLIP_UPLOADED', resourceType: 'PAYMENT',
          previousHash: 'H-prev', currentHash: 'H1',
        },
        {
          id: '2', logId: 'L2', sequenceNumber: 11,
          action: 'PAYMENT_SLIP_APPROVED', resourceType: 'PAYMENT',
          previousHash: 'H1', currentHash: 'H2',
        },
      ]);

      const result = await service.getPaymentAuditTrail('app-evidence');

      expect(result.events).toHaveLength(2);
      // Per-row WHT hook stamped on every event for forward-compat
      // with the corporate-WHT rollout.
      for (const evt of result.events) {
        expect(evt.withholdingTaxApplicable).toBe(false);
      }
      // Top-level WHT flag mirrors the per-row sentinel.
      expect(result.withholdingTaxApplicable).toBe(false);

      const args = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ sequenceNumber: 'asc' });
      expect(Array.isArray(args.where.OR)).toBe(true);
      expect(args.where.OR).toHaveLength(3);

      const scopes = args.where.OR.map((branch) => branch.resourceType);
      expect(scopes).toEqual(expect.arrayContaining(['APPLICATION', 'PAYMENT', 'INVOICE']));

      // Hash-chain stays verified when the two rows in the window
      // form an unbroken link (H1 → H2).
      expect(result.chain.verified).toBe(true);
      expect(result.chain.breaks).toEqual([]);
    });

    test('reports hash-chain break with forensic detail (no throw)', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([
        { id: '1', logId: 'L1', sequenceNumber: 10, previousHash: 'X', currentHash: 'H1' },
        { id: '2', logId: 'L2', sequenceNumber: 11, previousHash: 'TAMPERED', currentHash: 'H2' },
      ]);

      const result = await service.getPaymentAuditTrail('app-tampered');

      expect(result.chain.verified).toBe(false);
      expect(result.chain.breaks).toEqual([
        { at: 11, logId: 'L2', expected: 'H1', found: 'TAMPERED' },
      ]);
      // Events are still returned — the broken row is forensic
      // evidence; we must not hide it from the auditor.
      expect(result.events).toHaveLength(2);
    });

    test('clamps caller-supplied limit', async () => {
      const { prismaMock, service } = loadService();
      prismaMock.auditLog.findMany.mockResolvedValue([]);
      await service.getPaymentAuditTrail('app-1', { limit: 999_999 });
      const args = prismaMock.auditLog.findMany.mock.calls[0][0];
      expect(args.take).toBe(5000); // hard cap inside the helper
    });

    test('verifyHashChain returns verified=true on an empty list', () => {
      const { service } = loadService();
      expect(service.verifyHashChain([])).toEqual({ verified: true, breaks: [] });
      expect(service.verifyHashChain(null)).toEqual({ verified: true, breaks: [] });
    });

    test('verifyHashChain detects multiple breaks in one window', () => {
      const { service } = loadService();
      const result = service.verifyHashChain([
        { sequenceNumber: 1, logId: 'A', previousHash: 'X', currentHash: 'H1' },
        { sequenceNumber: 2, logId: 'B', previousHash: 'BROKEN', currentHash: 'H2' },
        { sequenceNumber: 3, logId: 'C', previousHash: 'H2', currentHash: 'H3' },
        { sequenceNumber: 4, logId: 'D', previousHash: 'ALSO-BROKEN', currentHash: 'H4' },
      ]);
      expect(result.verified).toBe(false);
      expect(result.breaks).toHaveLength(2);
      expect(result.breaks[0]).toMatchObject({ at: 2, logId: 'B', expected: 'H1', found: 'BROKEN' });
      expect(result.breaks[1]).toMatchObject({ at: 4, logId: 'D', expected: 'H3', found: 'ALSO-BROKEN' });
    });
  });
});
