#!/usr/bin/env node
/**
 * Agent J4 — Document Review Journey (Provider Reviewer)
 * Tests: reviewer login → dashboard → applications list → criteria
 */
const { JourneyRunner, api, loginProvider, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J4 — Document Review', '📋');
    console.log(`\n ${j.name}\n`);

    const reviewerId = generateThaiId('390000000000');
    let token;

    try {
        // Step 1: Login as reviewer
        token = await loginProvider(reviewerId);
        if (token) j.pass('Login as REVIEWER', 'Token acquired');
        else { j.fail('Login as REVIEWER', 'No token'); j.printReport(); return process.exit(1); }

        await waitMs(300);

        // Step 2: Reviewer dashboard
        const dash = await api('GET', '/provider/reviewer/dashboard', { token });
        if (dash.ok || dash.status === 200) {
            j.pass('Reviewer dashboard', `status: ${dash.status}`);
        } else {
            j.fail('Reviewer dashboard', `status: ${dash.status}`);
        }

        // Step 3: Get criteria
        const criteria = await api('GET', '/criteria', { token });
        if (criteria.ok || criteria.status === 200) {
            j.pass('Get review criteria', `status: ${criteria.status}`);
        } else {
            j.fail('Get review criteria', `status: ${criteria.status}`);
        }

        // Step 4: Get standards
        const standards = await api('GET', '/standards');
        if (standards.ok) {
            j.pass('Get GACP standards', `status: ${standards.status}`);
        } else {
            j.fail('Get GACP standards', `status: ${standards.status}`);
        }

        // Step 5: Get certificates (provider view)
        const certs = await api('GET', '/certificates', { token });
        if (certs.ok || certs.status === 200) {
            j.pass('List certificates', `status: ${certs.status}`);
        } else {
            j.fail('List certificates', `status: ${certs.status}`);
        }

        // Step 6: Login as ADMIN for broader view
        const adminId = generateThaiId('290000000000');
        const adminToken = await loginProvider(adminId);
        if (adminToken) j.pass('Login as ADMIN', 'Token acquired');
        else j.fail('Login as ADMIN', 'No token');

        await waitMs(300);

        // Step 7: Admin dashboard
        if (adminToken) {
            const adminDash = await api('GET', '/provider/admin/dashboard', { token: adminToken });
            if (adminDash.ok || adminDash.status === 200) {
                j.pass('Admin dashboard', `status: ${adminDash.status}`);
            } else {
                j.fail('Admin dashboard', `status: ${adminDash.status}`);
            }
        } else {
            j.skip('Admin dashboard', 'No admin token');
        }

        // Step 8: Admin config
        if (adminToken) {
            const config = await api('GET', '/config/document-slots');
            if (config.ok || config.status === 200) {
                j.pass('Document slots config', `status: ${config.status}`);
            } else {
                j.fail('Document slots config', `status: ${config.status}`);
            }
        } else {
            j.skip('Admin config', 'No admin token');
        }

        // Step 9: Get provider list
        if (adminToken) {
            const providers = await api('GET', '/provider', { token: adminToken });
            if (providers.ok || providers.status === 200) {
                j.pass('Get providers list', `status: ${providers.status}`);
            } else {
                j.fail('Get providers list', `status: ${providers.status}`);
            }
        } else {
            j.skip('Get providers list', 'No admin token');
        }

        // Step 10: System config
        const sysConfig = await api('GET', '/system-config/public');
        if (sysConfig.ok) {
            j.pass('System config (public)', `status: ${sysConfig.status}`);
        } else {
            j.fail('System config (public)', `status: ${sysConfig.status}`);
        }

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
