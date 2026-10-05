#!/usr/bin/env bash
# full-gate — the whole gate, on one machine that actually has Postgres, a Prisma
# engine and open egress. Run it on the gate/staging host; it needs no GitHub
# Actions, no runner and no network permission from this repo's CI.
#
# ┌─ WHAT THIS DOES NOT DO ─────────────────────────────────────────────────────┐
# │ It does NOT prevent anything from being merged. Branch protection is not     │
# │ available on the current GitHub plan, so nothing here can block a push or a  │
# │ merge. What it produces is an ATTESTATION — evidence/gate/<sha>.json — which │
# │ scripts/probes/gate-attestation.sh checks for the commit under test and      │
# │ scripts/probes/main-attestation-audit.sh checks across main's history. So an │
# │ unattested merge stays possible; it just cannot be claimed as gated, and it  │
# │ shows up by sha/date/author in the audit. Detection, not prevention.         │
# └─────────────────────────────────────────────────────────────────────────────┘
#
# THREE BUCKETS, never two: PASS · FAIL · NOT-RUN(reason). Every NOT-RUN is
# printed with its reason on every run. A check that could not run is never
# rounded up to a pass — that rounding is the phantom-guardrail family this repo
# has already caught 68 times (the audit ledger).
#
# EXIT: 0 only when every `required` check in scripts/ci/full-gate-checks.txt is
# PASS. A required NOT-RUN is fail-closed; the operator may accept it, in person,
# with `--allow-blocked "<who>: <why>"`, which is recorded in the attestation.
# A check that RAN AND FAILED can never be accepted.
#   0 = every required check PASS   1 = a verdict was reached and it is FAIL
#   2 = refused before starting (bad option, forbidden database, unknown sha)
#   3 = INFRA: this machine could not run the gate — no evidence could be
#       written, a tool is missing, Postgres did not answer. Nothing was learned
#       about the commit, so no attestation is written, this run's check logs are
#       deleted and an ABORTED marker is left instead. Three preflights (tools ·
#       evidence writability · admin connection) try to reach this state before
#       anything is built.
#       TWO INFRA FAILURES STILL EXIT 2, and saying so is cheaper than a comment
#       that is quietly wrong: `git worktree add` failing, and CREATE DATABASE
#       failing after the preflight connection succeeded. Both are reachable only
#       with a live Postgres, so no --selftest case can drive them, and this repo
#       does not change behaviour that no failing test covers first.
#
# MONEY (Law L3): the gate creates a throwaway database per run and drops it in a
# trap. The name must match ^gacp_gate_[0-9a-z_]+$ — an allowlist, because a
# denylist misses the name nobody thought of. gacp_db / gacp_staging abort the run
# outright. money-equation / drain-complete are NOT-RUN by default: on a database
# created seconds ago they would report "0 rows violate", which means "0 rows
# examined", not "no problem".
#
# Usage:
#   bash scripts/ci/full-gate.sh                     # gate HEAD
#   bash scripts/ci/full-gate.sh <sha>               # gate a specific commit
#   bash scripts/ci/full-gate.sh --allow-blocked "jonmaxmore: gitleaks missing"
#   bash scripts/ci/full-gate.sh --selftest          # exercise the logic, no DB
# Env: GATE_PG_ADMIN_URL (createdb/dropdb connection) · PGHOST/PGUSER/PGPORT
#      FULL_GATE_RUN_MONEY_PROBES=1 (only honoured when rows are actually present)
#      FLOW_PROOF_* (see apps/web-app/flow-proof/README.md)
# Runbook: docs/operations/runbooks/full-gate-on-staging.md
set -u

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKS_FILE="${GATE_CHECKS_FILE:-$SRC_ROOT/scripts/ci/full-gate-checks.txt}"
OUT_ROOT="${FULL_GATE_OUT_ROOT:-$SRC_ROOT}"

# Connection strings turn up inside other tools' error messages (prisma P1001,
# psql, jest). Every captured log and every reason string goes through this before
# it is written anywhere (Law L2). Pinned by --selftest case M.
redact() {
    printf '%s' "$*" | sed -E 's#(postgres(ql)?://[^:/@[:space:]]+):[^@[:space:]]*@#\1:***@#g'
}

