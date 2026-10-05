#!/usr/bin/env node
'use strict';

/**
 * Q1 platform-fault lane (owner ruling 2026-07-08): batch-reinstate
 * wrongfully-expired applications — "แพลตฟอร์มต้องไม่ได้กำไรจาก bug ตัวเอง".
 *
 * Companion to identify-wrongful-expiry-cohort.js (read-only cohort finder):
 * feed that script's application numbers into this one. The heavy lifting is
 * services/waiver-reopen-service.js batchReinstateWrongfulExpiry — the SAME
 * gates as the leniency path (EXPIRED check, origin derived from history,
 * settlement fail-closed, one-open-PENDING), the SAME atomic 6-leg reopen,
 * WITHOUT consuming the farmer's once-only leniency (WRONGFUL_EXPIRY lane).
 *
 * Accountability trail (mandatory): --approver-id (a real User row — printed
 * and recorded as requestedBy/decidedBy on every created request) and
 * --bug-ref (which defect caused the expiry — stamped into reason + the
 * hash-chained audit metadata, so "which bug / how many cases / who approved"
 * is answerable forever).
 *
 * Usage (run inside the backend container, like the other ops scripts):
 *   node scripts/ops/batch-reinstate-wrongful-expiry.js \
 *     --approver-id <userId> --bug-ref '<PR/issue/incident ref>' \
 *     (--ids GACP-A,GACP-B | --file cohort.txt) [--note '...'] \
 *     (--dry-run | --apply)
 *
 * --file = one application id or applicationNumber per line ('#' comments ok).
 * Refuses to run without exactly one of --dry-run / --apply (the
 * flag-that-doesn't-exist=live-run class from the entities backfill incident).
 * --dry-run runs the service's OWN gates read-only (no gate-logic drift).
 */

const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

function parseArgs(argv) {
    const out = { ids: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--dry-run') { out.dryRun = true; continue; }
        if (a === '--apply') { out.apply = true; continue; }
        if (a === '--approver-id') { out.approverId = argv[++i]; continue; }
        if (a === '--bug-ref') { out.bugRef = argv[++i]; continue; }
        if (a === '--note') { out.note = argv[++i]; continue; }
        if (a === '--ids') { out.ids.push(...String(argv[++i] || '').split(',')); continue; }
        if (a === '--file') { out.file = argv[++i]; continue; }
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
if (Boolean(args.dryRun) === Boolean(args.apply)) {
    console.error('Usage: batch-reinstate-wrongful-expiry.js --approver-id <id> --bug-ref <ref> (--ids a,b | --file f) (--dry-run | --apply)');
    process.exit(1);
}
if (!args.approverId || !String(args.bugRef || '').trim()) {
    console.error('[batch-reinstate] --approver-id and --bug-ref are both required (accountability trail).');
    process.exit(1);
}
if (args.file) {
    const lines = fs.readFileSync(args.file, 'utf8').split(/\r?\n/);
    args.ids.push(...lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
}
const ids = [...new Set(args.ids.map((s) => s.trim()).filter(Boolean))];
if (ids.length === 0) {
    console.error('[batch-reinstate] no application ids — pass --ids and/or --file (see identify-wrongful-expiry-cohort.js).');
    process.exit(1);
}

const { prisma } = require('../../services/prisma-database');
const { runWithTenantContext, withoutTenantScope } = require('../../services/tenant-context');
const { batchReinstateWrongfulExpiry } = require('../../services/waiver-reopen-service');

async function main() {
    console.log(`[batch-reinstate] mode=${args.apply ? 'APPLY' : 'DRY-RUN (read-only)'} apps=${ids.length} bugRef=${args.bugRef}`);

    // Accountability: the approver must be a real user — print who is on the hook.
    const approver = await withoutTenantScope(() => prisma.user.findUnique({
        where: { id: args.approverId },
        select: { id: true, role: true, status: true, isDeleted: true, organizationId: true },
    }));
    if (!approver || approver.isDeleted) {
        console.error(`[batch-reinstate] approver user ${args.approverId} not found — refusing (anonymous batch is not allowed).`);
        process.exit(1);
    }
    console.log(`[batch-reinstate] approver: ${approver.id} role=${approver.role} status=${approver.status}`);

    // The service runs under a tenant context (mirrors the route path the flow
    // was staging-proven on). Group the cohort by organizationId first.
    const rows = await withoutTenantScope(() => prisma.application.findMany({
        where: { OR: [{ id: { in: ids } }, { applicationNumber: { in: ids } }], isDeleted: false },
        select: { id: true, applicationNumber: true, organizationId: true },
    }));
    const byOrg = new Map();
    const resolved = new Set();
    for (const r of rows) {
        resolved.add(r.id); resolved.add(r.applicationNumber);
        if (!byOrg.has(r.organizationId)) { byOrg.set(r.organizationId, []); }
        byOrg.get(r.organizationId).push(r.id);
    }
    const notFound = ids.filter((x) => !resolved.has(x));

    const merged = { bugRef: args.bugRef, approver: approver.id, dryRun: !args.apply, reinstated: [], wouldReinstate: [], skipped: [] };
    for (const [organizationId, orgAppIds] of byOrg) {
        const report = await runWithTenantContext({ organizationId }, () => batchReinstateWrongfulExpiry({
            // Full row — the service validates role (raw DB spelling is fine:
            // it normalizes internally), ACTIVE status and the approver's own
            // organization (L6) before stamping the approver's side into the
            // audit trail. Passing {id} only made every run fail 403
            // WAIVER_BATCH_APPROVER_INVALID (caught live on the staging drill
            // 2026-07-08).
            approver: { id: approver.id, role: approver.role, status: approver.status, organizationId: approver.organizationId },
            applicationIds: orgAppIds,
            bugRef: args.bugRef,
            note: args.note,
            dryRun: !args.apply,
        }));
        merged.reinstated.push(...report.reinstated);
        merged.wouldReinstate.push(...report.wouldReinstate);
        merged.skipped.push(...report.skipped);
    }
    merged.skipped.push(...notFound.map((x) => ({ applicationId: x, code: 'NOT_FOUND', message: 'no application matches this id/number' })));

    for (const r of merged.reinstated) { console.log(`  + REINSTATED ${r.applicationNumber} -> ${r.origin} (due ${r.dueAt}) request=${r.requestId}`); }
    for (const r of merged.wouldReinstate) { console.log(`  ~ WOULD reinstate ${r.applicationNumber} -> ${r.origin}`); }
    for (const s of merged.skipped) { console.log(`  - SKIPPED ${s.applicationId || s.applicationNumber}: ${s.code} ${s.message}`); }

    console.log('[batch-reinstate] summary:', JSON.stringify({
        mode: args.apply ? 'apply' : 'dry-run',
        bugRef: args.bugRef,
        approver: approver.id,
        requested: ids.length,
        reinstated: merged.reinstated.length,
        wouldReinstate: merged.wouldReinstate.length,
        skipped: merged.skipped.length,
    }));
    return merged;
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[batch-reinstate] FAILED:', e); process.exit(1); });
