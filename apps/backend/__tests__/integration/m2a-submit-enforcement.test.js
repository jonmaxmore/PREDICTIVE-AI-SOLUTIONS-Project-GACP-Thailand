'use strict';

/**
 * M2a AC1-3 against a REAL Postgres — the document law applied to real rows.
 *
 * The unit suites prove the wiring and the decision logic over a mocked client.
 * Three things only the database can prove, and they are the three below:
 *
 *   AC1 — the `where` rulesAt builds is VALID PRISMA and selects what it claims:
 *         the seeded JURISTIC rule fires for a JURISTIC filing, and an
 *         INDIVIDUAL one is asked for nothing extra.
 *   AC2 — an `ApplicationDocument` row (a real INSERT, read back through
 *         `documentType`) is the evidence that clears the refusal, while a
 *         `formData.documents[].uploaded` flag on the same application is not.
 *   AC3 — a rule filed AFTER the stamp cannot 422 the resubmit: the stamped set
 *         decides, and the rule table is left alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HONEST SCOPE (Law L1). THIS FILE HAS NEVER EXECUTED. The machine it was
 * written on has no DATABASE_URL (plan Global Constraints, verified in this
 * session), so it self-skips and NEITHER red NOR green is claimed for any case
 * below. It is written to be run on staging after `prisma migrate deploy`, and
 * a fixture failure on the first real run is a fixture failure, not a product
 * failure.
 *
 * The rules it needs are created by the test itself, not assumed from the
 * migration seed — a suite that depends on seed rows proves the seed, not the
 * engine. The seed rows have their own suite (m2a-requirement-seed.test.js).
 */

const crypto = require('crypto');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('M2a submit enforcement (real Postgres)', () => {
    let prisma;
    let svc;
    const created = { rules: [], documents: [], applications: [], entities: [] };
    const uid = () => crypto.randomUUID();

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        svc = require('../../services/application-document-requirements');
    });

    afterAll(async () => {
        for (const id of created.documents) { await prisma.applicationDocument.deleteMany({ where: { id } }); }
        for (const id of created.applications) { await prisma.application.deleteMany({ where: { id } }); }
        for (const id of created.entities) { await prisma.entity.deleteMany({ where: { id } }); }
        // Requirement rules are append-only in PRODUCTION; a test that files its
        // own law cleans it up, or the next run is judged by the last run.
        for (const id of created.rules) { await prisma.requirementRule.deleteMany({ where: { id } }); }
    });

    // `plantId` is part of every real filing: since 2026-09-05 the gate refuses a filing
    // it cannot judge — one whose plant the register holds no กทล.1 rules for — BEFORE it
    // looks at documents, so a fixture without it would fail on the wrong refusal against
    // a register that carries the cannabis rows.
    async function seedFiling(entityType, formData = {}) {
        const filing = { plantId: 'cannabis', ...formData };
        const org = await prisma.organization.findFirst({ select: { id: true } });
        if (!org) { throw new Error('m2a-submit-enforcement: no organization row to attach fixtures to'); }

        const entity = await prisma.entity.create({
            data: {
                type: entityType,
                displayName: `M2A TEST ${uid().slice(0, 8)}`,
                organizationId: org.id,
                status: 'ACTIVE',
            },
        });
        created.entities.push(entity.id);

        const application = await prisma.application.create({
            data: {
                applicationNumber: `M2A-TEST-${uid().slice(0, 8)}`,
                status: 'DRAFT',
                organizationId: org.id,
                entityId: entity.id,
                formData: filing,
            },
        });
        created.applications.push(application.id);

        return { org, entity, application };
    }

    async function fileRule(data) {
        const rule = await prisma.requirementRule.create({
            data: {
                slotId: 'company_reg',
                isRequired: true,
                effectiveFrom: new Date(Date.now() - 86400000),
                createdBy: 'TEST-M2A',
                ...data,
            },
        });
        created.rules.push(rule.id);
        return rule;
    }

    it('AC1 — a JURISTIC filing with no document on file is refused, naming the slot', async () => {
        await fileRule({ holderType: 'JURISTIC' });
        const { application } = await seedFiling('JURISTIC');

        await expect(svc.assertRequiredDocumentsPresent({ application, mode: 'first-submit' }))
            .rejects.toMatchObject({
                status: 422,
                code: 'APPLICATION_INCOMPLETE',
                // Filed as 'company_reg' at :89, answered as the กทล.1 slot: the
                // v2 fold (spec 2026-09-01) made one paper one slot, and the
                // engine canonicalises what it reports (application-document-
                // requirements.js:148).
                missingSlots: [{ slotId: 'juristic_reg_6m', labelTH: expect.any(String) }],
            });
    });

    it('AC1 — the same law asks nothing of an INDIVIDUAL filing', async () => {
        await fileRule({ holderType: 'JURISTIC' });
        const { application } = await seedFiling('INDIVIDUAL');

        const { appliedRules } = await svc.assertRequiredDocumentsPresent({ application, mode: 'first-submit' });

        expect(appliedRules.filter((r) => r.holderType === 'JURISTIC')).toEqual([]);
    });

    it('AC2 — a client flag is not evidence, an ApplicationDocument row is', async () => {
        await fileRule({ holderType: 'JURISTIC' });
        const { application } = await seedFiling('JURISTIC', {
            documents: [{ slotId: 'company_reg', uploaded: true }],
        });

        await expect(svc.assertRequiredDocumentsPresent({ application, mode: 'first-submit' }))
            .rejects.toMatchObject({ status: 422 });

        const row = await prisma.applicationDocument.create({
            data: {
                applicationId: application.id,
                documentType: 'COMPANY_REG',
                fileUrl: '/uploads/test/company-reg.pdf',
            },
        });
        created.documents.push(row.id);

        const { appliedRules } = await svc.assertRequiredDocumentsPresent({ application, mode: 'first-submit' });
        expect(appliedRules.map((r) => r.slotId)).toContain('company_reg');
    });

    it('AC3 — a rule filed after the stamp cannot refuse the resubmit', async () => {
        const { application } = await seedFiling('JURISTIC', {
            serverRequirementSnapshot: { stampedAt: new Date().toISOString(), ruleIds: [], slotIds: [] },
        });
        // the ministry tightens the law AFTER this filing was judged …
        await fileRule({ holderType: 'JURISTIC', effectiveFrom: new Date() });

        await expect(svc.assertRequiredDocumentsPresent({ application, mode: 'resubmit' }))
            .resolves.toMatchObject({ appliedRules: [] });
    });

    it('AC3 — closing a rule stops it firing for filings made afterwards', async () => {
        const rule = await fileRule({ holderType: 'JURISTIC' });
        const { application } = await seedFiling('JURISTIC');

        await expect(svc.assertRequiredDocumentsPresent({ application, mode: 'first-submit' }))
            .rejects.toMatchObject({ status: 422 });

        const { closeRule } = require('../../services/requirement-rule-service');
        await closeRule(rule.id, 'TEST-M2A', 'integration test');

        const { appliedRules } = await svc.assertRequiredDocumentsPresent({ application, mode: 'first-submit' });
        expect(appliedRules.map((r) => r.id)).not.toContain(rule.id);
    });
});
