/**
 * M1 (2026-08-15) — AC4: erasing a member must never kill the farm's certificate,
 * and must never let a PERSON's name survive inside it.
 *
 * The unit pins (__tests__/unit/pdpa-erasure-service.test.js, describe
 * "M1 — erasure and the holder columns") prove the service ASKS Postgres for
 * `holderType` and writes the right UPDATE payload. They cannot prove Postgres
 * AGREES: that the M1 columns exist on the live table (migration
 * 20260815100000_certificate_holder_expand), that a JURISTIC row really keeps
 * its holder name through a full erasure transaction, and that the public
 * verify endpoint still answers 200/verified for that row afterwards. A false
 * negative here is unrecoverable — erasure is a one-way write.
 *
 * Operator ruling 2026-08-27 (pdpa-erasure-service.js, step 3): a certificate
 * still inside its retention (`retainUntil` in the future, or `legalHold`) is
 * DEFERRED — the holder name stays on the register. Postgres stamps
 * `retainUntil = now() + 5 years` NOT NULL on every row that does not set it
 * (migration 20260110020726), so a seed that says nothing about retention is a
 * LIVE certificate and never reaches the anonymising UPDATE. The anonymised-path
 * cases below therefore seed a PAST retainUntil explicitly; the live-default
 * case seeds nothing and proves the deferral against the real column default.
 *
 * Seeding uses a RAW PrismaClient rather than services/prisma-database: the app
 * client carries the tenant-scope + soft-delete extensions and we want ground
 * truth, not a filtered view. The erasure itself runs through its own client,
 * exactly as the route does.
 *
 * Requires DATABASE_URL pointing at a migrated Postgres. Skips itself cleanly
 * on the unit-only lane — a green local run is therefore NOT evidence of DB
 * behaviour (plan Global Constraints: staging only).
 */

