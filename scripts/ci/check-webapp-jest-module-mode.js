#!/usr/bin/env node

// Guards the web-app jest suite against being run in a module mode its test
// files cannot load in.
//
// The suite is written with CommonJS-only idioms — `__dirname` and `require()`.
// Neither identifier exists in an ES module scope, so running jest under
// `node --experimental-vm-modules` makes those files throw at load time. A
// suite that fails to LOAD never reports which assertions would have failed;
// it just reports fewer tests than the repo actually has.
//
// Measured 2026-07-26 against an unchanged jest.config.mjs, with the runner
// flag as the only variable:
//   with    --experimental-vm-modules : 113/218 suites failed,  1140 tests ran
//   without --experimental-vm-modules : 218/218 suites passed,  1780 tests ran
// The flag was hiding 518 tests that had never executed even once.
//
// This gate fails while both are true at the same time: CommonJS-only idioms
// in the test files, and ESM enabled on the runner or in the config. Either
// direction of fix satisfies it — drop the ESM flag (what the project does
// today), or migrate every listed file to `import.meta.url` and
// `import { jest } from '@jest/globals'`.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_APP = path.join(REPO_ROOT, 'apps', 'web-app');
const PKG_PATH = path.join(WEB_APP, 'package.json');
const CONFIG_PATH = path.join(WEB_APP, 'jest.config.mjs');
const SRC_ROOT = path.join(WEB_APP, 'src');

const ESM_FLAG = '--experimental-vm-modules';
const LABEL = '[jest-module-mode]';
const TEST_FILE_RE = /\.test\.tsx?$/;

// `__dirname` and bare `require(` are the two identifiers that exist in
// CommonJS and simply are not defined in an ES module scope. Matching them
// outside of comments and strings is not worth an AST pass here: a false
// positive costs one line of triage, and this gate runs on every commit.
const CJS_IDIOMS = [
  { name: '__dirname', re: /\b__dirname\b/ },
  { name: '__filename', re: /\b__filename\b/ },
  { name: 'require()', re: /(^|[^.\w])require\s*\(/ },
];

function walkTestFiles(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walkTestFiles(full, found);
    } else if (TEST_FILE_RE.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""');
}

function findCjsIdioms(files) {
  const hits = [];
  for (const file of files) {
    const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
    const used = CJS_IDIOMS.filter((idiom) => idiom.re.test(code)).map((i) => i.name);
    if (used.length > 0) {
      hits.push({ file: path.relative(REPO_ROOT, file), used });
    }
  }
  return hits;
}

// jest.config.mjs is an ES module exporting an object literal, so a CommonJS
// gate cannot require() it. Read the declarations textually, ignoring `//`
// comments — the config discusses ESM at length without declaring it.
function readConfigEsmDeclarations(configSource) {
  const code = configSource.replace(/^\s*\/\/.*$/gm, '');
  const declarations = [];
  if (/extensionsToTreatAsEsm\s*:/.test(code)) declarations.push('extensionsToTreatAsEsm');
  if (/useESM\s*:\s*true/.test(code)) declarations.push('useESM: true');
  return declarations;
}

function main() {
  for (const required of [PKG_PATH, CONFIG_PATH]) {
    if (!fs.existsSync(required)) {
      console.error(`${LABEL} FAIL: expected file is missing: ${path.relative(REPO_ROOT, required)}`);
      process.exitCode = 1;
      return;
    }
  }

  const testScript = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).scripts?.test ?? '';
  const configDeclarations = readConfigEsmDeclarations(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const esmEnabledBy = [];
  if (testScript.includes(ESM_FLAG)) {
    esmEnabledBy.push(`apps/web-app/package.json "test" script (${ESM_FLAG})`);
  }
  for (const declaration of configDeclarations) {
    esmEnabledBy.push(`apps/web-app/jest.config.mjs (${declaration})`);
  }

  const testFiles = walkTestFiles(SRC_ROOT);
  const cjsFiles = findCjsIdioms(testFiles);

  if (esmEnabledBy.length === 0 || cjsFiles.length === 0) {
    const mode = esmEnabledBy.length === 0 ? 'CommonJS' : 'ESM';
    console.log(
      `${LABEL} PASS: ${testFiles.length} test file(s) are loadable in ${mode} mode ` +
        `(${cjsFiles.length} use CommonJS-only idioms)`,
    );
    return;
  }

  console.error(
    `${LABEL} FAIL: ESM is enabled for the web-app jest suite, but ${cjsFiles.length} of ` +
      `${testFiles.length} test file(s) use CommonJS-only idioms and cannot load as ES modules.`,
  );
  console.error(`${LABEL}`);
  console.error(`${LABEL} ESM is enabled by:`);
  for (const source of esmEnabledBy) {
    console.error(`${LABEL}   - ${source}`);
  }
  console.error(`${LABEL}`);
  console.error(`${LABEL} Affected files (first 20):`);
  for (const hit of cjsFiles.slice(0, 20)) {
    console.error(`${LABEL}   ${hit.file}  [${hit.used.join(', ')}]`);
  }
  if (cjsFiles.length > 20) {
    console.error(`${LABEL}   ... and ${cjsFiles.length - 20} more file(s)`);
  }
  console.error(`${LABEL}`);
  console.error(`${LABEL} These suites fail to LOAD, which reports as fewer tests rather than`);
  console.error(`${LABEL} as failing assertions. Fix by removing ${ESM_FLAG} from the "test"`);
  console.error(`${LABEL} script and the ESM declarations from jest.config.mjs, or by migrating`);
  console.error(`${LABEL} every file above to import.meta.url and @jest/globals.`);

  process.exitCode = 1;
}

main();
