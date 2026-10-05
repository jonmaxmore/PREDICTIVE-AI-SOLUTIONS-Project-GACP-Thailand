#!/usr/bin/env bash
# image-smoke — พิสูจน์ว่า backend image หนึ่งใบรัน native modules ได้จริง และบูตตอบ /api/health
#
# ทำไมมี: การย้าย Node เมเจอร์ (20 → 24) เปลี่ยน ABI/musl ที่ sharp · prisma engine · chromium พึ่ง
# เทสใน jest ไม่เห็นสิ่งนี้เลย (รันบน node ของเครื่อง ไม่ใช่ใน alpine) — ต้องรันในอิมเมจจริง
#
# ทำอะไร (ทั้งหมดบน docker network แยก ชื่อ smoke-<pid> · ไม่แตะ DB/Redis จริงตัวใด):
#   1 node --version ในอิมเมจ
#   2 sharp สร้าง PNG จริง → <out>/sharp.png
#   3 chromium (puppeteer ผ่าน pdf-generator.service) เรนเดอร์ภาษาไทย → <out>/pdf.pdf
#   4 postgres:17-alpine ชั่วคราว (trust auth) + redis:7-alpine ชั่วคราว → prisma migrate deploy
#     ด้วยอิมเมจนี้ → บูต backend (NODE_ENV=development) → GET /api/health ต้องได้ database ตอบ
# ไม่ทำ: production mode (ต้องมี secret จริง — นั่นคือ deploy staging ของ operator) · frontend image
# ใช้:  bash scripts/ops/image-smoke.sh <backend-image> <out-dir> [เมเจอร์ Node ที่คาด]
# exit: 0 ทุกข้อผ่าน · 1 ข้อใดข้อหนึ่งตก (พิมพ์ว่าข้อไหน) · 2 ใช้ผิด/ไม่มี docker
set -u
IMG="${1:?backend image}"; OUT="${2:?out dir}"; WANT="${3:-}"
command -v docker >/dev/null || { echo "ไม่มี docker"; exit 2; }
docker image inspect "$IMG" >/dev/null 2>&1 || { echo "ไม่มีอิมเมจ $IMG"; exit 2; }
mkdir -p "$OUT"; chmod 777 "$OUT"
NET="smoke-$$"; PG="$NET-pg"; RD="$NET-redis"; BE="$NET-be"; PORT=$((18000 + $$ % 1000))
cleanup() { docker rm -f "$BE" "$PG" "$RD" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; }
trap cleanup EXIT
BAD=0
step() { local n="$1"; shift; if "$@" >"$OUT/$n.log" 2>&1; then echo "  ✓ $n"; else echo "  ✗ $n — $OUT/$n.log"; tail -5 "$OUT/$n.log" | sed 's/^/      /'; BAD=1; fi; }
inimg() { docker run --rm --entrypoint "$@"; }

echo "image-smoke: $IMG"
step node-version inimg node "$IMG" --version
sed 's/^/      /' "$OUT/node-version.log"
if [ -n "$WANT" ] && ! grep -qE "^v$WANT\." "$OUT/node-version.log"; then echo "  ✗ node-major — คาด $WANT"; BAD=1; fi
step sharp inimg node -w /app/apps/backend -v "$OUT:/out" "$IMG" -e \
  "const s=require('sharp');s({create:{width:120,height:40,channels:3,background:'#006633'}}).png().toFile('/out/sharp.png').then(i=>console.log('sharp',s.versions.sharp,'vips',s.versions.vips,i.size,'bytes'))"
step chromium-pdf inimg node -w /app/apps/backend -v "$OUT:/out" "$IMG" -e \
  "const g=require('./services/pdf/pdf-generator.service.js');g.generatePDF('<h1>ทดสอบ image-smoke</h1><p>'+process.version+'</p>').then(b=>{require('fs').writeFileSync('/out/pdf.pdf',b);console.log('pdf',b.length,'bytes');return g.close()}).then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})"

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=gacp postgres:17-alpine >/dev/null
docker run -d --name "$RD" --network "$NET" redis:7-alpine >/dev/null
URL="postgresql://postgres@$PG:5432/gacp"
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
step migrate-deploy docker run --rm --network "$NET" -e DATABASE_URL="$URL" -e DIRECT_URL="$URL" \
  --entrypoint sh "$IMG" -c 'cd /app/apps/backend && npx prisma migrate deploy'
grep -v 'npm notice' "$OUT/migrate-deploy.log" | tail -1 | sed 's/^/      /'
docker run -d --name "$BE" --network "$NET" -p "127.0.0.1:$PORT:8000" -e NODE_ENV=development \
  -e DATABASE_URL="$URL" -e DIRECT_URL="$URL" -e REDIS_URL="redis://$RD:6379" "$IMG" >/dev/null
health() { for _ in $(seq 1 90); do curl -sf "http://127.0.0.1:$PORT/api/health" && return 0; sleep 2; done; return 1; }
step health health
sed 's/^/      /' "$OUT/health.log"; echo
docker logs "$BE" >"$OUT/backend-boot.log" 2>&1
[ "$BAD" = 0 ] && { echo "image-smoke: PASS"; exit 0; }
echo "image-smoke: FAIL"; exit 1
