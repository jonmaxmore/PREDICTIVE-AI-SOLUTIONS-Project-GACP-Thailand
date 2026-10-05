/**
 * C2 fix — canonical application validator.
 *
 * The live wizard posts CANONICAL camelCase formData
 * (applicantData / farmData / plots / productionData / harvestData /
 * documents) with NO `steps.{1..9}` keys. The legacy snake-case
 * `validateAllSteps` therefore saw `{}` and 422'd every real submit.
 *
 * This module:
 *   1. `normalizeCanonicalToSteps(formData)` maps the canonical fields the
 *      wizard ACTUALLY collects into the snake-case step shape, so the
 *      mapping is auditable against the Zod step schemas (plot=step5 etc).
 *   2. `validateCanonicalSubmission(formData, documents)` runs rigorous
 *      Zod validation over the canonical shape (the GACP fields the live
 *      wizard collects — mirrors the FE review-step checklist), returning
 *      accurate per-step errors and missingFields.
 *
 * These tests exercise REAL Zod validation (no validator mocking — the C2
 * bug was masked by a mock).
 */

const {
    normalizeCanonicalToSteps,
    validateCanonicalSubmission,
} = require('../../validation/canonical-application-validator');
const { LEGACY_UNIT_TO_SQM } = require('../../shared/area-utils');

// A realistic, COMPLETE canonical formData derived from the live wizard
// (review-step.tsx payload + domain-types.ts) for an INDIVIDUAL applicant.
function completeCanonicalFormData() {
    return {
        plantId: 'cannabis',
        serviceType: 'NEW',
        certificationPurposes: ['EXPORT'],
        locationType: 'OUTDOOR',
        cultivationMethods: ['outdoor'],
        consentedPDPA: true,
        acknowledgedStandards: true,
        applicantData: {
            applicantType: 'INDIVIDUAL',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            idCard: '1100000000008',
            phone: '0812345678',
            email: 'somchai@example.com',
            address: '123 หมู่ 4 ต.บางพลี',
        },
        farmData: {
            farmName: 'ฟาร์มสมชาย',
            address: '123 หมู่ 4',
            province: 'สมุทรปราการ',
            district: 'บางพลี',
            subdistrict: 'บางพลีใหญ่',
            postalCode: '10540',
            totalAreaSize: '5',
            totalAreaUnit: 'Rai',
            landOwnership: 'OWN',
            gpsLat: '13.123456',
            gpsLng: '100.654321',
        },
        plots: [
            {
                id: 'plot-1',
                name: 'แปลงที่ 1',
                areaSize: '2',
                areaUnit: 'Rai',
                solarSystem: 'OUTDOOR',
            },
        ],
        productionData: {
            propagationType: ['SEED'],
            plantParts: ['FLOWER'],
            cultivationMethods: ['outdoor'],
        },
        harvestData: {
            harvestMethod: 'MANUAL',
            dryingMethod: 'SUN',
            storageSystem: 'AMBIENT',
            packaging: 'ถุงสุญญากาศ',
        },
        documents: [
            { type: 'ID_CARD', name: 'บัตรประชาชน', uploaded: true, url: '/uploads/id.pdf' },
        ],
    };
}

// Documents as normalized by preview-utils.normalizeDocuments (uploaded flag).
function completeDocuments() {
    return [{ type: 'ID_CARD', name: 'บัตรประชาชน', uploaded: true, url: '/uploads/id.pdf' }];
}

describe('C2 — normalizeCanonicalToSteps (canonical → step shape)', () => {
    it('maps farm/plot canonical fields into STEP 5 (plot=step5, not step2)', () => {
        const steps = normalizeCanonicalToSteps(completeCanonicalFormData());
        // plot_name lives in step 5 per the Zod step5Schema — never step 2.
        expect(steps['5']).toBeDefined();
        expect(steps['5'].plot_name).toBe('แปลงที่ 1');
        // The plant/strain step (2) must NOT carry the plot name.
        expect(steps['2']?.plot_name).toBeUndefined();
    });

    it('maps applicantData into STEP 4', () => {
        const steps = normalizeCanonicalToSteps(completeCanonicalFormData());
        expect(steps['4']).toBeDefined();
        expect(steps['4'].applicant_type).toBe('INDIVIDUAL');
        expect(steps['4'].first_name).toBe('สมชาย');
        expect(steps['4'].last_name).toBe('ใจดี');
    });

    it('maps harvest/quality canonical fields into STEP 7', () => {
        const steps = normalizeCanonicalToSteps(completeCanonicalFormData());
        expect(steps['7']).toBeDefined();
        expect(steps['7'].harvest_method).toBe('MANUAL');
    });

    it('maps production canonical fields into STEP 6', () => {
        const steps = normalizeCanonicalToSteps(completeCanonicalFormData());
        expect(steps['6']).toBeDefined();
    });
});

