#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  MOJIBAKE_HINT_RE,
  countMojibakeScore,
  walkFiles,
  relativePath,
} = require('../tools/encoding-mojibake-utils');

const DEFAULT_ROOTS = ['apps/backend', 'apps/web-app/src', 'docs', 'scripts'];

// Files that INTENTIONALLY contain mojibake bytes and must not fail the gate:
//  - the storage-decode fixture exercises the CP1252→UTF-8 repair logic;
//  - the mojibake tooling itself embeds the marker patterns as literals.
// Matched as posix path substrings so the gate can run in CI without
// red-flagging deliberate data (full-system audit area J, 2026-07-11).
const IGNORE_SUBSTRINGS = [
  'apps/backend/__tests__/unit/storage-decode-filename.test.js',
  'scripts/tools/encoding-mojibake-utils',
  'scripts/ci/check-mojibake-encoding',
  'scripts/tools/fix-mojibake-encoding',
];

function isIgnored(filePath) {
  const posix = filePath.split(path.sep).join('/');
  return IGNORE_SUBSTRINGS.some((sub) => posix.includes(sub));
}

function parseRoots(argv) {
  const roots = argv.filter((arg) => !arg.startsWith('--'));
  return roots.length > 0 ? roots : DEFAULT_ROOTS;
}

function main() {
  const args = process.argv.slice(2);
  const roots = parseRoots(args);

  const candidates = [];
  for (const root of roots) {
    const absoluteRoot = path.resolve(process.cwd(), root);
    for (const filePath of walkFiles(absoluteRoot)) {
      candidates.push(filePath);
    }
  }

  const findings = [];
  const bomFindings = [];
  for (const filePath of candidates) {
    if (isIgnored(filePath)) {
      continue;
    }
    const raw = fs.readFileSync(filePath);
    if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
      bomFindings.push(filePath);
    }

    const content = raw.toString('utf8');
    if (!MOJIBAKE_HINT_RE.test(content)) {
      continue;
    }

    const score = countMojibakeScore(content);
    if (score <= 0) {
      continue;
    }

    findings.push({
      filePath,
      score,
    });
  }

  if (findings.length === 0 && bomFindings.length === 0) {
    console.log('[encoding-check] PASS: no mojibake markers or UTF-8 BOM files found');
    return;
  }

  if (findings.length > 0) {
    console.error(`[encoding-check] FAIL: found ${findings.length} file(s) with mojibake markers`);
    for (const item of findings.slice(0, 100)) {
      console.error(`[encoding-check] ${relativePath(item.filePath)} (score=${item.score})`);
    }
    if (findings.length > 100) {
      console.error(`[encoding-check] ... and ${findings.length - 100} more file(s)`);
    }
  }

  if (bomFindings.length > 0) {
    console.error(`[encoding-check] FAIL: found ${bomFindings.length} UTF-8 BOM file(s)`);
    for (const filePath of bomFindings.slice(0, 100)) {
      console.error(`[encoding-check] ${relativePath(filePath)} (utf8-bom)`);
    }
    if (bomFindings.length > 100) {
      console.error(`[encoding-check] ... and ${bomFindings.length - 100} more BOM file(s)`);
    }
  }

  process.exitCode = 1;
}

main();
