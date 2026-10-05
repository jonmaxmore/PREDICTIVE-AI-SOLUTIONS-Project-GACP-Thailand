# ชั้นของค่า env และลำดับการทับกัน

**สถานะ:** active
**เจ้าของ:** platform operator
**เขียนเมื่อ:** 2026-08-04
**ที่มา:** INCIDENT-2026-08-04 (เปลี่ยนรหัสผ่านฐานข้อมูลแล้ว staging ล่มโดยไม่มีใครรู้)
**เอกสารคู่กัน:** `docs/operations/runbooks/rotate-database-credential.md`

เอกสารนี้ตอบคำถามเดียว คือ **ค่า env แต่ละตัวมาจากชั้นไหน และชั้นไหนทับชั้นไหน**
เขียนขึ้นเพราะรอบนี้มีคนอ่าน `.env.staging` แล้วสรุปผิด และเพราะคำสั่งที่ดึงค่าจาก
คอนเทนเนอร์ไปตั้งรหัสผ่านได้ค่าว่าง

---

## 0. สรุปสั้นสำหรับคนรีบ

1. แอปอ่านค่าฐานข้อมูลจากตัวแปรเดียวคือ `DATABASE_URL`
   (`apps/backend/prisma/schema/_base.prisma:12` คือ `url = env("DATABASE_URL")`)
2. `DB_NAME` `DB_USER` `DB_PASSWORD` **ไม่มีโค้ดของแอปตัวไหนอ่าน** มันเป็นเพียงวัตถุดิบ
   ให้ docker compose ประกอบ `DATABASE_URL` ขึ้นมาตอนสั่ง `up`
   (`docker-compose.production.yml:89`, `docker-compose.staging.yml:67`)
3. ไม่มี service ของ prod หรือ staging ใช้ `env_file:` เลย ทุกตัวแปรต้องถูกส่งเข้า
   คอนเทนเนอร์ทีละตัวใน `environment:`
   (คอมเมนต์ยืนยันในไฟล์เอง `docker-compose.production.yml:186`, `docker-compose.staging.yml:138`
   และ `git grep env_file` เจอเฉพาะ `docker-compose.test.local.yml:61`)
4. ผลตามมาที่สำคัญที่สุด คือ **ค่าที่อยู่ใน `.env.production` หรือ `.env.staging`
   ไม่ได้เข้าไปอยู่ในคอนเทนเนอร์** มันถูกใช้แค่แทนค่า `${...}` ในไฟล์ compose เท่านั้น
5. เพราะฉะนั้น การอ่านไฟล์อย่างเดียวไม่พอ ต้องตรวจค่าจริงในคอนเทนเนอร์เสมอ (ดูข้อ 6)

**เพิ่มเมื่อ 2026-08-17 (RLS Phase 1 Task 3):** ตัวใช้เชื่อมต่อจริงของ `DATABASE_URL` (ทุกบริการแอป)
แยกออกจาก `DB_USER` แล้ว — อ่านจาก **`APP_DB_USER`** ตัวใหม่แทน (ค่าเริ่มต้นยังเป็น `gacp` เหมือนเดิม คือ
merge ครั้งนี้ไม่เปลี่ยนพฤติกรรมรันจริงแม้แต่ตัวเดียว) ส่วน `POSTGRES_USER` ของคอนเทนเนอร์ postgres
(bootstrap superuser ที่สร้าง role `gacp_app`) ยังอ่าน `DB_USER` เหมือนเดิม ไม่ถูกแตะ รายละเอียดเต็มที่ §2.3b

---

## 1. ชั้นทั้งหมดที่มีจริงในรีโปนี้

แยกให้ชัดก่อนว่ามี **สองสนาม** ที่คนสับสนกันบ่อย

### 1.1 สนาม A ตัวแปรที่ docker compose ใช้แทนค่า `${...}` ในไฟล์ compose

ตัวแปรกลุ่มนี้ **ไม่ได้เข้าไปในคอนเทนเนอร์** มันมีชีวิตอยู่แค่ตอน compose อ่านไฟล์ yml

| ชั้น | ที่มา | หลักฐานในรีโป |
| --- | --- | --- |
| A1 | ไฟล์ที่ส่งด้วย `--env-file` เช่น `.env.production` `.env.staging` | `scripts/deploy/deploy-production.sh:39` ตั้ง `ENV_FILE="${ENV_FILE:-.env.production}"` · `scripts/deploy/deploy-staging.sh:28` ตั้ง `ENV_FILE="${ENV_FILE:-.env.staging}"` · เรียกใช้ที่ `scripts/deploy/deploy-staging.sh:110,135` |
| A2 | ตัวแปรที่ตั้งใน shell ตอนเรียกคำสั่ง (ชนะ A1) | `scripts/deploy/deploy-staging.sh:109-112` และ `:134-137` ตั้ง `STAGING_IMAGE_TAG=` นำหน้า `docker compose --env-file ...` ทั้งที่ไฟล์ env ก็มีคีย์นี้อยู่ (`scripts/deploy/deploy-staging.sh:50`) สคริปต์นี้จะทำงานถูกก็ต่อเมื่อ shell ชนะไฟล์ |
| A3 | ค่าปริยายที่เขียนไว้ใน compose เอง เช่น `${DB_NAME:-gacp_db}` (ใช้เมื่อ A1 และ A2 ไม่มีค่า) | `docker-compose.production.yml:89,316,318,325` |
| A4 | เครื่องหมาย `:?` ที่สั่งให้ล้มถ้าค่าว่าง | `docker-compose.production.yml:89` `${DB_PASSWORD:?DB_PASSWORD_required}` · `docker-compose.staging.yml:67` เหมือนกัน |

ยืนยันจากสแตกที่รันอยู่จริงแล้ว 2026-08-04 ว่า A1 ของ production คือ `.env.production`
label ของ compose project ชี้ตรง

```
com.docker.compose.project.environment_file = /opt/gacp-platform/.env.production
```

ก่อนหน้านี้ตารางนี้พิสูจน์ได้แค่ระดับ "สคริปต์ deploy ตั้งค่าไว้แบบนี้" ตอนนี้เป็นการยืนยันจากของจริง
วิธีตรวจซ้ำอยู่ในข้อ 6.4

