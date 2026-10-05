## คำขอ Credential OAuth ของระบบ GACP (ฉบับร่าง)

> เหตุผล: ระบบยังไม่มี client_id/secret ของ GACP เอง — provider จริงทั้งหมด (Health ID, Provider ID, ThaID) จึงถูกตั้ง `coming_soon` และ fail-closed อยู่ (ธง B1-CRED). Sandbox/UAT สาธิตได้ทันทีด้วย test credential ที่คู่มือแจก โดยใส่ผ่าน `.env` เท่านั้น **ห้ามคอมมิตลงรีโป** (Law 3.3 — T-SBX หน้า 19)

---

### (ก) ถึง สำนักสุขภาพดิจิทัล กระทรวงสาธารณสุข (สธ.) — Health ID / Provider ID OAuth

ขอ **credential ของ GACP เอง** สำหรับเชื่อมต่อ OAuth ของ Health ID (ฝั่งเกษตรกร/ประชาชน) และ Provider ID (ฝั่งเจ้าหน้าที่) — เป็นการลงทะเบียน 2 คู่แยกกันตามคู่มือ (audit F1):

| คู่ | สิ่งที่ขอ | ใช้ในขา |
|---|---|---|
| Health ID | `client_id` + `client_secret` | authorize + แลก code → Health ID token |
| ระบบ Provider ID | `client_id` (PID) + `secret_key` | token exchange + profile ของเจ้าหน้าที่ |

- **redirect_uri ที่ขอลงทะเบียน** (ต้อง whitelist ฝั่ง Health ID ก่อนใช้งานจริง):
  - `https://staging.gacpth.com/auth/callback/healthid`
  - `https://staging.gacpth.com/auth/callback/providerid`
- **สภาพแวดล้อม**: ขอทั้งชุด UAT (`uat-moph.id.th` / `uat-provider.id.th`) และ Production (`moph.id.th` / `provider.id.th`)
- ข้อมูลผู้ให้บริการ (RP): ระบบรับรอง GACP กรมการแพทย์แผนไทยฯ — ชื่อระบบ, โดเมน `gacpth.com`, ผู้ประสานงาน/อีเมลราชการ
- เอกสาร Health ID ฝั่งประชาชน (profile endpoint) ยังไม่มีในคู่มือปัจจุบัน — ขอรับเพิ่มเพื่อปิด BLOCKER-2

---

### (ข) ถึง กรมการปกครอง (BORA) — ThaID Production

ขอ **client_id/client_secret production ของ GACP เอง** สำหรับ ThaID (OAuth 2.0 authorization-code, HTTP Basic ที่ token endpoint):

- **ขั้นตอน**:
  1. ลงทะเบียนผู้ให้บริการ (RP) ที่ **https://digitalid.bora.dopa.go.th**
  2. ยื่น **หนังสือราชการ** จากกรมการแพทย์แผนไทยฯ ขออนุมัติใช้งาน ThaID ระดับ Production
- **redirect_uri ที่ขอลงทะเบียน**: `https://staging.gacpth.com/auth/callback/thaid`
  (Production พร้อมใช้จริงเมื่อขึ้นโดเมน production — จะแจ้ง redirect_uri เพิ่มภายหลัง)
- **ขอบเขต (scope)**: ตามฟิลด์ที่ระบบต้องใช้ (เช่น pid, ชื่อ-สกุล) อ้าง §6.1.1
- **หมายเหตุ**: ขณะนี้สาธิตบน **Sandbox** ได้แล้วด้วย credential กลางที่คู่มือ (T-SBX หน้า 19) แจก — redirect_uri ชุด sandbox "กำหนดเป็นอะไรก็ได้" และใช้จาก `.env` local เท่านั้น จึงยังไม่ต้องรอ production cred เพื่อทดสอบ E2E

---

**สรุปสิ่งที่ค้าง**: ยังใช้ provider จริงไม่ได้จนกว่าจะได้ (1) credential ของ GACP เองจากทั้ง สธ. และ BORA และ (2) ลงทะเบียน redirect_uri `https://staging.gacpth.com/auth/...` เรียบร้อย จนกว่าจะถึงตอนนั้น provider จริงคง `coming_soon` และ demo ผ่าน sandbox/mock เท่านั้น