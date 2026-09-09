# แบบออกแบบ: โมเดลบัญชีและบทบาท 3 ฝั่ง (Health ID · Provider ID · ThaID)

วันที่ 2026-09-09 · สถานะ: **รอ operator อนุมัติ** · ผู้ตัดสิน: operator · เอกสารตัดสิน: [ADR 0004](../../adr/0004-account-model.md)

แทนที่ "บทบาท 7 แบบ" ในแผน §6.5 และขยาย ADR 0001 ข้อ 5 ("Auth production = ThaID + หมอพร้อม เท่านั้น") ให้ระบุว่าใครใช้อะไร

## 1. สิ่งที่ตกลงกันแล้ว (operator 2026-09-09)

1. ยึดระเบียบหมอพร้อม/กระทรวงสาธารณสุขเป็นแกน: **ผู้รับบริการ = Health ID** · **เจ้าหน้าที่ผู้ให้บริการ = Provider ID** (Provider ID ไม่ใช่การล็อกอินแยก แต่เป็นเครดิตที่ต่อจาก Health ID พร้อมสังกัด)
2. ใช้ **ThaID** ตามตัวอย่าง Relying Party ของ ETDA (OpenID Connect กับกรมการปกครอง) สำหรับพิสูจน์ตัวตนบุคคล
3. **บริษัทผู้ให้บริการแพลตฟอร์มเป็นฝั่งที่ 3** ไม่ใช่ผู้รับบริการและไม่ใช่เจ้าหน้าที่กรม มีทางเข้าและหน้าจอของตัวเอง ล็อกอินด้วย ThaID + รายชื่อพนักงานที่บริษัทอนุญาต (ไม่มีรหัสผ่านที่เราเก็บเอง)
4. กรมและบริษัทมี "การเงิน" และ "ผู้ดูแลระบบ" ของตัวเองแยกกันชัด (บัญชีสองฝั่งกระทบยอดกัน ผู้ดูแลระบบสองฝั่งดูแลคนของตัวเอง) รวมเป็น 9 บทบาท
5. ไม่มี super admin · แยกอำนาจ กติกา / เงิน / การตัดสิน · สิทธิ์ดูแลเซิร์ฟเวอร์ (Vercel, Supabase, GitHub, Stripe) ไม่ใช่บทบาทในแอป

## 2. ข้อเท็จจริงจากเอกสารทางการที่แบบนี้อิง

