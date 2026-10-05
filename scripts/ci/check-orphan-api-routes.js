#!/usr/bin/env node
/*
 * Detects top-level API route entry files that are not mounted by
 * apps/backend/routes/api/index.js.
 *
 * Notes:
 * - helper modules (e.g. *-routes.js / *-utils.js) are intentionally excluded
 *   because they are registered inside canonical route entry files.
 * - mount detection is based on require('./...') references in index.js.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const apiDir = path.join(repoRoot, 'apps', 'backend', 'routes', 'api');
const indexFile = path.join(apiDir, 'index.js');

// Files exempted from the orphan rule, each with the reason it is exempt.
// Every entry must name a file that EXISTS: an exemption for a deleted file is a
// register entry nobody can verify, and it silently grants cover to any future
// file that happens to reuse the name. `provider-cms.js` was removed here on
// 2026-08-14 (rules audit wave 1B) — the file it excused was deleted in a9778bfd
// ("organize 80 route files into 12 domain sub-directories").
const ignoredFiles = new Map([
  ['index.js', 'the mount file itself'],
]);

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function collectMountedModules(indexSource) {
  const mounted = new Set();
  const requireRegex = /require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g;
  let match = requireRegex.exec(indexSource);

  while (match) {
    const mod = match[1].replace(/\\/g, '/');
    const topLevel = mod.split('/')[0];
    mounted.add(`${topLevel}.js`);
    match = requireRegex.exec(indexSource);
  }

  return mounted;
}

function isRouteEntryFile(source) {
  const hasRouterFactory = /express\.Router\s*\(/.test(source);
  const exportsRouter = /module\.exports\s*=\s*router\b/.test(source);
  return hasRouterFactory && exportsRouter;
}

function main() {
  const indexSource = readFile(indexFile);
  const mountedFiles = collectMountedModules(indexSource);

  const staleIgnores = [...ignoredFiles.keys()].filter(
    (name) => !fs.existsSync(path.join(apiDir, name)),
  );
  if (staleIgnores.length > 0) {
    console.error('[orphan-api-routes] FAIL: exemption list names file(s) that do not exist:');
    staleIgnores.forEach((name) => {
      console.error(` - ${name} (exempt because: ${ignoredFiles.get(name)})`);
    });
    console.error('   Delete the entry, or restore the file it was written for.');
    process.exit(1);
  }

  const allTopLevelRouteEntries = fs
    .readdirSync(apiDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .filter((name) => !ignoredFiles.has(name))
    .filter((name) => {
      const source = readFile(path.join(apiDir, name));
      return isRouteEntryFile(source);
    });

  const orphanFiles = allTopLevelRouteEntries.filter((name) => !mountedFiles.has(name));

  if (orphanFiles.length === 0) {
    console.log('[orphan-api-routes] OK: no orphan route files detected');
    process.exit(0);
  }

  console.error('[orphan-api-routes] Found orphan route files (not mounted by api/index.js):');
  orphanFiles.forEach((file) => {
    console.error(` - apps/backend/routes/api/${file}`);
  });
  process.exit(1);
}

main();
