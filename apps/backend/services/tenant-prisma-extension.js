/**
 * Prisma Client Extension — auto-inject organizationId on writes (ADR-014).
 *
 * Behavior:
 *   - On `create` / `createMany` / `upsert.create` against a tenant-scoped
 *     model, if the caller did not provide organizationId, inject it from
 *     the current tenant context.
 *   - If no tenant context is bound (e.g., scripts, migrations, tests, or
 *     code wrapped in `withoutTenantScope`), the extension is a no-op and
 *     the underlying call proceeds unchanged. This preserves backward
 *     compatibility — existing call sites that already pass organizationId,
 *     or that legitimately don't need one, are unaffected.
 *   - If the caller passed an explicit organizationId, it is left as-is and
 *     verified to match the current tenant context. A mismatch is treated
 *     as a programmer error and throws — this is the cross-tenant write
 *     guard.
 *
 * NOT implemented in this commit (deferred to Phase 3):
 *   - read filtering on findMany / findFirst / findUnique. RLS will be the
 *     primary read defense; the application layer will not duplicate it.
 *   - update/delete tenant scoping. Those operations target rows by id and
 *     will be guarded by RLS; if the row is in a different tenant, RLS
 *     hides it and the operation becomes a no-op rather than a leak.
 *
 * RLS Phase 0 (shadow / measure-first) addition:
 *   - findUnique now has a handler too, but ONLY to emit the missing-context
 *     shadow metric below — it still calls query(args) unmodified, so it
 *     remains a behavioural no-op (no read filtering added; that's still
 *     the Phase 3 item above).
 *   - Task 2 adds a SECOND shadow signal on findUnique/findFirst/findMany:
 *     after query() resolves, compare each returned row's organizationId to
 *     the bound tenant context and emit WOULD_BE_BLOCKED on a mismatch (see
 *     checkWouldBeBlockedResult below). Still measurement only — the result
 *     is returned to the caller exactly as query() produced it.
 *   - Task 3 adds the GUC-setting MECHANISM (flag RLS_SHADOW_GUC, default
 *     OFF — see shadowGucEnabled below): when ON, the by-id verbs
 *     (findUnique/update/delete/upsert) wrap their bound query in a batch
 *     $transaction that pins app.tenant_id (or app.rls_bypass) via
 *     set_config(..., true) first. The DB policy is still `SELECT TRUE`
 *     (permissive), so this sets the GUC per op but enforces nothing — it
 *     exists to prove the mechanism + measure its latency cost on staging
 *     ahead of any real enforcement phase. update/delete had no handler at
 *     all before Task 3; with the flag OFF they are still exactly
 *     `query(args)`, i.e. behaviourally identical to having no handler.
 *     CONTROLLED-PROOF/BENCHMARK-ONLY, not safe to flip on broadly: the
 *     batch form cannot detect (and therefore cannot skip) running inside
 *     an already-open interactive transaction on this Prisma version — see
 *     shadowGucEnabled's and withShadowGuc's doc comments for the full
 *     explanation and the failure mode this would hit at the ~50 in-tx
 *     call sites enumerated in task-3-report.md.
 */

const { getTenantContext, isWithoutTenantScope } = require('./tenant-context');
const { getEntityContext } = require('./entity-context');
const { emitMissingContext, emitWouldBeBlocked } = require('./rls-shadow-metrics');
const { checkHolderScoped } = require('./holder-read-witness');

/**
 * Tenant-scoped Prisma model names. Kept in sync by hand with the
 * @@map names in apps/backend/prisma/schema/*.prisma. The Prisma model
 * name (capitalized, used in the extension API) is on the left; the
 * underlying table name (for human reference only) is in the comment.
 *
 * Adding a new tenant-scoped model? Add it both here AND to the backfill
 * verification list in
 * apps/backend/prisma/migrations/20260427120200_backfill_default_organization
 * /migration.sql.
 */
