#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { X509Certificate } = require('crypto');

const rootDir = path.resolve(__dirname, '..', '..');
const ciMode = process.argv.includes('--ci-mode') || process.env.PRODUCTION_READINESS_CI_MODE === 'true';
const strictMode = !ciMode && (process.argv.includes('--strict') || process.env.PRODUCTION_READINESS_STRICT === 'true');

if (ciMode && (process.argv.includes('--strict') || process.env.PRODUCTION_READINESS_STRICT === 'true')) {
  console.log('[info] --ci-mode is mutually exclusive with --strict; ci-mode takes precedence');
}

const color = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

let testsPassed = 0;
let testsFailed = 0;
let warnings = 0;
let ciSkipped = 0;

function section(title) {
  console.log(`\n${color.blue}========================================${color.reset}`);
  console.log(`${color.blue}${title}${color.reset}`);
  console.log(`${color.blue}========================================${color.reset}`);
}

function pass(message) {
  testsPassed += 1;
  console.log(`${color.green}[PASS]${color.reset} ${message}`);
}

function fail(message) {
  testsFailed += 1;
  console.log(`${color.red}[FAIL]${color.reset} ${message}`);
}

function warn(message) {
  warnings += 1;
  console.log(`${color.yellow}[WARN]${color.reset} ${message}`);
}

function skipCi(message) {
  ciSkipped += 1;
  console.log(`${color.yellow}[SKIP-CI]${color.reset} ${message} (skipped in CI)`);
}

function fileExists(relPath) {
  return fs.existsSync(path.join(rootDir, relPath));
}

function readText(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

function run(command, args = [], options = {}) {
  const { shell = false, ...restOptions } = options;
  return spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'pipe',
    encoding: 'utf8',
    shell,
    ...restOptions,
  });
}

function commandExists(command) {
  const probe = process.platform === 'win32'
    ? run('where', [command])
    : run('command', ['-v', command], { shell: true });
  return probe.status === 0;
}

function runAndReport({
  title,
  command,
  args,
  successMessage,
  failMessage,
  warnIfMissingCommand,
  shell = false,
}) {
  if (warnIfMissingCommand && !commandExists(warnIfMissingCommand)) {
    warn(`${title} skipped: command '${warnIfMissingCommand}' is not available`);
    return null;
  }

  const result = run(command, args, { shell });
  if (result.status === 0) {
    pass(successMessage || title);
  } else {
    fail(failMessage || `${title} failed`);
    const log = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (log) {
      const lines = log.split(/\r?\n/).slice(-20);
      lines.forEach((line) => console.log(`  ${line}`));
    }
  }
  return result;
}

section('1. Code Quality Checks');
if (ciMode) {
  // The backend test suite imports services/prisma-database.js which calls
  // process.exit(1) at module load when DATABASE_URL is unset, so jest fails
  // unconditionally without a database. The real backend test gate is full-gate
  // on the staging box: required checks `suite-green` and `integration-pg`
  // (scripts/ci/full-gate-checks.txt) run against a per-run Postgres. Updated
  // 2026-08-14: this used to credit the ci.yml `test` job, which can never run.
  skipCi('Backend tests (covered by full-gate required checks suite-green + integration-pg — scripts/ci/full-gate-checks.txt)');
} else {
  runAndReport({
    title: 'Backend tests',
    command: commandExists('pnpm')
      ? 'pnpm --dir apps/backend exec jest --config jest.config.cjs --passWithNoTests --ci'
      : 'npm --prefix apps/backend test -- --passWithNoTests --ci',
    args: [],
    successMessage: 'All backend tests passing',
    failMessage: 'Backend tests failing',
    shell: true,
  });
}

runAndReport({
  title: 'Orphan API route check',
  command: 'node',
  args: ['scripts/ci/check-orphan-api-routes.js'],
  successMessage: 'No orphan API route files',
});

runAndReport({
  title: 'Provider API surface check',
  command: 'node',
  args: ['scripts/ci/check-frontend-provider-api-usage.js'],
  successMessage: 'Frontend provider API surface is canonical',
  failMessage: 'Legacy provider API usage found in frontend',
});

section('2. Security Checks');
if (fileExists('apps/backend/.env.production')) {
  pass('Production environment file exists');
  const envText = readText('apps/backend/.env.production');
  const weakPattern = /(password.*123|password.*admin|secret.*123)/i;
  if (weakPattern.test(envText)) {
    fail('Weak passwords detected in .env.production');
  } else {
    pass('No weak passwords detected');
  }
} else if (fileExists('apps/backend/.env.production.template') || fileExists('apps/backend/.env.production.example')) {
  const message = 'Production env file not found; template/example exists for provisioning';
  if (ciMode) {
    skipCi(`${message} — .env.production is gitignored and lives only on the production host`);
  } else if (strictMode) {
    fail(`${message} (strict mode)`);
  } else {
    warn(message);
  }
} else if (ciMode) {
  skipCi('Production environment file missing — .env.production is gitignored and lives only on the production host');
} else {
  fail('Production environment file missing');
}

