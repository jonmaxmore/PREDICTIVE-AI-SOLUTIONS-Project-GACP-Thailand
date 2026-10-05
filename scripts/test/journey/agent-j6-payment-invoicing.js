#!/usr/bin/env node
/**
 * Agent J6 — Payment & Invoicing Journey
 * Tests: pricing → fees → quotes → master data → calculations
 */
const { JourneyRunner, api, loginHealth, generateThaiId, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J6 — Payment & Invoicing', '💰');
    console.log(`\n ${j.name}\n`);

    try {
        // Step 1: Pricing fees (public)
        const fees = await api('GET', '/pricing/fees');
        if (fees.ok) j.pass('Get pricing fee schedule', `status: ${fees.status}`);
        else j.fail('Get pricing fee schedule', `status: ${fees.status}`);

        // Step 2: Calculate fees
        const calc = await api('POST', '/pricing/calculate', {
            body: { plantCount: 500, area: 10, cultivationMethod: 'outdoor' },
        });
        if (calc.ok) j.pass('Calculate application fees', `status: ${calc.status}`);
        else j.fail('Calculate application fees', `status: ${calc.status}`);

        // Step 3: Invoice phase pricing
        const phase1 = await api('GET', '/pricing/invoice/phase1');
        if (phase1.ok) j.pass('Phase 1 invoice pricing', `status: ${phase1.status}`);
        else j.fail('Phase 1 invoice pricing', `status: ${phase1.status}`);

        const phase2 = await api('GET', '/pricing/invoice/phase2');
        if (phase2.ok) j.pass('Phase 2 invoice pricing', `status: ${phase2.status}`);
        else j.fail('Phase 2 invoice pricing', `status: ${phase2.status}`);

        // Step 4: Login as health user
        const healthId = generateThaiId('110000000000');
        const healthToken = await loginHealth(healthId);
        if (healthToken) j.pass('Login as health user', 'Token acquired');
        else j.fail('Login as health user', 'No token');

        await waitMs(300);

        // Step 5: My quotes
        if (healthToken) {
            const myQuotes = await api('GET', '/quotes/my', { token: healthToken });
            if (myQuotes.ok) j.pass('My quotes', `status: ${myQuotes.status}`);
            else j.fail('My quotes', `status: ${myQuotes.status}`);
        } else j.skip('My quotes', 'No token');

        // Step 6: Master data fees
        const mdFees = await api('GET', '/master-data/fees');
        if (mdFees.ok) j.pass('Master data fees', `status: ${mdFees.status}`);
        else j.fail('Master data fees', `status: ${mdFees.status}`);

        // Step 7: QR pricing
        const qrPricing = await api('GET', '/master-data/qr-pricing');
        if (qrPricing.ok) j.pass('QR pricing', `status: ${qrPricing.status}`);
        else j.fail('QR pricing', `status: ${qrPricing.status}`);

        // Step 8: Master data purposes
        const purposes = await api('GET', '/master-data/purposes');
        if (purposes.ok) j.pass('Master data purposes', `status: ${purposes.status}`);
        else j.fail('Master data purposes', `status: ${purposes.status}`);

        // Step 9: Master data cultivation methods
        const methods = await api('GET', '/master-data/cultivation-methods');
        if (methods.ok) j.pass('Cultivation methods', `status: ${methods.status}`);
        else j.fail('Cultivation methods', `status: ${methods.status}`);

        // Step 10: GACP standards
        const standards = await api('GET', '/standards');
        if (standards.ok) j.pass('GACP standards', `status: ${standards.status}`);
        else j.fail('GACP standards', `status: ${standards.status}`);

    } catch (err) {
        j.fail('Unexpected error', err.message);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