const TENANT_SCOPED_MODELS = new Set([
  // auth
  'User',                  // users
  'UserConsent',           // user_consents
  // application
  'Application',           // applications
  'ApplicationComment',    // application_comments
  'ApplicationDraft',      // application_drafts
  'ApplicationBundle',     // application_bundles
  // farm + cultivation
  'Farm',                  // farms
  'SiteAnalysis',          // site_analyses
  'TrainingRecord',        // training_records
  'Plot',                  // plots
  'PlantingCycle',         // planting_cycles
  'PlantingCyclePlot',     // planting_cycle_plots
  'CareLog',               // care_logs
  'CultivationLog',        // cultivation_logs
  // gacp compliance
  'WaterSource',           // water_sources
  'GrowingMedium',         // growing_media
  'SeedSource',            // seed_sources
  'FertilizerRecord',      // fertilizer_records
  'ControlledEnvironment', // controlled_environments
  // harvest + trace
  'HarvestBatch',          // harvest_batches
  // T9 (2026-09-05) — a laboratory report belongs to the tenant that owns the batch
  // it was issued against, and the door reads its organizationId from that batch
  // rather than from the caller (services/batch-lab-result-service.js).
  'BatchLabResult',        // batch_lab_results
  'DryingTemperature',     // drying_temperatures
  'DryingHumidity',        // drying_humidity
  'DryingDarkRoom',        // drying_dark_rooms
  'CuringProcess',         // curing_processes
  'PackagingDetail',       // packaging_details
  'DryingProcess',         // drying_processes
  'Lot',                   // lots
  'TraceQrSecurity',       // trace_qr_security
  'TraceQrScan',           // trace_qr_scans
  'ConsumerFeedback',      // consumer_feedback
  // certification
  'Certificate',           // certificates
  // 2026-08-27 — archived superseded revisions of a certificate. The one writer
  // (reviseCertificateFromFarm) copies organizationId from the certificate row
  // explicitly, so this registration is the read-scoping safety net, same as Certificate.
  'CertificateRevision',   // certificate_revisions
  // billing
  'Invoice',               // invoices
  'InvoiceLineItem',       // invoice_line_items
  'Quote',                 // quotes
  // F-G4-64 (2026-08-28): the NEW quotation stream (Quotation/quotations) was
  // never registered here although `Quote` was, and Quotation carries a NOT
  // NULL organizationId exactly like Quote. Its one writer
  // (quotation-service.issueQuotationsForApplication) already passes
  // organizationId explicitly on every create, so this is the read-scoping
  // safety net — the same rationale FarmAuditPhoto and CertificateRevision
  // carry above, not a functional dependency of the writer.
  'Quotation',             // quotations
  'PaymentTransaction',    // payment_transactions
  'CheckoutOrder',         // checkout_orders (Wave 1 — single-checkout engine)
  'CheckoutDocument',      // checkout_documents
  'PaymentReminderLog',    // payment_reminder_logs (W3-41 Q2-D2 — reminder dedup
  //                       // ledger; NEW table created empty, so the 20260427120200
  //                       // backfill-verification list does not apply — every write
  //                       // carries the invoice's organizationId explicitly)
  // StripeWebhookEvent is deliberately NOT tenant-scoped: events arrive with
  // no tenant context; org resolves through the order they reference.
  // audit
  // กทล.๑ ส่วน จนท. ข้อ ๑.๑ — per-slot document verdicts. The one writer
  // (routes/api/provider/document-reviews.js) passes organizationId explicitly
  // from the application, so this registration is the read-scoping safety net,
  // the same rationale FarmAuditPhoto and CertificateRevision carry.
  'ApplicationDocumentReview', // application_document_reviews
  // Document pre-check (2026-09-27 design, §2) — Task 5. The writer
  // (Task 6/7, services/document-precheck's caller) passes organizationId
  // explicitly on every create, so this registration is the read-scoping
  // safety net, same rationale ApplicationDocumentReview carries just
  // above. NEW tables created empty, so the 20260427120200 backfill-
  // verification list does not apply — see PaymentReminderLog's comment
  // further up for the same reasoning.
  'DocumentPrecheck',      // document_prechecks
  'DocumentPrecheckFlag',  // document_precheck_flags
  'AuditLog',              // audit_logs
  'PostAuditTask',         // post_audit_tasks
  'RevisionDeadline',      // revision_deadlines
  'WaiverReopenRequest',   // waiver_reopen_requests (owner ruling 2026-07-08)
  // R2 M3 — per-stage correction round ledger (append-only, FINAL ข้อ 2/4)
  'CorrectionRound',       // correction_rounds
  // R2 M7 — append-only submitted-formData history per correction round (D-6)
  'CorrectionSubmissionVersion', // correction_submission_versions
  // system / provider (tenant-scoped parts)
  'Notification',          // notifications
  'ReportSubmission',      // report_submissions
  'SOPDocument',           // sop_documents
  'ScopeOfWork',           // scope_of_works
  'AuditChecklist',        // audit_checklists
  'MeetingRoom',           // meeting_rooms
  // Phase B (cert-integrity fix, 2026-08-16) — onsite audit photo evidence.
  // uploadPhoto (audit-onsite-service.js) already sets organizationId
  // explicitly on every write, so this registration is a read-scoping
  // safety net, not a functional dependency. FarmAuditChecklistItem is
  // intentionally NOT listed here — it has no organizationId column (see
  // prisma/schema/audit-onsite-evidence.prisma).
  'FarmAuditPhoto',        // farm_audit_photos
  // C3-01 drift fix (2026-08-23): GpsVerificationLog was added alongside
  // FarmAuditPhoto (same Phase B onsite-evidence work) but never registered
  // here. Its schema comment says it mirrors FarmAuditPhoto.organizationId
  // exactly, and its one writer (audit-onsite-service.js startInspection)
  // already sets organizationId explicitly on every create — so, same as
  // FarmAuditPhoto, this registration is a read-scoping safety net (closes
  // the gap on onsite.js's _resolveStartedAt findFirst under
  // TENANT_READ_ORG_SCOPE), not a functional dependency of the writer.
  'GpsVerificationLog',    // gps_verification_logs
  // ADR-016 Phase 1A — BPMN-aligned work activities
  'WorkActivity',          // work_activities
  // ADR-016 Phase 1C — multi-group user memberships
  'UserGroupMembership',   // user_group_memberships
  // Wave 2 — per-permission GRANT/REVOKE overrides
  'UserPermissionGrant',   // user_permission_grants
  // Farm-worker Wave B — per-member entity permission GRANT/REVOKE overrides
  'EntityMemberPermissionGrant', // entity_member_permission_grants
  // Wave A Phase 32 / G1 — polymorphic attachments
  'Attachment',            // attachments
  // Support tickets (persisted; was in-memory). TicketMessage is scoped via its
  // parent Ticket and has no organizationId column, so it is intentionally omitted.
  'Ticket',                // tickets
  // Survey module (C05F680149 ต้นแบบที่ 2 — ระบบสำรวจความต้องการ)
  'SurveyTemplate',        // survey_templates
  'SurveyQuestion',        // survey_questions
  'SurveyResponse',        // survey_responses
  'SurveyAnswer',          // survey_answers
  'ExpertInterview',       // expert_interviews
]);

