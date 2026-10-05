# Release Notes — Work Queue Rollout (2026-04-30)

**Status**: Live in production
**Production HEAD**: `10aa98c` (was `818a012` at session start)
**Droplet**: `203.0.113.20`
**Image tag**: `ghcr.io/jonmaxmore/gacp-{backend,frontend}:deploy-production-latest`
**Reference architecture**: `docs/adr/ADR-016-work-activity-tracking.md`

## What changed

13 PRs landed on 2026-04-30 implementing ADR-016 (BPMN-aligned work activity tracking) end-to-end across backend, both portals, admin, and manager surfaces.

| PR | Title | Diff |
|---|---|---:|
| #77 | ADR-016 Phase 1A-1D — Foundation | +5,000 |
| #78 | Phase 2 — Operator loops | +870 |
| #79 | Phase 3 — Combined done+advance | +563 |
| #80 | Phase 4 — Manager KPI dashboard | +693 |
| #81 | Phase 5 — KPI drill-down + CSV | +124 |
| #82 | Phase 6 — HEALTH activity visibility | +374 |
| #83 | Phase 7 — Notification preferences | +616 |
| #84 | Phase 8 — Slip-review states fix | +273 |
| #85 | Phase 9 — HEALTH UX wins | +113 |
| #86 | Phase 10 — Endpoint + CAR fix | +47 |
| #87 | Phase 11 — Dead-code cleanup | +9 / **−962** |
| #88 | Phase 12 — `/health/more` hub | +193 |
| #89 | Phase 13 — ADR-016 doc | +150 |

**Net total**: ~7,950 LOC net new, 0 production incidents.

## Migrations applied (in order)

```
20260430160000_create_work_activity_models
  - work_activities (per-tenant, RLS observe-only)
  - stage_activity_configs (global config + 8-row seed)
  - sla_policies (global config + 7-row seed)

20260430170000_add_work_activity_alert_timestamps
  - work_activities.warnedAt + breachedAt (cron dedup)

20260430180000_create_user_group_memberships
  - role_groups (5-row seed: admin / scheduler / document_reviewer / auditor / account)
  - user_group_memberships (M2M, per-tenant, RLS observe-only)
  - Backfill: 1 row per non-HEALTH user from User.role → 28 rows
```

All additive. Idempotent (`ON CONFLICT DO NOTHING` in seed/backfill blocks).

## New surfaces

### Provider portal (`/provider/*`)

| Path | Purpose |
|---|---|
| `/provider/work` + `/[id]` | Unified work queue (BPMN tasks). Claim, unclaim, mark done. URL filters: `?workType=`, `?state=`, `?group=`. |
| `/provider/applications/[id]` (existing) | New "งาน" tab showing the activity timeline for that application. |
| `/provider/management/users/[id]/groups` | Admin-only — manage M2M user-group memberships. |
| `/provider/settings/work-config` | Admin-only — edit `stage_activity_configs` + `sla_policies`. Bulk JSON export/import. |
| `/provider/analytics/work` | Admin + scheduler — KPI dashboard, drill-down to filtered queue, CSV export. |
| `/provider/profile/notifications` | Per-channel notification preferences. |

### HEALTH portal (`/health/*`)

| Path | Purpose |
|---|---|
| `/health/applications/[id]` (existing) | Activity timeline section showing redacted progress from staff. |
| `/health/applications` (existing) | Draft cancel button + revision/CAR deadline countdown badges + REJECTED_LAB retry banner. |
| `/health/profile/notifications` | Per-channel notification preferences. |
| `/health/more` | Discoverability hub for legit-feature orphans (training, sop-*, reports, etc.). |

### API endpoints

```
GET    /api/provider/work/my
GET    /api/provider/work/queue?{group,workType,state}
GET    /api/provider/work/:id
GET    /api/provider/work/:id/next-states          (Phase 3)
POST   /api/provider/work/:id/claim
POST   /api/provider/work/:id/unclaim
POST   /api/provider/work/:id/done                 (body: { note?, advanceStatus? })

GET    /api/provider/applications/:id/activities   (full internal view)
GET    /api/applications/:id/activities            (HEALTH redacted view)

GET    /api/provider/admin/work-config
POST   /api/provider/admin/work-config/stage-configs
PUT    /api/provider/admin/work-config/stage-configs/:id
DELETE /api/provider/admin/work-config/stage-configs/:id
PUT    /api/provider/admin/work-config/sla-policies/:workType
GET    /api/provider/admin/work-config/export
POST   /api/provider/admin/work-config/import      (upsert-only)

GET    /api/provider/admin/user-groups/:userId
POST   /api/provider/admin/user-groups/:userId
DELETE /api/provider/admin/user-groups/:userId/:groupCode

GET    /api/provider/analytics/work-kpis?days=N    (admin + scheduler only)

GET    /api/auth/{health,provider}/me/notification-prefs
PUT    /api/auth/{health,provider}/me/notification-prefs
```

