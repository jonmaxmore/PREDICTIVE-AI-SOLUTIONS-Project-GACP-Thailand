# ThaID (DOPA/BORA) Sandbox Smoke — Operator Runbook

**Audience**: operator running the FIRST real round-trip against the official ThaID sandbox
(`imauthsbx.bora.dopa.go.th`) on the Phase-0 laptop stack (node + Supabase, no Docker).

**Status as of 2026-08-19**: backend adapter/routes/identity-service are code-complete and unit-tested
(Tasks 1-4 of design note 2026-08-19-thaid-sandbox-readiness), but **no sandbox call has
ever been made** — this is that first call. Design record (binding council rulings R-A/R-B/R-C/R-D):
design note 2026-08-19-thaid-sandbox-readiness-design.

---

## 0. โหมดจำลอง (DEV) — validate OUR code before you ever touch the real sandbox

`scripts/dev/fake-thaid-idp.js` is a standalone, dev-only BORA-shaped OAuth2 server (authorize → consent →
redirect-with-code → token exchange). The product has zero knowledge of it — it is wired in purely through
env, the same way the real sandbox will be (design note 2026-08-14-remove-mock-idp-design
§5`: no simulated provider ever lives inside the registry itself). Point `AUTH_THAID_*` at it and every leg
of the REAL flow runs for real against it: login-chooser → authorize-url → BORA-shaped consent page →
`/auth/callback/thaid` → state validation → identity link (keyed subject) → MFA gate (if enrolled) →
session cookie → dashboard.

**Run it** (refuses to start with `NODE_ENV=production` — dev/test only):

```powershell
node scripts/dev/fake-thaid-idp.js
# fake-thaid-idp (DEV ONLY) listening on http://localhost:9210
```

**Point the backend at it** — 6 lines in `apps/backend/.env` (values are the fixture's own hardcoded dev
defaults, printed in the script's header comment — fake credentials, not secrets, safe to keep in a
git-ignored `.env`):

```
AUTH_THAID_CLIENT_ID=fake-dev-client
AUTH_THAID_CLIENT_SECRET=fake-dev-secret
AUTH_THAID_REDIRECT_URI=http://localhost:3000/auth/callback/thaid
AUTH_THAID_AUTHORIZE_URL=http://localhost:9210/api/v2/oauth2/auth/
AUTH_THAID_TOKEN_URL=http://localhost:9210/api/v2/oauth2/token/
AUTH_THAID_SCOPE=openid pid given_name family_name
```

`SESSION_SECRET` (§1 below, "the other 2 vars this smoke needs") must also be set — the authorize-url and
callback routes both fail closed without it regardless of which IdP is configured.

**The flow**: open `http://localhost:3000/auth`, click ThaID. The fake server's consent page is a plain
HTML form — type ANY 13-digit CID you want to "wear" and press "ยินยอม (จำลอง)" to continue as that
citizen (exercises both the existing-link/match path for a CID already in the database, and the
auto-provision path for one that is not — auto-provision additionally requires the BACKEND's own
`NODE_ENV=development`, per §2 below). Press "ปฏิเสธ — ทดสอบเส้น error" instead to walk the denial leg: the
fake server redirects back with `error=user_denied` (`scripts/dev/fake-thaid-idp.js:136` — not verbatim the
same code string BORA itself would send, since no real denial has ever been observed to confirm it against;
left unchanged per this task's scope — lint-only on that file). The callback page's `BORA_OAUTH_ERROR_MAP`
has no entry for that exact string, so `resolveErrorCode` falls through to its generic
"เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" card rather than the ThaID-specific "คุณยกเลิก..." copy — still a
graceful, correctly-routed error card, just not the most specific wording. Confirming the EXACT string BORA
sends on a real denial is one more thing probe P2 (§4) settles, not this mode.

**What this proves, and what it does NOT prove** — read this before drawing any conclusion from a green
run:

> โหมดนี้พิสูจน์ว่าโค้ดของเราเองเดินได้ครบวงจรจริง (ไม่ใช่แค่ mock ระดับ unit test) แต่**ไม่ใช่** probe P2
> ไม่ได้พิสูจน์ความเข้ากันได้กับ BORA ตัวจริงแม้แต่น้อย (รูปแบบ token ชื่อฟิลด์ พฤติกรรม error TLS/cert จริง
> ทั้งหมดเป็นของจำลองเอง) การเดินสำเร็จกับตัวจำลองนี้จึงไม่ใช่หลักฐานว่าระบบพร้อมสำหรับ sandbox จริง probe P2
> ในทะเบียนของกรมการปกครองด้วย T-SBX credentials (§1-§4 ด้านล่าง) ยังคงเป็นข้อกำหนดบังคับก่อนจะเคลมความเข้ากันได้
> กับ BORA ได้จริง

In one line: this mode is a REAL round-trip through our own code, but the IdP on the other end is ours, not
DOPA's — it can prove our side works and can never prove BORA's side agrees with what our adapter assumes.

**T6 note (operator directive 2026-08-19)**: since this task, the ThaID and Health ID (หมอพร้อม) buttons on
`/auth` are always pressable regardless of the registry's `coming_soon`/`unknown` state — clicking always
fires the real `authorize-url` call; only a genuinely not-ready backend answer renders an honest Thai
message on the card. This dev-sim mode is unaffected by that change (thaid is `enabled` once the 6 vars
above are set, so it takes the same redirect path an always-enterable click always attempts) — it changes
what happens when the vars above are NOT yet set, not this walkthrough.

---

## 1. Prerequisites — transcribe sandbox creds, never commit them

The shared sandbox credentials (api_key / client_id / client_secret / basic_token) are printed on
**T-SBX p.19** (`evidence/AUTH-01/manual-citations.md:157-158`). That manual is operator-held and marked
"ห้ามทำสำเนาหรือพิมพ์เผยแพร่" — do NOT copy the values into this repo, a report, or a commit (Law L2).
Type them directly into `apps/backend/.env` (git-ignored) and nowhere else.

### The 6 REQUIRED `AUTH_THAID_*` vars (`config/auth-providers.js` `REQUIRED_ENV.thaid`, verified at HEAD)

| Var | Sandbox value | Citation |
|---|---|---|
| `AUTH_THAID_CLIENT_ID` | from T-SBX p.19 | manual-citations.md:157-158 |
| `AUTH_THAID_CLIENT_SECRET` | from T-SBX p.19 | manual-citations.md:157-158 |
| `AUTH_THAID_REDIRECT_URI` | `http://localhost:3000/auth/callback/thaid` | shared sandbox creds accept ANY redirect_uri (manual-citations.md:158, T-SBX §9) |
| `AUTH_THAID_AUTHORIZE_URL` | `https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/auth/` | manual-citations.md:111 |
| `AUTH_THAID_TOKEN_URL` | `https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/token/` | manual-citations.md:112 |
| `AUTH_THAID_SCOPE` | `openid pid given_name family_name` | recommended — see note below |

### Optional (no longer required — Task 4 demoted it)

`AUTH_THAID_INTROSPECT_URL` — `https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/introspect/`
(manual-citations.md:113) if you want it set for a future `getProfile()` caller; the login flow
(`resolveThaidSession`, `apps/backend/routes/api/auth/auth-idp.js`) never calls introspect, so leaving it
unset does not block `thaid` from resolving `enabled`.

### Scope note (two BORA wire shapes — Task 4 tolerates both)

`AUTH_THAID_SCOPE="openid pid given_name family_name"` — with `openid` requested, `pid`/`given_name`/
`family_name` arrive INSIDE the `id_token` instead of top-level on the token response (§6.2.2 "**" note,
manual-citations.md:134-135). `apps/backend/services/auth/thaid-identity-service.js`'s
`decodeIdTokenClaims` + `apps/backend/routes/api/auth/auth-idp.js:247-251` read the id_token first and
fall back to top-level fields, so either shape resolves — record which one BORA's sandbox actually sends
(§4 below, O3).

### The other 2 vars this smoke needs (not ThaID-specific)

```
SESSION_SECRET=<openssl rand -hex 32>     # apps/backend/.env — signs idp_state; see apps/backend/.env.example
```

```
NEXT_PUBLIC_BACKEND_ORIGIN=http://localhost:8000
```
set in the environment `pnpm --filter web-app dev` runs in (there is no `apps/web-app/.env.example` today —
the default baked into `apps/web-app/src/lib/api/idp-client.ts:28` is already `http://localhost:8000`, so
this line is only needed if the backend runs on a different port).

---

## 2. Stack — NODE_ENV=development is REQUIRED

`resolveThaidLogin`'s auto-provision branch (`apps/backend/services/auth/thaid-identity-service.js:245-250`)
throws `AUTH_AUTOPROVISION_DISABLED` when `isProduction()` (`config/auth-providers.js:87-89`,
`NODE_ENV==='production'`) is true. The sandbox smoke needs auto-provision live for a fresh citizen
(no existing user/link yet), so the stack MUST run with `NODE_ENV=development`.

Bring up the laptop node+Supabase stack per the Phase-0 convention (detached processes, warm the routes
before the first real click):

```powershell
$env:NODE_ENV = "development"
pnpm --filter gacp-backend dev        # http://localhost:8000
```

```powershell
pnpm --filter web-app dev             # http://localhost:3000
```

Smoke the backend is up before touching the browser:

```powershell
Invoke-RestMethod http://localhost:8000/api/auth/idp/providers
# Expect: data.providers includes {"key":"thaid","state":"enabled","enabled":true}
# If state resolves "coming_soon" instead, one of the 6 REQUIRED vars is
# missing/empty — isConfigComplete() in config/auth-providers.js fails closed.
```

---

## 3. C1 sequence — HMAC backfill + flag flip (operator-run; council ruling R-C)

Run from the **repo root** (the script's own usage header documents this path, not a relative
`scripts/...` from inside `apps/backend`).

**Load the env first — the script hard-exits without it.** Unlike the backend server
(`apps/backend/server.js:9` — `require('dotenv').config(...)`), this is a standalone `node` invocation:
nothing loads `.env` for it. Its require chain needs `DATABASE_URL`
(`apps/backend/services/prisma-database.js:46-56` — hard `process.exit(1)` when unset outside test) and
`ENCRYPTION_KEY` (`apps/backend/utils/field-encryption.js` — required by `computeLookupHmac`, the same
function `AUTH_LOOKUP_HMAC_KEY` optionally overrides for; leave that one unset unless you know you need
it). The repo-root `.env` is the SAME file the rest of the stack already reads for these values (the
laptop stack's `pnpm dev` process picks it up the same way) — load it into THIS PowerShell session before
running the script, without ever printing a value:

```powershell
Get-Content .env | ForEach-Object {
    if ($_ -match '^(DATABASE_URL|ENCRYPTION_KEY|AUTH_LOOKUP_HMAC_KEY)=(.*)$') {
        Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
    }
}
Write-Host "Loaded DATABASE_URL/ENCRYPTION_KEY into this session from the repo-root .env (values not shown)."
```

Then:

```powershell
node apps/backend/scripts/backfill-national-id-hmac.js --dry-run
```

The 2026-08-19 dry-run was already clean: **34/6/40 candidates across the 3 populated columns
(healthId/idCard/communityRegistrationNo), 0 errors, 0 null-source** (spec §Council rulings, probe P3).
If a fresh dry-run today reproduces that (0 `UNIQUE_CONFLICT`, 0 errors), proceed:

```powershell
node apps/backend/scripts/backfill-national-id-hmac.js
```

Confirm the script's own final assertion held (`assertion.held: true`, meaning 0 ACTIVE rows are still
missing a `*Hmac` — the script exits non-zero and prints `ASSERTION FAILED` otherwise; do NOT proceed past
a non-zero exit). Only then flip the flag (L6 — flag flips are an operator action) in `apps/backend/.env`:

```
AUTH_LOOKUP_USE_HMAC=true
```

and restart the backend process (env is read at boot, not live-reloaded).

### KEY-ROTATION WARNING (read before rotating anything)

`thaidSubjectKey(sub) = computeLookupHmac('idp:thaid:' + sub)` (`thaid-identity-service.js:142-144`) derives
its key from `AUTH_LOOKUP_HMAC_KEY` if set, else falls back to `ENCRYPTION_KEY`
(`apps/backend/utils/field-encryption.js:197-208`). **Rotating either key changes the HMAC output for the
same plaintext**, which orphans every `identity_links` row already written for ThaID subjects — the stored
`subject` no longer matches what a re-derivation of the same `sub` produces. The only recovery path is the
CID re-match branch in `resolveThaidLogin` (step 3, `thaid-identity-service.js:227-239`, matches on
`nationalId` via the SAME `computeLookupHmac`).

**Correction (final-fix round — the earlier wording here was wrong):** that re-match branch does **not**
read `AUTH_LOOKUP_USE_HMAC` at all — it unconditionally queries `users.idCardHmac`/`healthIdHmac`
(`thaid-identity-service.js:228-234`, no flag check anywhere in that function). `AUTH_LOOKUP_USE_HMAC`
governs whether the REST of the platform (registration, password login — `prisma-auth-service.js`,
`provider-user-service.js`, etc.) writes and reads those `*Hmac` columns at all; it does not gate this
specific recovery path. The actual requirement for the CID re-match to work is simpler and narrower: the
`users.*Hmac` columns must already be **backfilled** for the citizen in question (§3 above) — the flag can
be off and the re-match still succeeds, but an un-backfilled row (a NULL `*Hmac`) will never match
regardless of the flag. **Do not rotate `ENCRYPTION_KEY` or `AUTH_LOOKUP_HMAC_KEY` before confirming the
backfill is complete (§3's assertion held), or ThaID logins for already-linked citizens break with no
fallback.**

---

## 4. Probe P2 checklist — gates council ruling R-B

This is the checklist that decides whether R-B (direct-origin transport, proxy untouched) holds, or whether
its own conditional fires. Walk it in order; STOP at the first failure.

1. Open `http://localhost:3000/auth` → click the ThaID entrance. DevTools → Network: confirm
   `POST http://localhost:8000/api/auth/idp/thaid/authorize-url` returns `data.authorizeUrl`, and the
   response sets a `Set-Cookie: idp_state=...` (DevTools → Application → Cookies → `localhost`, host-scoped
   so port is irrelevant).
2. Browser follows `authorizeUrl` to BORA's sandbox site (T-SBX §8: a web page that stands in for the ThaID
   app — you can edit the national ID it presents, other fields are fixed). Complete it.
3. BORA 302-redirects to `AUTH_THAID_REDIRECT_URI` — confirm the callback page
   (`apps/web-app/src/app/auth/callback/[provider]/page.tsx`, route `/auth/callback/thaid`) actually loads
   (not a 404 — this is exactly the leg that had no FE page before Task 1).
4. DevTools → Network: confirm the page's `POST http://localhost:8000/api/auth/idp/thaid/callback`
   request carries the `idp_state` cookie set in step 1 (Request Headers → Cookie).
5. On success, confirm `Set-Cookie: auth_token=...` on the callback response — **not** `provider_token`.
   Final-fix round Item 1: the cookie SLOT is chosen by the resolved user's role
   (`routes/api/auth/auth-idp.js`, mirrors `routes/api/identity/mfa.js:548-550`), and every citizen ThaID
   resolves through here is a HEALTH account (`assertAutoProvisionableRole` in `thaid-identity-service.js`
   rejects anything else) — so `auth_token` is the ONLY correct cookie name for this walk. Seeing
   `provider_token` here instead means the fix regressed; STOP and report it.
6. **The decisive leg — do not skip this one.** A `Set-Cookie` header alone does not prove the citizen is
   actually logged in: confirm the browser lands on and RENDERS `http://localhost:3000/health/dashboard`
   (not bounced back to `/auth/health/login`). This is exactly the failure mode Item 1 fixes — before it, a
   non-MFA citizen got a `Set-Cookie: provider_token=...` that step 5 above would have shown as "present",
   yet the Next middleware (`middleware.ts:172-185`, which checks `auth_token` for `/health/*`) still
   redirected the browser straight back to login. Set-Cookie present is necessary but NOT sufficient —
   the dashboard actually rendering is the proof.
7. Confirm a SUBSEQUENT request through the Next proxy (`/api/...` on port 3000 — anything the post-login
   dashboard calls) authenticates using that cookie (the existing proxy's cookie→Bearer conversion, which
   this task does NOT touch).
8. Record which token shape BORA actually returned: did `pid`/`given_name`/`family_name` arrive inside the
   `id_token`, top-level on the token response, or both? Confirm `sub == CID` (O3, the id_token's `sub`
   claim should equal the national ID you entered in step 2).

**If ANY leg fails → STOP. Record exactly which leg and what was observed.** Per the council's own
conditional, a P2 failure automatically makes **B2 the ruling**: fixing the universal proxy
(`apps/web-app/src/app/api/[...path]/route.ts`) to forward `Cookie`/`Set-Cookie` in both directions — its
own Tier C mission, RED-first across all 10 cookie consumers, out of scope for this runbook.

---

## 5. Evidence — capture the first successful round-trip

`evidence/AUTH-THAID/` currently holds only `INDEX.md` — a 2026-08-06 qc-evidence audit-of-absence (it
documents that NO evidence pack has ever existed for the ThaID login UI; it is not itself a pack). No
actual round-trip evidence (trace/video/screenshot/test-output) has ever been captured. Capture a view-pack
of the P2 walk-through under `evidence/AUTH-THAID/` per the project rules §5 (view-in-the-loop) — screenshots or
video of steps 1-6 above, plus the DevTools cookie views, are the artifact an operator can trust without
reading code.

---

## 6. The standing gate — repeat this line in every ThaID evidence pack until it's false

> การเดินจริงของเกษตรกรผ่าน proxy :3000 ยังไม่พิสูจน์ จนกว่า route.ts จะส่งต่อ Cookie/Set-Cookie
> (งาน Tier C แยก)

This smoke test proves the DIRECT-origin leg (browser → :8000). It does NOT prove a farmer's ordinary
session — everything else in the app — flows correctly through the `:3000` proxy for a ThaID-originated
cookie, because R-B deliberately routed around that proxy rather than fixing it. Step 7 above only confirms
the proxy's EXISTING cookie→Bearer conversion still works for an `auth_token` (or `provider_token`, for a
provider-role account) regardless of which login surface minted it; it is not a proof that the proxy
forwards `Set-Cookie` in the other direction.

---

## 7. MFA note (R-A) — test both a plain citizen and, if available, a 2FA-enrolled account

Since Task 2, a user with `twoFactorEnabled=true` gets the SAME `mfa_required`/`mfa_session` challenge via
ThaID that the password path returns (`prisma-auth-service.js` `issueTokensForAuthenticatedUser`, gate at
`:491-505`) — no bypass. The smoke should exercise:

- **A plain citizen** (no 2FA enrolled, likely the auto-provisioned case in §4 above) — expect a direct
  `auth_token` cookie (Item 1 — HEALTH-role cookie slot, not `provider_token`), no MFA screen.
- **A TOTP-enrolled account**, if one is available to link via ThaID (existing-link branch,
  `thaid-identity-service.js:214-225`, which now applies the SAME role/2FA gate as a fresh match) — expect
  the callback page's `mfa` view (`client-view.tsx` `ViewState.kind === 'mfa'`) to render
  `MfaChallengeForm`, and completing it to land on the dashboard exactly like the password-login MFA path.

TOTP is the only second factor since 2026-09-15 (merge `00bb27b8`, `apps/backend/shared/second-factor.js`
`hasUsableSecondFactor`) — production auth converges on ThaID + หมอพร้อม (Health ID) only. A legacy account
still marked with the retired `EMAIL` method is treated as *not enrolled*, not as a challengeable factor —
an EMAIL-method MFA challenge should NOT surface in this smoke; if it does, that is a regression to report,
not an expected path.
