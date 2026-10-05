#!/usr/bin/env bash
# Selftest for scripts/ops/gacp-backup.sh — black box, hermetic, no real docker.
#
# WHY BLACK BOX: gacp-backup.sh runs from cron with elevated rights. Adding a
# --selftest branch to it would put test-only code in that path. Instead this
# runner executes the real script with a fake `docker` first on PATH and a temp
# GACP_BACKUP_DIR, then asserts on the files it produced. Nothing here touches a
# container, a volume, or a database.
#
# Covers the gaps recorded in reports/risk-assessment/2026-08-13.md (§4 R3, R5)
# plus the defects an adversarial review of the first version proved by running it:
#   - the first selftest passed with BOTH volume names typo'd, because it matched
#     archives with a loose substring glob against a fake docker that wrote a file
#     for any `run`. Real docker AUTO-CREATES a missing named volume, so a typo
#     would have produced an empty tarball and a green run.
#   - it never checked WHY the failure case failed, so any unrelated non-zero exit
#     satisfied it.
#   - it never asserted that both databases were dumped.
#   - it never exercised retention, which under `set -e` never ran once a later
#     step failed.
#
# Run:  bash scripts/ops/gacp-backup.selftest.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${GACP_SELFTEST_TARGET:-$SCRIPT_DIR/gacp-backup.sh}"

pass=0; fail=0; skip=0

ok()      { printf '  PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad()     { printf '  FAIL  %s\n' "$1"; printf '        %s\n' "$2"; fail=$((fail + 1)); }
skipped() { printf '  SKIP  %s\n' "$1"; printf '        %s\n' "$2"; skip=$((skip + 1)); }

# Can this filesystem express POSIX modes at all? git-bash on Windows mounts
# NTFS with `noacl`, so chmod and umask are silently ignored and every file
# reports 644. Asserting mode there would fail on a correct script, and rewriting
# the assertion to "the source contains chmod" would test the implementation
# instead of the behaviour. So: detect, and SKIP out loud.
fs_supports_modes() {
    local probe; probe="$(mktemp)"
    chmod 600 "$probe" 2>/dev/null
    local m; m="$(stat -c '%a' "$probe" 2>/dev/null || stat -f '%Lp' "$probe" 2>/dev/null)"
    rm -f "$probe"
    [ "$m" = "600" ]
}

# The expected volume list is READ FROM THE SCRIPT, not duplicated here, so
# dropping a volume from production cannot leave a green test behind.
expected_volumes() {
    sed -n 's/^VOLUMES="\${GACP_BACKUP_VOLUMES:-\(.*\)}"$/\1/p' "$TARGET"
}

# ── fake docker ───────────────────────────────────────────────────────────────
# Faithful about argument SHAPE and about volume EXISTENCE. Unknown invocations
# exit non-zero so a newly added docker call cannot slip in untested.
# FAKE_VOLUMES lists the volumes that "exist"; anything else is reported missing,
# which is what a typo'd name must look like to the script under test.
make_fake_docker() {
    local bin="$1"
    mkdir -p "$bin"
    cat > "$bin/docker" <<'FAKE'
#!/usr/bin/env bash
set -uo pipefail

if [ "${1:-}" = "exec" ] && printf '%s\n' "$@" | grep -q '^pg_dump$'; then
    db="${!#}"
    printf 'FAKE-PGDUMP-CUSTOM-FORMAT db=%s\n' "$db"
    exit 0
fi

if [ "${1:-}" = "exec" ] && printf '%s\n' "$@" | grep -q '^pg_restore$'; then
    content="$(cat)"
    if [ "${FAKE_PGRESTORE_FAIL:-0}" = "1" ]; then
        echo "pg_restore: error: did not find magic string in file header" >&2
        exit 1
    fi
    case "$content" in
        FAKE-PGDUMP-*) echo "; Archive created at fake"; exit 0 ;;
        *) echo "pg_restore: error: did not find magic string in file header" >&2; exit 1 ;;
    esac
fi

if [ "${1:-}" = "volume" ] && [ "${2:-}" = "inspect" ]; then
    want="${3:-}"
    for v in ${FAKE_VOLUMES:-}; do
        [ "$v" = "$want" ] && { echo "[{\"Name\":\"$want\"}]"; exit 0; }
    done
    echo "Error: No such volume: $want" >&2
    exit 1
fi

if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
    [ "${FAKE_IMAGE_MISSING:-0}" = "1" ] && { echo "Error: No such image" >&2; exit 1; }
    echo "[{\"Id\":\"sha256:fake\"}]"; exit 0
