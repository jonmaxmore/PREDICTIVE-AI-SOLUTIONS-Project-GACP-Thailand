const express = require('express');
const router = express.Router();

// Guards for the operational endpoints defined directly on this router.
const { authenticateProvider } = require('../../middleware/auth-middleware');
const { requireAdmin } = require('../../middleware/require-admin');

// ─────────────────────────────────────────────────
// Import route modules — organized by domain
// ─────────────────────────────────────────────────

// Auth
const authHealthRouter = require('./auth/auth-health');
const authProviderRouter = require('./auth/auth-provider');
const publicRouter = require('./auth/public');

// Applications
const applicationsRouter = require('./applications/applications');
const validationRouter = require('./applications/validation');
const criteriaRouter = require('./applications/criteria');

// Finance
const invoicesRouter = require('./finance/invoices');
const paymentsRouter = require('./finance/payments');
const quotesRouter = require('./finance/quotes');
const accountingRouter = require('./finance/accounting');

// Audit
const auditsRouter = require('./audit/audits');

// Cultivation
const plantingCyclesRouter = require('./cultivation/planting-cycles');
const cultivationLogsRouter = require('./cultivation/cultivation-logs');
const harvestBatchesRouter = require('./cultivation/harvest-batches');
const farmsRouter = require('./cultivation/farms');

// Trace
const traceRouter = require('./trace/trace');
const lotsRouter = require('./trace/lots');

// Certificates
const certificatesRouter = require('./certificates/certificates');

// Identity
const consentRouter = require('./identity/consent');

// System
const notificationsRouter = require('./system/notifications');
const ticketsRouter = require('./system/tickets');
const configRouter = require('./system/config');
const dashboardRouter = require('./system/dashboard');
const providerDirectoryRouter = require('./system/provider');
const providerOperationsRouter = require('./provider/index');

// Documents
const documentsRouter = require('./documents/documents');

const { auditMiddleware } = require('../../middleware/audit-middleware');
const { ENTITIES } = require('../../services/audit-trail');

// ─────────────────────────────────────────────────
// Mount routes (Canonical Surface)
// ─────────────────────────────────────────────────

// System & Identity
router.use('/notifications', notificationsRouter);
router.use('/tickets', ticketsRouter);
router.use('/config', configRouter);
router.use('/system-config', require('./system/system-config-routes'));
router.use('/dashboard', dashboardRouter);
router.use('/system', require('./system/system'));
router.use('/cron', require('./system/cron'));
router.use('/sync', require('./system/sync'));
// E2E routes — NEVER loaded in production to eliminate attack surface.
// Primary gate (this conditional require) keeps the module out of the request
// graph entirely; the e2e router itself also has a 404 fallback middleware as
// defense-in-depth. Together they ensure production cannot reach the
// e2e-controller, which performs bulk DB operations and is intended only for
// dev/UAT/test harnesses.
if (process.env.NODE_ENV !== 'production') {
    router.use('/e2e', require('./system/e2e'));
}
router.use('/master-data', require('./system/master-data'));
router.use('/analytics', require('./system/analytics'));
// /subscription — REMOVED 2026-09-11 (คำสั่ง operator: แพลตฟอร์มไม่มีบริการแพ็กเกจสมาชิก)
// ทั้งประตู entitlement snapshot และ subscription-orders ถูกลบพร้อมตาราง subscriptions
// ประตูสร้างล็อตที่เคยกั้นไว้ที่ PREMIUM เปิดแล้ว — ด่านจริงคือความเป็นเจ้าของรุ่น ซึ่งอยู่ครบ
router.use('/mfa', require('./identity/mfa'));
router.use('/consent', consentRouter);

// Iter 27 (PDPA right-to-forget, 2026-05-16): PDPA ม.32 erasure endpoint
// pair. HEALTH self-service request → confirm with email-delivered token;
// executeErasure anonymises User PII + Application.formData PII leaves
// + Certificate display fields, while PRESERVING tax/accounting records
// (Invoice / JournalEntry / PaymentSlip / AuditLog) per ม.87/3 ป.รัษฎากร
// 7-year retention. ADMIN-only list view for compliance triage.
router.use('/pdpa/erasure', require('./pdpa/erasure'));

