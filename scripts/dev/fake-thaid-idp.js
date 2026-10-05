'use strict';
/**
 * fake-thaid-idp — a STANDALONE dev-only ThaiD (BORA) simulator.
 *
 * WHAT THIS IS: a tiny local OAuth2 server shaped like the DOPA ThaiD
 * endpoints the real adapter talks to (authorize → consent → redirect with
 * code; token exchange → { access_token, id_token }). Point the backend at it
 * via env ONLY — the app has no knowledge of this file, keeping the
 * remove-mock-idp decision intact (no simulated provider inside the product;
 * spec 2026-08-14). The whole PRODUCT flow — login-chooser → BORA-shaped
 * consent → /auth/callback/thaid → state validation → identity link (keyed
 * subject) → MFA gate → cookie → dashboard — runs for real against this.
 *
 * WHAT THIS IS NOT: it is not the sandbox, not a test of BORA's actual
 * contract (that is probe P2 with real T-SBX credentials), and it must NEVER
 * run in production — it refuses to start there.
 *
 * RUN:   node scripts/dev/fake-thaid-idp.js          (port 9210)
 * ENV to point the backend at it (apps/backend .env):
 *   AUTH_THAID_CLIENT_ID=fake-dev-client
 *   AUTH_THAID_CLIENT_SECRET=fake-dev-secret
 *   AUTH_THAID_REDIRECT_URI=http://localhost:3000/auth/callback/thaid
 *   AUTH_THAID_AUTHORIZE_URL=http://localhost:9210/api/v2/oauth2/auth/
 *   AUTH_THAID_TOKEN_URL=http://localhost:9210/api/v2/oauth2/token/
 *   AUTH_THAID_SCOPE=openid pid given_name family_name
 *   (SESSION_SECRET must also be set — see the runbook)
 * The provider state then resolves 'enabled' and the "รอการเชื่อมต่อ" popup
 * disappears because the button IS live.
 *
 * The consent page lets the tester TYPE the 13-digit CID to impersonate, so
 * both flows are exercisable: an existing user's CID (link/match path) and an
 * unknown CID (auto-provision path — requires NODE_ENV=development on the
 * backend, which fail-closes auto-provision in production by design).
 */

if (process.env.NODE_ENV === 'production') {
    console.error('fake-thaid-idp refuses to run with NODE_ENV=production.');
    process.exit(1);
}

const http = require('http');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

const PORT = Number(process.env.FAKE_THAID_PORT || 9210);
const CLIENT_ID = process.env.FAKE_THAID_CLIENT_ID || 'fake-dev-client';
const CLIENT_SECRET = process.env.FAKE_THAID_CLIENT_SECRET || 'fake-dev-secret';

// code -> { cid, redirectUri, issuedAt } ; single-use, 5-minute TTL.
const codes = new Map();
const CODE_TTL_MS = 5 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Unsigned (alg "none"-style) JWT — the backend reads claims off the
 *  backchannel response and does not verify the signature (documented
 *  decision in thaid-identity-service.js). Shape mirrors the manual: sub is
 *  the CID itself; pid + names ride inside the id_token when openid scope is
 *  requested (the two-shape read of Task 4 tolerates either). */
function mintIdToken(cid) {
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
        iss: `http://localhost:${PORT}`,
        sub: cid,
        pid: cid,
        given_name: 'สมชาย',
        family_name: 'ทดสอบระบบ',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
    }));
    return `${header}.${payload}.`;
}

