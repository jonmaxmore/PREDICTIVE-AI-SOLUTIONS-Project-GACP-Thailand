#!/usr/bin/env bash
# crawler-clean — crawler-report.json must show 0 dead/404/console-error.
#
# Counted with node, not python3. The previous version ran python3 in a command
# substitution with `|| echo unreadable`, which folded three different situations
# into one message: a report full of defects, a corrupt report, and a machine
# without a working interpreter all came out as
# `FAIL: <something> defects (or unreadable report)`.
#
# That last one is not hypothetical. On the Windows checkout used 2026-08-14
# `command -v python3` succeeded while `python3 -c 'pass'` exited 9009 — Windows
# ships an App Execution Alias that resolves as an executable and refuses to run.
# A probe reporting "defects" when the truth is "no interpreter" sends someone to
# read a crawl that is fine.
#
# The three now report separately: no usable node is BLOCKED (a tooling fault
# says nothing about the crawl), a report that will not parse is FAIL naming the
# parse error, and defects are FAIL naming the count.
#
# Selftest: bash scripts/probes/crawler-clean.sh --selftest
source "$(dirname "$0")/_lib.sh"

count_defects() { # $1 = report path; prints an integer, or exits non-zero
    node -e '
        const fs = require("fs");
        const raw = fs.readFileSync(process.argv[1], "utf8");
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const total = rows.reduce(
            (n, p) => n + (p.dead || 0) + (p.http404 || 0) + (p.consoleErrors || 0),
            0,
        );
        process.stdout.write(String(total));
    ' "$1" 2>&1
}

if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    run() { # $1 label  $2 expected-exit  $3 needle  [PATH-prefix]
        local label="$1" want="$2" needle="$3" prefix="${4:-}" out code
        CASES=$((CASES + 1))
        if [ -n "$prefix" ]; then
            out="$(PATH="$prefix:$PATH" EVIDENCE_DIR="$TMP" PROBE_OUT_DIR="$TMP" bash "$0" 2>&1)"; code=$?
        else
            out="$(EVIDENCE_DIR="$TMP" PROBE_OUT_DIR="$TMP" bash "$0" 2>&1)"; code=$?
        fi
        echo "--- $label → exit $code (expected $want)"; printf '   %s\n' "$out"
        [ "$code" = "$want" ] || { echo "*** $label FAILED: exit $code != $want"; BAD=$((BAD + 1)); }
        printf '%s' "$out" | grep -qi -- "$needle" \
            || { echo "*** $label FAILED: output does not mention '$needle'"; BAD=$((BAD + 1)); }
        echo
    }

    # A — no report yet is PENDING, not a verdict about a crawl nobody ran.
    rm -f "$TMP/crawler-report.json"
    run A 3 'no crawler-report'

    # B — a clean report passes. Without this case a probe that always failed
    #     would satisfy every other case here.
    printf '{"dead":0,"http404":0,"consoleErrors":0}\n' > "$TMP/crawler-report.json"
    run B 0 '0 dead'

    # C — defects fail, and the message carries the COUNT. "There are problems"
    #     without a number sends the reader back to run the sum by hand.
    printf '[{"dead":2,"http404":1,"consoleErrors":0},{"dead":0,"http404":0,"consoleErrors":4}]\n' > "$TMP/crawler-report.json"
    run C 1 '7 defect'

    # D — a report that will not parse must say SO. Folding it into the defect
    #     count is how "unreadable" got reported as a number of dead links.
    printf 'not json at all\n' > "$TMP/crawler-report.json"
    run D 1 'could not be parsed'

    # E — no usable node is BLOCKED, never a verdict. A stub that exits non-zero
    #     reproduces the broken-interpreter case on every platform; emptying PATH
    #     cannot be done on git-bash, where MSYS binaries need it to find their DLL.
    printf '{"dead":0,"http404":0,"consoleErrors":0}\n' > "$TMP/crawler-report.json"
    mkdir -p "$TMP/stubbin"
    printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/stubbin/node"; chmod +x "$TMP/stubbin/node"
    run E 2 'node' "$TMP/stubbin"

    echo "=================================================="
    [ "$BAD" -eq 0 ] && { echo "crawler-clean --selftest: $CASES/$CASES cases PASS"; exit 0; }
    echo "crawler-clean --selftest: $BAD assertion(s) FAILED"; exit 1
fi

F="$EVIDENCE_DIR/${WORK_ITEM:+$WORK_ITEM/}crawler-report.json"
[ -s "$F" ] || pending "no crawler-report.json yet ($F)"

node -e 'process.exit(0)' >/dev/null 2>&1 \
    || blocked "node is missing or not runnable here, and it counts the defects in $F — so nothing was learned about the crawl. Tooling fault on this machine, not a verdict. Check it with: node -e 'process.exit(0)'"

OUT="$(count_defects "$F")"
case "$OUT" in
    ''|*[!0-9]*)
        fail "$F could not be parsed as a crawler report — this is about the FILE, not about dead links: $(printf '%s' "$OUT" | head -1)" ;;
esac

[ "$OUT" = "0" ] && pass "0 dead/404/console-error in $F"
fail "$OUT defects (dead + http404 + consoleErrors) in $F"
