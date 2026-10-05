/**
 * Test oracle: main a0ee3b68's maskers, verbatim, plus the UUID shield as the
 * review (2026-10-03, round 3) defines it — find canonical UUIDs left to right,
 * swap each for a digit-free/hex-free sentinel, run MAIN's logic, swap back.
 * Written apart from the production code on purpose: it is the specification.
 */

'use strict';

const { scrubString: mainScrubString } = require('./scrub-main');

// field-encryption.js at main a0ee3b68 — maskThaiId + THAI_ID_RUN_IN_TEXT + maskThaiIdsInText.
function mainMaskThaiId(idCard) {
    if (idCard === null || idCard === undefined) {return idCard;}
    const s = String(idCard).replace(/[^0-9]/g, '');
    if (s.length === 13) {
        return `${s[0]}-XXXX-XXXX-X-${s.slice(9, 13)}`;
    }
    if (s.length <= 4) {return 'X'.repeat(s.length);}
    return 'X'.repeat(s.length - 4) + s.slice(-4);
}
const MAIN_THAI_ID_RUN_IN_TEXT = /(?<!\d)\d(?:[ .\-/,–—  ]*\d){12}(?!\d)/g;
function mainMaskThaiIdsInText(text) {
    if (typeof text !== 'string' || text === '') {return text;}
    return text.replace(MAIN_THAI_ID_RUN_IN_TEXT, (run) => {
        const digits = run.replace(/[^0-9]/g, '');
        if (digits.length !== 13) {return run;}
        return mainMaskThaiId(digits);
    });
}

// apps/mobile-app/lib/core/network/log_redactor.dart _maskThaiId at main, in JS.
function mainDartMaskThaiId(s) {
    return s.replace(/\d{13}/g, (d) => `${d.slice(0, 2)}*********${d.slice(11)}`);
}

const ORACLE_UUID = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g;

/** main ∘ shield: UUIDs out, main's logic, UUIDs back. */
function shielded(mainFn) {
    return (text) => {
        if (typeof text !== 'string' || text === '') {return mainFn(text);}
        const uuids = [];
        const swapped = text.replace(ORACLE_UUID, (u) => { uuids.push(u); return `\u{F0000}${uuids.length - 1}\u{F0001}`.replace(/\d/g, (d) => String.fromCodePoint(0xF0010 + Number(d))); });
        const out = mainFn(swapped);
        return out.replace(/\u{F0000}([\u{F0010}-\u{F0019}]+)\u{F0001}/gu, (_m, idx) => uuids[Number([...idx].map((c) => c.codePointAt(0) - 0xF0010).join(''))]);
    };
}

module.exports = { mainMaskThaiIdsInText, mainScrubString, mainDartMaskThaiId, shielded, ORACLE_UUID };
