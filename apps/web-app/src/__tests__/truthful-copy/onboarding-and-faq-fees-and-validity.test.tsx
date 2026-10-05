/**
 * The first-run tour and the help centre say what the backend actually does
 * about fees, certificate validity and renewal (audit 2026-09-17 UXUI-01,
 * operator decision 6: copy shown to users must be true).
 *
 * What was on screen before this suite:
 *   - the onboarding modal called 5,885 "scope เล็ก" and 29,425 "scope ใหญ่".
 *     They are instalment 1 and instalment 2 of ONE cultivation scope
 *     (constants/fees.ts), so a farmer read a 35,310 scope as costing 5,885;
 *   - its title said "ใบรับรองมีอายุ 3 ปี" while the backend issues for
 *     CERTIFICATE.VALIDITY_YEARS (one year, operator 2026-09-11, a22007e4) and
 *     the same modal's badge said "1 ปี";
 *   - its process step put "ชำระงวดที่ 2" after the farm inspection, while the
 *     state machine collects instalment 2 before the audit is confirmed
 *     (services/workflow-transition-service.js: DOC_APPROVED ->
 *     PENDING_AUDIT_FEE -> AUDIT_FEE_PAID -> AUDIT_CONFIRMED);
 *   - its help step said support is available "ได้ตลอดเวลา" and "ในเวลาราชการ"
 *     in the same card. The office-hours line and the contact email stay: they
 *     are what the help centre's contact page states, and email remains
 *     contact information (operator 2026-09-26: email is only out of 2FA and
 *     password reset). The first port of this suite forbade the email line;
 *     that rested on a reading the operator corrected;
 *   - the FAQ described renewal as "update your documents" (W12: a renewal has
 *     no document review) and promised a paid third inspection that no fee
 *     state exists for.
 *
 * Expectations are read from the backend records (./backend-record.ts). Amounts
 * come from a served fee table (GET /api/pricing/fees shape) that differs from
 * every figure the web once held as a constant; constants/fees.ts no longer
 * holds fees (2026-10-03, fees-from-server.test.tsx).
 */

import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    buildOnboardingSteps,
    OnboardingModal,
    type OnboardingStep,
} from '@/components/onboarding/OnboardingModal';
import { buildFaqTopics } from '@/components/help/faq-data';
import type { PublicFees } from '@/lib/pricing/public-fees';
import { FARMER_NAV } from '@/lib/navigation/nav-config';
import { SUPPORT_EMAIL } from '@/constants/contact-emails';

import {
    backendCarRevisionDeadlineBusinessDays,
    backendCertificateValidityYears,
    backendRenewalReminderDays,
    readRepoFile,
} from './backend-record';

const th = (value: number) => value.toLocaleString('th-TH');

/** A served table unlike any figure the web ever held as a constant. */
const SERVED: PublicFees = {
    applicationFee: 6_000,
    inspectionFee: 30_000,
    renewalFee: 40_000,
    renewalTotalPerScope: 42_800,
    phase1TotalPerScope: 6_420,
    phase2TotalPerScope: 32_100,
    vatRate: 0.07,
};
const GACP_PHASE1_TOTAL_SERVED = SERVED.phase1TotalPerScope;
const GACP_PHASE2_TOTAL_SERVED = SERVED.phase2TotalPerScope;
const RENEWAL_PAYABLE_SERVED = SERVED.renewalTotalPerScope;
const DEFAULT_ONBOARDING_STEPS = buildOnboardingSteps({ status: 'ready', fees: SERVED });
const FAQ_TOPICS = buildFaqTopics({ status: 'ready', fees: SERVED });

const VALIDITY_YEARS = backendCertificateValidityYears();
const REMINDER_DAYS = backendRenewalReminderDays();

function stepText(step: OnboardingStep): string {
    return [step.title, step.description, ...(step.bullets ?? [])].join('\n');
}

const ALL_STEPS_TEXT = DEFAULT_ONBOARDING_STEPS.map(stepText).join('\n');

function stepMentioning(needle: string): OnboardingStep {
    const found = DEFAULT_ONBOARDING_STEPS.find((s) => stepText(s).includes(needle));
    if (!found) throw new Error(`no onboarding step mentions ${needle}`);
    return found;
}

function faqAnswer(id: string): string {
    for (const topic of FAQ_TOPICS) {
        const item = topic.items.find((entry) => entry.id === id);
        if (item) return item.answer;
    }
    throw new Error(`FAQ item ${id} not found`);
}

