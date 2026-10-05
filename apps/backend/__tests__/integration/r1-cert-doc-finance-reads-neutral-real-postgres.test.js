'use strict';

/**
 * R1 is behaviour-neutral for the certificate, document, pre-check and finance
 * health doors (operator ruling C1; Task 4 of 2026-09-30-remove-workspace-mode):
 * for every actor, workspace header and door below, the R1 code answers with
 * exactly the status and row set the pre-R1 code (e46ceba0) answered with.
 *
 * EXPECTED was captured by running this same file against e46ceba0's
 * implementation files (a separate worktree at e46ceba0, same schema, same
 * fixture), with R1_NEUTRAL_RECORD set; row ids are mapped to fixture labels so
 * the table is stable across runs. See evidence/remove-workspace-mode/task-4/.
 *
 * Real Postgres, the real prisma-database client, the real tenant-context and
 * active-entity middlewares; only authentication is attached by hand, the
 * consent gate on submit passes, the pre-check queue records, and the two PDF
 * renderers return a fixed buffer (the bytes are not under test; the reads in
 * front of them are). The witness runs in its default (shadow) mode here.
 *
 * Fixture (one organisation):
 *   A — OWNER of personal P and of company C.
 *   W — OWNER of personal PW, MANAGER invited to P.
 *   V — OWNER of personal PV, VIEWER of C.
 *   M — OWNER of personal PM, MANAGER of C.
 *   S — OWNER of personal PS only (a stranger).
 *   F — OWNER of personal PF; filed fC and dF on company C, then lost the C
 *       membership (status REVOKED). Pre-R1 the filer pin alone decided the
 *       certificate/quote/report reads, so F still saw fC's certificate (fix round 1).
 *   G — personal entity PG matched only by thaiCitizenIdHash (no membership row):
 *       holder set R(G) = []. Filed gP and dG on PG (fix round 1).
 *   N — no entity and no membership at all, so no entity context is ever bound;
 *       filed nN and dN with entityId null. A also filed aN with entityId null
 *       (final review C1, 2026-10-03; expected re-recorded on main e33666b9).
 *   The QT-PRD quotation counter delta across the doors is recorded too: a read
 *   that misses a live quotation makes the self-heal burn numbers.
 *   Filings past DRAFT (each with a certificate, a quote, a quotation, one
 *   uploaded document and its pre-check): aC (A on C), aP (A on P), wP (W on P),
 *   mC (M on C). Drafts for submit/bundles: dC (A on C), dP (A on P), dW (W on P),
 *   dM (M on C). A planting cycle on A's farm in C.
 */

process.env.PAYMENT_ADAPTER = 'mock';
process.env.STRIPE_CHECKOUT_ENABLED = 'true';

const crypto = require('crypto');
const QT_COUNTER_KEY = 'COUNTER|QT-PRD numbers allocated by the doors';
const express = require('express');
const request = require('supertest');
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

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const actual = jest.requireActual('../../middleware/auth-middleware');
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const { activeEntityMiddleware } = jest.requireActual('../../middleware/active-entity-middleware');
    const bindTenant = tenantContextMiddleware();
    const bindEntity = activeEntityMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, () => bindEntity(req, res, next));
    };
    return { ...actual, authenticateAny: attach, authenticateHealth: attach, authenticateProvider: attach, authenticateToken: attach };
});
jest.mock('../../middleware/consent-manager', () => ({
    ...jest.requireActual('../../middleware/consent-manager'),
    requireConsent: (_req, _res, next) => next(),
}));
jest.mock('../../services/queue-service', () => ({
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-neutral' }) }),
    getPdfQueue: () => null,
}));
jest.mock('../../services/pdf/certificate-template-service', () => ({
    generateCertificatePdf: async () => Buffer.from('%PDF-1.4 certificate'),
}));
// The quotation renderer launches a headless browser; its bytes are not under test.
jest.mock('../../services/pdf/invoice-template-service', () => ({
    ...jest.requireActual('../../services/pdf/invoice-template-service'),
    generateQuotationPdf: async () => Buffer.from('%PDF-1.4 quotation'),
}));

const { ConsentCategory, ConsentVersions } = require('../../middleware/consent-manager');

const ACTORS = ['A', 'W', 'V', 'M', 'S', 'F', 'G', 'N'];
const HEADERS = ['none', 'P', 'C'];
const FILINGS = ['aC', 'aP', 'wP', 'mC', 'fC', 'gP', 'aN', 'nN'];
const DRAFTS = ['dC', 'dP', 'dW', 'dM', 'dF', 'dG', 'dN'];

