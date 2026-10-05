#!/usr/bin/env node
'use strict';
/**
 * R15 detector — find any plot carrying more than ONE open planting cycle.
 *
 * R15 (design note 2026-08-20-planting-tnt-design:152): one plot holds at
 * most one open cycle, so "the current cycle" always has exactly one answer. Two live
 * cycles on the same ground is the shape of produce laundering — the second open cycle
 * gives untracked material a certified origin to be recorded against. Ledger F-G4-21 found
 * it for real.
 *
 * WHY A DETECTOR AND NOT A DATABASE CONSTRAINT (operator decision, 2026-08-26):
 * a plot binds to a cycle two ways — the legacy scalar `PlantingCycle.plotId`
 * (prisma/schema/cultivation.prisma:27) and the join table `PlantingCyclePlot`
 * (:96, unique on cycleId+plotId), which is what the wizard actually writes. A partial
 * unique index on plantingCycle(plotId) would cover the legacy binding only and leave the
 * real one wide open while LOOKING like the database guarantees the rule. A half-constraint
 * is worse than none, because false confidence stops anyone from looking. Constraining this
 * properly means denormalising open-ness onto the join row — a real migration, another day.
 * Until then the guarantee is: the service refuses to create a violation
 * (services/planting-service.js:74 assertPlotsHaveNoOpenCycle, with the status column now a
 * closed set), and this script proves after the fact that none exists.
 *
 * THIS SCRIPT IS STRICTLY READ-ONLY. It issues two findMany calls and nothing else; there
 * is no create/update/delete/upsert/executeRaw path in the file, and
 * __tests__/unit/detect-double-booked-plots.test.js fails if one appears.
 *
 * Exit codes (so a scheduled check can be wired to it):
 *   0 — clean, no plot carries two open cycles
 *   1 — at least one violation found, printed with everything needed to act
 *   2 — the check could not be completed (a guard tripped, or the database was unreachable);
 *       NOT the same as clean, and deliberately a different code from a real finding.
 *
 * Usage: node scripts/detect-double-booked-plots.js
 */

const fs = require('fs');
const path = require('path');

const EXIT_CLEAN = 0;
const EXIT_VIOLATIONS = 1;
const EXIT_ERROR = 2;

const PLANTING_SERVICE = path.join(__dirname, '..', 'services', 'planting-service.js');
const REDACTED = '[redacted]';

/**
 * The definition of "open" comes from the service that enforces R15 — never from a copy
 * living here.
 *
 * It is read as TEXT rather than imported because planting-service.js is not the kind of
 * module a script can pull in for one constant: it captures the shared Prisma client at
 * require time and is required by nearly every cultivation route. Reading the declaration
 * keeps a single source of truth without dragging that in. If the two ever disagree, the
 * detector and the gate would answer "is this plot free?" differently, which is the exact
 * failure R15 exists to prevent — so the parse is a hard guard, and the companion test
 * asserts this function's result against planting-service's own list.
 *
 * @param {string} [file] path to planting-service.js
 * @returns {string[]} statuses that count as occupying a plot
 */
function readOpenCycleStatuses(file = PLANTING_SERVICE) {
    const source = fs.readFileSync(file, 'utf8');
    const match = source.match(/const OPEN_CYCLE_STATUSES = \[([^\]]*)\]/);
    if (!match) {
        throw new Error(`OPEN_CYCLE_STATUSES declaration not found in ${file} — refusing to guess what "open" means`);
    }
    const statuses = match[1]
        .split(',')
        .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    if (!statuses.length) {
        throw new Error(`OPEN_CYCLE_STATUSES in ${file} parsed to an empty list — refusing to report every plot clean`);
    }
    const malformed = statuses.filter((status) => !/^[A-Z][A-Z_]*$/.test(status));
    if (malformed.length) {
        throw new Error(`OPEN_CYCLE_STATUSES in ${file} contains values this parser cannot trust: ${malformed.join(', ')}`);
    }
    return statuses;
}

/**
 * Remove anything that could carry the database credentials out of a printed line.
 *
 * Prisma puts the full connection URL into several of its error messages, and this script
 * prints error messages. Law L2: no secret in code, log, or report.
 *
 * @param {unknown} text
 * @returns {string}
 */
