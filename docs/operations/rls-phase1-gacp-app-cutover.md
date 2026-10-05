# Runbook: ย้ายแอปไปใช้ role `gacp_app` — RLS Phase 1 cutover (staged, reversible)

**สถานะ:** active
**เจ้าของ:** platform operator
**เขียนเมื่อ:** 2026-08-17
**ขอบเขต:** ย้าย role ที่แอปใช้เชื่อมต่อฐานข้อมูล (Phase 1 เท่านั้น) — **ไม่แตะ policy บังคับ** (Phase 2/3)
**ที่มา:** RLS Phase 1 (role decouple) Task 1–4 บนกิ่ง `feat/rls-phase1-role-decouple`
(design note 2026-08-17-rls-phase1-role-decouple)
**เอกสารคู่กัน:** `docs/operations/env-layering.md` §2.3b + §4 (ที่มาของ `APP_DB_USER`/`APP_DB_PASSWORD`
+ เหตุผลที่ต้อง recreate), `docs/operations/runbooks/rotate-database-credential.md` (รูปแบบคำสั่ง
`docker compose ... up -d --force-recreate` ชุดเดียวกัน)

---

## 0. สรุปสั้นสำหรับคนรีบ

1. Phase 1 ย้าย **ใครเชื่อมต่อฐานข้อมูล** จาก superuser (`gacp`) ไปเป็น role least-privilege ใหม่
   (`gacp_app`) — policy ยังเป็น `SELECT TRUE` เหมือนเดิมทุกประการ ไม่มีการบังคับ RLS ในเฟสนี้
2. ทำทีละสภาพแวดล้อม: **staging ก่อนเสมอ** นิ่งอย่างน้อย 1 วันทำการ แล้วค่อย prod
3. Rollback คือ unset ตัวแปรสองตัวแล้ว recreate — ไม่แก้ compose ไม่แตะ policy จึงย้อนได้เสมอ
4. คำสั่งด้านล่างรันจาก `/opt/gacp-platform` บน droplet (ธรรมเนียมเดียวกับ runbook อื่นในโฟลเดอร์นี้)

---

## 1. Pre-req

- **`ADMIN_DATABASE_URL`** — connection string ของ **superuser** (role `gacp` เดิม)
  รูปแบบ `postgresql://gacp:<รหัสของ gacp>@<host>:5432/<db>?schema=public`
  ใช้ชื่อตัวแปรนี้ตัวเดียวตลอดเอกสารนี้ — นี่คือชื่อเดียวกับที่สคริปต์ maintenance ใน Task 4 อ่านจริง
  (`apps/backend/scripts/lib/admin-db-url.js:4-8`)
- รหัสผ่านใหม่สำหรับ `gacp_app` — สร้างตอนรัน provisioning ในข้อ 2 ไม่ต้องเตรียมล่วงหน้า

```bash
export ADMIN_DATABASE_URL="postgresql://gacp:<รหัสของ gacp>@<host>:5432/<db>?schema=public"
```

---

## 2. Provision (staging ก่อนเสมอ)

SQL provisioning ของ Task 1 รันโดย superuser, idempotent, ให้สิทธิ์ DML บน**ทุกตาราง** public
+ ตั้ง default privileges กันดริฟท์ในอนาคต — **ไม่แตะ policy** เลย
(ยืนยันจากตัวสคริปต์ `apps/backend/scripts/rls/gacp-app-provision.sql:82-83`)

```bash
APPPW="$(openssl rand -hex 24)"
psql "$ADMIN_DATABASE_URL" -v apppw="$APPPW" \
  -f apps/backend/scripts/rls/gacp-app-provision.sql
# เก็บ $APPPW ไว้ใน password manager ทันที (ต้องใช้ที่ข้อ 4) — ห้ามพิมพ์/log ค่านี้ออกมา
```

ทำไมต้องส่ง `-v apppw=`: สคริปต์เช็คก่อนเริ่มว่าตัวแปรนี้ถูกส่งมาหรือไม่ (`\if :{?apppw}` ที่บรรทัด 36)
แล้ว `\quit` ทันทีถ้าไม่มี — กัน hardcode รหัสไว้ในไฟล์และกันรันเผลอไม่ตั้งรหัส
`hex` ล้วนไม่มีอักขระที่ชนไวยากรณ์ URL/shell จึงวางลงไฟล์ env ตรง ๆ ได้โดยไม่ต้อง escape

---

## 3. Verify grants

```bash
DATABASE_URL="$ADMIN_DATABASE_URL" node apps/backend/scripts/rls/gacp-app-coverage-probe.js
```

ต้องได้ `PASS: gacp_app has full DML on every public base table.`
ถ้าได้ `FAIL: ...` พร้อมรายชื่อตาราง — **หยุดตรงนี้ ห้ามไปข้อ 4** (provisioning ในข้อ 2 idempotent
รันซ้ำได้ปลอดภัย ลองรันใหม่แล้ว verify อีกครั้ง)

