/**
 * ผู้ออกเอกสารทางการเงิน — **มีรายเดียว**
 *
 * operator 2026-09-11: *"ต่อไปนี้จะไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการ
 * ทั้งหมด"* และสั่งถอดระบบนำส่งเงินให้กรมออกทั้งชุด
 *
 * บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด เป็นผู้ออกใบเสนอราคา ใบแจ้งหนี้ และใบเสร็จทุกใบ
 * เกษตรกรจ่ายบริษัทครั้งเดียวต่องวด · ค่าบริการทั้งก้อนเป็นรายได้ที่ต้องเสีย VAT ของบริษัท
 * สิ่งที่บริษัทจ่ายให้กรมเป็นข้อตกลงนอกระบบนี้
 *
 * ── สิ่งที่ไฟล์นี้เคยเป็น และทำไมมันหายไป ──
 * เดิมหัวไฟล์ยาว 228 บรรทัด อธิบาย "two-money-flow model": ผู้ยื่นต้องโอนสองครั้งต่องวด
 * ค่าธรรมเนียมรัฐเข้าบัญชีกรมบัญชีกลางโดยตรง ใบเสร็จเงินรายได้แผ่นดินออกในนามกรม
 * พร้อมอ้างอิง ป.รัษฎากร ม.77/1(10) และ พ.ร.บ.วินัยการเงินการคลังของรัฐ ม.34
 *
 * โมเดลนั้นเลิกใช้ไปตั้งแต่ W14 (operator 2026-08-22) และการจ่ายเงินเป็น Stripe ใบเดียว
 * ⇒ คำอธิบายทั้งหมดนั้นบรรยายสิ่งที่ระบบไม่ได้ทำมานานแล้ว · เอกสารที่อยู่ยืนกว่าสิ่งที่มัน
 * อธิบาย เป็นอันตรายกว่าไม่มีเอกสาร เพราะคนอ่านเชื่อมัน
 *
 * DTAM_ISSUER / DTAM_BANK_ACCOUNT ถูกถอดพร้อมกัน — ไม่มีเอกสารใดออกในนามกรมอีกแล้ว
 * (ชื่อและเลขประจำตัวผู้เสียภาษีของกรมยังอยู่ในเทมเพลตใบรับรอง ซึ่งเป็นคนละเรื่อง:
 *  กรมเป็นผู้ให้การรับรอง ไม่ใช่ผู้ออกใบเสร็จ)
 *
 * env ที่ตั้งค่าได้: PLATFORM_COMPANY_NAME_TH/EN · PLATFORM_TAX_ID ·
 * PLATFORM_REGISTRATION_NO · PLATFORM_ADDRESS_LINE1/2 · PLATFORM_BANK_* · PLATFORM_PROMPTPAY_*
 */


// The tariff owns the VAT rate; this file reads it rather than keeping a second
// copy (config/business-rules FEES.VAT_RATE, guarded by fee-single-source).
const { FEES } = require('./business-rules');

const SERVICE_TYPES = Object.freeze({
    PHASE_1_STATE_FEE: 'PHASE_1_STATE_FEE',
    PHASE_1_PLATFORM_FEE: 'PHASE_1_PLATFORM_FEE',
    PHASE_2_STATE_FEE: 'PHASE_2_STATE_FEE',
    PHASE_2_PLATFORM_FEE: 'PHASE_2_PLATFORM_FEE',
});

/**
 * ผู้ออกเอกสารมีรายเดียว · รายการนี้ปิด — การเพิ่มรายที่สองแปลว่าต้องแก้สายการจ่ายเงิน
 * และการกระทบยอดบัญชีอีกหลายไฟล์
 *
 * `DTAM` ถูกถอด 2026-09-11 พร้อมการเลิกแยกค่าธรรมเนียมรัฐ
 */
const ISSUER_TYPES = Object.freeze({
    PLATFORM: 'PLATFORM',   // บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด — ค่าบริการ + VAT
});

/**
 * Sentinel that BOTH (a) is human-readable in a printed receipt so QA
 * spots the gap during UAT and (b) is grep-able in the repo so devs
 * find every site that depends on configuration before production cutover.
 */
const PENDING = 'PENDING_FINANCE_CONFIRMATION';

/**
 * The company contact address printed on financial documents (ใบเสนอราคา,
 * ใบวางบิล/ใบแจ้งหนี้, ใบเสร็จ, ใบกำกับภาษี, ใบลด/เพิ่มหนี้).
 *
 * Controller decision (2026-09-27, fix/invoice-pdf-truth): this is
 * finance@gacpth.com — the SAME address as `FINANCE_EMAIL` in
 * apps/web-app/src/constants/contact-emails.ts (mirror pinned by
 * __tests__/unit/finance-contact-email-mirror.test.js). Operator ruling
 * 2026-09-26: the gacpth.com addresses stay; MX is being set up.
 *
 * ONE backend source — `contactEmail` below reads this constant rather than
 * repeating the literal, so a future change only has one place to make.
 */
const FINANCE_CONTACT_EMAIL = 'finance@gacpth.com';


