# Production Deploy Checklist — Iter 29 (2026-05-16)

**Audience:** the engineer pressing the deploy button. Print or screenshot before
each prod cut.

**Companion docs:**
- `docs/operations/rollback-runbook-2026-05-16.md` — what to do if anything below goes wrong.
- `scripts/deploy-prod.sh` / `scripts/deploy-prod.ps1` — the harness this checklist gates.

Every box on this checklist is GREEN before traffic is cut. Any RED box means
HALT and follow the linked recovery path.

---

## A. Pre-deploy (T-30 min)

Run from the deployer's laptop or the CI runner before promoting to production.

### A.1 Repository state

- [ ] On `main` and pulled latest: `git checkout main && git pull --ff-only`.
- [ ] PR for this deploy is **merged and on `main`** — not on a feature branch.
- [ ] Working tree is clean: `git status` returns nothing.
- [ ] CI on the target SHA is **green** in `.github/workflows/ci.yml` (all jobs).

### A.2 Quality gates (must all pass locally OR be green on CI)

- [ ] `pnpm test` — unit + integration tests pass.
- [ ] `pnpm lint` — zero new ESLint warnings (`scripts/ci/check-no-new-eslint-warnings.js`).
- [ ] `pnpm check:prisma-migration-consistency` — migrations match `schema.prisma`.
- [ ] `pnpm check:infra-contracts` — no infra-contract drift.
- [ ] `pnpm check:production-topology` — production-topology guard green.

### A.3 Secrets + config

- [ ] `node apps/backend/scripts/check-secrets.js --env=production` exits **0**
      (or, if you're not on the prod host, the equivalent CI step is green).
- [ ] Any **new** secret introduced this iter is added to
      `apps/backend/config/secrets.js` AND populated in the prod secret manager.
- [ ] `.env.production` on the prod host has no `PENDING_FINANCE_CONFIRMATION`
      sentinel values (these count as missing per Iter 27).

### A.4 Migration review

- [ ] If the PR introduced a Prisma migration, the migration is **forward-only
      compatible with the previous image** (per rollback-runbook §4 policy).
      Two reviewers initialed the PR description's "migration-safety" box.
- [ ] A fresh PostgreSQL backup has been taken within the last hour:
      `ls -lt /var/backups/gacp/ | head -1` shows a recent `.sql.gz`.

### A.5 Communication

- [ ] Posted in `#gacp-deploys`: "Cutting prod deploy {SHA} at {time}. Watch
      window: 15 min." Tag on-call + ops lead.
- [ ] Customer Success notified if the deploy touches any user-visible journey.
- [ ] If a maintenance window is required (e.g. multi-step schema change),
      status page banner is **live BEFORE** the deploy starts.

---

## B. Deploy (T-0)

### B.1 Staging first (always)

- [ ] Run `NODE_ENV=production ./scripts/deploy-prod.sh` against the **staging-
      prod** environment first. Confirm:
    - [ ] Liveness `/api/health` returns 200.
    - [ ] Readiness `/api/health/ready` returns 200.
    - [ ] `/api/version` returns the new SHA.
    - [ ] Synthetic journey suite green: `node scripts/test/run-chaos-journey-check.js`.
- [ ] Soak on staging for **at least 10 minutes** while watching Sentry.

### B.2 Production cut

- [ ] Capture the previous-good SHA: it is also written by the harness to
      `/tmp/gacp-rollback-sha`, but **also paste it into the deploy channel**
      so it is preserved if the file is wiped.
- [ ] Run the harness against production:

  ```bash
  NODE_ENV=production ./scripts/deploy-prod.sh
  # or for k8s:
  NODE_ENV=production DEPLOY_TARGET=k8s KUBE_DEPLOYMENT=gacp-backend KUBE_NAMESPACE=production ./scripts/deploy-prod.sh
  ```

- [ ] Harness exits 0 (any non-zero → STOP, jump to the rollback runbook).

### B.3 Traffic ramp strategy

Production runs **rolling restart**, not canary. The orchestrator drains old
pods/containers as the new ones become ready. The harness waits for
`/api/health` to return 200 from at least one new instance before declaring
success. If finer-grained ramp is needed (large schema cut, new framework
version):

- [ ] Optional: scale new ReplicaSet to **1 pod** behind a 5% traffic split
      via the ingress (requires manual nginx/ingress edit; coordinate with ops).
- [ ] Soak at 5% for **10 min**, then ramp to 50% (soak 10 min), then 100%.
- [ ] At each step, confirm error rate < 0.1% in Sentry and p95 latency within
      ±15% of baseline.

---

## C. Post-deploy (T+0 to T+15 min)

### C.1 Smoke (within first 60 s)

- [ ] `curl -sf https://api.gacpth.com/api/health` returns 200.
- [ ] `curl -sf https://api.gacpth.com/api/health/ready` returns 200.
- [ ] `curl -s https://api.gacpth.com/api/version | jq` shows the **new** SHA.
- [ ] Login a real test account in each portal (member / provider / admin) — no
      500s in the network tab.

### C.2 Dashboard watch (T+5 to T+15 min)

- [ ] Sentry "Issues" view: no new spike in errors for the deploy window.
- [ ] Grafana "GACP Backend" dashboard:
    - [ ] p50 latency within ±10% of pre-deploy baseline.
    - [ ] p95 latency within ±20% of pre-deploy baseline.
    - [ ] 5xx rate < 0.1% across all routes.
- [ ] Customer Success has **zero** new tickets attributable to the deploy.

### C.3 Sign-off (T+15 min)

- [ ] Post in `#gacp-deploys`: "Deploy {SHA} ALL-CLEAR, 15-min soak green."
- [ ] Update the rollback-runbook "known-safe rollback boundaries" table if
      this deploy moved the schema cut line.
- [ ] If anything was hand-fixed during deploy (one-off psql, manual config
      tweak), file a follow-up ticket within 24h so the next deploy doesn't
      regress on the implicit assumption.

---

## D. Halt conditions

**Stop the deploy immediately** and jump to the rollback runbook if at any point:

- The harness exits non-zero.
- `/api/health` returns non-200 for > 60 s.
- A new error class appears in Sentry at > 10 events/min.
- A Customer Success agent reports a confirmed multi-tenant impact.
- A security alert fires in the deploy window.

---

## E. Quick reference — exit codes

| Code | Phase                  | First responder action |
|------|------------------------|------------------------|
| 0    | success                | continue to §C         |
| 10   | pre-flight failed      | DO NOT deploy; fix env / secrets / git state |
| 20   | build failed           | DO NOT deploy; investigate locally first      |
| 30   | migration failed       | rollback-runbook §4 — DBA on-call required    |
| 40   | smoke failed           | rollback-runbook §3 — immediate rollback      |
| 50   | orchestrator notify    | rollback-runbook §6 — verify nothing rolled   |
| 60   | post-deploy verify     | investigate; rollback if ready stays 503      |

---

## F. Sign-offs (this deploy)

- Deploy engineer: ____________________________  date: ______
- On-call reviewer: ____________________________  date: ______
- Ops lead (after sign-off, async OK): __________  date: ______