หมายเหตุ A2 ชนะ A1 เป็นพฤติกรรมของ docker compose เอง **ตรวจจากรีโปโดยตรงไม่ได้**
สิ่งที่รีโปพิสูจน์ได้คือสคริปต์ deploy เขียนโดยตั้งสมมติฐานนี้ (`scripts/deploy/deploy-staging.sh:109-112`)
วิธียืนยันของจริงอยู่ในข้อ 6.2

### 1.2 สนาม B ตัวแปรที่โปรเซสในคอนเทนเนอร์มองเห็นจริง

เรียงจาก **ชนะน้อยที่สุด ไปมากที่สุด**

| ลำดับ | ชั้น | ที่มา | หลักฐานในรีโป |
| --- | --- | --- | --- |
| B1 (อ่อนที่สุด) | `apps/backend/.env` ที่โหลดด้วย dotenv | `apps/backend/server.js:9` `require('dotenv').config({ path: path.join(__dirname, '.env') })` ไม่ได้ส่ง `override: true` จึงเติมเฉพาะตัวแปรที่ยังไม่มีค่า ไม่ทับของเดิม | `apps/backend/server.js:9` |
| B2 | `ENV` ใน Dockerfile (ฝังในอิมเมจ) | `apps/backend/Dockerfile:108-109` (`NODE_ENV`, `PORT`) · `apps/web-app/Dockerfile:36-42,61-66` | เห็นได้ด้วย `docker image inspect` |
| B3 | `environment:` ในไฟล์ compose (ทับ B2) | `docker-compose.production.yml:86-197` (backend) และ `:315-318` (postgres) · `docker-compose.staging.yml:63-142` (backend-staging) |
| B4 (ชนะที่สุด) | `-e` ที่ระบุตอน `docker run` หรือ `docker exec` | `scripts/deploy/deploy-staging.sh:121-124` ใช้ `docker run --rm -e DATABASE_URL=...` เพื่อรัน `prisma migrate deploy` |

ข้อควรระวังของ B1 ไฟล์ `apps/backend/.env` ถูกกันไม่ให้เข้าอิมเมจโดย `.dockerignore:10`
แต่ pattern ที่เขียนไว้คือ `.env` เฉย ๆ ไม่ใช่ `**/.env` จึงกันได้เฉพาะไฟล์ที่ราก build context
**ยืนยันไม่ได้จากรีโปว่าอิมเมจที่รันอยู่มี `apps/backend/.env` ติดไปด้วยหรือไม่**
ต้องรัน `docker exec gacp-backend ls -la /app/apps/backend/.env` ถึงจะรู้

### 1.3 ชั้นพิเศษของฝั่งหน้าเว็บ build ทับ runtime

`apps/web-app/next.config.ts:46-49` ประกาศ `env:` ซึ่ง Next.js จะ **ฝังค่าลงใน bundle ตอน build**
ค่าที่ฝังมาจาก `process.env.NEXT_PUBLIC_API_URL` ตอน build (`apps/web-app/next.config.ts:14`)
ซึ่งรับมาจาก build ARG (`apps/web-app/Dockerfile:39-40`)

แปลว่าการตั้ง `NEXT_PUBLIC_API_URL` ตอน runtime ที่ `docker-compose.staging.yml:175`
**ไม่เปลี่ยนค่าที่ถูกฝังไว้ในโค้ดฝั่งเบราว์เซอร์แล้ว** มันเปลี่ยนได้เฉพาะฝั่ง server ของ Next
ค่าจริงในเบราว์เซอร์ตรวจได้ทางเดียวคือดูที่ bundle ที่ถูก build ออกมา ไม่ใช่ดูที่ compose

---

## 2. ตารางตัวแปรฐานข้อมูล ตัวไหนตั้งที่ไหน ตัวไหนชนะ ใครอ่าน

### 2.1 `DATABASE_URL` ตัวจริงตัวเดียวที่มีผล

| ตั้งที่ไหน | file:line | มีผลจริงไหม |
| --- | --- | --- |
| แม่แบบ `.env.production` | `.env.production.example:14` | **ไม่มีผลต่อคอนเทนเนอร์** ถูก `docker-compose.production.yml:89` ประกอบใหม่ทับทั้งเส้น |
| backend (prod) | `docker-compose.production.yml:89` | **ชนะ** ประกอบจาก `${APP_DB_USER:-gacp}` `${APP_DB_PASSWORD:-${DB_PASSWORD:?}}` `postgres:5432` `${DB_NAME:-gacp_db}` — ตัวใช้เปลี่ยนจาก `DB_USER` เป็น `APP_DB_USER` ที่ Task 3 (§2.3b) |
| backend-staging | `docker-compose.staging.yml:73` | **ชนะ** ประกอบจาก `${APP_DB_USER:-gacp}` `${APP_DB_PASSWORD:-${DB_PASSWORD:?}}` `postgres:5432` `${STAGING_DB_NAME:-gacp_staging}` |
| blue / green | `docker-compose.bluegreen.yml:52` (anchor `&backend_env`) ใช้ซ้ำที่ `:111` | ชนะ เมื่อรัน overlay นี้ — ประกอบจาก `${APP_DB_USER:-gacp}` เช่นกัน |
| local-prod | `docker-compose.local-prod.yml:54` | ชนะ ในสแตกนั้น — ประกอบจาก `${APP_DB_USER:-gacp}` เช่นกัน |
| dev บนเครื่อง | `docker-compose.yml:49` | ชนะ ในสแตกนั้น — ประกอบจาก `${APP_DB_USER:-gacp}` เช่นกัน |
| QA | `docker-compose.qa.yml:48` | ชนะ ในสแตกนั้น ค่าเขียนตายในไฟล์ |
| คอนเทนเนอร์ one-shot ตอน migrate staging | `scripts/deploy/deploy-staging.sh:122` | ชนะ เฉพาะโปรเซสนั้น สร้างจากการ grep ค่าออกจากไฟล์ env |
| postgres-exporter | `monitoring/docker-compose.monitoring.yml:109` | เป็นสแตกแยก (`monitoring/README.md:23`) และ job ถูกคอมเมนต์ไว้ที่ `monitoring/prometheus.yml:33-35` |
| ด่านตรวจก่อน deploy prod | `scripts/deploy/deploy-production.sh:47` | บังคับว่า `.env.production` **ต้องมีบรรทัดนี้** ทั้งที่ค่าไม่ถูกใช้จริง นี่คือกับดักที่ทำให้คนอ่านไฟล์แล้วเชื่อผิด |

