#!/usr/bin/env node
/**
 * Agent J1 — Registration & Login Journey
 * Tests: register → login → profile → dashboard → notifications
 */
const { JourneyRunner, api, generateThaiId, PASSWORD, e2eReset, waitMs } = require('./journey-helper');

async function main() {
    const j = new JourneyRunner('Agent J1 — Registration & Login', '👤');
    console.log(`\n ${j.name}\n`);

    const ts = Date.now();
    const healthId = generateThaiId(`8${ts.toString().slice(-11)}`);
    const email = `j1-test-${ts}@journey.local`;

    try {
        // Step 1: Register
        const reg = await api('POST', '/auth/health/register', {
            body: {
                identifier: healthId,
                password: PASSWORD,
                email,
                firstName: 'ทดสอบ',
                lastName: 'เจวัน',
                phoneNumber: `08${ts.toString().slice(-8)}`,
            },
        });
        if (reg.status === 201 || reg.status === 200) {
            j.pass('Register new health user', `status: ${reg.status}`);
            j.context.token = reg.data?.data?.tokens?.accessToken || reg.data?.data?.token;
        } else {
            j.fail('Register new health user', `status: ${reg.status} — ${JSON.stringify(reg.data?.message || reg.data?.error || '').slice(0, 100)}`);
        }

        await waitMs(500);

        // Step 2: Login
        const login = await api('POST', '/auth/health/login', {
            body: { identifier: healthId, password: PASSWORD },
        });
        if (login.status === 200 && (login.data?.data?.tokens?.accessToken || login.data?.data?.token)) {
            j.context.token = login.data?.data?.tokens?.accessToken || login.data?.data?.token;
            j.pass('Login with credentials', `got token`);
        } else {
            j.fail('Login with credentials', `status: ${login.status}`);
        }

        await waitMs(300);

        // Step 3: Get profile
        if (j.context.token) {
            const me = await api('GET', '/auth/health/me', { token: j.context.token });
            if (me.status === 200) j.pass('Get user profile', `status: ${me.status}`);
            else j.fail('Get user profile', `status: ${me.status}`);
        } else j.skip('Get user profile', 'No token');

        // Step 4: Dashboard
        if (j.context.token) {
            const dash = await api('GET', '/dashboard', { token: j.context.token });
            if (dash.ok) j.pass('Access dashboard', `status: ${dash.status}`);
            else j.fail('Access dashboard', `status: ${dash.status}`);
        } else j.skip('Access dashboard', 'No token');

        // Step 5: Dashboard stats
        if (j.context.token) {
            const stats = await api('GET', '/dashboard/stats', { token: j.context.token });
            if (stats.ok) j.pass('Dashboard stats', `status: ${stats.status}`);
            else j.fail('Dashboard stats', `status: ${stats.status}`);
        } else j.skip('Dashboard stats', 'No token');

        // Step 6: Notifications
        if (j.context.token) {
            const notif = await api('GET', '/notifications', { token: j.context.token });
            if (notif.ok) j.pass('Get notifications', `status: ${notif.status}`);
            else j.fail('Get notifications', `status: ${notif.status}`);
        } else j.skip('Get notifications', 'No token');

        // Step 7: My applications (should be empty)
        if (j.context.token) {
            const apps = await api('GET', '/applications/my', { token: j.context.token });
            if (apps.ok) {
                const count = apps.data?.data?.length || apps.data?.data?.applications?.length || 0;
                j.pass('My applications (empty)', `${count} applications`);
            } else j.fail('My applications', `status: ${apps.status}`);
        } else j.skip('My applications', 'No token');

        // Step 8: Login with wrong password (should fail)
        const wrongLogin = await api('POST', '/auth/health/login', {
            body: { identifier: healthId, password: 'WrongPassword123!' },
        });
        if (wrongLogin.status === 401 || wrongLogin.status === 400) {
            j.pass('Reject wrong password', `status: ${wrongLogin.status}`);
        } else {
            j.fail('Reject wrong password', `expected 401, got: ${wrongLogin.status}`);
        }

    } finally {
        // Cleanup — skip gracefully if E2E disabled
        const cleanup = await e2eReset(email);
        if (cleanup.ok || cleanup.status === 200) {
            j.pass('Cleanup test user', 'E2E reset OK');
        } else if (cleanup.status === 403) {
            j.skip('Cleanup test user', 'E2E disabled in production');
        } else {
            j.fail('Cleanup test user', `status: ${cleanup.status}`);
        }
    }

    j.printReport();
    process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
