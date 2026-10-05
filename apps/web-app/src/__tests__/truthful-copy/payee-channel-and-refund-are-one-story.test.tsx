/**
 * Who the applicant pays, how, and what is refunded: one story on every page
 * (audit 2026-09-17 UXUI-01, UXUI-X2; operator decision 6).
 *
 * Before this suite the site told four stories at once:
 *   - FAQ: the 5,000 state fee goes to the Comptroller General's account and the
 *     technical fee to the certification body's account; the system makes a
 *     PromptPay QR "ทันที" and also takes Mobile Banking transfers; refunds are
 *     partial after document review, take 15-30 working days, and are filed
 *     with a form (with a bank account number) on the payments page;
 *   - pricing: PromptPay to the DEPARTMENT's tax ID, bank transfer to the
 *     DEPARTMENT's account, an "e-Tax Invoice ตามมาตรฐานสรรพากร" within one
 *     working day, and phase 2 refundable up to 7 working days before the visit;
 *   - Terms of Service: PromptPay and transfer to the COMPANY's bank account,
 *     and the same 7-day phase-2 refund;
 *   - renewal: "contact DTAM to pay", and "transfer to the company's account".
 *
 * The records say one thing:
 *   - payee: W14 (operator 2026-08-22; config/business-rules.js FEES header) and
 *     docs/legal/payment-terms-th-v1.2.md §1 (v1.1 §6 before 4 ตุลาคม 2569). One issuer, the platform
 *     company. Since operator 2026-09-11 the price is one ค่าบริการ plus VAT
 *     (constants/fees.ts): no state fee part, and whatever the company pays the
 *     department is outside this system;
 *   - rail: Stripe only (operator 2026-09-06), PromptPay only (mandate D3,
 *     services/checkout/stripe-checkout-service.js paymentMethodTypes), slips
 *     retired (2026-09-11). There is no bank account to transfer to;
 *   - refunds: payment-terms v1.2 §7 and §10, the text the applicant ticks before
 *     every payment. Its refund timetable (§7.3) is not filled in, and it sets no
 *     deduction and no form; a refund case starts with the company (§7.3, §11).
 */

import type * as React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { beforeAll, describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import PricingPage, { metadata as pricingMetadata } from '@/app/(marketing)/pricing/page';
import TermsOfServicePage from '@/app/(marketing)/terms-of-service/page';
import { FAQ_TOPICS } from '@/components/help/faq-data';
import PaymentInvoiceCard from '@/components/payments/PaymentInvoiceCard';
import type { PublicFees } from '@/lib/pricing/public-fees';
import { ONLINE_PAYMENT_STEP_TH, PAYMENT_CHANNEL_EN, PAYMENT_CHANNEL_TH } from '@/constants/service-facts';
import type { PaymentRecord } from '@/lib/services/payment-service';
import { th } from '@/lib/i18n/dictionaries/th';
import { en } from '@/lib/i18n/dictionaries/en';

import { backendCheckoutPaymentMethods, paymentTermsDocument } from './backend-record';

const PAYEE = 'บริษัทผู้ให้บริการแพลตฟอร์ม';
const NOT_OPEN = 'ยังชำระค่าบริการผ่านระบบไม่ได้';
/** The web's quote of the no-refund rule (v1.1 §2 verbatim; v1.2 §7.1 adds one space, NO_REFUND_V12). */
const NO_REFUND_ONCE_STARTED = 'ไม่สามารถขอคืนได้ แม้ผลจะไม่ผ่านหรือคำขอถูกยกเลิกเพราะพ้นกำหนดแก้ไข';
/** payment-terms v1.2 §7.3 + §11.1: a refund case starts with the company, at its support address. */
const REFUND_DOOR = 'support@gacpth.com';
/** payment-terms v1.2 §7.1 as the document prints it (the web line above drops one space). */
const NO_REFUND_V12 = 'ไม่สามารถขอคืนได้ แม้ผลจะไม่ผ่าน หรือคำขอถูกยกเลิกเพราะพ้นกำหนดแก้ไข';

const SRC = path.join(__dirname, '..', '..');

/**
 * The pricing page and the ToS are server components that read
 * GET /api/pricing/fees (fetchPublicFees). The served table here differs from
 * every figure the web once held as a constant (constants/fees.ts, retired
 * 2026-10-03), so an amount that shows up came from the response.
 */
const SERVED: PublicFees = {
    applicationFee: 6_000,
    inspectionFee: 30_000,
    renewalFee: 40_000,
    renewalTotalPerScope: 42_800,
    phase1TotalPerScope: 6_420,
    phase2TotalPerScope: 32_100,
    vatRate: 0.07,
};

function serveFees() {
    (globalThis as { fetch?: unknown }).fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: SERVED }),
    });
}

