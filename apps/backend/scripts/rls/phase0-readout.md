# RLS Phase 0 — shadow-mode readout

**Audience:** whoever reads Phase-0 shadow output in prod, and whoever signs off on advancing toward enforcement.
**Scope:** Phase 0 is measurement-only — zero enforcement, zero query-result changes. The DB RLS policy is still
`SELECT TRUE` (permissive); nothing described here blocks or hides a single row today. This doc explains the two
shadow signals, how to read them from logs, the exit criteria for advancing past Phase 0, the Task-3 GUC proof
switch, and what must still be true before any real enforcement flip.

---

## 1. The two shadow signals

Both are emitted by `apps/backend/services/rls-shadow-metrics.js`, called from the tenant-scoped hooks in
`apps/backend/services/tenant-prisma-extension.js`. Both are `logger.warn` (Winston,
`apps/backend/shared/logger.js`), and both emitters wrap the log call in try/catch — per the source comment,
"a shadow probe must never be able to take down the path it only measures." If a signal doesn't appear, treat it
as "didn't fire," not as guaranteed proof of a healthy path — a swallowed logger failure looks identical from the
app's side (there is no separate error channel for it).

### `MISSING_CONTEXT`

```js
logger.warn('[rls-shadow] missing tenant context on a tenant-scoped op', { signal: 'MISSING_CONTEXT', model, action });
```

Fires when a tenant-scoped operation ran with a **genuinely missing** tenant context — nobody ever bound one for
this request. (Not the same as an intentional `withoutTenantScope()` call, which is deliberately excluded — see
`checkMissingContext`, `tenant-prisma-extension.js:322-327`.) **Meaning: this request would fail-closed the
moment enforcement goes live.**

Wired verbs (six): `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy`.

### `WOULD_BE_BLOCKED`

```js
logger.warn('[rls-shadow] cross-tenant row would be blocked under enforcement', { signal: 'WOULD_BE_BLOCKED', model, action, rowOrgId, contextOrgId });
```

Fires when a tenant context **was** bound, but the row a query actually resolved belongs to a **different** org
(`rowOrgId !== contextOrgId`) — see `checkWouldBeBlockedResult`/`checkWouldBeBlockedRow`,
`tenant-prisma-extension.js:349-388`. **Meaning: enforcement would have hidden this exact row.**

Wired verbs (three — `count`/`aggregate`/`groupBy` don't return org-tagged rows to compare, so they're not wired
for this signal): `findMany`, `findFirst`, `findUnique`. `findMany` scans at most the first 50 rows of a result
(`WOULD_BE_BLOCKED_SCAN_CAP`, `tenant-prisma-extension.js:362`) — the full result set still goes back to the
caller unchanged; only the *scan for this signal* is capped. In practice a leaking call site will still surface
(it only takes one bad row among the first 50), but for a very large result set the log won't contain one line
per leaked row.

---

## 2. How to read them

Tool-agnostic on purpose — the exact log stack isn't specified here. `apps/backend/shared/logger.js` builds each
record as JSON (`level`, `message`, `timestamp`, `service`, plus the `signal`/`model`/`action`/... fields shown
above); today the only wired transport is Console with human-readable formatting. So: if your deployment ships
stdout to a file or log aggregator as structured JSON, `jq` works directly on it. Reading raw console text, `grep`
on the message string or the `"signal":"..."` substring still finds the lines. Either way, translate the same
filter/group-by into your dashboard's query language — the fields don't change.

```bash
# raw text (or JSON-lines with a text-mode fallback)
grep '"signal":"MISSING_CONTEXT"' app.log
grep '"signal":"WOULD_BE_BLOCKED"' app.log

# structured JSON-lines sink
jq -c 'select(.signal == "MISSING_CONTEXT")' app.log
jq -c 'select(.signal == "WOULD_BE_BLOCKED")' app.log
```

- **`MISSING_CONTEXT` → group by `model` + `action`.** Each distinct pair is one call path with a real gap in
  tenant-context propagation.
  ```bash
  jq -r 'select(.signal=="MISSING_CONTEXT") | "\(.model) \(.action)"' app.log | sort | uniq -c | sort -rn
  ```
- **`WOULD_BE_BLOCKED` → group by `model` + `action` + `contextOrgId`.** This is the map of the cross-tenant
  surface: which org, hitting which model/action, is seeing rows it shouldn't.
  ```bash
  jq -r 'select(.signal=="WOULD_BE_BLOCKED") | "\(.model) \(.action) \(.contextOrgId)"' app.log | sort | uniq -c | sort -rn
  ```
- **No HTTP route field.** The signal only carries `model`/`action` (Prisma model + verb) — the emitters and their
  callers never see the request or route, so it isn't in the payload to group by. If your log pipeline separately
  attaches a request-correlation id to every line of a request, join on that to recover the originating route;
  absent that, model+action(+org) is the finest grain this signal alone gives you.

---

## 3. Exit criteria — before any enforce flip

Two conditions, both required:

**(a) `MISSING_CONTEXT` → zero in prod.** Every authenticated path must reliably set tenant context. Any non-zero
rate means some real request would fail-closed the instant enforcement goes live — i.e. a real user gets locked
out. Drive the grouped model+action count from §2 to zero before Phase 2's enforce flip.

**(b) A COMPLETE `WOULD_BE_BLOCKED` map.** Every `model`+`action`(+`contextOrgId`) combination that has ever
fired must individually be either fixed (the read properly scoped) or explicitly confirmed-legitimate (e.g. a
deliberate cross-org admin path) — not merely observed. The grouped view from §2 *is* that map; "complete" means
every row in it has a disposition on record, not that the map itself is empty (confirmed-legitimate entries are
allowed to stay).

