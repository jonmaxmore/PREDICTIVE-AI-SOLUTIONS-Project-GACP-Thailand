# Runbook — heal `formData.plots[].areaUnit` (F-PLOT-AREAUNIT-DEADEND)

> Operator-run เท่านั้น (L5/L6) · เครื่องมือ: `scripts/maintenance/heal-plot-area-unit.js` (merged with branch feat/plot-areaunit-fix) · ที่มา: มติสภา 2026-08-19 (Option C) + spec design note 2026-08-19-plot-areaunit-fix-design Part B
> ใบที่ต้อง heal: **ทั้ง 18 ใบ รวม DRAFT 2 ใบ** — การแก้ผ่านหน้าเว็บ **ทำไม่ได้จริง** (wizard ไม่มีช่องหน่วย และเก็บแปลงเดิม verbatim — ดู the backlog 2026-08-19)

## Step 0 — ซ้อมก่อน (บังคับ)
`--apply` **ยังไม่เคยรันกับฐานข้อมูลจริงแม้ครั้งเดียว** (proof ทั้งหมดเป็น mock-level + live dry-run; ความเสี่ยงเหลือ = ล้มดัง+rollback ไม่ใช่เสียเงียบ — ชนิดคอลัมน์ id=text, updatedAt=timestamp(3) ตรวจสดแล้ว). ก่อนแตะ 7 ใบที่จ่ายเงินแล้ว ให้ซ้อม `--apply` ครั้งแรกกับใบ DRAFT (เช่น `0d0c7cb9-81c5-4fea-92a6-7c5e11589af8`) แล้วตรวจมือ:
- `formData.plots[i].areaUnit` ได้ค่าใหม่ และไม่มี key อื่นใน formData ขยับ
- `audit_logs` มีแถวใหม่ `action='PLOT_AREA_UNIT_HEALED'` พร้อมข้อความไทยตายตัว + metadata double-encoded (convention ของ audit-logger.js:394)
- `Application.workflowHistory` เพิ่มขึ้น 1 entry พอดี

## กติกา 2 ข้อจาก spec
1. ผู้ระบุ `--unit`/`--source` ต้อง**ไม่ใช่** auditor/reviewer ที่เซ็นแฟ้มใบนั้น — บันทึกผู้ให้ข้อมูลจริงใน `--source`
2. ใช้หน่วยตามหลักฐานจริง (โฉนด/เอกสารยื่น/คำยืนยันผู้สมัคร) — อย่าเดา Sqm. ถ้าหน่วยถูกต้องไม่ใช่ sqm: จอ PDF (`application-template-service.js:79`) และหน้า detail (`application-detail-page-config.ts:394-397`) จะแสดงเลขเพี้ยนจนกว่าจะถึง issuance (ดู the backlog) — ทราบแล้วค่อยใช้

## คำสั่ง (dry-run ก่อนเสมอ — dry-run เป็น default, เขียนจริงต้องมี `--apply`)
```bash
# specimen (ค้าง AUDIT_CONFIRMED, จ่ายครบ 2 งวด)
node scripts/maintenance/heal-plot-area-unit.js \
  --app f866374a-8f6b-4c7a-b850-bd09491db042 --plot 0 --unit Sqm \
  --reason "<เหตุผล>" --source "<เอกสารอ้างอิง>"            # dry-run — ดู diff ก่อน

node scripts/maintenance/heal-plot-area-unit.js \
  --app f866374a-8f6b-4c7a-b850-bd09491db042 --plot 0 --unit Sqm \
  --reason "<เหตุผล>" --source "<เอกสารอ้างอิง>" --apply    # เขียนจริง
```
Script ทีละใบเท่านั้น (ห้าม wildcard) · แก้ได้เฉพาะ plot ที่ **ไม่มี** unit (ไม่มีทาง overwrite) · ไม่แตะสถานะ ไม่เรียกออกใบ — ใบที่ heal แล้วกลับเข้าเส้นออกใบผ่าน edge ปกติ `AUDIT_CONFIRMED → AUDIT_PASSED` (evidence-gated issuance ยังตรวจตามปกติ)

