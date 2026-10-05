#!/usr/bin/env bash
# deps-health — เวอร์ชันของเครื่องมือหลักต้องพูดเสียงเดียวกัน และต้องยังไม่หมดอายุ
#
# ทำไมมี: Node 20 หมดอายุ 2026-04-30 แล้ว production ยังรันต่ออีกห้าเดือนโดยไม่มีใครรู้
# (spec design note 2026-09-26-versions-packages-tools-refresh-design) ·
# และ jest สองเมเจอร์อยู่ในรีโปเดียว (backend ^29 คู่ babel-jest ^30 · web-app ^30)
#
# FAIL เมื่อ:
#   node-pin   เมเจอร์ Node ใน Dockerfile*/*.Dockerfile/Dockerfile.* · docker-compose*.y(a)ml/compose.y(a)ml
#              (image: node:) · engines.node ของทุก package.json · .nvmrc · .node-version ·
#              .github/workflows (ค่า literal — รวม node-version บนบรรทัดเดียวเสมอ ไม่ใช่แค่ที่ขึ้นต้นด้วยเลข)
#              ไม่ตรงกัน · หรือไม่ได้ปักเมเจอร์ (node:lts-alpine, engines ">=20", "24.x || 26.x", ไม่มี tag,
#              เมทริกซ์ที่ค่าไม่ตรงกัน, ตัวแปร ARG ที่แก้ไม่ได้) · หรือไม่มี .nvmrc
#              รูปที่ "ปักเมเจอร์" จริง: N · N.x · N.y.z · vN (semver) และ N · N.n.n · N-suffix · N@sha256:... (docker tag)
#              เท่านั้น — ตัวดำเนินการช่วง (||, -, >=, <, ^, ~, เว้นวรรค) ไม่ผ่าน
#   node-eol   เมเจอร์นั้นเลยวัน end ใน node-release-schedule.txt (เตือนล่วงหน้า 60 วัน — ไม่ FAIL)
#   jest-major jest/babel-jest ใน package.json ใดๆ หรือใน pnpm-lock.yaml มีมากกว่าหนึ่งเมเจอร์ ·
#              หรือ spec อ่านเมเจอร์ไม่ได้ (>=29, ช่วง, workspace:*) · หรือ package.json อ่านไม่ได้ (parse error)
#   audit      pnpm audit มี critical (นับเฉพาะเมื่อ critical เป็นตัวเลขจริง)
# BLOCKED เมื่อ: pnpm audit ตอบไม่ได้/นับไม่ได้ (ออฟไลน์/registry ล่ม/ผลไม่มีตัวเลข — ไม่ใช่ PASS) ·
#   เมเจอร์ไม่มีในไฟล์ข้อมูล · แถวไม่มีวัน end · วัน end/DEPS_HEALTH_TODAY อ่านไม่ได้ ·
#   ไฟล์ข้อมูลมีเมเจอร์ซ้ำ/วันไม่เรียง/จำนวนช่องผิด
# FAIL ชนะ BLOCKED: ถ้ามีทั้งสองอย่าง exit 1
#
# ไม่อ่าน (พิมพ์ทุกครั้ง): node_modules/ · ค่า ${{ ... }} ใน workflow (แก้ไม่ได้แบบสถิต) ·
# Node ที่ติดตั้งบนเครื่อง (node --version) · high/moderate ของ audit ·
# .github/actions/*/action.yml · .tool-versions · package.json#volta (ไม่พบในรีโปวันนี้ — ยังไม่สแกน)
# ใช้:  bash scripts/probes/deps-health.sh [--selftest]
#       DEPS_HEALTH_ROOT DEPS_HEALTH_SCHEDULE DEPS_HEALTH_TODAY DEPS_HEALTH_AUDIT_JSON = fixture
source "$(dirname "$0")/_lib.sh"
SCAN_ROOT="${DEPS_HEALTH_ROOT:-$ROOT}"
SCHEDULE="${DEPS_HEALTH_SCHEDULE:-$(cd "$(dirname "$0")" && pwd)/node-release-schedule.txt}"
TODAY="${DEPS_HEALTH_TODAY:-$(TZ=Asia/Bangkok date +%F)}"
WARN_DAYS=60
NODE_IMG_RE='^(.*/)?node(:(.+))?$'

FAILS=(); BLOCKS=(); WARNS=()