ใครอ่าน `DATABASE_URL` ไปใช้
- Prisma ทั้งระบบ `apps/backend/prisma/schema/_base.prisma:12`
- ตัวตรวจ env ตอนบูต `apps/backend/config/env-validator.js:13` (บังคับต้องมีใน production) และ `:104-107`
- สคริปต์เคลียร์ข้อมูล UAT `apps/backend/scripts/clear-for-uat.js:90`
- ตัวแปรชื่อคนละตัวแต่ทำหน้าที่เดียวกันในงาน RLS `GACP_APP_DATABASE_URL` ที่ `apps/backend/scripts/rls/prototype-probe.js:58`

### 2.2 `DB_NAME`

| ตั้งที่ไหน | file:line | ผล |
| --- | --- | --- |
| แม่แบบ prod | `.env.production.example:13` (`DB_NAME=gacp_db`) | ใช้แทนค่าใน compose ของ prod |
| แม่แบบ local | `.env.local.example:11` | เฉพาะเครื่อง dev |
| ใช้แทนค่า | `docker-compose.production.yml:89,318,325` · `docker-compose.local-prod.yml:54,124,133` · `docker-compose.yml:16,49` · `docker-compose.test.local.yml:13,23` | มีผล |
| **staging ไม่ใช้ `DB_NAME` เลย** | `docker-compose.staging.yml:67` ใช้ `${STAGING_DB_NAME:-gacp_staging}` | `DB_NAME` ที่อยู่ใน `.env.staging` ถูกเมิน 100 เปอร์เซ็นต์ |

ใครอ่าน `DB_NAME` ตรง ๆ (ไม่ใช่แอป ทั้งหมดเป็นสคริปต์)
- `scripts/backup/pg-backup.sh:33` (`DB_NAME="${DB_NAME:-gacp_db}"`)
- `scripts/db/backup-db.js:12`
- `apps/backend/scripts/backup-database.sh:6` ค่าปริยายเป็นชื่อที่ **ไม่ตรงกับของจริง** (ดูข้อ 7.3)

**โค้ดของแอปไม่อ่าน `DB_NAME` เลย** ยืนยันด้วย
`git grep -nE "process\.env\.DB_NAME" apps/` เจอเฉพาะไฟล์ทดสอบและสคริปต์

### 2.3 `DB_USER`

| ตั้งที่ไหน | file:line |
| --- | --- |
| แม่แบบ | `.env.production.example:11` · `.env.local.example:9` |
| ใช้แทนค่า | `docker-compose.production.yml:89,316,325` · `docker-compose.staging.yml:67` · `docker-compose.bluegreen.yml:52` · `docker-compose.local-prod.yml:54,122,133` · `docker-compose.yml:14,49` · `docker-compose.test.local.yml:11,23` |
| สคริปต์อ่านจากไฟล์ | `scripts/deploy/deploy-staging.sh:87-88` |
| ค่าปริยายในสคริปต์ | `scripts/backup/pg-backup.sh:34` · `scripts/db/backup-db.js:11` |

จุดสำคัญ prod และ staging ใช้ **role เดียวกัน** เพราะทั้ง `docker-compose.production.yml:89`
และ `docker-compose.staging.yml:67` อ่าน `${DB_USER:-gacp}` ตัวเดียวกัน และคอมเมนต์ที่
`docker-compose.staging.yml:8-9` ระบุว่า staging ใช้ postgres คอนเทนเนอร์เดียวกับ prod
แค่แยกชื่อฐานข้อมูล ผลคือ **หมุนรหัสของ role นี้ครั้งเดียว กระทบทั้งสองระบบพร้อมกัน**

**หมายเหตุ (Task 3, 2026-08-17):** ย่อหน้าบนอธิบาย `DB_USER` ซึ่งยังทำหน้าที่เดิมทุกประการ — กำหนด
`POSTGRES_USER` ของคอนเทนเนอร์ postgres (bootstrap superuser) เท่านั้น ไม่ถูกแตะ แต่ตอนนี้ `DATABASE_URL`
ของบริการแอป **ไม่ได้อ่าน `DB_USER` โดยตรงอีกต่อไป** — อ่าน `APP_DB_USER` ตัวใหม่แทน (ค่าเริ่มต้น `gacp`
เท่ากับ `DB_USER` เดิม วันนี้ prod กับ staging จึงยังเป็น role เดียวกันอยู่จริง ข้อสรุป "หมุนรหัสครั้งเดียว
กระทบทั้งสองระบบ" ยังใช้ได้ **จนกว่าจะตั้ง `APP_DB_USER`/`APP_DB_PASSWORD` แยกต่อสภาพแวดล้อม** ซึ่งเป็น
เป้าหมายของ Task 3 พอดี) รายละเอียดเต็มอยู่ที่ §2.3b ถัดจากนี้

### 2.3b `APP_DB_USER` / `APP_DB_PASSWORD` — แยกแอปออกจาก bootstrap superuser (RLS Phase 1 Task 3, 2026-08-17)

**ปัญหาที่ตัวแปรนี้แก้:** `DB_USER` เดิมทำสองหน้าที่ปนกัน (A) `POSTGRES_USER` ของคอนเทนเนอร์ postgres —
bootstrap superuser ที่เป็นตัว `CREATE ROLE gacp_app` ใน Task 1 (B) ตัวใช้เชื่อมต่อจริงของแอปใน
`DATABASE_URL` ถ้าสลับ default ของ `DB_USER` ตัวเดียวตรง ๆ เป็น `gacp_app` (ตามร่างเดิมของ Task 3 brief)
จะชนกับ `CREATE ROLE gacp_app` ของ Task 1 เอง (bootstrap superuser กลายเป็น `gacp_app`) และแอปจะต่อด้วย
สิทธิ์ superuser แทนที่จะเป็น least-privilege — ตรงข้ามเป้าหมายทั้ง phase Task 3 จึงแยกเป็นสองตัวแปรอิสระ