Probe นี้ถูกออกแบบให้รันซ้ำได้หลัง migration ในอนาคตทุกครั้งเช่นกัน (คอมเมนต์หัวไฟล์
`apps/backend/scripts/rls/gacp-app-coverage-probe.js:6-7`) — **ณ วันที่เขียนนี้ยังไม่ได้ต่อเข้า
pipeline อัตโนมัติใด ๆ** (grep `.github/workflows/` และ `scripts/probes/probe-registry.txt` ไม่พบ
การอ้างถึงไฟล์นี้ และ GitHub Actions hosted runner เองก็ปิดอยู่ตามคำสั่ง operator ตั้งแต่ 2026-08-14
— `scripts/ci/local-gate.sh:4-5`) จนกว่าจะมีคนต่อสายนี้เข้า pipeline จริง ให้รันคำสั่งข้างบนด้วยมือ
ทุกครั้งหลัง `prisma migrate deploy`

---

## 4. Cut over staging

แก้ `/opt/gacp-platform/.env.staging` เพิ่ม/แก้สองบรรทัด

```
APP_DB_USER=gacp_app
APP_DB_PASSWORD=<ค่า $APPPW จากข้อ 2>
```

> ⚠️ **ห้ามตั้ง `DB_USER=gacp_app`** — `DB_USER` คุมเฉพาะ `POSTGRES_USER` ของคอนเทนเนอร์ postgres
> (bootstrap superuser) กับ `pg_isready -U` ของ healthcheck ไม่เกี่ยวกับ connection ของแอปเลย
> (`docs/operations/env-layering.md` §2.3b) มีแค่ **`APP_DB_USER`** ตัวเดียวที่ย้าย connection ของแอปจริง

**Recreate ห้าม `restart`** — ค่าที่ compose ประกอบเข้า `DATABASE_URL` ไม่ถูกอ่านใหม่ระหว่างคอนเทนเนอร์
กำลังรันอยู่ ต้องสั่ง `up -d` ใหม่เท่านั้น (`docs/operations/env-layering.md` §4)

```bash
cd /opt/gacp-platform
docker compose --env-file .env.staging \
  -f docker-compose.production.yml -f docker-compose.staging.yml \
  up -d --force-recreate --no-deps backend-staging
```

สอง `-f` ต้องมาด้วยกันเสมอสำหรับ staging: `backend-staging` ต่อ network `gacp-network` ที่ประกาศใน
`docker-compose.production.yml:545-546` (ไม่ได้ประกาศซ้ำใน `docker-compose.staging.yml`) — รูปแบบ
คำสั่งนี้ตรงกับที่ใช้จริงใน `docs/operations/runbooks/rotate-database-credential.md:429-431`
(`--no-deps` กันไม่ให้ postgres/redis/minio ที่ `backend-staging` ไม่ได้ประกาศ depends_on ตรง ๆ
ถูกแตะไปด้วยโดยไม่ตั้งใจ)

จากนั้น:
1. รัน full test suite
2. Smoke boot-critical paths: login, application read + write หนึ่งรอบ, checkout หนึ่งรอบ,
   Stripe webhook หนึ่งครั้ง
3. เฝ้า log หา `permission denied for table` เป็น**เวลาต่อเนื่อง ≥ 1 วันทำการ**

```bash
docker logs gacp-backend-staging --tail 200 -f | grep -i 'permission denied for table'
```

เจอแม้บรรทัดเดียว = มีตารางตกหล่นจาก provisioning (ข้อ 2) → rollback ทันที (ข้อ 7) แล้วสืบว่า
ตารางไหนหลุดจาก probe (ข้อ 3) ก่อนลองใหม่

---

## 5. ชี้สคริปต์ maintenance ไปที่ superuser

สคริปต์สามตัวนี้ทำ `TRUNCATE`/`ALTER`/`DROP` ซึ่ง `gacp_app` (least-privilege) ทำไม่ได้ — แยกเป็นสองกลุ่ม

| สคริปต์ | ต้องตั้งอะไร | ถ้าไม่ตั้ง |
| --- | --- | --- |
| `apps/backend/scripts/clear-for-uat.js` | `export ADMIN_DATABASE_URL=<superuser URL>` | resolve ผ่าน `resolveAdminDbUrl()` (`apps/backend/scripts/lib/admin-db-url.js:4-8`) — fallback ไป `DATABASE_URL` (ของ `gacp_app`) พร้อม warning `[admin-db] ADMIN_DATABASE_URL unset — falling back to DATABASE_URL; TRUNCATE/ALTER/DROP will FAIL under gacp_app` (`clear-for-uat.js:93-96`) แล้ว `TRUNCATE` จะ FAIL กลางคัน |
| `apps/backend/scripts/migrate-user-types.js` | เหมือนแถวบน | เหมือนแถวบน — คำเตือนเดียวกัน (`migrate-user-types.js:23-26`), `ALTER`/`DROP` แทน `TRUNCATE` |
| `apps/backend/scripts/run-role-canonicalization.sh` | **ไม่ใช้ `ADMIN_DATABASE_URL`** — คง `DB_USER=gacp` (ค่าเริ่มต้นของสคริปต์เอง ไม่ต้องตั้งอะไรเพิ่ม) เพราะต่อผ่าน `docker exec ... psql -U "$DB_USER"` ตรง ๆ | มีการ์ดที่ `run-role-canonicalization.sh:36` — ถ้า shell ตั้ง `DB_USER=gacp_app` ไว้ (เช่นเผลือ export ค้างจากงานอื่น) สคริปต์ **ตาย (`die`) ทันทีก่อนแตะฐานข้อมูล** |