# ── selftest ──────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'chmod -R u+rwX "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT; BAD=0; CASES=0; NOTRUN=0
    SHA="$(git -C "$SRC_ROOT" rev-parse HEAD)"
    # Deliberately a self-describing placeholder, not a realistic-looking password:
    # this file is scanned by the very gitleaks run that `secret-scan-deep` performs,
    # and a gate that trips over its own test fixture would be a fine joke.
    PW='placeholder-not-a-credential'

    run() { # $1 outdir  rest: args/env already exported by caller
        FULL_GATE_OUT_ROOT="$1" bash "$0" "${@:2}" 2>&1
    }
    check() { # $1 label  $2 expected-exit  $3 output  $4 actual-exit  [needles...]
        local label="$1" want="$2" out="$3" code="$4"; shift 4
        CASES=$((CASES + 1))
        echo "--- selftest $label → exit $code (expected $want)"; printf '%s\n' "$out" | tail -25
        [ "$code" = "$want" ] || { echo "*** $label FAILED: exit $code != $want"; BAD=$((BAD + 1)); }
        local needle
        for needle in "$@"; do
            printf '%s' "$out" | grep -qi -- "$needle" \
                || { echo "*** $label FAILED: output does not mention '$needle'"; BAD=$((BAD + 1)); }
        done
        echo
    }
    att_of() { cat "$1/evidence/gate/$SHA.json" 2>/dev/null; }

    # ── DB GUARD (Law L3). An allowlist, not a denylist: a denylist misses the
    #    name nobody thought of, and the blast radius here is production money.
    # A — the production database, named explicitly.
    out="$(DATABASE_URL="postgresql://u:$PW@db:5432/gacp_db" FULL_GATE_DRY_RUN=1 run "$TMP/A")"; code=$?
    check A 2 "$out" $code 'gacp_db' 'L3'

    # B — staging is not a scratch DB either; it holds real rows people look at.
    out="$(DATABASE_URL="postgresql://u:$PW@db:5432/gacp_staging" FULL_GATE_DRY_RUN=1 run "$TMP/B")"; code=$?
    check B 2 "$out" $code 'gacp_staging'

    # C — ALLOWLIST: any name outside gacp_gate_* is refused, even an innocent one.
    out="$(DATABASE_URL="postgresql://u:$PW@db:5432/some_other_db" FULL_GATE_DRY_RUN=1 run "$TMP/C")"; code=$?
    check C 2 "$out" $code 'gacp_gate_'

    # D — NEGATIVE CONTROL: a real scratch name must be accepted, otherwise the
    #     guard could be "correct" by refusing everything.
    out="$(DATABASE_URL="postgresql://u:$PW@db:5432/gacp_gate_abc123" FULL_GATE_DRY_RUN=1 run "$TMP/D")"; code=$?
    check D 0 "$out" $code

    # E — happy dry run writes a parseable attestation with the fields an operator
    #     needs to judge it later.
    out="$(FULL_GATE_DRY_RUN=1 run "$TMP/E")"; code=$?
    check E 0 "$out" $code 'PASS'
    CASES=$((CASES + 1))
    if att_of "$TMP/E" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["dry_run"] is True; assert d["sha"]; assert d["timestamp_utc"]; assert d["hostname"]; assert d["versions"]; assert d["checks"]; assert d["not_run"] is not None' 2>&1; then
        echo "--- selftest E2: attestation JSON shape ok"
    else
        echo "*** E2 FAILED: attestation missing required fields"; BAD=$((BAD + 1))
    fi
    echo

    # F — a REQUIRED check that did not run is fail-closed. This is the whole
    #     difference between this gate and a green tick that means nothing.
    out="$(FULL_GATE_DRY_RUN=1 FULL_GATE_FORCE='secret-scan-deep=not-run' run "$TMP/F")"; code=$?
    check F 1 "$out" $code 'secret-scan-deep' 'NOT-RUN'

    # G — the operator may accept it, by typing who they are. Recorded in the file.
    out="$(FULL_GATE_DRY_RUN=1 FULL_GATE_FORCE='secret-scan-deep=not-run' run "$TMP/G" --allow-blocked 'jonmaxmore: gitleaks not installed yet')"; code=$?
    check G 0 "$out" $code 'jonmaxmore'
    CASES=$((CASES + 1))
    if att_of "$TMP/G" | grep -q 'jonmaxmore'; then
        echo "--- selftest G2: acceptance recorded in the attestation"
    else
        echo "*** G2 FAILED: acceptance not written into the attestation"; BAD=$((BAD + 1))
    fi
    echo

    # H — MUTATION of G: acceptance covers NOT-RUN only. A check that ran and
    #     FAILED cannot be waved through, whoever types.
    out="$(FULL_GATE_DRY_RUN=1 FULL_GATE_FORCE='suite-green=fail' run "$TMP/H" --allow-blocked 'jonmaxmore: please')"; code=$?
    check H 1 "$out" $code 'suite-green'

    # I — the advisory set is printed with a per-item reason on EVERY run, pass or
    #     fail. Silence about what did not run is how a green tick starts lying.
    #     Asserted on the NOT-RUN *section* ("  - <id> — <reason>"), not on the id
    #     appearing anywhere: the first version of this case passed while all four
    #     were listed under PASS, which is the exact lie being guarded against.
    out="$(FULL_GATE_DRY_RUN=1 run "$TMP/I")"; code=$?
    check I 0 "$out" $code 'NOT-RUN (4' '- money-equation-real' '- drain-complete-real' '- stripe-keys-ready' '- flow-proof-full'

    # J — an acceptance with no name is not an acceptance.
    out="$(FULL_GATE_DRY_RUN=1 FULL_GATE_FORCE='secret-scan-deep=not-run' run "$TMP/J" --allow-blocked '')"; code=$?
    check J 2 "$out" $code 'who'

    # K — money probes pointed at a scratch DB: "0 rows violate" means "0 rows
    #     examined", not "no problem" (reports/accounting-reconciler/2026-08-06.md
    #     §1a). Even when explicitly enabled, zero sampled rows must stay NOT-RUN.
    out="$(FULL_GATE_DRY_RUN=1 FULL_GATE_RUN_MONEY_PROBES=1 FULL_GATE_MONEY_ROWS=0 run "$TMP/K")"; code=$?
    check K 0 "$out" $code '0 rows' 'money-equation-real'

    # L — NO SECRET (Law L2): the password in the connection string must not reach
    #     stdout or the attestation.
    out="$(DATABASE_URL="postgresql://u:$PW@db:5432/gacp_gate_abc123" FULL_GATE_DRY_RUN=1 run "$TMP/L")"; code=$?
    CASES=$((CASES + 1))
    echo "--- selftest L: no password in output or attestation"
    if printf '%s' "$out" | grep -q "$PW" || att_of "$TMP/L" | grep -q "$PW"; then
        echo "*** L FAILED: the DB password leaked into the gate output/attestation"; BAD=$((BAD + 1))
    else
        echo "ok — password absent from both"
    fi
    echo

    # M — the tools this gate runs print connection strings in their own error
    #     messages, so every captured log goes through redact() first. Asserted on
    #     the function itself, because case L can only see the paths we control.
    CASES=$((CASES + 1))
    echo "--- selftest M: redact() strips the password but keeps the database name"
    redacted="$(redact "prisma: P1001 cannot reach postgresql://gateuser:$PW@db:5432/gacp_gate_x")"
    printf '%s\n' "$redacted"
    if printf '%s' "$redacted" | grep -q "$PW"; then
        echo "*** M FAILED: password survived redaction"; BAD=$((BAD + 1))
    elif ! printf '%s' "$redacted" | grep -q 'gacp_gate_x'; then
        echo "*** M FAILED: redaction destroyed the database name — the log must stay useful"; BAD=$((BAD + 1))
    else
        echo "ok"
    fi
    echo

    # M2 — every detail infra_abort prints is captured output from another tool,
    #      and the header of this file promises that captured output is redacted
    #      before it is written anywhere. Asserted on the call sites, because the
    #      one that was missing redact() has no reachable trigger to test through:
    #      it fires only when `cat` fails, and then the variable holds cat's own
    #      error, not the log. A rule with one silent exception is not a rule.
    CASES=$((CASES + 1))
    echo "--- selftest M2: infra_abort details are redacted at every call site"
    if grep -n 'infra_abort' "$0" | grep -E '\$(captured|PG_PREFLIGHT|ATT_ERR)' | grep -v 'redact'; then
        echo "*** M2 FAILED: the call site(s) above hand captured output to infra_abort without redact()"; BAD=$((BAD + 1))
    else
        echo "ok — none"
    fi
    echo

    # ── INFRA FAILURE IS NOT CHECK FAILURE (exit 3). On the first real staging run
    #    evidence/ was root-owned, so every log write got EACCES and the gate
    #    printed `fail` for 14 checks that never executed — plus, in the dry path,
    #    `pass` for checks whose log was never written. "FAIL for something that
    #    never ran" is the same lie as "PASS for something that never ran": the
    #    phantom-guardrail family this gate exists to kill. Infra breakage must
    #    ABORT the whole run with a dedicated exit code, never join the FAIL pile.
    #    N/O/P make the write fail for EVERY uid (a path that cannot be opened for
    #    writing, whatever the permission bits say) because CI containers run as
    #    root, where chmod 500 stops nobody. R is the operator's literal symptom.

    # N — evidence/ cannot even be created: a file sits where the directory must go.
    mkdir -p "$TMP/N"; : >"$TMP/N/evidence"
    out="$(FULL_GATE_DRY_RUN=1 run "$TMP/N")"; code=$?
    check N 3 "$out" $code 'ABORT' 'infra' 'evidence' 'chown'
    CASES=$((CASES + 1))
    if printf '%s' "$out" | grep -q 'verdict:'; then
        echo "*** N2 FAILED: a verdict was printed for a run whose evidence could not be recorded"; BAD=$((BAD + 1))
    else
        echo "--- selftest N2: no verdict is printed when the gate aborts on infra"
    fi
    echo

    # O — the per-check log cannot be written. This is the exact staging line: the
    #     redirect fails, the check never runs, and the old code called that `fail`.
    mkdir -p "$TMP/O/evidence/gate/logs/$SHA/stripe-keys-ready.log"
    out="$(FULL_GATE_DRY_RUN=1 run "$TMP/O")"; code=$?
    check O 3 "$out" $code 'ABORT' 'stripe-keys-ready.log'
    CASES=$((CASES + 1))
    if printf '%s' "$out" | grep -qE 'stripe-keys-ready +(fail|pass)'; then
        echo "*** O2 FAILED: a check whose log could not be written was given a verdict"; BAD=$((BAD + 1))
    else
        echo "--- selftest O2: no pass/fail verdict is attached to a check that could not be logged"
    fi
    CASES=$((CASES + 1))
    # The ABORT block is meant to be the WHOLE message. A bash redirection error
    # printed just above it ("full-gate.sh: line NNN: ...") is the same raw-plumbing
    # leak as the Python traceback in P, so the guarded redirects apply 2>/dev/null
    # BEFORE the failing redirect — bash reports redirection errors in file order.
    if printf '%s' "$out" | grep -q 'full-gate.sh: line'; then
        echo "*** O3 FAILED: a raw shell redirection error leaked next to the ABORT block"; BAD=$((BAD + 1))
    else
        echo "--- selftest O3: the ABORT block is the only error the operator sees"
    fi
    CASES=$((CASES + 1))
    # "any check lines printed above are discarded" has to mean the FILES are gone
    # too. An aborted run used to leave logs reading `status=pass` under
    # evidence/gate/logs/<sha>/ with no attestation beside them — and the runbook's
    # copy-paste block would happily `git add evidence/gate` them, at which point
    # gate-attestation.sh:241 (which excludes ^evidence/gate/ when counting changed
    # files) lets the PREVIOUS commit's attestation still look like it covers HEAD.
    if [ -e "$TMP/O/evidence/gate/logs/$SHA/workspace-clean.log" ] || [ ! -e "$TMP/O/evidence/gate/logs/$SHA/ABORTED.txt" ]; then
        echo "*** O4 FAILED: the aborted run left committable check logs behind, or left no ABORTED marker"; BAD=$((BAD + 1))
    else
        echo "--- selftest O4: the aborted run removed its own logs and left an ABORTED marker in their place"
    fi
    echo

    # P — the attestation cannot be written. A raw Python traceback is not an error
    #     message, and exit 0 with no attestation on disk is a gate that lies.
    mkdir -p "$TMP/P/evidence/gate/$SHA.json"
    out="$(FULL_GATE_DRY_RUN=1 run "$TMP/P")"; code=$?
    check P 3 "$out" $code 'ABORT' 'attestation'
    CASES=$((CASES + 1))
    if printf '%s' "$out" | grep -q 'Traceback'; then
        echo "*** P2 FAILED: raw Python traceback reached the operator"; BAD=$((BAD + 1))
    else
        echo "--- selftest P2: no raw traceback in the output"
    fi
    echo

    # Q — PREFLIGHT, before anything is touched: a missing tool is named, and the
    #     abort is printed with shell builtins only, so it survives a bare PATH.
    mkdir -p "$TMP/Q" "$TMP/tinybin"
    ln -sf "$(command -v dirname)" "$TMP/tinybin/dirname"
    out="$(PATH="$TMP/tinybin" FULL_GATE_OUT_ROOT="$TMP/Q" FULL_GATE_DRY_RUN=1 "$BASH" "$0" 2>&1)"; code=$?
    # 'mkdir' is named on purpose: preflight 2 calls it, so a machine without it
    # got the chown advice for a problem chown cannot fix.
    check Q 3 "$out" $code 'ABORT' 'git' 'PATH' 'mkdir'

    # R — the operator's literal symptom: the directory exists and is mode 500.
    #     Permission bits do not apply to uid 0, so under root this case can assert
    #     nothing; it is then NOT-RUN with the reason printed, never rounded up to a
    #     pass (same three-bucket contract as the gate itself). N/O/P cover the same
    #     code path for every uid.
    mkdir -p "$TMP/R/evidence/gate"; chmod 500 "$TMP/R/evidence/gate"
    if : >"$TMP/R/evidence/gate/.writeprobe" 2>/dev/null; then
        rm -f "$TMP/R/evidence/gate/.writeprobe"; chmod 700 "$TMP/R/evidence/gate"
        NOTRUN=$((NOTRUN + 1))
        echo "--- selftest R: NOT-RUN — uid $(id -u) writes straight through mode 500, so this case would assert nothing here. Re-run the selftest as a non-root user to exercise it; N/O/P cover the same path meanwhile."
    else
        out="$(FULL_GATE_DRY_RUN=1 run "$TMP/R")"; code=$?
        chmod 700 "$TMP/R/evidence/gate"
        check R 3 "$out" $code 'ABORT' 'chown'
    fi
    echo

    # S — the ONLY non-dry case, and it is safe by construction: 127.0.0.1 port 1
    #     can never be a Postgres server, so this run can only ever abort in
    #     preflight — it can never reach `git worktree add`, `createdb` or pnpm.
    #     That is exactly the property under test: without a preflight the gate
    #     built a checkout and a scratch database first and discovered the dead
    #     connection afterwards. On a machine that is also missing psql/pnpm/node
    #     it aborts one preflight earlier, which is the same claim: exit 3, before
    #     anything was touched. Asserted on that claim, not on the wording.
    out="$(GATE_PG_ADMIN_URL='postgresql://gate@127.0.0.1:1/postgres' run "$TMP/S")"; code=$?
    check S 3 "$out" $code 'ABORT' 'infra'
    CASES=$((CASES + 1))
    # The `[ -d $LOG_DIR ]` this case used to lead with was TRUE on every green
    # path — preflight 2 creates that directory before preflight 3 can abort — so
    # the assertion could not fail and still printed "nothing was built" while a
    # worktree had in fact been checked out. That is a green-mask assertion, the
    # exact thing scripts/ci/check-green-mask-assertions.js exists to catch, and
    # it was shipped inside the gate. Asserted now on the two things the gate
    # actually announces when it starts building something.
    if printf '%s' "$out" | grep -qE 'creating a clean checkout|Preparing worktree|scratch database .* created'; then
        echo "*** S2 FAILED: the gate built a checkout or a scratch database before proving it could reach Postgres"; BAD=$((BAD + 1))
    else
        echo "--- selftest S2: nothing was built before the preflight verdict"
    fi
    echo

    # T — EVERY psql call has to be redacted, not just the one in preflight 3.
    #     create_scratch_db sent stderr straight to the terminal, and the gate is
    #     run under `tee` on the staging host, so an error there could put an admin
    #     password on disk (Law L2). Modern libpq happens not to echo the password
    #     on the paths tested against Postgres 16.13 — which is exactly why this
    #     case does not assert "the password is absent" against a real server: that
    #     would pin libpq's behaviour, not the gate's. It asserts the MECHANISM
    #     instead — a psql that DOES quote the connection string, as psql is free
    #     to do, must reach the operator only after redact(). The stand-in psql
    #     reads the connection string from the environment the gate itself exports,
    #     so nothing about the leak is hand-written into the fixture.
    mkdir -p "$TMP/T-bin"
    cat >"$TMP/T-bin/psql" <<'SH'
