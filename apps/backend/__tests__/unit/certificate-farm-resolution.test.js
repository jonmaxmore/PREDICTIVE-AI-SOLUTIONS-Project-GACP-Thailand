/**
 * M1.5 H3 (spec design note 2026-08-15-m1.5-hardening-design §H3):
 * the issuance path looks for the ENTITY's farm first, and stops trampling it.
 *
 * Two things are pinned here, and they are the same bug seen from two sides:
 *   • lookup — every farm lookup tries the entity leg (`entityId: app.entityId`)
 *     before the legacy `ownerId` leg, so a workspace application submitted by
 *     someone who did not create the farm still lands on that farm instead of
 *     giving birth to a VERIFIED ghost "Certified Farm". A legacy-leg hit that
 *     belongs to ANOTHER entity is refused outright.
 *   • reuse update — three classes and nothing else: fill-only-blank (name /
 *     address / the area trio, written atomically), always-write (the issuance
 *     semantics: VERIFIED + verifiedAt/By + a stated cultivationMethod), and
 *     never-write (`ownerId`, `farmType` — spreading those silently moved a
 *     member's farm to whoever happened to submit).
 *
 * Drives the REAL issuance chain through the injectable options.prisma client
 * (pattern: certificate-issuance-holder-wiring.test.js:9,68) — no DB, no module
 * mock of the data layer. The M1 `include: { entity: true }` on every farm
 * access stays pinned here too.
 */

// RULING 2 (2026-08-22, certificate-service.js:1089-1135): PKI signing is no
// longer best-effort — signWithLocalKey, getPublicKeyForNamespace, a self-verify
// round-trip AND (2026-08-25) a trust check on the key about to be pinned are all
// mandatory or generateCertificate refuses fail-closed
// (CERT_SIGNING_UNAVAILABLE) before ever reaching farm resolution. These tests
// are about farm resolution, not signing, so the fixture supplies a satisfying
// stub for all four (signing itself is covered by
// certificate-signing-fail-closed.test.js and
// certificate-issuance-requires-trusted-key.test.js).
const TRUSTED_FINGERPRINT = 'sha256:trusted-in-this-test';
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: () => ({
        signWithLocalKey: async () => 'fake-signature',
        getPublicKeyForNamespace: async () => 'fake-public-key-pem',
        verifyWithLocalKey: async () => true,
        getTrustedPublicKeyFingerprints: async () => new Set([TRUSTED_FINGERPRINT]),
    }),
    fingerprintPublicKey: () => TRUSTED_FINGERPRINT,
}));

const certService = require('../../services/certificate-service');
const logger = require('../../shared/logger');
const { AREA_UNIT } = require('../../shared/area-utils');
const { DEFAULT_MIN_PHOTOS, CHECKLIST_TEMPLATE_2026 } = require('../../services/audit-onsite-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');

const LEGACY_WARN = '[Certificate] farm resolved via legacy ownerId';

const applicant = { id: 'u-submitter', firstName: 'บี', lastName: 'ผู้ยื่น' };

function baseApp(overrides) {
    return {
        status: 'APPROVED',
        auditResult: 'PASS',
        organizationId: 'org-1',
        submitterId: applicant.id,
        applicant,
        entity: { displayName: 'วิสาหกิจชุมชนบ้านนา', type: 'COMMUNITY_ENTERPRISE' },
        ...overrides,
    };
}

/**
 * A client whose farm.findFirst answers the WHERE it was actually given, so the
 * order of the legs is observable instead of assumed.
 */
function makeClient(app, farms) {
    const rows = farms.map((row) => ({ isDeleted: false, entityId: null, entity: null, ...row }));
    const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
        if (key === 'isDeleted') { return (row.isDeleted ?? false) === value; }
        return row[key] === value;
    });
    return {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),   // no existing cert (dedupe clear)
            findUnique: jest.fn(async () => null),  // no cert-number collision
            create: jest.fn(async ({ data }) => ({ id: 'cert-1', ...data })),
        },
        application: { findUnique: jest.fn(async () => app) },
        // cert-integrity gate (onsite-evidence-gate.js, Phase A2 2026-08-16):
        // generateCertificate now refuses fail-closed unless it can VERIFY a
        // live onsite audit with enough photos/checklist items. These tests
        // are about farm resolution, not evidence capture, so the fixture
        // supplies a sufficient record — sourced from audit-onsite-service's
        // own constants so this stays in lockstep with the real thresholds.
        auditChecklist: {
            findFirst: jest.fn(async () => ({ id: 'audit-1' })),
        },
        farmAuditPhoto: farmAuditPhotoStub(DEFAULT_MIN_PHOTOS),
        farmAuditChecklistItem: {
            count: jest.fn(async () => CHECKLIST_TEMPLATE_2026.length),
        },
        farm: {
            findFirst: jest.fn(async ({ where }) => rows.find((row) => matches(row, where)) || null),
            create: jest.fn(async ({ data }) => ({ id: 'farm-new', entity: null, ...data })),
            update: jest.fn(async ({ where, data }) => ({
                ...rows.find((row) => row.id === where.id),
                ...data,
            })),
        },
        // F-G4-58: issuance names the plant from the master (plant-species-service),
        // read through this client, and refuses before any write when it is unknown.
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => (where.code === 'CAN'
                ? { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' }
                : null)),
        },
    };
}