| ตัวแปร | ควบคุมอะไร | ค่าเริ่มต้น | file:line (ทุกจุดที่อ่าน) |
| --- | --- | --- | --- |
| `DB_USER` | `POSTGRES_USER` (bootstrap superuser) + `pg_isready -U` ของ healthcheck **เท่านั้น** — ไม่ถูกแตะโดย Task 3 | `gacp` | `docker-compose.yml:14`, `docker-compose.production.yml:318,327`, `docker-compose.local-prod.yml:122,133` |
| `APP_DB_USER` | ส่วนผู้ใช้ของ `DATABASE_URL` ที่แอปเชื่อมต่อจริง | `gacp` (**ไม่ใช่** `gacp_app` — เหตุผลด้านล่าง) | `docker-compose.yml:49`, `docker-compose.staging.yml:73`, `docker-compose.production.yml:89`, `docker-compose.local-prod.yml:54`, `docker-compose.bluegreen.yml:52` (anchor `&backend_env`, ใช้ซ้ำที่ backend-green ผ่าน `:111`) |
| `APP_DB_PASSWORD` | ส่วนรหัสผ่านของ `DATABASE_URL` ฝั่งแอป — แยกจาก `DB_PASSWORD` ได้จริง | ไม่ตั้ง → nested fallback `${APP_DB_PASSWORD:-${DB_PASSWORD:?...}}` = ค่าเดียวกับ `DB_PASSWORD` | บรรทัดเดียวกับแถว `APP_DB_USER` ข้างบน |

**ทำไม default เป็น `gacp` ไม่ใช่ `gacp_app`:** ถ้า default เป็น `gacp_app` การ deploy ที่ยังไม่ผ่าน Task 1
(role `gacp_app` ยังไม่ถูกสร้างจริง) จะต่อฐานข้อมูลไม่ได้ทันทีที่ merge — ผิดหลัก "staged, reversible" ของ
Task 5 (`task-5-brief.md:1`) **merge ของ Task 3 เองจึงไม่เปลี่ยนพฤติกรรมรันจริงของสภาพแวดล้อมไหนเลย**
(`APP_DB_USER`/`APP_DB_PASSWORD` ไม่ตั้ง → ได้ค่าตัวอักษรเดียวกับก่อน merge ทุกไบต์) cutover เป็น opt-in
ต่อสภาพแวดล้อมทีละที่ผ่าน env file เท่านั้น ไม่ต้องแก้ compose ซ้ำ — Task 1 ให้ `gacp_app` มีรหัสผ่าน
**แยกจาก `gacp` อยู่แล้วในฐานข้อมูลจริง** (ตั้งผ่าน `:apppw` ตอนรัน provisioning SQL) เพราะฉะนั้น cutover จริง
ต้องตั้ง `APP_DB_PASSWORD` ควบคู่กับ `APP_DB_USER=gacp_app` เสมอ ปล่อยว่างไว้เฉย ๆ จะต่อฐานข้อมูลไม่ติด

