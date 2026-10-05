/**
 * Canonical GACP fee calculation.
 *
 * Business rule (W14 — operator ruling 2026-08-22, the change log c28355ea,
 * figures confirmed d1c33ea0):
 * - Phase 1 (document review): 5,000 THB per cultivation method/scope
 * - Phase 2 (audit): 25,000 THB per cultivation method/scope
 * - Platform fee: 10% of the state fee per phase
 * - ค่าบริการ (service fee) = state fee + platform fee
 * - ยอดชำระ (payable)      = service fee + VAT 7% OF THE WHOLE SERVICE FEE
 *
 * ONE issuer: the company issues the quotation, the billing note and the
 * receipt. The farmer pays the company; the company settles with DTAM outside
 * this system. There is no VAT-exempt government leg any more, and no
 * collection-agent split — see config/invoice-issuers.js.
 *
 * Per cultivation scope, grossed up: 35,310 / 70,620 / 105,930 for 1 / 2 / 3
 * scopes. A new application splits that across two phases in the 5,000:25,000
 * ratio of the state fee; a renewal is charged once, in full.
 *
 * Phase A6 §A6-2 (2026-04-29): file moved from
 *   apps/backend/services/fee-service.js
 * to
 *   apps/backend/modules/billing/internal/fee-service.js
 *
 * The thin re-export shim still at services/fee-service.js keeps existing
 * consumers working without breaking imports. Public API of the billing
 * module is exposed via apps/backend/modules/billing/index.js — anything
 * not exported there is private to the module and protected by the
 * `gacp/no-cross-module-internal` ESLint rule.
 */
const { FEES } = require('../../../config/business-rules');

// Rates are READ AT CALL TIME from the one FEES object (fix/fees-from-server
// round 2, 2026-10-03). This used to be a copy taken when the module loaded:
// `PHASE1_PER_SCOPE: FEES.PHASE1_PER_SCOPE`, … and `const VAT_RATE = FEES.VAT_RATE`.
// config/business-rules.js loadFeesFromSystemConfig mutates FEES in place, but
// server.js loads this module (via routes/api) long before any database work,
// so an override applied afterwards changed FEES and nothing that billed or
// quoted. Proven by __tests__/unit/fee-overrides-reach-the-engine.test.js.
// Only HOW a rate is read changed — no formula, rounding or VAT rule.
const FEE_RATES = Object.freeze(Object.defineProperties({}, {
  PHASE1_PER_SCOPE: { enumerable: true, get: () => FEES.PHASE1_PER_SCOPE },
  PHASE2_PER_SCOPE: { enumerable: true, get: () => FEES.PHASE2_PER_SCOPE },
  // Certificate renewal — ONE charge (operator ruling 2026-08-22, final).
  // Published here so the public pricing route reads it from the same object
  // it reads the phase fees from, instead of re-spelling a literal.
  //
  // It deliberately does NOT enter calculatePhase1Fee / calculatePhase2Fee: a
  // renewal is not a phased application. Making the CHECKOUT charge this once
  // instead of billing the phase pair means touching invoice/checkout creation,
  // which is money-mutation territory (L3) — that change is written up as a
  // PROPOSAL in reports/design-cleanup-2026-08-21/W12-renewal-fast-path.md and
  // is deliberately NOT applied here.
  RENEWAL_PER_SCOPE: { enumerable: true, get: () => FEES.RENEWAL_PER_SCOPE },
}));

/** The VAT rate as FEES holds it now. */
const currentVatRate = () => FEES.VAT_RATE;

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeMethod(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
}

