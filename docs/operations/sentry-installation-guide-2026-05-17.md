> **SUPERSEDED 2026-10-02.** Sentry was re-added with PII scrubbing; the code this guide names (`shared/production-logger.js`, `sentry.*.config.ts`, `withSentryConfig`) does not exist. Use `docs/operations/sentry-error-tracking.md`.

# Sentry Installation Guide — 2026-05-17 (consumer-facing ops setup)

> **Audience:** ops engineer / on-call provisioning Sentry projects + DSNs before T-3.
> **Companion docs:**
> - `docs/operations/sentry-alert-rules-2026-05-17.md` (W5-A) — the 5 alert rules to provision in the Sentry dashboard after installation completes
> - `docs/operations/cutover-checklist-2026-05-17.md` §4 — secrets list including `SENTRY_DSN`
> - `docs/operations/docker-localhost-smoke-runbook-2026-05-17.md` step 7 — verification that the 5 alert rules fire under synthetic chaos
> - `docs/handoffs/iter-W5/W5-A.md` — backend Sentry SDK install (where `@sentry/node` is wired)
> - `docs/handoffs/iter-W5/W5-B.md` — web-app Sentry SDK install (where `@sentry/nextjs` is wired)
> - `apps/backend/shared/production-logger.js` — backend Sentry init site
> - `apps/web-app/sentry.{client,server,edge}.config.ts` — web-app Sentry init sites (W5-B-shipped)

This guide is the **provisioning runbook**. The code-side work (install `@sentry/node` + `@sentry/nextjs`, wire `production-logger.js`, wrap `next.config.ts` with `withSentryConfig`) is already done by Loop W (W5-A backend + W5-B web-app). The ops engineer's remaining job is:

1. Create the 2 Sentry projects (`gacp-backend` + `gacp-web-app`) in Sentry Cloud (or self-hosted Sentry).
2. Copy each project's DSN to the production secret manager as `SENTRY_DSN`.
3. Provision the 5 alert rules per `docs/operations/sentry-alert-rules-2026-05-17.md`.
4. Verify event ingestion via the Docker smoke runbook (`docker-localhost-smoke-runbook-2026-05-17.md` step 3 + 7).

The Loop W code-complete sign-off (`docs/operations/loop-w-2026-05-17-sign-off.md`) §6 row "Sentry installed" depends on ops completing this guide before the 7-role initials are collected.

---

## 1. Pre-requisites

| Requirement | How to verify | Notes |
|-------------|---------------|-------|
| Sentry Cloud (or self-hosted) account | Login to https://sentry.io OR your self-hosted Sentry URL | Self-hosted Sentry must be at v23+ (Sentry SDK v8 requires modern protocol) |
| Organisation owner / admin role | "Settings → Members" page shows your role as `owner` or `admin` | Required to create projects + alert rules |
| Production secret manager access | `kubectl get secret gacp-prod-secrets -o yaml` (or equivalent) | The `SENTRY_DSN` env var is loaded by both backend + web-app via this manager |
| PagerDuty integration (or replacement) | "Settings → Integrations → PagerDuty" shows green | The 5 alert rules in W5-A's doc page DPO/Eng/Ops via PagerDuty escalation |
| W5 commit on `main` | `git log -1 --oneline` shows the W5 SHA | Sentry SDK code is only present at W5 commit and later |

---

## 2. Create Sentry projects

In Sentry Cloud (or self-hosted Sentry):

### 2.1 Backend project

1. Navigate to "Projects → Create Project".
2. Platform: **Node.js**.
3. Project name: `gacp-backend`.
4. Team: assign to the engineering on-call team (e.g. `#gacp-eng`).
5. Click "Create Project".
6. Copy the DSN displayed on the next page. It looks like:
   ```
   https://abc123...@o123456.ingest.sentry.io/7890123
   ```
   (For self-hosted: the hostname is your self-hosted Sentry URL, not `o123456.ingest.sentry.io`.)

### 2.2 Web-app project

1. Repeat the steps above with:
2. Platform: **Next.js**.
3. Project name: `gacp-web-app`.
4. Team: same engineering team as backend.
5. Copy the DSN.

> **Note:** the 2 projects MAY share a single DSN if you prefer (the SDKs auto-tag events with `runtime` / `platform`), but the recommended pattern is 2 separate DSNs so error rate alerts can be sliced per-tier. Loop W's W5-A and W5-B both read `process.env.SENTRY_DSN`, so if you want separate DSNs you set the env var to different values in the backend service vs. the web-app service.

---

## 3. Populate the production secret manager

