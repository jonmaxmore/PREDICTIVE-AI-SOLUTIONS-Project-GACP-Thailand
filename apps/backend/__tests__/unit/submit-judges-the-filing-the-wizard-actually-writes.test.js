/**
 * The submit door must judge the filing the six-step wizard ACTUALLY writes.
 *
 * The fixture in __tests__/fixtures/v2-wizard-real-filing.json is not invented: it is the
 * byte-for-byte formData a real filing carried after Deep QA walked the wizard in a real
 * browser on 2026-09-06 — login, six steps, three ลักษณะพื้นที่ ticks, a variety row, every
 * required paper attached, ส่วนที่ ๔ declarations all signed, fee 105,930 on the review
 * page. The applicant pressed ยื่นคำขอ and the door answered 422 naming SIXTEEN fields.
 *
 * Every one of them is the v1-hard-lock class — the gate demanding what no screen writes:
 *
 *   4:applicant_type            the wizard stores it TOP-LEVEL (wizard-owned key,
 *                               application-constants.js); the validator read only
 *                               applicantData.applicantType, the old wizard's spelling
 *   5:farm_name/address/…       the wizard writes siteName / siteAddress / areaSqm —
 *                               the กทล.๑ ส่วนที่ ๒ vocabulary. The PDF renderer already
 *                               reads these aliases (katorlor1-template-service.farmForForm);
 *                               the validator never learned them
 *   5:plot_*                    plot rows are born AFTER certification for T&T; the
 *                               six-step wizard files a SITE, not plots
 *   6:propagation/plant_parts   the redesign's mapping moved production & quality-control
 *   7:harvest/drying/storage    to the AUDIT DAY (design §, "64 รายการ … MOVE_TO_AUDIT");
 *                               demanding them at filing resurrects the deleted steps
 *
 * The design line this enforces: *"wizard, หน้าตรวจทาน, validator ฝั่ง prepare/submit และ
 * หน้าเจ้าหน้าที่ อ่านตัวนี้ตัวเดียว"* — one contract, not two generations of one.
 *
 * A LEGACY filing keeps every old demand. This is a boundary, not a migration — the same
 * W14 lesson: each filing is judged by its own era's law, and the era is read off the
 * filing itself (only the six-step wizard writes the site block).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const {
    validateCanonicalSubmission,
} = require('../../validation/canonical-application-validator');

const REAL = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'v2-wizard-real-filing.json'), 'utf8',
));

/** documents as the route normalizes them — one uploaded paper. */
const DOCS = [{ uploaded: true, url: '/uploads/application-documents/x.pdf' }];

describe('the filing the real browser walk produced', () => {
    test('is VALID at the submit door', () => {
        const verdict = validateCanonicalSubmission(REAL, DOCS);
        expect(verdict.errorsByStep).toEqual({});
        expect(verdict.isValid).toBe(true);
    });

    test('none of the sixteen 422 fields is demanded of it', () => {
        const verdict = validateCanonicalSubmission(REAL, DOCS);
        const fields = verdict.missingFields.join(' ');
        for (const ghost of [
            'applicant_type', 'farm_name', 'province', 'total_area_size', 'plot_count',
            'plot_name', 'propagation_type', 'plant_parts', 'harvest_method',
            'drying_method', 'storage_system',
        ]) {
            expect(fields).not.toContain(ghost);
        }
    });
});

describe('a กทล.๑ filing is still judged, not waved through', () => {
    test('missing the site name is refused, in the words of its own form', () => {
        const broken = JSON.parse(JSON.stringify(REAL));
        delete broken.farmData.siteName;
        const verdict = validateCanonicalSubmission(broken, DOCS);
        expect(verdict.isValid).toBe(false);
        expect(verdict.missingFields.join(' ')).toContain('farm_name');
    });

    test('missing the area size is refused', () => {
        const broken = JSON.parse(JSON.stringify(REAL));
        delete broken.farmData.areaSqm;
        const verdict = validateCanonicalSubmission(broken, DOCS);
        expect(verdict.isValid).toBe(false);
        expect(verdict.missingFields.join(' ')).toContain('total_area_size');
    });

    test('missing the applicant identity is refused', () => {
        const broken = JSON.parse(JSON.stringify(REAL));
        delete broken.applicantData.firstName;
        const verdict = validateCanonicalSubmission(broken, DOCS);
        expect(verdict.isValid).toBe(false);
    });

    test('papers are the LENS\'s to judge, not this validator\'s — no double judge', () => {
        // The requirements lens (assertRequiredDocumentsPresent) guards every submit door
        // and reads the ApplicationDocument rows the v2 upload flow writes. This
        // validator's step-8 check reads the OLD wizard's formData.documents store, which
        // v2 never writes — so on a v2 filing it refused a complete filing whose review
        // banner was clear. For v2 it must stay silent and leave the refusal to the lens
        // (pinned at the door by the m2a-submit-enforcement suite).
        const verdict = validateCanonicalSubmission(REAL, []);
        expect(verdict.missingFields.join(' ')).not.toContain('step8.files');
        expect(verdict.isValid).toBe(true);
    });
});

describe('a LEGACY filing keeps its own era\'s law', () => {
    // Old wizard shape: farmName/address/province + plots + production + harvest.
    const LEGACY = {
        plantId: 'cannabis',
        serviceType: 'new_application',
        certificationPurposes: ['EXPORT'],
        cultivationMethods: ['OUTDOOR'],
        applicantData: {
            applicantType: 'INDIVIDUAL', firstName: 'ก', lastName: 'ข',
            // checksum-valid — the last digit is a real check digit and the validator verifies it
            idCard: '0005550001110',
            phone: '0812345678',
            address: 'ที่อยู่',
        },
        farmData: {
            farmName: 'ฟาร์มเก่า', address: 'ที่อยู่ฟาร์ม', province: 'เชียงใหม่',
            totalAreaSize: '800', totalAreaUnit: 'sqm',
        },
        plots: [{ name: 'แปลง 1', areaSize: '800', areaUnit: 'sqm', solarSystem: 'OUTDOOR' }],
        productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
        harvestData: { harvestMethod: 'มือ', dryingMethod: 'ตาก', storageSystem: 'ห้องเย็น' },
    };

    test('a complete legacy filing still passes', () => {
        expect(validateCanonicalSubmission(LEGACY, DOCS).isValid).toBe(true);
    });

    test('a legacy filing missing its harvest method is still refused — the old demand holds there', () => {
        const broken = JSON.parse(JSON.stringify(LEGACY));
        delete broken.harvestData.harvestMethod;
        const verdict = validateCanonicalSubmission(broken, DOCS);
        expect(verdict.isValid).toBe(false);
        expect(verdict.missingFields.join(' ')).toContain('harvest_method');
    });

    test('a legacy filing with no plots is still refused', () => {
        const broken = JSON.parse(JSON.stringify(LEGACY));
        broken.plots = [];
        expect(validateCanonicalSubmission(broken, DOCS).isValid).toBe(false);
    });
});
