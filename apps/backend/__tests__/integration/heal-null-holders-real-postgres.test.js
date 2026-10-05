'use strict';

/**
 * heal-null-holders on a REAL Postgres (remove-workspace-mode Task 7, spec §3.5).
 *
 * planHeal must place every null-holder row the §3.5 rules can place, list the
 * rest for the operator, and write NOTHING. applyHeal must fill only columns
 * that are still NULL at write time — a holder filled between the plan and the
 * apply (by a person, or by the new code) is never overwritten.
 *
 * The plan reads the whole table; assertions look only at this file's fixture
 * rows so other suites' leftovers cannot change the answer. Skips cleanly
 * without a migrated test database.
 */

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

// The holder columns the issuance path writes (services/certificate-service.js holder
// snapshot: entity name/type, else the person and LEGACY_PERSON; submitter, else the
// applicant). m1-holder-backfill asserts no certificate row lacks them.
async function holderColumnsFor(prisma, applicationId) {
    const a = await prisma.application.findUnique({
        where: { id: applicationId },
        select: {
            submitterId: true,
            entity: { select: { displayName: true, type: true } },
            applicant: { select: { id: true, firstName: true, lastName: true } },
        },
    });
    const person = [a.applicant?.firstName, a.applicant?.lastName].filter(Boolean).join(' ') || 'ทดสอบ';
    return {
        holderDisplayName: a.entity ? a.entity.displayName : person,
        holderType: a.entity ? a.entity.type : 'LEGACY_PERSON',
        submittedByUserId: a.submitterId ?? a.applicant.id,
    };
}
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planHeal, applyHeal, main, RULES } = require('../../scripts/heal-null-holders');