| ระบบ | ข้อเท็จจริงที่ใช้ออกแบบ | แหล่ง |
|---|---|---|
| Health ID (MOPH) | OAuth2 authorization code: `GET {HealthID-URL}/oauth/redirect?client_id&redirect_uri&response_type=code&state` → `POST {HealthID-URL}/api/v1/token` (grant_type, code, redirect_uri, client_id, client_secret) → `access_token` (Bearer) + `account_id` · UAT `https://uat-moph.id.th` · PRD `https://moph.id.th` · ไม่ใช่ OpenID Connect (ไม่มี id_token, nonce, PKCE) | คู่มือการเชื่อมต่อระบบ Provider ID ด้วย OAuth ของ Health ID (1 ก.ค. 2567) ส่วนที่ 1 |
| Provider ID (MOPH) | `POST {Provider-URL}/api/v1/services/token` (client_id, secret_key, token_by="HealthID", token = access_token ของ Health ID) → 200 + token ของ Provider ID ถ้าเป็นเจ้าหน้าที่ · 400 "This user has not provider id" ถ้าไม่ใช่ · `GET /api/v1/services/profile` (Bearer + header client-id/secret-key) → `provider_id` 13 หลัก, `hash_cid`, ชื่อไทย/อังกฤษ, `organization[]` (`business_id`, `hcode`, `hname_th`, `position`, `position_type`, `license_id`, `expertise`, `is_hr_admin`, `is_director`) · UAT `https://uat-provider.id.th` · PRD `https://provider.id.th` | คู่มือเดียวกัน ส่วนที่ 2 |
| การขอ client | หน่วยงานดาวน์โหลดแบบฟอร์มที่ id.moph.go.th ทำหนังสือราชการถึงผู้อำนวยการสำนักสุขภาพดิจิทัล (ผู้บริหารสูงสุดลงนาม) แนบสำเนาบัตร ส่ง provider.id@moph.go.th → ได้ Client ID + Secret Key + คู่มือ API (โทร 02-590-2076-77) | ขั้นตอนการขอใช้ API Health ID และ Provider ID (ส.ค. 2567) |
| ขอบเขต Provider ID | "เจ้าหน้าที่ผู้ให้บริการ หมายความรวมถึง บุคลากรทางการแพทย์" · ใช้กับ back office ของหน่วยงานด้วย (Wifi, สลิปเงินเดือน, การลา) · ทุกวิชาชีพสมัครได้ตามดุลยพินิจหัวหน้าหน่วย · แพทย์แผนไทยอยู่ใน 9 วิชาชีพหลัก | ข้อกำหนดและเงื่อนไข Provider ID · เอกสารขั้นตอน · คู่มือสมัครของโรงพยาบาลในสังกัด |
| ThaID (DOPA) | OpenID Connect discovery `https://imauth.bora.dopa.go.th/.well-known/openid-configuration` (sandbox `https://imauthsbx.bora.dopa.go.th`) · authorization/token/userinfo/jwks/revocation endpoints · `response_types: code` · `grant_types: authorization_code, refresh_token` · id_token `ES256` · scopes `openid pid address gender birthdate given_name middle_name family_name name given_name_en middle_name_en family_name_en name_en title title_en ial smartcard_code date_of_expiry date_of_issuance` (+ `house_address` เฉพาะ production) · client auth `client_secret_basic` หรือ `client_secret_post` · discovery ไม่ประกาศ PKCE (ต้องทดสอบใน sandbox) | discovery documents (ดึง 2026-09-09) · ETDA ThaiD-Python-RP, ThaiD-PHP-RP, ThaiD-CSharp-RP (ทั้งสามใช้ flow เดียวกัน ต่างกันแค่ภาษา) |

ข้อควรระวัง: repo ตัวอย่าง C# ของ ETDA มี client secret ติดอยู่ใน `appsettings.json` สาธารณะ ห้ามนำมาใช้ ต้องลงทะเบียน RP ของเราเองกับกรมการปกครอง

## 3. โมเดลความคิด

```
บุคคลธรรมดาหนึ่งคน = User หนึ่งแถว (เชื่อมด้วย HMAC ของเลขบัตร)
   ├─ identities[]                     วิธีที่พิสูจน์ว่าเป็นคนนี้: THAID · MORPHROM_HEALTH_ID · DEV_LOCAL
   ├─ ProviderCredential (0..1)         เครดิต "เจ้าหน้าที่ผู้ให้บริการ" จาก Provider ID พร้อมสังกัด → เปิดทางให้บทบาทฝั่งกรม
   ├─ PlatformOperatorMembership (0..1) อยู่ในรายชื่อพนักงานบริษัท → เปิดทางให้บทบาทฝั่งบริษัท
   └─ staffRoleAssignments[]            บทบาทที่ถูกมอบ (มีผลจริงต่อเมื่อเครดิตของฝั่งนั้นยังใช้ได้)
```

- ทุก User ที่พิสูจน์ตัวตนแล้วเป็น `APPLICANT` ได้เสมอ (ยื่นคำขอในนามตนเองหรือนิติบุคคลที่ตนเป็นสมาชิก)
- **บทบาทมีผล = บทบาทที่ถูกมอบ ∩ บทบาทที่เครดิตอนุญาต** คำนวณใหม่ทุกครั้งที่ล็อกอิน: Provider ID หลุด (MOPH ตอบ 400) → บทบาทฝั่งกรมหายทันที · ถูกถอดจากรายชื่อบริษัท → บทบาทฝั่งบริษัทหายทันที
- คนเดียวเป็นได้ทั้งผู้ขอรับรองและเจ้าหน้าที่ (เหมือน Health ID คนเดียวมี Provider ID ได้) แต่กติกาผลประโยชน์ทับซ้อน (ห้ามได้รับมอบเคสของตนเอง) เป็นกฎของ `CaseAssignment` ใน M5

