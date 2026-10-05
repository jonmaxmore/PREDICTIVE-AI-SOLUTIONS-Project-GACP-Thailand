#!/usr/bin/env node
/**
 * Heal ONE plot's or ONE farm's missing areaUnit on ONE application.
 *
 * Council ruling 2026-08-19 (Option C) + operator scope decision B: this is an
 * OPERATOR-run script, not an endpoint. It is the repair door for the 18 real
 * applications a real-DB probe found stuck with a plot that has an area
 * (formData.plots[i].areaSize) but no unit — Task 1 of this fix stops NEW
 * submissions from reaching that state; this heals the ones already in it.
 *
 * 2026-08-20: extended with `--target farm|plot` (default `plot` — CLI
 * behavior for plots is byte-identical to before this change). `--target
 * farm` heals the SAME class of silent default on the farm surface
 * (certificate-service.js:561 used to fall back to Sqm when
 * formData.farmData.totalAreaUnit was absent) — 19 real applications carry
 * unit-less farmData (spec:
 * design note 2026-08-20-farm-areaunit-default-design). Unlike
 * plots, formData.farmData is SINGULAR (one farm per application, no index),
 * so `--target farm` refuses `--plot` outright rather than accepting one.
 *
 * The cert generator reads `formData.plots` (JSON), never the Plot table
 * (certificate-service.js:169-190) — Plot rows are only minted at issuance
 * (certificate-service.js:704-731) and don't exist yet for these apps. So
 * there is nothing authoritative to copy the unit FROM. The operator supplies
 * it, sourced from the applicant's own filing (deed, receipt, ...), recorded
 * in --source. This script NEVER defaults to AREA_UNIT and NEVER reads the
 * Plot table — a silent default is exactly the ×1,600 bug class this fix
 * exists to close (shared/area-utils.js's storedAreaToSqm docstring). The
 * same reasoning applies verbatim to the farm target and the Farm table.
 *
 * Guards (every one is a hard requirement — council scope table, not style —
 * and every one applies IDENTICALLY to both --target plot and --target farm):
 *   - dry-run by default; --apply required to write; dry-run writes NOTHING.
 *   - --app <applicationId>  exactly ONE per invocation. No wildcard/batch —
 *     each heal is a distinct human decision with its own --source.
 *   - --target <plot|farm>   which surface to heal (default: plot).
 *   - --plot <index|name>    which plot (0-based index into formData.plots,
 *                            or an exact plot name). Required for
 *                            --target plot; REFUSED for --target farm
 *                            (formData.farmData is singular — there is only
 *                            ever one farm per application, so there is no
 *                            selector to make).
 *   - --unit <value>         validated against the closed enum
 *                            Object.keys(LEGACY_UNIT_TO_SQM)
 *                            (apps/backend/shared/area-utils.js:40-53),
 *                            case-insensitively — anything else is refused.
 *   - --reason "<text>"      REQUIRED. Why this unit is correct.
 *   - --source "<เอกสารอ้างอิง>" REQUIRED. The document the unit came from.
 *   - --actor <id>           optional; defaults to the OS user running this.
 *   - a plot/farm that already HAS a unit is refused — there is no overwrite
 *     path.
 *   - before writing, the ENTIRE formData is deep-compared old vs new: the
 *     only difference allowed anywhere in the tree is the single areaUnit key
 *     being added (plots[i].areaUnit for --target plot,
 *     farmData.totalAreaUnit for --target farm). Anything else differing
 *     (areaSize, name, GPS, documents, any SERVER_OWNED_FORM_DATA_KEYS entry
 *     such as auditResult / serverRequirementSnapshot —
 *     shared/form-data-ownership.js:36-83 — or anything else) aborts the
 *     write loudly.
 *   - NEVER calls generateCertificate; NEVER changes `status` — status is
 *     only READ, to log it. The healed app re-enters issuance through the
 *     normal auditor edge (AUDIT_CONFIRMED -> AUDIT_PASSED), where
 *     evidence-gated issuance still applies un-bypassed.
 *
 * Concurrency (review finding 2026-08-19, CRITICAL — lost-update race): the
 * app's own writers (e.g. workflow-transition-service.js:364,396) touch these
 * SAME two columns (formData, workflowHistory) from an async payment-webhook
 * path, and several of the affected apps sit in PENDING_DOC_FEE /
 * PENDING_AUDIT_FEE — states that are BY DEFINITION awaiting exactly that
 * webhook. So the --apply path never reads outside a transaction: it opens
 * `prisma.$transaction`, takes `SELECT ... FOR UPDATE` on the row FIRST (locks
 * out a concurrent writer until this tx commits), re-reads the row only AFTER
 * the lock is held, and runs every refusal/integrity check plus builds the
 * write from THAT re-read — nothing read before the lock feeds the write. The
 * update itself is additionally guarded by `updatedAt` (updateMany, count
 * must be 1) as a second, independent check, and the write is verified by a
 * post-update re-read compared field-for-field against what was intended
 * (also proves the Prisma Json round-trip, not just the in-memory object) —
 * any mismatch throws and the whole transaction rolls back. The dry-run path
 * is read-only (nothing is ever written), so it keeps a plain, unlocked read.
 * This applies identically regardless of --target.
 *
 * Usage:
 *   node scripts/maintenance/heal-plot-area-unit.js \
 *     --app <id> --plot <index|name> --unit <value> \
 *     --reason "<text>" --source "<เอกสารอ้างอิง>"          # dry-run, report only
 *
 *   node scripts/maintenance/heal-plot-area-unit.js \
 *     --app <id> --plot <index|name> --unit <value> \
 *     --reason "<text>" --source "<เอกสารอ้างอิง>" --apply   # writes
 *
 *   node scripts/maintenance/heal-plot-area-unit.js \
 *     --app <id> --target farm --unit <value> \
 *     --reason "<text>" --source "<เอกสารอ้างอิง>" --apply   # heals formData.farmData
 *
 * Exit codes: 0 = success (dry-run-clean or apply-succeeded); non-zero = any
 * refusal (bad args, plot/farm not found, plot/farm already has a unit,
 * integrity assert tripped, application not found, DB error).
 */