Add the following env vars to your production secret manager (e.g. Kubernetes Secret `gacp-prod-secrets`, Vault, AWS Secrets Manager, etc.):

```yaml
# REQUIRED (post-W5-A — `required: 'production'`)
SENTRY_DSN: "https://abc...@o123456.ingest.sentry.io/7890123"

# RECOMMENDED (optional, not required by validator; defaults to NODE_ENV)
SENTRY_ENVIRONMENT: "production"

# RECOMMENDED (optional, set to deploy SHA for release tracking)
SENTRY_RELEASE: "<deploy-sha>"
```

> **PDPA stance:** Loop W deliberately leaves **session replay OFF by default** (W5-B does not enable `replaysSessionSampleRate` in `sentry.client.config.ts`). Reason: session replay captures DOM mutations + user inputs, which may include sensitive personal data subject to PDPA ม.6 (data minimisation). DPO sign-off required BEFORE enabling replay. See `docs/operations/loop-w-2026-05-17-sign-off.md` §10 row "DPO".

> **Per I-014:** the Loop W test helper `apps/backend/__tests__/unit/deploy-prod-check-secrets.test.js` now includes `'SENTRY_DSN'` in `PRODUCTION_REQUIRED_KEYS` AND `buildValidProductionEnv()` returns a stub `SENTRY_DSN: 'https://stub@stub/0'`. The stub is for the test harness only — production MUST use the real DSN from §2.

After populating the secret manager:

```bash
# Verify backend will boot with the new secret
node apps/backend/scripts/check-secrets.js --env=production
# Expected: exit 0; no "MISSING" errors.

# If you see: "SENTRY_DSN missing in production" → re-check the secret manager + restart the pod.
```

---

## 4. Provision the 5 alert rules

Open `docs/operations/sentry-alert-rules-2026-05-17.md` (W5-A deliverable). For each of the 5 rules:

1. Navigate to "Alerts → Create Alert Rule" in the Sentry project.
2. Choose the alert type per the doc:
   - Rule #1 — "Issue Alert" (event count threshold)
   - Rule #2 — "Metric Alert" (p95 transaction duration)
   - Rule #3 — "Issue Alert" with custom tag filter `audit_action:BREACH_RECORDED`
   - Rule #4 — "Issue Alert" with custom tag filter on `REDIS_DEDUPE_MISS` log pattern
   - Rule #5 — "Issue Alert" with exception type filter `RECEIPT_SEQUENCE_DB_UNAVAILABLE`