const legacyWarns = () => logger.warn.mock.calls.filter(([message]) => message === LEGACY_WARN);

beforeEach(() => {
    // Plots are irrelevant to farm resolution; the per-file module registry
    // keeps this override invisible to every other test file.
    certService.ensurePlotsForFarm = jest.fn(async () => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('M1.5 H3 — farm lookup asks the entity first', () => {
    it('AC1: the entity\'s farm is found through the entity leg though the submitter never created it', async () => {
        // plantId: F-G4-58 refuses an application whose plant the master does not know.
        const app = baseApp({ id: 'app-1', entityId: 'e1', formData: { farmId: 'farm-1', plantId: 'cannabis' } });
        const client = makeClient(app, [{
            id: 'farm-1', ownerId: 'u-creator', entityId: 'e1', organizationId: 'org-1',
            farmName: 'ฟาร์มบ้านนา', address: '1 หมู่ 1', province: 'เชียงใหม่',
            district: 'สันทราย', subDistrict: 'แม่แฝก', postalCode: '50210',
            totalArea: 4000, cultivationArea: 4000, areaUnit: AREA_UNIT,
        }]);

        await certService.generateCertificate('app-1', 'prov-1', { prisma: client, skipInitialAssets: true });

        const firstCall = client.farm.findFirst.mock.calls[0][0];
        expect(firstCall.where).toEqual(expect.objectContaining({ id: 'farm-1', entityId: 'e1' }));
        expect(firstCall.where).not.toHaveProperty('ownerId');
        expect(firstCall.include).toEqual(expect.objectContaining({ entity: true }));   // M1 D1 priority 2
        expect(client.farm.create).not.toHaveBeenCalled();
        expect(client.farm.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'farm-1' },
            include: expect.objectContaining({ entity: true }),
        }));
        expect(client.certificate.create.mock.calls[0][0].data.farmId).toBe('farm-1');
        expect(legacyWarns()).toHaveLength(0);
    });

    it('AC2: a legacy farm (entityId null) is still found through the ownerId leg — no ghost farm, one warn', async () => {
        // A single identifier on purpose: formData.farmId only, so the calls are
        // exactly the entity→owner pair of that one lookup.
        const app = baseApp({ id: 'app-2', entityId: 'e1', formData: { farmId: 'farm-2', plantId: 'cannabis' } });
        const client = makeClient(app, [{
            id: 'farm-2', ownerId: applicant.id, entityId: null, organizationId: 'org-1',
            farmName: 'ฟาร์มเก่า', address: '2 หมู่ 2', province: 'เชียงใหม่',
            district: 'สันทราย', subDistrict: 'แม่แฝก', postalCode: '50210',
            totalArea: 4000, cultivationArea: 4000, areaUnit: AREA_UNIT,
        }]);

        await certService.generateCertificate('app-2', 'prov-1', { prisma: client, skipInitialAssets: true });

        expect(client.farm.findFirst).toHaveBeenCalledTimes(2);
        expect(client.farm.findFirst.mock.calls[0][0].where).toEqual(
            expect.objectContaining({ id: 'farm-2', entityId: 'e1' }),
        );
        const ownerCall = client.farm.findFirst.mock.calls[1][0];
        expect(ownerCall.where).toEqual(expect.objectContaining({ id: 'farm-2', ownerId: applicant.id }));
        expect(ownerCall.where).not.toHaveProperty('entityId');
        expect(ownerCall.include).toEqual(expect.objectContaining({ entity: true }));
        expect(client.farm.create).not.toHaveBeenCalled();
        expect(client.certificate.create.mock.calls[0][0].data.farmId).toBe('farm-2');
        expect(logger.warn).toHaveBeenCalledWith(
            LEGACY_WARN,
            expect.objectContaining({ farmId: 'farm-2', applicationId: 'app-2' }),
        );
    });

    it('AC3: a farm belonging to another entity is refused, not reused', async () => {
        const app = baseApp({
            id: 'app-3', entityId: 'e1',
            formData: {
                farmId: 'farm-3',
                plantId: 'cannabis',
                // F-G4-52: the refused row is replaced by a NEW farm, which cannot be
                // created without its location — so the application states one. Since
                // 2026-09-07 it cannot be created without its NAME either: the fallback
                // that used to name it 'Certified Farm' is gone.
                farmData: {
                    farmName: 'ฟาร์มของผู้ยื่นเอง',
                    address: '7 หมู่ 7', province: 'เชียงใหม่', district: 'สันทราย',
                    subdistrict: 'แม่แฝก', postalCode: '50210',
                },
            },
        });
        const client = makeClient(app, [{
            id: 'farm-3', ownerId: applicant.id, entityId: 'e2', organizationId: 'org-1',
            farmName: 'ฟาร์มขององค์กรอื่น', address: '3 หมู่ 3', province: 'ลำพูน',
            district: 'เมือง', subDistrict: 'ในเมือง', postalCode: '51000',
            totalArea: 4000, cultivationArea: 4000, areaUnit: AREA_UNIT,
        }]);

        await certService.generateCertificate('app-3', 'prov-1', { prisma: client, skipInitialAssets: true });

        expect(client.farm.update).not.toHaveBeenCalled();
        expect(client.farm.create).toHaveBeenCalledTimes(1);
        const createArg = client.farm.create.mock.calls[0][0];
        expect(createArg.data).toEqual(expect.objectContaining({ entityId: 'e1', organizationId: 'org-1' }));
        expect(createArg.include).toEqual(expect.objectContaining({ entity: true }));
        expect(client.certificate.create.mock.calls[0][0].data.farmId).not.toBe('farm-3');
        expect(legacyWarns()).toHaveLength(0);   // a refused row was never "resolved"
    });
});