#!/bin/sh
case "$*" in
  *"CREATE DATABASE"*)
    echo "psql: error: FATAL: permission denied to create database" >&2
    echo "psql: detail: connection string was $GATE_PG_ADMIN_URL" >&2
    exit 1 ;;
esac
echo 1
SH
    chmod +x "$TMP/T-bin/psql"
    # Presence-only stand-ins: preflight 1 demands them on a non-dry run, and the
    # run exits at create_scratch_db long before either could be invoked.
    for t in pnpm node; do printf '#!/bin/sh\nexit 0\n' >"$TMP/T-bin/$t"; chmod +x "$TMP/T-bin/$t"; done
    out="$(PATH="$TMP/T-bin:$PATH" GATE_PG_ADMIN_URL="postgresql://gateuser:$PW@db:5432/postgres" run "$TMP/T")"; code=$?
    check T 2 "$out" $code 'could not create scratch database'
    CASES=$((CASES + 1))
    if printf '%s' "$out" | grep -q "$PW"; then
        echo "*** T2 FAILED: psql's stderr reached the operator with the password still in it"; BAD=$((BAD + 1))
    else
        echo "--- selftest T2: the failing CREATE DATABASE was redacted before it was printed"
    fi
    CASES=$((CASES + 1))
    if printf '%s' "$out" | grep -q 'gateuser:\*\*\*@db:5432'; then
        echo "--- selftest T3: redaction kept the user, host and port — the error is still diagnosable"
    else
        echo "*** T3 FAILED: the psql error was destroyed or dropped instead of redacted"; BAD=$((BAD + 1))
    fi
    echo

    # ── U/V/W: THE EVIDENCE HAS TO OUTLIVE THE RUN AND DESCRIBE ONE RUN ──────
    # From the first full staging run: suite-green (REQUIRED) went red pointing at
    # "log: $WORK/evidence/suite-green.log" — inside the throwaway worktree that
    # cleanup() deletes on exit, so the one check an operator needed to read was
    # the one check that could not be read. And because the real path appended to
    # the check log, an interrupted run and the next run ended up in one file.
    # These cases drive the REAL non-dry code path using stand-in binaries and a
    # one-row check list via GATE_CHECKS_FILE — an override the script already
    # supports — so no database, no install and no jest run is involved.
    mkdir -p "$TMP/UV-bin"
    cat >"$TMP/UV-bin/psql" <<'SH'
#!/bin/sh
case "$*" in *--version*) echo "psql (PostgreSQL) 0.0-standin"; exit 0 ;; esac
echo 1
exit 0
SH
    cat >"$TMP/UV-bin/node" <<'SH'
#!/bin/sh
case "${1:-}" in -v|--version) echo "v0.0.0-standin"; exit 0 ;; esac
# Stands in for `node scripts/ci/probe-gate.js`: writes its detailed result where
# PROBE_OUT_DIR points, exactly as the real probe-gate.js does.
[ -n "${PROBE_OUT_DIR:-}" ] || { echo "stand-in node: PROBE_OUT_DIR was not set" >&2; exit 1; }
mkdir -p "$PROBE_OUT_DIR" || exit 1
printf '{"probe":"stand-in","status":"PASS"}\n' >"$PROBE_OUT_DIR/probe-results.json"
echo "STANDIN-PROBE-GATE-MARKER"
# The sentinel is written from inside the check, i.e. after the run has taken the
# lock — so another run can wait on a condition instead of racing a sleep.
[ -n "${STANDIN_SENTINEL:-}" ] && : >"$STANDIN_SENTINEL"
[ -n "${STANDIN_SLEEP:-}" ] && sleep "$STANDIN_SLEEP"
if [ -n "${STANDIN_PGID_FILE:-}" ] && [ -f "$STANDIN_PGID_FILE" ]; then
    # The whole process group, which is what Ctrl-C sends. Signalling the gate
    # alone is NOT equivalent: bash discards a SIGINT it took while waiting on a
    # foreground child that did not itself die from it, and the run continues.
    kill -INT -"$(cat "$STANDIN_PGID_FILE")"
    sleep 2
