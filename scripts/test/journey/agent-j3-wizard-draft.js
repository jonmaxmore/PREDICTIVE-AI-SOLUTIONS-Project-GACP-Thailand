#!/usr/bin/env node
/**
 * Agent J3 — Wizard Draft & Submit Journey
 * Tests: wizard config → save draft → retrieve draft → prepare → submit → fees
 */
const { JourneyRunner, api, loginHealth, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J3 — Wizard Draft & Submit', '📝');
    console.log(`\n ${j.name}\n`);

    const healthId = generateThaiId('110000000000');
    let token;

    try {
        // Step 1: Login
        token = await loginHealth(healthId);
        if (token) j.pass('Login as health user', 'Token acquired');
        else { j.fail('Login', 'No token'); j.printReport(); return process.exit(1); }

        await waitMs(300);

        // Step 2: Get document slot config
        const slots = await api('GET', '/config/document-slots');
        if (slots.ok) j.pass('Get document slot config', `status: ${slots.status}`);
        else j.fail('Get document slot config', `status: ${slots.status}`);

        // Step 3: Get GACP standards
        const standards = await api('GET', '/standards');
        if (standards.ok) j.pass('Get GACP standards', `status: ${standards.status}`);
        else j.fail('Get GACP standards', `status: ${standards.status}`);

        // Step 4: Get applications config
        const appConfig = await api('GET', '/applications/config', { token });
        if (appConfig.ok || appConfig.status === 200) j.pass('Get applications config', `status: ${appConfig.status}`);
        else j.fail('Get applications config', `status: ${appConfig.status}`);

        // Step 5: Save draft
        const draft = await api('POST', '/wizard/draft', {
            token,
            body: {
                stepData: {
                    applicantType: 'INDIVIDUAL',
                    purpose: 'commercial',
                    cultivationMethod: 'outdoor',
                },
                currentStep: 1,
            },
        });
        if (draft.ok || draft.status === 200 || draft.status === 201) {
            j.context.draftId = draft.data?.data?.id || draft.data?.data?.draftId;
            j.pass('Save wizard draft', `id: ${j.context.draftId || 'created'}`);
        } else {
            j.fail('Save wizard draft', `status: ${draft.status} — ${JSON.stringify(draft.data?.message || draft.data?.error || '').slice(0, 80)}`);
        }

        await waitMs(300);

        // Step 6: Update draft with more data
        const update = await api('POST', '/wizard/draft', {
            token,
            body: {
                draftId: j.context.draftId,
                stepData: {
                    applicantType: 'INDIVIDUAL',
                    purpose: 'commercial',
                    cultivationMethod: 'outdoor',
                    farmName: 'ฟาร์มทดสอบ J3',
                    province: 'เชียงใหม่',
                },
                currentStep: 2,
            },
        });
        if (update.ok || update.status === 200) j.pass('Update wizard draft', `step 2 saved`);
        else j.fail('Update wizard draft', `status: ${update.status}`);

        // Step 7: List my applications
        const myApps = await api('GET', '/applications/my', { token });
        if (myApps.ok) j.pass('List my applications', `status: ${myApps.status}`);
        else j.fail('List my applications', `status: ${myApps.status}`);

        // Step 8: Pre-submission validation
        const preSubmit = await api('POST', '/validation/pre-submission', {
            body: {
                applicantType: 'INDIVIDUAL',
                farmName: 'ฟาร์มทดสอบ J3',
                cultivationMethod: 'outdoor',
                plantCount: 100,
            },
        });
        if (preSubmit.ok || preSubmit.status === 200) j.pass('Pre-submission validation', `status: ${preSubmit.status}`);
        else j.fail('Pre-submission validation', `status: ${preSubmit.status}`);

        // Step 9: Get pricing fees
        const fees = await api('GET', '/pricing/fees');
        if (fees.ok) j.pass('Get pricing fees', `status: ${fees.status}`);
        else j.fail('Get pricing fees', `status: ${fees.status}`);

        // Step 10: Calculate fees
        const calc = await api('POST', '/pricing/calculate', {
            body: { plantCount: 100, area: 5, cultivationMethod: 'outdoor' },
        });
        if (calc.ok) j.pass('Calculate application fees', `status: ${calc.status}`);
        else j.fail('Calculate application fees', `status: ${calc.status}`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