describe('C2 — validateCanonicalSubmission (real Zod, complete payload)', () => {
    it('ACCEPTS a complete canonical INDIVIDUAL application', () => {
        const result = validateCanonicalSubmission(completeCanonicalFormData(), completeDocuments());
        expect(result.isValid).toBe(true);
        expect(result.missingFields).toHaveLength(0);
    });

    it('ACCEPTS a complete canonical JURISTIC application', () => {
        const fd = completeCanonicalFormData();
        fd.applicantData = {
            applicantType: 'JURISTIC',
            companyName: 'บริษัท สมุนไพรไทย จำกัด',
            registrationNumber: '0105500000001',
            // F-G4-10: was '0105500000001', whose check digit is 3, not 1. The
            // submit door now verifies it. registrationNumber is left as-is on
            // purpose — that field is not checksum-validated, so this fixture
            // also proves the two are judged independently.
            taxId: '0105500000003',
            directorName: 'สมหญิง ผู้บริหาร',
            companyAddress: '99 อาคารทดสอบ',
        };
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(true);
    });
});

describe('C2 — validateCanonicalSubmission (real Zod, INCOMPLETE payloads reject)', () => {
    it('REJECTS when plots are missing (no plot = step 5 error)', () => {
        const fd = completeCanonicalFormData();
        fd.plots = [];
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
    });

    it('REJECTS when farmData.farmName is missing (step 5 error)', () => {
        const fd = completeCanonicalFormData();
        delete fd.farmData.farmName;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
    });

    it('REJECTS when applicant data is missing (step 4 error)', () => {
        const fd = completeCanonicalFormData();
        fd.applicantData = { applicantType: 'INDIVIDUAL' };
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['4']).toBeDefined();
    });

    it('REJECTS when production data (propagation/plantParts) is missing (step 6 error)', () => {
        const fd = completeCanonicalFormData();
        fd.productionData = {};
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['6']).toBeDefined();
    });

    it('REJECTS when harvestMethod is missing (step 7 error)', () => {
        const fd = completeCanonicalFormData();
        fd.harvestData = {};
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['7']).toBeDefined();
    });

    it('REJECTS when no documents are uploaded (step 8 error)', () => {
        const fd = completeCanonicalFormData();
        fd.documents = [];
        const result = validateCanonicalSubmission(fd, []);
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['8']).toBeDefined();
    });

    it('REJECTS when plant selection is missing (step 2 error)', () => {
        const fd = completeCanonicalFormData();
        delete fd.plantId;
        fd.cultivationMethods = [];
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['2']).toBeDefined();
    });

    it('REJECTS a totally empty canonical payload with multiple step errors', () => {
        const result = validateCanonicalSubmission({}, []);
        expect(result.isValid).toBe(false);
        // Multiple steps should report errors, not silently pass.
        expect(Object.keys(result.errorsByStep).length).toBeGreaterThan(2);
        expect(result.missingFields.length).toBeGreaterThan(0);
    });
});

