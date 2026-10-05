/**
 * Payment Routes - จัดการการชำระเงิน
 */

const express = require('express');
const router = express.Router();
// Sprint 6 healthId-audit H10: payments.js now imports the real `authenticateHealth`
// middleware instead of aliasing `authenticateAny` to it. The alias was hiding the
// fact that provider tokens were also accepted here, which bypasses the portal-
// separation invariant added by the canonical auth split.
const { authenticateHealth, authenticateProvider } = require('../../../middleware/auth-middleware');
// Direct Prisma client removed: invoice listing and application ownership
// checks now go through the canonical services so this route file no longer
// embeds row-level filters (isDeleted, healthId scoping) that must stay
// consistent across every read path. See docs/tech-debt/prisma-bypass-routes.md.
const logger = require('../../../shared/logger');
const { safeErrorMessage, isValidUUID } = require('../../../shared/api-response');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');
const { getRequestIp } = require('../../../utils/client-ip');
const {
  createPhase1Payment,
  // createPhase2Payment retired 2026-06-09 — Phase-2 is the canonical slip-upload
  // flow (#397). The service fn is kept (still exported + unit-tested) but no
  // route calls it; see the /phase2 + /create deprecation 410s below.
  _syncPhaseStatusesFromInvoices,
  getInvoiceSettlementsForApplication,
} = require('../../../services/payment-service');
// Sprint 6 healthId-audit H8: identity resolution goes through the canonical
// applicationService.resolveHealthIdentity instead of an ad-hoc file-local
// prisma.user.findFirst query.
const applicationService = require('../../../services/application-service');
const { holderScope, assertHolderCapability } = require('../../../services/holder-access');
const { entityPermissionDeniedBody } = require('../../../shared/entity-permission-denied');
const { ERROR_CODES } = require('../../../shared/error-codes');

/**
 * The catalogued refusal createPhase1Payment raises when the accepted
 * quotation's locked price cannot be read (fail closed, operator 2026-10-03;
 * payment-service-phase-flow.resolveLockedPhaseTotals). Answered with its own
 * code, status and Thai sentence instead of the generic 400, so the applicant
 * is told the cause and to try again. null for every other error (unchanged).
 */
function lockedPriceRefusal(error) {
  const row = ERROR_CODES.QUOTATION_GATE_UNAVAILABLE;
  if (error?.code !== row.code) { return null; }
  return {
    status: error.statusCode || error.status || row.httpStatus,
    body: { success: false, error: row.code, message: error.message || row.messageTh },
  };
}

// Phase 2 #2.1 — every payment-initiation event writes to the immutable
// audit_logs hash chain. ISO 27799 / PDPA require a verifiable trail of
// who triggered which financial action and from where. Failures are
// swallowed so the audit subsystem never breaks the payment path.
async function logPaymentEvent(req, action, severity, payload) {
  try {
    await auditLogger.log({
      category: AuditCategory.PAYMENT,
      action,
      severity,
      actorId: req.user?.id || 'ANONYMOUS',
      actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
      actorType: req.user?.providerId ? 'PROVIDER' : 'USER',
      resourceType: ResourceType.PAYMENT,
      resourceId: payload?.invoiceId || payload?.applicationId || 'unknown',
      ipAddress: getRequestIp(req),
      userAgent: req.get('user-agent'),
      metadata: payload || {},
    });
  } catch (err) {
    // Audit log failure must NOT break payment creation. Log it locally
    // so it's visible in the application log, but do not throw.
    logger.warn('[Payments] audit log failed (non-fatal):', err?.message);
  }
}

const PHASE_FROM_STATUS = Object.freeze({
  SUBMITTED: 'PHASE_1',
  PENDING_DOC_FEE: 'PHASE_1',
  PAYMENT_1_PENDING: 'PHASE_1',
  DOC_FEE_PAID: 'PHASE_1',
  DOC_APPROVED: 'PHASE_2',
  PENDING_AUDIT_FEE: 'PHASE_2',
  PAYMENT_2_PENDING: 'PHASE_2',
  UNDER_REVIEW: 'PHASE_2',
});