fi
exit 0
SH
    printf '%s\n' '#!/bin/sh' 'case "${1:-}" in -v|--version) echo "0.0.0-standin"; exit 0;; esac' 'exit 0' >"$TMP/UV-bin/pnpm"
    chmod +x "$TMP/UV-bin/psql" "$TMP/UV-bin/node" "$TMP/UV-bin/pnpm"
    printf 'check | probe-ci | required | one-row check list for the selftest\n' >"$TMP/UV-checks.txt"
    UV_ART="$TMP/U/evidence/gate/logs/$SHA/artifacts/probe-results.json"
    UV_LOG="$TMP/U/evidence/gate/logs/$SHA/probe-ci.log"

    # U — the artifact a check produces must still be there after cleanup ran.
    out="$(PATH="$TMP/UV-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
           GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$TMP/U")"; code=$?
    check U 0 "$out" $code 'probe-ci'
    CASES=$((CASES + 1))
    if [ -f "$UV_ART" ]; then
        echo "--- selftest U2: the check's detailed artifact outlived the worktree, under evidence/gate/logs/<sha>/"
    else
        echo "*** U2 FAILED: the detailed output died with the worktree — a red REQUIRED check would point at a path that no longer exists"; BAD=$((BAD + 1))
    fi
    # U3 — the whole class, not just the check that happened to be caught. Any
    #      destination inside $WORK is deleted by cleanup() by construction.
    CASES=$((CASES + 1))
    if grep -nE 'PROBE_OUT_DIR="\$WORK|outputFile="\$WORK|"\$WORK/(evidence|integration)' "$0" | grep -v '^[0-9]*:[[:space:]]*#'; then
        echo "*** U3 FAILED: a check still writes detailed output inside the worktree cleanup() deletes"; BAD=$((BAD + 1))
    else
        echo "--- selftest U3: no check writes its detailed output into the disposable worktree"
    fi
    echo

    # V — SECOND run of the same sha, same output root: one artifact must describe
    #     ONE run. The real path used >> with no truncation, so run 2 was appended
    #     to run 1 and the reader could not tell them apart.
    out="$(PATH="$TMP/UV-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
           GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$TMP/U")"; code=$?
    check V 0 "$out" $code 'probe-ci'
    CASES=$((CASES + 1))
    # Counted with -o, not -c: the redact rewrite dropped the trailing newline, so
    # run 2 was appended to run 1's last line and `grep -c` (which counts LINES)
    # reported "1" for a file that held two runs. That is how this bug hid.
    marks="$(grep -o 'STANDIN-PROBE-GATE-MARKER' "$UV_LOG" 2>/dev/null | grep -c .)"
    if [ "$marks" = "1" ]; then
        echo "--- selftest V2: after two runs of the same sha the check log still describes one run"
    else
        echo "*** V2 FAILED: probe-ci.log holds $marks run(s) — two runs were appended into a single artifact"; BAD=$((BAD + 1))
    fi
    CASES=$((CASES + 1))
    if [ -s "$UV_LOG" ] && [ -z "$(tail -c 1 "$UV_LOG")" ]; then
        echo "--- selftest V3: the check log ends with a newline, so the next thing written cannot land on its last line"
    else
        echo "*** V3 FAILED: the check log has no trailing newline — anything appended merges into its last line"; BAD=$((BAD + 1))
    fi
    echo

    # W — the interrupted run the operator actually hit: cleanup() ran while the
    #     check's redirect was still in effect, so "dropping scratch database"
    #     landed INSIDE the check's log. The stand-in interrupts the gate itself,
    #     so this is deterministic rather than a race with a sleep.
    # X — PREFLIGHT 2 ITSELF. Reducing assert_writable_dir() to a bare `mkdir -p`
    #     left every other assertion green, because a directory that already
    #     exists passes mkdir and only a real write tells a usable directory from
    #     a read-only one. Case R cannot cover it: with the probe gone, R aborts
    #     one directory later at `mkdir -p "$LOG_DIR"` and still exits 3. The
    #     probe file has a FIXED name so a test can block it — a name nobody can
    #     predict is a name no test can block. Run non-dry, because preflight 2's
    #     other job is to decide BEFORE a worktree or a database exists, and every
    #     other infra case is a dry run that could never have shown that.
    mkdir -p "$TMP/X/evidence/gate/.gate-write-probe"
    out="$(PATH="$TMP/UV-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
           GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$TMP/X")"; code=$?
    check X 3 "$out" $code 'ABORT' 'evidence' 'chown'
    CASES=$((CASES + 1))
    if printf '%s' "$out" | grep -qE 'creating a clean checkout|Preparing worktree|scratch database .* created'; then
        echo "*** X2 FAILED: the gate built a checkout or a database before preflight 2 had decided"; BAD=$((BAD + 1))
    else
        echo "--- selftest X2: nothing was built before the evidence tree was proved writable"
    fi
    echo

    # Y — the throwaway checkout's parent directory is created with mktemp -d, and
    #     an unchecked mktemp left WORK_PARENT empty, WORK="/tree" and the failure
    #     surfacing as "could not create a clean checkout" (exit 2) — a machine
    #     problem reported as a repository problem. The stand-in fails only
    #     `mktemp -d`, so the plain mktemp the result file needs still works.
    mkdir -p "$TMP/Y-bin"
    cp "$TMP/UV-bin/psql" "$TMP/UV-bin/node" "$TMP/UV-bin/pnpm" "$TMP/Y-bin/"
    printf '%s\n' '#!/bin/sh' 'for a in "$@"; do [ "$a" = "-d" ] && exit 1; done' \
        "exec $(command -v mktemp) \"\$@\"" >"$TMP/Y-bin/mktemp"
    chmod +x "$TMP/Y-bin/mktemp"
    out="$(PATH="$TMP/Y-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
           GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$TMP/Y")"; code=$?
    check Y 3 "$out" $code 'ABORT' 'temporary'
    echo

    # ── AA/AB: A FAILING redact() MUST STOP THE RUN, NOT EMPTY THE EVIDENCE ──
    # Regression introduced on this branch and caught by review: wrapping redact
    # in "$(...)" to add a trailing newline threw its exit status away, because
    # bash discards the status of a command substitution — `printf "%s" "$(false)"`
    # exits 0. A failing redact then produced an EMPTY check log and the run went
    # on to write `verdict: PASS`. Destroying the evidence and attesting to it is
    # the precise failure class this whole file exists to prevent.
    # The stand-in fails only on the -E form redact() uses, and only for ONE
    # payload, so preflight 1 (which only asks whether sed exists) and the
    # check-list parser still work. Per-payload matters: a sed that fails for
    # everything lets either guard abort the run, so each mutant stayed green
    # while the other guard caught it. One payload per case isolates one guard.
    mk_sed_standin() { # $1 = bin dir, $2 = payload that must fail
        mkdir -p "$1"
        cp "$TMP/UV-bin/psql" "$TMP/UV-bin/node" "$TMP/UV-bin/pnpm" "$1/"
        printf '%s\n' '#!/bin/sh' \
            '# -E is redact()'"'"'s signature; anything else goes straight through, so' \
            '# this never reads stdin for a sed that was given a file to read.' \
            'has_E=no; for a in "$@"; do [ "$a" = "-E" ] && has_E=yes; done' \
            '[ "$has_E" = no ] && exec REALSED "$@"' \
            'payload="$(cat)"' \
            'case "$payload" in' \
            '  *MARKER*) echo "sed: -E failed on this input (test stand-in)" >&2; exit 1 ;;' \
            'esac' \
            'printf "%s" "$payload" | REALSED "$@"' \
            | sed -e "s|REALSED|$(command -v sed)|g" -e "s|MARKER|$2|g" >"$1/sed"
        chmod +x "$1/sed"
    }
    # AA's payload is the check LOG's content; AB's is a NOT-RUN REASON's text.
    mk_sed_standin "$TMP/AA-bin" 'STANDIN-PROBE-GATE-MARKER'
    mk_sed_standin "$TMP/AB-bin" 'STRIPE_SECRET_KEY'

    # AA — the check-log path (non-dry, so a check really runs and is redacted).
    out="$(PATH="$TMP/AA-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
           GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$TMP/AA")"; code=$?
    check AA 3 "$out" $code 'ABORT'
    CASES=$((CASES + 1))
    if [ -e "$TMP/AA/evidence/gate/$SHA.json" ]; then
        echo "*** AA2 FAILED: an attestation was written for a run whose logs could not be redacted"; BAD=$((BAD + 1))
    else
        echo "--- selftest AA2: no attestation was written when redaction failed"
    fi
    echo

    # AB — the reason path. `REASON="$(redact "$REASON")"` had no guard at all, so
    #      a failing redact silently emptied it and all four NOT-RUN entries
    #      printed "no reason recorded" — breaking the three-bucket contract this
    #      file states in its own header (every NOT-RUN prints its reason).
    #      A plain assignment DOES keep the substitution's status, unlike printf.
    out="$(PATH="$TMP/AB-bin:$PATH" FULL_GATE_DRY_RUN=1 run "$TMP/AB")"; code=$?
    check AB 3 "$out" $code 'ABORT'
    CASES=$((CASES + 1))
    if printf '%s' "$out" | grep -q 'no reason recorded'; then
        echo "*** AB2 FAILED: a NOT-RUN entry lost its reason instead of stopping the run"; BAD=$((BAD + 1))
    else
        echo "--- selftest AB2: no NOT-RUN entry was printed with its reason silently emptied"
    fi
    echo

    # ── AC/AD: ONE RUN AT A TIME PER (evidence root, sha) ───────────────────
    # Two concurrent runs on the same sha erased each other's logs and both
    # reported PASS. Worth noting against my own work: case V2 ("the log still
    # describes one run") PASSES on that broken result — a correct assertion that
    # was not a sufficient one.
    mkdir -p "$TMP/AC"
    ( PATH="$TMP/UV-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
      GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' \
      STANDIN_SENTINEL="$TMP/AC-started" STANDIN_SLEEP=6 \
      FULL_GATE_OUT_ROOT="$TMP/AC" bash "$0" ) >"$TMP/AC-a.out" 2>&1 &
    ac_pid=$!
    for _ in $(seq 1 900); do
        [ -e "$TMP/AC-started" ] && break
        kill -0 "$ac_pid" 2>/dev/null || break   # it died; stop waiting for a sentinel that will never come
        sleep 0.1
    done
    out="$(PATH="$TMP/UV-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
           GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$TMP/AC")"; code=$?
    check AC 2 "$out" $code 'REFUSED' 'already gating'
    wait "$ac_pid"; ac_code=$?
    CASES=$((CASES + 1))
    if [ "$ac_code" = "0" ] && grep -q 'STANDIN-PROBE-GATE-MARKER' "$TMP/AC/evidence/gate/logs/$SHA/probe-ci.log" 2>/dev/null; then
        echo "--- selftest AC2: the run holding the lock finished with its evidence intact"
    else
        echo "*** AC2 FAILED: the holding run exited $ac_code and/or its log was taken by the second run"; BAD=$((BAD + 1))
    fi
    echo

    # AD — a lock left behind by a killed run must not wedge the gate for good.
    #      A lock needing manual cleanup on the machine an operator is using is a
    #      worse failure than the one the lock prevents.
    mkdir -p "$TMP/AD/evidence/gate/logs/$SHA/.lock"
    ( exit 0 ) & dead_pid=$!; wait "$dead_pid" 2>/dev/null
    echo "$dead_pid" >"$TMP/AD/evidence/gate/logs/$SHA/.lock/pid"
    out="$(PATH="$TMP/UV-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
           GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$TMP/AD")"; code=$?
    check AD 0 "$out" $code 'taking over a lock'
    echo

    # ── AE/AF/AG: GITLEAKS' EXIT CODE IS A THREE-VALUED ANSWER, NOT A BOOLEAN ──
    # From the first real run of secret-scan-deep on staging. The check was written
    # as `(gitleaks detect ...) || { REASON="gitleaks found leaks"; return 1; }`,
    # which maps EVERY non-zero exit onto "this commit contains a secret". gitleaks
    # documents three answers — 0 clean, 1 leaks found, anything else = the tool
    # itself could not run — so a bad config, an unreadable repo or a crash all
    # arrived dressed as a verdict about the commit. That is the same
    # infra-wearing-a-verdict lie as N/O/P, in the one check whose whole job is to
    # be believed. Driven with a stand-in gitleaks: all three answers become
    # deterministic and no 40-second history scan is involved.
    mkdir -p "$TMP/GL-bin"
    cat >"$TMP/GL-bin/gitleaks" <<'SH'
#!/bin/sh
case "${1:-}" in version|--version) echo "8.0.0-standin"; exit 0 ;; esac
# Mimics the real contract: the report is written only when the scan itself ran.
# Its entries carry fingerprints (commit:file:rule:line) and no secret material,
# so this stand-in cannot trip the real scan of this repository (Law L2).
prev=""; report=""
for a in "$@"; do [ "$prev" = "--report-path" ] && report="$a"; prev="$a"; done
echo "stand-in gitleaks: exiting ${STANDIN_GITLEAKS_EXIT:-0}"
case "${STANDIN_GITLEAKS_EXIT:-0}" in
    0) [ -n "$report" ] && printf '[]\n' >"$report" ;;
    1) [ -n "$report" ] && printf '%s\n' \
         '[{"RuleID":"generic-api-key","File":"fixture/one.txt","StartLine":1,"Secret":"REDACTED","Fingerprint":"standincommitone:fixture/one.txt:generic-api-key:1"},' \
         ' {"RuleID":"jwt","File":"fixture/two.txt","StartLine":2,"Secret":"REDACTED","Fingerprint":"standincommittwo:fixture/two.txt:jwt:2"}]' >"$report" ;;
    *) echo "stand-in gitleaks: pretending the tool itself could not run" >&2 ;;
