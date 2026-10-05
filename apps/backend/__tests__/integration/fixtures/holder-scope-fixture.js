'use strict';

/**
 * The spec §4 holder-scope fixture (2026-09-30-remove-workspace-mode, Task 6),
 * seeded on a REAL Postgres through a RAW PrismaClient (ground truth, no
 * tenant/soft-delete extensions). Task 6's door walk uses it; Task 12 reuses it.
 *
 *   organization  one, shared by every row
 *   company C     A OWNER, B MANAGER, V VIEWER, O2 OWNER
 *   personal PA   A OWNER (A's personal entity)
 *   personal PS   S OWNER (the stranger's personal entity)
 *   staff F       document_reviewer, no membership
 *   X             held by C, filed by A, CERTIFIED: invoice (paid, receipt issued),
 *                 certificate, quotation, quote, checkout order, document, pre-check,
 *                 revision deadline; its farm (held by C) has a plot, a planting
 *                 cycle, a harvest batch and a lot
 *   D             draft held by C, created by A
 *   D2            a second draft of C, created by A (O2's delete case)
 *   Y             held by PA, filed by A
 *
 * Tokens are REAL access tokens minted by config/jwt-security (the same signer
 * the login doors use), so a test drives the real authenticateHealth /
 * authenticateAny middlewares, which bind the tenant and active-entity context.
 *
 * @param {import('@prisma/client').PrismaClient} prisma raw client
 * @returns {Promise<object>} { orgId, users:{A,B,V,S,F,O2}, entities:{C,PA,PS},
 *   apps:{X,D,Y,D2}, invoiceX, receiptX, certX, tokens:{A,B,V,S,F,O2}, more:{…} }
 */

const crypto = require('crypto');

async function seedHolderScopeFixture(prisma) {
    const partial = {};
    try {
        return await seed(prisma, partial);
    } catch (error) {
        // A half-seeded fixture must not outlive the failure (it would break
        // invariant suites that count rows across the whole database).
        await cleanupHolderScopeFixture(prisma, partial).catch(() => {});
        throw error;
    }
}

