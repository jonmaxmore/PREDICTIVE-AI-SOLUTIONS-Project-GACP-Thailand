/**
 * Area on this platform is square metres. Everywhere, without exception.
 *
 * It used to be a number plus a unit picked from a dropdown — rai, ngan, square
 * wa, square metres — which meant every read site had to remember to convert,
 * and the two modules that did the converting disagreed about what an *absent*
 * unit meant: this one read it as square metres, config/plant-density read it
 * as rai. The same row, read by two paths, was 1,600 square metres or one, and
 * that number sets a farm's legal plant cap.
 *
 * Nothing writes anything but 'sqm' now, and nothing offers a choice. What
 * remains here is the ability to read a row written before the switch, because
 * `{ area: 5, areaUnit: 'rai' }` in the database still means eight thousand
 * square metres and will keep meaning that after the code has forgotten what
 * rai was.
 *
 * That reader refuses to guess. An unrecognised or absent unit throws instead
 * of quietly returning a farm 1,600 times too small — an error page is
 * recoverable, a wrong plant cap on a controlled crop is not.
 *
 * scripts/maintenance/migrate-area-to-sqm.js converts stored rows, and migration
 * 20260826090000_area_sqm_and_cultivation_scope_expand moves the converted number
 * into a column that carries its unit in its name: Plot.areaSqm. Once that
 * migration has run everywhere and the contract half has dropped `area` +
 * `areaUnit`, LEGACY_UNIT_TO_SQM, storedAreaToSqm and plotAreaSqm below can all
 * be deleted and callers can read `areaSqm` directly.
 */

/** The only unit the platform uses. */
const AREA_UNIT = 'sqm';

/** How it is shown to a Thai reader. Every area label in the UI is this. */
const AREA_UNIT_LABEL_TH = 'ตร.ม.';

/**
 * Square metres per unit, for rows written before the switch.
 *
 * The spellings are the ones that actually reached the database: the API wrote
 * lowercase, the web wizard wrote 'Rai'/'Ngan'/'Sqm', and at least one form
 * posted the Thai word. Lookup lowercases first, so only genuinely distinct
 * spellings are listed.
 */
const LEGACY_UNIT_TO_SQM = Object.freeze({
    sqm: 1,
    rai: 1600,
    ngan: 400,
    sqwa: 4,
    square_wa: 4,
    squarewa: 4,
    sqw: 4,
    wa2: 4,
    'ตารางวา': 4,
    'ตารางเมตร': 1,
    'ไร่': 1600,
    'งาน': 400,
});

function canonicalise(unit) {
    return String(unit == null ? '' : unit).trim().toLowerCase();
}

/**
 * Read a stored area as square metres.
 *
 * @param {number|string|null} area  the stored number; Prisma Decimal arrives as a string
 * @param {string} storedUnit        the row's own areaUnit — never a default supplied by the caller
 * @returns {number} square metres
 * @throws if the unit is absent or unrecognised
 */
function storedAreaToSqm(area, storedUnit) {
    const unit = canonicalise(storedUnit);

    if (!unit) {
        throw new Error(
            'area has no unit, so it cannot be read. A row with a number and no unit is '
            + 'ambiguous by a factor of 1,600; supply the row\'s own areaUnit rather than a '
            + 'default. Run scripts/maintenance/migrate-area-to-sqm.js to normalise stored rows.',
        );
    }

    const ratio = LEGACY_UNIT_TO_SQM[unit];
    if (ratio === undefined) {
        throw new Error(
            `unknown area unit "${storedUnit}". The platform stores square metres; the only other `
            + `units it can read are ${Object.keys(LEGACY_UNIT_TO_SQM).join(', ')}. `
            + 'Run scripts/maintenance/migrate-area-to-sqm.js to normalise stored rows.',
        );
    }

    const value = Number(area || 0);
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    return value * ratio;
}

/**
 * Read a plot's size in square metres.
 *
 * `Plot.areaSqm` is the column that says what it holds. `Plot.area` +
 * `Plot.areaUnit` are the pair it replaces (migration
 * 20260826090000_area_sqm_and_cultivation_scope_expand): still written, still
 * readable, and still the only size a row carries when it was written by a
 * process running the previous image, or when the backfill refused to read its
 * unit and left areaSqm NULL rather than guess.
 *
 * The fallback keeps that refusal — an unreadable unit throws here exactly as it
 * did before, instead of quietly returning a plot 1,600 times too small.
 *
 * DELETE THIS FUNCTION in the contract change, once `plots."area"` and
 * `plots."areaUnit"` are dropped: every caller then reads `plot.areaSqm`
 * directly and there is nothing left to fall back to.
 *
 * @param {{ areaSqm?: number|string|null, area?: number|string|null, areaUnit?: string|null }} plot
 * @returns {number} square metres
 */
function plotAreaSqm(plot) {
    // `> 0`, and the null test before it, are both load-bearing. `Number(null)` is 0, which
    // is finite and >= 0 — so a `>= 0` test answered 0 square metres for exactly the rows
    // this fallback exists to serve: a plot the backfill left NULL because it could not read
    // its unit, and any plot written by an image still serving traffic mid-deploy. The plot
    // then reads as zero-area everywhere downstream instead of falling back to area+areaUnit,
    // silently and with no error to notice. The frontend twin (apps/web-app/src/lib/area.ts)
    // already used `> 0`; the asymmetry was the tell.
    //
    // A stored 0 is treated as "nothing stored" on purpose: a plot of zero square metres is
    // not a measurement, and falling back costs nothing when there is genuinely nothing to
    // fall back to.
    const stored = plot?.areaSqm == null ? NaN : Number(plot.areaSqm);
    if (Number.isFinite(stored) && stored > 0) {
        return stored;
    }
    return storedAreaToSqm(plot?.area, plot?.areaUnit);
}

/** Is this a unit the migration still has to convert? */
function isLegacyAreaUnit(unit) {
    const canonical = canonicalise(unit);
    return Boolean(canonical) && canonical !== AREA_UNIT && canonical in LEGACY_UNIT_TO_SQM;
}

module.exports = {
    AREA_UNIT,
    AREA_UNIT_LABEL_TH,
    LEGACY_UNIT_TO_SQM,
    storedAreaToSqm,
    plotAreaSqm,
    isLegacyAreaUnit,
};
