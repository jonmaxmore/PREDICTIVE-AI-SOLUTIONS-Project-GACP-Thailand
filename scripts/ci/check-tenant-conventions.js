#!/usr/bin/env node

/**
 * Tenant convention guardrails (ADR-014).
 *
 * Enforces conventions for cross-tenant code paths so that Phase 3c (RLS)
 * does not silently drop rows from a forgotten unscoped query, and so that
 * platform-admin handlers cannot accidentally land writes in the wrong
 * tenant.
 *
 * Rules:
 *
 * 1. Every file under apps/backend/routes/api/platform-admin/** that
 *    references `prisma.` MUST import `withoutTenantScope` from
 *    `services/tenant-context` AND call it at least once. These handlers
 *    cross tenants by definition; forgetting the scope means they read
 *    only the bound (or no) tenant's data.
 *
 * 2. Every file under apps/backend/jobs/** that calls
 *    `prisma.<model>.findMany|findFirst|create|update|delete` MUST import
 *    one of `runWithTenantContext` or `withoutTenantScope`. Cron jobs run
 *    without an HTTP request, so they MUST establish or explicitly waive
 *    a tenant scope.
 *
 * Allowlists below carry exemptions with a written reason.
 */

const fs = require('fs');
const path = require('path');

const PLATFORM_ADMIN_DIR = path.normalize('apps/backend/routes/api/platform-admin');
const JOBS_DIR = path.normalize('apps/backend/jobs');

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

const PRISMA_USAGE_PATTERN = /\bprisma\.[a-zA-Z]/;
const PRISMA_WRITE_OR_READ_PATTERN = /\bprisma\.[a-zA-Z]+\.(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
const WITHOUT_SCOPE_IMPORT_PATTERN = /\bwithoutTenantScope\b/;
const RUN_WITH_CONTEXT_IMPORT_PATTERN = /\brunWithTenantContext\b/;

// Files exempt from rule 2 (jobs that legitimately do not touch tenant
// state — none today; left as a hook for future additions).
const JOBS_ALLOWLIST = new Set([]);

function collectFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  function visit(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  visit(rootDir);
  return files;
}

function checkPlatformAdmin(repoRoot) {
  const violations = [];
  const dir = path.join(repoRoot, PLATFORM_ADMIN_DIR);
  for (const absPath of collectFiles(dir)) {
    const rel = path.normalize(path.relative(repoRoot, absPath));
    const src = fs.readFileSync(absPath, 'utf8');
    if (!PRISMA_USAGE_PATTERN.test(src)) continue;
    if (!WITHOUT_SCOPE_IMPORT_PATTERN.test(src)) {
      violations.push({
        file: rel,
        rule: 'platform-admin handler uses prisma but does not import or call withoutTenantScope',
      });
    }
  }
  return violations;
}

function checkJobs(repoRoot) {
  const violations = [];
  const dir = path.join(repoRoot, JOBS_DIR);
  for (const absPath of collectFiles(dir)) {
    const rel = path.normalize(path.relative(repoRoot, absPath));
    if (JOBS_ALLOWLIST.has(rel)) continue;
    const src = fs.readFileSync(absPath, 'utf8');
    if (!PRISMA_WRITE_OR_READ_PATTERN.test(src)) continue;
    if (!RUN_WITH_CONTEXT_IMPORT_PATTERN.test(src) && !WITHOUT_SCOPE_IMPORT_PATTERN.test(src)) {
      violations.push({
        file: rel,
        rule: 'cron job touches tenant-scoped Prisma calls without runWithTenantContext or withoutTenantScope',
      });
    }
  }
  return violations;
}

function main() {
  const repoRoot = process.cwd();
  const platformAdminViolations = checkPlatformAdmin(repoRoot);
  const jobsViolations = checkJobs(repoRoot);

  const total = platformAdminViolations.length + jobsViolations.length;
  if (total === 0) {
    console.log('[tenant-conventions] PASS');
    return;
  }

  if (platformAdminViolations.length > 0) {
    console.error('\n[tenant-conventions] platform-admin handlers must use withoutTenantScope:');
    for (const v of platformAdminViolations) {
      console.error(`- ${v.file} — ${v.rule}`);
    }
  }
  if (jobsViolations.length > 0) {
    console.error('\n[tenant-conventions] cron jobs must establish or waive a tenant scope:');
    for (const v of jobsViolations) {
      console.error(`- ${v.file} — ${v.rule}`);
    }
  }

  console.error('\nFix: import { runWithTenantContext, withoutTenantScope } from "services/tenant-context"');
  console.error('and wrap your Prisma calls accordingly. See ADR-014 / docs/adr/ADR-014-phase-3-handoff.md.');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { checkPlatformAdmin, checkJobs };