3. Set the threshold per the doc (e.g. rule #1: `event.count > 5 in 5 minutes`).
4. Set the page recipients per the doc's "Page recipients" column (PagerDuty escalation routing).
5. Save the alert rule.

Repeat for `gacp-web-app` project where applicable (rules #1 + #2 apply to web-app; rules #3-#5 are backend-specific).

---

## 5. Verify event ingestion

### 5.1 Backend smoke

Trigger a test error from the backend:

```bash
# From a local shell with the production-shaped Docker stack running (per docker-localhost-smoke-runbook-2026-05-17.md step 2):
curl -X POST http://localhost:8080/api/test/sentry-trigger -H "Content-Type: application/json" -d '{}'
# (If the test endpoint is not present, use any 5xx-throwing route instead — backend's error middleware reports to Sentry via production-logger.js)
```

Open Sentry Cloud → `gacp-backend` project → "Issues". You should see the test event within 30 seconds. If not:
- Check the backend pod's env: `kubectl exec gacp-backend -- env | grep SENTRY_DSN` — should show the DSN populated.
- Check `production-logger.js` is the active logger: `kubectl logs gacp-backend | head -20` — should show "Sentry initialised" or similar boot message in NODE_ENV=production.

### 5.2 Web-app smoke

Trigger a test error from the browser:

```javascript
// In the browser console at https://localhost/ (with the local-prod Docker stack):
throw new Error("sentry-smoke-test from " + new Date().toISOString());
```

Open Sentry Cloud → `gacp-web-app` project → "Issues". You should see the test event within 30 seconds.

### 5.3 Alert rule fire-check

Per `docker-localhost-smoke-runbook-2026-05-17.md` step 7, the chaos check exercises rules #1/#3/#4/#5. After running step 7, verify in Sentry that each rule's "Recent Triggers" timeline shows a fire event in the last hour.

---

## 6. Rollback / removal

If Sentry needs to be removed (e.g. you switch to a different APM):

1. Set `SENTRY_DSN` to empty string in the production secret manager.
2. Re-deploy the backend + web-app pods.
3. `production-logger.js` will silently degrade (skip Sentry init) per the W5-A retained behaviour — events will simply not be sent.
4. To remove the SDK entirely, revert the W5-A + W5-B commits — but DO NOT do this without an alternative APM in place; the cutover-checklist §6 lists Sentry as required for error tracking + the 5 alert rules.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Backend boot crashes with `MODULE_NOT_FOUND: @sentry/node` | `pnpm install` not run after W5 commit OR `@sentry/node` removed from `apps/backend/package.json` | Re-run `pnpm install --filter @gacp/backend`; verify `@sentry/node` is in `dependencies` (NOT `devDependencies`) |
| Backend events not appearing in Sentry, no errors in logs | `SENTRY_DSN` env var not set OR wrong DSN | `node apps/backend/scripts/check-secrets.js --env=production` — must exit 0 |
| Backend events appearing but tagged with environment `test` instead of `production` | `SENTRY_ENVIRONMENT` not set; defaults to `NODE_ENV` which may be `test` in the pod | Set `SENTRY_ENVIRONMENT=production` explicitly in the secret manager |
| Web-app: `withSentryConfig` build error during `next build` | `@sentry/nextjs` version mismatch with Next 15.5.x | Verify `@sentry/nextjs` ≥ 8.x; older versions may not support Next 15 |
| Web-app: source maps not uploading at build time | `SENTRY_AUTH_TOKEN` not set (Sentry CLI needs it for source-map upload) | Set `SENTRY_AUTH_TOKEN` in CI env; see Sentry's auth-tokens dashboard |
| Alert rule #3 (`BREACH_RECORDED`) never fires even when a breach is recorded | Tag `audit_action` not being set on the Sentry event | Verify `breach-notification-service.recordBreach` calls `Sentry.captureMessage(..., { tags: { audit_action: 'BREACH_RECORDED' } })` — see W5-A `production-logger.js` integration |
| Sentry quota exceeded | Default Sentry Cloud free tier is 5K events/month; production load can exceed this | Upgrade Sentry plan OR set `tracesSampleRate: 0.05` (5% sampling) in `sentry.server.config.ts` |

---

## 8. Sentry-side hardening checklist

Before declaring Sentry ready for production:

- [ ] Both projects (`gacp-backend` + `gacp-web-app`) created.
- [ ] DSNs copied into production secret manager.
- [ ] All 5 alert rules per `sentry-alert-rules-2026-05-17.md` provisioned + tested.
- [ ] PagerDuty integration green; test page from Sentry → PagerDuty receives.
- [ ] Quota / event budget reviewed (default 5K/mo is insufficient for prod scale).
- [ ] PII scrubbing enabled in Sentry project settings → Security & Privacy → "Strip data" (PDPA compliance).
- [ ] Session replay confirmed OFF (W5-B leaves it OFF; DPO sign-off required to enable).
- [ ] Source-map upload working: `SENTRY_AUTH_TOKEN` in CI env; source maps appear in Sentry "Releases" tab after deploy.
- [ ] Test event from staging-prod env ingests successfully into both projects.
- [ ] Backend `production-logger.js` confirmed to call `Sentry.captureException(err)` on unhandled errors (verify in Sentry "Issues" tab after triggering a test error).

---

## References

- **W5-A backend handoff:** `docs/handoffs/iter-W5/W5-A.md`
- **W5-B web-app handoff:** `docs/handoffs/iter-W5/W5-B.md`
- **Sentry alert rule spec:** `docs/operations/sentry-alert-rules-2026-05-17.md`
- **Cutover checklist (re-swept):** `docs/operations/cutover-checklist-2026-05-17.md`
- **Docker smoke runbook:** `docs/operations/docker-localhost-smoke-runbook-2026-05-17.md`
- **Loop W sign-off (DRAFT):** `docs/operations/loop-w-2026-05-17-sign-off.md`
- **Backend Sentry init site:** `apps/backend/shared/production-logger.js`
- **Web-app Sentry init sites:** `apps/web-app/sentry.{client,server,edge}.config.ts` (W5-B-shipped)
- **Secrets catalog entry:** `apps/backend/config/secrets.js` (`SENTRY_DSN` row — bumped to `required: 'production'` by W5-A)
- **I-014 test helper update:** `apps/backend/__tests__/unit/deploy-prod-check-secrets.test.js` (`PRODUCTION_REQUIRED_KEYS` array includes `'SENTRY_DSN'`)
- **Sentry SDK docs (external):**
  - Node.js: https://docs.sentry.io/platforms/node/
  - Next.js: https://docs.sentry.io/platforms/javascript/guides/nextjs/

---