## Cron jobs

| Schedule | Job | What it does |
|---|---|---|
| `0 * * * *` | sla-monitor (existing) | App-level overdue alerts |
| `15 * * * *` | revision-deadline-checker (existing) | Auto-cancel expired revisions |
| `30 * * * *` | **work-activity-sla-monitor** (new) | One warning + one breach per activity row, dedup via columns |
| `0 9 * * *` | sla-report (existing) | Daily summary |
| `0 0 * * *` | certificate-expiry (existing) | 30-day pre-expiry alerts |
| `0 10 * * 1-5` | slip-sla-monitor (existing) | Weekday morning slip overdue alerts |
| `30 0 * * *` | subscription-expiry (existing) | Subscription state transitions |
| `0 9 * * *` | subscription-auto-renewal (existing) | Pre-mint renewal invoices |

Total: 8 scheduled jobs registered on backend startup.

## Notification types added

```
WORK_ACTIVITY_ASSIGNED   (HIGH priority) — sent on claim
WORK_ACTIVITY_WARNING    (NORMAL)         — fired by cron when warningAt <= now
WORK_ACTIVITY_BREACH     (URGENT)         — fired by cron when dueAt <= now
```

All three respect the new per-user preferences (`User.notificationSettings.channels.<type>.{email,inApp,sms}`). Default-allow if not set.

## Deploy commands (already executed)

```bash
# 1. Pull image
docker compose --env-file .env.production -f docker-compose.production.yml \
  pull backend frontend

# 2. Apply migrations
docker exec gacp-backend sh -c \
  'npx prisma migrate deploy --schema=prisma/schema'

# 3. Recreate containers
docker compose --env-file .env.production -f docker-compose.production.yml \
  up -d --no-deps backend frontend

# 4. Verify health
curl -sS http://localhost:8080/api/health
docker logs gacp-backend --since=2m | grep "Started 8 scheduled jobs"
```

## Smoke tests passed (post-deploy)

- ✅ `/api/health` → 200
- ✅ Backend logs show "Started 8 scheduled jobs" (was 7 pre-deploy)
- ✅ All 3 migrations applied successfully via `npx prisma migrate deploy`
- ✅ DB tables seeded: `stage_activity_configs` = 8 rows, `sla_policies` = 7 rows, `role_groups` = 5 rows, `user_group_memberships` = 28 rows
- ✅ All new endpoints respond 401/403 for unauthenticated requests (auth gates working)
- ✅ All new pages return 307 redirect to login for unauthenticated (route exists + auth middleware engaged)

## What's NOT covered (still deferred)

1. **Subscription checkout integration** (Stripe/Omise/PromptPay) — `BILLING_FREE_TIER_FOR_ALL=true` makes everyone PREMIUM; real checkout still TODO at `web-app/src/app/health/subscription/client-view.tsx:113`.
2. **MFA enforcement** — `REQUIRE_MFA_FOR_PRIVILEGED=false`. Code path is ready; needs operator-side enrollment campaign before flipping the flag.
3. **Multi-group user assignments** — backfill produced 1 group per user (matching legacy `User.role`). Adding secondary group memberships (e.g. AUDITOR + DOCUMENT_REVIEWER for the same user) is now a 3-click admin task at `/provider/management/users/[id]/groups`. **No automatic backfill** — admin needs to identify and assign manually.
4. **Orphan-route product decisions** — `export-documents`, `official-documents`, `start`, `start/readiness` not surfaced in `/health/more`. Product call needed: keep + nav-link, redirect, or delete.

## First-week observations to watch

After 1 week of production use, check:

- `SELECT * FROM work_activities WHERE state IN ('TODO','CLAIMED','IN_PROGRESS') AND "dueAt" < NOW();` — overdue count
- Cron logs at `:30` of each hour for `[Cron] Work Activity SLA Monitor result: ...`
- KPI dashboard at `/provider/analytics/work` for breach % across workTypes
- Notification opt-out rate via `User.notificationSettings IS NOT NULL` count

If breach % > 10% sustained, the SLA `targetHours` in `sla_policies` is wrong for real workload — adjust via admin UI or bulk import.

## Rollback plan

Per ADR-016 conditions for revisiting — **not** rollback. The 3 migrations are additive (no drops, no NOT NULL alterations on existing columns). To roll back:

1. Revert merge commits #77–#89 in reverse order
2. Drop the 3 new tables (no FKs from anything else)
3. Pull previous backend image and restart

But the `application-status-writer` hook is gated by `prisma.workActivity` presence + try/catch, so even a partial rollback (revert app code while leaving DB) is safe — the hook silently no-ops.

---

**Next session bookmark**: `docs/adr/ADR-016-work-activity-tracking.md` for architectural questions, this doc for operational state.
