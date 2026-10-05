#!/usr/bin/env node
/**
 * Agent J10 — Golden Scenario E2E (Full QC → QR → Trace)
 * Tests: reset → golden scenario → verify all entities → QR → trace → cleanup
 */
const { JourneyRunner, api, e2eReset, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J10 — Golden Scenario E2E', '🌟');
    console.log(`\n ${j.name}\n`);

    let goldenEmail = null;

    try {
        // Step 1: E2E Health check
        const health = await api('GET', '/health');
        if (health.ok) j.pass('API health check', `status: ${health.status}`);
        else j.fail('API health check', `status: ${health.status}`);

        // Step 2: Run Golden Scenario
        const golden = await api('POST', '/e2e/golden-scenario');
        if (golden.status === 403) {
            j.skip('Golden Scenario (E2E disabled)', 'Production mode — testing public APIs');
            // Fallback public tests
            const ver = await api('GET', '/version');
            if (ver.ok) j.pass('API version check', `v${ver.data?.version || '?'}`);
            else j.fail('API version', `status: ${ver.status}`);

            const metrics = await api('GET', '/metrics');
            if (metrics.ok) j.pass('API metrics', `status: ${metrics.status}`);
            else j.fail('API metrics', `status: ${metrics.status}`);

            const std = await api('GET', '/standards');
            if (std.ok) j.pass('GACP standards', `status: ${std.status}`);
            else j.fail('GACP standards', `status: ${std.status}`);

            const md = await api('GET', '/master-data');
            if (md.ok) j.pass('Master data', `status: ${md.status}`);
            else j.fail('Master data', `status: ${md.status}`);

            j.printReport();
            return process.exit(j.failCount > 0 ? 1 : 0);
        } else if (golden.ok && golden.data?.success) {
            const d = golden.data.data;
            goldenEmail = d.user?.email;
            j.pass('Run golden scenario', `7 steps completed`);

            // Step 3: Verify user
            if (d.user?.id) j.pass('Verify: User created', `${d.user.email}`);
            else j.fail('Verify: User not created');

            // Step 4: Verify farm
            if (d.farm?.id) j.pass('Verify: Farm created', `${d.farm.farmName || d.farm.name}`);
            else j.fail('Verify: Farm not created');

            // Step 5: Verify species
            if (d.species?.id) j.pass('Verify: Plant species', `${d.species.name} (${d.species.code})`);
            else j.fail('Verify: No species');

            // Step 6: Verify planting cycle
            if (d.cycle?.id) j.pass('Verify: Planting cycle', `${d.cycle.name}`);
            else j.fail('Verify: No cycle');

            // Step 7: Verify harvest batch
            if (d.batch?.id && d.batch?.batchNumber) {
                j.pass('Verify: Harvest batch', `${d.batch.batchNumber}`);
            } else j.fail('Verify: No batch');

            // Step 8: Verify batch QR
            if (d.batch?.qrCode) j.pass('Verify: Batch QR code', d.batch.qrCode.slice(0, 16));
            else j.fail('Verify: No batch QR');

            // Step 9: Verify lot
            if (d.lot?.id && d.lot?.lotNumber) {
                j.pass('Verify: Lot created', `${d.lot.lotNumber}`);
            } else j.fail('Verify: No lot');

            // Step 10: Verify lot QR
            if (d.lot?.qrCode) j.pass('Verify: Lot QR code', d.lot.qrCode.slice(0, 16));
            else j.fail('Verify: No lot QR');

            // Step 11: Verify tracking URLs
            if (d.batch?.trackingUrl && d.lot?.trackingUrl) {
                j.pass('Verify: Tracking URLs', 'Batch + Lot both have URLs');
            } else j.fail('Verify: Missing tracking URLs');

            // Step 12: QR data URL (downloadable)
            if (d.qrCodeDataUrl && d.qrCodeDataUrl.startsWith('data:image')) {
                j.pass('Verify: QR data URL', `data:image (${Math.round(d.qrCodeDataUrl.length / 1024)}KB)`);
            } else j.fail('Verify: No QR data URL');

            // Step 13: Label data completeness
            if (d.label) {
                const fields = ['qrCodeDataUrl', 'lotNumber', 'batchNumber', 'plant', 'farmName', 'weight'];
                const present = fields.filter(f => d.label[f]);
                j.pass('Verify: Label data', `${present.length}/${fields.length} fields`);
            } else j.fail('Verify: No label data');

            // Step 14: Fetch lot QR image
            if (d.lot?.id) {
                const qr = await api('GET', `/e2e/lot/${d.lot.id}/qr`);
                if (qr.status === 200) j.pass('Download: Lot QR PNG', 'status: 200');
                else j.fail('Download: Lot QR PNG', `status: ${qr.status}`);
            } else j.skip('Download: Lot QR PNG', 'No lot ID');

        } else {
            j.fail('Run golden scenario', `status: ${golden.status} — ${golden.data?.error || 'unknown'}`);
        }

    } finally {
        // Step 15: Cleanup
        if (goldenEmail) {
            const cleanup = await e2eReset(goldenEmail);
            if (cleanup.ok) j.pass('Cleanup: Reset golden data', 'E2E reset OK');
            else j.fail('Cleanup: Reset golden data', `status: ${cleanup.status}`);
        }
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
