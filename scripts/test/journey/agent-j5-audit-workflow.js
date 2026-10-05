#!/usr/bin/env node
/**
 * Agent J5 — Audit Workflow Journey
 * Tests: auditor login → dashboard → audits → schedule → analysis → audit log
 */
const { JourneyRunner, api, loginHealth, loginProvider, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J5 — Audit Workflow', '🔍');
    console.log(`\n ${j.name}\n`);

    const auditorId = generateThaiId('590000000000');
    let token;

    try {
        // Step 1: Login as auditor (provider)
        token = await loginProvider(auditorId);
        if (token) j.pass('Login as AUDITOR', 'Token acquired');
        else { j.fail('Login as AUDITOR', 'No token'); j.printReport(); return process.exit(1); }

        await waitMs(300);

        // Step 2: Auditor dashboard
        const dash = await api('GET', '/provider/auditor/dashboard', { token });
        if (dash.ok || dash.status === 200) j.pass('Auditor dashboard', `status: ${dash.status}`);
        else j.fail('Auditor dashboard', `status: ${dash.status}`);

        // Step 3: List audits
        const audits = await api('GET', '/audits', { token });
        if (audits.ok || audits.status === 200) j.pass('List audits', `status: ${audits.status}`);
        else j.fail('List audits', `status: ${audits.status}`);

        // Step 4: Pending schedule
        const pending = await api('GET', '/audits/pending-schedule', { token });
        if (pending.ok || pending.status === 200) j.pass('Pending audit schedule', `status: ${pending.status}`);
        else j.fail('Pending audit schedule', `status: ${pending.status}`);

        // Step 5: Scheduled audits
        const scheduled = await api('GET', '/audits/scheduled', { token });
        if (scheduled.ok || scheduled.status === 200) j.pass('Scheduled audits', `status: ${scheduled.status}`);
        else j.fail('Scheduled audits', `status: ${scheduled.status}`);

        // Step 6: Site analysis types
        const analysisTypes = await api('GET', '/site-analyses/types', { token });
        if (analysisTypes.ok || analysisTypes.status === 200) j.pass('Site analysis types', `status: ${analysisTypes.status}`);
        else j.fail('Site analysis types', `status: ${analysisTypes.status}`);

        // Step 7: Reassignable audits
        const reassignable = await api('GET', '/audits/reassign/reassignable', { token });
        if (reassignable.ok || reassignable.status === 200) j.pass('Reassignable audits', `status: ${reassignable.status}`);
        else j.fail('Reassignable audits', `status: ${reassignable.status}`);

        // Step 8: System audit log
        const auditLog = await api('GET', '/audit', { token });
        if (auditLog.ok || auditLog.status === 200) j.pass('System audit log', `status: ${auditLog.status}`);
        else j.fail('System audit log', `status: ${auditLog.status}`);

        // Step 9: Audit statistics
        const auditStats = await api('GET', '/audit/stats', { token });
        if (auditStats.ok || auditStats.status === 200) j.pass('Audit statistics', `status: ${auditStats.status}`);
        else j.fail('Audit statistics', `status: ${auditStats.status}`);

        // Step 10: Review criteria (cross-check)
        const criteria = await api('GET', '/criteria', { token });
        if (criteria.ok || criteria.status === 200) j.pass('Review criteria', `status: ${criteria.status}`);
        else j.fail('Review criteria', `status: ${criteria.status}`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