// `computeMasterBreakdownByPhase` lived here and returned flat PAYMENT_FEES
// constants — one scope, always. It was reached as
// `result.breakdown || computeMasterBreakdownByPhase(phase)`, and no return
// path of createPhase1Payment ever set `breakdown`, so it fired every time.
// Meanwhile fee-service charges `ratePerScope * scopeCount` and
// resolveLockedPhaseTotals prefers the total frozen on an accepted quotation,
// and that is the figure written to the invoice. So the screen and the invoice
// disagreed for every applicant with more than one cultivation method — and
// payment-slip-service matches the transferred amount against the invoice
// exactly, so their slip was rejected over a difference the platform created.
// The service reports its own breakdown now. One authority.

/**
 * F-G4-64 R1, whole-branch review C4 — this door asks the ONE quotation gate
 * before a payment record can exist, exactly as the card rail and the slip rail
 * do. Until now the gate had two callers and this rail had none, so the wizard's
 * own pay button minted phase-1 invoices for an application whose priced
 * document nobody had accepted (or which had no document at all).
 *
 * The payable set is the CARD RAIL'S OWN `PAYABLE_STATES.M1`, imported rather
 * than retyped: it dropped DRAFT because a DRAFT application has no quotation to
 * accept, and three doors that each keep their own copy of "when an instalment
 * exists" is how the two rails drifted apart in the first place.
 *
 * Returns the refusal to send, or null when this door may mint.
 *
 * @param {{id: string, status: string}} application ownership already proved
 * @returns {Promise<{status: number, body: object}|null>}
 */
/**
 * Who may start a payment for an application (spec 2026-09-30 §3.3, operator Q3):
 * a member holding SUBMIT_APPLICATION on its holder. The legacy invoice doors
 * (/create, /phase1/:applicationId) ask it before any service call, exactly as
 * /checkout does. An authz gate only: amounts, statuses, invoice numbering and
 * settlement are untouched. Answers the request and returns true when it refused.
 * @returns {Promise<boolean>}
 */
async function refuseUnlessMayPay(req, res, applicationId, scope, refusedAction) {
  const target = await applicationService.findApplicationHolderForHealth(applicationId, { holderScope: scope });
  if (!target) {
    res.status(404).json({ success: false, error: 'Application not found' });
    return true;
  }
  try {
    await assertHolderCapability(req.user?.id, target.entityId, 'SUBMIT_APPLICATION');
    return false;
  } catch (error) {
    if (error?.code !== 'ENTITY_PERMISSION_DENIED') { throw error; }
    await logPaymentEvent(req, refusedAction, AuditSeverity.WARNING, {
      applicationId,
      reason: 'ENTITY_PERMISSION_DENIED',
    });
    res.status(403).json(entityPermissionDeniedBody(error.permission));
    return true;
  }
}

async function refusalForPhase1Mint(application) {
  const { PAYABLE_STATES } = require('../../../services/checkout/stripe-checkout-service');
  if (!PAYABLE_STATES.M1.includes(application.status)) {
    return {
      status: 409,
      body: {
        success: false,
        error: 'PAYMENT_PHASE_UNAVAILABLE',
        message: `Cannot create payment from status ${application.status}`,
      },
    };
  }
  const { assertQuotationAcceptedForPayment } = require('../../../services/billing/quotation-gate');
  try {
    await assertQuotationAcceptedForPayment({
      applicationId: application.id,
      milestone: 'PHASE_1',
    });
    return null;
  } catch (error) {
    // Every refusal this gate raises carries its catalogued code, HTTP status
    // and Thai sentence; anything without a code is a real fault and belongs to
    // the route's own catch.
    if (!error?.code) { throw error; }
    return {
      status: error.statusCode || error.status || 409,
      body: { success: false, error: error.code, message: error.message },
    };
  }
}

function resolveRequestedPhase(payloadPhase, status) {
  const explicit = String(payloadPhase || '').trim().toUpperCase();
  if (explicit === 'PHASE_1' || explicit === '1' || explicit === 'DOC') {
    return 'PHASE_1';
  }
  if (explicit === 'PHASE_2' || explicit === '2' || explicit === 'AUDIT') {
    return 'PHASE_2';
  }
  return PHASE_FROM_STATUS[String(status || '').trim().toUpperCase()] || null;
}

