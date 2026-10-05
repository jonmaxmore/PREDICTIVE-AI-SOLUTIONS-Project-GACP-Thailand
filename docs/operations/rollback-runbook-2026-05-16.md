# Rollback Runbook — Iter 29 (2026-05-16)

**Audience:** on-call engineer, ops lead, anyone with prod SSH or `kubectl` access.

**Companion docs:**
- `docs/operations/deploy-checklist-2026-05-16.md` — pre/during/post deploy gates.
- `docs/operations/deploy-runbook.md` — long-form droplet runbook (historical).
- `scripts/deploy-prod.sh` / `scripts/deploy-prod.ps1` — the harness this runbook reverses.

---

## 1. When to roll back

Roll back when ANY of the following holds for more than 5 minutes after a deploy:

| Condition | Signal | Threshold |
|---|---|---|
| **Total outage** | `/api/health` returns 5xx or times out | 5 min |
| **Partial outage** | Synthetic monitor on critical journey (login, certificate lookup, payment) red | 5 min |
| **Data corruption** | New migration wrote bad rows OR pipelines emitting wrong data | **immediate** |
| **Security incident** | Disclosure / authn bypass / PII leak attributable to the new code | **immediate** |
| **Error-rate spike** | Sentry error rate > 3x rolling 24h baseline | 10 min |
| **Performance regression** | p95 latency > 2x baseline on a hot endpoint | 15 min |

Do **NOT** roll back for:

