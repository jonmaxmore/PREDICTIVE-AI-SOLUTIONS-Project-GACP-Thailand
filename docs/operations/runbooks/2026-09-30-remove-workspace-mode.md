# Runbook — ถอดโหมด workspace: R1 deploy · D0 · D1

สถานะ: **ยังไม่ได้รัน** · ที่มา: spec design note 2026-09-30-remove-workspace-mode-design §3.1 (D0), §3.5 (D1), §5

> ขั้นที่เขียนฐานข้อมูลหรือ deploy ทุกขั้นในไฟล์นี้ = **operator เท่านั้น** (ติดป้าย `[OPERATOR-ONLY]`)
> agent รันได้เฉพาะขั้นอ่าน และห้ามชี้สคริปต์ไปที่ staging/demo เอง
>
> ไฟล์นี้ไม่มี connection string หรือคีย์จริง — `<...>` คือที่ว่างให้ operator ใส่จากที่เก็บความลับ
> ห้าม echo/พิมพ์ค่าเหล่านั้นลงจอ, log หรือ report

## ลำดับ

<a id="r1-neutral"></a>**R1 ไม่เปลี่ยนคำตอบของประตูใดเทียบกับ main ก่อน R1 (operator ruling C1)** — รวมถึงคำขอ ใบแจ้งหนี้
ใบเสนอราคา และใบรับรองของคำขอที่ `entityId` ว่าง และรวมถึงผู้ใช้ที่ไม่มี entity เลย (middleware หา entity
ส่วนตัวไม่เจอ จึงไม่มีบริบท entity) กับคำขอที่ middleware หาสมาชิกภาพไม่สำเร็จชั่วคราว (ตกไปทางไม่มีบริบทเช่นกัน):
ใน R1 ตัวตรึงผู้ยื่นเดิมของแต่ละประตู (R1-legacy-pin) เป็นตัวตัดสินแถว ผู้ยื่นจึงเห็นแถวของตัวเองเท่าเดิม
**ไม่ว่า D1 จะรันแล้วหรือยัง** (หลักฐาน: `evidence/remove-workspace-mode/final-fix/green.txt` — เมทริกซ์
r1-application-reads ผู้ใช้ N + แถว transient, r1-cert-doc-finance N/aN/nN, r1-billing Z/aN/gN เทียบ main e33666b9)

D1 จึงไม่ใช่เงื่อนไขของ R1 แต่เป็น **เงื่อนไขของ R2**: R2 ถอดตัวตรึงผู้ยื่น (Task 12) จากนั้นแถวที่ `entityId`
ว่างจะไม่มีใครฝั่งผู้ยื่นเห็น และผู้ใช้ที่ไม่มีสมาชิกภาพเลยจะเห็นรายการว่าง · D0 และ D1 ใช้กับโค้ดเก่าได้
(D0 อ่านอย่างเดียว · D1 แค่เติม `entityId` ที่ว่าง) จึงรันก่อนหรือหลัง R1 deploy ก็ได้

ลำดับแนะนำ (ตามที่ operator รับไว้ 2026-09-30): D0 → D1 (staging) → D1 (demo) → R1 deploy → R1 walk ·
R2 เริ่มได้เมื่อ D1 = `0 | 0` ทั้งสองฐาน

## ใส่ connection string อย่างไร (ทุกขั้น)

เก็บ URL ของแต่ละฐานไว้ในไฟล์ของ operator สิทธิ์ `0600` ไฟล์ละฐาน (`<STAGING_URL_FILE>`, `<DEMO_URL_FILE>`)
แล้วส่งให้คำสั่ง **ใน step เดียวกับคำสั่งนั้นเสมอ** ด้วย `DATABASE_URL="$(cat <..._URL_FILE>)" <คำสั่ง>`
— ค่าเข้าไปเฉพาะ process นั้น ไม่ค้างในเชลล์ ไม่ต้อง `unset` และไม่มีช่วงที่ "ลืม export"