// Sprint 6 healthId-audit H8: delegate to the canonical service. The legacy
// shape (returns a string or null) is preserved so existing call sites don't
// change. resolveHealthIdentity throws when neither healthId nor a resolvable
// userId is present; here we swallow that to return null because the caller
// branches on `if (!healthId)` to apply role-based logic.
async function resolveHealthId(req) {
  const explicitHealthId = String(req.user?.healthId || '').trim();
  const userId = String(req.user?.id || '').trim();
  if (!explicitHealthId && !userId) {
    return null;
  }
  try {
    const identity = await applicationService.resolveHealthIdentity(userId, {
      healthId: explicitHealthId || undefined,
      userId: userId || undefined,
    });
    return identity.healthId || null;
  } catch (_error) {
    return null;
  }
}

/**
 * Canonical payment creation endpoint (Master API)
 * POST /api/payments/create
 *
 * @swagger
 * /api/payments/create:
 *   post:
 *     tags: [Payments]
 *     summary: Initiate a payment for an application (auto-detects phase)
 *     description: |
 *       Canonical entry point — resolves Phase 1 vs Phase 2 from the
 *       application status (or explicit `phase` override) and returns the
 *       payment URL. Ownership is enforced server-side; non-owner HEALTH
 *       users get 404. Every event hashes into the audit chain
 *       (PAYMENT_INITIATED / PAYMENT_INITIATE_FAILED).
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [applicationId]
 *             properties:
 *               applicationId:
 *                 type: string
 *                 format: uuid
 *               phase:
 *                 type: string
 *                 enum: [PHASE_1, PHASE_2, '1', '2', DOC, AUDIT]
 *     responses:
 *       200:
 *         description: Payment created (or existing) — includes invoiceId, paymentUrl, expiresAt, fee breakdown
 *       400:
 *         description: APPLICATION_ID_REQUIRED — missing/invalid id
 *       401:
 *         description: Unauthorized — no healthId on token
 *       404:
 *         description: Application not found
 *       409:
 *         description: PAYMENT_PHASE_UNAVAILABLE — current status disallows new payment
 *       429:
 *         description: Rate limit exceeded (paymentLimiter)
 */
