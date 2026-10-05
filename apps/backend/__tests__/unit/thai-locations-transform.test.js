/**
 * thai-locations-transform.test.js
 *
 * Turning a community dataset into something a government platform may rely on.
 *
 * The address fields were badly incomplete: 77 provinces, but only 75 districts
 * covering 7 of those provinces (~8% of Thailand's 930), no subdistricts at all,
 * and a free-text postal code. Farmers in the other 70 provinces met an empty
 * dropdown.
 *
 * Ingesting a replacement extract, one hazard has to be handled and one has to
 * be prevented.
 *
 * THE HAZARD. Administrative extracts routinely number จังหวัด with a 1-based
 * row sequence rather than the standard code — กรุงเทพมหานคร arrives as `1`
 * while this platform and every other Thai government system call it `10`, and
 * all 77 differ that way. Importing those row numbers as codes would silently
 * repoint the province on every existing application. อำเภอ codes do not have
 * that problem (เขตพระนคร = 1001), so a จังหวัด code is recoverable as
 * floor(districtId / 100) — an identity checked across the whole dataset, 930
 * of 930 อำเภอ agree, 0 disagree. This transform therefore derives จังหวัด
 * codes from อำเภอ and refuses to guess when it cannot.
 *
 * WHAT WE PREVENT. No government body has attested to the shipped file, and it
 * is vendored rather than fetched — fetching at build or run time would put a
 * foreign host in the path of a Thai government service, which is the thing we
 * just spent a wave removing. The validation below is what stands in for an
 * authority: if a future update introduces an orphan, a duplicate, or a
 * malformed code, the build fails rather than shipping a farm address that
 * points nowhere.
 */

'use strict';

const {
    deriveProvinceCode,
    transformLocations,
    validateLocations,
} = require('../../data/thai-locations-transform');

describe('deriveProvinceCode', () => {
    it('recovers the DOPA province code from a district code', () => {
        expect(deriveProvinceCode(1001)).toBe(10);  // เขตพระนคร -> กรุงเทพมหานคร
        expect(deriveProvinceCode(5001)).toBe(50);  // เมืองเชียงใหม่ -> เชียงใหม่
        expect(deriveProvinceCode(9601)).toBe(96);  // เมืองนราธิวาส -> นราธิวาส
    });

    it('rejects a district code that is not four digits', () => {
        // A three-digit or five-digit code means the upstream shape changed;
        // silently dividing it would produce a plausible but wrong province.
        expect(() => deriveProvinceCode(101)).toThrow();
        expect(() => deriveProvinceCode(10011)).toThrow();
        expect(() => deriveProvinceCode('abc')).toThrow();
    });
});

