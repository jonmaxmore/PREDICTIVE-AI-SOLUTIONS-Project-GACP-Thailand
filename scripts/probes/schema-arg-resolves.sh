#!/usr/bin/env bash
# schema-arg-resolves — every `--schema` argument handed to a Prisma command must
# name a path that actually exists in this repository.
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
# .github/workflows/production.yml ran
#     prisma migrate deploy --schema prisma/schema.prisma
# for months. `apps/backend/prisma/schema.prisma` was deleted on 2026-03-12
# (commit 3120e673) when the schema became a prismaSchemaFolder directory,
# `apps/backend/prisma/schema/`. Nothing in the repo noticed, because the only
# thing that would ever have executed that line is a real production deploy —
# by which point the deploy is already halfway through, the DB is backed up,
# and migrate exits "Could not find schema".
#
# Nothing here verified that a --schema VALUE points at something that exists.
# scripts/ci/check-enforcement-guardrails.js:148 (G-04b) added a denylist for
# the one filename we already knew was dead — and it is wired only into
# .github/workflows/ci.yml:342, which has not run since hosted Actions were
# switched off on 2026-08-14 (probe-registry.txt). A denylist also only ever
# catches the mistake that already happened: `--schema prisma/schemas`,
# `--schema prisma/schema/_base.prisma` after a rename, or a path that was
# right until someone moved the folder, all sail past it.
#
# So this probe asks the general question instead: does the path exist? It is a
# static check — no database, no network, no prisma binary.
#
# ── HOW A VALUE IS JUDGED ────────────────────────────────────────────────────
# A --schema value is relative to the working directory of whatever runs it, and
# that directory is not written down anywhere machine-readable. So the value is
# resolved against every base a command in this repo plausibly runs from:
#   · the repo root
#   · the directory of the file the line lives in
#   · every package root (a directory holding a package.json) — this is what
#     `npm run`, `pnpm --dir X exec` and a Docker WORKDIR actually use
#   · any `cd <dir>` or `WORKDIR <dir>` on the same line, with a leading `/app/`
#     stripped (the container path for the repo root — apps/backend/Dockerfile)
# The value passes if it exists under AT LEAST ONE of those bases, and that base
# is inside the repo. Be clear about what that means: this proves the path
# exists somewhere plausible, NOT that the command runs from the right place. A
# --schema that resolves only under apps/web-app while the step runs in
# apps/backend would pass here. The bug this closes is "points at nothing",
# which is the one that has actually bitten.
#
# ── WHAT IS DELIBERATELY NOT JUDGED (printed, never silently dropped) ────────
#   · `--schema` with no operand, or followed by another flag (`bq show
#     --schema --format=json`) — a boolean flag, not a path.
#   · A value that is not path-shaped: no `/` and not ending in `.prisma`.
#     Prose says "a --schema argument may never…" and that must not go red.
#   · A line that does not mention `prisma`: `pg_dump --schema=public` and
#     `bq show --schema` mean a SQL namespace, not a file. Consequence, stated
#     plainly: a Prisma command split across two lines with --schema on the
#     second line is skipped. Every skip is printed with file:line so a human
#     can see what was not judged.
#   · An absolute path outside the container's /app — unverifiable from a
#     checkout. Counted and printed; if NOTHING was verifiable the probe returns
#     BLOCKED, never a vacuous PASS.
#   · Records, not instructions: evidence/ and reports/ hold dated artifacts of
#     past runs, and the change log is append-only. A wrong command inside one
#     of those is history and must not be rewritten to make a gate green.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED.
#
# Usage:  bash scripts/probes/schema-arg-resolves.sh
#         bash scripts/probes/schema-arg-resolves.sh --selftest
#         SCHEMA_ARG_ROOT=<dir> bash scripts/probes/schema-arg-resolves.sh
#           ^ scan a synthetic tree instead of the repo, so the probe can be run
#             against known-broken and known-clean fixtures (same convention as
#             DOCKERIGNORE_ROOT in dockerignore-secrets.sh).
source "$(dirname "$0")/_lib.sh"

SCAN_ROOT="${SCHEMA_ARG_ROOT:-$ROOT}"
SELF_NAME="schema-arg-resolves.sh"

# ── path normalisation ───────────────────────────────────────────────────────
# Collapses `.` and `..` textually. Textual is required, not a shortcut: the
# whole point is to judge paths that DO NOT EXIST, and realpath/cd cannot
# normalise those.
normalize() {
    local p="$1" out=() seg
    local IFS='/'
    for seg in $p; do
        case "$seg" in
            ''|'.') ;;
            '..') [ "${#out[@]}" -gt 0 ] && unset 'out[${#out[@]}-1]' || out+=('..') ;;
            *) out+=("$seg") ;;
        esac
    done
    printf '%s' "${out[*]:-}"
}