// Entities (Wave C — workspace-switcher surface; entity-listing + audit)
router.use('/entities', require('./entities/index'));

// Auth
router.use('/auth/health', authHealthRouter);
router.use('/auth/provider', authProviderRouter);
// AUTH-01 P2: OAuth IdP entry (authorize-url + callback) — backend-only code
// exchange per mandate §D3; provider registry fails closed via
// config/auth-providers.js (evidence/AUTH-01/plan.md P2)
router.use('/auth/idp', require('./auth/auth-idp'));
router.use('/public', publicRouter);

// Provider Operations
const providerRouter = express.Router();
providerRouter.use(auditMiddleware({ entityType: ENTITIES.SYSTEM }));
providerRouter.use('/', providerOperationsRouter);
providerRouter.use('/directory', providerDirectoryRouter); // Mounted explicitly at /directory to prevent clashes
router.use('/provider', providerRouter);

// Platform-Admin (cross-tenant) — ADR-014 multi-tenancy admin surface.
// All handlers wrap their Prisma calls in withoutTenantScope().
router.use('/platform-admin/organizations', require('./platform-admin/organizations'));

// Applications (consolidated domain — new canonical paths + legacy aliases)
const appConsolidated = express.Router();
appConsolidated.use('/config', require('./applications/applications-config'));
appConsolidated.use('/validate', validationRouter);                    // NEW: /api/applications/validate
appConsolidated.use('/calculations', require('./applications/calculations'));  // NEW: /api/applications/calculations
appConsolidated.use('/revision-deadline', require('./applications/revision-deadline'));
appConsolidated.use('/bundles', require('./applications/application-bundles'));  // NEW: /api/applications/bundles
appConsolidated.use('/journey', require('./applications/journey'));  // NEW: /api/applications/journey
// Iter 26 (renewal workflow, 2026-05-16): annual re-certification.
// HEALTH applicant POSTs originalCertificateId; service validates
// ownership + ACTIVE status and creates a DRAFT renewal application
// with carry-forward farm/cultivation data. Provider/admin GET
// upcoming-expiry feeds the renewal-reminder cron's reverse view.
// Mounted BEFORE the catch-all '/:applicationId/...' sub-router so
// '/renewals' resolves to its own handler instead of being parsed as
// an applicationId.
appConsolidated.use('/renewals', require('./applications/renewals'));
// Tier 18 / B18-A (2026-05-16) — quotation sub-router under
// /api/applications/:applicationId/quotations. The router uses
// mergeParams:true so :applicationId from this mount propagates inside.
appConsolidated.use('/:applicationId/quotations', require('./applications/quotations'));
// CAR (เอกสารตอบข้อบกพร่อง) — router ประกาศเส้นทางของตัวเองไว้เป็น '/:id/car' จึงต้องแขวนที่ราก
// ของโดเมน application · เดิมแขวนไว้ใต้เซกเมนต์ '/car' อีกชั้น ทางจริงเลยกลายเป็น
// /api/applications/car/:id/car ซึ่งไม่มีหน้าจอไหนเรียก และเทสทุกตัวก็ mount เองที่ราก
// จึงไม่มีใครเห็นว่าประตูนี้ตายอยู่ (วัดจริง 2026-09-07: 404 Cannot POST)
appConsolidated.use('/', require('./applications/applications-car'));
appConsolidated.use('/', applicationsRouter);                          // Main CRUD
router.use('/applications', appConsolidated);

// Legacy application route aliases (backward compat — will be removed in v4)
router.use('/validation', validationRouter);
router.use('/calculations', require('./applications/calculations'));
router.use('/criteria', criteriaRouter);
router.use('/cultivation-config', require('./applications/journey'));
router.use('/revision-deadline', require('./applications/revision-deadline'));
router.use('/application-bundles', require('./applications/application-bundles'));

