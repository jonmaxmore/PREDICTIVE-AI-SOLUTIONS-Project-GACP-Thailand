#!/usr/bin/env node

/**
 * Banned terms guard (brand/legal hygiene).
 *
 * Fails if tracked files contain prohibited terms/brand references.
 * Uses git grep so checks are fast and repository-scoped.
 */

const { spawnSync } = require('child_process');

// รายการว่างโดยคำสั่ง operator 2026-08-14 (บันทึก the change log วันเดียวกัน):
// รายการเดิมทั้งหมดคือแบรนด์ "หมอพร้อม" กับตัวสะกดอังกฤษของมัน — กฎนั้นมาจาก
// ยุคตั้งโปรเจกต์ ก่อนที่กระทรวงจะบังคับให้ ThaID/หมอพร้อม เป็นทางเข้าระบบ
// หน้า login จึง "ต้อง" เรียกชื่อบริการนั้นตรง ๆ · กฎกับคำสั่งขัดกัน คำสั่งชนะ
// harness คงไว้สำหรับคำต้องห้ามทางกฎหมาย/แบรนด์ตัวจริงในอนาคต — เพิ่ม
// { label, regex } ที่นี่แล้ว local-gate จะบังคับให้เอง (รายการเดิม: git log ไฟล์นี้)
const BANNED_PATTERNS = [];

function runGit(args, cwd = process.cwd()) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    env: process.env,
  });
}

function fail(message) {
  console.error(`[banned-terms] FAIL: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    stagedOnly: args.has('--staged'),
  };
}

function getStagedFiles() {
  const result = runGit([
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMRTUXB',
    '-z',
    '--',
  ]);

  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`Unable to read staged files${output ? `: ${output}` : ''}`);
  }

  return String(result.stdout || '')
    .split('\0')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => file !== 'scripts/ci/check-banned-terms.js');
}

function grepPattern(pattern, stagedFiles) {
  const args = [
    'grep',
    '-nI',
    '-i',
    '-E',
  ];

  if (Array.isArray(stagedFiles)) {
    args.push('--cached');
  }

  args.push(pattern.regex, '--');

  if (Array.isArray(stagedFiles)) {
    args.push(...stagedFiles);
  } else {
    args.push(
      '.',
      ':!scripts/ci/check-banned-terms.js',
      ':!node_modules/**',
      ':!.git/**',
    );
  }

  return runGit(args);
}

function main() {
  const { stagedOnly } = parseArgs(process.argv);
  const stagedFiles = stagedOnly ? getStagedFiles() : null;

  if (stagedOnly && stagedFiles.length === 0) {
    console.log('[banned-terms] No staged files to scan; check skipped');
    return;
  }

  const found = [];

  for (const pattern of BANNED_PATTERNS) {
    const result = grepPattern(pattern, stagedOnly ? stagedFiles : null);

    if (result.status === 0) {
      const lines = String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        found.push({ pattern, lines });
      }
      continue;
    }

    if (result.status === 1) {
      continue; // no matches
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    fail(`Unable to scan repository for "${pattern.label}"${output ? `: ${output}` : ''}`);
  }

  if (found.length > 0) {
    console.error('[banned-terms] Prohibited terms detected:');
    for (const match of found) {
      console.error(`\n  - ${match.pattern.label} (${match.pattern.regex})`);
      for (const line of match.lines) {
        console.error(`    ${line}`);
      }
    }
    fail('Remove prohibited brand terms from tracked files.');
  }

  console.log(stagedOnly ? '[banned-terms] Staged-file scan passed' : '[banned-terms] Repository scan passed');
}

try {
  main();
} catch (error) {
  fail(error.message);
}