# ── the scan ─────────────────────────────────────────────────────────────────
# Workflows, shell scripts, Dockerfiles, package.json, the JS under scripts/ that
# shells out, and the docs that tell a human what to type — docs/deployment
# carried this same broken path in two runbooks.
#
# ONE grep process, not find + a grep per file: this probe is marked `ci` and
# runs on every local-gate, and the per-file spawn form measured 2m33s on the
# real repo against 4s here (Windows process creation). A gate slow enough to be
# annoying is a gate someone eventually reaches for a reason to skip.
#
# Emits `<path-relative-to-scan-root>:<lineno>:<text>`. Two files are dropped:
# the change log is an append-only incident log (a bad command recorded there is
# history, not an instruction), and this probe's own file carries deliberately
# broken --schema fixtures inside its selftest.
grep_hits() {
    grep -rnI --binary-files=without-match \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
        --exclude-dir=coverage --exclude-dir=dist --exclude-dir=build \
        --exclude-dir=playwright-report --exclude-dir=test-results \
        --exclude-dir=.turbo --exclude-dir=out --exclude-dir=evidence \
        --exclude-dir=reports --exclude-dir=backups \
        --include='*.sh' --include='Dockerfile*' --include='package.json' \
        --include='*.yml' --include='*.yaml' --include='*.js' \
        --include='*.cjs' --include='*.mjs' --include='*.md' \
        -e '--schema' "$SCAN_ROOT" 2>/dev/null \
    | sed "s#^${SCAN_ROOT}/##" \
    | grep -v -e "^${SELF_NAME}:" -e "/${SELF_NAME}:" \
    | sort
}

# ── base directories a command may run from ──────────────────────────────────
# Discovered, not hardcoded: a new app added tomorrow is covered without editing
# this probe. Generated trees are excluded as bases — a build output that happens
# to contain a copy of prisma/ would let a wrong argument "exist" and turn this
# probe green off an artifact nobody deploys from.
package_roots() {
    find "$SCAN_ROOT" -maxdepth 4 -name package.json \
        -not -path '*/node_modules/*' -not -path '*/.next/*' \
        -not -path '*/dist/*' -not -path '*/build/*' -print 2>/dev/null \
    | sed "s#^${SCAN_ROOT}/\{0,1\}##; s#package\.json\$##; s#/\$##" | sort -u
}

# ── selftest ─────────────────────────────────────────────────────────────────
# In-file, same convention as dockerignore-secrets.sh / holiday-single-source.sh.
# Law L6: a probe ships proving BOTH that it fails on the real defect and that it
# passes on the real repo shape. Case A is the negative control — without it a
# probe that always failed would satisfy every red case below.
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0

    # A tree with the shape this repo actually has: a schema FOLDER, a backend
    # package root, a web-app package root, a workflow and a Dockerfile.
    seed_tree() { # $1 dir
        mkdir -p "$1/.github/workflows" "$1/apps/backend/prisma/schema" \
                 "$1/apps/web-app" "$1/docs/deployment" "$1/scripts"
        printf '{}\n'                >"$1/package.json"
        printf '{}\n'                >"$1/apps/web-app/package.json"
        printf 'generator client {}\n' >"$1/apps/backend/prisma/schema/_base.prisma"
        printf '{\n  "scripts": { "postinstall": "prisma generate --schema prisma/schema" }\n}\n' \
                                     >"$1/apps/backend/package.json"
    }
    check() { # $1 label  $2 root  $3 expected-exit  [needles...]
        local out code label="$1" root="$2" want="$3"; shift 3
        local needle
        CASES=$((CASES + 1))
        out="$(SCHEMA_ARG_ROOT="$root" bash "$0" 2>&1)"; code=$?
        echo "--- selftest $label → exit $code (expected $want)"; printf '%s\n' "$out"
        [ "$code" = "$want" ] || { echo "*** $label FAILED: exit $code != $want"; BAD=$((BAD + 1)); }
        for needle in "$@"; do
            printf '%s' "$out" | grep -q -- "$needle" \
                || { echo "*** $label FAILED: output does not mention '$needle'"; BAD=$((BAD + 1)); }
        done
        echo
    }

    # A — NEGATIVE CONTROL: the arguments this repo ships today ⇒ PASS.
    mkdir -p "$TMP/A"; seed_tree "$TMP/A"
    cat >"$TMP/A/.github/workflows/production.yml" <<'YML'
            docker compose run --rm backend sh -lc \
              "cd /app/apps/backend && pnpm exec prisma migrate deploy --schema prisma/schema"
