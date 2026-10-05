# Deploy PR3 — drop the DTAM remittance schema (DESTRUCTIVE)

Migration `apps/backend/prisma/migrations/20260929155037_drop_dtam_remittance_schema`
ดรอปตาราง `dtam_remittance_batches` และคอลัมน์ `checkout_orders.dtam_fee_amount`,
`dtam_remittance_status`, `"remittanceBatchId"` · เขียน CHECK ยอดรวมใหม่
(`total_payable_amount = platform_fee_gross` ยกเว้นแถว CANCELLED).
มติ operator 2026-09-11 "ถอดออกทั้งระบบ" · 2026-09-29 บริษัทชำระกับกรมฯ นอกระบบ.

**migration ปฏิเสธเองก่อนดรอป** (`DTAM_SCHEMA_DROP_REFUSED` พร้อมจำนวน · ทั้งใบ rollback ไม่มีอะไรหาย) เมื่อ
- มี order `dtam_fee_amount > 0` ที่สถานะไม่ใช่ CANCELLED
- มี batch ที่สถานะไม่ใช่ OPEN (บันทึกของเงินที่ส่งออกไปจริง)
- มีแถวอื่นที่ CHECK ใหม่จะไม่รับ: ไม่ใช่ CANCELLED แต่ `total_payable_amount <> platform_fee_gross`
  หรือค่าบริการ/VAT ติดลบ (ฐานที่ CHECK เดิมถูกถอดด้วยมือ)

ขั้น 1 ตอบคำถามเดียวกันแบบอ่านอย่างเดียว เพื่อให้ deploy ไม่ไปเจอการปฏิเสธ.

**ห้ามปล่อย image PR3 บนฐานที่ยังไม่ migrate**: `dtam_fee_amount` ยังเป็น `NOT NULL` ไม่มีค่า default
(migration 20260802150000) และโค้ด PR3 ไม่เขียนคอลัมน์นี้ ⇒ **ทุก INSERT ของ checkout ล้ม**
(ผู้ยื่นกดชำระไม่ได้เลย). ขั้น 3–4 จึงผูก migrate → image ด้วย `&&` และ migrate รันจาก image ใหม่.
กลับกัน image เดิม (PR2) บนฐานที่ migrate แล้วอ่าน `checkout_orders` ไม่ได้ — สองคำสั่งต้องติดกัน.

## ตัวแปรที่ใช้ทุกขั้น (ตั้งครั้งเดียว · ไม่มีคำสั่งไหนพิมพ์ URL ออกจอ)
```bash
cd /opt/gacp-platform
SHA=<commit ที่ operator merge>                 # เต็ม 40 ตัว
IMG=ghcr.io/jonmaxmore/gacp-backend:local-${SHA:0:12}
url_of()   { grep -E '^DIRECT_URL=' "$1" | head -1 | cut -d= -f2-; }   # session-mode URL (ไม่ใช่ pooled)
psql_url() { url_of "$1" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//'; }  # psql ไม่รับ ?schema=
```

## 0. ก่อนกดอะไรบน demo: demo ต้องรัน build ที่มี PR2 (dc0e3368)
ขั้น 2 พึ่งตัวปลด order ของ PR2 ถ้า backend ของ demo ยังรัน build ก่อน PR2 การกดชำระจะไม่ปลดอะไร.
ตัวตัดสินคือ revision ของ **backend** (`/api/health` ของ backend-demo ที่ 127.0.0.1:8003):
```bash
rev_of() { curl -fsS "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).revision||"")))'; }
BE_REV="$(rev_of http://127.0.0.1:8003/api/health)"
git -C /tmp/gacp-build fetch -q origin \
  && [ -n "$BE_REV" ] && git -C /tmp/gacp-build merge-base --is-ancestor dc0e3368 "$BE_REV" \
  && echo "backend-demo ($BE_REV) มี PR2 แล้ว" || echo "หยุด: backend-demo ยังไม่มี PR2 (revision='$BE_REV') — deploy main ก่อน"
# บรรทัดที่สอง (ข้อมูลประกอบ): frontend ควรเป็น commit เดียวกัน
FE_REV="$(rev_of http://127.0.0.1:3003/api/webapp-version)"; [ "$FE_REV" = "$BE_REV" ] && echo "frontend ตรงกัน" || echo "frontend ต่าง: $FE_REV"
```

