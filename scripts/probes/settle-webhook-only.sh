#!/usr/bin/env bash
# settle-webhook-only — ไม่มีเส้นทางใดนอก checkout-settlement-service ที่ **เขียน**
# สถานะ checkout เป็น SETTLED และเทสหน่วยของการตัดเงินต้องเขียว
#
# ── ทำไมต้องแยก "เขียน" ออกจาก "อ่าน" (แก้ 2026-09-11) ────────────────────────
# รุ่นก่อนหน้า grep หาข้อความ `status: 'SETTLED'` ตรง ๆ ซึ่งแมตช์ทั้ง
#     data:  { status: 'SETTLED' }      ← เขียน (สิ่งที่ด่านนี้ห้าม)
#     where: { status: 'SETTLED' }      ← อ่าน  (ปกติสิ้นดี)
# ⇒ มันฟ้อง dtam-remittance-service.js กับ dtam-remittance-batch-job.js ซึ่งทั้งคู่
# **อ่าน** ใบที่ตัดเงินแล้วเพื่อไปกระทบยอด ไม่ได้เขียนอะไรเลย · ด่านที่ฟ้องของที่ถูกต้อง
# คือด่านที่ถูกปิดเสียง แล้วกฎจริงก็หายไปกับมัน (แถวนี้ถูกจอดเป็น manual อยู่หลายเดือน
# ด้วยเหตุผลที่ไม่ใช่เหตุผลจริงของมัน)
#
# กติกาที่ใช้ตัดสิน: นับ `status: 'SETTLED'` เป็นการเขียน ก็ต่อเมื่อ **เครื่องหมายล่าสุด
# ก่อนหน้ามันคือ `data:`** · ถ้าเป็น `where:` คือการอ่าน · ตัวอักษรเดียวกัน คนละเจตนา
#
# ใช้:  bash scripts/probes/settle-webhook-only.sh
#       bash scripts/probes/settle-webhook-only.sh --selftest
#       SETTLE_SCAN_ROOT=<dir> bash scripts/probes/settle-webhook-only.sh
#         ^ สแกนต้นไม้สังเคราะห์ เพื่อออกกำลังด่านกับ fixture ที่รู้คำตอบอยู่แล้ว
#           ทั้งเคสสกปรกและเคสสะอาด ไม่ใช่แค่กับสิ่งที่ repo บังเอิญมีวันนี้
source "$(dirname "$0")/_lib.sh"

SETTLE_REL="services/checkout/checkout-settlement-service.js"

