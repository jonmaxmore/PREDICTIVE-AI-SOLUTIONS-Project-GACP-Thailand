/**
 * No fee lives here.
 *
 * Rates come from the backend fee engine (apps/backend/config/business-rules.js
 * FEES, read through modules/billing) and are served by GET /api/pricing/fees.
 * SystemConfig fee.* rows are NOT applied: loadFeesFromSystemConfig is unwired
 * by operator ruling 2026-10-03, so a rate changes only with a code change.
 * Every screen reads that response: server components through
 * src/lib/pricing/fetch-public-fees.ts, client components through
 * src/hooks/use-pricing.ts. When it cannot be read a screen shows
 * FEES_UNAVAILABLE_TH and no number (src/lib/pricing/public-fees.ts).
 *
 * This file used to declare GACP_APPLICATION_FEE / GACP_INSPECTION_FEE /
 * GACP_RENEWAL_FEE / GACP_VAT_RATE and totals derived from them. They matched
 * the server on the day they were typed and would have kept showing the old
 * price the day a fee changed, while invoices billed the new one. They were
 * removed on 2026-10-03; src/__tests__/no-screen-imports-a-literal-fee.test.ts
 * keeps them out.
 */

// PHASE_1_FEE_THRESHOLD, the last value here, was removed on 2026-10-03 (round
// 1): payment-service.ts guessed an invoice's phase by comparing its
// VAT-inclusive total to this pre-VAT figure. The phase is now read from the
// invoice's serviceType or line items, and an invoice that names none gets no
// phase label. The file stays, empty, so the guards that point at it
// (scripts/system-integrity-check.js §10, no-screen-imports-a-literal-fee)
// keep checking that no fee comes back.
export {};