**หลักฐานที่ใช้ตัดสินว่า nested default `${APP_DB_PASSWORD:-${DB_PASSWORD:?...}}` ใช้ได้** (เครื่องที่ทำ Task
3 นี้ไม่มี Docker ให้รันจริง จึงตรวจจากรีโปแทน ไม่เดา):
1. เครื่องมือ deploy จริงใช้ Compose **V2** (`docker compose` มีช่องว่าง) ไม่ใช่ V1 (`docker-compose` ขีด) —
   คอมเมนต์ยืนยันตรง ๆ ที่ `scripts/deploy/remote-install.sh:14-15` ("Uses Docker Compose v2 ... was the
   legacy standalone docker-compose v1 binary") และ invocation จริงทุกจุดใน
   `scripts/deploy/deploy-staging.sh`, `deploy-production.sh`, `deploy-bluegreen.sh`,
   `.github/workflows/production.yml` ใช้ `docker compose` สม่ำเสมอ
2. `docker-compose.staging.yml:76-79,86` มี nested default แบบเดียวกันนี้ใช้งานจริงอยู่แล้ว 5 บรรทัด (เช่น
   `HEALTH_JWT_SECRET=${STAGING_HEALTH_JWT_SECRET:-${HEALTH_JWT_SECRET:?required}}`) พร้อมคอมเมนต์ยืนยันว่า
   เคย crash-loop จริงตอน passthrough ขาด (`RSA_PRIVATE_KEY_PASSPHRASE`, บรรทัด 80-85 ไฟล์เดียวกัน) —
   รูปแบบนี้ถูกใช้งานจริงในสแตกที่กำลังแก้ ไม่ใช่แค่ทฤษฎี
   ข้อสังเกตที่ยังไม่ปิด (ไม่ได้ใช้ตัดสินเพราะอยู่นอกขอบเขต grep ที่ใช้): `scripts/deploy/local-deploy.ps1`
   (PowerShell) เรียก `docker-compose` (ขีด) สำหรับ `docker-compose.local-prod.yml` โดยเฉพาะ — ยืนยันจากรีโป
   ไม่ได้ว่าเครื่องที่รันสคริปต์นั้นมี compose รุ่นไหนติดตั้งจริง

**ไม่ใช่ตัวเดียวกับ `GACP_APP_DATABASE_URL`:** probe ของ Task 2
(`apps/backend/scripts/rls/prototype-probe.js:58`) อ่านคนละตัวแปร เป็น connection string เต็มที่ operator
ตั้งเองตอนรัน probe ด้วยมือ ไม่ผ่าน compose

**Cutover/rollback แบบละเอียด → Task 5** (`docs/operations/rls-phase1-gacp-app-cutover.md`, ยังไม่ถูกสร้าง
ณ เวลาที่เขียนนี้) สรุปสั้น ๆ ตรงนี้: provision `gacp_app` ด้วย SQL ของ Task 1 บน staging ก่อน → รัน probe ของ
Task 2 ยืนยัน grants → ตั้ง `APP_DB_USER=gacp_app` + `APP_DB_PASSWORD=<apppw>` ใน `.env.staging` →
**recreate** `backend-staging` (`restart` เฉย ๆ ไม่พอ ค่าไม่ถูกอ่านใหม่ — เหตุผลเดียวกับ §4) rollback คือ
unset ทั้งสองตัวแล้ว recreate อีกครั้ง กลับเป็น `gacp` ทันที ขั้นตอนเดียว ไม่ต้องแก้ไฟล์ compose

### 2.4 `DB_PASSWORD` ตัวที่ทำให้ล่มรอบนี้

| ตั้งที่ไหน | file:line | ผล |
| --- | --- | --- |
| `/opt/gacp-platform/.env.production` | แม่แบบ `.env.production.example:12` | ใช้แทนค่าใน compose |
| `/opt/gacp-platform/.env.staging` | ไฟล์จริงไม่อยู่ในรีโป ถูก ignore ที่ `.gitignore:25` | ใช้แทนค่าใน compose ของ staging |
| ใช้แทนค่า | `docker-compose.production.yml:89,317` · `docker-compose.staging.yml:67` · `docker-compose.bluegreen.yml:52` · `docker-compose.local-prod.yml:54,123` · `docker-compose.yml:15,49` · `docker-compose.test.local.yml:12` | มีผล |
| ด่านตรวจ | `scripts/deploy/deploy-staging.sh:33,66-72` บังคับว่าต้องมีค่าไม่ว่างในไฟล์ env | มีผล |
| ถูก grep ออกจากไฟล์ | `scripts/deploy/deploy-staging.sh:122` | มีผล |

**สิ่งที่ต้องจำให้ขึ้นใจ ไม่มี service ไหนส่ง `DB_PASSWORD` เข้าไปในคอนเทนเนอร์**

- backend ของ prod รายการ `environment:` เริ่มที่ `docker-compose.production.yml:86`
  มีเฉพาะ `DATABASE_URL` ที่ `:89` ไม่มีบรรทัด `DB_PASSWORD`
- backend-staging รายการ `environment:` คือ `docker-compose.staging.yml:63-142`
  มีเฉพาะ `DATABASE_URL` ที่ `:67` ไม่มีบรรทัด `DB_PASSWORD`
- คอนเทนเนอร์ postgres ได้ `POSTGRES_PASSWORD` ไม่ใช่ `DB_PASSWORD`
  (`docker-compose.production.yml:317`)

ดังนั้น `docker exec gacp-backend-staging printenv DB_PASSWORD` **จะได้ค่าว่างเสมอ**
ตรงกับอาการที่รายงานมาในเหตุการณ์ และเป็นเหตุผลว่าทำไมคำสั่งที่ดึงค่าจากคอนเทนเนอร์
ไปตั้งรหัสผ่านจึงกลายเป็นการล้างรหัสทิ้ง วิธีเขียนคำสั่งที่ไม่พังแบบนี้อยู่ใน runbook
`docs/operations/runbooks/rotate-database-credential.md` ข้อ 3

### 2.5 `DB_HOST` และ `DB_PORT`

มีที่เดียวในทั้งรีโป คือ `apps/backend/scripts/backup-database.sh:8-9`
**ไม่มีในไฟล์ compose ไฟล์ใดเลย และแอปไม่อ่าน**
host กับ port ที่ใช้จริงคือ `postgres:5432` ซึ่งเขียนตายอยู่ในตัว `DATABASE_URL`
ของแต่ละ compose (`docker-compose.production.yml:89` และ `docker-compose.staging.yml:67`)
การไปตั้ง `DB_HOST` ในไฟล์ env จึงไม่มีผลอะไรทั้งสิ้น

### 2.6 ตัวแปรอื่นในตระกูลเดียวกันที่เจอ

| ตัวแปร | ที่ตั้ง | หน้าที่ |
| --- | --- | --- |
| `STAGING_DB_NAME` | `docker-compose.staging.yml:67` · `scripts/deploy/deploy-staging.sh:85-86` · แนะนำให้ตั้งที่ `docs/operations/staging-activation.md:68` | ชื่อฐานข้อมูลของ staging ตัวจริง |
| `POSTGRES_USER` `POSTGRES_PASSWORD` `POSTGRES_DB` | `docker-compose.production.yml:316-318` · `docker-compose.local-prod.yml:122-124` · `docker-compose.yml:14-16` · `docker-compose.test.local.yml:11-13` · `docker-compose.qa.yml:12-14` | ค่าที่อิมเมจ postgres ใช้ตอน initdb ครั้งแรกเท่านั้น |
| `PGADMIN_DEFAULT_PASSWORD` | `docker-compose.production.yml:356` | รหัสเข้าเว็บ pgAdmin ไม่ใช่รหัสฐานข้อมูล |
| `SHADOW_DATABASE_URL` | `scripts/ci/check-prisma-migration-consistency.js:80-82` | ใช้ใน CI ตรวจ drift ของ schema |
| `GACP_APP_DATABASE_URL` | `apps/backend/scripts/rls/prototype-probe.js:58` | connection string ของ role `gacp_app` ในงาน RLS บน staging |
| `APP_DB_USER` | `docker-compose.yml:49` · `docker-compose.staging.yml:73` · `docker-compose.production.yml:89` · `docker-compose.local-prod.yml:54` · `docker-compose.bluegreen.yml:52` | ตัวใช้ (user) ของ `DATABASE_URL` ฝั่งแอป — ค่าเริ่มต้น `gacp` (Task 3, §2.3b) |
| `APP_DB_PASSWORD` | บรรทัดเดียวกับแถวบน — nested `${APP_DB_PASSWORD:-${DB_PASSWORD:?...}}` | รหัสผ่านของ `DATABASE_URL` ฝั่งแอป — ไม่ตั้ง → fallback `DB_PASSWORD` (§2.3b) |
| `PGPASSWORD` | `scripts/backup/backup-system.sh:196` | ค่าใช้ทดสอบเท่านั้น |

---

## 3. เคสที่ทำให้ staging ล่มวันนี้ ตามด้วยสิ่งที่รีโปพิสูจน์ได้จริง

### 3.1 สิ่งที่ operator รายงาน

`.env.staging` ตั้ง `DB_NAME=gacp_db` แต่ compose ตั้ง `DATABASE_URL` ชี้ `gacp_staging` ทับ
ใครอ่าน `.env.staging` อย่างเดียวจะได้ข้อสรุปผิด

### 3.2 สิ่งที่ยืนยันได้จากรีโป

- `.env.staging` **ไม่อยู่ในรีโป** ถูก ignore ที่ `.gitignore:25`
  จึงอ่านเนื้อไฟล์จริงบนเครื่องไม่ได้จากที่นี่
- แต่วิธีสร้างไฟล์นี้ถูกเขียนไว้ชัด `docs/operations/staging-activation.md:59`
  สั่งให้ `cp .env.production .env.staging` คือ **คัดลอกมาทั้งไฟล์**
- `.env.production` มีบรรทัด `DB_NAME=gacp_db` ตามแม่แบบ `.env.production.example:13`
  ดังนั้นไฟล์ที่ copy มาจะติดบรรทัดนี้มาด้วย
- รายการค่าที่เอกสารสั่งให้ override หลัง copy อยู่ที่
  `docs/operations/staging-activation.md:63-87` ในรายการนั้น **ไม่มี `DB_NAME`**
  มีแต่การเพิ่ม `STAGING_DB_NAME=gacp_staging` ที่ `:68`
- ฝั่ง compose ของ staging ไม่แตะ `DB_NAME` เลย มันอ่าน `${STAGING_DB_NAME:-gacp_staging}`
  ที่ `docker-compose.staging.yml:67`

สรุป กลไกที่ทำให้เข้าใจผิดตรงกับที่ operator เล่าทุกประการ และพิสูจน์ได้จากรีโป
ส่วนเนื้อไฟล์ `.env.staging` ตัวจริงบนเครื่อง **ยืนยันไม่ได้จากที่นี่**
ต้องรันบน droplet เพื่อดู

```bash
# ดูว่าไฟล์จริงตั้งคีย์อะไรไว้บ้าง แสดงเฉพาะชื่อคีย์ ไม่แสดงค่า
sudo grep -oE '^[A-Z0-9_]+=' /opt/gacp-platform/.env.staging | tr -d '=' | sort
```

### 3.3 ทำไมถึงล่มทั้งที่แก้ไปแล้ว

หลักฐานสามชิ้นประกอบกัน

1. staging ใช้ postgres คอนเทนเนอร์เดียวกับ prod และใช้ role เดียวกัน
   (`docker-compose.staging.yml:8-9` และ `:67` เทียบกับ `docker-compose.production.yml:89`)
   รหัสผ่านจึงเป็นของร่วมกัน ไม่ใช่ของใครของมัน
2. สคริปต์หมุนความลับที่มีอยู่ `scripts/maintenance/rotate-secret.sh` แตะ **เฉพาะ**
   `.env.production` (`:39`) และ restart **เฉพาะ** service `backend` (`:222`)
   ไม่เคยแตะ `.env.staging` และไม่เคย recreate `backend-staging`
3. สคริปต์เดียวกันนี้ยัง **หมุนรหัสฐานข้อมูลไม่ได้อยู่แล้ว** เพราะ allow-list ที่
   `scripts/maintenance/rotate-secret.sh:55-62` มีแค่หกตัวคือ `HEALTH_JWT_SECRET`
   `PROVIDER_JWT_SECRET` `QR_SIGNATURE_FALLBACK_SECRET` `PAYMENT_WEBHOOK_SECRET`
   `ENCRYPTION_KEY` `MASTER_ENCRYPTION_KEY` ไม่มี `DB_PASSWORD` และไม่มี `DATABASE_URL`

การหมุนรหัสฐานข้อมูลจึงเป็นงานมือล้วน และ "ครบ" หมายถึงต้องแตะทั้งสองไฟล์
และ recreate ทั้งสองสแตกในรอบเดียว รายการเต็มอยู่ใน runbook ข้อ 1

---

## 4. รากของความเข้าใจผิด `DATABASE_URL` คือ connection string ที่มีทุกอย่างฝังอยู่ข้างใน

รูปแบบของมันคือ

```
postgresql://<ผู้ใช้>:<รหัสผ่าน>@<โฮสต์>:<พอร์ต>/<ชื่อฐานข้อมูล>?schema=public
```

หนึ่งเส้นนี้บรรจุ **ผู้ใช้ รหัสผ่าน โฮสต์ พอร์ต และชื่อฐานข้อมูล** ครบ
เมื่อ Prisma อ่านตัวแปรนี้ตัวเดียว (`apps/backend/prisma/schema/_base.prisma:12`)
ผลที่ตามมาคือ

- ตั้ง `DB_NAME` แยกไว้ **ไม่มีผล** ถ้าปลายทางคือ `DATABASE_URL` ที่ถูกประกอบขึ้นใหม่
  หรือถูกกำหนดตรง ๆ อยู่แล้ว
- ตั้ง `DB_HOST` `DB_PORT` แยกไว้ **ไม่มีผล** ด้วยเหตุผลเดียวกัน
- แก้ `DB_PASSWORD` ในไฟล์แล้วยังไม่พอ ต้อง **recreate คอนเทนเนอร์** ด้วย
  เพราะสตริงถูกประกอบตอน `docker compose up` ไม่ได้อ่านใหม่ระหว่างที่คอนเทนเนอร์รันอยู่
- ถ้ารหัสผ่านมีอักขระ `@ : / ? # %` มันจะไปชนไวยากรณ์ของ URL และทำให้ต่อฐานข้อมูลไม่ได้
  ทั้งที่รหัสถูกต้อง ดูข้อกำหนดเรื่องชุดอักขระใน runbook ข้อ 2

---

## 5. กับดักที่รู้แล้ว รวมไว้ที่เดียว

| กับดัก | ทำไมถึงหลอกคน | หลักฐาน |
| --- | --- | --- |
| อ่าน `.env.staging` แล้วเชื่อว่า staging ใช้ `gacp_db` | compose ของ staging ไม่อ่าน `DB_NAME` | `docker-compose.staging.yml:67` |
| อ่าน `DATABASE_URL` ใน `.env.production` แล้วเชื่อว่านั่นคือค่าที่ใช้จริง | compose ประกอบทับทั้งเส้น | `.env.production.example:14` เทียบ `docker-compose.production.yml:89` |
| deploy บังคับให้มี `DATABASE_URL` ในไฟล์ env จึงคิดว่ามันสำคัญ | เป็นด่านตรวจอย่างเดียว ค่าไม่ถูกใช้ | `scripts/deploy/deploy-production.sh:47` |
| `docker exec ... printenv DB_PASSWORD` ได้ค่าว่างจึงคิดว่ารหัสว่าง | ตัวแปรนี้ไม่เคยถูกส่งเข้าคอนเทนเนอร์ | `docker-compose.production.yml:86-197` และ `docker-compose.staging.yml:63-142` ไม่มีบรรทัด `DB_PASSWORD` |
| แก้ไฟล์ env แล้วคิดว่าจบ | ต้อง recreate คอนเทนเนอร์ ค่าเก่ายังอยู่ในโปรเซสเดิม | `scripts/deploy/deploy-staging.sh:134-137` ต้องสั่ง `up -d` ใหม่ทุกครั้ง |
| เห็นคอนเทนเนอร์ยัง `Up` จึงคิดว่าปกติ | `restart: unless-stopped` ไม่รีสตาร์ตจากสถานะ unhealthy และไม่มี autoheal ในรีโป (`git grep -i autoheal` ได้ศูนย์ผลลัพธ์) | `docker-compose.staging.yml:55,152-157` |
| ตั้ง `NEXT_PUBLIC_API_URL` ใน compose แล้วคิดว่าเบราว์เซอร์เห็นค่าใหม่ | Next ฝังค่าตอน build | `apps/web-app/next.config.ts:46-49` · `apps/web-app/Dockerfile:39-40` |

---

## 6. วิธีตรวจว่าค่าจริงคืออะไร บทเรียนหลักของเหตุการณ์นี้

**การอ่านไฟล์เชื่อไม่ได้ ต้องถามคอนเทนเนอร์** ทุกคำสั่งด้านล่างรันได้จริงและปิดบังรหัสผ่านแล้ว

### 6.1 ค่าที่โปรเซสในคอนเทนเนอร์เห็นจริง

```bash
# รายชื่อตัวแปรทั้งหมดที่คอนเทนเนอร์เห็น แสดงเฉพาะชื่อ ไม่แสดงค่า
docker exec gacp-backend         printenv | cut -d= -f1 | sort
docker exec gacp-backend-staging printenv | cut -d= -f1 | sort

# ดู DATABASE_URL โดยปิดบังรหัสผ่านไว้ ปลอดภัยพอจะแปะใน ticket ได้
docker exec gacp-backend printenv DATABASE_URL \
  | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'

docker exec gacp-backend-staging printenv DATABASE_URL \
  | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'
```

คำสั่งชุดนี้จะทำให้เห็นทันทีว่า `DB_PASSWORD` ไม่มีอยู่ในรายการ และเห็นว่า staging
ชี้ไปฐานข้อมูลชื่ออะไรจริง ๆ

### 6.2 ค่าที่ compose จะใช้ ก่อนสั่ง up จริง

```bash
cd /opt/gacp-platform

# ให้ compose คลี่ ${...} ทั้งหมดออกมาให้ดู แล้วดูเฉพาะบรรทัดที่เกี่ยวกับฐานข้อมูล
# ระวัง output ชุดนี้มีรหัสผ่านจริง ห้ามแปะที่อื่น จึงกรองผ่าน sed ก่อน
docker compose --env-file .env.production -f docker-compose.production.yml config \
  | grep -iE 'DATABASE_URL|POSTGRES_(USER|DB)' \
  | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'

docker compose --env-file .env.staging \
  -f docker-compose.production.yml -f docker-compose.staging.yml config \
  | grep -iE 'DATABASE_URL' \
  | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'
```

นี่คือวิธียืนยันข้อ 1.1 ว่าชั้นไหนชนะจริงบนเครื่องจริง โดยไม่ต้องเดา

### 6.3 ฐานข้อมูลที่แอปต่ออยู่จริง ๆ ตอนนี้

```bash
# ถามฐานข้อมูลเองว่าเรากำลังคุยกับฐานไหน ไม่ต้องเชื่อไฟล์ใด ๆ
docker exec -i gacp-postgres psql -U <ผู้ใช้ฐานข้อมูล> -d <ชื่อฐานข้อมูล> \
  -tAc 'SELECT current_database(), current_user;'

# รายชื่อฐานข้อมูลทั้งหมดในคอนเทนเนอร์เดียวกัน จะเห็นว่า prod กับ staging อยู่ด้วยกัน
docker exec -i gacp-postgres psql -U <ผู้ใช้ฐานข้อมูล> -lqt | cut -d\| -f1
```

### 6.4 แอปเชื่อมต่อฐานข้อมูลได้จริงหรือไม่

`/api/health` คืน 503 เมื่อ Prisma ต่อฐานข้อมูลไม่ได้
(`apps/backend/routes/api/index.js:379-394` โดยเฉพาะ `:384` ที่เลือก status จาก `overallSuccess`)
และ `/api/health/ready` ตรวจทั้งฐานข้อมูลและ secrets
(`apps/backend/routes/api/health.js:62-108`)

```bash
curl -s -o /dev/null -w 'prod    /api/health        -> %{http_code}\n' http://127.0.0.1:8000/api/health
curl -s -o /dev/null -w 'staging /api/health        -> %{http_code}\n' http://127.0.0.1:8001/api/health
curl -s http://127.0.0.1:8001/api/health/ready | head -c 400; echo
```

### 6.5 กฎเรื่องความลับเวลาตรวจ

- ห้ามรัน `docker exec ... printenv` เปล่า ๆ แล้วแปะผลลงแชท ticket หรือ log ใด ๆ
  ให้ตัดด้วย `cut -d= -f1` หรือกรองด้วย `sed` ตามตัวอย่างเสมอ
- ห้ามใส่รหัสผ่านจริงเป็น argument ของคำสั่ง เพราะ `ps` บนเครื่องเดียวกันเห็นได้
  ถ้าจำเป็นต้องส่งรหัส ให้ใช้ `--env-file` ที่ชี้ไฟล์ mode 0600 แล้วลบทิ้งหลังใช้
- `docker compose config` แสดงรหัสผ่านแบบเต็ม ต้องกรองก่อนเสมอ

---

## 7. สิ่งที่ตรวจไม่ได้จากรีโป ต้องรันบนเครื่องจริงถึงจะรู้

| ประเด็น | ทำไมตรวจไม่ได้ | ต้องรันอะไร |
| --- | --- | --- |
| เนื้อไฟล์ `/opt/gacp-platform/.env.production` และ `.env.staging` | ถูก ignore ที่ `.gitignore:24-25` | ข้อ 3.2 และ ข้อ 6.2 |
| `apps/backend/.env` ติดไปในอิมเมจหรือไม่ | `.dockerignore:10` เป็น pattern ระดับราก ไม่ใช่ `**/.env` | `docker exec gacp-backend ls -la /app/apps/backend/.env` |
| ค่า `NEXT_PUBLIC_API_URL` ที่ฝังอยู่ใน bundle ฝั่งเบราว์เซอร์ | ฝังตอน build ตาม `apps/web-app/next.config.ts:46-49` | ตรวจที่ไฟล์ bundle ที่ build ออกมา ไม่ใช่ที่ compose |
| pgAdmin เก็บรหัสฐานข้อมูลของ server ที่บันทึกไว้หรือไม่ | ข้อมูลอยู่ใน volume `pgadmin_data` (`docker-compose.production.yml:336-357`) ไม่ใช่ในรีโป | เข้าเว็บ pgAdmin แล้วดูรายการ server ที่บันทึกไว้ |
| pg_hba.conf ในคอนเทนเนอร์ postgres อนุญาตต่อผ่าน unix socket แบบไม่ใช้รหัสหรือไม่ | เป็นค่าที่อิมเมจสร้างตอน initdb ไม่มีในรีโป | `docker exec gacp-postgres cat /var/lib/postgresql/data/pg_hba.conf` |
| `scripts/backup/backup-system.sh:55` ที่ต่อผ่าน `-h localhost` ต้องใช้รหัสผ่านหรือไม่ | ขึ้นกับ pg_hba ข้างบน | รันสคริปต์จริงหลังหมุนรหัส แล้วดูว่าไฟล์ backup มีขนาดมากกว่าศูนย์ |

### ความไม่ตรงกันที่เจอระหว่างทาง

`apps/backend/scripts/backup-database.sh:6-7` ตั้งค่าปริยายเป็นชื่อฐานข้อมูลและชื่อผู้ใช้
ที่ไม่ตรงกับสแตกจริงเลย ขณะที่ `scripts/backup/pg-backup.sh:33-34` และ
`docker-compose.production.yml:316-318` ใช้อีกชุดหนึ่ง สคริปต์ตัวแรกจึงเป็นแหล่งข้อมูล
คู่ขนานที่ผิด ยังไม่ได้แก้ในงานนี้เพราะอยู่นอกขอบเขต บันทึกไว้เพื่อให้ไม่มีใครหลงใช้

---

## 8. เอกสารที่เกี่ยวข้อง

- `docs/operations/runbooks/rotate-database-credential.md` ขั้นตอนหมุนรหัสฐานข้อมูลแบบไม่ล่ม
- `docs/operations/runbooks/secret-rotation.md` ความลับตัวอื่นที่ `rotate-secret.sh` หมุนได้
- `docs/operations/staging-activation.md` ที่มาของไฟล์ `.env.staging`
- `docs/integration/partner-interoperability-api.md:82` อธิบายเรื่องไม่มี `env_file` ไว้ในบริบทอื่น

### 6.4 ไฟล์ env ที่ compose ใช้จริง ตรวจจากสแตกที่รันอยู่

อย่าเดาจากสคริปต์ ให้ถาม compose เองว่ามันอ่านไฟล์ไหน

```bash
# ไฟล์ env ที่ compose project ผูกไว้ ไม่มีค่าความลับใน output นี้
docker inspect gacp-backend \
  --format '{{index .Config.Labels "com.docker.compose.project.environment_file"}}'
```

ผลที่ได้เมื่อ 2026-08-04 คือ `/opt/gacp-platform/.env.production`

เหตุที่ต้องมีขั้นนี้ รายงานฉบับหนึ่งเคยสรุปว่า compose อ่านไฟล์ชื่อ `.env` เฉย ๆ ซึ่งผิด
และความผิดนั้นแพร่ต่อไปเป็นคำแนะนำให้ไปแก้ไฟล์ผิดตัว การถาม compose ตรง ๆ ปิดช่องนี้ได้ในคำสั่งเดียว
บันทึกเต็มอยู่ที่ `docs/operations/secret-audit-2026-08-04.md` ข้อ 0

### 6.5 อย่าใช้การเทียบ hash ของ connection string เป็นตัวชี้ขาด

เคยมีข้อเสนอให้เทียบ `docker exec ... printenv REDIS_URL | sha256sum` กับ hash ที่ประกอบจากค่าปริยายในไฟล์
**ยกเลิกวิธีนี้** เพราะต้องตรงกันทุกไบต์รวมอักขระขึ้นบรรทัด ต่างหนึ่งไบต์ก็ได้ผล "ไม่ตรง" ทั้งที่ค่าเหมือนกัน
จึงให้ผลลบลวงได้ง่าย

ถ้าอยากรู้ว่ารหัสที่รันอยู่ใช่ค่าที่สงสัยหรือไม่ ให้ทดสอบกับตัวบริการโดยตรง เช่น `redis-cli AUTH`
แล้วดูว่าได้ `OK` หรือ `WRONGPASS` ซึ่งตอบคำถามตรงตัวโดยไม่ต้องประกอบสตริงเอง
ระวังอย่าใส่รหัสเป็น argument ของคำสั่ง ให้ป้อนทาง stdin หรืออ่านจากไฟล์ mode 600