function redact(text) {
    let out = String(text);
    const url = process.env.DATABASE_URL;
    if (url) {
        out = out.split(url).join(REDACTED);
        try {
            const password = new URL(url).password;
            // Short passwords are skipped: blanking a 2-character string would shred
            // unrelated words in the line and make the report unreadable.
            if (password && password.length >= 4) {
                out = out.split(password).join(REDACTED);
            }
        } catch {
            // An unparseable DATABASE_URL is handled by the guard in connect(); the
            // literal split above already covered it here.
        }
    }
    return out.replace(/\b(?:postgres(?:ql)?|prisma):\/\/\S+/gi, REDACTED);
}

function say(line) {
    console.log(redact(line));
}

function fail(line) {
    console.error(redact(line));
}

function formatDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'string' && value.length >= 10) {
        return value.slice(0, 10);
    }
    return '(no start date)';
}

/**
 * Read both bindings, union them, and return every plot held by two or more open cycles.
 *
 * Reading only one binding is the whole failure mode this replaces: the wizard writes the
 * join table, while rows from before it existed (and the auto-trace path) carry the plot on
 * the deprecated scalar only. A detector that saw one of the two would report clean over a
 * real violation — which is the same false confidence that made the operator decline the
 * partial index.
 *
 * @param {object} prisma a Prisma client, or anything with the same two findMany calls
 * @param {string[]} openStatuses from readOpenCycleStatuses()
 * @returns {Promise<{openStatuses: string[], cyclesScanned: number, plotsBound: number, violations: object[]}>}
 */
async function findDoubleBookedPlots(prisma, openStatuses) {
    if (!Array.isArray(openStatuses) || !openStatuses.length) {
        throw new Error('findDoubleBookedPlots needs a non-empty openStatuses list');
    }

    const cycles = await prisma.plantingCycle.findMany({
        where: {
            isDeleted: false,
            status: { in: openStatuses },
        },
        select: {
            id: true,
            cycleName: true,
            status: true,
            startDate: true,
            plotId: true,
            cyclePlots: { select: { plotId: true } },
        },
    });

    if (!Array.isArray(cycles)) {
        throw new Error('plantingCycle.findMany did not return a list — refusing to report on a shape this script cannot read');
    }

    // Guard, in the style of scripts/g4/set-certificate-business-date.js: assert the exact
    // expected shape and abort rather than guess. A row whose status is outside the filter
    // means the where clause did not apply, and a detector reading unfiltered rows would
    // invent violations out of closed cycles.
    const byPlot = new Map();
    for (const cycle of cycles) {
        if (!cycle || typeof cycle.id !== 'string' || !cycle.id) {
            throw new Error(`open cycle row has no usable id: ${JSON.stringify(cycle)}`);
        }
        if (!openStatuses.includes(cycle.status)) {
            throw new Error(`cycle ${cycle.id} came back with status ${String(cycle.status)}, outside the requested filter — the query is not being applied`);
        }
        if (cycle.isDeleted === true) {
            throw new Error(`cycle ${cycle.id} came back soft-deleted despite isDeleted:false — the query is not being applied`);
        }
        if (!Array.isArray(cycle.cyclePlots)) {
            throw new Error(`cycle ${cycle.id} came back without a cyclePlots array — the join-table binding cannot be read`);
        }
        if (cycle.plotId != null && typeof cycle.plotId !== 'string') {
            throw new Error(`cycle ${cycle.id} has a non-string plotId — refusing to guess which plot it means`);
        }

        const bindings = new Map();
        if (cycle.plotId) {
            bindings.set(cycle.plotId, 'legacy scalar PlantingCycle.plotId');
        }
        for (const cyclePlot of cycle.cyclePlots) {
            if (!cyclePlot || typeof cyclePlot.plotId !== 'string' || !cyclePlot.plotId) {
                throw new Error(`cycle ${cycle.id} has a PlantingCyclePlot row without a plotId`);
            }
            // A cycle bound to the same plot BOTH ways is one occupant, not two.
            bindings.set(
                cyclePlot.plotId,
                bindings.has(cyclePlot.plotId) ? 'both bindings' : 'join table PlantingCyclePlot',
            );
        }

        for (const [plotId, boundVia] of bindings) {
            if (!byPlot.has(plotId)) {
                byPlot.set(plotId, []);
            }
            byPlot.get(plotId).push({
                id: cycle.id,
                cycleName: cycle.cycleName,
                status: cycle.status,
                startDate: cycle.startDate,
                boundVia,
            });
        }
    }

    const violatingPlotIds = [...byPlot.entries()]
        .filter(([, holders]) => holders.length > 1)
        .map(([plotId]) => plotId);

    const plotsById = new Map();
    if (violatingPlotIds.length) {
        const plots = await prisma.plot.findMany({
            where: { id: { in: violatingPlotIds } },
            select: { id: true, name: true, plotCode: true, farmId: true },
        });
        if (!Array.isArray(plots)) {
            throw new Error('plot.findMany did not return a list — the violating plots cannot be named');
        }
        for (const plot of plots) {
            plotsById.set(plot.id, plot);
        }
    }

    const violations = violatingPlotIds.map((plotId) => {
        const plot = plotsById.get(plotId);
        return {
            plotId,
            // A cycle pointing at a plot row that does not exist is itself a finding, so it
            // is reported rather than crashed on.
            plotName: plot ? plot.name : '(plot row not found)',
            plotCode: plot ? plot.plotCode : null,
            farmId: plot ? plot.farmId : null,
            cycles: byPlot.get(plotId)
                .slice()
                .sort((a, b) => formatDate(a.startDate).localeCompare(formatDate(b.startDate))),
        };
    });

    return {
        openStatuses,
        cyclesScanned: cycles.length,
        plotsBound: byPlot.size,
        violations,
    };
}