function collectUniqueCultivationMethods(payload = {}) {
  const unique = new Set();

  // ลักษณะพื้นที่ — what the SIX-STEP wizard actually writes (กทล.๑ ส่วนที่ ๒ is a
  // checkbox row; the wizard stores the ticks nested under farmData) and what the
  // farmer SEES and SELECTS. It is AUTHORITATIVE when present.
  //
  // Operator ruling 2026-09-06 (superseding the earlier "legacy cultivationMethods
  // wins"): the price must equal what step 3 selected. A demo filing carried a stale
  // cultivationMethods=[3 methods] alongside areaTypes=[INDOOR] and was billed for
  // three — "เลือก 1 รูปแบบการปลูก ทำไมจ่ายของ 3". areaTypes now outranks the legacy
  // key; cultivationMethods is only the fallback for old filings that never wrote
  // areaTypes. The submit gate reads the SAME precedence (canonical-application-
  // validator) so the gate and the price never disagree.
  const nestedAreaTypes = Array.isArray(payload?.formData?.farmData?.areaTypes)
    ? payload.formData.farmData.areaTypes
    : (Array.isArray(payload?.farmData?.areaTypes) ? payload.farmData.areaTypes : []);
  for (const method of nestedAreaTypes) {
    const normalized = normalizeMethod(method);
    if (normalized) {
      unique.add(normalized);
    }
  }

  // Legacy cultivationMethods (direct + nested) — FALLBACK only, used when the filing
  // wrote no areaTypes (pre-six-step data). Skipped entirely once areaTypes answered.
  if (unique.size === 0) {
    const legacy = [
      ...(Array.isArray(payload?.cultivationMethods) ? payload.cultivationMethods : []),
      ...(Array.isArray(payload?.formData?.cultivationMethods) ? payload.formData.cultivationMethods : []),
    ];
    for (const method of legacy) {
      const normalized = normalizeMethod(method);
      if (normalized) {
        unique.add(normalized);
      }
    }
  }

  if (unique.size === 0) {
    const plots = Array.isArray(payload?.plots) ? payload.plots : [];
    for (const plot of plots) {
      const normalized = normalizeMethod(plot?.solarSystem || plot?.cultivationMethod || plot?.locationType);
      if (normalized) {
        unique.add(normalized);
      }
    }
  }

  // ── ทางถอยที่อ่านคอลัมน์ค่าเดียว ถูกตัดออก 2026-09-11 ───────────────────────
  //
  // เดิมบรรทัดนี้คือ `normalizeMethod(payload?.locationType || payload?.areaType)`
  //
  // `Application.areaType` เป็นคอลัมน์ NOT NULL จากยุคที่หนึ่งคำขอมีหนึ่งลักษณะ และ
  // **ประตูร่างเป็นคนเติมคำว่า 'OUTDOOR' ลงไปเอง** เพื่อให้คอลัมน์มีค่า (applications.js)
  // ⇒ การอ่านคอลัมน์นั้นคือการอ่านคำที่ระบบประดิษฐ์ แล้วพิมพ์มันลงบรรทัดในเอกสาร
  // เป็น "แบบกลางแจ้ง" ทั้งที่ผู้ยื่นไม่เคยเลือก · คำเดียวกันนั้นไหลต่อไปถึงขอบเขตบน
  // ใบรับรอง ซึ่ง certified-scope.js ใช้ล็อกว่าจะเพิ่มแปลงแบบอื่นได้หรือไม่
  //
  // คำขอที่ไม่ประกาศอะไรเลยยังคิดหนึ่งลักษณะเหมือนเดิม (ยอดไม่เปลี่ยน) แต่เป็น
  // `SCOPE_1` ที่ไม่มีชื่อ — เอกสารพิมพ์ "รูปแบบการปลูกที่ 1" และไม่มีบรรทัดใดอ้างว่า
  // ผู้ยื่นเลือกอะไร · ตั้งแต่ 2026-09-11 ประตูยื่นปฏิเสธคำขอที่ไม่ประกาศอยู่แล้ว
  // ทางนี้จึงเหลือไว้ให้เฉพาะการ "อ่าน" คำขอยุคก่อนเท่านั้น

  return [...unique];
}

/**
 * WHICH cultivation types this filing declared — the list, not the tally.
 *
 * Operator ruling 2026-09-06: *"มันเป็นการบวกมากกว่า ... ราคาก็เอามารวมกัน"*. The fee is a
 * SUM over the declared types, so the types themselves are what the pricing needs; a count
 * is only what you keep when every type happens to cost the same, and it stops being true
 * the day one of them does not.
 *
 * `options.scopes` overrides for a caller that already resolved them (the combined
 * calculation resolves once and hands both phases the same answer). `options.scopeCount`
 * is still honoured for older callers and yields anonymous placeholder scopes, because a
 * caller that only knew a number never knew which types they were.
 */
