'use strict';
/**
 * F-G4-64 — the quotation gate's error vocabulary is catalogued, and the two
 * pre-existing rows say the truth.
 *
 * Adversarial review of the research (synthesis.md §5(ก).4) found
 * QUOTATION_NOT_ACCEPTED wrong in three places at once: httpStatus 400 while
 * the route answers 409, messages that mention slip upload only, and a `source`
 * pointing at a line the function moved off long ago.
 */
const fs = require('fs');
const path = require('path');

const { ERROR_CODES } = require('../../shared/error-codes');
const { GATE_CODES } = require('../../services/billing/quotation-gate');

const EXPECTED_STATUS = {
    QUOTATION_NOT_ISSUED: 409,
    QUOTATION_NOT_ACCEPTED: 409,
    QUOTATION_EXPIRED: 409,
    QUOTATION_GATE_UNAVAILABLE: 503,
    CHECKOUT_PRICE_DRIFT: 409,
    PAYMENT_TERMS_NOT_ACCEPTED: 409,
    QUOTATION_ISSUE_FAILED: 500,
    // Fix round 1 (reviewer F4): a renewal quotation prices PHASE_2 only, so
    // ?phase=1 used to emit a numbered money document totalling 0.00 THB. The
    // refusal has to be a named row like every other one on this path.
    QUOTATION_PHASE_NOT_PRICED: 409,
    // Fix round 2 (reviewer, minor 2): the payment rail needs its OWN row. The
    // one above is the renderer's and says "ระบบจึงไม่ออกเอกสาร".
    CHECKOUT_PHASE_NOT_PRICED: 409,
    // Fix round 4 (R2). A row the applicant is asking to accept that cannot be
    // frozen is a REFUSAL of that request, not a server fault: the accept route
    // reads its status from this row, and a 500 tells the applicant (and every
    // log dashboard) that the system broke when in fact the document did.
    SNAPSHOT_REQUIRED: 409,
};