## 4. บทบาท 9 แบบ (`UserRole`) และฝั่ง (`RoleSide`)

| ฝั่ง (`RoleSide`) | บทบาท | ไทย | ทำอะไร | ทำอะไรไม่ได้ |
|---|---|---|---|---|
| `APPLICANT` | `APPLICANT` | ผู้ขอรับรอง | ยื่นคำขอ แนบเอกสาร ยอมรับใบเสนอราคา ชำระ แก้ตามที่ขอเพิ่ม | เห็นคำขอของคนอื่น |
| `CERTIFICATION_BODY` | `DOCUMENT_REVIEWER` | ผู้ตรวจเอกสาร | รับเคส ตรวจรายช่อง ขอเอกสารเพิ่ม รับ/ไม่รับคำขอ | เงิน กติกา |
| `CERTIFICATION_BODY` | `DISPATCHER` | ผู้จัดคิวงาน | มอบ/โยกเคส ดูภาระงานและ SLA | เงิน กติกา ตัดสินคำขอ |
| `CERTIFICATION_BODY` | `FIELD_INSPECTOR` | ผู้ตรวจประเมินแปลง | นัดวัน ลงพื้นที่ checklist + หลักฐาน ส่งรายงาน (Phase 2: ติดตาม T&T) | เงิน กติกา |
| `CERTIFICATION_BODY` | `CERTIFICATE_APPROVER` | ผู้อนุมัติออกใบรับรอง | อนุมัติ/ไม่อนุมัติ/ส่งตรวจซ้ำ เพิกถอน (Phase 2: อนุมัติ recall) | เงิน กติกา |
| `CERTIFICATION_BODY` | `CERTIFICATION_BODY_ADMIN` | ผู้ดูแลระบบของกรม | มอบ/ถอดบทบาทฝั่งกรมให้คนที่มี `ProviderCredential` ใช้ได้ · จัดการ `AuthorizedProviderOrganization` (สังกัดที่รับเป็นเจ้าหน้าที่กรม เช่น กรมฯ, สสจ.) · ดูบันทึกการเข้าถึงเอกสารของเจ้าหน้าที่กรม · ดูแลข้อมูลกฎของกรม (ช่องเอกสาร กฎบังคับ checklist อายุใบรับรอง วันทำการ) เมื่อมีหน้าจอ (หลัง M6) | เงิน ตัดสินคำขอ คนของบริษัท |
| `CERTIFICATION_BODY` | `CERTIFICATION_BODY_FINANCE_OFFICER` | เจ้าหน้าที่การเงินของกรม | เห็นค่าธรรมเนียม (ส่วนของกรม) ที่เก็บได้ต่อคำขอต่องวด · ยืนยันรับงวดนำส่งจากบริษัท · ส่งออกรายงาน (อ่านอย่างเดียว) | ออกเอกสารเงิน เปลี่ยนสถานะคำขอ |
| `PLATFORM_OPERATOR` | `PLATFORM_OPERATOR_ADMIN` | ผู้ดูแลระบบของบริษัท | รายชื่อพนักงานบริษัท (`PlatformOperatorMembership`) · มอบ/ถอดบทบาทฝั่งบริษัท · ตั้ง/กู้คืน `CERTIFICATION_BODY_ADMIN` ให้กรม (บันทึก + แจ้งเตือนผู้ดูแลกรมทุกครั้ง) · เครื่องมือซัพพอร์ตแบบอ่านอย่างเดียว (ค้นคำขอ ดูสถานะ ส่งแจ้งเตือนซ้ำ ทุกการเปิดดูเอกสารถูกบันทึก) · ดูบันทึกทั้งระบบ | เงิน ตัดสินคำขอ มอบบทบาทเจ้าหน้าที่กรมอื่นนอกจากผู้ดูแลกรม |
| `PLATFORM_OPERATOR` | `PLATFORM_OPERATOR_FINANCE_OFFICER` | เจ้าหน้าที่การเงินของบริษัท | ใบเสนอราคา ใบเสร็จ/ใบกำกับภาษี คืนเงิน ใบลดหนี้ กระทบยอด Stripe · บันทึกงวดนำส่งค่าธรรมเนียมให้กรม | เปลี่ยนสถานะคำขอ กติกา คน |

