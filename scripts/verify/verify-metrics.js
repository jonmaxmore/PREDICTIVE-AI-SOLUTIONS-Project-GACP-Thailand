const metricsService = require('../apps/backend/services/metrics-service');

async function runVerification() {
  console.log('--- Verifying Metrics Service ---');
  try {
    const stats = await metricsService.getDashboardStats();
    console.log('[verify-metrics] Metrics service returned data:');
    console.log(JSON.stringify(stats, null, 2));

    if (!stats.overview || !stats.byStatus || !stats.byPlantType) {
      throw new Error('Missing required keys in response');
    }

    console.log('[verify-metrics] PASS');
    process.exit(0);
  } catch (error) {
    console.error('[verify-metrics] FAIL:', error);
    process.exit(1);
  }
}

runVerification();
