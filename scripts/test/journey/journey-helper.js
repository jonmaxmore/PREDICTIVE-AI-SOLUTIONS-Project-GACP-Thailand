/**
 * ═══════════════════════════════════════════════════════════════
 * Journey Test Helper — Shared utilities for journey agents
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = process.argv[2] || 'https://gacpth.com';
const API = `${BASE_URL}/api`;

const PASSWORD = 'Test@12345';
const TIMESTAMP = Date.now();

// ─── Thai ID Generator ──────────────────────────────────────
function generateThaiId(prefix) {
    const digits = prefix.split('').map(Number);
    while (digits.length < 12) digits.push(0);
    const weights = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += digits[i] * weights[i];
    digits.push((11 - (sum % 11)) % 10);
    return digits.join('');
}

// ─── Test Result Tracking ───────────────────────────────────
class JourneyRunner {
    constructor(name, icon) {
        this.name = name;
        this.icon = icon;
        this.results = [];
        this.passCount = 0;
        this.failCount = 0;
        this.skipCount = 0;
        this.context = {}; // Shared state between steps
    }

    pass(step, detail = '') {
        this.results.push({ s: 'PASS', step, detail });
        this.passCount++;
        console.log(`${step}${detail ?'—'+ detail :''}`);
    }

    fail(step, detail = '') {
        this.results.push({ s: 'FAIL', step, detail });
        this.failCount++;
        console.log(`${step}${detail ?'—'+ detail :''}`);
    }

    skip(step, detail = '') {
        this.results.push({ s: 'SKIP', step, detail });
        this.skipCount++;
        console.log(`${step}${detail ?'—'+ detail :''}`);
    }

    printReport() {
        const total = this.passCount + this.failCount + this.skipCount;
        const rate = total > 0 ? ((this.passCount / total) * 100).toFixed(1) : '0.0';

        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║     ${this.icon} ${this.name.padEnd(46)}║`);
        console.log(`╚════════════════════════════════════════════════════════════╝\n`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Passed: ${this.passCount} Failed: ${this.failCount} Skipped: ${this.skipCount}`);
        console.log(`Pass Rate: ${rate}% (${total} total)`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        if (this.failCount === 0) console.log('\n ALL STEPS PASSED');
        else console.log(`\n ${this.failCount} STEP(S) FAILED`);

        // Save results file
        const outFile = path.join(__dirname, `${this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-results.txt`);
        const lines = [
            `${this.name} Results`,
            `Date: ${new Date().toISOString()}`,
            `Pass: ${this.passCount} | Fail: ${this.failCount} | Skip: ${this.skipCount} | Rate: ${rate}%`,
            '',
            ...this.results.map(r => `${r.s} | ${r.step} | ${r.detail}`),
        ];
        fs.writeFileSync(outFile, lines.join('\n'), 'utf-8');
        console.log(`\nResults → ${outFile}\n`);
        return { pass: this.passCount, fail: this.failCount, skip: this.skipCount, total, rate };
    }
}

// ─── HTTP Helpers ───────────────────────────────────────────
async function api(method, path, opts = {}) {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
    // P1-e2e: /e2e/* routes now require a shared secret. Set E2E_SECRET in the env
    // when running journey suites against a secret-gated server (staging/CI).
    if (process.env.E2E_SECRET) headers['x-e2e-secret'] = process.env.E2E_SECRET;

    const fetchOpts = { method, headers };
    if (opts.body && method !== 'GET') fetchOpts.body = JSON.stringify(opts.body);

    try {
        const res = await fetch(url, fetchOpts);
        let data = null;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
            try { data = await res.json(); } catch { data = null; }
        }
        return { status: res.status, data, ok: res.ok };
    } catch (err) {
        return { status: 0, data: null, ok: false, error: err.message };
    }
}

async function loginHealth(identifier) {
    const r = await api('POST', '/auth/health/login', { body: { identifier, password: PASSWORD } });
    return r.data?.data?.tokens?.accessToken || r.data?.data?.token || null;
}

async function loginProvider(providerId) {
    const r = await api('POST', '/auth/provider/login', { body: { providerId, password: PASSWORD } });
    return r.data?.data?.token || null;
}

async function e2eReset(email) {
    return api('POST', '/e2e/reset', { body: { healthEmail: email } });
}

async function waitMs(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = {
    BASE_URL, API, PASSWORD, TIMESTAMP,
    generateThaiId, JourneyRunner, api, loginHealth, loginProvider, e2eReset, waitMs,
};
