/**
 * Area on this platform is square metres. This is every sum the UI does with it.
 *
 * It used to compare plot areas against the farm area by converting everything
 * to rai — `convertToRai(size, plot.areaUnit || 'Rai')` — while the form
 * defaulted every new plot and the farm total to `'Sqm'`. The fallback
 * contradicted the default it existed to cover, and the summary line above the
 * plot list printed the rai figure with a ตร.ม. suffix, so a 1,600 m² plot was
 * reported to the farmer as "1 ตร.ม.".
 *
 * With one unit there is nothing to convert, which is the point.
 */

/** How square metres are labelled everywhere in the UI. */
export const AREA_UNIT_LABEL = 'ตร.ม.';

interface PlotAreaLike {
    areaSize?: string | number | null;
}

interface FarmAreaLike {
    totalAreaSize?: string | number | null;
}

/**
 * A number typed into a form field, or 0 if it is not a usable area.
 *
 * Blank, junk and negative all become 0 rather than NaN: a NaN total silently
 * disables the over-allocation check below, because every comparison against
 * NaN is false.
 */
function areaValue(input: string | number | null | undefined): number {
    const value = typeof input === 'number' ? input : parseFloat(String(input ?? ''));
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value;
}

/** Square metres across every plot the farmer has added. */
export function plotAreaTotalSqm(plots: ReadonlyArray<PlotAreaLike> | null | undefined): number {
    return (plots || []).reduce((total, plot) => total + areaValue(plot?.areaSize), 0);
}

/** Square metres the farmer gave as the farm's total. */
export function farmAreaSqm(formData: FarmAreaLike | null | undefined): number {
    return areaValue(formData?.totalAreaSize);
}

/**
 * Do the plots claim more land than the farm has?
 *
 * The tolerance is for floating-point dust, not for slack: three plots of 0.1
 * sum to 0.30000000000000004, and reporting that as an overrun of a 0.3 farm
 * would block a correct form with a message the farmer cannot act on.
 */
export function plotsExceedFarmArea(totalPlotSqm: number, totalFarmSqm: number): boolean {
    // Zero means "not filled in yet". The farm total is required and validated
    // on its own; complaining here would show the wrong message first.
    if (totalFarmSqm <= 0) return false;
    return totalPlotSqm - totalFarmSqm > 0.0001;
}

/**
 * An area, written the way a Thai reader expects to see it.
 *
 * Two decimals at most, and none at all when the number is whole — a farm of
 * 1,600 m² should read "1,600", not "1,600.00".
 */
export function formatAreaSqm(sqm: number): string {
    if (!Number.isFinite(sqm)) return '0';
    return sqm.toLocaleString('th-TH', { maximumFractionDigits: 2 });
}

/**
 * Square metres per unit, for rows written before the switch.
 *
 * The API converts on the way out, so a client should normally never see one of
 * these. Until scripts/maintenance/migrate-area-to-sqm.js has run against every
 * environment, a raw row can still carry `rai`, and rendering 5 rai as "5
 * ตร.ม." would understate a farm by a factor of 1,600 on the page a DTAM
 * officer reads.
 */
const LEGACY_RATIOS: Record<string, number> = {
    sqm: 1,
    rai: 1600,
    ngan: 400,
    sqwa: 4,
    // Some submissions recorded the Thai word rather than the code. These
    // mirror apps/backend/shared/area-utils.js — the two tables have to agree,
    // or the same row reads differently on the page and in the database.
    'ตารางเมตร': 1,
    'ตารางวา': 4,
    'ไร่': 1600,
    'งาน': 400,
};

/**
 * Read a possibly-legacy stored area as square metres.
 *
 * Unlike the backend reader, this one cannot throw — it is rendering a number
 * onto a page. An absent or unrecognised unit is read as square metres, which
 * is what the API now sends and the only defensible reading of a value that has
 * already been normalised.
 */
export function legacyAreaToSqm(area: number | string | null | undefined, unit?: string | null): number {
    const value = areaValue(area);
    const ratio = LEGACY_RATIOS[String(unit ?? '').trim().toLowerCase()] ?? 1;
    return value * ratio;
}

interface StoredPlotArea {
    areaSqm?: number | string | null;
    area?: number | string | null;
    areaUnit?: string | null;
}

/**
 * A plot's size in square metres, as the API sends it during the expand window.
 *
 * `areaSqm` is the column that says what it holds. `area` + `areaUnit` are the
 * pair it replaces (backend migration
 * 20260826090000_area_sqm_and_cultivation_scope_expand): still sent, still
 * correct, and still the only size on a row written by a process serving the
 * previous image, or on one whose stored unit the backfill refused to read.
 *
 * DELETE THIS FUNCTION and read `plot.areaSqm` directly once the contract
 * migration drops `area` and `areaUnit` and they leave the API payload.
 */
export function plotAreaSqm(plot: StoredPlotArea | null | undefined): number {
    const stored = areaValue(plot?.areaSqm);
    if (stored > 0) return stored;
    return legacyAreaToSqm(plot?.area, plot?.areaUnit);
}

/**
 * Plants per square metre by cultivation method.
 *
 * These are the numbers `apps/backend/config/plant-density.js` enforces. They
 * used to be duplicated here with a different fallback — 1 instead of the
 * outdoor 2.5 — so the wizard suggested a count the backend would have allowed
 * anyway, always low, with nothing on screen to explain the difference.
 */
export const PLANT_DENSITY_PER_SQM = {
    OUTDOOR: 2.5,
    GREENHOUSE: 5,
    INDOOR: 8,
    INDOOR_CONTROLLED: 8,
} as const satisfies Record<string, number>;

type CultivationMethod = keyof typeof PLANT_DENSITY_PER_SQM;

/** The suggested plant count for an area, never above what the backend allows. */
export function suggestPlantCount(areaSqm: number, method: string): number {
    const key = String(method || '').toUpperCase() as CultivationMethod;
    const density = PLANT_DENSITY_PER_SQM[key] ?? PLANT_DENSITY_PER_SQM.OUTDOOR;
    return Math.floor(areaValue(areaSqm) * density);
}
