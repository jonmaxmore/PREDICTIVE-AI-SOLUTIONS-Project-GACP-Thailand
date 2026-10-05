#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const sourceExts = new Set(['.js', '.jsx', '.ts', '.tsx']);
const ignoreDirs = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.git', '.turbo']);

const stats = {
  sourceFiles: 0,
  files500Plus: [],
  files400Plus: [],
  anyUsages: 0,
  backendCommonJsFiles: 0,
  frontendTsFiles: 0,
};

function walk(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, callback);
      continue;
    }

    callback(fullPath);
  }
}

function countLines(text) {
  return text.split(/\r?\n/).length;
}

function toRelative(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function inspectFile(filePath) {
  const rel = toRelative(filePath);
  const ext = path.extname(rel);

  if (!sourceExts.has(ext)) {
    return;
  }

  stats.sourceFiles += 1;
  const text = fs.readFileSync(filePath, 'utf8');
  const lineCount = countLines(text);

  if (lineCount >= 500) {
    stats.files500Plus.push({ file: rel, lines: lineCount });
  } else if (lineCount >= 400) {
    stats.files400Plus.push({ file: rel, lines: lineCount });
  }

  if (rel.startsWith('apps/web-app/src/') && (ext === '.ts' || ext === '.tsx')) {
    stats.frontendTsFiles += 1;
    stats.anyUsages += (text.match(/\bany\b/g) || []).length;
  }

  if (rel.startsWith('apps/backend/') && ext === '.js') {
    if (/module\.exports|require\(/.test(text)) {
      stats.backendCommonJsFiles += 1;
    }
  }
}

function printTopFiles(title, rows, limit) {
  if (rows.length === 0) {
    console.log(`${title}: none`);
    return;
  }

  console.log(`${title}:`);
  rows
    .sort((a, b) => b.lines - a.lines)
    .slice(0, limit)
    .forEach((row) => {
      console.log(`  - ${row.lines} lines :: ${row.file}`);
    });
}

function level(current, target) {
  if (current <= target) {
    return 'OK';
  }
  if (current <= target * 1.5) {
    return 'WARN';
  }
  return 'CRITICAL';
}

function main() {
  walk(rootDir, inspectFile);

  const files500Plus = stats.files500Plus.length;
  const files400Plus = stats.files400Plus.length;
  const anyUsage = stats.anyUsages;

  console.log('=== vNext AI Audit ===');
  console.log(`Source files scanned: ${stats.sourceFiles}`);
  console.log(`Frontend TS/TSX files: ${stats.frontendTsFiles}`);
  console.log(`Files >= 500 lines: ${files500Plus} [${level(files500Plus, 20)}]`);
  console.log(`Files 400-499 lines: ${files400Plus}`);
  console.log(`'any' occurrences (frontend): ${anyUsage} [${level(anyUsage, 100)}]`);
  console.log(`Backend CommonJS files: ${stats.backendCommonJsFiles}`);
  console.log('');

  printTopFiles('Top large files', stats.files500Plus, 10);
  console.log('');
  printTopFiles('Near threshold files', stats.files400Plus, 8);

  console.log('\nRecommended next actions:');
  console.log('  1. Split every changed file that exceeds 500 lines before merge.');
  console.log("  2. Replace 'any' in auth/member flow first (critical path).");
  console.log('  3. Keep backend JS stable, but migrate new modules to TS or JSDoc-typed boundaries.');
  console.log('  4. Run `npm run check:max-lines` and `npm --prefix apps/web-app run lint:auth` in every PR.');
}

main();
