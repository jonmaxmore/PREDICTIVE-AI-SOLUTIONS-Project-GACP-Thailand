/**
 * payment-service-quotation-accept.test.ts — F-G4-64 final round (R20, R21, R16).
 *
 * Three facts about a quotation this service used to throw away:
 *
 *   R20 (S14) — `acceptQuotation` collapsed the whole envelope to `null`, so
 *   both accept surfaces printed "กรุณาลองใหม่อีกครั้ง" for refusals that can
 *   never succeed on retry (SNAPSHOT_REQUIRED, INVALID_QUOTATION_STATUS,
 *   QUOTATION_EXPIRED). It now answers a discriminated result carrying the
 *   backend's code, and one shared function turns that code into the
 *   catalogue's Thai with the document number in it.
 *
 *   R21 (C1 FE / S16) — the acceptance door binds `validUntil`
 *   (services/quotation-service.js markQuotationAccepted, final round R1), so
 *   the predicate that decides whether a screen draws the accept button has to
 *   read the same two facts the backend reads: status AND validUntil.
 *
 *   R16 (S17) — one exported milestone label map, so no screen prints 'M1'.
 *
 * `api` is mocked per repo convention — see __tests__/checkout-service.test.ts.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { api } from '@/lib/api/api-client';
import {
    acceptedPhaseAmount,
    isQuotationAcceptable,
    isQuotationLapsed,
    milestoneLabelTh,
    milestonePhase,
    PaymentService,
    quotationAcceptFailureMessage,
    quotationLapsedNoticeTh,
    QUOTATION_EXPIRED_COPY_TH,
    QUOTATION_EXPIRED_ON_LIST_COPY_TH,
    QUOTATION_NOT_ISSUED_COPY_TH,
    type QuotationRecord,
} from '../payment-service';

jest.mock('@/lib/api/api-client', () => ({
    api: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockedPost = api.post as jest.MockedFunction<typeof api.post>;

const NUMBER = 'QT-PRD-2026-000001';

const ROW: QuotationRecord = {
    id: 'qt-1',
    applicationId: 'app-1',
    issuerType: 'PLATFORM',
    quotationNumber: NUMBER,
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    status: 'PENDING',
    createdAt: '2026-08-25T00:00:00.000Z',
    validUntil: '2026-09-24T00:00:00.000Z',
};

describe('PaymentService.acceptQuotation answers with the refusal, not with null (R20)', () => {
    beforeEach(() => {
        mockedPost.mockReset();
    });

    it('a recorded acceptance comes back as the row', async () => {
        const accepted = { ...ROW, status: 'ACCEPTED' as const };
        mockedPost.mockResolvedValue({ success: true, data: accepted });

        const result = await PaymentService.acceptQuotation('app-1', 'PLATFORM');

        expect(result).toEqual({ ok: true, row: accepted });
    });

    it('a refusal keeps the backend code so the screen can say which refusal it was', async () => {
        mockedPost.mockResolvedValue({
            success: false,
            code: 'SNAPSHOT_REQUIRED',
            error: 'SNAPSHOT_REQUIRED',
            status: 409,
        });

        const result = await PaymentService.acceptQuotation('app-1', 'PLATFORM');

        expect(result).toEqual({ ok: false, code: 'SNAPSHOT_REQUIRED' });
    });

    it('an envelope that carries the identifier only in `error` is read there too', async () => {
        mockedPost.mockResolvedValue({
            success: false,
            error: 'QUOTATION_EXPIRED',
            status: 409,
        });

        const result = await PaymentService.acceptQuotation('app-1', 'PLATFORM');

        expect(result).toEqual({ ok: false, code: 'QUOTATION_EXPIRED' });
    });

    it('no answer at all carries no code: that is the one case a retry can clear', async () => {
        mockedPost.mockResolvedValue({ success: false });

        const result = await PaymentService.acceptQuotation('app-1', 'PLATFORM');

        expect(result).toEqual({ ok: false });
    });

    it('a dropped connection is no answer either, however friendly its sentence', async () => {
        // api-client answers a transport failure with a display string in
        // `error` and no `code` (lib/api/api-client.ts). Harvesting that as a
        // code would make every later `if (result.code)` read a network drop as
        // a permanent refusal — the exact branch R20 introduced.
        mockedPost.mockResolvedValue({ success: false, error: 'Unable to connect to server' });

        const result = await PaymentService.acceptQuotation('app-1', 'PLATFORM');

        expect(result).toEqual({ ok: false });
        expect(quotationAcceptFailureMessage(
            (result as { code?: string }).code, NUMBER,
        )).toContain('กรุณาลองใหม่อีกครั้ง');
    });

    it('a timeout sentence is not a code either', async () => {
        mockedPost.mockResolvedValue({ success: false, error: 'Request timeout. Please try again' });

        await expect(PaymentService.acceptQuotation('app-1', 'PLATFORM')).resolves.toEqual({ ok: false });
    });

    it('asks nothing without an application or an issuer', async () => {
        await expect(PaymentService.acceptQuotation('', 'PLATFORM')).resolves.toEqual({ ok: false });
        expect(mockedPost).not.toHaveBeenCalled();
    });
});

describe('quotationAcceptFailureMessage names the refusal and the document (R20)', () => {
    it('SNAPSHOT_REQUIRED asks for the one thing that lets staff act: the number', () => {
        const copy = quotationAcceptFailureMessage('SNAPSHOT_REQUIRED', NUMBER);

        expect(copy).toContain('ไม่มีตัวเลขครบ');
        expect(copy).toContain('เจ้าหน้าที่');
        expect(copy).toContain(NUMBER);
        expect(copy).not.toContain('ลองใหม่อีกครั้ง');
    });

    it('QUOTATION_EXPIRED names the act the system performs, never a staff re-issue door', () => {
        const copy = quotationAcceptFailureMessage('QUOTATION_EXPIRED', NUMBER);

        expect(copy).toContain(NUMBER);
        expect(copy).toContain('หน้ารายการชำระเงิน');
        // ledger F-G4-71: there is no staff quotation-issuance surface.
        expect(copy).not.toContain('ติดต่อเจ้าหน้าที่');
        expect(copy).not.toContain('ลองใหม่อีกครั้ง');
    });

    it('INVALID_QUOTATION_STATUS says the screen was refreshed instead of asking for a retry', () => {
        const copy = quotationAcceptFailureMessage('INVALID_QUOTATION_STATUS', NUMBER);

        expect(copy).toContain(NUMBER);
        expect(copy).toContain('สถานะ');
        expect(copy).not.toContain('ลองใหม่อีกครั้ง');
    });

    it('no code means no answer arrived, which is the only failure a retry can clear', () => {
        const copy = quotationAcceptFailureMessage(undefined, NUMBER);

        expect(copy).toContain('ลองใหม่อีกครั้ง');
    });

    it('every sentence is Thai, has no em dash, and fits on a screen', () => {
        for (const code of ['SNAPSHOT_REQUIRED', 'QUOTATION_EXPIRED', 'INVALID_QUOTATION_STATUS', undefined]) {
            const copy = quotationAcceptFailureMessage(code, NUMBER);
            expect(copy).toMatch(/[฀-๿]/);
            expect(copy).not.toContain('—');
            expect(copy.length).toBeGreaterThan(20);
            expect(copy.length).toBeLessThanOrEqual(200);
        }
    });

    it('the expiry sentence is the catalogue row, shared by every surface that shows it', () => {
        // apps/backend/shared/error-codes.js QUOTATION_EXPIRED.messageTh, byte
        // for byte. Last items of the final round: the unconditional promise
        // ("ระบบจะออกใบใหม่ให้เมื่อคุณกลับไป…") is gone, because the read refuses
        // to replace a pre-W14 pair, an M2-payable row priced for both
        // instalments, and a row already invoiced. The sentence names the door
        // that may replace the offer, then the action for when it does not.
        expect(QUOTATION_EXPIRED_COPY_TH).toBe(
            'ใบเสนอราคาเกินกำหนดยืนราคาแล้ว กรุณากลับไปที่หน้ารายการชำระเงิน '
            + 'หากระบบไม่ออกใบใหม่ให้ กรุณาติดต่อเจ้าหน้าที่พร้อมแจ้งเลขที่ใบเสนอราคา',
        );
        expect(QUOTATION_EXPIRED_COPY_TH).not.toContain('ระบบจะออกใบใหม่ให้');
    });

    /**
     * The other half of the same rule (last items of the final round): the
     * missing-quotation sentence is the catalogue's too, so the checkout map
     * and the slip modal cannot drift into two answers for one refusal. The
     * read issues a late quotation only inside SELF_HEAL_STATUSES, so this row
     * may not tell an M2-payable applicant that looking again produces one.
     */
    it('the not-issued sentence is the catalogue row, and promises no refresh', () => {
        expect(QUOTATION_NOT_ISSUED_COPY_TH).toBe(
            'ระบบยังไม่ออกใบเสนอราคาของคำขอนี้ จึงยังชำระเงินไม่ได้ '
            + 'กรุณาติดต่อเจ้าหน้าที่พร้อมแจ้งเลขที่คำขอ',
        );
        expect(QUOTATION_NOT_ISSUED_COPY_TH).not.toContain('รีเฟรช');
    });
});