function faqQuestion(id: string): string {
    for (const topic of FAQ_TOPICS) {
        const item = topic.items.find((entry) => entry.id === id);
        if (item) return item.question;
    }
    throw new Error(`FAQ item ${id} not found`);
}

describe('onboarding modal: certificate validity', () => {
    it('the record this suite compares to is readable', () => {
        expect(Number.isInteger(VALIDITY_YEARS)).toBe(true);
        expect(VALIDITY_YEARS).toBeGreaterThan(0);
        expect(REMINDER_DAYS.length).toBeGreaterThan(0);
    });

    it('every "มีอายุ N ปี" in the tour names the validity the backend issues with', () => {
        const years = [...ALL_STEPS_TEXT.matchAll(/มีอายุ\s*(\d+)\s*ปี/g)].map((m) => Number(m[1]));
        expect(years.length).toBeGreaterThan(0);
        for (const n of years) expect(n).toBe(VALIDITY_YEARS);
    });

    it('the badge of the validity step and its title agree', () => {
        const index = DEFAULT_ONBOARDING_STEPS.findIndex((s) => /มีอายุ\s*\d+\s*ปี/.test(s.title));
        expect(index).toBeGreaterThanOrEqual(0);
        const html = renderToStaticMarkup(<OnboardingModal initialStep={index} />);
        expect(html).toContain(`ใบรับรองมีอายุ ${VALIDITY_YEARS} ปี`);
        const badgeYears = [...html.matchAll(/>(\d+) ปี</g)].map((m) => Number(m[1]));
        expect(badgeYears).toEqual([VALIDITY_YEARS]);
    });

    it('names the reminder days the renewal cron actually sends, and no renewal window the backend does not have', () => {
        const step = stepText(stepMentioning('ต่ออายุ'));
        for (const day of REMINDER_DAYS) expect(step).toContain(String(day));
        // renewal-service.createRenewalApplication accepts any ACTIVE,
        // unexpired certificate: there is no "from 90 days before" window, and
        // an expired certificate needs a new application, so the old one does
        // not stay valid "until the new one is issued".
        expect(ALL_STEPS_TEXT).not.toContain('90 วัน');
        expect(ALL_STEPS_TEXT).not.toContain('ใช้งานได้จนกว่าจะออกใบใหม่');
        expect(step).toContain('หมดอายุแล้วต้องยื่นคำขอใหม่');
    });

    it('states the renewal charge that is collected, once', () => {
        const step = stepText(stepMentioning('ต่ออายุ'));
        expect(step).toContain(th(RENEWAL_PAYABLE_SERVED));
        expect(step).toContain('ครั้งเดียว');
    });
});

describe('onboarding modal: fees and who is paid', () => {
    it('does not call the two instalments a small and a large scope', () => {
        expect(ALL_STEPS_TEXT).not.toMatch(/scope\s*เล็ก/);
        expect(ALL_STEPS_TEXT).not.toMatch(/scope\s*ใหญ่/);
    });

    it('names each amount beside its own instalment, per cultivation scope', () => {
        const bullets = stepMentioning(th(GACP_PHASE1_TOTAL_SERVED)).bullets ?? [];
        expect(bullets.some((b) => b.includes('งวดที่ 1') && b.includes(th(GACP_PHASE1_TOTAL_SERVED)))).toBe(true);
        expect(bullets.some((b) => b.includes('งวดที่ 2') && b.includes(th(GACP_PHASE2_TOTAL_SERVED)))).toBe(true);
        expect(stepText(stepMentioning(th(GACP_PHASE1_TOTAL_SERVED)))).toContain('รูปแบบการปลูก');
    });

    it('says who the applicant pays (W14: one issuer, the platform company)', () => {
        expect(stepText(stepMentioning(th(GACP_PHASE1_TOTAL_SERVED)))).toContain('บริษัทผู้ให้บริการแพลตฟอร์ม');
    });

    it('calls the amount one ค่าบริการ plus VAT, with no platform fee inside it (operator 2026-09-11)', () => {
        const step = stepText(stepMentioning(th(GACP_PHASE1_TOTAL_SERVED)));
        expect(step).not.toContain('ค่าบริการแพลตฟอร์ม');
        expect(step).not.toContain('ค่าธรรมเนียมรัฐ');
        expect(step).toContain('VAT 7%');
    });
});

