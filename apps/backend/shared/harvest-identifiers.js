/**
 * W1-3 (batch/lot identifier SSOT) — the single canonical generator for
 * HarvestBatch.batchNumber and Lot.lotNumber.
 *
 * BEFORE this module existed there were (at least) three competing
 * HarvestBatch.batchNumber generators, two of them wrongly prefixed "LOT-"
 * (LOT- is the packaging Lot's prefix, not the harvest batch's — the harvest
 * batch is "รุ่นเก็บเกี่ยว", a Lot is "ชุดบรรจุ"; conflating the two is the bug
 * the operator ordered fixed):
 *   - certificate-service.js (auto-issue path)   → `LOT-${year}-${farm.id
 *     .slice(0,4)}-001` — a HARDCODED "-001" tail, collision-prone.
 *   - harvest-service.js `createBatch()`         → `LOT-${farmId.slice(0,8)}
 *     -${year}-${count+1}` — racy count()+1, unreachable/dead (0 callers).
 *   - traceability-service.js `buildBatchNumber` → racy count()+1, correctly
 *     prefixed "BATCH-" but duplicated logic (0 live callers — feeds only the
 *     dead auto-first-cycle-trace path).
 *   - planting-cycle-service.js `buildBatchNumber` → transaction-scoped
 *     PostgreSQL sequence (harvest_batch_number_seq, migration
 *     20260425100000_add_numbering_sequences) — race-safe by construction,
 *     and already the LIVE generator behind POST /cultivation/harvest-batches
 *     (routes/api/cultivation/harvest-batches.js → harvest-service.js
 *     `_buildBatchNumberFromSequence`) and POST .../harvest-batches (plot
 *     capacity route → harvest-capacity-operations.js).
 *
 * This module promotes that last (best) implementation to the SSOT. Every
 * other call site now routes through here instead of re-deriving its own
 * batch/lot number.
 *
 * YEAR CONVENTION (fix round 1, review finding on a1c0bad7): this system's
 * identifier convention is Buddhist Era (BE), not Gregorian — certificate
 * numbers are `GACP-TH-{BE year}-...` (certificate-service.js), and every
 * batch row minted before this SSOT existed is `LOT-{BE year}-...`. The
 * first cut of this module used the Gregorian year, which would have printed
 * a `BATCH-2026-...` next to a `GACP-TH-2569-...` certificate and an old
 * `LOT-2569-...` batch — reintroducing the exact cross-labeling confusion
 * this work item was ordered to eliminate. `thaiYear()` below is the ONE
 * place that conversion happens; every format branch (including the
 * non-transactional fallback) uses it.
 *
 * FORMAT (new mints only — see below):
 *   HarvestBatch.batchNumber = `BATCH-{BE year}-{seq:06d}`   e.g. BATCH-2569-000123
 *   Lot.lotNumber            = `LOT-{BE year}-{seq:06d}-{A..Z|NN}` derived
 *                               from its parent batchNumber, e.g.
 *                               LOT-2569-000123-A
 * "BATCH-" and "LOT-" are chosen to read unambiguously against each other:
 * a harvest batch ("รุ่นเก็บเกี่ยว") NEVER starts with "LOT-"; a packaging lot
 * ("ชุดบรรจุ") always does.
 *
 * FALLBACK FORMAT (only when the sequence is unavailable — e.g. a fresh DB
 * before migration 20260425100000_add_numbering_sequences has run, or the
 * `nextval()` call otherwise throws): `BATCH-{BE year}-{ts36}-{rand}`, where
 * `ts36` is `Date.now()` base-36 and `rand` is 3 random bytes hex — NOT the
 * zero-padded `{seq:06d}` shape above, because there is no sequence value to
 * pad. This shape is intentionally different-looking (longer, alphanumeric
 * tail) so a fallback-minted number is visually distinguishable from a
 * sequence-minted one if it ever needs to be audited; both keep the same
 * `BATCH-{BE year}-` prefix and are equally collision-safe for their
 * respective mechanism (sequence: guaranteed; fallback: statistical).
 *
 * HISTORY IS UNTOUCHABLE: this module only affects NEWLY MINTED numbers.
 * Existing stored batchNumber/lotNumber values (including old "LOT-"-prefixed
 * harvest-batch numbers minted before this fix) are never rewritten, and the
 * trace resolver (services/trace-service/resolve-generic.js) matches stored
 * strings exactly regardless of prefix/format — see
 * __tests__/unit/trace-resolve-legacy-batch-number-format.test.js.
 */