function isTenantScoped(modelName) {
  return TENANT_SCOPED_MODELS.has(modelName);
}

/**
 * Entity-scoped Prisma model names — Wave C, PR C-2.
 *
 * Models that carry an `entityId` FK pointing at the legal-applicant
 * Entity (separate dimension from Organization). The Prisma extension
 * auto-filters reads on these models by `entityId = activeEntity.id`
 * when an active-entity context is bound to the request — a row-level
 * read filter for the entity dimension.
 *
 * Conservative first pass: only Application and Farm. Certificate is
 * transitively scoped via Application.entityId so doesn't need direct
 * filtering. EntityMembership is intentionally NOT scoped because the
 * picker UI lists memberships across entities by design. TraceQrSecurity
 * has an `entityId` column but it's polymorphic
 * (entityType=HARVEST_BATCH/PACKAGING_LOT/PLANT_UNIT) — different sense
 * of "entity", not the legal-applicant Entity, so left out.
 *
 * Adding a new model here? Make sure every existing call site that
 * reads it is OK with implicit entityId filtering — handlers that
 * legitimately need to read across entities must wrap their Prisma
 * calls in withoutEntityScope().
 */
const ENTITY_SCOPED_MODELS = new Set([
  'Application', // applications
  'Farm',        // farms
]);

function isEntityScoped(modelName) {
  return ENTITY_SCOPED_MODELS.has(modelName);
}

/**
 * Mutates the data object to add organizationId if missing, or verifies
 * that an existing organizationId matches the current tenant. Returns the
 * (possibly modified) data object.
 *
 * @param {object} data — single record or undefined
 * @param {string} expectedOrgId
 */
function applyToRecord(data, expectedOrgId) {
  if (!data) {return data;}
  if (data.organizationId === undefined || data.organizationId === null) {
    data.organizationId = expectedOrgId;
    return data;
  }
  if (data.organizationId !== expectedOrgId) {
    const err = new Error(
      `Cross-tenant write blocked: data.organizationId=${data.organizationId} ` +
        `does not match current tenant context ${expectedOrgId}. ` +
        `If this is intentional, wrap the call in withoutTenantScope().`,
    );
    err.code = 'CROSS_TENANT_WRITE';
    throw err;
  }
  return data;
}