describe('isQuotationAcceptable reads validUntil as well as status (R21)', () => {
    const FUTURE = '2099-01-01T00:00:00.000Z';
    const PAST = '2020-01-01T00:00:00.000Z';

    it('a PENDING row inside its validity window can still be accepted', () => {
        expect(isQuotationAcceptable({ ...ROW, status: 'PENDING', validUntil: FUTURE })).toBe(true);
    });

    it('a PENDING row past validUntil cannot: the acceptance door refuses it', () => {
        expect(isQuotationAcceptable({ ...ROW, status: 'PENDING', validUntil: PAST })).toBe(false);
        expect(isQuotationLapsed({ ...ROW, status: 'PENDING', validUntil: PAST })).toBe(true);
    });

    it('a row with no validity date is bounded by its status alone', () => {
        expect(isQuotationAcceptable({ ...ROW, status: 'SENT', validUntil: null })).toBe(true);
        expect(isQuotationLapsed({ ...ROW, status: 'SENT', validUntil: null })).toBe(false);
    });

    it('an ACCEPTED row never lapses: an agreement does not expire with the offer window', () => {
        expect(isQuotationLapsed({ ...ROW, status: 'ACCEPTED', validUntil: PAST })).toBe(false);
        expect(isQuotationAcceptable({ ...ROW, status: 'ACCEPTED', validUntil: PAST })).toBe(false);
    });

    it('nothing to accept is not acceptable', () => {
        expect(isQuotationAcceptable(null)).toBe(false);
        expect(isQuotationAcceptable(undefined)).toBe(false);
    });
});

