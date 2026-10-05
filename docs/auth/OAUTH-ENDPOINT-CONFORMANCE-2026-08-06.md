# OAuth Endpoint Conformance — 2026-08-06 (LANE 4)

> เทียบ adapter จริงกับ endpoint/flow ที่ operator ยืนยัน (DTAM Next UAT capture + คู่มือ BORA RP Sandbox "doc 3" + คู่มือ P-OAUTH) — read-only, ทุกข้อมี file:line · **ไม่มี secret ใดในเอกสารนี้**

## ThaID (BORA/DOPA)

| ด้าน | ผล | รายละเอียด |
|---|---|---|
| Base URL / path | ✅ MATCH | env-only ทั้งหมด; shape `.../api/v2/oauth2/auth/` + `.../token/` ตรง sandbox จริง (`thaid-adapter.js:148,171,223`; `auth-providers.js:178-192`) |
| **Flow model** | ✅ MATCH | adapter = redirect authorization-code (`getAuthorizeUrl` :127-148 → `exchangeCode` :157-178) — **QR/txID คือหน้าจอ auth ของ BORA เอง ไม่ใช่สิ่งที่ RP ต้อง implement** ([T-SBX] §6.1-6.2 ตัวอย่างเป็น redirect+code callback ล้วน) → ข้อกังวล "adapter ผิดเพราะ QR" ปิด |
| Authorize params | ✅ MATCH | response_type=code, client_id, redirect_uri, scope, state (:141-147) ตรง §6.1.1 |
| Token/Introspect | ✅ MATCH | Basic Base64(client:secret) header + form body ตรง §6.2.1/§6.3 (:165-178, :221-230) |
| **api_key** | ✅ ไม่ต้องส่ง (verified) | [T-SBX] §9 แจก api_key ใน credential ชุด sandbox **แต่ไม่มีตัวอย่าง request ใน §6.1-6.3 ใช้มันเลย** (ตรวจทั้ง doc: ปรากฏบรรทัดเดียวในตาราง §9) → เป็นของ BORA data APIs อื่น; ถ้ายิง sandbox จริงแล้วโดนปฏิเสธค่อยเพิ่ม `AUTH_THAID_API_KEY` (env-only) — จะจดใน .env.example ผ่าน **#806 (draft ยังไม่ merge)** |
| env template | 🔧 **แก้ใน #806 (draft ยังไม่ merge)** | .env.example บน main ยัง stale: บอก adapter ยังไม่ลง + ขาด INTROSPECT_URL/SCOPE ที่ REQUIRED_ENV บังคับ → deploy ใหม่ตาม template บน main จะเปิด ThaID ไม่ได้จนกว่า #806 merge |

## MOPH (Health ID + Provider ID)

| ด้าน | ผล | รายละเอียด |
|---|---|---|
| Base URL | ✅ MATCH | authorize `{URL}/oauth/redirect` ตรง `https://uat-moph.id.th/oauth/redirect`; `/oauth/login` = หน้า login ของ IdP เอง (RP ไม่เรียกตรง — ถูกต้องที่ไม่มี env slot) |
| Flow model | ✅ MATCH | redirect auth-code + 2-leg exchange (Health ID token → Provider ID token) ตาม P-OAUTH (`provider-id-adapter.js:187-267`) |
| Params ทุก leg | ✅ MATCH | authorize/token/exchange/profile ตรงคู่มือหน้า 3/4/7/9 (:195-283) |
| api_key | ✅ N/A | P-OAUTH ใช้ client_id/secret + client-id/secret-key — ไม่มี api_key ในคู่มือ MOPH |

## Credential rule — สถานะ

- ✅ **ไม่มี client_id hardcode ที่ไหนเลย** — ทุกค่าอ่านผ่าน `getProviderConfig` จาก env; literal เดียวใน source คือ mock seam `'gacp-mock-idp-client'` (คำอ่านได้ ไม่ใช่ credential); prefix DTAM Next `019c324c` = 0 hits ทั้ง repo
- 🔧 **grep-guard** → PR #806 (`oauth-clientid-hardcode-guard.test.js`) — **draft ยังไม่ merge** · เป็น best-effort grep-pin (จับ quoted literal + prefix 019c324c ใน dir หลัก) — QA #806 พบว่า **bypass ได้** (concat `'019c'+'324c…'`, backtick, dir นอก scan เช่น server.js) → docstring "anywhere in source" overclaim, กำลังเสริม scope + ปรับคำ
- 🔒 **ThaID sandbox demo ได้เลย**: creds ทดสอบกลางจาก [T-SBX] §9 (กรมแจกในคู่มือ ใช้ได้จนกว่าประกาศยกเลิก, redirect_uri กำหนดอะไรก็ได้) — **env-only ห้าม commit** · prod ต้องขอ client_id ของ GACP เอง (ดู CREDENTIAL-REQUEST-DRAFT.md)

## Blocker ฝั่ง operator (B1-CRED)

GACP ยังไม่มี production credential ของตัวเองทั้ง 3 provider → ทุกตัวจริงคง `coming_soon` fail-closed จนกว่า: (1) cred จาก สธ. (MOPH คู่ Health ID + คู่ Provider ID) (2) cred จาก BORA (ลงทะเบียน digitalid.bora.dopa.go.th + หนังสือราชการ) (3) ลงทะเบียน redirect_uri `https://staging.gacpth.com/auth/callback/{healthid|providerid|thaid}` — ร่างหนังสือ: `docs/auth/CREDENTIAL-REQUEST-DRAFT.md`
