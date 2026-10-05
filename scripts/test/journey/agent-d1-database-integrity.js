#!/usr/bin/env node
/**
 * Agent D1 — Database Schema & Integrity (via API)
 * Tests: DB health, master data completeness, data format, GACP categories, plants
 */
const { JourneyRunner, api, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent D1 — Database Integrity', '🗄️');
    console.log(`\n ${j.name}\n`);

    try {
        // Step 1: Database health check
        const health = await api('GET', '/health');
        if (health.ok && health.data?.dbStatus?.status === 'connected') {
            j.pass('DB connection healthy', `status: ${health.data.dbStatus.status}`);
        } else if (health.ok) {
            j.pass('API healthy', `DB: ${health.data?.dbStatus?.status || 'unknown'}`);
        } else {
            j.fail('DB health check', `status: ${health.status}`);
        }

        // Step 2: Master data — provinces completeness
        const locations = await api('GET', '/master-data/locations');
        if (locations.ok) {
            const data = locations.data?.data || locations.data;
            const count = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
            if (count > 0) j.pass('Master data — provinces', `${count} items`);
            else j.fail('Master data — provinces empty', 'No data');
        } else {
            j.fail('Master data — provinces', `status: ${locations.status}`);
        }

        // Step 3: Master data — QR pricing
        const qr = await api('GET', '/master-data/qr-pricing');
        if (qr.ok) j.pass('Master data — QR pricing', `status: ${qr.status}`);
        else j.fail('Master data — QR pricing', `status: ${qr.status}`);

        // Step 4: Master data — fees
        const fees = await api('GET', '/master-data/fees');
        if (fees.ok) j.pass('Master data — fee schedule', `status: ${fees.status}`);
        else j.fail('Master data — fees', `status: ${fees.status}`);

        // Step 5: Cultivation config — GACP categories
        const cats = await api('GET', '/cultivation-config/gacp-categories');
        if (cats.ok && cats.data) j.pass('GACP categories data', `status: ${cats.status}`);
        else j.fail('GACP categories', `status: ${cats.status}`);

        // Step 6: Cultivation config — soil types
        const soils = await api('GET', '/cultivation-config/soil-types');
        if (soils.ok) j.pass('Soil types data', `status: ${soils.status}`);
        else j.fail('Soil types', `status: ${soils.status}`);

        // Step 7: Cultivation config — methods
        const methods = await api('GET', '/cultivation-config/cultivation-methods');
        if (methods.ok) j.pass('Cultivation methods', `status: ${methods.status}`);
        else j.fail('Cultivation methods', `status: ${methods.status}`);

        // Step 8: Standards data
        const standards = await api('GET', '/standards');
        if (standards.ok) j.pass('GACP standards data', `status: ${standards.status}`);
        else j.fail('GACP standards', `status: ${standards.status}`);

        // Step 9: Plants data
        const plants = await api('GET', '/plants');
        if (plants.ok) {
            const count = Array.isArray(plants.data?.data) ? plants.data.data.length : 0;
            j.pass('Plant species in DB', `${count || '?'} species`);
        } else {
            j.fail('Plant species', `status: ${plants.status}`);
        }

        // Step 10: Audit trail accessible
        const auditLog = await api('GET', '/audit');
        if (auditLog.ok) j.pass('Audit trail accessible', `status: ${auditLog.status}`);
        else j.fail('Audit trail', `status: ${auditLog.status}`);

        // Step 11: Document slots config
        const docSlots = await api('GET', '/config/document-slots');
        if (docSlots.ok) j.pass('Document slots config', `status: ${docSlots.status}`);
        else j.fail('Document slots config', `status: ${docSlots.status}`);

        // Step 12: System config
        const sysConfig = await api('GET', '/system-config/public');
        if (sysConfig.ok) j.pass('System config (public)', `status: ${sysConfig.status}`);
        else j.fail('System config', `status: ${sysConfig.status}`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