## รายชื่อ 18 ใบ (live probe 2026-08-19 — รายละเอียดเต็ม: evidence/plot-areaunit-fix-task2/live-18-apps-probe.txt)
- **DRAFT (2) — ซ้อม step 0 ที่นี่ก่อน**: 0d0c7cb9-81c5-4fea-92a6-7c5e11589af8 · c7253718-f08f-47bb-8b63-6fa6ecedc6ed
- **SUBMITTED (1)**: 5bcbcb49-df3b-46d6-8d06-1503a717d1fd
- **PENDING_DOC_FEE (6)**: bd9b28d0-2d5e-4370-b3d9-07b96b71cb15 · ba3e7e14-6f53-4474-8437-80c8c4b6c6e5 · 90511926-5671-481a-aad7-b3a48efcbb29 · a0720a9f-fd40-49cc-b2a3-799d541adaaa · cc1c06d2-e583-4397-99bf-3288da1cb887 · 1280fd9b-87b2-4014-95ae-56baeb2e0fa2
- **PHASE_1_SLIP_UNDER_REVIEW (2)**: 71428be8-b64f-4601-a523-f14b723c809e · b289c296-f35b-483a-a534-7f0aa9b80c31
- **DOC_FEE_PAID (5)**: 2e1c7ce2-13ec-4daa-aad3-65340a3a43dd · 771067e4-85a3-4896-89f3-b26724b319a5 · f611a7ef-b745-431a-8897-10ca6a985791 · 7ab438a8-c744-4b44-a67f-3653605b1316 · 5136f1ed-f5a2-42d4-8ff8-fe2066eefc60
- **PENDING_AUDIT_FEE (1)**: 297088db-bb4a-4c43-ba7b-e81b2a643cde
- **AUDIT_CONFIRMED (1) = specimen**: f866374a-8f6b-4c7a-b850-bd09491db042

ต่อใบ: เปิด `formData.plots` (index + ชื่อแปลง) เทียบเอกสารยื่นจริงเพื่อได้ `--unit`/`--source` ที่ถูก แล้วรัน dry-run → `--apply` ต่อแปลง

## หลัง heal specimen เสร็จ
เดินต่อ: auditor กด AUDIT_CONFIRMED → AUDIT_PASSED ผ่าน UI ปกติ → ระบบ mint cert (จุดที่เคยพังผ่านแล้ว — final reviewer พิสูจน์สดกับ formData จริงว่า strict reader ผ่านหลังเติมหน่วย) · ผลรันจริง = หลักฐานปิด out-of-scope item (e) ของ spec

---

## ส่วนที่ 2 — heal `formData.farmData.totalAreaUnit` (follow-up (g), 2026-08-20)

> ที่มา: มติสภาเดิม 2026-08-19 (ruling C) ใช้ซ้ำกับฝั่ง farm (ไม่เปิดสภาใหม่) · spec:
> design note 2026-08-20-farm-areaunit-default-design · เครื่องมือเดียวกัน
> `scripts/maintenance/heal-plot-area-unit.js --target farm` (guard ทุกข้อเหมือน `--target plot`
> ทุกตัวอักษร — dry-run default, tx FOR UPDATE + updatedAt guard + post-write deepDiff verify,
> closed enum, no-overwrite, `--reason`/`--source` บังคับ, audit action
> `FARM_AREA_UNIT_HEALED`) · ต่างจาก plot ตรงที่ `formData.farmData` เป็นเอกพจน์ (ฟาร์มเดียวต่อใบ
> สมัคร) — ห้ามส่ง `--plot` มาพร้อม `--target farm` (สคริปต์ปฏิเสธที่ arg-parse)

### Farm TABLE probe (read-only, 2026-08-20) — ตัดสินเงื่อนไข T3 :398
```sql
SELECT COUNT(*) FROM farms WHERE "areaUnit" IS NULL OR TRIM("areaUnit") = '';
```
ผล: **0 แถว** (จากทั้งหมด 2 แถวใน `farms`) — คอลัมน์ `areaUnit` มี `@default("sqm")` ระดับ schema
จึงไม่มีทาง NULL ได้อยู่แล้ว ดังนั้น T3 คง fallback ที่ `certificate-service.js:398` (`farm.areaUnit ||
AREA_UNIT`) ไว้แบบ defensive-only ได้โดยไม่ต้อง heal Farm-table row ใดๆ เพิ่ม (เงื่อนไข spec ผ่าน:
0 unit-less rows) — full query + ผลลัพธ์: `evidence/farm-areaunit-default-task1/live-probe.txt`