ชื่อที่เลิกใช้: `FINANCE_OFFICER`, `SYSTEM_ADMIN` (กำกวมว่าของใคร) · `SYSTEM` ยังเป็น actor kind ไม่ใช่บทบาท

กติกาฝั่ง → บทบาท (ใน `packages/domain`, ทดสอบเป็นเมทริกซ์):

| เครดิตที่ User มี | บทบาทที่ถือได้ |
|---|---|
| ตัวตนที่พิสูจน์แล้วอย่างใดอย่างหนึ่ง (ThaID หรือ Health ID) | `APPLICANT` |
| `ProviderCredential` ใช้ได้ + สังกัดอยู่ใน `AuthorizedProviderOrganization` | บทบาทฝั่ง `CERTIFICATION_BODY` ทั้ง 6 |
| `PlatformOperatorMembership` ใช้ได้ | บทบาทฝั่ง `PLATFORM_OPERATOR` ทั้ง 2 |

การมอบบทบาท (`StaffRoleAssignment`) ที่ขัดกติกานี้ถูกปฏิเสธที่ชั้น domain · ใครมอบได้: `CERTIFICATION_BODY_ADMIN` มอบบทบาทฝั่งกรม · `PLATFORM_OPERATOR_ADMIN` มอบบทบาทฝั่งบริษัท และมอบ `CERTIFICATION_BODY_ADMIN` ได้ (เพื่อเริ่มระบบและกู้คืน) · ระบบไม่ให้ถอดผู้ดูแลระบบคนสุดท้ายของแต่ละฝั่ง

## 5. ทางเข้าและหน้าจอ (แยกฝั่งจริง)

| ทางเข้า | ใคร | ปุ่ม/วิธี | หลังผ่าน |
|---|---|---|---|
| `/auth/login` (สาธารณะ) | ผู้ขอรับรอง | "เข้าสู่ระบบด้วย Health ID" · "เข้าสู่ระบบด้วย ThaID" | `/applicant` |
| `/auth/login` ส่วน "สำหรับเจ้าหน้าที่กรม" | เจ้าหน้าที่กรม | "เข้าด้วย Provider ID" (เริ่ม Health ID OAuth เหมือนกัน แต่ `state` บอกความตั้งใจว่าเป็นเจ้าหน้าที่ → ระบบตรวจ Provider ID ต่อทันที) | หน้าหลักของบทบาทฝั่งกรม หรือหน้า "รอผู้ดูแลกรมมอบบทบาท" ถ้ายังไม่มีบทบาท หรือ "บัญชีนี้ไม่มี Provider ID / สังกัดไม่อยู่ในรายการ" |
| `/platform-operator/login` (ไม่ลิงก์จากหน้าสาธารณะ) | พนักงานบริษัท | ThaID เท่านั้น | หน้าหลักของบทบาทฝั่งบริษัท หรือ "ไม่อยู่ในรายชื่อพนักงาน" |
| dev เท่านั้น | นักพัฒนา | เลือกบทบาท (dev login เดิม) ระบบสร้างเครดิตของฝั่งนั้นให้ในหน่วยความจำ | ตามบทบาท |

เส้นทางจัดกลุ่มตามฝั่ง (แทน route ต่อบทบาทระดับบนของ M0):

