#!/usr/bin/env bash
# no-skip — ไม่มี .skip/.only/xit/xdescribe ในตำแหน่งที่ **รันได้** นอกรายการที่ operator เซ็น
#
# ── ทำไมต้องข้ามคอมเมนต์ (แก้ 2026-09-11) ────────────────────────────────────
# รุ่นก่อนหน้า grep ทั้งบรรทัดโดยไม่สนว่าเป็นโค้ดหรือคอมเมนต์ ⇒ คอมเมนต์ที่อธิบายว่า
# "บรรทัดนี้เคยเป็น test.skip(...) และถูกถอดเพราะอะไร" กลายเป็นการละเมิดเสียเอง
# ⇒ คนที่เก็บกวาด skip ถูกลงโทษด้วยการห้ามอธิบายว่าเก็บกวาดอะไรไป และเหตุผลก็หายไป
# พร้อมโค้ด — ซึ่งเป็นวิธีที่ skip ตัวถัดไปจะถูกเพิ่มกลับมาโดยไม่มีใครรู้ว่าเคยมี
#
# หลักเดียวกับที่ eslint-rules/no-legacy-status-vocabulary.js เขียนไว้เอง:
# "A comment explaining why a value was removed is documentation, not a violation."
#
# ใช้:  bash scripts/probes/no-skip.sh
#       bash scripts/probes/no-skip.sh --selftest
#       NO_SKIP_SCAN_ROOT=<dir> bash scripts/probes/no-skip.sh
source "$(dirname "$0")/_lib.sh"
ALLOW="$(dirname "$0")/no-skip-allowlist.txt"

PATTERN='\.(skip|only)\(|\bxit\(|\bxdescribe\('

# กรองบรรทัดคอมเมนต์ออก: `//` นำหน้า, ` * ` ของบล็อกคอมเมนต์, และ `/*` เปิดบรรทัด
# ตัดที่ต้นบรรทัด (หลังช่องว่าง) เท่านั้น — โค้ดที่มีคอมเมนต์ต่อท้ายยังถูกจับตามปกติ
strip_comments() {
    grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)'
}

scan() { # $1 = root ที่จะสแกน
    local root="$1" targets=()
    for d in "$root/apps/backend/__tests__" "$root/tests" "$root/apps/web-app"; do
        [ -d "$d" ] && targets+=("$d")
    done
    [ ${#targets[@]} -eq 0 ] && return 0
    grep -rnE "$PATTERN" "${targets[@]}" 2>/dev/null \
        --include='*.test.js' --include='*.spec.js' --include='*.test.ts' --include='*.spec.ts' \
        --exclude-dir=node_modules \
        | strip_comments \
        | { [ -s "$ALLOW" ] && grep -vFf "$ALLOW" || cat; } 2>/dev/null || true
}

if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    mk() { mkdir -p "$1/tests"; printf '%s\n' "$2" > "$1/tests/x.spec.ts"; }
    check() { # $1 label $2 dir $3 expected-exit $4 needle
        local out code; CASES=$((CASES+1))
        out="$(NO_SKIP_SCAN_ROOT="$2" bash "$0" 2>&1)"; code=$?
        if [ "$code" != "$3" ]; then
            echo "  ✗ $1 — คาด exit $3 ได้ $code"; echo "$out" | sed 's/^/      /'; BAD=1; return
        fi
        [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -q "$4" && {
            echo "  ✗ $1 — ไม่พบ \"$4\""; echo "$out" | sed 's/^/      /'; BAD=1; return; }
        echo "  ✓ $1"
    }

    A="$TMP/a"; mk "$A" "test('ok', async () => { expect(1).toBe(1); });"
    check "ไม่มี skip = PASS" "$A" 0 "PASS"

    B="$TMP/b"; mk "$B" "test.skip('x', async () => {});"
    check "skip จริง = FAIL" "$B" 1 "x.spec.ts"

    C="$TMP/c"; mk "$C" "// เดิมบรรทัดนี้เป็น test.skip(cond, 'reason') และถูกถอดออก
test('ok', async () => { expect(1).toBe(1); });"
    check "คอมเมนต์บรรทัดเดียวที่เอ่ยถึง = PASS" "$C" 0 "PASS"

    D="$TMP/d"; mk "$D" "/**
 * อธิบายว่าเคยมี test.skip(expectLiveBackend(), ...) แล้วถอดทำไม
 */
test('ok', async () => { expect(1).toBe(1); });"
    check "บล็อกคอมเมนต์ที่เอ่ยถึง = PASS" "$D" 0 "PASS"

    E="$TMP/e"; mk "$E" "test.only('x', async () => {}); // เหลือ only ค้างไว้"
    check "only พร้อมคอมเมนต์ต่อท้าย = FAIL" "$E" 1 "x.spec.ts"

    echo "selftest: $CASES เคส"
    [ "$BAD" = 0 ] || exit 1
    echo "PASS: selftest ครบทั้งสองทิศ"
    exit 0
fi

HITS="$(scan "${NO_SKIP_SCAN_ROOT:-$ROOT}")"
[ -n "$HITS" ] && fail "$(printf '%s' "$HITS" | head -10)"
pass "0 skip/only ในตำแหน่งที่รันได้ นอกรายการที่เซ็นไว้"
