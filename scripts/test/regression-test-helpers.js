// Prefer explicit BASE_URL; otherwise derive the API base from PUBLIC_BASE_URL
// (CI's ERP/journey jobs set PUBLIC_BASE_URL=http://host:5000 — the API lives at
// /api under it). Falls back to the nginx-fronted localhost default.
const BASE_URL = process.env.BASE_URL
  || (process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/api`
    : 'http://localhost/api');
const { createBillingHelpers } = require('./regression-test-billing-helpers');
const { createPublicHelpers } = require('./regression-test-public-helpers');

function derivePublicBaseUrl(apiBaseUrl) {
  try {
    const parsed = new URL(apiBaseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_error) {
    return 'http://localhost';
  }
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || derivePublicBaseUrl(BASE_URL);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

const CREDENTIALS = {
  health: {
    healthId: process.env.HEALTH_ID || process.env.HEALTH_USER_HEALTH_ID || '1186494077533',
    password: process.env.HEALTH_PASSWORD || process.env.HEALTH_USER_PASSWORD || 'Test@12345',
  },
  // Provider passwords default to PASSWORDS.OFFICER from seed-gacp.js
  // ('Gacp@2025'). The previous default ('provider@12345') no longer
  // matches any seeded user, so the regression gate's reviewer login
  // returned 401.
  reviewer: {
    providerId: process.env.REVIEWER_PROVIDER_ID || '1111111111111',
    password: process.env.REVIEWER_PASSWORD || 'Gacp@2025',
  },
  scheduler: {
    providerId: process.env.SCHEDULER_PROVIDER_ID || '3333333333333',
    password: process.env.SCHEDULER_PASSWORD || 'Gacp@2025',
  },
  auditor: {
    providerId: process.env.AUDITOR_PROVIDER_ID || '2222222222222',
    password: process.env.AUDITOR_PASSWORD || 'Gacp@2025',
  },
  account: {
    providerId: process.env.ACCOUNT_PROVIDER_ID || '4444444444444',
    password: process.env.ACCOUNT_PASSWORD || 'Gacp@2025',
  },
  admin: {
    providerId: process.env.ADMIN_PROVIDER_ID || '9876543210987',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
  },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function toApiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}${normalized}`;
}

async function request(path, options = {}) {
  const response = await fetch(toApiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return { response, body };
}

async function requestWithRetry(path, options = {}, retryOptions = {}) {
  const attempts = retryOptions.attempts || 4;
  const delayMs = retryOptions.delayMs || 700;
  const retryStatuses = retryOptions.retryStatuses || [429, 500, 502, 503, 504];

  let lastResult;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await request(path, options);
    if (lastResult.response.ok || !retryStatuses.includes(lastResult.response.status) || attempt === attempts) {
      return lastResult;
    }
    await sleep(delayMs * attempt);
  }
  return lastResult;
}

async function loginHealth() {
  const result = await requestWithRetry('/auth/health/login', {
    method: 'POST',
    // The route's healthLoginSchema requires `identifier` (the field
    // the production login form actually sends — Thai national ID or
    // email). `healthId` alone is rejected with 400. Send both for
    // backward compatibility.
    body: JSON.stringify({
      identifier: CREDENTIALS.health.healthId,
      healthId: CREDENTIALS.health.healthId,
      password: CREDENTIALS.health.password,
    }),
  }, {
    attempts: 5,
    delayMs: 900,
  });
  assert(result.response.ok, `Health login failed: ${result.response.status}`);
  const token = result.body?.data?.tokens?.accessToken || result.body?.data?.token;
  assert(token, 'Health login token missing');
  return token;
}

async function loginProvider(roleKey) {
  const cred = CREDENTIALS[roleKey];
  const result = await requestWithRetry('/auth/provider/login', {
    method: 'POST',
    body: JSON.stringify({
      providerId: cred.providerId,
      password: cred.password,
    }),
  }, {
    attempts: 5,
    delayMs: 900,
  });
  assert(result.response.ok, `${roleKey} login failed: ${result.response.status}`);
  const token = result.body?.data?.token;
  const user = result.body?.data?.user;
  assert(token, `${roleKey} token missing`);
  assert(user?.id, `${roleKey} user missing`);
  return { token, user };
}

const loginHEALTH_USER = loginHealth;
const loginPROVIDER = loginProvider;
const billingHelpers = createBillingHelpers({
  assert,
  authHeader,
  request,
  requestWithRetry,
});

const publicHelpers = createPublicHelpers({
  assert,
  authHeader,
  requestWithRetry,
  PUBLIC_BASE_URL,
  LOCAL_HOSTNAMES,
});

const {
  listInvoicesForApplication,
  listPhaseInvoices,
  markPhaseInvoicesPaid,
  issuePhaseReceipts,
  findInvoiceForApplication,
  issueReceipt,
  listMyCertificates,
  rowKey,
} = billingHelpers;

