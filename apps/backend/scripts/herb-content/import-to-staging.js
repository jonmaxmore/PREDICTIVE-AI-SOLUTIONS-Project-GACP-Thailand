'use strict';

/**
 * ต้นแบบที่ 5 (ก) — นำเข้าชุดข้อมูลอ้างอิงสมุนไพร (AI_DRAFT) เข้าฐานผ่าน API จริง.
 *
 * ใช้ endpoint จริง: provider-admin login → client-minted CSRF (double-submit) →
 * POST /api/herbs/:code/entries/import → GET /api/herbs/coverage เพื่อพิสูจน์ KPI
 * ≥300/ฐาน.
 *
 * ปลายทาง = STAGING เท่านั้น (ข้อมูลเป็นร่าง AI ที่ต้องให้ SSRU ตรวจก่อน).
 * ห้ามชี้ base ไป production. Idempotency guard: ข้ามฐานที่ count ≥ target อยู่แล้ว
 * เพื่อกัน double-import ตอนรันซ้ำ.
 *
 * usage:
 *   node import-to-staging.js <assembledDir> <baseUrl> <providerId> <password>
 *   e.g. node import-to-staging.js .../assembled https://staging.gacpth.com 2900000000009 Test@12345
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CODES = ['CANNABIS', 'TURMERIC', 'GINGER', 'BLACK_GALINGALE', 'PLAI', 'KRATOM'];

function parseCookies(setCookieArr) {
    const jar = {};
    for (const line of (setCookieArr || [])) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) { jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim(); }
    }
    return jar;
}
function cookieHeader(jar) { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }

async function main() {
    const [assembledDir, baseUrl, providerId, password] = process.argv.slice(2);
    if (!assembledDir || !baseUrl || !providerId || !password) {
        throw new Error('usage: node import-to-staging.js <assembledDir> <baseUrl> <providerId> <password>');
    }
    if (/gacpth\.com$/.test(new URL(baseUrl).hostname) && !/staging/.test(new URL(baseUrl).hostname)) {
        throw new Error(`SAFETY: refusing non-staging gacpth.com host "${baseUrl}" — AI_DRAFT content is staging-only until SSRU review`);
    }

    // 1) provider-admin login
    const loginRes = await fetch(`${baseUrl}/api/auth/provider/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, password }),
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok) { throw new Error(`login failed ${loginRes.status}: ${JSON.stringify(loginBody)}`); }
    const jar = parseCookies(loginRes.headers.getSetCookie());
    // 2) client-minted CSRF double-submit token
    const csrf = crypto.randomBytes(24).toString('hex');
    jar.csrf_token = csrf;
    const authHeaders = () => ({
        'Content-Type': 'application/json',
        'Cookie': cookieHeader(jar),
        'x-csrf-token': csrf,
    });
    console.log(`login OK as ${providerId} (role=${loginBody?.data?.user?.role || loginBody?.user?.role || '?'})`);

    const cov0 = await (await fetch(`${baseUrl}/api/herbs/coverage`)).json();
    console.log(`coverage before: total=${cov0.data.totalEntries}`);

    // 3) idempotent per-herb: clear existing AI_DRAFT rows, then import fresh set.
    for (const code of CODES) {
        const file = path.join(assembledDir, `${code}.json`);
        const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

        // 3a) list + delete existing AI_DRAFT rows (paginate; keep starter seeds)
        let deleted = 0;
        for (let page = 1; page <= 20; page++) {
            const listRes = await fetch(`${baseUrl}/api/herbs/${code}/entries?page=${page}&pageSize=200`);
            const listBody = await listRes.json().catch(() => ({}));
            const arr = (listBody.data && Array.isArray(listBody.data.entries)) ? listBody.data.entries : [];
            if (arr.length === 0) { break; }
            const drafts = arr.filter(e => typeof e.source === 'string' && e.source.startsWith('AI_DRAFT'));
            for (const e of drafts) {
                const del = await fetch(`${baseUrl}/api/herbs/${code}/entries/${e.id}`, { method: 'DELETE', headers: authHeaders() });
                if (del.ok) { deleted += 1; }
            }
            if (arr.length < 200) { break; }
        }

        // 3b) import fresh
        const res = await fetch(`${baseUrl}/api/herbs/${code}/entries/import`, {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ rows }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { throw new Error(`import ${code} failed ${res.status}: ${JSON.stringify(body)}`); }
        const d = body.data || body;
        const sampleErr = (d.errors || []).slice(0, 2).map(x => x.error).join(' | ');
        console.log(`${code.padEnd(16)} cleared=${deleted} imported=${d.imported} skipped=${d.skipped}${sampleErr ? ' e.g. ' + sampleErr : ''}`);
    }

    // 4) verify coverage ≥300/herb
    const cov = await (await fetch(`${baseUrl}/api/herbs/coverage`)).json();
    console.log('\n=== coverage after import ===');
    for (const h of cov.data.herbs) {
        console.log(`${h.meets300 ? 'OK ' : 'LOW'} ${h.code.padEnd(16)} ${String(h.count).padStart(3)}/${cov.data.target}`);
    }
    console.log(`herbsMeetingTarget=${cov.data.herbsMeetingTarget}/${cov.data.totalHerbs}  totalEntries=${cov.data.totalEntries}`);
    if (cov.data.herbsMeetingTarget !== cov.data.totalHerbs) { process.exitCode = 2; }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
