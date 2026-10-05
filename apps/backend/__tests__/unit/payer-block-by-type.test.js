'use strict';

/**
 * Payer block by Entity.type — operator rule 2026-09-27 ("อนุมัติ").
 *
 *   INDIVIDUAL            ชื่อ-นามสกุล       · the national ID is NEVER printed (full or partial) — "-"
 *   JURISTIC              ชื่อบริษัท         · เลขประจำตัวผู้เสียภาษี = Entity.juristicId (checksum-guarded)
 *   COMMUNITY_ENTERPRISE  ชื่อวิสาหกิจชุมชน  · เลขทะเบียนวิสาหกิจชุมชน = Entity.communityRegNo
 *                                              (the tax invoice's buyer tax id prints "-")
 *
 * ONE source: utils/applicant-resolver.js. Every renderer (the six finance
 * documents and the web quotation step, through the quotation API) consumes
 * it. This file pins the resolver, the credit/debit-note context, the
 * quotation API's `payer` + `signatory`, and that no second copy of the
 * labels exists in the renderers. The real-render proof on Postgres is
 * __tests__/integration/payer-block-matrix.test.js.
 *
 * Fixture ids are synthetic, checksum-valid, never a real person/company.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const NATIONAL_ID = '1100000000008'; // synthetic, checksum-valid, starts 1 = person
const JURISTIC_ID = '0105561234560'; // synthetic, checksum-valid, starts 0 = company
const COMMUNITY_REG_NO = '58012345678'; // DOAE 11 digits

// Every printed/serialised form a national ID could take: raw, Thai digits,
// Thai 1-4-5-2-1 grouping, ASCII grouping, and the last-4 tail.
const NATIONAL_ID_FORMS = [
    NATIONAL_ID,
    '๑๑๐๐๐๐๐๐๐๐๐๐๘',
    '๑-๑๐๐๐-๐๐๐๐๐-๐๐-๘',
    '1-1000-00000-00-8',
];

function expectNoNationalId(value) {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    for (const form of NATIONAL_ID_FORMS) { expect(s).not.toContain(form); }
}

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

const resolver = require('../../utils/applicant-resolver');

const ENTITIES = {
    INDIVIDUAL: { id: 'e-1', type: 'INDIVIDUAL', displayName: 'สมชาย ทดสอบ', thaiCitizenId: NATIONAL_ID },
    JURISTIC: { id: 'e-2', type: 'JURISTIC', displayName: 'บริษัท ทดสอบ จำกัด', juristicId: JURISTIC_ID },
    COMMUNITY_ENTERPRISE: {
        id: 'e-3', type: 'COMMUNITY_ENTERPRISE', displayName: 'วิสาหกิจชุมชนทดสอบ', communityRegNo: COMMUNITY_REG_NO,
    },
};

describe('applicant-resolver — the one source of the payer block', () => {
    test('PAYER_ENTITY_SELECT carries what the resolver needs and never thaiCitizenId', () => {
        expect(resolver.PAYER_ENTITY_SELECT).toEqual({
            id: true, type: true, displayName: true, juristicId: true, communityRegNo: true,
        });
        expect(resolver.PAYER_APPLICATION_SELECT).toEqual({
            formData: true, entity: { select: resolver.PAYER_ENTITY_SELECT },
        });
    });

    test.each([
        ['INDIVIDUAL', 'ชื่อ-นามสกุล', 'Name', 'เลขประจำตัวประชาชน', 'ID No.', '-', '-'],
        ['JURISTIC', 'ชื่อบริษัท', 'Company Name', 'เลขประจำตัวผู้เสียภาษี', 'Tax ID', JURISTIC_ID, JURISTIC_ID],
        ['COMMUNITY_ENTERPRISE', 'ชื่อวิสาหกิจชุมชน', 'Community Enterprise Name',
            'เลขทะเบียนวิสาหกิจชุมชน', 'Registration No.', COMMUNITY_REG_NO, '-'],
    ])('%s — labels + printed id by type', (type, nameTh, nameEn, idTh, idEn, idPrinted, buyerTaxId) => {
        const out = resolver.resolveApplicantInfo({ entity: ENTITIES[type], formData: {} });
        expect(out.entityType).toBe(type);
        expect(out.name).toBe(ENTITIES[type].displayName);
        expect(out.nameLabel).toBe(nameTh);
        expect(out.nameLabelBilingual).toBe(`${nameTh} / ${nameEn}`);
        expect(out.idLabel).toBe(idTh);
        expect(out.idLabelBilingual).toBe(`${idTh} / ${idEn}`);
        expect(out.idPrinted).toBe(idPrinted);
        expect(out.buyerTaxIdPrinted).toBe(buyerTaxId);
    });

    test('INDIVIDUAL entity carrying thaiCitizenId: the ID reaches no field of the result', () => {
        const out = resolver.resolveApplicantInfo({ entity: ENTITIES.INDIVIDUAL, formData: {} });
        expect(out.id).toBe('-');
        expectNoNationalId(out);
    });

    test('no-entity fallback never returns a national ID (applicant.nationalId, person.idCard, person.nationalId)', () => {
        const out = resolver.resolveApplicantInfo({
            applicant: { firstName: 'A', lastName: 'B', nationalId: NATIONAL_ID, taxId: NATIONAL_ID },
            formData: { applicantType: 'INDIVIDUAL', applicantData: { idCard: NATIONAL_ID, nationalId: NATIONAL_ID } },
        });
        expect(out.name).toBe('A B');
        expect(out.idPrinted).toBe('-');
        expectNoNationalId(out);
    });

    test('no-entity fallback with no type signal at all is treated as a person — still no ID', () => {
        const out = resolver.resolveApplicantInfo({
            formData: { applicantData: { firstName: 'ก', lastName: 'ข', idCard: NATIONAL_ID } },
        });
        expect(out.nameLabel).toBe('ชื่อ-นามสกุล');
        expectNoNationalId(out);
    });

    test('no-entity JURISTIC fallback: a national ID under taxId is not a printable tax id', () => {
        const out = resolver.resolveApplicantInfo({
            formData: { applicantType: 'JURISTIC', applicantData: { companyName: 'X', taxId: NATIONAL_ID } },
        });
        expect(out.idPrinted).toBe('-');
        expect(out.buyerTaxIdPrinted).toBe('-');
    });

    test('no-entity COMMUNITY fallback reads the keys the wizard writes (communityName, communityRegistrationNo)', () => {
        const out = resolver.resolveApplicantInfo({
            formData: {
                applicantType: 'COMMUNITY',
                applicantData: {
                    communityName: 'วิสาหกิจชุมชนจากวิซาร์ด',
                    communityRegistrationNo: COMMUNITY_REG_NO,
                    presidentIdCard: NATIONAL_ID,
                },
            },
        });
        expect(out.name).toBe('วิสาหกิจชุมชนจากวิซาร์ด');
        expect(out.idPrinted).toBe(COMMUNITY_REG_NO);
        expect(out.nameLabel).toBe('ชื่อวิสาหกิจชุมชน');
        expectNoNationalId(out);
    });

    // Fix round 1, M1 — `id` is the printed value, never a raw one that skipped
    // the printable check: a person's own national ID typed into the juristic
    // taxId field of a no-entity row reaches neither field.
    test('no-entity JURISTIC: a national-ID-shaped person.taxId → id and idPrinted both "-"', () => {
        const out = resolver.resolveApplicantInfo({
            applicant: { taxId: NATIONAL_ID, companyRegistrationNumber: NATIONAL_ID },
            formData: { applicantType: 'JURISTIC', applicantData: { companyName: 'X', taxId: NATIONAL_ID } },
        });
        expect(out.id).toBe('-');
        expect(out.idPrinted).toBe('-');
        expectNoNationalId(out);
    });

    test('`id` always equals `idPrinted` (JURISTIC entity with a checksum-invalid id)', () => {
        const out = resolver.resolveApplicantInfo({
            entity: { ...ENTITIES.JURISTIC, juristicId: '0105561234561' },
            formData: {},
        });
        expect(out.idPrinted).toBe('-');
        expect(out.id).toBe(out.idPrinted);
    });

    // Fix round 1, M2 — the key applicant-validation.js:66 and entity-service.js:1715 use.
    test('no-entity COMMUNITY fallback also reads communityRegNumber', () => {
        const out = resolver.resolveApplicantInfo({
            formData: {
                applicantType: 'COMMUNITY_ENTERPRISE',
                applicantData: { communityName: 'วิสาหกิจชุมชนทดสอบ', communityRegNumber: COMMUNITY_REG_NO },
            },
        });
        expect(out.idPrinted).toBe(COMMUNITY_REG_NO);
        expect(out.id).toBe(COMMUNITY_REG_NO);
    });

    test('contact phone and name come from formData.applicantData (the only place the wizard writes them)', () => {
        const out = resolver.resolveApplicantInfo({
            applicant: { phoneNumber: '0800000000' },
            entity: ENTITIES.JURISTIC,
            formData: { applicantData: { phone: '0822220002', contactName: 'คุณประสาน' } },
        });
        expect(out.contactPhone).toBe('0822220002');
        expect(out.contactName).toBe('คุณประสาน');
    });

    test('payerBlockForApi — the shape the web renders, and nothing else', () => {
        const block = resolver.payerBlockForApi({
            entity: ENTITIES.INDIVIDUAL,
            formData: { applicantData: { idCard: NATIONAL_ID, phone: '0811110001', address: '1 ม.1' } },
        });
        expect(block).toEqual({
            type: 'INDIVIDUAL',
            nameLabel: 'ชื่อ-นามสกุล',
            name: 'สมชาย ทดสอบ',
            idLabel: 'เลขประจำตัวประชาชน',
            idPrinted: '-',
            address: '1 ม.1',
            contactName: 'สมชาย ทดสอบ',
            phone: '0811110001',
        });
        expectNoNationalId(block);
    });
});

describe('credit/debit note — payer from the ORIGINAL invoice entity, through the resolver', () => {
    const { buildAdjustmentNoteContext } = require('../../services/pdf/invoice-template-service');
    const META = { docNumber: 'CN-T-1', docTypeTh: 'ใบลดหนี้', docTypeEn: 'CREDIT NOTE' };
    const note = (entity) => ({
        creditNoteNumber: 'CN-T-1',
        subtotal: 100, vat: 7, totalAmount: 107,
        reason: 'ทดสอบ',
        originalInvoice: {
            invoiceNumber: 'INV-T-1', serviceType: 'PHASE_1_PLATFORM_FEE',
            // The snapshot column no writer populates — must not be the source.
            billingName: null, billingAddress: null,
            application: { entity, formData: { applicantData: { address: '9 ถนนทดสอบ' } } },
        },
    });

    test.each([
        ['INDIVIDUAL', 'ชื่อ-นามสกุล / Name', 'เลขประจำตัวประชาชน / ID No.', '-'],
        ['JURISTIC', 'ชื่อบริษัท / Company Name', 'เลขประจำตัวผู้เสียภาษี / Tax ID', '๐-๑๐๕๕-๖๑๒๓๔-๕๖-๐'],
        ['COMMUNITY_ENTERPRISE', 'ชื่อวิสาหกิจชุมชน / Community Enterprise Name',
            'เลขทะเบียนวิสาหกิจชุมชน / Registration No.', '๕๘๐๑๒๓๔๕๖๗๘'],
    ])('%s', (type, nameLabel, idLabel, idTh) => {
        const ctx = buildAdjustmentNoteContext(note(ENTITIES[type]), META);
        expect(ctx.PAYER_NAME).toBe(ENTITIES[type].displayName);
        expect(ctx.PAYER_NAME_LABEL).toBe(nameLabel);
        expect(ctx.PAYER_ID_LABEL).toBe(idLabel);
        expect(ctx.PAYER_ID_TH).toBe(idTh);
        expect(ctx.PAYER_ADDRESS).toBe('9 ถนนทดสอบ');
        expectNoNationalId(ctx);
    });

    test.each([
        ['credit-note-service', 'creditNote', 'CreditNote', 'credit-notes'],
        ['debit-note-service', 'debitNote', 'DebitNote', 'debit-notes'],
    ])('%s — the PDF read carries the entity, the JSON read does not', async (svc, model, Model, routeFile) => {
        const findUnique = jest.fn(async () => ({ id: 'n-1', organizationId: null, originalInvoice: {} }));
        let service;
        jest.isolateModules(() => {
            jest.doMock('../../services/prisma-database', () => ({
                prisma: { [model]: { create: jest.fn(), findUnique } },
            }));
            service = require(`../../services/${svc}`);
        });
        const actor = { canonicalRole: 'system_admin_dtam' };

        await service[`find${Model}ForDocument`]('n-1', { actor });
        const docSelect = findUnique.mock.calls[0][0].include.originalInvoice.select;
        expect(docSelect.application).toEqual({ select: resolver.PAYER_APPLICATION_SELECT });
        expect(JSON.stringify(docSelect)).not.toContain('thaiCitizenId');

        // The detail route serialises this one — no applicant data may ride along.
        await service[`find${Model}ById`]('n-1', { actor });
        const jsonSelect = findUnique.mock.calls[1][0].include.originalInvoice.select;
        expect(jsonSelect.application).toBeUndefined();

        // The live PDF route reads through the document finder.
        const route = fs.readFileSync(path.join(__dirname, `../../routes/api/finance/${routeFile}.js`), 'utf8');
        const pdfHandler = route.slice(route.indexOf("'/:id/pdf'"));
        expect(pdfHandler).toContain(`find${Model}ForDocument(`);
        jest.dontMock('../../services/prisma-database');
    });
});

describe('quotation template — no hardcoded "บริษัท" before the customer name (L-087)', () => {
    test('quotation.html remark line prints the name alone', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../services/pdf/templates/quotation.html'), 'utf8');
        expect(html).not.toMatch(/บริษัท\s*<span class="fill sm">\{\{CUSTOMER_COMPANY\}\}/);
        expect(html).toContain('{{CUSTOMER_TAXID_LABEL}}');
    });
});

describe('no second copy of the payer labels in any renderer', () => {
    const FILES = [
        'apps/backend/services/pdf/invoice-template-service.js',
        'apps/backend/services/pdf/templates/credit-note.html',
        'apps/backend/services/pdf/templates/debit-note.html',
        'apps/web-app/src/app/health/applications/new/_steps/steps/invoice-step.tsx',
        'apps/web-app/src/features/permit-form/components/documents/quotation-document.tsx',
    ];
    // A label as printable text: quoted, or in its bilingual form. (Prose that
    // merely mentions "the company's name" in a comment is not a label copy.)
    const LABELS = [
        "'ชื่อบริษัท", '"ชื่อบริษัท', 'ชื่อบริษัท / Company Name',
        "'ชื่อ-นามสกุล", '"ชื่อ-นามสกุล', 'ชื่อ-นามสกุล / Name',
        'ชื่อวิสาหกิจชุมชน', 'เลขทะเบียนวิสาหกิจชุมชน', 'Company Name',
    ];
    test.each(FILES)('%s', (rel) => {
        const src = fs.readFileSync(path.join(__dirname, '../../../..', rel), 'utf8');
        for (const label of LABELS) { expect(src).not.toContain(label); }
    });

    test('the web step never reads the national ID or builds the payer from wizard state', () => {
        const src = fs.readFileSync(path.join(__dirname,
            '../../../web-app/src/app/health/applications/new/_steps/steps/invoice-step.tsx'), 'utf8');
        expect(src).not.toMatch(/idCard/);
        expect(src).not.toMatch(/applicantData\?\.(taxId|companyName|communityName|firstName|lastName)/);
    });

    test('the web quotation carries no hardcoded signatory', () => {
        const src = fs.readFileSync(path.join(__dirname,
            '../../../web-app/src/features/permit-form/components/documents/quotation-document.tsx'), 'utf8');
        expect(src).not.toContain('นายปรีชา');
        expect(src).not.toContain('ปฏิบัติราชการแทน');
    });
});

describe('GET /api/applications/:id/quotations — payer + signatory from the server', () => {
    jest.resetModules();
    const mockSlice = jest.fn();
    jest.doMock('../../middleware/auth-middleware', () => {
        const auth = (req, _res, next) => {
            req.user = { id: 'user-1', canonicalRole: req.headers['x-test-role'] || 'health', organizationId: 'org-1' };
            next();
        };
        return { authenticateAny: auth, authenticateHealth: auth, authenticateProvider: auth };
    });
    jest.doMock('../../services/application-service', () => ({
        getApplicationSlice: (...a) => mockSlice(...a),
        findOwnedApplicationForApplicant: jest.fn(async (id, options) => (options?.holderScope?.userId === 'user-1' ? { id, isDeleted: false } : null)),
    }));
    jest.doMock('../../services/quotation-issuance-on-submit', () => ({
        ensureQuotationForIssuedApplication: jest.fn(async () => ({ platform: null })),
    }));
    jest.doMock('../../services/quotation-service', () => ({
        findQuotationsByApplicationId: jest.fn(async () => ({ platform: null })),
    }));

    function buildApp() {
        const app = express();
        app.use('/api/applications/:applicationId/quotations', require('../../routes/api/applications/quotations'));
        return app;
    }

    test.each(Object.keys(ENTITIES))('%s', async (type) => {
        mockSlice.mockResolvedValue({
            id: 'app-1', status: 'SUBMITTED', applicationNumber: 'APP-1', organizationId: 'org-1',
            entity: ENTITIES[type],
            formData: { applicantData: { idCard: NATIONAL_ID, phone: '0811110001' } },
        });
        const res = await request(buildApp()).get('/api/applications/app-1/quotations');
        expect(res.status).toBe(200);
        const expected = resolver.payerBlockForApi({ entity: ENTITIES[type], formData: { applicantData: { phone: '0811110001' } } });
        expect(res.body.data.payer).toEqual(expected);
        expect(res.body.data.signatory).toEqual(
            require('../../services/pdf/invoice-template-service').buildQuotationSignatory(),
        );
        expectNoNationalId(res.body);

        // The select the route asked for: the resolver's own, never thaiCitizenId.
        const { select } = mockSlice.mock.calls[mockSlice.mock.calls.length - 1][1];
        expect(select.entity).toEqual({ select: resolver.PAYER_ENTITY_SELECT });
        expect(JSON.stringify(select)).not.toContain('thaiCitizenId');
    });

    test('a non-owner, non-staff caller still gets nothing (the ruling is not widened)', async () => {
        const res = await request(buildApp()).get('/api/applications/app-1/quotations').set('x-test-role', 'field_inspector');
        expect(res.status).toBe(403);
        expect(res.body.data).toBeUndefined();
    });
});
