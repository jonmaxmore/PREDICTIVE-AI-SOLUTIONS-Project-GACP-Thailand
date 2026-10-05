# Deploy runbook — main @ 9a035519cdee (2026-09-06)

**เตรียมโดย agent · รันโดย operator เท่านั้น (L5).** ทุกคำสั่งรันบนเครื่อง box
(ubuntu@203.0.113.10). คัดลอกทีละบล็อก อ่านผลก่อนไปบล็อกถัดไป.

โค้ดที่จะ deploy = `main @ 9a035519cdeeed510455ba0f72702daf776246f3` (merge แล้ว ยืนยันด้วย git ls-remote).

---

## สองเส้นทาง — คนละฐานข้อมูล คนละระดับความเสี่ยง

| | staging (พวกเรา) | demo (ลูกค้า) |
|---|---|---|
| ฐานข้อมูล | `gacp_staging` — คอนเทนเนอร์ local บน box | **Supabase ตัวเดียวกับ prod+preview** |
| migrate | `deploy-staging.sh` ทำเองในสคริปต์ (ปลอดภัย) | **แตะข้อมูล prod — ทำแยก ระวังสูงสุด** |
| ความเสี่ยง | ต่ำ | สูง — ทำ Track B ต่อเมื่อ staging ผ่านแล้ว |

migration ที่ค้างบน Supabase 3 ใบ (ตรวจ 2026-09-06):
`20260901310000_application_document_reviews` · `20260905120000_batch_lab_results` ·
`20260906000000_audit_note_disclosure` — ทั้งหมด additive + `IF NOT EXISTS` ทุกคำสั่ง
(พิสูจน์แล้วว่า migrate ครบ 134 ใบจากฐานเปล่าได้) แต่ยังเป็นการเขียนลงฐานที่ prod ใช้.

---

## 0. Build image จาก main (ทำครั้งเดียว ใช้ได้ทั้งสอง track)

image ตัวเดียว serve ทั้ง staging และ demo (docker-compose.demo.yml:137).

```bash
cd /tmp && rm -rf /tmp/gacp-build && \
  git clone -q git@github.com:jonmaxmore/GACP-Certification-Application.git /tmp/gacp-build && \
  cd /tmp/gacp-build
git rev-parse HEAD    # ต้องได้ 9a035519cdeeed510455ba0f72702daf776246f3
SHA=$(git rev-parse HEAD); TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

docker build -f apps/backend/Dockerfile \
  --build-arg GIT_SHA=$SHA --build-arg BUILT_AT=$TS \
  -t ghcr.io/jonmaxmore/gacp-backend:local-${SHA:0:12} .

docker build -f apps/web-app/Dockerfile \
  --build-arg GIT_SHA=$SHA --build-arg BUILT_AT=$TS \
  --build-arg NEXT_PUBLIC_API_URL=https://staging.gacpth.com \
  --build-arg NEXT_PUBLIC_PWA_ENABLED=false \
  --build-arg NEXT_PUBLIC_CHECKOUT_UI_ENABLED=true \
  -t ghcr.io/jonmaxmore/gacp-frontend:local-${SHA:0:12} .
```

> กับดัก build (จาก runbook เดิม): `NEXT_PUBLIC_API_URL` **ไม่มี** `/api` ท้าย ·
> เช็คท้าย log ว่าไม่มี `build-args were not consumed` (แปลว่า flag ถูกเมิน) ·
> `NEXT_PUBLIC_*` ฝังตอน build — เปลี่ยนบน container ที่รันอยู่ไม่มีผล.

ตรวจว่า image ได้ SHA ถูก:
```bash
docker run --rm --entrypoint sh ghcr.io/jonmaxmore/gacp-backend:local-${SHA:0:12} -c 'echo $GIT_SHA'
```

---

## Track A — staging (ทำก่อน)

สคริปต์ทำ preflight → backup DB → migrate (`gacp_staging`) → recreate ให้เอง.
migration 3 ใบใหม่จะถูก apply ที่นี่ (ไม่ใช่ no-op อีกต่อไป — additive ปลอดภัย).

