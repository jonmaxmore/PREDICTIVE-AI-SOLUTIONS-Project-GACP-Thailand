# REQUIREMENT — loop การตรวจลงพื้นที่ต้องวนได้จริง (operator ยืนยัน 2026-08-04)

> **สถานะ: requirement ที่ยืนยันแล้ว ยังไม่ implement**
> operator ตัดสิน 2026-08-04 หลังอ่าน `evidence/PAYMENT-SCHEDULER/REALITY-CHECK-2026-08-04.md`
> **เข้า R2 M4-M7 เป็น scope ที่ต้องมี ไม่ใช่ของแถม**
> เอกสารนี้ **ไม่เสนอ patch** และ **ไม่มีโค้ดถูกแก้** — เป็นการระบุว่าต้องเพิ่มอะไรบ้าง เพื่อให้ตอนลงมือทำไม่ต้องค้นใหม่

---

## 1. มติที่ยืนยันแล้ว

มติ correction loop **"วนได้ไม่จำกัดครั้ง"** ครอบ **ทั้งสอง loop** ไม่ใช่แค่เอกสาร:

```
ลงพื้นที่ / Zoom ไม่ผ่าน → แจ้งประเด็น → 5 วันทำการ → นัดใหม่ → วนได้ไม่จำกัดครั้ง
```

ก่อนหน้านี้ตีความกันว่ามติครอบเฉพาะ loop เอกสาร (`REVISION_REQUESTED`) ซึ่ง**เป็นการตีความที่แคบเกินไป**
operator ยืนยันว่าครอบ loop ลงพื้นที่ด้วย

## 2. สิ่งที่โค้ดวันนี้ทำได้ และทำไม่ได้

**ทำได้แล้ว** — loop เอกสาร วนไม่จำกัดจริง
`ASSIGNED_FOR_REVIEW ⇄ REVISION_REQUESTED` เป็นวงปิดที่ไม่มีตัวนับรอบ
(`apps/backend/services/workflow-transition-service.js:57-58`)

**ทำไม่ได้** — loop ลงพื้นที่ ไปได้ทางเดียวแล้วตัน
`AUDIT_CONFIRMED → CAR_PENDING → CAR_REVIEWING → AUDIT_PASSED` เป็นทางเดินไปหน้าอย่างเดียว
ไม่มีทางกลับไปนัดลงพื้นที่รอบใหม่ ⇒ **ถ้าประเด็นที่พบต้องไปดูของจริงซ้ำ ระบบพาไปไม่ได้**

## 3. edge ที่ต้องเพิ่มใน state machine (ยังไม่แก้)

ตารางสถานะปัจจุบันอยู่ที่ `apps/backend/services/workflow-transition-service.js:56-68`
บรรทัดที่เกี่ยวข้องกับ loop ลงพื้นที่ อ่านได้ตามนี้:

```js
AUDIT_FEE_PAID:   new Set(['AUDIT_CONFIRMED']),                          // :64
AUDIT_CONFIRMED:  new Set(['AUDIT_PASSED', 'CAR_PENDING', 'REJECTED']),  // :65
CAR_PENDING:      new Set(['CAR_REVIEWING', 'EXPIRED']),                 // :66
CAR_REVIEWING:    new Set(['AUDIT_PASSED', 'CAR_PENDING']),              // :67
AUDIT_PASSED:     new Set(['APPROVED', 'CAR_REVIEWING']),                // :68
```

### 3.1 edge ที่ขาด — อย่างน้อย 1 เส้น

| จาก | ไป | ทำไมต้องมี |
|---|---|---|
| `CAR_REVIEWING` | `AUDIT_CONFIRMED` | เกษตรกรส่งหลักฐานแก้ไขกลับมาแล้ว เจ้าหน้าที่อ่านแล้วเห็นว่า **ต้องไปดูของจริงซ้ำ** จึงต้องนัดลงพื้นที่รอบใหม่ · วันนี้ `CAR_REVIEWING` ไปได้แค่ `AUDIT_PASSED` (ผ่าน) หรือ `CAR_PENDING` (ให้แก้อีก) — ไม่มีทางที่สาม |

**ทางเลือกที่ operator ต้องตัดสินตอน implement**: จะใช้ `AUDIT_CONFIRMED` ซ้ำ หรือสร้างสถานะใหม่
(เช่น `AUDIT_RESCHEDULED`) เพื่อให้แยกออกว่าเป็นการตรวจรอบที่เท่าไหร่
· **ข้อดีของการใช้ `AUDIT_CONFIRMED` ซ้ำ**: ประตูและหน้าจอที่มีอยู่ทำงานต่อได้ทันที
· **ข้อดีของสถานะใหม่**: นับรอบได้ และรายงานแยกได้ว่าเคสไหนตรวจซ้ำกี่ครั้ง
· **หมายเหตุ**: คำว่า `AUDIT_RESCHEDULED` **ถูกใช้ไปแล้ว**ในความหมายอื่น (เป็นชนิดของ event ตอนยิงนัดทับ
`apps/backend/routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js:191`) ถ้าจะใช้ชื่อนี้เป็นสถานะ ต้องกันชนกันก่อน

