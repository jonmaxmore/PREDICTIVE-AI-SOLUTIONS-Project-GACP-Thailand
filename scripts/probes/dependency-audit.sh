#!/usr/bin/env bash
# dependency-audit — no production dependency may carry a known HIGH or CRITICAL advisory
# unless the operator has signed an acceptance for that exact advisory, with an expiry.
#
# ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
# Audit 2026-09-17 (PROC-04 / SECU-01): nothing in the repo scanned dependencies after
# hosted CI died on 2026-08-06, so demo.gacpth.com — which is production — ran
# next@15.5.21 for nine days after GHSA-2xp9-vwfh-vxw4 (critical, unauthenticated RCE)
# was published, and multer@2.2.0 with three DoS advisories on a public door. Both were
# one-line version bumps. A probe in the gate would have turned that into a red line
# the day the advisory appeared.
#
# ── ACCEPTANCES ARE WAIVERS, SO THEY ARE OPERATOR-SIGNED ──────────────────────
# Some advisories have no fixed version (extract-zip, pulled in by puppeteer to unzip
# Chrome at install time). Accepting one is a cover in the sense of the project rules L6, so a
# row in dependency-audit-accepted.txt only counts when its signed-by field is exactly
# `operator` and its expiry is today or later. An agent may WRITE a proposed row, but it
# stays inert until the operator signs it.
#
# Row format (| separated):  GHSA-id | package | expires YYYY-MM-DD | signed-by | reason
#
# ── SUPPRESSIONS IN package.json ARE WAIVERS TOO (PR #858 review MEDIUM-1) ─────
# pnpm drops every advisory listed in package.json `pnpm.auditConfig.ignoreCves`
# (pnpm 8: pnpm.cjs, before `pnpm audit --json` is written; pnpm 9 adds `ignoreGhsas`)
# BEFORE this probe sees the JSON. A package.json edit would otherwise silence an
# advisory with no operator row. So every entry in either list must have its own
# operator-signed, unexpired row here whose first column is that exact id
# (CVE-… or GHSA-…); the package column is informational for these rows, because
# pnpm's suppression applies to the id across every package. A missing row = FAIL
# naming the id. An unreadable package.json = BLOCKED.
#
# Contract: exit 0 PASS · 1 FAIL · 2 BLOCKED (audit could not run or its output could not
# be read — never a vacuous PASS).
#
# Usage:  bash scripts/probes/dependency-audit.sh
#         bash scripts/probes/dependency-audit.sh --selftest
#         DEP_AUDIT_JSON=<file> DEP_AUDIT_ACCEPTED=<file> DEP_AUDIT_TODAY=YYYY-MM-DD bash …
#           ^ read a saved `pnpm audit --json` instead of running one (used by --selftest).
#         DEP_AUDIT_PACKAGE_JSON=<file> — the manifest whose pnpm.auditConfig is checked
#           (default: the repo root package.json, the one `pnpm audit` reads).
source "$(dirname "$0")/_lib.sh"

ACCEPTED="${DEP_AUDIT_ACCEPTED:-$(dirname "$0")/dependency-audit-accepted.txt}"
TODAY="${DEP_AUDIT_TODAY:-$(date -u +%F)}"
MANIFEST="${DEP_AUDIT_PACKAGE_JSON:-$ROOT/package.json}"