ห้าม: `export DATABASE_URL=...` ค้างไว้ในเชลล์ · `unset` ระหว่าง dry run กับ apply · พิมพ์ค่า/`echo` ค่า

สคริปต์ heal ปฏิเสธเองถ้า DATABASE_URL ไม่ได้มากับ environment ตอนเริ่ม (ค่าจาก `apps/backend/.env`
ไม่ถูกใช้เด็ดขาด) และ `--apply` ปฏิเสธถ้าลายนิ้วมือฐานไม่ตรงกับแผนที่ตรวจ

## วิธีอ่านฐานข้อมูล (ทุกขั้นอ่าน)

ทุก query ห่อด้วย `BEGIN READ ONLY; ...; ROLLBACK;` **ต่อ query** — ห้าม `SET` / `RESET` บน pooler (6543)
เพราะ session SET รั่วข้าม connection ใน pool (บันทึก 2026-09-27: staging เคยกลายเป็น read-only ทั้งก้อนจาก SET เดียว)

```bash
psql "$(cat <STAGING_URL_FILE>)" -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; <QUERY>; ROLLBACK;"
```

## D0 — บัญชีเจ้าหน้าที่ที่ถือสมาชิกภาพ (อ่านอย่างเดียว)

```sql
BEGIN READ ONLY;
SELECT count(*) FROM entity_memberships m JOIN users u ON u.id = m."userId" WHERE m.status = 'ACTIVE' AND u.role <> 'health';
ROLLBACK;
```

คาด: **0** ทั้ง staging และ demo
ถ้าไม่เป็น 0: หยุด รายงาน operator — ตาม spec §3.1(b) การอ่านของบัญชีเหล่านั้นจะกว้างขึ้นเป็นเท่าที่องค์กร
และ RBAC ของเขาอนุญาต ต้องให้ operator ยืนยันว่ารับได้ก่อนไปต่อ

## D1 — เติมผู้ถือให้แถวเก่า

สคริปต์: `apps/backend/scripts/heal-null-holders.js` — ค่าเริ่มต้นคือดูอย่างเดียว อาร์กิวเมนต์ที่ไม่รู้จักถูกปฏิเสธ (exit 2)

รันจาก checkout ของ commit ที่จะ deploy บนเครื่องที่ต่อฐานได้ (ไม่ใช่ใน container — container เขียน
`/app/evidence` ไม่ได้และไฟล์จะหายไปกับ container) หลัง `pnpm install` + `npx prisma generate` ใน `apps/backend`

1. **ดูอย่างเดียว** (operator หรือ agent ที่ได้รับคำสั่ง):

   ```bash
   cd apps/backend
   DATABASE_URL="$(cat <STAGING_URL_FILE>)" node scripts/heal-null-holders.js --db-label=staging
   ```

   ผล: `evidence/heal-null-holders/staging-<db>-<ISO>-plan.csv`
   บรรทัดแรก `# heal-null-holders plan label=staging db=<ลายนิ้วมือ 8 hex> rows=<n>` แล้วคอลัมน์
   `table,id,status,chosenEntityId,rule,evidence` · ลายนิ้วมือ = sha256 ของ user@host:port/db (ไม่รวมรหัสผ่าน)
   ย้อนกลับเป็น URL ไม่ได้ — สคริปต์ไม่พิมพ์ URL ส่วนใดเลย

