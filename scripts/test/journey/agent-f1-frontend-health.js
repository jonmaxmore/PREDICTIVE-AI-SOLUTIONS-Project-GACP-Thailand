#!/usr/bin/env node
/**
 * Agent F1 — Frontend Health User Pages
 * Tests: SSR page accessibility for health user portal
 * Validates HTTP 200 on all major health user pages
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
    const j = new JourneyRunner('Agent F1 — Frontend Health User', '🖥️');
    console.log(`\n ${j.name}\n`);

    const pages = [
        { name: 'Home / Landing',         path: '/' },
        { name: 'Login page',             path: '/login' },
        { name: 'Register page',          path: '/register' },
        { name: 'Health portal home',     path: '/health' },
        { name: 'Health dashboard',       path: '/health/dashboard' },
        { name: 'Applications list',      path: '/health/applications' },
        { name: 'New Application wizard', path: '/health/applications/new' },
        { name: 'Profile page',           path: '/health/profile' },
        { name: 'Notifications',          path: '/health/notifications' },
        { name: 'Tracking overview',      path: '/health/tracking' },
        { name: 'Certificates page',      path: '/health/certificates' },
    ];

    for (const page of pages) {
        const res = await fetchPage(`${BASE}${page.path}`);
        // 200=rendered, 302/307=redirect (auth required = expected for protected pages)
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
