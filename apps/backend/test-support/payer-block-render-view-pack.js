'use strict';

/**
 * Payer-block view-pack generator (fix/payer-block-by-type, fix round 1 M5).
 *
 * Renders all 18 cells (6 finance documents x 3 Entity types) to a REAL PDF
 * through the production renderers and the same reads the live routes make,
 * then page 1 to a small PNG. Called from the matrix test's afterAll, in the
 * SAME run, so the images carry the same run tag as MATRIX.md:
 *
 *   PAYER_BLOCK_VIEW_PACK=1 npx jest __tests__/integration/payer-block-matrix.test.js
 *
 * Page 1 → PNG is done by `readPdf(buffer, 'png', out)` from
 * apps/backend/test-support/pdf-child.js, handed in by the caller: a PLAIN node
 * child runs pdf-parse (it cannot run inside a jest worker without
 * --experimental-vm-modules) and sharp. pdftoppm is not installed on this host.
 */

const fs = require('fs');
const path = require('path');

const DOCS = ['quotation', 'invoice', 'receipt', 'tax-invoice', 'credit-note', 'debit-note'];

/**
 * @param {object} args
 * @param {object} args.seeded     the matrix test's { [type]: {invoice, creditNote, debitNote, application, quotation} }
 * @param {string[]} args.types    Entity types in row order
 * @param {object} args.services   { invoiceService, invoiceTemplateService, applicationService, creditNoteService, debitNoteService }
 * @param {object} args.quotationSelect  the route's application select
 * @param {Function} args.readPdf  test-support/pdf-child.js readPdf
 * @param {string} args.outDir
 * @returns {Promise<string[]>} written file names
 */
async function renderViewPack({ seeded, types, services, quotationSelect, readPdf, outDir }) {
    const {
        invoiceService, invoiceTemplateService, applicationService, creditNoteService, debitNoteService,
    } = services;
    const actor = { canonicalRole: 'system_admin_dtam' };
    fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    for (const type of types) {
        const s = seeded[type];
        const inv = await invoiceService.getForDocument(s.invoice.id);
        const app = await applicationService.getApplicationSlice(s.application.id, { select: quotationSelect });
        const cn = await creditNoteService.findCreditNoteForDocument(s.creditNote.id, { actor });
        const dn = await debitNoteService.findDebitNoteForDocument(s.debitNote.id, { actor });
        const pdfs = {
            quotation: () => invoiceTemplateService.generateQuotationPdf(
                { application: app, issuerSide: 'PLATFORM', phase: 1, quotationRow: s.quotation },
                { quotationNumber: s.quotation.quotationNumber, upload: false },
            ),
            invoice: () => invoiceTemplateService.generateInvoicePdf(inv, { upload: false }),
            receipt: () => invoiceTemplateService.generateReceiptPdf(inv, { upload: false }),
            'tax-invoice': () => invoiceTemplateService.generateTaxInvoicePdf(inv, { upload: false }),
            'credit-note': () => invoiceTemplateService.generateCreditNotePdf(cn, { upload: false }),
            'debit-note': () => invoiceTemplateService.generateDebitNotePdf(dn, { upload: false }),
        };
        for (const doc of DOCS) {
            const name = `${doc}-${type}.png`;
            await readPdf(await pdfs[doc](), 'png', path.join(outDir, name));
            written.push(name);
        }
    }
    return written;
}

module.exports = { renderViewPack, DOCS };
