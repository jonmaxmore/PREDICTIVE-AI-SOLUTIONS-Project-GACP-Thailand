#!/usr/bin/env node
/**
 * Agent J9 — Notification & System Data Lifecycle
 * Tests: notifications → master data → system config → locations
 */
const { JourneyRunner, api, loginHealth, loginProvider, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J9 — Notifications & Tickets', '🔔');
    console.log(`\n ${j.name}\n`);

    try {
        // Step 1: Login as health user
        const healthId = generateThaiId('110000000000');
        const healthToken = await loginHealth(healthId);
        if (healthToken) j.pass('Login as health user', 'Token acquired');
        else { j.fail('Login', 'No token'); j.printReport(); return process.exit(1); }

        await waitMs(300);

        // Step 2: Get notifications
        const notifs = await api('GET', '/notifications', { token: healthToken });
        if (notifs.ok) {
            const count = notifs.data?.data?.length || 0;
            j.pass('Get notifications', `${count} notifications`);
        } else j.fail('Get notifications', `status: ${notifs.status}`);

        // Step 3: Get unread count
        const unread = await api('GET', '/notifications/unread-count', { token: healthToken });
        if (unread.ok) {
            j.pass('Get unread count', `count: ${unread.data?.data?.count ?? unread.data?.count ?? 'N/A'}`);
        } else j.fail('Get unread count', `status: ${unread.status}`);

        // Step 4: Master data
        const masterData = await api('GET', '/master-data');
        if (masterData.ok) j.pass('Get master data', `status: ${masterData.status}`);
        else j.fail('Get master data', `status: ${masterData.status}`);

        // Step 5: Master data locations
        const locations = await api('GET', '/master-data/locations');
        if (locations.ok) j.pass('Get location provinces', `status: ${locations.status}`);
        else j.fail('Get location provinces', `status: ${locations.status}`);

        // Step 6: QR pricing
        const qrPricing = await api('GET', '/master-data/qr-pricing');
        if (qrPricing.ok) j.pass('Get QR pricing', `status: ${qrPricing.status}`);
        else j.fail('Get QR pricing', `status: ${qrPricing.status}`);

        // Step 7: Master data fees
        const fees = await api('GET', '/master-data/fees');
        if (fees.ok) j.pass('Get fee schedule', `status: ${fees.status}`);
        else j.fail('Get fee schedule', `status: ${fees.status}`);

        // Step 8: Cultivation methods via master data
        const methods = await api('GET', '/master-data/cultivation-methods');
        if (methods.ok) j.pass('Get cultivation methods', `status: ${methods.status}`);
        else j.fail('Get cultivation methods', `status: ${methods.status}`);

        // Step 9: System config (public)
        const sysConfig = await api('GET', '/system-config/public');
        if (sysConfig.ok) j.pass('System config (public)', `status: ${sysConfig.status}`);
        else j.fail('System config (public)', `status: ${sysConfig.status}`);

        // Step 10: API health
        const health = await api('GET', '/health');
        if (health.ok) j.pass('API health endpoint', `status: ${health.status}`);
        else j.fail('API health endpoint', `status: ${health.status}`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
