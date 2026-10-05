#!/usr/bin/env node
/**
 * Agent F2 — Frontend Provider Pages
 * Tests: SSR page accessibility for provider portal
 * Validates HTTP 200/302 on all major provider pages
 */
const { JourneyRunner, waitMs } = require('./journey-helper');
const https = require('https');

const BASE = process.argv[2] || 'https://gacpth.com';
const agent = new https.Agent({ rejectUnauthorized: false });

async function fetchPage(url) {
    try {
        const res = await fetch(url, { agent, redirect: 'manual' });
        return { status: res.status, ok: res.status >= 200 && res.status < 400 };
    } catch (err) {
        return { status: 0, ok: false, error: err.message };
    }
}

async function main() {
    const j = new JourneyRunner('Agent F2 — Frontend Provider', '🖥️');
    console.log(`\n ${j.name}\n`);

    const pages = [
        { name: 'Provider login',         path: '/provider/login' },
        { name: 'Provider home',          path: '/provider' },
        { name: 'Provider dashboard',     path: '/provider/dashboard' },
        { name: 'Applications list',      path: '/provider/applications' },
        { name: 'Audits list',            path: '/provider/audits' },
        { name: 'Certificates',           path: '/provider/certificates' },
        { name: 'Accounting',             path: '/provider/accounting' },
        { name: 'Receipts',               path: '/provider/receipts' },
        { name: 'Analytics',              path: '/provider/analytics' },
        { name: 'Calendar',               path: '/provider/calendar' },
        { name: 'Settings',               path: '/provider/settings' },
        { name: 'Public trace page',      path: '/trace' },
    ];

    for (const page of pages) {
        const res = await fetchPage(`${BASE}${page.path}`);
        if (res.ok || res.status === 302 || res.status === 307) {
            j.pass(page.name, `HTTP ${res.status}`);
        } else {
            j.fail(page.name, `HTTP ${res.status}${res.error ? ' — ' + res.error : ''}`);
        }
        await waitMs(200);
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
