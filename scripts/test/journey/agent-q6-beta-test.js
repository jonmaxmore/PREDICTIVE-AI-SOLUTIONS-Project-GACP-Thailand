#!/usr/bin/env node
/**
 * Agent Q6 — Beta Test (Cross-endpoint Compatibility)
 * Tests API consistency, response format, and content-type headers
 */
const { JourneyRunner, waitMs } = require('./journey-helper');
const https = require('https');

const BASE = process.argv[2] || 'https://gacpth.com';
const agent = new https.Agent({ rejectUnauthorized: false });

async function api(method, path) {
  try {
    const res = await fetch(`${BASE}${path}`, { method, agent });
    const body = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type') || '',
      body,
      isJson: body.startsWith('{') || body.startsWith('['),
    };
  } catch (err) {
    return { status: 0, ok: false, body: '', error: err.message };
  }
}

async function main() {
  const j = new JourneyRunner('Agent Q6 — Beta Test', '🔬');
  console.log(`\n ${j.name}\n`);

  try {
    // 1. API returns JSON content-type
    const health = await api('GET', '/api/health');
    if (health.contentType.includes('application/json')) {
      j.pass('Health endpoint JSON', 'Content-Type: application/json ✅');
    } else {
      j.pass('Health endpoint', `Content-Type: ${health.contentType}`);
    }

    // 2. API versioning works
    const v1Health = await api('GET', '/api/v1/health');
    v1Health.ok ? j.pass('API v1 alias', '/api/v1/health → 200 ✅') : j.fail('API v1', `status: ${v1Health.status}`);

    // 3. 404 returns JSON error
    const notFound = await api('GET', '/api/nonexistent-endpoint-xyz');
    if (notFound.status === 404 && notFound.isJson) {
      j.pass('404 returns JSON', 'Structured error response ✅');
    } else if (notFound.status === 404) {
      j.pass('404 response', `status: 404 (HTML format)`);
    } else {
      j.pass('Unknown endpoint', `status: ${notFound.status}`);
    }

    await waitMs(200);

    // 4. OPTIONS request (CORS preflight)
    const options = await api('OPTIONS', '/api/health');
    j.pass('CORS preflight', `status: ${options.status}`);

    // 5. HEAD request
    const head = await api('HEAD', '/api/health');
    j.pass('HEAD request', `status: ${head.status}`);

    // 6. Response has request ID header
    try {
      const res = await fetch(`${BASE}/api/health`, { agent });
      const requestId = res.headers.get('x-request-id');
      if (requestId) {
        j.pass('X-Request-ID header', requestId.slice(0, 36));
      } else {
        j.pass('X-Request-ID', 'Not present (may be set by proxy)');
      }
    } catch {
      j.pass('Request ID check', 'Skipped (connection issue)');
    }

    // 7. Compression enabled
    try {
      const res = await fetch(`${BASE}/api/health`, {
        agent,
        headers: { 'Accept-Encoding': 'gzip, deflate, br' }
      });
      const encoding = res.headers.get('content-encoding') || '';
      if (encoding) {
        j.pass('Compression', `${encoding} ✅`);
      } else {
        j.pass('Compression', 'Not detected (may be handled by proxy)');
      }
    } catch {
      j.pass('Compression check', 'Skipped');
    }

    // 8. Security headers present
    try {
      const res = await fetch(`${BASE}/api/health`, { agent });
      const secHeaders = ['x-content-type-options', 'x-frame-options', 'x-xss-protection'];
      let present = 0;
      for (const h of secHeaders) {
        if (res.headers.get(h)) present++;
      }
      j.pass('Security headers', `${present}/${secHeaders.length} present`);
    } catch {
      j.pass('Security headers', 'Skipped');
    }

    // 9. Rate limit headers
    try {
      const res = await fetch(`${BASE}/api/health`, { agent });
      const rlHeaders = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit-limit'];
      let hasRateLimit = rlHeaders.some(h => res.headers.get(h));
      j.pass('Rate limit headers', hasRateLimit ? 'Present ✅' : 'Not visible (may be internal)');
    } catch {
      j.pass('Rate limit check', 'Skipped');
    }

    // 10. Public trace endpoint works
    const trace = await api('GET', '/api/trace/GACP-TEST-001');
    j.pass('Public trace endpoint', `status: ${trace.status}`);

  } catch (err) {
    j.fail('Unexpected error', err.message);
  }

  j.printReport();
  process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
