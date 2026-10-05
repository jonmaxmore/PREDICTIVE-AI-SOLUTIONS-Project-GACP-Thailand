#!/usr/bin/env bash
# no-secret — live key material in sources = FAIL.
#
# TWO LAYERS, and this probe is only layer 1:
#   layer 1 = the grep pin below (this file)
#   layer 2 = CI job `Secret Scanning` (TruffleHog) in .github/workflows/ci.yml
#
# FAIL-LOUD CONTRACT (operator 2026-08-03). This probe used to end with
#   pass "0 grep hits (gitleaks not installed in this environment — grep only)"
# i.e. it reported PASS for a scan it did not run. To every reader, and in every
# archived evidence pack, that is indistinguishable from a clean two-layer
# result — and evidence/W2-01-adapter-seam/probe-results.json shows it had been
# taking that path all along, while the project rules Law 3.3 advertised "gitleaks +
# grep pin" as the enforcement. gitleaks appears nowhere under .github/.
#
# A probe that passes itself when its tool is missing is not a probe. When no
# deep scanner is available, exit BLOCKED (2) — never PASS.
#
# REDACTION CONTRACT (2026-08-27, the change log L2 near-miss). A FAIL prints
# file:line:<prefix><redacted> — never the matched value. The probe's own output
# lands in agent context, terminal scrollback and evidence packs; a secret
# scanner that prints the secret it found is itself the leak it exists to
# prevent. Selftest: bash scripts/probes/no-secret.sh --selftest
source "$(dirname "$0")/_lib.sh"

SECRET_RE='(sk_(test|live)_|rk_(test|live)_|whsec_|pk_live_)[A-Za-z0-9]{8,}'

# Every hit as file:line:<prefix><redacted>. `-o` keeps only the token (never the
# rest of the line, which may hold a second secret the regex does not know), and
# the sed keeps only the prefix that names WHAT kind of key was found.
# WHAT is scanned: everything git could commit — tracked files plus untracked files
# that are not ignored (git ls-files -co --exclude-standard). A gitignored
# apps/backend/.env holding a developer's sk_test key is not a leak into the
# repository, and reporting it made this probe permanently red on every dev box
# while CI (no .env) stayed green — two different answers to one question.
# Outside a git work tree (the selftest's temp dirs) fall back to a plain
# directory walk so the redaction contract is still exercised.
redact() { sed -E 's/:((sk|rk)_(test|live)_|whsec_|pk_live_)[A-Za-z0-9]+$/:\1<redacted>/'; }
scan_hits() { # $1 = root to scan
    if git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        (cd "$1" && git ls-files -co --exclude-standard -z -- apps packages scripts 2>/dev/null \
            | xargs -0 grep -InoE "$SECRET_RE" 2>/dev/null) | redact || true
    else
        grep -rInoE "$SECRET_RE" "$1/apps" "$1/packages" "$1/scripts" \
            --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=build --exclude-dir=dist 2>/dev/null \
            | redact || true
    fi
}