// F-PLOT-AREAUNIT-DEADEND fix (Task 1) — the specimen (f866374a…) sailed
// through intake, got paid, and passed audit with a plot that had no
// areaUnit, then died at cert generation (strict reader,
// certificate-service.js:169-190 / area-utils.js:67-76). The mapper used to
// read plots[0] only and the step5 schema never checked a unit at all — this
// suite pins the fix at the SAME door the front submit and resubmit doors
// both call (validateCanonicalSubmission).
describe('C2 — plot areaUnit enforcement (F-PLOT-AREAUNIT-DEADEND fix, Task 1)', () => {
    it('REJECTS when the only plot has no areaUnit at all (step 5 error, names the plot)', () => {
        const fd = completeCanonicalFormData();
        delete fd.plots[0].areaUnit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
        const messages = result.errorsByStep['5'].map((e) => e.message).join(' ');
        // Actionable Thai message names the plot (by its own name/index).
        expect(messages).toContain('แปลงที่ 1');
    });

    it('REJECTS plots[1] missing a unit even when plots[0] is valid — the plots[0]-blindness bug', () => {
        const fd = completeCanonicalFormData();
        fd.plots = [
            { id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Rai', solarSystem: 'OUTDOOR' },
            { id: 'p2', name: 'แปลงที่ 2', areaSize: '1', solarSystem: 'OUTDOOR' }, // no areaUnit
        ];
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
        const messages = result.errorsByStep['5'].map((e) => e.message).join(' ');
        expect(messages).toContain('แปลงที่ 2');
    });

    // The UI wizard posts 'Sqm' capitalised (farm-info-step.tsx:252,387) — a
    // case-sensitive enum would block every real user. Every spelling in the
    // closed LEGACY_UNIT_TO_SQM enum must pass, both as stored and uppercased.
    it.each(Object.keys(LEGACY_UNIT_TO_SQM))('ACCEPTS areaUnit "%s" from the closed enum', (unit) => {
        const fd = completeCanonicalFormData();
        fd.plots[0].areaUnit = unit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(true);
    });

    it.each(['Sqm', 'SQM', 'Rai', 'RAI', 'Ngan'])('ACCEPTS areaUnit "%s" case-insensitively (UI casing)', (unit) => {
        const fd = completeCanonicalFormData();
        fd.plots[0].areaUnit = unit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(true);
    });

    it.each(['ไร่ครึ่ง', 'acres', 'hectare', '  '])('REJECTS areaUnit "%s" (not in the closed enum)', (unit) => {
        const fd = completeCanonicalFormData();
        fd.plots[0].areaUnit = unit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
    });
});

// farm-areaunit-default fix (Task 2) — mirrors the plot areaUnit enforcement
// above at the SAME closed door (validateCanonicalSubmission), for the farm's
// OWN totalAreaUnit. Facts (spec :6-8): 19 legacy applications reached
// farmData.totalAreaSize with no totalAreaUnit; certificate-service.js:561
// (farm CREATE at mint) reads `farmData.totalAreaUnit || productionData.areaUnit
// || AREA_UNIT` — a silent Sqm default on the exact ×1,600 ambiguity the plot
// reader refuses to guess at. This suite closes the intake door so a
// unit-less farmData can never enter again (T3, not this task, removes the
// silent default at mint).
describe('C2 — farm areaUnit enforcement (farm-areaunit-default fix, Task 2)', () => {
    it('REJECTS when farmData has no totalAreaUnit at all (step 5 error)', () => {
        const fd = completeCanonicalFormData();
        delete fd.farmData.totalAreaUnit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
        const messages = result.errorsByStep['5'].map((e) => e.message).join(' ');
        // Honesty rule (plot-mission lesson) — the wizard sets this
        // programmatically and exposes NO unit control, so the remedy text
        // must NOT tell the user to fix it in the form.
        expect(messages).not.toContain('แก้ไขผ่านฟอร์ม');
        expect(messages).toContain('ติดต่อเจ้าหน้าที่');
    });

    it('REJECTS when farmData.totalAreaUnit is an empty string', () => {
        const fd = completeCanonicalFormData();
        fd.farmData.totalAreaUnit = '';
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
    });

    it.each(Object.keys(LEGACY_UNIT_TO_SQM))('ACCEPTS farm areaUnit "%s" from the closed enum', (unit) => {
        const fd = completeCanonicalFormData();
        fd.farmData.totalAreaUnit = unit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(true);
    });

    it.each(['Sqm', 'sqm', 'Rai', 'RAI', 'Ngan'])('ACCEPTS farm areaUnit "%s" case-insensitively (UI casing)', (unit) => {
        const fd = completeCanonicalFormData();
        fd.farmData.totalAreaUnit = unit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(true);
    });

    it.each(['ไร่ครึ่ง', 'acres', 'hectare', '  '])('REJECTS farm areaUnit "%s" (not in the closed enum)', (unit) => {
        const fd = completeCanonicalFormData();
        fd.farmData.totalAreaUnit = unit;
        const result = validateCanonicalSubmission(fd, completeDocuments());
        expect(result.isValid).toBe(false);
        expect(result.errorsByStep['5']).toBeDefined();
    });
});

/**
 * The plant is not free text — it decides which body of law judges the filing.
 *
 * `requiredString` accepted any non-empty string, so `plantId: 'x'` passed this door and
 * reached the requirement engine, which had no rules for it. The engine now refuses such
 * a filing outright; this schema refuses it one door earlier, where the applicant is
 * still on the page that asked the question and can fix it.
 */
describe('ชนิดพืช must be a plant this platform knows', () => {
    const { PLANT_SLUG_TO_CODE } = require('../../config/plant-species-slugs');

    it('accepts every plant the wizard can offer', () => {
        Object.keys(PLANT_SLUG_TO_CODE).forEach((slug) => {
            const fd = completeCanonicalFormData();
            fd.plantId = slug;
            const result = validateCanonicalSubmission(fd, [{ fileUrl: '/uploads/a.pdf' }]);
            expect(result.missingFields).not.toContain('step2.plant_id');
        });
    });

    it('refuses a word that is not a plant, instead of passing it to the law', () => {
        const fd = completeCanonicalFormData();
        fd.plantId = 'x';
        const result = validateCanonicalSubmission(fd, [{ fileUrl: '/uploads/a.pdf' }]);
        expect(result.missingFields).toContain('step2.plant_id');
        expect(result.isValid).toBe(false);
    });

    // Review finding 7 — two doors, one vocabulary, one normalisation. The lens
    // lower-cased and this door did not, so 'Cannabis' was judged normally by the
    // requirement engine and then refused here.
    it('reads a plant the same way the requirement engine does, case and padding included', () => {
        const fd = completeCanonicalFormData();
        fd.plantId = '  Cannabis  ';
        const result = validateCanonicalSubmission(fd, [{ fileUrl: '/uploads/a.pdf' }]);
        expect(result.missingFields).not.toContain('step2.plant_id');
    });

    it('still refuses an empty plant, with the same field named', () => {
        const fd = completeCanonicalFormData();
        delete fd.plantId;
        const result = validateCanonicalSubmission(fd, [{ fileUrl: '/uploads/a.pdf' }]);
        expect(result.missingFields).toContain('step2.plant_id');
    });
});

