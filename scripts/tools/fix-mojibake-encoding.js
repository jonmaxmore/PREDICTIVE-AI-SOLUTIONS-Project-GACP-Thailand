#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  walkFiles,
  scanAndRepairFile,
  relativePath,
} = require('./encoding-mojibake-utils');

const WRITE_FLAG = '--write';
const STRICT_ROOTS = ['apps/backend', 'apps/web-app/src', 'docs', 'scripts'];

function parseRoots(argv) {
  const rawRoots = argv.filter((arg) => !arg.startsWith('--'));
  if (rawRoots.length > 0) {
    return rawRoots;
  }
  return STRICT_ROOTS;
}

function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes(WRITE_FLAG);
  const roots = parseRoots(args);

  const fileSet = new Set();
  for (const root of roots) {
    const absoluteRoot = path.resolve(process.cwd(), root);
    for (const filePath of walkFiles(absoluteRoot)) {
      fileSet.add(filePath);
    }
  }

  const files = [...fileSet];
  const repairs = [];
  const bomRepairs = [];
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath);
    if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
      bomRepairs.push({
        filePath,
      });
    }

    const repair = scanAndRepairFile(filePath);
    if (repair) {
      repairs.push(repair);
    }
  }

  if (repairs.length === 0 && bomRepairs.length === 0) {
    console.log('[encoding-fix] No safe mojibake repairs or BOM cleanup required');
    return;
  }

  if (repairs.length > 0) {
    console.log(`[encoding-fix] Detected ${repairs.length} file(s) with safe mojibake repairs`);
    for (const item of repairs) {
      console.log(
        `[encoding-fix] ${relativePath(item.filePath)} ` +
          `(mojibake: ${item.beforeScore} -> ${item.afterScore}, thai: ${item.beforeThai} -> ${item.afterThai})`,
      );
    }
  }

  if (bomRepairs.length > 0) {
    console.log(`[encoding-fix] Detected ${bomRepairs.length} UTF-8 BOM file(s)`);
    for (const item of bomRepairs) {
      console.log(`[encoding-fix] ${relativePath(item.filePath)} (remove-utf8-bom)`);
    }
  }

  if (!writeMode) {
    console.log('[encoding-fix] Dry run only. Re-run with --write to apply changes.');
    process.exitCode = 2;
    return;
  }

  const outputByFile = new Map();

  for (const item of repairs) {
    outputByFile.set(item.filePath, item.content);
  }

  for (const item of bomRepairs) {
    const currentContent = outputByFile.has(item.filePath)
      ? outputByFile.get(item.filePath)
      : fs.readFileSync(item.filePath, 'utf8');
    outputByFile.set(item.filePath, currentContent.replace(/^\uFEFF/, ''));
  }

  for (const [filePath, content] of outputByFile.entries()) {
    fs.writeFileSync(filePath, content, 'utf8');
  }

  console.log(`[encoding-fix] Applied ${outputByFile.size} file(s)`);
}

main();
