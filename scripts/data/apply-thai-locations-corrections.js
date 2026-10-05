#!/usr/bin/env node
/**
 * Apply the reviewed corrections in apps/backend/data/thai-locations-corrections.js
 * to the shipped dataset, in place.
 *
 * Usage: node scripts/data/apply-thai-locations-corrections.js [--check]
 *
 * `--check` reports what would change and writes nothing, which is how CI
 * asserts that the file in the repo is the corrected artifact rather than a
 * stale one that merely has a corrections file sitting next to it.
 *
 * The dataset is the source of truth in this repo — it is not regenerated from
 * anything external, and nothing downloads reference data at build or run time.
 * That is deliberate: a foreign host in the path of a Thai government service
 * is a dependency this repo has removed everywhere else it appeared.
 *
 * Writes nothing if validation fails.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { corrections, applyCorrections } = require('../../apps/backend/data/thai-locations-corrections');
const { validateLocations } = require('../../apps/backend/data/thai-locations-transform');

const DATA = path.join(__dirname, '..', '..', 'apps', 'backend', 'data', 'thai-locations-data.json');

function main() {
    const checkOnly = process.argv.includes('--check');
    const current = JSON.parse(fs.readFileSync(DATA, 'utf8'));

    // A correction whose "before" no longer matches throws here rather than
    // being skipped, so a dataset that drifted fails loudly.
    const { data, applied } = applyCorrections(current, corrections);

    if (applied.length === 0) {
        console.log('[thai-locations] no corrections pending — data already matches the correction set.');
        return 0;
    }

    for (const line of applied) console.log(`[thai-locations] ${line}`);

    const errors = validateLocations(data);
    if (errors.length > 0) {
        console.error(`[thai-locations] FAIL - ${errors.length} validation error(s) after correcting, nothing written:`);
        for (const error of errors.slice(0, 20)) console.error(`  ${error}`);
        return 1;
    }

    if (checkOnly) {
        console.error(`[thai-locations] FAIL - ${applied.length} correction(s) are not present in the shipped data.`);
        console.error('  Run: node scripts/data/apply-thai-locations-corrections.js');
        return 1;
    }

    fs.writeFileSync(DATA, JSON.stringify(data));
    console.log(`[thai-locations] OK - ${applied.length} correction(s) applied to ${path.relative(process.cwd(), DATA)}`);
    return 0;
}

try {
    process.exit(main());
} catch (error) {
    console.error('[thai-locations] runtime error:', error.message);
    process.exit(2);
}