fi

if [ "${1:-}" = "run" ]; then
    [ "${FAKE_TAR_FAIL:-0}" = "1" ] && { echo "tar: No space left on device" >&2; exit 2; }
    out_host=""; dest=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -v) case "$2" in *:/dst) out_host="${2%%:*}" ;; esac; shift 2 ;;
            czf|-czf) dest="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    if [ -n "$out_host" ] && [ -n "$dest" ]; then
        target="$out_host/$(basename "$dest")"
        if [ -e "$target" ]; then
            # Writing to a path the HOST already created: `>` is O_TRUNC, the
            # inode survives, and mode and owner stay the host's. Whether the
            # script arranges for this is the whole question.
            printf 'FAKE-TAR\n' > "$target"
        else
            # Creating a NEW path: in production the container is root with the
            # image default umask 022, so the archive lands root-owned 0644 and
            # a cron user CANNOT chmod it afterwards. The umask alone is not the
            # reason the box produced 644 — the ownership is. Record the path so
            # the fake chmod refuses it, which is the half that actually failed.
            umask 022
            printf 'FAKE-TAR\n' > "$target"
            [ -n "${FAKE_ROOT_OWNED:-}" ] && echo "$target" >> "$FAKE_ROOT_OWNED"
        fi
        exit 0
    fi
    echo "fake docker: unrecognised run form" >&2
    exit 90
fi

echo "fake docker: unexpected invocation: $*" >&2
exit 91
FAKE
    chmod +x "$bin/docker"

    # A privilege boundary the test cannot cross for real: it does not run as
    # root, so it cannot produce a file it is unable to chmod. Stubbing chmod at
    # the same seam where docker is already stubbed is what makes the production
    # failure reachable — without it the script's post-hoc `chmod 600` succeeds
    # here and fails on the box, and the test reports green for a broken script.
    # Paths not registered as container-created go to the real chmod, so the
    # directory and dump permissions are still exercised for real.
    cat > "$bin/chmod" <<'FAKE'
#!/usr/bin/env bash
set -uo pipefail
reg="${FAKE_ROOT_OWNED:-/nonexistent}"
for a in "$@"; do
    if [ -f "$reg" ] && grep -qxF -- "$a" "$reg" 2>/dev/null; then
        echo "chmod: changing permissions of '$a': Operation not permitted" >&2
        exit 1
    fi
done
for real in /bin/chmod /usr/bin/chmod; do
    [ -x "$real" ] && exec "$real" "$@"
done
echo "fake chmod: real chmod not found" >&2
exit 92
FAKE
    chmod +x "$bin/chmod"
}

# Run the script under test. Extra VAR=value args are passed through to `env`.
run_backup() {
    local out="$1"; shift
    local bin="$1"; shift
    PATH="$bin:$PATH" \
    GACP_BACKUP_DIR="$out" \
    GACP_PG_CONTAINER=fake-postgres \
    GACP_PG_USER=fakeuser \
    FAKE_VOLUMES="$(expected_volumes)" \
    FAKE_ROOT_OWNED="$bin/.root-owned" \
    env "$@" bash "$TARGET" 2>&1
}

echo "=== gacp-backup.sh selftest ==="

VOLS="$(expected_volumes)"
if [ -z "$VOLS" ]; then
    bad "อ่านรายชื่อ volume จากสคริปต์ได้" "parse VOLUMES= จาก $TARGET ไม่ได้ — assertion อื่นเชื่อถือไม่ได้"
fi

# ── 0. the required set is held HERE, not derived ────────────────────────────
# The completeness check below reads the list from the script, which means a
# volume deleted from the script becomes "expected" and the run stays green.
# This list is the test's own, so dropping any of these fails. Provenance:
# docker-compose.production.yml:559-566 (each has an explicit `name:`).
REQUIRED_VOLUMES="gacp-uploads-data gacp-storage-data gacp-signing-keys gacp-minio-data gacp-platform_gacp_staging_uploads gacp-platform_gacp_staging_storage gacp-platform_gacp_staging_signing_keys"
absent=""
for r in $REQUIRED_VOLUMES; do
    printf '%s\n' $VOLS | grep -qx "$r" || absent="$absent $r"
done
if [ -z "$absent" ]; then
    ok "สคริปต์ยังครอบ volume ที่ห้ามหาย ($(printf '%s' "$REQUIRED_VOLUMES" | wc -w) ตัว)"
