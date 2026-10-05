#!/usr/bin/env bash
# check-done.sh — probe runner (the project rules §4). Operator-owned (Law 3.12).
# Runs the requested probes (default: integrity + domain set), writes
# evidence/probe-results.json, exits non-zero if ANY probe FAILED.
# BLOCKED/PENDING do not fail the run — they are honest states, reported as-is.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBES_DIR="$ROOT/scripts/probes"
OUT_DIR="${PROBE_OUT_DIR:-$ROOT/evidence}"
mkdir -p "$OUT_DIR"

DEFAULT="suite-green no-skip no-secret ratchet stripe-sdk-isolated webhook-idempotent settle-webhook-only holiday-single-source stripe-keys-ready drain-complete money-equation crawler-clean"

# ── JSON encoding ─────────────────────────────────────────────────────────────
# node, not python3. This ran `python3 -c 'json.dumps(...)'` inside a command
# substitution, and on a machine without python3 the substitution returns the
# EMPTY STRING — so every entry was written as `"detail":}` and the artifact was
# not JSON at all. Observed on a Windows checkout 2026-08-14: probe-gate then
# failed on every run with "probe-results.json is not valid JSON", which reads
# like a corrupted result rather than a missing interpreter, and the tree was
# left dirty every time.
#
# The runner's entire job is producing evidence that can be trusted, so the
# failure mode "silently write something that is not what it claims to be" is the
# worst one available to it. node is the right dependency because this repository
# already requires it everywhere — probe-gate.js, every CI check, the app itself.
#
# Two guards, because they catch different things: the preflight catches "no
# encoder at all", and the per-probe check below catches an encoder that runs but
# produces nothing (a shim, a broken install, a killed process).
command -v node >/dev/null 2>&1 || {
    echo "check-done: node is not installed on this machine. It encodes probe output into probe-results.json; without it this runner would write a file that is not JSON instead of telling you. Install node and re-run." >&2
    exit 2
}

json_encode() { # stdin → a JSON string literal
    node -e 'let s="";process.stdin.on("data",d=>{s+=d}).on("end",()=>process.stdout.write(JSON.stringify(s)))'
}

json_parses() { # $1 = path; 0 when the file is valid JSON
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$1" 2>/dev/null
}

# ── selftest ──────────────────────────────────────────────────────────────────
# Kept in-file (same convention as scripts/probes/status-vocab.sh --selftest) so
# the evidence is re-runnable by the operator rather than living in an agent's
# scratch dir (Law 3.11).
#
# What it pins: what this runner writes must be readable, honest, and must not
# dirty the tree it is checking.
#
# Every probe prints machine paths built from an absolute $ROOT, so the written
# JSON used to contain this checkout's absolute path — which differs per machine
# and per git worktree. Consequence recorded in the change log (2026-08-07): every
# single run left the tree dirty and every agent had to `git checkout --
# evidence/probe-results.json` by hand before committing. A guardrail whose
# routine output must be manually discarded trains people to discard its output.
# Paths written here must therefore be repo-root-relative (cases A, B, D).
#
# That fix was necessary and not sufficient. The file's CONTENT is a list of
# probe verdicts, and those legitimately differ per machine, so it is now
# gitignored: a committed copy is a cached claim about probes that may not
# describe the commit beside it. the project rules §5 still wants it as evidence — as a
# copy inside evidence/<work-item>/, written by pointing PROBE_OUT_DIR there
# (case F).
#
# And case C used to be checked with python3 while the writer encoded with
# python3, so on a machine without it the case reported "not valid JSON" when the
# truth was "no parser here" — a broken subject and a missing tool telling the
# same story. Both now use node (cases C, E).
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    fail_case() { echo "*** $1 FAILED: $2"; BAD=$((BAD + 1)); }

    # Probes chosen because they are pure grep (no DB/key/jest) and they are the
    # ones that actually print file paths — i.e. the ones that could leak $ROOT.
    OUT="$(PROBE_OUT_DIR="$TMP" bash "$0" holiday-single-source ratchet no-skip 2>&1)"
    JSON="$TMP/probe-results.json"

    CASES=$((CASES + 1))
    echo "--- selftest A: written JSON contains no absolute checkout path"
    if [ ! -s "$JSON" ]; then
        fail_case A "no probe-results.json written to \$PROBE_OUT_DIR"
    else
        HITS="$(grep -o "$ROOT[^\"]*" "$JSON" | head -5 || true)"
        if [ -n "$HITS" ]; then
            echo "absolute paths found in $JSON:"; printf '%s\n' "$HITS"
            fail_case A "probe-results.json embeds the absolute checkout path ($ROOT) — it must be repo-root-relative"
        else
            echo "ok — 0 occurrences of $ROOT"
        fi
    fi
    echo

    CASES=$((CASES + 1))
    echo "--- selftest B: paths are still THERE, just relative (no blanket path stripping)"
    # Asserts the POSITIVE form, not merely the absence of $ROOT: deleting paths
    # altogether would also satisfy case A while destroying the evidence.
    if [ -s "$JSON" ] && grep -q 'single calendar source: apps/backend/utils/working-days.js' "$JSON"; then
        echo "ok — 'single calendar source: apps/backend/utils/working-days.js' present verbatim"
    else
        fail_case B "expected the calendar source path to survive as a repo-relative path"
    fi
    echo

    CASES=$((CASES + 1))
    echo "--- selftest C: output is valid JSON"
    # Checked with node, not python3. This assertion used python3 too, so on a
    # machine without it the case reported "not valid JSON" when the truth was
    # "no parser here" — the same conflation of a broken subject with a missing
    # tool that full-gate.sh:1009 had to fix for gitleaks.
    if [ -s "$JSON" ] && json_parses "$JSON"; then
        echo "ok — parses"
    else
        fail_case C "probe-results.json is not valid JSON"
    fi
    echo

    CASES=$((CASES + 1))
    echo "--- selftest D: console summary does not print the absolute checkout path either"
    if printf '%s' "$OUT" | grep -q "$ROOT/apps"; then
        printf '%s\n' "$OUT" | grep -o "$ROOT/apps[^ ]*" | head -3
        fail_case D "console summary still prints \$ROOT-prefixed paths"
    else
        echo "ok"
    fi
    echo

    CASES=$((CASES + 1))
    echo "--- selftest E: an encoder that returns nothing must ABORT, not write a corrupt artifact"
    # Reproduces the 2026-08-14 failure exactly. python3 was absent, so the
    # command substitution returned empty and the runner wrote `"detail":}` for
    # every probe and exited 0. A stub `node` that prints nothing puts the runner
    # in the same position without needing to uninstall anything — and unlike a
    # PATH sandbox it works on every platform, because it PREPENDS to PATH rather
    # than restricting it.
    FAKEBIN="$TMP/fakebin"; mkdir -p "$FAKEBIN"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKEBIN/node"
    chmod +x "$FAKEBIN/node"
    E_DIR="$TMP/case-e"; mkdir -p "$E_DIR"
    E_OUT="$(PATH="$FAKEBIN:$PATH" PROBE_OUT_DIR="$E_DIR" bash "$0" holiday-single-source 2>&1)"; E_RC=$?
    E_JSON="$E_DIR/probe-results.json"
    if [ "$E_RC" -eq 0 ]; then
        fail_case E "exited 0 with an encoder that produces nothing — this is the silent corruption being fixed"
    elif ! printf '%s' "$E_OUT" | grep -qi 'encod'; then
        fail_case E "aborted but never named the encoder as the cause: $(printf '%s' "$E_OUT" | tail -1)"
    elif [ -s "$E_JSON" ] && ! json_parses "$E_JSON"; then
        fail_case E "wrote an unparseable probe-results.json instead of refusing to write one"
    else
        echo "ok — aborted, named the encoder, and left no artifact that fails to parse"
    fi
    echo

    CASES=$((CASES + 1))
    echo "--- selftest F: the default output path is not tracked by git"
    # A tracked artifact that every run rewrites makes the gate dirty the tree it
    # is checking, and teaches people to discard a guardrail's output by reflex —
    # the change log recorded that happening to three agents in one day. Worse
    # than the noise: a committed copy is a cached claim about probe outcomes,
    # which is the failure ci.yml:355 describes the session start script making.
    if git -C "$ROOT" ls-files --error-unmatch evidence/probe-results.json >/dev/null 2>&1; then
        fail_case F "evidence/probe-results.json is tracked — every run rewrites it with this machine's verdicts, so the tree is dirty after every run and a committed copy may not describe the commit beside it"
    else
        echo "ok — untracked; evidence packs keep their own copy via PROBE_OUT_DIR (the project rules §5)"
    fi
    echo

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "check-done --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "check-done --selftest: $BAD assertion(s) FAILED"; exit 1
fi

