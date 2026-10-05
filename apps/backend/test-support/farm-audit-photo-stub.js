'use strict';

/**
 * A hand-written `prisma.farmAuditPhoto` delegate for suites that mock prisma.
 *
 * onsite-evidence-gate.js counts DISTINCT photographs, so it reads rows through
 * `findMany` and de-duplicates on fileHash. Until 2026-08-26 it fell back to
 * `count()` — a ROW count — whenever the delegate had no findMany, which meant
 * every stub below was silently exercising a laxer rule than production. That
 * fallback is gone (a client that cannot answer the gate's real question now
 * refuses with EVIDENCE_CAPTURE_UNAVAILABLE), so a stub has to answer it.
 *
 * This lives in one file rather than in each suite so the next change to the
 * gate's read shape is one edit, not thirteen — the same reason
 * services/audit/arm-onsite-evidence.js exists.
 *
 * @param {number} distinctCount how many DISTINCT photographs the audit has.
 * @param {object} [opts]
 * @param {number} [opts.duplicatesOf] extra rows repeating hash #0, to model the
 *   upload-one-photo-N-times case: `findMany` returns
 *   distinctCount + duplicatesOf rows but only distinctCount distinct hashes.
 * @returns {{ count: Function, findMany: Function }}
 */
function farmAuditPhotoStub(distinctCount, { duplicatesOf = 0 } = {}) {
    const rows = [];
    for (let i = 0; i < distinctCount; i += 1) {
        rows.push({ fileHash: `stub-hash-${i}`.padEnd(64, '0') });
    }
    for (let i = 0; i < duplicatesOf; i += 1) {
        rows.push({ fileHash: 'stub-hash-0'.padEnd(64, '0') });
    }

    return {
        // Kept alongside findMany: some suites assert on call counts, and a real
        // Prisma delegate exposes both.
        count: jest.fn(async () => rows.length),
        findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
    };
}

module.exports = { farmAuditPhotoStub };