router.post('/create', authenticateHealth, async (req, res) => {
  // Hoisted outside try so the audit-log catch branch (Phase 2 #2.1) can
  // reference it.
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const applicationId = String(payload.applicationId || payload.id || '').trim();
  try {
    if (!applicationId || !isValidUUID(applicationId)) {
      return res.status(400).json({
        success: false,
        error: 'APPLICATION_ID_REQUIRED',
        message: !applicationId ? 'Application ID is required' : 'Invalid application ID format',
      });
    }

    const healthId = await resolveHealthId(req);
    if (!healthId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    // Who may pay (SUBMIT_APPLICATION on the holder, Q3) is asked first (R2 Task 9
    // fix round 1). Then the holder-scoped lookup (spec 2026-09-30 §3.1): the
    // service-level method enforces the holder fragment + isDeleted=false.
    const createScope = await holderScope(req);
    if (await refuseUnlessMayPay(req, res, applicationId, createScope, 'PAYMENT_INITIATE_REFUSED')) { return undefined; }
    const application = await applicationService.findForPaymentOwnership(applicationId, {
      holderScope: createScope,
    });
    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Application not found',
      });
    }

    const phase = resolveRequestedPhase(payload.phase, application.status);
    if (!phase) {
      return res.status(409).json({
        success: false,
        error: 'PAYMENT_PHASE_UNAVAILABLE',
        message: `Cannot create payment from status ${application.status}`,
      });
    }

    if (phase === 'PHASE_2') {
      // DEPRECATED (2026-06-09): Phase-2 payment via this endpoint is retired.
      // Canonical งวดที่ 2 billing (as of 2026-09-11): approving the documents
      // issues the quotation automatically (F-G4-71 — workflow-side-effects.js),
      // the applicant pays through Stripe checkout, and the verified webhook
      // settles PENDING_AUDIT_FEE → AUDIT_FEE_PAID. No slip, and no human
      // approves a payment. The old createPhase2Payment wrote a non-canonical
      // PAYMENT_PHASE_2 status + an off-canon invoice that desynced the
      // workflow. The FE only ever posts {phase:'1'} here.
      // See Obsidian "Legacy Payment Paths — Analysis & Plan".
      await logPaymentEvent(req, 'PAYMENT_PHASE2_CREATE_DEPRECATED', AuditSeverity.INFO, { applicationId });
      return res.status(410).json({
        success: false,
        error: 'PHASE_2_PAYMENT_DEPRECATED',
        message: 'การชำระงวดที่ 2 ผ่านช่องทางนี้ถูกยกเลิก ระบบสร้างใบแจ้งหนี้งวด 2 อัตโนมัติเมื่อเอกสารผ่าน แล้วให้ผู้ขอชำระผ่านหน้าชำระเงินของระบบ',
      });
    }

    const refusal = await refusalForPhase1Mint(application);
    if (refusal) {
      await logPaymentEvent(req, 'PAYMENT_INITIATE_REFUSED', AuditSeverity.WARNING, {
        applicationId,
        phase,
        reason: refusal.body.error,
      });
      return res.status(refusal.status).json(refusal.body);
    }

    const result = await createPhase1Payment(applicationId, healthId, { holderScope: createScope });
    const breakdown = result.breakdown || { serviceFee: null, vat: null, total: null };
    const total = breakdown.total;

    await logPaymentEvent(req, 'PAYMENT_INITIATED', AuditSeverity.INFO, {
      applicationId,
      phase,
      invoiceId: result.invoiceId || null,
      amount: total,
      existing: Boolean(result.existing),
    });

    return res.json({
      success: true,
      data: {
        applicationId,
        phase,
        invoiceId: result.invoiceId || null,
        paymentUrl: result.paymentUrl || null,
        expiresAt: result.expiresAt || null,
        amount: total,
        fees: {
          // null rather than a plausible wrong number when the parts cannot be
          // reconciled with the charged total — see phase-breakdown.js.
          // `governmentFee` ถูกถอด 2026-09-11: ค่าบริการเป็นก้อนเดียว ไม่มีส่วนของรัฐแยก
          serviceFee: breakdown.serviceFee,
          vat7: breakdown.vat,
          total,
        },
        existing: Boolean(result.existing),
        phasePaid: Boolean(result.phasePaid),
      },
    });
  } catch (error) {
    logger.error('[Payments] Create Payment Error:', error);
    await logPaymentEvent(req, 'PAYMENT_INITIATE_FAILED', AuditSeverity.WARNING, {
      applicationId,
      reason: safeErrorMessage(error),
    });
    const refused = lockedPriceRefusal(error);
    if (refused) { return res.status(refused.status).json(refused.body); }
    return res.status(400).json({
      success: false,
      error: safeErrorMessage(error),
    });
  }
});

/**
 * Initiate Phase 1 Payment (5,535 THB total in Master mode)
 * POST /api/payments/phase1/:applicationId
 *
 * Creates payment invoice and returns payment URL
 *
 * @swagger
 * /api/payments/phase1/{applicationId}:
 *   post:
 *     tags: [Payments]
 *     summary: Initiate Phase 1 (document-fee) payment
 *     description: Generates the Phase 1 invoice + PromptPay URL for the applicant's own application. Audit-logged as PAYMENT_PHASE1_INITIATED.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invoice created — returns invoiceId, paymentUrl, requiredInvoices, phasePaid flag
 *       400:
 *         description: Invalid application ID format or service-level rejection
 *       401:
 *         description: Unauthorized — no healthId on token
 *       404:
 *         description: Application not found
 *       429:
 *         description: Rate limit exceeded (paymentLimiter)
 */
