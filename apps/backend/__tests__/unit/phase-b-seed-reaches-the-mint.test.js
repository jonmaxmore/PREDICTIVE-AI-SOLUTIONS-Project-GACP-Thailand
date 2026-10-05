'use strict';

/**
 * The Phase-B suite's seeded application must reach certificate.create.
 *
 * __tests__/integration/onsite-evidence-unfreeze.test.js (HEADLINE) expects
 * certificate-service.generateCertificate to mint for the row that
 * test-support/phase-b-application-seed.js describes, once onsite evidence is
 * fully recorded. That suite runs only against a test database; on a laptop it
 * skips, so a seed that stops at one of the register's fail-closed gates
 * (F-G4-52 farm location, F-G4-58 plant master) stays green here and goes red
 * on the runner (F-G4-58 review finding, 2026-08-27).
 *
 * This test walks the SAME row through the REAL issuance chain with an injected
 * client (pattern: certificate-issuance-names-the-plant.test.js): evidence
 * complete, no farm on record, and the plant master answering exactly as
 * prisma/seed-plants.js seeds it (read as text, so the fake cannot drift from
 * the seed). Either the certificate is written, or this fails with the gate's
 * own code.
 */

const fs = require('fs');
const path = require('path');

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
const { DEFAULT_MIN_PHOTOS, CHECKLIST_TEMPLATE_2026 } = require('../../services/audit-onsite-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');
const { phaseBApplicationData } = require('../../test-support/phase-b-application-seed');

const SEED_PLANTS = path.resolve(__dirname, '../../prisma/seed-plants.js');
const CERTIFICATE_NUMBER = /^TH-GACP \d+\/\d{4}$/;

/**
 * The plant master rows prisma/seed-plants.js declares, keyed by code — the same
 * regex __tests__/unit/plant-slug-map-covers-the-wizard.test.js reads the seed with.
 */
function readSeedPlantMaster() {
    const text = fs.readFileSync(SEED_PLANTS, 'utf8');
    const re = /\bcode:\s*'([A-Z]+)',\s*nameEN:\s*'([^']*)',\s*nameTH:\s*'([^']+)'/g;
    const master = {};
    let m;
    while ((m = re.exec(text)) !== null) {
        master[m[1]] = { id: `ps-${m[1].toLowerCase()}`, code: m[1], nameEN: m[2], nameTH: m[3], isActive: true };
    }
    return master;
}

/** The row prisma.application.findUnique hands back for the suite's HEADLINE seed. */
function headlineApplication() {
    const row = phaseBApplicationData(
        { applicationNumber: 'PHASE-B-unit', healthId: 'phase-b-applicant', organizationId: 'org-1' },
        // What the HEADLINE test passes as appOverrides.
        { status: 'AUDIT_PASSED', auditResult: 'PASS' },
    );
    return {
        id: 'app-1',
        // Application.formData is Json? with no default: absent from create means null.
        formData: null,
        entityId: null,
        submitterId: null,
        entity: null,
        applicant: { id: 'u1', firstName: 'Phase-B', lastName: 'Applicant' },
        ...row,
    };
}

/** No farm, no plots, full evidence, the seed's plant master. */
function fakeClient(application, plantMaster) {
    return {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'cert-1', ...data })),
        },
        application: { findUnique: jest.fn(async () => application) },
        auditChecklist: { findFirst: jest.fn(async () => ({ id: 'audit-1' })) },
        farmAuditPhoto: farmAuditPhotoStub(DEFAULT_MIN_PHOTOS),
        farmAuditChecklistItem: { count: jest.fn(async () => CHECKLIST_TEMPLATE_2026.length) },
        farm: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'farm-new', entity: null, ...data })),
            update: jest.fn(async ({ data }) => ({ id: 'farm-new', entity: null, ...data })),
        },
        plot: {
            count: jest.fn(async () => 0),
            create: jest.fn(async ({ data }) => ({ id: 'plot-1', ...data })),
        },
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => plantMaster[where.code] || null),
        },
    };
}

describe('the Phase-B seed reaches the mint', () => {
    const plantMaster = readSeedPlantMaster();

    it('read the plant master out of prisma/seed-plants.js (the regex still matches)', () => {
        expect(Object.keys(plantMaster).length).toBeGreaterThan(0);
    });

    it('generateCertificate mints for the HEADLINE seed, naming the plant from the master', async () => {
        const client = fakeClient(headlineApplication(), plantMaster);

        const cert = await certService.generateCertificate('app-1', 'auditor-1', {
            prisma: client,
            skipInitialAssets: true,
        });

        expect(cert.certificateNumber).toMatch(CERTIFICATE_NUMBER);
        expect(cert.applicationId).toBe('app-1');
        expect(client.certificate.create).toHaveBeenCalledTimes(1);

        const written = client.certificate.create.mock.calls[0][0].data;
        const namedCodes = Object.keys(plantMaster).filter((code) => plantMaster[code].nameTH === written.cropType);
        expect(namedCodes.length).toBe(1);
    });
});