### 19 ใบที่ต้อง heal (live probe สด 2026-08-20 — เงื่อนไข: `formData.farmData` เป็น object และ
`totalAreaUnit` ว่าง/NULL — ตรงกับ spec ทุกใบและทุกสถานะ)
- **DRAFT (2) — ซ้อม step 0 ที่นี่ก่อน**: `0d0c7cb9-81c5-4fea-92a6-7c5e11589af8` · `c7253718-f08f-47bb-8b63-6fa6ecedc6ed` (ใบเดียวกับที่ใช้ซ้อม plot heal — มีทั้ง unit-less plot และ unit-less farmData)
- **SUBMITTED (1)**: `5bcbcb49-df3b-46d6-8d06-1503a717d1fd`
- **PENDING_DOC_FEE (6)**: `ba3e7e14-6f53-4474-8437-80c8c4b6c6e5` · `cc1c06d2-e583-4397-99bf-3288da1cb887` · `90511926-5671-481a-aad7-b3a48efcbb29` · `bd9b28d0-2d5e-4370-b3d9-07b96b71cb15` · `a0720a9f-fd40-49cc-b2a3-799d541adaaa` · `1280fd9b-87b2-4014-95ae-56baeb2e0fa2`
- **PHASE_1_SLIP_UNDER_REVIEW (2)**: `b289c296-f35b-483a-a534-7f0aa9b80c31` · `71428be8-b64f-4601-a523-f14b723c809e`
- **DOC_FEE_PAID (5)**: `2e1c7ce2-13ec-4daa-aad3-65340a3a43dd` · `f611a7ef-b745-431a-8897-10ca6a985791` · `5136f1ed-f5a2-42d4-8ff8-fe2066eefc60` · `7ab438a8-c744-4b44-a67f-3653605b1316` · `771067e4-85a3-4896-89f3-b26724b319a5`
- **PENDING_AUDIT_FEE (1)**: `297088db-bb4a-4c43-ba7b-e81b2a643cde`
- **AUDIT_CONFIRMED (1)**: `f866374a-8f6b-4c7a-b850-bd09491db042` (ใบเดียวกับ plot specimen)
- **CERTIFIED (1) — heal เพื่อความถูกต้องของ metadata เท่านั้น, ไม่ re-issue**: `10e13c50-949d-461d-8a1a-e43673b5e5c0`
  (`APP-2569-MSZ1JR6W-83BD0E`) — ใบนี้ mint cert ไปแล้วด้วย silent default (`farmData.totalAreaUnit`
  ว่าง → `certificate-service.js:561` เคย fallback เป็น Sqm) `farmData.totalAreaSize=5` และ
  `Certificate.farmSize=5` ตรงกัน (unit ที่ default ไปคือ Sqm ซึ่งบังเอิญตรงกับ wizard invariant จริง
  ของใบนี้) **ใบรับรองที่ออกไปแล้วถูกต้อง ไม่ต้อง re-issue** — heal ใบนี้แก้แค่ metadata ใน
  `formData.farmData.totalAreaUnit` ให้ตรงตามหลักฐาน ไม่กระทบใบรับรองที่ออกไปแล้ว

รายละเอียดเต็ม + query สด: `evidence/farm-areaunit-default-task1/live-probe.txt`

### ✅ สถานะปัจจุบัน (2026-08-20) — heal EXECUTED แล้ว, precondition ผ่าน
`--target farm --apply` **รันจริงกับฐานข้อมูลจริงแล้ว** ครบทั้ง 19 ใบ (operator-instructed run,
2026-08-20) — `REMAINING unit-less farmData: 0`, `FARM_AREA_UNIT_HEALED audit rows: 19` — หลักฐาน:
`evidence/farm-areaunit-heal-2026-08-20/final-verify.txt` (commit `1d3196b7`). **เงื่อนไข deploy-order
ของ T3 (ด้านล่าง) ผ่านแล้ว — strict flip ที่ `certificate-service.js` merge ได้ปลอดภัย** ส่วน Step 0
ด้านล่างคงไว้เป็นบริบทเชิงกระบวนการ (ขั้นตอนที่ operator ทำจริงก่อน apply เต็ม 19 ใบ) ไม่ใช่สิ่งที่ยังต้องทำ