router.post('/phase1/:applicationId', authenticateHealth, async (req, res) => {
  const { applicationId } = req.params;
  try {
    if (!isValidUUID(applicationId)) {
      return res.status(400).json({ success: false, error: 'Invalid application ID format' });
    }
    const healthId = await resolveHealthId(req);
    if (!healthId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Ownership-scoped lookup, the same one /create uses — this door had none
    // of its own and relied on createPhase1Payment's internal filter, which left
    // it with no application to gate on and no 404 of its own.
    // Who may pay (Q3), asked before any service call (R2 Task 9 fix round 1).
    const phase1Scope = await holderScope(req);
    if (await refuseUnlessMayPay(req, res, applicationId, phase1Scope, 'PAYMENT_PHASE1_INITIATE_REFUSED')) { return undefined; }
    const application = await applicationService.findForPaymentOwnership(applicationId, {
      holderScope: phase1Scope,
    });
    if (!application) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    const refusal = await refusalForPhase1Mint(application);
    if (refusal) {
      await logPaymentEvent(req, 'PAYMENT_PHASE1_INITIATE_REFUSED', AuditSeverity.WARNING, {
        applicationId,
        reason: refusal.body.error,
      });
      return res.status(refusal.status).json(refusal.body);
    }

    const result = await createPhase1Payment(applicationId, healthId, { holderScope: phase1Scope });
    const settlements = await getInvoiceSettlementsForApplication(applicationId, { holderScope: phase1Scope });

    await logPaymentEvent(req, 'PAYMENT_PHASE1_INITIATED', AuditSeverity.INFO, {
      applicationId,
      invoiceId: result.invoiceId || null,
      // null, not the standard fee. An audit log that substitutes a constant
      // records a fee this applicant was never charged, and an audit log is
      // exactly the place that must not be plausible-but-wrong.
      amount: result?.breakdown?.total ?? null,
    });

    res.json({
      success: true,
      ...result,
      requiredInvoices: result.requiredInvoices || settlements.requiredInvoices.phase1,
      phasePaid: typeof result.phasePaid === 'boolean' ? result.phasePaid : settlements.phase1.phasePaid,
    });

  } catch (error) {
    logger.error('[Payments] Initiate Phase 1 Error:', error);
    await logPaymentEvent(req, 'PAYMENT_PHASE1_INITIATE_FAILED', AuditSeverity.WARNING, {
      applicationId,
      reason: safeErrorMessage(error),
    });
    const refused = lockedPriceRefusal(error);
    if (refused) { return res.status(refused.status).json(refused.body); }

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: safeErrorMessage(error),
      });
    }

    res.status(400).json({
      success: false,
      error: safeErrorMessage(error),
    });
  }
});

/**
 * Initiate Phase 2 Payment (27,675 THB total in Master mode)
 * POST /api/payments/phase2/:applicationId
 *
 * Called after document review is approved
 *
 * @swagger
 * /api/payments/phase2/{applicationId}:
 *   post:
 *     tags: [Payments]
 *     summary: Initiate Phase 2 (audit-fee) payment
 *     description: Provider-only endpoint — SCHEDULER or ADMIN can trigger after document review is approved. Audit-logged as PAYMENT_PHASE2_INITIATED (or PAYMENT_PHASE2_INITIATE_DENIED on RBAC failure).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invoice created — returns invoiceId, paymentUrl, requiredInvoices, phasePaid flag
 *       400:
 *         description: Service-level rejection (validation, transition failure)
 *       403:
 *         description: Unauthorized to initiate phase 2 payment (role must be SCHEDULER or ADMIN)
 *       429:
 *         description: Rate limit exceeded (paymentLimiter)
 */
// DEPRECATED (2026-06-09): Phase-2 payment-create is retired. งวดที่ 2 billing is
// Stripe checkout settled by the verified webhook (PENDING_AUDIT_FEE →
// AUDIT_FEE_PAID); the quotation is issued automatically when the documents are
// approved (F-G4-71). The slip flow this comment used to describe was retired
// 2026-09-11. createPhase2Payment wrote a non-canonical PAYMENT_PHASE_2
// status + an off-canon invoice that desynced the 20-state workflow; no FE/provider
// surface calls this. Kept as a 410 (not removed) so any stale client gets a clear
// signal. See Obsidian "Legacy Payment Paths — Analysis & Plan".
router.post('/phase2/:applicationId', authenticateProvider, async (req, res) => {
  const { applicationId } = req.params;
  await logPaymentEvent(req, 'PAYMENT_PHASE2_CREATE_DEPRECATED', AuditSeverity.INFO, { applicationId });
  return res.status(410).json({
    success: false,
    error: 'PHASE_2_PAYMENT_DEPRECATED',
    message: 'การชำระงวดที่ 2 ผ่านช่องทางนี้ถูกยกเลิก ระบบสร้างใบแจ้งหนี้งวด 2 อัตโนมัติเมื่อเอกสารผ่าน แล้วให้ผู้ขอชำระผ่านหน้าชำระเงินของระบบ',
  });
});

