# Runbook — เก็บหลักฐาน M1 บน staging (ครั้งเดียว ครอบทั้ง 3 PR)

**ทำเมื่อ:** main รวม M1 ครบแล้ว (`d9104fa4` ขึ้นไป) · **ปิดหนี้:** AC5 (backfill + นับแถว — Phase 1/3), AC2/AC3/AC4 ระดับ DB (Phase 4 ผ่านเทส self-seeding), AC6 (view-pack — Phase 0/5), gate-attestation ของ SHA บน main (Phase 4)

**กติกาความปลอดภัย** (จ่ายค่าเรียนแล้ว — the change log 2026-08-14 เหตุ ssh-keygen):
- ทุกกล่องระบุ **เครื่อง** บนหัว — ห้ามวางกล่องของเครื่องหนึ่งลงอีกเครื่อง · กล่องมีแต่คำสั่ง · ไม่มีคำสั่งถาม prompt
- ทำตามลำดับ phase — "ก่อน" ต้องเกิดก่อน migrate จริงๆ
- ค่าที่ใช้ยืนยันจากไฟล์ระบบแล้ว: container Postgres = `gacp-postgres`, DB user = `gacp`, DB = `gacp_staging` (`docker-compose.production.yml:318` · `scripts/deploy/deploy-staging.sh:114-115` · `docs/operations/staging-activation.md:33,49`)

---

## Phase 0a — เลือกใบที่ AC6 จะพิสูจน์ได้จริง (เครื่อง staging — SSH)

ใบเก่าที่ไม่มี entity จะ backfill เป็นชื่อคนเดิม (LEGACY_PERSON) — ภาพก่อน/หลังจะ**เหมือนเดิม** พิสูจน์ AC6 ไม่ได้ ต้องใช้ใบที่ application หรือ farm ผูก entity อยู่:

```bash
docker exec -i gacp-postgres psql -U gacp -d gacp_staging <<'SQL'
SELECT c."certificateNumber", e."displayName", e."type", 'via application' AS path
FROM certificates c JOIN applications a ON a.id = c."applicationId" JOIN entities e ON e.id = a."entityId"
UNION ALL
SELECT c."certificateNumber", e."displayName", e."type", 'via farm'
FROM certificates c JOIN farms f ON f.id = c."farmId" JOIN entities e ON e.id = f."entityId"
LIMIT 10;
SQL
```

- ได้อย่างน้อย 1 แถว → จดเลขใบตัวแรกไว้ ใช้ทั้ง Phase 0b และ Phase 5
- **0 แถว** → staging ไม่มีใบที่จะเปลี่ยนชื่อผู้ถือ — AC6 ต้องออกใบใหม่จากคำขอที่ผูก entity ก่อน: หยุดตรงนี้แล้วแจ้ง agent ให้จัดชุดออกใบทดสอบ ห้ามติ๊ก AC6 ผ่านด้วยใบ LEGACY_PERSON

## Phase 0b — ภาพ "ก่อน" (เบราว์เซอร์ของคุณ)

เปิดหน้า verify สาธารณะของ**ใบจาก 0a** → screenshot ทั้งหน้า `verify-before.png` + ดาวน์โหลด PDF `cert-before.pdf` (เก็บบนเครื่องคุณจนถึง Phase 5)

## Phase 1 — นับแถวก่อน migrate (เครื่อง staging — SSH)

```bash
docker exec -i gacp-postgres psql -U gacp -d gacp_staging -c "SELECT COUNT(*) AS total_before FROM certificates;" | tee /tmp/m1-counts-before.txt
```

## Phase 2 — build + deploy (เครื่อง staging — SSH)

Build สองอิมเมจ (ตาม `build-images-on-the-box.md` — backend ~1 นาที, frontend ~5 นาที):

```bash
cd /tmp && rm -rf /tmp/gacp-build && git clone -q git@github.com:jonmaxmore/GACP-Certification-Application.git /tmp/gacp-build && cd /tmp/gacp-build
SHA=$(git rev-parse HEAD)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker build -f apps/backend/Dockerfile --build-arg GIT_SHA=$SHA --build-arg BUILT_AT=$TS -t ghcr.io/jonmaxmore/gacp-backend:local-${SHA:0:12} .
docker build -f apps/web-app/Dockerfile --build-arg GIT_SHA=$SHA --build-arg BUILT_AT=$TS --build-arg NEXT_PUBLIC_API_URL=https://staging.gacpth.com --build-arg NEXT_PUBLIC_PWA_ENABLED=false --build-arg NEXT_PUBLIC_CHECKOUT_UI_ENABLED=true -t ghcr.io/jonmaxmore/gacp-frontend:local-${SHA:0:12} .
```

อัปเดตโค้ดฝั่ง `/opt/gacp-platform` ให้ SHA ตรงกับที่ build แล้ว deploy (สคริปต์ทำ preflight → **backup DB** → migrate → recreate — migration M1 `20260815100000_certificate_holder_expand` รันตรงนี้):

```bash
cd /opt/gacp-platform && git fetch origin && git checkout main && git pull --ff-only
test "$(git rev-parse HEAD)" = "$(git -C /tmp/gacp-build rev-parse HEAD)" && echo SHA-MATCH || echo SHA-MISMATCH-STOP
```

```bash
cd /opt/gacp-platform && sudo IMAGE_TAG=local-$(git rev-parse --short=12 HEAD) bash scripts/deploy/deploy-staging.sh
```

**ตรวจว่า backup เกิดจริงก่อนไปต่อ** — สคริปต์ `|| true` ตรง pg_dump: backup ล้ม = มัน**เดินต่อ**เฉยๆ (deploy-staging.sh:118-127) อย่าเชื่อโดยไม่ดูไฟล์:

```bash
ls -lht /var/backups/gacp-staging/staging-pre-deploy-*.sql.gz | head -3
```

ไฟล์**บนสุดต้องเป็นของรอบนี้** (ดู timestamp เทียบเวลาที่เพิ่งรัน deploy — เครื่องนี้มี backup เก่าจาก 2026-08-14 ค้างอยู่ อย่าให้มันหลอก) และขนาดสมเหตุสมผล (หลาย KB ขึ้นไป ไม่ใช่หลัก byte) · วิธีถอยถ้า migrate พัง: `deploy-staging-manual.md:125-135`

## Phase 3 — นับแถวหลัง migrate = หลักฐาน AC5 (เครื่อง staging — SSH)

```bash
docker exec -i gacp-postgres psql -U gacp -d gacp_staging <<'SQL' | tee /tmp/m1-counts-after.txt
SELECT COUNT(*) AS total_after FROM certificates;
SELECT COUNT(*) FILTER (WHERE "holderDisplayName" IS NULL) AS holder_null,
       COUNT(*) FILTER (WHERE "submittedByUserId" IS NULL) AS submitter_null,
       COUNT(*) FILTER (WHERE "holderType" IS NULL)        AS type_null,
       COUNT(*) FILTER (WHERE "holderType" = 'LEGACY_PERSON') AS legacy_person
FROM certificates;
SELECT COUNT(*) AS d1_conflicts FROM certificates c
JOIN applications a ON a.id = c."applicationId"
JOIN farms f        ON f.id = c."farmId"
WHERE a."entityId" IS NOT NULL AND f."entityId" IS NOT NULL AND a."entityId" <> f."entityId";
SQL
```

**เกณฑ์ผ่าน:** `total_after` = `total_before` · null ทั้งสาม = 0 · `legacy_person`/`d1_conflicts` เป็นเท่าไหร่ก็ได้ — จดตัวเลข (spec สั่งบันทึก ไม่ได้สั่งให้เป็นศูนย์)

## Phase 4 — full-gate + attestation (เครื่อง staging — SSH · ตาม `full-gate-on-staging.md`)

หลักฐาน AC2/AC3/AC4 ระดับ DB มาจากขั้นนี้: `integration-pg` (required) รัน `m1-erasure-holder-survives` + `m1-submit-enforcement` ซึ่ง **seed ข้อมูลเอง**บน scratch DB · (หมายเหตุความซื่อสัตย์: `m1-holder-backfill` บน scratch DB เขียวแบบ 0 แถว = ไม่ใช่หลักฐาน AC5 — AC5 มีแค่ Phase 3)

> ⚠️ **ข้อจำกัดเครื่อง (staging-box-topology.md:94-101):** 2 คอร์ / 7.1 GiB / ไม่มี swap และถือ container production อยู่ — full unit suite เคยตาย OOM มาแล้ว (2026-08-08) และเหยื่อของ OOM-killer อาจเป็น `gacp-postgres` ที่ถือ DB production ด้วย · รันช่วงเครื่องว่าง · ถ้า gate ABORT/OOM: **หยุดแล้วแจ้ง agent** — ห้ามใช้ `--allow-blocked` โดยไม่ตัดสินใจอย่างรู้ตัว (มันคือการให้ cover ที่บันทึกลง attestation ถาวร)

```bash
cd /opt/gacp-platform && bash scripts/ci/full-gate.sh \
  && SHA="$(git rev-parse HEAD)" \
  && test -f "evidence/gate/$SHA.json" \
  && git add evidence/gate \
  && git commit -m "chore(gate): full-gate attestation" -m "Gate-Attestation: $SHA" \
  && git push
```

## Phase 5 — ภาพ "หลัง" + เอา evidence เข้า repo

**เบราว์เซอร์ของคุณ:** หน้า verify **ใบเดิมจาก 0a** → `verify-after.png` + PDF → `cert-after.pdf` · สิ่งที่ต้องเห็น: "ผู้ถือใบรับรอง" เปลี่ยนเป็นชื่อ entity จาก 0a — ของเดิมครบทุกช่อง

**เครื่อง staging — SSH:**

```bash
cd /opt/gacp-platform && mkdir -p evidence/M1/staging \
  && cp /tmp/m1-counts-before.txt /tmp/m1-counts-after.txt evidence/M1/staging/ \
  && git add evidence/M1/staging && git commit -m "evidence(M1): staging backfill counts — AC5" && git push
```

**เครื่อง Windows ของคุณ:** วางภาพ/PDF สี่ไฟล์ลง `evidence/M1/view-pack/` แล้วบอก agent ให้ตรวจ + ทำ INDEX + commit

## เช็คลิสต์ปิด M1

- [ ] `total_before == total_after` และ null ทั้งสาม = 0 (AC5 — Phase 3)
- [ ] backup ก่อน migrate มีไฟล์จริงขนาดสมเหตุสมผล (Phase 2)
- [ ] full-gate เขียว + attestation push แล้ว — หรือบันทึก ABORT ตามจริงถ้าเครื่องไม่ไหว (Phase 4)
- [ ] `m1-erasure-holder-survives` + `m1-submit-enforcement` **ไม่ skip** ใน log gate (`evidence/gate/logs/<sha>/`) (AC2/AC3/AC4)
- [ ] view-pack 4 ไฟล์จากใบที่เปลี่ยนจริง (AC6 — ห้ามใช้ใบ LEGACY_PERSON)
- [ ] แจ้ง agent อัปเดต PENDING → DONE เฉพาะข้อที่มี artifact