2. **ตรวจไฟล์แผน** — ทุกแถวต้องอธิบายได้ ห้ามแก้ไฟล์ (แก้แล้ว `--apply` จะปฏิเสธเพราะไม่ตรงฐาน):

   | rule | ความหมาย | การกระทำ |
   |---|---|---|
   | `APP_FILER_SINGLE_PERSONAL_ENTITY` | applicantType เป็น INDIVIDUAL/ไม่ระบุ + ผู้ยื่นมี OWNER INDIVIDUAL ACTIVE หนึ่งเดียว | `--apply` เติมให้ |
   | `FARM_CERTIFICATE_APPLICATION_ENTITY` | ใบรับรองที่ระบุฟาร์มนี้ชี้ไปที่ผู้ถือของคำขอหนึ่งเดียว และเจ้าของฟาร์มเป็นสมาชิก ACTIVE ของผู้ถือนั้น (ถ้าไม่ ACTIVE = `UNPLACED_OPERATOR_DECIDES` evidence `owner not ACTIVE on <id>` — ไม่ตกไปกฎ entity ส่วนตัว) | `--apply` เติมให้ |
   | `FARM_OWNER_SINGLE_PERSONAL_ENTITY` | ฟาร์มที่ไม่มีผู้ถือจากใบรับรองเลย + เจ้าของฟาร์มมี entity ส่วนตัวหนึ่งเดียว | `--apply` เติมให้ |
   | `UNPLACED_DRAFT_DELETE_ON_OPERATOR_WORD` | คำขอ DRAFT ที่กฎวางไม่ได้ | ลบเมื่อ operator สั่งเท่านั้น (Q2) — สคริปต์ไม่ลบ |
   | `UNPLACED_OPERATOR_DECIDES` | คำขอที่ไม่ใช่ DRAFT หรือฟาร์ม ที่กฎวางไม่ได้ (เช่น ประกาศ JURISTIC, มีสองตัวเลือก) | operator ตัดสินรายแถว (Q2) โดยเฉพาะแถวที่มีใบรับรอง |

3. **`[OPERATOR-ONLY]` เขียนจริง** — ผูกกับแผนที่ตรวจในข้อ 2:

   ```bash
   DATABASE_URL="$(cat <STAGING_URL_FILE>)" node scripts/heal-null-holders.js \
     --apply --db-label=staging --plan=../../evidence/heal-null-holders/<ไฟล์แผนจากข้อ 1>
   ```

   ก่อนต่อฐาน สคริปต์ปฏิเสธ (exit 2) ถ้า: ไม่มี DATABASE_URL ใน environment · ไม่มี `--plan` หรือ `--db-label`
   · `--db-label` ไม่ตรงกับ label ในแผน · ลายนิ้วมือฐานไม่ตรงกับ `db=` ในแผน (= กำลังชี้ผิดฐาน)
   หลังต่อฐาน สคริปต์วางแผนใหม่แล้วเทียบรายแถว (table, id, chosenEntityId, rule) กับแผน — ต่างแม้แถวเดียว
   = ปฏิเสธ **ก่อนเขียนแถวแรก** (exit 3, พิมพ์ table|id ที่ต่าง) → กลับไปข้อ 1 ทำแผนใหม่และตรวจใหม่
   เขียนด้วย `updateMany where { id, entityId: null }` — แถวที่ถูกเติมระหว่างนั้นถูกข้าม ไม่ถูกทับ

   ผล: `evidence/heal-null-holders/staging-<db>-<ISO>-applied-rollback.csv` = **รายการย้อนกลับ**
   มีเฉพาะแถวที่รอบนี้เขียนจริง (`table,id,entityId`) แถวที่ข้ามเพราะถูกเติมไปก่อนแล้วไม่อยู่ในไฟล์นี้

4. **`[OPERATOR-ONLY]` แถวที่วางไม่ได้** — ลบ DRAFT / ตัดสินรายแถวตาม Q2 ด้วยมือ ไม่มีสคริปต์ทำแทน

5. **ตรวจ** (อ่านอย่างเดียว):

   ```sql
   BEGIN READ ONLY;
   SELECT (SELECT count(*) FROM applications WHERE "entityId" IS NULL) apps, (SELECT count(*) FROM farms WHERE "entityId" IS NULL) farms;
   ROLLBACK;
   ```

   คาด: **`0 | 0`** บน staging และบน demo — นี่คือ deploy gate D1 ของ R2 (spec §3.5) จนกว่า NOT NULL
   follow-up จะลง

