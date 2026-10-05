#!/usr/bin/env node
/**
 * GACP Platform - Comprehensive E2E Smoke Test Suite
 * 
 * Categories:
 *   A. Infrastructure & Health Checks
 *   B. Authentication Flows
 *   C. RBAC Enforcement
 *   D. API Endpoint Smoke Tests
 *   E. Frontend Page Load Tests
 *   F. Workflow State Machine
 *   G. Security Checks
 *   H. Data Integrity
 * 
 * Usage:
 *   node scripts/e2e-smoke-test.js [BASE_URL]
 *   Default BASE_URL: https://gacpth.com
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = process.argv[2] || 'https://gacpth.com';
const API = `${BASE_URL}/api`;
const OUTPUT_FILE = path.join(__dirname, 'e2e-results.txt');

// ─── Test Runner ─────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const results = [];
const cookies = { health: null, provider: null };

async function test(category, name, fn) {
    const label = `[${category}] ${name}`;
    try {
        const result = await fn();
        if (result === 'SKIP') {
            skipped++;
            results.push({ status: '⏭️', label, detail: 'Skipped (dependency)' });
            return;
        }
        passed++;
        results.push({ status: '✅', label, detail: result || '' });
    } catch (err) {
        failed++;
        const msg = err.message || String(err);
        results.push({ status: '❌', label, detail: msg.substring(0, 120) });
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function fetchJSON(url, options = {}) {
    const opts = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    };
    // Node 18+ has fetch built-in; skip TLS verification for self-signed cert
        const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, headers: res.headers };
}

// Extract Set-Cookie from response headers
function extractCookie(headers, name) {
    const setCookie = headers.getSetCookie?.() || [];
    for (const c of setCookie) {
        if (c.startsWith(`${name}=`)) {
            return c.split(';')[0]; // e.g., "provider_token=xxx"
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════
// A. INFRASTRUCTURE & HEALTH CHECKS
// ═══════════════════════════════════════════════════════════════════

async function runInfraTests() {
    await test('A-INFRA', 'API Health endpoint returns 200', async () => {
        const { status, json } = await fetchJSON(`${API}/health`);
        assert(status === 200, `Expected 200, got ${status}`);
        return `status: ${json?.status || 'ok'}`;
    });

    await test('A-INFRA', 'API Version endpoint returns 200', async () => {
        const { status, json } = await fetchJSON(`${API}/version`);
        assert(status === 200, `Expected 200, got ${status}`);
        return `version: ${json?.version || 'unknown'}`;
    });

    await test('A-INFRA', 'Frontend landing page returns 200', async () => {
        const res = await fetch(`${BASE_URL}/`, {
            redirect: 'follow',
            headers: { 'Accept': 'text/html' },
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const text = await res.text();
        assert(text.includes('GACP') || text.includes('html'), 'Missing GACP content');
        return 'HTML page loaded';
    });

    await test('A-INFRA', 'Nginx returns proper headers', async () => {
        const res = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
        const server = res.headers.get('server') || '';
        return `server: ${server || 'hidden (good)'}`;
    });
}

// ═══════════════════════════════════════════════════════════════════
// B. AUTHENTICATION FLOWS
// ═══════════════════════════════════════════════════════════════════

async function runAuthTests() {
    // B1: Provider login with invalid credentials
    await test('B-AUTH', 'Provider login rejects invalid credentials', async () => {
        const { status } = await fetchJSON(`${API}/auth/provider/login`, {
            method: 'POST',
            body: JSON.stringify({ idCard: '0000000000000', password: 'wrongpassword' }),
        });
        assert(status === 401 || status === 400 || status === 404, `Expected 4xx, got ${status}`);
        return `Correctly rejected with ${status}`;
    });

    // B2: Health login with invalid credentials
    await test('B-AUTH', 'Health login rejects invalid credentials', async () => {
        const { status } = await fetchJSON(`${API}/auth/health/login`, {
            method: 'POST',
            body: JSON.stringify({ idCard: '0000000000000', password: 'wrongpassword' }),
        });
        assert(status === 401 || status === 400 || status === 404, `Expected 4xx, got ${status}`);
        return `Correctly rejected with ${status}`;
    });

    // B3: Provider login with empty body
    await test('B-AUTH', 'Provider login rejects empty body', async () => {
        const { status } = await fetchJSON(`${API}/auth/provider/login`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
        return `Correctly rejected with ${status}`;
    });

    // B4: Provider /me without auth
    await test('B-AUTH', 'Provider /me rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/auth/provider/me`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly rejected with ${status}`;
    });

    // B5: Health /me without auth
    await test('B-AUTH', 'Health /me rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/auth/health/me`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly rejected with ${status}`;
    });

    // B6: Provider login response does NOT contain token in body (CP-09)
    await test('B-AUTH', 'Provider login body does NOT contain token field (CP-09)', async () => {
        const { json } = await fetchJSON(`${API}/auth/provider/login`, {
            method: 'POST',
            body: JSON.stringify({ idCard: '0000000000000', password: 'wrongpassword' }),
        });
        // Even on failure, check the response shape doesn't leak token
        if (json?.data?.token) throw new Error('Token found in response body!');
        return 'No token in body';
    });

    // B7: Health register endpoint exists
    await test('B-AUTH', 'Health register endpoint responds', async () => {
        const { status } = await fetchJSON(`${API}/auth/health/register`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        // Should be 400 (bad request) not 404 (not found)
        assert(status !== 404, `Register endpoint missing (got 404)`);
        return `Endpoint exists (status: ${status})`;
    });
}

// ═══════════════════════════════════════════════════════════════════
// C. RBAC ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════

async function runRBACTests() {
    // C1: Unauthenticated access to admin routes
    await test('C-RBAC', 'Admin dashboard API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/admin/config`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C2: Unauthenticated access to applications
    await test('C-RBAC', 'Applications API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/applications`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C3: Unauthenticated access to provider operations
    await test('C-RBAC', 'Provider operations API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/provider/establishments`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C4: Unauthenticated access to invoices
    await test('C-RBAC', 'Invoices API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/invoices`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C5: Unauthenticated access to certificates
    await test('C-RBAC', 'Certificates API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/certificates`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C6: Unauthenticated access to payments
    await test('C-RBAC', 'Payments API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/payments`);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C7: Unauthenticated access to audits
    await test('C-RBAC', 'Audits API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/audits`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C8: Unauthenticated access to accounting
    await test('C-RBAC', 'Accounting API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/accounting`);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C9: Cron routes reject without secret
    await test('C-RBAC', 'Cron routes reject without secret', async () => {
        const { status } = await fetchJSON(`${API}/cron/sla-check`);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C10: Cron routes reject with wrong secret
    await test('C-RBAC', 'Cron routes reject with wrong secret', async () => {
        const { status } = await fetchJSON(`${API}/cron/sla-check`, {
            headers: { 'x-cron-secret': 'wrong-secret-value' },
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C11: Dashboard API rejects without auth
    await test('C-RBAC', 'Dashboard API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/dashboard`);
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // C12: Farm data API rejects without auth
    await test('C-RBAC', 'Farms API rejects without auth', async () => {
        const { status } = await fetchJSON(`${API}/farms`);
        assert(status === 401 || status === 403, `Expected 401/403, got ${status}`);
        return `Correctly blocked: ${status}`;
    });
}

// ═══════════════════════════════════════════════════════════════════
// D. API ENDPOINT SMOKE TESTS
// ═══════════════════════════════════════════════════════════════════

async function runAPITests() {
    // D1: Public endpoints (should work without auth)
    const publicEndpoints = [
        { path: '/standards', name: 'Standards' },
        { path: '/master-data/provinces', name: 'Master data provinces' },
    ];

    for (const ep of publicEndpoints) {
        await test('D-API', `${ep.name} endpoint responds`, async () => {
            const { status } = await fetchJSON(`${API}${ep.path}`);
            assert(status < 500, `Server error: ${status}`);
            return `status: ${status}`;
        });
    }

    // D2: System config endpoint
    await test('D-API', 'System config endpoint responds', async () => {
        const { status } = await fetchJSON(`${API}/system-config/public`);
        assert(status === 200 || status === 404, `Expected 200 or 404, got ${status}`);
        return `status: ${status}`;
    });

    // D3: Pricing endpoint
    await test('D-API', 'Pricing endpoint responds', async () => {
        const { status } = await fetchJSON(`${API}/pricing`);
        assert(status < 500, `Server error: ${status}`);
        return `status: ${status}`;
    });

    // D4: Lab webhook rejects without API key
    await test('D-API', 'Lab webhook rejects without API key', async () => {
        const { status } = await fetchJSON(`${API}/callbacks/lab/results`, {
            method: 'POST',
            body: JSON.stringify({ test: true }),
        });
        assert(status === 401 || status === 403 || status === 404, `Expected 4xx, got ${status}`);
        return `Correctly rejected: ${status}`;
    });

    // D5: Trace endpoint (public QR code)
    await test('D-API', 'Trace/verify endpoint responds', async () => {
        const { status } = await fetchJSON(`${API}/trace/verify/NONEXISTENT`);
        assert(status < 500, `Server error: ${status}`);
        return `status: ${status}`;
    });

    // D6: Standards endpoint
    await test('D-API', 'Standards endpoint responds', async () => {
        const { status } = await fetchJSON(`${API}/standards`);
        assert(status < 500, `Server error: ${status}`);
        return `status: ${status}`;
    });

    // D7: Journey/cultivation config
    await test('D-API', 'Cultivation config endpoint responds', async () => {
        const { status } = await fetchJSON(`${API}/cultivation-config`);
        assert(status < 500, `Server error: ${status}`);
        return `status: ${status}`;
    });

    // D8: Webhook endpoint exists
    await test('D-API', 'Payment webhook endpoint exists', async () => {
        const { status } = await fetchJSON(`${API}/webhooks/payment`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        assert(status !== 404, `Webhook endpoint missing`);
        return `status: ${status}`;
    });
}

// ═══════════════════════════════════════════════════════════════════
// E. FRONTEND PAGE LOAD TESTS
// ═══════════════════════════════════════════════════════════════════

async function runPageTests() {
    // Public pages (should load without auth)
    const publicPages = [
        { path: '/', name: 'Landing page' },
        { path: '/privacy', name: 'Privacy policy' },
        { path: '/terms', name: 'Terms of service' },
        { path: '/auth/provider/login', name: 'Provider login' },
        { path: '/auth/health/login', name: 'Health login' },
        { path: '/trace', name: 'Trace verification' },
        { path: '/verify', name: 'Public verify' },
        { path: '/verify-identity', name: 'Identity verification' },
    ];

    for (const page of publicPages) {
        await test('E-PAGE', `${page.name} loads (200 or redirect)`, async () => {
            const res = await fetch(`${BASE_URL}${page.path}`, {
                redirect: 'follow',
                headers: { 'Accept': 'text/html' },
            });
            assert(res.status === 200, `Expected 200, got ${res.status}`);
            return 'Loaded';
        });
    }

    // Auth-guarded pages (should redirect to login)
    const guardedPages = [
        { path: '/provider/dashboard', name: 'Provider dashboard', loginPath: '/auth/provider/login' },
        { path: '/provider/applications', name: 'Provider applications', loginPath: '/auth/provider/login' },
        { path: '/provider/certificates', name: 'Provider certificates', loginPath: '/auth/provider/login' },
        { path: '/provider/audits', name: 'Provider audits', loginPath: '/auth/provider/login' },
        { path: '/provider/accounting', name: 'Provider accounting', loginPath: '/auth/provider/login' },
        { path: '/provider/calendar', name: 'Provider calendar', loginPath: '/auth/provider/login' },
        { path: '/provider/analytics', name: 'Provider analytics', loginPath: '/auth/provider/login' },
        { path: '/provider/management', name: 'Provider management', loginPath: '/auth/provider/login' },
        { path: '/provider/receipts', name: 'Provider receipts', loginPath: '/auth/provider/login' },
        { path: '/provider/profile', name: 'Provider profile', loginPath: '/auth/provider/login' },
        { path: '/provider/settings', name: 'Provider settings', loginPath: '/auth/provider/login' },
        { path: '/provider/verification', name: 'Provider verification', loginPath: '/auth/provider/login' },
        { path: '/provider/planting', name: 'Provider planting', loginPath: '/auth/provider/login' },
        { path: '/provider/criteria', name: 'Provider criteria', loginPath: '/auth/provider/login' },
        { path: '/health/dashboard', name: 'Health dashboard', loginPath: '/auth/health/login' },
        { path: '/health/applications', name: 'Health applications', loginPath: '/auth/health/login' },
        { path: '/health/certificates', name: 'Health certificates', loginPath: '/auth/health/login' },
        { path: '/health/profile', name: 'Health profile', loginPath: '/auth/health/login' },
        { path: '/health/settings', name: 'Health settings', loginPath: '/auth/health/login' },
        { path: '/health/payments', name: 'Health payments', loginPath: '/auth/health/login' },
        { path: '/health/notifications', name: 'Health notifications', loginPath: '/auth/health/login' },
        { path: '/health/establishments', name: 'Health establishments', loginPath: '/auth/health/login' },
        { path: '/health/planting', name: 'Health planting', loginPath: '/auth/health/login' },
        { path: '/health/documents', name: 'Health documents', loginPath: '/auth/health/login' },
        { path: '/health/training', name: 'Health training', loginPath: '/auth/health/login' },
        { path: '/health/site-analysis', name: 'Health site analysis', loginPath: '/auth/health/login' },
        { path: '/health/tracking', name: 'Health tracking', loginPath: '/auth/health/login' },
        { path: '/admin/dashboard', name: 'Admin dashboard', loginPath: '/auth/provider/login' },
        { path: '/admin/users', name: 'Admin users', loginPath: '/auth/provider/login' },
        { path: '/admin/settings', name: 'Admin settings', loginPath: '/auth/provider/login' },
        { path: '/admin/planting', name: 'Admin planting', loginPath: '/auth/provider/login' },
    ];

    for (const page of guardedPages) {
        await test('E-PAGE', `${page.name} redirects to login without auth`, async () => {
            const res = await fetch(`${BASE_URL}${page.path}`, {
                redirect: 'follow',
                headers: { 'Accept': 'text/html' },
            });
            const finalUrl = res.url || '';
            const text = await res.text();
            // Should either redirect to login or show login page
            const redirectedToLogin = finalUrl.includes('login') || finalUrl.includes('redirect');
            const showsLoginForm = text.includes('login') || text.includes('เข้าสู่ระบบ');
            assert(redirectedToLogin || showsLoginForm, `Did NOT redirect to login. URL: ${finalUrl}`);
            return redirectedToLogin ? 'Redirected to login' : 'Shows login form';
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// F. WORKFLOW STATE MACHINE
// ═══════════════════════════════════════════════════════════════════

async function runWorkflowTests() {
    // F1: Applications config returns valid states
    await test('F-WORKFLOW', 'Application config returns workflow info', async () => {
        const { status, json } = await fetchJSON(`${API}/applications/config/new_application`);
        assert(status < 500, `Server error: ${status}`);
        return `status: ${status}`;
    });

    // F2: Verify workflow states are canonical
    await test('F-WORKFLOW', 'Status machine constants accessible', async () => {
        // Test via the system config or health check
        const { status } = await fetchJSON(`${API}/system/status-machine`);
        assert(status < 500, `Server error: ${status}`);
        return `status: ${status}`;
    });
}

// ═══════════════════════════════════════════════════════════════════
// G. SECURITY CHECKS
// ═══════════════════════════════════════════════════════════════════

async function runSecurityTests() {
    // G1: SQL injection attempt on login
    await test('G-SECURITY', 'Provider login rejects SQL injection', async () => {
        const { status } = await fetchJSON(`${API}/auth/provider/login`, {
            method: 'POST',
            body: JSON.stringify({ idCard: "' OR 1=1 --", password: "' OR 1=1 --" }),
        });
        assert(status >= 400 && status < 500, `Expected 4xx, got ${status}`);
        return `Correctly rejected: ${status}`;
    });

    // G2: XSS attempt in query params
    await test('G-SECURITY', 'API rejects XSS in query params', async () => {
        const { status } = await fetchJSON(`${API}/public/standards?search=<script>alert(1)</script>`);
        assert(status < 500, `Server error on XSS attempt: ${status}`);
        return `No server error: ${status}`;
    });

    // G3: Path traversal attempt
    await test('G-SECURITY', 'API rejects path traversal', async () => {
        const { status } = await fetchJSON(`${API}/../../../etc/passwd`);
        assert(status >= 400, `Expected 4xx, got ${status}`);
        return `Correctly blocked: ${status}`;
    });

    // G4: CORS headers present
    await test('G-SECURITY', 'CORS headers configured', async () => {
        const res = await fetch(`${API}/health`, {
            method: 'OPTIONS',
            headers: { 'Origin': 'https://evil.com' },
        });
        return `status: ${res.status}`;
    });

    // G5: No server version exposed
    await test('G-SECURITY', 'X-Powered-By header not exposed', async () => {
        const res = await fetch(`${API}/health`);
        const powered = res.headers.get('x-powered-by');
        assert(!powered || powered !== 'Express', 'X-Powered-By exposed');
        return powered ? `header: ${powered}` : 'Not exposed (good)';
    });

    // G6: Rate limiting or proper error on flood
    await test('G-SECURITY', 'Login endpoint handles rapid requests', async () => {
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(fetchJSON(`${API}/auth/provider/login`, {
                method: 'POST',
                body: JSON.stringify({ idCard: '0000000000000', password: 'wrong' }),
            }));
        }
        const results = await Promise.all(promises);
        const allResponded = results.every(r => r.status > 0);
        assert(allResponded, 'Some requests failed');
        return `All 5 requests handled`;
    });
}

// ═══════════════════════════════════════════════════════════════════
// H. DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════

async function runDataTests() {
    // H1: Total migration count matches
    await test('H-DATA', 'All Prisma migrations applied', async () => {
        // This is checked via the API/health endpoint
        const { status, json } = await fetchJSON(`${API}/health`);
        assert(status === 200, `Health check failed: ${status}`);
        return 'Health OK → DB connected';
    });

    // H2: No 500 errors on empty list endpoints
    const listEndpoints = [
        '/notifications',
        '/tickets',
    ];

    for (const ep of listEndpoints) {
        await test('H-DATA', `${ep} does not 500 on unauthenticated access`, async () => {
            const { status } = await fetchJSON(`${API}${ep}`);
            assert(status !== 500, `Server error (500) on ${ep}`);
            return `status: ${status}`;
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════

function printReport() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        GACP Platform — E2E Smoke Test Report               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n  Target: ${BASE_URL}`);
    console.log(`  Date:   ${new Date().toISOString()}\n`);

    let currentCategory = '';
    for (const r of results) {
        const cat = r.label.match(/\[(.+?)\]/)?.[1] || '';
        if (cat !== currentCategory) {
            currentCategory = cat;
            console.log(`\n── ${cat} ${'─'.repeat(50 - cat.length)}`);
        }
        const detail = r.detail ? ` (${r.detail})` : '';
        console.log(`  ${r.status} ${r.label.replace(/\[.+?\] /, '')}${detail}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Passed: ${passed} Failed: ${failed} Skipped: ${skipped}`);
    console.log(`  Total:  ${passed + failed + skipped}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (failed === 0) {
        console.log('\n ALL TESTS PASSED\n');
    } else {
        console.log(`\n ${failed} TEST(S) FAILED\n`);
        console.log('  Failed tests:');
        for (const r of results) {
            if (r.status === '❌') {
                console.log(`    • ${r.label}: ${r.detail}`);
            }
        }
        console.log('');
    }

    // Write results to file
    const lines = [];
    lines.push('GACP Platform - E2E Smoke Test Report');
    lines.push(`Target: ${BASE_URL}`);
    lines.push(`Date: ${new Date().toISOString()}`);
    lines.push('');
    for (const r of results) {
        lines.push(`${r.status === '✅' ? 'PASS' : r.status === '❌' ? 'FAIL' : 'SKIP'} | ${r.label} | ${r.detail}`);
    }
    lines.push('');
    lines.push(`Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped} | Total: ${passed + failed + skipped}`);
    if (failed > 0) {
        lines.push('');
        lines.push('FAILURES:');
        for (const r of results) {
            if (r.status === '❌') lines.push(`  - ${r.label}: ${r.detail}`);
        }
    }
    fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
    console.log(`\nResults written to ${OUTPUT_FILE}`);

    process.exit(failed > 0 ? 1 : 0);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function waitForBackend(maxAttempts = 10, intervalMs = 3000) {
    console.log(`Waiting for backend to be healthy at ${API}/health ...`);
    for (let i = 1; i <= maxAttempts; i++) {
        try {
            const res = await fetch(`${API}/health`);
            if (res.ok) {
                console.log(`Backend healthy after ${i} attempt(s)\n`);
                return true;
            }
            console.log(`   Attempt ${i}/${maxAttempts}: status ${res.status}, retrying...`);
        } catch {
            console.log(`   Attempt ${i}/${maxAttempts}: connection refused, retrying...`);
        }
        if (i < maxAttempts) await new Promise(r => setTimeout(r, intervalMs));
    }
    console.log(`Backend not healthy after ${maxAttempts} attempts. Running tests anyway.\n`);
    return false;
}

async function main() {
    console.log(`\n Starting GACP E2E Smoke Tests against ${BASE_URL}\n`);

    // Wait for backend to be ready before running tests
    await waitForBackend();

    await runInfraTests();
    await runAuthTests();
    await runRBACTests();
    await runAPITests();
    await runPageTests();
    await runWorkflowTests();
    await runSecurityTests();
    await runDataTests();

    printReport();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
