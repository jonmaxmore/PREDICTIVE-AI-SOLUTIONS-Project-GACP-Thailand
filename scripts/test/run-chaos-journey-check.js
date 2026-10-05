#!/usr/bin/env node
/**
 * Lightweight production-safe chaos checks ("chaos case").
 *
 * Goals:
 * - Send concurrent invalid and edge requests.
 * - Ensure the system does not return unexpected 5xx responses.
 * - Confirm core health endpoint stays responsive under pressure.
 */

const { performance } = require('perf_hooks');

const baseUrl = String(process.env.BASE_URL || 'http://localhost/api').replace(/\/+$/, '');
const timeoutMs = Number(process.env.CHAOS_TIMEOUT_MS || 15_000);
const burstSize = Math.max(5, Number(process.env.CHAOS_BURST_SIZE || 20));

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    return { status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_error) {
    return null;
  }
}

function assertNoServerErrors(results, label) {
  const with5xx = results.filter((result) => result.status >= 500);
  if (with5xx.length > 0) {
    throw new Error(`${label}: detected ${with5xx.length} responses with 5xx status`);
  }
}

async function runHealthBurst() {
  const startedAt = performance.now();
  const requests = Array.from({ length: burstSize }, () => fetchText(`${baseUrl}/health`));
  const results = await Promise.all(requests);
  const durationMs = Math.round(performance.now() - startedAt);

  assertNoServerErrors(results, 'health-burst');

  const okCount = results.filter((result) => result.status === 200).length;
  if (okCount < Math.ceil(burstSize * 0.8)) {
    throw new Error(`health-burst: expected >=80% 200, got ${okCount}/${burstSize}`);
  }

  return { id: 'CHAOS-HEALTH-BURST', durationMs, sampleStatus: results[0]?.status || null };
}

async function runInvalidLoginBurst() {
  const loginBurstSize = Math.min(burstSize, 4);
  const startedAt = performance.now();
  const requests = Array.from({ length: loginBurstSize }, (_, index) =>
    fetchText(`${baseUrl}/auth/health/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        healthId: `99999999999${String(index % 10)}`,
        password: 'not-a-valid-password',
      }),
    }),
  );
  const results = await Promise.all(requests);
  const durationMs = Math.round(performance.now() - startedAt);

  assertNoServerErrors(results, 'invalid-login-burst');

  const expectedStatusCount = results.filter((result) => [400, 401, 429].includes(result.status)).length;
  if (expectedStatusCount < Math.ceil(loginBurstSize * 0.9)) {
    throw new Error(
      `invalid-login-burst: expected mostly 400/401/429, got ${expectedStatusCount}/${loginBurstSize}`,
    );
  }

  return { id: 'CHAOS-INVALID-LOGIN-BURST', durationMs, sampleStatus: results[0]?.status || null };
}

async function runRouteFuzzBurst() {
  const startedAt = performance.now();
  const paths = [
    '/../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/auth/health/login%00',
    '/auth/health/does-not-exist',
    '/provider/../../../admin',
  ];

  const requests = Array.from({ length: burstSize }, (_, index) => {
    const path = paths[index % paths.length];
    return fetchText(`${baseUrl}${path}`, { method: 'GET' });
  });

  const results = await Promise.all(requests);
  const durationMs = Math.round(performance.now() - startedAt);

  assertNoServerErrors(results, 'route-fuzz-burst');

  const acceptedStatuses = new Set([400, 401, 403, 404, 405]);
  const unexpected = results.filter((result) => !acceptedStatuses.has(result.status));
  if (unexpected.length > Math.ceil(burstSize * 0.2)) {
    throw new Error(`route-fuzz-burst: too many unexpected statuses (${unexpected.length}/${burstSize})`);
  }

  return { id: 'CHAOS-ROUTE-FUZZ-BURST', durationMs, sampleStatus: results[0]?.status || null };
}

async function runOversizedPayloadCheck() {
  const largePayload = {
    healthId: '1100100100011',
    password: 'x'.repeat(50_000),
  };

  const startedAt = performance.now();
  const response = await fetchText(`${baseUrl}/auth/health/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(largePayload),
  });
  const durationMs = Math.round(performance.now() - startedAt);

  if (response.status >= 500) {
    throw new Error(`oversized-payload: got ${response.status}`);
  }

  const body = parseJson(response.text);
  if (body && body.success === true) {
    throw new Error('oversized-payload: request unexpectedly succeeded');
  }

  return { id: 'CHAOS-OVERSIZED-PAYLOAD', durationMs, sampleStatus: response.status };
}

async function main() {
  console.log(`[chaos-case] BASE_URL=${baseUrl}`);
  console.log(`[chaos-case] burstSize=${burstSize}`);

  const checks = [
    runHealthBurst,
    runInvalidLoginBurst,
    runRouteFuzzBurst,
    runOversizedPayloadCheck,
  ];

  const results = [];
  for (const check of checks) {
    const id = check.name;
    try {
      const result = await check();
      results.push({ ...result, passed: true });
      console.log(`[chaos-case] PASS ${result.id} (${result.durationMs}ms)`);
    } catch (error) {
      results.push({ id, passed: false, error: error.message });
      console.error(`[chaos-case] FAIL ${id}: ${error.message}`);
    }
  }

  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    console.error(`[chaos-case] FAIL: ${failed.length}/${results.length} checks failed`);
    process.exit(1);
  }

  console.log(`[chaos-case] PASS: ${results.length}/${results.length} checks passed`);
}

main().catch((error) => {
  console.error(`[chaos-case] unexpected error: ${error.message}`);
  process.exit(1);
});