function resolveCultivationScopes(formData = {}, options = {}) {
  if (Array.isArray(options.scopes) && options.scopes.length > 0) {
    return options.scopes.map(normalizeMethod).filter(Boolean);
  }

  const methods = collectUniqueCultivationMethods(formData);
  const explicit = toPositiveInt(options.scopeCount);

  if (explicit) {
    // A caller that names a count AND a filing that names its types agree in the ordinary
    // case, and then the TYPES win — losing the names to an anonymous SCOPE_n would put
    // "รูปแบบการปลูกที่ 1" on a document that could have said "แบบกลางแจ้ง".
    //
    // When they disagree the caller knows something the filing no longer does — a frozen
    // row was priced for N types and the application now names a different number — and
    // no line may claim to be one of them (ruling 12, 2026-08-28). That is the only case
    // that earns the placeholders.
    if (methods.length === explicit) {
      return methods;
    }
    return Array.from({ length: explicit }, (_unused, i) => `SCOPE_${i + 1}`);
  }

  if (methods.length > 0) {
    return methods;
  }

  // A filing that declares nothing is charged for one, never zero: a zero-scope fee is a
  // free certificate, which is a worse answer than the minimum charge.
  return ['SCOPE_1'];
}

function resolveCultivationScopeCount(formData = {}, options = {}) {
  return resolveCultivationScopes(formData, options).length;
}