'use strict';

const path = require('path');
const os = require('os');

const backend = path.resolve(__dirname, '..', '..', 'apps', 'backend');

const { prisma } = require(path.join(backend, 'services', 'prisma-database'));
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require(
    path.join(backend, 'middleware', 'audit-logger'),
);
const { buildWorkflowEvent } = require(path.join(backend, 'shared', 'workflow-event-builder'));
const { LEGACY_UNIT_TO_SQM } = require(path.join(backend, 'shared', 'area-utils'));
// Referenced for the explicit "which named keys must survive untouched"
// documentation the spec calls out (auditResult, serverRequirementSnapshot,
// ...) — the actual gate is assertOnlyPathChanged's full-tree diff below,
// which is a strict superset (it also catches areaSize/name/GPS/documents,
// none of which are in this list). Kept imported + used in the abort message
// so a reviewer can see server-owned keys called out by name when one trips.
const { SERVER_OWNED_FORM_DATA_KEYS } = require(path.join(backend, 'shared', 'form-data-ownership'));

const SERVER_OWNED_KEY_SET = new Set(SERVER_OWNED_FORM_DATA_KEYS);

// The fixed text every heal's audit_logs + workflowHistory row must carry
// (spec Part B, verbatim) — this is metadata surgery, not a re-audit. Generic
// ("หน่วยพื้นที่" = "area unit"), so it applies to both plot and farm heals
// unchanged.
const FIXED_AUDIT_NOTE_TH = 'แก้ metadata หน่วยพื้นที่ — ไม่ใช่การตรวจซ้ำพื้นที่จริงหรือหลักฐานภาคสนาม';

const PLOT_ACTION = 'PLOT_AREA_UNIT_HEALED';
const PLOT_REASON_CODE = 'PLOT_AREA_UNIT_HEAL';
const FARM_ACTION = 'FARM_AREA_UNIT_HEALED';
const FARM_REASON_CODE = 'FARM_AREA_UNIT_HEAL';

const VALID_AREA_UNITS = Object.keys(LEGACY_UNIT_TO_SQM);
const VALID_TARGETS = ['plot', 'farm'];

class HealRefusalError extends Error {}