# พิมพ์ไฟล์ที่ **เขียน** SETTLED (หนึ่งบรรทัดต่อไฟล์) ในต้นไม้ที่ให้มา
settled_writers() {
    local root="$1"
    local dirs=()
    for d in services routes jobs; do
        [ -d "$root/$d" ] && dirs+=("$root/$d")
    done
    [ ${#dirs[@]} -eq 0 ] && return 0
    grep -rl "status: 'SETTLED'" "${dirs[@]}" --include='*.js' 2>/dev/null | while IFS= read -r f; do
        awk '
            # จำเครื่องหมายล่าสุด — data: = กำลังจะเขียน · where: = กำลังจะอ่าน
            /data[[:space:]]*:/  { mark = "data" }
            /where[[:space:]]*:/ { mark = "where" }
            # data: กับค่าอยู่บรรทัดเดียวกัน ก็ยังเป็นการเขียน
            /data[[:space:]]*:.*status[[:space:]]*:[[:space:]]*.SETTLED./ { print FILENAME; exit }
            /status[[:space:]]*:[[:space:]]*.SETTLED./ {
                if (mark == "data") { print FILENAME; exit }
            }
        ' "$f"
    done
}

# ── selftest ──────────────────────────────────────────────────────────────────
# อยู่ในไฟล์เพื่อให้ operator รันหลักฐานซ้ำได้เอง (L6) แบบเดียวกับ fee-single-source
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0

    make_tree() { # $1 dir
        mkdir -p "$1/services/checkout" "$1/routes" "$1/jobs"
        cat >"$1/$SETTLE_REL" <<'JS'
await tx.checkoutOrder.update({ where: { id }, data: { status: 'SETTLED' } });
JS
    }
    check() { # $1 label  $2 dir  $3 expected-exit  [$4 needle]
        local out code
        CASES=$((CASES + 1))
        out="$(SETTLE_SCAN_ROOT="$2" bash "$0" 2>&1)"; code=$?
        if [ "$code" != "$3" ]; then
            echo "  ✗ $1 — คาด exit $3 ได้ $code"; echo "$out" | sed 's/^/      /'; BAD=1; return
        fi
        if [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -q "$4"; then
            echo "  ✗ $1 — ไม่พบ \"$4\" ในผล"; echo "$out" | sed 's/^/      /'; BAD=1; return
        fi
        echo "  ✓ $1"
    }

    # เคสสะอาด: มีแต่ตัวตัดเงินที่เขียน
    A="$TMP/a"; make_tree "$A"
    check "เขียนเฉพาะในตัวตัดเงิน = PASS" "$A" 0 "PASS"

    # เคสสกปรก: ไฟล์อื่นเขียน
    B="$TMP/b"; make_tree "$B"
    cat >"$B/routes/rogue.js" <<'JS'
await prisma.checkoutOrder.update({ where: { id }, data: { status: 'SETTLED' } });
JS
    check "ไฟล์อื่นเขียน = FAIL" "$B" 1 "rogue.js"

    # เคสที่รุ่นก่อนหน้าฟ้องผิด: อ่านอย่างเดียว
    C="$TMP/c"; make_tree "$C"
    cat >"$C/jobs/reconcile.js" <<'JS'
const owed = await prisma.checkoutOrder.findMany({ where: { status: 'SETTLED' } });
JS
    check "อ่านอย่างเดียว = PASS (นี่คือบั๊กที่แก้)" "$C" 0 "PASS"

    # อ่านหลายบรรทัด — where: อยู่คนละบรรทัดกับค่า
    D="$TMP/d"; make_tree "$D"
    cat >"$D/services/agg.js" <<'JS'
const agg = await prisma.checkoutOrder.aggregate({
    where: {
        organizationId,
        status: 'SETTLED',
    },
});
JS
    check "อ่านแบบหลายบรรทัด = PASS" "$D" 0 "PASS"

    # เขียนหลายบรรทัด — data: อยู่คนละบรรทัดกับค่า
    E="$TMP/e"; make_tree "$E"
    cat >"$E/services/sneaky.js" <<'JS'
await prisma.checkoutOrder.update({
    where: { id },
    data: {
        status: 'SETTLED',
    },
});
JS
    check "เขียนแบบหลายบรรทัด = FAIL" "$E" 1 "sneaky.js"

    echo "selftest: $CASES เคส"
    [ "$BAD" = 0 ] || exit 1
    echo "PASS: selftest ครบทั้งสองทิศ"
    exit 0
fi

SCAN="${SETTLE_SCAN_ROOT:-$BACKEND}"
HITS="$(settled_writers "$SCAN" | grep -v "$SETTLE_REL" || true)"
[ -n "$HITS" ] && fail "extra SETTLED writers: $(printf '%s' "$HITS" | tr '\n' ' ')"

# โหมด fixture ไม่มี jest ให้รัน — ด่านที่สองเป็นของต้นไม้จริงเท่านั้น
if [ -n "${SETTLE_SCAN_ROOT:-}" ]; then
    pass "only $SETTLE_REL writes SETTLED (fixture scan)"
fi

LOG="$EVIDENCE_DIR/settle-webhook-only.log"
(cd "$BACKEND" && npx jest __tests__/unit/stripe-checkout-engine.test.js \
    -t "settles everything in ONE transaction" --silent --forceExit) >"$LOG" 2>&1 \
    || fail "settle unit test failed — $LOG"
pass "only $SETTLE_REL writes SETTLED; settle test green"