function buildPhaseFee({ scopes, scopeCount, ratePerScope, rateForScope, phase, label }) {
  // ── ค่าบริการเดียว ไม่มีการแยกส่วน (operator 2026-09-11) ──────────────────
  //
  //   ยอดชำระ = ค่าบริการ + VAT 7% ของค่าบริการ
  //
  // "ต่อไปนี้จะไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการทั้งหมด 5,500 + 27,500
  //  ... รวม vat 7% จะเท่ากับ 35,310 เรามีราคานี้เท่านั้น ต่อ 1 รูปแบบการปลูก"
  //
  // เดิมที่นี่คำนวณย้อนกลับ: ประกาศฐานรัฐ 5,000 แล้วบวกแพลตฟอร์ม 10% ให้ได้ค่าบริการ
  // 5,500 · ตอนนี้อัตราที่ประกาศ **คือค่าบริการเอง** · ยอดที่เกษตรกรจ่ายเท่าเดิมทุกบาท
  //
  // การแยกนั้นไม่มีผู้ใช้เหลืออยู่แล้วก่อนจะถูกถอด: รางที่มินต์ใบจริงใช้ serviceType
  // `CERTIFICATION_CHECKOUT_M1|M2` ซึ่งไม่ลงท้าย `_STATE_FEE` ⇒ invoice-side.js
  // จัดทั้งก้อนเป็นฝั่งบริษัทอยู่แล้ว และไม่มีเส้นทางใดมินต์ใบ `*_STATE_FEE` อีกเลย
  // ต่อเนื่องจาก W14 (operator 2026-08-22 @ c28355ea, ยืนยันตัวเลข @ d1c33ea0):
  // บริษัทออกเอกสารทุกใบ เกษตรกรจ่ายบริษัท บริษัทไปกระทบยอดกับกรมนอกระบบนี้
  //
  // ROUNDING: ไม่มีจุดไหนที่การปัดเศษมีผล — 5,500 × 0.07 = 385 ลงตัวพอดีทุกจำนวนรูปแบบ
  // Math.round คงไว้เพื่อไม่ให้อัตราที่ override ผ่าน SystemConfig สร้างเศษสตางค์
  // ที่อัตราปัจจุบันมันไม่เคยปัดจริง · นี่คือเหตุผลที่งวด 1 + งวด 2 เท่ากับยอดต่ออายุ
  // ครั้งเดียวเป๊ะ (385n + 1,925n = 2,310n) โดยไม่ต้องมีกติกาดูดเศษที่ไหนเลย
  // ── บวก ไม่ใช่คูณ (operator ruling 2026-09-06) ───────────────────────────
  //
  // The state amount is the SUM of one line per declared cultivation type, and every
  // figure below is computed from that sum. It used to be `ratePerScope × scopeCount`,
  // and the quotation then DIVIDED the phase total back by the count to invent a
  // per-type line — the arithmetic running backwards. At today's uniform rates both
  // give the same number; the moment one type is priced differently, multiplication
  // gives wrong lines under a right-looking total, and this gives right lines whose
  // sum IS the total.
  //
  // `rateForScope` is the seam a dated per-type rate table lands on. It defaults to the
  // configured rate for every type, so nothing re-prices today.
  if (!Array.isArray(scopes) || scopes.length === 0) {
    // Loud, not lenient. A caller that reaches here has a scopeCount and no scopes, which
    // under the additive model means nobody knows WHAT is being charged for — and the
    // quiet answer (fall back to a count) is exactly the multiplication this ruling
    // replaced.
    throw new Error(
      'buildPhaseFee needs the declared cultivation scopes — pass `scopes` from '
      + 'resolveCultivationScopes(). A count alone cannot price an additive fee.',
    );
  }

  const rateOf = typeof rateForScope === 'function'
    ? (method) => Number(rateForScope(method)) || 0
    : () => ratePerScope;

  const scopeBreakdown = scopes.map((method) => {
    const lineService = rateOf(method);
    const lineVat = Math.round(lineService * currentVatRate());
    return {
      method,
      phase,
      serviceFeeAmount: lineService,
      vatAmount: lineVat,
      phaseTotal: lineService + lineVat,
    };
  });

  const serviceFeeAmount = scopeBreakdown.reduce((sum, line) => sum + line.serviceFeeAmount, 0);
  const vatAmount = Math.round(serviceFeeAmount * currentVatRate());
  const phaseTotal = serviceFeeAmount + vatAmount;
  // `label` only renames the human-readable line descriptions; the amounts
  // above are untouched by it. W12 uses it so the renewal's single charge does
  // not describe itself as "Phase 2" on an invoice.
  const phaseLabel = label || (phase === 'PHASE_1' ? 'Phase 1' : 'Phase 2');

  return {
    scopeCount: scopeBreakdown.length,
    // One entry per declared cultivation type. The document prints these as its
    // numbered lines; their sum is the amount above, not the other way round.
    scopeBreakdown,
    // ค่าบริการ — รายได้ที่ต้องเสีย VAT ของบริษัท และเป็นฐานที่ VAT คิดจาก
    // ทุกผู้บริโภค (ยอดก่อนภาษีในใบเสนอราคา/ใบแจ้งหนี้/ใบเสร็จ และ pricing API)
    // อ่านค่านี้ค่าเดียว ไม่ต้องบวกอะไรเข้าด้วยกันเองแล้วเสี่ยงได้คำตอบคนละอย่าง
    serviceFeeAmount,
    vatAmount,
    phaseTotal,
    // บรรทัดที่เอกสารพิมพ์ — หนึ่งรายการ ไม่ใช่สาม (operator 2026-09-11)
    // `stateItems` / `platformItems` ถูกถอด: มันบรรยายการแยกส่วนที่เลิกใช้แล้ว
    // และบนเอกสารภาษี บรรทัดที่บรรยายสูตรที่ไม่ได้ใช้ = ข้อความเท็จ
    serviceFeeItems: [
      {
        description: `${phaseLabel} ค่าบริการ (${scopeCount} รูปแบบการปลูก)`,
        amount: serviceFeeAmount,
      },
    ],
    vatItems: [
      {
        description: `${phaseLabel} VAT 7% ของค่าบริการ`,
        amount: vatAmount,
      },
    ],
    items: [
      {
        description: `${phaseLabel} ค่าบริการ (${scopeCount} รูปแบบการปลูก)`,
        amount: serviceFeeAmount,
      },
    ],
    // `total` คือยอดเต็มของงวด (ค่าบริการ + VAT) — คือสิ่งที่ตัดผ่านช่องทางชำระเงิน
    // และเป็นยอดที่ใบแจ้งหนี้/ใบเสร็จรวมได้ · ก่อนการตรวจ 2026-04-28 ช่องนี้เคยคืน
    // ยอดส่วนรัฐอย่างเดียว ทำให้ตัดเงินน้อยกว่าที่ออกใบ — อย่าให้มันกลับไปเป็นยอดย่อยอีก
    total: phaseTotal,
  };
}


function calculatePhase1Fee(formData = {}, options = {}) {
  return buildPhaseFee({
    scopes: resolveCultivationScopes(formData, options),
    ratePerScope: FEE_RATES.PHASE1_PER_SCOPE,
    rateForScope: options.rateForScope,
    phase: 'PHASE_1',
  });
}

