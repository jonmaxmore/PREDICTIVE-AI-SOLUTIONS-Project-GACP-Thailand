// ตรวจว่าโค้ด schema และ path ไม่ใช้คำต้องห้ามและตรง casing ตาม docs/glossary.md
// รันด้วย Node 24 โดยตรง (type stripping) : node scripts/check-glossary.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.prisma',
  '.sql',
  '.yaml',
  '.yml',
]);
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  '.turbo',
  'playwright-report',
  'test-results',
  'docs',
  'generated',
]);
// lockfile มีชื่อแพ็กเกจของคนอื่น ไม่ใช่ชื่อที่เราตั้ง
const SKIPPED_FILES = new Set(['scripts/check-glossary.ts', 'pnpm-lock.yaml']);
const ALLOW_MARKER = 'glossary-allow';

type ForbiddenTerm = { readonly pattern: RegExp; readonly useInstead: string };

const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = [
  { pattern: /\bwizard\b/i, useInstead: 'ApplicationForm' },
  { pattern: /\bstepper\b/i, useInstead: 'ApplicationFormStep' },
  { pattern: /\bfarmer\b/i, useInstead: 'Applicant / APPLICANT' },
  { pattern: /\bentity\b/i, useInstead: 'Applicant' },
  { pattern: /\btenant\b/i, useInstead: 'CertificationBody' },
  { pattern: /\borganization\b/i, useInstead: 'CertificationBody' },
  { pattern: /\bauditor\b/i, useInstead: 'DOCUMENT_REVIEWER / FIELD_INSPECTOR' },
  { pattern: /\bsuperuser\b/i, useInstead: 'SYSTEM_ADMIN' },
  { pattern: /\bchanote\b/i, useInstead: 'LandParcel / LAND_RIGHTS_DOCUMENT' },
  { pattern: /\binvoice\b/i, useInstead: 'Quotation / Receipt' },
  { pattern: /\bslip\b/i, useInstead: 'Payment' },
  { pattern: /\bscheduler\b/i, useInstead: 'Automation' },
  { pattern: /\bcron\b/i, useInstead: 'Automation' },
  { pattern: /\bcoordinator\b/i, useInstead: 'DISPATCHER' },
  { pattern: /\bworker\b/i, useInstead: 'Automation' },
  { pattern: /\bCAN\b/, useInstead: 'cannabis' },
];

const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;
const LOWER_SNAKE = /^[a-z][a-z0-9_]*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

type Violation = { readonly file: string; readonly line: number; readonly message: string };

function walk(directory: string, files: string[]): void {
  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(name)) walk(fullPath, files);
      continue;
    }
    const extension = name.slice(name.lastIndexOf('.'));
    if (SCANNED_EXTENSIONS.has(extension)) files.push(fullPath);
  }
}

function toRepoPath(fullPath: string): string {
  return relative(ROOT, fullPath).split('\\').join('/');
}

function checkForbiddenTerms(
  repoPath: string,
  lines: readonly string[],
  violations: Violation[],
): void {
  for (const term of FORBIDDEN_TERMS) {
    if (term.pattern.test(repoPath)) {
      violations.push({
        file: repoPath,
        line: 0,
        message: `path มีคำต้องห้าม ${term.pattern.source} ใช้ ${term.useInstead}`,
      });
    }
  }
  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const term of FORBIDDEN_TERMS) {
      if (term.pattern.test(line)) {
        violations.push({
          file: repoPath,
          line: index + 1,
          message: `คำต้องห้าม ${term.pattern.source} ใช้ ${term.useInstead} แทน (หรือใส่ ${ALLOW_MARKER} พร้อมเหตุผล)`,
        });
      }
    }
  });
}

function checkPrismaConventions(
  repoPath: string,
  lines: readonly string[],
  violations: Violation[],
): void {
  let insideEnum = false;
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNumber = index + 1;

    const modelMatch = /^model\s+(\S+)/.exec(line);
    if (modelMatch?.[1] && !PASCAL.test(modelMatch[1])) {
      violations.push({
        file: repoPath,
        line: lineNumber,
        message: `ชื่อ model ต้องเป็น PascalCase: ${modelMatch[1]}`,
      });
    }

    const enumMatch = /^enum\s+(\S+)/.exec(line);
    if (enumMatch) {
      insideEnum = true;
      if (enumMatch[1] && !PASCAL.test(enumMatch[1])) {
        violations.push({
          file: repoPath,
          line: lineNumber,
          message: `ชื่อ enum ต้องเป็น PascalCase: ${enumMatch[1]}`,
        });
      }
      return;
    }
    if (insideEnum) {
      if (line.startsWith('}')) {
        insideEnum = false;
        return;
      }
      const member = line.split(/\s+/)[0];
      if (
        member &&
        !member.startsWith('//') &&
        !member.startsWith('@@') &&
        !UPPER_SNAKE.test(member)
      ) {
        violations.push({
          file: repoPath,
          line: lineNumber,
          message: `enum member ต้องเป็น UPPER_SNAKE_CASE: ${member}`,
        });
      }
    }

    for (const mapMatch of line.matchAll(/@@?map\("([^"]+)"\)/g)) {
      const mapped = mapMatch[1];
      if (mapped && !LOWER_SNAKE.test(mapped)) {
        violations.push({
          file: repoPath,
          line: lineNumber,
          message: `@map/@@map ต้องเป็น snake_case: ${mapped}`,
        });
      }
    }
  });
}

function main(): void {
  const files: string[] = [];
  walk(ROOT, files);
  const violations: Violation[] = [];

  for (const fullPath of files) {
    const repoPath = toRepoPath(fullPath);
    if (SKIPPED_FILES.has(repoPath)) continue;
    const lines = readFileSync(fullPath, 'utf8').split(/\r?\n/);
    checkForbiddenTerms(repoPath, lines, violations);
    if (repoPath.endsWith('.prisma')) checkPrismaConventions(repoPath, lines, violations);
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}:${violation.line}: ${violation.message}`);
    }
    console.error(`glossary: พบ ${violations.length} จุดที่ต้องแก้`);
    process.exit(1);
  }
  console.info(`glossary: ok (${files.length} files)`);
}

main();