describe('the milestone label map is one constant (R16)', () => {
    it('names both instalments in Thai', () => {
        expect(milestoneLabelTh('M1')).toBe('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
        expect(milestoneLabelTh('M2')).toBe('งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง');
    });

    it('a renewal names its M2 as the renewal service, never งวดที่ 2 (round 2, operator 2026-10-03)', () => {
        const renewal = {
            PHASE_1: null,
            PHASE_2: { name: 'ค่าบริการต่ออายุใบรับรอง', nameEn: 'x', coverage: 'ครอบคลุม: x', coverageEn: 'x' },
        };
        expect(milestoneLabelTh('M2', renewal)).toBe('ค่าบริการต่ออายุใบรับรอง');
        // a renewal has no instalment 1 to name
        expect(milestoneLabelTh('M1', renewal)).toBeNull();
    });

    it('answers null for anything else, so no screen falls back to the raw enum', () => {
        expect(milestoneLabelTh('M3')).toBeNull();
        expect(milestoneLabelTh('')).toBeNull();
    });

    it('maps a milestone to the instalment the snapshot keys on', () => {
        expect(milestonePhase('M1')).toBe('PHASE_1');
        expect(milestonePhase('M2')).toBe('PHASE_2');
        expect(milestonePhase('nope')).toBeNull();
    });
});

/**
 * Fix round 1 of the final round — reviewer MAJOR (finding on R15's fallback).
 *
 * The checkout idle screen prints `acceptedPhaseAmount` as "ยอดตามใบเสนอราคา"
 * directly above the no-refund tick, so that figure is the one the applicant
 * consents against. It used to fall back to the ROW's own
 * `installments[phase].amount`, which is the ISSUER-SPECIFIC slice: on a
 * pre-W14 PLATFORM row it is platform + VAT only (apps/backend/services/
 * quotation-line-items.js instalmentPayable), i.e. 4,425 of a 29,425 phase.
 * A pre-W14 row closed as INVOICED by the repair script (spec §3.7) carries no
 * acceptance snapshot at all, so that fallback was the branch such an applicant
 * actually saw while the charge was minted from the full breakdown.
 *
 * The split columns (stateAmount/platformAmount/vatAmount) are written
 * IDENTICALLY onto both issuers' entries and describe the WHOLE phase
 * (quotation-service._buildInstallments), which is why summing them is the one
 * honest reading of a snapshot-less row, and why the two rows of a pre-W14 pair
 * cannot disagree about it.
 */
describe('acceptedPhaseAmount states the whole phase or nothing (fix round 1)', () => {
    const W14_ROW: QuotationRecord = {
        ...ROW,
        status: 'ACCEPTED',
        installments: [
            { phase: 'PHASE_1', amount: 5885, stateAmount: 5000, platformAmount: 500, vatAmount: 385 },
            { phase: 'PHASE_2', amount: 29425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925 },
        ],
        acceptedSnapshot: {
            quotationNumber: NUMBER,
            issuerType: 'PLATFORM',
            currency: 'THB',
            installments: [
                { phase: 'PHASE_1', amount: 5885, stateAmount: 5000, platformAmount: 500, vatAmount: 385, phaseTotal: 5885 },
                { phase: 'PHASE_2', amount: 29425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925, phaseTotal: 29425 },
            ],
        },
    };

    // The shape the repair script leaves behind: INVOICED, acceptedAt and the
    // snapshot both null, and an `amount` that is only this issuer's slice.
    const LEGACY_PLATFORM: QuotationRecord = {
        ...ROW,
        status: 'INVOICED',
        acceptedAt: null,
        acceptedSnapshot: null,
        installments: [
            { phase: 'PHASE_1', amount: 885, stateAmount: 5000, platformAmount: 500, vatAmount: 385 },
            { phase: 'PHASE_2', amount: 4425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925 },
        ],
    };

    it('reads the frozen phaseTotal when the acceptance froze one', () => {
        expect(acceptedPhaseAmount(W14_ROW, 'PHASE_1')).toBe(5885);
        expect(acceptedPhaseAmount(W14_ROW, 'PHASE_2')).toBe(29425);
    });

    it('a snapshot-less legacy PLATFORM row states the PHASE, never its own slice', () => {
        // 4,425 is what this document asks for; 29,425 is what the phase costs
        // and what the charge will be. The screen taking the consent may only
        // name the second.
        expect(acceptedPhaseAmount(LEGACY_PLATFORM, 'PHASE_2')).toBe(29425);
        expect(acceptedPhaseAmount(LEGACY_PLATFORM, 'PHASE_1')).toBe(5885);
    });

    it('the DTAM half of the same pre-W14 pair answers the same phase price', () => {
        const legacyDtam: QuotationRecord = {
            ...LEGACY_PLATFORM,
            issuerType: 'DTAM',
            installments: [
                { phase: 'PHASE_2', amount: 25000, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925 },
            ],
        };
        expect(acceptedPhaseAmount(legacyDtam, 'PHASE_2')).toBe(29425);
    });

    it('a pre-GAP-5 instalment that carries only {phase, amount} states nothing', () => {
        const preGap5: QuotationRecord = {
            ...LEGACY_PLATFORM,
            installments: [{ phase: 'PHASE_2', amount: 4425 }],
        };
        // The row never recorded what the phase costs, and inventing it from
        // the slice is exactly the defect. The summary prints no figure.
        expect(acceptedPhaseAmount(preGap5, 'PHASE_2')).toBeNull();
    });

    it('an instalment the document does not price at all is null', () => {
        expect(acceptedPhaseAmount(W14_ROW, 'PHASE_2' as const)).not.toBeNull();
        const phase2Only: QuotationRecord = {
            ...W14_ROW,
            acceptedSnapshot: {
                ...W14_ROW.acceptedSnapshot,
                installments: [
                    { phase: 'PHASE_2', amount: 29425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925, phaseTotal: 29425 },
                ],
            },
            installments: [
                { phase: 'PHASE_2', amount: 29425, stateAmount: 25000, platformAmount: 2500, vatAmount: 1925 },
            ],
        };
        expect(acceptedPhaseAmount(phase2Only, 'PHASE_1')).toBeNull();
    });

    it('nothing accepted is nothing to name', () => {
        expect(acceptedPhaseAmount(null, 'PHASE_1')).toBeNull();
    });
});

/**
 * Fix round 1 — reviewer MINOR: the lapsed-row copy promised a replacement the
 * backend does not issue for a pre-W14 PAIR. `_lapsedOfferToReplace`
 * (apps/backend/services/quotation-issuance-on-submit.js) returns null the
 * moment an application holds two live rows, on purpose: replacing a pair with
 * one W14 document is a repricing decision, not a repair. So an applicant with
 * a lapsed pair could refresh for ever.
 */
describe('quotationLapsedNoticeTh promises a replacement only where one is issued (fix round 1)', () => {
    const LAPSED = { ...ROW, status: 'PENDING' as const, validUntil: '2020-01-01T00:00:00.000Z' };

    it('a single row: the system issues the replacement, so the copy says so', () => {
        const copy = quotationLapsedNoticeTh({ dtam: null, platform: LAPSED }, 'payments-list');
        expect(copy).toBe(QUOTATION_EXPIRED_ON_LIST_COPY_TH);
        expect(copy).toContain('ระบบจะออกใบใหม่ให้');
    });

    it('away from the payments list it names that page instead of this one', () => {
        expect(quotationLapsedNoticeTh({ dtam: null, platform: LAPSED }, 'elsewhere'))
            .toBe(QUOTATION_EXPIRED_COPY_TH);
    });

    it('a pre-W14 pair gets the fact and the only door that exists, not the promise', () => {
        const copy = quotationLapsedNoticeTh(
            {
                dtam: { ...LAPSED, id: 'qt-dtam', issuerType: 'DTAM', quotationNumber: 'QT-DTAM-2026-000009' },
                platform: LAPSED,
            },
            'payments-list',
        );
        expect(copy).not.toContain('ระบบจะออกใบใหม่');
        expect(copy).toContain('เกินกำหนดยืนราคาแล้ว');
        expect(copy).toContain('กรุณาติดต่อเจ้าหน้าที่');
        expect(copy).toContain('QT-DTAM-2026-000009');
        expect(copy).toContain(NUMBER);
    });
});
