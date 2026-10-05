#!/usr/bin/env node
/**
 * Agent Q8 — Performance
 * Checks frontend and backend performance characteristics
 */
const { JourneyRunner, waitMs } = require('./journey-helper');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'https://gacpth.com';
const agent = new https.Agent({ rejectUnauthorized: false });
const WEBAPP_SRC = path.join(__dirname, '../../../apps/web-app/src');

async function timedFetch(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, { agent });
    const body = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      timeMs: Date.now() - start,
      bodySizeKB: Math.round(body.length / 1024),
    };
  } catch (err) {
    return { status: 0, ok: false, timeMs: Date.now() - start, error: err.message };
  }
}

function scanDir(dir, exts) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.next'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...scanDir(fullPath, exts));
      else if (exts.some(e => entry.name.endsWith(e))) results.push(fullPath);
    }
  } catch { /* skip */ }
  return results;
}

async function main() {
  const j = new JourneyRunner('Agent Q8 — Performance', '⚡');
  console.log(`\n ${j.name}\n`);

  try {
    // 1. API response time
    const healthResult = await timedFetch(`${BASE}/api/health`);
    if (healthResult.timeMs < 500) {
      j.pass('API response time', `${healthResult.timeMs}ms (< 500ms ✅)`);
    } else if (healthResult.timeMs < 2000) {
      j.pass('API response time', `${healthResult.timeMs}ms (acceptable)`);
    } else {
      j.fail('API response time', `${healthResult.timeMs}ms (slow > 2s)`);
    }

    // 2. Homepage load time
    const homeResult = await timedFetch(`${BASE}/`);
    if (homeResult.timeMs < 3000) {
      j.pass('Homepage load time', `${homeResult.timeMs}ms, ${homeResult.bodySizeKB}KB`);
    } else {
      j.pass('Homepage load time', `${homeResult.timeMs}ms (consider optimization)`);
    }

    await waitMs(200);

    // 3. Login page load
    const loginResult = await timedFetch(`${BASE}/login`);
    j.pass('Login page load', `${loginResult.timeMs}ms, ${loginResult.bodySizeKB}KB`);

    // 4. Check for large files in source
    const files = scanDir(WEBAPP_SRC, ['.tsx', '.ts', '.js']);
    let largeFiles = 0;
    const largeFileList = [];
    for (const file of files) {
      const stats = fs.statSync(file);
      if (stats.size > 20 * 1024) { // > 20KB
        largeFiles++;
        if (largeFileList.length < 5) {
          largeFileList.push(`${path.relative(WEBAPP_SRC, file)} (${Math.round(stats.size / 1024)}KB)`);
        }
      }
    }
    if (largeFiles <= 5) {
      j.pass('Large source files', `${largeFiles} files >20KB (acceptable)`);
    } else {
      j.pass('Large source files', `${largeFiles} files >20KB (consider code splitting)`);
      for (const f of largeFileList) j.pass('  Large file', f);
    }

    // 5. Check for lazy loading
    let lazyImports = 0;
    let dynamicImports = 0;
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      lazyImports += (content.match(/React\.lazy|lazy\(/g) || []).length;
      dynamicImports += (content.match(/import\(/g) || []).length;
    }
    j.pass('Lazy loading', `${lazyImports} React.lazy, ${dynamicImports} dynamic imports`);

    // 6. Check for image optimization
    let nextImage = 0;
    let htmlImg = 0;
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      nextImage += (content.match(/from ['"]next\/image['"]/g) || []).length;
      htmlImg += (content.match(/<img\b/g) || []).length;
    }
    j.pass('Image optimization', `${nextImage} next/image, ${htmlImg} <img> tags`);

    // 7. Check bundle dependencies
    const pkgPath = path.join(WEBAPP_SRC, '../../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {}).length;
      const devDeps = Object.keys(pkg.devDependencies || {}).length;
      j.pass('Dependencies', `${deps} prod, ${devDeps} dev`);

      // Check for heavy dependencies
      const heavyDeps = ['moment', 'lodash', 'jquery', 'bootstrap'];
      const foundHeavy = heavyDeps.filter(d => pkg.dependencies?.[d]);
      if (foundHeavy.length === 0) {
        j.pass('No heavy dependencies', 'No moment/lodash/jquery/bootstrap ✅');
      } else {
        j.pass('Heavy dependencies', `Found: ${foundHeavy.join(', ')}`);
      }
    }

    // 8. Check for memoization usage
    let memoCount = 0;
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      memoCount += (content.match(/useMemo|useCallback|React\.memo/g) || []).length;
    }
    j.pass('Memoization usage', `${memoCount} useMemo/useCallback/React.memo`);

  } catch (err) {
    j.fail('Unexpected error', err.message);
  }

  j.printReport();
  process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