## 1. ตรวจก่อน (อ่านอย่างเดียว — ไม่เขียนอะไร)
ตัวตรวจอยู่ใน image ใหม่ · Prisma อ่าน URL จาก env:
```bash
DATABASE_URL="$(url_of .env.staging)" docker run --rm --network gacp-network -e DATABASE_URL "$IMG" \
  sh -c 'cd /app/apps/backend && node scripts/ops/check-dtam-schema-drop-preflight.js'; echo "staging exit=$?"
DATABASE_URL="$(url_of .env.demo)" docker run --rm --network gacp-network -e DATABASE_URL "$IMG" \
  sh -c 'cd /app/apps/backend && node scripts/ops/check-dtam-schema-drop-preflight.js'; echo "demo exit=$?"
```
exit 0 `SAFE_TO_DROP` → ขั้น 3–4 · exit 1 `BLOCKED` → ขั้น 2 · exit 2 → หยุด ตรวจเอง.

ทางเลือกด้วย psql ล้วน (ไม่ต้องมี image ใหม่) — ตั้ง URL ต่อ env ชัด ๆ ทีละตัว:
```bash
PGURL="$(psql_url .env.demo)"; export PGURL        # หรือ .env.staging
docker run --rm -i -e PGURL postgres:17-alpine sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1' <<'SQL'
BEGIN READ ONLY;
SELECT status, count(*) FROM checkout_orders WHERE dtam_fee_amount > 0 GROUP BY status;
SELECT status, count(*) FROM dtam_remittance_batches GROUP BY status;
SELECT status, count(*) FROM checkout_orders
 WHERE NOT (dtam_fee_amount > 0 AND status <> 'CANCELLED')
   AND ((total_payable_amount <> platform_fee_gross AND status <> 'CANCELLED')
        OR platform_fee_net < 0 OR platform_fee_vat < 0)
 GROUP BY status;
ROLLBACK;
SQL
unset PGURL
```

## 2. ถ้า BLOCKED
- **order `PENDING_PAYMENT`** (demo มี 1 ใบ สร้าง 2026-09-12) — ทำขั้น 0 ก่อน: เข้าในนามผู้ยื่นของคำขอนั้น
  (`applicationNumber` อยู่ในรายงาน) แล้วกด **ชำระเงิน** หนึ่งครั้ง บน build PR2 —
  ระบบยกเลิก intent + order + ใบแจ้งหนี้ที่ยังไม่จ่าย แล้วตอบข้อความ "คิดยอดแบบเก่าที่เลิกใช้แล้ว"
  (ไม่มีการเก็บเงิน ไม่มียอดถูกเขียน) · รันขั้น 1 ซ้ำ ต้องได้ exit 0.
  ถ้าได้ "สถานะที่ระบบดำเนินการต่อจากหน้านี้ไม่ได้" (`CHECKOUT_INTENT_UNUSABLE`) = intent จ่ายแล้ว/
  กำลังจ่าย → หยุด เป็นเรื่องคืนเงิน (operator).
  ประตูนี้ตรวจสถานะคำขอ ใบเสนอราคาที่ยอมรับแล้ว และการยอมรับเงื่อนไขชำระเงิน **ก่อน** ถึงตัวยกเลิก —
  ถ้าได้ข้อความอื่น order ไม่ถูกยกเลิก: ขั้น 1 จะยัง BLOCKED → หยุด ให้ operator ตัดสิน.
- **order `SETTLED` / `EXPIRED`, batch `REMITTED` / `RECONCILED` หรือแถวใน `ordersBreakingNewTotalCheck`**:
  หยุด — ไม่มีทางอัตโนมัติ เป็นการตัดสินใจของ operator (เงินเคลื่อนแล้ว / ฐาน drift).