- `/applicant/...`
- `/certification-body/document-reviewer` · `/certification-body/dispatcher` · `/certification-body/field-inspector` · `/certification-body/certificate-approver` · `/certification-body/admin` · `/certification-body/finance-officer`
- `/platform-operator/admin` · `/platform-operator/finance-officer` · `/platform-operator/login`
- callback: `/auth/morphrom/callback` · `/auth/thaid/callback`

`proxy.ts` เป็นประตูเดียวเหมือนเดิม: ไม่มี session → ไปหน้าล็อกอินของฝั่งนั้น (`/platform-operator/*` → `/platform-operator/login`, อื่น ๆ → `/auth/login`) · บทบาทไม่ตรง → 403 · แถบบนของ `RoleShell` แสดงฝั่ง + บทบาท (สีเจ้าหน้าที่ `officer` สำหรับกรม สีเดิมสำหรับผู้ขอรับรอง สี navy สำหรับบริษัท)

## 6. flow การล็อกอิน (server ทั้งหมด ไม่มี token ค้างในเบราว์เซอร์)

**A. Health ID (ผู้ขอรับรอง หรือเจ้าหน้าที่กรม)**

1. `GET /auth/morphrom/start?intent=applicant|certification-body-staff` สร้าง `state` สุ่ม (เก็บใน cookie ชั่วคราว httpOnly พร้อม intent อายุ 10 นาที) → redirect `{HealthID-URL}/oauth/redirect?...`
2. callback ตรวจ `state` ตรงกับ cookie → `POST /api/v1/token` → `access_token`, `account_id`
3. ดึงข้อมูลผู้ใช้ Health ID ตามคู่มือ MOPH DID API (ได้หลังลงทะเบียน): อย่างน้อยชื่อสำหรับแสดง และเลขบัตรหรือ hash ของเลขบัตร (ถ้าได้ `hash_cid` ใช้เชื่อม User ถ้าไม่ได้ subject = `account_id`)
4. upsert `UserIdentity(provider = MORPHROM_HEALTH_ID, subjectHmac = HMAC(account_id))` และเชื่อม User ด้วย `nationalIdHmac` เมื่อรู้เลขบัตร
5. ถ้า intent เป็นเจ้าหน้าที่กรม: `POST {Provider-URL}/api/v1/services/token` ด้วย token ของ Health ID → 400 = แสดง "บัญชีนี้ไม่มี Provider ID" (ยังใช้เป็นผู้ขอรับรองได้) · 200 = `GET /api/v1/services/profile` → upsert `ProviderCredential` (provider_id, สังกัด, `lastVerifiedAt`) · ถ้าไม่มีสังกัดใดอยู่ใน `AuthorizedProviderOrganization` → บันทึกเครดิตแต่ทำเครื่องหมายว่า "สังกัดไม่ได้รับอนุญาต" และแสดงข้อความ
6. คำนวณบทบาทมีผล → ออก session cookie (JWE เดิม) → ไปหน้าหลัก · **ไม่เก็บ access_token ของ MOPH** ไว้หลังจบ request (เราไม่เรียก PHR)

**B. ThaID (ผู้ขอรับรอง หรือพนักงานบริษัท)**

1. `GET /auth/thaid/start?intent=applicant|platform-operator-staff` → `openid-client` v6: discovery จาก `GACP_THAID_ISSUER_URL` สร้าง `state`, `nonce` และ `code_challenge` (PKCE) ถ้า sandbox รับ · scope `openid pid name given_name family_name ial`
2. callback: แลก code → ตรวจ id_token (JWKS, ES256, `iss`, `aud`, `nonce`, `exp`) → claims `sub`, `pid`, ชื่อ, `ial`
3. upsert `UserIdentity(provider = THAID, subjectHmac = HMAC(sub))` ตั้ง `users.nationalIdHmac = HMAC(pid)` (ไม่เก็บ pid อ่านได้) · ถ้า intent เป็นพนักงานบริษัท: หา `PlatformOperatorMembership` ที่ `nationalIdHmac` ตรงและยังไม่ถูกถอด → ไม่พบ = "ไม่อยู่ในรายชื่อพนักงาน" (ไม่สร้างสิทธิ์อะไร) · พบ = ผูก `userId` เข้ากับ membership
4. คำนวณบทบาทมีผล → session → หน้าหลัก · เรียก revocation endpoint ของ DOPA ทิ้ง access token หลังใช้ (ไม่เก็บ refresh token)

