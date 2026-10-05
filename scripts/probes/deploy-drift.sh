#!/usr/bin/env bash
# deploy-drift — is what is RUNNING the commit it is supposed to be?
#
# WHY THIS EXISTS: on 2026-08-14 gacp-frontend-staging was serving an image built
# 2026-07-23 — two days before the data-sovereignty audit that removed 29
# outbound flows. Source had been clean for three weeks. Not one gate in this
# repository could see it, because every one of them reads files in the repo and
# none of them asks the running system anything. A runbook recorded the same fact
# on 2026-08-05 and nine days later nothing had changed, which is the evidence
# that this layer needs a machine rather than a document.
#
# CONTRACT (scripts/probes/_lib.sh): 0 PASS · 1 FAIL · 2 BLOCKED · 3 PENDING.
#   - Unreachable endpoint is FAIL, never PASS. A check that quietly passes when
#     it did not run is the failure this repository keeps re-learning.
#   - A MISSING TOOL is BLOCKED, because "curl is not installed here" says
#     nothing about the deployment. full-gate.sh:1009 draws the same line for
#     gitleaks.
#
# Spec: design note 2026-08-14-runtime-deploy-drift-design
set -u
. "${BASH_SOURCE[0]%/*}/_lib.sh"

TARGETS="${DEPLOY_TARGETS_FILE:-$ROOT/scripts/probes/deploy-targets.txt}"

# Shortest prefix still worth treating as an identifier. Below this, matching
# says almost nothing: three hex characters match roughly one commit in 4096.
MIN_REVISION_LENGTH=7

command -v curl >/dev/null 2>&1 \
    || blocked "curl is not installed on this machine, so no endpoint was contacted and nothing was learned about what is deployed"
command -v node >/dev/null 2>&1 \
    || blocked "node is not installed on this machine — it parses the JSON reply; nothing was learned about what is deployed"

[ -r "$TARGETS" ] \
    || fail "cannot read $TARGETS — a drift probe with no target list would report PASS having contacted nothing"

rows="$(grep -vE '^[[:space:]]*(#|$)' "$TARGETS" 2>/dev/null)"
[ -n "$rows" ] \
    || fail "$TARGETS contains no target rows — refusing to pass having contacted nothing"

# Pure-bash trim. Using `tr` here would add an external command to the set this
# probe needs, and the selftest has to be able to build a PATH without curl in
# it — every extra dependency is another thing that has to be in that sandbox
# for a reason unrelated to what is being tested.
trim() {
    local s="$1"
    s="${s#"${s%%[![:space:]]*}"}"
    s="${s%"${s##*[![:space:]]}"}"
    printf '%s' "$s"
}

# Read `revision` out of a JSON body.
#   prints the value · prints NULL for an explicit null · exits non-zero if the
#   body is not JSON, or has no revision, or has one that is not a string.
#
# node rather than grep: a lexical match would happily find a SHA-shaped string
# inside some other field, or inside an HTML error page, and report a value
# nobody published.
extract_revision() {
    node -e '
        let s = "";
        process.stdin.on("data", (d) => { s += d; });
        process.stdin.on("end", () => {
            let v;
            try { v = JSON.parse(s).revision; } catch { process.exit(9); }
            if (v === null) { process.stdout.write("NULL"); return; }
            if (typeof v !== "string" || v === "") { process.exit(8); }
            process.stdout.write(v);
        });
    ' 2>/dev/null
}

problems=""
checked=0

# Compare against the REMOTE refs, not whatever this checkout last saw: a stale
# origin/main turns real drift into a false PASS, the one direction this probe
# must never be wrong in.
#
# Fetch each remote-tracking ref the target list names EXPLICITLY, by refspec —
# never a bare `git fetch origin`. A bare fetch obeys the clone's fetch refspec,
# and a single-branch or shallow clone (`git clone --depth N`) narrows that
# refspec to the default branch, so origin/deploy/production never materialises
# no matter how often origin is fetched and the row fails as unresolvable for a
# branch that exists. Observed 2026-08-14 on the first fully green staging run,
# from the very shallow clone recommended to dodge a flaky full clone.
#
# Rows naming local refs (HEAD, a SHA) trigger no fetch, which keeps the
# selftest hermetic without giving the probe a test-only escape hatch.
while IFS= read -r remote_branch; do
    [ -n "$remote_branch" ] || continue
    # No --depth here, deliberately: a depth-limited fetch into a FULL checkout
    # writes .git/shallow and turns that checkout shallow, which then breaks
    # main-attestation-audit's 30-commit walk in a probe that shares the repo.
    # A plain refspec fetch never changes the shallowness of a full clone, and
    # in an already-shallow clone git deepens only as far as it must.
    git -C "$ROOT" fetch --quiet origin \
        "+refs/heads/${remote_branch}:refs/remotes/origin/${remote_branch}" 2>/dev/null \
        || problems="$problems
  cannot fetch 'origin/${remote_branch}' from the remote — either a network fault or the branch is gone on origin. Rows naming it were NOT checked, and unchecked is not passed"
done <<<"$(printf '%s\n' "$rows" | awk -F'|' '{gsub(/[[:space:]]/,"",$3); if ($3 ~ /^origin\//) { sub(/^origin\//,"",$3); print $3 } }' | sort -u)"

while IFS='|' read -r name url ref; do
    name="$(trim "${name:-}")"
    url="$(trim "${url:-}")"
    ref="$(trim "${ref:-}")"

    if [ -z "$name" ] || [ -z "$url" ] || [ -z "$ref" ]; then
        problems="$problems
  malformed row (expected 'name | url | ref'): ${name:-?} | ${url:-?} | ${ref:-?}"
        continue
    fi

    expected="$(git -C "$ROOT" rev-parse --verify --quiet "${ref}^{commit}" 2>/dev/null)"
    if [ -z "$expected" ]; then
        problems="$problems
  $name: ref '$ref' does not resolve to a commit — this row names something that no longer exists, so nothing was checked for it"
        continue
    fi

    if ! body="$(curl -fsS --max-time 15 "$url" 2>/dev/null)"; then
        problems="$problems
  $name: could not reach $url (network or HTTP error). Not a verdict about the deployment — but not a pass either"
        continue
    fi

    if ! actual="$(printf '%s' "$body" | extract_revision)" || [ -z "$actual" ]; then
        problems="$problems
  $name: the reply from $url is not JSON carrying a string-or-null 'revision' field. An error page served with HTTP 200 looks like this"
        continue
    fi

    checked=$((checked + 1))

    if [ "$actual" = "NULL" ]; then
        problems="$problems
  $name: reports revision=null — this image does not know which commit it was built from, so it cannot be checked at all. Rebuild it with --build-arg GIT_SHA=\$(git rev-parse HEAD)"
        continue
    fi

    if [ "${#actual}" -lt "$MIN_REVISION_LENGTH" ]; then
        problems="$problems
  $name: revision '$actual' is shorter than $MIN_REVISION_LENGTH characters, which is too short to identify a commit"
        continue
    fi

    case "$expected" in
        "$actual"*) ;;
        *)
            behind="$(git -C "$ROOT" rev-list --count "${actual}..${ref}" 2>/dev/null || printf 'an unknown number of')"
            problems="$problems
  $name is NOT running $ref
      running:  $actual
      expected: $expected
      $behind commit(s) behind"
            ;;
    esac
done <<<"$rows"

[ -z "$problems" ] || fail "what is deployed does not match the repository:$problems"
pass "$checked target(s) are running the commit they should ($TARGETS)"