- Single-user issues (handle via support).
- Frontend-only cosmetic regressions (forward-fix; rollback churn isn't worth it).
- Logging/observability gaps (forward-fix; rollback wastes the bake-in).

When unsure, **declare an incident first**, then decide rollback vs. forward-fix in the incident channel.

---

## 2. Decision tree (first 5 min)

```
[Deploy completed] ──► [Smoke red?] ──Yes──► ROLLBACK (this runbook)
                          │
                          No
                          ▼
                    [Sentry spike?] ──Yes──► triage 5 min; if not pinpointed → ROLLBACK
                          │
                          No
                          ▼
                    [Customer reports?] ──Yes──► triage 5 min; if widespread → ROLLBACK
                          │
                          No
                          ▼
                       monitor 15 min, then sign off (deploy-checklist)
```

---

## 3. Application rollback procedure

The platform deploys **immutable container images** tagged by git SHA. Rollback means
**pointing the orchestrator at the previous image tag**, not building a new artifact.

### 3.1 Identify the previous-good SHA

```bash
# The harness wrote it during deploy:
cat /tmp/gacp-rollback-sha
#  → abc1234deadbeef0000...

# OR from the deploy log:
ls -t /var/log/gacp-deploys/ | head -3
grep 'pulling tag' /var/log/gacp-deploys/<previous-deploy>.log
```

### 3.2 Re-run deploy with the previous tag (image-based path)

```bash
# Docker Compose target:
IMAGE_TAG=sha-abc1234 NODE_ENV=production ./scripts/deploy-prod.sh

# Kubernetes target:
kubectl -n production set image deployment/gacp-backend backend=ghcr.io/jonmaxmore/gacp-backend:sha-abc1234
kubectl -n production rollout status deployment/gacp-backend --timeout=300s

# Or use kubectl rollout undo (if previous ReplicaSet is still retained):
kubectl -n production rollout undo deployment/gacp-backend
kubectl -n production rollout status deployment/gacp-backend --timeout=300s
```

### 3.3 Git-state rollback (for hosts deploying from source)

```bash
ssh root@<prod-host>
cd /opt/gacp-platform
git fetch origin
git reset --hard "$(cat /tmp/gacp-rollback-sha)"
# Re-run the harness so post-rollback smoke confirms the previous-good image is live:
NODE_ENV=production SKIP_BUILD=true SKIP_MIGRATE=true ./scripts/deploy-prod.sh
```

### 3.4 Confirm rollback

```bash
curl -sf https://api.gacpth.com/api/health
curl -sf https://api.gacpth.com/api/health/ready
curl -sf https://api.gacpth.com/api/version  # should show the previous SHA
```

All three must return 200. If `ready` returns 503, see §6 troubleshooting.

---

## 4. Database rollback — why we do NOT

**Forward-only migrations is a policy, not a bug.** We do not run `prisma migrate
resolve --rolled-back <name>` or restore a pre-deploy `pg_dump` as part of routine rollback.

Reasons:

1. **Schema reversibility is unsafe.** Many migrations are non-reversible by construction
   (column adds with non-null backfills, type widenings, enum value additions, FK additions
   after data backfill). A `DROP COLUMN` that "reverses" a previous `ADD COLUMN` will destroy
   any rows written by the new code in the window between deploy and rollback.
2. **Live data exists in the new schema.** Even a 60-second deploy window can write rows
   that depend on a new column. Reversing the migration would delete that data silently.
3. **The new code SHOULD tolerate the old schema for one release.** PR review enforces:
   migrations are written so the **previous** image keeps booting against the new schema.
   This is what makes rolling back the IMAGE while keeping the SCHEMA forward safe.

### When a migration MUST be reversed

If forensics show the new migration is the root cause (corrupted FK, wrong default,
orphaned rows), this is **not a rollback — it is an incident**:

1. Stop traffic to the affected service (k8s: `scale --replicas=0`, compose: `stop`).
2. Open an incident (`#gacp-incidents`); designate an Incident Commander.
3. The **DBA on-call** writes a NEW forward-only migration that corrects the bad state.
   The reversal goes through the SAME PR review process as any other migration — no
   ad-hoc psql against production.
4. Take a fresh `pg_dump` BEFORE running the corrective migration so the next responder
   has a stable point-in-time backup.
5. Apply via the normal deploy harness, not a manual `prisma migrate deploy`.

Backups are for **disaster recovery** (corrupted volume, ransomware, regional outage),
not for routine rollback. The latest pg_dump path: `/var/backups/gacp/gacp-pre-deploy-*.sql.gz`.

---

## 5. Communication plan

Announce rollback **before** running it, so the support + customer-success teams stop
escalating cases that the rollback will incidentally fix.

| Audience | Channel | When | Template |
|---|---|---|---|
| Engineering on-call + ops | `#gacp-incidents` Slack | Immediately on decision | "Rolling back deploy {SHA→prev-SHA} due to {symptom}. ETA 5 min." |
| Customer Success | `#cs-platform` Slack | Within 60 s of decision | "Heads-up: rolling back, expect 30–60s blip. Hold escalations until ALL-CLEAR." |
| Public status page | status.gacpth.com | If outage > 5 min already | "Investigating elevated errors. Mitigation in progress." → "Resolved" after smoke green. |
| DTAM contact (state side) | Email `audit-ops@dtam.gov.th` | Only if certificate / e-Filing flow affected | Use template in `docs/operations/handoff-2026-04.md` §4 |
| Leadership | `#gacp-leadership` Slack | After rollback completes | Brief: cause hypothesis, scope, next-steps |

Rule of thumb: **announce → execute → confirm → close-out**, in that order. Do not run
the rollback before the announce so observers know spike-then-recover is expected.

---

## 6. Post-rollback verification

Run, in order:

```bash
# 1. Liveness + readiness
curl -sf https://api.gacpth.com/api/health
curl -sf https://api.gacpth.com/api/health/ready

# 2. Version pin (must equal previous-good SHA)
curl -s https://api.gacpth.com/api/version | jq .commit

# 3. Critical journeys (synthetic checks)
node scripts/test/run-chaos-journey-check.js
node scripts/ci/check-health-login-readiness.js

# 4. Error rate — Sentry "Issues" view, last 5 min, should trend DOWN
# 5. p95 latency — Grafana dashboard "GACP Backend", last 15 min
```

If any of (1)–(3) fail, the rollback itself failed. Escalate to platform lead, do
**not** attempt a second rollback without coordination.

---

## 7. Post-mortem template

File at `docs/incidents/postmortem-YYYY-MM-DD-<short-slug>.md` within **5 business days**
of the rollback. Required fields:

```markdown
# Incident: <short title>

**Date:** YYYY-MM-DD
**Duration:** start → end (Asia/Bangkok)
**Severity:** SEV-1 / SEV-2 / SEV-3
**Incident Commander:** name
**Author:** name

## Summary
One paragraph: what broke, who noticed, how we recovered.

## Impact
- Users affected: N (% of DAU)
- Journeys affected: list
- Financial impact (if any): THB
- Data integrity: confirmed / suspected / unknown

## Timeline (Asia/Bangkok)
- HH:MM — deploy SHA <abc1234> went live
- HH:MM — first synthetic alert (which monitor?)
- HH:MM — incident declared by <name>
- HH:MM — rollback initiated
- HH:MM — rollback verified, ALL-CLEAR posted

## Root cause
Specific code/config/data change + WHY existing gates missed it.

## What went well
- (signal-detection, comms, rollback ergonomics, etc.)

## What went poorly
- (gaps, friction, escalation delays)

## Action items
- [ ] Owner — concrete fix (with PR link if filed)
- [ ] Owner — gate to prevent recurrence
- [ ] Owner — observability gap to close

## Lessons learned
Plain-language takeaways for the team channel.
```

Action items must each have a single named owner and a target date. "Team will look
into this" is not an action item.

---

## 8. Appendix — known-safe rollback boundaries

Rolling forward from these SHAs to current is always safe (manually verified for
backward image-compat with the live schema):

| Cutover date | Last-safe previous SHA | Notes |
|---|---|---|
| 2026-05-16 | (current iter)         | Iter 29 — first publication of this doc |
| 2026-04-30 | sha-<TBD>              | Slip-flow Phase 1 schema cut; image-based rollback fully validated |

Maintain this table on every deploy that touches the schema.