**C. ระดับความน่าเชื่อถือ**: บันทึก `ial` จาก ThaID และวิธีพิสูจน์ (Health ID/ThaID) ลง `UserIdentity` เพื่อให้ Katorlor1 และใบรับรองอ้างได้ว่าเลขบัตรที่พิมพ์มาจากบัญชีที่พิสูจน์แล้ว (ปิดข้อ P12 ของแผน)

## 7. โมเดลข้อมูล (Prisma, ชื่อตาม glossary)

- `enum IdentityProvider { THAID, MORPHROM_HEALTH_ID, DEV_LOCAL }` (เปลี่ยนชื่อค่า `MORPHROM` → `MORPHROM_HEALTH_ID`)
- `enum UserRole` 9 ค่า: เปลี่ยนชื่อ `FINANCE_OFFICER → PLATFORM_OPERATOR_FINANCE_OFFICER`, `SYSTEM_ADMIN → PLATFORM_OPERATOR_ADMIN` · เพิ่ม `CERTIFICATION_BODY_ADMIN`, `CERTIFICATION_BODY_FINANCE_OFFICER`
- `User` เพิ่ม `nationalIdHmac String? @unique` (เชื่อมตัวตนหลายทางของคนเดียว)
- `UserIdentity` เพิ่ม `identityAssuranceLevel String?` (จาก ThaID `ial`) และ `verifiedAt`
- ใหม่ `ProviderCredential` (`provider_credentials`): `userId @unique`, `providerId` (13 หลัก), `organizationBusinessId`, `organizationCode` (hcode), `organizationNameTh`, `position`, `positionType`, `licenseId`, `verifiedAt`, `lastVerifiedAt`, `revokedAt` (เมื่อ MOPH ตอบ 400/404 ครั้งล่าสุด), `profileHash` (sha256 ของ profile ไว้ตรวจการเปลี่ยนแปลง ไม่เก็บ profile ทั้งก้อน)
- ใหม่ `AuthorizedProviderOrganization` (`authorized_provider_organizations`): `businessId @unique`, `organizationCode`, `nameTh`, `addedById`, `addedAt`, `revokedAt`, `revokedById`
- ใหม่ `PlatformOperatorMembership` (`platform_operator_memberships`): `nationalIdHmac @unique`, `displayName`, `userId?` (ผูกเมื่อล็อกอินครั้งแรก), `addedById?`, `addedAt`, `revokedAt`, `revokedById`
- `StaffRoleAssignment` เหมือนเดิม · `Session` เหมือนเดิม · ทุกการเพิ่ม/ถอด membership, องค์กร, บทบาท → แถวใน `audit_logs`
- migration: `ALTER TYPE user_role RENAME VALUE` ×2 + `ADD VALUE` ×2 · `ALTER TYPE identity_provider RENAME VALUE` · ตารางใหม่ 3 · ข้อมูลเดิมมีเฉพาะเครื่องพัฒนาและ demo

## 8. Contracts, domain, env