// Finance
router.use('/invoices', invoicesRouter);
router.use('/pricing', require('./finance/pricing'));
router.use('/payments', paymentsRouter);
// Wave 2 — Stripe webhook (design v2 §5.5). Reached as /api/v1/webhooks/stripe
// through the /api/v1 alias (and /api/webhooks/stripe unversioned). No auth
// middleware: authenticity is the stripe-signature HMAC over the raw body.
router.use('/webhooks', require('./webhooks/stripe'));
// Two-card payment flow (B18-B, 2026-05-16): read-only issuer + bank
// channel lookup sourced from `config/invoice-issuers.js`. Frontend
// PaymentInvoiceCard calls this per-invoice so each card displays the
// right bank + QR for its issuer (DTAM vs PLATFORM).
router.use('/finance/issuers', require('./finance/issuers'));
router.use('/quotes', quotesRouter);
router.use('/accounting', accountingRouter);
// B19-C (tax/compliance, 2026-05-16): ภ.พ.30 Output-VAT monthly
// report + RD e-Filing CSV export + period-closable check.
// Read by both finance roles + system_admin_dtam (operator 2026-09-11 "finance
// ต้องเห็นเหมือนกัน"; field_inspector removed 2026-09-27). Every call is
// VAT_REPORT_EXPORTED audited.
router.use('/finance/tax-reports', require('./finance/tax-reports'));
// Iter 26 (hardening loop, 2026-05-16): WHT (Withholding Tax 3%) STUB —
// records ทบ.50 ทวิ certificates that corporate buyers mail to
// platform finance + computes indicative 3% amounts. Per
// ป.รัษฎากร ม.50 + ม.69 ทวิ the PAYER (buyer) does the actual
// withholding + ภ.ง.ด.53 remittance; the platform (seller) only
// RECEIVES the certificate. Auto-deduction at point of sale + the
// monthly ภ.ง.ด.53 pipeline are intentionally deferred — see
// docs/tax/wht-stub-2026-05-16.md. Roles: finance_officer_platform +
// system_admin_dtam write; both finance roles + system_admin_dtam read.
router.use('/finance/wht', require('./finance/wht'));
// B19-B (financial-reports, 2026-05-16): TFRS for NPAEs core
// statements — Trial Balance, P&L, Balance Sheet, General Ledger.
// Reads JournalEntry/JournalLine; both finance roles + system_admin_dtam
// read (9xxx suspense excluded by the aggregator). Every call is
// FINANCE_REPORT_EXPORTED audited per Thai e-Transactions Act §31.
router.use('/finance/reports', require('./finance/reports'));
// B20-A (credit/debit notes, 2026-05-16): ใบลดหนี้ (ม.86/10) +
// ใบเพิ่มหนี้ (ม.86/9) corrections to a previously issued PLATFORM full
// tax invoice. finance_officer_platform + system_admin_dtam write; both
// finance roles + system_admin_dtam read (role + tenant scope enforced
// inside the services). Every mutation audit-logs via auditLogger as
// CREDIT_NOTE_* / DEBIT_NOTE_* actions per Thai e-Transactions Act §31.
router.use('/finance/credit-notes', require('./finance/credit-notes'));
router.use('/finance/debit-notes', require('./finance/debit-notes'));
// Iter 26 (purchase invoices / Input VAT, 2026-05-16): ใบกำกับภาษีซื้อ
// tracking so ภ.พ.30 monthly filing includes the Input VAT side per
// ป.รัษฎากร ม.82/3 + ม.82/4 + ม.83/8. finance_officer_platform +
// system_admin_dtam create / approve / reject / mark-paid; both finance
// roles + system_admin_dtam read. Each
// approval writes the Input VAT journal entry (Dr Input VAT,
// Cr Cash / AP) so the trial balance + ภ.พ.30 reconcile. Audit-logged
// per Thai e-Transactions Act §31.
router.use('/finance/purchase-invoices', require('./finance/purchase-invoices'));
// Iter 23 (refund orchestration, 2026-05-16): refund flow that wraps
// credit-note (ม.86/10) creation + issue + post into a single transaction,
// then notifies the applicant via notification-fanout-service. Scope is
// PLATFORM-side only — STATE invoice refunds route through Treasury's
// กรมบัญชีกลาง refund process. Initiate: finance_officer_platform +
// system_admin_dtam; status: both finance roles + system_admin_dtam;
// cancel: system_admin_dtam only (separation of duties).
router.use('/finance/refunds', require('./finance/refunds'));
// B20-C (manual journal-entry workflow, 2026-05-16): DRAFT → APPROVED
// → POSTED for non-slip-driven entries. Separation-of-duties enforced
// at the service layer (approver ≠ creator) per TFRS for NPAEs ch.2.
router.use('/finance/manual-journal-entries', require('./finance/manual-journal-entries'));
// Iter 24 (period close, 2026-05-16): monthly accounting-period close
// workflow per TFRS for NPAEs ch.5. Once a (organizationId, year, month)
// triple is CLOSED, the journal-entry layer REJECTS new entries whose
// entryDate falls inside that period — preventing back-dating fraud.
// Close: finance_officer_platform + system_admin_dtam. Reopen: admin-only with separation-
// of-duties enforced (reopener MUST differ from original closer). Every
// state transition is audit-logged per Thai e-Transactions Act §31.
router.use('/finance/period-close', require('./finance/period-close'));
// T14 (2026-09-05): ส่งกลับให้เจ้าหน้าที่ตรวจ — the applicant returns ONE paper.
// The other end of /provider/applications/:id/document-reviews. Mounted before
// the generic applications router so its specific path matches first.
router.use('/applications', require('./applications/revision-resubmit'));
// F-TNT-M30-01 — the applicant's own copy of what an auditor wrote about them (PDPA ม.30).
router.use('/applications', require('./applications/audit-notes'));

