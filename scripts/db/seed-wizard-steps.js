// scripts/seed-wizard-steps.js
require('dotenv').config({ path: 'apps/backend/.env' }); // Load backend env
const wizardConfigService = require('../apps/backend/services/wizard-config-service');

async function seed() {
    console.log('Seeding Wizard Steps...');
    try {
        const result = await wizardConfigService.seedDefaultSteps();
        console.log('Seed Complete:', result);
    } catch (error) {
        console.error('Seed Failed:', error);
    } finally {
        process.exit();
    }
}

seed();