function calculatePhase2Fee(formData = {}, options = {}) {
  return buildPhaseFee({
    scopes: resolveCultivationScopes(formData, options),
    ratePerScope: FEE_RATES.PHASE2_PER_SCOPE,
    rateForScope: options.rateForScope,
    phase: 'PHASE_2',
  });
}

/**
 * W12 (operator ruling 2026-08-22, the change log 67ef3612 / 851fd516;
 * billing change authorised as a one-time L3 exception, eabfc020).
 *
 * A certificate renewal is ONE charge. It does not walk the phase-1/phase-2
 * pair, so it has no calculatePhaseNFee of its own — but it must be grossed up
 * by exactly the same arithmetic, or the number the applicant is shown and the
 * number the invoice carries drift apart. It therefore goes through the same
 * buildPhaseFee the phase fees go through: the rates are reused, never
 * re-declared, and the rounding cannot diverge because it is the same code.
 *
 * PER SCOPE (operator correction 2026-08-22, the change log 8b8d581f):
 * "ไม่ว่าใหม่ หรือต่อ ต้องคิดเงินแยกรูปแบบการปลูก". scopeCount is resolved by
 * resolveCultivationScopeCount and multiplied inside buildPhaseFee — the exact
 * path calculatePhase1Fee and calculatePhase2Fee take — rather than a second
 * multiplication written here.
 *
 * The figures are deliberately NOT written in this comment. The per-scope rate is
 * FEES.RENEWAL_PER_SCOPE (config/business-rules.js, served through the dated rate
 * table), and the base and payable for 1, 2 and 3 scopes are pinned by
 * __tests__/unit/renewal-single-charge-billing.test.js (SCOPE_TABLE, which also
 * calls this function directly). Figures copied into this comment have gone stale
 * twice: once when W14 moved VAT onto the whole service fee, and again when the
 * 2026-09-11 rate change raised the base while leaving the payable as it was. A money
 * comment that outlives its formula has already misled one operator ruling in this
 * file (line 243 note); read the rate and the test, not prose.
 *
 * The result is shaped like a phase fee because everything downstream
 * (quotation installments, invoice mint, receipts) already speaks that shape.
 * It is mapped onto the PHASE_2 slot by quotation-service — see the note there
 * for why PHASE_2 and not a new service type.
 */
function calculateRenewalFee(formData = {}, options = {}) {
  return buildPhaseFee({
    scopes: resolveCultivationScopes(formData, options),
    ratePerScope: FEE_RATES.RENEWAL_PER_SCOPE,
    rateForScope: options.rateForScope,
    phase: 'PHASE_2',
    label: 'Certificate renewal',
  });
}

function calculateApplicationFees(formData = {}, options = {}) {
  // Resolved ONCE and handed to both phases, so the two instalments can never disagree
  // about which types the filing declared.
  const scopes = resolveCultivationScopes(formData, options);
  const scopeCount = scopes.length;
  const phase1 = calculatePhase1Fee(formData, { ...options, scopes });
  const phase2 = calculatePhase2Fee(formData, { ...options, scopes });

  // ค่าบริการรวมสองงวด — ฐานที่ VAT 7% คิดจาก
  const serviceFeeTotal = phase1.serviceFeeAmount + phase2.serviceFeeAmount;
  const vatTotal = phase1.vatAmount + phase2.vatAmount;
  const grandTotal = serviceFeeTotal + vatTotal;

  return {
    scopeCount,
    phase1,
    phase2,
    // `total` คือผลรวมของทั้งสองงวด (ค่าบริการ + VAT) เท่ากับ grandTotal —
    // คงไว้เพราะผู้บริโภคเดิมอ่านช่องนี้ และมันตรงกับยอดที่ผู้ยื่นจ่ายจริง
    total: phase1.total + phase2.total,
    serviceFeeTotal,
    vatTotal,
    grandTotal,
  };
}


module.exports = {
  FEE_RATES,
  // A getter, not a value, for the same reason as FEE_RATES above.
  get VAT_RATE() {
    return currentVatRate();
  },
  resolveCultivationScopeCount,
  resolveCultivationScopes,
  collectUniqueCultivationMethods,
  calculatePhase1Fee,
  calculatePhase2Fee,
  calculateRenewalFee,
  calculateApplicationFees,
};
