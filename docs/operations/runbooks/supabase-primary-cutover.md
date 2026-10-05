# Runbook — สลับ gacpth.com ไปใช้ Supabase เป็นฐานข้อมูลหลัก

สถานะ: **ยังไม่ได้รัน และยังไม่ถึงเวลารัน**

มติ operator 2026-08-23: "ตอนนี้เราใช้แค่ url preview ที่เป็นเวอร์ชั่นล่าสุด แต่ staging ให้เป็นเวอร์ชั่นเก่า
… ไม่ต้อง deploy บน staging เราจะ deploy แค่บน preview"

⇒ **ปลายทาง deploy มีตัวเดียวคือ preview.gacpth.com ซึ่งใช้ Supabase อยู่แล้ว** คำสั่ง "Supabase คือ DB หลัก"
จึงเป็นจริงแล้วสำหรับ stack เดียวที่เรา deploy · `gacpth.com` / `staging.gacpth.com` ตั้งใจแช่ไว้ที่เวอร์ชั่นเก่า
พร้อม postgres ในเครื่องของมัน — **ห้ามรัน runbook นี้จนกว่า operator จะสั่งย้าย production**

runbook นี้เก็บไว้ให้พร้อมสำหรับตอนนั้น ของที่ต้องแก้ก่อนย้ายได้ merge ไว้แล้ว (branch `chore/supabase-primary-db`)

หลักฐานประกอบทั้งหมด: `evidence/supabase-primary-2026-08-23/INDEX.md`

---

## สิ่งที่จะเปลี่ยน (เมื่อถึงวันที่สั่งย้าย)

`gacpth.com` และ `staging.gacpth.com` วันนี้เสิร์ฟจาก postgres ในเครื่อง (`gacp_db`)
หลังรัน runbook นี้ ทั้งคู่จะเสิร์ฟจาก Supabase ซึ่งเป็นฐานเดียวกับที่ `preview.gacpth.com` ใช้อยู่แล้ว

**ระหว่างที่ยังไม่ย้าย**: `gacp-postgres` ต้องเปิดอยู่ต่อไป เพราะ stack เวอร์ชั่นเก่ายังใช้มันอยู่
การเปลี่ยนใน `docker-compose.production.yml` (profile `legacy-db`) จะมีผลก็ต่อเมื่อมีการ deploy production
ซึ่งตอนนี้ไม่ทำ — อย่าเผลอรัน `docker compose up` ของ production โดยไม่ได้ตั้งใจย้ายฐาน

## สิ่งที่จะหายไปจากสายตาผู้ใช้ — ต้องตัดสินใจก่อนเริ่ม

`gacp_db` มี **24 บัญชี / 5 คำขอ / 6 สลิป / 2 ใบแจ้งหนี้** ที่ Supabase ไม่มี (บัญชีคนละช่วงเวลากันสนิท
— ในเครื่องสร้าง 3 มิ.ย.–4 ส.ค. บน Supabase สร้าง 16–23 ส.ค.) ไม่มีใบรับรองและไม่มีรายการชำระเงินติดอยู่

พอสลับแล้ว 24 บัญชีนั้นจะเข้าระบบไม่ได้ ต้องสมัครใหม่ ข้อมูลไม่หาย — อยู่ในไฟล์สำรองและใน volume เดิม

**ต้องได้คำตอบจาก operator ก่อนขั้นที่ 2**: ทิ้งไว้ในไฟล์สำรอง หรือย้ายขึ้น Supabase ก่อน
(การย้ายไม่ตรงไปตรงมา เพราะสคีมาในเครื่องตามหลัง 12 migration — ต้องแปลงข้อมูล ไม่ใช่ dump/restore เฉย ๆ)

## เงื่อนไขที่ต้องครบก่อนเริ่ม

- image ของ backend/frontend ต้องสร้างจาก main ปัจจุบัน — ตัวที่รันอยู่เก่ากว่าสคีมา Supabase
  12 migration การชี้ image เก่าไปที่สคีมาใหม่คือการเชิญ 500 ที่หาสาเหตุยาก
- branch `chore/supabase-primary-db` merge เข้า main แล้ว (compose / backup / nginx / preflight)

---

## ขั้นตอน

### 1. สำรอง Supabase ก่อน (ไม่ใช่แค่ฐานในเครื่อง)

```bash
ssh ubuntu@203.0.113.10
cd /opt/gacp-platform
sudo env ENV_FILE=/opt/gacp-platform/.env.preview BACKUP_DIR=/var/backups/gacp/pre-cutover \
    bash scripts/backup/pg-backup.sh
```

