/**
 * k6 load test — Iter 29 (FINAL), hardening loop 2026-05-16.
 *
 * Owner: QA (Iter 29)
 * Runbook: docs/qa/load-test-runbook-2026-05-16.md
 *
 * Four scenarios covering the load profile QA committed to in Iter 28
 * (capacity baseline: 1000 concurrent applicants + 50 concurrent staff):
 *
 *   1. applicant_browsing       — GET /api/applications/my, 100 rps, 5min
 *   2. slip_upload_spike        — POST /api/payments/slip/upload, ramp 10→50 rps
 *   3. public_certificate_verify— GET /api/auth/public/verify/:n, 500 rps
 *   4. admin_reports            — GET /api/finance/reports/trial-balance, 5 rps
 *
 * Run all scenarios in parallel:
 *
 *   k6 run scenarios.k6.js
 *
 * Run a single scenario (others skipped via --tag if you split them out):
 *
 *   k6 run --env SCENARIO=public_certificate_verify scenarios.k6.js
 *
 * Environment variables:
 *
 *   BASE_URL        — target host (default https://staging.gacp.dtam.go.th)
 *   APPLICANT_TOKEN — Bearer token for an HEALTH applicant fixture
 *   ADMIN_TOKEN     — Bearer token for an ACCOUNT_PLATFORM admin fixture
 *   CERT_NUMBER     — known-valid cert number for the verify scenario
 *
 * Even if k6 isn't installed locally, this file is a valid k6 script that
 * runs on any k6 v0.50+ binary (https://k6.io/docs/get-started/installation/).
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ──────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'https://staging.gacp.dtam.go.th';
const APPLICANT_TOKEN = __ENV.APPLICANT_TOKEN || 'staging-applicant-token-placeholder';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || 'staging-admin-token-placeholder';
const CERT_NUMBER = __ENV.CERT_NUMBER || 'GACP-2026-001';

// Custom metrics — surface scenario-specific signals on top of k6's built-ins.
const errorRate = new Rate('app_error_rate');
const slipUploadErrors = new Counter('slip_upload_errors_total');
const slipUploadLatency = new Trend('slip_upload_latency_ms', true);
const verifyLatency = new Trend('public_verify_latency_ms', true);
const reportLatency = new Trend('admin_report_latency_ms', true);

// Tiny, fake slip-image payload (base64 of a 1x1 PNG). Real-world average is
// ~200 KB; we keep this small so the test stresses the API tier, not the
// uploader's bandwidth. Swap in a SharedArray of real fixtures when stress
// testing storage (S3 / MinIO) end-to-end.
const FAKE_SLIP_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// SharedArray so VUs don't each re-instantiate this list (memory-cheap, JIT-friendly).
const certNumbers = new SharedArray('verify_cert_pool', () => [
  CERT_NUMBER,
  'GACP-2026-002',
  'GACP-2026-003',
  'GACP-2026-NOT-FOUND',
]);

// ──────────────────────────────────────────────────────────────────────────
// Scenarios
// ──────────────────────────────────────────────────────────────────────────
//
// k6 'constant-arrival-rate' executor — what k6 calls "throughput-based"
// scenarios — generates iterations at a target rate, scaling VUs up
// automatically until preAllocatedVUs (or maxVUs) is exhausted. This is
// the right shape for a load test where we care about rps, not VU count.
export const options = {
  scenarios: {
    applicant_browsing: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 200,
      maxVUs: 400,
      exec: 'applicantBrowsing',
      tags: { scenario: 'applicant_browsing' },
    },
    slip_upload_spike: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 300,
      stages: [
        { duration: '1m', target: 10 },   // baseline
        { duration: '30s', target: 50 },  // ramp
        { duration: '5m', target: 50 },   // sustained spike
        { duration: '30s', target: 10 },  // cool-down
      ],
      exec: 'slipUploadSpike',
      tags: { scenario: 'slip_upload_spike' },
      // Stagger so this doesn't start at t=0 with the others — slip uploads
      // typically follow a browsing window in the applicant journey.
      startTime: '30s',
    },
    public_certificate_verify: {
      executor: 'constant-arrival-rate',
      rate: 500,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 500,
      maxVUs: 1000,
      exec: 'publicCertificateVerify',
      tags: { scenario: 'public_certificate_verify' },
    },
    admin_reports: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: 'adminReports',
      tags: { scenario: 'admin_reports' },
    },
  },

  // Pass/fail thresholds — these are the targets the runbook references.
  // If ANY threshold trips, `k6 run` exits non-zero (CI-friendly).
  thresholds: {
    // Scenario 1 — applicant browsing
    'http_req_duration{scenario:applicant_browsing}': ['p(95)<500'],
    'http_req_failed{scenario:applicant_browsing}':   ['rate<0.001'],

    // Scenario 2 — slip upload
    'http_req_failed{scenario:slip_upload_spike}':           ['rate<0.01'],
    'http_req_duration{scenario:slip_upload_spike}':         ['p(95)<2000'],
    'slip_upload_errors_total':                              ['count<50'],

    // Scenario 3 — public verify (the hot path)
    'http_req_duration{scenario:public_certificate_verify}': ['p(95)<200'],
    'http_req_failed{scenario:public_certificate_verify}':   ['rate<0.001'],

    // Scenario 4 — admin trial balance (heavy SQL)
    'http_req_duration{scenario:admin_reports}': ['p(95)<5000'],
    'http_req_failed{scenario:admin_reports}':   ['rate<0.01'],

    // Cross-scenario safety net
    'app_error_rate': ['rate<0.01'],
  },

  // No data discardin so we get full p99 percentiles on the summary line.
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

// ──────────────────────────────────────────────────────────────────────────
// Scenario 1 — Applicant browsing
// ──────────────────────────────────────────────────────────────────────────
// Models the most common authenticated read path. The applicant lists their
// own applications between actions in the journey (dashboard polling +
// after each save). 100 rps sustained for 5min ≈ 30K requests total —
// enough to catch a slow query that only appears on a warmed cache.
export function applicantBrowsing() {
  group('applicant: GET /api/applications/my', () => {
    const res = http.get(`${BASE_URL}/api/applications/my`, {
      headers: {
        Authorization: `Bearer ${APPLICANT_TOKEN}`,
        Accept: 'application/json',
      },
      tags: { endpoint: 'applications_my' },
    });
    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'response has body': (r) => r.body && r.body.length > 0,
      'response is JSON': (r) =>
        r.headers['Content-Type'] && r.headers['Content-Type'].includes('json'),
    });
    if (!ok) {errorRate.add(1);} else {errorRate.add(0);}
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario 2 — Slip upload spike
// ──────────────────────────────────────────────────────────────────────────
// Mirrors the post-business-hours pattern when applicants queue up bank
// slips after the cutover window. Real users hit the endpoint with a
// multipart payload — k6 builds that with FormData. We ramp from baseline
// 10 rps → 50 rps to surface queue-saturation under burst.
export function slipUploadSpike() {
  group('applicant: POST /api/payments/slip/upload', () => {
    const payload = {
      invoiceNumber: `INV-LOAD-${__VU}-${__ITER}`,
      amount: '5535.00',
      transferDate: '2026-05-16',
      // Decode the placeholder PNG inline; k6 sends as binary part.
      slipImage: http.file(
        encoding_base64ToBytes(FAKE_SLIP_PNG_B64),
        `slip-${__VU}-${__ITER}.png`,
        'image/png',
      ),
    };
    const res = http.post(`${BASE_URL}/api/payments/slip/upload`, payload, {
      headers: { Authorization: `Bearer ${APPLICANT_TOKEN}` },
      tags: { endpoint: 'slip_upload' },
      // OCR + slip fraud-detection can take 1-2s; give the request room.
      timeout: '30s',
    });
    slipUploadLatency.add(res.timings.duration);
    const ok = check(res, {
      'status is 200 or 202': (r) => r.status === 200 || r.status === 202,
      'no 5xx': (r) => r.status < 500,
    });
    if (!ok || res.status >= 500) {
      slipUploadErrors.add(1);
      errorRate.add(1);
    } else {
      errorRate.add(0);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario 3 — Public certificate verify
// ──────────────────────────────────────────────────────────────────────────
// The Iter 28 capacity baseline says public verify must hold 500 rps. This
// is the QR-scan path consumers hit from herbal-product packaging — it
// MUST be fast and MUST be CDN-friendly. p95 < 200ms is the contract.
export function publicCertificateVerify() {
  group('public: GET /api/auth/public/verify/:n', () => {
    // Round-robin across the SharedArray so cache-hit profile stays realistic.
    const cert = certNumbers[(__VU + __ITER) % certNumbers.length];
    const res = http.get(`${BASE_URL}/api/auth/public/verify/${cert}`, {
      headers: { Accept: 'application/json' },
      tags: { endpoint: 'public_verify' },
    });
    verifyLatency.add(res.timings.duration);
    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'success flag set': (r) => {
        try {
          const j = JSON.parse(r.body);
          return j && j.success === true;
        } catch (_e) {
          return false;
        }
      },
    });
    if (!ok) {errorRate.add(1);} else {errorRate.add(0);}
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario 4 — Admin reports
// ──────────────────────────────────────────────────────────────────────────
// Trial balance is the heaviest legitimate query an account staff member
// will run. 5 rps is conservative — only one or two ACCOUNT_PLATFORM users
// are usually active. The job is to prove the report endpoint doesn't
// degrade the system when other scenarios are also hammering it.
export function adminReports() {
  group('admin: GET /api/finance/reports/trial-balance', () => {
    const year = 2026;
    const month = 5;
    const res = http.get(
      `${BASE_URL}/api/finance/reports/trial-balance?year=${year}&month=${month}`,
      {
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          Accept: 'application/json',
        },
        tags: { endpoint: 'trial_balance' },
        timeout: '30s',
      },
    );
    reportLatency.add(res.timings.duration);
    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'returns ledger rows': (r) => {
        try {
          const j = JSON.parse(r.body);
          return j && Array.isArray(j.data && j.data.rows || j.rows);
        } catch (_e) {
          return false;
        }
      },
    });
    if (!ok) {errorRate.add(1);} else {errorRate.add(0);}
  });

  // Adminreport scenarios space requests so we don't trigger
  // rate-limiter on the report endpoint by accident.
  sleep(1);
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
// k6's `encoding` module ships with base64 decode. Wrap so the scenario
// body stays focused on intent.
import encoding from 'k6/encoding';
function encoding_base64ToBytes(s) {
  return encoding.b64decode(s, 'std', 'b');
}

// ──────────────────────────────────────────────────────────────────────────
// Test lifecycle — setup / teardown
// ──────────────────────────────────────────────────────────────────────────
export function setup() {
  // Sanity ping. If staging is down before the load test starts, fail fast
  // with a clear message instead of producing 18,000 confusing 503s.
  const ping = http.get(`${BASE_URL}/api/health`, { timeout: '10s' });
  if (ping.status !== 200) {
    throw new Error(
      `[k6-setup] Target ${BASE_URL}/api/health returned ${ping.status} — abort load test.`,
    );
  }
  return { startedAt: new Date().toISOString() };
}

export function teardown(data) {
  // eslint-disable-next-line no-console
  console.log(`[k6-teardown] Load test started at ${data.startedAt}, ended at ${new Date().toISOString()}.`);
}
