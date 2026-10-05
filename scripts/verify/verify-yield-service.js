const yieldService = require('../apps/backend/services/yield-service');

function verifyYield() {
    console.log('--- Verifying Yield Service ---');

    // Case 1: Cannabis Indoor 1 Rai
    // 1 Rai = 1600 sqm. Effective = 1280. Spacing = 1.5. Plants = 853.
    // Yield = 853 * 0.5 * 0.95 = 405.175
    const case1 = yieldService.calculateYield('CAN', 'INDOOR', 1);
    console.log('Case 1 (CAN, INDOOR, 1 Rai):', case1);
    if (case1.plantCount !== 853 || case1.estimatedYield < 400) throw new Error('Case 1 Failed');

    // Case 2: Kratom Outdoor 1 Rai
    // 1 Rai = 1600 sqm. Effective = 1280. Spacing = 4.0. Plants = 320.
    // Yield = 320 * 2.0 * 0.70 = 448.0
    const case2 = yieldService.calculateYield('KRA', 'OUTDOOR', 1);
    console.log('Case 2 (KRA, OUTDOOR, 1 Rai):', case2);
    if (case2.plantCount !== 320 || Math.abs(case2.estimatedYield - 448) > 1) throw new Error('Case 2 Failed');

    console.log('Yield Service Verification Passed');
}

verifyYield();