const prodCertExists = fileExists('nginx/ssl/gacp.crt') && fileExists('nginx/ssl/gacp.key');
const localCertExists = fileExists('nginx/ssl/local/localhost.crt') && fileExists('nginx/ssl/local/localhost.key');

if (prodCertExists || (!strictMode && localCertExists)) {
  pass('SSL certificates present');
  const certPath = prodCertExists ? 'nginx/ssl/gacp.crt' : 'nginx/ssl/local/localhost.crt';

  if (commandExists('openssl')) {
    const certCheck = run('openssl', ['x509', '-in', path.join(rootDir, certPath), '-noout', '-checkend', '86400']);
    if (certCheck.status === 0) {
      pass('SSL certificate valid (expires in > 24 hours)');
    } else {
      fail('SSL certificate expiring soon or invalid');
    }
  } else {
    try {
      const certPem = readText(certPath);
      const cert = new X509Certificate(certPem);
      const validTo = new Date(cert.validTo);
      const nowPlus24h = new Date(Date.now() + (24 * 60 * 60 * 1000));

      if (Number.isNaN(validTo.getTime())) {
        fail('SSL certificate validity period unreadable');
      } else if (validTo > nowPlus24h) {
        pass('SSL certificate valid (expires in > 24 hours) [node fallback]');
      } else {
        fail('SSL certificate expiring soon or invalid');
      }
    } catch (_error) {
      fail('SSL certificate expiry validation failed (openssl unavailable and node fallback parse failed)');
    }
  }
} else {
  const message = 'SSL certificates missing';
  if (ciMode) {
    skipCi(`${message} — TLS material is provisioned per environment (Let's Encrypt on prod, mkcert locally)`);
  } else if (strictMode) {
    fail(`${message} (strict mode)`);
  } else {
    warn(`${message}; local readiness can proceed without TLS artifacts`);
  }
}

if (fileExists('docker/nginx/modsecurity.conf')) {
  pass('ModSecurity WAF configuration present');
} else {
  warn('ModSecurity configuration not found');
}

if (fileExists('docker/nginx/default.conf')) {
  const nginxConfig = readText('docker/nginx/default.conf');
  const hasSecurityHeaders = ['X-Frame-Options', 'X-Content-Type-Options', 'X-XSS-Protection']
    .every((header) => nginxConfig.includes(header));
  if (hasSecurityHeaders) {
    pass('Security headers configured in Nginx');
  } else {
    fail('Security headers missing from Nginx config');
  }
} else {
  fail('Nginx config missing: docker/nginx/default.conf');
}

section('3. Infrastructure Checks');
if (ciMode) {
  // docker-compose.production.yml references env vars (DATABASE_URL,
  // JWT_SECRET, ...) that are only populated on the production host, so
  // `docker compose config` spuriously fails off-host.
  // Corrected 2026-08-14: the old comment claimed "the compose file is YAML-linted
  // by the system-integrity job already". It is not — grep for `compose` in
  // scripts/system-integrity-check.js returns one code comment and no check, and
  // no probe or full-gate row runs `docker compose config`. Nothing validates it
  // outside a host run; the skip says so instead of implying cover.
  skipCi('Docker Compose configuration validation (env vars only present on the host; NOT validated anywhere else — run this script without --ci-mode on the box)');
} else if (commandExists('docker')) {
  const dockerCompose = run('docker', ['compose', 'config']);
  if (dockerCompose.status === 0) {
    pass('Docker Compose configuration valid');
  } else {
    fail('Docker Compose configuration invalid');
  }
} else {
  warn('Docker is not available; skipped docker compose validation');
}

// Note 2026-04-29 (operator decision ช): the canonical production
// monitoring stack is defined in docker-compose.production.yml, NOT in
// monitoring/docker-compose.monitoring.yml. The latter is an aspirational
// reference template (see monitoring/README.md). This check now tracks
// what's actually deployed.

if (fileExists('docker-compose.production.yml')) {
  pass('Production compose file present');
} else {
  fail('docker-compose.production.yml missing — required for prod deployment');
}

if (fileExists('monitoring/prometheus/prometheus.yml')) {
  pass('Prometheus configuration present');
} else {
  fail('Prometheus configuration missing');
}

if (fileExists('monitoring/alertmanager/alertmanager.yml')) {
  // AlertManager config exists but is not currently deployed on prod
  // (see monitoring/README.md). Reference template is intentionally
  // kept; not a deploy blocker.
  warn('AlertManager configuration is aspirational — not currently deployed (see monitoring/README.md)');
} else {
  warn('AlertManager configuration missing — alerting will need a fresh design');
}

// Retargeted 2026-08-14 (rules audit wave 1B): this used to award a PASS for the
// existence of .github/workflows/production.yml. GitHub Actions is permanently
// unavailable, so that file is a document, not a pipeline — the readiness score
// was crediting an artifact that cannot execute. The deploy/gate path that does
// execute is the on-box runbook pair.
const pipelineRunbooks = [
  'docs/operations/runbooks/build-images-on-the-box.md',
  'docs/operations/runbooks/full-gate-on-staging.md',
];
const missingRunbooks = pipelineRunbooks.filter((p) => !fileExists(p));
if (missingRunbooks.length === 0) {
  pass(`Build/gate pipeline documented as executable runbooks (${pipelineRunbooks.length})`);
} else {
  fail(`Pipeline runbook(s) missing: ${missingRunbooks.join(', ')} — there is no other executable deploy/gate path`);
}