// B20-D (customer-reports, 2026-05-16): Customer Statement
// (สรุปยอดลูกค้า) + AR Aging (รายงานลูกหนี้ค้างชำระ). Both finance roles +
// system_admin_dtam see both book sides (the viewer picks one). Applicant healthId
// is always masked at the service boundary per PDPA ม.6
// (data minimisation). Every read is CUSTOMER_REPORT_EXPORTED
// audited per Thai e-Transactions Act §31 + PDPA ม.39.
router.use('/finance', require('./finance/customer-reports'));

// Iter 25 (audit scheduling, 2026-05-16): bridges AUDIT_FEE_PAID →
// AUDIT_CONFIRMED in the canonical GACP workflow. SCHEDULER (or ADMIN)
// assigns auditor + date; HEALTH applicant can request reschedule.
// Conflict detection (no overlap, max 2 audits/day per Bureau of Audit
// 2566/2.4) lives in the service layer. Working-day rule per
// utils/working-days (ไม่นัดวันเสาร์-อาทิตย์/วันหยุดราชการ).
router.use('/audit/scheduling', require('./audit/scheduling'));

// Iter V3 / V3-A (DI-1 fix, 2026-05-17): mobile on-site inspection
// flow that the auditor reaches via /provider/audits/[id]/inspect.
// Endpoints: GET /context, POST /start, /checklist, /photo,
// POST /decision, GET /gps-verify. File-level guard requires
// AUDIT_STAFF; per-mutation routes narrow to AUDITORS. Prior to
// V3-A this router file existed on disk but was never required —
// every page load of the inspect screen 404'd silently on
// AuditService.getOnsiteContext(). See iter-V3/00-rfc.md §DI-1.
router.use('/audit/onsite', require('./audit/onsite'));