d('heal-null-holders (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { users: {}, entities: {}, apps: {}, farms: {}, certs: [] };

    async function makeUser(label) {
        const id = crypto.randomUUID();
        const canonicalId = `heal-${label}-${sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `heal-${label}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: label, organizationId: fx.org,
            },
        });
        fx.users[label] = { id, canonicalId };
        return fx.users[label];
    }

    async function makeEntity(label, { type, owner, role = 'OWNER', status = 'ACTIVE' }) {
        const entity = await raw.entity.create({ data: { type, displayName: `heal ${label}`, organizationId: fx.org } });
        await raw.entityMembership.create({
            data: { userId: owner.id, entityId: entity.id, role, status, organizationId: fx.org },
        });
        fx.entities[label] = entity.id;
        return entity.id;
    }

    async function makeApp(label, { filer, status = 'SUBMITTED', applicantType, entityId = null }) {
        const row = await raw.application.create({
            data: {
                applicationNumber: `APP-HEAL-${label}-${sfx}`, healthId: filer.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId, status,
                formData: applicantType === undefined ? {} : { applicantType },
            },
        });
        fx.apps[label] = row.id;
        return row.id;
    }

    async function makeFarm(label, { owner, entityId = null }) {
        const farm = await raw.farm.create({
            data: {
                ownerId: owner.id, farmName: `ฟาร์ม heal ${label} ${sfx}`, farmType: 'CULTIVATION', address: '1',
                province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'บางพลีใหญ่', postalCode: '10540',
                totalArea: 1, cultivationArea: 1, cultivationMethod: 'OUTDOOR', organizationId: fx.org, entityId,
            },
        });
        fx.farms[label] = farm.id;
        return farm.id;
    }

    async function makeCert(label, { applicationId, farmId, user }) {
        const cert = await raw.certificate.create({
            data: {
                certificateNumber: `GACP-HEAL-${label}-${sfx}`, verificationCode: `V-${label}-${sfx}`, qrData: 'qr',
                applicationId, userId: user.id, farmId, farmName: 'ฟาร์ม', applicantName: 'ทดสอบ',
                cropType: 'cannabis', farmSize: 1, province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'บางพลีใหญ่',
                standardId: 'std', standardName: 'GACP', expiryDate: new Date(Date.now() + 365 * 86400e3),
                issuedBy: user.id, status: 'active', organizationId: fx.org,
                ...(await holderColumnsFor(raw, applicationId)),
            },
        });
        fx.certs.push(cert.id);
    }

    const mine = (plan) => {
        const ids = new Set([...Object.values(fx.apps), ...Object.values(fx.farms)]);
        return plan.rows.filter((r) => ids.has(r.id));
    };
    const rowOf = (plan, table, id) => plan.rows.find((r) => r.table === table && r.id === id);

    async function snapshot() {
        const [apps, farms, memberships, entities] = await Promise.all([
            raw.application.findMany({ select: { id: true, entityId: true, updatedAt: true }, orderBy: { id: 'asc' } }),
            raw.farm.findMany({ select: { id: true, entityId: true, updatedAt: true }, orderBy: { id: 'asc' } }),
            raw.entityMembership.count(),
            raw.entity.count(),
        ]);
        return { apps, farms, memberships, entities };
    }

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: `heal-${sfx}`, slug: `heal-${sfx}`, code: `HEAL_${sfx}`.toUpperCase() },
        });
        fx.org = org.id;

        // solo: one personal entity. twin: two personal entities. corp: a personal
        // entity and a company. revoked: an OWNER membership that is no longer ACTIVE.
        const solo = await makeUser('solo');
        await makeEntity('soloPersonal', { type: 'INDIVIDUAL', owner: solo });
        const twin = await makeUser('twin');
        await makeEntity('twinA', { type: 'INDIVIDUAL', owner: twin });
        await makeEntity('twinB', { type: 'INDIVIDUAL', owner: twin });
        const corp = await makeUser('corp');
        await makeEntity('corpPersonal', { type: 'INDIVIDUAL', owner: corp });
        await makeEntity('corpCompany', { type: 'JURISTIC', owner: corp });
        const revoked = await makeUser('revoked');
        await makeEntity('revokedPersonal', { type: 'INDIVIDUAL', owner: revoked, status: 'REVOKED' });

        await makeApp('soloIndividual', { filer: solo, applicantType: 'INDIVIDUAL' });
        await makeApp('soloAbsent', { filer: solo, applicantType: undefined, status: 'DRAFT' });
        await makeApp('corpJuristicDraft', { filer: corp, applicantType: 'JURISTIC', status: 'DRAFT' });
        await makeApp('corpJuristicSubmitted', { filer: corp, applicantType: 'JURISTIC', status: 'SUBMITTED' });
        await makeApp('twinIndividual', { filer: twin, applicantType: 'INDIVIDUAL' });
        await makeApp('revokedIndividual', { filer: revoked, applicantType: 'INDIVIDUAL' });
        await makeApp('alreadyHeld', { filer: solo, applicantType: 'INDIVIDUAL', entityId: fx.entities.soloPersonal });
        // The company's certified application, filed with the company as holder.
        await makeApp('corpCertified', { filer: corp, applicantType: 'JURISTIC', status: 'CERTIFIED', entityId: fx.entities.corpCompany });

        await makeFarm('corpCertFarm', { owner: corp });
        await makeCert('corp', { applicationId: fx.apps.corpCertified, farmId: fx.farms.corpCertFarm, user: corp });
        // Final review I2: the farm owner left the company the certificate names (REVOKED).
        // left: has a personal entity; leftAlone: has none.
        const left = await makeUser('left');
        await makeEntity('leftPersonal', { type: 'INDIVIDUAL', owner: left });
        await makeEntity('leftCompany', { type: 'JURISTIC', owner: left, status: 'REVOKED' });
        await makeApp('leftCertified', { filer: left, applicantType: 'JURISTIC', status: 'CERTIFIED', entityId: fx.entities.leftCompany });
        await makeFarm('leftCertFarm', { owner: left });
        await makeCert('left', { applicationId: fx.apps.leftCertified, farmId: fx.farms.leftCertFarm, user: left });
        const leftAlone = await makeUser('leftAlone');
        await makeEntity('leftAloneCompany', { type: 'JURISTIC', owner: leftAlone, status: 'REVOKED' });
        await makeApp('leftAloneCertified', {
            filer: leftAlone, applicantType: 'JURISTIC', status: 'CERTIFIED', entityId: fx.entities.leftAloneCompany,
        });
        await makeFarm('leftAloneCertFarm', { owner: leftAlone });
        await makeCert('leftAlone', { applicationId: fx.apps.leftAloneCertified, farmId: fx.farms.leftAloneCertFarm, user: leftAlone });
        await makeFarm('soloFarm', { owner: solo });
        await makeFarm('twinFarm', { owner: twin });
        await makeFarm('heldFarm', { owner: solo, entityId: fx.entities.soloPersonal });
    });

    afterAll(async () => {
        if (fx.dir) { fs.rmSync(fx.dir, { recursive: true, force: true }); }
        if (!raw) { return; }
        await raw.certificate.deleteMany({ where: { id: { in: fx.certs } } });
        await raw.application.deleteMany({ where: { id: { in: Object.values(fx.apps) } } });
        await raw.farm.deleteMany({ where: { id: { in: Object.values(fx.farms) } } });
        await raw.entityMembership.deleteMany({ where: { organizationId: fx.org } });
        await raw.entity.deleteMany({ where: { id: { in: Object.values(fx.entities) } } });
        await raw.user.deleteMany({ where: { id: { in: Object.values(fx.users).map((u) => u.id) } } });
        await raw.organization.delete({ where: { id: fx.org } }).catch(() => {});
        await raw.$disconnect();
    });

    test('dry run writes nothing (every application and farm row, and the membership tables, unchanged)', async () => {
        const before = await snapshot();
        const plan = await planHeal(raw);
        const after = await snapshot();
        expect(mine(plan).length).toBeGreaterThan(0);
        expect(after).toEqual(before);
    });

    test('rows that already have a holder are not in the plan', async () => {
        const plan = await planHeal(raw);
        expect(rowOf(plan, 'applications', fx.apps.alreadyHeld)).toBeUndefined();
        expect(rowOf(plan, 'applications', fx.apps.corpCertified)).toBeUndefined();
        expect(rowOf(plan, 'farms', fx.farms.heldFarm)).toBeUndefined();
    });

    test('application rules on real rows', async () => {
        const plan = await planHeal(raw);
        expect(rowOf(plan, 'applications', fx.apps.soloIndividual)).toMatchObject({
            chosenEntityId: fx.entities.soloPersonal, rule: RULES.APP_FILER_SINGLE_PERSONAL_ENTITY,
        });
        expect(rowOf(plan, 'applications', fx.apps.soloAbsent)).toMatchObject({
            chosenEntityId: fx.entities.soloPersonal, rule: RULES.APP_FILER_SINGLE_PERSONAL_ENTITY,
        });
        // JURISTIC declared → unplaced, even though the filer owns a company and a personal entity.
        expect(rowOf(plan, 'applications', fx.apps.corpJuristicDraft)).toMatchObject({
            chosenEntityId: null, rule: 'UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD',
        });
        expect(rowOf(plan, 'applications', fx.apps.corpJuristicSubmitted)).toMatchObject({
            chosenEntityId: null, rule: 'UNPLACED_OPERATOR_DECIDES',
        });
        expect(rowOf(plan, 'applications', fx.apps.twinIndividual)).toMatchObject({
            chosenEntityId: null, rule: 'UNPLACED_OPERATOR_DECIDES',
        });
        // A REVOKED owner membership is not a candidate.
        expect(rowOf(plan, 'applications', fx.apps.revokedIndividual)).toMatchObject({ chosenEntityId: null });
    });

    test("farm rules on real rows: the certificate's application entity wins, then the single personal entity", async () => {
        const plan = await planHeal(raw);
        expect(rowOf(plan, 'farms', fx.farms.corpCertFarm)).toMatchObject({
            chosenEntityId: fx.entities.corpCompany, rule: RULES.FARM_CERTIFICATE_APPLICATION_ENTITY,
        });
        expect(rowOf(plan, 'farms', fx.farms.soloFarm)).toMatchObject({
            chosenEntityId: fx.entities.soloPersonal, rule: RULES.FARM_OWNER_SINGLE_PERSONAL_ENTITY,
        });
        expect(rowOf(plan, 'farms', fx.farms.twinFarm)).toMatchObject({
            chosenEntityId: null, rule: 'UNPLACED_OPERATOR_DECIDES',
        });
    });

    test('final review I2: the certificate rule never places a farm on an entity its owner is not an ACTIVE member of', async () => {
        const plan = await planHeal(raw);
        // The owner's company membership is REVOKED → unplaced even with a personal entity:
        // a certified farm is not handed to a person while a company holds the certificate.
        expect(rowOf(plan, 'farms', fx.farms.leftCertFarm)).toMatchObject({
            chosenEntityId: null, rule: 'UNPLACED_OPERATOR_DECIDES',
        });
        // ...and with no personal entity either → unplaced, the operator decides.
        expect(rowOf(plan, 'farms', fx.farms.leftAloneCertFarm)).toMatchObject({
            chosenEntityId: null, rule: 'UNPLACED_OPERATOR_DECIDES',
        });
    });

    // Round 1: the CLI driven end to end. planHeal is narrowed to this file's rows so
    // a shared test database's other null rows are neither planned nor written.
    function cli(extra = {}) {
        const lines = [];
        const deps = {
            env: { DATABASE_URL: process.env.DATABASE_URL },
            planHeal: async (p) => ({ rows: mine(await planHeal(p)) }),
            evidenceDir: fx.dir,
            out: { log: (m) => lines.push(m), error: (m) => lines.push(m) },
            ...extra,
        };
        return { deps, lines };
    }
    const newest = (suffix) => fs.readdirSync(fx.dir).filter((f) => f.endsWith(suffix)).sort().pop();

    test('--apply with a plan that no longer matches the database refuses and writes nothing', async () => {
        fx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-pg-'));
        const dry = cli();
        expect(await main(['--db-label=local'], dry.deps)).toBe(0);
        const planPath = path.join(fx.dir, newest('-plan.csv'));

        // After review, twin loses the second personal entity: twinIndividual becomes placeable.
        await raw.entityMembership.updateMany({ where: { entityId: fx.entities.twinB }, data: { status: 'REVOKED' } });
        try {
            const before = await snapshot();
            const run = cli();
            expect(await main(['--apply', '--db-label=local', `--plan=${planPath}`], run.deps)).toBe(3);
            expect(await snapshot()).toEqual(before);
            expect(run.lines.join('\n')).toContain(fx.apps.twinIndividual);
            expect(newest('-rollback.csv')).toBeUndefined();
        } finally {
            await raw.entityMembership.updateMany({ where: { entityId: fx.entities.twinB }, data: { status: 'ACTIVE' } });
        }
    });

    test('--apply fills only NULL columns and never overwrites a holder filled after the plan', async () => {
        const plan = await planHeal(raw);
        const scoped = { rows: mine(plan) };

        // Between the plan and the apply, someone gives soloIndividual a different holder.
        await raw.application.update({ where: { id: fx.apps.soloIndividual }, data: { entityId: fx.entities.corpCompany } });

        const result = await applyHeal(raw, scoped);

        const app = (id) => raw.application.findUnique({ where: { id }, select: { entityId: true } });
        const farm = (id) => raw.farm.findUnique({ where: { id }, select: { entityId: true } });
        expect((await app(fx.apps.soloIndividual)).entityId).toBe(fx.entities.corpCompany); // not overwritten
        expect((await app(fx.apps.soloAbsent)).entityId).toBe(fx.entities.soloPersonal);
        expect((await farm(fx.farms.corpCertFarm)).entityId).toBe(fx.entities.corpCompany);
        expect((await farm(fx.farms.soloFarm)).entityId).toBe(fx.entities.soloPersonal);
        // Unplaced rows stay NULL — the script never decides for the operator.
        expect((await app(fx.apps.corpJuristicDraft)).entityId).toBeNull();
        expect((await app(fx.apps.twinIndividual)).entityId).toBeNull();
        expect((await farm(fx.farms.twinFarm)).entityId).toBeNull();
        // A row that already had a holder keeps it.
        expect((await app(fx.apps.alreadyHeld)).entityId).toBe(fx.entities.soloPersonal);

        // I2: the owner left the certificate's company → unplaced, with or without a personal entity.
        expect((await farm(fx.farms.leftCertFarm)).entityId).toBeNull();
        expect((await farm(fx.farms.leftAloneCertFarm)).entityId).toBeNull();
        expect(result.updated.map((r) => r.id).sort()).toEqual(
            [fx.apps.soloAbsent, fx.farms.corpCertFarm, fx.farms.soloFarm].sort(),
        );
        expect(result.skipped).toEqual([
            expect.objectContaining({ table: 'applications', id: fx.apps.soloIndividual, reason: 'ALREADY_FILLED' }),
        ]);

        // Applying the same plan again changes nothing.
        const again = await applyHeal(raw, scoped);
        expect(again.updated).toEqual([]);
    });

    test('the rollback list holds only rows this run wrote — never one filled by someone else', async () => {
        const late = await makeUser('late');
        await makeEntity('latePersonal', { type: 'INDIVIDUAL', owner: late });
        await makeApp('lateA', { filer: late, applicantType: 'INDIVIDUAL' });
        await makeApp('lateB', { filer: late, applicantType: 'INDIVIDUAL' });
        fx.dir = fx.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'heal-pg-'));

        expect(await main(['--db-label=local'], cli().deps)).toBe(0);
        const planPath = path.join(fx.dir, newest('-plan.csv'));

        // lateB is filled by someone else after the compare and before the write.
        const run = cli({
            applyHeal: async (p, plan) => {
                await raw.application.update({ where: { id: fx.apps.lateB }, data: { entityId: fx.entities.corpCompany } });
                return applyHeal(p, plan);
            },
        });
        expect(await main(['--apply', '--db-label=local', `--plan=${planPath}`], run.deps)).toBe(0);

        const rows = fs.readFileSync(path.join(fx.dir, newest('-rollback.csv')), 'utf8').trim().split('\n');
        expect(rows[0]).toMatch(/^# heal-null-holders ROLLBACK LIST label=local db=[0-9a-f]{8} written=1/);
        expect(rows.slice(2)).toEqual([`applications,${fx.apps.lateA},${fx.entities.latePersonal}`]);
        const app = (id) => raw.application.findUnique({ where: { id }, select: { entityId: true } });
        expect((await app(fx.apps.lateA)).entityId).toBe(fx.entities.latePersonal);
        expect((await app(fx.apps.lateB)).entityId).toBe(fx.entities.corpCompany);
    });
});
