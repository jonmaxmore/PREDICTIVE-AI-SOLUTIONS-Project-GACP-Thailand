#!/usr/bin/env node
/**
 * Rebuild apps/backend/data/thai-locations-data.json from a fresh extract.
 *
 * Usage: node scripts/data/build-thai-locations.js <dir-with>/province.json
 *
 * For the day DTAM or DOPA supplies an official extract. Day to day the JSON in
 * this repo IS the source of truth and nothing regenerates it — see
 * apps/backend/data/source/PROVENANCE.md.
 *
 * Deliberately takes a local path rather than a URL: this repo does not fetch
 * reference data at build time, because that would put a foreign host in the
 * path of a Thai government service. Checksums of whatever you point it at are
 * printed so the rebuild can be recorded.
 *
 * Writes nothing if validation fails — a dataset with an orphan reference or a
 * duplicate code would ship farm addresses that resolve to nothing. After a
 * rebuild, run scripts/data/apply-thai-locations-corrections.js: a fresh
 * extract does not carry the corrections recorded in this repo.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
    transformLocations,
    validateLocations,
} = require('../../apps/backend/data/thai-locations-transform');

const OUTPUT = path.join(__dirname, '..', '..', 'apps', 'backend', 'data', 'thai-locations-data.json');
const SOURCE_FILES = ['province.json', 'district.json', 'sub_district.json'];

function main() {
    const sourceDir = process.argv[2];
    if (!sourceDir) {
        console.error('usage: node scripts/data/build-thai-locations.js <path-to>/api/latest');
        return 2;
    }

    const read = (file) => JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8'));

    console.log('[thai-locations] source checksums (record these in PROVENANCE.md):');
    for (const file of SOURCE_FILES) {
        const bytes = fs.readFileSync(path.join(sourceDir, file));
        console.log(`  ${crypto.createHash('sha256').update(bytes).digest('hex')}  ${file}`);
    }

    const result = transformLocations({
        provinces: read('province.json'),
        districts: read('district.json'),
        subDistricts: read('sub_district.json'),
    });

    for (const warning of result.warnings) {
        console.warn(`[thai-locations] WARNING ${warning}`);
    }

    const errors = validateLocations(result);
    if (errors.length > 0) {
        console.error(`[thai-locations] FAIL - ${errors.length} validation error(s), nothing written:`);
        for (const error of errors.slice(0, 20)) console.error(`  ${error}`);
        return 1;
    }

    fs.writeFileSync(OUTPUT, JSON.stringify({
        provinces: result.provinces,
        districts: result.districts,
        subDistricts: result.subDistricts,
    }));

    console.log(`[thai-locations] OK - ${result.provinces.length} provinces, ${result.districts.length} districts, ${result.subDistricts.length} subdistricts`);
    console.log(`[thai-locations] written: ${path.relative(process.cwd(), OUTPUT)}`);
    return 0;
}

try {
    process.exit(main());
} catch (error) {
    console.error('[thai-locations] runtime error:', error.message);
    process.exit(2);
}
