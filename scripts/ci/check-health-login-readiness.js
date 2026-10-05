#!/usr/bin/env node
/**
 * Readiness check for health login before running web E2E.
 *
 * Readiness modes:
 * - auto (default): use login mode when explicit credentials are present, otherwise status mode
 * - login: perform POST /auth/health/login checks
 * - status: perform GET /health checks (non-destructive)
 *
 * This avoids self-inflicted lockouts/rate-limit loops during CI/UAT runs
 * that do not provide explicit test credentials.
 */

const baseUrl = String(process.env.BASE_URL || 'http://localhost/api').replace(/\/+$/, '');
const healthId = process.env.HEALTH_ID || process.env.E2E_TEST_IDENTIFIER || '';
const healthPassword = process.env.HEALTH_PASSWORD || process.env.E2E_TEST_PASSWORD || '';
const requestedMode = String(process.env.AUTH_READINESS_MODE || 'auto').trim().toLowerCase();
const hasExplicitCredentials = Boolean(String(healthId).trim()) && Boolean(String(healthPassword).trim());
const readinessMode = requestedMode === 'auto'
  ? (hasExplicitCredentials ? 'login' : 'status')
  : requestedMode;
const maxAttempts = Math.max(1, Number(process.env.AUTH_READINESS_RETRIES || 8));
const sleepMs = Math.max(1000, Number(process.env.AUTH_READINESS_SLEEP_MS || 5000));
const timeoutMs = Math.max(3000, Number(process.env.AUTH_READINESS_TIMEOUT_MS || 15000));
const allowAuthRejectionAsReady =
  String(process.env.AUTH_READINESS_ALLOW_AUTH_REJECTION || 'true').trim().toLowerCase() !== 'false';
const allowRateLimitedAsReady =
  String(process.env.AUTH_READINESS_ALLOW_RATE_LIMIT || 'true').trim().toLowerCase() !== 'false';

const AUTH_REJECTION_READY_CODES = new Set([
  'INVALID_CREDENTIALS',
  'AUTH_INVALID_CREDENTIALS',
  'CSRF_MISMATCH',
  'ACCOUNT_LOCKED',
  'AUTH_ACCOUNT_LOCKED',
]);

async function attemptStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptLogin() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/auth/health/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The health login schema keys on `identifier` (13-digit national ID),
        // NOT `healthId` — sending healthId 400'd VALIDATION_ERROR on staging
        // so the probe never reached a real 200/401 (journey run 2026-07-08).
        identifier: healthId,
        password: healthPassword,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`[auth-readiness] BASE_URL=${baseUrl}`);
  console.log(`[auth-readiness] mode=${readinessMode}`);
  console.log(`[auth-readiness] retries=${maxAttempts}, intervalMs=${sleepMs}`);

  if (!['login', 'status'].includes(readinessMode)) {
    console.error(`[auth-readiness] FAIL: invalid AUTH_READINESS_MODE=${requestedMode}`);
    process.exit(1);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (readinessMode === 'status') {
        const statusResult = await attemptStatus();
        const statusPass = statusResult.status === 200
          && statusResult.json
          && statusResult.json.success === true;
        if (statusPass) {
          console.log(`[auth-readiness] PASS on attempt ${attempt}/${maxAttempts} (status endpoint reachable)`);
          return;
        }

        const code = statusResult.json?.code || 'UNKNOWN';
        console.log(
          `[auth-readiness] waiting (${attempt}/${maxAttempts}) status=${statusResult.status} code=${code}`,
        );
      } else {
      const result = await attemptLogin();
      const success = result.status === 200 && result.json?.success === true;
      const responseCode = String(result.json?.code || 'UNKNOWN').toUpperCase();
      // A 429 proves the endpoint is up and answering — the live login
      // limiter does NOT stamp a machine code in its body (observed
      // code=UNKNOWN on staging, journey run 2026-07-08), so gating on
      // responseCode === 'RATE_LIMITED' turned rate-limited-but-healthy
      // into a false FAIL.
      const rateLimitedReady = allowRateLimitedAsReady
        && result.status === 429;
      const authRejectionReady =
        allowAuthRejectionAsReady
        && [400, 401, 403].includes(result.status)
        && AUTH_REJECTION_READY_CODES.has(responseCode);

      if (success) {
        console.log(`[auth-readiness] PASS on attempt ${attempt}/${maxAttempts}`);
        return;
      }
      if (authRejectionReady) {
        console.log(
          `[auth-readiness] PASS on attempt ${attempt}/${maxAttempts} (auth endpoint reachable, code=${responseCode})`,
        );
        return;
      }
      if (rateLimitedReady) {
        console.log(
          `[auth-readiness] PASS on attempt ${attempt}/${maxAttempts} (login rate-limited → endpoint reachable)`,
        );
        return;
      }

      const code = result.json?.code || 'UNKNOWN';
      console.log(
        `[auth-readiness] waiting (${attempt}/${maxAttempts}) status=${result.status} code=${code}`,
      );
      }
    } catch (error) {
      console.log(`[auth-readiness] waiting (${attempt}/${maxAttempts}) error=${error.message}`);
    }

    if (attempt < maxAttempts) {
      await wait(sleepMs);
    }
  }

  console.error('[auth-readiness] FAIL: login endpoint not ready in time');
  process.exit(1);
}

main().catch((error) => {
  console.error(`[auth-readiness] unexpected error: ${error.message}`);
  process.exit(1);
});