describe('transformLocations', () => {
    const source = {
        provinces: [{ id: 1, name_th: 'กรุงเทพมหานคร', name_en: 'Bangkok' }],
        districts: [{ id: 1001, province_id: 1, name_th: 'เขตพระนคร', name_en: 'Khet Phra Nakhon' }],
        subDistricts: [{
            id: 100101, district_id: 1001, zip_code: 10200,
            name_th: 'พระบรมมหาราชวัง', name_en: 'Phra Borom Maha Ratchawang',
        }],
    };

    it('emits the DOPA province code, not the upstream sequence number', () => {
        const out = transformLocations(source);
        expect(out.provinces).toEqual([
            { code: 10, nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok' },
        ]);
    });

    it('keeps district and subdistrict codes as they are — those are already DOPA', () => {
        const out = transformLocations(source);
        expect(out.districts[0]).toEqual({
            code: 1001, provinceCode: 10, nameTh: 'เขตพระนคร', nameEn: 'Khet Phra Nakhon',
        });
        expect(out.subDistricts[0]).toEqual({
            code: 100101, districtCode: 1001, postalCode: '10200',
            nameTh: 'พระบรมมหาราชวัง', nameEn: 'Phra Borom Maha Ratchawang',
        });
    });

    it('keeps the postal code as a string so a leading zero cannot be lost', () => {
        const out = transformLocations(source);
        expect(typeof out.subDistricts[0].postalCode).toBe('string');
        expect(out.subDistricts[0].postalCode).toHaveLength(5);
    });

    it('drops a province that has no districts, rather than emitting a code it guessed', () => {
        // Province codes are derived from districts. A province with none is a
        // province we cannot place, and an unplaceable province in a dropdown
        // is worse than an absent one.
        const out = transformLocations({
            ...source,
            provinces: [...source.provinces, { id: 99, name_th: 'จังหวัดผี', name_en: 'Ghost' }],
        });
        expect(out.provinces.map((p) => p.nameTh)).not.toContain('จังหวัดผี');
        expect(out.warnings.some((w) => w.includes('จังหวัดผี'))).toBe(true);
    });

    it('drops a district with no subdistricts — the address flow cannot complete through it', () => {
        // Upstream carries two entries named ท้องถิ่นเทศบาลตำบล… which are
        // municipality registration units overlaying an existing tambon, not
        // อำเภอ a farmer would pick. They have no subdistricts, so selecting
        // one leaves the ตำบล dropdown empty and the applicant stuck. Better
        // absent than a dead end — but reported, never silently removed.
        const out = transformLocations({
            ...source,
            districts: [
                ...source.districts,
                { id: 1099, province_id: 1, name_th: 'ท้องถิ่นเทศบาลตำบลทดสอบ', name_en: 'Local Muni' },
            ],
        });
        expect(out.districts.map((d) => d.nameTh)).not.toContain('ท้องถิ่นเทศบาลตำบลทดสอบ');
        expect(out.warnings.some((w) => w.includes('ท้องถิ่นเทศบาลตำบลทดสอบ'))).toBe(true);
    });

    it('refuses a subdistrict whose district does not exist', () => {
        expect(() => transformLocations({
            ...source,
            subDistricts: [...source.subDistricts, { id: 999999, district_id: 9999, zip_code: 10200, name_th: 'x', name_en: 'x' }],
        })).toThrow(/district/i);
    });

    it('skips rows the upstream marked deleted', () => {
        const out = transformLocations({
            ...source,
            subDistricts: [
                ...source.subDistricts,
                { id: 100102, district_id: 1001, zip_code: 10200, name_th: 'ลบแล้ว', name_en: 'Deleted', deleted_at: '2024-01-01' },
            ],
        });
        expect(out.subDistricts.map((s) => s.nameTh)).not.toContain('ลบแล้ว');
    });
});

describe('validateLocations', () => {
    const good = {
        provinces: [{ code: 10, nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok' }],
        districts: [{ code: 1001, provinceCode: 10, nameTh: 'เขตพระนคร', nameEn: 'K' }],
        subDistricts: [{ code: 100101, districtCode: 1001, postalCode: '10200', nameTh: 'พ', nameEn: 'P' }],
    };

    it('passes a well-formed dataset', () => {
        expect(validateLocations(good)).toEqual([]);
    });

    it('catches a district pointing at a province that is not there', () => {
        const errors = validateLocations({ ...good, districts: [{ ...good.districts[0], provinceCode: 99 }] });
        expect(errors.join(' ')).toMatch(/province/i);
    });

    it('catches a subdistrict pointing at a district that is not there', () => {
        const errors = validateLocations({ ...good, subDistricts: [{ ...good.subDistricts[0], districtCode: 9999 }] });
        expect(errors.join(' ')).toMatch(/district/i);
    });

    it('catches duplicate codes at every level', () => {
        expect(validateLocations({ ...good, provinces: [good.provinces[0], good.provinces[0]] }).join(' ')).toMatch(/duplicate/i);
        expect(validateLocations({ ...good, districts: [good.districts[0], good.districts[0]] }).join(' ')).toMatch(/duplicate/i);
        expect(validateLocations({ ...good, subDistricts: [good.subDistricts[0], good.subDistricts[0]] }).join(' ')).toMatch(/duplicate/i);
    });

    it('catches a malformed postal code', () => {
        expect(validateLocations({ ...good, subDistricts: [{ ...good.subDistricts[0], postalCode: '102' }] }).join(' ')).toMatch(/postal/i);
    });

    it('catches a subdistrict code that does not sit under its district', () => {
        // 100101 must begin with its district code 1001. A mismatch means the
        // hierarchy is broken even though both rows individually look fine.
        const errors = validateLocations({
            ...good,
            subDistricts: [{ ...good.subDistricts[0], code: 500101 }],
        });
        expect(errors.join(' ')).toMatch(/hierarch|prefix|under/i);
    });

    it('catches a missing Thai name — the dropdown would render blank', () => {
        expect(validateLocations({ ...good, provinces: [{ ...good.provinces[0], nameTh: '' }] }).join(' ')).toMatch(/name/i);
    });
});