/**
 * Turn a result into the lines a human acts on. Returned rather than printed so the test
 * can read them without capturing stdout.
 *
 * @param {object} result from findDoubleBookedPlots
 * @returns {string[]}
 */
function formatReport(result) {
    const lines = [
        `R15 double-booked plot detector — "open" = ${result.openStatuses.join(', ')} `
        + '(read from services/planting-service.js)',
        `Scanned ${result.cyclesScanned} open cycle(s) holding ${result.plotsBound} plot(s).`,
    ];

    if (!result.violations.length) {
        // Saying so out loud: silence from a detector is indistinguishable from a detector
        // that failed to run.
        lines.push('CLEAN — no plot carries more than one open planting cycle. R15 holds.');
        return lines;
    }

    lines.push(`FOUND ${result.violations.length} R15 VIOLATION(S) — a plot may carry only ONE open cycle:`);
    for (const violation of result.violations) {
        lines.push('');
        lines.push(`  plot "${violation.plotName}" (id ${violation.plotId}`
            + `${violation.plotCode ? `, code ${violation.plotCode}` : ''}`
            + `${violation.farmId ? `, farm ${violation.farmId}` : ''}) `
            + `is held by ${violation.cycles.length} open cycles:`);
        for (const cycle of violation.cycles) {
            lines.push(`    - "${cycle.cycleName}" (id ${cycle.id}, status ${cycle.status}, `
                + `start ${formatDate(cycle.startDate)}, bound via ${cycle.boundVia})`);
        }
    }
    lines.push('');
    lines.push('Act: close every holder but one (record its harvest), or move the extra cycle to its own plot. '
        + 'Nothing is changed by this script.');
    return lines;
}

/**
 * Build a read-only client. Same pooled-port shape as scripts/g4/set-certificate-business-date.js.
 */
function connect() {
    require('dotenv').config({ quiet: true });
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set — refusing to report on a database this script cannot reach');
    }
    let url;
    try {
        url = new URL(process.env.DATABASE_URL);
    } catch {
        throw new Error('DATABASE_URL is not a URL this script can parse — refusing to guess');
    }
    url.port = '6543';
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('connection_limit', '1');
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function main() {
    const openStatuses = readOpenCycleStatuses();
    const prisma = connect();
    try {
        const result = await findDoubleBookedPlots(prisma, openStatuses);
        for (const line of formatReport(result)) {
            say(line);
        }
        return result.violations.length ? EXIT_VIOLATIONS : EXIT_CLEAN;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main()
        .then((code) => process.exit(code))
        .catch((error) => {
            fail(`FATAL: ${error && error.message ? error.message : error}`);
            fail('The R15 check did NOT complete — this is not a clean result.');
            process.exit(EXIT_ERROR);
        });
}

module.exports = {
    readOpenCycleStatuses,
    findDoubleBookedPlots,
    formatReport,
    redact,
    formatDate,
    EXIT_CLEAN,
    EXIT_VIOLATIONS,
    EXIT_ERROR,
};
