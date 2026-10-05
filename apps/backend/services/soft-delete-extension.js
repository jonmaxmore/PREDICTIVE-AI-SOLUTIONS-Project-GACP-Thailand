/**
 * Prisma Client Extension — auto-filter `isDeleted = false` on reads (G11).
 *
 * Why:
 *   The schema carries an `isDeleted` column on 19 lifecycle models. Before
 *   this extension every query had to remember `where: { isDeleted: false }`
 *   manually, and a missed one returned tombstones to the UI. This
 *   extension makes "active rows only" the default — every query
 *   automatically excludes soft-deleted rows unless explicitly opted out.
 *
 * What gets filtered:
 *   - findMany, findFirst, findFirstOrThrow
 *   - count, aggregate, groupBy
 *   - updateMany   (so a bulk update can't accidentally touch tombstones)
 *
 * What does NOT get filtered:
 *   - findUnique, findUniqueOrThrow, update, delete, upsert
 *     By-PK semantics: callers who target a specific row are expected to
 *     know what they're doing. Soft-delete writes use `update({ where, data:
 *     { isDeleted: true } })` — that path must not be filtered to itself.
 *   - deleteMany — physical delete is rare and intentional; preserve it as
 *     a hard-purge tool for ops scripts.
 *
 * Two escape hatches when callers DO want tombstones:
 *   - `withDeletedRows(() => ...)` async-local wrapper from
 *     soft-delete-context.js
 *   - Explicit `where.isDeleted` in any form (the extension only injects
 *     when the caller didn't mention isDeleted at all)
 *
 * The model list is intentionally hand-maintained — generating it from the
 * schema would mean parsing Prisma DSL at startup. Adding a new
 * soft-deletable model is a 2-line change here, mirroring
 * `tenant-prisma-extension.js`.
 */

const { getSoftDeleteContext } = require('./soft-delete-context');

/**
 * Models that carry an `isDeleted Boolean` column. Mirrors the schema —
 * keep in sync when adding/removing soft-delete on a model.
 *
 * Last refreshed: 2026-04-30 after Wave A Phase 15 added 8 new models.
 */
const SOFT_DELETE_MODELS = new Set([
  // tickets.prisma (B-DB-02 fix, 2026-06-04) — Ticket has isDeleted; classify
  // it here so soft-deleted tickets are auto-filtered on read (safe default).
  // Closes the soft-delete-registry-drift guard which flagged Ticket as
  // unclassified in neither registry set.
  'Ticket',
  // application.prisma
  'Application',
  'ApplicationComment',
  'ApplicationDraft',
  'ApplicationBundle',
  // auth.prisma
  'User',
  // billing.prisma
  'Invoice',
  'Quote',
  // certification.prisma
  'Certificate',
  // cultivation.prisma
  'PlantingCycle',
  // farm.prisma
  'Farm',
  // harvest.prisma
  'HarvestBatch',
  // batch-lab-result.prisma (T9, 2026-09-05) — auto-filtered, deliberately: a
  // withdrawn COA must stop appearing on the public scan the moment it is deleted,
  // and every read of it is a read somebody outside the platform can trigger.
  // lab-evidence-service filters isDeleted by hand as well; that filter guards the
  // un-extended clients (tests, scripts) and is not made redundant by this.
  'BatchLabResult',
  // system.prisma
  'ReportSubmission',
  'SOPDocument',
  'ScopeOfWork',
  'AuditChecklist',
  'MeetingRoom',
  // trace.prisma
  'Lot',
  'ConsumerFeedback',
  'PlantSpecies',
  // attachment.prisma (Wave A Phase 32 / G1)
  'Attachment',
  // survey.prisma — both carry isDeleted + deletedAt and arrived unclassified,
  // so their reads were never auto-filtered. ExpertInterview even indexes
  // isDeleted, which is only useful if something filters on it. Auto-filter is
  // the safe default here: an interview holds a masked transcript and key
  // insights, so a deleted one must not keep surfacing in reads.
  'SurveyTemplate',
  'ExpertInterview',
]);

