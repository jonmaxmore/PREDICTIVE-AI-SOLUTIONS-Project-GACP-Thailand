'use strict';

/**
 * A coordinate is either a finite number or NOTHING. There is no third value.
 *
 * WHY THIS FILE EXISTS
 *   Two writers of Farm.latitude/longitude were found on 2026-08-27, and neither said
 *   "missing" honestly:
 *
 *     parseFloat(farmData.gpsLat || 0)      — application-submission-methods.js
 *
 *   turns an absent coordinate into 0, and 0°N 0°E is a real point in the Gulf of Guinea.
 *   Every reader downstream — the GPS check-in tolerance, the per-photo distance the
 *   provenance layer records — would then compare a Thai farm against West Africa and
 *   report it 9,000 km off, with complete confidence. The other writer, certificate
 *   issuance, simply did not carry the coordinates at all, so a farm that had given its
 *   position in the wizard was minted with none (F-G4-33: the walk's farm had
 *   gpsLat/gpsLng in formData and NULL on the row).
 *
 *   A wrong number and a missing number must never look the same. NULL is the only
 *   honest spelling of "the farmer did not tell us".
 *
 * WHAT IT DOES NOT DO
 *   It does not decide whether a coordinate is inside Thailand — that is a UI concern
 *   (apps/web-app checkThaiCoordinates) and a policy the field app enforces with a
 *   tolerance, not a parser's job. It only refuses to invent a number.
 */

/**
 * @param {unknown} value a string from a form, a number from a row, or nothing
 * @returns {number|null} the coordinate, or null when there is no finite number here
 */
function parseCoordinate(value) {
    if (value === null || value === undefined) { return null; }
    if (typeof value === 'string' && value.trim() === '') { return null; }
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
}

/**
 * Both halves or neither — a farm with a latitude and no longitude is not "half located",
 * it is unlocated, and storing one half invites a reader to pair it with 0.
 *
 * @param {{ gpsLat?: unknown, gpsLng?: unknown, latitude?: unknown, longitude?: unknown }} source
 * @returns {{ latitude: number|null, longitude: number|null }}
 */
function coordinatePairFrom(source) {
    const latitude = parseCoordinate(source?.gpsLat ?? source?.latitude);
    const longitude = parseCoordinate(source?.gpsLng ?? source?.longitude);
    if (latitude === null || longitude === null) {
        return { latitude: null, longitude: null };
    }
    return { latitude, longitude };
}

module.exports = { parseCoordinate, coordinatePairFrom };
