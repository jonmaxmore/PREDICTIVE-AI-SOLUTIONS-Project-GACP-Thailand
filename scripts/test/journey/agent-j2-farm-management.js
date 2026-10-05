#!/usr/bin/env node
/**
 * Agent J2 — Farm Management Journey
 * Tests: login → master data → farms → plants → cultivation config
 */
const { JourneyRunner, api, loginHealth, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J2 — Farm Management', '🌾');
    console.log(`\n ${j.name}\n`);

    const healthId = generateThaiId('110000000000');
    let token;

    try {
        // Step 1: Login
        token = await loginHealth(healthId);
        if (token) j.pass('Login as health user', 'Token acquired');
        else { j.fail('Login as health user', 'No token'); j.printReport(); return process.exit(1); }

        await waitMs(300);

        // Step 2: Get cultivation config (journey full-config)
        const config = await api('GET', '/cultivation-config/full-config');
        if (config.ok) j.pass('Get cultivation full-config', `status: ${config.status}`);
        else j.fail('Get cultivation full-config', `status: ${config.status}`);

        // Step 3: Get cultivation methods
        const methods = await api('GET', '/cultivation-config/cultivation-methods');
        if (methods.ok) j.pass('Get cultivation methods', `status: ${methods.status}`);
        else j.fail('Get cultivation methods', `status: ${methods.status}`);

        // Step 4: Get farm layouts
        const layouts = await api('GET', '/cultivation-config/farm-layouts');
        if (layouts.ok) j.pass('Get farm layouts', `status: ${layouts.status}`);
        else j.fail('Get farm layouts', `status: ${layouts.status}`);

        // Step 5: Get certification purposes
        const purposes = await api('GET', '/cultivation-config/certification-purposes');
        if (purposes.ok) j.pass('Get certification purposes', `status: ${purposes.status}`);
        else j.fail('Get certification purposes', `status: ${purposes.status}`);

        // Step 6: Get GACP categories
        const gacpCats = await api('GET', '/cultivation-config/gacp-categories');
        if (gacpCats.ok) j.pass('Get GACP categories', `status: ${gacpCats.status}`);
        else j.fail('Get GACP categories', `status: ${gacpCats.status}`);

        // Step 7: Get soil types
        const soilTypes = await api('GET', '/cultivation-config/soil-types');
        if (soilTypes.ok) j.pass('Get soil types', `status: ${soilTypes.status}`);
        else j.fail('Get soil types', `status: ${soilTypes.status}`);

        // Step 8: Get plants
        const plants = await api('GET', '/plants');
        if (plants.ok) j.pass('Get plant species', `status: ${plants.status}`);
        else j.fail('Get plant species', `status: ${plants.status}`);

        // Step 9: Get my farms
        const farms = await api('GET', '/farms', { token });
        if (farms.ok || farms.status === 200) j.pass('List my farms', `status: ${farms.status}`);
        else j.fail('List my farms', `status: ${farms.status}`);

        // Step 10: Get document requirements
        const docReqs = await api('GET', '/cultivation-config/document-requirements');
        if (docReqs.ok) j.pass('Get document requirements', `status: ${docReqs.status}`);
        else j.fail('Get document requirements', `status: ${docReqs.status}`);

        // Step 11: Get environment checklist
        const envCheck = await api('GET', '/cultivation-config/environment-checklist');
        if (envCheck.ok) j.pass('Get environment checklist', `status: ${envCheck.status}`);
        else j.fail('Get environment checklist', `status: ${envCheck.status}`);

        // Step 12: Get water sources (config)
        const waterSrc = await api('GET', '/cultivation-config/water-sources');
        if (waterSrc.ok) j.pass('Get water sources config', `status: ${waterSrc.status}`);
        else j.fail('Get water sources config', `status: ${waterSrc.status}`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
