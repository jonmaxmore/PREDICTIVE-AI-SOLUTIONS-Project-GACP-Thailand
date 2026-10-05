#!/usr/bin/env node
'use strict';

/**
 * Task 9 (document pre-check): scores the rule layer against the synthetic
 * corpus (`__tests__/fixtures/document-precheck/corpus`, truth in
 * `labels.json`), per check:
 *
 *  - precision of warnings: of the results that warn (anything other than
 *    PASS/MATCH), how many sit on a document whose truth is a problem;
 *  - recall of true problems: of the documents whose truth is a problem, how
 *    many got a warning (any warning — MISMATCH and NOT_FOUND both send the
 *    officer to look, which is what a warning is for);
 *  - exact agreement: the result equals the labelled result (reported, not
 *    floored — it separates "warned for the right reason" from "warned");
 *  - UNREADABLE rate: share of files whose READABILITY came back UNREADABLE.
 *
 * DOC_TYPE / CROSS_MATCH / VALIDITY are scored only on files whose truth
 * READABILITY is PASS: on an unreadable file the rule layer emits their
 * UNREADABLE / NOT_FOUND / DATE_NOT_FOUND automatically (cascade), and counting
 * those would score READABILITY three more times (task-9-review.md I1).
 * A false UNREADABLE on a readable file still counts against them.
 *
 * "overall" pools every scored (file, check) pair of the four checks. Precision is
 * the first objective (design §6.4: fewer false warnings beats more catches).
 *
 * The expensive part — extracting every file (fork + pdf.js + OCR) — runs
 * once; `evaluate` is pure, so a threshold sweep re-scores the same
 * extractions (`evaluate`'s optional `thresholds` parameter, which exists for
 * this report alone).
 *
 * Usage (from apps/backend):
 *     node scripts/document-precheck/accuracy-report.js            # score at the shipped constants, check floors
 *     node scripts/document-precheck/accuracy-report.js --sweep    # + the OCR x name threshold sweep and the pick
 *     node scripts/document-precheck/accuracy-report.js --json     # machine-readable
 *
 * Exits 1 when a floor in thresholds.json is breached (the same comparison the
 * jest ratchet makes), 0 otherwise.
 */

const fs = require('fs');
const path = require('path');

const { extractDocument } = require('../../services/document-precheck/extract');
const { evaluate, OCR_CONFIDENCE_MIN, NAME_SIMILARITY_MIN } = require('../../services/document-precheck/evaluate');

const FIXTURE_DIR = path.join(__dirname, '..', '..', '__tests__', 'fixtures', 'document-precheck');
const CORPUS_DIR = path.join(FIXTURE_DIR, 'corpus');
const LABELS_PATH = path.join(FIXTURE_DIR, 'labels.json');
const FLOORS_PATH = path.join(FIXTURE_DIR, 'thresholds.json');

const CHECKS = ['READABILITY', 'DOC_TYPE', 'CROSS_MATCH', 'VALIDITY'];
const NON_WARNING = new Set(['PASS', 'MATCH']);

/** Sweep grid (decision 4 of the Task 9 dispatch). */
const OCR_SWEEP = { from: 40, to: 80, step: 5 };
const NAME_SWEEP = { from: 0.7, to: 0.95, step: 0.05 };
/** A pick may give up at most this much pooled recall against the best recall the grid reaches. */
const RECALL_SLACK = 0.05;

/** Metrics are compared at this many decimals, so a floor written from a report reproduces exactly. */
const DECIMALS = 4;

function round(x) {
    return x === null ? null : Number(x.toFixed(DECIMALS));
}

function loadLabels() {
    return JSON.parse(fs.readFileSync(LABELS_PATH, 'utf8'));
}

function loadFloors() {
    return JSON.parse(fs.readFileSync(FLOORS_PATH, 'utf8'));
}

function mimeFor(file) {
    return file.endsWith('.png') ? 'image/png' : 'application/pdf';
}

/**
 * Extracts every labelled file once, sequentially (one OCR worker at a time —
 * the same shape as the production queue).
 *
 * @returns {Promise<{extractions: Array<{label: object, extraction: object, ms: number}>, wallTimeMs: number}>}
 */