## 3–4. สำรอง → migrate จาก image ใหม่ → ปล่อย image (ทำ staging ก่อน แล้ว demo)
**staging** — สคริปต์ทำ pg_dump → migrate ใน image ใหม่ → recreate เอง และหยุด (exit 3) ก่อน recreate
ถ้า migrate ล้ม (`scripts/deploy/deploy-staging.sh:190-197`):
```bash
sudo IMAGE_TAG=local-${SHA:0:12} bash scripts/deploy/deploy-staging.sh
```
**demo** — ทั้งก้อนเดียว ผูกด้วย `&&` ขั้นไหนล้มขั้นหลังไม่รัน:
```bash
( set -euo pipefail
  umask 077   # dump มีข้อมูลส่วนบุคคล — ไฟล์อ่านได้เฉพาะเจ้าของ (root) ไม่ใช่ทุกคนบนเครื่อง
  TS="$(date -u +%Y%m%dT%H%M%SZ)"; DUMP="/var/backups/gacp/supabase/demo/${TS}_pre-pr3.sql.gz"
  sudo mkdir -p /var/backups/gacp/supabase/demo
  PGURL="$(psql_url .env.demo)"; export PGURL
  docker run --rm -e PGURL postgres:17-alpine sh -c 'pg_dump --clean --if-exists --no-owner --no-acl "$PGURL"' \
    | gzip | sudo tee "$DUMP" >/dev/null
  unset PGURL
  # command grep -c ไม่ใช่ grep -q: -q เลิกอ่านก่อน gzip จบ → SIGPIPE → pipefail ตอบ 141 ทั้งที่ dump ดี ·
  # `command` ข้าม alias (profile แบบ interactive อาจ alias grep เป็น ugrep ซึ่งก็ได้ 141 เหมือนกัน)
  sudo test -s "$DUMP" && sudo gzip -dc "$DUMP" | command grep -c 'CREATE TABLE public.checkout_orders' >/dev/null \
    && echo "backup ok: $DUMP ($(sudo du -h "$DUMP" | cut -f1))" \
  && DATABASE_URL="$(url_of .env.demo)" DIRECT_URL="$(url_of .env.demo)" \
     docker run --rm --network gacp-network -e DATABASE_URL -e DIRECT_URL "$IMG" \
       sh -c 'cd /app/apps/backend && npx prisma migrate deploy' \
  && DEMO_IMAGE_TAG=local-${SHA:0:12} docker compose --env-file .env.demo \
       -f docker-compose.production.yml -f docker-compose.demo.yml \
       up -d --no-deps backend-demo frontend-demo
)
```
ห้าม bare `docker compose up -d` · ห้าม `--remove-orphans` · อย่ากดชำระเงินระหว่าง migrate กับ `up`.
ไฟล์ dump ถูกสร้างภายใต้ `umask 077` (สิทธิ์ 600 เจ้าของ root) เพราะมีข้อมูลส่วนบุคคลของผู้ยื่น — ห้าม chmod ให้คนอื่นอ่าน.

## 5. ถ้า migrate ถูกปฏิเสธ (P3018 + `DTAM_SCHEMA_DROP_REFUSED: …`)
ฐานไม่เปลี่ยน (พิสูจน์บน Postgres 17) และ image เดิมยังรันอยู่ (สายโซ่หยุดก่อน `up`) แต่ Prisma จดใบนี้ว่า
failed → deploy ครั้งถัดไปตอบ P3009. ปลดด้วย image ใหม่ ทีละ env ที่ถูกปฏิเสธ:
```bash
DATABASE_URL="$(url_of .env.staging)" DIRECT_URL="$(url_of .env.staging)" \
  docker run --rm --network gacp-network -e DATABASE_URL -e DIRECT_URL "$IMG" \
  sh -c 'cd /app/apps/backend && npx prisma migrate resolve --rolled-back 20260929155037_drop_dtam_remittance_schema'
DATABASE_URL="$(url_of .env.demo)" DIRECT_URL="$(url_of .env.demo)" \
  docker run --rm --network gacp-network -e DATABASE_URL -e DIRECT_URL "$IMG" \
  sh -c 'cd /app/apps/backend && npx prisma migrate resolve --rolled-back 20260929155037_drop_dtam_remittance_schema'
```
แล้วกลับไปขั้น 2.

## 6. ตรวจหลัง deploy (URL ผ่าน env เท่านั้น)
1. ขั้น 1 ซ้ำ → `ALREADY_DROPPED` exit 0
2. สมการเงิน (เงื่อนไขเดียวกับ `scripts/probes/money-equation.sh`) ต้องได้ `0` — คัดลอกจากไฟล์ดิบได้ตรง ๆ
   (ไม่มี heredoc):

```bash
PGURL="$(psql_url .env.demo)"; export PGURL        # แล้วซ้ำด้วย .env.staging
docker run --rm -e PGURL postgres:17-alpine sh -c 'psql "$PGURL" -qtA -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY" -c "SELECT count(*) FROM checkout_orders WHERE platform_fee_gross <> platform_fee_net + platform_fee_vat OR (total_payable_amount <> platform_fee_gross AND status <> \$\$CANCELLED\$\$)" -c "ROLLBACK"'
unset PGURL
```

3. ชำระเงินจริงหนึ่งใบ (Stripe test) → order SETTLED, บัญชี 1110-001 / 4110-001 / 2131-001

## ถอยกลับ
image ย้อนอย่างเดียวไม่พอ (PR2 อ่านคอลัมน์ที่ดรอป). ใช้ dump จากขั้น 3–4 หรือ SQL rollback
ในหัวไฟล์ migration (คืนรูปตาราง/คอลัมน์ และคืน `dtam_fee_amount` = total − gross ของแถวเก่า;
แถว batch และสถานะนำส่งไม่กลับมา) แล้วปล่อย image เดิม.
**สิทธิ์ (GRANT) ไม่ถูกคืน**: ไม่มี migration ใดให้ GRANT กับสองตารางนี้ — ถ้ามีการให้สิทธิ์ด้วยมือ
(เช่น role `gacp_app` ตาม runbook RLS phase 1) ให้ใส่กลับเฉพาะอันนั้น.
