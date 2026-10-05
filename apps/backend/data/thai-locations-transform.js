/**
 * Normalising a Thai administrative extract, and refusing to guess.
 *
 * `thai-locations-data.json` is the source of truth in this repo and is not
 * regenerated from anything external — a build- or run-time download would put
 * a foreign host in the path of a Thai government service. This module exists
 * for the day DTAM or DOPA supplies a fresh extract: it turns that shape into
 * ours, and it is where the validation rules live that the CI gate reuses.
 * See data/source/PROVENANCE.md.
 *
 * The one thing that must not go wrong. Administrative extracts routinely
 * number provinces with a 1-based row sequence rather than the standard code —
 * กรุงเทพมหานคร arrives as `1` while every Thai government system, this one
 * included, calls it `10`, and all 77 provinces differ that way. Importing
 * those row numbers as codes would silently repoint the province on every
 * stored application.
 *
 * อำเภอ codes do not have that problem: they are the standard codes already
 * (เขตพระนคร = 1001), and a จังหวัด code is recoverable from one as
 * floor(districtCode / 100). That identity was checked across every อำเภอ in
 * the dataset before it was relied on — 930 agree, 0 disagree. Everything here
 * derives from it, and throws rather than guessing wherever it cannot.
 */

'use strict';

/** DOPA codes: province 2 digits, district 4, subdistrict 6. */
const DISTRICT_CODE = /^\d{4}$/;
const SUBDISTRICT_CODE = /^\d{6}$/;
const POSTAL_CODE = /^\d{5}$/;

/**
 * The DOPA province code embedded in a district code.
 *
 * Throws on anything that is not a four-digit code: a shape change upstream
 * would otherwise divide silently and produce a plausible but wrong province,
 * which is far worse than a failed build.
 */
function deriveProvinceCode(districtCode) {
    const text = String(districtCode);
    if (!DISTRICT_CODE.test(text)) {
        throw new Error(
            `district code must be 4 digits to yield a province code, received: ${districtCode}`,
        );
    }
    return Math.floor(Number(text) / 100);
}

/**
 * Upstream shape -> our shape.
 *
 * Returns `warnings` for things that are survivable and reports them rather
 * than hiding them; throws for things that would corrupt the hierarchy.
 */
function transformLocations(source) {
    const warnings = [];
    const live = (rows) => (rows || []).filter((row) => !row.deleted_at);

    const srcProvinces = live(source.provinces);
    const srcDistricts = live(source.districts);
    const srcSubDistricts = live(source.subDistricts);

    // Province code comes from that province's districts, not from its own id.
    const provinceCodeByUpstreamId = new Map();
    for (const district of srcDistricts) {
        const code = deriveProvinceCode(district.id);
        const seen = provinceCodeByUpstreamId.get(district.province_id);
        if (seen !== undefined && seen !== code) {
            throw new Error(
                `province ${district.province_id} yields conflicting DOPA codes ${seen} and ${code}`,
            );
        }
        provinceCodeByUpstreamId.set(district.province_id, code);
    }

    const provinces = [];
    for (const province of srcProvinces) {
        const code = provinceCodeByUpstreamId.get(province.id);
        if (code === undefined) {
            // No districts means no way to place it. A province in the dropdown
            // that resolves to nothing is worse than one that is absent.
            warnings.push(`province has no districts, cannot derive a DOPA code, skipped: ${province.name_th}`);
            continue;
        }
        provinces.push({ code, nameTh: province.name_th, nameEn: province.name_en });
    }

    // A district with no subdistricts is a dead end in the address flow: the
    // applicant picks it and the ตำบล dropdown is empty. Upstream carries two
    // such entries (ท้องถิ่นเทศบาลตำบล…) which are municipality registration
    // units overlaying an existing tambon rather than อำเภอ anyone would
    // select. Drop them, but report each one — a district disappearing
    // silently is how a real address becomes unreachable.
    const subDistrictCountByDistrict = new Map();
    for (const sub of srcSubDistricts) {
        const key = Number(sub.district_id);
        subDistrictCountByDistrict.set(key, (subDistrictCountByDistrict.get(key) || 0) + 1);
    }

    const districts = [];
    for (const district of srcDistricts) {
        if (!subDistrictCountByDistrict.has(Number(district.id))) {
            warnings.push(`district has no subdistricts, skipped: ${district.name_th} (${district.id})`);
            continue;
        }
        districts.push({
            code: Number(district.id),
            provinceCode: deriveProvinceCode(district.id),
            nameTh: district.name_th,
            nameEn: district.name_en,
        });
    }

    const districtCodes = new Set(districts.map((d) => d.code));
    const subDistricts = srcSubDistricts.map((sub) => {
        if (!districtCodes.has(Number(sub.district_id))) {
            throw new Error(
                `subdistrict ${sub.id} (${sub.name_th}) references a district that does not exist: ${sub.district_id}`,
            );
        }
        return {
            code: Number(sub.id),
            districtCode: Number(sub.district_id),
            // String, so a postal code beginning with zero survives.
            postalCode: String(sub.zip_code).padStart(5, '0'),
            nameTh: sub.name_th,
            nameEn: sub.name_en,
        };
    });

    return { provinces, districts, subDistricts, warnings };
}

/**
 * Structural checks over the normalised data.
 *
 * This is what stands in for an authority. The dataset is community
 * maintained, so nothing guarantees a future update is coherent — these
 * assertions are the guarantee. Returns a list of problems; empty means clean.
 */
function validateLocations(data) {
    const errors = [];

    const checkDuplicates = (rows, label) => {
        const seen = new Set();
        for (const row of rows) {
            if (seen.has(row.code)) {
                errors.push(`duplicate ${label} code: ${row.code}`);
            }
            seen.add(row.code);
        }
        return seen;
    };

    const provinceCodes = checkDuplicates(data.provinces, 'province');
    const districtCodes = checkDuplicates(data.districts, 'district');
    checkDuplicates(data.subDistricts, 'subdistrict');

    for (const province of data.provinces) {
        if (!province.nameTh) {errors.push(`province ${province.code} has no Thai name`);}
    }

    for (const district of data.districts) {
        if (!district.nameTh) {errors.push(`district ${district.code} has no Thai name`);}
        if (!provinceCodes.has(district.provinceCode)) {
            errors.push(`district ${district.code} references an unknown province: ${district.provinceCode}`);
        }
    }

    for (const sub of data.subDistricts) {
        if (!sub.nameTh) {errors.push(`subdistrict ${sub.code} has no Thai name`);}
        if (!districtCodes.has(sub.districtCode)) {
            errors.push(`subdistrict ${sub.code} references an unknown district: ${sub.districtCode}`);
        }
        if (!POSTAL_CODE.test(sub.postalCode)) {
            errors.push(`subdistrict ${sub.code} has a malformed postal code: ${sub.postalCode}`);
        }
        if (!SUBDISTRICT_CODE.test(String(sub.code))) {
            errors.push(`subdistrict code is not 6 digits: ${sub.code}`);
        } else if (!String(sub.code).startsWith(String(sub.districtCode))) {
            // A DOPA subdistrict code always begins with its district code.
            // Both rows can look valid alone while the hierarchy is broken.
            errors.push(
                `subdistrict ${sub.code} does not sit under district ${sub.districtCode} (code prefix mismatch)`,
            );
        }
    }

    return errors;
}

module.exports = { deriveProvinceCode, transformLocations, validateLocations };