async function extractCorpus(labels = loadLabels()) {
    const start = Date.now();
    const extractions = [];
    for (const label of labels.files) {
        const t0 = Date.now();
        const extraction = await extractDocument(path.join(CORPUS_DIR, label.file), mimeFor(label.file));
        extractions.push({ label, extraction, ms: Date.now() - t0 });
    }
    return { extractions, wallTimeMs: Date.now() - start };
}

/** Runs `evaluate` on every extraction and pairs each flag with its label. */
function scoreRows(extractions, labels, thresholds) {
    const now = new Date(labels.now);
    return extractions.map(({ label, extraction, ms }) => {
        const flags = evaluate({
            extraction,
            reference: labels.references[label.slotId],
            slotId: label.slotId,
            now,
            thresholds,
        });
        const actual = {};
        for (const check of CHECKS) {
            const flag = flags.find((f) => f.check === check);
            actual[check] = flag ? flag.result : null;
        }
        const confidences = (extraction.pages || []).map((p) => p.confidence);
        return { file: label.file, slotId: label.slotId, variant: label.variant, expected: label.expected, actual, method: extraction.method, confidences, ms };
    });
}

function emptyTally() {
    return { n: 0, problems: 0, warnings: 0, tp: 0, fp: 0, fn: 0, exact: 0 };
}

function finish(t) {
    return {
        ...t,
        precision: round(t.warnings === 0 ? null : t.tp / t.warnings),
        recall: round(t.problems === 0 ? null : t.tp / t.problems),
        exactAgreement: round(t.n === 0 ? null : t.exact / t.n),
    };
}

/**
 * @param {ReturnType<typeof scoreRows>} rows
 * @returns {{checks: Record<string, object>, overall: object, unreadableRate: number, presenceErrors: string[]}}
 */
function computeMetrics(rows) {
    const tallies = Object.fromEntries(CHECKS.map((c) => [c, emptyTally()]));
    const overall = emptyTally();
    const presenceErrors = [];
    let unreadable = 0;

    for (const row of rows) {
        if (row.actual.READABILITY === 'UNREADABLE') {unreadable += 1;}
        for (const check of CHECKS) {
            const expected = row.expected[check];
            const actual = row.actual[check];
            if (expected === null || actual === null) {
                if (expected !== actual) {presenceErrors.push(`${row.file} ${check}: expected ${expected}, got ${actual}`);}
                continue;
            }
            // Fix round 1 (task-9-review.md I1): on a truth-UNREADABLE file the
            // dependent checks only echo READABILITY (the rule layer's cascade),
            // so they are not scored there — presence is still checked above.
            if (check !== 'READABILITY' && row.expected.READABILITY !== 'PASS') {
                continue;
            }
            const problem = !NON_WARNING.has(expected);
            const warning = !NON_WARNING.has(actual);
            for (const t of [tallies[check], overall]) {
                t.n += 1;
                if (problem) {t.problems += 1;}
                if (warning) {t.warnings += 1;}
                if (problem && warning) {t.tp += 1;}
                if (!problem && warning) {t.fp += 1;}
                if (problem && !warning) {t.fn += 1;}
                if (expected === actual) {t.exact += 1;}
            }
        }
    }

    return {
        checks: Object.fromEntries(CHECKS.map((c) => [c, finish(tallies[c])])),
        overall: finish(overall),
        unreadableRate: round(rows.length === 0 ? 0 : unreadable / rows.length),
        presenceErrors,
    };
}

/**
 * Every breach of thresholds.json: a precision/recall below its floor, or the
 * UNREADABLE rate above its ceiling. An undefined metric (no warnings / no
 * problems in the corpus) against a numeric floor is a breach too — a floor
 * that can silently stop being measured is not a floor.
 *
 * @returns {string[]}
 */
