/**
 * A กทล.๑ v2 filing must carry the STRUCTURED farm location the certificate needs.
 *
 * Found by walking the real doors to a certificate on 2026-09-06 (F-WALK-03): the six-step
 * wizard stored the site location as ONE free-text string `farmData.siteAddress`, and the v2
 * submit schema was written to NOT demand a separate จังหวัด/อำเภอ/ตำบล ("a separate province
 * string is not demanded of a v2 filing"). But certificate issuance builds the Farm row from
 * `farmData.province/district/subDistrict` (certificate-service.js resolveFarmForCertificate)
 * and refuses with CERTIFICATE_FARM_LOCATION_MISSING when they are blank — so EVERY v2 filing
 * passed submit + audit and then could not be certified. The suite was green because unit
 * tests feed the engines formData directly and never reach generateCertificate.
 *
 * กทล.๑ ส่วนที่ ๒ ข้อ ๑ lists the location as จังหวัด + อำเภอ/เขต + ตำบล/แขวง as separate
 * fields (DTAM baseline census review.md:113-115, all KEEP). The v2 rebuild collapsed them
 * into siteAddress and dropped the structured triple. The fix restores them and demands them
 * at the SUBMIT gate — where a v1-hard-lock refusal belongs — so no filing reaches the cert
 * gate without the location the certificate must name.
 */
'use strict';

const { validateCanonicalSubmission } = require('../../validation/canonical-application-validator');

const DOCS = [{ uploaded: true, url: '/uploads/application-documents/x.pdf' }];

/** A v2 six-step filing (site block present) with structured location filled. */
function v2Filing(farmOverrides = {}) {
    return {
        plantId: 'cannabis',
        serviceType: 'new_application',
        certificationPurposes: ['EXPORT'],
        cultivationMethods: ['OUTDOOR'],
        applicantData: {
            applicantType: 'INDIVIDUAL', firstName: 'ก', lastName: 'ข',
            idCard: '0005550001110', phone: '0812345678', address: 'ที่อยู่',
        },
        applicantType: 'INDIVIDUAL',
        farmData: {
            siteName: 'ฟาร์มทดสอบ',
            siteAddress: '12 หมู่ 3 ต.หนองหาร อ.สันทราย จ.เชียงใหม่',
            areaSqm: '800',
            areaTypes: ['OUTDOOR'],
            province: 'เชียงใหม่',
            district: 'สันทราย',
            subDistrict: 'หนองหาร',
            postalCode: '50290',
            ...farmOverrides,
        },
    };
}

describe('a v2 กทล.๑ filing must declare จังหวัด/อำเภอ/ตำบล (the certificate names them)', () => {
    test('a filing WITH the structured triple is valid', () => {
        const v = validateCanonicalSubmission(v2Filing(), DOCS);
        expect(v.errorsByStep).toEqual({});
        expect(v.isValid).toBe(true);
    });

    test('missing จังหวัด is refused at submit — not left to fail silently at issuance', () => {
        const v = validateCanonicalSubmission(v2Filing({ province: undefined }), DOCS);
        expect(v.isValid).toBe(false);
        expect(v.missingFields.join(' ')).toContain('province');
    });

    test('missing อำเภอ is refused at submit', () => {
        const v = validateCanonicalSubmission(v2Filing({ district: undefined }), DOCS);
        expect(v.isValid).toBe(false);
        expect(v.missingFields.join(' ')).toContain('district');
    });

    test('missing ตำบล is refused at submit', () => {
        const v = validateCanonicalSubmission(v2Filing({ subDistrict: undefined }), DOCS);
        expect(v.isValid).toBe(false);
        expect(v.missingFields.join(' ')).toContain('sub_district');
    });

    test('a free-text siteAddress alone (the F-WALK-03 shape) is no longer enough', () => {
        const v = validateCanonicalSubmission(
            v2Filing({ province: undefined, district: undefined, subDistrict: undefined }), DOCS);
        expect(v.isValid).toBe(false);
    });
});