const {
  isoAfterHours,
  scheduleAuditWithRetries,
  makeAbsolutePublicUrl,
  assertHttpsOrLocal,
  fetchPublicUrl,
  ensureNoSensitiveFields,
} = publicHelpers;

async function ensurePhase1InvoicesCreated(healthToken, applicationId) {
  const result = await requestWithRetry(`/payments/phase1/${encodeURIComponent(applicationId)}`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({}),
  }, { attempts: 4, delayMs: 700 });

  if (result.response.ok && result.body?.success) {
    return result.body;
  }

  const message = String(result.body?.error || result.body?.message || '').toLowerCase();
  const ignorable = ['already', 'paid', 'exists', 'processing', 'under review', 'under_review']
    .some((term) => message.includes(term));
  if (ignorable) {
    return result.body;
  }

  throw new Error(`Phase 1 invoice init failed: ${result.response.status} ${JSON.stringify(result.body)}`);
}

async function transition(token, applicationId, toState, payload = {}) {
  const result = await requestWithRetry(`/provider/applications/${encodeURIComponent(applicationId)}/workflow-transitions`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ toState, ...payload }),
  }, { attempts: 4, delayMs: 700 });

  assert(
    result.response.ok && result.body?.success,
    `Transition ${toState} failed: ${result.response.status} ${JSON.stringify(result.body)}`,
  );
  return result.body;
}

async function approveForPhase2(reviewerToken, applicationId) {
  const result = await requestWithRetry(`/applications/${encodeURIComponent(applicationId)}/review`, {
    method: 'POST',
    headers: authHeader(reviewerToken),
    body: JSON.stringify({
      action: 'APPROVE',
      comment: 'Generate phase 2 invoice',
    }),
  }, { attempts: 4, delayMs: 700 });

  assert(
    result.response.ok && result.body?.success,
    `Phase 2 approve failed: ${result.response.status} ${JSON.stringify(result.body)}`,
  );
  return result.body;
}

async function markPaidByApplication(healthToken, applicationId, transactionId) {
  await ensurePhase1InvoicesCreated(healthToken, applicationId);

  const result = await requestWithRetry(`/invoices/mark-paid-by-application/${encodeURIComponent(applicationId)}`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({ transactionId: transactionId || `MOCK-${Date.now()}` }),
  }, { attempts: 4, delayMs: 700 });

  if (result.response.ok && result.body?.success) {
    return result.body;
  }

  if (result.response.status !== 404) {
    assert(
      result.response.ok && result.body?.success,
      `Mark paid failed: ${result.response.status} ${JSON.stringify(result.body)}`,
    );
  }

  const phase1Init = await requestWithRetry(`/payments/phase1/${encodeURIComponent(applicationId)}`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({}),
  }, { attempts: 4, delayMs: 700 });
  assert(
    phase1Init.response.ok && phase1Init.body?.success,
    `Mark paid fallback init failed: ${phase1Init.response.status} ${JSON.stringify(phase1Init.body)}`,
  );

  if (phase1Init.body?.phasePaid === true) {
    return phase1Init.body;
  }

  const invoiceId = String(phase1Init.body?.invoiceId || '').trim();
  assert(invoiceId, `Mark paid fallback missing invoiceId: ${JSON.stringify(phase1Init.body)}`);

  const webhook = await requestWithRetry('/webhooks/payment', {
    method: 'POST',
    body: JSON.stringify({
      invoiceId,
      status: 'SUCCESS',
      transactionId: transactionId || `MOCK-WEBHOOK-${Date.now()}`,
      paidAt: new Date().toISOString(),
    }),
  }, { attempts: 4, delayMs: 700 });
  assert(
    webhook.response.ok && webhook.body?.success === true,
    `Mark paid fallback webhook failed: ${webhook.response.status} ${JSON.stringify(webhook.body)}`,
  );

  return webhook.body;
}
module.exports = {
  BASE_URL,
  PUBLIC_BASE_URL,
  CREDENTIALS,
  assert,
  sleep,
  authHeader,
  request,
  requestWithRetry,
  loginHealth,
  loginProvider,
  loginHEALTH_USER,
  loginPROVIDER,
  ensurePhase1InvoicesCreated,
  transition,
  approveForPhase2,
  markPaidByApplication,
  listInvoicesForApplication,
  listPhaseInvoices,
  markPhaseInvoicesPaid,
  issuePhaseReceipts,
  findInvoiceForApplication,
  issueReceipt,
  listMyCertificates,
  isoAfterHours,
  scheduleAuditWithRetries,
  makeAbsolutePublicUrl,
  assertHttpsOrLocal,
  fetchPublicUrl,
  ensureNoSensitiveFields,
  rowKey,
};
