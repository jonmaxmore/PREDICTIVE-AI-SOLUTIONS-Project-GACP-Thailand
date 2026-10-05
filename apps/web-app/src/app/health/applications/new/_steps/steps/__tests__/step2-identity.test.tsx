/**
 * T6 — step 2 asks กทล.1 ส่วนที่ ๑, and asks only what THIS applicant's type requires.
 *
 * The three field lists are not variations on one form. A merged form with everything
 * optional collects the wrong facts and lets a filing through missing the ones its own
 * type requires — which the officer then chases by telephone. And the qualification
 * cards come from the SERVER's payload, never from a list this screen keeps: the engine
 * already scopes by holder type, so rendering a fixed list would show a sole trader the
 * company-registration card and demand a paper the law never asked of them.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import {
    IDENTITY_FIELDS_BY_APPLICANT_TYPE,
    identityFieldsFor,
    identityComplete,
    STEP2_COPY_TH,
} from '../step2-identity-config';
import Step2Identity from '../step2-identity';

describe('the three field lists are genuinely different', () => {
    it('asks a วิสาหกิจชุมชน for its สัญชาติ and its สวช.01 code', () => {
        const keys = IDENTITY_FIELDS_BY_APPLICANT_TYPE.COMMUNITY_ENTERPRISE.map((f) => f.key);
        expect(keys).toContain('nationality');
        expect(keys).toContain('communityRegistrationNo');
        expect(keys).toContain('presidentIdCard');
    });

    it('asks a sole trader for none of those', () => {
        const keys = IDENTITY_FIELDS_BY_APPLICANT_TYPE.INDIVIDUAL.map((f) => f.key);
        expect(keys).not.toContain('nationality');
        expect(keys).not.toContain('communityRegistrationNo');
        expect(keys).not.toContain('companyName');
        expect(keys).toContain('idCard');
    });

    it('asks a นิติบุคคล who may sign, and for its registration number', () => {
        const keys = IDENTITY_FIELDS_BY_APPLICANT_TYPE.JURISTIC.map((f) => f.key);
        expect(keys).toContain('authorizedSignatory');
        expect(keys).toContain('taxId');
        expect(keys).not.toContain('presidentIdCard');
    });

    it('every field reads as Thai and never shows its own key', () => {
        Object.values(IDENTITY_FIELDS_BY_APPLICANT_TYPE).flat().forEach((f) => {
            expect(f.labelTH).toMatch(/[ก-๙]/);
            expect(f.labelTH).not.toContain(f.key);
            expect(f.labelTH).not.toContain('—');
        });
    });

    it('email is never required, on any type — a farmer without one must still file', () => {
        Object.values(IDENTITY_FIELDS_BY_APPLICANT_TYPE).flat()
            .filter((f) => f.key === 'email')
            .forEach((f) => expect(f.required).toBe(false));
    });

    it('asks nothing until step 1 has said who is applying', () => {
        expect(identityFieldsFor(null)).toEqual([]);
    });
});

describe('identityComplete gates on THIS type’s required fields only', () => {
    it('is false before an applicant type is chosen', () => {
        expect(identityComplete(null, { firstName: 'สมชาย' })).toBe(false);
    });

    it('accepts a sole trader who answered the individual fields', () => {
        const data = {
            firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1100000000008',
            address: '99 หมู่ 3', phone: '0812345678',
        };
        expect(identityComplete('INDIVIDUAL', data)).toBe(true);
        // …and does not hold their email against them.
        expect(identityComplete('INDIVIDUAL', { ...data, email: '' })).toBe(true);
    });

    it('does not let one type’s answers satisfy another’s', () => {
        const soleTrader = {
            firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1100000000008',
            address: '99 หมู่ 3', phone: '0812345678',
        };
        expect(identityComplete('COMMUNITY_ENTERPRISE', soleTrader)).toBe(false);
        expect(identityComplete('JURISTIC', soleTrader)).toBe(false);
    });

    it('treats whitespace as unanswered', () => {
        expect(identityComplete('INDIVIDUAL', {
            firstName: '  ', lastName: 'ใจดี', idCard: '1100000000008',
            address: '99 หมู่ 3', phone: '0812345678',
        })).toBe(false);
    });
});

describe('the screen', () => {
    const slot = (slotId: string, labelTH: string) => ({
        slotId, labelTH, description: null, sourceHint: null,
        required: true, requiredReason: 'HOLDER_TYPE', satisfied: false,
        fileUrl: null, fileName: null, uploadedAt: null,
    });

    it('an INDIVIDUAL filing shows the producer-supervision card and NOT the juristic ones', () => {
        const html = renderToStaticMarkup(
            <Step2Identity
                applicantType="INDIVIDUAL"
                applicantData={{}}
                slots={[
                    slot('producer_supervision_letter', 'หนังสือกำกับโดยผู้รับอนุญาตผลิตยา'),
                    slot('id_house_reg', 'สำเนาบัตรประชาชนและทะเบียนบ้าน'),
                ]}
                appId="app-1"
                onChange={() => {}}
                onChanged={() => {}}
            />,
        );
        expect(html).toContain('หนังสือกำกับโดยผู้รับอนุญาตผลิตยา');
        expect(html).toContain('สำเนาบัตรประชาชนและทะเบียนบ้าน');
        expect(html).not.toContain('หนังสือรับรองการจดทะเบียนนิติบุคคล');
    });

    it('a วิสาหกิจชุมชน filing is asked for สัญชาติ', () => {
        const html = renderToStaticMarkup(
            <Step2Identity
                applicantType="COMMUNITY_ENTERPRISE"
                applicantData={{}}
                slots={[]}
                appId="app-1"
                onChange={() => {}}
                onChanged={() => {}}
            />,
        );
        expect(html).toContain('สัญชาติ');
        expect(html).toContain('สวช.01');
    });

    it('says what to do when step 1 has not named the applicant yet', () => {
        const html = renderToStaticMarkup(
            <Step2Identity
                applicantType={null}
                applicantData={{}}
                slots={[]}
                appId="app-1"
                onChange={() => {}}
                onChanged={() => {}}
            />,
        );
        expect(html).toContain(STEP2_COPY_TH.noApplicantType);
    });
});