Both gate the same thing: flipping the RLS policy off `SELECT TRUE`. Neither is a soft target — (a) is a
correctness/availability bar (fail-closed hurts real users first), (b) is a security bar (undiscovered
cross-tenant reads).

---

## 4. The Task-3 GUC shadow switch (`RLS_SHADOW_GUC`)

`RLS_SHADOW_GUC` is default **OFF** — `shadowGucEnabled()`, `tenant-prisma-extension.js:274-276`
(`process.env.RLS_SHADOW_GUC === 'true'`; only the literal string `'true'` turns it on, unset/anything else is
OFF). When on, the by-id verbs (`findUnique`/`update`/`delete`/`upsert`) wrap their bound query in a batch
`$transaction` that pins `app.tenant_id` (or `app.rls_bypass`) via `set_config(..., true)` before running it
(`withShadowGuc`, `:504-521`). The RLS policy is still `SELECT TRUE` either way, so this changes no query
results — it exists to prove the GUC-setting mechanism and measure its latency cost.

**This is CONTROLLED-PROOF / BENCHMARK-ONLY — not safe to enable broadly.** It's unsafe for any tenant-scoped
by-id call made from *inside* an already-open interactive transaction (`$transaction(async (tx) => ...)`): the
batch wrap runs on the closure-captured singleton, a different physical connection from the one the surrounding
transaction holds, so the GUC can silently miss the query entirely or contend on the pool. Prisma 5.22.0 gives
the extension no field on the `$allModels` hook that reveals "am I already inside an interactive transaction"
(confirmed empirically — real hook args are `{ model, operation, args, __internalParams, query }`, no `client`),
so no in-extension guard is possible — safety here is operational, not mechanical. Only enable this flag for a
targeted run against traffic that does **not** exercise the in-tx call sites listed in §5(A) below.

**Staging command** (verbatim, from `apps/backend`, against a migrated staging Postgres, in an isolated window
with no concurrent production-shaped traffic):

```bash
DATABASE_URL="postgresql://<staging-conn>" RLS_SHADOW_GUC=true npx jest rls-shadow-guc.int -i
```

(`RLS_SHADOW_GUC=true` here is belt-and-suspenders — the suite's own `beforeAll` already sets it for the run;
passing it externally too guards against a future edit silently removing that line.)

This runs `apps/backend/__tests__/integration/rls-shadow-guc.int.test.js` (5 tests): GUC visibility on the real
connection for both the tenant and bypass branches, a real `findUnique` through the `user` model with the flag
on, a non-leak check (no residual `app.tenant_id` after `COMMIT`), and a 50-iteration benchmark. Read the
benchmark's own `console.log` line, prefixed `[RLS-T3 BENCHMARK]` — total/avg-per-op ms for bare vs. GUC-wrapped
and the delta — that's the latency number to record; no pass/fail threshold is asserted on it (staging hardware
varies). **Turn the flag back off after the run** — it must not stay on in any environment that also serves the
in-tx call sites below.

---

## 5. Enforcement-phase blockers

Two things, beyond Phase 0's own scope, must be true before any future phase flips the RLS policy off
`SELECT TRUE`:

**(A) The ~50 in-tx by-id call sites need the Phase-0b per-site `SET LOCAL`-on-existing-tx treatment.** Each site
(enumerated in `design notes` — e.g.
`apps/backend/services/application-status-writer.js`, `apps/backend/services/checkout/checkout-settlement-service.js`,
and 48 others across `services/` and `routes/api/`) must issue `tx.$executeRawUnsafe('SET LOCAL app.tenant_id...')`
once at the top of its own interactive transaction, replacing reliance on the auto-commit batch form this task
proved (which cannot run safely from inside one — see §4). Until that lands, `RLS_SHADOW_GUC` — and, later, real
enforcement — cannot be turned on broadly without risking the cross-connection failure described above.

**(B) The missing-context path must stay fail-closed, and the real enforcing policy must be built to match it.**
As of Task 3's fix round 1, a genuinely-missing tenant context reaches the DB with **neither** `app.tenant_id`
**nor** `app.rls_bypass` set (`withShadowGuc`, `tenant-prisma-extension.js:504-521` — the app layer's part is
done). Whoever writes the real enforcing policy (replacing today's `SELECT TRUE`) must treat "neither GUC set" as
**deny**, not as a default-allow fallthrough. No such policy exists yet in Phase 0, so this can't be verified
until it's written — only that the app layer now emits the correct, checkable signal for it to key off.

**Standing gate (unconditional, independent of A/B): the enforce flip is never a single person's call.** Today,
the project rules L5/L6 already restrict every Tier C merge to the operator — RLS/tenant-identity work qualifies as
Tier C, and Tasks 1–3 all merged on that basis. `GOALS.md` G3 names the target explicitly: a second human
reviewer holding real Tier-C merge authority, specifically to cut bus factor from 1 to 2 — not yet in place (open
checklist item, 90-day target), but the intent for the enforce decision itself is the same either way: owner **+**
a second reviewer, never one person alone.

---

**Sources:** signal shapes, wired verbs, scan cap, GUC mechanics — `apps/backend/services/rls-shadow-metrics.js`,
`apps/backend/services/tenant-prisma-extension.js` (read directly, this session). Staging command and
enforcement-phase blockers — `design notes`. Exit-criteria
wording — `design notes` /
design note 2026-08-17-rls-phase0-shadow:125-130`. Standing gate — `GOALS.md` G3.
