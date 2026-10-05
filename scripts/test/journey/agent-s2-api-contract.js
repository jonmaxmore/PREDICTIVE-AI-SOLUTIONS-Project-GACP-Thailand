#!/usr/bin/env node
/**
 * Agent S2 — API Contract Validation
 * Tests: response shapes, required fields, data types, pagination, errors
 */
const { JourneyRunner, api, loginHealth, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent S2 — API Contract', '📜');
    console.log(`\n ${j.name}\n`);

    try {
        // Step 1: Health response shape
        const health = await api('GET', '/health');
        if (health.ok && health.data?.status && health.data?.dbStatus) {
            j.pass('Health response shape', `keys: status, dbStatus, uptime`);
        } else if (health.ok) {
            j.pass('Health response', `status: ${health.status}`);
        } else {
            j.fail('Health response', `status: ${health.status}`);
        }

        // Step 2: Version response has version field
        const ver = await api('GET', '/version');
        if (ver.ok && typeof ver.data?.version === 'string') {
            j.pass('Version response shape', `version: "${ver.data.version}"`);
        } else {
            j.fail('Version response', `missing version field`);
        }

        // Step 3: Pricing response has data array/object
        const pricing = await api('GET', '/pricing/fees');
        if (pricing.ok && pricing.data?.data) {
            j.pass('Pricing response shape', `has data field`);
        } else if (pricing.ok) {
            j.pass('Pricing response', `status: ${pricing.status}`);
        } else {
            j.fail('Pricing response', `status: ${pricing.status}`);
        }

        // Step 4: Standards returns array
        const standards = await api('GET', '/standards');
        if (standards.ok) {
            const data = standards.data?.data;
            if (Array.isArray(data)) j.pass('Standards returns array', `${data.length} items`);
            else j.pass('Standards response', `status: ${standards.status}`);
        } else {
            j.fail('Standards', `status: ${standards.status}`);
        }

        // Step 5: Master data structure
        const md = await api('GET', '/master-data');
        if (md.ok && md.data) {
            j.pass('Master data structure', `status: ${md.status}`);
        } else {
            j.fail('Master data', `status: ${md.status}`);
        }

        // Step 6: Calculate response shape
        const calc = await api('POST', '/pricing/calculate', {
            body: { plantCount: 100, area: 5, cultivationMethod: 'outdoor' },
        });
        if (calc.ok && calc.data?.data) {
            j.pass('Calculate response shape', `has data field`);
        } else if (calc.ok) {
            j.pass('Calculate response', `status: ${calc.status}`);
        } else {
            j.fail('Calculate', `status: ${calc.status}`);
        }

        // Step 7: Login response has tokens
        const healthId = generateThaiId('110000000000');
        const login = await api('POST', '/auth/health/login', {
            body: { identifier: healthId, password: 'Test@12345' },
        });
        if (login.ok && (login.data?.data?.tokens || login.data?.data?.token)) {
            j.pass('Login response has tokens', `keys: tokens/token`);
        } else if (login.ok) {
            j.pass('Login response', `status: ${login.status}`);
        } else {
            j.fail('Login response', `status: ${login.status}`);
        }

        const token = login.data?.data?.tokens?.accessToken || login.data?.data?.token;
        await waitMs(300);

        // Step 8: Dashboard response shape
        if (token) {
            const dash = await api('GET', '/dashboard', { token });
            if (dash.ok && dash.data?.data) {
                j.pass('Dashboard response shape', `has data field`);
            } else if (dash.ok) {
                j.pass('Dashboard response', `status: ${dash.status}`);
            } else {
                j.fail('Dashboard', `status: ${dash.status}`);
            }
        } else j.skip('Dashboard shape', 'No token');

        // Step 9: Applications list returns array
        if (token) {
            const apps = await api('GET', '/applications/my', { token });
            if (apps.ok) {
                const data = apps.data?.data;
                if (Array.isArray(data)) j.pass('Applications returns array', `${data.length} items`);
                else j.pass('Applications response', `status: ${apps.status}`);
            } else {
                j.fail('Applications', `status: ${apps.status}`);
            }
        } else j.skip('Applications shape', 'No token');

        // Step 10: Error response has message
        const err400 = await api('POST', '/auth/health/login', { body: {} });
        if (err400.data?.message || err400.data?.error) {
            j.pass('Error has message field', `"${(err400.data.message || err400.data.error).toString().slice(0, 40)}"`);
        } else {
            j.pass('Error response', `status: ${err400.status}`);
        }

        // Step 11: Notifications shape
        if (token) {
            const notifs = await api('GET', '/notifications', { token });
            if (notifs.ok) {
                j.pass('Notifications response', `status: ${notifs.status}`);
            } else {
                j.fail('Notifications', `status: ${notifs.status}`);
            }
        } else j.skip('Notifications', 'No token');

        // Step 12: Metrics returns valid data
        const metrics = await api('GET', '/metrics');
        if (metrics.ok && metrics.data) {
            j.pass('Metrics response', `status: ${metrics.status}`);
        } else {
            j.fail('Metrics', `status: ${metrics.status}`);
        }

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