// System deep-dive Tier 10 — Backend + Compliance + Finance (2026-05-15):
// Platform issuer real data confirmed by owner.
//
// Key facts:
//   - Registered as "บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด" (note: "โซลูชัน" not
//     "โซลูชั่น" — official spelling per DBD records)
//   - "(สำนักงานใหญ่)" suffix is part of the legal name when issuing tax
//     documents (distinguishes from branch offices for VAT purposes per
//     ม.86/4 (1) แห่ง ป.รัษฎากร — full tax invoice must show whether the
//     issuing site is the head office or a branch)
//   - In Thailand the 13-digit corporate registration number (เลขทะเบียน
//     นิติบุคคล) IS the same as the corporate tax ID (เลขประจำตัวผู้เสียภาษี).
//     Hence taxId === registrationNo. The two env vars stay separate so
//     ops can override either independently in edge cases.
const PLATFORM_ISSUER = Object.freeze({
    type: ISSUER_TYPES.PLATFORM,
    legalNameTH: process.env.PLATFORM_COMPANY_NAME_TH
        || 'บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่)',
    legalNameEN: process.env.PLATFORM_COMPANY_NAME_EN
        || 'Predictive AI Solution Co., Ltd. (Head Office)',
    taxId: process.env.PLATFORM_TAX_ID || '0105568045932',
    addressLine1: process.env.PLATFORM_ADDRESS_LINE1
        || '429/69 หมู่บ้าน พรีเมี่ยมเพลส ถนนสุคนธสวัสดิ์ แขวงลาดพร้าว เขตลาดพร้าว',
    addressLine2: process.env.PLATFORM_ADDRESS_LINE2
        || 'กรุงเทพมหานคร 10230',
    // เลขทะเบียนพาณิชย์ / นิติบุคคล (13 digits) — same as taxId in Thailand
    registrationNo: process.env.PLATFORM_REGISTRATION_NO || '0105568045932',
    // The platform issues a full tax invoice that corporate customers can
    // use when withholding 3% under their own ภ.ง.ด.53 obligation.
    receiptDocumentType: 'FULL_TAX_INVOICE_RECEIPT',
    receiptDocumentTypeTH: 'ใบกำกับภาษีเต็มรูป / ใบเสร็จรับเงิน',
    chargesVat: true,
    // Derived, not re-typed. The tariff owns the rate (config/business-rules
    // FEES.VAT_RATE, guarded by the fee-single-source probe); a second literal
    // here would agree with it until the day one of them was edited.
    // A getter, read at call time (fix/fees-from-server round 3): a copy taken
    // when this file loaded missed any later fee.vat_rate override on FEES.
    get vatRate() { return FEES.VAT_RATE; },
    // ช่องทางติดต่อของบริษัท — พิมพ์บนหัวกระดาษของใบเสนอราคา ใบวางบิล และใบเสร็จ
    // เดิมเอกสารเหล่านี้พิมพ์เบอร์ switchboard ของกรม (shared/ministry-contact.js):
    // เอกสารของบริษัทที่บอกลูกค้าให้โทรหากรม · แก้ 2026-09-11
    contactPhone: process.env.PLATFORM_CONTACT_PHONE || PENDING,
    // อีเมลของบริษัท — operator 2026-09-11 · เดิมเอกสารพิมพ์ contact@gacpth.com
    // ซึ่งเป็นอีเมลของแพลตฟอร์ม/กรม ไม่ใช่ของผู้ออกเอกสาร · เดิม default ที่นี่เป็น
    // 'issuer-contact@example.com' (gmail ส่วนตัว) — ถอดออก 2026-09-27, แทนด้วย
    // FINANCE_CONTACT_EMAIL (finance@gacpth.com, ตรงกับ FINANCE_EMAIL ฝั่งเว็บ)
    contactEmail: process.env.PLATFORM_CONTACT_EMAIL || FINANCE_CONTACT_EMAIL,
});


// PLATFORM_BANK_ACCOUNT — Predictive AI Solution corporate account
//   - Default values are PENDING_FINANCE_CONFIRMATION because the platform
//     bank-account number is NOT in any old document found during the
//     B16-C search. Finance team must fill these env vars before
//     production cutover (see "How to fill in real data" §"Ops runbook"
//     in this file's header comment).
//   - PromptPay defaults to the platform's 13-digit registration / tax-ID
//     (0105568045932) — for corporate PromptPay accounts that is the
//     canonical identifier.
const PLATFORM_BANK_ACCOUNT = Object.freeze({
    issuer: ISSUER_TYPES.PLATFORM,
    bankName: process.env.PLATFORM_BANK_NAME || PENDING,
    accountNo: process.env.PLATFORM_BANK_ACCOUNT_NO || PENDING,
    accountName: process.env.PLATFORM_BANK_ACCOUNT_NAME
        || 'บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด',
    promptpayId: process.env.PLATFORM_PROMPTPAY_ID || '0105568045932',
    // ป.รัษฎากร ม.86/4 — ผู้ประกอบการ VAT รับรู้รายได้ + Output VAT
    vatExempt: false,
    // Derived, like PLATFORM_ISSUER.vatRate above. Two literals of one rate in
    // one file is the shape that drifts the day either is edited. Read at call
    // time, like PLATFORM_ISSUER.vatRate (round 3).
    get vatRate() { return FEES.VAT_RATE; },
    revenueCategoryTH: 'รายได้ค่าบริการ + ภาษีขายตั้งพัก',
    note: 'Platform commercial channel — applicant transfers platform fee '
        + '+ VAT to this account. Posted Dr Cash / Cr Revenue + Cr Output '
        + 'VAT per TFRS for NPAEs ch.18.',
});

