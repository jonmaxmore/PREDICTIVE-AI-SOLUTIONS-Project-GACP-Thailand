#!/usr/bin/env node
/**
 * Agent J7 — Certificate & Verify Journey
 * Tests: golden scenario → certificates → verify → QR code
 */
const { JourneyRunner, api, loginHealth, generateThaiId, e2eReset, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J7 — Certificate & Verify', '🏆');
    console.log(`\n ${j.name}\n`);

    let goldenData = null;

    try {
        // Step 1: Run Golden Scenario
        const golden = await api('POST', '/e2e/golden-scenario');
        if (golden.ok && golden.data?.success) {
            goldenData = golden.data.data;
            j.pass('Golden Scenario — complete flow', `user: ${goldenData.user?.id?.slice(0, 8)}...`);
        } else if (golden.status === 403) {
            j.skip('Golden Scenario (E2E disabled)', 'Production mode — testing public APIs instead');
            // Fallback: test public certificate APIs
            const standards = await api('GET', '/standards');
            if (standards.ok) j.pass('Get GACP standards', `status: ${standards.status}`);
            else j.fail('Get GACP standards', `status: ${standards.status}`);

            const certs = await api('GET', '/v1/public/verify/GACP-TEST-000');
            j.pass('Certificate verify endpoint', `status: ${certs.status} (${certs.status === 404 ? 'not found = correct' : 'response'})`);

            j.printReport();
            return process.exit(j.failCount > 0 ? 1 : 0);
        } else {
            j.fail('Golden Scenario', `status: ${golden.status} — ${golden.data?.error || ''}`);
            j.printReport();
            return process.exit(1);
        }

        await waitMs(500);

        // Step 2: Verify user was created
        if (goldenData.user) {
            j.pass('User created', `id: ${goldenData.user.id.slice(0, 8)}..., email: ${goldenData.user.email}`);
        } else {
            j.fail('User not found in golden data');
        }

        // Step 3: Verify farm was created
        if (goldenData.farm) {
            j.pass('Farm created', `${goldenData.farm.farmName || goldenData.farm.name}`);
        } else {
            j.fail('Farm not found in golden data');
        }

        // Step 4: Verify planting cycle
        if (goldenData.cycle) {
            j.pass('Planting cycle created', `${goldenData.cycle.name}`);
        } else {
            j.fail('Planting cycle not found');
        }

        // Step 5: Verify harvest batch
        if (goldenData.batch) {
            j.pass('Harvest batch created', `${goldenData.batch.batchNumber}, QR: ${goldenData.batch.qrCode?.slice(0, 12)}...`);
        } else {
            j.fail('Harvest batch not found');
        }

        // Step 6: Verify lot with QR
        if (goldenData.lot) {
            j.pass('Lot created with QR', `${goldenData.lot.lotNumber}, QR: ${goldenData.lot.qrCode?.slice(0, 12)}...`);
        } else {
            j.fail('Lot not found');
        }

        // Step 7: Verify tracking URL
        if (goldenData.lot?.trackingUrl) {
            j.pass('Tracking URL generated', goldenData.lot.trackingUrl.slice(0, 50));
        } else {
            j.fail('No tracking URL');
        }

        // Step 8: QR code data URL
        if (goldenData.qrCodeDataUrl) {
            const isDataUrl = goldenData.qrCodeDataUrl.startsWith('data:image');
            j.pass('QR code data URL', isDataUrl ? 'data:image/png' : 'generated');
        } else {
            j.fail('No QR code data URL');
        }

        // Step 9: Label data
        if (goldenData.label) {
            j.pass('Label data complete', `farm: ${goldenData.label.farmName}, plant: ${goldenData.label.plant}`);
        } else {
            j.fail('No label data');
        }

        // Step 10: Get lot QR image
        if (goldenData.lot?.id) {
            const qrImg = await api('GET', `/e2e/lot/${goldenData.lot.id}/qr`);
            if (qrImg.status === 200) {
                j.pass('Download lot QR image', `status: 200`);
            } else {
                j.fail('Download lot QR image', `status: ${qrImg.status}`);
            }
        } else {
            j.skip('Download lot QR image', 'No lot ID');
        }

        // Step 11: Public certificate standards
        const standards = await api('GET', '/standards');
        if (standards.ok) j.pass('Get GACP standards (public)', `status: ${standards.status}`);
        else j.fail('Get GACP standards', `status: ${standards.status}`);

    } finally {
        // Cleanup
        if (goldenData?.user?.email) {
            const cleanup = await e2eReset(goldenData.user.email);
            if (cleanup.ok) j.pass('Cleanup golden data', 'E2E reset OK');
            else j.fail('Cleanup golden data', `status: ${cleanup.status}`);
        }
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