else
    bad "สคริปต์ต้องครอบ volume ที่ห้ามหาย" \
        "ขาด:$absent — gacp-signing-keys คือกุญแจที่เซ็นใบรับรองทุกใบ หายแล้วสร้างใหม่ไม่ได้"
fi

# ── run 1: the happy path ─────────────────────────────────────────────────────
T1="$(mktemp -d)"; make_fake_docker "$T1/bin"; out1="$T1/backups"
log1="$(run_backup "$out1" "$T1/bin")"; rc1=$?

if [ "$rc1" -eq 0 ]; then
    ok "รันปกติแล้วออกด้วย 0"
else
    bad "รันปกติแล้วออกด้วย 0" "exit $rc1 — $(printf '%s' "$log1" | tail -2 | tr '\n' ' ')"
fi

# 1a. every configured database is dumped
for db in gacp_db gacp_staging; do
    if find "$out1" -name "${db}_*.dump" 2>/dev/null | grep -q .; then
        ok "ดัมป์ฐาน ${db}"
    else
        bad "ดัมป์ฐาน ${db}" "ไม่พบ ${db}_*.dump — ฐานหนึ่งหายไปเงียบ ๆ"
    fi
done

# 1b. dumps are not world-readable
dump="$(find "$out1" -name 'gacp_db_*.dump' 2>/dev/null | head -1)"
if [ -z "$dump" ]; then
    bad "ตรวจสิทธิ์ไฟล์ดัมป์" "ไม่มีไฟล์ให้ตรวจ"
elif ! fs_supports_modes; then
    skipped "ไฟล์ดัมป์เป็น mode 600" \
        "filesystem นี้ไม่รองรับ POSIX mode (git-bash/NTFS noacl — chmod ไม่มีผล) ⇒ ต้องรันบน Linux"
else
    mode="$(stat -c '%a' "$dump" 2>/dev/null || stat -f '%Lp' "$dump")"
    [ "$mode" = "600" ] && ok "ไฟล์ดัมป์เป็น mode 600" \
        || bad "ไฟล์ดัมป์เป็น mode 600" "ได้ mode $mode"
fi

# 1d. volume archives are not world-readable EITHER
#
# The dump check above passes on the strength of `umask 077`, which covers files
# the script's own shell creates. Archives are created by the container, which
# has its own umask and its own user — a separate mechanism that needs its own
# assertion. On the staging box 2026-08-14 the dumps were 600 and the archives
# were root-owned 644 in the same directory, from the same run.
arch="$(find "$out1" -name '*.tgz' 2>/dev/null | head -1)"
if [ -z "$arch" ]; then
    bad "ตรวจสิทธิ์ไฟล์ archive" "ไม่มีไฟล์ให้ตรวจ"
elif ! fs_supports_modes; then
    skipped "ไฟล์ archive เป็น mode 600" \
        "filesystem นี้ไม่รองรับ POSIX mode (git-bash/NTFS noacl — chmod ไม่มีผล) ⇒ ต้องรันบน Linux"
else
    mode="$(stat -c '%a' "$arch" 2>/dev/null || stat -f '%Lp' "$arch")"
    [ "$mode" = "600" ] && ok "ไฟล์ archive เป็น mode 600" \
        || bad "ไฟล์ archive เป็น mode 600" "ได้ mode $mode — โหมดโฟลเดอร์กันได้เฉพาะตอนไฟล์ยังอยู่ในโฟลเดอร์"
fi

# 1c. EVERY configured volume produces an archive under its EXACT name
missing=""
for v in $VOLS; do
    find "$out1" -name "${v}_*.tgz" 2>/dev/null | grep -q . || missing="$missing $v"
done
if [ -z "$missing" ]; then
    ok "สำรอง volume ครบทุกตัวที่ตั้งไว้ ($(printf '%s' "$VOLS" | wc -w) ตัว)"
else
    bad "สำรอง volume ครบทุกตัวที่ตั้งไว้" "ขาด:$missing"
fi

# ── 2. a volume that does not exist must fail loudly ──────────────────────────
# Real docker auto-creates a missing named volume and tars nothing, so a typo
# would otherwise produce an empty archive and a green run.
T2="$(mktemp -d)"; make_fake_docker "$T2/bin"; out2="$T2/backups"
log2="$(PATH="$T2/bin:$PATH" GACP_BACKUP_DIR="$out2" GACP_PG_CONTAINER=fake-postgres \
        GACP_PG_USER=fakeuser FAKE_VOLUMES="$VOLS" \
        env GACP_BACKUP_VOLUMES="gacp-uploads-dataX" bash "$TARGET" 2>&1)"; rc2=$?
