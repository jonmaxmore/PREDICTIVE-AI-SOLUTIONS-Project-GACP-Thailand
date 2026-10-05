'use strict';

/**
 * plant-species-service.js — the ONE plant resolver (F-G4-59).
 *
 * Callers hold a plant reference in one of two vocabularies: the wizard slug
 * ('cannabis', 'black_galangal', ...) or the plant_species master code ('CAN', 'GAL',
 * ...). Both resolve here to the master row; the slug goes through
 * config/plant-species-slugs.js, the code is looked up as itself. Input is trimmed and
 * case-insensitive. An unknown reference answers null; the database is asked only for
 * text, so a null / undefined / object reference never reaches Prisma.
 *
 * A plant an admin has deactivated (isActive false, routes/api/admin/plants.js PATCH)
 * or soft-deleted (isDeleted true) answers null as well: a retired plant is no longer
 * a plant a certificate, a revision, or a document checklist may name. The status is
 * judged on the row Prisma returns, so an injected client or transaction is honoured
 * the same way the default client is; prisma/schema/trace.prisma declares both flags
 * non-null with defaults, so a real row always carries them.
 *
 * A database error is not an unknown reference and is left to propagate.
 */

const { prisma } = require('./prisma-database');
const { PLANT_SLUG_TO_CODE } = require('../config/plant-species-slugs');

/**
 * Normalise a plant reference to a master code candidate.
 * @param {unknown} ref wizard slug or master code
 * @returns {string|null} the master code to look up, or null when ref is not text
 */
function toMasterCode(ref) {
    if (typeof ref !== 'string') {
        return null;
    }
    const trimmed = ref.trim();
    if (!trimmed) {
        return null;
    }
    const fromSlug = PLANT_SLUG_TO_CODE[trimmed.toLowerCase()];
    if (fromSlug) {
        return fromSlug;
    }
    // Master codes are upper-case by seed convention (prisma/seed-plants.js). Whether
    // the code exists is the table's answer, so a newly seeded plant resolves without
    // this file learning about it.
    return trimmed.toUpperCase();
}

/**
 * Whether a plant_species row has been taken out of service by an admin: deactivated
 * (isActive false) or soft-deleted (isDeleted true). Both flags are non-null in the
 * schema, so a real row always answers this exactly.
 * @param {{ isActive?: boolean, isDeleted?: boolean }} row a plant_species row
 * @returns {boolean}
 */
function isRetiredPlant(row) {
    return row.isActive === false || row.isDeleted === true;
}

/**
 * Resolve a plant reference to its live plant_species row.
 * @param {unknown} ref wizard slug ('cannabis') or master code ('CAN'); trimmed, case-insensitive
 * @param {{ client?: { plantSpecies: { findUnique: Function } } }} [options] Prisma client or tx
 * @returns {Promise<object|null>} the PlantSpecies row, or null when nothing matches or
 *   the matching row is deactivated / soft-deleted
 */
async function resolvePlantSpecies(ref, { client = prisma } = {}) {
    const code = toMasterCode(ref);
    if (!code) {
        return null;
    }
    const row = await client.plantSpecies.findUnique({ where: { code } });
    if (!row || isRetiredPlant(row)) {
        return null;
    }
    return row;
}

function nonBlank(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
}

/**
 * The register name of a plant: nameTH first, nameEN only when nameTH is blank.
 * @param {{ nameTH?: string|null, nameEN?: string|null }|null|undefined} row
 * @returns {string|null} null when neither name exists; never a placeholder
 */
function plantDisplayName(row) {
    if (!row || typeof row !== 'object') {
        return null;
    }
    return nonBlank(row.nameTH) || nonBlank(row.nameEN);
}

module.exports = { resolvePlantSpecies, plantDisplayName };