evaluate() {  # evaluate <audit-json-file> — prints the verdict line, returns 0/1/2
    python3 - "$1" "$ACCEPTED" "$TODAY" "$MANIFEST" <<'PY'
import datetime, json, re, sys
audit_path, accepted_path, today, manifest_path = sys.argv[1:5]
ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

def real_iso_date(value):
    """True only for a strict, zero-padded YYYY-MM-DD that exists on the calendar.
    A text compare let `never` and `2026-9-1` sort after every real date, so such a
    row never expired; `2026-02-30` must not roll over to March either."""
    if not ISO_DATE.match(value):
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return True
try:
    data = json.load(open(audit_path, encoding='utf-8'))
    advisories = data['advisories']
except Exception as e:  # noqa: BLE001 — any unreadable audit is BLOCKED, not PASS
    print(f"BLOCKED: cannot read pnpm audit output ({type(e).__name__})")
    sys.exit(2)

try:
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    audit_config = ((manifest.get('pnpm') or {}).get('auditConfig') or {})
    suppressed = []
    for field in ('ignoreCves', 'ignoreGhsas'):
        entries = audit_config.get(field) or []
        if not isinstance(entries, list):
            raise ValueError(f"{field} is not a list")
        suppressed += [(field, str(e).strip()) for e in entries]
except Exception as e:  # noqa: BLE001 — cannot see the suppressions = cannot judge
    print(f"BLOCKED: cannot read pnpm.auditConfig from {manifest_path} ({type(e).__name__})")
    sys.exit(2)

accepted, signed_ids, ignored, invalid = {}, set(), [], []
accepted_name = accepted_path.split('/')[-1]
try:
    for n, raw in enumerate(open(accepted_path, encoding='utf-8'), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        parts = [p.strip() for p in line.split('|')]
        # A malformed row must neither count as a cover nor vanish into a note:
        # it FAILs the probe, naming the line, whoever signed it.
        if len(parts) < 5:
            invalid.append(f"{accepted_name}:{n} INVALID row (needs 5 |-separated fields, has {len(parts)})")
            continue
        ghsa, pkg, expires, signed = parts[:4]
        if not real_iso_date(expires):
            invalid.append(f"{accepted_name}:{n} INVALID row {ghsa}: expiry '{expires}' is not a real YYYY-MM-DD date")
            continue
        if signed != 'operator':
            ignored.append(f"{ghsa} not signed by operator ({signed})")
            continue
        if expires < today:
            ignored.append(f"{ghsa} acceptance expired {expires}")
            continue
        accepted[(ghsa, pkg)] = expires
        signed_ids.add(ghsa)
except FileNotFoundError:
    pass

open_items = []
for adv in advisories.values():
    if adv.get('severity') not in ('high', 'critical'):
        continue
    key = (adv.get('github_advisory_id'), adv.get('module_name'))
    if key in accepted:
        continue
    open_items.append(f"{adv['severity']} {adv['module_name']} {adv.get('github_advisory_id')} (vulnerable {adv.get('vulnerable_versions')}, patched {adv.get('patched_versions')})")

# An id pnpm was told to drop never reaches the JSON above, so it is judged here.
for field, ident in suppressed:
    if ident not in signed_ids:
        open_items.append(f"package.json pnpm.auditConfig.{field} suppresses {ident} with no operator-signed row in {accepted_name}")
open_items += invalid

note = f" · ignored acceptances: {'; '.join(ignored)}" if ignored else ''
if open_items:
    print(f"FAIL: {len(open_items)} unaccepted high/critical advisory(ies), unsigned suppression(s) or invalid row(s): " + ' | '.join(sorted(set(open_items))) + note)
    sys.exit(1)
print(f"PASS: no unaccepted high/critical advisory in production dependencies ({len(accepted)} operator-accepted){note}")
PY
}

# ── selftest ──────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--selftest" ]; then
    TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BAD=0; CASES=0
    adv() {  # adv <severity> <module> <ghsa>
        printf '"%s":{"severity":"%s","module_name":"%s","github_advisory_id":"%s","vulnerable_versions":"<9","patched_versions":">=9"}' \
            "$3" "$1" "$2" "$3"
    }
    write_audit() { printf '{"advisories":{%s}}' "$1" >"$TMP/audit.json"; }
    write_manifest() { printf '%s' "$1" >"$TMP/package.json"; }
    expect() {  # expect <want-exit> <label> [text the output must contain]
        CASES=$((CASES+1))
        out="$(DEP_AUDIT_JSON="$TMP/audit.json" DEP_AUDIT_ACCEPTED="$TMP/accepted.txt" DEP_AUDIT_PACKAGE_JSON="$TMP/package.json" DEP_AUDIT_TODAY=2026-09-17 bash "$0" 2>&1)"; got=$?
        if [ "$got" = "$1" ] && { [ -z "${3:-}" ] || printf '%s' "$out" | grep -qF -- "$3"; }; then
            echo "  ok   $2 → exit $got"
        else
            echo "  BAD  $2 → exit $got, wanted $1${3:+ naming $3}: $out"; BAD=$((BAD+1))
        fi
    }
    write_manifest '{"name":"x"}'
    : >"$TMP/accepted.txt"
    write_audit "$(adv critical next GHSA-a)";                     expect 1 "A critical advisory"
    write_audit "$(adv high multer GHSA-b)";                       expect 1 "B high advisory, nothing accepted"
    write_audit "$(adv moderate js-yaml GHSA-c),$(adv low x GHSA-d)"; expect 0 "C only moderate/low"
    write_audit "$(adv high extract-zip GHSA-e)"
    echo "GHSA-e | extract-zip | 2026-12-31 | operator | install-time only" >"$TMP/accepted.txt";   expect 0 "D high accepted by operator"
    echo "GHSA-e | extract-zip | 2026-09-01 | operator | expired" >"$TMP/accepted.txt";            expect 1 "E acceptance expired"
    echo "GHSA-e | extract-zip | 2026-12-31 | agent | proposed only" >"$TMP/accepted.txt";          expect 1 "F acceptance not signed by operator"
    echo "GHSA-e | other-pkg | 2026-12-31 | operator | wrong package" >"$TMP/accepted.txt";        expect 1 "G acceptance names a different package"
    printf '{not json' >"$TMP/audit.json";                                                          expect 2 "H unreadable audit output"
    # MEDIUM-1: pnpm drops ignoreCves/ignoreGhsas ids before the JSON exists — the
    # audit below is clean exactly as pnpm would print it after the suppression.
    write_audit "$(adv moderate js-yaml GHSA-c)"; : >"$TMP/accepted.txt"
    write_manifest '{"pnpm":{"auditConfig":{"ignoreCves":["CVE-2099-0001"]}}}';                   expect 1 "I ignoreCves entry with no signed row" "CVE-2099-0001"
    echo "CVE-2099-0001 | brace-expansion | 2026-12-31 | operator | build tooling only" >"$TMP/accepted.txt"; expect 0 "J ignoreCves entry signed by operator"
    echo "CVE-2099-0001 | brace-expansion | 2026-12-31 | proposed | build tooling only" >"$TMP/accepted.txt"; expect 1 "K ignoreCves row only proposed" "CVE-2099-0001"
    echo "CVE-2099-0001 | brace-expansion | 2026-09-01 | operator | expired" >"$TMP/accepted.txt";            expect 1 "L ignoreCves row expired" "CVE-2099-0001"
    echo "CVE-2099-0002 | brace-expansion | 2026-12-31 | operator | a different id" >"$TMP/accepted.txt";     expect 1 "M ignoreCves row signs a different id" "CVE-2099-0001"
    write_manifest '{"pnpm":{"auditConfig":{"ignoreGhsas":["GHSA-zzzz"]}}}'; : >"$TMP/accepted.txt";   expect 1 "N ignoreGhsas entry with no signed row" "GHSA-zzzz"
    write_manifest '{"pnpm":{"auditConfig":{"ignoreCves":[]}}}';                                      expect 0 "O empty ignoreCves"
    write_manifest '{not json';                                                                        expect 2 "P unreadable package.json"
    # Expiry is a real calendar date or the row is INVALID (FAIL, naming the line) —
    # a text compare let `never` / `2026-9-1` sort after every date and never expire.
    write_manifest '{"name":"x"}'; write_audit "$(adv high extract-zip GHSA-e)"
    printf '# header\nGHSA-e | extract-zip | never | operator | perpetual\n' >"$TMP/accepted.txt";      expect 1 "Q expiry 'never'" "accepted.txt:2 INVALID"
    echo "GHSA-e | extract-zip | 2026-9-1 | operator | unpadded, past" >"$TMP/accepted.txt";          expect 1 "R expiry unpadded 2026-9-1" "accepted.txt:1 INVALID"
    echo "GHSA-e | extract-zip | 2026-02-30 | operator | no such day" >"$TMP/accepted.txt";           expect 1 "S expiry 2026-02-30 (not a calendar date)" "'2026-02-30'"
    echo "GHSA-e | extract-zip | 2027-01-15 | operator | valid future date" >"$TMP/accepted.txt";     expect 0 "T expiry a valid future date"
    write_audit "$(adv moderate js-yaml GHSA-c)"
    echo "GHSA-q | whatever | never | proposed | even an inert row" >"$TMP/accepted.txt";           expect 1 "U invalid expiry fails even on a row that covers nothing" "INVALID row GHSA-q"
    echo "GHSA-q | only-three-fields | 2027-01-15" >"$TMP/accepted.txt";                               expect 1 "V short row does not vanish" "accepted.txt:1 INVALID row"
    echo "selftest: $((CASES-BAD))/$CASES"
    [ "$BAD" -eq 0 ] && exit 0 || exit 1
fi

# ── real run ──────────────────────────────────────────────────────────────────
if [ -n "${DEP_AUDIT_JSON:-}" ]; then
    evaluate "$DEP_AUDIT_JSON"; exit $?
fi
command -v pnpm >/dev/null 2>&1 || blocked "pnpm not on PATH — cannot audit dependencies"
OUT="$EVIDENCE_DIR/dependency-audit.json"
# pnpm audit exits non-zero whenever it finds anything; the verdict comes from the JSON.
(cd "$ROOT" && timeout 180 pnpm audit --prod --json >"$OUT" 2>"$OUT.err") || true
[ -s "$OUT" ] || blocked "pnpm audit produced no output (network or registry problem): $(head -c 300 "$OUT.err" 2>/dev/null)"
evaluate "$OUT"; exit $?
