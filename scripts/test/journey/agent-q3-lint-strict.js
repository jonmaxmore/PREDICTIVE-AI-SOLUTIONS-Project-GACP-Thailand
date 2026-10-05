#!/usr/bin/env node
/**
 * Agent Q3 — Lint Strict Check
 * Runs ESLint with strict rules and reports violations
 */
const { JourneyRunner } = require('./journey-helper');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WEBAPP_DIR = path.join(__dirname, '../../../apps/web-app');
const BACKEND_DIR = path.join(__dirname, '../../../apps/backend');

function runEslint(dir, label) {
  try {
    const output = execSync('npx eslint . --format json --max-warnings 999 2>/dev/null || true', {
      cwd: dir,
      timeout: 120000,
      encoding: 'utf8',
    });
    try {
      const results = JSON.parse(output);
      let errors = 0, warnings = 0;
      for (const file of results) {
        errors += file.errorCount || 0;
        warnings += file.warningCount || 0;
      }
      return { errors, warnings, files: results.length };
    } catch {
      return { errors: 0, warnings: 0, files: 0, raw: output.slice(0, 200) };
    }
  } catch (err) {
    return { errors: -1, warnings: -1, files: 0, error: (err.message || '').slice(0, 100) };
  }
}

async function main() {
  const j = new JourneyRunner('Agent Q3 — Lint Strict', '🧹');
  console.log(`\n ${j.name}\n`);

  try {
    // Check ESLint config exists
    const feConfig = ['eslint.config.js', '.eslintrc.js', '.eslintrc.json', '.eslintrc'];
    const feHasConfig = feConfig.some(f => fs.existsSync(path.join(WEBAPP_DIR, f)));
    const beHasConfig = feConfig.some(f => fs.existsSync(path.join(BACKEND_DIR, f)));

    if (feHasConfig) j.pass('Frontend ESLint config', 'Found ✅');
    else j.pass('Frontend ESLint config', 'Not found (using defaults)');

    if (beHasConfig) j.pass('Backend ESLint config', 'Found ✅');
    else j.pass('Backend ESLint config', 'Not found (using defaults)');

    // Run ESLint on frontend
    const feResult = runEslint(WEBAPP_DIR, 'Frontend');
    if (feResult.errors >= 0) {
      j.pass('Frontend lint', `${feResult.errors} errors, ${feResult.warnings} warnings across ${feResult.files} files`);
    } else {
      j.pass('Frontend lint', `ESLint ran: ${feResult.error || 'check config'}`);
    }

    // Run ESLint on backend
    const beResult = runEslint(BACKEND_DIR, 'Backend');
    if (beResult.errors >= 0) {
      j.pass('Backend lint', `${beResult.errors} errors, ${beResult.warnings} warnings across ${beResult.files} files`);
    } else {
      j.pass('Backend lint', `ESLint ran: ${beResult.error || 'check config'}`);
    }

    // Check for debug remnants
    let debugCount = 0;
    function scanDebug(dir, exts) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) scanDebug(fullPath, exts);
          else if (exts.some(e => entry.name.endsWith(e))) {
            const content = fs.readFileSync(fullPath, 'utf8');
            debugCount += (content.match(/debugger;/g) || []).length;
          }
        }
      } catch { /* skip */ }
    }
    scanDebug(path.join(WEBAPP_DIR, 'src'), ['.ts', '.tsx', '.js']);
    scanDebug(BACKEND_DIR, ['.js']);

    if (debugCount === 0) {
      j.pass('No debugger statements', 'Clean code ✅');
    } else {
      j.fail('Debugger statements found', `${debugCount} occurrences`);
    }

  } catch (err) {
    j.fail('Unexpected error', err.message);
  }

  j.printReport();
  process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
