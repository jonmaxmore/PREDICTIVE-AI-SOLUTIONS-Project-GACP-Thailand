/**
 * F-QA-06 heal — a filing already submitted before the farm-materialisation fix has no Farm row,
 * and its site lives in the six-step wizard's vocabulary (siteName / siteAddress). The certificate
 * resolver read only the older spelling (farmData.address / farmName), so those filings walked the
 * whole line — documents, both payments, scheduling, six GPS-tagged photographs, the 24-item
 * checklist — and were then refused CERTIFICATE_FARM_LOCATION_MISSING with the address sitting in
 * the filing all along. The resolver now reads through the SAME map the submit path uses.
 */
'use strict';

const { readFilingSite } = require('../../services/application-service/application-farm-materialization');

describe('the certificate reads the site the wizard actually wrote', () => {
    const wizardFiling = {
        formData: {
            farmData: {
                siteName: 'สวนทดสอบ คิวเอ',
                siteAddress: '12 หมู่ 3',
                subDistrict: 'หนองหาร',
                district: 'สันทราย',
                province: 'เชียงใหม่',
                postalCode: '50290',
            },
        },
    };

    it('reads name and address from the wizard spelling', () => {
        const site = readFilingSite(wizardFiling.formData);
        expect(site.farmName).toBe('สวนทดสอบ คิวเอ');
        expect(site.address).toBe('12 หมู่ 3');
        expect(site.province).toBe('เชียงใหม่');
        expect(site.district).toBe('สันทราย');
        expect(site.subDistrict).toBe('หนองหาร');
    });

    it('still reads the older spelling, so filings in flight do not change meaning', () => {
        const site = readFilingSite({ farmData: { farmName: 'ไร่เก่า', address: '99 หมู่ 1', province: 'เชียงราย',
            district: 'เมือง', subdistrict: 'เวียง' } });
        expect(site.farmName).toBe('ไร่เก่า');
        expect(site.address).toBe('99 หมู่ 1');
        expect(site.subDistrict).toBe('เวียง');
    });

    it('the certificate resolver uses that map — no second field list', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services', 'certificate-service.js'), 'utf8');
        expect(src).toContain('readFilingSite');
        // and it must not go back to reading only the legacy key
        expect(src).not.toMatch(/normalizeText\(\s*farmData\.address \|\| locationData\.address\s*\)/);
    });
});
