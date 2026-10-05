/**
 * audit-onsite-service unit tests — Iter 25 (B25-B).
 *
 * Verifies the onsite-audit contract end-to-end with an in-memory prisma
 * stub (no real DB needed):
 *   - startInspection: status gating, auditor match, GPS log write
 *   - submitChecklistItem: template lookup, upsert + photo linking
 *   - uploadPhoto: SHA-256 hash invariant + attachment + photo row
 *   - submitDecision: PASS transition, FAIL CAR_PENDING, NEEDS_REVIEW flag
 *   - verifyGpsAgainstFarm: haversine + tolerance edge cases
 */

'use strict';

const path = require('path');

// --- Mock collaborators ----------------------------------------------------

const mockWriteApplicationStatus = jest.fn(async () => ({ id: 'app-1', status: 'AUDIT_PASSED' }));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...args) => mockWriteApplicationStatus(...args),
}));

const mockAttachmentService = {
    attach: jest.fn(async ({ resId, fileName }) => ({
        id: `att-${fileName}`,
        resId,
        fileName,
    })),
};
jest.mock('../../services/attachment-service', () => mockAttachmentService);

const mockFanoutService = {
    send: jest.fn(async () => ({ inApp: { ok: true }, email: { ok: true }, sms: { ok: true } })),
};
jest.mock('../../services/notification-fanout-service', () => mockFanoutService);

// Task 3 (pin decided auditId through decision->mint): wrap the REAL gate in
// a jest.fn (spy-through-to-real) rather than a blanket success stub — the
// pre-existing "cert-integrity: fail-closed evidence gate" cases below rely
// on the REAL assertOnsiteEvidenceSufficient throwing for insufficient
// evidence, so a blanket mock would silently break them. Wrapping the real
// implementation keeps every existing case behavior-identical while making
// the gate spyable/overridable for the new pinning test.
jest.mock('../../services/onsite-evidence-gate', () => {
    const actual = jest.requireActual('../../services/onsite-evidence-gate');
    return {
        ...actual,
        assertOnsiteEvidenceSufficient: jest.fn(actual.assertOnsiteEvidenceSufficient),
    };
});