### Step 0 — ซ้อมก่อน apply เต็ม (ทำไปแล้ว — เก็บไว้เป็นบริบทเชิงกระบวนการ)
ก่อนแตะใบที่จ่ายเงินแล้วหรือใบ CERTIFIED ได้ซ้อม `--apply` ครั้งแรกกับใบ DRAFT
(`0d0c7cb9-81c5-4fea-92a6-7c5e11589af8` หรือ `c7253718-f08f-47bb-8b63-6fa6ecedc6ed`) แล้วตรวจมือ:
- `formData.farmData.totalAreaUnit` ได้ค่าใหม่ และไม่มี key อื่นใน formData ขยับ (รวม `formData.plots`
  ถ้าใบนั้นมี unit-less plot ด้วย — ต้อง heal แยกคนละคำสั่ง คนละ `--target`)
- `audit_logs` มีแถวใหม่ `action='FARM_AREA_UNIT_HEALED'` พร้อมข้อความไทยตายตัวเดียวกับ plot heal
- `Application.workflowHistory` เพิ่มขึ้น 1 entry พอดี

### คำสั่ง (dry-run ก่อนเสมอ — dry-run เป็น default, เขียนจริงต้องมี `--apply`)
```bash
node scripts/maintenance/heal-plot-area-unit.js \
  --app <id> --target farm --unit Sqm \
  --reason "<เหตุผล>" --source "<เอกสารอ้างอิง>"            # dry-run — ดู diff ก่อน

node scripts/maintenance/heal-plot-area-unit.js \
  --app <id> --target farm --unit Sqm \
  --reason "<เหตุผล>" --source "<เอกสารอ้างอิง>" --apply    # เขียนจริง
```
ห้ามส่ง `--plot` มาพร้อม `--target farm` (สคริปต์ปฏิเสธ — `formData.farmData` เป็นเอกพจน์ ไม่มี index
ให้เลือก) · ทีละใบเท่านั้น (ห้าม wildcard) · แก้ได้เฉพาะฟาร์มที่ **ไม่มี** unit (ไม่มีทาง overwrite) ·
ไม่แตะสถานะ ไม่เรียกออกใบ

### ✅ ลำดับ deploy — SATISFIED (2026-08-20)
**เงื่อนไข "heal ทั้ง 19 ใบให้ครบก่อน T3 deploy/merge" ผ่านแล้ว**: heal รันจริงครบ 19/19,
`REMAINING unit-less farmData: 0` (`evidence/farm-areaunit-heal-2026-08-20/final-verify.txt`,
commit `1d3196b7`) — **strict flip ที่ `certificate-service.js` (T3) merge ได้ปลอดภัยตอนนี้** ไม่มีใบ
unit-less ที่จะไปเดินถึง issuance แล้ว dead-end แบบ F-PLOT-AREAUNIT-DEADEND อีก

ข้อความเดิม (เก็บไว้เป็นบริบทว่าลำดับที่บังคับคืออะไร ก่อนจะถูกทำสำเร็จ):
> **heal ทั้ง 19 ใบให้ครบก่อน** ที่ T3 (strict flip ที่ `certificate-service.js`) จะ deploy/merge
> ถ้า merge ก่อน heal ครบ ใบที่ยังไม่ได้ heal ที่เดินไปถึง issuance จะ dead-end แบบเดียวกับ
> F-PLOT-AREAUNIT-DEADEND ทุกประการ (throw ที่ mint แทนที่จะออกใบสำเร็จ) — ลำดับที่ถูกต้องคือ:
> 1. heal ทั้ง 19 ใบ (operator-run ตาม step 0 + คำสั่งด้านบน) — **ทำแล้ว 2026-08-20**
> 2. ตรวจ audit_logs + workflowHistory ของแต่ละใบหลัง heal — **ทำแล้ว**
> 3. จากนั้นเท่านั้นจึง merge/deploy T3 — **เงื่อนไขผ่าน, merge ได้**