/**
 * Pick the bank account that matches an issuer type. Mirrors
 * `getInvoiceIssuer(serviceType)` so callers can ask one question at the
 * canonical level (serviceType) and get both legal identity AND the bank
 * channel in a single helper response.
 *
 * @param {string} issuerType — one of ISSUER_TYPES (DTAM / PLATFORM)
 * @returns {object} frozen DTAM_BANK_ACCOUNT or PLATFORM_BANK_ACCOUNT
 * @throws when issuerType is unknown
 */
function getBankAccountForIssuer(issuerType) {
    if (issuerType === ISSUER_TYPES.PLATFORM) {
        return PLATFORM_BANK_ACCOUNT;
    }
    throw new Error(
        `[invoice-issuers] Unknown issuerType "${issuerType}". `
        + `Expected one of: ${Object.values(ISSUER_TYPES).join(', ')}.`,
    );
}

/**
 * Resolve issuer info from a canonical service type.
 * STATE fees → DTAM. PLATFORM fees → Predictive AI Solution.
 *
 * Post-B16-C: the returned object also carries `.bankAccount` so PDF
 * templates + payment routes can read the legal identity + the bank
 * channel from one helper call. The bank account is the appropriate
 * `DTAM_BANK_ACCOUNT` (state fees) or `PLATFORM_BANK_ACCOUNT` (platform
 * fees + VAT) — see "Two-money-flow model" in this file's header comment.
 *
 * @param {string} serviceType  one of SERVICE_TYPES values
 * @returns {object}  issuer info merged with the matching bank account
 * @throws  if serviceType is not recognized
 */
function getInvoiceIssuer(serviceType) {
    const normalized = String(serviceType || '').toUpperCase();
    // W14 (operator ruling 2026-08-22, the change log c28355ea): ONE issuer.
    //
    // Every service type — the two that used to route to DTAM included — is
    // issued by the company. The farmer pays the company for a service; the
    // company settles the state portion with DTAM afterwards, outside this
    // system. So there is one legal identity on the document, one tax ID, one
    // bank account to transfer to, and VAT on the whole ค่าบริการ.
    //
    // The serviceType argument is still VALIDATED rather than ignored: an
    // unrecognised value must stay an error. Collapsing the branches must not
    // quietly turn a typo'd service type into a valid document.
    if (Object.values(SERVICE_TYPES).includes(normalized)) {
        return Object.freeze({ ...PLATFORM_ISSUER, bankAccount: PLATFORM_BANK_ACCOUNT });
    }
    throw new Error(
        `[invoice-issuers] Unknown serviceType "${serviceType}". `
        + `Expected one of: ${Object.values(SERVICE_TYPES).join(', ')}.`,
    );
}

// เดิมมี shouldChargeVat(serviceType) ที่คืน true เสมอตั้งแต่ W14 — ไม่มีผู้เรียกเหลืออยู่
// และคำถาม "ใบนี้ต้องคิด VAT ไหม" ไม่มีคำตอบอื่นได้แล้ว · ถอด 2026-09-11

/**
 * Validates that production has filled in all `PENDING_…` placeholders.
 * Returns an array of [field, issuerType] tuples that are still pending.
 * Empty array = all good.
 *
 * Call this once during app startup in production — log a loud warning
 * if anything is missing so Finance/DevOps spots it before customers do.
 */
function listPendingIssuerFields() {
    const pending = [];
    for (const issuer of [PLATFORM_ISSUER]) {
        for (const [key, value] of Object.entries(issuer)) {
            if (value === PENDING) {pending.push([key, issuer.type]);}
        }
    }
    // สแกนบัญชีธนาคารด้วย เพื่อให้ค่าที่ยังไม่ได้ตั้ง (เช่น PLATFORM_BANK_ACCOUNT_NO)
    // โผล่ในการตรวจความพร้อมตอนบูต
    for (const [type, acct] of [
        ['PLATFORM_BANK_ACCOUNT', PLATFORM_BANK_ACCOUNT],
    ]) {
        for (const [key, value] of Object.entries(acct)) {
            if (value === PENDING) {pending.push([key, type]);}
        }
    }
    return pending;
}

module.exports = {
    SERVICE_TYPES,
    ISSUER_TYPES,
    PLATFORM_ISSUER,
    PLATFORM_BANK_ACCOUNT,
    PENDING,
    FINANCE_CONTACT_EMAIL,
    getInvoiceIssuer,
    getBankAccountForIssuer,
    listPendingIssuerFields,
};
