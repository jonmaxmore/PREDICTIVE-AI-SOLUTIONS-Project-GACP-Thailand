# Herb reference content (ต้นแบบที่ 5 — ก) — AI draft, pending SSRU verification

ปิดช่องว่าง **ก** ของเอกสารส่งงาน C05F680149: ฐานข้อมูลสมุนไพร 6 ฐาน **≥300 รายการ/ฐาน**
(รวม ≥1,800). เนื้อหาในโฟลเดอร์นี้ทำหน้าที่ **พิสูจน์ pipeline นำเข้า + KPI coverage**
บน staging และเป็น **ร่างตั้งต้นให้ SSRU ตรวจ/ยืนยัน**.

## ⚠️ ความซื่อสัตย์ (อ่านก่อนใช้)

- `data/*.json` = **ร่างอ้างอิงที่เรียบเรียงโดย AI (AI_DRAFT)** อิงองค์ความรู้เกษตร/
  พฤกษศาสตร์/กฎหมายมาตรฐานทั่วไป — **ไม่ใช่** ข้อมูลวิจัยที่ตรวจสอบแล้วของ SSRU.
- ทุกแถวติดป้าย `source` = `AI_DRAFT: … — ต้องตรวจสอบกับ SSRU`.
- เขียนแบบระมัดระวังในโดเมนที่ควบคุม (กัญชา/กระท่อม): **ไม่**ให้ขนาดยาในมนุษย์,
  **ไม่**แนะนำการใช้เพื่อเสพ/นันทนาการ, **ไม่**อ้างรักษาหายขาด — เน้น GACP
  (การปลูก/คุณภาพ/เก็บเกี่ยว/แปรรูป/โรค/กฎหมาย/สัณฐาน).
- **ห้ามนำขึ้น production เป็นข้อมูลทางการก่อน SSRU ตรวจยืนยัน** — `import-to-staging.js`
  ปฏิเสธ host `gacpth.com` ที่ไม่ใช่ staging โดยอัตโนมัติ.

## ที่มา (provenance)

1. เนื้อหาดิบสร้างโดย workflow หลายเอเจนต์ (grounded Thai agronomy/phytochemistry,
   source-tagged) → JSON per herb×category.
2. `scan-and-assemble.js` = **ชั้น accountability ก่อนนำเข้า**: validate ตรง entrySchema
   ของ `herb-knowledge-service` (category enum, title ≤500, content ≤20000, unit ≤50,
   source ≤500; omit unit/valueNumber ที่ว่าง — zod `.optional()` ไม่รับ `null`) +
   red-flag scan (กันคำแนะนำขนาดยา/การเสพ/อ้างรักษาหาย) + normalize `source` ให้มี
   marker `AI_DRAFT` + `ต้องตรวจสอบกับ SSRU` + dedup ชื่อซ้ำต่อฐาน + รายงาน coverage.
3. `data/*.json` = ผลลัพธ์ที่ผ่านชั้น (2) แล้ว (พร้อมนำเข้า, reviewable ใน repo).

## ผล (staging, 2026-07-11)

`herbsMeetingTarget = 6/6` — CANNABIS 312 · TURMERIC 313 · GINGER 312 ·
BLACK_GALINGALE 310 · PLAI 310 · KRATOM 312 (วัดผ่าน `/api/herbs/coverage` จริง).

## วิธีรันซ้ำ (idempotent)

```bash
# 1) validate + assemble (จาก dir เนื้อหาดิบ) → data/ ในเรโป (ผ่าน outDir ก็ได้)
node scripts/herb-content/scan-and-assemble.js <rawDir> <outDir>

# 2) import เข้า staging (login admin → CSRF → clear AI_DRAFT เดิม → import → verify)
node scripts/herb-content/import-to-staging.js \
  scripts/herb-content/data https://staging.gacpth.com <providerId> <password>
```

`import-to-staging.js` เป็น idempotent: ล้างแถว `source` ที่ขึ้นต้น `AI_DRAFT` เดิมก่อน
แล้วจึง import ใหม่ (รันซ้ำไม่ทำให้เกิน/ซ้ำ). starter seeds (`seed-herbs.js`) ไม่ถูกแตะ.

## งานต่อของ SSRU

ตรวจ/แก้/ยืนยันเนื้อหา (หรือแทนที่ด้วยข้อมูลวิจัยของ SSRU) → เปลี่ยน `source` จาก
`AI_DRAFT` เป็นแหล่งอ้างอิงจริง → owner อนุมัติ → import ขึ้น prod ด้วย pipeline เดียวกัน.
