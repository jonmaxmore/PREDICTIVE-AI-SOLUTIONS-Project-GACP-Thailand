#!/usr/bin/env node
'use strict';

/**
 * Waiver-reopen ANOMALY REPORT (READ-ONLY) — hardening batch 2026-07-09.
 * Ticketed in docs/handoffs/waiver-reopen-decision-2026-07-08.md (risk #6
 * "collusion/rubber-stamp" approver×farmer pairs; §5.5 deliberately NO
 * per-farmer quota engine — "once-per-app + anomaly report query พอ ตรวจ
 * pattern ด้วยตาได้"; §7.5 per-farmer aggregate as backlog).
 *
 * Sections:
 *   1. repeatApproverFarmerPairs        — same approver decided ≥2 APPROVED
 *                                         requests for the same farmer token
 *                                         (across apps) — collusion signal.
 *   2. perFarmerLeniencyAggregate       — farmer with APPROVED LENIENCY on ≥2
 *                                         DISTINCT applications.
 *   3. selfDecidedLeniency              — requestedBy === decidedBy on a
 *                                         LENIENCY row. Expected 0 (the
 *                                         WAIVER_SELF_APPROVAL gate); nonzero =
 *                                         gate regression or direct DB write.
 *                                         The system_batch WRONGFUL_EXPIRY lane
 *                                         self-decides BY DESIGN — excluded.
 *   4. multiApprovedLeniencyPerApplication — >1 APPROVED LENIENCY on one app.
 *                                         Expected 0 (partial-unique breach).
 *   5. reopenedThenReExpired            — APPROVED request whose application is
 *                                         now EXPIRED again (burned reopen /
 *                                         repeat wrongful-expiry candidate).
 *   6. repeatWrongfulExpiryPerApplication — ≥2 APPROVED WRONGFUL_EXPIRY on one
 *                                         app (allowed for different bugRefs —
 *                                         eyeball-worthy).
 *   7. pendingPastSla                   — PENDING older than 5 working days.
 *                                         Snapshot only: waiver-sla-escalation-
 *                                         job.js already escalates these daily.
 *
 * PII-inert by construction: emits counts, request/application ids, actor
 * UUIDs, and TRUNCATED healthId tokens — never reason/decisionNote free text
 * (masked at write, but keep the report side clean too).
 *
 * Output: JSON report to stdout. Writes NOTHING.
 *
 * Usage: node apps/backend/scripts/ops/waiver-anomaly-report.js
 */

const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const { prisma } = require('../../services/prisma-database');
const { withoutTenantScope } = require('../../services/tenant-context');
const { addWorkingDays } = require('../../utils/working-days');

const SLA_DAYS = 5;

function tokenPreview(token) {
    const s = String(token || '');
    return s.length <= 12 ? s : `${s.slice(0, 12)}…`;
}

function appRef(row) {
    return {
        requestId: row.id,
        applicationId: row.applicationId,
        applicationNumber: row.application?.applicationNumber || null,
    };
}

/**
 * Pure aggregation over WaiverReopenRequest rows (with application include).
 * Exported for unit tests; the CLI main() below feeds it the live rows.
 */