# scan_files — find(1) ตัด node_modules / .git / worktree ซ้อน / build output ทิ้ง
# (ชื่อบอกว่ามันคือการ "สแกนไฟล์" ธรรมดา ไม่ใช่ git-tracked — fixture ของ selftest ไม่ใช่ git repo)
scan_files() { # $@ = find predicates
    find "$SCAN_ROOT" \( -name node_modules -o -name .git -o -name .next \) -prune -o \( "$@" \) -type f -print 2>/dev/null
}
rel() { printf '%s' "${1#"$SCAN_ROOT"/}"; }
major_of() { # $1 value  $2 mode: semver(default: N · N.x · N.y.z · vN) | tag(docker: N · N.n.n · N-suf · N@sha256:..)
    local v="$1" mode="${2:-semver}"
    case "$mode" in
        tag) printf '%s' "$v" | sed -nE 's/^([0-9]+)(\.[0-9]+){0,2}(-[A-Za-z][A-Za-z0-9.]*)*(@sha256:[0-9a-f]+)?$/\1/p' ;;
        *)   printf '%s' "$v" | sed -nE 's/^v?([0-9]+)(\.([0-9]+|x|\*)){0,2}$/\1/p' ;;
    esac
}
strip_quotes() { # trim ws + drop one layer of matching quotes + drop trailing # comment
    local s="${1%%#*}"
    s="$(printf '%s' "$s" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ "${s:0:1}" = '"' ] && [ "${s: -1}" = '"' ] && s="${s:1:${#s}-2}"
    [ "${s:0:1}" = "'" ] && [ "${s: -1}" = "'" ] && s="${s:1:${#s}-2}"
    printf '%s' "$s"
}

check_node_pin() {
    local rows="" f line tag m v root_engines=0
    local -A ARGDEFS

    # Dockerfile* / *.Dockerfile / Dockerfile.*
    while IFS= read -r f; do
        ARGDEFS=()
        while IFS= read -r line; do
            if [[ "$line" =~ ^[[:space:]]*[Aa][Rr][Gg][[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
                ARGDEFS["${BASH_REMATCH[1]}"]="$(strip_quotes "${BASH_REMATCH[2]}")"
                continue
            fi
            [[ "$line" =~ ^[[:space:]]*[Ff][Rr][Oo][Mm][[:space:]]+(.*)$ ]] || continue
            local rest="${BASH_REMATCH[1]}"
            while [[ "$rest" =~ ^--[^[:space:]]+([[:space:]]+(.*))?$ ]]; do
                rest="${BASH_REMATCH[2]:-}"
                [ -n "$rest" ] || break
            done
            [ -n "$rest" ] || continue
            local imgref="${rest%%[[:space:]]*}"
            if [[ "$imgref" =~ \$\{([A-Za-z_][A-Za-z0-9_]*)\} ]] || [[ "$imgref" =~ \$([A-Za-z_][A-Za-z0-9_]*) ]]; then
                local var="${BASH_REMATCH[1]}"
                if [ -n "${ARGDEFS[$var]+x}" ]; then
                    imgref="${imgref//\$\{$var\}/${ARGDEFS[$var]}}"
                    imgref="${imgref//\$$var/${ARGDEFS[$var]}}"
                fi
            fi
            if [[ "$imgref" == *'$'* ]]; then
                FAILS+=("node-pin: $(rel "$f"): FROM $imgref — ตัวแปร ARG แก้ไม่ได้แบบสถิต (ไม่มีค่า default ในไฟล์นี้)")
                continue
            fi
            [[ "$imgref" =~ $NODE_IMG_RE ]] || continue
            tag="${BASH_REMATCH[3]:-}"
            if [ -z "$tag" ]; then
                FAILS+=("node-pin: $(rel "$f"): FROM $imgref ไม่ปักแท็ก (ไม่มี tag = ใช้ latest แล้วกระโดดเมเจอร์เอง)")
                continue
            fi
            m="$(major_of "$tag" tag)"
            [ -z "$m" ] && { FAILS+=("node-pin: $(rel "$f"): FROM node:$tag ไม่ปักเมเจอร์ (tag เป็น lts/latest/ช่วง)"); continue; }
            rows+="$m $(rel "$f") FROM node:$tag"$'\n'
        done < "$f"
    done < <(scan_files -name 'Dockerfile*' -o -name '*.Dockerfile' -o -name 'Dockerfile.*')

    # docker-compose*.y(a)ml / compose.y(a)ml
    while IFS= read -r f; do
        while IFS= read -r line; do
            [[ "$line" =~ ^[[:space:]]*image:[[:space:]]*(.*)$ ]] || continue
            v="$(strip_quotes "${BASH_REMATCH[1]}")"
            [ -n "$v" ] || continue
            [[ "$v" =~ $NODE_IMG_RE ]] || continue
            tag="${BASH_REMATCH[3]:-}"
            if [ -z "$tag" ]; then
                FAILS+=("node-pin: $(rel "$f"): image $v ไม่ปักแท็ก (ไม่มี tag = ใช้ latest)")
                continue
            fi
            m="$(major_of "$tag" tag)"
            [ -z "$m" ] && { FAILS+=("node-pin: $(rel "$f"): image node:$tag ไม่ปักเมเจอร์"); continue; }
            rows+="$m $(rel "$f") image node:$tag"$'\n'
        done < "$f"
    done < <(scan_files -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'compose.yml' -o -name 'compose.yaml')

    # package.json engines.node — parse errors / non-string values must FAIL, never skip silently
    while IFS= read -r f; do
        local result tag2 rest2
        result="$(node -e '
try {
  const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const en = p.engines && p.engines.node;
  if (en === undefined || en === null || en === "") { console.log("EMPTY"); }
  else if (typeof en !== "string") { console.log("BADTYPE\t" + JSON.stringify(en)); }
  else { console.log("OK\t" + en); }
} catch (e) { console.log("PARSEERR\t" + String(e.message || e).slice(0,120)); }
' "$f" 2>/dev/null)"
        tag2="${result%%$'\t'*}"
        rest2="${result#*$'\t'}"
        case "$tag2" in
            EMPTY) : ;;
            OK)
                v="$rest2"
                [ "$f" = "$SCAN_ROOT/package.json" ] && root_engines=1
                m="$(major_of "$v")"
                [ -z "$m" ] && { FAILS+=("node-pin: $(rel "$f"): engines.node \"$v\" ไม่ใช่การปักเมเจอร์ (ใช้รูป \"24.x\")"); continue; }
                rows+="$m $(rel "$f") engines.node=$v"$'\n'
                ;;
            BADTYPE)
                FAILS+=("node-pin: $(rel "$f"): engines.node ไม่ใช่สตริง ($rest2)")
                ;;
            *)
                FAILS+=("node-pin: $(rel "$f"): package.json อ่านไม่ได้ ($rest2)")
                ;;
        esac
    done < <(scan_files -name package.json)
    [ "$root_engines" = 1 ] || FAILS+=("node-pin: package.json (ราก) ไม่มี engines.node")

    if [ -f "$SCAN_ROOT/.nvmrc" ]; then
        v="$(tr -d '[:space:]' < "$SCAN_ROOT/.nvmrc")"; m="$(major_of "$v")"
        [ -z "$m" ] && FAILS+=("node-pin: .nvmrc \"$v\" ไม่ใช่การปักเมเจอร์") || rows+="$m .nvmrc=$v"$'\n'
    else
        FAILS+=("node-pin: ไม่มี .nvmrc")
    fi
    if [ -f "$SCAN_ROOT/.node-version" ]; then
        v="$(tr -d '[:space:]' < "$SCAN_ROOT/.node-version")"; m="$(major_of "$v")"
        [ -z "$m" ] && FAILS+=("node-pin: .node-version \"$v\" ไม่ใช่การปักเมเจอร์") || rows+="$m .node-version=$v"$'\n'
    fi

    # .github/workflows — ทุกค่าของ node-version/NODE_VERSION ต้องถูกตัดสิน (FAIL หรือปัก) ไม่ใช่แค่ที่ขึ้นต้นด้วยเลข
    while IFS= read -r f; do
        while IFS= read -r rawval; do
            v="$(strip_quotes "$rawval")"
            if [ -z "$v" ]; then
                FAILS+=("node-pin: $(rel "$f"): node-version ไม่มีค่าบนบรรทัดเดียวกัน (block list?) แก้ไม่ได้แบบสถิต")
                continue
            fi
            if [[ "$v" =~ ^\$\{\{.*\}\}$ ]]; then
                continue # ${{ ... }} — ประกาศไว้ที่ "ไม่อ่าน" แล้ว ไม่ใช่การผ่านเงียบ
            fi
            if [[ "$v" =~ ^\[(.*)\]$ ]]; then
                local inner="${BASH_REMATCH[1]}" it mi ok=1 majlist=() item
                IFS=',' read -ra _items <<< "$inner"
                for item in "${_items[@]}"; do
                    it="$(printf '%s' "$item" | tr -d "[:space:]'\"")"
                    mi="$(major_of "$it")"
                    [ -z "$mi" ] && { ok=0; break; }
                    majlist+=("$mi")
                done
                if [ "$ok" = 1 ] && [ "$(printf '%s\n' "${majlist[@]}" | sort -u | wc -l)" = 1 ]; then
                    rows+="${majlist[0]} $(rel "$f") node-version=[matrix ทุกค่า=${majlist[0]}]"$'\n'
                else
                    FAILS+=("node-pin: $(rel "$f"): node-version เมทริกซ์ไม่ตรงกันหรือแก้ไม่ได้: $v")
                fi
                continue
            fi
            m="$(major_of "$v")"
            if [ -z "$m" ]; then
                FAILS+=("node-pin: $(rel "$f"): node-version=$v ไม่ปักเมเจอร์ (lts/latest/ช่วง จะกระโดดเมเจอร์เอง)")
            else
                rows+="$m $(rel "$f") node-version=$v"$'\n'
            fi
        done < <(sed -nE 's/^[[:space:]]*(node-version|NODE_VERSION):[[:space:]]*(.*)$/\2/p' "$f")
    done < <(scan_files -path '*/.github/workflows/*' \( -name '*.yml' -o -name '*.yaml' \))

    [ -n "$rows" ] || { BLOCKS+=("node-pin: ไม่พบที่ปัก Node สักแห่ง — ตรวจศูนย์แหล่ง = ไม่ได้ตรวจ"); return; }
    echo "node-pin: $(printf '%s' "$rows" | grep -c .) แหล่ง"
    printf '%s' "$rows" | sed 's/^/  /'
    local majors; majors="$(printf '%s' "$rows" | awk 'NF{print $1}' | sort -u)"
    if [ "$(printf '%s\n' "$majors" | grep -c .)" -gt 1 ]; then
        FAILS+=("node-pin: เมเจอร์ไม่ตรงกัน ($(printf '%s' "$majors" | tr '\n' ' ')) — แหล่งที่ต่างจากส่วนใหญ่:
$(printf '%s' "$rows" | awk -v top="$(printf '%s' "$rows" | awk 'NF{print $1}' | sort | uniq -c | sort -rn | awk 'NR==1{print $2}')" 'NF && $1!=top' | sed 's/^/    /')")
    fi
    NODE_MAJOR="$(printf '%s' "$rows" | awk 'NF{print $1}' | sort | uniq -c | sort -rn | awk 'NR==1{print $2}')"
}

# validate_schedule — ไฟล์ข้อมูลเอง: 4 ช่อง, ไม่ซ้ำเมเจอร์, วันอ่านได้และเรียงจากน้อยไปมาก
validate_schedule() {
    local ln n=0
    local -A seen
    while IFS= read -r ln; do
        n=$((n+1))
        [[ "$ln" =~ ^[[:space:]]*# ]] && continue
        [[ "$ln" =~ ^[[:space:]]*$ ]] && continue
        local -a fields
        IFS='|' read -ra fields <<< "$ln"
        if [ "${#fields[@]}" -ne 4 ]; then
            BLOCKS+=("node-eol: $(basename "$SCHEDULE") บรรทัด $n: ต้องมี 4 ช่อง ได้ ${#fields[@]}")
            continue
        fi
        local maj lts maint end
        maj="$(printf '%s' "${fields[0]}" | tr -d '[:space:]')"
        lts="$(printf '%s' "${fields[1]}" | tr -d '[:space:]')"
        maint="$(printf '%s' "${fields[2]}" | tr -d '[:space:]')"
        end="$(printf '%s' "${fields[3]}" | tr -d '[:space:]')"
        if [ -n "${seen[$maj]:-}" ]; then
            BLOCKS+=("node-eol: $(basename "$SCHEDULE"): เมเจอร์ $maj มีมากกว่าหนึ่งแถว")
            continue
        fi
        seen[$maj]=1
        local d bad=0
        for d in "$lts" "$maint" "$end"; do
            [ -n "$d" ] || continue
            TZ=UTC date -d "$d" >/dev/null 2>&1 || { BLOCKS+=("node-eol: $(basename "$SCHEDULE"): เมเจอร์ $maj มีวันที่อ่านไม่ได้: $d"); bad=1; }
        done
        if [ "$bad" = 0 ] && [ -n "$lts" ] && [ -n "$maint" ] && [ -n "$end" ]; then
            local ts_lts ts_maint ts_end
            ts_lts=$(TZ=UTC date -d "$lts" +%s); ts_maint=$(TZ=UTC date -d "$maint" +%s); ts_end=$(TZ=UTC date -d "$end" +%s)
            if [ "$ts_lts" -gt "$ts_maint" ] || [ "$ts_maint" -gt "$ts_end" ]; then
                BLOCKS+=("node-eol: $(basename "$SCHEDULE"): เมเจอร์ $maj วันไม่เรียงจากน้อยไปมาก (lts→maintenance→end)")
            fi
        fi
    done < "$SCHEDULE"
}

check_node_eol() {
    [ -n "${NODE_MAJOR:-}" ] || return
    [ -f "$SCHEDULE" ] || { BLOCKS+=("node-eol: ไม่มีไฟล์ข้อมูล $SCHEDULE"); return; }
    validate_schedule
    if ! TZ=UTC date -d "$TODAY" +%F >/dev/null 2>&1; then
        BLOCKS+=("node-eol: DEPS_HEALTH_TODAY \"$TODAY\" ไม่ใช่วันที่ที่อ่านได้"); return
    fi
    local row eol left
    row="$(awk -F'|' -v m="$NODE_MAJOR" '$1 !~ /^[[:space:]]*#/ { maj=$1; gsub(/[[:space:]]/,"",maj); if (maj==m) print }' "$SCHEDULE" | head -1)"
    if [ -z "$row" ]; then
        BLOCKS+=("node-eol: Node $NODE_MAJOR ไม่มีแถวใน $(basename "$SCHEDULE") — เพิ่มจาก nodejs/Release schedule.json"); return
    fi
    eol="$(printf '%s' "$row" | awk -F'|' '{v=$4; gsub(/[[:space:]]/,"",v); print v}')"
    if [ -z "$eol" ]; then
        BLOCKS+=("node-eol: แถว Node $NODE_MAJOR ใน $(basename "$SCHEDULE") ไม่มีวัน end"); return
    fi
    if ! TZ=UTC date -d "$eol" +%F >/dev/null 2>&1; then
        BLOCKS+=("node-eol: แถว Node $NODE_MAJOR ใน $(basename "$SCHEDULE") มีวัน end อ่านไม่ได้: \"$eol\""); return
    fi
    left=$(( ( $(TZ=UTC date -d "$eol" +%s) - $(TZ=UTC date -d "$TODAY" +%s) ) / 86400 ))
    if [ "$left" -lt 0 ]; then
        FAILS+=("node-eol: Node $NODE_MAJOR หมดอายุ $eol — เลยมา $((-left)) วัน (วันนี้ $TODAY)")
    elif [ "$left" -le "$WARN_DAYS" ]; then
        WARNS+=("node-eol: Node $NODE_MAJOR จะหมดอายุ $eol — เหลือ $left วัน เริ่มย้ายเมเจอร์")
        echo "node-eol: Node $NODE_MAJOR หมดอายุ $eol (เหลือ $left วัน)"
    else
        echo "node-eol: Node $NODE_MAJOR หมดอายุ $eol (เหลือ $left วัน)"
    fi
}

check_audit() {
    local json
    if [ -n "${DEPS_HEALTH_AUDIT_JSON:-}" ]; then
        json="$(cat "$DEPS_HEALTH_AUDIT_JSON" 2>/dev/null)"
        echo "audit: จาก fixture $DEPS_HEALTH_AUDIT_JSON"
    else
        command -v pnpm >/dev/null 2>&1 || { BLOCKS+=("audit: ไม่มี pnpm บนเครื่อง"); return; }
        # exit code ของ pnpm audit ใช้ไม่ได้: เจอช่องโหว่ = 1 · ออฟไลน์ = 1 เหมือนกัน (วัด 2026-09-26)
        # fetch-retries=0: ค่าปริยายลองซ้ำจนเกิน 60 วินาทีเมื่อออฟไลน์ (วัด 2026-09-26)
        json="$(cd "$SCAN_ROOT" && timeout 120 pnpm audit --json --config.fetch-retries=0 2>/dev/null)"
    fi
    local verdict
    verdict="$(printf '%s' "$json" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try { j=JSON.parse(s) } catch { console.log("BLOCKED\tตอบไม่เป็น JSON (ออฟไลน์/หมดเวลา?)"); return }
  if (j.error) { console.log("BLOCKED\t"+(j.error.code||"error")+": "+(j.error.message||"").slice(0,160)); return }
  const v=j.metadata&&j.metadata.vulnerabilities
  if (!v || typeof v.critical !== "number") { console.log("BLOCKED\tผล audit ไม่มี metadata.vulnerabilities.critical เป็นตัวเลข"); return }
  const line="critical="+v.critical+" high="+v.high+" moderate="+v.moderate+" low="+v.low
  if (v.critical>0) {
    const names=Object.values(j.advisories||{}).filter(a=>a.severity==="critical").map(a=>a.module_name+" — "+a.title)
    console.log("FAIL\t"+line+" · "+names.join(" · ")); return }
  console.log("OK\t"+line)
})' 2>/dev/null)"
    case "${verdict%%$'\t'*}" in
        OK)      echo "audit: ${verdict#*$'\t'}" ;;
        FAIL)    FAILS+=("audit: ${verdict#*$'\t'}") ;;
        *)       BLOCKS+=("audit: ${verdict#*$'\t'}") ;;
    esac
    local ign
    ign="$(node -e 'const p=require(process.argv[1]);const i=(p.pnpm&&p.pnpm.auditConfig&&p.pnpm.auditConfig.ignoreCves)||[];process.stdout.write(i.join(" "))' "$SCAN_ROOT/package.json" 2>/dev/null)"
    [ -n "$ign" ] && echo "audit: ไม่นับ (pnpm.auditConfig.ignoreCves ใน package.json): $ign"
}

