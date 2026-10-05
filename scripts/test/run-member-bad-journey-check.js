#!/usr/bin/env node
/**
 * Member auth negative-path journey checks ("bad case").
 *
 * Verifies that invalid/abusive requests are rejected safely with stable
 * status codes and no server crash (no 5xx).
 */

const { performance } = require('perf_hooks');

const baseUrl = String(process.env.BASE_URL || 'http://localhost/api').replace(/\/+$/, '');
const timeoutMs = Number(process.env.BAD_JOURNEY_TIMEOUT_MS || 20_000);
const allowRateLimitedAsPass =
  String(process.env.BAD_JOURNEY_ALLOW_RATE_LIMIT || 'true').trim().toLowerCase() !== 'false';

function isRateLimited(response) {
  return response.status === 429 && String(response.json?.code || '').toUpperCase() === 'RATE_LIMITED';
}

async function requestJson({
  method = 'GET',
  endpoint,
  headers = {},
  body,
  rawBody,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }

    return { status: response.status, text, json };
  } finally {
    clearTimeout(timeout);
  }
}

function fail(message) {
  throw new Error(message);
}

async function runCase(testCase) {
  const startedAt = performance.now();
  try {
    const response = await requestJson(testCase.request);
    testCase.assert(response);
    const durationMs = Math.round(performance.now() - startedAt);
    console.log(`[bad-case] PASS ${testCase.id} (${durationMs}ms)`);
    return { id: testCase.id, passed: true, durationMs };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    console.error(`[bad-case] FAIL ${testCase.id} (${durationMs}ms): ${error.message}`);
    return { id: testCase.id, passed: false, durationMs, error: error.message };
  }
}

async function main() {
  console.log(`[bad-case] BASE_URL=${baseUrl}`);

  const cases = [
    {
      id: 'BAD-LOGIN-001',
      request: {
        method: 'POST',
        endpoint: '/auth/health/login',
        headers: { 'Content-Type': 'application/json' },
        body: {},
      },
      assert: (response) => {
        if (allowRateLimitedAsPass && isRateLimited(response)) {
          return;
        }
        if (response.status !== 400) {
          fail(`Expected 400 for missing credentials, got ${response.status}`);
        }
        if (response.json?.code !== 'MISSING_CREDENTIALS') {
          fail(`Expected code=MISSING_CREDENTIALS, got ${String(response.json?.code)}`);
        }
      },
    },
    {
      id: 'BAD-LOGIN-002',
      request: {
        method: 'POST',
        endpoint: '/auth/health/login',
        headers: { 'Content-Type': 'application/json' },
        body: { healthId: '1100100100011', password: 'Wrong@12345' },
      },
      assert: (response) => {
        if (allowRateLimitedAsPass && isRateLimited(response)) {
          return;
        }
        if (response.status !== 401) {
          fail(`Expected 401 for invalid credentials, got ${response.status}`);
        }
        if (response.json?.code !== 'INVALID_CREDENTIALS') {
          fail(`Expected code=INVALID_CREDENTIALS, got ${String(response.json?.code)}`);
        }
      },
    },
    {
      id: 'BAD-LOGIN-003',
      request: {
        method: 'POST',
        endpoint: '/auth/health/login',
        headers: { 'Content-Type': 'application/json' },
        rawBody: '{',
      },
      assert: (response) => {
        if (response.status !== 400) {
          fail(`Expected 400 for malformed JSON, got ${response.status}`);
        }
        if (response.json?.code !== 'REQUEST_FAILED') {
          fail(`Expected code=REQUEST_FAILED, got ${String(response.json?.code)}`);
        }
      },
    },
    {
      id: 'BAD-RBAC-001',
      request: {
        method: 'GET',
        endpoint: '/provider/dashboard',
      },
      assert: (response) => {
        if (![401, 403].includes(response.status)) {
          fail(`Expected unauthorized status 401/403, got ${response.status}`);
        }
      },
    },
  ];

  const results = [];
  for (const testCase of cases) {
    results.push(await runCase(testCase));
  }

  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    console.error(`[bad-case] FAIL: ${failed.length}/${results.length} checks failed`);
    process.exit(1);
  }

  console.log(`[bad-case] PASS: ${results.length}/${results.length} checks passed`);
}

main().catch((error) => {
  console.error(`[bad-case] unexpected error: ${error.message}`);
  process.exit(1);
});

