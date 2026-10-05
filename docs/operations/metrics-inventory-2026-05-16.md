# GACP Metrics Inventory - Iter 29

**Effective Date**: 2026-05-16
**Owner**: SRE on-call
**Scope**: Prometheus metrics referenced by the Iter 29 dashboards and alert rules.

Read-only inventory. Iter 29 does NOT add instrumentation - this doc lists what should be emitted by backend code in a subsequent iteration so the dashboards and alerts in this iter become live.

Status legend:
- `EMITTED` - metric is already produced by `apps/backend/**` today
- `PLANNED` - dashboard/alert references it; instrumentation TODO
- `EXPORTER` - produced by a third-party exporter (node_exporter, pg_exporter, etc.)

---

## 1. HTTP Layer

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `http_requests_total` | counter | `job`, `method`, `handler`, `status` | Express middleware (prom-client) | PLANNED |
| `http_request_duration_seconds` | histogram | `job`, `method`, `handler`, `status` | Express middleware (prom-client) | PLANNED |
| `rate_limit_hit_total` | counter | `route`, `source_ip` | express-rate-limit hook | PLANNED |

Where to add in code: `apps/backend/src/middleware/metrics.ts` (TODO, do not touch in Iter 29).

---

## 2. Database

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `db_query_duration_seconds` | histogram | `model`, `action` | Prisma middleware (`prisma.$use`) | PLANNED |
| `pg_up` | gauge | (no labels) | postgres_exporter | EXPORTER |
| `pg_stat_activity_count` | gauge | `state` | postgres_exporter | EXPORTER |
| `pg_stat_statements_mean_exec_time` | gauge | `query` | postgres_exporter | EXPORTER |
| `pg_replication_lag` | gauge | `instance` | postgres_exporter | EXPORTER |

---

## 3. Application Domain - Applications & Certificates

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `gacp_applications_total` | gauge | `status` | Backend cron snapshot every 60s | PLANNED |
| `gacp_applications_submitted_total` | counter | (none) | Application submit handler | PLANNED |
| `gacp_certificates_issued_total` | counter | `cert_type` | Certificate issuance service | PLANNED |
| `gacp_active_sessions` | gauge | (none) | Auth service - count non-expired refresh tokens | PLANNED |

---

## 4. Finance (Iter 25/26)

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `payment_slip_pending_count` | gauge | (none) | Slip review service - cron count of PENDING | PLANNED |
| `payment_slip_decision_total` | counter | `decision` (APPROVED/REJECTED/REQUEST_INFO) | Slip review handler | PLANNED |
| `vat_output_current_period_thb` | gauge | (none) | Finance reporting service | PLANNED |
| `vat_period_uncloseable` | gauge | `period` | Period close pre-check | PLANNED |
| `invoice_pending_count` | gauge | (none) | Finance reporting service | PLANNED |
| `invoice_ar_aging_thb` | gauge | `bucket` (0_30, 31_60, 61_90, 90_plus) | Finance reporting service | PLANNED |
| `revenue_recognized_daily_thb` | gauge | (none) | Finance reporting service | PLANNED |

---

## 5. Audit Log (Iter 23)

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `audit_log_writes_total` | counter | `action`, `actor_role` | AuditLog write wrapper | PLANNED |
| `audit_log_write_errors_total` | counter | `error_class` | AuditLog write wrapper - catch path | PLANNED |

---

## 6. Security & Auth

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `auth_login_failed_total` | counter | `reason` (BAD_PASSWORD/UNKNOWN_USER/LOCKED), `source_ip` | Auth login handler | PLANNED |
| `jwt_verification_failed_total` | counter | `reason` (EXPIRED/INVALID_SIG/MALFORMED) | JWT middleware | PLANNED |
| `admin_force_status_total` | counter | `action` | Iter 28 admin tooling middleware | PLANNED |

---

## 7. PDPA (Iter 27)

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `pdpa_erasure_requests_total` | counter | `status` (RECEIVED/COMPLETED/REJECTED) | PDPA service | PLANNED |
| `pdpa_erasure_pending_over_30d_count` | gauge | (none) | PDPA service cron | PLANNED |
| `pdpa_consent_withdrawn_total` | counter | `purpose` | Consent service | PLANNED |
| `pdpa_breach_suspected_total` | counter | `trigger` | Security monitor | PLANNED |

---

## 8. Process / Runtime (Node.js)

| Metric | Type | Labels | Source | Status |
|--------|------|--------|--------|--------|
| `process_resident_memory_bytes` | gauge | (none) | prom-client default | EMITTED (if prom-client is mounted) |
| `process_cpu_seconds_total` | counter | (none) | prom-client default | EMITTED (if prom-client is mounted) |
| `nodejs_heap_size_used_bytes` | gauge | (none) | prom-client default | EMITTED (if prom-client is mounted) |

---

## 9. Infrastructure Exporters

| Metric | Type | Source | Status |
|--------|------|--------|--------|
| `node_cpu_seconds_total` | counter | node_exporter | EXPORTER |
| `node_memory_MemTotal_bytes` | gauge | node_exporter | EXPORTER |
| `node_memory_MemAvailable_bytes` | gauge | node_exporter | EXPORTER |
| `node_filesystem_avail_bytes` | gauge | node_exporter | EXPORTER |
| `node_filesystem_size_bytes` | gauge | node_exporter | EXPORTER |
| `redis_up` | gauge | redis_exporter | EXPORTER |
| `redis_memory_used_bytes` | gauge | redis_exporter | EXPORTER |
| `redis_memory_max_bytes` | gauge | redis_exporter | EXPORTER |
| `probe_ssl_earliest_cert_expiry` | gauge | blackbox_exporter | EXPORTER |

---

## 10. Instrumentation Backlog (next iter)

The following PLANNED metrics must be added by a future backend iteration:

1. Mount `prom-client` and `/metrics` endpoint on the backend (single PR).
2. Add Express middleware emitting `http_requests_total` + `http_request_duration_seconds`.
3. Add Prisma `$use` middleware emitting `db_query_duration_seconds`.
4. Wrap AuditLog writes with try/catch that increments `audit_log_writes_total` and `audit_log_write_errors_total`.
5. Add 60-second cron emitting application/slip/invoice gauges.
6. Auth handler increments login/JWT counters with `reason` and hashed `source_ip` labels.
7. PDPA service exposes erasure + consent counters.

**Ticket reference**: GACP-OBS-001 to GACP-OBS-007 (to be created in next iter).

---

## 11. Cardinality Notes

- `source_ip` labels on auth/rate-limit metrics: hash the IP (sha256 truncated to 8 hex chars) to keep cardinality bounded. Never label by raw IP.
- `handler` labels: use the route template (`/api/applications/:id`), not the resolved URL (`/api/applications/abc-123`). Express `req.route.path` gives the template.
- Avoid labels with unbounded user-controlled values (email, application UUID, etc.).

---

**Last reviewed**: 2026-05-16 (Iter 29)
**Next review**: when instrumentation PR lands.
