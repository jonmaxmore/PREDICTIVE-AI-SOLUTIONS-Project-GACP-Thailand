# รายงานตรวจสอบ Platform + System Checklist (Duplication / Complexity / Incomplete Code)

วันที่ตรวจสอบ: 2026-02-09  
ขอบเขต: โครงสร้าง backend, frontend component naming, เอกสาร deploy/checklist ระดับ root

## วิธีตรวจสอบ (Commands)

```bash
rg --files
rg -n "checklist|Checklist|gcp_checklist|farm_audit_checklist" apps/backend
python - <<'PY'
# scan duplicate service basenames (excluding node_modules)
PY
diff -u <fileA> <fileB>
```

---

## Executive Summary

- พบ **จุดซ้ำซ้อนเชิงโครงสร้าง (duplicate implementation)** หลายจุดใน service layer ของ backend (เช่น Email, Payment, Cache, Ksher)
- พบ **ความสับสนระดับ routing**: mount route เดียวกันซ้ำ (`/payments`) และมี checklist endpoint แบบ mock แยกอยู่ใน `server-production.js` ที่โครงสร้าง response ไม่เหมือน route จริง
- พบ **เอกสาร deployment/checklist กระจายหลายไฟล์** (กลุ่ม deploy มากกว่า 20 ไฟล์ใน root) ทำให้เกิดความคลุมเครือว่าไฟล์ใดเป็น source of truth
- พบ **โค้ดยังไม่สมบูรณ์ / placeholder** ที่กระทบ production readiness (S3 not implemented, Lab connector base methods not implemented, ข้อมูลบัญชีแพลตฟอร์มยัง `TBD`)

---

## Findings (เช็คลิสต์ตรวจระบบ)

## 1) Duplicate / Redundant Code

- [x] `apps/backend/services/EmailService.js` และ `apps/backend/services/email/EmailService.js` เป็นคนละ implementation แต่หน้าที่ซ้อนกัน
- [x] `apps/backend/services/payment-service.js` และ `apps/backend/services/payment/payment-service.js` ซ้ำเชิง domain
- [x] `apps/backend/services/ksher-service.js` และ `apps/backend/services/payment/ksher-service.js` ซ้ำเชิง gateway
- [x] `apps/backend/services/cache-service.js` และ `apps/backend/services/cache/cache-service.js` ซ้ำเชิง cache abstraction
- [x] `apps/backend/services/notification-service.js` และ `apps/backend/services/notification/notification-service.js` ซ้ำเชิง notification domain

**ผลกระทบ:** เพิ่ม cognitive load, เสี่ยงเรียกใช้ผิดไฟล์, ทดสอบยาก, bug fix ไม่ครบทุกจุด

---

## 2) Complexity / Confusion (Routing + API Contract)

- [x] ใน `apps/backend/routes/api/index.js` มีการ mount `/payments` มากกว่า 1 ครั้ง
- [x] ใน `apps/backend/server-production.js` มี endpoint `GET /api/v2/validation/checklist` แบบ mock ที่ response (`items`) ไม่สอดคล้องกับ route จริงใน `apps/backend/routes/api/validation.js` ที่ใช้โครงสร้าง `sections/items`

**ผลกระทบ:** พฤติกรรมขึ้นกับจุดเข้า server, สัญญา API ไม่แน่นอน, client อาจพังเมื่อสลับ runtime path

---

## 3) Documentation / Checklist Sprawl

- [x] พบไฟล์กลุ่ม deploy/checklist จำนวนมากใน root เช่น `DEPLOYMENT.md`, `DEPLOYMENT_GUIDE.md`, `PRODUCTION_DEPLOYMENT_GUIDE.md`, `DOCKER_DEPLOYMENT_GUIDE.md`, `DEPLOY_SUMMARY.md`, `DEPLOY_STEP_BY_STEP.txt`, `DEPLOYMENT_CHECKLIST_FINAL.md`, `RELEASE_CHECKLIST.md` ฯลฯ

**ผลกระทบ:** ทีมปฏิบัติการอาจทำตามคนละเอกสาร → เสี่ยงขั้นตอนตกหล่น

---

## 4) Incomplete / Placeholder Code

- [x] `apps/backend/services/storage-service.js` ระบุ `TODO` สำหรับ S3 และ fallback local เมื่อเลือก provider=s3
- [x] `apps/backend/services/lab-connectors/index.js` ใน base class มี `throw new Error('Not implemented')` หลายเมธอด
- [x] `apps/web-app/src/app/farmer/applications/new/steps/StepInvoice.tsx` มีข้อมูล `PLATFORM_INFO.bankAccount = 'XXXXXXXXXX' // TBD`

**ผลกระทบ:** ความพร้อมใช้งาน production ไม่สมบูรณ์, behavior จริงขึ้นกับ fallback/mock

---

## แผนแก้ไข (Prioritized)

### P0 (ต้องทำก่อน release รอบถัดไป)

- [ ] กำหนด **single source of truth** สำหรับ service domain ต่อไปนี้: email, payment, ksher, cache, notification
- [ ] ลบ/redirect endpoint mock `validation/checklist` ใน `server-production.js` ให้ใช้ router จริงเท่านั้น
- [ ] ยุบการ mount `/payments` ให้เหลือ 1 จุด
- [ ] แยกเอกสาร deploy/checklist ให้เหลือ “แม่บท 1 ไฟล์” + ไฟล์ย่อยเฉพาะ environment

### P1

- [ ] ทำ storage provider S3 ให้ครบวงจร หรือปิด flag ไม่ให้เลือก `s3` จนกว่าจะรองรับจริง
- [ ] เปลี่ยน `Not implemented` ใน lab base class เป็น feature flag + graceful error + telemetry
- [ ] แทนที่ค่าบัญชี `TBD` ด้วย config runtime จาก backend/system-config

### P2

- [ ] ตั้ง naming convention เดียวกัน (kebab-case หรือ PascalCase ตามบทบาทไฟล์)
- [ ] เพิ่ม architecture decision record (ADR) สำหรับ routing + service layering

---

## Acceptance Checklist (Definition of Done)

- [ ] ไม่มี service duplicate ใน domain เดียวกันที่ active พร้อมกัน
- [ ] `/api/v2/validation/checklist` ส่ง contract เดียวกันทุก entrypoint
- [ ] `/payments` ถูก mount จุดเดียวและ test ผ่าน
- [ ] deploy docs มี canonical entrypoint 1 ไฟล์
- [ ] ไม่มี `TODO/TBD/Not implemented` ใน critical path production