const CONSENT_HTML = (query) => `<!doctype html><html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ThaiD จำลอง (DEV)</title>
<style>
 body{font-family:system-ui,'Segoe UI',sans-serif;background:#0f2557;color:#fff;
      display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
 .card{background:#fff;color:#1a1a2e;border-radius:16px;padding:32px;max-width:420px;width:92%;
       box-shadow:0 8px 40px rgba(0,0,0,.35)}
 .tag{background:#c0392b;color:#fff;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:700}
 h1{font-size:20px;margin:12px 0 4px} p{font-size:14px;color:#555;line-height:1.6}
 input{width:100%;box-sizing:border-box;font-size:18px;letter-spacing:2px;padding:10px 12px;
       border:2px solid #ccd;border-radius:8px;margin:12px 0}
 button{width:100%;background:#16326e;color:#fff;border:0;border-radius:8px;
        padding:12px;font-size:16px;cursor:pointer} button:hover{background:#1e429a}
 .deny{background:none;color:#888;margin-top:8px;font-size:13px}
</style></head><body><div class="card">
 <span class="tag">เครื่องมือ DEV — ไม่ใช่ ThaiD จริง</span>
 <h1>จำลองการยืนยันตัวตน ThaiD</h1>
 <p>ใส่เลขบัตรประชาชน 13 หลักที่ต้องการ "สวมบทบาท" แล้วกดยินยอม — ระบบจะพาไปที่
    callback ของแอปเหมือน BORA ตัวจริงทุกขั้น</p>
 <form method="POST" action="/consent">
  ${['response_type', 'client_id', 'redirect_uri', 'scope', 'state']
        .map((k) => `<input type="hidden" name="${k}" value="${(query.get(k) || '').replace(/"/g, '&quot;')}">`)
        .join('')}
  <input name="cid" inputmode="numeric" pattern="\\d{13}" maxlength="13" required
         placeholder="เลขบัตรประชาชน 13 หลัก" autofocus>
  <button type="submit" name="decision" value="allow">ยินยอม (จำลอง)</button>
  <button type="submit" name="decision" value="deny" class="deny">ปฏิเสธ — ทดสอบเส้น error</button>
 </form>
</div></body></html>`;

function readBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => resolve(raw));
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    console.log(`${req.method} ${url.pathname}${url.search ? '?…' : ''}`);

    // ---- authorize: render the consent page (GET, like BORA's hosted page)
    if (req.method === 'GET' && url.pathname.replace(/\/$/, '') === '/api/v2/oauth2/auth') {
        if (url.searchParams.get('client_id') !== CLIENT_ID) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('unknown client_id — check AUTH_THAID_CLIENT_ID matches the fake server');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(CONSENT_HTML(url.searchParams));
    }

    // ---- consent decision → 302 back to the app's redirect_uri
    if (req.method === 'POST' && url.pathname === '/consent') {
        const form = new URLSearchParams(await readBody(req));
        const redirectUri = form.get('redirect_uri');
        const state = form.get('state') || '';
        if (!redirectUri) { res.writeHead(400); return res.end('missing redirect_uri'); }
        const back = new URL(redirectUri);
        if (form.get('decision') !== 'allow') {
            back.searchParams.set('error', 'user_denied');
            back.searchParams.set('error_description', 'ผู้ใช้ปฏิเสธการยินยอม (จำลอง)');
            back.searchParams.set('state', state);
            res.writeHead(302, { Location: back.toString() });
            return res.end();
        }
        const cid = (form.get('cid') || '').trim();
        if (!/^\d{13}$/.test(cid)) { res.writeHead(400); return res.end('CID must be 13 digits'); }
        const code = `devcode_${crypto.randomBytes(12).toString('hex')}`;
        codes.set(code, { cid, redirectUri, issuedAt: Date.now() });
        back.searchParams.set('code', code);
        back.searchParams.set('state', state);
        res.writeHead(302, { Location: back.toString() });
        return res.end();
    }

    // ---- token exchange: Basic auth + form body, single-use code
    if (req.method === 'POST' && url.pathname.replace(/\/$/, '') === '/api/v2/oauth2/token') {
        const auth = req.headers.authorization || '';
        const expected = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
        if (auth !== expected) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'invalid_client' }));
        }
        const form = new URLSearchParams(await readBody(req));
        const entry = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        if (!entry || Date.now() - entry.issuedAt > CODE_TTL_MS
            || entry.redirectUri !== form.get('redirect_uri')
            || form.get('grant_type') !== 'authorization_code') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'invalid_request' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            access_token: `devaccess_${crypto.randomBytes(12).toString('hex')}`,
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: mintIdToken(entry.cid),
        }));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('fake-thaid-idp: unknown route');
});

server.listen(PORT, () => {
    console.log(`fake-thaid-idp (DEV ONLY) listening on http://localhost:${PORT}`);
    console.log('authorize:', `http://localhost:${PORT}/api/v2/oauth2/auth/`);
    console.log('token:    ', `http://localhost:${PORT}/api/v2/oauth2/token/`);
});
