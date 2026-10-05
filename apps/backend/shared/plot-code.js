'use strict';

/**
 * The permanent identifier of a piece of land.
 *
 * มกษ. 3502-2561 ข้อ 8(1) requires recording "รหัสแปลงปลูกและข้อมูลประจำแปลงปลูก" — a plot
 * code and per-plot data (docs/standards/tas-3502-2561-records-and-traceability.md). Until
 * now the platform had none: the trace QR hangs off PlantingCyclePlot, which is unique per
 * (cycle, plot), so the code was reborn every season. That made two things impossible — a
 * sign that can stay in the field across seasons, and detecting the same land being
 * registered twice, which is the control that stops one certificate covering someone else's
 * crop.
 *
 * The format answers to two constraints that pull against each other.
 *
 * A person has to be able to read it. The sign lives outdoors and will fade, split and get
 * splashed with mud. When the QR stops scanning, the farmer reads the code down a phone or
 * types it in. So the alphabet drops every pair that gets confused on a weathered label —
 * 0/O, 1/I/L — and U as well, which is the Crockford convention and keeps accidental
 * profanity out of a code someone has to say out loud. Uppercase only, grouped in fives.
 *
 * Nobody may enumerate it. The plot page is public and needs no login. A sequential code
 * would hand anyone a walk through every plot in the country, and for cannabis that is a map
 * of where the crop is standing. So the payload is 10 random characters from a 30-character
 * alphabet — about 9.3e14 codes — drawn from the crypto RNG, not from a counter or a clock.
 *
 * Rejection sampling rather than a modulo: 256 does not divide 30 evenly, and taking the
 * remainder would make the first six letters of the alphabet measurably more common. The
 * bias would be small and completely invisible, which is exactly the kind of flaw that
 * survives for years.
 */

const crypto = require('crypto');

// Crockford base32 minus I, L, O, U.
const PLOT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const PLOT_CODE_PREFIX = 'PLOT';
const GROUP_LENGTH = 5;
const GROUPS = 2;
const PAYLOAD_LENGTH = GROUP_LENGTH * GROUPS;

const PLOT_CODE_PATTERN = new RegExp(
    `^${PLOT_CODE_PREFIX}-[${PLOT_CODE_ALPHABET}]{${GROUP_LENGTH}}-[${PLOT_CODE_ALPHABET}]{${GROUP_LENGTH}}$`,
);

/**
 * One uniformly-distributed character from the alphabet.
 *
 * The largest multiple of the alphabet size that fits in a byte is the cutoff; bytes above
 * it are discarded and redrawn. Roughly 6% of draws are thrown away, which costs nothing and
 * buys an even distribution.
 */
function randomChar() {
    const size = PLOT_CODE_ALPHABET.length;
    const limit = Math.floor(256 / size) * size;
    for (;;) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < limit) {
            return PLOT_CODE_ALPHABET[byte % size];
        }
    }
}

/**
 * Mint a plot code. Uniqueness is enforced by the database, not here — a generator that
 * promised uniqueness would be lying, since it cannot see the table.
 *
 * @returns {string} e.g. "PLOT-7F2KX-M9QRT"
 */
function generatePlotCode() {
    let payload = '';
    for (let i = 0; i < PAYLOAD_LENGTH; i++) {
        payload += randomChar();
    }
    return `${PLOT_CODE_PREFIX}-${payload.slice(0, GROUP_LENGTH)}-${payload.slice(GROUP_LENGTH)}`;
}

/**
 * Normalise what a person typed into what the database stores.
 *
 * Case and surrounding whitespace are transcription noise, not a different plot. Everything
 * else is left alone on purpose: this does NOT map a typed 0 to O or 1 to I. Those
 * characters cannot occur in a real code, so silently repairing them would turn a typo into
 * a confident lookup of the wrong plot — and the wrong plot is worse than no plot.
 *
 * @param {unknown} value
 * @returns {string|null} the canonical code, or null if it is not one
 */
function normalizePlotCode(value) {
    if (typeof value !== 'string') return null;
    const candidate = value.trim().toUpperCase();
    return PLOT_CODE_PATTERN.test(candidate) ? candidate : null;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidPlotCode(value) {
    return normalizePlotCode(value) !== null;
}

module.exports = {
    generatePlotCode,
    isValidPlotCode,
    normalizePlotCode,
    PLOT_CODE_ALPHABET,
    PLOT_CODE_PREFIX,
    PLOT_CODE_PATTERN,
};