const { localYear } = require('../utils/working-days');

/**
 * Convert a Gregorian date to the Thai Buddhist Era (BE) year used
 * throughout this system's human-facing identifiers (certificate numbers,
 * batch/lot numbers). BE = Gregorian year + 543.
 *
 * @param {Date} [date] — defaults to now.
 * @returns {number}
 */
function thaiYear(date = new Date()) {
    // The Bangkok year, not the process clock's (UTC in the containers): a
    // certificate or lot minted at 01:30 on 1 January in Bangkok carries the
    // new year, the same year its printed date shows (operator 2026-09-26).
    return localYear(date) + 543;
}

/**
 * Allocate a race-safe HarvestBatch.batchNumber.
 *
 * Uses the PostgreSQL sequence `harvest_batch_number_seq` (created by
 * migration 20260425100000_add_numbering_sequences) so concurrent callers —
 * even across separate transactions — can never receive the same number.
 * Sequences are NOT transactional (a rolled-back mint still consumes a
 * value), which is fine for human-facing numbering: gaps are acceptable,
 * duplicates are not.
 *
 * Falls back to a timestamp+random suffix ONLY if the sequence is
 * unavailable (e.g. a fresh DB before the migration has run) — statistically
 * collision-resistant so the caller's create still succeeds. See the
 * FALLBACK FORMAT note in the module header for why its shape differs.
 *
 * @param {object} client — any Prisma client exposing `$queryRaw` (the
 *   top-level `prisma` singleton, or an interactive transaction `tx`).
 * @returns {Promise<string>}
 */
async function buildBatchNumber(client) {
    const year = thaiYear();
    try {
        const rows = await client.$queryRaw`SELECT nextval('harvest_batch_number_seq') AS seq`;
        const seq = rows?.[0]?.seq;
        if (seq !== undefined && seq !== null) {
            return `BATCH-${year}-${String(seq).padStart(6, '0')}`;
        }
    } catch (_err) {
        // Fall through to the suffix-based fallback.
    }
    const ts = Date.now().toString(36).toUpperCase();
    const rand = require('crypto').randomBytes(3).toString('hex').toUpperCase();
    return `BATCH-${year}-${ts}-${rand}`;
}

/**
 * Derive a packaging Lot.lotNumber from its parent HarvestBatch.batchNumber.
 *
 * Bug 5.5: guarded suffix — A..Z for the first 26 lots of a batch, then
 * -27, -28 … past 26 (an earlier inlined `String.fromCharCode(65 + n)` walked
 * into '[' and beyond once a batch reached its 27th lot). Null-safe on
 * batchNumber. The year embedded in the result comes from whatever year is
 * already in `batchNumber` (this function only swaps the BATCH/LOT prefix
 * and appends a suffix) — it never computes a year of its own, so it is
 * automatically BE-consistent as long as its input batchNumber is.
 *
 * @param {string} batchNumber
 * @param {number} index — 0-based lot index within its batch
 * @returns {string}
 */
function buildLotNumber(batchNumber, index) {
    const base = String(batchNumber || '').replace(/^BATCH/i, 'LOT');
    if (index < 26) {
        return `${base}-${String.fromCharCode(65 + index)}`;
    }
    return `${base}-${String(index + 1).padStart(2, '0')}`;
}

module.exports = {
    thaiYear,
    buildBatchNumber,
    buildLotNumber,
};
