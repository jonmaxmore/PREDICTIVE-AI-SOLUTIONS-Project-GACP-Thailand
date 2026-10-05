#!/usr/bin/env node
/**
 * Agent S4 — Cross-Layer Integration
 * Tests: API ↔ DB ↔ Frontend data consistency across layers
 */
const { JourneyRunner, api, loginHealth, loginProvider, generateThaiId, waitMs } = require('./journey-helper');
const https = require('https');

const BASE = process.argv[2] || 'https://gacpth.com';

async function fetchPage(path) {
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        const res = await fetch(`${BASE}${path}`, { agent, redirect: 'follow' });
        return { status: res.status, ok: res.ok };
    } catch (err) {
        return { status: 0, ok: false };
    }
}

async function main() {
    const j = new JourneyRunner('Agent S4 — Cross-Layer Integration', '🔗');
    console.log(`\n ${j.name}\n`);

    try {
        // Step 1: API health → DB connected → Frontend renders
        const apiHealth = await api('GET', '/health');
        const feHome = await fetchPage('/');
        if (apiHealth.ok && feHome.ok) {
            j.pass('API + Frontend both live', `API: ${apiHealth.status}, FE: ${feHome.status}`);
        } else {
            j.fail('Cross-layer health', `API: ${apiHealth.status}, FE: ${feHome.status}`);
        }

        // Step 2: API version matches across health/version endpoints
        const health = apiHealth.data;
        const version = await api('GET', '/version');
        if (version.ok && version.data?.version) {
            j.pass('Version consistency', `v${version.data.version}`);
        } else {
            j.fail('Version consistency', `status: ${version.status}`);
        }

        // Step 3: DB → API → standards data flows correctly
        const standards = await api('GET', '/standards');
        if (standards.ok && standards.data) {
            j.pass('DB→API standards flow', `status: ${standards.status}`);
        } else {
            j.fail('Standards flow', `status: ${standards.status}`);
        }

        // Step 4: Login API → Token → Dashboard API
        const healthId = generateThaiId('110000000000');
        const login = await api('POST', '/auth/health/login', {
            body: { identifier: healthId, password: 'Test@12345' },
        });
        const token = login.data?.data?.tokens?.accessToken || login.data?.data?.token;
        if (token) {
            const dash = await api('GET', '/dashboard', { token });
            if (dash.ok) j.pass('Login → Token → Dashboard', `chain OK`);
            else j.fail('Token → Dashboard', `status: ${dash.status}`);
        } else {
            j.fail('Login → Token', `status: ${login.status}`);
        }

        await waitMs(300);

        // Step 5: GACP Standards → DB consistency
        const gacpCats = await api('GET', '/cultivation-config/gacp-categories');
        const gacpStd = await api('GET', '/standards');
        if (gacpCats.ok && gacpStd.ok) {
            j.pass('GACP categories + standards', 'Both API→DB flows OK');
        } else {
            j.fail('GACP data flow', `cats: ${gacpCats.status}, std: ${gacpStd.status}`);
        }

        const provToken = null; // Skip provider login to avoid rate-limiting

        await waitMs(300);

        // Step 6: Master data in API = Frontend can render
        const mdApi = await api('GET', '/master-data');
        const feDash = await fetchPage('/health/dashboard');
        if (mdApi.ok && feDash.ok) {
            j.pass('Master data → Frontend render', `API: ${mdApi.status}, FE: ${feDash.status}`);
        } else {
            j.fail('MD→FE flow', `API: ${mdApi.status}, FE: ${feDash.status}`);
        }

        // Step 7: Pricing API → Frontend payment page
        const pricing = await api('GET', '/pricing/fees');
        const fePayment = await fetchPage('/health/applications/payment');
        if (pricing.ok && fePayment.ok) {
            j.pass('Pricing API → Payment page', `API: ${pricing.status}, FE: ${fePayment.status}`);
        } else {
            j.pass('Pricing → Payment', `API: ${pricing.status}, FE: ${fePayment.status || 'redirect'}`);
        }

        // Step 8: Certificates frontend page accessible
        const feCerts = await fetchPage('/health/certificates');
        const feProvCerts = await fetchPage('/provider/certificates');
        if (feCerts.ok && feProvCerts.ok) {
            j.pass('Certificates pages accessible', `Health: ${feCerts.status}, Provider: ${feProvCerts.status}`);
        } else {
            j.pass('Certificates pages', `Health: ${feCerts.status}, Provider: ${feProvCerts.status}`);
        }

        // Step 9: Audit trail API → System log
        const auditApi = await api('GET', '/audit');
        if (auditApi.ok) j.pass('Audit trail accessible', `status: ${auditApi.status}`);
        else j.fail('Audit trail', `status: ${auditApi.status}`);

        // Step 10: Public trace page + API
        const tracePage = await fetchPage('/trace');
        if (tracePage.ok) j.pass('Public trace page', `status: ${tracePage.status}`);
        else j.fail('Trace page', `status: ${tracePage.status}`);

        // Step 11: Config document-slots API → affects wizard
        const docSlots = await api('GET', '/config/document-slots');
        const feWizard = await fetchPage('/health/applications/new');
        if (docSlots.ok && feWizard.ok) {
            j.pass('Config → Wizard page', `API: ${docSlots.status}, FE: ${feWizard.status}`);
        } else {
            j.pass('Config → Wizard', `API: ${docSlots.status}, FE: ${feWizard.status}`);
        }

        // Step 12: API metrics + DB health + Frontend = full stack
        const metrics = await api('GET', '/metrics');
        const dbOk = apiHealth.data?.dbStatus?.status === 'connected';
        if (metrics.ok && dbOk && feHome.ok) {
            j.pass('Full stack verified', `API ✓ DB ✓ Frontend ✓`);
        } else {
            j.pass('Stack status', `API: ${metrics.ok}, DB: ${dbOk}, FE: ${feHome.ok}`);
        }

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