if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    # A fabricated token with a recognisable tail; the tail must never be printed.
    FAKE_TAIL="ZZselftestZZ9c8b7a6f5e4d3c2b1a"
    mkdir -p "$TMP/dirty/apps/x" "$TMP/dirty/packages" "$TMP/dirty/scripts" \
             "$TMP/clean/apps" "$TMP/clean/packages" "$TMP/clean/scripts"
    printf 'const k = "sk_test_%s";\nconst w = "whsec_%s";\n' "$FAKE_TAIL" "$FAKE_TAIL" > "$TMP/dirty/apps/x/leak.js"
    printf 'const k = process.env.STRIPE_SECRET_KEY;\n' > "$TMP/clean/apps/ok.js"

    run() { # $1 label  $2 root  $3 expected-exit  $4 needle  $5 forbidden
        local label="$1" root="$2" want="$3" needle="$4" forbidden="$5" out code
        CASES=$((CASES + 1))
        out="$(NO_SECRET_SCAN_ROOT="$root" PROBE_OUT_DIR="$TMP" bash "$0" 2>&1)"; code=$?
        echo "--- $label → exit $code (expected $want)"; printf '   %s\n' "$out"
        [ "$code" = "$want" ] || { echo "*** $label FAILED: exit $code != $want"; BAD=$((BAD + 1)); }
        printf '%s' "$out" | grep -q -- "$needle" || { echo "*** $label FAILED: missing '$needle'"; BAD=$((BAD + 1)); }
        if [ -n "$forbidden" ] && printf '%s' "$out" | grep -q -- "$forbidden"; then
            echo "*** $label FAILED: printed the secret value ('$forbidden')"; BAD=$((BAD + 1))
        fi
    }
    run "dirty tree: FAIL, both kinds named, value redacted" "$TMP/dirty" 1 "sk_test_<redacted>" "$FAKE_TAIL"
    run "dirty tree: whsec named too" "$TMP/dirty" 1 "whsec_<redacted>" "$FAKE_TAIL"
    # A git work tree whose only secret sits in a gitignored .env must not fail:
    # that file cannot reach the repository. A committable file with a key must.
    mkdir -p "$TMP/repo/apps" "$TMP/repo/packages" "$TMP/repo/scripts"
    (cd "$TMP/repo" && git init -q && printf '.env\n' > .gitignore \
        && printf 'STRIPE_SECRET_KEY=sk_test_%s\n' "$FAKE_TAIL" > apps/.env \
        && printf 'const k = process.env.STRIPE_SECRET_KEY;\n' > apps/ok.js)
    if command -v gitleaks >/dev/null 2>&1 || [ -n "${CI:-}" ]; then
        run "git tree: ignored .env is not a leak (PASS)" "$TMP/repo" 0 "0 hits" "$FAKE_TAIL"
    else
        run "git tree: ignored .env is not a leak (BLOCKED, not FAIL)" "$TMP/repo" 2 "0 hits" "$FAKE_TAIL"
    fi
    printf 'const leak = "whsec_%s";\n' "$FAKE_TAIL" > "$TMP/repo/apps/leak.js"
    run "git tree: an untracked committable file with a key FAILs, redacted" "$TMP/repo" 1 "whsec_<redacted>" "$FAKE_TAIL"
    if command -v gitleaks >/dev/null 2>&1 || [ -n "${CI:-}" ]; then
        run "clean tree: PASS (deep scanner present)" "$TMP/clean" 0 "0 hits" ""
    else
        run "clean tree: BLOCKED, never PASS without a deep scanner" "$TMP/clean" 2 "0 hits" ""
    fi
    [ "$BAD" -eq 0 ] && { echo "no-secret --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "no-secret --selftest: $BAD assertion(s) FAILED"; exit 1
fi

SCAN_ROOT="${NO_SECRET_SCAN_ROOT:-$ROOT}"
HITS="$(scan_hits "$SCAN_ROOT")"
[ -n "$HITS" ] && fail "$(printf '%s' "$HITS" | head -5)"

# Layer 2 when a local deep scanner exists.
if command -v gitleaks >/dev/null 2>&1; then
    (cd "$SCAN_ROOT" && gitleaks detect --no-banner --redact) >"$EVIDENCE_DIR/gitleaks.log" 2>&1 \
        || fail "gitleaks found leaks — $EVIDENCE_DIR/gitleaks.log"
    pass "layer1 grep: 0 hits · layer2 gitleaks: clean"
fi

# In CI, layer 2 is the TruffleHog `Secret Scanning` job, so a CI run genuinely
# has two layers even without gitleaks on PATH. A local run does not.
if [ -n "${CI:-}" ]; then
    pass "layer1 grep: 0 hits · layer2 = TruffleHog job (Secret Scanning) in this CI run"
fi

blocked "operator:secret-scanner — layer1 grep passed (0 hits) but NO deep scanner ran locally (gitleaks absent, not in CI). Install gitleaks or run in CI where TruffleHog provides layer 2. Refusing to report PASS for a scan that did not happen."