ทำซ้ำข้อ 1-5 กับ demo ด้วย `--db-label=demo` และ `<DEMO_URL_FILE>` (แผนของ staging ใช้กับ demo ไม่ได้ —
ลายนิ้วมือต่างกัน สคริปต์ปฏิเสธ)

## R1 deploy — `[OPERATOR-ONLY]`

คำตอบของทุกประตูเท่ากับ main ก่อน R1 — ข้อความเต็มและขอบเขตอยู่ที่ [ลำดับ](#r1-neutral) (รวมแถว `entityId` ว่าง
และผู้ใช้ที่ไม่มี entity) · สิ่งที่ R1 เพิ่ม: holder fragment ในทุกการอ่านฝั่งผู้ยื่น (คู่กับตัวตรึงผู้ยื่นเดิมในรูป OR)
+ witness โหมด shadow

1. image + restart ตามขั้นตอนปกติของ staging (migrate ก่อนถ้า main นำหน้าฐาน — R1 ไม่มี migration ใหม่)
2. **staging walk หนึ่งรอบ** ด้วยบัญชีผู้ยื่นทดสอบ: login → รายการคำขอ → เปิดคำขอ → ยื่น → ชำระ (Stripe test mode)
3. อ่าน metric ของ witness จาก backend ที่เพิ่ง restart (endpoint ภายใน ไม่เปิดสาธารณะ):

   ```bash
   docker exec <BACKEND_CONTAINER> wget -qO- http://127.0.0.1:<BACKEND_PORT>/metrics | grep health_read_unscoped_total
   ```

   คำสั่งนี้สมมติว่ามี `wget` ใน image (image เป็น `node:24-alpine` — `apps/backend/Dockerfile:59` ติดตั้ง `curl`
   ไว้ที่ :72 ส่วน `wget` มาจาก busybox ของ alpine ซึ่งยังไม่ได้ตรวจบน image ที่รันจริง) ถ้าไม่มี ใช้ node ที่มีอยู่แน่นอน:

   ```bash
   docker exec <BACKEND_CONTAINER> node -e "require('http').get('http://127.0.0.1:<BACKEND_PORT>/metrics',(r)=>r.pipe(process.stdout)).on('error',(e)=>{console.error(e.message);process.exit(1)})" | grep health_read_unscoped_total
   ```

   คาด: ไม่มีบรรทัดตัวอย่าง หรือทุกบรรทัดเป็น **0** — ชื่อ metric ในโค้ดคือ `health_read_unscoped_total`
   (`apps/backend/shared/prometheus.js:62` ไม่มี prefix `gacp_backend_`)
   ถ้าไม่เป็น 0: log ที่มี `signal: HEALTH_READ_UNSCOPED` บอก model, op, route — ประตูนั้นยังอ่านโดยไม่มี
   holder fragment ต้องแก้ก่อน R2
4. deploy demo ตามเมื่อ staging ผ่าน

## Rollback

- R1: image ก่อนหน้า (ไม่มี migration ให้ย้อน)
- D1: การเติมเป็นการเพิ่มข้อมูลและโค้ดเก่าทนได้ — ปกติไม่ต้องย้อน · ถ้าต้องย้อน `[OPERATOR-ONLY]` ใช้
  **เฉพาะ** `...-applied-rollback.csv` ของรอบนั้น (ไม่ใช่ไฟล์แผน — แผนมีแถวที่สคริปต์ไม่ได้เขียน) ตั้ง
  `entityId` กลับเป็น NULL เฉพาะแถวที่ยังมีค่าเท่ากับคอลัมน์ `entityId` ในไฟล์ (`WHERE id = <id> AND
  "entityId" = <entityId>`) เพื่อไม่ลบผู้ถือที่ถูกเปลี่ยนหลังจากนั้น
