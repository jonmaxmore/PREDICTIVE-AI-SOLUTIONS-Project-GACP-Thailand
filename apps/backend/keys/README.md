# ⚠️ ห้าม rotate / ห้ามลบ / ห้ามย้าย `private.pem` — DO NOT ROTATE

> ป้ายกำกับนี้ตั้งใจวางไว้เป็นไฟล์แยก **ไม่ใช่เขียนลงใน `private.pem` เอง**
> เพราะการแทรกข้อความลงไฟล์ PEM เสี่ยงทำให้ parser อ่านไม่ผ่าน = ระบบเซ็นใบรับรองล่มทันที

## ทำไมห้าม

`apps/backend/keys/private.pem` คือ **ลายเซ็นดิจิทัลของใบรับรอง GACP ทุกใบที่ออกไปแล้ว**

- `services/crypto/signature-service.js:66` — `this.keyDir = options.keyDir || path.join(__dirname, '../../keys')` ⇒ โฟลเดอร์นี้คือ keyDir ตัวจริง
- อ่านจริงที่ `:347`, `:391`, `:420`, `:557` (และ backup ที่ `:560`)
- `services/receipt-auto-sign-service.js:111` ใช้ผ่าน service เดียวกันสำหรับใบเสร็จ

**กลไกที่ทำให้อันตรายเป็นพิเศษ** — `services/crypto/signature-service.js:353` `ensureLocalKeys()`
**สร้าง RSA keypair ใหม่ให้อัตโนมัติเมื่อโฟลเดอร์ keys ว่าง** โดยไม่มี error ไม่มีคำเตือน
⇒ ถ้าใครลบ/ย้าย/rotate ไฟล์นี้ ระบบจะไม่แจ้งอะไรเลย แต่ **ใบรับรองที่ออกไปแล้วทั้งหมดจะ verify ไม่ผ่าน**
(หน้า `/verify` จะขึ้น AMBER "ยืนยันลายเซ็นดิจิทัลไม่ได้" แทนที่จะเป็นเขียว) — ผูกกับ **GAP-3 / D5**

## ความเสี่ยงที่แท้จริงคืออะไร (และไม่ใช่อะไร)

| | |
|---|---|
| ❌ **ไม่ใช่** | key รั่วขึ้น git — ตรวจชี้ขาดแล้ว 2026-08-06: `git rev-list --objects --all` หา blob `*.pem`/`*.key` **ทั้ง history ทุก branch = 0** · ไฟล์ untracked · `.gitignore:105` (`*.pem`) ครอบอยู่ · ทั้งรีโปมีไฟล์ key/pem ที่ track อยู่ 0 ไฟล์ |
| ✅ **ใช่** | ไฟล์อยู่บนดิสก์แบบไม่เข้ารหัส เป็นของ uid เดียวกับที่รัน dev shell และ coding agent ⇒ อะไรก็ตามที่รันด้วย uid นั้น **อ่านได้และปลอมลายเซ็นได้** |

**ทางแก้ที่ถูกคือ filesystem/process isolation ไม่ใช่การ rotate key**

> ที่มาของป้ายนี้: `docs/audit/SYSTEM-COMPLETENESS-2026-08-05.md` เคยระบุผิดว่า key ใบนี้ "committed to the repo / lives in VCS"
> ซึ่งถ้ามีใครเชื่อแล้วสั่ง rotate ตาม the project rules §7 จะเผาใบรับรองที่ออกไปแล้วทั้งหมดโดยไม่จำเป็น — คำอ้างนั้นถูกถอนแล้วในคอมมิตเดียวกับที่สร้างไฟล์นี้

## ถ้าจำเป็นต้องเปลี่ยน key จริง ๆ

หยุดแล้วถาม operator ก่อน (the project rules §7) — ต้องมีแผนรองรับใบเก่าก่อนเสมอ เช่น เก็บ public key เดิมไว้ verify ย้อนหลัง
หรือใช้ per-issuer namespace (`<keyDir>/namespaces/<ns>/private.pem`, `signature-service.js:247-259`) แทนการทับตัว default