describe('quotation gate error codes', () => {
    it.each(Object.entries(EXPECTED_STATUS))('%s is catalogued with status %i', (code, status) => {
        const row = ERROR_CODES[code];
        expect(row).toBeDefined();
        expect(row.httpStatus).toBe(status);
        expect(row.messageTh.length).toBeGreaterThan(0);
        expect(row.messageEn.length).toBeGreaterThan(0);
        expect(row.source).toMatch(/^[^:]+:\d+$/);
    });

    it('the four gate codes point at the shared gate module, not at one rail', () => {
        for (const code of ['QUOTATION_NOT_ISSUED', 'QUOTATION_NOT_ACCEPTED',
            'QUOTATION_EXPIRED', 'QUOTATION_GATE_UNAVAILABLE']) {
            expect(ERROR_CODES[code].source).toMatch(/^services\/billing\/quotation-gate\.js:\d+$/);
        }
    });

    // Fix round 1 (reviewer, minor): all four `source` values pointed at lines
    // that do not raise them now that the gate file exists — one of them at a
    // line inside a JSDoc block. The shape assertion above could not see it.
    // A catalogue that is the declared record of what a module says to an
    // applicant has to survive the module being edited, so the check reads the
    // file instead of trusting the number.
    it('every gate code`s source line is the line that actually raises it', () => {
        const gatePath = path.join(__dirname, '..', '..', 'services', 'billing', 'quotation-gate.js');
        const lines = fs.readFileSync(gatePath, 'utf8').split(/\r?\n/);

        for (const [key, code] of Object.entries(GATE_CODES)) {
            const [file, lineNo] = ERROR_CODES[code].source.split(':');
            expect(file).toBe('services/billing/quotation-gate.js');
            const line = lines[Number(lineNo) - 1] || '';
            expect(`${code} @ ${lineNo}: ${line.trim()}`)
                .toContain(`gateError(GATE_CODES.${key})`);
        }
    });

    // Fix round 1 (reviewer, minor 5): the two rows BOTH rails now raise still
    // pointed at doors that do not exist - PAYMENT_TERMS_NOT_ACCEPTED at the
    // slip service line that only delegates now, with a remediation naming a
    // request body coordinator ruling 2 deleted, and CHECKOUT_PRICE_DRIFT at a
    // line 129 above its throw. An operator debugging a refused checkout is
    // sent looking for code that is not there.
    it('the two shared refusals name the line that actually raises them', () => {
        const readLine = (rel, lineNo) => {
            const abs = path.join(__dirname, '..', '..', ...rel.split('/'));
            return (fs.readFileSync(abs, 'utf8').split(/\r?\n/)[lineNo - 1] || '').trim();
        };

        const [termsFile, termsLine] = ERROR_CODES.PAYMENT_TERMS_NOT_ACCEPTED.source.split(':');
        expect(termsFile).toBe('services/billing/payment-terms-gate.js');
        expect(`${termsLine}: ${readLine(termsFile, Number(termsLine))}`)
            .toContain('throw termsError()');

        const [driftFile, driftLine] = ERROR_CODES.CHECKOUT_PRICE_DRIFT.source.split(':');
        expect(driftFile).toBe('services/checkout/stripe-checkout-service.js');
        expect(`${driftLine}: ${readLine(driftFile, Number(driftLine))}`)
            .toContain("catalogError('CHECKOUT_PRICE_DRIFT')");
    });

    // Fix round 2 (reviewer, minor 2). The renderer's row was being raised to
    // refuse a PAYMENT: the applicant was told the system did not issue a
    // DOCUMENT and sent to open a different instalment's document, which is the
    // wrong cause and a next action that cannot lead to paying. Two doors, two
    // rows, and both `source` values now read by this test so neither can rot.
    it('the two not-priced refusals are separate rows pointing at their own door', () => {
        const readLine = (rel, lineNo) => {
            const abs = path.join(__dirname, '..', '..', ...rel.split('/'));
            return (fs.readFileSync(abs, 'utf8').split(/\r?\n/)[lineNo - 1] || '').trim();
        };

        const [pdfFile, pdfLine] = ERROR_CODES.QUOTATION_PHASE_NOT_PRICED.source.split(':');
        expect(pdfFile).toBe('services/pdf/invoice-template-service.js');
        expect(`${pdfLine}: ${readLine(pdfFile, Number(pdfLine))}`)
            .toContain("quotationDocumentError('QUOTATION_PHASE_NOT_PRICED')");

        const [payFile, payLine] = ERROR_CODES.CHECKOUT_PHASE_NOT_PRICED.source.split(':');
        expect(payFile).toBe('services/checkout/stripe-checkout-service.js');
        expect(`${payLine}: ${readLine(payFile, Number(payLine))}`)
            .toContain("catalogError('CHECKOUT_PHASE_NOT_PRICED')");
    });

    /**
     * Fix round 4 (R2). Both not-priced rows told the applicant to "ติดต่อ
     * เจ้าหน้าที่เพื่อออกใบเสนอราคาใหม่". There is no quotation route under
     * routes/api/admin, routes/api/provider or routes/api/platform-admin and no
     * staff screen for one, so the sentence named a function nobody can
     * perform. The two rows keep their own doors (the source assertions above)
     * but say the same true thing: which งวด was asked for is wrong, choose the
     * right one, and if it persists the staff need the quotation number to look
     * at anything at all.
     */
    it('neither not-priced copy sends the applicant to a staff door that does not exist', () => {
        const EXPECTED = 'งวดนี้ไม่อยู่ในใบเสนอราคาของคำขอ กรุณาเลือกงวดที่ถูกต้อง '
            + 'หากยังพบข้อความนี้ กรุณาติดต่อเจ้าหน้าที่พร้อมแจ้งเลขที่ใบเสนอราคา';
        for (const code of ['QUOTATION_PHASE_NOT_PRICED', 'CHECKOUT_PHASE_NOT_PRICED']) {
            expect(`${code}: ${ERROR_CODES[code].messageTh}`).toBe(`${code}: ${EXPECTED}`);
            expect(ERROR_CODES[code].messageEn.length).toBeGreaterThan(0);
        }
    });

    it('no applicant-facing row on this path promises a staff re-issue', () => {
        // "ติดต่อเจ้าหน้าที่เพื่อออกใบ…ใหม่" is the sentence with no door behind
        // it. Asking staff to LOOK at something is fine; asking them to issue a
        // document the product gives them no way to issue is not.
        for (const code of Object.keys(EXPECTED_STATUS)) {
            expect(`${code}: ${/เจ้าหน้าที่เพื่อออกใบ/.test(ERROR_CODES[code].messageTh)}`)
                .toBe(`${code}: false`);
        }
    });

    /**
     * Fix round 1 of the final round (reviewer MAJOR).
     *
     * The copy said "กดรีเฟรชอีกครั้ง หากยังไม่ปรากฏให้ติดต่อเจ้าหน้าที่", and the
     * remediation asserted the GET re-issues idempotently "which is what makes
     * the refresh in the Thai copy true". R3 removed the M2-payable states from
     * SELF_HEAL_STATUSES and routes exactly those applications to this refusal,
     * so for them a refresh can never produce a quotation: the applicant was
     * sent round a loop that cannot terminate, and then to a staff door that
     * R3 itself declares does not exist (F-G4-71). The row now states the cause
     * and asks for the one thing that lets staff look at anything, the
     * application number.
     */
    it('the not-issued copy stops promising a refresh the window cannot honour', () => {
        const row = ERROR_CODES.QUOTATION_NOT_ISSUED;
        expect(row.messageTh).toBe(
            'ระบบยังไม่ออกใบเสนอราคาของคำขอนี้ จึงยังชำระเงินไม่ได้ '
            + 'กรุณาติดต่อเจ้าหน้าที่พร้อมแจ้งเลขที่คำขอ',
        );
        expect(row.messageTh).not.toContain('รีเฟรช');
        // The remediation is where an operator reads WHEN the read re-issues.
        expect(row.remediation).toMatch(/SELF_HEAL_STATUSES/);
        expect(row.remediation).toMatch(/F-G4-71/);
    });

    /**
     * The sweep half of the same finding, renamed to claim exactly what it
     * checks (final round, last items). The old name — "only the row whose
     * replacement the system performs promises a new document" — asserted that
     * the replacement IS performed for the row that mentions one. The read
     * refuses to replace three shapes it can meet (services/
     * quotation-issuance-on-submit.js): a pre-W14 DTAM+PLATFORM pair
     * (_lapsedOfferToReplace returns null on live.length !== 1), an M2-payable
     * application whose lapsed row prices both instalments or records none, and
     * a row whose งวดที่ 2 is already invoiced (mayReplaceLapsedQuotation). What
     * this loop really checks is narrower and still worth pinning: ONE row may
     * mention a new document at all, and it mentions it as a condition.
     */
    it('only QUOTATION_EXPIRED mentions a new document, and it mentions it as a condition', () => {
        const MENTIONS_A_NEW_DOCUMENT = /รีเฟรช|โหลดใหม่|ออกใบใหม่|ออกใบเสนอราคาใหม่/;
        const ROWS_ALLOWED_TO_MENTION_ONE = ['QUOTATION_EXPIRED'];

        for (const code of Object.keys(EXPECTED_STATUS)) {
            expect(`${code}: ${MENTIONS_A_NEW_DOCUMENT.test(ERROR_CODES[code].messageTh)}`)
                .toBe(`${code}: ${ROWS_ALLOWED_TO_MENTION_ONE.includes(code)}`);
        }
        // The mention is conditional, not a promise: 'หากระบบไม่ออกใบใหม่ให้'.
        expect(ERROR_CODES.QUOTATION_EXPIRED.messageTh).toContain('หากระบบไม่ออกใบใหม่ให้');
    });

    it('the snapshot refusal names the cause and an action staff can actually take', () => {
        const row = ERROR_CODES.SNAPSHOT_REQUIRED;
        expect(row.messageTh).toBe(
            'ระบบบันทึกการยอมรับใบเสนอราคาไม่ได้เพราะใบนี้ไม่มีตัวเลขครบ '
            + 'กรุณาติดต่อเจ้าหน้าที่พร้อมแจ้งเลขที่ใบเสนอราคา',
        );
        // The old copy asked for a retry that can never succeed on this row.
        expect(row.messageTh).not.toContain('ลองใหม่อีกครั้ง');
    });

    /**
     * Fix round 4 (R1/R2) put the remedy in the copy: "ระบบจะออกใบใหม่ให้เมื่อคุณ
     * กลับไปที่หน้ารายการชำระเงิน". The last items of the round take the promise
     * back out, because the read refuses the replacement for three shapes that
     * reach this refusal (services/quotation-issuance-on-submit.js): a pre-W14
     * DTAM+PLATFORM pair, an M2-payable application whose lapsed row prices both
     * instalments (or records none), and a row whose งวดที่ 2 is already
     * invoiced. For those the applicant would have refreshed for ever: no new
     * document, no accept button, and no staff issuance door (ledger F-G4-71).
     * The row now names the door that MAY replace it and what to do when it
     * does not, and the remediation is where the three shapes are written down.
     */
    it('the expiry copy names the door that may replace the row, and what to do when it does not', () => {
        const row = ERROR_CODES.QUOTATION_EXPIRED;
        expect(row.messageTh).toBe(
            'ใบเสนอราคาเกินกำหนดยืนราคาแล้ว กรุณากลับไปที่หน้ารายการชำระเงิน '
            + 'หากระบบไม่ออกใบใหม่ให้ กรุณาติดต่อเจ้าหน้าที่พร้อมแจ้งเลขที่ใบเสนอราคา',
        );
        expect(row.messageTh).not.toContain('ท่าน');
        // The unconditional promise is gone from the sentence itself.
        expect(row.messageTh).not.toContain('ระบบจะออกใบใหม่ให้');
        // The three shapes the replacement window refuses, and the ledger row
        // for the door that would rescue them.
        expect(row.remediation).toMatch(/pair/i);
        expect(row.remediation).toMatch(/both instalments/i);
        expect(row.remediation).toMatch(/phase2InvoicedAt/);
        expect(row.remediation).toMatch(/F-G4-71/);
    });

    // Fix round 2 (reviewer, minor 4). A drifted PENDING_PAYMENT order refuses
    // forever AND blocks minting a corrected one, so a remediation that names
    // only "re-issue the quotation" leaves the applicant unable to pay. The
    // catalogue is where an operator looks; it has to name the step that
    // actually clears the block.
    it('the price-drift remediation names the step that unblocks the applicant', () => {
        const { remediation } = ERROR_CODES.CHECKOUT_PRICE_DRIFT;
        expect(remediation).toMatch(/checkout_orders/);
        expect(remediation).toMatch(/CANCELLED/);
        expect(remediation).toMatch(/re-issue/i);
    });

    it('the payment-terms remediation no longer names the request body ruling 2 deleted', () => {
        const { remediation } = ERROR_CODES.PAYMENT_TERMS_NOT_ACCEPTED;
        expect(remediation).not.toMatch(/paymentTermsAccepted/);
        expect(remediation).toMatch(/ConsentVersions\.PAYMENT_TERMS/);
    });

    it('the two rail-specific messages no longer name only the slip', () => {
        // Both rails now enforce both gates, so copy that says "อัปโหลดสลิป"
        // tells a card-rail applicant to do something that does not exist.
        expect(ERROR_CODES.QUOTATION_NOT_ACCEPTED.messageTh).not.toMatch(/สลิป/);
        expect(ERROR_CODES.PAYMENT_TERMS_NOT_ACCEPTED.messageTh).not.toMatch(/สลิป/);
    });

    it('no Thai message uses an em dash (thai-ui-copy rule)', () => {
        for (const code of Object.keys(EXPECTED_STATUS)) {
            expect(ERROR_CODES[code].messageTh).not.toContain('—');
        }
    });

    // Fix round 3 (reviewer r1 on T6, finding 3; reviewer r2 on T5, major 1).
    // "เจ้าหน้าที่ได้รับแจ้งแล้ว" is a promise about a notification, not a
    // figure of speech. Only rows whose path actually raises one may carry it:
    // CHECKOUT_PRICE_DRIFT (notifyAdminCheckoutPriceDrift, awaited by
    // stripe-checkout-service before the throw) and QUOTATION_ISSUE_FAILED
    // (notifyAdminQuotationIssueFailed, from quotation-issuance-on-submit).
    // UNKNOWN_MILESTONE's only records are a logger.error line and a
    // QUOTATION_CLOSE_FAILED audit row, and an audit row is a record, not an
    // alert - no createNotification is raised anywhere on that path.
    it('only the rows that actually alert staff say staff were alerted', () => {
        const CODES_THAT_ALERT = ['CHECKOUT_PRICE_DRIFT', 'QUOTATION_ISSUE_FAILED'];
        const F_G4_64_ROWS = [...Object.keys(EXPECTED_STATUS), 'UNKNOWN_MILESTONE'];

        for (const code of F_G4_64_ROWS) {
            expect(`${code}: ${ERROR_CODES[code].messageTh.includes('ได้รับแจ้งแล้ว')}`)
                .toBe(`${code}: ${CODES_THAT_ALERT.includes(code)}`);
        }
    });

    it('the close-failure copy still tells the applicant their money and receipt stand', () => {
        const row = ERROR_CODES.UNKNOWN_MILESTONE;
        expect(row.messageTh).toContain('การชำระเงินและใบเสร็จของคุณยังคงอยู่ครบ');
        expect(row.messageTh).not.toContain('—');
    });
});