/**
 * DB-03 — models that carry an `isDeleted` column in the schema but are
 * DELIBERATELY NOT auto-filtered. Keeping this as an explicit set (instead of
 * leaving them silently missing from SOFT_DELETE_MODELS) is what closes the
 * registry-vs-schema drift: `soft-delete-registry-drift.test.js` parses the
 * Prisma schema at runtime and asserts every isDeleted-bearing model is in
 * EXACTLY ONE of these two sets. Adding/removing `isDeleted` on any model now
 * fails that test until the model is consciously classified here.
 *
 * These seven are the finance ledgers + tenancy roots. Verified 2026-05
 * (file:line evidence, DB-03):
 *   - They are NEVER soft-deleted today: credit/debit notes void via
 *     `status: CANCELLED` (debit-note-service.js:462-464) — no code writes
 *     `data:{ isDeleted:true }` to any of them.
 *   - Every current read already passes `isDeleted: false` EXPLICITLY
 *     (credit-note-service.js:243,621,639; debit-note-service.js:507,517;
 *     vat-report-service.js:556,562,755,794; financial-statements-service.js:93;
 *     general-ledger-service.js:181,200; trial-balance-service.js:284;
 *     customer-statement-service.js:396).
 * So auto-filtering them would be a no-op on today's code. They are kept OUT of
 * the auto-filter on purpose: finance reconciliation / audit views must remain
 * free to inspect tombstones via an explicit `isDeleted` predicate without the
 * extension second-guessing them, and Entity/Organization are isolated by
 * tenant-prisma-extension, not soft-delete. Before relying on auto-filtering for
 * any of these, MOVE it into SOFT_DELETE_MODELS and add read-path coverage.
 */
const SOFT_DELETE_EXEMPT_MODELS = new Set([
  // billing.prisma — accounting ledgers
  'CreditNote',
  'DebitNote',
  'JournalEntry',
  'PurchaseInvoice',
  'Quotation',
  // auth.prisma — tenancy roots (scoped via tenant-prisma-extension)
  'Entity',
  'Organization',
]);

function hasSoftDelete(modelName) {
  return SOFT_DELETE_MODELS.has(modelName);
}

/**
 * Returns true if `where` already mentions `isDeleted` at any level the
 * caller might reasonably consider "explicit". We only check the top-level
 * key — Prisma will combine top-level keys with AND, so anything nested
 * inside an OR/AND is the caller's call.
 */
function hasExplicitIsDeleted(where) {
  if (!where || typeof where !== 'object') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(where, 'isDeleted');
}

function injectFilter(args) {
  const next = args ? { ...args } : {};
  const where = next.where || {};
  if (hasExplicitIsDeleted(where)) {
    return next;
  }
  next.where = { ...where, isDeleted: false };
  return next;
}

function shouldSkip(model) {
  if (!hasSoftDelete(model)) {
    return true;
  }
  const ctx = getSoftDeleteContext();
  if (ctx && ctx.includeDeleted) {
    return true;
  }
  return false;
}

// One handler factory keeps each operation override down to a single line.
function makeFilterHandler() {
  return async function filterHandler({ model, args, query }) {
    if (shouldSkip(model)) {
      return query(args);
    }
    return query(injectFilter(args));
  };
}

const softDeleteFilterExtension = {
  name: 'soft-delete-filter',
  query: {
    $allModels: {
      findMany: makeFilterHandler(),
      findFirst: makeFilterHandler(),
      findFirstOrThrow: makeFilterHandler(),
      count: makeFilterHandler(),
      aggregate: makeFilterHandler(),
      groupBy: makeFilterHandler(),
      updateMany: makeFilterHandler(),
    },
  },
};

module.exports = {
  softDeleteFilterExtension,
  hasSoftDelete,
  SOFT_DELETE_MODELS,
  SOFT_DELETE_EXEMPT_MODELS,
};
