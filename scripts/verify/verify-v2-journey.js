/**
 * Compatibility wrapper for historical "verify-v2-journey" usage.
 *
 * Canonical verification suite is ERP regression gate under current API surface.
 */

const { spawnSync } = require('child_process');

function run() {
  console.log('[verify-v2-journey] Deprecated script alias. Running canonical ERP regression gate...');

  const result = spawnSync('node', ['scripts/run-regression-gate.js'], {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });

  if (result.status !== 0) {
    console.error('[verify-v2-journey] FAIL');
    process.exit(result.status || 1);
  }

  console.log('[verify-v2-journey] PASS');
}

run();
