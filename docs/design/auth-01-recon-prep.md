# AUTH-01-RECON — prep: our assumed OAuth request vs. the real thing

**Status:** recon prep (read-only) — the actual URL-vs-code diff is **BLOCKED(operator:oauth-url)** until the operator sends the real OAuth button query-strings from DTAM Next dev
**Owner:** PM/Security · **Date:** 2026-08-05 · **Source:** read-only research workflow (2 agents, file:line-verified) + `evidence/AUTH-01/manual-citations.md`
**Purpose (brief A):** document what OUR code assumes so the operator's real OAuth URL can be diffed field-by-field, and sharpen the B1-CRED credentials request.

---

## 1. What our code actually implements today (per provider)

| provider | adapter? | enablement | terminal behavior |
|---|---|---|---|
| **Provider ID** (staff) | ✅ real 2-leg HTTP adapter `provider-id-adapter.js` | fail-closed `coming_soon` until all `AUTH_PROVIDERID_*` env set (`auth-providers.js:52-72,111-122`) | after a successful profile fetch, **always 409 `AUTH_LINKING_PENDING`** — no User row created (by design, flag D-MANUAL-HASHCID; test-pinned) (`auth-idp.js:339-349`) |
| **ThaID** (both) | ❌ **no adapter file** — `getIdpAdapter('thaid')` throws `AUTH_PROVIDER_NO_ADAPTER` | env scaffolding only | n/a — cannot run |
| **Health ID** (citizen) | ❌ **no adapter file** — throws | env scaffolding (`AUTH_HEALTHID_*`), no `PROFILE_URL` known | n/a — cannot run |
| **mock** | ✅ deterministic, mirrors Provider ID contract | non-prod only (forced `coming_soon` in prod) | resolves an existing staff record → mints provider session (dev/test/E2E only) |

**So today only Provider ID has a real adapter; Health ID and ThaID are env scaffolding with no code path.** The operator's OAuth URLs will confirm the shapes for all three.

## 2. Our assumed Provider ID OAuth request (the diff target)

The authorize request our code builds (`provider-id-adapter.js:187-202`):

```
GET {AUTH_PROVIDERID_AUTHORIZE_URL}
    ?client_id={AUTH_PROVIDERID_CLIENT_ID}
    &redirect_uri={AUTH_PROVIDERID_REDIRECT_URI}
    &response_type=code
    &state={256-bit random, HMAC-signed idp_state cookie, 10-min TTL, single-use}
```

**We send NO `scope`, NO PKCE (`code_challenge`/`method`), NO `nonce`.** ← the single most important thing to diff against the operator's real button URL: if DTAM Next's URL carries a `scope`, PKCE, or `nonce`, our adapter would need those added.

Token exchange is **two legs** (`provider-id-adapter.js:208-289`):
1. `POST {AUTH_PROVIDERID_TOKEN_URL}` (Health-ID token, form-urlencoded): `grant_type=authorization_code, code, redirect_uri, client_id, client_secret` → reads `data.access_token`.
2. `POST {AUTH_PROVIDERID_TOKEN_EXCHANGE_URL}` (JSON): `{client_id: PID_CLIENT_ID, secret_key, token_by:'Health ID', token:<leg1 token>}` → reads `access_token, account_id`. **Note: a second, separate credential pair** (`PID_CLIENT_ID`/`SECRET_KEY`).
3. `GET {AUTH_PROVIDERID_PROFILE_URL}` (Bearer + `client-id`/`secret-key` headers) → **raw profile, no parsing in the adapter**; the callback reads only `account_id` + `hash_cid` (both required, fail-closed).

## 3. Known (from official manuals) vs. unknown

| provider | confirmed by manual | still unknown / awaiting |
|---|---|---|
| **ThaID** | endpoints (sandbox `imauthsbx.bora.dopa.go.th` + prod), `scope=pid` → **13-digit CID plaintext** (`sub`), Basic-auth token, access_token 15 min, OIDC id_token claims (`manual-citations.md:111-145`). **C1-THAID-DOC CLOSED** | PKCE/nonce/prompt/max_age **not mentioned** (must not implement); refresh_token self-contradictory across manual versions. **B1-CRED open** (no prod client_id/secret). No adapter yet |
| **Provider ID** | endpoints (UAT+prod) for authorize `/oauth/redirect`, token `/api/v1/token`, exchange `/api/v1/services/token`, profile `/api/v1/services/profile` ([P-OAUTH], `manual-citations.md:50-73`); exchange **200 if the holder has a Provider ID, 400 otherwise → matches §D4 "no auto-provision"** by the IdP's own behavior | **`hash_cid` algorithm/salt UNSPECIFIED** — hex-64 SHA-256-shaped but cannot confirm `= sha256(CID)` (**D-MANUAL-HASHCID open** — the one fact gating real linking). **B1-CRED open** |
| **Health ID** (citizen) | authorize + token legs documented ([P-OAUTH]) | **no citizen-facing profile endpoint in the manual** (**BLOCKER-2 open**); no adapter |

## 4. What the operator's OAuth URL / integration will answer (the diff, once unblocked)

1. Does the real Provider ID / Health ID authorize URL **omit `scope`, PKCE, and `nonce`** as our code assumes — or does the live IdP expect any of them? (our adapter currently never sends them)
2. Any extra params on the button URL we don't build (e.g. `acr_values`, `ui_locales`, `prompt`)?
3. For Health ID (citizen): does the real flow reveal a **profile endpoint** (closes BLOCKER-2)?
4. Is **`hash_cid = sha256(CID)`** (closes D-MANUAL-HASHCID)? — needs สธ. confirmation, may not be visible in the URL alone.

## 5. Credentials request (B1-CRED) — how to accelerate

- **C1-THAID-DOC and the Provider ID [P-OAUTH] manual are closed/read** — the credentials request can cite specific endpoints + the confirmed exchange behavior, not just "we need OAuth access".
- **Cite DTAM Next as a working reference integration** — **but only if the operator confirms DTAM Next actually did an OAuth integration with these IdPs** (endpoints/scopes/credential process). ⚠️ **Open question**: was DTAM Next a real OAuth integration, or only a UI/branding reference? If only UI, do **not** cite it as an integration precedent. (operator to confirm)
- The not-yet-created `oauth-registration-status.md` should capture, once approved: production `client_id`/`client_secret`/`secret_key`/`redirect_uri` + registration reference numbers/dates per provider.

## 6. Operator questions this recon surfaces (sharpens the blockers)

- [ ] Send the **real OAuth button URL query-strings** (Health ID / Provider ID) → enables the §4 diff.
- [ ] Confirm **`hash_cid` algorithm** with สธ. (D-MANUAL-HASHCID) — the single fact unblocking real Provider ID linking.
- [ ] Supply the **citizen Health ID manual** / profile endpoint (BLOCKER-2).
- [ ] Confirm whether **DTAM Next did a real OAuth integration** (citable) or was UI-only.
- [ ] Production credentials per provider (B1-CRED).
- [ ] `shared_token`/สยามมณี app-launch handoff — in scope, separate, or withdrawn? (mandate.md:16 vs :17 contradict)

## 7. Note for UI-01 / FE

There is **no OAuth button/redirect on the frontend yet** — the backend authorize-url + callback exist, the FE handoff does not. This matches UI-01 (`docs/design/ui-01-reference.md`) being the phase that builds the OAuth-first login UI. Confirm the FE OAuth work is scoped to UI-01 / a later AUTH-01 phase (not assumed already-present).
