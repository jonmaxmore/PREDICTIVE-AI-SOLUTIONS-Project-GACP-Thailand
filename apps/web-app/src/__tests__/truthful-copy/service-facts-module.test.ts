/**
 * constants/service-facts.ts is the one place web copy takes its statements
 * about certificate validity, the payee, the payment rail, the refund rule and
 * what the platform is (operator decision 6, 2026-09-17). This file pins the
 * module to the records it names; the pages that read it are pinned by the
 * sibling suites.
 */

import { describe, expect, it } from '@jest/globals';

import * as facts from '@/constants/service-facts';

import {
    backendCertificateValidityYears,
    backendCheckoutPaymentMethods,
    backendRenewalReminderDays,
    paymentTermsDocument,
} from './backend-record';

const COPY = Object.entries(facts).filter(
    (entry): entry is [string, string | ReadonlyArray<string>] =>
        typeof entry[1] === 'string' || (Array.isArray(entry[1]) && entry[1].every((v) => typeof v === 'string')),
);

function allCopy(): string[] {
    return COPY.flatMap(([, v]) => (typeof v === 'string' ? [v] : [...v]));
}

describe('service facts', () => {
    it('certificate validity and reminder days are the backend values', () => {
        expect(facts.GACP_CERTIFICATE_VALIDITY_YEARS).toBe(backendCertificateValidityYears());
        expect([...facts.GACP_RENEWAL_REMINDER_DAYS]).toEqual(backendRenewalReminderDays());
        expect(facts.CERTIFICATE_VALIDITY_TH).toContain(`${facts.GACP_CERTIFICATE_VALIDITY_YEARS} ปี`);
    });

    it('the channel sentence names what the checkout offers and refuses what it does not', () => {
        // A name per method, not a second list of what is offered: the offered
        // list is the backend's CHECKOUT_PAYMENT_METHOD_TYPES.
        const METHOD_NAME_TH: Record<string, string> = { promptpay: 'พร้อมเพย์', card: 'บัตร' };
        const methods = backendCheckoutPaymentMethods();
        expect(methods.length).toBeGreaterThan(0);
        for (const m of methods) {
            expect(Object.keys(METHOD_NAME_TH)).toContain(m);
            expect(facts.PAYMENT_CHANNEL_TH).toContain(METHOD_NAME_TH[m]);
        }
        for (const [m, name] of Object.entries(METHOD_NAME_TH)) {
            if (!methods.includes(m)) expect(facts.PAYMENT_CHANNEL_TH).toContain(`ไม่รับ${name}`);
        }
        // Operator ruling 2026-09-27: the payment provider is not named in any user-facing text.
        expect(facts.PAYMENT_CHANNEL_TH).not.toMatch(/stripe/i);
        expect(facts.PAYMENT_CHANNEL_TH).toContain('ผู้ให้บริการรับชำระเงิน');
        for (const [name, value] of Object.entries(facts)) {
            if (typeof value === 'string') expect(`${name}: ${/stripe/i.test(value)}`).toBe(`${name}: false`);
        }
        expect(facts.PAYMENT_CHANNEL_TH).toContain('ไม่รับโอน');
    });

    it('the payee is the one issuer of payment-terms v1.2 §1', () => {
        expect(paymentTermsDocument()).toContain('ผู้ให้บริการและผู้รับชำระเงินตามเงื่อนไขนี้มีเพียงรายเดียว');
        expect(facts.PAYEE_TH).toBe('บริษัทผู้ให้บริการแพลตฟอร์ม');
        expect(facts.PAYEE_STATEMENT_TH).toContain(facts.PAYEE_TH);
    });

    it('every refund line is a rule payment-terms v1.2 states (§7, §10, §11)', () => {
        const doc = paymentTermsDocument().replace(/\*\*/g, '').replace(/\n(?=[^\s#|>-])/g, '');
        expect(doc).toContain('ไม่สามารถขอคืนได้ แม้ผลจะไม่ผ่าน หรือคำขอถูกยกเลิกเพราะพ้นกำหนดแก้ไข');
        expect(facts.REFUND_POLICY_TH[0]).toContain('ไม่สามารถขอคืนได้ แม้ผลจะไม่ผ่านหรือคำขอถูกยกเลิกเพราะพ้นกำหนดแก้ไข');
        expect(doc).toContain('ระบบเรียกเก็บเงินซ้ำหรือเกินเพราะความผิดพลาดทางเทคนิค บริษัทคืนเงินส่วนที่เก็บซ้ำหรือเกิน');
        expect(facts.REFUND_POLICY_TH.some((l) => l.includes('ส่วนที่เก็บเกิน'))).toBe(true);
        expect(doc).toContain('คืนเงินยอดที่ชำระซ้ำให้ท่านเต็มจำนวน');
        expect(facts.REFUND_POLICY_TH.some((l) => l.includes('เต็มจำนวน'))).toBe(true);
        expect(doc).toContain('บริษัทหรือหน่วยงานของรัฐเป็นฝ่ายยกเลิกการให้บริการเอง');
        expect(facts.REFUND_POLICY_TH.some((l) => l.includes('บริษัทหรือหน่วยงานของรัฐเป็นฝ่ายยกเลิกการให้บริการเอง'))).toBe(true);
        // §7.2 (ง), new in v1.2: cancelling before that instalment's review starts refunds it.
        expect(doc).toContain('ขอยกเลิกคำขอก่อนเริ่มดำเนินการตรวจของงวดที่ชำระแล้ว บริษัทคืนค่าบริการของงวดนั้น');
        expect(facts.REFUND_POLICY_TH.some((l) => l.includes('ขอยกเลิกคำขอก่อนเริ่มดำเนินการตรวจของงวดที่ชำระแล้ว บริษัทคืนค่าบริการของงวดนั้น'))).toBe(true);
        // §7.3 timetable (operator 2026-10-03): 15 working days from approval + complete account details.
        expect(facts.REFUND_POLICY_TH.some((l) => l.includes('ภายใน 15 วันทำการ นับจากวันที่อนุมัติการคืนเงินและได้รับข้อมูลบัญชีครบถ้วน'))).toBe(true);
        expect(facts.REFUND_POLICY_TH).toHaveLength(6);
        // §7.3 + §11.1: a refund case starts with the company, by the support address.
        expect(doc).toContain('ท่านเริ่มเรื่องขอคืนเงินได้ที่ช่องทางตามข้อ 11');
        expect(doc).toContain('support@gacpth.com');
        expect(facts.REFUND_REQUEST_TH).toContain('support@gacpth.com');
        expect(facts.REFUND_REQUEST_TH).not.toContain('เจ้าหน้าที่ผู้ตรวจที่รับผิดชอบคำขอ');
    });

    it('makes no claim the records do not support', () => {
        const text = allCopy().join('\n');
        expect(text).not.toContain('17065');
        expect(text).not.toContain('เว็บไซต์ของรัฐบาล');
        expect(text).not.toContain('รับรองโดย');
        // CAR_REVISION_DEADLINE_TH (one-fee residue sweep 2026-09-26) is the one
        // "วันทำการ" claim this module backs — PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS
        // (frontend-service-facts-mirror.test.js). Every OTHER "วันทำการ" mention is
        // still an unsupported timetable claim.
        expect(facts.CAR_REVISION_DEADLINE_TH).toMatch(/วันทำการ/);
        const withoutCarDeadline = text.split(facts.CAR_REVISION_DEADLINE_TH).join('');
        expect(withoutCarDeadline).not.toMatch(/วันทำการ/);
    });

    it('speaks of one ค่าบริการ: no state fee inside the price, no remittance by the company (operator 2026-09-11)', () => {
        // The first port of this module (2026-09-17) said the price held the
        // department's fee and that the company remitted it. The one-fee ruling
        // retired the split (constants/fees.ts header); what the company pays
        // the department is outside this system (payment-terms v1.2 §2.6).
        const text = allCopy().join('\n');
        expect(text).not.toContain('ค่าธรรมเนียมรัฐ');
        expect(text).not.toContain('ค่าบริการแพลตฟอร์ม');
        expect(text).not.toContain('นำส่ง');
        expect(facts.PAYEE_STATEMENT_TH).toContain('ไม่มียอดใดที่ต้องชำระแยก');
    });

    it('calls the one charge ค่าบริการ (operator 2026-09-11 "จะเป็นค่าบริการทั้งหมด")', () => {
        // "ค่าธรรมเนียม" may appear only inside the accepted document's proper name.
        const DOC_NAME = 'เงื่อนไขการชำระค่าธรรมเนียมและการคืนเงิน';
        for (const line of allCopy()) {
            expect(line.split(DOC_NAME).join('')).not.toContain('ค่าธรรมเนียม');
        }
    });

    it('reads as plain Thai UI copy (thai-ui-copy: no em dash, no ท่าน outside legal text)', () => {
        for (const line of allCopy()) {
            expect(line).not.toContain('—');
            expect(line).not.toContain('ท่าน');
        }
    });
});
