#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, 'apps', 'web-app', 'src');
const FILE_EXTENSIONS = new Set(['.js', '.ts', '.tsx']);

const forbiddenPatterns = [
  /\/api\/provider-cms\//g,
  /\/api\/provider\/stats\b/g,
  /\/api\/provider\/pending-reviews\b/g,
  /\/api\/provider\/pending-audits\b/g,
  /\/api\/provider\/scheduler\/queue\b/g,
  /\/api\/provider\/scheduler\/assign-reviewer\b/g,
  /\/api\/provider\/scheduler\/approve-document\b/g,
  /\/api\/provider\/scheduler\/schedule-audit\b/g,
  /\/api\/provider\/scheduler\/stats\b/g,
  /\/workflow-transition\b/g,
  /\/start-inspection\b/g,
  // Legacy auditor decision path only. The CANONICAL on-site audit decision
  // endpoint POST /audit/onsite/:auditId/decision (services/audit-onsite-service.js,
  // actively served) must NOT match — only the legacy /auditor/applications/:id/decision.
  /\/auditor\/applications\/[^/]+\/decision\b/g,
  /\/audit-timeline\b/g,
  /\/revision\/reminder-run\b/g,
  /\/batch-action\b/g,
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test directories — this gate inspects runtime files only.
      if (entry.name === '__tests__' || entry.name === 'tests') { continue; }
      files.push(...walk(fullPath));
      continue;
    }
    // Skip unit/e2e test + spec files (runtime-only gate; doc-comments in tests
    // legitimately mention legacy paths).
    if (/\.(test|spec)\.[jt]sx?$/.test(entry.name)) { continue; }
    if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function findMatches(content, pattern) {
  const matches = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      matches.push(index + 1);
    }
    pattern.lastIndex = 0;
  }
  return matches;
}

const files = walk(TARGET_DIR);
const violations = [];

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const pattern of forbiddenPatterns) {
    const lines = findMatches(content, pattern);
    for (const lineNumber of lines) {
      violations.push({
        filePath: path.relative(ROOT, filePath),
        lineNumber,
        pattern: pattern.source,
      });
    }
  }
}

if (violations.length > 0) {
  console.error('[provider-api-surface] FAIL: legacy provider API usage found in frontend runtime files');
  for (const violation of violations) {
    console.error(` - ${violation.filePath}:${violation.lineNumber} matched /${violation.pattern}/`);
  }
  process.exit(1);
}

console.log('[provider-api-surface] OK: frontend uses canonical provider API surface');