- contracts: `UserRole` (9), `RoleSide = { APPLICANT, CERTIFICATION_BODY, PLATFORM_OPERATOR }`, `roleSideOf(role)`, `CERTIFICATION_BODY_ROLES`, `PLATFORM_OPERATOR_ROLES`, `IdentityProvider` (3), `LoginIntent = { APPLICANT, CERTIFICATION_BODY_STAFF, PLATFORM_OPERATOR_STAFF }`, schema ของ profile ที่เราเก็บจาก MOPH และ ThaID (เฉพาะ field ที่ใช้)
- domain: `effectiveRoles({ assignedRoles, providerCredentialActive, providerOrganizationAuthorized, platformOperatorMembershipActive })` และ `canAssignRole(actorRoles, targetRole, targetCredentials)` ทดสอบครบเมทริกซ์ · ไม่มี HTTP ใน domain
- web `lib/identity/`: `ThaidClient` (openid-client) และ `MorphromClient` (fetch ต่อ Health ID + Provider ID) เป็น interface + implementation จริง + `FakeThaidClient` / `FakeMorphromClient` สำหรับ test · `currentUser()` คำนวณบทบาทมีผลจากเครดิตทุกครั้ง
- env ใหม่ (บังคับใน demo/staging/production ว่างได้ใน development/test): `GACP_PUBLIC_BASE_URL` (ประกอบ redirect_uri), `GACP_THAID_ISSUER_URL` (`https://imauthsbx.bora.dopa.go.th` หรือ `https://imauth.bora.dopa.go.th`), `GACP_THAID_CLIENT_ID`, `GACP_THAID_CLIENT_SECRET`, `GACP_MORPHROM_HEALTH_ID_BASE_URL` (`https://uat-moph.id.th` หรือ `https://moph.id.th`), `GACP_MORPHROM_HEALTH_ID_CLIENT_ID`, `GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET`, `GACP_MORPHROM_PROVIDER_ID_BASE_URL` (`https://uat-provider.id.th` หรือ `https://provider.id.th`), `GACP_MORPHROM_PROVIDER_ID_CLIENT_ID`, `GACP_MORPHROM_PROVIDER_ID_SECRET_KEY` · `GACP_AUTH_DEV_LOGIN_ENABLED` เหมือนเดิม (production ปฏิเสธ)

## 9. การเริ่มระบบและงานผู้ดูแลที่ทำในรอบนี้

- คนแรกของบริษัท: คำสั่ง `pnpm --filter @gacp/db platform-operator:bootstrap` รับเลขบัตรจาก stdin (ไม่ผ่าน argument ไม่ลง log) → HMAC → สร้าง membership + มอบ `PLATFORM_OPERATOR_ADMIN` ให้ทันทีเมื่อล็อกอินครั้งแรก
- หน้าจอขั้นต่ำรอบนี้: `/platform-operator/admin` (รายชื่อพนักงาน เพิ่ม/ถอด, มอบบทบาทฝั่งบริษัท, ตั้ง `CERTIFICATION_BODY_ADMIN`) · `/certification-body/admin` (สังกัดที่อนุญาต เพิ่ม/ถอด, มอบบทบาทฝั่งกรมให้คนที่มีเครดิต) · หน้าหลักการเงินทั้งสองฝั่งยังเป็นหน้าว่างจน M4
- เลิกใช้บทบาท `SYSTEM_ADMIN` และ `FINANCE_OFFICER` ในโค้ด ข้อความ glossary แผน และ ADR 0001 ข้อ 13

## 10. สิ่งที่ operator และหน่วยงานต้องจัดหา (ไม่ใช่งานเขียนโค้ด)

| รายการ | ใคร | ได้อะไร |
|---|---|---|
| หนังสือราชการขอใช้ API Health ID + Provider ID ถึงผู้อำนวยการสำนักสุขภาพดิจิทัล (แบบฟอร์มจาก id.moph.go.th ผู้บริหารสูงสุดลงนาม สำเนาบัตร) → provider.id@moph.go.th | กรม (หรือบริษัทในฐานะหน่วยงาน ถ้ากรมตกลง) | Client ID/Secret ของ Health ID และ Provider ID (UAT + PRD) + คู่มือ MOPH DID API (field ของ profile ผู้ใช้ Health ID) |
| ลงทะเบียน Relying Party กับกรมการปกครอง (RP Admin) ระบุ callback URL ของ demo/staging/production | บริษัท | client_id, client_secret, API key ของ ThaID (sandbox `imauthsbx` และ production) |
| รายการสังกัดที่รับเป็นเจ้าหน้าที่กรม (business_id/hcode ของกรมฯ และ สสจ. ที่เกี่ยวข้อง) และคำตอบว่าผู้ตรวจแปลงภายนอกจะได้ Provider ID ในสังกัดกรมหรือไม่ | กรม | seed ตาราง `AuthorizedProviderOrganization` |
| รายชื่อพนักงานบริษัท (ชื่อ + เลขบัตร) สำหรับผู้ดูแลระบบของบริษัทกรอกเข้าระบบ | บริษัท | membership |