async function seed(prisma, partial) {
    const jwtConfig = require('../../../config/jwt-security');
    const sfx = crypto.randomUUID().slice(0, 8);
    const org = await prisma.organization.create({
        data: { name: `hs-${sfx}`, slug: `hs-${sfx}`, code: `HS_${sfx}`.toUpperCase() },
    });
    const orgId = org.id;
    partial.orgId = orgId;

    const users = {};
    partial.users = users;
    const mkUser = async (key, role = 'health') => {
        const id = crypto.randomUUID();
        const canonicalId = `hs-${key.toLowerCase()}-${sfx}`;
        await prisma.user.create({
            data: {
                id, canonicalId, healthId: role === 'health' ? canonicalId : null, password: 'x', role,
                authType: 'EMAIL_LEGACY', email: `hs-${key.toLowerCase()}-${sfx}@example.test`,
                firstName: 'ทดสอบ', lastName: key, organizationId: orgId, status: 'ACTIVE',
            },
        });
        users[key] = { id, canonicalId, role };
    };
    for (const key of ['A', 'B', 'V', 'S', 'O2']) { await mkUser(key); }
    await mkUser('F', 'document_reviewer');

    const entities = {};
    partial.entities = entities;
    const mkEntity = async (key, type, displayName, createdBy) => {
        const row = await prisma.entity.create({ data: { type, displayName, organizationId: orgId, createdBy } });
        entities[key] = row.id;
    };
    await mkEntity('C', 'JURISTIC', `บริษัท โฮลเดอร์ ${sfx} จำกัด`, users.A.id);
    await mkEntity('PA', 'INDIVIDUAL', `ทดสอบ A ${sfx}`, users.A.id);
    await mkEntity('PS', 'INDIVIDUAL', `ทดสอบ S ${sfx}`, users.S.id);
    const memberships = [
        ['A', 'C', 'OWNER'], ['B', 'C', 'MANAGER'], ['V', 'C', 'VIEWER'], ['O2', 'C', 'OWNER'],
        ['A', 'PA', 'OWNER'], ['S', 'PS', 'OWNER'],
    ];
    for (const [u, e, role] of memberships) {
        await prisma.entityMembership.create({
            data: { userId: users[u].id, entityId: entities[e], role, status: 'ACTIVE', organizationId: orgId },
        });
    }

    const apps = {};
    const mkApp = async (key, entity, status, extra = {}) => {
        const row = await prisma.application.create({
            data: {
                applicationNumber: `APP-HS-${key}-${sfx}`, healthId: users.A.canonicalId, areaType: 'OUTDOOR',
                organizationId: orgId, entityId: entities[entity], submitterId: users.A.id, status,
                formData: { plantId: 'cannabis', workflowState: status }, ...extra,
            },
        });
        apps[key] = row.id;
    };
    await mkApp('X', 'C', 'CERTIFIED');
    // D carries one draft document (GET /documents and /documents/:id read
    // formData.draftDocuments of the caller's filings).
    const draftDocId = `draft-doc-hs-${sfx}`;
    await mkApp('D', 'C', 'DRAFT', {
        formData: {
            plantId: 'cannabis', workflowState: 'DRAFT',
            draftDocuments: [{ documentId: draftDocId, fileName: 'land.pdf', fileUrl: '/uploads/hs-land.pdf', stepKey: 'land_rights' }],
        },
    });
    await mkApp('D2', 'C', 'DRAFT');
    await mkApp('Y', 'PA', 'SUBMITTED');

    const more = { draftDoc: draftDocId };
    partial.more = more;
    more.farm = (await prisma.farm.create({
        data: {
            ownerId: users.A.id, entityId: entities.C, organizationId: orgId, farmName: `ฟาร์มโฮลเดอร์ ${sfx}`,
            farmType: 'CULTIVATION', address: '1 หมู่ 1', province: 'สมุทรปราการ', district: 'บางพลี',
            subDistrict: 'บางพลีใหญ่', postalCode: '10540', totalArea: 5, cultivationArea: 3,
            cultivationMethod: 'OUTDOOR', status: 'ACTIVE',
        },
    })).id;
    more.plot = (await prisma.plot.create({
        data: {
            farmId: more.farm, name: 'แปลงที่ 1', areaSqm: 400, area: 400, areaUnit: 'sqm', solarSystem: 'OUTDOOR',
            organizationId: orgId,
        },
    })).id;
    const speciesCode = `H${sfx}`.slice(0, 8).toUpperCase();
    more.species = (await prisma.plantSpecies.create({ data: { code: speciesCode, nameTH: 'ทดสอบโฮลเดอร์' } })).id;
    more.cycle = (await prisma.plantingCycle.create({
        data: {
            farmId: more.farm, plantSpeciesId: more.species, organizationId: orgId, cycleName: 'รอบที่ 1',
            startDate: new Date('2026-01-01'), status: 'HARVESTED', cultivationType: 'OUTDOOR',
        },
    })).id;
    more.batch = (await prisma.harvestBatch.create({
        data: {
            farmId: more.farm, cycleId: more.cycle, organizationId: orgId, batchNumber: `HB-HS-${sfx}`,
            harvestDate: new Date('2026-06-01'), freshWeight: 10, dryWeight: 3, plantCode: speciesCode, status: 'HARVESTED',
        },
    })).id;
    more.lot = (await prisma.lot.create({
        data: {
            batchId: more.batch, organizationId: orgId, lotNumber: `LOT-HS-${sfx}`, packageType: 'BAG',
            quantity: 1, unitWeight: 1, totalWeight: 1, qrCode: `qr-hs-${sfx}`, status: 'PACKAGED',
        },
    })).id;

    const certX = (await prisma.certificate.create({
        data: {
            certificateNumber: `GACP-HS-${sfx}`, verificationCode: `V-HS-${sfx}`, qrData: 'qr', applicationId: apps.X,
            userId: users.A.id, farmId: more.farm, farmName: 'ฟาร์มโฮลเดอร์', applicantName: 'ทดสอบ', cropType: 'cannabis',
            farmSize: 1, province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'บางพลีใหญ่', standardId: 'std',
            standardName: 'GACP', expiryDate: new Date(Date.now() + 365 * 86400e3), issuedBy: users.F.id,
            status: 'active', organizationId: orgId,
            holderType: 'JURISTIC', holderDisplayName: `บริษัท โฮลเดอร์ ${sfx} จำกัด`, submittedByUserId: users.A.id,
        },
    })).id;
    const receiptNumber = `TAX-HS-RCPT-${sfx}`;
    const invoiceX = (await prisma.invoice.create({
        data: {
            invoiceNumber: `INV-HS-X-${sfx}`, applicationId: apps.X, healthId: users.A.canonicalId,
            serviceType: 'CERTIFICATION_CHECKOUT_M1', subtotal: 5500, vat: 385, totalAmount: 5885,
            dueDate: new Date('2026-10-08T00:00:00Z'), organizationId: orgId, status: 'RECEIPT_ISSUED',
            paidAt: new Date('2026-09-29T08:14:45Z'), receiptNumber, receiptIssuedAt: new Date('2026-09-29T08:14:45Z'),
            receiptIssuedBy: 'stripe-webhook', receiptStatus: 'ISSUED', paymentMethod: 'PromptPay',
        },
    })).id;
    more.quotation = (await prisma.quotation.create({
        data: {
            applicationId: apps.X, issuerType: 'PLATFORM', quotationNumber: `QT-HS-X-${sfx}`, subtotal: 5500, vat: 385,
            totalAmount: 5885, installments: [{ phase: 'PHASE_1', amount: 5885 }], status: 'ACCEPTED',
            validUntil: new Date(Date.now() + 7 * 86400e3), organizationId: orgId,
        },
    })).id;
    more.quote = (await prisma.quote.create({
        data: {
            quoteNumber: `QT-HS-Q-${sfx}`, applicationId: apps.X, subtotal: 100, totalAmount: 107,
            validUntil: new Date(Date.now() + 7 * 86400e3), organizationId: orgId,
        },
    })).id;
    more.order = (await prisma.checkoutOrder.create({
        data: {
            // main 34290b86 dropped dtamPayableAmount: the order is the platform fee alone.
            applicationId: apps.X, milestone: 'M1', status: 'SETTLED', organizationId: orgId,
            platformFeeNet: 5500, platformFeeVat: 385, platformFeeGross: 5885, totalPayableAmount: 5885,
            quotationId: more.quotation, invoiceId: invoiceX,
        },
    })).id;
    more.document = (await prisma.applicationDocument.create({
        data: {
            applicationId: apps.X, documentType: 'LAND_RIGHTS', slotId: 'land_rights', fileName: 'land.pdf',
            fileUrl: '/uploads/hs-land.pdf', currentForSlot: 'land_rights',
        },
    })).id;
    more.precheck = (await prisma.documentPrecheck.create({
        data: {
            applicationId: apps.X, documentId: `doc-hs-${sfx}`, slotId: 'land_rights', status: 'DONE', rulesVersion: 1,
            organizationId: orgId,
        },
    })).id;

    // Rows the by-id doors read, so the owner reaches each door's reads (Task 6
    // fix round 1, I2): a door that answers nobody proves nothing about a stranger.
    more.revisionDeadline = (await prisma.revisionDeadline.create({
        data: { applicationId: apps.X, revisionDue: new Date(Date.now() + 5 * 86400e3), organizationId: orgId },
    })).id;
    more.bundle = (await prisma.applicationBundle.create({
        data: { bundleNumber: `BND-HS-${sfx}`, healthId: users.A.canonicalId, organizationId: orgId },
    })).id;
    more.ticket = (await prisma.ticket.create({
        data: { organizationId: orgId, creatorId: users.A.id, title: 'คำถามเรื่องคำขอ', relatedApplication: apps.X },
    })).id;
    more.siteAnalysis = (await prisma.siteAnalysis.create({
        data: { farmId: more.farm, analysisType: 'INITIAL', organizationId: orgId },
    })).id;
    more.training = (await prisma.trainingRecord.create({
        data: {
            farmId: more.farm, personName: 'ทดสอบ อบรม', trainingTopic: 'GACP เบื้องต้น', trainingType: 'GACP_BASIC',
            trainingDate: new Date('2026-08-01'), organizationId: orgId,
        },
    })).id;
    more.sop = (await prisma.sOPDocument.create({
        data: { userId: users.A.id, sopType: 'cultivation', title: 'SOP การปลูก', organizationId: orgId },
    })).id;
    more.report = (await prisma.reportSubmission.create({
        data: {
            certificateId: certX, userId: users.A.id, reportType: 'PT27', reportMonth: 1, reportYear: 2569,
            formData: {}, organizationId: orgId,
        },
    })).id;
    more.cultivationLog = (await prisma.cultivationLog.create({
        data: { cycleId: more.cycle, logType: 'IRRIGATION', organizationId: orgId },
    })).id;
    more.templateCode = `HS_TPL_${sfx}`.toUpperCase();
    more.template = (await prisma.documentTemplate.create({
        data: { code: more.templateCode, titleTH: 'แบบทดสอบ', htmlTemplate: '<p>{{NAME}}</p>', status: 'ACTIVE' },
    })).id;
    more.standardCode = `HS_STD_${sfx}`.toUpperCase();
    more.standard = (await prisma.certificationStandard.create({
        data: { code: more.standardCode, name: 'Walk standard', nameTH: 'มาตรฐานทดสอบ' },
    })).id;

    const tokens = {};
    for (const [key, u] of Object.entries(users)) {
        const health = u.role === 'health';
        tokens[key] = jwtConfig.generateToken(
            { id: u.id, userId: u.id, role: u.role, canonicalRole: u.role },
            health ? 'public' : 'provider',
        );
    }

    return {
        sfx, orgId, users, entities, apps, invoiceX, receiptX: { invoiceId: invoiceX, receiptNumber }, certX, tokens, more,
    };
}