YML
    check A "$TMP/A" 0

    # B — THE ORIGINAL DEFECT, verbatim from production.yml:279 before the fix.
    #     Must go red and must NAME the path, not merely complain.
    mkdir -p "$TMP/B"; seed_tree "$TMP/B"
    cat >"$TMP/B/.github/workflows/production.yml" <<'YML'
            docker compose run --rm backend sh -lc \
              "cd /app/apps/backend && pnpm exec prisma migrate deploy --schema prisma/schema.prisma"
YML
    check B "$TMP/B" 1 'prisma/schema.prisma' 'production.yml'

    # C — MUTATION: a plausible near-miss a denylist for `schema.prisma` cannot
    #     see. The folder was renamed / the value was mistyped.
    mkdir -p "$TMP/C"; seed_tree "$TMP/C"
    printf 'RUN npx prisma generate --schema=prisma/schemas\n' >"$TMP/C/apps/backend/Dockerfile"
    check C "$TMP/C" 1 'prisma/schemas' 'Dockerfile'

    # D — MUTATION: a package.json script. Same class, different file type.
    mkdir -p "$TMP/D"; seed_tree "$TMP/D"
    printf '{\n  "scripts": { "postinstall": "prisma generate --schema prisma/gone/schema" }\n}\n' \
        >"$TMP/D/apps/backend/package.json"
    check D "$TMP/D" 1 'prisma/gone/schema' 'package.json'

    # E — MUTATION: a runbook. docs/deployment carried this exact broken path in
    #     two files; a doc that tells an operator to type a dead command is the
    #     same defect as the workflow that runs it.
    mkdir -p "$TMP/E"; seed_tree "$TMP/E"
    printf 'Run:\n\n    pnpm --dir apps/backend exec prisma migrate status --schema prisma/schema.prisma\n' \
        >"$TMP/E/docs/deployment/preview-deploy-runbook.md"
    check E "$TMP/E" 1 'preview-deploy-runbook.md'

    # F — a value relative to a Dockerfile in another app, reached by `..`.
    #     apps/web-app/Dockerfile does exactly this. Must PASS: normalisation and
    #     the file's own directory as a base both have to work.
    mkdir -p "$TMP/F"; seed_tree "$TMP/F"
    printf 'WORKDIR /app/apps/web-app\nRUN npx prisma generate --schema=../backend/prisma/schema\n' \
        >"$TMP/F/apps/web-app/Dockerfile"
    check F "$TMP/F" 0

    # G — the same `..` form pointed one directory too high. Escaping the repo is
    #     not "exists"; without this case F could pass for the wrong reason.
    mkdir -p "$TMP/G"; seed_tree "$TMP/G"
    printf 'WORKDIR /app/apps/web-app\nRUN npx prisma generate --schema=../../../backend/prisma/schema\n' \
        >"$TMP/G/apps/web-app/Dockerfile"
    check G "$TMP/G" 1 'backend/prisma/schema'

    # H — NOT A PATH: pg_dump/bq spell a SQL namespace `--schema=public`, and
    #     prose says "a --schema argument may never…". Both must stay green, or
    #     the probe gets switched off the first week.
    mkdir -p "$TMP/H"; seed_tree "$TMP/H"
    cat >"$TMP/H/scripts/backup.sh" <<'SH'
pg_dump -U gacp --data-only --schema=public > dump.sql
bq show --schema --format=json my_dataset.my_table
# the rule is: a --schema argument may never name the old monolith file
SH
    cat >"$TMP/H/.github/workflows/production.yml" <<'YML'
            run: pnpm exec prisma migrate deploy --schema prisma/schema