section('4. Database Checks');
// PR #192 deleted the orphan `add_performance_indexes.sql` consolidator file
// (its contents are now distributed across normal Prisma migrations + @@index
// declarations in the schema). The check here used to look for that exact
// filename; we now count @@index declarations across all schema files, which
// is what we actually care about: do indexes exist?
const schemaDir = path.join(rootDir, 'apps', 'backend', 'prisma', 'schema');
let indexCount = 0;
if (fs.existsSync(schemaDir)) {
  for (const entry of fs.readdirSync(schemaDir)) {
    if (!entry.endsWith('.prisma')) continue;
    const content = fs.readFileSync(path.join(schemaDir, entry), 'utf8');
    indexCount += (content.match(/^\s*@@index\b/gm) || []).length;
  }
}
if (indexCount > 0) {
  pass('Database optimization indexes present');
  console.log(`   ${indexCount} @@index declarations across schema`);
} else {
  fail('Database optimization indexes missing');
}

if (fs.existsSync(schemaDir)) {
  pass('Prisma schema present');
  const modelCount = fs
    .readdirSync(schemaDir)
    .filter((entry) => entry.endsWith('.prisma'))
    .map((entry) => fs.readFileSync(path.join(schemaDir, entry), 'utf8'))
    .reduce((count, content) => count + (content.match(/^model\s+/gm) || []).length, 0);
  console.log(`   ${modelCount} models defined`);
} else {
  fail('Prisma schema missing');
}

section('5. Documentation Checks');
[
  'docs/architecture/system-map.md',
  'docs/api/active-api-surface.md',
  'docs/architecture/deprecation-register.md',
  'docs/api/api-path-identity-policy.md',
  'docs/api/engineering-route-naming.md',
].forEach((docPath) => {
  if (fileExists(docPath)) {
    pass(`Documentation present: ${docPath}`);
  } else {
    warn(`Missing documentation: ${docPath}`);
  }
});

section('6. Monitoring & Observability');
if (fileExists('apps/backend/routes/api/index.js')) {
  const apiIndex = readText('apps/backend/routes/api/index.js');
  if (apiIndex.includes("router.get('/health'")) {
    pass('Health check API implemented (/api/health)');
  } else {
    fail('Health check API missing (/api/health)');
  }

  if (apiIndex.includes("router.get('/metrics'")) {
    pass('Metrics endpoint implemented (/api/metrics)');
  } else {
    warn('Metrics endpoint not exposed at /api/metrics');
  }
} else {
  fail('API index route missing');
}

if (fileExists('monitoring/grafana/dashboards/gacp-overview.json')) {
  pass('Grafana dashboard configuration present');
} else {
  warn('Grafana dashboard configuration missing');
}

section('7. Backup & Recovery');
const backupScript = 'scripts/backup/backup-system.sh';
if (fileExists(backupScript)) {
  pass('Backup script present');
} else {
  fail('Backup script missing');
}

section('8. Frontend Checks');
if (fileExists('apps/web-app/src/app/provider/analytics/page.tsx')) {
  pass('Provider analytics dashboard implemented');
} else {
  fail('Provider analytics dashboard missing');
}

section('VALIDATION SUMMARY');
console.log(`${color.green}Tests Passed: ${testsPassed}${color.reset}`);
console.log(`${color.red}Tests Failed: ${testsFailed}${color.reset}`);
console.log(`${color.yellow}Warnings: ${warnings}${color.reset}`);
if (ciMode) {
  console.log(`${color.yellow}CI-skipped (production-host-only): ${ciSkipped}${color.reset}`);
}

// In CI mode, skipped checks are excluded from the denominator — the
// score reflects only the code-quality / structural checks that this
// sandbox can actually evaluate.
const total = testsPassed + testsFailed;
const readinessScore = total > 0 ? Math.floor((testsPassed * 100) / total) : 0;
const scoreLabel = ciMode ? 'Readiness Score (CI subset)' : 'Readiness Score';
console.log(`\n${color.blue}${scoreLabel}: ${readinessScore}%${color.reset}`);

if (ciMode) {
  if (testsFailed === 0) {
    console.log(`\n${color.green}CI READINESS GATE PASSED${color.reset}`);
    console.log(`${color.yellow}(${ciSkipped} production-host-only checks skipped — validate on the production host before release)${color.reset}`);
    process.exit(0);
  }
  console.log(`\n${color.red}CI READINESS GATE FAILED${color.reset}`);
  process.exit(1);
}

if (testsFailed === 0 && readinessScore >= 95) {
  console.log(`\n${color.green}PRODUCTION READY${color.reset}`);
  process.exit(0);
}

if (readinessScore >= 80) {
  console.log(`\n${color.yellow}NEARLY READY${color.reset}`);
  process.exit(1);
}

console.log(`\n${color.red}NOT READY${color.reset}`);
process.exit(1);
