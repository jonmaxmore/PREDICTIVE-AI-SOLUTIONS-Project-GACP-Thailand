# Interoperability Track + Trust Layer Standard

Date: 2026-03-02  
Owner: Platform (Backend + Frontend + Data)

## 1) Objective

ยกระดับระบบให้เชื่อมต่อข้ามหน่วยงานได้ในรูปแบบมาตรฐาน และยกระดับความเชื่อมั่นระดับประเทศด้วยโครงสร้าง Trust Layer ที่ตรวจสอบย้อนหลังได้

## 2) Interoperability Track (Implemented API Surface)

Base path: `/api/interoperability/v1`

### Data Contracts

- `GET /data-contracts/traceability`
  - Canonical schema สำหรับแลกเปลี่ยน traceability ข้ามหน่วยงาน
  - Version: `DTAM_TRACEABILITY_SCHEMA_1.0.0`

- `GET /event-contracts/trace-events`
  - Event contract สำหรับ trace timeline
  - Version: `DTAM_TRACE_EVENT_CONTRACT_1.0.0`

### e-Certificate & External Verification

- `GET /certificates/:certificateNumber/e-certificate`
  - ส่ง e-certificate envelope พร้อมลายเซ็นดิจิทัล
- `GET /certificates/:certificateNumber/signed-envelope`
  - ส่ง payload + signature + public key สำหรับ verifier ภายนอก
- `GET /verification?certificateNumber=...`
  - query-style external verification endpoint

### Event Contract for Trace

- `GET /trace/events/:entityType/:entityId`
  - รองรับ `CERTIFICATE`, `PLANTING_CYCLE`, `HARVEST_BATCH`, `PACKAGING_LOT`, `PLANT_UNIT`
  - ใช้ timeline event ที่ serialize ได้สำหรับระบบกลาง

## 3) Trust Layer (Implemented API Surface)

### Trust Registry & Transparency

- `GET /trust/registry`
  - Public trust registry, รองรับ pagination/filter/search
- `GET /trust/revocations`
  - Revocation transparency feed (รองรับ `since` + `limit`)
- `GET /trust/public-key`
  - Public key distribution endpoint สำหรับ verify signature

### Signed Document Verification

- `POST /signatures/verify`
  - ตรวจ signature ของ payload/payloadHash
  - Algorithm: `RSA-SHA256`

### Governance Operations

- `POST /certificates/:certificateNumber/revoke`
  - Revocation by admin (`ADMIN`/`SUPER_ADMIN`)
  - เขียนหลักฐาน revocation ลง certificate record

## 4) Data Governance Baseline

- Data contract กลาง:
  - Traceability schema + event contract มี version ชัดเจน
- Data minimization:
  - ข้อมูลที่เปิดสาธารณะใช้ field ที่จำเป็น
  - actor identifier ใช้ `sha256` แทนค่า plaintext
- Trust transparency:
  - มี revocation feed แยกสำหรับ verifier/cross-agency polling

## 5) Remaining Governance Gaps (Next Phase)

- Public trust registry แบบ signed snapshot รายวัน (tamper-evident manifest)
- Inter-agency data contract governance board (version lifecycle + deprecation policy)
- Revocation publication SLA และ incident communication policy
- Verifier conformance test suite ระดับหน่วยงานภายนอก

## 6) UAT Checklist (Interoperability / Trust)

- Verify active certificate -> `valid=true`, `trustStatus=ACTIVE`
- Verify revoked certificate -> `valid=false`, `trustStatus=REVOKED`
- Pull revocation feed -> มีรายการและ timestamp ถูกต้อง
- Verify signed-envelope with `/signatures/verify` -> `valid=true`
- Pull trace events -> event timeline เรียงตามเวลาและมี integrity hash