/**
 * Remove every row seedHolderScopeFixture wrote, plus the rows the doors may
 * have written for its applications. Never deletes with an undefined key.
 * @param {import('@prisma/client').PrismaClient} prisma raw client
 * @param {object} fx the seed result
 */
async function cleanupHolderScopeFixture(prisma, fx) {
    if (!prisma || !fx || !fx.orgId) { return; }
    const wipe = async (model, where) => {
        if (!prisma[model] || Object.values(where).some((v) => v === undefined || v === null)) { return; }
        await prisma[model].deleteMany({ where }).catch(() => {});
    };
    const appIds = (await prisma.application.findMany({ where: { organizationId: fx.orgId }, select: { id: true } }))
        .map((r) => r.id);
    const userIds = Object.values(fx.users || {}).map((u) => u.id);
    const entityIds = Object.values(fx.entities || {});
    await wipe('reportSubmission', { userId: { in: userIds } });
    await wipe('sOPDocument', { userId: { in: userIds } });
    await wipe('ticket', { creatorId: { in: userIds } });
    await wipe('siteAnalysis', { organizationId: fx.orgId });
    await wipe('trainingRecord', { organizationId: fx.orgId });
    await wipe('documentTemplate', { id: fx.more?.template });
    await wipe('certificationStandard', { id: fx.more?.standard });
    await wipe('certificate', { applicationId: { in: appIds } });
    await wipe('lot', { organizationId: fx.orgId });
    await wipe('harvestBatch', { organizationId: fx.orgId });
    await wipe('cultivationLog', { cycleId: fx.more?.cycle });
    await wipe('plantingCycle', { organizationId: fx.orgId });
    await wipe('plot', { organizationId: fx.orgId });
    await wipe('checkoutDocument', { organizationId: fx.orgId });
    await wipe('checkoutOrder', { applicationId: { in: appIds } });
    const invoiceIds = (await prisma.invoice.findMany({ where: { applicationId: { in: appIds } }, select: { id: true } })
        .catch(() => [])).map((r) => r.id);
    await wipe('invoiceLineItem', { invoiceId: { in: invoiceIds } });
    for (const model of ['paymentTransaction', 'invoice', 'quotation', 'quote', 'documentPrecheck', 'applicationDocumentReview',
        'applicationDocument', 'revisionDeadline', 'workActivity', 'applicationComment', 'correctionSubmissionVersion',
        'correctionRound']) {
        await wipe(model, { applicationId: { in: appIds } });
    }
    await prisma.application.updateMany({ where: { id: { in: appIds } }, data: { bundleId: null } }).catch(() => {});
    await wipe('applicationBundle', { healthId: fx.users?.A?.canonicalId });
    await wipe('auditLog', { resourceId: { in: appIds } });
    await wipe('application', { id: { in: appIds } });
    await wipe('farm', { organizationId: fx.orgId });
    await wipe('plantSpecies', { id: fx.more?.species });
    await wipe('userConsent', { userId: { in: userIds } });
    await wipe('entityMembership', { entityId: { in: entityIds } });
    await wipe('entity', { id: { in: entityIds } });
    await wipe('notification', { userId: { in: userIds } });
    await wipe('user', { id: { in: userIds } });
    await wipe('organization', { id: fx.orgId });
}

module.exports = { seedHolderScopeFixture, cleanupHolderScopeFixture };
