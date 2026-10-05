#!/usr/bin/env bash
# ตรวจว่าโฮสต์หนึ่งได้บิลด์ใหม่จริงหรือยัง — ด้วยพฤติกรรม ไม่ใช่ป้ายเวอร์ชัน
#
# ทำไมไม่ดู /api/version: มันคืน "3.0.0" เท่ากันทั้งบิลด์เก่าและใหม่ และไม่มี sha
# (วัดจริง 2026-09-10 บน demo และ staging) · ป้ายที่ไม่เปลี่ยนตามโค้ด บอกอะไรไม่ได้
#
# ทุกข้อที่นี่ยิงได้โดยไม่ต้องมีโทเคน และแต่ละข้อผูกกับการแก้ที่ merge เข้า main
# ที่ 9c947286 — ถ้าโฮสต์ยังตอบแบบเก่า แปลว่าบิลด์ยังไม่ถึง
#
#   ใช้: bash scripts/verify-deployed-build.sh https://staging.gacpth.com
set -uo pipefail

HOST="${1:?ใส่ URL ของโฮสต์ เช่น https://staging.gacpth.com}"
pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %-52s %s\n' "$1" "$2"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %-52s %s\n' "$1" "$2"; fail=$((fail+1)); }

echo "═══ $HOST ═══"

# 1) ประตูที่ไม่มีอยู่ ต้องตอบ JSON ไม่ใช่หน้า HTML ของ Express
#    (fe289fea — API ที่ตอบ HTML คือ API ที่ผิดสัญญา)
body=$(curl -s --max-time 25 "$HOST/api/does-not-exist" 2>/dev/null)
if printf '%s' "$body" | grep -q 'ROUTE_NOT_FOUND'; then
    ok "404 เป็น JSON (api-not-found ถูก mount)" "ROUTE_NOT_FOUND"
elif printf '%s' "$body" | grep -qi '<!DOCTYPE html>'; then
    bad "404 เป็น JSON (api-not-found ถูก mount)" "ยังเป็น HTML — บิลด์เก่ากว่า fe289fea"
else
    bad "404 เป็น JSON (api-not-found ถูก mount)" "คำตอบไม่รู้จัก"
fi

# 2) พาธผี /api/auth/login ไม่มีอยู่จริง — ประตูล็อกอินคือ /api/auth/health/login
#    บิลด์เก่าตอบ 405 Allow: POST แล้ว POST ก็ 404 (คำตอบขัดกันเอง)
hdr=$(curl -s -i --max-time 25 -X DELETE "$HOST/api/auth/login" 2>/dev/null | tr -d '\r')
code=$(printf '%s' "$hdr" | awk 'NR==1{print $2}')
allow=$(printf '%s' "$hdr" | grep -i '^allow:' | head -1)
if [ "$code" = "404" ] && [ -z "$allow" ]; then
    ok "พาธผี /api/auth/login ไม่ถูกโฆษณา" "404 ไม่มี Allow"
else
    bad "พาธผี /api/auth/login ไม่ถูกโฆษณา" "$code ${allow:-(ไม่มี Allow)}"
fi

# 3) พาธจริงที่อยู่ใต้ mount หลายเซ็กเมนต์ ต้องตอบ 405 พร้อม Allow
hdr=$(curl -s -i --max-time 25 -X DELETE "$HOST/api/auth/health/login" 2>/dev/null | tr -d '\r')
code=$(printf '%s' "$hdr" | awk 'NR==1{print $2}')
allow=$(printf '%s' "$hdr" | grep -i '^allow:' | head -1)
if [ "$code" = "405" ] && printf '%s' "$allow" | grep -qi 'POST'; then
    ok "ประตูล็อกอินจริงตอบ 405 พร้อม Allow" "$allow"
else
    bad "ประตูล็อกอินจริงตอบ 405 พร้อม Allow" "$code ${allow:-(ไม่มี Allow)}"
fi

# 4) ตัวจำกัดอัตรานับ "เส้นทาง" ไม่ใช่ "ค่าในเส้นทาง"
#    /api/public/verify/:certificateNumber ตั้งไว้ 30 ครั้ง/นาที
#    บิลด์เก่า: ยิงเลขต่างกันได้ถังใหม่ทุกครั้ง → ไม่มีตัวไหนถูกบล็อกเลย
blocked=0
for i in $(seq 1 40); do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$HOST/api/public/verify/GACP-PROBE-$$-$i" 2>/dev/null)
    [ "$c" = "429" ] && blocked=$((blocked+1))
done
if [ "$blocked" -gt 0 ]; then
    ok "ตัวจำกัดอัตรานับเส้นทาง ไม่ใช่ค่า" "ยิงเลขต่างกัน 40 ครั้ง ถูกบล็อก $blocked"
else
    bad "ตัวจำกัดอัตรานับเส้นทาง ไม่ใช่ค่า" "ยิงเลขต่างกัน 40 ครั้ง ไม่ถูกบล็อกเลย"
fi

echo
echo "  ผ่าน $pass · ไม่ผ่าน $fail"
[ "$fail" -eq 0 ] || exit 1