if [ "$rc2" -ne 0 ] && printf '%s' "$log2" | grep -qi "volume"; then
    ok "volume ที่ไม่มีอยู่จริง ทำให้ล้มพร้อมบอกว่าเป็นเรื่อง volume"
else
    bad "volume ที่ไม่มีอยู่จริงต้องทำให้ล้ม" \
        "exit $rc2 — ชื่อพิมพ์ผิดจะได้ tarball เปล่าแล้วรายงานว่าสำเร็จ · log: $(printf '%s' "$log2" | tail -1)"
fi

# ── 3. an unreadable dump must fail, and fail FOR THAT REASON ────────────────
T3="$(mktemp -d)"; make_fake_docker "$T3/bin"; out3="$T3/backups"
log3="$(run_backup "$out3" "$T3/bin" FAKE_PGRESTORE_FAIL=1)"; rc3=$?
if [ "$rc3" -ne 0 ] && printf '%s' "$log3" | grep -q "not a readable archive"; then
    ok "ดัมป์ที่อ่านไม่ออก ล้มพร้อมเหตุผลที่ถูกต้อง"
else
    bad "ดัมป์ที่อ่านไม่ออกต้องล้มพร้อมเหตุผลที่ถูกต้อง" \
        "exit $rc3 · log: $(printf '%s' "$log3" | tail -1)"
fi

# ── 4. retention must still run when a later step fails ──────────────────────
# Under `set -e` a prune placed after the volume loop never executes once tar
# fails. The disk then fills a little more every night with nothing removed.
T4="$(mktemp -d)"; make_fake_docker "$T4/bin"; out4="$T4/backups"
mkdir -p "$out4"
touch -d '40 days ago' "$out4/gacp_db_OLD.dump" "$out4/gacp-uploads-data_OLD.tgz" 2>/dev/null \
    || touch -t 202606010000 "$out4/gacp_db_OLD.dump" "$out4/gacp-uploads-data_OLD.tgz"
run_backup "$out4" "$T4/bin" FAKE_TAR_FAIL=1 >/dev/null 2>&1
leftover="$(find "$out4" -name '*_OLD.*' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$leftover" -eq 0 ]; then
    ok "ไฟล์เกินอายุถูกลบแม้ขั้นตอนหลังจะล้ม"
else
    bad "ไฟล์เกินอายุต้องถูกลบแม้ขั้นตอนหลังล้ม" \
        "เหลือ $leftover ไฟล์อายุ 40 วัน — คืนที่ tar ล้ม ดิสก์จะโตขึ้นโดยไม่มีอะไรถูกลบ"
fi

# ── 5. a relative backup dir must be refused ─────────────────────────────────
# docker treats a `-v` source that is not an absolute path as a NAMED VOLUME,
# so the tarballs would land inside an invisible volume while the run exits 0.
T5="$(mktemp -d)"; make_fake_docker "$T5/bin"
log5="$(cd "$T5" && PATH="$T5/bin:$PATH" GACP_BACKUP_DIR="relative/dir" \
        GACP_PG_CONTAINER=fake-postgres GACP_PG_USER=fakeuser FAKE_VOLUMES="$VOLS" \
        bash "$TARGET" 2>&1)"; rc5=$?
if [ "$rc5" -ne 0 ] && printf '%s' "$log5" | grep -qi "absolute"; then
    ok "GACP_BACKUP_DIR แบบ relative ถูกปฏิเสธ"
else
    bad "GACP_BACKUP_DIR แบบ relative ต้องถูกปฏิเสธ" \
        "exit $rc5 — docker จะตีความว่าเป็นชื่อ named volume แล้ว tarball จะหายเข้าไปข้างใน"
fi

rm -rf "$T1" "$T2" "$T3" "$T4" "$T5"

echo ""
echo "=== ผล: PASS=$pass FAIL=$fail SKIP=$skip ==="
if [ "$skip" -gt 0 ]; then
    echo "!!! มี $skip ข้อที่ยังไม่ถูกพิสูจน์บนเครื่องนี้ — ผลนี้ยังไม่ใช่หลักฐานครบ"
    echo "!!! ต้องรันซ้ำบนเซิร์ฟเวอร์ Linux แล้วแนบ output ที่ SKIP=0"
fi
[ "$fail" -eq 0 ]