/**
 * ENT-01 data-layer read scope — DEFAULT ON (Gap-1 GREEN, 2026-08).
 * Org read-scope now enforces whenever a tenant context is bound. Leaving it OFF
 * was a silent cross-tenant read leak: a findMany/count issued inside org B's
 * request returned org A's rows (proven on real Postgres by
 * __tests__/integration/tenant-isolation-cross-org-be.test.js). Staging ran with
 * TENANT_READ_ORG_SCOPE=true (docker-compose.staging.yml) and validated it, so it
 * is now the default everywhere.
 * SAFE BY CONSTRUCTION: admin/cron/public run inside withoutTenantScope
 * (getTenantContext()=null) → never narrowed (see applyReadScopes below).
 * Kill-switch retained: set TENANT_READ_ORG_SCOPE=false to disable in an emergency.
 * (Deeper by-id defense — findUnique/update/delete via RLS+GUC — is the separate
 * Phase E.2 follow-up.)
 */
function orgReadScopeEnabled() {
  return process.env.TENANT_READ_ORG_SCOPE !== 'false';
}

/**
 * RLS Phase 0 (shadow / measure-first) — Task 3: GUC-setting wiring.
 * DEFAULT OFF (shape mirrors orgReadScopeEnabled above, but this is a
 * DIFFERENT concern).
 *
 * *** CONTROLLED-PROOF / BENCHMARK-ONLY. NOT SAFE TO ENABLE BROADLY. ***
 * When ON, the by-id verbs (findUnique/update/delete/upsert) wrap their
 * bound query in a batch $transaction that pins app.tenant_id (or
 * app.rls_bypass) via set_config(..., true) before running it. The DB RLS
 * policy is still `SELECT TRUE` (permissive) at this phase, so this sets
 * the GUC per op but ENFORCES NOTHING.
 *
 * This batch form is UNSAFE when the call is already running inside an
 * INTERACTIVE `$transaction(async (tx) => ...)`: Prisma 5.22.0 gives
 * $allModels query-extension hooks no field that reveals this, so there is
 * no reliable way for withShadowGuc (below) to detect it and fall back —
 * see that function's doc comment for the exact failure mode. Roughly 50
 * services call Prisma from inside an interactive transaction today
 * (enumerated in task-3-report.md); a by-id call made from inside one of
 * them is unsafe with this flag on.
 *
 * Enable this ONLY for a targeted auto-commit proof/benchmark run (e.g.
 * rls-shadow-guc.int.test.js on staging, against traffic that does not
 * exercise the ~50 in-tx call sites) — NEVER broadly, and never in an
 * environment serving real production traffic, until Phase-0b lands the
 * per-site SET-LOCAL-on-existing-tx treatment. OFF by default so merging
 * this is a no-op everywhere until the operator opts in for exactly that
 * kind of controlled run.
 */
function shadowGucEnabled() {
  return process.env.RLS_SHADOW_GUC === 'true';
}

/**
 * Inject row-level read filters into a read op's `args`, per dimension.
 * Both dimensions fail-open: if their context is null, nothing is added.
 * @param {string} model — Prisma model name
 * @param {object} args — read op args (findMany/findFirst/count)
 * @returns {object} the (possibly modified) args
 */
function applyReadScopes(model, args) {
  const next = args || {};
  // 1. entity dimension (Wave C — unchanged behaviour, always on)
  if (isEntityScoped(model)) {
    const ectx = getEntityContext();
    if (ectx) {
      next.where = { ...(next.where || {}), entityId: ectx.entityId };
    }
  }
  // 2. organization dimension (ENT-01 backstop — flag-gated)
  if (orgReadScopeEnabled() && isTenantScoped(model)) {
    const tctx = getTenantContext();
    if (tctx) {
      next.where = { ...(next.where || {}), organizationId: tctx.organizationId };
    }
  }
  return next;
}

/**
 * RLS Phase 0 — shadow / measure-first (see services/rls-shadow-metrics.js).
 * MEASUREMENT ONLY: emits a log signal and changes nothing about the op.
 *
 * A tenant-scoped read/by-id op with a genuinely missing tenant context
 * (nobody ever bound one — not the same as an intentional
 * withoutTenantScope) would fail-closed once RLS enforcement is live. This
 * records that signal so Phase 0 can measure real call-site risk before any
 * enforcement is turned on. isWithoutTenantScope() is the accessor that
 * tells the two null-context cases apart (see tenant-context.js).
 *
 * Deliberately independent of TENANT_READ_ORG_SCOPE / orgReadScopeEnabled():
 * that flag gates today's app-layer read backstop, an unrelated concern from
 * the DB-level RLS policy this metric is measuring readiness for.
 *
 * @param {string} model
 * @param {string} action
 */