// Audit (consolidated domain — new canonical paths + legacy aliases)
const auditConsolidated = express.Router();
auditConsolidated.use('/reassign', require('./audit/audits-reassign'));
// /audits/farm — REMOVED. The backing module routes/api/audit/farm-audit.js
// (and its only consumer, services/farm-audit-checklist-service.js) referenced
// phantom Prisma models (`gcpChecklistTemplate`, `farmAuditChecklists`,
// `farmAuditPhotos`) that do not exist in any schema file, so every endpoint
// 500'd with `prisma.<x> is not a function`. Both were already UNMOUNTED with
// zero require-site callers (the live onsite-audit flow at ./audit/onsite uses
// guarded prisma access and does not depend on them), so the dead cluster was
// deleted outright. Re-introduce a real implementation when farm-audit
// checklists become a feature with backing schema.
auditConsolidated.use('/post', require('./audit/post-audit'));          // NEW: /api/audits/post
auditConsolidated.use('/fraud', require('./audit/fraud-detection'));    // NEW: /api/audits/fraud
auditConsolidated.use('/site-analysis', require('./audit/site-analyses')); // NEW: /api/audits/site-analysis
auditConsolidated.use('/', auditsRouter);                               // Main CRUD
auditConsolidated.use('/', require('./audit/audit'));                    // Legacy audit actions
router.use('/audits', auditConsolidated);

// Legacy audit route aliases (backward compat — will be removed in v4)
router.use('/audit', require('./audit/audit'));
// /farm-audits legacy alias — REMOVED alongside the canonical mount above
// (the backing farm-audit module was deleted — see the note on /audits/farm).
router.use('/post-audit', require('./audit/post-audit'));
router.use('/fraud-detection', require('./audit/fraud-detection'));
router.use('/site-analyses', require('./audit/site-analyses'));

// Cultivation
router.use('/plants', require('./cultivation/plants'));
router.use('/harvest-batches', harvestBatchesRouter);
router.use('/planting-cycles', plantingCyclesRouter);
router.use('/cultivation-logs', cultivationLogsRouter);
router.use('/farms', farmsRouter);
router.use('/water-sources', require('./cultivation/water-sources'));
router.use('/seed-sources', require('./cultivation/seed-sources'));
router.use('/fertilizer-records', require('./cultivation/fertilizer-records'));
router.use('/controlled-environments', require('./cultivation/controlled-environments'));
router.use('/plots', require('./cultivation/plots'));
// No per-plant router is mounted here, and none may be added back. R8 of
// design note 2026-08-20-planting-tnt-design retires per-plant
// tracking: traceability resolves to planting cycle / plot and to Lot, never
// to an individual plant. The 16-endpoint `/plant-units` router that used to
// be mounted at `/` — generate, confirm, per-plant QR, care logs, mark-sold —
// was deleted with its service on 2026-08-25.

// Trace
router.use('/trace', traceRouter);
router.use('/lots', lotsRouter);

// Certificates
router.use('/certificates', certificatesRouter);
router.use('/standards', require('./certificates/standards'));

// Files — W1-2 signed download URLs for the private /uploads mount, so a
// browser <img>/download can fetch an entitled private file without an
// Authorization header. See routes/api/files/files.js.
router.use('/files', require('./files/files'));

// Documents
router.use('/documents', documentsRouter);
router.use('/templates', require('./documents/templates'));
router.use('/report-submissions', require('./documents/report-submissions'));
router.use('/reports', require('./documents/reports'));
router.use('/training-records', require('./documents/training-records'));
router.use('/sop-documents', require('./documents/sop-documents'));

// Preview
router.use('/preview', require('./preview/preview'));

// Integration
router.use('/interoperability', require('./integration/interoperability'));
router.use('/consumer-feedback', require('./integration/consumer-feedback'));

// Surveys (สัญญา C05F680149 ต้นแบบที่ 2 — ระบบสำรวจความต้องการ; auth per-route:
// template master data = provider ADMIN, respondent submit = authenticateAny)
router.use('/surveys', require('./surveys/surveys'));

// Herb Knowledge DB (สัญญา C05F680149 ต้นแบบที่ 5 — ฐานข้อมูลสมุนไพร 6 ฐาน;
// global reference data: public reads + ADMIN-only writes per-route)
router.use('/herbs', require('./herbs/herbs'));

// Image Assessment (สัญญา C05F680149 ต้นแบบที่ 6 — ตรวจสอบและประเมิน 3 โมดูล:
// image inspection + quality scoring + disease detection; AUDIT_STAFF, advisory)
router.use('/image-assessment', require('./audit/image-assessment'));

