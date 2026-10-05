/**
 * Every surface that names a price must name the price that is charged.
 *
 * F-G4-64 T9, review r1 MINOR 4. The pay CTA on the application detail page
 * said "ชำระค่าตรวจเอกสาร ฿5,535" and "ชำระค่าประเมินหน้างาน ฿27,675", and the
 * help-centre FAQ repeated 5,535 / 27,675. Those are the retired figures: the
 * old formula taxed the platform slice alone, and W14 (operator ruling
 * 2026-08-22) put VAT on the whole ค่าบริการ, so the amounts actually collected
 * are GACP_PHASE1_TOTAL / GACP_PHASE2_TOTAL (5,885 / 29,425 per scope).
 *
 * Failure this pins: an applicant in PENDING_DOC_FEE presses a button labelled
 * ฿5,535 and is charged ฿5,885 — declared lower than collected, the same class
 * of exposure docs/legal/payment-terms-th-v1.1.md was written to close, on a
 * louder surface than the legal document.
 *
 * 2026-10-03 (fix/fees-from-server): the expectations used to be computed from
 * constants/fees.ts. Those constants are gone; the surfaces take the amounts
 * GET /api/pricing/fees serves, so the copy is pinned to a served table that
 * differs from every literal the web ever held. A source scan still catches
 * the retired figures wherever they survive in these files, comments included.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

import { ACTION_META } from '@/app/health/applications/[id]/application-detail-page-config';
import { resolveActionTarget } from '@/app/health/applications/[id]/application-detail-page-helpers';
import { buildFaqTopics } from '@/components/help/faq-data';
import type { PublicFees } from '@/lib/pricing/public-fees';

/** A served table unlike any figure the web ever held. */
const SERVED: PublicFees = {
    applicationFee: 6_000,
    inspectionFee: 30_000,
    renewalFee: 40_000,
    renewalTotalPerScope: 42_800,
    phase1TotalPerScope: 6_420,
    phase2TotalPerScope: 32_100,
    vatRate: 0.07,
};
const FAQ_TOPICS = buildFaqTopics({ status: 'ready', fees: SERVED });
const docLabel = () => resolveActionTarget('PAY_DOC_FEE', 'app-1', ACTION_META.PAY_DOC_FEE, SERVED)?.label ?? '';
const auditLabel = () => resolveActionTarget('PAY_AUDIT_FEE', 'app-1', ACTION_META.PAY_AUDIT_FEE, SERVED)?.label ?? '';

const th = (value: number) => value.toLocaleString('th-TH');

/** The figures the retired platform-only-VAT formula produced. */
const RETIRED = ['5,535', '27,675'];

const SRC = path.join(__dirname, '..');
const PRICE_DECLARING_FILES = [
    'app/health/applications/[id]/application-detail-page-config.ts',
    'app/health/applications/[id]/application-detail-page-helpers.ts',
    'components/help/faq-data.ts',
    'components/onboarding/OnboardingModal.tsx',
];

function faqAnswer(id: string): string {
    for (const topic of FAQ_TOPICS) {
        const item = topic.items.find((entry) => entry.id === id);
        if (item) return item.answer;
    }
    throw new Error(`FAQ item ${id} not found`);
}

describe('the pay CTA declares the amount that is collected', () => {
    it('the phase-1 button names the served phase-1 total, per scope', () => {
        expect(docLabel()).toContain(th(SERVED.phase1TotalPerScope));
        expect(docLabel()).toContain('ต่อขอบเขต');
    });

    it('the phase-2 button names the served phase-2 total, per scope', () => {
        expect(auditLabel()).toContain(th(SERVED.phase2TotalPerScope));
        expect(auditLabel()).toContain('ต่อขอบเขต');
    });

    it('neither button carries a retired figure', () => {
        for (const retired of RETIRED) {
            expect(docLabel()).not.toContain(retired);
            expect(auditLabel()).not.toContain(retired);
        }
    });

    it('the static labels carry no amount of their own', () => {
        // "งวดที่ N" is the instalment's number, not an amount (round 2, operator
        // 2026-10-03: a tight button says "ชำระงวดที่ N"); any other digit is.
        const amountDigits = (label: string) => label.replace(/งวดที่ [12]/g, '');
        expect(amountDigits(ACTION_META.PAY_DOC_FEE.buttonLabel)).not.toMatch(/[0-9]/);
        expect(amountDigits(ACTION_META.PAY_AUDIT_FEE.buttonLabel)).not.toMatch(/[0-9]/);
    });
});

describe('the help-centre fee answer declares the amount that is collected', () => {
    it('names both phase totals', () => {
        const answer = faqAnswer('pay-scope-fee');
        expect(answer).toContain(th(SERVED.phase1TotalPerScope));
        expect(answer).toContain(th(SERVED.phase2TotalPerScope));
    });

    it('carries no retired figure', () => {
        const answer = faqAnswer('pay-scope-fee');
        for (const retired of RETIRED) {
            expect(answer).not.toContain(retired);
        }
    });
});

describe('no price-declaring surface still carries the retired figures', () => {
    it.each(PRICE_DECLARING_FILES)('%s is clean, comments included', (relative) => {
        const source = fs.readFileSync(path.join(SRC, relative), 'utf8');
        for (const retired of RETIRED) {
            expect(source).not.toContain(retired);
        }
        expect(source).not.toContain(String(5535));
        expect(source).not.toContain(String(27675));
    });
});
