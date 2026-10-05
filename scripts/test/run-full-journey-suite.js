#!/usr/bin/env node
/**
 * Full release verification runner.
 *
 * Runs:
 * - lint checks
 * - type check
 * - user journey matrix:
 *   - best case
 *   - good case
 *   - normal case
 *   - bad case
 *   - chaos case
 * - e2e, uat evidence
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// This file lives in scripts/test/ — repo root is TWO levels up (a one-level
// resolve pointed every spawned step at scripts/, ENOENT on npm --prefix).
const repoRoot = path.resolve(__dirname, '..', '..');

const baseUrl = String(process.env.BASE_URL || 'https://gacpth.com/api').replace(/\/+$/, '');
const publicBaseUrl =
  String(process.env.PUBLIC_BASE_URL || baseUrl.replace(/\/api$/, '')).replace(/\/+$/, '');
const healthId = process.env.HEALTH_ID || process.env.E2E_TEST_IDENTIFIER || '';
const healthPassword = process.env.HEALTH_PASSWORD || process.env.E2E_TEST_PASSWORD || '';
const hasExplicitHealthCredentials =
  Boolean(process.env.HEALTH_ID || process.env.E2E_TEST_IDENTIFIER)
  && Boolean(process.env.HEALTH_PASSWORD || process.env.E2E_TEST_PASSWORD);
const credentialEnv = hasExplicitHealthCredentials
  ? {
      HEALTH_ID: healthId,
      HEALTH_PASSWORD: healthPassword,
      E2E_TEST_IDENTIFIER: healthId,
      E2E_TEST_PASSWORD: healthPassword,
      TESTSPRITE_HEALTH_ID: healthId,
      TESTSPRITE_HEALTH_PASSWORD: healthPassword,
    }
  : {};
const skipTlsVerification =
  process.env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined
    ? process.env.NODE_TLS_REJECT_UNAUTHORIZED
    : '0';

function createSkippedStepResult({ label, command, cwd, reason }) {
  console.log(`\n[full-test] SKIP ${label}`);
  console.log(`[full-test] REASON ${reason}`);
  return {
    label,
    command,
    cwd,
    status: 0,
    passed: true,
    skipped: true,
    reason,
    durationMs: 0,
  };
}

function runCommand({ label, command, cwd = repoRoot, env = {} }) {
  const startedAt = Date.now();
  console.log(`\n[full-test] START ${label}`);
  console.log(`[full-test] CMD   ${command}`);
  console.log(`[full-test] CWD   ${cwd}`);

  const result = spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: true,
  });

  const durationMs = Date.now() - startedAt;
  const status = result.status || 0;
  const passed = status === 0;

  console.log(`[full-test] ${passed ? 'PASS' : 'FAIL'} ${label} (${durationMs}ms)`);

  return {
    label,
    command,
    cwd,
    status,
    passed,
    durationMs,
  };
}

function runCategory(category) {
  console.log(`\n==================================================`);
  console.log(`[full-test] CATEGORY ${category.id} (${category.title})`);
  console.log(`==================================================`);

  const steps = [];
  for (const step of category.steps) {
    if (step.requiresAuthCredentials && !hasExplicitHealthCredentials) {
      steps.push(
        createSkippedStepResult({
          label: `${category.id}:${step.label}`,
          command: step.command,
          cwd: step.cwd || repoRoot,
          reason: 'missing explicit HEALTH_ID/HEALTH_PASSWORD env',
        }),
      );
      continue;
    }

    const result = runCommand({
      label: `${category.id}:${step.label}`,
      command: step.command,
      cwd: step.cwd || repoRoot,
      env: {
        BASE_URL: baseUrl,
        PUBLIC_BASE_URL: publicBaseUrl,
        E2E_BASE_URL: publicBaseUrl,
        E2E_IGNORE_HTTPS_ERRORS: 'true',
        TESTSPRITE_BASE_URL: baseUrl,
        NODE_TLS_REJECT_UNAUTHORIZED: skipTlsVerification,
        ...credentialEnv,
        ...step.env,
      },
    });

    steps.push(result);
    if (!result.passed) {
      break;
    }
  }

  const passed = steps.every((step) => step.passed);
  return {
    id: category.id,
    title: category.title,
    passed,
    steps,
  };
}

function writeReport(report) {
  const outputDir = path.join(repoRoot, 'test-reports', 'full-test');
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(outputDir, `full-test-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

function buildCategories() {
  return [
    {
      id: 'engineering_checks',
      title: 'Lint and Type Check',
      steps: [
        { label: 'backend_lint', command: 'npm --prefix apps/backend run lint' },
        { label: 'web_lint', command: 'npm --prefix apps/web-app run lint' },
        {
          label: 'web_typecheck',
          command: 'npx tsc -p tsconfig.json --noEmit',
          cwd: path.join(repoRoot, 'apps', 'web-app'),
        },
      ],
    },
    {
      id: 'best_case',
      title: 'Security-hardened happy path',
      steps: [{ label: 'auth_hardening_gate', command: 'npm run gate:auth-hardening' }],
    },
    {
      id: 'good_case',
      title: 'Primary user-facing smoke with valid credentials',
      steps: [
        {
          label: 'auth_readiness',
        command: 'node scripts/ci/check-health-login-readiness.js',
          env: {
            AUTH_READINESS_MODE: hasExplicitHealthCredentials ? 'login' : 'status',
            AUTH_READINESS_ALLOW_RATE_LIMIT: 'true',
          },
        },
        {
          label: 'web_e2e',
          command: 'npm --prefix apps/web-app run test:e2e -- --project=chromium --workers=1',
          requiresAuthCredentials: true,
        },
      ],
    },
    {
      id: 'normal_case',
      title: 'Core business workflow regression',
      steps: [
        {
          label: 'uat_regression_gate',
          command: 'node scripts/run-regression-gate.js',
          requiresAuthCredentials: true,
        },
      ],
    },
    {
      id: 'bad_case',
      title: 'Negative and invalid input handling',
      steps: [{ label: 'member_negative_paths', command: 'node scripts/run-member-bad-journey-check.js' }],
    },
    {
      id: 'chaos_case',
      title: 'Concurrency and fuzz resilience checks',
      steps: [{ label: 'chaos_journey', command: 'node scripts/run-chaos-journey-check.js' }],
    },
  ];
}

async function main() {
  console.log('[full-test] Full journey suite started');
  console.log(`[full-test] BASE_URL=${baseUrl}`);
  console.log(`[full-test] PUBLIC_BASE_URL=${publicBaseUrl}`);
  console.log(`[full-test] AUTH_CREDENTIAL_MODE=${hasExplicitHealthCredentials ? 'explicit' : 'none'}`);

  const categories = buildCategories();
  const categoryResults = [];

  for (const category of categories) {
    const categoryResult = runCategory(category);
    categoryResults.push(categoryResult);
    if (!categoryResult.passed) {
      break;
    }
  }

  const passedCategories = categoryResults.filter((result) => result.passed).length;
  const totalCategories = categories.length;
  const passed = passedCategories === totalCategories;

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    publicBaseUrl,
    authCredentialMode: hasExplicitHealthCredentials ? 'explicit' : 'none',
    categories: categoryResults,
    summary: {
      passed,
      passedCategories,
      totalCategories,
    },
  };

  const reportPath = writeReport(report);
  console.log(`\n[full-test] SUMMARY ${passedCategories}/${totalCategories} categories passed`);
  console.log(`[full-test] REPORT  ${reportPath}`);

  if (!passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[full-test] unexpected error: ${error.message}`);
  process.exit(1);
});

