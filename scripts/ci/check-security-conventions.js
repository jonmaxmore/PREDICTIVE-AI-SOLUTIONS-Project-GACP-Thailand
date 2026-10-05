#!/usr/bin/env node

/**
 * Security convention guardrails.
 *
 * Enforces:
 * 1. No direct `req.ip` usage outside approved compatibility files.
 * 2. No `Math.random()` usage in runtime backend code paths.
 */

const fs = require('fs');
const path = require('path');

const REQ_IP_PATTERN = /\breq\.ip\b/;
const MATH_RANDOM_PATTERN = /\bMath\.random\s*\(/;
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);
const ALWAYS_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
]);

const reqIpAllowlist = new Set([
  path.normalize('apps/backend/utils/client-ip.js'),
  path.normalize('apps/backend/__tests__/unit/client-ip.test.js'),
]);

const runtimeMathRandomIgnorePrefixes = [
  path.normalize('apps/backend/scripts/'),
  path.normalize('apps/backend/__tests__/'),
  path.normalize('apps/backend/e2e/'),
  path.normalize('apps/backend/chaos-tests/'),
  path.normalize('apps/backend/prisma/'),
  path.normalize('apps/backend/uat-tests/'),
];

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function collectSourceFiles(rootDir) {
  const files = [];

  function visit(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ALWAYS_IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (entry.isFile() && isSourceFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  visit(rootDir);
  return files;
}

function findPatternLines(content, pattern) {
  const lines = content.split(/\r?\n/);
  const matches = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (pattern.test(lines[idx])) {
      matches.push({
        line: idx + 1,
        text: lines[idx].trim(),
      });
    }
  }
  return matches;
}

function isRuntimeMathRandomExcluded(relativePath) {
  return runtimeMathRandomIgnorePrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function main() {
  const repoRoot = process.cwd();
  const backendRoot = path.join(repoRoot, 'apps', 'backend');
  const files = collectSourceFiles(backendRoot);

  const reqIpViolations = [];
  const mathRandomViolations = [];

  for (const absolutePath of files) {
    const relativePath = path.normalize(path.relative(repoRoot, absolutePath));
    const content = fs.readFileSync(absolutePath, 'utf8');

    if (!reqIpAllowlist.has(relativePath)) {
      const matches = findPatternLines(content, REQ_IP_PATTERN);
      for (const match of matches) {
        reqIpViolations.push({
          file: relativePath,
          line: match.line,
          text: match.text,
        });
      }
    }

    if (!isRuntimeMathRandomExcluded(relativePath)) {
      const matches = findPatternLines(content, MATH_RANDOM_PATTERN);
      for (const match of matches) {
        mathRandomViolations.push({
          file: relativePath,
          line: match.line,
          text: match.text,
        });
      }
    }
  }

  if (reqIpViolations.length === 0 && mathRandomViolations.length === 0) {
    console.log('[security-conventions] PASS');
    return;
  }

  if (reqIpViolations.length > 0) {
    console.error('\n[security-conventions] Direct req.ip usage is forbidden:');
    for (const violation of reqIpViolations) {
      console.error(`- ${violation.file}:${violation.line} ${violation.text}`);
    }
  }

  if (mathRandomViolations.length > 0) {
    console.error('\n[security-conventions] Math.random() is forbidden in runtime backend code:');
    for (const violation of mathRandomViolations) {
      console.error(`- ${violation.file}:${violation.line} ${violation.text}`);
    }
  }

  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`[security-conventions] failed: ${error.message}`);
  process.exit(1);
}
