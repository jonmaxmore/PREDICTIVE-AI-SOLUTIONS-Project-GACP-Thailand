#!/usr/bin/env bash
# dockerignore-secrets — no private key, env file or farmer upload can enter a
# Docker build context.
#
# ── WHY THIS IS NOT A STRING-MATCH PROBE ─────────────────────────────────────
# The obvious implementation is `grep -q '\*\*/\*.pem' .dockerignore`. That
# probe passes on a .dockerignore full of patterns that do not actually match
# anything — which is precisely the failure it is supposed to catch. The
# pre-2026-08-22 .dockerignore contained `.env` and looked protected; it was
# not, because .dockerignore patterns are matched with Go's filepath.Match
# against the path RELATIVE TO THE CONTEXT ROOT and do NOT recurse the way
# .gitignore does. `.env` matched ./.env and nothing else, so apps/backend/.env
# — Supabase credentials, JWT secrets — went into every image, alongside
# apps/backend/keys/private.pem (the certificate-signing key) and 85 farmer
# uploads, via apps/backend/Dockerfile:28 `COPY apps/backend ./apps/backend`
# and :96 carrying it into the final stage.
#
# So this probe does what Docker does: it enumerates the sensitive files that
# actually exist in the tree and evaluates the .dockerignore rules against each
# one, honouring `**`, trailing-slash directory rules, and `!` negation. A
# pattern that is present but ineffective goes red.
#
# NOT COVERED (say what a guard does not fix):
#   - Secrets committed in git history — that is `no-secret` + a key rotation.
#   - Secrets baked in via ARG/ENV in a Dockerfile, or fetched at build time.
#   - A file type not in the sensitive list below.
#   - Whether a running container leaks them; this is build-context only.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED (never a vacuous PASS: an
# unreadable .dockerignore, or a scan that finds nothing to test, is BLOCKED).
#
# Usage:  bash scripts/probes/dockerignore-secrets.sh
#         bash scripts/probes/dockerignore-secrets.sh --selftest
#         DOCKERIGNORE_ROOT=<dir> bash scripts/probes/dockerignore-secrets.sh
#           ^ evaluate a synthetic tree instead of the repo, so the probe can be
#             exercised against known-dirty and known-clean fixtures (same
#             convention as HOLIDAY_BACKEND_ROOT in holiday-single-source.sh).
source "$(dirname "$0")/_lib.sh"

SCAN_ROOT="${DOCKERIGNORE_ROOT:-$ROOT}"

# ── .dockerignore rule → regex ───────────────────────────────────────────────
# Models Docker's matcher, deliberately including the part people get wrong:
# a pattern with no `**` does NOT match at deeper levels. A rule that names a
# directory also excludes everything under it.
rule_to_regex() {
    local p="$1" re="" c
    p="${p#./}"
    p="${p%/}"
    while [ -n "$p" ]; do
        c="${p:0:1}"
        case "$c" in
            '*')
                if [ "${p:0:3}" = "**/" ]; then re="$re(.*/)?"; p="${p:3}"; continue
                elif [ "${p:0:2}" = "**" ]; then re="$re.*"; p="${p:2}"; continue
                else re="$re[^/]*"; fi ;;
            '?') re="$re[^/]" ;;
            '.'|'+'|'('|')'|'['|']'|'{'|'}'|'^'|'$'|'|'|'\\') re="$re\\$c" ;;
            *) re="$re$c" ;;
        esac
        p="${p:1}"
    done
    # A matched directory takes its whole subtree with it.
    printf '%s' "^${re}(/.*)?\$"
}

# is_ignored <relative-path> — echoes the winning rule, or nothing.
# Later rules win, and a leading `!` re-includes, exactly as Docker resolves it.
is_ignored() {
    local path="$1" rule winner="" neg re
    while IFS= read -r rule; do
        rule="${rule%$'\r'}"
        case "$rule" in ''|'#'*) continue;; esac
        neg=0
        case "$rule" in '!'*) neg=1; rule="${rule#!}";; esac
        re="$(rule_to_regex "$rule")"
        if [[ "$path" =~ $re ]]; then
            if [ "$neg" = 1 ]; then winner=""; else winner="$rule"; fi
        fi
    done <"$IGNORE_FILE"
    printf '%s' "$winner"
}