ต้องเห็นไฟล์ขนาดหลักร้อย KB ขึ้นไป ถ้าสคริปต์บอก FAILED ให้หยุด

### 2. ชี้ .env.production ไปที่ Supabase

`DATABASE_URL` ใน `/opt/gacp-platform/.env.production` วันนี้คือ

```
postgresql://***@postgres:5432/${DB_NAME}?schema=public
```

เปลี่ยนเป็นค่าเดียวกับที่ `.env.preview` ใช้ (Supabase pooler) เก็บบรรทัดเดิมไว้เป็นคอมเมนต์
เพื่อย้อนกลับได้ใน 10 วินาที และ **คงบรรทัด `DB_PASSWORD` ไว้** ตลอดช่วงที่ยังเปิดทาง rollback

```bash
sudo cp .env.production .env.production.bak-pre-supabase-cutover
sudoedit .env.production      # แก้บรรทัด DATABASE_URL
```

ตรวจว่าไม่พิมพ์ผิด โดยไม่พิมพ์รหัสผ่านออกมา:

```bash
sudo grep -E '^DATABASE_URL=' .env.production | sed -E 's#://[^@]*@#://***@#'
```

### 3. deploy จาก main

```bash
sudo bash scripts/deploy/deploy-preflight.sh          # ต้องเห็น DATABASE_URL defined
sudo bash scripts/deploy/deploy-production.sh
```

ขั้น [2/7] จะสำรอง **Supabase** ผ่านสาย (ไม่ใช่ container ในเครื่องอีกแล้ว) ถ้าล้ม มันจะหยุดก่อนแตะอะไร

### 4. ปิด postgres และ pgadmin ในเครื่อง

หลัง deploy ผ่านและเว็บใช้งานได้จริง:

```bash
sudo docker stop gacp-pgadmin gacp-postgres
```

ยังไม่ต้องลบ — volume `gacp-postgres-data` คือทางถอย compose ประกาศทั้งสองตัวไว้ใต้ profile `legacy-db`
แล้ว จึงไม่สตาร์ตเองอีกต่อไป ถ้าต้องเปิดอ่านชั่วคราว:

```bash
sudo docker compose --env-file .env.production -f docker-compose.production.yml \
     --profile legacy-db up -d postgres
```

### 5. ตรวจว่าใช้งานได้จริง (กดจริง ไม่ใช่ดู log)

- `https://gacpth.com` เปิดได้ ล็อกอินด้วยบัญชีที่อยู่บน Supabase ได้
- เปิดคำขอสักใบ ดูเอกสารแนบ โหลด PDF ใบรับรอง
- `https://gacpth.com/api/pricing/fees` ต้องได้ 35,310 / 70,620 / 105,930 ต่อ 1/2/3 รูปแบบการปลูก
- `https://gacpth.com/pgadmin/` ต้องได้ 404 (ไม่ใช่ 502)
- จำนวนแถวฝั่ง Supabase ต้องไม่ลดลงจากก่อน cutover

### 6. ตรวจว่าแบ็กอัพรายวันยังทำงาน

นี่คือขั้นที่พลาดแล้วเงียบที่สุด — cron เดิมสำรองจาก container ที่ตอนนี้ปิดไปแล้ว

```bash
sudo bash scripts/backup/pg-backup.sh                 # ต้องขึ้นชื่อ host ของ Supabase ใน log
cat /etc/cron.d/gacp-backup
```

พรุ่งนี้กลับมาดูว่ามีไฟล์ใหม่ใน `/var/backups/gacp/scheduled/daily/` จริง

---

## ทางถอย

```bash
sudo cp .env.production.bak-pre-supabase-cutover .env.production
sudo docker compose --env-file .env.production -f docker-compose.production.yml \
     --profile legacy-db up -d postgres
sudo bash scripts/deploy/deploy-production.sh
```

ข้อมูลที่เขียนลง Supabase ระหว่างช่วงที่สลับไปแล้วจะไม่ตามกลับมาที่ `gacp_db` — ยิ่งถอยช้ายิ่งเสียมาก

## ปิดงานเมื่อไหร่

เมื่อ operator พอใจว่าไม่ต้องถอยแล้ว: ลบ service `postgres` และ `pgadmin` กับ volume
`gacp-postgres-data` ออกจาก `docker-compose.production.yml` เป็นใบแยก (contract step)
พร้อมกับตัดสินใจเรื่อง stack `gacp-*-staging` ที่ไม่มีโดเมนวิ่งเข้าและยังผูกกับ postgres ในเครื่องอยู่
