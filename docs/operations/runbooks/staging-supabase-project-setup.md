# ตั้ง Supabase project ที่สองสำหรับ staging (operator ทำ)

**ทำไม:** break-test เขียนขยะ/ทำลายข้อมูล + retention sweep null คอลัมน์ระบุตัวตน —
ห้ามทำบนฐาน prod เด็ดขาด · staging ต้องมีฐานของตัวเอง (มติ operator 2026-09-06)

## บน Supabase dashboard (operator)
1. New project → ตั้งชื่อ `gacp-staging` (คนละ project กับ prod) · เลือก region เดียวกับ prod (ap-southeast) · ตั้ง DB password เก็บไว้
2. รอ provision เสร็จ → Project Settings → Database → **Connection string**
   - คัดลอกทั้ง **Session/pooler URI** (ใช้เป็น `DATABASE_URL`) และ **Direct connection** (ใช้เป็น `DIRECT_URL`)
3. อย่าเปิด public ให้ใครนอกทีม · ไม่ต้องใส่ข้อมูลจริง

## บน box (operator, หลังได้ connection string)
1. แก้ `/opt/gacp-platform/.env.staging`:
   ```
   DATABASE_URL=<pooler URI ของ gacp-staging>
   DIRECT_URL=<direct URI ของ gacp-staging>
   ```
   (ค่าเดิมที่ชี้ container local จะถูกแทน — staging ย้ายมา Supabase ตัวใหม่)
2. migrate ฐานใหม่จากศูนย์ (พิสูจน์แล้วว่า 134 ใบ apply ได้):
   ```
   cd /tmp/gacp-build/apps/backend && set -a; . /opt/gacp-platform/.env.staging; set +a
   npx prisma migrate deploy
   ```
3. seed กติกา กทล.1 (ไม่ได้มากับ migration — เป็น script idempotent):
   ```
   node scripts/seed-cannabis-requirement-rules.js --apply
   ```
4. deploy staging ด้วยอิมเมจ main (Track A ในคู่มือ deploy) — สคริปต์จะ migrate ซ้ำ (no-op)

## แจ้งผมเมื่อพร้อม
ให้ connection string ผมไม่ได้ (เป็น secret — ห้ามพิมพ์ใน chat/log ตาม L2) · แค่บอกว่า
"staging Supabase พร้อม + migrate แล้ว" ผมจะเดิน view-in-the-loop เต็มเส้นบน staging.gacpth.com ต่อ

---

## อัปเดต 2026-09-06 — project refs ที่ยืนยันแล้ว
- **staging** = `your-project-ref` (region ap-northeast-2 / pooler `aws-0-ap-northeast-2`)
- **demo/prod** = `nnfbugfmkhkqxqlrvcmu` (ap-southeast-2)

## สำคัญ: แอปใช้ Prisma ไม่ใช่ Supabase JS
- **อย่า** `npm install @supabase/supabase-js @supabase/ssr` — โค้ดเบสไม่ได้ใช้ (grep = 0)
- **อย่า** ใช้ publishable/secret key หรือ `NEXT_PUBLIC_SUPABASE_URL` — ไม่มีที่ให้ใส่
- สิ่งที่ต้องมี = **Postgres connection string** (DATABASE_URL/DIRECT_URL) พร้อม DB password จริง

## ต่อ staging เข้ากับ Supabase project ใหม่ (operator รันบน box — เติม password เอง ไม่วางใน chat)
```bash
# บน box · แทน <PW> ด้วย DB password ของ project your-project-ref
cd /opt/gacp-platform
cp .env.staging .env.staging.bak-$(date +%s)          # สำรองก่อน
cat >> .env.staging <<'ENVEOF'
# ── staging → Supabase project your-project-ref (2026-09-06) ──
# บรรทัดนี้อยู่ท้ายไฟล์จึง override ค่า DATABASE_URL เดิมที่ชี้ container local
DATABASE_URL=postgresql://postgres.your-project-ref:<PASSWORD>@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.your-project-ref:<PASSWORD>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
ENVEOF
# ยืนยันว่า override เป็นบรรทัดสุดท้ายจริง (ค่าท้ายชนะใน docker env_file)
grep -n '^DATABASE_URL=' .env.staging
```
จากนั้น: migrate ฐานใหม่จากศูนย์ → seed กติกา → deploy (ตามขั้นในไฟล์นี้ด้านบน)
เสร็จแล้วบอกผม "staging wired" (ไม่ต้องส่ง connection string) ผมเดิน view-in-the-loop ต่อบน staging.gacpth.com
