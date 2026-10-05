// Invoice issuer + bank-account read-only surface.
//
// Why this route exists (2026-05-16, batch B18-B / two-card payment flow):
//
//   The applicant payment screen now renders TWO separate payment cards
//   per phase — one for the DTAM-side state fee (กรมบัญชีกลาง bank
//   account) and one for the PLATFORM-side platform fee + VAT (Predictive
//   AI bank account). Each card needs to display:
//     - the issuer's bank channel (bank name, account no, account holder)
//     - the issuer's PromptPay identifier (for per-card QR generation)
//     - the issuer's legal name + tax ID (for the "transfer to" line)
//
//   The existing `/api/payments/bank-accounts/active` endpoint resolves
//   bank info from the runtime-mutable `BankAccount` Prisma table — that
//   table is shared across both flows and currently only stores one row
//   per phase. We need a SEPARATE source-of-truth that mirrors the
//   canonical `apps/backend/config/invoice-issuers.js` definitions
//   (DTAM_BANK_ACCOUNT + PLATFORM_BANK_ACCOUNT) so the applicant always
//   sees the same bank coordinates the PDF templates and journal-entry
//   service use. This route reads from that config — no DB lookup, no
//   tenant scope — so it can never drift from the receipt PDFs.
//
//   Read-only by design. Mutations go through the existing
//   /payments/bank-accounts admin routes (DB-backed) or via env var
//   overrides on backend redeploy (config-backed).

'use strict';

const express = require('express');

const { authenticateAny } = require('../../../middleware/auth-middleware');
const { safeErrorMessage } = require('../../../shared/api-response');
const logger = require('../../../shared/logger');
const {
  SERVICE_TYPES,
  getInvoiceIssuer,
} = require('../../../config/invoice-issuers');
const { buildPromptPayPayload } = require('../../../utils/promptpay-qr');

const router = express.Router();

// Surface to APPLICANTs: tax ID is public per ม.86/4 ป.รัษฎากร (must
// appear on every tax invoice); bank account number is the published
// revenue account; PromptPay payload is non-secret by design (it's a
// scannable QR). We deliberately strip the `note` and ops-only fields
// so the applicant view is identical to the PDF's payment-info block.
function buildIssuerView(serviceType) {
  const issuer = getInvoiceIssuer(serviceType);
  const bank = issuer.bankAccount;

  // Static payload (no amount baked in) — the front-end re-runs
  // buildPromptPayPayload({ target, amountTHB }) once it knows the
  // invoice amount, so the QR scans pre-filled with the right amount.
  const promptpayQrPayload = bank.promptpayId
    ? buildPromptPayPayload({ target: bank.promptpayId })
    : null;

  return {
    serviceType,
    issuerType: issuer.type,
    legalNameTH: issuer.legalNameTH,
    legalNameEN: issuer.legalNameEN,
    taxId: issuer.taxId,
    addressLine1: issuer.addressLine1,
    addressLine2: issuer.addressLine2,
    receiptDocumentType: issuer.receiptDocumentType,
    receiptDocumentTypeTH: issuer.receiptDocumentTypeTH,
    chargesVat: Boolean(issuer.chargesVat),
    vatRate: issuer.vatRate || 0,
    // W14: `collectedByPlatform` / `collectionAgentNoteTH` are gone. One
    // issuer — the company — collecting in its own name, not as DTAM's
    // collection agent, so there is no agent notation left to serve.
    bankAccount: {
      bankName: bank.bankName,
      accountNumber: bank.accountNo,
      accountHolder: bank.accountName,
      legacyAccountName: bank.legacyAccountName || null,
      promptpayId: bank.promptpayId,
      promptpayQrPayload,
      vatExempt: Boolean(bank.vatExempt),
      revenueCategoryTH: bank.revenueCategoryTH || null,
    },
  };
}

// GET /issuers/by-service-type/:serviceType
// Returns the issuer + bank channel for a given canonical service type.
// This is the primary endpoint the two-card payment screen calls — once
// per invoice — so the bank channel and QR target follow the invoice's
// own serviceType (PHASE_1_STATE_FEE, PHASE_1_PLATFORM_FEE, etc.).
router.get('/by-service-type/:serviceType', authenticateAny, async (req, res) => {
  try {
    const serviceType = String(req.params.serviceType || '').toUpperCase().trim();
    const known = Object.values(SERVICE_TYPES);
    if (!known.includes(serviceType)) {
      return res.status(400).json({
        success: false,
        error: 'UNKNOWN_SERVICE_TYPE',
        message: `serviceType must be one of: ${known.join(', ')}`,
      });
    }
    const view = buildIssuerView(serviceType);
    return res.json({ success: true, data: view });
  } catch (error) {
    logger.error('[issuers] lookup by serviceType failed:', error?.message);
    return res.status(500).json({ success: false, error: safeErrorMessage(error) });
  }
});

module.exports = router;
