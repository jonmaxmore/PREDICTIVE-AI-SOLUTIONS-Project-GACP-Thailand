#!/usr/bin/env node
/**
 * Agent D2 — Database Performance & Relations
 * Tests: response times, aggregation queries, cross-entity data, metrics
 */
const { JourneyRunner, api, waitMs } = require('./journey-helper');

async function timed(fn) {
    const start = Date.now();
    const result = await fn();
    return { ...result, ms: Date.now() - start };
}

async function main() {
    const j = new JourneyRunner('Agent D2 — Database Performance', '📈');
    console.log(`\n ${j.name}\n`);

    try {
        // Step 1: Health check latency
        const h = await timed(() => api('GET', '/health'));
        if (h.ok) j.pass('Health latency', `${h.ms}ms`);
        else j.fail('Health check', `status: ${h.status}`);

        // Step 2: Master data query
        const md = await timed(() => api('GET', '/master-data'));
        if (md.ok) j.pass('Master data query', `${md.ms}ms`);
        else j.fail('Master data', `status: ${md.status}`);

        // Step 3: Locations (large dataset)
        const loc = await timed(() => api('GET', '/master-data/locations'));
        if (loc.ok) j.pass('Locations query (large)', `${loc.ms}ms`);
        else j.fail('Locations query', `status: ${loc.status}`);

        // Step 4: Pricing fees query
        const fees = await timed(() => api('GET', '/pricing/fees'));
        if (fees.ok) j.pass('Pricing fees query', `${fees.ms}ms`);
        else j.fail('Pricing fees', `status: ${fees.status}`);

        // Step 5: Standards query
        const std = await timed(() => api('GET', '/standards'));
        if (std.ok) j.pass('Standards query', `${std.ms}ms`);
        else j.fail('Standards query', `status: ${std.status}`);

        // Step 6: Plants query
        const plants = await timed(() => api('GET', '/plants'));
        if (plants.ok) j.pass('Plants query', `${plants.ms}ms`);
        else j.fail('Plants query', `status: ${plants.status}`);

        // Step 7: Cultivation config (full)
        const cfg = await timed(() => api('GET', '/cultivation-config/full-config'));
        if (cfg.ok) j.pass('Full config query', `${cfg.ms}ms`);
        else j.fail('Full config', `status: ${cfg.status}`);

        // Step 8: Audit stats (aggregation)
        const auditStats = await timed(() => api('GET', '/audit/stats'));
        if (auditStats.ok) j.pass('Audit stats aggregation', `${auditStats.ms}ms`);
        else j.fail('Audit stats', `status: ${auditStats.status}`);

        // Step 9: Audit trail data
        const trail = await timed(() => api('GET', '/audit'));
        if (trail.ok) j.pass('Audit trail query', `${trail.ms}ms`);
        else j.fail('Audit trail', `status: ${trail.status}`);

        // Step 10: API metrics (in-memory)
        const metrics = await timed(() => api('GET', '/metrics'));
        if (metrics.ok) j.pass('API metrics', `${metrics.ms}ms`);
        else j.fail('API metrics', `status: ${metrics.status}`);

        // Step 11: Version
        const ver = await timed(() => api('GET', '/version'));
        if (ver.ok) j.pass('Version endpoint', `v${ver.data?.version} in ${ver.ms}ms`);
        else j.fail('Version', `status: ${ver.status}`);

        // Step 12: Concurrent mixed queries
        const concStart = Date.now();
        const conc = await Promise.all([
            api('GET', '/health'),
            api('GET', '/standards'),
            api('GET', '/plants'),
            api('GET', '/master-data'),
            api('GET', '/pricing/fees'),
        ]);
        const concMs = Date.now() - concStart;
        const allOk = conc.every(r => r.ok);
        if (allOk) j.pass('5 concurrent mixed queries', `all 200 in ${concMs}ms`);
        else j.fail('Concurrent queries', `${conc.filter(r => !r.ok).length} failed`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