```bash
cd /opt/gacp-platform && sudo IMAGE_TAG=local-${SHA:0:12} bash scripts/deploy/deploy-staging.sh
```

> ถ้า migration ABORT (role ที่ map ไม่ได้) สคริปต์หยุดก่อน recreate, DB ถูก rollback,
> มี backup ให้ถอย — ดู `evidence/runtime-deploy-drift/task5/INDEX.md`.

verify staging ได้ build ใหม่จริง:
```bash
cd /tmp/gacp-build && bash scripts/probes/deploy-drift.sh; echo "exit=$?"
# แถว staging ต้องหายจาก FAIL · แถว production FAIL เสมอจาก box นี้ (Cloudflare WAF)
curl -s https://staging.gacpth.com/api/webapp-version    # ต้องเห็น SHA 9a035519cdee
```

**หยุดตรงนี้ ทดสอบ staging ด้วยมือให้พอใจก่อนไป Track B.**

---

## Track B — demo (Supabase = ฐาน prod · ทำต่อเมื่อ staging ผ่าน)

### B1. สำรอง Supabase ก่อนแตะ (ทำเสมอ)
```bash
# ใช้เครื่องมือ backup ของ Supabase หรือ pg_dump ผ่าน DIRECT_URL ใน .env.demo
# เก็บ dump ไว้ก่อน migrate — นี่คือข้อมูล prod
```

### B2. migrate Supabase — ก่อนปล่อย image เสมอ (ห้ามสลับ)
```bash
cd /tmp/gacp-build/apps/backend
# ใช้ DATABASE_URL/DIRECT_URL ของ Supabase จาก /opt/gacp-platform/.env.demo
set -a; . /opt/gacp-platform/.env.demo; set +a
npx prisma migrate status        # ต้องเห็น 3 ใบ pending ตามรายการข้างบน
npx prisma migrate deploy        # apply — additive, re-runnable
```

### B3. ปล่อย image demo (หลัง migrate เท่านั้น)
```bash
cd /opt/gacp-platform
DEMO_IMAGE_TAG=local-${SHA:0:12} docker compose --env-file .env.demo \
  -f docker-compose.production.yml -f docker-compose.demo.yml \
  up -d --no-deps backend-demo frontend-demo
```
> **ห้าม** bare `docker compose up -d` (จะ recreate ทุก service ในโปรเจกต์รวม prod) ·
> **ห้าม** `--remove-orphans` (gacp-pgadmin อยู่หลัง profile) ·
> **ห้ามลืม** `DEMO_IMAGE_TAG=` (compose บังคับด้วย `:?` จะ error ถ้าไม่ใส่ — ดีแล้ว).

### B4. verify demo
```bash
curl -s https://demo.gacpth.com/api/webapp-version    # ต้องเห็น SHA 9a035519cdee
# แล้วเปิด demo.gacpth.com จากมือถือ (ปิด wifi) กดยื่นคำขอจริงหนึ่งใบ
```

---

## Rollback (ถ้าจำเป็น)
- staging: `IMAGE_TAG=<sha-เดิม> docker compose ... up -d backend-staging frontend-staging`
  (raw compose ไม่ใช่สคริปต์ — สคริปต์รัน migrate ซึ่งไม่ถอยหลัง)
- demo: `DEMO_IMAGE_TAG=<sha-เดิม> docker compose --env-file .env.demo ... up -d --no-deps backend-demo frontend-demo`
- **migration ถอยไม่ได้ด้วยการ rollback image** — ถ้าต้องถอยฐาน ใช้ dump จาก B1

## กฎเหล็ก
- migrate ก่อน image เสมอ · ทุก `up -d` ต้องมี IMAGE_TAG/DEMO_IMAGE_TAG นำหน้า ·
  ไม่มี bare up -d · ไม่มี --remove-orphans · verify SHA บนโดเมนจริงหลัง deploy ทุกครั้ง