/**
 * POST /api/payments/checkout — Wave 2 single lump-sum Stripe checkout.
 *
 * Body: { applicationId, milestone: 'M1' | 'M2' }
 * Returns the PaymentIntent client secret + the itemized breakdown for the
 * checkout UI (single PromptPay QR / card via Stripe Elements), plus the number
 * of the quotation the charge collects against.
 *
 * F-G4-64 — two preconditions the SERVICE enforces, deliberately not this
 * route: the application's quotation must be accepted, and the applicant must
 * hold a granted PAYMENT_TERMS consent (coordinator ruling 2: one consent
 * namespace, recorded through POST /api/consent exactly as the slip modal
 * records it — the body of THIS request is not evidence of a disclosure). A
 * route-level check would be bypassable by any other caller of the service.
 * The catch below already maps `error.statusCode || error.status` and echoes
 * `error.code`, so all SEVEN refusals surface with their catalogued status:
 * QUOTATION_NOT_ISSUED / QUOTATION_NOT_ACCEPTED / QUOTATION_EXPIRED /
 * QUOTATION_GATE_UNAVAILABLE / CHECKOUT_PHASE_NOT_PRICED /
 * CHECKOUT_PRICE_DRIFT / PAYMENT_TERMS_NOT_ACCEPTED. `safeErrorMessage`
 * replaces the catalogue's Thai sentence with an English fallback, so the
 * screen maps the code itself: CHECKOUT_ERROR_MAP in
 * apps/web-app/src/app/health/payments/checkout/client-view.tsx carries all
 * seven, pinned by its own test.
 *
 * Drain-then-purge (D2): gated by STRIPE_CHECKOUT_ENABLED so the flip to
 * Stripe-only is an env decision per environment; the legacy slip surface
 * above continues serving in-flight applications until they drain.
 */
router.post('/checkout', authenticateHealth, async (req, res) => {
  const { isStripeCheckoutEnabled } = require('../../../config/stripe');
  if (!isStripeCheckoutEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'STRIPE_CHECKOUT_DISABLED',
      message: 'Online payment is not enabled in this environment',
    });
  }
  try {
    const { createCheckoutForApplication } = require('../../../services/checkout/stripe-checkout-service');
    const healthId = await resolveHealthId(req);
    if (!healthId) {
      return res.status(401).json({ success: false, error: 'AUTH_ERROR' });
    }
    const { applicationId, milestone } = req.body || {};
    if (!applicationId || !isValidUUID(applicationId)) {
      return res.status(400).json({ success: false, error: 'APPLICATION_ID_REQUIRED' });
    }

    // Who may start a checkout (spec 2026-09-30 §3.3, operator Q3): a member
    // holding SUBMIT_APPLICATION on the application's holder, the same people who
    // may file. An authz gate only: it runs before the service, so a refusal
    // mints no order, invoice or payment and never reaches the gateway. Amounts,
    // statuses and settlement stay the service's and the webhook's.
    const checkoutScope = await holderScope(req);
    const target = await applicationService.findApplicationHolderForHealth(applicationId, { holderScope: checkoutScope });
    if (!target) {
      throw Object.assign(new Error('Application not found'), { statusCode: 404, code: 'APPLICATION_NOT_FOUND' });
    }
    await assertHolderCapability(req.user?.id, target.entityId, 'SUBMIT_APPLICATION');

    const result = await createCheckoutForApplication({
      applicationId,
      milestone: String(milestone || 'M1').toUpperCase(),
      // The role travels with the actor because the price-drift refusal writes
      // a CRITICAL audit row, and AuditLog.actorRole is NOT NULL — same
      // expression logPaymentEvent above uses, so one door cannot record a
      // different actor than the other.
      actor: {
        id: req.user?.id,
        holderScope: checkoutScope,
        role: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
      },
    });

    await logPaymentEvent(req, 'CHECKOUT_INTENT_CREATED', AuditSeverity.INFO, {
      applicationId,
      checkoutOrderId: result.checkoutOrderId,
      milestone: result.milestone,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    await logPaymentEvent(req, 'CHECKOUT_INTENT_FAILED', AuditSeverity.WARNING, {
      applicationId: req.body?.applicationId,
      error: error.code || error.message,
    });
    if (error?.code === 'ENTITY_PERMISSION_DENIED') {
      return res.status(403).json(entityPermissionDeniedBody(error.permission));
    }
    const status = error.statusCode || error.status || 500;
    return res.status(status).json({
      success: false,
      error: error.code || 'CHECKOUT_FAILED',
      message: safeErrorMessage(error),
    });
  }
});

module.exports = router;
