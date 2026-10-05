#!/usr/bin/env node
/**
 * Dataset coherence check - the shipped Thai administrative dataset must stay
 * coherent.
 *
 * How this runs (2026-08-14): nothing runs it automatically. Its only invoker
 * was `.github/workflows/ci.yml:66` and GitHub Actions is permanently
 * unavailable (the change log 2026-08-14); there is no `pnpm check:` alias and
 * no row in scripts/ci/full-gate-checks.txt or local-gate.sh. The dataset is
 * community-maintained, so this is precisely the drift nobody would notice by
 * hand — run `node scripts/ci/check-thai-locations.js` after any data update.
 *
 * The address fields on a GACP application are what an auditor drives to. The
 * data behind them is community-maintained rather than DOPA-attested (see
 * apps/backend/data/source/PROVENANCE.md), so nothing external guarantees a
 * future update is sound. These assertions are the guarantee.
 *
 * Exit codes: 0 clean, 1 violation, 2 runtime error.
 */

'use strict';

const { validateLocations } = require('../../apps/backend/data/thai-locations-transform');
const locations = require('../../apps/backend/data/thai-locations');

// Thailand's real counts. A silent shrink is the failure this catches: a
// truncated import still looks like valid data, and simply loses provinces.
//
// 928 districts, not the 930 rows upstream ships: two of those are
// ท้องถิ่นเทศบาลตำบล… municipality registration units with no ตำบล beneath
// them, which the build drops because an applicant who picked one would face
// an empty ตำบล dropdown. 928 is the real number of อำเภอ/เขต in Thailand.
const EXPECTED = { provinces: 77, districts: 928, subDistricts: 7467 };

function main() {
    const data = {
        provinces: locations.provinces.map((p) => ({ code: p.id, nameTh: p.name_th, nameEn: p.name_en })),
        districts: locations.districts.map((d) => ({
            code: d.id, provinceCode: d.province_id, nameTh: d.name_th, nameEn: d.name_en,
        })),
        subDistricts: locations.subDistricts.map((s) => ({
            code: s.id, districtCode: s.district_id, postalCode: s.zip, nameTh: s.name_th, nameEn: s.name_en,
        })),
    };

    const errors = validateLocations(data);

    for (const [level, expected] of Object.entries(EXPECTED)) {
        const actual = data[level].length;
        if (actual !== expected) {
            errors.push(`${level}: expected ${expected} records, found ${actual}`);
        }
    }

    // Every province must offer at least one district, or its dropdown is a
    // dead end - the exact defect this dataset replaced.
    for (const province of data.provinces) {
        if (locations.getDistrictsByProvince(province.code).length === 0) {
            errors.push(`province ${province.nameTh} (${province.code}) has no districts`);
        }
    }
    for (const district of data.districts) {
        if (locations.getSubDistrictsByDistrict(district.code).length === 0) {
            errors.push(`district ${district.nameTh} (${district.code}) has no subdistricts`);
        }
    }

    if (errors.length === 0) {
        console.log(`[thai-locations] OK - ${data.provinces.length} provinces, ${data.districts.length} districts, ${data.subDistricts.length} subdistricts, all reachable.`);
        return 0;
    }

    console.error(`[thai-locations] FAIL - ${errors.length} problem(s):`);
    for (const error of errors.slice(0, 25)) console.error(`  ${error}`);
    console.error('');
    console.error('See apps/backend/data/source/PROVENANCE.md before changing this data.');
    return 1;
}

try {
    process.exit(main());
} catch (error) {
    console.error('[thai-locations] runtime error:', error.message);
    process.exit(2);
}
