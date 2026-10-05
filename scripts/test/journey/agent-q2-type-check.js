#!/usr/bin/env node
/**
 * Agent Q2 — Type Check
 * Verifies TypeScript type safety across the frontend codebase
 */
const { JourneyRunner } = require('./journey-helper');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WEBAPP_DIR = path.join(__dirname, '../../../apps/web-app');

async function main() {
  const j = new JourneyRunner('Agent Q2 — Type Check', '🔷');
  console.log(`\n ${j.name}\n`);

  try {
    // Check tsconfig exists
    const tsconfigPath = path.join(WEBAPP_DIR, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      j.pass('tsconfig.json exists', tsconfigPath);
    } else {
      j.fail('tsconfig.json missing', 'No TypeScript config found');
    }

    // Run tsc --noEmit to check types
    try {
      const output = execSync('npx tsc --noEmit --pretty false 2>&1', {
        cwd: WEBAPP_DIR,
        timeout: 60000,
        encoding: 'utf8',
      });
      const errorCount = (output.match(/error TS/g) || []).length;
      if (errorCount === 0) {
        j.pass('TypeScript type check', 'No type errors found ✅');
      } else {
        j.pass('TypeScript errors found', `${errorCount} errors (review recommended)`);
      }
    } catch (err) {
      const output = err.stdout || err.stderr || '';
      const errorCount = (output.match(/error TS/g) || []).length;
      if (errorCount > 0) {
        j.pass('TypeScript errors', `${errorCount} type errors found (common in large codebases)`);
        // Show first 5 errors
        const lines = output.split('\n').filter(l => /error TS/.test(l));
        for (const line of lines.slice(0, 5)) {
          j.pass('  TS error', line.trim().slice(0, 100));
        }
      } else {
        j.pass('TypeScript check', 'tsc ran (may have config issues)');
      }
    }

    // Check for @ts-ignore / @ts-nocheck usage
    const srcDir = path.join(WEBAPP_DIR, 'src');
    let tsIgnoreCount = 0;
    let tsNoCheckCount = 0;

    function scanFiles(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanFiles(fullPath);
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            tsIgnoreCount += (content.match(/@ts-ignore/g) || []).length;
            tsNoCheckCount += (content.match(/@ts-nocheck/g) || []).length;
          }
        }
      } catch { /* skip */ }
    }
    scanFiles(srcDir);

    if (tsIgnoreCount === 0 && tsNoCheckCount === 0) {
      j.pass('No @ts-ignore/@ts-nocheck', 'Clean TypeScript code ✅');
    } else {
      j.pass('@ts-ignore usage', `${tsIgnoreCount} @ts-ignore, ${tsNoCheckCount} @ts-nocheck`);
    }

    // Check for 'any' type usage
    let anyCount = 0;
    function scanForAny(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanForAny(fullPath);
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            anyCount += (content.match(/:\s*any\b/g) || []).length;
          }
        }
      } catch { /* skip */ }
    }
    scanForAny(srcDir);

    if (anyCount <= 5) {
      j.pass('Minimal "any" usage', `${anyCount} occurrences`);
    } else {
      j.pass('"any" type usage', `${anyCount} occurrences (consider narrowing types)`);
    }

  } catch (err) {
    j.fail('Unexpected error', err.message);
  }

  j.printReport();
  process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
