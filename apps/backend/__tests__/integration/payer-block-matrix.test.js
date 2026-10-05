/**
 * RED audit — payer-block-by-type (before the fix)
 *
 * Renders all 6 finance documents x 3 Entity types through the REAL Prisma
 * selects + REAL PDF template services (invoice-service.getForDocument,
 * invoice-template-service.generate*Pdf, quotation-service /
 * applicationService.getApplicationSlice with the SAME select the live route
 * uses, credit-note-service.findCreditNoteById, debit-note-service.findDebitNoteById)
 * against a scratch Postgres (never staging/demo/production), and asserts the
 * approved target column from the mission brief:
 *
 *   INDIVIDUAL            -> name label "ชื่อ-นามสกุล", NO national ID anywhere
 *   JURISTIC               -> name label "ชื่อบริษัท", id = Entity.juristicId
 *   COMMUNITY_ENTERPRISE   -> name label "ชื่อวิสาหกิจชุมชน", id = Entity.communityRegNo
 *                              (tax invoice prints "-")
 *
 * This harness is EXPECTED TO FAIL on this branch (fix/payer-block-by-type,
 * pre-fix). The failures ARE the RED evidence. It is written so the same file
 * turns GREEN once the fix lands — no test here is loosened to pass early.
 *
 * L1 (EVIDENCE-OR-SILENCE) / L2 (NO SECRET): every claim below is backed by a
 * real render in this session; no `.env`, no staging/demo url is read here.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

jest.setTimeout(180000);

const { prisma } = require('../../services/prisma-database');
const invoiceService = require('../../services/invoice-service');
const invoiceTemplateService = require('../../services/pdf/invoice-template-service');
const applicationService = require('../../services/application-service');
const quotationServiceExports = require('../../services/quotation-service');
const creditNoteService = require('../../services/credit-note-service');
const debitNoteService = require('../../services/debit-note-service');
// What the resolver needs from an application — the same object the live
// quotation route spreads into its select (routes/api/applications/quotations.js).
const { PAYER_APPLICATION_SELECT } = require('../../utils/applicant-resolver');
const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');
const { arabicToThai } = require('../../utils/thai-numerals');

const EVIDENCE_DIR = process.env.PAYER_BLOCK_OUT_DIR
  || path.join(require('os').tmpdir(), 'payer-block-matrix');

// ── fixture identifiers (fake, valid-checksum, never a real person/company) ──

function thai13Checksum(first12Digits) {
  const digits = first12Digits.split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (13 - i), 0);
  return String((11 - (sum % 11)) % 10);
}
function fakeThai13(seedPrefix) {
  // seedPrefix: 12 digits, first char controls person(1-9)/juristic(0) class.
  return seedPrefix + thai13Checksum(seedPrefix);
}
const FAKE_INDIVIDUAL_ID = fakeThai13('100000000000'); // starts 1 = person
const FAKE_JURISTIC_ID = fakeThai13('010500000000'); // starts 0 = juristic (DBD)
const FAKE_COMMUNITY_REGNO = '58012345678'; // DOAE 11-digit, no checksum (schema comment)
const FAKE_PRESIDENT_ID = fakeThai13('300000000000');

// Thai-numeral documents (tax invoice, credit/debit note) print the id in Thai
// digits — a JURISTIC tax id in the 1-4-5-2-1 grouping. Asserted against the
// LITERAL expected string, never against formatThaiTaxId itself (a formatter
// compared with itself passes under any grouping, including the round-3 bug
// that dropped two digits). The two sanity pins keep the literals honest.
const FAKE_JURISTIC_ID_TH = arabicToThai('0-1050-00000-00-4');
// The receipt / tax invoice prints the same grouping in Arabic digits.
const FAKE_JURISTIC_ID_GROUPED = '0-1050-00000-00-4';
const FAKE_COMMUNITY_REGNO_TH = arabicToThai('58012345678');
// A national ID must not appear in ANY printed form: raw, Thai digits, or
// grouped either way.
const FAKE_INDIVIDUAL_ID_FORMS = [
  FAKE_INDIVIDUAL_ID,
  arabicToThai(FAKE_INDIVIDUAL_ID),
  arabicToThai('1-0000-00000-00-9'),
  '1-0000-00000-00-9',
];
function printsNationalId(s) {
  return FAKE_INDIVIDUAL_ID_FORMS.some((form) => String(s).includes(form));
}

function mask(id) {
  if (!id || id === '-' || String(id).length < 4) { return id; }
  return `…${String(id).slice(-4)}`;
}

const RUN_TAG = Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

const TYPES = [
  {
    type: 'INDIVIDUAL',
    displayName: 'สมชาย นามสมมติทดสอบ',
    entityIds: { thaiCitizenId: FAKE_INDIVIDUAL_ID },
    applicantData: {
      firstName: 'สมชาย', lastName: 'นามสมมติทดสอบ',
      idCard: FAKE_INDIVIDUAL_ID,
      phone: '0811110001',
      address: '12 หมู่ 3 ต.ทดสอบ', district: 'ทดสอบ', province: 'เชียงใหม่', postalCode: '50290',
    },
  },
  {
    type: 'JURISTIC',
    displayName: 'บริษัท ทดสอบตรวจสอบ จำกัด',
    entityIds: { juristicId: FAKE_JURISTIC_ID },
    applicantData: {
      companyName: 'บริษัท ทดสอบตรวจสอบ จำกัด',
      authorizedSignatory: 'นางสาวทดสอบ ผู้มีอำนาจ',
      taxId: FAKE_JURISTIC_ID,
      phone: '0822220002',
      address: '99 ถ.ทดสอบ', district: 'ทดสอบ', province: 'กรุงเทพมหานคร', postalCode: '10110',
    },
  },
  {
    type: 'COMMUNITY_ENTERPRISE',
    displayName: 'วิสาหกิจชุมชนทดสอบตรวจสอบ',
    entityIds: { communityRegNo: FAKE_COMMUNITY_REGNO },
    applicantData: {
      communityName: 'วิสาหกิจชุมชนทดสอบตรวจสอบ',
      presidentName: 'นายทดสอบ ประธานสมมติ',
      presidentIdCard: FAKE_PRESIDENT_ID,
      nationality: 'ไทย',
      communityRegistrationNo: FAKE_COMMUNITY_REGNO,
      houseCode: '5001234567',
      phone: '0833330003',
      address: '55 หมู่ 1 ต.ทดสอบ', district: 'ทดสอบ', province: 'เชียงราย', postalCode: '57000',
    },
  },
];

// Populated in beforeAll — { INDIVIDUAL: {org, user, entity, application, invoice,
// creditNote, debitNote, quotation}, ... }
const seeded = {};
// Cell results collected as tests run, so afterAll can write the matrix once.
const CELLS = [];
function recordCell(doc, type, verdict, actual, expected, note) {
  CELLS.push({ doc, type, verdict, actual, expected, note: note || '' });
}

function stripHtmlToLblVal(html) {
  const re = /<span class="lbl">([^<]*)<\/span>\s*<br>\s*<span class="val">([^<]*)<\/span>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) { out.push({ label: m[1].trim(), value: m[2].trim() }); }
  return out;
}

// The payer's own name/id pair, NOT the issuer's or the approver's. Several
// templates (credit-note.html, debit-note.html; formerly tax-invoice.html) use the
// SAME <span class="lbl">/<span class="val"> markup for three different
// blocks: the issuer ("ชื่อผู้ออก / Issuer" ... "เลขประจำตัวผู้เสียภาษีอากร /
// Tax ID" — note "ภาษีอากร", printed BEFORE the payer block), the payer
// ("ชื่อบริษัท / Company Name" or "ชื่อ-นามสกุล / Name" — the ONLY two labels
// payerNameLabel() can currently produce), and the approver ("ชื่อ-สกุล /
// Name" — note "สกุล" without "นาม", printed AFTER the payer block). A plain
// `.find(label.includes('ชื่อ'))` grabs the issuer's row on those three
// templates. Exact-match the two labels payerNameLabel() can actually emit,
// then take the NEXT pair — every template puts the id/tax-id field
// immediately after the name field in the payer block, and only there.
// Third label added with the fix: COMMUNITY_ENTERPRISE now has its own
// ("ชื่อวิสาหกิจชุมชน", L-092) instead of borrowing the person's.
const PAYER_NAME_LABELS = new Set([
  'ชื่อบริษัท / Company Name', 'ชื่อ-นามสกุล / Name', 'ชื่อวิสาหกิจชุมชน / Community Enterprise Name',
]);
function extractPayerPair(html) {
  const pairs = stripHtmlToLblVal(html);
  const nameIdx = pairs.findIndex((p) => PAYER_NAME_LABELS.has(p.label));
  return {
    namePair: nameIdx >= 0 ? pairs[nameIdx] : undefined,
    idPair: nameIdx >= 0 ? pairs[nameIdx + 1] : undefined,
  };
}

// The real Puppeteer PDF is read by a PLAIN node child (test-support/pdf-child.js),
// never by pdf-parse inside this jest worker: pdf-parse v2 sets up its worker with
// a dynamic import() that jest's vm refuses without --experimental-vm-modules, so
// the in-process read was green only with a hand-set NODE_OPTIONS and red under
// the gate's plain `jest --config jest.config.cjs` (9 cells, fix round 1).
const { readPdf } = require('../../test-support/pdf-child');

async function pdfToText(buffer) {
  const text = await readPdf(buffer, 'text');
  // The PDF text layer hands back SARA AM (U+0E33, "ำ") in its compatibility
  // decomposition NIKHAHIT + SARA AA (U+0E4D U+0E32, "ํา") — "จำกัด" extracts
  // as "จํากัด". Recompose it so an exact `includes(displayName)` compares
  // what was printed with what was seeded; nothing else is normalised.
  return text.replace(/\u0E4D\u0E32/g, '\u0E33');
}

let ORG_ID;

// The PDF text layer emits NUL separators; excerpts are written without them so
// git keeps them as text. Assertions read the raw text, unchanged.
function excerpt(text, limit) {
  return text.slice(0, limit).replace(/\u0000/g, '') + '\n';
}

// The route's quotation select, shared by the quotation cells and the view-pack.
const QUOTATION_ROUTE_SELECT = {
  id: true, applicationNumber: true,
  cultivationScopeCount: true, totalAreaTypes: true,
  ...PAYER_APPLICATION_SELECT,
};

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: {
      name: `PAYER-AUDIT-ORG-${RUN_TAG}`,
      slug: `payer-audit-${RUN_TAG}`,
      code: `PAUDIT${RUN_TAG}`.slice(0, 20).toUpperCase(),
      type: 'PRIVATE_CERTIFIER',
    },
  });
  ORG_ID = org.id;

  for (const spec of TYPES) {
    const canonicalId = crypto.randomUUID();
    const user = await prisma.user.create({
      data: {
        canonicalId,
        authType: 'EMAIL_LEGACY',
        email: `payer-audit-${spec.type.toLowerCase()}-${RUN_TAG}@example.invalid`,
        password: 'x-not-a-real-password-hash',
        organizationId: ORG_ID,
        // Login contact phone — deliberately DIFFERENT from applicantData.phone
        // so a render that used this instead of the wizard key would be caught.
        phoneNumber: '0800000000',
        firstName: spec.type === 'INDIVIDUAL' ? spec.applicantData.firstName : undefined,
        lastName: spec.type === 'INDIVIDUAL' ? spec.applicantData.lastName : undefined,
        // Deprecated User-table legacy columns (companyName/taxId/communityName/...)
        // deliberately left NULL — Phase 5b/5c retired them as the source of
        // truth; a real current-day row does not carry them either.
      },
    });

    const entity = await prisma.entity.create({
      data: {
        type: spec.type,
        displayName: spec.displayName,
        organizationId: ORG_ID,
        ...spec.entityIds,
        createdBy: user.id,
      },
    });

    const application = await prisma.application.create({
      data: {
        applicationNumber: `PAUDIT-${spec.type}-${RUN_TAG}`,
        healthId: user.canonicalId,
        entityId: entity.id,
        areaType: 'INDOOR',
        organizationId: ORG_ID,
        cultivationScopeCount: 1,
        totalAreaTypes: 1,
        formData: {
          applicantData: spec.applicantData,
          // NOT setting formData.phone — real DBs hold the phone only at
          // formData.applicantData.phone (mission brief, confirmed by the
          // v2-wizard-real-filing fixture and step2-identity-config.ts).
        },
      },
    });

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-PAUDIT-${spec.type}-${RUN_TAG}`,
        applicationId: application.id,
        healthId: user.canonicalId,
        serviceType: 'PHASE_1_PLATFORM_FEE',
        subtotal: 5500,
        vat: 385,
        totalAmount: 5885,
        dueDate: new Date(),
        status: 'paid',
        paidAt: new Date(),
        receiptNumber: `RCPT-PAUDIT-${spec.type}-${RUN_TAG}`,
        receiptIssuedAt: new Date(),
        organizationId: ORG_ID,
        // billingName intentionally left NULL — no live code path in this
        // repo writes it at invoice-creation time (grep: only vat-report and
        // the CN/DN templates ever READ it). A real row does not carry it.
      },
    });

    const creditNote = await prisma.creditNote.create({
      data: {
        originalInvoiceId: invoice.id,
        creditNoteNumber: `CN-PAUDIT-${spec.type}-${RUN_TAG}`,
        reason: 'ทดสอบตรวจสอบ (audit fixture)',
        reasonCode: 'CORRECTION',
        subtotal: 500, vat: 35, totalAmount: 535,
        status: 'ISSUED',
        issuedAt: new Date(),
        organizationId: ORG_ID,
      },
    });

    const debitNote = await prisma.debitNote.create({
      data: {
        originalInvoiceId: invoice.id,
        debitNoteNumber: `DN-PAUDIT-${spec.type}-${RUN_TAG}`,
        reason: 'ทดสอบตรวจสอบ (audit fixture)',
        reasonCode: 'CORRECTION',
        subtotal: 300, vat: 21, totalAmount: 321,
        status: 'ISSUED',
        issuedAt: new Date(),
        organizationId: ORG_ID,
      },
    });

    const quotation = await prisma.quotation.create({
      data: {
        applicationId: application.id,
        issuerType: 'PLATFORM',
        quotationNumber: `QT-PAUDIT-${spec.type}-${RUN_TAG}`,
        subtotal: 32605, vat: 2705, totalAmount: 35310,
        installments: [
          { phase: 'PHASE_1', amount: 5885, scopeCount: 1 },
          { phase: 'PHASE_2', amount: 29425, scopeCount: 1 },
        ],
        status: 'SENT',
        validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        organizationId: ORG_ID,
      },
    });

    seeded[spec.type] = { spec, org, user, entity, application, invoice, creditNote, debitNote, quotation };
  }
});

afterAll(async () => {
  try {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const lines = [];
  lines.push('# Payer-block matrix — 2026-09-27 (fix/payer-block-by-type)');
  lines.push('');
  lines.push('Real render, scratch Postgres (127.0.0.1:5434), run tag `' + RUN_TAG + '`. IDs masked to last-4.');
  lines.push('');
  lines.push('| doc | type | verdict | actual | expected |');
  lines.push('|---|---|---|---|---|');
  for (const c of CELLS) {
    lines.push(`| ${c.doc} | ${c.type} | ${c.verdict} | ${c.actual.replace(/\|/g, '\\|')} | ${c.expected.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  const pass = CELLS.filter((c) => c.verdict === 'PASS').length;
  const fail = CELLS.filter((c) => c.verdict === 'FAIL').length;
  const blocked = CELLS.filter((c) => c.verdict === 'BLOCKED').length;
  lines.push(`Verdict counts: PASS=${pass} FAIL=${fail} BLOCKED=${blocked} (of ${CELLS.length} cells)`);

  // View-pack in the SAME run, so the images carry this run's tag
  // (test-support/payer-block-render-view-pack.js). Opt-in: it adds ~40 s of
  // Puppeteer renders and rewrites 18 committed PNGs.
  if (process.env.PAYER_BLOCK_VIEW_PACK === '1') {
    // eslint-disable-next-line global-require
    const { renderViewPack } = require('../../test-support/payer-block-render-view-pack');
    const written = await renderViewPack({
      seeded,
      types: TYPES.map((t) => t.type),
      services: { invoiceService, invoiceTemplateService, applicationService, creditNoteService, debitNoteService },
      quotationSelect: QUOTATION_ROUTE_SELECT,
      readPdf,
      outDir: path.join(EVIDENCE_DIR, 'view-pack'),
    });
    lines.push('');
    lines.push(`View-pack: ${written.length} PNGs in view-pack/ rendered in this same run (tag \`${RUN_TAG}\`).`);
  }
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'MATRIX.md'), lines.join('\n') + '\n');

  // The Puppeteer browser the real renders launched keeps the jest process alive
  // after the last test (seen: 18/18 then no exit under a plain `jest` run).
  } finally {
    // Same shutdown pdf-ssrf-interception.test.js uses — in finally, so a
    // throwing view-pack render cannot leave the browser open.
    await require('../../services/pdf/pdf-generator.service').close();
    await prisma.$disconnect();
  }
});

// ── INVOICE + RECEIPT / TAX INVOICE (htmlOnly render path, real select) ─────

describe.each(TYPES.map((t) => t.type))('invoice.html payer block — %s', (type) => {
  test(`invoice — ${type}`, async () => {
    const s = seeded[type];
    const invRow = await invoiceService.getForDocument(s.invoice.id);
    let html;
    try {
      html = await invoiceTemplateService.generateInvoicePdf(invRow, { upload: false, htmlOnly: true });
    } catch (err) {
      recordCell('invoice', type, 'BLOCKED', String(err && err.stack || err), '-');
      throw err;
    }
    const { namePair, idPair } = extractPayerPair(html);
    const actual = `name-label="${namePair?.label}" name="${namePair?.value}" id-label="${idPair?.label}" id="${mask(idPair?.value)}"`;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, `invoice-${type}.txt`), actual + '\n');

    if (type === 'INDIVIDUAL') {
      const expected = 'name-label contains "ชื่อ-นามสกุล"; NO national ID anywhere';
      const noId = !printsNationalId(html) && !html.includes(FAKE_INDIVIDUAL_ID.slice(-4));
      const ok = namePair?.label.includes('ชื่อ-นามสกุล') && noId;
      recordCell('invoice', type, ok ? 'PASS' : 'FAIL', actual, expected);
      expect({ nameLabelOk: namePair?.label.includes('ชื่อ-นามสกุล'), noNationalId: noId }).toEqual({ nameLabelOk: true, noNationalId: true });
    } else if (type === 'JURISTIC') {
      const expected = `name-label "ชื่อบริษัท"; id = Entity.juristicId (${mask(FAKE_JURISTIC_ID)})`;
      const ok = namePair?.label.includes('ชื่อบริษัท') && idPair?.value === FAKE_JURISTIC_ID;
      recordCell('invoice', type, ok ? 'PASS' : 'FAIL', actual, expected);
      expect({ nameLabel: namePair?.label, id: idPair?.value }).toEqual({ nameLabel: 'ชื่อบริษัท / Company Name', id: FAKE_JURISTIC_ID });
    } else {
      const expected = `name-label "ชื่อวิสาหกิจชุมชน"; id = Entity.communityRegNo (${mask(FAKE_COMMUNITY_REGNO)})`;
      const ok = namePair?.label.includes('ชื่อวิสาหกิจชุมชน')
        && namePair?.value === s.spec.displayName && idPair?.value === FAKE_COMMUNITY_REGNO;
      recordCell('invoice', type, ok ? 'PASS' : 'FAIL', actual, expected);
      expect({ nameLabelOk: namePair?.label.includes('ชื่อวิสาหกิจชุมชน'), name: namePair?.value, id: idPair?.value })
        .toEqual({ nameLabelOk: true, name: s.spec.displayName, id: FAKE_COMMUNITY_REGNO });
    }
  });

  // One paper since 2026-09-29: ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป
  // (receipt-tax-invoice.html). Its buyer block follows the tax-invoice rule:
  // the company's tax id, grouped 1-4-5-2-1 in Arabic digits; "-" for a person
  // and for a community enterprise (no tax-id field for one).
  test(`receipt-tax-invoice — ${type}`, async () => {
    const s = seeded[type];
    const invRow = await invoiceService.getForDocument(s.invoice.id);
    let html;
    try {
      html = await invoiceTemplateService.generateReceiptTaxInvoicePdf(invRow, { upload: false, htmlOnly: true });
    } catch (err) {
      recordCell('receipt-tax-invoice', type, 'BLOCKED', String(err && err.stack || err), '-');
      throw err;
    }
    const { namePair, idPair } = extractPayerPair(html);
    const actual = `name-label="${namePair?.label}" name="${namePair?.value}" tax-id="${mask(idPair?.value)}"`;
    fs.writeFileSync(path.join(EVIDENCE_DIR, `receipt-tax-invoice-${type}.txt`), actual + '\n');

    if (type === 'INDIVIDUAL') {
      const expected = 'name-label contains "ชื่อ-นามสกุล"; NO national ID anywhere';
      const noId = !printsNationalId(html);
      const ok = namePair?.label.includes('ชื่อ-นามสกุล') && noId && idPair?.value === '-';
      recordCell('receipt-tax-invoice', type, ok ? 'PASS' : 'FAIL', actual, expected);
      expect({ nameLabelOk: namePair?.label.includes('ชื่อ-นามสกุล'), noNationalId: noId, id: idPair?.value })
        .toEqual({ nameLabelOk: true, noNationalId: true, id: '-' });
    } else if (type === 'JURISTIC') {
      const expected = `tax-id = Entity.juristicId, 1-4-5-2-1 (${FAKE_JURISTIC_ID_GROUPED})`;
      const ok = idPair?.value === FAKE_JURISTIC_ID_GROUPED;
      recordCell('receipt-tax-invoice', type, ok ? 'PASS' : 'FAIL', actual, expected);
      expect({ nameLabel: namePair?.label, id: idPair?.value })
        .toEqual({ nameLabel: 'ชื่อบริษัท / Company Name', id: FAKE_JURISTIC_ID_GROUPED });
    } else {
      const expected = 'tax-id = "-" (community enterprise has no tax-id field on a tax invoice)';
      const ok = idPair?.value === '-';
      recordCell('receipt-tax-invoice', type, ok ? 'PASS' : 'FAIL', actual, expected);
      expect(idPair?.value).toBe('-');
    }
  });
});

// ── CREDIT NOTE + DEBIT NOTE (real PDF via puppeteer, real select) ─────────

describe.each(TYPES.map((t) => t.type))('credit/debit note payer block — %s', (type) => {
  test(`credit-note — ${type}`, async () => {
    const s = seeded[type];
    const actor = { canonicalRole: 'system_admin_dtam' };
    // The read the live PDF route makes (routes/api/finance/credit-notes.js '/:id/pdf').
    const cn = await creditNoteService.findCreditNoteForDocument(s.creditNote.id, { actor });
    let text;
    try {
      const buf = await invoiceTemplateService.generateCreditNotePdf(cn, { upload: false });
      text = await pdfToText(buf);
    } catch (err) {
      recordCell('credit-note', type, 'BLOCKED', String(err && err.stack || err), '-');
      throw err;
    }
    fs.writeFileSync(path.join(EVIDENCE_DIR, `credit-note-${type}.txt`), excerpt(text, 2000));
    const expectedName = type === 'INDIVIDUAL' ? s.spec.applicantData.firstName + ' ' + s.spec.applicantData.lastName
      : s.spec.displayName;
    const nameOk = text.includes(s.spec.displayName) || (type === 'INDIVIDUAL' && text.includes(s.spec.applicantData.firstName));
    let idOk;
    let expectedIdDesc;
    if (type === 'INDIVIDUAL') {
      expectedIdDesc = 'NO national ID anywhere';
      idOk = !printsNationalId(text);
    } else if (type === 'JURISTIC') {
      expectedIdDesc = `Entity.juristicId in Thai digits, 1-4-5-2-1 (${FAKE_JURISTIC_ID_TH})`;
      idOk = text.includes(FAKE_JURISTIC_ID_TH);
    } else {
      expectedIdDesc = `Entity.communityRegNo in Thai digits (${FAKE_COMMUNITY_REGNO_TH})`;
      idOk = text.includes(FAKE_COMMUNITY_REGNO_TH);
    }
    const actual = `name-printed=${nameOk} id-matches-entity=${idOk}`;
    const ok = nameOk && idOk;
    recordCell('credit-note', type, ok ? 'PASS' : 'FAIL', actual, `name=${expectedName}; id=${expectedIdDesc}`);
    expect({ nameOk, idOk }).toEqual({ nameOk: true, idOk: true });
  });

  test(`debit-note — ${type}`, async () => {
    const s = seeded[type];
    const actor = { canonicalRole: 'system_admin_dtam' };
    // The read the live PDF route makes (routes/api/finance/debit-notes.js '/:id/pdf').
    const dn = await debitNoteService.findDebitNoteForDocument(s.debitNote.id, { actor });
    let text;
    try {
      const buf = await invoiceTemplateService.generateDebitNotePdf(dn, { upload: false });
      text = await pdfToText(buf);
    } catch (err) {
      recordCell('debit-note', type, 'BLOCKED', String(err && err.stack || err), '-');
      throw err;
    }
    fs.writeFileSync(path.join(EVIDENCE_DIR, `debit-note-${type}.txt`), excerpt(text, 2000));
    const nameOk = text.includes(s.spec.displayName) || (type === 'INDIVIDUAL' && text.includes(s.spec.applicantData.firstName));
    let idOk;
    let expectedIdDesc;
    if (type === 'INDIVIDUAL') {
      expectedIdDesc = 'NO national ID anywhere';
      idOk = !printsNationalId(text);
    } else if (type === 'JURISTIC') {
      expectedIdDesc = `Entity.juristicId in Thai digits, 1-4-5-2-1 (${FAKE_JURISTIC_ID_TH})`;
      idOk = text.includes(FAKE_JURISTIC_ID_TH);
    } else {
      expectedIdDesc = `Entity.communityRegNo in Thai digits (${FAKE_COMMUNITY_REGNO_TH})`;
      idOk = text.includes(FAKE_COMMUNITY_REGNO_TH);
    }
    const actual = `name-printed=${nameOk} id-matches-entity=${idOk}`;
    const ok = nameOk && idOk;
    recordCell('debit-note', type, ok ? 'PASS' : 'FAIL', actual, `name=Entity.displayName; id=${expectedIdDesc}`);
    expect({ nameOk, idOk }).toEqual({ nameOk: true, idOk: true });
  });
});

// ── QUOTATION (real PDF via puppeteer, real route-shaped select) ───────────

describe.each(TYPES.map((t) => t.type))('quotation.html payer block — %s', (type) => {
  test(`quotation — ${type}`, async () => {
    const s = seeded[type];
    // The select the live route uses (routes/api/applications/quotations.js
    // ':issuerType/pdf'): its four scalar columns plus the resolver's own
    // PAYER_APPLICATION_SELECT (formData + entity, never thaiCitizenId). Pre-fix
    // the route had no `entity` at all — that select gap was L-085.
    const applicationSlice = await applicationService.getApplicationSlice(s.application.id, {
      select: QUOTATION_ROUTE_SELECT,
    });
    let buf;
    try {
      buf = await invoiceTemplateService.generateQuotationPdf(
        { application: applicationSlice, issuerSide: 'PLATFORM', phase: 1, quotationRow: s.quotation },
        { quotationNumber: s.quotation.quotationNumber, upload: false },
      );
    } catch (err) {
      recordCell('quotation', type, 'BLOCKED', String(err && err.stack || err), '-');
      throw err;
    }
    const text = await pdfToText(buf);
    fs.writeFileSync(path.join(EVIDENCE_DIR, `quotation-${type}.txt`), excerpt(text, 2500));

    // The ISSUER is a company and must be named on its own quotation (header,
    // signatory, rate authority). "บริษัท" is a defect only when it is said of
    // the CUSTOMER (L-087), so every occurrence inside the issuer's own legal
    // name is removed first; any "บริษัท" left over was said of the customer.
    // Whitespace is dropped and both sides NFKC-normalised because the PDF text
    // layer wraps lines and decomposes "ำ" into "ํา".
    const squash = (v) => String(v).normalize('NFKC').replace(/\s+/g, '');
    const issuerName = squash(String(PLATFORM_ISSUER.legalNameTH).replace(/\s*\([^)]*\)\s*$/, ''));
    const printsCompanyWord = squash(text).split(issuerName).join('').includes('บริษัท');
    const printsWizardPhone = text.includes(s.spec.applicantData.phone);
    let idOk; let idDesc; let nameOk;
    if (type === 'INDIVIDUAL') {
      idDesc = 'NO national ID anywhere';
      idOk = !printsNationalId(text);
      nameOk = text.includes(s.spec.applicantData.firstName);
    } else if (type === 'JURISTIC') {
      idDesc = `Entity.juristicId (${mask(FAKE_JURISTIC_ID)})`;
      idOk = text.includes(FAKE_JURISTIC_ID);
      nameOk = text.includes(s.spec.displayName);
    } else {
      idDesc = `Entity.communityRegNo (${mask(FAKE_COMMUNITY_REGNO)})`;
      idOk = text.includes(FAKE_COMMUNITY_REGNO);
      nameOk = text.includes(s.spec.displayName);
    }
    const bariBusinessWordOk = type === 'JURISTIC' ? true : !printsCompanyWord;
    const actual = `name-ok=${nameOk} id-ok=${idOk} prints-"บริษัท"=${printsCompanyWord} `
      + `prints-wizard-phone(${s.spec.applicantData.phone.slice(-4)})=${printsWizardPhone}`;
    const expected = `name=Entity.displayName; id=${idDesc}; "บริษัท" only for JURISTIC; phone=applicantData.phone`;
    const ok = nameOk && idOk && bariBusinessWordOk && printsWizardPhone;
    recordCell('quotation', type, ok ? 'PASS' : 'FAIL', actual, expected);
    expect({ nameOk, idOk, bariBusinessWordOk, printsWizardPhone }).toEqual({
      nameOk: true, idOk: true, bariBusinessWordOk: true, printsWizardPhone: true,
    });
  });
});