esac
exit "${STANDIN_GITLEAKS_EXIT:-0}"
SH
    chmod +x "$TMP/GL-bin/gitleaks"
    printf 'check | secret-scan-deep | required | one-row check list for AE/AF/AG\n' >"$TMP/GL-checks.txt"
    gl_run() { # $1 outdir  $2 exit code the stand-in gitleaks should return
        STANDIN_GITLEAKS_EXIT="$2" PATH="$TMP/GL-bin:$TMP/UV-bin:$PATH" \
        GATE_CHECKS_FILE="$TMP/GL-checks.txt" \
        GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' run "$1"
    }
    GL_REPORT_REL="evidence/gate/logs/$SHA/artifacts/gitleaks-report.json"

    # AE — NEGATIVE CONTROL: a clean scan must still pass. Without it, AG could be
    #      satisfied by a check that never passes anything.
    out="$(gl_run "$TMP/AE" 0)"; code=$?
    check AE 0 "$out" $code 'secret-scan-deep' 'PASS    (1)' 'FAIL    (0)'

    # AF — exit 1 is the ONLY answer that means "this commit contains a secret",
    #      and the reason has to carry the COUNT. "gitleaks found leaks" gave the
    #      operator nothing to act on and nothing to compare with the last run.
    out="$(gl_run "$TMP/AF" 1)"; code=$?
    check AF 1 "$out" $code 'secret-scan-deep' 'FAIL    (1)' '2 finding'

    # AG — THE BUG ITSELF. exit 3 is gitleaks saying it could not do its job.
    #      A broken tool is NOT-RUN — still fail-closed (exit 1 for a REQUIRED
    #      check), but never `fail`, because `fail` is a claim about the commit
    #      and nothing whatsoever was learned about the commit here.
    #      The reason must name the exit code: "the tool broke" with no number is
    #      not something an operator can look up or reproduce.
    out="$(gl_run "$TMP/AG" 3)"; code=$?
    check AG 1 "$out" $code 'secret-scan-deep' 'NOT-RUN (1' 'FAIL    (0)' 'exited 3'

    # AF2 — "see log" has to have something to see. The staging run left three
    #       summary lines saying a number, so the operator could neither rotate a
    #       key nor classify a fixture without re-running the scan by hand.
    CASES=$((CASES + 1))
    if [ -s "$TMP/AF/$GL_REPORT_REL" ]; then
        echo "--- selftest AF2: the failing scan left a machine-readable report beside its log"
    else
        echo "*** AF2 FAILED: no gitleaks report at $GL_REPORT_REL — 'see log' points at a summary line and nothing else"; BAD=$((BAD + 1))
    fi
    echo

    CASES=$((CASES + 1))
    if ! command -v setsid >/dev/null 2>&1; then
        NOTRUN=$((NOTRUN + 1))
        echo "--- selftest W: NOT-RUN — setsid is absent, so the gate cannot be put in its own process group and a real Ctrl-C cannot be delivered without also signalling this selftest."
    else
        mkdir -p "$TMP/W"
        (   export PATH="$TMP/UV-bin:$PATH" GATE_CHECKS_FILE="$TMP/UV-checks.txt" \
                   GATE_PG_ADMIN_URL='postgresql://gate@standin:5432/postgres' \
                   STANDIN_PGID_FILE="$TMP/W-pgid" FULL_GATE_OUT_ROOT="$TMP/W"
            setsid bash -c 'echo $$ >"$STANDIN_PGID_FILE"; exec bash "$0"' "$0"
        ) >"$TMP/W.out" 2>&1
        code=$?
        echo "--- selftest W → exit $code (interrupted mid-check on purpose; 130 = the SIGINT really landed)"
        if [ "$code" != "130" ]; then
            echo "*** W FAILED: the run was not interrupted (exit $code), so this case proved nothing"; BAD=$((BAD + 1))
        elif grep -q 'dropping scratch database' "$TMP/W/evidence/gate/logs/$SHA/probe-ci.log" 2>/dev/null; then
            echo "*** W FAILED: cleanup() wrote into the check's log — one artifact now describes the run AND its teardown"; BAD=$((BAD + 1))
        else
            echo "--- selftest W: the interrupted run's teardown output stayed out of the check log"
        fi
    fi
    echo

    echo "=================================================="
    SKIPPED=""; [ "$NOTRUN" -gt 0 ] && SKIPPED=" · $NOTRUN NOT-RUN (reason printed above)"
    [ "$BAD" -eq 0 ] && { echo "full-gate --selftest: $CASES/$CASES cases PASS$SKIPPED"; exit 0; }
    echo "full-gate --selftest: $BAD assertion(s) FAILED"; exit 1
fi

# ── arguments ────────────────────────────────────────────────────────────────
SHA_ARG=""; ALLOW_SET=0; ALLOW_RAW=""
while [ $# -gt 0 ]; do
    case "$1" in
        --allow-blocked) ALLOW_SET=1; ALLOW_RAW="${2-}"; shift 2 || shift ;;
        --help|-h) sed -n '1,54p' "$0"; exit 0 ;;
        -*) echo "full-gate: unknown option '$1'"; exit 2 ;;
        *)  SHA_ARG="$1"; shift ;;
    esac
done

ACCEPTED_BY=""; ACCEPTED_WHY=""
if [ "$ALLOW_SET" = "1" ]; then
    ACCEPTED_BY="$(printf '%s' "$ALLOW_RAW" | cut -d: -f1 | sed 's/^ *//; s/ *$//')"
    ACCEPTED_WHY="$(printf '%s' "$ALLOW_RAW" | cut -s -d: -f2- | sed 's/^ *//; s/ *$//')"
    [ -n "$ACCEPTED_BY" ] || { echo "full-gate: --allow-blocked needs to say WHO is accepting and why: --allow-blocked \"<who>: <why>\". An unsigned acceptance is not an acceptance."; exit 2; }
fi

DRY="${FULL_GATE_DRY_RUN:-0}"

# ── INFRA FAILURE IS NOT CHECK FAILURE (exit 3) ──────────────────────────────
# Exit 3 means "this machine could not run the gate": no log could be written, a
# tool is missing, the admin connection is dead, the attestation could not be
# saved. None of that is evidence about the commit. On the first real staging run
# evidence/ was root-owned, every log write got EACCES, and the gate reported
# `fail` for 14 checks that had never executed — a FAIL for something that never
# ran is the same lie as a PASS for something that never ran, which is the whole
# family this gate exists to kill. So infra breakage aborts the run, never joins
# the FAIL pile and never writes an attestation. Pinned by --selftest N/O/P/Q/R.
# Printed with shell builtins only: it must survive a PATH with nothing on it.
EXIT_INFRA=3
TOUCHED_LOGS=()
infra_abort() { # $1 = what broke · $2 = copy-pasteable fix · $3 = captured detail
    # "Discarded" has to mean the FILES are gone, not just that a sentence said
    # so. An aborted run used to leave logs reading `status=pass` next to no
    # attestation; `git add evidence/gate` would then commit them, and because
    # gate-attestation.sh excludes ^evidence/gate/ when counting changed files,
    # the previous commit's attestation kept looking like it covered the new HEAD.
    local f
    for f in "${TOUCHED_LOGS[@]:-}"; do [ -n "$f" ] && rm -f "$f" 2>/dev/null; done
    [ -n "${RES_TSV:-}" ] && rm -f "$RES_TSV" 2>/dev/null
    if [ -n "${LOG_DIR:-}" ] && [ -d "${LOG_DIR:-}" ]; then
        { printf 'ABORTED — infra failure, no check result from this run is valid.\n'
          printf 'what broke: %s\n' "$1"
          printf 'The logs this run had written were deleted: a log with no attestation\n'
          printf 'beside it must never be mistaken for evidence about this commit.\n'
        } >"$LOG_DIR/ABORTED.txt" 2>/dev/null
    fi
    printf '\n'
    printf 'full-gate: ABORT — infra failure, the gate could not run (exit %s).\n' "$EXIT_INFRA"
    printf '  what broke : %s\n' "$1"
    [ -n "${3:-}" ] && printf '  detail     : %s\n' "$3"
    printf '  fix        : %s\n' "$2"
    printf 'Nothing was proved about %s. No attestation was written; this run'"'"'s check logs\n' "${FULL_SHA:-this commit}"
    printf 'were deleted and an ABORTED marker left in their place — infra failure is not\n'
    printf 'a check failure, and half a run is not evidence.\n'
    exit "$EXIT_INFRA"
}

# ── preflight 1/3: tools, before anything at all is touched ──────────────────
# Every external command the run will need, checked with a builtin so the report
# is a named tool rather than "grep: command not found" three screens later. A
# dry run installs nothing, creates no database and starts no browser, so it is
# only held to the tools the dry path itself uses.
GATE_TOOLS_MISSING=""
for t in dirname git python3 sed grep mkdir mktemp cat mv rm tr cut head hostname; do
    command -v "$t" >/dev/null 2>&1 || GATE_TOOLS_MISSING="$GATE_TOOLS_MISSING $t"
done
if [ "$DRY" != "1" ]; then
    for t in psql pnpm node; do
        command -v "$t" >/dev/null 2>&1 || GATE_TOOLS_MISSING="$GATE_TOOLS_MISSING $t"
    done
fi
[ -z "$GATE_TOOLS_MISSING" ] || infra_abort \
    "required tool(s) not on PATH:$GATE_TOOLS_MISSING" \
    "install them on this machine (docs/operations/runbooks/full-gate-on-staging.md §requirements), then re-run"

# ── the check list (SSOT) ────────────────────────────────────────────────────
[ -r "$CHECKS_FILE" ] || { echo "full-gate: cannot read $CHECKS_FILE — refusing to invent the check list"; exit 2; }
declare -a CHECK_IDS=()
declare -A CHECK_FLAG=() CHECK_NOTE=()
while IFS='|' read -r kind value flag note; do
    kind="$(printf '%s' "$kind" | tr -d '[:space:]')"
    [ "$kind" = "check" ] || continue
    value="$(printf '%s' "$value" | tr -d '[:space:]')"
    flag="$(printf '%s' "$flag" | tr -d '[:space:]')"
    note="$(printf '%s' "$note" | sed 's/^ *//; s/ *$//')"
    CHECK_IDS+=("$value"); CHECK_FLAG["$value"]="$flag"; CHECK_NOTE["$value"]="$note"
done < <(grep -vE '^[[:space:]]*#' "$CHECKS_FILE")
[ "${#CHECK_IDS[@]}" -gt 0 ] || { echo "full-gate: no check rows in $CHECKS_FILE"; exit 2; }

# ── Law L3 guard: allowlist, checked before anything can touch a database ─────
db_name_of() { # postgres://u:p@h:5432/NAME?params → NAME
    local u="${1%%\?*}"; printf '%s' "${u##*/}"
}
assert_scratch_db() { # $1 = database name  $2 = where it came from
    case "$1" in
        gacp_db|gacp_staging)
            echo "full-gate: ABORT — $2 points at '$1'. Law L3: an agent-run gate never touches the real database. Unset it or point it at a gacp_gate_* scratch DB."
            exit 2 ;;
    esac
    if ! printf '%s' "$1" | grep -qE '^gacp_gate_[0-9a-z_]+$'; then
        echo "full-gate: ABORT — $2 names database '$1', which is not in the allowlist ^gacp_gate_[0-9a-z_]+$. An allowlist is used on purpose: a denylist misses the name nobody thought of, and the blast radius here is production money (Law L3)."
        exit 2
    fi
}
if [ -n "${DATABASE_URL:-}" ]; then
    assert_scratch_db "$(db_name_of "$DATABASE_URL")" "the inherited DATABASE_URL"