function compareToFloors(metrics, floors) {
    const breaches = [];
    const cmp = (name, value, floor) => {
        if (typeof floor !== 'number') {return;}
        if (value === null || value < floor) {breaches.push(`${name} ${value} < floor ${floor}`);}
    };
    for (const check of CHECKS) {
        const f = floors.checks[check];
        cmp(`${check}.precision`, metrics.checks[check].precision, f.precisionMin);
        cmp(`${check}.recall`, metrics.checks[check].recall, f.recallMin);
    }
    cmp('overall.precision', metrics.overall.precision, floors.overall.precisionMin);
    cmp('overall.recall', metrics.overall.recall, floors.overall.recallMin);
    if (typeof floors.unreadableRateMax === 'number' && metrics.unreadableRate > floors.unreadableRateMax) {
        breaches.push(`unreadableRate ${metrics.unreadableRate} > ceiling ${floors.unreadableRateMax}`);
    }
    return breaches;
}

function grid({ from, to, step }) {
    const values = [];
    for (let i = 0; from + i * step <= to + 1e-9; i += 1) {values.push(round(from + i * step));}
    return values;
}

/**
 * Re-scores the one set of extractions at every (OCR, name) pair of the grid
 * and picks per decision 4: the highest pooled precision among the pairs whose
 * pooled recall is within RECALL_SLACK of the best pooled recall on the grid.
 * Ties: higher recall; then the pair nearest the current constants (the data
 * gave no reason to move further) — distance in grid steps.
 */
function sweep(extractions, labels) {
    const results = [];
    for (const ocrConfidenceMin of grid(OCR_SWEEP)) {
        for (const nameSimilarityMin of grid(NAME_SWEEP)) {
            const m = computeMetrics(scoreRows(extractions, labels, { ocrConfidenceMin, nameSimilarityMin }));
            results.push({ ocrConfidenceMin, nameSimilarityMin, metrics: m });
        }
    }
    const bestRecall = Math.max(...results.map((r) => r.metrics.overall.recall));
    const eligible = results.filter((r) => r.metrics.overall.recall >= round(bestRecall - RECALL_SLACK));
    const distance = (r) =>
        Math.abs(r.ocrConfidenceMin - OCR_CONFIDENCE_MIN) / OCR_SWEEP.step +
        Math.abs(r.nameSimilarityMin - NAME_SIMILARITY_MIN) / NAME_SWEEP.step;
    eligible.sort(
        (a, b) =>
            b.metrics.overall.precision - a.metrics.overall.precision ||
            b.metrics.overall.recall - a.metrics.overall.recall ||
            distance(a) - distance(b),
    );
    return { results, bestRecall, pick: eligible[0] };
}

/**
 * The whole report at the shipped constants (what the jest ratchet runs).
 */
async function runAccuracy() {
    const labels = loadLabels();
    const { extractions, wallTimeMs } = await extractCorpus(labels);
    const rows = scoreRows(extractions, labels);
    const metrics = computeMetrics(rows);
    return {
        constants: { OCR_CONFIDENCE_MIN, NAME_SIMILARITY_MIN },
        rows,
        metrics,
        presenceErrors: metrics.presenceErrors,
        wallTimeMs,
        extractions,
        labels,
    };
}

function pct(x) {
    return x === null ? '  n/a' : `${(x * 100).toFixed(1).padStart(5)}%`;
}

function formatMetricsTable(metrics) {
    const lines = ['check        n  problems warnings  TP  FP  FN  precision  recall  exact'];
    const row = (name, t) =>
        `${name.padEnd(11)} ${String(t.n).padStart(3)} ${String(t.problems).padStart(8)} ${String(t.warnings).padStart(8)} ${String(t.tp).padStart(3)} ${String(t.fp).padStart(3)} ${String(t.fn).padStart(3)}     ${pct(t.precision)}  ${pct(t.recall)} ${pct(t.exactAgreement)}`;
    for (const check of CHECKS) {lines.push(row(check, metrics.checks[check]));}
    lines.push(row('overall', metrics.overall));
    lines.push(`UNREADABLE rate: ${pct(metrics.unreadableRate)} of files`);
    return lines.join('\n');
}