// Captured from e46ceba0 (pre-R1) — see the header.
const EXPECTED = require('../fixtures/r1-cert-doc-finance-reads-neutral.expected.json');

d('R1 certificate / document / pre-check / finance health doors answer exactly as pre-R1 (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { users: {}, entities: {}, apps: {}, certs: {}, docs: {}, prechecks: {}, entityIds: [], userIds: [] };
    const label = new Map();

    const mkUser = async (name) => {
        const id = crypto.randomUUID();
        const canonicalId = `r1f-${name.toLowerCase()}-${sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `r1f-${name.toLowerCase()}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: name, organizationId: fx.org,
            },
        });
        await raw.userConsent.create({
            data: {
                userId: id, organizationId: fx.org, category: ConsentCategory.PAYMENT_TERMS,
                version: ConsentVersions.PAYMENT_TERMS, granted: true, grantedAt: new Date(),
            },
        });
        fx.userIds.push(id);
        fx.users[name] = { id, canonicalId };
    };
    const mkEntity = async (name, type) => {
        const row = await raw.entity.create({ data: { type, displayName: `r1f ${name} ${sfx}`, organizationId: fx.org } });
        fx.entityIds.push(row.id);
        fx.entities[name] = row.id;
    };
    const member = (user, entity, role, status = 'ACTIVE') => raw.entityMembership.create({
        data: { userId: fx.users[user].id, entityId: fx.entities[entity], role, status, organizationId: fx.org },
    });
    const mkApp = async (name, filer, entity, status) => {
        const row = await raw.application.create({
            data: {
                applicationNumber: `APP-R1F-${name}-${sfx}`, healthId: fx.users[filer].canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId: fx.entities[entity], submitterId: fx.users[filer].id, status,
                formData: { plantId: 'cannabis', steps: {}, workflowState: status },
            },
        });
        fx.apps[name] = row.id;
        label.set(row.id, name);
        return row;
    };

    const as = (name) => {
        const u = fx.users[name];
        mockActor.current = { id: u.id, canonicalId: u.canonicalId, healthId: u.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
    };
    const headerFor = (h) => (h === 'none' ? {} : { 'x-active-entity-id': fx.entities[h] });
    const labelOf = (id) => label.get(id) || 'NEW';
    const labels = (rows, key = 'id') => (Array.isArray(rows) ? rows.map((r) => labelOf(r[key])).sort().join(',') : '-');

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx.org = (await raw.organization.create({ data: { name: `r1f-${sfx}`, slug: `r1f-${sfx}`, code: `R1F_${sfx}`.toUpperCase() } })).id;
        for (const name of ACTORS) { await mkUser(name); }
        await mkEntity('P', 'INDIVIDUAL');
        await mkEntity('C', 'JURISTIC');
        for (const name of ['PW', 'PV', 'PM', 'PS']) { await mkEntity(name, 'INDIVIDUAL'); }
        await member('A', 'P', 'OWNER');
        await member('A', 'C', 'OWNER');
        await member('W', 'PW', 'OWNER');
        await member('W', 'P', 'MANAGER');
        await member('V', 'PV', 'OWNER');
        await member('V', 'C', 'VIEWER');
        await member('M', 'PM', 'OWNER');
        await member('M', 'C', 'MANAGER');
        await member('S', 'PS', 'OWNER');
        await mkEntity('PF', 'INDIVIDUAL');
        await member('F', 'PF', 'OWNER');
        await member('F', 'C', 'MANAGER', 'REVOKED');
        // G's personal entity is found by the national-id hash only — no membership row.
        const pg = await raw.entity.create({
            data: {
                type: 'INDIVIDUAL', displayName: `r1f PG ${sfx}`, organizationId: fx.org,
                thaiCitizenIdHash: crypto.createHash('sha256').update(fx.users.G.canonicalId).digest('hex'),
            },
        });
        fx.entityIds.push(pg.id);
        fx.entities.PG = pg.id;

        const farm = await raw.farm.create({
            data: {
                ownerId: fx.users.A.id, farmName: `ฟาร์ม r1f ${sfx}`, farmType: 'CULTIVATION', address: '1', province: 'สมุทรปราการ',
                district: 'บางพลี', subDistrict: 'บางพลีใหญ่', postalCode: '10540', totalArea: 1, cultivationArea: 1,
                cultivationMethod: 'OUTDOOR', organizationId: fx.org, entityId: fx.entities.C,
            },
        });
        fx.farm = farm.id;
        const species = await raw.plantSpecies.create({ data: { code: `R${sfx}`.slice(0, 8).toUpperCase(), nameTH: 'ทดสอบ', nameEN: 'test' } })
            .catch(() => raw.plantSpecies.create({ data: { code: `R${sfx}`.slice(0, 8).toUpperCase(), nameTH: 'ทดสอบ' } }));
        fx.species = species.id;
        fx.cycle = (await raw.plantingCycle.create({
            data: { cycleName: 'รอบที่ 1', farmId: farm.id, plantSpeciesId: species.id, startDate: new Date(), organizationId: fx.org },
        })).id;

        const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
        for (const [name, filer, entity] of [['aC', 'A', 'C'], ['aP', 'A', 'P'], ['wP', 'W', 'P'], ['mC', 'M', 'C'], ['fC', 'F', 'C'], ['gP', 'G', 'PG'],
            ['aN', 'A', null], ['nN', 'N', null]]) {
            const row = await mkApp(name, filer, entity, 'PENDING_DOC_FEE');
            await issueQuotationOnSubmit({ application: row, actorId: null });
            const cert = await raw.certificate.create({
                data: {
                    certificateNumber: `GACP-R1F-${name}-${sfx}`, verificationCode: `V-${name}-${sfx}`, qrData: 'qr',
                    applicationId: row.id, userId: fx.users[filer].id, farmId: farm.id, farmName: 'ฟาร์ม', applicantName: 'ทดสอบ',
                    cropType: 'cannabis', farmSize: 1, province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'บางพลีใหญ่',
                    standardId: 'std', standardName: 'GACP', expiryDate: new Date(Date.now() + 365 * 86400e3),
                    issuedBy: fx.users.A.id, status: 'active', organizationId: fx.org,
                    ...(await holderColumnsFor(raw, row.id)),
                },
            });
            fx.certs[name] = cert.id;
            label.set(cert.id, `cert-${name}`);
            const quote = await raw.quote.create({
                data: {
                    quoteNumber: `QT-R1F-${name}-${sfx}`, applicationId: row.id, subtotal: 100, totalAmount: 107,
                    validUntil: new Date(Date.now() + 7 * 86400e3), organizationId: fx.org,
                },
            });
            label.set(quote.id, `quote-${name}`);
            // water_test is a slot of every cannabis filing; juristic_reg_6m (a pre-check
            // catalogue slot) is a slot of the company's filings only.
            const doc = await raw.applicationDocument.create({
                data: {
                    applicationId: row.id, documentType: 'WATER_TEST', slotId: 'water_test', fileName: 'w.pdf',
                    fileUrl: `/uploads/r1f-${name}-water.pdf`, currentForSlot: 'WATER_TEST', documentId: `docw-${name}-${sfx}`,
                },
            });
            fx.docs[name] = doc.id;
            await raw.applicationDocument.create({
                data: {
                    applicationId: row.id, documentType: 'JURISTIC_REG_6M', slotId: 'juristic_reg_6m', fileName: 'j.pdf',
                    fileUrl: `/uploads/r1f-${name}-reg.pdf`, currentForSlot: 'JURISTIC_REG_6M', documentId: `docj-${name}-${sfx}`,
                },
            });
            const pc = await raw.documentPrecheck.create({
                data: {
                    applicationId: row.id, documentId: `docj-${name}-${sfx}`, slotId: 'juristic_reg_6m', status: 'DONE',
                    rulesVersion: 1, organizationId: fx.org,
                },
            });
            fx.prechecks[name] = pc.id;
        }
        for (const [name, filer, entity] of [['dC', 'A', 'C'], ['dP', 'A', 'P'], ['dW', 'W', 'P'], ['dM', 'M', 'C'], ['dF', 'F', 'C'], ['dG', 'G', 'PG'],
            ['dN', 'N', null]]) {
            await mkApp(name, filer, entity, 'DRAFT');
        }

        app = express();
        app.use(express.json());
        app.use('/api/applications/bundles', require('../../routes/api/applications/application-bundles'));
        app.use('/api/applications/:applicationId/quotations', require('../../routes/api/applications/quotations'));
        app.use('/api/applications', require('../../routes/api/applications/requirements'));
        app.use('/api/applications', require('../../routes/api/applications/applications'));
        app.use('/api/payments', require('../../routes/api/finance/payments'));
        app.use('/api/quotes', require('../../routes/api/finance/quotes'));
        app.use('/api/certificates', require('../../routes/api/certificates/certificates'));
        app.use('/api/report-submissions', require('../../routes/api/documents/report-submissions'));
        app.use('/api/planting-cycles', require('../../routes/api/cultivation/planting-cycles'));
    });

    afterAll(async () => {
        if (!raw) { return; }
        const appIds = (await raw.application.findMany({ where: { organizationId: fx.org }, select: { id: true } })).map((r) => r.id);
        // Never delete with an undefined key: Prisma drops it and the filter matches every row.
        const wipe = async (model, where) => {
            if (!raw[model] || Object.values(where).some((v) => v === undefined || v === null)) { return; }
            await raw[model].deleteMany({ where }).catch(() => {});
        };
        await wipe('cultivationLog', { cycleId: fx.cycle });
        await wipe('plantingCycle', { id: fx.cycle });
        await wipe('reportSubmission', { userId: { in: fx.userIds } });
        await wipe('certificate', { applicationId: { in: appIds } });
        await wipe('farm', { id: fx.farm });
        await wipe('plantSpecies', { id: fx.species });
        const orders = await raw.checkoutOrder.findMany({ where: { applicationId: { in: appIds } } }).catch(() => []);
        await wipe('checkoutOrder', { applicationId: { in: appIds } });
        await wipe('invoiceLineItem', { invoiceId: { in: orders.map((o) => o.invoiceId).filter(Boolean) } });
        for (const model of ['paymentTransaction', 'invoice', 'quote', 'quotation', 'documentPrecheck', 'applicationDocumentReview',
            'applicationDocument', 'workActivity', 'applicationComment']) {
            await wipe(model, { applicationId: { in: appIds } });
        }
        await raw.application.updateMany({ where: { id: { in: appIds } }, data: { bundleId: null } }).catch(() => {});
        await wipe('applicationBundle', { healthId: { in: Object.values(fx.users).map((u) => u.canonicalId) } });
        await wipe('auditLog', { resourceId: { in: appIds } });
        await wipe('application', { id: { in: appIds } });
        await wipe('userConsent', { userId: { in: fx.userIds } });
        await wipe('entityMembership', { entityId: { in: fx.entityIds } });
        await wipe('entity', { id: { in: fx.entityIds } });
        await wipe('user', { id: { in: fx.userIds } });
        await wipe('organization', { id: fx.org });
        await raw.$disconnect();
    });

    const actual = {};
    const record = (key, value) => { actual[key] = value; };
    const qtCounter = async () => {
        const rows = await raw.receiptSequence.findMany({ where: { prefix: 'QT-PRD' }, select: { counter: true } });
        return rows.reduce((sum, row) => sum + Number(row.counter || 0), 0);
    };
    let qtBefore = null;
    const pick = (prefixRe) => Object.fromEntries(Object.entries(actual).filter(([k]) => prefixRe.test(k)));
    const pickExpected = (prefixRe) => Object.fromEntries(Object.entries(EXPECTED).filter(([k]) => prefixRe.test(k)));

    test('read doors: certificates, report schedule, quotes, quotations (+pdf), requirements', async () => {
        qtBefore = await qtCounter();
        for (const actor of ACTORS) {
            for (const h of HEADERS) {
                as(actor);
                const hdr = headerFor(h);
                const all = await request(app).get('/api/certificates').set(hdr);
                record(`${actor}|${h}|GET /certificates`, `${all.status} ${labels(all.body?.data)}`);
                const my = await request(app).get('/api/certificates/my').set(hdr);
                record(`${actor}|${h}|GET /certificates/my`, `${my.status} ${labels(my.body?.data)}`);
                const sched = await request(app).get('/api/report-submissions/schedule').set(hdr);
                record(`${actor}|${h}|GET /report-submissions/schedule`, `${sched.status} ${labels(sched.body?.data?.certificates)}`);
                const quotes = await request(app).get('/api/quotes/my').set(hdr);
                record(`${actor}|${h}|GET /quotes/my`, `${quotes.status} ${labels(quotes.body?.data)}`);
                for (const target of FILINGS) {
                    const certId = fx.certs[target];
                    const one = await request(app).get(`/api/certificates/${certId}`).set(hdr);
                    record(`${actor}|${h}|GET /certificates/:id|${target}`, `${one.status} ${one.body?.data?.id ? labelOf(one.body.data.id) : '-'}`);
                    const dl = await request(app).get(`/api/certificates/${certId}/download`).set(hdr);
                    record(`${actor}|${h}|GET /certificates/:id/download|${target}`, `${dl.status}`);
                    const appId = fx.apps[target];
                    const qt = await request(app).get(`/api/applications/${appId}/quotations`).set(hdr);
                    record(`${actor}|${h}|GET /:id/quotations|${target}`, `${qt.status} ${qt.body?.data?.platform ? 'row' : '-'}`);
                    const pdf = await request(app).get(`/api/applications/${appId}/quotations/PLATFORM/pdf`).set(hdr);
                    record(`${actor}|${h}|GET /:id/quotations/PLATFORM/pdf|${target}`, `${pdf.status}`);
                    const reqs = await request(app).get(`/api/applications/${appId}/requirements`).set(hdr);
                    const slots = Array.isArray(reqs.body?.data?.slots) ? reqs.body.data.slots : [];
                    const docs = (JSON.stringify(reqs.body?.data ?? null).match(/uploads\/r1f-/g) || []).length;
                    record(`${actor}|${h}|GET /:id/requirements|${target}`,
                        `${reqs.status} docs=${docs} prechecks=${slots.filter((s) => s.precheck).length}`);
                }
            }
        }
        expect(pick(/\|GET /)).toEqual(pickExpected(/\|GET /));
    });

    test('write doors: report submission, pre-check acknowledge, quotation accept, checkout, submit, bundles, planting attachments', async () => {
        let n = 0;
        // Non-filers first, A last, so a write by A cannot change what another actor sees.
        for (const actor of ['W', 'V', 'M', 'S', 'F', 'G', 'A']) {
            for (const h of HEADERS) {
                as(actor);
                const hdr = headerFor(h);
                for (const target of FILINGS) {
                    n += 1;
                    const rep = await request(app).post('/api/report-submissions').set(hdr).send({
                        certificateId: fx.certs[target], reportType: 'PT27', reportMonth: 1 + (n % 12), reportYear: 2500 + n,
                    });
                    record(`${actor}|${h}|POST /report-submissions|${target}`, `${rep.status}`);
                    const ack = await request(app)
                        .post(`/api/applications/${fx.apps[target]}/prechecks/${fx.prechecks[target]}/acknowledge`).set(hdr).send({});
                    record(`${actor}|${h}|POST /:id/prechecks/:pid/acknowledge|${target}`, `${ack.status}`);
                    const acc = await request(app).post(`/api/applications/${fx.apps[target]}/quotations/PLATFORM/accept`).set(hdr).send({});
                    record(`${actor}|${h}|POST /:id/quotations/PLATFORM/accept|${target}`, `${acc.status}`);
                    const pay = await request(app).post('/api/payments/checkout').set(hdr).send({ applicationId: fx.apps[target], milestone: 'M1' });
                    record(`${actor}|${h}|POST /payments/checkout|${target}`, `${pay.status} ${pay.body?.error || ''}`.trim());
                    const act = await request(app).post(`/api/planting-cycles/${fx.cycle}/activities`).set(hdr)
                        .send({ scope: 'CYCLE', activityType: 'IRRIGATION', attachmentIds: [fx.docs[target]] });
                    record(`${actor}|${h}|POST /planting-cycles/:id/activities|${target}`, `${act.status}`);
                }
                if (actor !== 'A') {
                    for (const target of DRAFTS) {
                        const sub = await request(app).post('/api/applications/submit').set(hdr)
                            .send({ applicationId: fx.apps[target], declarationsAccepted: true });
                        record(`${actor}|${h}|POST /submit|${target}`, `${sub.status}`);
                    }
                }
                const bundle = await request(app).post('/api/applications/bundles').set(hdr)
                    .send({ applications: DRAFTS.map((t) => fx.apps[t]) });
                const linked = await raw.application.findMany({
                    where: { id: { in: DRAFTS.map((t) => fx.apps[t]) }, bundleId: { not: null } }, select: { id: true },
                });
                record(`${actor}|${h}|POST /bundles`, `${bundle.status} ${labels(linked)}`);
                await raw.application.updateMany({ where: { id: { in: DRAFTS.map((t) => fx.apps[t]) } }, data: { bundleId: null } });
            }
        }
        expect(pick(/\|POST /)).toEqual(pickExpected(/\|POST /));
    });

    test('the doors allocate exactly as many QT-PRD quotation numbers as pre-R1 did', async () => {
        // A self-heal that cannot see a live quotation issues another one and burns
        // numbers (reviewer, Task 4 fix round 1). The suite runs -i, so nothing else
        // allocates from this counter in between.
        record(QT_COUNTER_KEY, `${(await qtCounter()) - qtBefore}`);
        expect(actual[QT_COUNTER_KEY]).toBe(EXPECTED[QT_COUNTER_KEY]);
    });

    afterAll(() => {
        if (process.env.R1_NEUTRAL_RECORD) {
            require('fs').writeFileSync(process.env.R1_NEUTRAL_RECORD, `${JSON.stringify(actual, Object.keys(actual).sort(), 2)}\n`);
        }
    });
});