jest.mock('../../shared/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

// prisma-database is consulted lazily inside the service; we want the
// callers to inject prisma directly, so leave the module as a tolerant
// stub for the lazy require path.
jest.mock('../../services/prisma-database', () => ({ prisma: null }));

const servicePath = path.resolve(__dirname, '../../services/audit-onsite-service.js');
function loadService() {
    jest.resetModules();
    // Re-establish mocks after resetModules.
    jest.doMock('../../services/application-status-writer', () => ({
        writeApplicationStatus: (...args) => mockWriteApplicationStatus(...args),
    }));
    jest.doMock('../../services/attachment-service', () => mockAttachmentService);
    jest.doMock('../../services/notification-fanout-service', () => mockFanoutService);
    jest.doMock('../../services/onsite-evidence-gate', () => {
        const actual = jest.requireActual('../../services/onsite-evidence-gate');
        return {
            ...actual,
            assertOnsiteEvidenceSufficient: jest.fn(actual.assertOnsiteEvidenceSufficient),
        };
    });
    jest.doMock('../../services/prisma-database', () => ({ prisma: null }));
    jest.doMock('../../shared/logger', () => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    return require(servicePath);
}

// --- Prisma stub factory ---------------------------------------------------

function makePrismaStub(overrides = {}) {
    const audits = new Map();
    const checklistItems = new Map();
    const photos = new Map();
    const gpsLogs = [];

    const stub = {
        auditChecklist: {
            // Phase A2: onsite-evidence-gate.js looks the audit up by
            // `where.applicationId` (submitDecision's own pre-existing lookup
            // above it still uses `where.id`) — support both keys.
            findFirst: jest.fn(async ({ where }) => {
                if (where.id) { return audits.get(where.id) || null; }
                if (where.applicationId) {
                    for (const a of audits.values()) {
                        if (a.applicationId === where.applicationId || a.application?.id === where.applicationId) {
                            return a;
                        }
                    }
                    return null;
                }
                return null;
            }),
            update: jest.fn(async ({ where, data }) => {
                const cur = audits.get(where.id);
                const next = { ...cur, ...data };
                audits.set(where.id, next);
                return next;
            }),
        },
        farmAuditChecklistItem: {
            count: jest.fn(async ({ where }) => {
                let n = 0;
                for (const i of checklistItems.values()) {
                    if (i.auditId === where.auditId) {n += 1;}
                }
                return n;
            }),
            upsert: jest.fn(async ({ where, create, update }) => {
                const key = `${where.auditId_itemCode.auditId}:${where.auditId_itemCode.itemCode}`;
                if (checklistItems.has(key)) {
                    const cur = checklistItems.get(key);
                    const next = { ...cur, ...update };
                    checklistItems.set(key, next);
                    return next;
                }
                const row = { id: `cli-${key}`, ...create };
                checklistItems.set(key, row);
                return row;
            }),
        },
        farmAuditPhoto: {
            create: jest.fn(async ({ data }) => {
                const id = `photo-${photos.size + 1}`;
                const row = { id, ...data };
                photos.set(id, row);
                return row;
            }),
            count: jest.fn(async ({ where }) => {
                let n = 0;
                for (const p of photos.values()) {
                    if (p.auditId === where.auditId) {n += 1;}
                }
                return n;
            }),
            // The gate reads DISTINCT photographs through findMany, not count — this
            // fake has to answer the question the gate actually asks, or the gate
            // refuses the client as unverifiable (EVIDENCE_CAPTURE_UNAVAILABLE).
            findMany: jest.fn(async ({ where }) => Array.from(photos.values())
                .filter((p) => p.auditId === where.auditId)
                .map((p) => ({ fileHash: p.fileHash }))),
            updateMany: jest.fn(async () => ({ count: 0 })),
        },
        gpsVerificationLog: {
            create: jest.fn(async ({ data }) => {
                const row = { id: `gps-${gpsLogs.length + 1}`, ...data };
                gpsLogs.push(row);
                return row;
            }),
        },
        farm: {
            findUnique: jest.fn(async () => null),
        },
        $transaction: jest.fn(async (cbOrArr) => {
            if (typeof cbOrArr === 'function') {return cbOrArr(stub);}
            return Promise.all(cbOrArr);
        }),
    };
    Object.assign(stub, overrides);
    return { stub, audits, checklistItems, photos, gpsLogs };
}

// --- Helpers ---------------------------------------------------------------

function seedAudit(audits, partial = {}) {
    const audit = {
        id: 'audit-1',
        auditorId: 'user-auditor-1',
        status: 'IN_PROGRESS',
        applicationId: 'app-1',
        organizationId: 'org-1',
        formData: {},
        application: {
            id: 'app-1',
            status: 'AUDIT_CONFIRMED',
            applicationNumber: 'GACP-2026-001',
            healthId: 'user-applicant-1',
        },
        ...partial,
    };
    audits.set(audit.id, audit);
    return audit;
}

beforeEach(() => {
    mockWriteApplicationStatus.mockClear();
    mockAttachmentService.attach.mockClear();
    mockFanoutService.send.mockClear();
});

// --- Tests -----------------------------------------------------------------

describe('audit-onsite-service', () => {
    describe('haversineDistanceMeters', () => {
        test('returns ~0 for identical coords', () => {
            const svc = loadService();
            const d = svc.haversineDistanceMeters(13.7563, 100.5018, 13.7563, 100.5018);
            expect(d).toBeLessThan(0.01);
        });
        test('returns ~111km for 1 degree latitude separation', () => {
            const svc = loadService();
            const d = svc.haversineDistanceMeters(13.0, 100.0, 14.0, 100.0);
            // Each degree of latitude is ~111 km.
            expect(d).toBeGreaterThan(110000);
            expect(d).toBeLessThan(112000);
        });
    });

    describe('computePhotoHash (SHA-256 invariant)', () => {
        test('same bytes → same hash', () => {
            const svc = loadService();
            const buf = Buffer.from('GACP onsite photo bytes #1', 'utf8');
            const h1 = svc.computePhotoHash(buf);
            const h2 = svc.computePhotoHash(Buffer.from('GACP onsite photo bytes #1', 'utf8'));
            expect(h1).toEqual(h2);
            expect(h1).toMatch(/^[a-f0-9]{64}$/);
        });
        test('modified bytes → different hash', () => {
            const svc = loadService();
            const h1 = svc.computePhotoHash(Buffer.from('GACP onsite photo bytes #1', 'utf8'));
            const h2 = svc.computePhotoHash(Buffer.from('GACP onsite photo bytes #2', 'utf8'));
            expect(h1).not.toEqual(h2);
        });
        test('rejects non-Buffer input', () => {
            const svc = loadService();
            expect(() => svc.computePhotoHash('not-a-buffer')).toThrow(/Buffer required/);
        });
    });

    describe('startInspection', () => {
        test('happy path: writes GPS log + returns checklist template', async () => {
            const svc = loadService();
            const { stub, audits, gpsLogs } = makePrismaStub();
            seedAudit(audits);

            const out = await svc.startInspection({
                auditId: 'audit-1',
                auditorId: 'user-auditor-1',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                gpsAccuracy: 12.3,
                prisma: stub,
            });

            expect(out.audit.id).toBe('audit-1');
            expect(out.checklistTemplate.length).toBeGreaterThan(0);
            expect(out.templateVersion).toBe('2026-05');
            expect(gpsLogs.length).toBe(1);
            expect(gpsLogs[0].entityType).toBe('AUDIT_INSPECTION_START');
            expect(gpsLogs[0].reportedLatitude).toBe(13.7563);
        });

        // F-ONSITE-GPS-CHECKIN-UNREACHABLE (GpsVerificationLog schema landed
        // 2026-08-19): the guarded create() call at
        // audit-onsite-service.js:474-488 now runs against a real (mocked)
        // gpsVerificationLog.create — pins that startInspection threads
        // organizationId from the in-memory audit row (fetched at :457, no
        // select) onto every GPS log write, mirroring FarmAuditPhoto's
        // required organizationId column. RED before the service change
        // (organizationId undefined on the written row) -> GREEN after.
        test('threads organizationId from the audit row onto the GPS log', async () => {
            const svc = loadService();
            const { stub, audits, gpsLogs } = makePrismaStub();
            seedAudit(audits, { organizationId: 'org-gps-1' });

            await svc.startInspection({
                auditId: 'audit-1',
                auditorId: 'user-auditor-1',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                gpsAccuracy: 12.3,
                prisma: stub,
            });

            expect(gpsLogs.length).toBe(1);
            expect(gpsLogs[0]).toMatchObject({
                entityType: 'AUDIT_INSPECTION_START',
                entityId: 'audit-1',
                reportedLatitude: 13.7563,
                reportedLongitude: 100.5018,
                gpsAccuracy: 12.3,
                verifiedBy: 'user-auditor-1',
                verificationMethod: 'GPS_DEVICE',
                isVerified: false,
                organizationId: 'org-gps-1',
            });
            expect(stub.gpsVerificationLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ organizationId: 'org-gps-1' }),
                }),
            );
        });

        test('rejects when audit not found', async () => {
            const svc = loadService();
            const { stub } = makePrismaStub();

            await expect(svc.startInspection({
                auditId: 'missing',
                auditorId: 'user-auditor-1',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                prisma: stub,
            })).rejects.toThrow(/Audit not found/);
        });

        test('rejects when auditor does not match assigned auditorId', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits, { auditorId: 'user-other' });

            await expect(svc.startInspection({
                auditId: 'audit-1',
                auditorId: 'user-auditor-1',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                prisma: stub,
            })).rejects.toThrow(/different auditor/);
        });

        test('rejects when audit status is not IN_PROGRESS', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits, { status: 'COMPLETED' });

            await expect(svc.startInspection({
                auditId: 'audit-1',
                auditorId: 'user-auditor-1',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                prisma: stub,
            })).rejects.toThrow(/status is COMPLETED/);
        });

        // B6: FE sends nested { gps: { latitude, longitude } }; the route
        // does `Number(gps.latitude)` — a missing/malformed field yields
        // `Number(undefined) === NaN`. `typeof NaN === 'number'` is true, so
        // the old `typeof gpsLat !== 'number'` guard let NaN through to
        // GpsVerificationLog silently. Number.isFinite(NaN) === false closes
        // that hole.
        test('startInspection rejects NaN GPS (Number.isFinite, not typeof)', async () => {
            const svc = loadService();
            await expect(svc.startInspection({
                auditId: 'aud-1', auditorId: 'auditor-1', gpsLat: Number(undefined), gpsLng: 100.5,
                prisma: { auditChecklist: { findFirst: async () => ({ id: 'aud-1', status: 'IN_PROGRESS', auditorId: 'auditor-1' }) } },
            })).rejects.toThrow(/gpsLat \+ gpsLng/);
        });
    });

    describe('submitChecklistItem', () => {
        test('persists known item code + accepts PASS/FAIL/NA', async () => {
            const svc = loadService();
            const { stub, audits, checklistItems } = makePrismaStub();
            seedAudit(audits);

            const row = await svc.submitChecklistItem({
                auditId: 'audit-1',
                itemCode: '4.1',
                response: 'PASS',
                notes: 'Cultivation records complete',
                actorId: 'user-auditor-1',
                prisma: stub,
            });

            expect(row.itemCode).toBe('4.1');
            expect(row.response).toBe('PASS');
            expect(row.section).toBe('CULTIVATION');
            expect(row.isCritical).toBe(true);
            expect(checklistItems.size).toBe(1);
        });

        test('refuses unknown item code', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);

            await expect(svc.submitChecklistItem({
                auditId: 'audit-1',
                itemCode: '99.99',
                response: 'PASS',
                prisma: stub,
            })).rejects.toThrow(/unknown itemCode/);
        });

        test('refuses invalid response value', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);

            await expect(svc.submitChecklistItem({
                auditId: 'audit-1',
                itemCode: '4.1',
                response: 'MAYBE',
                prisma: stub,
            })).rejects.toThrow(/PASS\|FAIL\|NA/);
        });

        test('links photos via updateMany when photoIds supplied', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);

            await svc.submitChecklistItem({
                auditId: 'audit-1',
                itemCode: '5.1',
                response: 'PASS',
                photoIds: ['photo-1', 'photo-2'],
                prisma: stub,
            });

            expect(stub.farmAuditPhoto.updateMany).toHaveBeenCalledTimes(1);
            const call = stub.farmAuditPhoto.updateMany.mock.calls[0][0];
            expect(call.where.id.in).toEqual(['photo-1', 'photo-2']);
            expect(call.where.auditId).toBe('audit-1');
        });
    });

    describe('uploadPhoto', () => {
        test('computes hash + stores via attachment + writes photo row', async () => {
            const svc = loadService();
            const { stub, audits, photos } = makePrismaStub();
            seedAudit(audits);
            const buf = Buffer.from('JPEG_BYTES_ABC', 'utf8');

            const out = await svc.uploadPhoto({
                auditId: 'audit-1',
                fileBuffer: buf,
                fileName: 'farm.jpg',
                mimeType: 'image/jpeg',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                capturedAt: new Date('2026-05-16T10:30:00Z'),
                caption: 'หน้าแปลงปลูก',
                uploadedBy: 'user-auditor-1',
                organizationId: 'org-1',
                prisma: stub,
            });

            expect(out.fileHash).toMatch(/^[a-f0-9]{64}$/);
            expect(out.photoId).toMatch(/^photo-/);
            expect(out.attachmentId).toMatch(/^att-/);
            expect(mockAttachmentService.attach).toHaveBeenCalledTimes(1);
            const attachCall = mockAttachmentService.attach.mock.calls[0][0];
            expect(attachCall.fileHash).toBe(out.fileHash);
            expect(attachCall.fileSize).toBe(buf.length);
            expect(photos.size).toBe(1);
            const stored = Array.from(photos.values())[0];
            expect(stored.fileHash).toBe(out.fileHash);
            expect(stored.gpsLatitude).toBe(13.7563);
            expect(stored.caption).toBe('หน้าแปลงปลูก');
        });

        // Task 9 (fixes B7): /photo carried the same nested-GPS/NaN bug Task 8
        // fixed for /start, PLUS uploadPhoto's own guard used `typeof x !== 'number'`
        // (NaN IS typeof 'number' — Number('garbage') sails straight through),
        // PLUS the return had no viewable `url` (FE renders a broken-image icon).
        test('returns a viewable url and rejects NaN GPS via Number.isFinite', async () => {
            const svc = loadService();
            const attach = { id: 'att-1', fileUrl: '/uploads/audits/aud-1/x.jpg' };
            const prisma = {
                auditChecklist: { findFirst: async () => ({ id: 'aud-1', auditorId: 'auditor-1' }) },
                farmAuditPhoto: { create: async ({ data }) => ({ id: 'photo-1', ...data }) },
            };
            const attachmentService = { attach: async () => attach };

            const out = await svc.uploadPhoto({
                auditId: 'aud-1', fileBuffer: Buffer.from('x'), fileName: 'x.jpg',
                gpsLat: 13.75, gpsLng: 100.5, uploadedBy: 'auditor-1', organizationId: 'org-1',
                prisma, attachmentService,
            });
            expect(out.url).toBe('/uploads/audits/aud-1/x.jpg');
            expect(out.photoId).toBe('photo-1');

            // Number('nope') === NaN, and `typeof NaN === 'number'` — the OLD guard
            // (`typeof gpsLat !== 'number'`) let this straight through into the DB
            // write. Number.isFinite(NaN) === false closes that hole.
            await expect(svc.uploadPhoto({
                auditId: 'aud-1', fileBuffer: Buffer.from('x'), fileName: 'x.jpg',
                gpsLat: Number('nope'), gpsLng: 100.5, uploadedBy: 'auditor-1', organizationId: 'org-1',
                prisma, attachmentService,
            })).rejects.toThrow(/gpsLat \+ gpsLng/);
        });

        // Ruling 6b (carried into Task 9): uploadPhoto used to do
        // `if (audit) { ownership check }` — a not-found audit SKIPPED the
        // ownership check entirely and fell through to attach+create, which
        // FK-violates auditId on real Postgres. Reject before any write.
        test('rejects with NO_ONSITE_AUDIT (statusCode 404) when the audit does not exist, before any write', async () => {
            const svc = loadService();
            const attach = jest.fn(async () => ({ id: 'att-1', fileUrl: '/uploads/x.jpg' }));
            const create = jest.fn(async ({ data }) => ({ id: 'photo-1', ...data }));
            const prisma = {
                auditChecklist: { findFirst: async () => null },
                farmAuditPhoto: { create },
            };
            const attachmentService = { attach };

            await expect(svc.uploadPhoto({
                auditId: 'missing-audit', fileBuffer: Buffer.from('x'), fileName: 'x.jpg',
                gpsLat: 13.75, gpsLng: 100.5, uploadedBy: 'auditor-1', organizationId: 'org-1',
                prisma, attachmentService,
            })).rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT', statusCode: 404 });

            expect(attach).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
        });

        // itemId linkage (Task 9 interface point 5): checklistItemCode forwards
        // to a best-effort lookup + link so a photo taken AFTER its checklist
        // item was already saved still gets checklistItemId set. The primary/
        // authoritative link stays submitChecklistItem's updateMany(photoIds).
        test('links checklistItemId when checklistItemCode matches an existing FarmAuditChecklistItem', async () => {
            const svc = loadService();
            const updateCalls = [];
            const prisma = {
                auditChecklist: { findFirst: async () => ({ id: 'aud-1', auditorId: 'auditor-1' }) },
                farmAuditChecklistItem: {
                    findFirst: jest.fn(async ({ where }) => (
                        (where.auditId === 'aud-1' && where.itemCode === '4.1') ? { id: 'cli-1' } : null
                    )),
                },
                farmAuditPhoto: {
                    create: async ({ data }) => ({ id: 'photo-1', ...data }),
                    update: jest.fn(async ({ where, data }) => {
                        updateCalls.push({ where, data });
                        return { id: where.id, ...data };
                    }),
                },
            };
            const attachmentService = { attach: async () => ({ id: 'att-1', fileUrl: '/uploads/x.jpg' }) };

            const out = await svc.uploadPhoto({
                auditId: 'aud-1', fileBuffer: Buffer.from('x'), fileName: 'x.jpg',
                gpsLat: 13.75, gpsLng: 100.5, uploadedBy: 'auditor-1', organizationId: 'org-1',
                checklistItemCode: '4.1',
                prisma, attachmentService,
            });

            expect(out.photoId).toBe('photo-1');
            expect(prisma.farmAuditChecklistItem.findFirst).toHaveBeenCalledWith({
                where: { auditId: 'aud-1', itemCode: '4.1' },
                select: { id: true },
            });
            expect(updateCalls).toEqual([{ where: { id: 'photo-1' }, data: { checklistItemId: 'cli-1' } }]);
        });

        test('itemId link is a non-fatal no-op when no matching checklist item exists yet', async () => {
            const svc = loadService();
            const update = jest.fn();
            const prisma = {
                auditChecklist: { findFirst: async () => ({ id: 'aud-1', auditorId: 'auditor-1' }) },
                farmAuditChecklistItem: { findFirst: jest.fn(async () => null) },
                farmAuditPhoto: {
                    create: async ({ data }) => ({ id: 'photo-1', ...data }),
                    update,
                },
            };
            const attachmentService = { attach: async () => ({ id: 'att-1', fileUrl: '/uploads/x.jpg' }) };

            const out = await svc.uploadPhoto({
                auditId: 'aud-1', fileBuffer: Buffer.from('x'), fileName: 'x.jpg',
                gpsLat: 13.75, gpsLng: 100.5, uploadedBy: 'auditor-1', organizationId: 'org-1',
                checklistItemCode: '9.9',
                prisma, attachmentService,
            });

            expect(out.photoId).toBe('photo-1');
            expect(update).not.toHaveBeenCalled();
        });
    });

    describe('verifyGpsAgainstFarm', () => {
        test('returns withinTolerance=true when auditor is at the farm', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits, {
                application: {
                    id: 'app-1',
                    formData: { locationData: { latitude: 13.7563, longitude: 100.5018, farmId: 'farm-1' } },
                },
            });

            const out = await svc.verifyGpsAgainstFarm({
                auditId: 'audit-1',
                gpsLat: 13.7564, // ~10m offset
                gpsLng: 100.5019,
                prisma: stub,
            });

            expect(out.withinTolerance).toBe(true);
            expect(out.distanceMeters).toBeLessThan(50);
            expect(out.toleranceMeters).toBe(500);
        });

        test('returns withinTolerance=false beyond tolerance', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits, {
                application: {
                    id: 'app-1',
                    formData: { locationData: { latitude: 13.7563, longitude: 100.5018 } },
                },
            });

            const out = await svc.verifyGpsAgainstFarm({
                auditId: 'audit-1',
                gpsLat: 14.0, // ~27km north
                gpsLng: 100.5018,
                prisma: stub,
            });

            expect(out.withinTolerance).toBe(false);
            expect(out.distanceMeters).toBeGreaterThan(20000);
        });

        test('returns unknownFarmLocation when farm has no coords', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits, {
                application: { id: 'app-1', formData: {} },
            });

            const out = await svc.verifyGpsAgainstFarm({
                auditId: 'audit-1',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                prisma: stub,
            });

            expect(out.unknownFarmLocation).toBe(true);
            expect(out.withinTolerance).toBe(false);
            expect(out.distanceMeters).toBeNull();
        });

        test('respects custom toleranceMeters override', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits, {
                application: {
                    id: 'app-1',
                    formData: { locationData: { latitude: 13.7563, longitude: 100.5018 } },
                },
            });

            // 100m from the farm: outside 50m tolerance but inside 500m default.
            const out = await svc.verifyGpsAgainstFarm({
                auditId: 'audit-1',
                gpsLat: 13.7572, // ~100m north
                gpsLng: 100.5018,
                toleranceMeters: 50,
                prisma: stub,
            });

            expect(out.withinTolerance).toBe(false);
            expect(out.distanceMeters).toBeGreaterThan(50);
        });

        // Task 10 (carried Ruling 8, fixes B8): the route does
        // `gpsLat: Number(req.query.lat)` — a missing/malformed `lat`/`lng`
        // query param yields `Number(undefined) === NaN`. `typeof NaN ===
        // 'number'` is true, so the OLD guard (`typeof gpsLat !== 'number'`)
        // let NaN sail through to the haversine calculation, silently
        // returning `distanceMeters: NaN` (and `withinTolerance: false`,
        // since every comparison with NaN is false) instead of rejecting
        // the malformed request. Same fix Task 8 applied to startInspection
        // and Task 9 applied to uploadPhoto. Number.isFinite(NaN) === false
        // closes this hole too.
        test('rejects NaN GPS (Number.isFinite, not typeof) instead of returning NaN distanceMeters', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits, {
                application: {
                    id: 'app-1',
                    formData: { locationData: { latitude: 13.7563, longitude: 100.5018 } },
                },
            });

            await expect(svc.verifyGpsAgainstFarm({
                auditId: 'audit-1',
                gpsLat: Number(undefined), // NaN — mirrors Number(req.query.lat) on a missing param
                gpsLng: 100.5018,
                prisma: stub,
            })).rejects.toThrow(/gpsLat \+ gpsLng/);

            await expect(svc.verifyGpsAgainstFarm({
                auditId: 'audit-1',
                gpsLat: 13.7563,
                gpsLng: Number('garbage'), // NaN — mirrors Number(req.query.lng) on a malformed param
                prisma: stub,
            })).rejects.toThrow(/gpsLat \+ gpsLng/);
        });
    });

    describe('submitDecision', () => {
        function seedFullChecklist(stubObj, auditId = 'audit-1') {
            const svc = require('../../services/audit-onsite-service');
            for (const item of svc.CHECKLIST_TEMPLATE_2026) {
                stubObj.farmAuditChecklistItem.upsert({
                    where: { auditId_itemCode: { auditId, itemCode: item.itemCode } },
                    create: {
                        auditId, itemCode: item.itemCode, section: item.section,
                        response: 'PASS', isCritical: item.isCritical, maxPoints: item.maxPoints,
                    },
                    update: { response: 'PASS' },
                });
            }
        }

        function seedPhotos(stubObj, auditId, n = 5) {
            for (let i = 0; i < n; i += 1) {
                stubObj.farmAuditPhoto.create({
                    data: { auditId, fileHash: `hash-${i}`, gpsLatitude: 13.7, gpsLongitude: 100.5, organizationId: 'org-1' },
                });
            }
        }

        // Task 3 (pin decided auditId through decision->mint): a lighter,
        // submitDecision-only prisma stub. Unlike makePrismaStub() this has no
        // farmAuditPhoto/farmAuditChecklistItem — the evidence gate is
        // overridden per-test via the module-level onsite-evidence-gate mock
        // above, so evidence rows aren't needed to reach the pin/persist logic
        // under test. `updates` is a live array of every
        // writeApplicationStatus(...) call's full args object, captured by
        // overriding the file's existing mockWriteApplicationStatus for the
        // single call submitDecision makes.
        function makeSubmitDecisionPrisma({ audit }) {
            const updates = [];
            mockWriteApplicationStatus.mockImplementationOnce(async (writeArgs) => {
                updates.push(writeArgs);
                return { id: audit.application?.id, status: writeArgs.toStatus };
            });
            const prisma = {
                auditChecklist: {
                    findFirst: jest.fn(async () => audit),
                    update: jest.fn(async ({ data }) => ({ ...audit, ...data })),
                },
                $transaction: jest.fn(async (cb) => cb(prisma)),
            };
            return { prisma, updates };
        }

        test('PASS decision → transitions to AUDIT_PASSED + notifies', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            const out = await svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PASS',
                summary: 'ทุกรายการผ่านการตรวจ',
                actorId: 'user-auditor-1',
                actorRole: 'AUDITOR',
                prisma: stub,
            });

            expect(out.audit.status).toBe('COMPLETED');
            expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
            const transitionCall = mockWriteApplicationStatus.mock.calls[0][0];
            expect(transitionCall.toStatus).toBe('AUDIT_PASSED');
            expect(transitionCall.reason).toBe('ONSITE_AUDIT_PASS');
            expect(mockFanoutService.send).toHaveBeenCalledTimes(1);
            expect(mockFanoutService.send.mock.calls[0][0].type).toBe('AUDIT_RESULT_PASSED');
        });

        test('FAIL decision → transitions to CAR_PENDING + sets correctiveActionRequired', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            const out = await svc.submitDecision({
                auditId: 'audit-1',
                decision: 'FAIL',
                summary: 'พบประเด็นวิกฤตที่ต้องแก้ไข',
                criticalFindings: ['1.1', '2.1'],
                actorId: 'user-auditor-1',
                prisma: stub,
            });

            expect(out.audit.status).toBe('COMPLETED');
            const transitionCall = mockWriteApplicationStatus.mock.calls[0][0];
            expect(transitionCall.toStatus).toBe('CAR_PENDING');
            // The FAIL details live on the parent Application (additionalData), NOT on
            // the AuditChecklist row — it has no formData column (writing one threw a
            // PrismaClientValidationError that rolled back the whole tx; see the
            // submitDecision tx note). Assert the real current contract.
            expect(transitionCall.additionalData.auditResult).toBe('FAIL');
            expect(transitionCall.additionalData.auditNotes).toBe('พบประเด็นวิกฤตที่ต้องแก้ไข');
            expect(mockFanoutService.send.mock.calls[0][0].type).toBe('AUDIT_RESULT_CAR');
        });

        test('FAIL decision WITHOUT a summary → throws CAR_COMMENT_REQUIRED (C2-02)', async () => {
            // A FAIL drives the app to CAR_PENDING, starting the applicant's
            // 5-working-day corrective-action clock; the canonical workflow
            // requires a comment on →CAR_PENDING. This path writes via
            // writeApplicationStatus (edge+role only), so the summary gate is
            // enforced in submitDecision itself.
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            await expect(svc.submitDecision({
                auditId: 'audit-1',
                decision: 'FAIL',
                summary: '   ', // whitespace-only must also be rejected
                criticalFindings: ['1.1'],
                actorId: 'user-auditor-1',
                prisma: stub,
            })).rejects.toMatchObject({ code: 'CAR_COMMENT_REQUIRED' });

            expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        });

        test('NEEDS_REVIEW → flags audit, no transition, status stays IN_PROGRESS', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            const out = await svc.submitDecision({
                auditId: 'audit-1',
                decision: 'NEEDS_REVIEW',
                summary: 'ต้องการให้หัวหน้าตรวจสอบ',
                actorId: 'user-auditor-1',
                prisma: stub,
            });

            expect(out.audit.status).toBe('IN_PROGRESS');
            // NEEDS_REVIEW keeps the audit open (submittedAt stays null) and performs
            // NO application transition — the head-auditor-review signal is the absence
            // of a transition + the NEEDS_REVIEW notification, not an audit.formData flag
            // (the audit row has no formData column).
            expect(out.audit.submittedAt).toBeNull();
            expect(out.transition).toBeNull();
            expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
            expect(mockFanoutService.send.mock.calls[0][0].type).toBe('AUDIT_RESULT_NEEDS_REVIEW');
        });

        test('rejects when fewer than minPhotos photos uploaded', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 2);

            await expect(svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PASS',
                actorId: 'user-auditor-1',
                prisma: stub,
            })).rejects.toThrow(/minimum 5 photos required/);
            expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        });

        test('rejects when checklist is incomplete', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedPhotos(stub, 'audit-1', 5);
            // only 1 item filled (less than full template)
            await stub.farmAuditChecklistItem.upsert({
                where: { auditId_itemCode: { auditId: 'audit-1', itemCode: '4.1' } },
                create: { auditId: 'audit-1', itemCode: '4.1', section: 'CULTIVATION', response: 'PASS', isCritical: true, maxPoints: 5 },
                update: { response: 'PASS' },
            });

            await expect(svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PASS',
                actorId: 'user-auditor-1',
                prisma: stub,
            })).rejects.toThrow(/checklist items required/);
        });

        test('rejects invalid decision code', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);

            await expect(svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PROBABLY_OK',
                actorId: 'user-auditor-1',
                prisma: stub,
            })).rejects.toThrow(/decision must be/);
        });

        test('fanout failure does not throw (best-effort)', async () => {
            const svc = loadService();
            mockFanoutService.send.mockRejectedValueOnce(new Error('SMTP down'));
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            const out = await svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PASS',
                actorId: 'user-auditor-1',
                prisma: stub,
            });

            expect(out.audit.status).toBe('COMPLETED');
            expect(out.notify.ok).toBe(false);
        });

        // --- Bug 6.1: submitDecision must validate the PARENT-application edge ---
        // Previously the transition was gated ONLY on the AuditChecklist row status,
        // so a re-PASS onto an already-certified record (and a bogus 5-day CAR clock)
        // was reachable. The transition write must opt into assertTransition so an
        // illegal parent-state edge throws (mirrors /audits/:id/result +
        // auditor-audit-decision-handler.js).
        test('6.1: PASS transition write opts into assertTransition:true', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            await svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PASS',
                summary: 'ผ่านทุกรายการ',
                actorId: 'user-auditor-1',
                prisma: stub,
            });

            const transitionCall = mockWriteApplicationStatus.mock.calls[0][0];
            expect(transitionCall.assertTransition).toBe(true);
        });

        test('6.1: FAIL transition write opts into assertTransition:true', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits);
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            await svc.submitDecision({
                auditId: 'audit-1',
                decision: 'FAIL',
                summary: 'พบข้อบกพร่องต้องแก้ไข',
                actorId: 'user-auditor-1',
                prisma: stub,
            });

            const transitionCall = mockWriteApplicationStatus.mock.calls[0][0];
            expect(transitionCall.assertTransition).toBe(true);
        });

        test('6.1: illegal parent-state transition (already certified) → throws illegal-transition, no silent write', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            // Parent already CERTIFIED (terminal) — a re-PASS is an illegal edge.
            seedAudit(audits, {
                application: {
                    id: 'app-1',
                    status: 'CERTIFIED',
                    applicationNumber: 'GACP-2026-001',
                    healthId: 'user-applicant-1',
                },
            });
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            // The mock writer honours the writer's real assertTransition contract:
            // throw the exact "illegal transition" error when assertTransition is on
            // and the parent state cannot legally reach the target.
            mockWriteApplicationStatus.mockImplementationOnce(async (writeArgs) => {
                if (writeArgs.assertTransition && writeArgs.fromStatus === 'CERTIFIED') {
                    throw new Error(
                        `writeApplicationStatus: illegal transition ${writeArgs.fromStatus} → ${writeArgs.toStatus}`,
                    );
                }
                return { id: 'app-1', status: writeArgs.toStatus };
            });

            await expect(svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PASS',
                summary: 'ผ่าน',
                actorId: 'user-auditor-1',
                prisma: stub,
            })).rejects.toThrow(/illegal transition/i);
        });

        test('6.1: a normal AUDIT_CONFIRMED→AUDIT_PASSED edge still succeeds (no over-block)', async () => {
            const svc = loadService();
            const { stub, audits } = makePrismaStub();
            seedAudit(audits); // application.status defaults to AUDIT_CONFIRMED
            await seedFullChecklist(stub);
            await seedPhotos(stub, 'audit-1', 5);

            const out = await svc.submitDecision({
                auditId: 'audit-1',
                decision: 'PASS',
                summary: 'ผ่านทุกรายการ',
                actorId: 'user-auditor-1',
                prisma: stub,
            });

            expect(out.audit.status).toBe('COMPLETED');
            expect(mockWriteApplicationStatus.mock.calls[0][0].toStatus).toBe('AUDIT_PASSED');
        });

        // --- cert-integrity fix (Phase A): fail-closed evidence gate on PASS ---
        // Bug: FarmAuditPhoto / FarmAuditChecklistItem models do NOT EXIST in the
        // Prisma schema (only AuditChecklist does), so `prisma.farmAuditPhoto` is
        // undefined and the old `typeof prisma.farmAuditPhoto?.count === 'function'`
        // guard silently SKIPPED both evidence checks — a PASS minted a government
        // GACP certificate with ZERO photos and ZERO checklist items. The fix scopes
        // the evidence gate to decision === PASS and makes it fail-closed: if the
        // evidence models aren't provisioned, submitDecision THROWS instead of
        // silently skipping.
        describe('cert-integrity: fail-closed evidence gate', () => {
            test('CERT-INTEGRITY: PASS with unprovisioned evidence models throws EVIDENCE_CAPTURE_UNAVAILABLE (fail-closed) and never reaches cert mint', async () => {
                const svc = loadService();
                const { stub, audits } = makePrismaStub();
                seedAudit(audits);
                // Reproduce the REAL unprovisioned deployment (see startInspection's
                // pilot-descope guard comment): no farmAuditPhoto / farmAuditChecklistItem
                // model at all. makePrismaStub() provides both by default, so delete
                // them here to prove the fail-closed gate rather than the happy path.
                delete stub.farmAuditPhoto;
                delete stub.farmAuditChecklistItem;

                await expect(svc.submitDecision({
                    auditId: 'audit-1',
                    decision: 'PASS',
                    summary: 'ผ่านทุกรายการ',
                    actorId: 'user-auditor-1',
                    prisma: stub,
                })).rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });

                // Refused BEFORE the cert-minting transition — writeApplicationStatus
                // (the AUDIT_CONFIRMED → AUDIT_PASSED edge that triggers cert auto-gen
                // downstream) must never be reached.
                expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
            });

            test('FAIL decision unaffected: unprovisioned evidence models do not throw (a FAIL needs no evidence)', async () => {
                const svc = loadService();
                const { stub, audits } = makePrismaStub();
                seedAudit(audits);
                delete stub.farmAuditPhoto;
                delete stub.farmAuditChecklistItem;

                const out = await svc.submitDecision({
                    auditId: 'audit-1',
                    decision: 'FAIL',
                    summary: 'พบข้อบกพร่องต้องแก้ไข',
                    actorId: 'user-auditor-1',
                    prisma: stub,
                });

                expect(out.audit.status).toBe('COMPLETED');
                expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
                expect(mockWriteApplicationStatus.mock.calls[0][0].toStatus).toBe('CAR_PENDING');
            });

            test('CERT-INTEGRITY (Phase A2 reviewer finding): exactly ONE of the two evidence models present still throws EVIDENCE_CAPTURE_UNAVAILABLE (a partial deployment must not silently check only the half that exists)', async () => {
                const svc = loadService();
                const { stub, audits } = makePrismaStub();
                seedAudit(audits);
                // farmAuditPhoto stays provisioned; delete ONLY the checklist model.
                delete stub.farmAuditChecklistItem;

                await expect(svc.submitDecision({
                    auditId: 'audit-1',
                    decision: 'PASS',
                    summary: 'ผ่านทุกรายการ',
                    actorId: 'user-auditor-1',
                    prisma: stub,
                })).rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });
                expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
            });

            test('PASS with evidence present (provisioned models, sufficient counts) passes the gate', async () => {
                const svc = loadService();
                const { stub, audits } = makePrismaStub();
                seedAudit(audits);
                await seedFullChecklist(stub);
                await seedPhotos(stub, 'audit-1', 5);

                await expect(svc.submitDecision({
                    auditId: 'audit-1',
                    decision: 'PASS',
                    summary: 'ผ่านทุกรายการ',
                    actorId: 'user-auditor-1',
                    prisma: stub,
                })).resolves.toMatchObject({ audit: { status: 'COMPLETED' } });
                expect(mockWriteApplicationStatus.mock.calls[0][0].toStatus).toBe('AUDIT_PASSED');
            });
        });

        // --- Task 3 (cert-integrity fix, 2026-08-17): pin the decided auditId
        // through decision -> mint. submitDecision already holds the auditId
        // it is deciding on; pass THAT to the gate (instead of letting it
        // re-resolve) and persist it as formData.onsiteAuditId so the in-tx
        // auto-mint's generateCertificate verifies the SAME AuditChecklist row
        // — preventing a newer/duplicate row from diverging the gate between
        // decision and mint. ---
        describe('Task 3: pin decided auditId through decision -> mint', () => {
            test('submitDecision(PASS) pins its auditId to the gate and persists formData.onsiteAuditId', async () => {
                const svc = loadService();
                const gate = require('../../services/onsite-evidence-gate');
                gate.assertOnsiteEvidenceSufficient.mockImplementationOnce(async () => ({
                    auditId: 'aud-1', photoCount: 5, itemCount: 24,
                }));
                const { prisma, updates } = makeSubmitDecisionPrisma({
                    audit: {
                        id: 'aud-1', status: 'IN_PROGRESS', auditorId: 'auditor-1',
                        application: {
                            id: 'app-1', status: 'AUDIT_CONFIRMED', applicationNumber: 'A-1', healthId: null, formData: {},
                        },
                    },
                });

                await svc.submitDecision({
                    auditId: 'aud-1', decision: 'PASS', summary: 'ok', actorId: 'auditor-1', prisma,
                });

                expect(gate.assertOnsiteEvidenceSufficient).toHaveBeenCalledWith(
                    expect.objectContaining({ applicationId: 'app-1', auditId: 'aud-1' }),
                );
                // The parent-application write carried onsiteAuditId in formData.
                const appWrite = updates.find((u) => u.additionalData?.formData);
                expect(appWrite.additionalData.formData.onsiteAuditId).toBe('aud-1');
            });

            test('submitDecision runs its tx with an explicit ≥30s timeout (P2028 — walk-2 2026-08-19)', async () => {
                // The decision tx used Prisma's 5000ms interactive-transaction
                // default; the cert-auto-gen hook inside it (farm create +
                // evidence-gate counts + cert mint) took 6594ms over Supabase
                // and the whole PASS rolled back with P2028 — the auditor saw a
                // bare 400 and could not finish a fully-evidenced inspection.
                // Same failure family + same remedy as the settle tx
                // (F-SETTLE-TX-LOST → SETTLEMENT.TX_TIMEOUT_MS): the timeout is
                // an explicit business rule, not the library default.
                const svc = loadService();
                const gate = require('../../services/onsite-evidence-gate');
                gate.assertOnsiteEvidenceSufficient.mockImplementationOnce(async () => ({
                    auditId: 'aud-1', photoCount: 5, itemCount: 24,
                }));
                const { prisma } = makeSubmitDecisionPrisma({
                    audit: {
                        id: 'aud-1', status: 'IN_PROGRESS', auditorId: 'auditor-1',
                        application: {
                            id: 'app-1', status: 'AUDIT_CONFIRMED', applicationNumber: 'A-1', healthId: null, formData: {},
                        },
                    },
                });

                await svc.submitDecision({
                    auditId: 'aud-1', decision: 'PASS', summary: 'ok', actorId: 'auditor-1', prisma,
                });

                const txCall = prisma.$transaction.mock.calls.find((c) => typeof c[0] === 'function');
                expect(txCall).toBeDefined(); // submitDecision ran an interactive transaction
                expect(txCall[1]?.timeout).toBeGreaterThanOrEqual(30000); // explicit ≥30s, not the 5s library default
            });
        });
    });
});
