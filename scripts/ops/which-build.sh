#!/usr/bin/env bash
# which-build.sh: "เซิร์ฟเวอร์นี้กำลังรันบิลด์ไหนอยู่?" ตอบด้วยคำสั่งเดียว
#
# design-reproducibility/01-build-identity: operator ที่ย้ายเครื่องทำงาน ย้าย
# server หรือส่งงานต่อบริษัทภายนอก ต้องมีทางตรวจสอบว่าเซิร์ฟเวอร์ที่กำลังดูอยู่
# รันซอร์สโค้ดจริงจาก commit ไหน โดยไม่ต้อง SSH เข้าไปอ่าน log
#
# ยิง GET <base-url>/api/webapp-version (apps/web-app/src/app/api/webapp-version/
# route.ts อ่านจาก apps/web-app/src/lib/build-info.ts) แล้วเทียบ commit ที่ได้กับ
# ประวัติ git ของเครื่องนี้ ว่าตามหลัง origin/main อยู่กี่ commit
#
# ใช้ node แปลง JSON เหมือน scripts/probes/deploy-drift.sh (การจับคู่ string ด้วย
# grep เสี่ยงเจอ SHA ปลอมในฟิลด์อื่นหรือในหน้า error HTML)
#
# วิธีใช้:
#   scripts/ops/which-build.sh <base-url>
#   ตัวอย่าง: scripts/ops/which-build.sh https://staging.gacpth.com
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
    echo "ต้องระบุ URL ของเซิร์ฟเวอร์ที่จะตรวจสอบ"
    echo "วิธีใช้: scripts/ops/which-build.sh <base-url>"
    echo "ตัวอย่าง: scripts/ops/which-build.sh https://staging.gacpth.com"
    exit 2
fi
# Strip a trailing slash so "https://x/" and "https://x" behave the same.
BASE_URL="${BASE_URL%/}"

command -v curl >/dev/null 2>&1 || {
    echo "ไม่พบคำสั่ง curl บนเครื่องนี้ ติดตั้ง curl แล้วลองใหม่"
    exit 1
}
command -v node >/dev/null 2>&1 || {
    echo "ไม่พบคำสั่ง node บนเครื่องนี้ (ใช้แปลงคำตอบ JSON) ติดตั้ง Node.js แล้วลองใหม่"
    exit 1
}

URL="$BASE_URL/api/webapp-version"

if ! body="$(curl -fsS --max-time 15 "$URL" 2>/dev/null)"; then
    echo "เชื่อมต่อ $URL ไม่ได้"
    echo "ตรวจสอบว่า URL ถูกต้องและเซิร์ฟเวอร์เปิดอยู่ แล้วลองใหม่"
    exit 1
fi

# Prints two lines on success: revision (or the literal NULL) then builtAt (or
# NULL). Exits non-zero if the body is not JSON, or the fields are the wrong
# shape — an HTML error page served with HTTP 200 looks like this too.
parsed="$(printf '%s' "$body" | node -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
        let v;
        try { v = JSON.parse(s); } catch { process.exit(9); }
        const rev = v.revision;
        const built = v.builtAt;
        if (rev !== null && typeof rev !== "string") process.exit(8);
        if (built !== null && typeof built !== "string") process.exit(8);
        process.stdout.write((rev === null ? "NULL" : rev) + "\n" + (built === null ? "NULL" : built) + "\n");
    });
' 2>/dev/null)" || {
    echo "คำตอบจาก $URL ไม่ใช่ JSON ที่มีฟิลด์ revision/builtAt ตามที่คาด"
    echo "อาจเจอหน้า error หรือ proxy คั่นกลางแทนตัวแอปจริง ตรวจสอบ URL แล้วลองใหม่"
    exit 1
}

revision="$(printf '%s\n' "$parsed" | sed -n '1p')"
builtAt="$(printf '%s\n' "$parsed" | sed -n '2p')"

if [ "$revision" = "NULL" ]; then
    echo "เซิร์ฟเวอร์นี้ไม่ทราบรุ่นบิลด์ของตัวเอง (GIT_SHA ว่างตอน build อิมเมจ)"
    echo "ให้ build ใหม่พร้อม --build-arg GIT_SHA=\$(git rev-parse HEAD) --build-arg BUILT_AT=\$(date -u +%Y-%m-%dT%H:%M:%SZ) แล้ว deploy ใหม่"
    exit 1
fi

echo "รุ่นบิลด์ (commit): $revision"
if [ "$builtAt" = "NULL" ]; then
    echo "เวลา build: ไม่ทราบ (BUILT_AT ว่างตอน build อิมเมจ)"
else
    echo "เวลา build: $builtAt"
fi

# Resolve against THIS clone's history. Fetch origin/main explicitly by
# refspec first (a bare `git fetch origin` obeys a shallow/single-branch
# clone's narrowed refspec and can leave origin/main missing even though it
# exists — same reasoning as deploy-drift.sh).
git -C "$REPO_ROOT" fetch --quiet origin '+refs/heads/main:refs/remotes/origin/main' 2>/dev/null \
    || echo "หมายเหตุ: fetch origin/main ไม่สำเร็จ (เครือข่ายหรือ remote ไม่ตอบ) ตัวเลขด้านล่างอาจไม่ทันสมัย"

if ! git -C "$REPO_ROOT" rev-parse --verify --quiet "${revision}^{commit}" >/dev/null; then
    echo "ไม่รู้จัก commit นี้ในซอร์สโค้ดโลคัลเครื่องนี้ (ประวัติอาจไม่ครบ)"
    echo "รัน git fetch origin ก่อนแล้วลองใหม่ ถ้ายังไม่รู้จักอีก แปลว่า commit นี้ยังไม่เข้า origin"
    exit 0
fi

behind="$(git -C "$REPO_ROOT" rev-list --count "${revision}..origin/main" 2>/dev/null || echo '')"
if [ -z "$behind" ]; then
    echo "เทียบกับ origin/main ไม่ได้ (origin/main ไม่มีในโลคัลนี้)"
elif [ "$behind" = "0" ]; then
    echo "ตรงกับ origin/main แล้ว เป็นบิลด์ล่าสุด"
else
    echo "ตามหลัง origin/main อยู่ $behind commit"
fi