YML
    check H "$TMP/H" 0 'not judged'

    # I — quoting: the value sits inside a double-quoted shell string in YAML.
    #     The reported path must be `prisma/schema.prisma`, with no trailing
    #     quote, or the operator greps for a path that does not appear.
    mkdir -p "$TMP/I"; seed_tree "$TMP/I"
    printf 'run: sh -lc "prisma migrate deploy --schema prisma/schema.prisma"\n' \
        >"$TMP/I/.github/workflows/deploy.yml"
    check I "$TMP/I" 1 'prisma/schema.prisma$'

    # J — nothing to judge ⇒ BLOCKED, not PASS. "I found no --schema arguments"
    #     is a different statement from "every --schema argument is good", and
    #     reporting PASS for it would hide a broken scan.
    mkdir -p "$TMP/J"; seed_tree "$TMP/J"
    rm "$TMP/J/apps/backend/package.json"; printf '{}\n' >"$TMP/J/apps/backend/package.json"
    check J "$TMP/J" 2

    # K — only unverifiable absolute host paths ⇒ BLOCKED. A checkout cannot say
    #     whether /opt/gacp/schema exists on a deploy box; claiming PASS would be
    #     a vacuous green.
    mkdir -p "$TMP/K"; seed_tree "$TMP/K"
    rm "$TMP/K/apps/backend/package.json"; printf '{}\n' >"$TMP/K/apps/backend/package.json"
    printf 'run: prisma migrate deploy --schema /opt/gacp/prisma/schema\n' \
        >"$TMP/K/.github/workflows/deploy.yml"
    check K "$TMP/K" 2 'not verifiable'

    # L — an absolute path INSIDE the container maps to the repo root and is
    #     judged normally. This one is broken and must go red.
    mkdir -p "$TMP/L"; seed_tree "$TMP/L"
    printf 'run: prisma migrate deploy --schema /app/apps/backend/prisma/schema.prisma\n' \
        >"$TMP/L/.github/workflows/deploy.yml"
    check L "$TMP/L" 1 '/app/apps/backend/prisma/schema.prisma'

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "schema-arg-resolves --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "schema-arg-resolves --selftest: $BAD assertion(s) FAILED"; exit 1
fi

# ── run ──────────────────────────────────────────────────────────────────────
[ -d "$SCAN_ROOT" ] || blocked "scan root $SCAN_ROOT is not a directory — nothing was examined"

BASES_COMMON=".
$(package_roots)"

BAD_LIST=""
BAD_COUNT=0
OK_COUNT=0
UNVERIFIABLE=""
UNVERIFIABLE_COUNT=0
SKIPPED=""
SKIPPED_COUNT=0

HITS_FILE="${TMPDIR:-/tmp}/schema-arg-hits.$$"
trap 'rm -f "$HITS_FILE"' EXIT
grep_hits >"$HITS_FILE"

# Read from a file, never a pipe: the counters below must survive the loop, and a
# piped `while` runs in a subshell that throws them away.
while IFS= read -r hitline; do
    [ -z "${hitline:-}" ] && continue
    rel="${hitline%%:*}"
    rest="${hitline#*:}"
    lineno="${rest%%:*}"
    text="${rest#*:}"

    # A --schema on a line with no `prisma` on it is a SQL namespace, not a path
    # (pg_dump, bq). Judging those would make the probe wrong, not stricter.
    if ! printf '%s' "$text" | grep -qi 'prisma'; then
        SKIPPED="${SKIPPED}  - ${rel}:${lineno}  (no 'prisma' on the line — reads as a SQL namespace, not a path)"$'\n'
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
    fi

    # Every base this line's command could run from.
    bases="$BASES_COMMON
$(dirname "$rel")"
    for d in $(printf '%s' "$text" | grep -oE '(cd|WORKDIR)[[:space:]]+[^[:space:]"'"'"'`;&]+' | sed -E 's/^(cd|WORKDIR)[[:space:]]+//'); do
        d="${d#/app/}"; d="${d#/}"
        bases="$bases