fi

# ── what are we gating ───────────────────────────────────────────────────────
FULL_SHA="$(git -C "$SRC_ROOT" rev-parse --verify "${SHA_ARG:-HEAD}" 2>/dev/null)"
[ -n "$FULL_SHA" ] || { echo "full-gate: cannot resolve '${SHA_ARG:-HEAD}' in $SRC_ROOT"; exit 2; }
SHORT_SHA="$(git -C "$SRC_ROOT" rev-parse --short=12 "$FULL_SHA")"
SCRATCH_DB="gacp_gate_${SHORT_SHA}"
assert_scratch_db "$SCRATCH_DB" "the computed scratch database name"

LOG_REL="evidence/gate/logs/$FULL_SHA"
LOG_DIR="$OUT_ROOT/$LOG_REL"
ATT_FILE="$OUT_ROOT/evidence/gate/$FULL_SHA.json"
# Detailed artifacts (probe JSON, jest reports) used to be written inside the
# throwaway worktree, which cleanup() deletes on exit. The first full staging run
# put suite-green — a REQUIRED check — in the FAIL pile pointing at a
# suite-green.log inside that worktree: a path that no longer existed by the time
# the operator read the verdict, so the one check that had to be diagnosed was
# the one check that could not be. They are written straight into the durable log
# directory instead of being copied out at the end, because a copy step is one
# interrupted run away from losing the evidence all over again.
ARTIFACT_DIR="$LOG_DIR/artifacts"
INTEGRATION_JSON="$ARTIFACT_DIR/integration.json"

# ── preflight 2/3: the evidence tree must be creatable AND actually writable ──
# `[ -w ]` is not enough. A directory can satisfy the permission bits and still
# refuse a write (read-only mount, root-squashed NFS, immutable flag), so the
# only honest test is to write a real file and delete it again. Done here,
# before the worktree and the scratch database exist, because the failure this
# guards against cost a whole staging run: the gate built everything and only
# then discovered it had nowhere to record what it saw.
CHOWN_HINT="give this user its evidence tree back:  sudo chown -R \"\$(id -un)\":\"\$(id -gn)\" \"$OUT_ROOT/evidence\"   then re-run"
assert_writable_dir() { # $1 = directory that must exist and accept a write
    mkdir -p "$1" 2>/dev/null || infra_abort "cannot create the evidence directory $1" "$CHOWN_HINT"
    # Fixed name, deliberately: --selftest X blocks this exact path to prove the
    # write actually happens, and a name containing $$ is a name no test can
    # block. Concurrent runs are safe — the probe is created then removed, and
    # `rm -f` on a file another run already removed still succeeds.
    local probe="$1/.gate-write-probe"
    : 2>/dev/null >"$probe" || infra_abort "cannot write inside the evidence directory $1" "$CHOWN_HINT"
    rm -f "$probe" 2>/dev/null || infra_abort "cannot delete $probe — the evidence directory is not fully usable" "$CHOWN_HINT"
}
assert_writable_dir "$OUT_ROOT/evidence/gate"
assert_writable_dir "$LOG_DIR"
assert_writable_dir "$ARTIFACT_DIR"

WORK=""; WORK_PARENT=""; SCRATCH_URL=""; ADMIN_URL="${GATE_PG_ADMIN_URL:-}"; DB_CREATED=0
LOCK_DIR="$LOG_DIR/.lock"; LOCK_HELD=0
# A private duplicate of the gate's real stdout. cleanup() runs from the EXIT
# trap, which on Ctrl-C fires while a check's log redirect is still in effect —
# that is how "[full-gate] dropping scratch database" ended up as the first line
# of a check's log on the staging host, describing the PREVIOUS run. Teardown
# talks to the operator, never into a check's evidence file.
#
# KNOWN, ACCEPTED: this fd is inherited by every child (pnpm, prisma, jest,
# gitleaks, the flow-proof browser); bash offers no way to mark it close-on-exec.
# Closing it per check — `"$fn" ... {GATE_STDOUT}>&-` — would also close it for
# the EXIT trap firing INSIDE that check, which is precisely the interrupted case
# this fd exists to serve, so the teardown notice would be lost exactly when it
# matters. It is an output fd onto the operator's own terminal, so the leak costs
# hygiene rather than secrecy, and no child writes to an inherited high fd by
# accident. Kept, deliberately, rather than trading a real behaviour for a tidier
# fd table.
exec {GATE_STDOUT}>&1
cleanup() {
    [ "$DB_CREATED" = "1" ] && { echo "[full-gate] dropping scratch database $SCRATCH_DB" >&"$GATE_STDOUT"; drop_scratch_db; }
    [ -n "$WORK" ] && [ -d "$WORK" ] && git -C "$SRC_ROOT" worktree remove --force "$WORK" >/dev/null 2>&1
    [ -n "$WORK_PARENT" ] && [ -d "$WORK_PARENT" ] && rm -rf "$WORK_PARENT"
    [ "$LOCK_HELD" = "1" ] && rm -rf "$LOCK_DIR"
    return 0
}
trap cleanup EXIT

# ── one run at a time per (evidence root, sha) ───────────────────────────────
# Two runs on the same sha share every path under evidence/gate/logs/<sha>/, and
# because each run truncates its logs, the slower one's output is erased by the
# faster one while BOTH still print a verdict and write an attestation. mkdir is
# atomic, so it is the lock. The owner's pid goes inside so a lock left behind by
# a killed run can be taken over instead of wedging the gate for everyone after
# it — a lock that needs manual cleanup on a machine an operator is using is a
# worse failure than the one it prevents.
if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_HELD=1; echo $$ >"$LOCK_DIR/pid" 2>/dev/null
else
    LOCK_OWNER="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
    if [ -n "$LOCK_OWNER" ] && kill -0 "$LOCK_OWNER" 2>/dev/null; then
        # NOT infra_abort: that deletes this sha's logs and drops an ABORTED
        # marker, which would destroy the evidence of the run that holds the lock.
        echo "full-gate: REFUSED — another full-gate run (pid $LOCK_OWNER) is already gating $FULL_SHA into $LOG_REL."
        echo "  Both runs would write the same log files, and the one that finishes first would erase the other's"
        echo "  evidence while both still reported a verdict. Wait for it to finish, or gate a different sha."
        echo "  If you are sure no gate is running: rm -rf \"$LOCK_DIR\""
        exit 2
    fi
    echo "[full-gate] taking over a lock left behind by pid ${LOCK_OWNER:-unknown}, which is no longer running"
    LOCK_HELD=1; echo $$ >"$LOCK_DIR/pid" 2>/dev/null
fi

