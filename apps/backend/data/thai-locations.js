/**
 * Thai administrative divisions — จังหวัด / อำเภอ / ตำบล + รหัสไปรษณีย์.
 *
 * What this replaced, and why it mattered.
 *
 * The previous version of this file was hand-maintained and covered 77
 * provinces but only 75 districts across 7 of them — roughly 8% of Thailand's
 * 930 — with no subdistricts at all. A farmer in any of the other 70 provinces
 * opened the address step, chose their province, and met an empty อำเภอ
 * dropdown; ตำบล and รหัสไปรษณีย์ were free text for everyone. On a
 * certification platform the farm address is what an auditor drives to.
 *
 * The data now lives in `thai-locations-data.json`. See
 * `data/source/PROVENANCE.md` for how it is verified, the five rows we
 * corrected and why, the questions still open, and an honest statement of what
 * this data is and is not.
 *
 * Two decisions worth knowing about:
 *
 * 1. Codes are the standard Thai administrative codes — จังหวัด 2 digits,
 *    อำเภอ 4, ตำบล 6, each nesting inside its parent. They are what every Thai
 *    government system uses, so a value stored against an application stays
 *    meaningful outside this platform.
 *
 * 2. The data is vendored, never fetched. Downloading it at build or run time
 *    would place a foreign host in the path of a Thai government service —
 *    a dependency this repo has removed everywhere else it appeared.
 */

'use strict';

const data = require('./thai-locations-data.json');

/**
 * Legacy shape `{ id, name_th, name_en }` is preserved so existing callers and
 * the current frontend keep working unchanged. `id` is the DOPA code, which is
 * what the old hand-maintained file already used for provinces — so values
 * already stored against applications continue to resolve.
 */
const provinces = data.provinces.map((p) => ({
    id: p.code,
    name_th: p.nameTh,
    name_en: p.nameEn,
}));

const districts = data.districts.map((d) => ({
    id: d.code,
    province_id: d.provinceCode,
    name_th: d.nameTh,
    name_en: d.nameEn,
}));

const subDistricts = data.subDistricts.map((s) => ({
    id: s.code,
    district_id: s.districtCode,
    name_th: s.nameTh,
    name_en: s.nameEn,
    zip: s.postalCode,
}));

const _provinceById = new Map(provinces.map((p) => [p.id, p]));

const _districtsByProvince = new Map();
for (const district of districts) {
    if (!_districtsByProvince.has(district.province_id)) {
        _districtsByProvince.set(district.province_id, []);
    }
    _districtsByProvince.get(district.province_id).push(district);
}
const _districtById = new Map(districts.map((d) => [d.id, d]));

const _subDistrictsByDistrict = new Map();
for (const sub of subDistricts) {
    if (!_subDistrictsByDistrict.has(sub.district_id)) {
        _subDistrictsByDistrict.set(sub.district_id, []);
    }
    _subDistrictsByDistrict.get(sub.district_id).push(sub);
}
const _subDistrictById = new Map(subDistricts.map((s) => [s.id, s]));

module.exports = {
    provinces,
    districts,
    subDistricts,

    getProvinces: () => provinces,
    getProvinceById: (id) => _provinceById.get(Number(id)) || null,
    getDistrictsByProvince: (provinceId) => _districtsByProvince.get(Number(provinceId)) || [],
    getDistrictById: (id) => _districtById.get(Number(id)) || null,
    getSubDistrictsByDistrict: (districtId) => _subDistrictsByDistrict.get(Number(districtId)) || [],
    getSubDistrictById: (id) => _subDistrictById.get(Number(id)) || null,

    /**
     * Postal code for a subdistrict, or null.
     *
     * A tambon maps to one postal code, but the reverse does not hold: 174 of
     * the 955 postal codes span more than one district. Callers may use this
     * to prefill the field; they must leave it editable rather than locking it
     * to this answer.
     */
    getPostalCode: (subDistrictId) => {
        const sub = _subDistrictById.get(Number(subDistrictId));
        return sub ? sub.zip : null;
    },
};
