#!/usr/bin/env node
/**
 * Canonical ERP regression gate runner.
 *
 * Expected runtime environment:
 * - Backend API is already running and reachable via BASE_URL
 * - Seed identities are provisioned (health + provider roles)
 */

const { spawnSync } = require('child_process');

const maxAttempts = Math.max(1, Number(process.env.ERP_GATE_RETRIES || 2));

const requiredScripts = [
  'scripts/test/validate-health-planting-flow.js',
  'scripts/verify/verify-upload-integration.js',
];

function runNodeScript(scriptPath) {
  return spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  for (const script of requiredScripts) {
    let passed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      console.log(`[erp-gate] run ${script} (attempt ${attempt}/${maxAttempts})`);
      const result = runNodeScript(script);

      if (result.status === 0) {
        passed = true;
        break;
      }

      if (attempt < maxAttempts) {
        await sleep(800 * attempt);
      }
    }

    if (!passed) {
      console.error(`[erp-gate] FAILED: ${script}`);
      process.exit(1);
    }
  }

  console.log('[erp-gate] PASS: all required regression scripts succeeded');
}

run().catch((error) => {
  console.error('[erp-gate] unexpected error:', error.message);
  process.exit(1);
});
