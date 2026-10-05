#!/usr/bin/env bash
# Shared probe helpers. Operator-owned (Law 3.12).
# Contract: every probe exits 0 = PASS, 1 = FAIL, 2 = BLOCKED, 3 = PENDING.
# A probe that cannot run must say WHY on stdout — never pass vacuously.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$ROOT/apps/backend"
EVIDENCE_DIR="${PROBE_OUT_DIR:-$ROOT/evidence}"
mkdir -p "$EVIDENCE_DIR"

pass()    { echo "PASS: $*";    exit 0; }
fail()    { echo "FAIL: $*";    exit 1; }
blocked() { echo "BLOCKED: $*"; exit 2; }
pending() { echo "PENDING: $*"; exit 3; }

# find_attestation <repo-root> <tip-sha> [depth]
#   Locate the newest full-gate attestation (evidence/gate/<sha>.json) reachable
#   from <tip-sha>. Echoes "<attested-sha><TAB><files changed since, excluding
#   evidence/gate/>"; returns 1 when no attestation file exists within <depth>.
#   The caller decides what a non-empty second field means — for gate-attestation
#   it voids the attestation, for main-attestation-audit it means "try the merged
#   head instead". Lives here because BOTH probes need the identical walk and two
#   hand-maintained copies of it is exactly what Law L4 forbids.
find_attestation() {
    local root="$1" tip="$2" depth="${3:-50}" c f since extra
    while IFS= read -r c; do
        [ -z "$c" ] && continue
        f="$root/evidence/gate/$c.json"
        [ -f "$f" ] || continue
        since="$(git -C "$root" diff --name-only "$c" "$tip" 2>/dev/null || true)"
        extra="$(printf '%s\n' "$since" | grep -vE '^evidence/gate/' | grep -v '^$' || true)"
        printf '%s\t%s\n' "$c" "$(printf '%s' "$extra" | tr '\n' ' ')"
        return 0
    done <<<"$(git -C "$root" rev-list -n "$depth" "$tip" 2>/dev/null)"
    return 1
}

# Read a ratchet baseline "name: N" from scripts/probes/ratchet-baseline.txt; echoes N or empty.
baseline() {
    grep -E "^\s*-?\s*\`?$1\`?\s*:\s*[0-9]+" "$ROOT/scripts/probes/ratchet-baseline.txt" 2>/dev/null \
        | head -1 | grep -oE '[0-9]+' | head -1
}
