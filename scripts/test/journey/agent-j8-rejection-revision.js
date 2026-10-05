#!/usr/bin/env node
/**
 * Agent J8 — Rejection & Revision Loop
 * Tests: application status → config → validation → scoring → step requirements
 */
const { JourneyRunner, api, loginHealth, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J8 — Rejection & Revision', '🔄');
    console.log(`\n ${j.name}\n`);

    try {
        // Step 1: Login as health user
        const healthId = generateThaiId('110000000000');
        const healthToken = await loginHealth(healthId);
        if (healthToken) j.pass('Login as health user', 'Token acquired');
        else { j.fail('Login', 'No token'); j.printReport(); return process.exit(1); }

        await waitMs(300);

        // Step 2: Get my applications
        const myApps = await api('GET', '/applications/my', { token: healthToken });
        if (myApps.ok) {
            const apps = myApps.data?.data || [];
            j.pass('Get my applications', `${Array.isArray(apps) ? apps.length : 0} applications`);
        } else j.fail('Get my applications', `status: ${myApps.status}`);

        // Step 3: Document slot config (no login needed)
        const deadlineConfig = await api('GET', '/config/document-slots');
        if (deadlineConfig.ok) j.pass('Document slot config', `status: ${deadlineConfig.status}`);
        else j.fail('Document slot config', `status: ${deadlineConfig.status}`);

        // Step 4: Validation pre-submission
        const preSubmit = await api('POST', '/validation/pre-submission', {
            body: {
                applicantType: 'INDIVIDUAL',
                farmName: 'ทดสอบ rejection',
                cultivationMethod: 'outdoor',
                plantCount: 100,
            },
        });
        if (preSubmit.ok) j.pass('Pre-submission validation', `status: ${preSubmit.status}`);
        else j.fail('Pre-submission validation', `status: ${preSubmit.status}`);

        // Step 5: Review criteria (public or token)
        const criteria = await api('GET', '/criteria', { token: healthToken });
        if (criteria.ok || criteria.status === 200) j.pass('Review criteria', `status: ${criteria.status}`);
        else j.fail('Review criteria', `status: ${criteria.status}`);

        // Step 6: Step 5 requirements
        const step5 = await api('GET', '/cultivation-config/step-requirements/5');
        if (step5.ok) j.pass('Step 5 requirements', `status: ${step5.status}`);
        else j.fail('Step 5 requirements', `status: ${step5.status}`);

        // Step 7: GACP categories
        const gacpCats = await api('GET', '/cultivation-config/gacp-categories');
        if (gacpCats.ok) j.pass('GACP categories', `status: ${gacpCats.status}`);
        else j.fail('GACP categories', `status: ${gacpCats.status}`);

        // Step 8: GACP standards
        const standards = await api('GET', '/standards');
        if (standards.ok) j.pass('GACP standards', `status: ${standards.status}`);
        else j.fail('GACP standards', `status: ${standards.status}`);

        // Step 9: Applications config
        const appConfig = await api('GET', '/applications/config', { token: healthToken });
        if (appConfig.ok || appConfig.status === 200) j.pass('Applications config', `status: ${appConfig.status}`);
        else j.fail('Applications config', `status: ${appConfig.status}`);

        // Step 10: Full cultivation config
        const fullConfig = await api('GET', '/cultivation-config/full-config');
        if (fullConfig.ok) j.pass('Full cultivation config', `status: ${fullConfig.status}`);
        else j.fail('Full config', `status: ${fullConfig.status}`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