### 3.2 ประตูจัดตารางทั้ง 3 จุดต้องแก้ด้วย — ไม่ใช่แค่ state machine

ทั้งสามจุดเช็คด้วย **ความเท่ากับสถานะเดียว** ไม่ใช่ชุดสถานะ ⇒ ต่อให้เพิ่ม edge แล้ว API ก็ยังปฏิเสธ

| จุด | บรรทัดที่ต้องแก้ | รูปปัจจุบัน |
|---|---|---|
| `routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js` | `:108` | `if (currentState !== 'AUDIT_FEE_PAID')` → 400 |
| `services/audit-scheduling-service.js` | `:450` | `if (currentState !== 'AUDIT_FEE_PAID')` → 409 `INVALID_STATE` |
| `shared/phase2-schedule-gate.js` | `:40` + `:66` | `const SCHEDULABLE_STATE = 'AUDIT_FEE_PAID'` แล้ว `if (currentState !== SCHEDULABLE_STATE)` |

**รูปที่ควรเป็น**: เปลี่ยนจากเทียบค่าเดียวเป็น **allowlist ของสถานะที่นัดได้** ประกาศที่เดียวแล้วให้ทั้งสามจุดอ่านตัวเดียวกัน
(วันนี้ `phase2-schedule-gate.js` มีค่าคงที่อยู่แล้วแต่**อีกสองจุดไม่ได้อ่านมัน** ต่างคนต่างเขียนสตริงเอง = Law 3.6)

### 3.3 ประตูเรื่องเงินไม่ต้องแก้ — ตรวจแล้ว

`isPhase2PaymentConfirmed` (`apps/backend/shared/phase2-schedule-gate.js:42-52`) ตัดสินจาก
**ใบแจ้งหนี้งวด 2 ที่ชำระแล้ว** (`phase2Settlement.phasePaid`) หรือ `application.phase2Status === 'PAID'`
⇒ เคสที่จ่ายงวด 2 ไปแล้วและกำลังวนรอบตรวจ **ยังผ่านประตูนี้อยู่โดยไม่ต้องแก้อะไร**
สอดคล้องกับมติที่ว่า **นัดใหม่ไม่เก็บเงินเพิ่ม**

### 3.4 หน้าจอตัดสินผลตรวจต้องแก้ด้วย

`apps/backend/routes/api/provider/handlers/auditor-audit-decision-handler.js:84-89`
```js
if (currentState === 'CAR_REVIEWING' && decision !== 'PASS') {
    return res.status(400).json({ ... 'CAR_REVIEWING can only transition to AUDIT_PASSED (decision PASS).' });
}
```
ด่านนี้ปิดทุกทางเลือกที่ไม่ใช่ PASS เมื่ออยู่ `CAR_REVIEWING` **ทั้งที่ state machine อนุญาต `CAR_REVIEWING → CAR_PENDING` อยู่แล้ว** (`:67`)
⇒ เป็นด่านที่เข้มกว่า state machine โดยไม่มีเหตุผลเขียนกำกับ · ต้องผ่อนให้รับ decision ที่พาไปนัดใหม่ได้

### 3.5 เส้นตาย 5 วันทำการ — มีอยู่แล้ว ใช้ซ้ำได้

`CAR_PENDING: new Set(['CAR_REVIEWING', 'EXPIRED'])` (`:66`) มีทางหมดอายุอยู่แล้ว
และค่า 5 วันทำการอยู่ที่ `apps/backend/config/business-rules.js:121`
⇒ ข้อ "5 วันทำการ" ของมติ **ไม่ต้องสร้างกลไกใหม่** แต่ต้องยืนยันตอน implement ว่า cron ตัวที่บังคับเส้นตายครอบเส้นนี้จริง

## 4. สิ่งที่ต้องตัดสินตอน implement (ยังไม่ต้องตอบตอนนี้)

1. ใช้ `AUDIT_CONFIRMED` ซ้ำ หรือสร้างสถานะใหม่เพื่อ**นับรอบ**
2. ถ้านับรอบ — เก็บที่ไหน (คอลัมน์ใหม่ หรือ derive จาก audit log)
3. รอบตรวจซ้ำ **ผู้ตรวจคนเดิมหรือคนใหม่** — วันนี้เจ้าหน้าที่จัดคิวเลือกเองอยู่แล้ว แต่ต้องตัดสินว่ามีกฎบังคับไหม
4. รายงานฝั่งบัญชี — ตรวจซ้ำไม่เก็บเงินเพิ่ม แต่**ต้นทุนการลงพื้นที่เพิ่มจริง** ต้องตัดสินว่าบันทึกที่ไหน

## 5. ขอบเขตของเอกสารนี้

- **ไม่มีโค้ดถูกแก้** — `git diff --name-only` ของคอมมิตที่เพิ่มไฟล์นี้มีแต่ไฟล์ markdown
- ทุก `file:line` อ่านจาก `origin/main` ที่ `3183c340` และยืนยันด้วยการเปิดไฟล์จริง
- **ไม่ได้ตรวจฝั่งหน้าจอ** ว่าต้องเพิ่มปุ่มอะไรบ้าง — เอกสารนี้ครอบเฉพาะ state machine กับด่านฝั่ง API