# ── selftest ─────────────────────────────────────────────────────────────────
# In-file so the operator can re-run the evidence, same convention as
# holiday-single-source.sh / status-vocab.sh. Every mutation case re-introduces
# a REAL leak and asserts this probe goes red — a probe that only ever passes
# proves nothing.
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0

    # A build context carrying exactly what this repo carries.
    seed_tree() { # $1 dir
        mkdir -p "$1/apps/backend/keys" "$1/apps/backend/public/uploads"
        printf 'NOT-A-REAL-KEY\n' >"$1/apps/backend/keys/private.pem"
        printf 'NOT-A-REAL-KEY\n' >"$1/apps/backend/keys/public.pem"
        printf 'PLACEHOLDER=1\n'  >"$1/apps/backend/.env"
        printf 'PLACEHOLDER=1\n'  >"$1/.env"
        printf 'x\n'              >"$1/apps/backend/public/uploads/farmer-doc.pdf"
    }
    check() { # $1 label  $2 root  $3 expected-exit  [$4 needle]
        local out code
        CASES=$((CASES + 1))
        out="$(DOCKERIGNORE_ROOT="$2" bash "$0" 2>&1)"; code=$?
        echo "--- selftest $1 → exit $code (expected $3)"; printf '%s\n' "$out"
        [ "$code" = "$3" ] || { echo "*** $1 FAILED: exit $code != $3"; BAD=$((BAD + 1)); }
        if [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -q -- "$4"; then
            echo "*** $1 FAILED: output does not mention '$4'"; BAD=$((BAD + 1))
        fi
        echo
    }

    # A — the patterns this repo now ships ⇒ PASS. Baseline: without it, a probe
    #     that always fails would satisfy every mutation case below.
    mkdir -p "$TMP/A"; seed_tree "$TMP/A"
    cat >"$TMP/A/.dockerignore" <<'IGN'
**/node_modules
**/*.pem
**/.env
**/.env.*
apps/backend/keys/
apps/backend/public/uploads/
IGN
    check A "$TMP/A" 0

    # B — THE ORIGINAL DEFECT: only the context-root `.env` is excluded, which is
    #     what the file said before 2026-08-22. Must FAIL and must name the
    #     private key, not merely complain in the abstract.
    mkdir -p "$TMP/B"; seed_tree "$TMP/B"
    cat >"$TMP/B/.dockerignore" <<'IGN'
**/node_modules
.git
.env
.env.local
backups/
evidence/
IGN
    check B "$TMP/B" 1 'apps/backend/keys/private.pem'

    # C — MUTATION: keys and uploads handled, but env files only at the root.
    #     This is the .dockerignore-vs-.gitignore trap; a string-matching probe
    #     that saw `.env` present would call this clean.
    mkdir -p "$TMP/C"; seed_tree "$TMP/C"
    cat >"$TMP/C/.dockerignore" <<'IGN'
**/node_modules
**/*.pem
apps/backend/keys/
apps/backend/public/uploads/
.env
IGN
    check C "$TMP/C" 1 'apps/backend/.env'

    # D — MUTATION: secrets handled, farmer uploads (PDPA personal data) not.
    mkdir -p "$TMP/D"; seed_tree "$TMP/D"
    cat >"$TMP/D/.dockerignore" <<'IGN'
**/node_modules
**/*.pem
**/.env
**/.env.*
IGN
    check D "$TMP/D" 1 'uploads'

    # E — MUTATION: the right patterns, then a `!` negation that undoes one.
    #     Rule precedence must be modelled, not just rule presence.
    mkdir -p "$TMP/E"; seed_tree "$TMP/E"
    cat >"$TMP/E/.dockerignore" <<'IGN'
**/node_modules
**/*.pem
**/.env
**/.env.*
apps/backend/public/uploads/
!apps/backend/keys/private.pem
IGN
    check E "$TMP/E" 1 'apps/backend/keys/private.pem'

    # F — no .dockerignore at all ⇒ BLOCKED, never PASS.
    mkdir -p "$TMP/F"; seed_tree "$TMP/F"
    check F "$TMP/F" 2

    # G — a tree with nothing sensitive in it ⇒ BLOCKED, not PASS. "I found
    #     nothing to check" is a different statement from "nothing leaks", and
    #     reporting PASS for it would hide a broken scan.
    mkdir -p "$TMP/G"; printf 'x\n' >"$TMP/G/readme.txt"
    cat >"$TMP/G/.dockerignore" <<'IGN'
**/node_modules
IGN
    check G "$TMP/G" 2

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "dockerignore-secrets --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "dockerignore-secrets --selftest: $BAD assertion(s) FAILED"; exit 1
fi

# ── run ──────────────────────────────────────────────────────────────────────
IGNORE_FILE="$SCAN_ROOT/.dockerignore"
[ -r "$IGNORE_FILE" ] \
    || blocked "cannot read ${IGNORE_FILE} — with no ignore file the ENTIRE context ships to the daemon and into any COPY; refusing to call that a PASS"

# Sensitive files that actually exist in the context. Discovered, not hardcoded,
# so a new key or env file added tomorrow is covered without editing this probe.
# node_modules/.git are excluded: both are already ignored and walking them
# costs minutes.
SENSITIVE="$(cd "$SCAN_ROOT" && find . \
        \( -name node_modules -o -name .git \) -prune -o \
        \( -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' -o -name '*.crt' \
           -o -name '.env' -o -name '.env.*' \
           -o -path './apps/backend/public/uploads/*' \) -type f -print 2>/dev/null \
    | sed 's#^\./##' | sort)"

COUNT="$(printf '%s\n' "$SENSITIVE" | grep -c . || true)"
[ "$COUNT" -gt 0 ] \
    || blocked "found no key/env/upload files under ${SCAN_ROOT} — the scan proved nothing, so this is BLOCKED not PASS (check the find filters)"

LEAKED=""
LEAK_COUNT=0
while IFS= read -r f; do
    [ -z "$f" ] && continue
    if [ -z "$(is_ignored "$f")" ]; then
        LEAKED="${LEAKED}  - ${f}"$'\n'
        LEAK_COUNT=$((LEAK_COUNT + 1))
    fi
done <<<"$SENSITIVE"

if [ "$LEAK_COUNT" -eq 0 ]; then
    pass "$COUNT sensitive file(s) in the tree, all excluded from the build context by .dockerignore"
fi

echo "FAIL: $LEAK_COUNT of $COUNT sensitive file(s) would be shipped in the Docker build context"
echo "      (apps/backend/Dockerfile:28 COPYs all of apps/backend, and :96 carries it into the final image)"
printf '%s' "$LEAKED"
echo "      Fix: add matching rules to .dockerignore. Remember patterns do NOT"
echo "      recurse like .gitignore — use '**/' for any depth below the root."
exit 1
