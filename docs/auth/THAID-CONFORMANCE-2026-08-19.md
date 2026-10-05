# ThaID Conformance Audit — 2026-08-19 (main @ 0b28252b)

> Per-requirement audit: BORA manual extractions (`evidence/AUTH-01/manual-citations.md`, hash-cited from the real T-SBX/T-PRD PDFs) ↔ implementation ↔ test pins. Produced by a read-only adversarial audit; 5 suites / 102 tests re-run green during the audit (`thaid-adapter`, `auth-idp-thaid-session`, `thaid-identity-service`, `auth-idp-routes`, `auth-providers-config`). Supersedes the thaid scope of `docs/auth/OAUTH-ENDPOINT-CONFORMANCE-2026-08-06.md`.
> **Verdict: 0 defects** — no case where the code does something the manual forbids or contradicts a citation the manual actually makes.

## ตารางเทียบรายข้อ

| # | ข้อกำหนดจากคู่มือ | โค้ดเรา | test ที่ pin | VERDICT |
|---|---|---|---|---|
| 1 | Authorize/Token URL §6.1.1/§6.2.1 (citations :111-112) | env-only `AUTH_THAID_AUTHORIZE_URL`/`TOKEN_URL` — auth-providers.js:174-181; adapter ไม่ hardcode (thaid-adapter.js:32-34,141-148) | thaid-adapter.test.js:80-129 | ตรงตามคู่มือ |
| 2 | `response_type=code` (:118) | thaid-adapter.js:142 | :85 | ตรงตามคู่มือ |
| 3 | `client_id`, `redirect_uri` (:119-120) | thaid-adapter.js:143-144 (REQUIRED_ENV) | :86-87 | ตรงตามคู่มือ |
| 4 | `scope` space-separated (:121) | thaid-adapter.js:145, env-driven | :88 | ตรงตามคู่มือ |
| 5 | `state` required (:122, §7) | throws if absent (:127-133); route mints 256-bit HMAC-signed state (auth-idp.js:74-99,459-469) | adapter :94-97; routes :251-284 | ตรงตามคู่มือ (เข้มกว่า) |
| 6 | Callback `?code&state` / `?error&error_description` (:124-126) | FE client-view.tsx:184-204 | idp-callback-page.test.tsx | ตรงตามคู่มือ |
| 7 | Token: `Basic base64(id:secret)`, creds ห้ามอยู่ใน body (:128-129) | thaid-adapter.js:165-175; body มีแค่ grant_type/code/redirect_uri | :102-129 (รวม `form.has('client_id')===false`) | ตรงตามคู่มือ |
| 8 | Token fields รวมชื่อ non-standard `expire_in` (:133) | อ่าน `body.expire_in` ตรงตามคู่มือ (:191-198) | :131-141 | ตรงตามคู่มือ |
| 9 | no-openid→top-level; openid→claims ใน id_token (:135) | id_token-first + top-level fallback (auth-idp.js:253-265; decodeIdTokenClaims) | routes :593-650 (3 shapes) | ตรงตามคู่มือ (ความกำกวมจดไว้ รอ sandbox) |
| 10 | id_token claims sub/aud/exp/iat/iss/at_hash (:136) | อ่านเฉพาะ sub/pid/given_name/family_name; ไม่ enforce aud/exp/iss (สอดคล้อง #11) | — | คู่มือกำกวม — รอ sandbox |
| 11 | id_token เป็น JWS verify ได้ผ่าน .well-known (:115,135) | จงใจไม่ verify — trust model = backchannel TLS + client-secret (thaid-identity-service.js:64-67) | — | จงใจต่าง จดเหตุผลแล้ว |
| 12 | §7 `401 user_denied` (:126) | → AUTH_IDP_ACCESS_DENIED (:90-96) | :153-158 | ตรงตามคู่มือ |
| 13 | §7 error อื่นๆ (invalid_client/invalid_scope/invalid_request/5xx) — คู่มือที่ถอดมา cite ตรงเฉพาะ user_denied | จัดการเป็น OAuth2 มาตรฐาน (:83-119) | :146-184 | คู่มือกำกวม — สมมุติ vocabulary มาตรฐาน รอ sandbox ยืนยัน string จริง |
| 14 | Introspect §6.3 (:113,138-139) | `getProfile()` มีแต่ไม่ถูกเรียกบนเส้น login (by design); INTROSPECT_URL ปลดจาก REQUIRED (auth-providers.js:71-76) | — | จงใจไม่ทำ จดเหตุผลแล้ว |
| 15 | Revoke §6.4 (:114,140) | ไม่ทำ — logout ยกเลิก session ของ GACP เอง ไม่ใช่ access_token 15 นาทีของ BORA | — | จงใจไม่ทำ จดเหตุผลแล้ว |
| 16 | PKCE ไม่มีในคู่มือทั้งสองเล่ม (:150) | ไม่ส่ง code_challenge (grep ยืนยัน) | — | จงใจไม่ทำ ตามกติกา "ทำตามเอกสารเท่านั้น" |
| 17 | nonce ไม่มีในคู่มือ (:151) | ไม่ส่ง; replay กันด้วย single-use state | routes :332-357 | จงใจไม่ทำ จดเหตุผลแล้ว |
| 18 | refresh_token — คู่มือขัดแย้งตัวเอง (:153) | ไม่ทำ; session TTL ของเราแยกจาก expire_in ของ ThaID | — | จงใจไม่ทำ จดเหตุผลแล้ว |
| 19 | state = "random string" (:154) | 256-bit (STATE_BYTES=32) | routes :251-263 | ตรงตามคู่มือ (เข้มกว่า) |
| 20 | sandbox redirect_uri "กำหนดเป็นอะไรก็ได้" vs prod ต้องลงทะเบียน (:158,:120) | env-driven — เป็น policy ฝั่ง IdP ไม่ใช่ฝั่งเรา | — | ตรงตามคู่มือ (N/A ฝั่งเรา) |
| 21 | `sub`==CID (ตัวอย่าง introspect :139,142-144 — **O3 ยังไม่ยืนยัน**) | ปฏิบัติกับ sub เสมือน CID ดิบ: ไม่เก็บดิบเลย — domain-separated keyed HMAC (`thaidSubjectKey`, thaid-identity-service.js:116-144); audit hash ก็ keyed (auth-idp.js:271-276) | thaid-identity-service.test.js (domain-sep/stability/raw-CID-nowhere) | ตรงตามคู่มือแบบกันไว้ก่อน — premise รอ sandbox (O3) |
| 22 | `pid` ใช้เทียบทะเบียนเท่านั้น ไม่เป็น subject (:143 + mandate) | CID match ใช้ `computeLookupHmac(nationalId)` ไม่มี label (ตรง users.idCardHmac) — คนละฟังก์ชันกับ thaidSubjectKey (:266-277) | thaid-identity-service.test.js | ตรงตามคู่มือ |
| 23 | api_key อยู่ใน §9 แต่ไม่มีตัวอย่าง request ไหนใช้ | adapter ไม่ส่ง — ตรงกับ conformance doc 2026-08-06:13 | — | ตรงตามคู่มือ (ต้องยืนยันกับ sandbox ว่าไม่บังคับจริง) |
| 24 | Auto-provision/link policy (GACP เอง ไม่ใช่ BORA) | citizen-only allow-list + fail-closed production (thaid-identity-service.js:158-165,283-288) | 9 resolveThaidLogin cases | N/A ต่อคู่มือ — ตรง mandate §D4 |
| 25 | 2FA/status gate ที่ mint (GACP เอง) | ACCOUNT_INACTIVE + MFA challenge ก่อน mint (auth-idp.js:290-352) | auth-idp-thaid-session (รวม /verify round-trip) | N/A ต่อคู่มือ — ตรง mandate |

## ยังพิสูจน์ไม่ได้จนกว่าจะยิง sandbox จริง (P2-gated)
1. **O3**: `sub` == CID จริงไหม (มีแค่ตัวอย่าง introspect ในคู่มือ)
2. BORA คืน pid/ชื่อ top-level **และ** ใน id_token พร้อมกัน หรือแบบใดแบบหนึ่งตาม "**" — โค้ดรองรับทั้งคู่ รอดูของจริง
3. String error §7 จริงของ BORA (นอกจาก user_denied ที่ cite ตรง)
4. `AUTH_THAID_API_KEY` บังคับจริงหรือไม่
5. Scope ผสม `"openid pid given_name family_name"` ใน request เดียว — ยังไม่เคยยิงกับเซิร์ฟเวอร์จริง

## จงใจไม่ทำ + เหตุผล (บันทึกแล้วทุกข้อ)
PKCE (ไม่มีในคู่มือ) · nonce (ไม่มีในคู่มือ; single-use state กัน replay) · refresh_token (คู่มือขัดแย้งตัวเอง; TTL เราแยก) · introspect-ใน-flow (dead by design; env ปลดจาก required) · revoke (logout ยกเลิก session เราเอง) · JWS signature verify (backchannel trust; จดใน thaid-identity-service.js:64-67)

## DEFECT
**ไม่พบ** — ไม่มีข้อใดที่โค้ดทำสิ่งที่คู่มือห้าม หรือขัดกับ citation ที่คู่มือระบุจริง