describe('M1.5 H3 — the reuse update writes three classes and nothing else', () => {
    const existingFarm = {
        id: 'farm-4', ownerId: 'u-creator', entityId: 'e1', organizationId: 'org-1',
        farmName: 'ฟาร์มจริงของสมาชิก',
        address: '',                       // blank → fill-only-blank fills it
        province: 'เชียงใหม่',              // has a value → survives
        district: '', subDistrict: 'แม่แฝก', postalCode: '50210',
        farmType: 'PROCESSING', status: 'ACTIVE',
        totalArea: 4000, cultivationArea: 4000, areaUnit: AREA_UNIT,
    };

    const reuseApp = (id) => baseApp({
        id, entityId: 'e1',
        formData: {
            farmId: 'farm-4',
            plantId: 'cannabis',
            locationType: 'INDOOR',
            // totalAreaUnit required since the farm-areaunit-default fix
            // (Task 3): the reuse path's blank-guard now reads it strictly
            // (computeBaseArea) when farm.totalArea is itself blank
            // (app-6 below) — a unit-less farmData would throw there.
            // district: the farm on record has a blank one (fill-only-blank fills it);
            // F-G4-52 refuses issuance when it would stay blank, so the application
            // answers it.
            farmData: { farmName: 'สวนของผู้ยื่น', address: '9 หมู่ 2', province: 'ลำพูน', district: 'เมืองลำพูน', totalAreaUnit: 'Sqm' },
            // productionData.areaUnit removed: dead carrier, dropped by the
            // farm-areaunit-default fix (Task 3) — certificate-service.js no
            // longer reads it (grepped: no live writer anywhere in the
            // tree). growingArea (the NUMBER) is still read; only the unit
            // came from farmData.totalAreaUnit now.
            productionData: { growingArea: 1600 },
        },
    });

    it('AC4: never-write ownerId/farmType, always-write VERIFIED, and the farm\'s own values survive', async () => {
        const app = reuseApp('app-4');
        const client = makeClient(app, [existingFarm]);

        await certService.generateCertificate('app-4', 'prov-4', { prisma: client, skipInitialAssets: true });

        const { data } = client.farm.update.mock.calls[0][0];
        // never-write
        expect(data).not.toHaveProperty('ownerId');
        expect(data).not.toHaveProperty('farmType');
        // always-write
        expect(data.status).toBe('VERIFIED');
        expect(data.verifiedBy).toBe('prov-4');
        expect(data.verifiedAt).toBeInstanceOf(Date);
        expect(data.cultivationMethod).toBe('INDOOR');
        // fill-only-blank: the empty one gets filled, the stated ones survive
        expect(data.address).toBe('9 หมู่ 2');
        const merged = { ...existingFarm, ...data };
        expect(merged.farmName).toBe('ฟาร์มจริงของสมาชิก');
        expect(merged.province).toBe('เชียงใหม่');
        expect(merged.ownerId).toBe('u-creator');
        expect(merged.farmType).toBe('PROCESSING');
        expect(client.certificate.create.mock.calls[0][0].data.farmName).toBe('ฟาร์มจริงของสมาชิก');
    });

    it('the area trio is atomic: untouched when totalArea has a value, written together when it is blank', async () => {
        const withArea = makeClient(reuseApp('app-5'), [existingFarm]);
        await certService.generateCertificate('app-5', 'prov-5', { prisma: withArea, skipInitialAssets: true });
        const kept = withArea.farm.update.mock.calls[0][0].data;
        expect(kept).not.toHaveProperty('totalArea');
        expect(kept).not.toHaveProperty('cultivationArea');
        expect(kept).not.toHaveProperty('areaUnit');   // a lone unit rewrite is how 1,600 sqm became 1,600 rai

        const blankArea = makeClient(
            reuseApp('app-6'),
            [{ ...existingFarm, totalArea: null, cultivationArea: null, areaUnit: 'rai' }],
        );
        await certService.generateCertificate('app-6', 'prov-6', { prisma: blankArea, skipInitialAssets: true });
        const filled = blankArea.farm.update.mock.calls[0][0].data;
        expect(filled).toEqual(expect.objectContaining({
            totalArea: 1600, cultivationArea: 1600, areaUnit: AREA_UNIT,
        }));
    });
});
