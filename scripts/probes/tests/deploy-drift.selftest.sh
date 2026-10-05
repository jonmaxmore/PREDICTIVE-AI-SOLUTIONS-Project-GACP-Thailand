#!/usr/bin/env bash
# Selftest for scripts/probes/deploy-drift.sh — hermetic, no real network.
#
# WHY IT LIVES IN tests/ RATHER THAN BESIDE ITS TARGET: scripts/ci/probe-gate.js
# :137-144 treats every scripts/probes/*.sh except _lib.sh as a probe and fails
# the gate for any of them without a registry row. A selftest is not a checker of
# the system, so giving it a row would put a lie in the one file that is supposed
# to be the register of what checks what. readdirSync does not recurse, so a
# subdirectory is out of that scan's scope.
#
# THE RULE THIS FILE WAS WRITTEN UNDER, learned the same day from
# scripts/ops/gacp-backup.selftest.sh: a stub that is KINDER than production
# makes the test lie in the only direction that costs anything. That selftest's
# fake docker inherited the script's own umask, so archives came out 600 in the
# test while the real box produced root-owned 644, and the assertion passed
# against the broken script. Every stub here is therefore built to fail the way
# the real thing fails — the fake curl exits non-zero with no body, as curl does
# on a timeout, rather than returning an empty success.
#
# Run:  bash scripts/probes/tests/deploy-drift.selftest.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET="$ROOT/scripts/probes/deploy-drift.sh"

