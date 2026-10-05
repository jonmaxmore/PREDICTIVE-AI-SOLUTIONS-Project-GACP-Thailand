'use strict';

/**
 * Prisma Client Extension — every Plot row is born with its permanent code.
 *
 * WHY THIS EXISTS
 *
 * มกษ. 3502-2561 ข้อ 8(1) requires recording "รหัสแปลงปลูกและข้อมูลประจำแปลงปลูก" — a plot code
 * and per-plot data (docs/standards/tas-3502-2561-records-and-traceability.md). Layer 1 added
 * the column (Plot.plotCode, partial unique index), the generator (shared/plot-code.js) and a
 * backfill for the rows that already exist. None of that puts a code on the NEXT plot somebody
 * creates, and a plot with no code is a plot that can never carry a sign in the field.
 *
 * WHY AN EXTENSION AND NOT THREE CALL-SITE PATCHES
 *
 * Three runtime paths insert a Plot row today:
 *   services/planting-service.js:656                                  POST /farms/:farmId/plots
 *   services/application-service/application-submission-methods.js:83 wizard submission (in a tx)
 *   services/certificate-service.js:796                               ensurePlotsForFarm at issuance
 * A fix at each of them is correct on the day it is written and wrong the first time somebody
 * adds a fourth — an import route, an admin tool, a fixture. The property we want is not "these
 * three call sites mint a code", it is "a Plot row cannot exist without one", and the only
 * place inside the application where every write actually converges is the shared Prisma
 * client. The repo already carries three extensions on that client (tenant injection,
 * soft-delete filtering, PDPA field encryption — services/prisma-database.js), so this is the
 * established seam rather than a new mechanism.
 *
 * The alternative was a database DEFAULT, which would also cover raw SQL and the seed scripts'
 * own un-extended clients. It was rejected for now: the format would then live twice — once in
 * shared/plot-code.js and once in plpgsql — and the second copy is the one that silently drifts.
 * Postgres' random() is also not a CSPRNG, and the code is deliberately non-enumerable
 * (shared/plot-code.js explains why: a public plot page plus a guessable code is a map of where
 * a controlled crop is standing). gen_random_bytes() would fix the RNG but not the duplication.
 * If the contract migration later makes plotCode NOT NULL, a DEFAULT becomes worth revisiting
 * as a belt-and-braces backstop — see reports/tnt-redesign/layer2-L1.md.
 *
 * WHAT IT DOES NOT DO
 *
 *   - It never touches a record that already carries a plotCode. Re-issuing a code orphans any
 *     sign already nailed to the post, so `update` is deliberately NOT hooked at all and the
 *     `update` branch of an upsert is left alone.
 *   - It never sets qrIssuedAt or qrRevokedAt. A code existing and a sign existing are two
 *     different facts; qrIssuedAt is the printing event and belongs to whoever prints.
 *   - It does not pre-check uniqueness. The partial unique index is the arbiter; a SELECT before
 *     the INSERT has a race window between the two, and would cost a round trip per plot to
 *     defend against an event that happens roughly never.
 *   - It does not reach nested writes (`farm.create({ data: { plots: { create: [...] } } })`).
 *     Prisma query extensions fire on the top-level model only. No code in the repo writes plots
 *     that way today (verified by grep, 2026-08-24); if one starts, this extension will not see
 *     it and the contract migration's NOT NULL is what will catch it.
 */

const { generatePlotCode } = require('../shared/plot-code');

const PLOT_MODEL = 'Plot';

/**
 * How many fresh codes to try before giving up and letting the caller see the constraint
 * error. With ~9.3e14 codes, a collision at a million plots is a one-in-a-billion event per
 * insert; five attempts exist so that a genuinely stuck state (a corrupted generator, say)
 * surfaces as an error instead of spinning forever against the database.
 */
const MAX_MINT_ATTEMPTS = 5;

function hasCode(record) {
    return record.plotCode !== undefined && record.plotCode !== null;
}

/**
 * @returns {{ record: object, minted: boolean }} the record to write, and whether WE put the
 * code on it — only a code we minted may be thrown away and redrawn.
 */
function mintRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return { record, minted: false };
    }
    if (hasCode(record)) {
        return { record, minted: false };
    }
    return { record: { ...record, plotCode: generatePlotCode() }, minted: true };
}

function mintData(data) {
    if (Array.isArray(data)) {
        let minted = false;
        const rows = data.map((row) => {
            const result = mintRecord(row);
            minted = minted || result.minted;
            return result.record;
        });
        return { data: rows, minted };
    }
    return (({ record, minted }) => ({ data: record, minted }))(mintRecord(data));
}

/**
 * A unique violation is only ours if it names plotCode. Any other P2002 — a duplicate id from
 * a deterministic seed, say — is the caller's problem and must surface immediately; retrying it
 * with a new plot code would burn four more round trips and then report the same error later.
 */
function isPlotCodeCollision(error) {
    if (!error || error.code !== 'P2002') {
        return false;
    }
    const target = error.meta && error.meta.target;
    const named = Array.isArray(target) ? target.join(',') : String(target || '');
    return named.includes('plotCode');
}

/**
 * Mint, write, and on a plot-code collision draw again.
 *
 * HONEST LIMIT: inside an interactive transaction the retry cannot help. Postgres marks the
 * whole transaction aborted when a statement fails, so the second attempt comes back as 25P02
 * rather than succeeding. The caller sees an error either way, which is the same outcome as not
 * retrying; the retry is real on auto-commit calls, which is where most plot inserts happen.
 * Making it work inside a transaction would need a SAVEPOINT around every plot insert, and that
 * is not worth carrying for a one-in-a-billion event.
 *
 * @param {*} original the caller's data, before any minting — re-minted fresh on each attempt
 * @param {(data: *) => void} assign writes the minted data back into args where Prisma reads it
 */
async function writeWithFreshCode(original, assign, args, query) {
    let lastError = null;
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
        const { data, minted } = mintData(original);
        assign(data);
        try {
            return await query(args);
        } catch (error) {
            if (!minted || !isPlotCodeCollision(error)) {
                throw error;
            }
            lastError = error;
        }
    }
    throw lastError;
}

const plotCodeExtension = {
    name: 'plot-code',
    query: {
        $allModels: {
            async create({ model, args, query }) {
                if (model !== PLOT_MODEL) { return query(args); }
                return writeWithFreshCode(args.data, (data) => { args.data = data; }, args, query);
            },

            async createMany({ model, args, query }) {
                if (model !== PLOT_MODEL) { return query(args); }
                return writeWithFreshCode(args.data, (data) => { args.data = data; }, args, query);
            },

            // createManyAndReturn takes the same shape. It has no caller in the repo today; it
            // is hooked so that the day somebody reaches for it, they do not quietly create the
            // one batch of plots with no codes.
            async createManyAndReturn({ model, args, query }) {
                if (model !== PLOT_MODEL) { return query(args); }
                return writeWithFreshCode(args.data, (data) => { args.data = data; }, args, query);
            },

            // Only the create branch. If the row already exists it may already carry a code, and
            // the update branch must not be able to replace it. A pre-existing row with no code
            // is the backfill's job (prisma/backfill-plot-codes.js), not this hook's.
            async upsert({ model, args, query }) {
                if (model !== PLOT_MODEL) { return query(args); }
                return writeWithFreshCode(args.create, (data) => { args.create = data; }, args, query);
            },
        },
    },
};

module.exports = {
    plotCodeExtension,
    // Exported for the tests; not part of the runtime contract.
    isPlotCodeCollision,
    MAX_MINT_ATTEMPTS,
};
