#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const PATTERNS = {
  jwt_secret: /JWT_SECRET\s*=\s*['"](?!process\.env)[^'"]+['"]/gi,
  api_key: /API_KEY\s*=\s*['"](?!process\.env)[^'"]+['"]/gi,
  password: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  postgres_uri: /postgres(ql)?:\/\/[^'"]+/gi,
  redis_url: /redis:\/\/[^'"]+/gi,
  aws_key: /(AWS|aws)_(ACCESS_KEY|SECRET|KEY_ID)\s*=\s*['"][^'"]+['"]/gi
};

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', 'archive'];

function scanFile(filePath) {
  const findings = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  Object.entries(PATTERNS).forEach(([type, pattern]) => {
    lines.forEach((line, idx) => {
      if (pattern.test(line)) {
        findings.push({
          file: filePath,
          line: idx + 1,
          type,
          snippet: line.trim().substring(0, 80)
        });
      }
    });
  });

  return findings;
}

function scanDirectory(dir, findings = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !EXCLUDE_DIRS.includes(entry.name)) {
      scanDirectory(fullPath, findings);
    } else if (entry.isFile() && /\.(js|ts|tsx|jsx)$/.test(entry.name)) {
      findings.push(...scanFile(fullPath));
    }
  });

  return findings;
}

const rootDir = process.argv[2] || process.cwd();
console.log(`Scanning ${rootDir} for hardcoded secrets...\n`);

const findings = scanDirectory(rootDir);

if (findings.length === 0) {
  console.log('No hardcoded secrets detected!');
  process.exit(0);
}

console.log(`Found ${findings.length} potential security issues\n`);

const grouped = findings.reduce((acc, f) => {
  acc[f.type] = acc[f.type] || [];
  acc[f.type].push(f);
  return acc;
}, {});

Object.entries(grouped).forEach(([type, items]) => {
  console.log(`${type.toUpperCase()}: ${items.length} occurrences`);
  items.slice(0, 3).forEach(item => console.log(`   ${item.file}:${item.line}`));
  if (items.length > 3) console.log(`   ... and ${items.length - 3} more`);
});

console.log('\n Run: node scripts/security/fix-secrets.js');
process.exit(1);
