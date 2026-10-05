# Monitoring stack — what's deployed vs aspirational

**Status as of 2026-04-29:** the production droplet (203.0.113.10)
runs a **subset** of the monitoring stack defined in this directory.
This README is the honest map of which configs are live and which are
reference templates for future work.

## What's actually running on prod

Defined in `/opt/gacp-platform/docker-compose.production.yml`:

| Service | Image | Purpose |
|---|---|---|
| **prometheus** | `prom/prometheus:latest` | Metrics scrape + storage |
| **node-exporter** | `prom/node-exporter:latest` | Host-level metrics |
| **cadvisor** | `gcr.io/cadvisor/cadvisor:latest` | Container metrics |
| **grafana** | `grafana/grafana:latest` | Dashboards (uses `monitoring/grafana/provisioning/`) |
| **loki** | `grafana/loki:2.9.6` | Log aggregation |
| **promtail** | `grafana/promtail:2.9.6` | Log shipper (uses `monitoring/promtail/config.yml`) |

## What's aspirational (NOT deployed)

`monitoring/docker-compose.monitoring.yml` is a **separate, parallel
compose file** that defines a fuller stack. **It is never run on prod.**
The services it defines but the prod stack does NOT run:

| Service | Why not deployed | Action if needed |
|---|---|---|
| **alertmanager** | No SMTP / Slack / PagerDuty creds wired up; firing alerts to nowhere | Provision creds + add to `docker-compose.production.yml` + uncomment `alerting:` in `prometheus/prometheus.yml` |
| **postgres-exporter** | Postgres metrics low priority; node-exporter covers host disk/cpu/mem already | Add to `docker-compose.production.yml`, mount `pg_stat_statements` |
| **redis-exporter** | Redis metrics not yet a SLO concern; backend health endpoint is sufficient | Add to compose; expose `:9121` to prometheus only |
| **nginx-exporter** | nginx access logs already shipped to Loki via promtail | Add only when we need RPS / latency dashboards |
| **jaeger** | No tracing integration in backend code yet | Wire up `@opentelemetry/*` packages in backend first |

## Why keep the aspirational config in-tree?

Deleting would lose the reference template + force the next engineer
who wants alerting to start from scratch. Keeping clearly-marked
aspirational files is cheaper as long as:

1. This README stays accurate (review on each deploy doc update).
2. CI doesn't fail just because alertmanager isn't running.
3. Anyone reading the directory can tell "what runs" from "what's a
   future-blueprint".

## Decision-record (operator decision ช, 2026-04-29)

The 2026-04-28 server-hygiene audit asked whether to **deploy** or
**delete** the aspirational config. Operator answered: keep as
aspirational reference, do NOT block forward progress on alerting.

That means:
- The `production-readiness-check.js` no longer fails when this stack
  isn't running — it warns clearly that alertmanager + exporters are
  not deployed and cross-references this README.
- The 2026-04-28 server-hygiene audit's "alerts go nowhere" concern
  is acknowledged: there are no production alerts firing, so there
  is no false-confidence problem.
- Future "spike: production alerting" RFC can pick up from these
  templates when SLOs become real.