async function renderServerPage(Page: () => unknown): Promise<string> {
    serveFees();
    return renderToStaticMarkup((await Page()) as React.ReactElement);
}

function textOf(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\s+/g, ' ');
}

function faq(id: string): { question: string; answer: string } {
    for (const topic of FAQ_TOPICS) {
        const item = topic.items.find((entry) => entry.id === id);
        if (item) return item;
    }
    throw new Error(`FAQ item ${id} not found`);
}

function refundTopicAnswers(): string {
    const topic = FAQ_TOPICS.find((t) => t.id === 'refund');
    if (!topic) throw new Error('FAQ refund topic not found');
    return [faq('pay-refund').answer, ...topic.items.map((i) => i.answer)].join('\n');
}

/** Card is not offered; a mention of it may only be the refusal. */
function withoutCardRefusal(text: string): string {
    return text.replace(/ไม่รับ(ชำระด้วย)?บัตร/g, '');
}

describe('the records this suite reads', () => {
    it('the live rail offers PromptPay only', () => {
        expect(backendCheckoutPaymentMethods()).toEqual(['promptpay']);
    });

    it('payment-terms v1.2 carries the refund rule and the refund door quoted here', () => {
        const doc = paymentTermsDocument().replace(/\*\*/g, '').replace(/\n(?=[^\s#|>-])/g, '');
        expect(doc).toContain(NO_REFUND_V12);
        expect(doc).toContain('คืนเงินยอดที่ชำระซ้ำให้ท่านเต็มจำนวน');
        expect(doc).toContain('ท่านเริ่มเรื่องขอคืนเงินได้ที่ช่องทางตามข้อ 11');
        expect(doc).toContain(`อีเมล ${REFUND_DOOR}`);
        expect(doc).toContain('ผู้ให้บริการและผู้รับชำระเงินตามเงื่อนไขนี้มีเพียงรายเดียว');
    });
});

describe('FAQ', () => {
    it('names the platform company as the one payee, not the Comptroller General or a CB', () => {
        const { question, answer } = faq('pay-state-fee');
        expect(question).not.toContain('จ่ายเข้ากรมบัญชีกลาง');
        expect(answer).not.toContain('นำส่งเข้าบัญชีของกรมบัญชีกลาง');
        expect(answer).not.toContain('บัญชีของหน่วยรับรอง');
        expect(answer).toContain(PAYEE);
        // One ค่าบริการ (operator 2026-09-11): no state fee inside the price and
        // no remittance sentence.
        expect(answer).not.toContain('ค่าธรรมเนียมรัฐ');
        expect(answer).not.toContain('นำส่ง');
    });

    // PromptPay QR step (2026-09-27): the checkout page shows Stripe's QR when
    // the backend holds a publishable key and says it cannot when it does not.
    // A static FAQ cannot know which, so it states the sentence true in both
    // and neither "cannot pay yet" nor "pay now".
    it('describes the one rail and how paying works, true whether or not this environment can take the payment', () => {
        const { answer } = faq('pay-promptpay');
        expect(answer).not.toContain('Mobile Banking');
        expect(answer).not.toContain('ชำระเงินทันที');
        expect(answer).not.toContain('จับคู่กับคำขอโดยอัตโนมัติ');
        expect(answer).not.toMatch(/stripe/i); // operator ruling 2026-09-27: provider not named
        expect(answer).toContain('ผู้ให้บริการรับชำระเงิน');
        expect(answer).toContain('พร้อมเพย์');
        expect(withoutCardRefusal(answer)).not.toContain('บัตร');
        expect(answer).toContain(ONLINE_PAYMENT_STEP_TH);
        expect(answer).not.toContain(NOT_OPEN);
    });

    it('states the refund rule of payment-terms v1.2 and nothing it does not say', () => {
        const answers = refundTopicAnswers();
        // 'วันทำการ' is no longer an invention: v1.2 §7.3 now states 15 working days
        // (operator 2026-10-03), and the answer must carry exactly that timetable.
        expect(answers).toContain('ภายใน 15 วันทำการ นับจากวันที่อนุมัติการคืนเงินและได้รับข้อมูลบัญชีครบถ้วน');
        for (const invented of ['คืนบางส่วน', '15-30', 'หักค่าบริการ', 'เลขบัญชีรับโอน', 'ยื่นคำร้องที่หน้า']) {
            expect(answers).not.toContain(invented);
        }
        expect(faq('refund-conditions').answer).toContain(NO_REFUND_ONCE_STARTED);
        expect(faq('refund-conditions').answer).toContain('เต็มจำนวน');
        expect(faq('refund-process').answer).toContain(REFUND_DOOR);
    });
});

describe('pricing page', () => {
    let html = '';
    let text = '';
    beforeAll(async () => {
        html = await renderServerPage(PricingPage as () => unknown);
        text = textOf(html);
    });

    it('names no department account or tax ID as a place to pay', () => {
        expect(text).not.toContain('เลขประจำตัวผู้เสียภาษีของกรมฯ');
        expect(text).not.toContain('บัญชีกรมการแพทย์แผนไทย');
        expect(text).not.toContain('โอนผ่านธนาคาร');
    });

    it('names the payee and the rail, and how paying works in either state of the rail (PromptPay QR step, 2026-09-27)', () => {
        expect(text).toContain(PAYEE);
        expect(text).not.toMatch(/stripe/i); // operator ruling 2026-09-27: provider not named
        expect(text).toContain('ผู้ให้บริการรับชำระเงิน');
        expect(text).toContain(ONLINE_PAYMENT_STEP_TH);
        expect(text).not.toContain(NOT_OPEN);
        expect(withoutCardRefusal(text)).not.toContain('บัตร');
    });

    it('claims no e-Tax registration and no receipt timetable the code does not keep', () => {
        expect(text).not.toContain('e-Tax');
        expect(text).not.toContain('ภายใน 1 วันทำการ');
    });

    it('does not say the whole price is set by the department', () => {
        expect(text).not.toContain('อัตราค่าธรรมเนียมเป็นไปตามประกาศ');
        expect(pricingMetadata.description).not.toContain('ตามประกาศกรม');
    });

    it('prices one ค่าบริการ plus VAT, with no state fee or platform fee part (operator 2026-09-11)', () => {
        for (const retired of ['ค่าธรรมเนียมรัฐ', 'ค่าแพลตฟอร์ม', 'ค่าบริการแพลตฟอร์ม', 'ราคาเต็ม']) {
            expect(text).not.toContain(retired);
            expect(pricingMetadata.description).not.toContain(retired);
        }
    });

    it('gives the refund rule of payment-terms v1.2, with no 7-day phase-2 refund', () => {
        expect(text).not.toContain('7 วันทำการ');
        expect(text).not.toContain('ขอคืนได้ก่อนกำหนดวันตรวจ');
        expect(text).toContain(NO_REFUND_ONCE_STARTED);
        expect(text).toContain('เต็มจำนวน');
        expect(text).toContain(REFUND_DOOR);
    });

    it('names the company\'s one charge ค่าบริการ, not ค่าธรรมเนียม, in its title/eyebrow/heading (one-fee residue sweep 2026-09-26)', () => {
        // operator 2026-09-11: "จะเป็นค่าบริการทั้งหมด" — one noun for the whole
        // charge. The page body (one served ค่าบริการ, no split) was already right;
        // this pins the title/eyebrow/h1 to the same word. The unrelated
        // "เงื่อนไขการชำระค่าธรรมเนียมและการคืนเงิน" further down names the
        // accepted legal document by ITS OWN title (out of this sweep's scope)
        // and is not touched here.
        expect(pricingMetadata.title).not.toContain('ค่าธรรมเนียม');
        expect(pricingMetadata.title).toContain('ค่าบริการ');
        const div = document.createElement('div');
        div.innerHTML = html;
        const h1 = div.querySelector('h1');
        expect(h1?.textContent).not.toContain('ค่าธรรมเนียม');
        expect(h1?.textContent).toContain('ค่าบริการ');
        expect(h1?.previousElementSibling?.textContent).not.toContain('ค่าธรรมเนียม');
        expect(h1?.previousElementSibling?.textContent).toContain('ค่าบริการ');
    });

    it('discloses the renewal charge, so "ไม่มีค่าใช้จ่ายแอบแฝง" is not hiding a yearly fee', () => {
        // The renewal total equals the two instalments added up (W12), so the
        // figure alone is already on the page; what must exist is the renewal
        // entry that carries it.
        const div = document.createElement('div');
        div.innerHTML = html;
        const renewal = Array.from(div.querySelectorAll('article')).find((a) =>
            (a.querySelector('h2')?.textContent || '').includes('ต่ออายุ'),
        );
        expect(renewal).toBeDefined();
        const renewalText = renewal!.textContent || '';
        expect(renewalText).toContain(SERVED.renewalTotalPerScope.toLocaleString('th-TH'));
        expect(renewalText).toContain('ครั้งเดียว');
    });
});

describe('Terms of Service', () => {
    let text = '';
    beforeAll(async () => {
        text = textOf(await renderServerPage(TermsOfServicePage as () => unknown));
    });

    it('prices one ค่าบริการ plus VAT and names no remittance to the department (operator 2026-09-11)', () => {
        for (const retired of ['ค่าธรรมเนียมรัฐ', 'ค่าแพลตฟอร์ม', 'ราคาเต็ม', 'นำส่งให้กรม']) {
            expect(text).not.toContain(retired);
        }
    });

    it('names the company\'s one charge ค่าบริการ, not ค่าธรรมเนียม, anywhere on the page (one-fee residue sweep 2026-09-26)', () => {
        // operator 2026-09-11: "จะเป็นค่าบริการทั้งหมด". Every "ค่าธรรมเนียม" on
        // this page named the company's own charge (service scope, §3 title, the
        // refund-policy-document reference, and the /pricing link label) — none
        // of it was the accepted legal document's own frozen title, so the whole
        // page is in scope.
        expect(text).not.toContain('ค่าธรรมเนียม');
        expect(text).toContain('ค่าบริการ');
    });

    it('names no bank transfer and no receipt timetable', () => {
        expect(text).not.toContain('การโอนผ่านบัญชีธนาคาร');
        expect(text).not.toContain('ภายใน 1 วันทำการ');
        expect(text).not.toMatch(/stripe/i); // operator ruling 2026-09-27: provider not named
        expect(text).toContain('ผู้ให้บริการรับชำระเงิน');
        expect(text).toContain(PAYEE);
    });

    it('refers refunds to the payment terms the applicant accepts, with their rule', () => {
        expect(text).not.toContain('ขอคืนได้ก่อนกำหนดวันตรวจ');
        // Was "...ค่าธรรมเนียม..." — renamed with the rest of the page's ค่าบริการ
        // sweep (one-fee residue sweep 2026-09-26); the referenced document is
        // v1.2 since 4 ตุลาคม 2569, whose title this is.
        expect(text).toContain('เงื่อนไขการชำระค่าบริการและการคืนเงิน');
        expect(text).toContain(NO_REFUND_ONCE_STARTED);
        expect(text).toContain('เต็มจำนวน');
    });
});

describe('renewal wizard copy', () => {
    const renewalTh = th.health.renewal;
    const renewalEn = en.health.renewal;

    it('does not send the applicant to the department to pay', () => {
        for (const line of [th.renewalAdvisory.title, th.renewalAdvisory.body, renewalTh.paymentPendingMessage]) {
            expect(line).not.toMatch(/ติดต่อ\s*(DTAM|กรม)[\s\S]*ชำระ/);
        }
        for (const line of [en.renewalAdvisory.title, en.renewalAdvisory.body, renewalEn.paymentPendingMessage]) {
            expect(line).not.toMatch(/contact[^.]*DTAM[^.]*(pay|settle)/i);
            expect(line).not.toMatch(/contact the Department[^.]*(pay|settle)/i);
        }
        expect(th.renewalAdvisory.body).toContain(PAYEE);
    });

    it('names no bank transfer as a way to pay', () => {
        // "ไม่รับโอน…" is the refusal, the one mention of a transfer allowed.
        expect(renewalTh.invoice.methodTransfer.replace(/ไม่รับโอน/g, '')).not.toContain('โอน');
        expect(renewalEn.invoice.methodTransfer).not.toMatch(/transfer to/i);
        expect(renewalTh.invoice.methodTransfer).toContain('พร้อมเพย์');
    });

    it('the English channel sentence reads the SAME source as the Thai one, not a hand-written duplicate (one-fee residue sweep 2026-09-26)', () => {
        expect(renewalTh.invoice.methodTransfer).toContain(PAYMENT_CHANNEL_TH);
        expect(renewalEn.invoice.methodTransfer).toContain(PAYMENT_CHANNEL_EN);
    });

    it('does not promise an online payment page the renewal step cannot open', () => {
        for (const line of [renewalTh.payment.subtitle, renewalTh.payment.helpText, renewalTh.payment.cta]) {
            expect(line).not.toContain('ชำระเงินออนไลน์');
        }
        for (const line of [renewalEn.payment.subtitle, renewalEn.payment.helpText, renewalEn.payment.cta]) {
            expect(line).not.toMatch(/online payment|pay online/i);
        }
    });
});

describe('documents and staff screens', () => {
    it('the checkout invoice card names the payee, not an online payment it cannot take', () => {
        const invoice: PaymentRecord = {
            id: 'inv-co-m1-open',
            type: 'INVOICE',
            documentNumber: 'INV-CO-D810DEBF-M1',
            applicationId: 'APP-1',
            amount: 5885,
            status: 'PENDING',
            erpStatus: 'PENDING',
            createdAt: '2026-08-26T03:00:00.000Z',
            serviceType: 'CERTIFICATION_CHECKOUT_M1',
            phase: 'PHASE_1',
            component: 'CHECKOUT',
            isPaid: false,
        };
        const text = textOf(renderToStaticMarkup(<PaymentInvoiceCard invoice={invoice} />));
        expect(text).not.toContain('ออนไลน์');
        expect(text).toContain(PAYEE);
    });

    it('the staff invoice modal shows no retired bank or PromptPay-ID channel', () => {
        const src = fs.readFileSync(path.join(SRC, 'app/provider/accounting/invoice-detail-modal.tsx'), 'utf8');
        expect(src).not.toContain('4750134376');
        expect(src).not.toContain('0994000036540');
        expect(src).not.toContain('ธนาคารกรุงไทย');
    });

    it('the checkout disclosure names the company\'s charge ค่าบริการ, not ค่าธรรมเนียม (one-fee residue sweep 2026-09-26)', () => {
        // These two bullets are hardcoded duplicates of REFUND_POLICY_TH's own
        // "ค่าบริการของขั้นตอนที่เริ่มดำเนินการตรวจแล้ว..." wording (constants/
        // service-facts.ts), not a quote of the v1.1 document's own phrasing.
        const src = fs.readFileSync(
            path.join(SRC, 'app/health/payments/checkout/client-view.tsx'),
            'utf8',
        );
        expect(src).not.toContain('ค่าธรรมเนียมของขั้นตอนที่');
        expect(src).toContain('ค่าบริการของขั้นตอนที่');
        expect(src).not.toContain('ค่าธรรมเนียมถูกล็อกราคา');
        // payment-terms v1.2 §3.4 (2026-10-03) replaced "ล็อกราคา ณ วันยื่นคำขอ"
        // with the accepted quotation binding every instalment.
        expect(src).not.toContain('ล็อกราคา ณ วันยื่นคำขอ');
        expect(src).toContain('PAYMENT_TERMS_PRICE_BINDING_TH');
    });

    it('the quotation preview prints the same channel line as the issued PDF renders', () => {
        const quotation = fs.readFileSync(
            path.join(SRC, 'features/permit-form/components/documents/quotation-document.tsx'),
            'utf8',
        );
        const pdf = fs.readFileSync(
            path.join(SRC, '../../backend/services/pdf/invoice-template-service.js'),
            'utf8',
        );
        const line = 'ชำระผ่านระบบด้วย PromptPay QR ที่หน้าชำระเงินของระบบ';
        // fix/web-quotation-truth (2026-09-28): the preview no longer keeps its
        // own copy of the line — it prints the server's `copy.note`, built by
        // the PDF's own buildPaymentChannelLine (pinned by
        // apps/backend/__tests__/unit/web-quotation-truth.test.js). One source
        // instead of two literals kept equal by this test.
        expect(quotation).not.toContain(line);
        expect(quotation).toContain('copy.note');
        expect(pdf).toContain('function buildPaymentChannelLine()');
        // Fix round 1 (2026-09-26, review Minor-1): the PDF side no longer
        // hardcodes this line as a bare literal — it derives the method name
        // from the same CHECKOUT_PAYMENT_METHOD_TYPES list bankLine already
        // reads, via an English sibling of bankLine's own map, so a method
        // the rail starts/stops offering updates this text on both lines
        // instead of leaving one behind. Runtime parity with the quotation
        // preview's literal (today: the same "PromptPay" text) is pinned by
        // executing buildPaymentInfoHtml() for real on the backend side
        // (invoice-template-single-issuer.test.js), not by a source-text scan.
        expect(pdf).toContain('checkoutMethodLabelEN()');
        expect(pdf).not.toMatch(/<div>ชำระผ่านระบบด้วย PromptPay QR/);
        // The comment above that line said the applicant "pays by card"; the
        // rail offers PromptPay only and the card path is refused (mandate D3).
        expect(quotation).not.toMatch(/pays by card/);
    });
});