$d"
    done

    occurrences="$(printf '%s' "$text" | grep -o -- '--schema' | grep -c . || true)"
    values="$(printf '%s' "$text" | grep -oE -- '--schema(=|[[:space:]]+)[^[:space:]"'"'"'`]+' \
              | sed -E 's/^--schema(=|[[:space:]]+)//')"
    value_count=0

    while IFS= read -r val; do
        [ -z "$val" ] && continue
        val="${val%%[,;)]}"; val="${val%\\}"; val="${val%.}"
        case "$val" in -*) continue;; esac          # another flag, not a value
        value_count=$((value_count + 1))

        # ค่าที่มี `\/` คือ **regex literal ไม่ใช่ path** — เส้นทางไฟล์บนลินุกซ์ไม่มีวัน
        # มี backslash นำหน้า slash · ที่เจอจริง 2026-09-11 สองจุด: เทสที่ตรึงว่า
        # Dockerfile ต้องมี `--schema prisma/schema` เขียน assertion เป็น
        # /--schema prisma\/schema/ และ BACKLOG ที่ยกข้อความนั้นมาอ้าง ⇒ ด่านอ่าน
        # regex เป็น path แล้วฟ้องว่าไฟล์ไม่มีอยู่ · ด่านที่ฟ้องเทสที่บังคับกฎเดียวกับตัวมันเอง
        # คือด่านที่ลงโทษคนที่ทำถูก
        case "$val" in
            *'\/'*) SKIPPED="${SKIPPED}  - ${rel}:${lineno}  '${val}' (regex literal ไม่ใช่ path — มี backslash นำหน้า slash)"$'\n'
                    SKIPPED_COUNT=$((SKIPPED_COUNT + 1)); continue;;
        esac

        # Path-shaped, or prose? A real --schema value always carries a separator
        # or names a .prisma file. "argument", "pointing", "at" do not.
        case "$val" in
            */*|*.prisma) ;;
            *) SKIPPED="${SKIPPED}  - ${rel}:${lineno}  '${val}' (not path-shaped — reads as prose, not a value)"$'\n'
               SKIPPED_COUNT=$((SKIPPED_COUNT + 1)); continue;;
        esac

        # Absolute values: /app is the repo root inside the container images.
        # Anything else names a host path a checkout cannot see.
        case "$val" in
            /app/*) cand_list="$(normalize "${val#/app/}")" ;;
            /*)     UNVERIFIABLE="${UNVERIFIABLE}  - ${rel}:${lineno}  ${val}"$'\n'
                    UNVERIFIABLE_COUNT=$((UNVERIFIABLE_COUNT + 1)); continue ;;
            *)      cand_list=""
                    while IFS= read -r b; do
                        [ -z "$b" ] && continue
                        cand_list="${cand_list}$(normalize "$b/$val")"$'\n'
                    done <<<"$bases" ;;
        esac

        found=""
        tried=""
        while IFS= read -r cand; do
            [ -z "$cand" ] && continue
            case "$cand" in ..*) continue;; esac     # resolved outside the repo
            tried="${tried}${cand} "
            if [ -e "$SCAN_ROOT/$cand" ]; then found="$cand"; break; fi
        done <<<"$cand_list"

        if [ -n "$found" ]; then
            OK_COUNT=$((OK_COUNT + 1))
        else
            BAD_COUNT=$((BAD_COUNT + 1))
            BAD_LIST="${BAD_LIST}  - ${rel}:${lineno}"$'\n'"      --schema ${val}"$'\n'"      no such path under any base tried: ${tried:-<none — every candidate escaped the repo>}"$'\n'
        fi
    done <<<"$values"

    if [ "$occurrences" -gt "$value_count" ]; then
        SKIPPED="${SKIPPED}  - ${rel}:${lineno}  ($((occurrences - value_count)) '--schema' with no path operand — a boolean flag)"$'\n'
        SKIPPED_COUNT=$((SKIPPED_COUNT + occurrences - value_count))
    fi
done <"$HITS_FILE"

report_tail() {
    [ "$UNVERIFIABLE_COUNT" -gt 0 ] && {
        echo "      $UNVERIFIABLE_COUNT value(s) not verifiable from a checkout (absolute host path):"
        printf '%s' "$UNVERIFIABLE"; }
    [ "$SKIPPED_COUNT" -gt 0 ] && {
        echo "      $SKIPPED_COUNT '--schema' occurrence(s) not judged, by design:"
        printf '%s' "$SKIPPED"; }
    return 0
}

if [ "$BAD_COUNT" -gt 0 ]; then
    echo "FAIL: $BAD_COUNT --schema argument(s) name a path that does not exist in this repo"
    printf '%s' "$BAD_LIST"
    echo "      The Prisma schema here is a prismaSchemaFolder DIRECTORY:"
    echo "      apps/backend/prisma/schema/ — pass '--schema prisma/schema' from apps/backend"
    echo "      (apps/backend/Dockerfile is the correct reference). apps/backend/prisma/schema.prisma"
    echo "      was deleted on 2026-03-12 and must not be recreated."
    report_tail
    exit 1
fi

if [ "$OK_COUNT" -eq 0 ]; then
    # The tail goes out BEFORE the verdict: a BLOCKED that does not show what it
    # saw is indistinguishable from a scan that silently found nothing.
    report_tail
    blocked "found no verifiable --schema path argument anywhere under $SCAN_ROOT ($UNVERIFIABLE_COUNT unverifiable, $SKIPPED_COUNT not judged) — the scan proved nothing, so this is BLOCKED not PASS (check the file filters in collect_files)"
fi

echo "PASS: $OK_COUNT --schema path argument(s) all resolve to a path that exists"
report_tail
exit 0
