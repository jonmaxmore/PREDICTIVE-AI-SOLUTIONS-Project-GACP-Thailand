#!/usr/bin/env node
/**
 * Auth hardening gate
 * - Runs shared security convention checks
 * - Runs focused auth/security backend tests
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..', '..');

function run(command, args, options = {}) {
  const quote = (value) => {
    const raw = String(value ?? '');
    if (!/[\s"]/u.test(raw)) {
      return raw;
    }
    return `"${raw.replace(/"/g, '\\"')}"`;
  };

  const commandLine = [command, ...args.map(quote)].join(' ');
  const result = spawnSync(commandLine, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    ...options,
  });

  if (result.error) {
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const securityConventionsPath = path.join(__dirname, '..', 'ci', 'check-security-conventions.js');
if (fs.existsSync(securityConventionsPath)) {
  runNodeScript(securityConventionsPath);
}

run('npm', [
  '--prefix',
  'apps/backend',
  'test',
  '--',
  '--runInBand',
  '--runTestsByPath',
  '__tests__/unit/client-ip.test.js',
]);

console.log('\n[auth-hardening-gate] PASS');
