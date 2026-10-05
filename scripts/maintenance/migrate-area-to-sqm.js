#!/usr/bin/env node
/**
 * Convert every stored area to square metres.
 *
 * The platform now collects, stores and displays one unit. Rows written before
 * that still carry `areaUnit: 'rai'` (Prisma's old column default) or 'ngan' or
 * 'sqwa', and the number beside them is in that unit. Application code reads
 * them correctly — `shared/area-utils.storedAreaToSqm` exists for exactly this
 * — but every read path that has to remember to convert is a read path that can
 * forget, and one already had: `Farm.areaUnit` was never written at all, so a
 * farmer who typed 1,600 ตร.ม. got a certified farm of 1,600 rai.
 *
 * After this has run against an environment, `area` means square metres in
 * every row and `areaUnit` says 'sqm' everywhere. The legacy table in
 * area-utils.js can then be deleted.
 *
 * Usage:
 *   node scripts/maintenance/migrate-area-to-sqm.js            # report only
 *   node scripts/maintenance/migrate-area-to-sqm.js --apply    # convert
 *
 * Safe to re-run: a row already saying 'sqm' is skipped, so a partial run can
 * simply be repeated.
 */

const path = require('path');

const backend = path.resolve(__dirname, '..', '..', 'apps', 'backend');
const { prisma } = require(path.join(backend, 'services', 'prisma-database'));
const {
    AREA_UNIT,
    LEGACY_UNIT_TO_SQM,
    storedAreaToSqm,
    isLegacyAreaUnit,
} = require(path.join(backend, 'shared', 'area-utils'));

/**
 * Every table that stores an area with its own unit.
 *
 * `areaFields` are the columns measured in `unitField`. Farm carries two areas
 * under one unit, which is why this is a list rather than a single name.
 */
const TABLES = [
    { model: 'farm', unitField: 'areaUnit', areaFields: ['totalArea', 'cultivationArea'] },
    { model: 'plot', unitField: 'areaUnit', areaFields: ['area'] },
    { model: 'plantingCycle', unitField: 'areaUnit', areaFields: ['plotArea'] },
    { model: 'harvestBatch', unitField: 'areaUnit', areaFields: ['plotArea'] },
];

const apply = process.argv.includes('--apply');

async function migrateTable({ model, unitField, areaFields }) {
    const delegate = prisma[model];
    if (!delegate) {
        return { model, skipped: 'no such model on this client', converted: 0, unknown: [] };
    }

    const rows = await delegate.findMany({
        select: Object.fromEntries(
            ['id', unitField, ...areaFields].map((field) => [field, true]),
        ),
    });

    let converted = 0;
    const unknown = [];

    for (const row of rows) {
        const unit = row[unitField];
        if (!isLegacyAreaUnit(unit)) {
            // Already square metres, or a unit nothing here can read. The
            // second is reported rather than guessed at — converting a row we
            // do not understand is how a farm silently changes size.
            if (unit && String(unit).trim().toLowerCase() !== AREA_UNIT && !(String(unit).trim().toLowerCase() in LEGACY_UNIT_TO_SQM)) {
                unknown.push({ id: row.id, unit });
            }
            continue;
        }

        const data = { [unitField]: AREA_UNIT };
        for (const field of areaFields) {
            if (row[field] === null || row[field] === undefined) continue;
            data[field] = storedAreaToSqm(row[field], unit);
        }

        if (apply) {
            await delegate.update({ where: { id: row.id }, data });
        }
        converted += 1;
    }

    return { model, converted, unknown, total: rows.length };
}

async function main() {
    console.log(apply
        ? 'Converting stored areas to square metres.'
        : 'Reporting only. Re-run with --apply to convert.');
    console.log('');

    let totalConverted = 0;
    let totalUnknown = 0;

    for (const table of TABLES) {
        const result = await migrateTable(table);
        if (result.skipped) {
            console.log(`  ${result.model}: skipped — ${result.skipped}`);
            continue;
        }

        console.log(`  ${result.model}: ${result.converted} of ${result.total} row(s) to convert`);
        totalConverted += result.converted;

        for (const row of result.unknown) {
            console.log(`    ! ${row.id} has areaUnit "${row.unit}", which nothing can read — fix by hand`);
            totalUnknown += 1;
        }
    }

    console.log('');
    if (totalUnknown > 0) {
        console.log(`${totalUnknown} row(s) carry a unit this migration does not understand. They were left alone.`);
    }
    if (!apply && totalConverted > 0) {
        console.log(`Re-run with --apply to convert ${totalConverted} row(s).`);
    }
    if (apply) {
        console.log(`Converted ${totalConverted} row(s).`);
    }

    // A clean report — nothing left to convert and nothing unreadable — is what
    // says the legacy table in area-utils.js can be deleted.
    process.exit(totalUnknown > 0 ? 1 : 0);
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