function formatReport(report) {
    const out = [
        `document-precheck accuracy — OCR_CONFIDENCE_MIN=${report.constants.OCR_CONFIDENCE_MIN} NAME_SIMILARITY_MIN=${report.constants.NAME_SIMILARITY_MIN}`,
        `files: ${report.rows.length}   extraction wall time: ${report.wallTimeMs} ms`,
        '',
        formatMetricsTable(report.metrics),
        '',
        'disagreements with the labels (file: check expected -> actual):',
    ];
    for (const row of report.rows) {
        for (const check of CHECKS) {
            if (row.expected[check] !== row.actual[check]) {
                const conf = row.confidences.map((c) => Math.round(c)).join(',');
                out.push(`  ${row.file}: ${check} ${row.expected[check]} -> ${row.actual[check]}   [${row.method} conf ${conf}]`);
            }
        }
    }
    if (report.presenceErrors.length) {out.push('presence errors:', ...report.presenceErrors.map((e) => `  ${e}`));}
    return out.join('\n');
}

function formatSweep(sw) {
    const names = grid(NAME_SWEEP);
    const lines = [
        `sweep: pooled precision / recall per (OCR_CONFIDENCE_MIN row, NAME_SIMILARITY_MIN column); best recall on grid = ${pct(sw.bestRecall)}`,
        `OCR \\ name ${names.map((n) => String(n).padStart(13)).join('')}`,
    ];
    for (const ocr of grid(OCR_SWEEP)) {
        const cells = names.map((n) => {
            const r = sw.results.find((x) => x.ocrConfidenceMin === ocr && x.nameSimilarityMin === n);
            return `${pct(r.metrics.overall.precision)}/${pct(r.metrics.overall.recall)}`.padStart(13);
        });
        lines.push(`${String(ocr).padEnd(10)} ${cells.join('')}`);
    }
    lines.push(
        `pick: OCR_CONFIDENCE_MIN=${sw.pick.ocrConfidenceMin} NAME_SIMILARITY_MIN=${sw.pick.nameSimilarityMin} ` +
            `(precision ${pct(sw.pick.metrics.overall.precision)}, recall ${pct(sw.pick.metrics.overall.recall)})`,
    );
    if (sw.pick.ocrConfidenceMin !== OCR_CONFIDENCE_MIN || sw.pick.nameSimilarityMin !== NAME_SIMILARITY_MIN) {
        lines.push(
            `shipped constants differ from the pick (OCR_CONFIDENCE_MIN=${OCR_CONFIDENCE_MIN} NAME_SIMILARITY_MIN=${NAME_SIMILARITY_MIN}) — ` +
                'the recorded decision is in evidence/document-precheck-task-9/INDEX.md',
        );
    }
    return lines.join('\n');
}

module.exports = {
    CORPUS_DIR,
    CHECKS,
    loadLabels,
    loadFloors,
    extractCorpus,
    scoreRows,
    computeMetrics,
    compareToFloors,
    sweep,
    runAccuracy,
    formatReport,
    formatSweep,
};

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    runAccuracy()
        .then((report) => {
            const floors = fs.existsSync(FLOORS_PATH) ? loadFloors() : null;
            const breaches = floors ? compareToFloors(report.metrics, floors) : ['thresholds.json is missing'];
            const sw = args.has('--sweep') ? sweep(report.extractions, report.labels) : null;
            if (args.has('--json')) {
                const { extractions: _extractions, labels: _labels, ...rest } = report;
                const sweepOut = sw && {
                    bestRecall: sw.bestRecall,
                    pick: { ocrConfidenceMin: sw.pick.ocrConfidenceMin, nameSimilarityMin: sw.pick.nameSimilarityMin, metrics: sw.pick.metrics },
                    results: sw.results.map((r) => ({ ocrConfidenceMin: r.ocrConfidenceMin, nameSimilarityMin: r.nameSimilarityMin, overall: r.metrics.overall, checks: r.metrics.checks })),
                };
                console.log(JSON.stringify({ ...rest, breaches, sweep: sweepOut }, null, 2));
            } else {
                console.log(formatReport(report));
                if (sw) {console.log(`\n${formatSweep(sw)}`);}
                console.log(`\nfloors: ${breaches.length === 0 ? 'all met' : `BREACHED\n  ${breaches.join('\n  ')}`}`);
            }
            // exitCode, not process.exit(): exit() cut piped --json output at 64 KB (fix round 1).
            process.exitCode = breaches.length === 0 ? 0 : 1;
        })
        .catch((err) => {
            console.error(err);
            process.exitCode = 2;
        });
}