function computeWaiverAnomalies(requests, { now = new Date(), minRepeat = 2 } = {}) {
    const rows = Array.isArray(requests) ? requests : [];
    const approved = rows.filter((r) => r.status === 'APPROVED');
    const approvedLeniency = approved.filter((r) => r.reasonCode === 'LENIENCY');
    const approvedWrongful = approved.filter((r) => r.reasonCode === 'WRONGFUL_EXPIRY');

    // 1 — approver × farmer repeat pairs (distinct applications).
    const pairMap = new Map();
    for (const r of approved) {
        const farmer = r.application?.healthId || 'UNKNOWN';
        const key = `${r.decidedBy}|${farmer}`;
        if (!pairMap.has(key)) { pairMap.set(key, { decidedBy: r.decidedBy, farmerToken: tokenPreview(farmer), apps: new Set(), requests: [] }); }
        const entry = pairMap.get(key);
        entry.apps.add(r.applicationId);
        entry.requests.push(appRef(r));
    }
    const repeatApproverFarmerPairs = [...pairMap.values()]
        .filter((e) => e.apps.size >= minRepeat)
        .map((e) => ({ decidedBy: e.decidedBy, farmerToken: e.farmerToken, count: e.apps.size, requests: e.requests }));

    // 2 — per-farmer APPROVED LENIENCY across distinct applications.
    const farmerMap = new Map();
    for (const r of approvedLeniency) {
        const farmer = r.application?.healthId || 'UNKNOWN';
        if (!farmerMap.has(farmer)) { farmerMap.set(farmer, { farmerToken: tokenPreview(farmer), apps: new Set(), requests: [] }); }
        const entry = farmerMap.get(farmer);
        entry.apps.add(r.applicationId);
        entry.requests.push(appRef(r));
    }
    const perFarmerLeniencyAggregate = [...farmerMap.values()]
        .filter((e) => e.apps.size >= 2)
        .map((e) => ({ farmerToken: e.farmerToken, distinctApplications: e.apps.size, requests: e.requests }));

    // 3 — self-decided LENIENCY (batch WRONGFUL_EXPIRY lane self-decides by design).
    const selfDecidedLeniency = rows
        .filter((r) => r.decidedBy && r.requestedBy === r.decidedBy && r.reasonCode === 'LENIENCY')
        .map((r) => ({ ...appRef(r), requestedBy: r.requestedBy, status: r.status }));

    // 4 — >1 APPROVED LENIENCY per application (invariant breach).
    const perAppLeniency = new Map();
    for (const r of approvedLeniency) {
        if (!perAppLeniency.has(r.applicationId)) { perAppLeniency.set(r.applicationId, []); }
        perAppLeniency.get(r.applicationId).push(appRef(r));
    }
    const multiApprovedLeniencyPerApplication = [...perAppLeniency.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([applicationId, list]) => ({ applicationId, count: list.length, requests: list }));

    // 5 — approved reopen whose application is EXPIRED again.
    const reopenedThenReExpired = approved
        .filter((r) => String(r.application?.status || '').toUpperCase() === 'EXPIRED')
        .map((r) => ({ ...appRef(r), reasonCode: r.reasonCode, decidedAt: r.decidedAt }));

    // 6 — repeated WRONGFUL_EXPIRY per application (bugRef from 'BATCH:<ref>').
    const perAppWrongful = new Map();
    for (const r of approvedWrongful) {
        if (!perAppWrongful.has(r.applicationId)) { perAppWrongful.set(r.applicationId, []); }
        const bugRef = /^BATCH:(.+)$/.exec(String(r.decisionNote || ''))?.[1] || null;
        perAppWrongful.get(r.applicationId).push({ ...appRef(r), bugRef });
    }
    const repeatWrongfulExpiryPerApplication = [...perAppWrongful.entries()]
        .filter(([, list]) => list.length >= 2)
        .map(([applicationId, list]) => ({ applicationId, count: list.length, requests: list }));

    // 7 — PENDING past the 5-working-day decision SLA (snapshot; the daily
    // waiver-sla-escalation-job actively chases these).
    const pendingPastSla = rows
        .filter((r) => r.status === 'PENDING' && r.createdAt && addWorkingDays(new Date(r.createdAt), SLA_DAYS) < now)
        .map((r) => ({ ...appRef(r), createdAt: r.createdAt }));

    return {
        generatedAt: now.toISOString(),
        totals: {
            requests: rows.length,
            approved: approved.length,
            approvedLeniency: approvedLeniency.length,
            approvedWrongfulExpiry: approvedWrongful.length,
            pending: rows.filter((r) => r.status === 'PENDING').length,
            denied: rows.filter((r) => r.status === 'DENIED').length,
        },
        repeatApproverFarmerPairs,
        perFarmerLeniencyAggregate,
        selfDecidedLeniency,
        multiApprovedLeniencyPerApplication,
        reopenedThenReExpired,
        repeatWrongfulExpiryPerApplication,
        pendingPastSla,
    };
}

async function main() {
    // Pilot volume is small — one cross-org fetch, aggregate in memory.
    const requests = await withoutTenantScope(() => prisma.waiverReopenRequest.findMany({
        include: {
            application: { select: { applicationNumber: true, healthId: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
    }));

    const report = computeWaiverAnomalies(requests);
    console.log(JSON.stringify(report, null, 2));

    const flagged = report.repeatApproverFarmerPairs.length
        + report.perFarmerLeniencyAggregate.length
        + report.selfDecidedLeniency.length
        + report.multiApprovedLeniencyPerApplication.length
        + report.reopenedThenReExpired.length
        + report.repeatWrongfulExpiryPerApplication.length
        + report.pendingPastSla.length;
    console.error(`[waiver-anomaly-report] ${report.totals.requests} request(s) scanned, ${flagged} anomaly row(s) across 7 sections. READ-ONLY — nothing written.`);
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((e) => { console.error('[waiver-anomaly-report] FAILED:', e?.message || e); process.exit(1); });
}

module.exports = { computeWaiverAnomalies };