```bash
export ADMIN_DATABASE_URL="postgresql://gacp:<รหัสของ gacp>@<host>:5432/<db>?schema=public"
node apps/backend/scripts/clear-for-uat.js          # ดู flag/guard เต็มในคอมเมนต์หัวไฟล์
node apps/backend/scripts/migrate-user-types.js
```

---

## 6. Prod cutover

ต้องมี **owner + reviewer มนุษย์คนที่สอง** เซ็นรับก่อนเริ่ม — เป้า G3 ต้องการให้ reviewer คนที่ 2
มีสิทธิ์ merge Tier C จริง (`GOALS.md:51`) และ the project rules ผูก Tier C (เงิน/auth/identity/schema/
migration) ไว้กับ operator merge เสมอ — งานย้าย role ฐานข้อมูลเข้าเกณฑ์ Tier C

ทำซ้ำข้อ 2–5 ทุกขั้น สลับไฟล์เป็นของ prod ใน **maintenance window ที่ประกาศล่วงหน้า**:

```bash
cd /opt/gacp-platform
docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  up -d --force-recreate --no-deps backend
```

(`.env.production` แทน `.env.staging`, container ที่เฝ้า log คือ `gacp-backend` ไม่ใช่
`gacp-backend-staging` — ไฟล์เดียวก็พอเพราะ `backend` อยู่ใน `docker-compose.production.yml` เอง
ไม่ต้องรวมไฟล์ staging)

---

## 7. Rollback (instant)

```bash
cd /opt/gacp-platform
# ลบ (หรือ comment) สองบรรทัดนี้ออกจาก .env ของสภาพแวดล้อมที่ต้องการย้อน
#   APP_DB_USER=gacp_app
#   APP_DB_PASSWORD=...
docker compose --env-file .env.staging \
  -f docker-compose.production.yml -f docker-compose.staging.yml \
  up -d --force-recreate --no-deps backend-staging
```

Unset สองตัวแล้ว recreate → `${APP_DB_USER:-gacp}` กลับไปใช้ค่าเริ่มต้น `gacp` (superuser เดิม)
ทันที ไม่ต้องแก้ compose ไม่มีอะไรอื่นเปลี่ยน — เพราะ **policy ไม่เคยถูกแตะเลยตลอด Phase 1** (ข้อ 8)
สำหรับ prod สลับไฟล์/service ตามข้อ 6 (`.env.production`, service `backend`, ไฟล์เดียวพอ)

---

## 8. สิ่งที่ยังไม่ทำใน Phase 1 (โดยตั้งใจ)

- **ไม่ flip policy ให้บังคับจริง** — `apps/backend/scripts/rls/gacp-app-provision.sql:82-83` ยืนยันว่า
  policy ยังเป็น `SELECT TRUE` (นิยามที่ `prisma/migrations/20260502060000_rls_quiet_observe_only/migration.sql:39-50`)
- **ไม่ใส่ `FORCE ROW LEVEL SECURITY`** บนตารางไหนทั้งสิ้น
- ทั้งสองอย่างเป็นของ **Phase 2/3** — แผนแยกต่างหาก ต้องผ่าน owner + reviewer#2 เหมือนข้อ 6 อีกรอบ
  ก่อนเริ่ม ไม่ใช่ส่วนหนึ่งของ runbook นี้

---

## 9. เอกสารที่เกี่ยวข้อง

- `docs/operations/env-layering.md` §2.3b (ที่มา `APP_DB_USER`/`APP_DB_PASSWORD`) และ §4 (ทำไมต้อง recreate)
- `docs/operations/runbooks/rotate-database-credential.md` (รูปแบบคำสั่ง `docker compose ... up -d --force-recreate --no-deps` ชุดเดียวกัน)
- `apps/backend/scripts/rls/gacp-app-provision.sql` (Task 1 — SQL provisioning เต็ม)
- `apps/backend/scripts/rls/gacp-app-coverage-probe.js` (Task 2 — coverage probe เต็ม)
- `apps/backend/scripts/lib/admin-db-url.js` (Task 4 — resolver เต็ม)