// Mirrors shared/area-utils.js's canonicalise() (trim + lowercase, :55-57).
// That helper is not exported and area-utils.js is out of this fix's scope —
// canonical-application-validator.js:64-67 already made the same call for
// the same reason ("the same two operations are repeated here rather than
// widening that module's surface"); this script follows the same precedent.
function canonicaliseAreaUnit(unit) {
    return String(unit == null ? '' : unit).trim().toLowerCase();
}

function isValidAreaUnit(unit) {
    const canonical = canonicaliseAreaUnit(unit);
    return Boolean(canonical) && VALID_AREA_UNITS.includes(canonical);
}

/**
 * Parse + validate CLI args into a plain object, or throw HealRefusalError
 * with a message naming every problem found. Pure (no I/O) except the
 * injectable OS-user fallback, so it is fully unit-testable.
 *
 * @param {string[]} argv                     process.argv.slice(2)
 * @param {{getOsUser?: () => string}} [opts]
 */
function parseArgs(argv, { getOsUser = () => os.userInfo().username } = {}) {
    const args = { apply: false };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (typeof token !== 'string' || !token.startsWith('--')) { continue; }
        const key = token.slice(2);
        if (key === 'apply') { args.apply = true; continue; }
        args[key] = argv[i + 1];
        i += 1;
    }

    // --target defaults to 'plot' — every pre-existing plot invocation
    // (no --target flag at all) resolves to exactly the same target it
    // always did, so behavior for plots is unchanged.
    const target = args.target === undefined ? 'plot' : canonicaliseAreaUnit(args.target);

    const errors = [];
    if (!VALID_TARGETS.includes(target)) {
        errors.push(`--target must be one of: ${VALID_TARGETS.join(', ')} (got "${args.target}")`);
    }
    if (!args.app) {
        errors.push('--app <applicationId> is required (exactly ONE per invocation — no wildcard/batch)');
    } else if (/[*,]/.test(args.app)) {
        errors.push(`--app must name exactly ONE applicationId — "${args.app}" looks like a wildcard/batch, which this script does not support`);
    }
    if (target === 'plot') {
        if (!args.plot) { errors.push('--plot <index|name> is required'); }
    } else if (target === 'farm' && args.plot !== undefined) {
        errors.push('--plot is not allowed with --target farm — formData.farmData is singular (one farm per application), so there is no plot to select');
    }
    if (!args.unit) { errors.push('--unit <value> is required'); }
    if (!args.reason || !String(args.reason).trim()) { errors.push('--reason "<text>" is required'); }
    if (!args.source || !String(args.source).trim()) { errors.push('--source "<เอกสารอ้างอิง>" is required'); }

    if (errors.length > 0) {
        throw new HealRefusalError(errors.join('; '));
    }

    if (!isValidAreaUnit(args.unit)) {
        throw new HealRefusalError(
            `--unit "${args.unit}" is not a recognised area unit. Valid units (case-insensitive): `
            + `${VALID_AREA_UNITS.join(', ')}. Never guessed/defaulted — supply the unit the source document states.`,
        );
    }

    return {
        applicationId: args.app,
        target,
        plotSelector: args.plot,
        unit: args.unit,
        reason: String(args.reason).trim(),
        source: String(args.source).trim(),
        actor: (args.actor && String(args.actor).trim()) || getOsUser() || 'unknown',
        apply: args.apply,
    };
}

/**
 * Resolve a --plot selector (0-based index, or an exact plot name) to an
 * index into `plots`. Throws HealRefusalError on out-of-range, not-found, or
 * ambiguous name.
 */
function resolvePlotIndex(plots, selector) {
    if (!Array.isArray(plots) || plots.length === 0) {
        throw new HealRefusalError('this application has no formData.plots to heal');
    }

    const trimmed = String(selector == null ? '' : selector).trim();
    if (/^\d+$/.test(trimmed)) {
        const index = Number(trimmed);
        if (index < 0 || index >= plots.length) {
            throw new HealRefusalError(`--plot index ${index} is out of range (0..${plots.length - 1})`);
        }
        return index;
    }

    const matches = plots
        .map((plot, index) => ({ plot, index }))
        .filter(({ plot }) => String(plot && plot.name || '').trim() === trimmed);

    if (matches.length === 0) {
        throw new HealRefusalError(`no plot named "${trimmed}" was found (use --plot <index> instead — 0..${plots.length - 1})`);
    }
    if (matches.length > 1) {
        throw new HealRefusalError(`plot name "${trimmed}" is ambiguous — ${matches.length} plots share it; use --plot <index> instead`);
    }
    return matches[0].index;
}