## 11. ข้อที่ยังเปิด (เข้าแผน §11)

1. ฝั่งของ `DISPATCHER`: ค่าเริ่มต้นฝั่งกรม (ย้ายได้เพราะเป็นข้อมูลใน `roleSideOf`)
2. DOPA รับ PKCE ไหม: ทดสอบใน sandbox เมื่อได้ client · ถ้าไม่รับ ใช้ `state` + `nonce` + client_secret ตามมาตรฐาน
3. field ของ profile ผู้ใช้ Health ID (มาจากคู่มือหลังลงทะเบียน): จนกว่าจะได้ ใช้ `account_id` เป็น subject และเชื่อม User ด้วยเลขบัตรจาก ThaID เมื่อผู้ใช้ล็อกอินทางนั้น
4. การกระทบยอดกรม–บริษัท (งวดนำส่ง + ยืนยันรับ) เข้า M4 · แผน §2 ข้อ "ไม่ทำเลย: นำส่งกรม" เปลี่ยนเป็น "บันทึกและยืนยันงวดนำส่งในระบบ การโอนเงินจริงอยู่นอกระบบ"
5. หน้าจอแก้ตารางอัตรา: บริษัทแก้ กรมกดรับรองก่อนมีผล (หลัง M6)

## 12. การทดสอบ

- domain: เมทริกซ์ `effectiveRoles` และ `canAssignRole` ครบทุกฝั่ง × เครดิต × สถานะถอด
- contracts: env schema (production บังคับครบ dev ว่างได้), enums 9/3 ค่า
- db integration: enum ในฐานข้อมูลตรงกับ contracts (ทดสอบเดิมขยาย), unique ของ membership และองค์กร
- web: handler ของ callback ทดสอบด้วย `FakeThaidClient` / `FakeMorphromClient` ครอบกรณี 400 ของ Provider ID, สังกัดไม่อนุญาต, ไม่อยู่ในรายชื่อบริษัท, state ไม่ตรง · เดินในเบราว์เซอร์ด้วย dev login ทั้ง 9 บทบาทและ 3 ทางเข้า
- sandbox จริง (ThaID sandbox, MOPH UAT) เมื่อได้ client จาก 2 หน่วยงาน

## 13. ลำดับงาน (ให้ writing-plans แตกเป็นแผน)

1. contracts + db: enums, ตารางใหม่, migration, glossary §2 และคำใหม่ (`RoleSide`, `ProviderCredential`, `AuthorizedProviderOrganization`, `PlatformOperatorMembership`, `LoginIntent`, `ThaidClient`, `MorphromClient`)
2. domain: `effectiveRoles`, `canAssignRole`, `roleSideOf` + tests
3. web: จัดกลุ่มเส้นทางตามฝั่ง, `proxy.ts`, หน้าล็อกอิน 2 หน้า, `ThaidClient` / `MorphromClient` + fake, callback 2 ทาง, `currentUser()` คำนวณบทบาทมีผล, dev login จำลองเครดิต, หน้าผู้ดูแลระบบขั้นต่ำ 2 ฝั่ง, bootstrap CLI
4. เอกสาร: ADR 0004, ADR 0001 ข้อ 5 และ 13 (ถ้อยคำ), แผน §6.5 §2 §11, memory