describe('onboarding modal: process, status and help', () => {
    it('puts instalment 2 before the farm inspection, as the state machine does', () => {
        const processStep = stepMentioning('งวดที่ 2');
        const text = stepText(processStep);
        expect(text).not.toContain('ชำระงวดที่ 2 และออกใบรับรอง');
        expect((processStep.bullets ?? []).some((b) => /งวดที่ 2.*ก่อน.*ตรวจประเมิน/.test(b))).toBe(true);
    });

    it('does not say the department drives the system', () => {
        expect(ALL_STEPS_TEXT).not.toContain('ขับเคลื่อนโดยกรม');
    });

    it('does not promise help "ตลอดเวลา", and gives the contact address the contact page lists', () => {
        expect(ALL_STEPS_TEXT).not.toContain('ตลอดเวลา');
        // The help centre's "อีเมลทั่วไป" card and this step read the same constant.
        const contactPage = readRepoFile('apps/web-app/src/app/help/contact/page.tsx');
        expect(contactPage).toMatch(/label: 'อีเมลทั่วไป',[\s\S]*?value: SUPPORT_EMAIL,/);
        const helpStep = stepText(stepMentioning('คำถามที่พบบ่อย'));
        expect(helpStep).toContain(SUPPORT_EMAIL);
        // "ในเวลาราชการ" is the contact page's จันทร์ - ศุกร์ 08:30 - 16:30.
        expect(contactPage).toContain('จันทร์ - ศุกร์ 08:30 - 16:30');
        expect(helpStep).toContain('ในเวลาราชการ');
    });

    it('points at the help menu by the label the navigation really shows', () => {
        const help = FARMER_NAV.find((item) => item.key === 'help');
        expect(help).toBeDefined();
        expect(ALL_STEPS_TEXT).toContain(`"${help!.labelTH}"`);
        expect(ALL_STEPS_TEXT).not.toContain('"ศูนย์ช่วยเหลือ"');
    });
});

describe('help-centre FAQ: validity, renewal and fees', () => {
    it('certificate validity is the backend value, with the reminder days the cron sends', () => {
        const answer = faqAnswer('cert-validity');
        expect(answer).toContain(`${VALIDITY_YEARS} ปี`);
        for (const day of REMINDER_DAYS) expect(answer).toContain(String(day));
    });

    it('renewal has no document review and one charge (W12)', () => {
        const answer = faqAnswer('cert-renewal');
        expect(answer).not.toContain('อัปเดตเอกสาร');
        expect(answer).not.toContain('Surveillance');
        expect(answer).toContain('ไม่มีการตรวจเอกสาร');
        expect(answer).toContain(th(RENEWAL_PAYABLE_SERVED));
    });

    it('promises no charge that no fee state exists for', () => {
        const answer = faqAnswer('audit-recheck');
        expect(answer).not.toContain('เรียกเก็บค่าตรวจเพิ่มเติม');
        expect(answer).toContain('ไม่มีค่าตรวจซ้ำ');
    });

    it('fees are counted per cultivation scope', () => {
        const answer = faqAnswer('pay-scope-fee');
        expect(answer).toContain('รูปแบบการปลูก');
        expect(answer).not.toContain('จำนวนพืชและพื้นที่');
    });

    it('the per-scope amounts are one ค่าบริการ plus VAT, not a state fee and a platform fee (operator 2026-09-11)', () => {
        const answer = faqAnswer('pay-scope-fee');
        expect(answer).not.toContain('ค่าธรรมเนียมรัฐ');
        expect(answer).not.toContain('ค่าบริการแพลตฟอร์ม');
        expect(answer).toContain('ค่าบริการรวม VAT 7%');
    });

    it('does not ask applicants to make a bank transfer', () => {
        expect(faqQuestion('pay-two-installments')).not.toContain('โอนเงิน');
    });

    it('gives the CAR revision deadline the backend actually enforces, in business days (one-fee residue sweep 2026-09-26)', () => {
        const days = backendCarRevisionDeadlineBusinessDays();
        const answer = faqAnswer('audit-fail');
        expect(answer).not.toContain('30 วัน');
        expect(answer).toContain(`${days} วันทำการ`);
    });

    it('schedules the audit visit in-app only — no email notification channel (one-fee residue sweep 2026-09-26)', () => {
        const answer = faqAnswer('audit-schedule');
        expect(answer).not.toContain('และอีเมล');
        expect(answer).toContain('ผ่านระบบ');
    });
});
