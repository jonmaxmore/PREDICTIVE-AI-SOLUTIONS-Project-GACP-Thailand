// Wave 0 purge (docs/payment-refactor/legacy-payment-audit.md): the
// gateway-era webhook flow this factory used to derive handlers from was
// removed — no route mounted it since the 2026-04-29 slip-flow cutover.
// The slip-flow owns PENDING → PAID (`payment-slip-service.js`); Phase-2
// minting moved to the DOC_APPROVED auto-chain (workflow-side-effects.js),
// so this factory now produces the Phase-1 initiation only.
const { writeApplicationStatus } = require('./application-status-writer');
const { storedCultivationScopeCount } = require('../shared/application-scope');
const { phaseFeeBreakdown } = require('./payments/phase-breakdown');
const { quotationGateRefusal, GATE_CODES } = require('./billing/quotation-gate');

function createPhaseFlow(deps) {
  const {
    prisma,
    feeService,
    CONFIG,
    generateSecureIdFragment,
    asArray,
    buildWorkflowEvent,
    syncPhaseStatusesFromInvoices,
    getInvoiceSettlementsForApplication,
    logger,
    // GAP-5 (2026-07-08): frozen price-of-record reader. When present, the phase
    // amount is COPIED from the accepted quotation instead of recomputed from
    // (mutable) formData, so the paymentTransaction can never desync from the
    // already-minted invoices. Absent → recompute (pre-GAP-5 behavior).
    getFrozenPhaseFees,
  } = deps;

  // GAP-5: overlay the frozen accepted-quote phase totals onto a fresh
  // recompute. Returns { phase1Total, phase2Total, scopeCount, frozen }.
  // Logs a structured drift warning when the two diverge; the frozen price
  // (what the applicant accepted) wins.
  async function resolveLockedPhaseTotals(applicationId, recomputedFees) {
    const result = {
      phase1Total: recomputedFees.phase1.phaseTotal,
      phase2Total: recomputedFees.phase2.phaseTotal,
      scopeCount: recomputedFees.scopeCount,
      frozen: false,
    };
    if (typeof getFrozenPhaseFees !== 'function') { return result; }
    // FAIL CLOSED (operator ruling 2026-10-03, fix/fees-from-server round 4).
    // This used to be best-effort: a failed read of the accepted quotation's
    // locked price was logged and the RECOMPUTED price was invoiced instead, a
    // price the applicant never accepted. Now a read error stops the payment
    // with the quotation gate's own refusal (QUOTATION_GATE_UNAVAILABLE, 503,
    // Thai cause + next action) before anything is written: the fee patch and
    // the payment transaction below are never reached.
    //
    // A read that ANSWERS null is not an error and is unchanged: no platform
    // quotation row (or one with no installments) still means recompute. Both
    // routes refuse an application with no quotation earlier, at
    // assertQuotationAcceptedForPayment (QUOTATION_NOT_ISSUED).
    let frozen = null;
    try {
      frozen = await getFrozenPhaseFees(applicationId);
    } catch (err) {
      if (logger?.error) {
        logger.error('[QUOTE_PRICE_LOCK] frozen-quote read failed — payment refused (fail closed)', {
          applicationId,
          error: err?.message,
        });
      }
      throw Object.assign(quotationGateRefusal(GATE_CODES.UNAVAILABLE), { cause: err });
    }
    if (!frozen) { return result; }
    if ((frozen.phase1.phaseTotal !== result.phase1Total
      || frozen.phase2.phaseTotal !== result.phase2Total) && logger?.warn) {
      logger.warn('[QUOTE_PRICE_DRIFT] phase payment amount differs from accepted quotation — honoring the frozen quote', {
        applicationId,
        frozenPhase1: frozen.phase1.phaseTotal,
        recomputedPhase1: result.phase1Total,
        frozenPhase2: frozen.phase2.phaseTotal,
        recomputedPhase2: result.phase2Total,
      });
    }
    return {
      phase1Total: frozen.phase1.phaseTotal,
      phase2Total: frozen.phase2.phaseTotal,
      scopeCount: frozen.scopeCount,
      frozen: true,
    };
  }

async function createPhase1Payment(applicationId, healthId) {
  try {
    // Check if application exists and belongs to user
    const application = await prisma.application.findFirst({
      where: {
        id: applicationId,
        healthId,
        // PR 2c: five legacy spellings dropped. PAYMENT_1_PAID in particular
        // was never a phase-1-payable state — it means the fee is already paid.
        status: { in: ['DRAFT', 'SUBMITTED', 'PENDING_DOC_FEE'] },
        isDeleted: false,
      },
    });

    if (!application) {
      throw new Error('Application not found or not in DRAFT status');
    }

    const synced = await syncPhaseStatusesFromInvoices(applicationId);
    if (synced?.phase1Paid) {
      return {
        success: true,
        existing: true,
        phasePaid: true,
        requiredInvoices: synced.settlements.requiredInvoices.phase1,
        message: 'Phase 1 is already fully paid',
      };
    }

    const feeContext = {
      ...(typeof application.formData === 'object' && application.formData ? application.formData : {}),
      // Inert: nothing in modules/billing reads this key off the payload — a
      // stored scope count only takes effect through `options.scopeCount`.
      // Renamed with the column rather than made live, because making it live
      // would change what applicants are charged (L3: an agent flags a money
      // path, it does not mutate one). Open finding: reports/sku/design-event.md.
      cultivationScopeCount: storedCultivationScopeCount(application),
    };
    const calculatedFees = feeService.calculateApplicationFees(feeContext);
    // Tier 8 fix (2026-05-16) — ยอดที่ลูกค้าจ่ายคือ `.phaseTotal` (ค่าบริการ + VAT)
    // = 5,885 / 29,425 ต่อรูปแบบ · ข้อบกพร่องเดิมอ่าน `.total` ซึ่งสมัยนั้นเป็น
    // นามแฝงของยอดส่วนรัฐอย่างเดียว แล้ว underbill เกษตรกรทุกรายเทียบกับใบที่ออกไป
    // ตอนนี้ `.total` เท่ากับ `.phaseTotal` แล้ว แต่ยังอ่าน `.phaseTotal` ตรง ๆ
    // เพราะชื่อมันบอกว่ามันคืออะไร · ชื่อ "Tier 8" กับคำว่า underbill ถูกคงไว้ให้
    // ตามรอยเหตุการณ์เดิมได้ และมีเทสตรึงไว้ว่าคำอธิบายนี้จะไม่ถูกลบทิ้งกลางทาง
    //
    // GAP-5 (2026-07-08): copy the phase totals from the accepted quotation
    // (frozen price-of-record) when one exists; recompute is the fallback.
    const locked = await resolveLockedPhaseTotals(applicationId, calculatedFees);
    const phase1Amount = locked.phase1Total;
    const phase2Amount = locked.phase2Total;

    const feePatch = {};
    if (application.phase1Status !== 'PAID' && application.phase1Amount !== phase1Amount) {
      feePatch.phase1Amount = phase1Amount;
    }
    if (application.phase2Status !== 'PAID' && application.phase2Amount !== phase2Amount) {
      feePatch.phase2Amount = phase2Amount;
    }
    if (storedCultivationScopeCount(application) !== locked.scopeCount) {
      feePatch.cultivationScopeCount = locked.scopeCount;
      // Retired name for the same number, patched in step so a process still
      // serving the previous image prices correctly; the contract migration
      // drops it.
      feePatch.totalAreaTypes = locked.scopeCount;
    }
    if (Object.keys(feePatch).length > 0) {
      await prisma.application.update({
        where: { id: applicationId },
        data: feePatch,
      });
    }

    // Check if already has pending payment
    if (application.phase1Status === 'PROCESSING' && application.phase1ExpiresAt > new Date()) {
      const settlements = await getInvoiceSettlementsForApplication(applicationId);
      return {
        success: true,
        existing: true,
        invoiceId: application.phase1InvoiceId,
        expiresAt: application.phase1ExpiresAt,
        // The amount already persisted on the application — the same figure the
        // outstanding invoice carries and the bank slip will be matched against.
        breakdown: phaseFeeBreakdown({
          chargedTotal: application.phase1Amount,
          calculated: null,
        }),
        phasePaid: settlements.phase1.phasePaid,
        requiredInvoices: settlements.requiredInvoices.phase1,
      };
    }

    // Generate unique invoice ID. The slip-flow expects this to exist on
    // the application before the applicant uploads a slip; the wizard
    // calls /api/payments/create which lands here.
    const invoiceId = `INV-${Date.now()}-${generateSecureIdFragment(9)}`;
    const expiresAt = new Date(Date.now() + CONFIG.invoiceExpiryMinutes * 60 * 1000);

    // Atomically update application + create transaction record (callback form so the
    // canonical writeApplicationStatus call participates in the same prisma transaction).
    const phase1WorkflowHistory = asArray(application.workflowHistory);
    await prisma.$transaction(async (tx) => {
      await writeApplicationStatus({
        prisma: tx,
        applicationId,
        fromStatus: application.status,
        // The canonical state, not 'PAYMENT_PHASE_1'. That string was in no
        // state list, so payment-slip-service resolved it to itself and refused
        // the upload — "Cannot upload slip from application status
        // PAYMENT_PHASE_1" — after the farmer had already transferred the fee.
        // The Phase-2 twin was retired for exactly this in June 2026
        // (payments.js:299); Phase 1 was left as it was.
        toStatus: 'PENDING_DOC_FEE',
        actorId: healthId,
        actorRole: 'HEALTH',
        reason: 'PHASE_1_PAYMENT_CREATED',
        additionalData: {
          phase1Status: 'PROCESSING',
          phase1InvoiceId: invoiceId,
          phase1ExpiresAt: expiresAt,
          workflowHistory: [
            ...phase1WorkflowHistory,
            buildWorkflowEvent(
              'PHASE_1_PAYMENT_CREATED',
              application.status,
              'PENDING_DOC_FEE',
              {
                actorId: healthId,
                actorHealthId: healthId,
                invoiceId,
                amount: phase1Amount,
              },
            ),
          ],
        },
      });
      await tx.paymentTransaction.create({
        data: {
          applicationId,
          phase: 'PHASE_1',
          gateway: 'BANK_TRANSFER',
          gatewayRef: invoiceId,
          amount: phase1Amount * 100, // satang
          currency: 'THB',
          status: 'PENDING',
          expiredAt: expiresAt,
          idempotencyKey: `${applicationId}-PHASE1-${Date.now()}`,
        },
      });
    });

    return {
      success: true,
      invoiceId,
      amount: phase1Amount,
      // What was actually charged, so the route does not have to guess. It used
      // to fall back to flat single-scope constants, which disagreed with this
      // invoice for any farm registering more than one cultivation method.
      breakdown: phaseFeeBreakdown({
        chargedTotal: phase1Amount,
        calculated: calculatedFees?.phase1 || null,
      }),
      expiresAt,
      phasePaid: false,
      requiredInvoices: synced?.settlements?.requiredInvoices?.phase1 || [],
    };

  } catch (error) {
    logger.error('Create Phase Payment Error:', error);
    throw error;
  }
}

  return {
    createPhase1Payment,
  };
}

module.exports = { createPhaseFlow };
