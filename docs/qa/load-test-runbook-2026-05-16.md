# Load Test Runbook — Iter 29 (FINAL)

**Date:** 2026-05-16
**Owner:** QA (hardening loop, Iter 29)
**k6 script:** `scripts/load-test/scenarios.k6.js`

---

## Why this runbook exists

Iter 28 set capacity baselines for the production cutover:

- **1000 concurrent applicants** (HEALTH role, dashboard + form + slip upload)
- **50 concurrent staff** (REVIEWER, AUDITOR, SCHEDULER, ACCOUNT_PLATFORM)

This runbook tells whoever runs the test (typically the SRE on-call before a
release, or QA during a UAT pass) how to prepare, execute, and interpret a
k6 run against staging — and what to do when a threshold trips.

---

## 1. Pre-test checklist

Do these in order. Skipping a step has bitten us in past iterations
(monitoring noise during Iter 22 surfacing a non-issue, alert paging in
Iter 25 waking on-call at 03:00 for what was a planned drill).

### 1.1 Staging environment readiness

- [ ] Staging deploy is green and matches the production cutover candidate
      (`docker-compose.staging.yml` running the same image tag).
- [ ] Database migrations on staging match `prisma migrate status`.
- [ ] Seed data loaded: at least 1000 applications across HEALTH users, 50
      ACTIVE certificates for the verify scenario, 12 closed accounting
      periods (so `trial-balance` returns realistic row counts).
- [ ] Storage backend (MinIO / S3) reachable — slip uploads will fail
      otherwise.
- [ ] Redis up — rate-limiter falls back to in-memory, but that defeats
      the realism of the verify scenario which has a 30 req/IP/min cap.

### 1.2 Baseline metrics captured

Take a screenshot or copy the Prometheus URLs **before** starting the run.
Post-test, you compare against these baselines, not absolute numbers:

- [ ] CPU utilisation per pod (backend, frontend, postgres)
- [ ] DB connection pool size (`pg_stat_activity`)
- [ ] Redis hit rate
- [ ] Average request latency by endpoint (last 1h on Grafana)
- [ ] Open file descriptors per backend pod
- [ ] Disk IOPS on the Postgres volume

### 1.3 Monitoring + alerting

- [ ] Pause PagerDuty for the SRE on-call rota for the duration of the
      run + 30min (load-test alarms otherwise wake people up).
- [ ] Post in `#sre-staging` Slack: "Starting load test at HH:MM, expected
      duration 7min, hold any non-emergency deploys."
- [ ] Snapshot Grafana board `gacp-staging-overview` (download PNG) to
      preserve the "before" state.

### 1.4 Fixtures

- [ ] `APPLICANT_TOKEN` is a fresh JWT for the load-test fixture user
      (`smoke+load@gacp.dev`). Refresh if older than 1h.
- [ ] `ADMIN_TOKEN` is a fresh JWT for an ACCOUNT_PLATFORM fixture
      (`account-load@gacp.dev`).
- [ ] `CERT_NUMBER` resolves to an ACTIVE, non-revoked certificate in
      staging seed data.

---

## 2. How to run k6

### 2.1 Install k6 (one-time per workstation)

```bash
# macOS
brew install k6
# Ubuntu
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt-get update && sudo apt-get install k6
# Windows
choco install k6
# Docker (any platform)
docker pull grafana/k6:latest
```

### 2.2 Full run — all four scenarios in parallel

```bash
export BASE_URL=https://staging.gacp.dtam.go.th
export APPLICANT_TOKEN="$(./scripts/get-staging-token.sh health)"
export ADMIN_TOKEN="$(./scripts/get-staging-token.sh account_platform)"
export CERT_NUMBER=GACP-2026-001

k6 run scripts/load-test/scenarios.k6.js
```

Total wall-clock: ~7 minutes (longest scenario is slip_upload_spike at
1m + 30s + 5m + 30s = 7m).

### 2.3 Single scenario — for narrow regression checks

```bash
# Only the public verify scenario
k6 run --tag scenario=public_certificate_verify \
       --include-system-env-vars \
       scripts/load-test/scenarios.k6.js
```

### 2.4 With output to a metrics backend

```bash
# Prometheus remote-write (recommended for retained results)
k6 run --out experimental-prometheus-rw \
       -e K6_PROMETHEUS_RW_SERVER_URL=http://staging-prom:9090/api/v1/write \
       scripts/load-test/scenarios.k6.js

# Local JSON file (offline review)
k6 run --out json=load-test-results-$(date +%Y%m%d-%H%M).json \
       scripts/load-test/scenarios.k6.js
```

---

## 3. Interpreting results

k6 prints a summary table when the run ends. The headline rows:

```
http_req_duration..........: avg=NNNms  min=Nms  med=NNms  max=Ns  p(90)=NNNms  p(95)=NNNms  p(99)=Ns
http_req_failed............: x.xx%  ✓ count   ✗ failures
```

A run is **green** when k6 exits 0. That means every threshold in
`options.thresholds` passed:

| Scenario                       | P95 target | Error-rate target | Special |
|--------------------------------|-----------:|------------------:|---------|
| applicant_browsing             |    < 500ms |           < 0.1%  | — |
| slip_upload_spike              |  < 2000ms  |             < 1%  | no 5xx; slip-upload errors < 50 total |
| public_certificate_verify      |    < 200ms |           < 0.1%  | — |
| admin_reports (trial balance)  |  < 5000ms  |             < 1%  | — |

If any threshold is breached, k6 prints:

```
ERRO[NNN] thresholds on metrics 'http_req_duration{scenario:public_certificate_verify}' have been breached
```

The exit code is 99 (non-zero) — CI gates can rely on this.

### Common error patterns

- **Lots of 401/403**: tokens expired. Refresh and re-run.
- **Lots of 429**: rate-limiter is throttling. Either the scenario is mis-
  configured (e.g. one IP doing 500 verify req/s without Redis-backed
  shared counter) or the limiter ceiling is below the test target.
- **5xx cluster on slip_upload only**: storage backend is the bottleneck.
  Inspect MinIO / S3 metrics, not the API tier.
- **DB connection pool exhaustion**: visible as p99 latency cliff. Check
  `pg_stat_activity` for backends in 'idle in transaction'.

---

## 4. Bottleneck identification process

When the run goes red, work through this top-down:

1. **Which scenario tripped?** k6 names it in the breach line. Other
   scenarios may still be green.
2. **Which endpoint inside the scenario?** Check the `endpoint:` tag
   breakdown in the summary or in Grafana.
3. **Is it the API tier?** Look at backend pod CPU / memory.
   - **Yes**: profile with `node --prof` on a one-off run, or attach
     pprof. Look for hot syncronous CPU work (typically JSON parsing
     of large bodies or unnecessary serialisation).
4. **Is it the DB tier?** Check Postgres CPU + slow-query log.
   - **Hot table**: missing index. Run `EXPLAIN ANALYZE` on the slowest
     query you find in `pg_stat_statements`.
   - **Hot row**: lock contention. Check `pg_locks`.
5. **Is it the network / proxy tier?** Nginx access logs will show
   request times >> backend service times. Tune keepalive / worker
   processes if so.
6. **Is it a downstream service?** Slip uploads call OCR + fraud
   detection. Those have their own latency. The slip_upload p95 budget
   is generous (2000ms) precisely because of these dependencies.

Document the finding in `docs/qa/load-test-runs/<date>-<reason>.md`
with the breach line, the Grafana screenshot, and the remediation.

---

## 5. Capacity planning baselines

These are the numbers Iter 28 committed to. They drive autoscaling
thresholds and the HPA configuration in `infra/k8s/hpa/*.yml`.

### Sustained load — production target

| Metric                              |   Target |   Stress |
|-------------------------------------|---------:|---------:|
| Concurrent HEALTH applicants        |     1000 |     2500 |
| Concurrent staff (REVIEWER+AUDIT+ACCT) |    50 |      100 |
| Public verify rps (peak hour)       |      500 |     1500 |
| Slip uploads / day (peak)           |    5,000 |   12,000 |
| Trial-balance queries / day         |       50 |      150 |

### Backend pod sizing — staging baseline

| Service     | Replicas | CPU req | CPU lim | RAM req | RAM lim |
|-------------|---------:|--------:|--------:|--------:|--------:|
| api         |        3 |    500m |   2000m |   512Mi |  2048Mi |
| frontend    |        2 |    200m |    500m |   256Mi |   512Mi |
| postgres    |        1 |   1000m |   4000m |  2048Mi |  8192Mi |
| redis       |        1 |    100m |    500m |   256Mi |   512Mi |
| minio       |        2 |    200m |   1000m |   512Mi |  1024Mi |

If the load test exceeds these thresholds for the **target** column,
production sizing is good. If it can only barely meet target on staging,
scale prod up by 1 replica per service before cutover.

---

## 6. Post-run cleanup

- [ ] Re-enable PagerDuty for SRE on-call.
- [ ] Post in `#sre-staging`: "Load test complete, results: [link]"
- [ ] Archive the JSON output (if used) to `docs/qa/load-test-runs/`.
- [ ] If a regression was found, file a ticket linking the breach line
      and the Grafana snapshot — assign to the owning service team.
- [ ] Reset the load-test fixture user's data via `scripts/test/agent-
      application.js` so the next run starts from a known state.

---

## 7. References

- Iter 28 capacity baseline: `docs/qa/iter-28-capacity-baseline-2026-05-16.md`
  (sibling Iter; if missing, ask Iter 28 owner)
- Smoke test runbook: `docs/qa/smoke-test-runbook-2026-05-16.md`
- k6 docs: https://k6.io/docs/
- k6 scenarios reference: https://k6.io/docs/using-k6/scenarios/
- Prometheus remote-write output: https://k6.io/docs/results-output/real-time/prometheus-remote-write/