function checkMissingContext(model, action) {
  if (!isTenantScoped(model)) {return;}
  if (getTenantContext()) {return;} // bound — fine
  if (isWithoutTenantScope()) {return;} // intentional bypass — not a signal
  emitMissingContext({ model, action });
}

/**
 * RLS Phase 0 — would-be-blocked cross-tenant shadow metric (Task 2).
 * Counterpart to checkMissingContext above: fires when a tenant context WAS
 * bound but the row query() actually resolved belongs to a DIFFERENT org —
 * exactly the class of row RLS enforcement would hide. findUnique is the
 * high-value case: it's a by-id op applyReadScopes deliberately does not
 * scope (Phase 3 note atop this file), so it can genuinely return a
 * cross-org row today. findFirst/findMany are hooked too for parity —
 * applyReadScopes already narrows them by default, so a mismatch should be
 * rare there, but the compare is cheap and stays correct even if that
 * backstop is ever disabled (TENANT_READ_ORG_SCOPE=false).
 *
 * MEASUREMENT ONLY: a read-only compare. Never mutates or returns anything,
 * so it cannot change what the caller gets back.
 *
 * @param {string} model
 * @param {string} action
 * @param {*} row — a single record, or null/undefined
 * @param {string} ctxOrgId — the bound tenant context's organizationId
 */
function checkWouldBeBlockedRow(model, action, row, ctxOrgId) {
  if (!row || typeof row !== 'object') {return;} // null/undefined — nothing to compare
  if (row.organizationId === undefined) {return;} // row has no own organizationId — skip, no false signal
  if (row.organizationId === ctxOrgId) {return;} // same org — not a signal
  emitWouldBeBlocked({ model, action, rowOrgId: row.organizationId, contextOrgId: ctxOrgId });
}

// findMany can return arbitrarily large result sets; scanning every row on
// every list read would make a measurement probe itself a cost concern.
// Cap the scan at the first N rows — generous for a typical UI list/page
// size while keeping worst-case work bounded. The full (uncapped) array is
// still returned to the caller unchanged; only the SCAN for this signal is
// capped.
const WOULD_BE_BLOCKED_SCAN_CAP = 50;

/**
 * Called AFTER query() resolves in the findUnique/findFirst/findMany hooks.
 * Fails open when there's no bound tenant context — nothing to compare
 * against (a genuinely missing context is checkMissingContext's signal, not
 * this one; an intentional withoutTenantScope bypass isn't "cross-tenant"
 * by definition — nothing is bound for a row to be "cross" from).
 *
 * @param {string} model
 * @param {string} action
 * @param {*} result — whatever query() resolved to: null, a single record,
 *   or (findMany) an array of records
 */
function checkWouldBeBlockedResult(model, action, result) {
  if (!isTenantScoped(model)) {return;}
  const ctx = getTenantContext();
  if (!ctx) {return;} // no bound context — nothing to compare against
  if (Array.isArray(result)) {
    const limit = Math.min(result.length, WOULD_BE_BLOCKED_SCAN_CAP);
    for (let i = 0; i < limit; i++) {
      checkWouldBeBlockedRow(model, action, result[i], ctx.organizationId);
    }
    return;
  }
  checkWouldBeBlockedRow(model, action, result, ctx.organizationId);
}

/**
 * RLS Phase 0 Task 3 — GUC batch-transaction helpers, copied verbatim from
 * the proven form in scripts/rls/extension-reference.md (lines 45-68).
 *
 * Each wraps the BOUND query (the `query(args)` callback the extension
 * hook itself was handed — already carrying PDPA-decrypt + soft-delete,
 * NOT basePrisma) inside a batch-array `$transaction`, whose first element
 * pins a GUC via `set_config(..., true)` (= SET LOCAL — transaction-scoped;
 * dies at COMMIT, so a pooled connection never carries a stale tenant value
 * into the next request). Array (batch) form, not a callback: both elements
 * run on the SAME pinned connection in ONE transaction, so the GUC set by
 * element 1 is live for element 2's read/write.
 */
// Unwraps a batch $transaction's resolved pair. Defensive against a
// non-array resolution (e.g. the test-env engine-less stub Proxy in
// prisma-database.js resolves $transaction(...) to `Promise.resolve(null)`
// regardless of arguments — array-destructuring `null` throws) — falls
// through to returning whatever came back unchanged instead of crashing.
function unwrapGucBatchResult(pair) {
  return Array.isArray(pair) ? pair[1] : pair;
}

