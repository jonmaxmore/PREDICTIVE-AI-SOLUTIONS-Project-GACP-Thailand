# ADR-016: BPMN-aligned Work Activity Tracking

> **Reference-pattern note.** This ADR cites Odoo's `mail.activity`
> and Camunda's `task` (BPMN 2.0 — ISO/IEC 19510:2013) as
> *reference patterns* — both are well-documented examples of the
> "activity decoupled from record state" design. **GACP does not
> use Odoo or Camunda as a dependency** — the architectural choice
> is implemented natively in our Prisma schema + service layer.

- Status: Accepted (implemented in PRs #77–#88, deployed 2026-04-30)
- Date: 2026-04-30
- Deciders: jonmaxmore (project owner)
- Related:
  - `docs/audit/2026-04-30-provider-role-page-alignment.md` — the audit that surfaced the structural gap this ADR addresses
  - `docs/audit/2026-04-30-health-portal-audit.md` — sister audit on the applicant side
  - ADR-014 — Multi-tenancy foundation (work activity tables are tenant-scoped via the same primitives)
  - `apps/backend/services/workflow-transition-service.js` — the canonical workflow state machine that Phase 1A hooks into

## Context

GACP certification is a multi-stage workflow. Up to PR #76 the entire status of an application was a single string column (`Application.status`) advanced via `services/application-status-writer.js` (see ADR-012). The status enum was shared across all roles, and which role could perform which transition was modelled in `ROLE_TRANSITIONS` as one entry per `(role, fromStatus, toStatus)` triple.

Two structural problems came out of the 2026-04-30 SOW review:

**1. One person often does work that crosses role boundaries.**

The canonical roles are `ADMIN / SCHEDULER / DOCUMENT_REVIEWER / AUDITOR / ACCOUNT`. In production, one auditor commonly does both document review (in the office) **and** field audit (on-site). The legacy alias `reviewer_auditor` collapses the two by mapping to `DOCUMENT_REVIEWER`, but that hides the fact that the same person is doing two distinct work products with two distinct SLAs. We had no way to attribute "who did the doc review" separately from "who did the field audit" when both were done by the same `User`.

**2. Status answers "where in the pipeline?" but not "what work is open right now?".**

Statuses are buckets in time. They tell us the application is currently in `ASSIGNED_FOR_REVIEW`, but not who's working on it, when they claimed it, when they should be done by, or whether the SLA is breached. The system relied on staff to remember which application was theirs (via `formData.PROVIDERAssignment.reviewerId`), and relied on managers to scan the status column manually for breaches. There was no roll-up.

Both problems compound. Without a per-work-item handle:

- Multi-group users can't show up correctly in queues — they belong to one queue per role, but their actual workload spans both.
- SLA enforcement requires per-row deadlines, which the status model doesn't have.
- Activity completion ("the reviewer is done") is conflated with stage advance ("the application is ready for the next phase"), so partial work and revisions are messy to reason about.
- Applicants see only the status string, with no transparency into which step is currently happening.

The audit at `docs/audit/2026-04-30-provider-role-page-alignment.md` recommended adopting the activity-tracking pattern documented in BPMN 2.0 (ISO/IEC 19510:2013) and exemplified by Odoo's `mail.activity` and Camunda's `task` — both separate "what stage?" from "what work item?".

## Decision

Introduce a parallel `WorkActivity` model alongside the existing `Application.status` column. Activities are spawned automatically when status changes, carry their own assignment + SLA + completion timestamps, and are independent of the application's lifecycle column.

Three core principles:

**1. Activity completion ≠ stage advance.**

An activity moves through `TODO → CLAIMED → IN_PROGRESS → DONE`. None of those state transitions update `Application.status`. Stage advance is a separate, explicit gate — the user picks the next status from the legal options. Activity tracking is intentionally independent of the record's state column, matching the well-documented "activity decoupled from state" pattern. Phase 3 added a combined "ปิดงาน + เลื่อนสถานะ" UX path that bundles both intents in one click while preserving the architectural separation: the backend runs them inside one `prisma.$transaction` so they're atomic, but the user explicitly picks the target stage.

**2. Candidate Group + Assigned User are two distinct levels.**

Each activity has a `candidateGroup` (a canonical role code — anyone with that role can claim) and an optional `assignedUserId` (the specific person who claimed it). This mirrors BPMN's `lane` (group) vs `assignee` (user). Phase 1C added a first-class `UserGroupMembership` M2M model so a single user can belong to multiple groups simultaneously — the auditor who also reviews documents now claims work from both queues without role-swapping.

**3. SLA = boundary timer event per BPMN.**

`SlaPolicy` rows define `targetHours / warningHours / escalationHours` per `workType`. When an activity is created, `dueAt` and `warningAt` are computed once and frozen on the row — policy edits don't move past deadlines retroactively. A cron at `:30 * * * *` checks open activities, fires a single warning + a single breach notification per row (dedup via `warnedAt / breachedAt` columns), and stops. The activity continues to surface as overdue in the UI via the `dueAt < now` badge so visibility persists even after the alert is silenced.

## How activities flow

```
HEALTH applicant uploads slip
   ↓ application-status-writer hook
   ↓   reads stage_activity_configs WHERE workflowStage = newStatus
   ↓   spawns WorkActivity row(s) with candidateGroup + dueAt frozen
   ↓
ACCOUNT staff sees the row in /provider/work
   ↓ claim → assignedUserId = self, state = CLAIMED
   ↓ markDone → state = DONE
   ↓ separate workflow-transition (or combined "done + advance")
   ↓
application-status-writer hook fires again
   ↓ status terminal? → cancelOpenForStage (kill leftover work)
   ↓ status non-terminal? → spawn next stage's activities
```

## Phase rollout (PR-by-PR)

| Phase | PR | Scope |
|---|---|---|
| 1A | #77 | `WorkActivity` + `StageActivityConfig` + `SlaPolicy` schema with RLS observe-only, seed for 8 stages × 7 SLA policies, `work-activity-service`, hook into `application-status-writer`, routes `/provider/work/{my,queue,:id/claim,:id/unclaim,:id/done}`, `/provider/work` list page |
| 1B | #77 | SLA cron + `WORK_ACTIVITY_*` notification types + `notifyAssigned/Warning/Breach` dispatcher + activity detail page `/provider/work/[id]` |
| 1C | #77 | `RoleGroup` + `UserGroupMembership` M2M with seed + backfill from existing `User.role`; `shared/user-groups.js` helpers (`getUserGroups / userInGroup / listGroupMemberUserIds`) wired into `claim / listMyTodo / notifications`. Backward-compatible: `User.role` stays as fallback |
| 1D | #77 | Admin work-config UI at `/provider/settings/work-config` + audit-logged GET/PUT/POST/DELETE on `stage_activity_configs` and `sla_policies` |
| 2 | #78 | Activity timeline tab on `/provider/applications/[id]`; `/provider/management/users/[id]/groups` UI for the M2M memberships; settings sub-nav layout; bulk JSON export/import for work-config (upsert-only, atomic, single audit log entry per import) |
| 3 | #79 | `GET /api/provider/work/:id/next-states` (legal targets per user's groups); `POST /done` extended with optional `advanceStatus { toState, comment }` running inside one `prisma.$transaction` so illegal transitions roll back the markDone too; "ปิดงาน + เลื่อนสถานะ" panel on `/provider/work/[id]` |
| 4 | #80 | Manager KPI dashboard at `/provider/analytics/work` — admin + scheduler only. 5 panels in one query: summary, byWorkType, byGroup, top-10 performers, state distribution. Window 7/30/90/365 days |
| 5 | #81 | KPI drill-down — `/provider/work` reads `?workType / ?state / ?group` URL params with filter chips. KPI table rows link to filtered queue. CSV export with UTF-8 BOM for Excel |
| 6 | #82 | `GET /api/applications/:id/activities` (HEALTH-only, redacted shape — no assignee names, status coarsened to `pending/in_progress/done/cancelled`). `HealthActivityTimeline` on `/health/applications/[id]` so applicants see "เจ้าหน้าที่กำลังตรวจสลิปของคุณ" instead of just a status string |
| 7 | #83 | Per-user notification channel preferences (`User.notificationSettings` JSON, default-allow). `notification-service.sendNotification` reads prefs once and gates inApp/email/sms via `isAllowed`. Shared `<NotificationPreferences>` component on `/{health,provider}/profile/notifications` |
| 8 | #84 | HEALTH portal audit + top P0 fix: surface `PHASE_1_SLIP_UNDER_REVIEW` / `PHASE_2_SLIP_UNDER_REVIEW` in 4 frontend mapping files (slip-flow had no entries pre-fix) with drift-guard tests |
| 9 | #85 | HEALTH UX wins: draft-cancel button (DELETE endpoint existed but no UI), revision-deadline countdown badge on list rows, REJECTED_LAB retry banner on detail page |
| 10 | #86 | `amendment` + `replacement` legacy `/api/applications` (404) → `/applications/draft`. CAR_PENDING countdown badge alongside revision deadline |
| 11 | #87 | Dead-code cleanup: `app-shell.tsx` / `mobile-bottom-nav.tsx` / `sidebar-nav.tsx` / `applications/tracking/*` deleted (zero refs verified). Net `−962` LOC. Lint baseline `95 → 94` |
| 12 | #88 | `/health/more` hub for legit-feature orphans (training, site-analysis, sop-*, reports, etc.) categorised by lifecycle stage |

Each phase shipped as a separate PR with green CI, deployed to production same-day. Net diff across all 12 PRs: **+8,913 / −962** ≈ **~7,950 LOC net new**.

## Trade-offs considered

**Why not enforce `Application.status = activity.state`?**

Tempting but wrong. Activities and stages have different cardinalities (1 stage : N activities) and different lifecycles. A stage like `AUDIT_CONFIRMED` has one `FIELD_AUDIT` activity in Phase 1A's seed — but in a future audit-with-followup workflow it might have `FIELD_AUDIT + LAB_TEST + DOCUMENT_VERIFY`. Tying status to activity collapses that flexibility. Keeping them independent is the BPMN-canonical approach.

**Why activities default to single-role candidate group instead of M2M from the start?**

We considered making `WorkActivity.candidateGroups` a many-to-many table from day one. Rejected because: (a) Phase 1A had to ship inside one PR for the seed-data to land cleanly with the migration, and (b) 95% of activities have exactly one canonical group anyway. The Phase 1C M2M happens on the **user** side (`User × RoleGroup`) — that's where multi-membership actually exists in production. Activity-side M2M would be an over-fit.

**Why upsert-only bulk import (Phase 2)?**

The admin work-config bulk import deliberately can't delete rows. Worst case a malformed import inserts garbage that admins remove via the per-row DELETE. This avoids the much worse failure mode where a typo in the JSON wipes the entire seed.

**Why CSV export with UTF-8 BOM (Phase 5)?**

Excel on Windows defaults to Windows-1252 when opening UTF-8 CSV without BOM. Thai labels would render as mojibake. The BOM forces Excel into UTF-8 mode. This is dumb but it's how Excel works in 2026.

**Why redact assignee names on the HEALTH endpoint (Phase 6)?**

Same applicationId scope as the existing `GET /:id` (must own the application via `healthId`), but the response strips `assignedUserName / completedByName / candidateGroup / triggeredAtStage / note / cancelReason / dueAt / warningAt`. The applicant doesn't need to know which specific officer is reviewing their case — that's internal personnel data. They just need to know "officer is currently reviewing the slip — usually 1 working day".

**Why default-allow notification preferences (Phase 7)?**

Migration cost. If we defaulted to opt-in, every existing user would silently lose notifications until they visited the prefs page. Default-allow means existing users keep getting alerts and only those who proactively opt out see the change. Same shape as GDPR-style preferences in mature SaaS.

## Consequences

### Positive

- Multi-group users (auditor + document_reviewer) work without role-swapping. Their queue surfaces both kinds of work.
- SLA breaches fire automatic notifications to the right candidate group + admins, not just visible passively in a list.
- Manager has a cross-cutting roll-up (`/provider/analytics/work`) with drill-down. Pre-ADR there was no such view.
- HEALTH applicants see real status copy ("เจ้าหน้าที่กำลังตรวจสลิป") instead of raw enum strings ("PHASE_1_SLIP_UNDER_REVIEW").
- Audit-logged config changes — every stage_activity_config / sla_policy edit goes through `auditLogger.log` with the changed fields in metadata.
- Drift guards in unit tests catch the class of bug Phase 8 fixed (Phase 1A spawns a state, Phase 8 forces frontend coverage).

### Negative

- More moving parts. `application-status-writer` now does two things — write status + spawn activities. The hook is gated by `prisma.workActivity` presence + try/catch so pre-migration deploys safely no-op, but it's more code in the hot path.
- Multi-group resolution requires a DB read per `userInGroup` call. We didn't add a per-request cache because (a) most calls are in admin/manager paths where one extra read is fine, and (b) the existing `userGroupsHelper` already caches the role-group code → id lookup table in-process. If hot paths emerge under production load, we'll add request-level memoization.
- `Application.formData` accumulates more keys (`workflowState`, `revisionDueAt`, `carDueAt`). The mapper at `routes/api/helpers/applications-helpers.js` is the canonical projection — direct `formData.X` reads in route handlers should be considered tech debt and migrated through the mapper as touched.

### Migration story for existing applications

When the Phase 1A migration ran on production (2026-04-30 ~09:50 UTC), `work_activities` was empty — no activities for in-flight applications. This is intentional. The status writer hook spawns activities **on the next status transition**, not retroactively. Applications mid-flow at deploy time skip the activity for the current stage but pick up activities at the next stage transition. Manual backfill considered and rejected: in-flight applications in production were < 30, the next status transition for each is hours-to-days away, and a backfill script with carDueAt / revisionDueAt edge cases was not worth the engineering risk.

## Conditions for revisiting this ADR

Revisit when any of the following hold:

1. A workflow stage needs N activities in parallel (currently 1:1 in the seed but the schema supports N) — the `displayOrder` field becomes meaningful.
2. SLA breach rate stays > 10% across all workTypes for two consecutive 30-day windows — indicates the policy hours are wrong for real workload, not that staff are slow.
3. A workType needs a candidate group that isn't a canonical role — would force the M2M extension on the activity side.
4. The HEALTH applicant view needs to show assigned-officer identity (legal disclosure obligation, public-trust mandate, etc.) — the redaction strategy changes from "always" to "configurable per tenant".
5. A workflow stage needs to spawn activities asynchronously (e.g. only after lab-result webhook arrives, not on stage entry) — the status-writer hook becomes insufficient and we need an event bus.

When any of those land, this ADR is superseded by a new one documenting the activation plan + revised model.