const { PrismaClient } = require('@prisma/client');
const request = require('supertest');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('M1: erasing a member never kills the farm certificate (AC4)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let erasureService;
    let ERASURE_SENTINEL;
    let app;
    let orgId;

    /** Everything seeded, newest first — torn down in FK-safe order. */
    const seeded = { certificates: [], applications: [], farms: [], memberships: [], entities: [], users: [] };

    const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        // Lazy requires: a skipped lane must not pay for booting the server.
        erasureService = require('../../services/pdpa-erasure-service');
        ({ ERASURE_SENTINEL } = erasureService);
        app = require('../../server');

        const suffix = uniq();
        const org = await prisma.organization.create({
            data: {
                name: 'M1 Erasure Holder Test Org',
                slug: `m1-erasure-${suffix}`,
                code: `M1ERASE_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
    });

    afterAll(async () => {
        if (prisma) {
            // Certificate → Application → Farm → Membership → Entity → User → Org.
            // Certificate.farmId is ON DELETE Restrict by design (T-010), so the
            // certificate rows must go first or the farm delete is refused.
            await prisma.certificate.deleteMany({ where: { id: { in: seeded.certificates } } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id: { in: seeded.applications } } }).catch(() => {});
            await prisma.farm.deleteMany({ where: { id: { in: seeded.farms } } }).catch(() => {});
            await prisma.entityMembership.deleteMany({ where: { id: { in: seeded.memberships } } }).catch(() => {});
            await prisma.entity.deleteMany({ where: { id: { in: seeded.entities } } }).catch(() => {});
            await prisma.user.deleteMany({ where: { id: { in: seeded.users } } }).catch(() => {});
            if (orgId) { await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {}); }
            await prisma.$disconnect();
        }
    });

    /**
     * Seed one member + the entity that holds the certificate.
     *
     * `entityType` is the Entity.type; `holderType` is what the certificate row
     * records (they differ only for LEGACY_PERSON, which is what the M1 backfill
     * stamps on pre-entity certificates).
     *
     * `retention` is spread into the certificate row: `{ retainUntil, legalHold }`
     * for the anonymised path, or omitted so Postgres applies its own defaults
     * (now()+5y / false) — the row every certificate the app mints looks like.
     */
    async function seedHolder({ entityType, holderType, holderDisplayName, retention = {} }) {
        const suffix = uniq();
        const user = await prisma.user.create({
            data: {
                canonicalId: `m1-erase-canon-${suffix}`,
                healthId: `m1-erase-hid-${suffix}`,
                password: 'x', // never authenticated in this test
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'สมชาย',
                lastName: 'ทดสอบ',
            },
        });
        seeded.users.push(user.id);

        const entity = await prisma.entity.create({
            data: { type: entityType, displayName: holderDisplayName, organizationId: orgId, createdBy: user.id },
        });
        seeded.entities.push(entity.id);

        const membership = await prisma.entityMembership.create({
            data: { userId: user.id, entityId: entity.id, role: 'OWNER', status: 'ACTIVE', organizationId: orgId },
        });
        seeded.memberships.push(membership.id);

        const farm = await prisma.farm.create({
            data: {
                ownerId: user.id,
                entityId: entity.id,
                organizationId: orgId,
                farmName: 'ไร่ทดสอบ M1',
                farmType: 'CULTIVATION',
                address: '1 หมู่ 1',
                province: 'กรุงเทพ',
                district: 'ดุสิต',
                subDistrict: 'ดุสิต',
                postalCode: '10300',
                totalArea: 5,
                cultivationArea: 3,
                cultivationMethod: 'ORGANIC',
            },
        });
        seeded.farms.push(farm.id);

        const application = await prisma.application.create({
            data: {
                applicationNumber: `M1-ERASE-${suffix}`,
                healthId: user.canonicalId,
                entityId: entity.id,
                submitterId: user.id,
                areaType: 'OUTDOOR',
                organizationId: orgId,
            },
        });
        seeded.applications.push(application.id);

        const yearBE = new Date().getFullYear() + 543;
        const certNumber = `GACP-TH-${yearBE}-${suffix}`.slice(0, 40);
        const certificate = await prisma.certificate.create({
            data: {
                certificateNumber: certNumber,
                verificationCode: 'M1TESTCODE',
                qrData: `https://gacpth.com/verify/${certNumber}`,
                applicationId: application.id,
                userId: user.id,
                farmId: farm.id,
                farmName: farm.farmName,
                applicantName: 'สมชาย ทดสอบ',
                submittedByUserId: user.id,
                holderDisplayName,
                holderType,
                cropType: 'กัญชา',
                farmSize: 5,
                province: 'กรุงเทพ',
                district: 'ดุสิต',
                subDistrict: 'ดุสิต',
                address: '1 หมู่ 1',
                standardId: 'GACP-TH',
                standardName: 'GACP Thailand',
                status: 'active',
                issuedDate: new Date(),
                expiryDate: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000),
                issuedBy: 'SYSTEM',
                validityYears: 3,
                ...retention,
            },
        });
        seeded.certificates.push(certificate.id);

        return { user, entity, farm, application, cert: certificate };
    }

    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    /** Past retention, no hold: the only row shape the anonymising UPDATE accepts. */
    const pastRetention = () => ({ retainUntil: new Date(Date.now() - YEAR_MS), legalHold: false });

    const seedJuristicEntityWithCert = () => seedHolder({
        entityType: 'JURISTIC', holderType: 'JURISTIC', holderDisplayName: 'บริษัท ไร่ทดสอบ จำกัด',
        retention: pastRetention(),
    });
    // An INDIVIDUAL Entity's displayName is built from the person's own
    // firstName + lastName (entity-service.js:323-327) — the exact string the
    // erasure clears from applicantName. Letting it live on in holderDisplayName
    // would re-publish the erased name on the PDF and the verify page.
    const seedIndividualEntityCert = () => seedHolder({
        entityType: 'INDIVIDUAL', holderType: 'INDIVIDUAL', holderDisplayName: 'สมชาย ทดสอบ',
        retention: pastRetention(),
    });
    // Pre-entity certificates: no Entity row ever existed, so the M1 backfill
    // stamped LEGACY_PERSON and copied the person's applicantName across.
    const seedLegacyPersonCert = () => seedHolder({
        entityType: 'INDIVIDUAL', holderType: 'LEGACY_PERSON', holderDisplayName: 'สมชาย ทดสอบ',
        retention: pastRetention(),
    });
    // Schema-default row: nothing said about retention, so Postgres stamps
    // now()+5y / false — the shape of every certificate the app actually issues.
    const seedLiveIndividualCert = () => seedHolder({
        entityType: 'INDIVIDUAL', holderType: 'INDIVIDUAL', holderDisplayName: 'สมชาย ทดสอบ',
    });

    it('juristic-held cert (past retention): valid + verifiable + holder name unchanged after member erasure', async () => {
        const { user, cert } = await seedJuristicEntityWithCert();

        await erasureService.executeErasure({ userId: user.id, actorId: user.id });

        const after = await prisma.certificate.findUnique({ where: { id: cert.id } });
        expect(after.status).toBe('active');
        expect(after.holderDisplayName).toBe(cert.holderDisplayName);
        expect(after.holderType).toBe('JURISTIC');
        // The person behind the submission IS erased in the same transaction —
        // this test is about the company keeping its certificate, not about
        // relaxing the erasure. (Reachable only because the seed is past its
        // retention; the live-default case below pins the other branch.)
        expect(after.applicantName).toBe(ERASURE_SENTINEL);

        const res = await request(app).get(`/api/v1/public/verify/${cert.certificateNumber}`);
        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(true);
    });

    it('LEGACY_PERSON and INDIVIDUAL certs (past retention): holder name IS wiped to sentinel (person data duty wins)', async () => {
        for (const seed of [seedLegacyPersonCert, seedIndividualEntityCert]) {
            const { user, cert } = await seed();

            await erasureService.executeErasure({ userId: user.id, actorId: user.id });

            const after = await prisma.certificate.findUnique({ where: { id: cert.id } });
            expect(after.holderDisplayName).toBe(ERASURE_SENTINEL);
            // The certificate itself survives — PDPA hides the identity, it does
            // not destroy the regulated record.
            expect(after.certificateNumber).toBe(cert.certificateNumber);
            expect(after.status).toBe('active');
        }
    });

    it('schema-default (live) cert: retention active, so erasure retains it — applicantName + holder name untouched, row listed in summary.retained', async () => {
        const { user, cert } = await seedLiveIndividualCert();
        // Ground truth from the column default, not from this file: Postgres set it.
        expect(cert.legalHold).toBe(false);
        expect(cert.retainUntil.getTime()).toBeGreaterThan(Date.now());

        const summary = await erasureService.executeErasure({ userId: user.id, actorId: user.id });

        const after = await prisma.certificate.findUnique({ where: { id: cert.id } });
        expect(after.applicantName).toBe('สมชาย ทดสอบ');
        expect(after.holderDisplayName).toBe('สมชาย ทดสอบ');
        expect(after.status).toBe('active');
        expect(summary.anonymized.certificates).toBe(0);
        expect(summary.retained.certificates).toEqual([{
            id: cert.id,
            certificateNumber: cert.certificateNumber,
            basis: 'RETENTION_ACTIVE',
            retainUntil: cert.retainUntil.toISOString(),
        }]);

        // The register still answers for the certificate, and still names its
        // holder: `verified` is status/expiry only (routes/api/auth/public.js,
        // `isActive`), and an INDIVIDUAL holder goes through the PR-1.5 mask
        // (last name → initial) — never the sentinel.
        const res = await request(app).get(`/api/v1/public/verify/${cert.certificateNumber}`);
        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(true);
        expect(res.body.data.certificate.holderDisplayName).toBe('สมชาย ท.');
        expect(res.body.data.certificate.applicantName).toBe('สมชาย ท.');
    });
});