function withTenantGuc(prismaExtended, organizationId, args, query) {
  return prismaExtended
    .$transaction([
      prismaExtended.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true)`,
        organizationId,
      ),
      query(args),
    ])
    .then(unwrapGucBatchResult);
}

// Mirrors withoutTenantScope(): platform-admin / cron / system reads. The
// enforcing policy (staging prototype) returns TRUE when app.rls_bypass is
// 'on', so this maps the app-layer escape hatch onto the DB-layer one.
function withBypassGuc(prismaExtended, args, query) {
  return prismaExtended
    .$transaction([
      prismaExtended.$executeRawUnsafe(
        `SELECT set_config('app.rls_bypass', 'on', true)`,
      ),
      query(args),
    ])
    .then(unwrapGucBatchResult);
}

// Memoized lazy-require, same idiom as getWorkflowTransitionService() in
// application-status-writer.js ("Lazy require to avoid circular import").
// Confirmed empirically against the installed @prisma/client@5.22.0: the
// $allModels query-extension hook does NOT receive a `client` field (its
// ModelQueryOptionsCbArgs type is { model, operation, args, query } only).
// extension-reference.md flagged this possibility and named the fallback:
// "capture the extended prisma via closure." A top-level
// `require('./prisma-database')` would be circular — prisma-database.js
// requires THIS file (for tenantInjectExtension) before its own `prisma`
// export exists — so the require is deferred to first call inside the
// getter below. By the time any hook actually runs (a real request has
// reached the DB layer), prisma-database.js has long finished its
// synchronous bootstrap and require's module cache returns the complete,
// fully-extended client (tenant + soft-delete + PDPA) — never basePrisma.
// Not memoized on a falsy result, so a (theoretical) too-early call self-heals
// on the next invocation instead of caching `undefined` forever.
//
// This absence is UNCONDITIONAL — real Prisma never passes `client`,
// whether the current call is inside an interactive transaction or not.
// That is exactly why withShadowGuc below has no way to detect "am I
// already inside an interactive $transaction?" and cannot guard against it;
// see that function's doc comment for what that means in practice.
let _extendedPrismaClient = null;
function getClosureExtendedClient() {
  if (!_extendedPrismaClient) {
    _extendedPrismaClient = require('./prisma-database').prisma || null;
  }
  return _extendedPrismaClient;
}

/**
 * RLS Phase 0 Task 3 — dispatches a by-id verb through the GUC-setting
 * batch $transaction (auto-commit form only).
 *
 * *** NOT SAFE INSIDE AN INTERACTIVE TRANSACTION — NO GUARD IS POSSIBLE. ***
 * An earlier version of this function tried to guard against that case by
 * checking `typeof client?.$transaction !== 'function'`, on the theory that
 * inside an interactive `$transaction(async (tx) => ...)` callback the hook
 * would see the tx-client (which lacks a `$transaction` of its own) as
 * `client`. That guard was fiction: Prisma 5.22.0 never puts a `client`
 * field on $allModels hook args AT ALL — not on auto-commit calls, not
 * inside an interactive transaction either (see getClosureExtendedClient
 * above) — so `client` here is always either a test-supplied mock or the
 * closure-captured EXTENDED SINGLETON, which always has a working
 * `$transaction`. The guard could never trip, so it silently did nothing:
 * a by-id call made from inside one of the ~50 interactive-transaction call
 * sites enumerated in task-3-report.md would still run this function,
 * still call `$transaction([...])` on the singleton — a DIFFERENT
 * connection from the one the surrounding interactive transaction is bound
 * to. That can dispatch the SET_CONFIG and the actual query on two
 * different physical connections (the GUC silently never reaches the
 * query), or stall/deadlock waiting for a connection while the pool is
 * exhausted by the still-open outer transaction (prototype-probe.js case
 * E's cross-connection failure).
 *
 * There is no reliable, non-invasive way to detect "am I already inside an
 * interactive transaction?" from inside a $allModels hook on this Prisma
 * version — do not attempt one (no `__internalParams` spelunking, no
 * try/catch-the-deadlock). The real fix is per-call-site: issue `SET LOCAL`
 * once at the top of each existing interactive transaction via
 * `tx.$executeRawUnsafe(...)`, which is the deferred Phase-0b work. Until
 * that lands, safety here is OPERATIONAL, not mechanical: shadowGucEnabled
 * (above) is a controlled-proof/benchmark-only switch — the operator must
 * never enable it in an environment that also serves traffic through the
 * ~50 in-tx call sites.
 */
function withShadowGuc(client, ctx, args, query) {
  if (ctx) {
    return withTenantGuc(client, ctx.organizationId, args, query);
  }
  if (isWithoutTenantScope()) {
    // Intentional bypass (platform-admin / cron / system) — mirrors the
    // app-layer withoutTenantScope() escape hatch onto the DB layer.
    return withBypassGuc(client, args, query);
  }
  // Genuinely missing context: nobody ever bound one — NOT the same as an
  // intentional withoutTenantScope (isWithoutTenantScope() is false here).
  // Task 1's checkMissingContext already logs this as a signal. Do NOT
  // route it to withBypassGuc — that would set app.rls_bypass='on' for an
  // op nobody scoped, i.e. fail OPEN (silently platform-admin-equivalent
  // once real enforcement lands). Run the plain bound query with NO GUC set
  // at all, so this path fails CLOSED under enforcement instead of bypassed.
  return query(args);
}

const tenantInjectExtension = {
  name: 'tenant-inject',
  query: {
    $allModels: {
      async create({ model, args, query }) {
        if (!isTenantScoped(model)) {return query(args);}
        const ctx = getTenantContext();
        if (!ctx) {return query(args);}
        args.data = applyToRecord(args.data, ctx.organizationId);
        return query(args);
      },

      async createMany({ model, args, query }) {
        if (!isTenantScoped(model)) {return query(args);}
        const ctx = getTenantContext();
        if (!ctx) {return query(args);}
        if (Array.isArray(args.data)) {
          args.data = args.data.map((r) => applyToRecord(r, ctx.organizationId));
        } else {
          args.data = applyToRecord(args.data, ctx.organizationId);
        }
        return query(args);
      },

      async upsert({ model, args, query, client }) {
        if (!isTenantScoped(model)) {return query(args);}
        const ctx = getTenantContext();
        if (ctx) {
          // Upsert's create branch always runs when no row matches `where`;
          // make sure it carries organizationId. This inject is the E.1
          // write guard — ALWAYS applied, independent of RLS_SHADOW_GUC.
          args.create = applyToRecord(args.create, ctx.organizationId);
        }
        if (!shadowGucEnabled()) {return query(args);}
        // RLS Phase 0 Task 3 (shadow): the update branch matches by
        // `where`, so once enforcement lands RLS needs to gate it the same
        // as a bare update — pin the GUC around the whole call either way.
        return withShadowGuc(client || getClosureExtendedClient(), ctx, args, query);
      },

      // RLS Phase 0 Task 3 (shadow) — update/delete had NO handler before
      // this: by-id writes relied on RLS alone (Phase 3 note atop this
      // file), so this extension never touched them. RLS_SHADOW_GUC=false
      // (default) keeps that exactly true: query(args) unmodified, the same
      // as having no handler registered at all for this verb.
      // RLS_SHADOW_GUC=true additionally routes the call through the same
      // GUC batch wrap as findUnique/upsert, purely to measure the
      // mechanism — the policy is still SELECT TRUE, so nothing is
      // enforced and no result changes.
      async update({ model, args, query, client }) {
        if (!shadowGucEnabled() || !isTenantScoped(model)) {return query(args);}
        return withShadowGuc(client || getClosureExtendedClient(), getTenantContext(), args, query);
      },

      async delete({ model, args, query, client }) {
        if (!shadowGucEnabled() || !isTenantScoped(model)) {return query(args);}
        return withShadowGuc(client || getClosureExtendedClient(), getTenantContext(), args, query);
      },

      // Read-side scoping (findMany / findFirst / count). Two INDEPENDENT
      // dimensions, both fail-open when their context is absent (scripts,
      // withoutTenantScope, public/unauthenticated reads → getXContext()=null):
      //   1. entity (entityId)  — Wave C, PR C-2. Always on for ENTITY_SCOPED_MODELS.
      //   2. organization (organizationId) — ENT-01 data-layer backstop for
      //      TENANT_SCOPED_MODELS. FLAG-GATED via env TENANT_READ_ORG_SCOPE so it
      //      can be enabled + verified on staging (2-org data) before prod. When
      //      the flag is off this is a strict no-op → behaviour identical to before.
      //
      // SAFE BY CONSTRUCTION: platform-admin + cron + system code already run
      // inside withoutTenantScope() (getTenantContext()=null), and public reads
      // have no tenant context — so the org filter only ever narrows reads that
      // run inside a bound single-tenant request, which is exactly the leak class.
      //
      // findUnique / update / delete are intentionally left alone for READ
      // FILTERING (by-id; deferred to RLS phase) — findUnique below is hooked
      // for TWO Phase-0 shadow signals only (checkMissingContext AND, since
      // Task 2, checkWouldBeBlockedResult), never for scoping; it still calls
      // query(args) unmodified, so its result is exactly what query()
      // resolved to. findFirst/findMany get the SAME post-read compare in
      // addition to their existing applyReadScopes filtering — the compare
      // is independent of that filter and stays live even if
      // TENANT_READ_ORG_SCOPE is ever disabled. aggregate / groupBy ARE
      // hooked for scoping below: they accept the same top-level `where`, so
      // they route through the IDENTICAL applyReadScopes fail-open
      // org-injection. Leaving them unhooked leaked _sum/groupBy stats
      // cross-org while sibling counts were scoped (see
      // invoice-service.js#getSummary). They do NOT get the would-be-blocked
      // compare (Task 2 scope decision) — aggregate/groupBy results carry no
      // org-bearing rows to compare.
      //
      // Read witness (spec 2026-09-30-remove-workspace-mode §3.1): every read
      // hook calls checkHolderScoped FIRST, on the args as they reach this
      // hook (Prisma's clone of the caller's), before applyReadScopes, whose
      // entity dimension overwrites where.entityId and would break the value
      // match against the request's registered holder fragments. Check-only:
      // in shadow mode (default) it never changes the op; in throw mode it
      // rejects an unscoped health read of a watched model before it runs.
      // findFirstOrThrow / findUniqueOrThrow are hooked for the witness only
      // (they had no handler; query(args) is passed through unchanged).
      async findMany({ model, args, query }) {
        checkHolderScoped(model, 'findMany', args);
        checkMissingContext(model, 'findMany');
        const result = await query(applyReadScopes(model, args));
        checkWouldBeBlockedResult(model, 'findMany', result);
        return result;
      },

      async findFirst({ model, args, query }) {
        checkHolderScoped(model, 'findFirst', args);
        checkMissingContext(model, 'findFirst');
        const result = await query(applyReadScopes(model, args));
        checkWouldBeBlockedResult(model, 'findFirst', result);
        return result;
      },

      // Phase-0 shadow metrics only (checkMissingContext +
      // checkWouldBeBlockedResult, see docs above) — no read-scope injection
      // here, so this remains a behavioural no-op beyond the two log
      // signals. Zero change to what the op returns: `result` is exactly
      // what query(args) resolved to, returned unmodified (compare-then-
      // return, never filter).
      async findUnique({ model, args, query, client }) {
        checkHolderScoped(model, 'findUnique', args);
        checkMissingContext(model, 'findUnique');
        // RLS Phase 0 Task 3 (shadow): GUC wrap goes BETWEEN the two Task
        // 1/2 shadow hooks, around the query itself — both hooks above/
        // below are preserved unmodified. Flag OFF (default) ⇒ this is
        // exactly `await query(args)`, byte-equivalent to before Task 3.
        const result =
          shadowGucEnabled() && isTenantScoped(model)
            ? await withShadowGuc(client || getClosureExtendedClient(), getTenantContext(), args, query)
            : await query(args);
        checkWouldBeBlockedResult(model, 'findUnique', result);
        return result;
      },

      async findFirstOrThrow({ model, args, query }) {
        checkHolderScoped(model, 'findFirstOrThrow', args);
        return query(args);
      },

      async findUniqueOrThrow({ model, args, query }) {
        checkHolderScoped(model, 'findUniqueOrThrow', args);
        return query(args);
      },

      async count({ model, args, query }) {
        checkHolderScoped(model, 'count', args);
        checkMissingContext(model, 'count');
        return query(applyReadScopes(model, args));
      },

      async aggregate({ model, args, query }) {
        checkHolderScoped(model, 'aggregate', args);
        checkMissingContext(model, 'aggregate');
        return query(applyReadScopes(model, args));
      },

      async groupBy({ model, args, query }) {
        checkHolderScoped(model, 'groupBy', args);
        checkMissingContext(model, 'groupBy');
        return query(applyReadScopes(model, args));
      },
    },
  },
};

module.exports = {
  tenantInjectExtension,
  isTenantScoped,
  TENANT_SCOPED_MODELS,
  isEntityScoped,
  ENTITY_SCOPED_MODELS,
  applyReadScopes,
  orgReadScopeEnabled,
  WOULD_BE_BLOCKED_SCAN_CAP,
  shadowGucEnabled,
};