// Datasets (สัญญา C05F680149 ภาคผนวก 4 ข้อ 3 — ชุดข้อมูลดิบ + data dictionary
// → Data Lake บพข.; catalog/dictionary = provider read, export = ADMIN)
router.use('/datasets', require('./datasets/datasets'));

// Admin console API (Iter-28): users / audit-log / config / plants / planting-cycles /
// applications. Auth-gated inside ./admin (authenticateProvider + requireAdmin).
//
// audit 2026-06-10 follow-up: this router was previously mounted ONLY inside the
// ENABLE_PROVIDER_LEGACY_ALIAS block below — but that flag is set in NO environment
// (nothing in .env.example / compose / docs references it), so every /admin/* endpoint
// 404'd on staging+prod (e.g. /admin/users rendered an "HTTP 404" banner + an empty
// table) even though the /admin/* FE pages and admin-service-b28 are written to call it.
// It is the CURRENT admin console, not a legacy alias, so mount it unconditionally here
// (still admin-only). The genuinely-legacy aliases (provider-cms, wizard) stay gated.
router.use('/admin', require('./admin'));

// ─────────────────────────────────────────────────
// Legacy / Compatibility Routes (Flagged)
// ─────────────────────────────────────────────────
if (process.env.ENABLE_PROVIDER_LEGACY_ALIAS === 'true') {
    router.use('/provider-cms', require('./system/provider-cms'));
    router.use('/wizard', require('./applications/wizard'));
}

// ─────────────────────────────────────────────────
// Health / Metrics / Version
// ─────────────────────────────────────────────────
const prismaDatabase = require('../../services/prisma-database');
const appMetrics = require('../../shared/metrics');
const { buildInfo } = require('../../shared/build-info');

router.get('/health', async (req, res) => {
  try {
      const dbHealth = await prismaDatabase.healthCheck();
      const overallSuccess = dbHealth && dbHealth.status === 'connected';

      const build = buildInfo();

      res.status(overallSuccess ? 200 : 503).json({
        success: overallSuccess,
        // Hardcoded, and left that way on purpose in this change:
        // __tests__/integration/production-smoke.test.js:192 asserts this exact
        // string. It has never moved since the first commit, so it says nothing
        // about what is deployed — `revision` below is the field that does.
        version: '3.0.0',
        revision: build.revision,
        builtAt: build.builtAt,
        database: 'postgresql',
        dbStatus: dbHealth,
        message: overallSuccess ? 'GACP API v3.0 is running' : 'System Unhealthy',
      });
  } catch (_err) {
      res.status(503).json({ success: false, message: 'Healthcheck failed' });
  }
});

// Liveness/readiness split (Iter 29). The inline GET /health above stays
// authoritative for /api/health (back-compat `{ success }` shape used by smoke
// tests + the docker healthcheck). Mounting the health router here additionally
// exposes GET /api/health/ready (DB + migrations + secrets gate) WITHOUT shadowing
// the inline handler: router.get('/health') matches the exact path first, and
// '/health/ready' falls through to this router.
router.use('/health', require('./health'));

// Operational telemetry is staff data. nginx proxies all of /api/ to the
// backend and the only thing in front of this router is the rate limiter, so
// without a guard here anyone on the internet could ask a government platform
// for its uptime, per-endpoint request and error counters, response-time
// samples, host CPU and memory, socket counts and database timing.
//
// Most of those recorders are not wired up today, so the payload is currently
// thin — which is the reason to close it now rather than after someone wires
// them up and quietly turns this into a live operational feed.
//
// /health above stays anonymous on purpose: the container healthcheck and any
// load-balancer probe depend on it.
router.get('/metrics', authenticateProvider, requireAdmin, (_req, res) => {
  res.json({
    success: true,
    data: appMetrics.getMetrics(),
  });
});

router.get('/version', (req, res) => {
  res.json({
    success: true,
    version: '3.0.0',
    minClientVersion: '1.0.0',
    features: ['notifications', 'tickets', 'config', 'plants', 'harvest-batches', 'validation'],
  });
});

module.exports = router;
