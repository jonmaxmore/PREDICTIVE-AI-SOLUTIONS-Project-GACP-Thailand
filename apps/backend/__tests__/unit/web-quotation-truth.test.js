'use strict';

/**
 * The web quotation says what the PDF says — operator-approved fix 2026-09-28
 * (branch fix/web-quotation-truth).
 *
 * Seen on staging (main 863400fc): the web quotation document printed the
 * retired DTAM header ("ระบบรับรองมาตรฐาน GACP สมุนไพร", 88/23 หมู่ 4 ถนนติวานนท์,
 * โทร 0-2591-7007, contact@gacpth.com), an opening paragraph with that name
 * doubled and "พืชกัญชา" hardcoded on a ginger application. The PDF prints the
 * company issuer from config/invoice-issuers.js — and its own paragraph also
 * hardcoded "กัญชา".
 *
 * ONE source: invoice-template-service.js builds the issuer block and the
 * wording (intro + payment note); the quotation PDF and the quotation API (which
 * the web renders verbatim) both read it. The plant is the application's own,
 * named by config/plant-species-slugs.js plantNameTH (pinned to the
 * plant_species seed) — never a default plant.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const mockRealTemplate = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services', 'pdf', 'templates', 'quotation.html'),
    'utf8',
);
const mockCapture = { html: '' };

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    readTemplateCached: () => mockRealTemplate,
    replaceTemplateVariables: (tpl, data) =>
        tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(data[k] === undefined ? '' : data[k])),
    generatePDF: async (html) => { mockCapture.html = html; return Buffer.from('PDF'); },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

const RETIRED_HEADER = [
    'ระบบรับรองมาตรฐาน GACP สมุนไพร',
    '0-2591-7007',
    'contact@gacpth.com',
    'ติวานนท์',
    '88/23',
];

function expectNoRetiredHeader(value) {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    for (const word of RETIRED_HEADER) { expect(s).not.toContain(word); }
}

const GINGER_APP = {
    id: 'app-ginger',
    applicationNumber: 'GACP-TH-2569-000777',
    totalAreaTypes: 1,
    formData: { plantId: 'ginger', cultivationMethods: ['OUTDOOR'] },
};

const ROW = {
    quotationNumber: 'QT-PRD-2026-000002',
    issuerType: 'PLATFORM',
    status: 'PENDING',
    totalAmount: '35310.00',
    installments: [
        { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
    ],
    acceptedSnapshot: null,
    validUntil: new Date('2026-10-06T16:59:59.999Z'),
};

describe('issuer block — the company, from config/invoice-issuers.js', () => {
    test('buildQuotationIssuer: name, taxId, address, email, branch of the company', () => {
        const saved = process.env.PLATFORM_CONTACT_EMAIL;
        delete process.env.PLATFORM_CONTACT_EMAIL;
        try {
            jest.isolateModules(() => {
                const tpl = require('../../services/pdf/invoice-template-service');
                const { getInvoiceIssuer } = require('../../config/invoice-issuers');
                const issuer = tpl.buildQuotationIssuer();
                const config = getInvoiceIssuer('PHASE_1_PLATFORM_FEE');
                expect(Object.keys(issuer).sort()).toEqual(['address', 'branch', 'contact', 'email', 'name', 'taxId']);
                expect(issuer.email).toBe('finance@gacpth.com');
                // Fix round 1 (M-1): the contact line is the PDF header's own
                // string — one phone-PENDING check, no separate phone field.
                expect(issuer.contact).toBe(tpl.buildPlatformQuotationMeta().contact);
                expect(issuer.contact).toContain('finance@gacpth.com');
                expect(issuer.taxId).toBe(config.taxId);
                expect(config.legalNameTH.startsWith(issuer.name)).toBe(true);
                expect(issuer.branch).toBe('สำนักงานใหญ่');
                expect(issuer.address).toContain(config.addressLine1);
                expectNoRetiredHeader(issuer);
            });
        } finally {
            if (saved !== undefined) { process.env.PLATFORM_CONTACT_EMAIL = saved; }
        }
    });
});

describe('copy — the intro and the payment note, one wording for PDF and web', () => {
    const tpl = require('../../services/pdf/invoice-template-service');

    test('a ginger application: the intro names ขิง, never กัญชา, and the issuer once', () => {
        const { intro, note } = tpl.buildQuotationCopy(GINGER_APP);
        const issuer = tpl.buildQuotationIssuer();
        expect(intro).toContain('ขิง');
        expect(intro).not.toContain('กัญชา');
        expect(intro.split(issuer.name).length - 1).toBe(1);
        expect(intro).toContain('มีความยินดีที่จะเสนอราคา');
        expectNoRetiredHeader(intro);
        expect(note).toContain('ที่หน้าชำระเงินของระบบ');
    });

    test('no plant on the application: no plant is printed, not a default one', () => {
        const { intro } = tpl.buildQuotationCopy({ formData: {} });
        expect(intro).not.toContain('กัญชา');
        expect(intro).not.toMatch(/ของพืช\s/);
    });

    test('the quotation PDF prints the same intro and note (the template carries no wording copy)', async () => {
        mockCapture.html = '';
        await tpl.generateQuotationPdf({
            application: GINGER_APP, issuerSide: 'PLATFORM', phase: 1, quotationRow: ROW,
        });
        const { intro, note } = tpl.buildQuotationCopy(GINGER_APP);
        // Assert on what PRINTS: HTML comments are not on the paper. Fix round 1
        // (review I-1): asserting on the raw HTML stayed green with the visible
        // intro replaced by a literal, because a template comment carried the
        // placeholder and the substitution filled it there.
        const printed = mockCapture.html.replace(/<!--[\s\S]*?-->/g, '');
        expect(printed).toContain(intro);
        expect(printed).toContain(note);
        expect(printed).not.toContain('กัญชา');
        expect(mockRealTemplate).not.toContain('พืชกัญชา');
        expectNoRetiredHeader(printed);
    });
});

describe('GET /api/applications/:id/quotations — issuer + copy from the server', () => {
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

    test('a ginger application: issuer is the company, the intro names ขิง', async () => {
        mockSlice.mockResolvedValue({
            id: 'app-ginger', status: 'SUBMITTED', applicationNumber: 'APP-1', organizationId: 'org-1',
            entity: { id: 'e-2', type: 'JURISTIC', displayName: 'บริษัท ทดสอบ จำกัด', juristicId: '0105561234560' },
            formData: { plantId: 'ginger' },
        });
        const res = await request(buildApp()).get('/api/applications/app-ginger/quotations');
        expect(res.status).toBe(200);
        const tpl = require('../../services/pdf/invoice-template-service');
        expect(res.body.data.issuer).toEqual(tpl.buildQuotationIssuer());
        expect(res.body.data.copy).toEqual(tpl.buildQuotationCopy({ formData: { plantId: 'ginger' } }));
        expect(res.body.data.copy.intro).toContain('ขิง');
        expect(JSON.stringify(res.body)).not.toContain('กัญชา');
        expectNoRetiredHeader(res.body);
    });

    test('the door is not widened: a non-finance staff role still gets 403 and no issuer/copy', async () => {
        const res = await request(buildApp()).get('/api/applications/app-ginger/quotations').set('x-test-role', 'field_inspector');
        expect(res.status).toBe(403);
        expect(res.body.data).toBeUndefined();
    });
});