psql_admin() { # run a psql command against the admin connection
    if [ -n "$ADMIN_URL" ]; then psql "$ADMIN_URL" "$@"; else psql -d postgres "$@"; fi
}
# The same Law L2 rule as preflight 3, applied to the neighbouring call that uses
# the very same connection string: psql is free to quote the whole string in an
# error, and this gate is run under `tee` on the staging host, so unredacted
# stderr here puts an admin password on disk. Not a hypothetical about today's
# libpq — the gate must not depend on libpq's discretion. Pinned by --selftest T.
create_scratch_db() {
    local err rc
    err="$(psql_admin -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH_DB\"" 2>&1 >/dev/null)"; rc=$?
    [ -n "$err" ] && printf '%s\n' "$(redact "$err")" >&2
    return "$rc"
}
drop_scratch_db()   { psql_admin -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" >/dev/null 2>&1; }
scratch_url() {
    if [ -n "$ADMIN_URL" ]; then
        local base="${ADMIN_URL%%\?*}"; printf '%s/%s' "${base%/*}" "$SCRATCH_DB"
    else
        printf 'postgresql://%s@%s:%s/%s' "${PGUSER:-postgres}" "${PGHOST:-127.0.0.1}" "${PGPORT:-5432}" "$SCRATCH_DB"
    fi
}

# ── preflight 3/3: the admin connection has to answer ────────────────────────
# Proved with a query, not by inspecting the URL: a string that parses and a
# server that answers are two different facts. Read-only, and aimed at the
# maintenance connection only — never at DATABASE_URL, which Law L3 keeps away
# from this script entirely. psql quotes the whole connection string in some of
# its errors, so its output goes through redact() before it is shown (Law L2).
if [ "$DRY" != "1" ]; then
    if ! PG_PREFLIGHT="$(psql_admin -v ON_ERROR_STOP=1 -tAc 'SELECT 1' 2>&1)"; then
        infra_abort \
            "cannot reach Postgres with $([ -n "$ADMIN_URL" ] && printf 'GATE_PG_ADMIN_URL' || printf 'the PGHOST/PGUSER/PGPORT defaults')" \
            "export GATE_PG_ADMIN_URL='postgresql://<user>@<host>:5432/postgres' for a role that may CREATE DATABASE, then re-run" \
            "$(redact "$PG_PREFLIGHT")"
    fi
fi

# ── check implementations. Contract mirrors scripts/probes/_lib.sh:
#    return 0 = PASS · 1 = FAIL · 2 = NOT-RUN, and set REASON when not passing.
REASON=""
in_backend() { (cd "$WORK/apps/backend" && DATABASE_URL="$SCRATCH_URL" "$@"); }

do_workspace_clean() {
    local dirty; dirty="$(git -C "$SRC_ROOT" status --porcelain)"
    printf '%s\n' "$dirty"
    [ -z "$dirty" ] && { DIRTY=false; return 0; }
    DIRTY=true
    REASON="uncommitted changes in the source checkout: $(printf '%s' "$dirty" | head -3 | tr '\n' ' ') — the sha would not describe what was tested"
    return 1
}
do_install() {
    (cd "$WORK" && pnpm install --frozen-lockfile) || { REASON="pnpm install --frozen-lockfile failed"; return 1; }
}
do_prisma_generate() {
    in_backend npx prisma generate --schema prisma/schema \
        || { REASON="prisma generate failed — this is the single reason settle-webhook-only/webhook-idempotent are parked out of CI"; return 1; }
}
do_migrate_deploy() {
    in_backend npx prisma migrate deploy || { REASON="prisma migrate deploy failed against $SCRATCH_DB"; return 1; }
}
do_suite_green() {
    (cd "$WORK" && DATABASE_URL="$SCRATCH_URL" PROBE_OUT_DIR="$ARTIFACT_DIR" bash scripts/probes/suite-green.sh)
    local c=$?
    [ "$c" = "0" ] && return 0
    [ "$c" = "2" ] || [ "$c" = "3" ] && { REASON="probe suite-green returned BLOCKED/PENDING — see log"; return 2; }
    REASON="probe suite-green FAILED — see log"; return 1
}
do_integration_pg() {
    in_backend npx jest __tests__/integration --ci --forceExit --json --outputFile="$INTEGRATION_JSON"
    local c=$? passed
    passed="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["numPassedTests"])' "$INTEGRATION_JSON" 2>/dev/null || echo 0)"
    echo "numPassedTests=$passed"
    [ "$c" != "0" ] && { REASON="jest exited $c on __tests__/integration with a real Postgres"; return 1; }
    [ "${passed:-0}" -gt 0 ] || { REASON="0 integration tests executed — these files self-skip without DATABASE_URL, so an empty run proves nothing"; return 1; }
    return 0
}
do_integration_no_skip() {
    local pending
    pending="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["numPendingTests"])' "$INTEGRATION_JSON" 2>/dev/null || echo '')"
    [ -z "$pending" ] && { REASON="no integration jest report to read (integration-pg did not produce one)"; return 2; }
    echo "numPendingTests=$pending"
    [ "$pending" = "0" ] && return 0
    REASON="$pending integration test(s) still skipped themselves with a real Postgres present"
    return 1
}
do_secret_scan_deep() {
    command -v gitleaks >/dev/null 2>&1 \
        || { REASON="gitleaks is not installed on this machine — a deep scan that did not happen is NOT a pass (same contract as scripts/probes/no-secret.sh). Install it: see the runbook."; return 2; }
    # The JSON report is the evidence. The first staging run left three summary
    # lines saying a number, so "see log" pointed at nothing an operator could act
    # on: not which finding, not which file, not which commit. --redact stays on —
    # the report is written under evidence/ and Law L2 applies to it like anything
    # else; a fingerprint (commit:file:rule:line) carries no secret material.
    local report="$ARTIFACT_DIR/gitleaks-report.json" code n
    (cd "$SRC_ROOT" && gitleaks detect --no-banner --redact \
        --report-format json --report-path "$report")
    code=$?
    # gitleaks answers with THREE values: 0 clean, 1 leaks found, anything else =
    # the tool itself could not run. The old code was `|| return 1`, which filed a
    # bad config, an unreadable repo and a crash under "this commit contains a
    # secret" — infra breakage wearing a verdict's clothes, the same lie this file
    # kills everywhere else (see the exit-3 block above). Pinned by --selftest
    # AE/AF/AG.
    case "$code" in
        0) return 0 ;;
        1) n="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$report" 2>/dev/null)" || n=""
           REASON="gitleaks found ${n:-an unknown number of} finding(s) not covered by .gitleaksignore — read $report (secrets redacted). Every entry there is either a real leak to ROTATE or a fixture to classify; adding a fingerprint to .gitleaksignore is granting cover, which only the operator signs (Law L6)."
           return 1 ;;
        *) REASON="gitleaks itself exited $code — its contract is 0=clean, 1=leaks, anything else=the tool could not run, so this is a broken tool and not a verdict about this commit; nothing was learned about the commit. See log."
           return 2 ;;
    esac
}
do_probe_ci() {
    (cd "$WORK" && PROBE_OUT_DIR="$ARTIFACT_DIR" node scripts/ci/probe-gate.js) || { REASON="probe-gate.js failed — see log"; return 1; }
}
do_probe_prisma_deps() {
    local worst=0 p c
    for p in settle-webhook-only webhook-idempotent; do
        (cd "$WORK" && DATABASE_URL="$SCRATCH_URL" PROBE_OUT_DIR="$ARTIFACT_DIR" bash "scripts/probes/$p.sh")
        c=$?
        echo "[$p] exit $c"
        case "$c" in 0) ;; 2|3) [ "$worst" -lt 2 ] && worst=2 ;; *) worst=1 ;; esac
    done
    [ "$worst" = "0" ] && return 0
    [ "$worst" = "2" ] && { REASON="settle-webhook-only/webhook-idempotent returned BLOCKED — see log"; return 2; }
    REASON="settle-webhook-only or webhook-idempotent FAILED — see log"; return 1
}
do_deploy_drift() {
    # No DATABASE_URL: this probe never touches a database. It makes HTTP
    # requests to the deployed services and compares what they report against
    # the refs in scripts/probes/deploy-targets.txt.
    (cd "$WORK" && PROBE_OUT_DIR="$ARTIFACT_DIR" bash scripts/probes/deploy-drift.sh)
    local c=$?
    [ "$c" = "0" ] && return 0
    # 2 and 3 mean the probe could not run — no curl, no node, or the fetch of
    # the refs to compare against failed. full-gate records that as not-run
    # rather than as a verdict, the same mapping do_probe_prisma_deps uses.
    [ "$c" = "2" ] || [ "$c" = "3" ] && { REASON="deploy-drift could not run (missing curl/node, or git fetch failed) — see log"; return 2; }
    REASON="a deployed service is not running the commit it should — see log"; return 1
}
money_rows_examined() { # echoes a row count, or empty when it cannot be determined
    if [ -n "${FULL_GATE_MONEY_ROWS:-}" ]; then printf '%s' "$FULL_GATE_MONEY_ROWS"; return 0; fi
    # No scratch URL (dry run) ⇒ report "unknown". Never fall through to psql with
    # an empty connection string: libpq would then use PG*/defaults, which is how
    # a "harmless" query ends up on somebody's real database (Law L3).
    [ -n "$SCRATCH_URL" ] || return 0
    psql "$SCRATCH_URL" -tAc 'SELECT count(*) FROM checkout_orders' 2>/dev/null | tr -d '[:space:]'
}
money_probe() { # $1 = probe name
    [ "${FULL_GATE_RUN_MONEY_PROBES:-0}" = "1" ] \
        || { REASON="not run by default: ${CHECK_NOTE[$1]}"; return 2; }
    local rows; rows="$(money_rows_examined)"
    [ -n "$rows" ] || { REASON="cannot count checkout_orders rows on the scratch DB — refusing to report a verdict about rows it could not read"; return 2; }
    echo "rows_examined=$rows"
    [ "$rows" -gt 0 ] 2>/dev/null \
        || { REASON="0 rows examined in checkout_orders on the scratch database — a PASS here would mean '0 rows examined', not '0 violations' (reports/accounting-reconciler/2026-08-06.md §1a)"; return 2; }
    local probe="${1%-real}"
    (cd "$WORK" && DATABASE_URL="$SCRATCH_URL" PROBE_OUT_DIR="$ARTIFACT_DIR" bash "scripts/probes/$probe.sh")
    local c=$?
    [ "$c" = "0" ] && return 0
    [ "$c" = "2" ] || [ "$c" = "3" ] && { REASON="probe $probe returned BLOCKED"; return 2; }
    REASON="probe $probe FAILED on $rows sampled row(s)"; return 1
}
do_money_equation_real() { money_probe money-equation-real; }
do_drain_complete_real() { money_probe drain-complete-real; }
do_stripe_keys_ready() {
    REASON="${CHECK_NOTE[stripe-keys-ready]}"
    return 2
}
do_flow_proof_full() {
    local missing="" v
    [ "$DRY" = "1" ] && { REASON="dry run — the flow-proof harness drives a real browser against a real deployment; it is never started by --selftest"; return 2; }
    for v in FLOW_PROOF_API_BASE FLOW_PROOF_BASE_URL FLOW_PROOF_REVIEWER_ID FLOW_PROOF_REVIEWER_PW \
             FLOW_PROOF_SCHEDULER_ID FLOW_PROOF_SCHEDULER_PW FLOW_PROOF_AUDITOR_ID FLOW_PROOF_AUDITOR_PW \
             FLOW_PROOF_ADMIN_ID FLOW_PROOF_ADMIN_PW; do
        [ -z "${!v:-}" ] && missing="$missing $v"
    done
    [ -n "$missing" ] && { REASON="missing credential env:$missing (apps/web-app/flow-proof/README.md) — not run, not guessed"; return 2; }
    (cd "$WORK" && FLOW_PROOF_MODE=full DATABASE_URL="$SCRATCH_URL" bash scripts/flow-proof.sh) \
        || { REASON="flow-proof full mode failed — see log"; return 1; }
}