SELECTED="${*:-$DEFAULT}"

# Rewrite this checkout's absolute path out of anything a probe printed, so the
# artifact below is identical on every machine and in every git worktree.
# Applied HERE, at the single writer, rather than in each probe: probes emit paths
# from stdout AND stderr and from helpers in _lib.sh, so per-probe stripping would
# be N places to keep in sync (Law 3.6) and would still miss the next probe added.
# Only the "$ROOT/" prefix is removed — the path itself survives, which is what
# makes the file useful as evidence (pinned by --selftest case B).
relativise() { printf '%s' "${1//"$ROOT/"/}"; }

RESULTS=()
ANY_FAIL=0
for p in $SELECTED; do
    script="$PROBES_DIR/$p.sh"
    if [ ! -x "$script" ]; then chmod +x "$script" 2>/dev/null; fi
    if [ ! -f "$script" ]; then
        status=FAIL; detail="unknown probe $p"; ANY_FAIL=1
    else
        detail="$(bash "$script" 2>&1)"
        code=$?
        case "$code" in
            0) status=PASS;;
            2) status=BLOCKED;;
            3) status=PENDING;;
            *) status=FAIL; ANY_FAIL=1;;
        esac
    fi
    detail="$(relativise "$detail")"
    printf '%-22s %-8s %s\n' "$p" "$status" "$(printf '%s' "$detail" | tail -1)"

    # An encoder that runs but returns nothing is the failure that produced
    # `"detail":}` for every probe. Refuse here rather than assembling a file
    # that will not parse — a runner that writes broken evidence and exits 0 is
    # worse than one that does not run (pinned by --selftest case E).
    encoded="$(printf '%s' "$detail" | json_encode)"
    [ -n "$encoded" ] || {
        echo "check-done: JSON encoding of probe '$p' output produced nothing — refusing to write an artifact that would not parse. Check that 'node' works: node -e 'process.stdout.write(\"ok\")'" >&2
        exit 2
    }
    RESULTS+=("{\"probe\":\"$p\",\"status\":\"$status\",\"detail\":$encoded}")
done

{
    printf '{"runner":"scripts/check-done.sh","results":[\n'
    IFS=,; printf '%s' "${RESULTS[*]}"
    printf '\n]}\n'
} >"$OUT_DIR/probe-results.json"
echo "→ $(relativise "$OUT_DIR/probe-results.json")"
exit "$ANY_FAIL"