/** Refuse if the plot already carries a non-empty areaUnit — no overwrite path exists. */
function assertPlotUnitAbsent(plot, plotIndex) {
    const current = plot ? plot.areaUnit : undefined;
    if (current !== undefined && current !== null && String(current).trim() !== '') {
        throw new HealRefusalError(
            `plots[${plotIndex}] already has areaUnit "${current}" — this script only fills an ABSENT unit; there is no overwrite path`,
        );
    }
}

/** Refuse if formData.farmData already carries a non-empty totalAreaUnit — no overwrite path exists. */
function assertFarmUnitAbsent(farmData) {
    const current = farmData ? farmData.totalAreaUnit : undefined;
    if (current !== undefined && current !== null && String(current).trim() !== '') {
        throw new HealRefusalError(
            `farmData already has totalAreaUnit "${current}" — this script only fills an ABSENT unit; there is no overwrite path`,
        );
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Immutable: returns a NEW formData object with plots[plotIndex].areaUnit set
 * to `unit`. Never mutates its input — dry-run calls this and must leave the
 * caller's object byte-identical.
 */
function computeHealedFormData(formData, plotIndex, unit) {
    const source = isPlainObject(formData) ? formData : {};
    const next = structuredClone(source);
    if (!Array.isArray(next.plots)) { next.plots = []; }
    next.plots[plotIndex] = { ...(next.plots[plotIndex] || {}), areaUnit: unit };
    return next;
}

/**
 * Immutable: returns a NEW formData object with farmData.totalAreaUnit set to
 * `unit`. Never mutates its input — dry-run calls this and must leave the
 * caller's object byte-identical.
 */
function computeHealedFarmFormData(formData, unit) {
    const source = isPlainObject(formData) ? formData : {};
    const next = structuredClone(source);
    next.farmData = { ...(isPlainObject(next.farmData) ? next.farmData : {}), totalAreaUnit: unit };
    return next;
}

/** Recursively collect every leaf-level {path, oldValue, newValue} difference. */
function collectDiffs(oldValue, newValue, path, diffs) {
    if (Object.is(oldValue, newValue)) { return; }

    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        const len = Math.max(oldValue.length, newValue.length);
        for (let i = 0; i < len; i += 1) {
            collectDiffs(oldValue[i], newValue[i], `${path}[${i}]`, diffs);
        }
        return;
    }

    if (isPlainObject(oldValue) && isPlainObject(newValue)) {
        const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
        for (const key of keys) {
            collectDiffs(oldValue[key], newValue[key], path ? `${path}.${key}` : key, diffs);
        }
        return;
    }

    diffs.push({ path, oldValue, newValue });
}

/**
 * Generic deep-diff over any JSON-shaped value (object OR array at the root —
 * unlike diffFormData below, this does NOT coerce a non-object root to `{}`,
 * so it also compares two `workflowHistory` arrays directly). Used by the
 * post-write verification step to confirm what got written (and round-tripped
 * back through Prisma's Json handling) is exactly what was intended.
 */
function deepDiff(oldValue, newValue) {
    const diffs = [];
    collectDiffs(oldValue, newValue, '', diffs);
    return diffs;
}

function diffFormData(oldFormData, newFormData) {
    return deepDiff(
        isPlainObject(oldFormData) ? oldFormData : {},
        isPlainObject(newFormData) ? newFormData : {},
    );
}

/**
 * Shared integrity gate (spec Part B / requirement 5): the ONLY difference
 * anywhere in the formData tree between old and new must be `expectedPath`
 * becoming `expectedUnit`. Aborts loudly (throws) otherwise, naming every
 * unexpected field — and flagging server-owned ones by name
 * (shared/form-data-ownership.js SERVER_OWNED_FORM_DATA_KEYS). Both the plot
 * and farm assertions below are thin wrappers over this, so they cannot
 * drift from each other.
 */
function assertOnlyPathChanged(oldFormData, newFormData, expectedPath, expectedUnit) {
    const diffs = diffFormData(oldFormData, newFormData);
    const unexpected = diffs.filter((d) => d.path !== expectedPath);

    if (unexpected.length > 0) {
        const described = unexpected.map((d) => {
            const topKey = d.path.split(/[.[]/)[0];
            const tag = SERVER_OWNED_KEY_SET.has(topKey) ? ' [SERVER-OWNED]' : '';
            return `${d.path}${tag}: ${JSON.stringify(d.oldValue)} -> ${JSON.stringify(d.newValue)}`;
        }).join('; ');
        throw new HealRefusalError(
            `refusing to write: ${unexpected.length} field(s) besides ${expectedPath} would change — ${described}`,
        );
    }

    const areaUnitDiff = diffs.find((d) => d.path === expectedPath);
    if (!areaUnitDiff || areaUnitDiff.newValue !== expectedUnit) {
        throw new HealRefusalError(
            `refusing to write: expected ${expectedPath} to become ${JSON.stringify(expectedUnit)} but the computed diff does not show that`,
        );
    }

    return diffs;
}

function assertOnlyAreaUnitChanged(oldFormData, newFormData, plotIndex, expectedUnit) {
    return assertOnlyPathChanged(oldFormData, newFormData, `plots[${plotIndex}].areaUnit`, expectedUnit);
}

function assertOnlyFarmAreaUnitChanged(oldFormData, newFormData, expectedUnit) {
    return assertOnlyPathChanged(oldFormData, newFormData, 'farmData.totalAreaUnit', expectedUnit);
}

/** workflowHistory entry (Application.workflowHistory JSON array) for a plot heal, via the shared builder. */
function buildHealWorkflowEvent({ plotIndex, plotName, previousUnit, unit, actor, actorRole, reason, source, applicationId = null }) {
    return buildWorkflowEvent({
        action: PLOT_ACTION,
        actorId: actor,
        actorRole,
        comment: reason,
        reasonCode: PLOT_REASON_CODE,
        metadata: {
            applicationId,
            plotIndex,
            plotName: plotName || null,
            areaUnit: { before: previousUnit == null ? null : previousUnit, after: unit },
            source,
            note: FIXED_AUDIT_NOTE_TH,
        },
    });
}

/** audit_logs event payload for a plot heal, handed verbatim to auditLogger.logWithin(event, tx). */
function buildHealAuditEvent({
    applicationId, plotIndex, plotName, previousUnit, unit,
    actor, actorRole, reason, source, organizationId, applicationStatus,
}) {
    return {
        category: AuditCategory.ADMIN,
        action: PLOT_ACTION,
        severity: AuditSeverity.INFO,
        actorId: actor,
        actorType: 'ADMIN',
        actorRole,
        resourceType: ResourceType.APPLICATION,
        resourceId: applicationId,
        organizationId,
        result: 'SUCCESS',
        metadata: {
            applicationId,
            plotIndex,
            plotName: plotName || null,
            areaUnit: { before: previousUnit == null ? null : previousUnit, after: unit },
            reason,
            source,
            applicationStatusAtHeal: applicationStatus,
            note: FIXED_AUDIT_NOTE_TH,
        },
    };
}

/** workflowHistory entry for a farm heal — mirrors buildHealWorkflowEvent, farm wording, no plotIndex/plotName. */
function buildFarmHealWorkflowEvent({ previousUnit, unit, actor, actorRole, reason, source, applicationId = null }) {
    return buildWorkflowEvent({
        action: FARM_ACTION,
        actorId: actor,
        actorRole,
        comment: reason,
        reasonCode: FARM_REASON_CODE,
        metadata: {
            applicationId,
            areaUnit: { before: previousUnit == null ? null : previousUnit, after: unit },
            source,
            note: FIXED_AUDIT_NOTE_TH,
        },
    });
}

/** audit_logs event payload for a farm heal — mirrors buildHealAuditEvent, action FARM_AREA_UNIT_HEALED. */
function buildFarmHealAuditEvent({
    applicationId, previousUnit, unit,
    actor, actorRole, reason, source, organizationId, applicationStatus,
}) {
    return {
        category: AuditCategory.ADMIN,
        action: FARM_ACTION,
        severity: AuditSeverity.INFO,
        actorId: actor,
        actorType: 'ADMIN',
        actorRole,
        resourceType: ResourceType.APPLICATION,
        resourceId: applicationId,
        organizationId,
        result: 'SUCCESS',
        metadata: {
            applicationId,
            areaUnit: { before: previousUnit == null ? null : previousUnit, after: unit },
            reason,
            source,
            applicationStatusAtHeal: applicationStatus,
            note: FIXED_AUDIT_NOTE_TH,
        },
    };
}

/**
 * Pure: run every plot-level refusal/integrity check against a given
 * `app` snapshot (whichever one the caller trusts — the tx-locked read for
 * apply, the plain read for dry-run) and compute the healed formData.
 */
function resolvePlotHeal(app, parsed) {
    const oldFormData = isPlainObject(app.formData) ? app.formData : {};
    const plots = Array.isArray(oldFormData.plots) ? oldFormData.plots : [];
    const plotIndex = resolvePlotIndex(plots, parsed.plotSelector);
    const plot = plots[plotIndex];
    assertPlotUnitAbsent(plot, plotIndex);

    const newFormData = computeHealedFormData(oldFormData, plotIndex, parsed.unit);
    assertOnlyAreaUnitChanged(oldFormData, newFormData, plotIndex, parsed.unit);

    const plotName = (plot && plot.name) || null;
    const previousUnit = (plot && plot.areaUnit) == null ? null : plot.areaUnit;

    return { target: 'plot', oldFormData, plotIndex, plotName, previousUnit, newFormData };
}

/**
 * Pure: same shape as resolvePlotHeal, for formData.farmData (singular — no
 * index/name selector). Refuses when formData.farmData is absent entirely
 * (nothing to heal) and when it already carries a non-empty totalAreaUnit.
 */
function resolveFarmHeal(app, parsed) {
    const oldFormData = isPlainObject(app.formData) ? app.formData : {};
    const farmData = isPlainObject(oldFormData.farmData) ? oldFormData.farmData : undefined;
    if (!farmData) {
        throw new HealRefusalError('this application has no formData.farmData to heal');
    }
    assertFarmUnitAbsent(farmData);

    const newFormData = computeHealedFarmFormData(oldFormData, parsed.unit);
    assertOnlyFarmAreaUnitChanged(oldFormData, newFormData, parsed.unit);

    const previousUnit = farmData.totalAreaUnit == null ? null : farmData.totalAreaUnit;

    return { target: 'farm', oldFormData, previousUnit, newFormData };
}

/** Dispatches to the plot or farm resolver by parsed.target. Shared by both dry-run and apply so they cannot drift. */
function resolveHeal(app, parsed) {
    return parsed.target === 'farm' ? resolveFarmHeal(app, parsed) : resolvePlotHeal(app, parsed);
}

function logDiff(app, result, unit) {
    console.log('');
    console.log(`Application ${app.id} (${app.applicationNumber}), status=${app.status}`);
    if (result.target === 'farm') {
        console.log(`  formData.farmData.totalAreaUnit: ${JSON.stringify(result.previousUnit)} -> ${JSON.stringify(unit)}`);
    } else {
        console.log(`  plots[${result.plotIndex}]${result.plotName ? ` ("${result.plotName}")` : ''}.areaUnit: ${JSON.stringify(result.previousUnit)} -> ${JSON.stringify(unit)}`);
    }
}

/** Read-only. Never opens a transaction, never locks, never writes. */
async function performDryRun(parsed) {
    const app = await prisma.application.findFirst({
        where: { OR: [{ id: parsed.applicationId }, { applicationNumber: parsed.applicationId }] },
    });
    if (!app) {
        throw new HealRefusalError(`application "${parsed.applicationId}" was not found`);
    }

    const result = resolveHeal(app, parsed);
    logDiff(app, result, parsed.unit);

    console.log('');
    console.log('Dry-run complete — nothing written. Re-run with --apply to write.');
}

/** Builds the workflowHistory event + audit_logs payload for whichever target this run heals. */
function buildHealEvents(parsed, { app, result }) {
    const actorRole = 'MAINTENANCE_SCRIPT';
    if (parsed.target === 'farm') {
        return {
            actorRole,
            workflowEvent: buildFarmHealWorkflowEvent({
                previousUnit: result.previousUnit, unit: parsed.unit,
                actor: parsed.actor, actorRole, reason: parsed.reason, source: parsed.source,
                applicationId: app.id,
            }),
            auditEvent: buildFarmHealAuditEvent({
                applicationId: app.id, previousUnit: result.previousUnit, unit: parsed.unit,
                actor: parsed.actor, actorRole, reason: parsed.reason, source: parsed.source,
                organizationId: app.organizationId, applicationStatus: app.status,
            }),
        };
    }
    return {
        actorRole,
        workflowEvent: buildHealWorkflowEvent({
            plotIndex: result.plotIndex, plotName: result.plotName, previousUnit: result.previousUnit, unit: parsed.unit,
            actor: parsed.actor, actorRole, reason: parsed.reason, source: parsed.source,
            applicationId: app.id,
        }),
        auditEvent: buildHealAuditEvent({
            applicationId: app.id, plotIndex: result.plotIndex, plotName: result.plotName, previousUnit: result.previousUnit, unit: parsed.unit,
            actor: parsed.actor, actorRole, reason: parsed.reason, source: parsed.source,
            organizationId: app.organizationId, applicationStatus: app.status,
        }),
    };
}

/**
 * Writes. Trusts NOTHING read outside this transaction (lost-update race,
 * review finding 2026-08-19): lock -> re-read -> assert -> updateMany(guarded
 * by updatedAt) -> audit -> post-write verify, all inside ONE
 * prisma.$transaction. Any thrown HealRefusalError rolls the whole thing back.
 * Identical for --target plot and --target farm — only resolveHeal and the
 * event builders differ by target.
 */
async function performApply(parsed) {
    await prisma.$transaction(async (tx) => {
        // 1) Lock FIRST — before reading anything this path will trust. The OR
        // (id / applicationNumber) match happens inside the locking query itself
        // so there is no separate, unlocked "resolve the id" read beforehand.
        const lockedRows = await tx.$queryRaw`
            SELECT id FROM applications
            WHERE id = ${parsed.applicationId} OR "applicationNumber" = ${parsed.applicationId}
            FOR UPDATE
        `;
        if (lockedRows.length === 0) {
            throw new HealRefusalError(`application "${parsed.applicationId}" was not found`);
        }
        if (lockedRows.length > 1) {
            throw new HealRefusalError(`"${parsed.applicationId}" matched more than one application row — refusing to guess`);
        }
        const lockedId = lockedRows[0].id;

        // 2) Re-read ONLY after the lock is held. Everything below is built from
        // this snapshot alone — a concurrent writer (the webhook path that shares
        // these columns) is now blocked behind our lock until this tx ends.
        const app = await tx.application.findFirst({ where: { id: lockedId } });
        if (!app) {
            throw new HealRefusalError(`application "${parsed.applicationId}" was not found (row removed after lock)`);
        }

        const result = resolveHeal(app, parsed);
        logDiff(app, result, parsed.unit);

        const workflowHistory = Array.isArray(app.workflowHistory) ? app.workflowHistory : [];
        const { workflowEvent, auditEvent } = buildHealEvents(parsed, { app, result });
        const nextWorkflowHistory = [...workflowHistory, workflowEvent];

        // 3) Belt-and-suspenders on top of the row lock: pin the WHERE to the
        // tx-locked-read updatedAt. Under a correctly-held FOR UPDATE lock this
        // can only ever match 1 row; count !== 1 means the lock did not do what
        // it was supposed to, and this is the backstop that catches it instead
        // of silently overwriting whatever is there.
        const updateResult = await tx.application.updateMany({
            where: { id: app.id, updatedAt: app.updatedAt },
            data: { formData: result.newFormData, workflowHistory: nextWorkflowHistory },
        });
        if (updateResult.count !== 1) {
            throw new HealRefusalError(
                `refusing to write: application ${app.id} changed between the row lock and the write `
                + `(updatedAt guard matched ${updateResult.count} row(s), expected 1) — re-run to pick up the current state`,
            );
        }

        await auditLogger.logWithin(auditEvent, tx);

        // 4) Post-write verification — re-read (through the SAME tx) and
        // deep-diff against exactly what step 3 intended to write. This is the
        // only proof in this run that Prisma's Json write + read round-trips
        // byte-for-byte, not just that the in-memory object looked right. Any
        // mismatch throws, which aborts and rolls back this entire transaction.
        const rewritten = await tx.application.findFirst({ where: { id: app.id } });
        if (!rewritten) {
            throw new HealRefusalError(`post-write verification failed: application ${app.id} not found after update`);
        }
        const formDataDiffs = deepDiff(result.newFormData, isPlainObject(rewritten.formData) ? rewritten.formData : {});
        if (formDataDiffs.length > 0) {
            throw new HealRefusalError(
                `post-write verification failed: written formData does not match the intended write — `
                + formDataDiffs.map((d) => d.path || '(root)').join(', '),
            );
        }
        const historyDiffs = deepDiff(nextWorkflowHistory, Array.isArray(rewritten.workflowHistory) ? rewritten.workflowHistory : []);
        if (historyDiffs.length > 0) {
            throw new HealRefusalError(
                `post-write verification failed: written workflowHistory does not match the intended append — `
                + historyDiffs.map((d) => d.path || '(root)').join(', '),
            );
        }
    });

    console.log('');
    console.log(`Applied — 1 ${parsed.target} healed. Row locked (FOR UPDATE) before read, updatedAt-guarded write, post-write verified, all in one transaction.`);
}

/**
 * Pure: the one-line intent banner printed before any I/O. Byte-identical to
 * the pre-farm (cdcab667) template for the default `--target plot` case — the
 * `target=farm ` fragment is the ONLY thing this can ever add, and only when
 * `--target farm` was actually passed; `plot=<selector>` is the ONLY thing it
 * can ever drop, and only for `--target farm` (which has no plot selector).
 * Extracted to a pure function (review finding, farm-areaunit T1 round 2: the
 * first cut of this always printed `target=plot`, which broke the "plot CLI
 * byte-identical" claim) so the exact strings are pinned directly, with no
 * CLI/DB plumbing in the way.
 */
function formatRunBanner(parsed) {
    const targetPrefix = parsed.target === 'farm' ? 'target=farm ' : '';
    const plotSuffix = parsed.target === 'plot' ? ` plot=${parsed.plotSelector}` : '';
    return parsed.apply
        ? `Applying — ${targetPrefix}app=${parsed.applicationId}${plotSuffix} unit=${parsed.unit}`
        : `Dry-run (nothing will be written; re-run with --apply to write) — ${targetPrefix}app=${parsed.applicationId}${plotSuffix} unit=${parsed.unit}`;
}

async function runCli() {
    let parsed;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`REFUSED: ${err.message}`);
        process.exitCode = 1;
        return;
    }

    console.log(formatRunBanner(parsed));

    try {
        if (parsed.apply) {
            await performApply(parsed);
        } else {
            await performDryRun(parsed);
        }
        process.exitCode = 0;
    } catch (err) {
        console.error(`REFUSED: ${err.message}`);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    runCli();
}

module.exports = {
    HealRefusalError,
    FIXED_AUDIT_NOTE_TH,
    VALID_AREA_UNITS,
    VALID_TARGETS,
    canonicaliseAreaUnit,
    isValidAreaUnit,
    parseArgs,
    formatRunBanner,
    resolvePlotIndex,
    assertPlotUnitAbsent,
    assertFarmUnitAbsent,
    computeHealedFormData,
    computeHealedFarmFormData,
    diffFormData,
    deepDiff,
    assertOnlyAreaUnitChanged,
    assertOnlyFarmAreaUnitChanged,
    buildHealWorkflowEvent,
    buildHealAuditEvent,
    buildFarmHealWorkflowEvent,
    buildFarmHealAuditEvent,
    resolveHeal,
    resolvePlotHeal,
    resolveFarmHeal,
    __runCli: runCli,
};