# ── runner ───────────────────────────────────────────────────────────────────
DIRTY=false
RES_TSV="$(mktemp)" || infra_abort "cannot create the temporary result file" "check free space and permissions on ${TMPDIR:-/tmp}, then re-run"
forced_status() { # honoured only in dry runs
    printf '%s' "${FULL_GATE_FORCE:-}" | tr ', ' '\n\n' | grep -E "^$1=" | head -1 | cut -d= -f2
}
declare -a P_LIST=() F_LIST=() N_LIST=()
# Checks whose decision is PURE — they choose NOT-RUN from configuration alone and
# start no database, browser or package manager. Those run for real even in a dry
# run, because their decision is the thing most worth testing: it is where a
# vacuous PASS would be born (--selftest cases I and K).
DRY_SAFE=" money-equation-real drain-complete-real stripe-keys-ready flow-proof-full "
run_check() {
    local id="$1" flag="${CHECK_FLAG[$1]}" log="$LOG_REL/$1.log" status fn code forced
    local logfile="$OUT_ROOT/$log" captured
    REASON=""
    # The log IS the evidence, so it is opened BEFORE the check is started. A
    # check that ran with nowhere to record what happened proves nothing, and —
    # this is the staging bug — a redirect that fails makes bash return 1 without
    # running the command at all, which the old code then filed under `fail`.
    # TRUNCATE, not append: one artifact describes exactly one run. Re-gating the
    # same sha used to append, and an interrupted first run plus a second run
    # ended up in a single file with no way to tell where one stopped.
    : 2>/dev/null >"$logfile" || infra_abort "cannot open the check log $logfile for writing, so '$id' was not started" "$CHOWN_HINT"
    TOUCHED_LOGS+=("$logfile")   # so an abort can delete exactly what this run wrote
    if [ "$DRY" = "1" ] && { [ -n "$(forced_status "$id")" ] || [[ "$DRY_SAFE" != *" $id "* ]]; }; then
        forced="$(forced_status "$id")"; status="${forced:-pass}"
        [ "$status" = "pass" ] || REASON="forced to '$status' by FULL_GATE_FORCE (dry run — no command executed)"
        printf 'dry run: no command executed; status=%s\n' "$status" 2>/dev/null >"$logfile" \
            || infra_abort "cannot write the check log $logfile" "$CHOWN_HINT"
    else
        fn="do_${id//-/_}"
        { "$fn" >>"$logfile" 2>&1; code=$?; } || true
        case "$code" in 0) status=pass ;; 2|3) status=not-run ;; *) status=fail ;; esac
        # Read back and redact. Every failure here is infra, never a verdict: if
        # the log cannot be read or rewritten, what the check did is unknown.
        captured="$(cat "$logfile" 2>&1)" \
            || infra_abort "cannot read back the check log $logfile after running '$id'" "$CHOWN_HINT" "$(redact "$captured")"
        # TWO commands, two guards, on purpose. Wrapping redact in "$(...)" to add
        # the trailing newline threw its exit status away — bash discards the
        # status of a command substitution, so `printf '%s' "$(false)"` exits 0 —
        # and a failing redact then wrote an EMPTY log and the run continued to
        # `verdict: PASS`. Destroying the evidence and then attesting to it is the
        # exact class this file exists to stop. Pinned by --selftest AA.
        redact "$captured" 2>/dev/null >"$logfile.tmp" \
            || infra_abort "redaction of the check log $logfile failed, so '$id' has no usable log" \
                           "make sure 'sed -E' works for this user (redact() needs it), then re-run"
        # Separate command: redact() emits no trailing newline, and without one
        # the log's last line stays open for whatever is written next (V3).
        printf '\n' 2>/dev/null >>"$logfile.tmp" \
            || infra_abort "cannot finish the redacted copy $logfile.tmp" "$CHOWN_HINT"
        mv "$logfile.tmp" "$logfile" 2>/dev/null \
            || infra_abort "cannot replace $logfile with its redacted copy" "$CHOWN_HINT"
    fi
    # A plain assignment DOES keep the substitution's exit status (unlike printf
    # above, and unlike `local x=$(...)`), so this one can be guarded directly.
    # Unguarded, a failing redact emptied the reason and every NOT-RUN entry
    # printed "no reason recorded" — breaking the three-bucket promise in this
    # file's own header. Pinned by --selftest AB.
    REASON="$(redact "$REASON")" \
        || infra_abort "redaction of the reason text for '$id' failed" \
                       "make sure 'sed -E' works for this user (redact() needs it), then re-run"
    REASON="${REASON//$'\t'/ }"   # the result file is tab-separated; a tab in a reason would shift every field
    printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$flag" "$status" "$REASON" "$log" 2>/dev/null >>"$RES_TSV" \
        || infra_abort "cannot append to the result file $RES_TSV" "check free space and permissions on ${TMPDIR:-/tmp}, then re-run"
    case "$status" in
        pass)    P_LIST+=("$id") ;;
        fail)    F_LIST+=("$id — ${REASON:-see $log}") ;;
        not-run) N_LIST+=("$id — ${REASON:-no reason recorded}") ;;
    esac
    printf '[full-gate] %-20s %-8s %s\n' "$id" "$status" "$REASON"
}

echo "[full-gate] sha=$FULL_SHA host=$(hostname) dry_run=$DRY scratch_db=$SCRATCH_DB"
if [ "$DRY" != "1" ]; then
    # `git worktree add` refuses an existing directory, so mktemp makes the PARENT
    # and git creates the leaf itself. Never run the gate in the tree that is
    # deployed — that tree is serving traffic and its node_modules is not ours.
    # Announced before it happens, so "nothing was built yet" is an observable
    # fact a test can assert on rather than an absence nobody can see
    # (--selftest S2/X2). It is also the slowest step, and an operator watching a
    # silent terminal deserves to know why.
    echo "[full-gate] creating a clean checkout of $FULL_SHA and scratch database $SCRATCH_DB"
    WORK_PARENT="$(mktemp -d -t gacp-gate-XXXXXX)" \
        || infra_abort "cannot create a temporary directory for the clean checkout" \
                       "check free space and permissions on ${TMPDIR:-/tmp}, then re-run"
    WORK="$WORK_PARENT/tree"
    git -C "$SRC_ROOT" worktree add --detach "$WORK" "$FULL_SHA" >/dev/null \
        || { echo "full-gate: could not create a clean checkout of $FULL_SHA"; exit 2; }
    SCRATCH_URL="$(scratch_url)"
    create_scratch_db || { echo "full-gate: could not create scratch database $SCRATCH_DB (set GATE_PG_ADMIN_URL or PGHOST/PGUSER)"; exit 2; }
    DB_CREATED=1
    echo "[full-gate] clean checkout at \$TMP, scratch database $SCRATCH_DB created (dropped on exit)"
fi

for id in "${CHECK_IDS[@]}"; do run_check "$id"; done

# ── verdict ──────────────────────────────────────────────────────────────────
VERDICT=pass
declare -a ACCEPTED_IDS=()
while IFS=$'\t' read -r id flag status reason log; do
    [ "$flag" = "required" ] || continue
    case "$status" in
        pass) ;;
        fail) VERDICT=fail ;;
        *)    if [ -n "$ACCEPTED_BY" ]; then ACCEPTED_IDS+=("$id"); else VERDICT=fail; fi ;;
    esac
done <"$RES_TSV"

echo ""
echo "===== full-gate $FULL_SHA ====="
echo "PASS    (${#P_LIST[@]}): ${P_LIST[*]:-none}"
printf 'FAIL    (%d):\n' "${#F_LIST[@]}"; for l in "${F_LIST[@]:-}"; do [ -n "$l" ] && echo "  - $l"; done
printf 'NOT-RUN (%d) — printed every run, never rounded up to a pass:\n' "${#N_LIST[@]}"
for l in "${N_LIST[@]:-}"; do [ -n "$l" ] && echo "  - $l"; done
if [ "${#ACCEPTED_IDS[@]}" -gt 0 ]; then
    echo "ACCEPTED-NOT-RUN by $ACCEPTED_BY (${ACCEPTED_WHY:-no reason given}): ${ACCEPTED_IDS[*]}"
fi

# ── attestation ──────────────────────────────────────────────────────────────
# Wrapped so a write failure becomes one sentence an operator can act on instead
# of an eight-line Python traceback, and so the run ends as an infra ABORT: a
# verdict whose attestation was never saved is a claim with no evidence behind
# it, which is exactly what this file exists to make impossible (--selftest P).
write_attestation() {
GATE_TSV="$RES_TSV" \
GATE_OUT="$ATT_FILE" \
GATE_SHA="$FULL_SHA" \
GATE_DIRTY="$DIRTY" \
GATE_DRY="$([ "$DRY" = "1" ] && echo true || echo false)" \
GATE_VERDICT="$VERDICT" \
GATE_HOST="$(hostname)" \
GATE_NODE="$(node -v 2>/dev/null || echo absent)" \
GATE_PNPM="$(pnpm -v 2>/dev/null || echo absent)" \
GATE_PG="$(psql --version 2>/dev/null || echo absent)" \
GATE_GIT="$(git --version 2>/dev/null || echo absent)" \
GATE_GITLEAKS="$(gitleaks version 2>/dev/null || echo absent)" \
GATE_ACCEPTED_BY="$ACCEPTED_BY" \
GATE_ACCEPTED_WHY="$ACCEPTED_WHY" \
GATE_ACCEPTED_IDS="${ACCEPTED_IDS[*]:-}" \
GATE_DB="$SCRATCH_DB" \
python3 - <<'PY'
import json, os, sys, datetime
rows = []
for line in open(os.environ['GATE_TSV'], encoding='utf-8'):
    line = line.rstrip('\n')
    if not line:
        continue
    cid, flag, status, reason, log = line.split('\t')
    rows.append({'id': cid, 'required': flag == 'required', 'flag': flag,
                 'status': status, 'reason': reason, 'log': log})
accepted = os.environ['GATE_ACCEPTED_IDS'].split()
doc = {
    'schema': 'gacp-full-gate/1',
    'sha': os.environ['GATE_SHA'],
    'timestamp_utc': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    'hostname': os.environ['GATE_HOST'],
    'dirty': os.environ['GATE_DIRTY'] == 'true',
    'dry_run': os.environ['GATE_DRY'] == 'true',
    'generated_by': 'scripts/ci/full-gate.sh',
    'scratch_database': os.environ['GATE_DB'],
    'versions': {'node': os.environ['GATE_NODE'], 'pnpm': os.environ['GATE_PNPM'],
                 'postgres_client': os.environ['GATE_PG'], 'git': os.environ['GATE_GIT'],
                 'gitleaks': os.environ['GATE_GITLEAKS']},
    'checks': rows,
    'not_run': [{'id': r['id'], 'required': r['required'], 'reason': r['reason']}
                for r in rows if r['status'] == 'not-run'],
    'allow_blocked': ({'accepted_by': os.environ['GATE_ACCEPTED_BY'],
                       'at': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
                       'checks': accepted,
                       'note': os.environ['GATE_ACCEPTED_WHY']} if accepted else None),
    'verdict': os.environ['GATE_VERDICT'],
}
try:
    with open(os.environ['GATE_OUT'], 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
except OSError as exc:
    # One line, no traceback: the caller turns this into the infra ABORT block.
    sys.stderr.write('%s\n' % exc)
    sys.exit(3)
PY
}
ATT_ERR="$(write_attestation 2>&1)" \
    || infra_abort "cannot write the attestation $ATT_FILE" "$CHOWN_HINT" "$(redact "$ATT_ERR")"
rm -f "$RES_TSV"

echo "verdict: $(printf '%s' "$VERDICT" | tr '[:lower:]' '[:upper:]')"
echo "attestation: evidence/gate/$FULL_SHA.json    logs: $LOG_REL/"
[ "$VERDICT" = "pass" ] && exit 0
exit 1
