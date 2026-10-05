/**
 * Preview Routes - prepare complete official preview data before payment.
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const { prisma } = require('../../../services/prisma-database');
const { collectUniqueCultivationMethods } = require('../../../modules/billing');
const {
  computePhaseSettlement,
  flattenRequiredInvoices,
} = require('../../../services/phase-billing-service');
const {
  parseJson,
  buildFullFormSnapshot,
  normalizeFarmInfo,
  normalizeSelectionInfo,
  normalizeProductionInfo,
  normalizeDocuments,
  summarizeCompletion,
} = require('./preview-utils');
const {
  readPhase1FinancialDocuments,
  summarizeCheckoutInvoices,
  derivePhasePaymentState,
} = require('./preview-financial-utils');
const PREVIEWABLE_STATUSES = require('./previewable-statuses');
const logger = require('../../../shared/logger');
const { storedCultivationScopeCount } = require('../../../shared/application-scope');
const { isRenewalFiling } = require('../../../shared/instalment-service-names');
const { previewPhaseAmounts } = require('../../../services/billing/renewal-amount');
const { holderScope, holderReadWhere } = require('../../../services/holder-access');

// P-GET (staging walk 2026-09-30, L3): this GET is a read door in EVERY state.
// It used to write a feePatch back onto the application — phase1Amount,
// phase2Amount, cultivationScopeCount, totalAreaTypes — whenever the stored
// value differed from the computed one, so opening the page could reprice a
// stored scope count (F-PREVIEW-REVISION-WRITE had already closed that for
// REVISION_REQUESTED/CAR_PENDING only). The figures are now computed and
// returned, never persisted.
//
// Who still stamps those columns (2026-10-02, M3) — and who does NOT:
//   - services/application-service/application-draft-query-methods.js:71-77
//     (saveDraft; no route calls it — the deleted /api/wizard door never did either)
//   (application-submission-methods.js went with the /api/wizard door, R2 Task 10)
//   - services/payment-service-phase-flow.js:127-145 (createPhase1Payment,
//     POST /api/payments/create and /phase1/:applicationId — routes/api/finance/payments.js:278,385)
//   - services/renewal-service.js:399-406 (cultivationScopeCount/totalAreaTypes only)
// The live web doors POST /api/applications/draft and /submit
// (routes/api/applications/applications.js) stamp NONE of them, so for an
// application filed through today's wizard the columns keep their schema
// defaults. That does not move money: the quotation prices at issuance from
// billableScopes (shared/application-scope.js — declaration first, stored
// count only as the fallback), and checkout prices from formData or the
// accepted quotation (stripe-checkout-service breakdownForMilestone). Whether
// submit should stamp them is an operator question; this door does not.
//
// The figure shown here is computed with the SAME billableScopes the quotation
// uses (M4), so the preview and the quotation cannot disagree about a row.
// Proof: __tests__/integration/preview-get-writes-nothing-real-postgres.test.js

// The filing is read within the caller's holder scope alone (spec 2026-09-30
// §3.1): holderScope is called inside the handler, after authentication. Any
// ACTIVE member of the holder previews it; there is no filer pin.

router.get('/applications/:id/preview', authenticateHealth, async (req, res) => {
  try {
    const { id } = req.params;
    const scope = await holderScope(req);

    const application = await prisma.application.findFirst({
      where: {
        id,
        ...holderReadWhere(scope, 'Application'),
        isDeleted: false,
      },
      include: {
        applicant: {
          select: {
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true,
          },
        },
      },
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Application not found',
      });
    }

    // Allow preview during DRAFT and pre-review/payment stages.
    //
    // The user-facing flow is:
    //   wizard step 9 → click "ยืนยันและไปหน้าพรีวิว" → /applications/prepare
    //                 → redirect to /applications/preview?id=<draftId>
    //
    // /prepare deliberately does NOT advance status to SUBMITTED — the
    // applicant is supposed to review the rendered document one more time
    // and only then click the final submit. Without DRAFT in this list,
    // every applicant trying to preview their draft would hit:
    //   400 "Application is not in previewable state"
    // which is exactly the bug reported on 2026-05-02.
    //
    // Keeping the rest of the whitelist so we still 400 on terminal states
    // (REJECTED, EXPIRED, CERTIFIED, etc.) where preview makes no sense.
    if (!PREVIEWABLE_STATUSES.has(application.status)) {
      return res.status(400).json({
        success: false,
        error: 'Application is not in previewable state',
        currentStatus: application.status,
      });
    }

    // Parse form data
    const formData = application.formData || {};

    const normalizedFarmInfo = normalizeFarmInfo(formData, application);
    const normalizedSelectionInfo = normalizeSelectionInfo(formData, application);
    const normalizedProductionInfo = normalizeProductionInfo(formData);
    const normalizedDocuments = normalizeDocuments(formData, application);
    const normalizedSummary = summarizeCompletion(formData, normalizedDocuments);
    const healthProfile = application.applicant || {};

    const feeContext = {
      ...(typeof formData === 'object' && formData ? formData : {}),
      // Inert: nothing in modules/billing reads this key off the payload — a
      // stored scope count only takes effect through `options.scopeCount`.
      // Renamed with the column rather than made live, because making it live
      // would change what applicants are charged (L3: an agent flags a money
      // path, it does not mutate one). Open finding: reports/sku/design-event.md.
      cultivationScopeCount: storedCultivationScopeCount(application),
    };
    // Read-only in every state — see P-GET above.
    const financialDocs = await readPhase1FinancialDocuments(application, { holderScope: scope });

    const allInvoices = await prisma.invoice.findMany({
      where: {
        applicationId: application.id,
        isDeleted: false,
        ...holderReadWhere(scope, 'Invoice'),
      },
      select: {
        id: true,
        invoiceNumber: true,
        serviceType: true,
        status: true,
        totalAmount: true,
        // round 4: a renewal's billed figure is read from its own invoice
        subtotal: true,
        vat: true,
        paidAt: true,
        receiptIssuedAt: true,
        receiptNumber: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    // What the preview prices, from ONE tested function (services/billing/renewal-amount.js
    // previewPhaseAmounts, round 5): a new filing — both instalments from the engine with the
    // quotation's own scope rule (M4: billableScopes); a renewal (round 4, operator
    // 2026-10-03: prices are real costs, shown completely and correctly) — ONE charge, no
    // instalment 1, priced invoice → quotation → engine. Computed to answer only; never
    // written back to the row (P-GET).
    const isRenewal = isRenewalFiling(application);
    const quotationRow = isRenewal
      ? (await require('../../../services/quotation-service')
        .findQuotationsByApplicationId(application.id, { holderScope: scope })).platform
      : null;
    const amounts = previewPhaseAmounts({ application, invoices: allInvoices, quotationRow });
    // ยอดเต็มของงวด (ค่าบริการ + VAT) — คำนวณเพื่อส่งกลับเท่านั้น ไม่เขียนลงแถว (P-GET)
    const phase1Total = amounts.phase1 ? amounts.phase1.phaseTotal : null;
    const phase2Total = amounts.phase2.phaseTotal;
    const phase1Settlement = computePhaseSettlement(allInvoices, 'PHASE_1');
    const phase2Settlement = computePhaseSettlement(allInvoices, 'PHASE_2');
    const checkoutSummary = summarizeCheckoutInvoices(allInvoices);

    // B-F1: computePhaseSettlement only sees the retired split service types.
    // On a checkout-rail application it answers "unpaid" forever, which made
    // nextRequiredAction stick at PAY_PHASE_1 after the money had settled.
    // Both rails answer through one helper.
    const phase1Payment = derivePhasePaymentState({
      settlement: phase1Settlement,
      checkout: checkoutSummary.phase1,
    });
    const phase2Payment = derivePhasePaymentState({
      settlement: phase2Settlement,
      checkout: checkoutSummary.phase2,
    });

    // A renewal has no instalment 1 to pay; without this its preview asked for PAY_PHASE_1.
    const phase1Paid = isRenewal ? true : phase1Payment.paid;
    const phase2Paid = phase2Payment.paid;
    const canFinalizeSubmission = false;
    const statusUpper = String(application.status || '').toUpperCase();
    const needsAuditFee = ['DOC_APPROVED', 'PENDING_AUDIT_FEE'].includes(statusUpper);
    const nextRequiredAction = !phase1Paid
      ? 'PAY_PHASE_1'
      : (!phase2Paid
        ? (needsAuditFee ? 'PAY_PHASE_2' : 'WAIT_DOC_REVIEW')
        : (phase2Payment.receiptIssued ? 'WAIT_AUDIT_SCHEDULE' : 'WAIT_RECEIPT_PHASE_2'));

    // Build preview summary
    const preview = {
      applicationId: application.id,
      status: application.status,
      nextRequiredAction,
      canFinalizeSubmission,

      // Health Info (canonical) + Applicant alias (backward compatibility)
      health: {
        name: `${healthProfile.firstName || ''} ${healthProfile.lastName || ''}`.trim(),
        phone: healthProfile.phoneNumber,
        email: healthProfile.email,
      },
      applicant: {
        name: `${healthProfile.firstName || ''} ${healthProfile.lastName || ''}`.trim(),
        phone: healthProfile.phoneNumber,
        email: healthProfile.email,
      },

      // Farm Info
      farmInfo: {
        ...normalizedFarmInfo,
      },
      selectionInfo: normalizedSelectionInfo,

      // Production Info
      productionInfo: normalizedProductionInfo,

      // Documents
      documents: normalizedDocuments,
      attachments: parseJson(application.attachments, []),

      // Summary
      summary: {
        totalSteps: 7,
        completedSteps: normalizedSummary.completedSteps,
        isComplete: normalizedSummary.isComplete,
        missingFields: normalizedSummary.missingFields,
      },

      // Payment Info
      payment: {
        // ยอดของงวด = ยอดเต็ม (ค่าบริการ + VAT)
        isRenewal: amounts.isRenewal,
        phase1Amount: phase1Total,
        phase1Status: application.phase1Status,
        phase2Amount: phase2Total,
        scopeCount: amounts.scopeCount,
        // ผู้ยื่นบอกลักษณะพื้นที่ไว้แล้วหรือยัง — คนละคำถามกับ scopeCount
        //
        // scopeCount = 1 ตอบได้สองความหมาย: "ขอมา 1 รูปแบบ" กับ "ยังไม่ได้เลือกเลย
        // ระบบจึงคิดให้ 1 ไปก่อน" · หน้าจอที่พิมพ์ราคาให้เกษตรกรอ่าน ต้องแยกสองอย่างนี้
        // ให้ออก ไม่งั้นร่างที่ยังไม่เลือกจะโชว์ราคาของ 1 รูปแบบ แล้วผู้ยื่นตกใจตอนยอด
        // ขึ้นเป็นสามเท่าที่ขั้นยื่นจริง (operator 2026-09-10)
        //
        // อ่านจาก collectUniqueCultivationMethods ตัวเดียวกับที่คิดราคา — ไม่ใช่การตีความ
        // "ลักษณะพื้นที่" ซ้ำอีกรอบ · ลิสต์ว่าง = ผู้ยื่นยังไม่เคยตอบคำถามนี้
        scopeDeclared: collectUniqueCultivationMethods(feeContext).length > 0,
        totalEstimated: amounts.totals.grandTotal,
        // F-G4-51: the phase-1/phase-2 state of the ONE-invoice checkout rail,
        // read off the same rows `breakdown` is computed from. The retired
        // per-side quote/invoice pair (financialDocuments below) is null for
        // every application minted under the checkout rail, so this is what the
        // applicant's preview page can actually show them.
        checkout: checkoutSummary,
        // ค่าบริการก้อนเดียวต่องวด ไม่มีการแยกรัฐ/แพลตฟอร์มอีกแล้ว (operator 2026-09-11)
        // `stateStatus`/`platformStatus` ถูกถอดไปด้วย: มันคือสถานะของใบสองใบที่ไม่มีการ
        // มินต์อีกแล้ว และค่าที่มันตอบจึงเหมือนกันเสมอ — สองช่องที่ตอบเหมือนกันตลอดกาล
        // ทำให้คนอ่านเชื่อว่ามีสองสิ่งให้ติดตาม
        breakdown: {
          phase1: amounts.phase1 ? {
            serviceFeeAmount: amounts.phase1.serviceFeeAmount,
            vatAmount: amounts.phase1.vatAmount,
            phaseTotal: amounts.phase1.phaseTotal,
            // B-F1: ความจริงเดียวกับที่ nextRequiredAction สร้างขึ้นมา —
            // หน้าจออ่านธงนี้เพื่อตัดสินว่าจะแสดงอะไรให้ผู้ยื่น
            isPhasePaid: phase1Paid,
          } : null,
          phase2: {
            serviceFeeAmount: amounts.phase2.serviceFeeAmount,
            vatAmount: amounts.phase2.vatAmount,
            phaseTotal: amounts.phase2.phaseTotal,
            isPhasePaid: phase2Paid,
          },
          totals: amounts.totals,
        },
      },

      financialDocuments: {
        ...financialDocs,
        requiredInvoices: flattenRequiredInvoices(phase1Settlement),
      },

      // Full official snapshot: include every saved field for document-grade preview.
      fullFormSnapshot: buildFullFormSnapshot(application, formData),
    };

    res.json({
      success: true,
      preview,
    });

  } catch (error) {
    logger.error('Get Preview Error:', error);
    res.status(500).json({
      success: false,
      error: safeErrorMessage(error),
    });
  }
});

// Helper Functions

module.exports = router;