pass=0; fail=0; skip=0
ok()      { printf '  PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad()     { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; fail=$((fail + 1)); }
skipped() { printf '  SKIP  %s\n' "$1"; printf '        %s\n' "$2"; skip=$((skip + 1)); }

HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"

# A fake curl that answers every URL with the same body.
#   $1 = bin dir · $2 = body · $3 = exit code (non-zero ⇒ no body, like real curl)
make_fake_curl() {
    local bin="$1" body="$2" code="${3:-0}"
    mkdir -p "$bin"
    {
        printf '#!/usr/bin/env bash\n'
        printf 'code=%s\n' "$code"
        printf '[ "$code" != "0" ] && exit "$code"\n'
        printf 'cat <<%s\n%s\n%s\n' "CURLBODY" "$body" "CURLBODY"
    } > "$bin/curl"
    chmod +x "$bin/curl"
}

# A PATH containing ONLY the tools named — the only way this test can hold an
# environment where curl is genuinely absent, since it cannot uninstall it.
# Emptying PATH instead would break mkdir and grep too, and the probe would then
# fail for a reason that has nothing to do with the case under test.
make_sandbox_bin() {
    local bin="$1"; shift
    mkdir -p "$bin"
    local t p
    for t in "$@"; do
        p="$(command -v "$t" 2>/dev/null)" || continue
        cp "$p" "$bin/$t" 2>/dev/null || ln -sf "$p" "$bin/$t" 2>/dev/null || true
    done
}

run_probe() { # $1 = bin dir  $2 = targets file
    PATH="$1:$PATH" DEPLOY_TARGETS_FILE="$2" bash "$TARGET" 2>&1
}

echo "=== deploy-drift.sh selftest ==="

# ── A. revision matches the ref ──────────────────────────────────────────────
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_fake_curl "$T/bin" "{\"revision\":\"$HEAD_SHA\",\"builtAt\":\"2026-08-14T00:00:00Z\"}"
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
[ "$rc" = "0" ] && ok "revision ตรงกับ ref ⇒ PASS" \
    || bad "revision ตรงกับ ref ⇒ PASS" "exit $rc — $out"

# ── B. revision is a different commit ────────────────────────────────────────
# The message has to name BOTH sides. "Does not match" without the two values
# tells the reader to go and run the comparison the probe just ran.
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_fake_curl "$T/bin" '{"revision":"0000000000000000000000000000000000000000"}'
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
if [ "$rc" = "1" ] && printf '%s' "$out" | grep -q '0000000' && printf '%s' "$out" | grep -q "${HEAD_SHA:0:12}"; then
    ok "revision ต่างจาก ref ⇒ FAIL และบอก sha ทั้งสองฝั่ง"
else
    bad "revision ต่างจาก ref ⇒ FAIL และบอก sha ทั้งสองฝั่ง" "exit $rc — $out"
fi

# ── C. revision is null ──────────────────────────────────────────────────────
# An image that cannot say which commit it is has not been checked, so it must
# not count as checked. null is a DIFFERENT problem from drift and needs a
# different fix (rebuild with the build arg), so the message must say so.
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_fake_curl "$T/bin" '{"revision":null}'
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
if [ "$rc" = "1" ] && printf '%s' "$out" | grep -qi 'null\|build-arg\|GIT_SHA'; then
    ok "revision เป็น null ⇒ FAIL พร้อมบอกว่าให้ build ใหม่"
else
    bad "revision เป็น null ⇒ FAIL พร้อมบอกว่าให้ build ใหม่" "exit $rc — $out"
fi

# ── D. endpoint unreachable — the case that must never pass ──────────────────
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_fake_curl "$T/bin" '' 28
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
if [ "$rc" = "1" ] && printf '%s' "$out" | grep -qi 'reach\|network'; then
    ok "ยิงไม่ถึง ⇒ FAIL และบอกว่าเป็นเรื่องเครือข่าย"
else
    bad "ยิงไม่ถึง ⇒ FAIL และบอกว่าเป็นเรื่องเครือข่าย" "exit $rc — $out"
fi

# ── E. a body that is not the expected shape ─────────────────────────────────
# An nginx error page is still HTTP 200 sometimes. Parsing it as "no revision"
# and moving on would report the deployment as unchecked-but-fine.
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_fake_curl "$T/bin" '<html><body>502 Bad Gateway</body></html>'
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
[ "$rc" = "1" ] && ok "คำตอบไม่ใช่ JSON ที่มี revision ⇒ FAIL" \
    || bad "คำตอบไม่ใช่ JSON ที่มี revision ⇒ FAIL" "exit $rc — $out"

# ── F. empty target list must not pass ───────────────────────────────────────
T="$(mktemp -d)"
printf '# ทุกบรรทัดเป็นคอมเมนต์\n\n' > "$T/targets.txt"
make_fake_curl "$T/bin" '{"revision":"whatever"}'
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
[ "$rc" = "1" ] && ok "ไม่มีเป้าหมายให้ตรวจ ⇒ FAIL ไม่ใช่ PASS" \
    || bad "ไม่มีเป้าหมายให้ตรวจ ⇒ FAIL ไม่ใช่ PASS" "exit $rc — $out"

# ── G. missing target file must not pass ─────────────────────────────────────
T="$(mktemp -d)"
make_fake_curl "$T/bin" '{"revision":"whatever"}'
out="$(run_probe "$T/bin" "$T/no-such-file.txt")"; rc=$?
[ "$rc" = "1" ] && ok "ไฟล์เป้าหมายหาย ⇒ FAIL" \
    || bad "ไฟล์เป้าหมายหาย ⇒ FAIL" "exit $rc — $out"

# ── H. curl absent is BLOCKED, not FAIL ──────────────────────────────────────
# full-gate.sh:1009 already draws this line for gitleaks: "the tool could not
# run" is not a verdict about the thing being checked.
#
# The only way this test can hold an environment where curl is genuinely absent
# is to build a PATH containing everything the probe needs EXCEPT curl. On
# git-bash that cannot be done: the tools are MSYS executables that resolve
# msys-2.0.dll through PATH, so a directory holding copies of them is not a
# working environment — bash itself exits 127 before the probe runs.
#
# Asserting anyway would report a failure that says nothing about the probe, and
# loosening the assertion to accept 127 would make the case pass for a probe that
# does not implement the behaviour at all. So: detect, and SKIP out loud. This
# case is verified on Linux — see evidence/runtime-deploy-drift/task3/.
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_sandbox_bin "$T/nocurl" bash mkdir grep git node dirname
if ! PATH="$T/nocurl" bash -c 'exit 0' 2>/dev/null; then
    skipped "ไม่มี curl ⇒ BLOCKED (exit 2) ไม่ใช่ FAIL" \
        "platform นี้สร้าง PATH sandbox ไม่ได้ (git-bash/MSYS — สำเนา .exe หา msys-2.0.dll ไม่เจอ) ⇒ ต้องรันบน Linux"
else
    out="$(PATH="$T/nocurl" DEPLOY_TARGETS_FILE="$T/targets.txt" bash "$TARGET" 2>&1)"; rc=$?
    [ "$rc" = "2" ] && ok "ไม่มี curl ⇒ BLOCKED (exit 2) ไม่ใช่ FAIL" \
        || bad "ไม่มี curl ⇒ BLOCKED (exit 2) ไม่ใช่ FAIL" "exit $rc — $out"
fi

# ── I. a ref that does not resolve ───────────────────────────────────────────
# A row naming a deleted branch must fail loudly. Skipping it would shrink the
# checked set silently, which is how coverage disappears without anyone deciding.
T="$(mktemp -d)"
{ printf 'good | https://example.invalid/a | HEAD\n'
  printf 'bad  | https://example.invalid/b | refs/heads/no-such-branch-xyz\n'; } > "$T/targets.txt"
make_fake_curl "$T/bin" "{\"revision\":\"$HEAD_SHA\"}"
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
[ "$rc" = "1" ] && ok "ref ที่ resolve ไม่ได้ ⇒ FAIL" \
    || bad "ref ที่ resolve ไม่ได้ ⇒ FAIL" "exit $rc — $out"

# ── J. a short revision still matches by prefix ──────────────────────────────
# Short SHAs are a legal answer; rejecting them would make the probe fail on a
# correct deployment.
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_fake_curl "$T/bin" "{\"revision\":\"${HEAD_SHA:0:12}\"}"
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
[ "$rc" = "0" ] && ok "revision แบบสั้น ตรงด้วย prefix ⇒ PASS" \
    || bad "revision แบบสั้น ตรงด้วย prefix ⇒ PASS" "exit $rc — $out"

# ── K. a revision too short to identify anything ─────────────────────────────
# Prefix matching has to have a floor, or "a" matches every commit starting a.
T="$(mktemp -d)"
printf 'only | https://example.invalid/api/health | HEAD\n' > "$T/targets.txt"
make_fake_curl "$T/bin" "{\"revision\":\"${HEAD_SHA:0:3}\"}"
out="$(run_probe "$T/bin" "$T/targets.txt")"; rc=$?
[ "$rc" = "1" ] && ok "revision สั้นเกินกว่าจะระบุ commit ⇒ FAIL" \
    || bad "revision สั้นเกินกว่าจะระบุ commit ⇒ FAIL" "exit $rc — $out"

echo ""
echo "=== ผล: PASS=$pass FAIL=$fail SKIP=$skip ==="
[ "$skip" = "0" ] || echo "    มี $skip เคสที่ platform นี้พิสูจน์ไม่ได้ — ผลจากเครื่องนี้ยังไม่ครบ ต้องรันบน Linux ด้วย"
[ "$fail" = "0" ]