check_jest_major() {
    local rows="" f line tag name spec m
    while IFS= read -r f; do
        while IFS=$'\t' read -r tag name spec; do
            [ -z "$tag" ] && continue
            if [ "$tag" = "PARSEERR" ]; then
                FAILS+=("jest-major: $(rel "$f"): package.json อ่านไม่ได้ ($name)")
                continue
            fi
            [ -z "$name" ] && continue
            m="$(major_of "${spec#[\^~]}")"
            [ -z "$m" ] && { FAILS+=("jest-major: $(rel "$f"): $name \"$spec\" อ่านเมเจอร์ไม่ได้"); continue; }
            rows+="$m $(rel "$f") $name@$spec"$'\n'
        done < <(node -e '
try {
  const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const d = {...p.dependencies, ...p.devDependencies};
  for (const n of ["jest","babel-jest"]) if (d[n]) console.log("OK\t" + n + "\t" + d[n]);
} catch (e) { console.log("PARSEERR\t" + String(e.message || e).slice(0,120)); }
' "$f" 2>/dev/null)
    done < <(scan_files -name package.json)
    if [ -f "$SCAN_ROOT/pnpm-lock.yaml" ]; then
        while IFS= read -r line; do
            rows+="${line##*@} pnpm-lock.yaml ${line# }"$'\n'
        done < <(grep -oE '^  /?(jest|babel-jest)@[0-9]+' "$SCAN_ROOT/pnpm-lock.yaml" | sed -E 's#^ +/?##' | sort -u)
    fi
    [ -n "$rows" ] || { BLOCKS+=("jest-major: ไม่พบ jest ใน package.json หรือ pnpm-lock.yaml — ตรวจศูนย์แหล่ง = ไม่ได้ตรวจ"); return; }
    echo "jest-major: $(printf '%s' "$rows" | grep -c .) แหล่ง"
    printf '%s' "$rows" | sed 's/^/  /'
    local majors; majors="$(printf '%s' "$rows" | awk 'NF{print $1}' | sort -u)"
    [ "$(printf '%s\n' "$majors" | grep -c .)" -gt 1 ] && \
        FAILS+=("jest-major: jest/babel-jest มีหลายเมเจอร์ ($(printf '%s' "$majors" | tr '\n' ' '))")
}

if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    printf '20 | 2023-10-24 | 2024-10-22 | 2026-04-30\n24 | 2025-10-28 | 2026-10-20 | 2028-04-30\n' > "$TMP/sched.txt"
    printf '{"metadata":{"vulnerabilities":{"info":0,"low":1,"moderate":2,"high":3,"critical":0}}}' > "$TMP/audit-ok.json"
    printf '{"advisories":{"1":{"module_name":"next","title":"RCE","severity":"critical"}},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":1}}}' > "$TMP/audit-crit.json"
    printf '{"error":{"code":"ECONNREFUSED","message":"request to http://127.0.0.1:9/ failed"}}' > "$TMP/audit-off.json"
    printf '{"metadata":{"vulnerabilities":{}}}' > "$TMP/audit-nonum.json"
    printf 'this is not json' > "$TMP/audit-notjson.json"
    mk() { # $1 dir  $2 major (ทุกแหล่ง)
        mkdir -p "$1/apps/backend" "$1/.github/workflows"
        printf 'FROM node:%s-alpine AS builder\nFROM node:%s-alpine AS runner\n' "$2" "$2" > "$1/apps/backend/Dockerfile"
        printf '{"name":"root","engines":{"node":"%s.x"},"devDependencies":{"jest":"^30.2.0"}}\n' "$2" > "$1/package.json"
        printf '{"name":"backend","engines":{"node":"%s.x"},"devDependencies":{"jest":"^30.2.0","babel-jest":"^30.2.0"}}\n' "$2" > "$1/apps/backend/package.json"
        printf 'lockfileVersion: '\''6.0'\''\npackages:\n  /babel-jest@30.2.0(@babel/core@7.29.0):\n  /jest@30.2.0(@types/node@24.0.0):\n' > "$1/pnpm-lock.yaml"
        printf '%s\n' "$2" > "$1/.nvmrc"
        printf 'env:\n  NODE_VERSION: '\''%s.x'\''\njobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ env.NODE_VERSION }}\n' "$2" > "$1/.github/workflows/ci.yml"
        printf 'services:\n  qa:\n    image: node:%s-alpine\n' "$2" > "$1/docker-compose.qa.yml"
    }
    check() { # $1 ป้าย $2 root $3 exit ที่คาด $4 ข้อความที่ต้องเห็น $5 วันนี้ $6 ไฟล์ audit $7 ไฟล์ schedule
        local out code; CASES=$((CASES+1))
        out="$(DEPS_HEALTH_ROOT="$2" DEPS_HEALTH_SCHEDULE="${7:-$TMP/sched.txt}" DEPS_HEALTH_TODAY="${5:-2026-09-26}" \
               DEPS_HEALTH_AUDIT_JSON="${6:-$TMP/audit-ok.json}" bash "$0" 2>&1)"; code=$?
        if [ "$code" != "$3" ] || ! printf '%s' "$out" | grep -q -- "$4"; then
            echo "  ✗ $1 — คาด exit $3 + '$4' ได้ exit $code"; printf '%s\n' "$out" | sed 's/^/      /'; BAD=1; return; fi
        echo "  ✓ $1"
    }
    checkno() { # เหมือน check() แต่ $4 ต้องไม่ปรากฏ
        local out code; CASES=$((CASES+1))
        out="$(DEPS_HEALTH_ROOT="$2" DEPS_HEALTH_SCHEDULE="${7:-$TMP/sched.txt}" DEPS_HEALTH_TODAY="${5:-2026-09-26}" \
               DEPS_HEALTH_AUDIT_JSON="${6:-$TMP/audit-ok.json}" bash "$0" 2>&1)"; code=$?
        if [ "$code" != "$3" ] || printf '%s' "$out" | grep -q -- "$4"; then
            echo "  ✗ $1 — คาด exit $3 + ไม่มี '$4' ได้ exit $code"; printf '%s\n' "$out" | sed 's/^/      /'; BAD=1; return; fi
        echo "  ✓ $1"
    }

    A="$TMP/a"; mk "$A" 24;                                                check "24 ทุกแหล่ง ยังไม่หมดอายุ audit สะอาด = PASS" "$A" 0 "PASS"
    B="$TMP/b"; mk "$B" 24; sed -i 's/node:24-alpine AS runner/node:20-alpine AS runner/' "$B/apps/backend/Dockerfile"
                                                                           check "Dockerfile stage หนึ่งค้าง 20 = FAIL ชี้ไฟล์" "$B" 1 "apps/backend/Dockerfile FROM node:20"
    C="$TMP/c"; mk "$C" 24; sed -i 's/node:24-alpine AS builder/node:lts-alpine AS builder/' "$C/apps/backend/Dockerfile"
                                                                           check "node:lts-alpine = FAIL ไม่ปักเมเจอร์" "$C" 1 "ไม่ปักเมเจอร์"
    D="$TMP/d"; mk "$D" 24; printf '{"name":"root","engines":{"node":">=20"}}\n' > "$D/package.json"
                                                                           check "engines แบบช่วง (>=20) = FAIL" "$D" 1 "ไม่ใช่การปักเมเจอร์"
    E="$TMP/e"; mk "$E" 24; rm "$E/.nvmrc";                                check "ไม่มี .nvmrc = FAIL" "$E" 1 "ไม่มี .nvmrc"
    F="$TMP/f"; mk "$F" 24; printf '  NODE_VERSION: '\''20'\''\n' >> "$F/.github/workflows/ci.yml"
                                                                           check "workflow literal ค้าง 20 = FAIL" "$F" 1 "ci.yml node-version=20"
    G="$TMP/g"; mk "$G" 20;                                                check "20 ทุกแหล่ง วันนี้ 2026-09-26 = FAIL หมดอายุ" "$G" 1 "หมดอายุ 2026-04-30"
    H="$TMP/h"; mk "$H" 24;                                                check "24 เหลือ < 60 วัน = PASS + เตือน" "$H" 0 "WARN" "2028-03-15"
    I="$TMP/i"; mk "$I" 22;                                                check "เมเจอร์ไม่มีในไฟล์ข้อมูล = BLOCKED" "$I" 2 "ไม่มีแถว"
    J="$TMP/j"; mk "$J" 24;                                                check "audit มี critical = FAIL ชื่อแพ็กเกจ" "$J" 1 "next — RCE" "" "$TMP/audit-crit.json"
    K="$TMP/k"; mk "$K" 24;                                                check "audit ออฟไลน์ = BLOCKED ไม่ใช่ PASS" "$K" 2 "BLOCKED" "" "$TMP/audit-off.json"
    L="$TMP/l"; mk "$L" 20;                                                check "ออฟไลน์ + หมดอายุ = FAIL ชนะ BLOCKED" "$L" 1 "หมดอายุ" "" "$TMP/audit-off.json"

    # ---- Important 1: workflow lts/latest/range/array/matrix/${{ }} ----
    M="$TMP/m"; mk "$M" 24; printf '  NODE_VERSION: '\''lts/*'\''\n' >> "$M/.github/workflows/ci.yml"
                                                                           check "workflow lts/* = FAIL ไม่ปักเมเจอร์" "$M" 1 "ไม่ปักเมเจอร์"
    N="$TMP/n"; mk "$N" 24; printf '  NODE_VERSION: latest\n' >> "$N/.github/workflows/ci.yml"
                                                                           check "workflow latest = FAIL ไม่ปักเมเจอร์" "$N" 1 "ไม่ปักเมเจอร์"
    O="$TMP/o"; mk "$O" 24; printf "  NODE_VERSION: '>=20'\n" >> "$O/.github/workflows/ci.yml"
                                                                           check "workflow ช่วง '>=20' = FAIL ไม่ปักเมเจอร์" "$O" 1 "ไม่ปักเมเจอร์"
    P="$TMP/p"; mk "$P" 24; printf '  node-version: [20, 24]\n' >> "$P/.github/workflows/ci.yml"
                                                                           check "workflow เมทริกซ์ [20,24] ไม่ตรงกัน = FAIL" "$P" 1 "เมทริกซ์ไม่ตรงกัน"
    Q="$TMP/q"; mk "$Q" 24; printf '  node-version: [24, 24]\n' >> "$Q/.github/workflows/ci.yml"
                                                                           check "workflow เมทริกซ์ [24,24] ตรงกัน = PASS" "$Q" 0 "PASS"
    R="$TMP/r"; mk "$R" 24; printf '  node-version: ${{ matrix.node }}\n' >> "$R/.github/workflows/ci.yml"
                                                                           check "workflow \${{ matrix.node }} = ไม่ FAIL (ประกาศไว้ที่ไม่อ่าน) ยัง PASS จากแหล่งอื่น" "$R" 0 "PASS"

    # ---- Important 2: Dockerfile/compose forms ----
    S="$TMP/s"; mk "$S" 24; sed -i 's/^FROM node:24-alpine AS builder$/FROM --platform=linux\/amd64 node:20-alpine AS builder/' "$S/apps/backend/Dockerfile"
                                                                           check "FROM --platform=... node:20 = จับได้ว่าเป็น 20 (ไม่ตรงกับ 24 ที่อื่น)" "$S" 1 "เมเจอร์ไม่ตรงกัน"
    T="$TMP/t"; mk "$T" 24; sed -i 's/^FROM node:24-alpine AS builder$/FROM node AS builder/' "$T/apps/backend/Dockerfile"
                                                                           check "FROM node (ไม่มี tag) = FAIL ไม่ปักแท็ก" "$T" 1 "ไม่ปักแท็ก"
    U="$TMP/u"; mk "$U" 24; sed -i 's/^FROM node:24-alpine AS builder$/from node:20-alpine AS builder/' "$U/apps/backend/Dockerfile"
                                                                           check "from ตัวเล็ก node:20 = จับได้ (ไม่ตรงกับ 24)" "$U" 1 "เมเจอร์ไม่ตรงกัน"
    V="$TMP/v"; mk "$V" 24; sed -i 's/^FROM node:24-alpine AS builder$/FROM docker.io\/library\/node:20/' "$V/apps/backend/Dockerfile"
                                                                           check "FROM docker.io/library/node:20 = จับได้ (ไม่ตรงกับ 24)" "$V" 1 "เมเจอร์ไม่ตรงกัน"
    W="$TMP/w"; mk "$W" 24; rm "$W/apps/backend/Dockerfile"; printf 'FROM node:20-alpine AS builder\n' > "$W/apps/backend/backend.Dockerfile"
                                                                           check "backend.Dockerfile (*.Dockerfile) ถูกสแกน = จับ 20 ได้" "$W" 1 "backend.Dockerfile FROM node:20"
    X="$TMP/x"; mk "$X" 24; sed -i 's/image: node:24-alpine/image: node/' "$X/docker-compose.qa.yml"
                                                                           check "compose image: node (ไม่มี tag) = FAIL ไม่ปักแท็ก" "$X" 1 "ไม่ปักแท็ก"
    Y="$TMP/y"; mk "$Y" 24; sed -i 's/image: node:24-alpine/image: docker.io\/library\/node:20/' "$Y/docker-compose.qa.yml"
                                                                           check "compose docker.io/library/node:20 = จับได้ (ไม่ตรงกับ 24)" "$Y" 1 "เมเจอร์ไม่ตรงกัน"
    Z="$TMP/z"; mk "$Z" 24; rm "$Z/docker-compose.qa.yml"; printf 'services:\n  qa:\n    image: node:20-alpine\n' > "$Z/compose.yml"
                                                                           check "compose.yml (ชื่อไฟล์ compose.yml) ถูกสแกน = จับ 20 ได้" "$Z" 1 "เมเจอร์ไม่ตรงกัน"
    AA="$TMP/aa"; mk "$AA" 24; sed -i 's/^FROM node:24-alpine AS builder$/ARG NODE_VERSION=24\nFROM node:${NODE_VERSION}-alpine AS builder/' "$AA/apps/backend/Dockerfile"
                                                                           check "ARG NODE_VERSION=24 + FROM node:\${NODE_VERSION} = แก้ค่าได้ = PASS" "$AA" 0 "PASS"
    AB="$TMP/ab"; mk "$AB" 24; sed -i 's/^FROM node:24-alpine AS builder$/FROM node:${NODE_VERSION}-alpine AS builder/' "$AB/apps/backend/Dockerfile"
                                                                           check "FROM node:\${NODE_VERSION} ไม่มี ARG default = FAIL แก้ไม่ได้" "$AB" 1 "แก้ไม่ได้แบบสถิต"

    # ---- Important 3: major_of ต้องปฏิเสธตัวดำเนินการช่วง ----
    AC="$TMP/ac"; mk "$AC" 24; printf '{"name":"root","engines":{"node":"24.x || 26.x"}}\n' > "$AC/package.json"
                                                                           check "engines '24.x || 26.x' = FAIL ไม่ใช่การปักเมเจอร์" "$AC" 1 "ไม่ใช่การปักเมเจอร์"
    AD="$TMP/ad"; mk "$AD" 24; printf '{"name":"root","engines":{"node":"24.x - 26.x"}}\n' > "$AD/package.json"
                                                                           check "engines '24.x - 26.x' = FAIL ไม่ใช่การปักเมเจอร์" "$AD" 1 "ไม่ใช่การปักเมเจอร์"
    AR="$TMP/ar"; mk "$AR" 24; sed -i 's/node:24-alpine AS builder/node:24-26 AS builder/' "$AR/apps/backend/Dockerfile"
                                                                           check "Docker tag ตัวเลขล้วนแบบช่วง node:24-26 = FAIL ไม่ปักเมเจอร์" "$AR" 1 "ไม่ปักเมเจอร์"

    # ---- Important 4: audit JSON ที่ไม่มีตัวเลข ----
    AE="$TMP/ae"; mk "$AE" 24;                                            check "audit metadata.vulnerabilities ว่าง = BLOCKED ไม่ใช่ PASS" "$AE" 2 "BLOCKED" "" "$TMP/audit-nonum.json"

    # ---- Minors ----
    AF="$TMP/af"; mk "$AF" 24;                                            check "DEPS_HEALTH_TODAY ผิดรูป = BLOCKED" "$AF" 2 "DEPS_HEALTH_TODAY" "not-a-date"
    printf '20 | 2023-10-24 | 2024-10-22 | 2026-04-30\n24 | 2025-10-28 | 2026-10-20 | TBD\n' > "$TMP/sched-badeol.txt"
    AG="$TMP/ag"; mk "$AG" 24;                                            check "วัน end ในไฟล์ข้อมูลอ่านไม่ได้ (TBD) = BLOCKED ชี้แถว" "$AG" 2 "อ่านไม่ได้" "" "" "$TMP/sched-badeol.txt"
    printf '20 | 2023-10-24 | 2024-10-22 | 2026-04-30\n24 | 2025-10-28 | 2026-10-20 | 2028-04-30\n24 | 2026-01-01 | 2026-06-01 | 2028-06-01\n' > "$TMP/sched-dup.txt"
    AH="$TMP/ah"; mk "$AH" 24;                                            check "เมเจอร์ซ้ำในไฟล์ข้อมูล = BLOCKED" "$AH" 2 "มีมากกว่าหนึ่งแถว" "" "" "$TMP/sched-dup.txt"
    printf '20 | 2023-10-24 | 2024-10-22 | 2026-04-30\n24 | 2025-10-28 | 2026-10-20 |\n' > "$TMP/sched-noend.txt"
    AI="$TMP/ai"; mk "$AI" 24;                                            check "แถวไม่มีวัน end = BLOCKED ไม่ใช่ 'ไม่มีแถว'" "$AI" 2 "ไม่มีวัน end" "" "" "$TMP/sched-noend.txt"
    AJ="$TMP/aj"; mk "$AJ" 24; printf 'not valid json{{{' > "$AJ/package.json"
                                                                           check "package.json parse ไม่ผ่าน = FAIL ชี้ไฟล์ ไม่ใช่ข้าม" "$AJ" 1 "package.json อ่านไม่ได้"
    AK="$TMP/ak"; mk "$AK" 24; printf '{"name":"root","engines":{"node":24}}\n' > "$AK/package.json"
                                                                           check "engines.node เป็นเลข (ไม่ใช่สตริง) = FAIL ชี้ไฟล์ ไม่ใช่ข้าม" "$AK" 1 "engines.node ไม่ใช่สตริง"
    AL="$TMP/al"; mk "$AL" 20;                                            check "วันนี้ = วัน end พอดี = WARN ไม่ใช่ FAIL" "$AL" 0 "WARN" "2026-04-30"
    AM="$TMP/am"; mk "$AM" 20;                                            check "วันนี้ = วัน end+1 = FAIL เลยมา 1 วัน" "$AM" 1 "เลยมา 1 วัน" "2026-05-01"
    AN="$TMP/an"; mk "$AN" 24;                                            check "เหลือพอดี 60 วัน = WARN" "$AN" 0 "WARN" "2028-03-01"
    AO="$TMP/ao"; mk "$AO" 24;                                            checkno "เหลือ 61 วัน = ไม่มี WARN" "$AO" 0 "WARN" "2028-02-29"
    AP="$TMP/ap"; mk "$AP" 24;                                            check "audit ตอบไม่เป็น JSON เลย (ข้อความล้วน) = BLOCKED" "$AP" 2 "BLOCKED" "" "$TMP/audit-notjson.json"
    AQ="$TMP/aq"; mk "$AQ" 24;                                            check "audit จาก fixture ต้องประกาศว่าเป็น fixture" "$AQ" 0 "จาก fixture"

    # ---- Important 5: jest-major ----
    AS="$TMP/m2"; mk "$AS" 24; sed -i 's/"jest":"\^30.2.0","babel/"jest":"^29.7.0","babel/' "$AS/apps/backend/package.json"
                                                                           check "backend jest ^29 ข้าง babel-jest ^30 = FAIL" "$AS" 1 "apps/backend/package.json jest@^29.7.0"
    AT="$TMP/n2"; mk "$AT" 24; printf '  /jest@29.7.0:\n' >> "$AT/pnpm-lock.yaml"
                                                                           check "package.json 30 แต่ lockfile ยังมี jest@29 = FAIL" "$AT" 1 "pnpm-lock.yaml jest@29"
    AU="$TMP/o2"; mk "$AU" 24; printf '{"name":"root","engines":{"node":"24.x"}}\n' > "$AU/package.json"
                printf '{"name":"backend","engines":{"node":"24.x"}}\n' > "$AU/apps/backend/package.json"; rm "$AU/pnpm-lock.yaml"
                                                                           check "ไม่มี jest เลย = BLOCKED ไม่ใช่ PASS" "$AU" 2 "ไม่พบ jest"
    AV="$TMP/p2"; mk "$AV" 24; sed -i 's/"jest":"\^30.2.0"}/"jest":">=29.7.0"}/' "$AV/package.json"
                                                                           check "jest spec เป็นช่วง >=29.7.0 อ่านเมเจอร์ไม่ได้ = FAIL" "$AV" 1 "package.json: jest \">=29.7.0\" อ่านเมเจอร์ไม่ได้"
    AW="$TMP/q2"; mk "$AW" 24; printf '{"name":"backend","devDependencies":{"jest":"^29.7.0"}' > "$AW/apps/backend/package.json"
                                                                           check "backend package.json พัง (JSON ไม่ปิด) แต่มี jest ซ่อนอยู่ = FAIL ชี้ไฟล์ ไม่ใช่ข้ามเงียบ" "$AW" 1 "jest-major: apps/backend/package.json: package.json อ่านไม่ได้"

    echo "selftest: $CASES เคส"; [ "$BAD" = 0 ] || exit 1
    echo "PASS: selftest ครบทั้งสองทิศ"; exit 0
fi

echo "ไม่อ่าน: node_modules/ · \${{ ... }} ใน workflow · Node ที่ติดตั้งบนเครื่อง · high/moderate ของ audit · .github/actions/*/action.yml · .tool-versions · package.json#volta"
NODE_MAJOR=""
check_node_pin
check_node_eol
check_jest_major
check_audit
for w in "${WARNS[@]}"; do echo "WARN: $w"; done
if [ "${#FAILS[@]}" -gt 0 ]; then
    for b in "${BLOCKS[@]}"; do echo "(และ BLOCKED: $b)"; done
    fail "${#FAILS[@]} ข้อ
$(printf '  %s\n' "${FAILS[@]}")"
fi
[ "${#BLOCKS[@]}" -gt 0 ] && blocked "$(printf '%s · ' "${BLOCKS[@]}")"
pass "Node $NODE_MAJOR ตรงกันทุกแหล่ง · ยังไม่หมดอายุ · jest เมเจอร์เดียว · audit ไม่มี critical"
