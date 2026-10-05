/**
 * T5 — what each of the SIX steps counts as finished.
 *
 * `isStepComplete` is the gate the wizard bounces forward navigation against, so a
 * step whose screen cannot produce the thing it demands hard-locks every applicant.
 * That already happened once on v1: step 1 required `certificationPurposes`, which
 * the step-1 screen had no control for, so `isStepComplete(1)` could never be true
 * and every new applicant was bounced back to it forever.
 *
 * Each case below therefore asserts against what the step's OWN screen collects.
 */

import { isStepComplete, firstIncompleteStep } from '../use-application-flow-store';
import type { WizardState } from '../use-application-flow-store';

const EMPTY = {
    currentStep: 1,
    plantId: null,
    requestType: null,
    certScope: null,
    applicantType: null,
    previousCertificateNumber: null,
    serviceType: null,
    serviceTypes: [],
    certificationPurposes: [],
    siteTypes: [],
    licensePdfUrl: null,
    consentedPDPA: false,
    acknowledgedStandards: false,
    applicantData: null,
    siteData: null,
    productionData: null,
    harvestData: null,
    securityData: null,
    documents: [],
    locationType: null,
    cultivationMethods: [],
    plots: [],
    lots: [],
    farmData: null,
} as unknown as WizardState;

const state = (patch: Partial<WizardState>): WizardState => ({ ...EMPTY, ...patch });

describe('wizard v2 — step 1 (ประเภทคำขอและผู้ยื่น)', () => {
    it('is not finished until the request type AND the applicant are both chosen', () => {
        expect(isStepComplete(state({}), 1)).toBe(false);
        expect(isStepComplete(state({ requestType: 'NEW' }), 1)).toBe(false);
        expect(isStepComplete(state({ applicantType: 'INDIVIDUAL' }), 1)).toBe(false);
    });

    it('a NEW request answers the plant here, and no scope question', () => {
        // Operator 2026-09-06: "ขอรับรองในขั้นตอนใด ส่วนนี้ไม่ต้องมี". Choosing ขอใหม่
        // silently records certScope:'PLANTING', so completion cannot hinge on an
        // answer nobody is asked.
        const withoutPlant = state({ requestType: 'NEW', applicantType: 'INDIVIDUAL' });
        expect(isStepComplete(withoutPlant, 1)).toBe(false);
        expect(isStepComplete({ ...withoutPlant, plantId: 'cannabis' }, 1)).toBe(true);
    });

    it('a RENEWAL or REPLACEMENT must name the certificate it succeeds', () => {
        (['RENEWAL', 'REPLACEMENT'] as const).forEach((requestType) => {
            const base = state({ requestType, applicantType: 'COMMUNITY_ENTERPRISE' });
            // No scope is asked here: a renewal inherits the scope of what it renews.
            expect(isStepComplete(base, 1)).toBe(false);
            expect(isStepComplete({ ...base, previousCertificateNumber: 'GACP-TH-2569-E5960D' }, 1)).toBe(true);
            // Whitespace is not a certificate number.
            expect(isStepComplete({ ...base, previousCertificateNumber: '   ' }, 1)).toBe(false);
        });
    });
});

describe('wizard v2 — the remaining five steps gate on their own screen', () => {
    // plantId: step 1 asks the plant since F-QA-04.
    const step1Done = { requestType: 'NEW', applicantType: 'INDIVIDUAL', certScope: 'PLANTING', plantId: 'cannabis' } as const;

    it('step 2 wants the identity fields its own applicant type asks for', () => {
        expect(isStepComplete(state({ ...step1Done }), 2)).toBe(false);
        const individual = state({
            ...step1Done,
            applicantData: { applicantType: 'INDIVIDUAL', firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1100000000008', address: '99 หมู่ 3', phone: '0812345678' },
        } as Partial<WizardState>);
        expect(isStepComplete(individual, 2)).toBe(true);
    });

    /**
     * REWRITTEN 2026-09-06. This used to assert a named farm, an address and at least one
     * `plots` row — none of which step 3 collects. The screen writes `siteName` and
     * `siteAddress`, and it never creates a plot, so the rule this test pinned made step 3
     * impossible to complete: the ถัดไป button stayed dead and the route guard bounced
     * anyone who tried to reach step 4. The test passed the whole time, because it built
     * its fixture out of the same wrong fields the gate read.
     */
    it('step 3 wants what step 3 asks for — the site, the land right, and the area', () => {
        const partial = state({
            ...step1Done,
            farmData: { siteName: 'ไร่ทดสอบ', siteAddress: '1 หมู่ 2' },
        } as Partial<WizardState>);
        expect(isStepComplete(partial, 3)).toBe(false);

        const complete = state({
            ...step1Done,
            farmData: {
                siteName: 'ไร่ทดสอบ', siteAddress: '1 หมู่ 2', landOwnership: 'OWNED',
                // จังหวัด/อำเภอ/ตำบล — the certificate names them (43dd39c6), so step 3
                // is not complete without them.
                subDistrict: 'หนองหาร', district: 'สันทราย', province: 'เชียงใหม่',
                landDocumentDetail: { type: 'โฉนด', number: '12345' },
                areaTypes: ['OUTDOOR'], areaSqm: '1600',
            },
        } as Partial<WizardState>);
        // ไม่มีแถว plots สักแถว และนั่นถูกต้อง — ขั้นนี้ไม่ได้สร้างมัน
        expect(isStepComplete(complete, 3)).toBe(true);
    });

    it('step 4 wants the plant — a filing that names none is judged by no law at all', () => {
        expect(isStepComplete(state({ ...step1Done }), 4)).toBe(false);
        const named = state({
            ...step1Done, plantId: 'cannabis', certificationPurposes: ['EXPORT'], cultivationMethods: ['outdoor'],
        } as Partial<WizardState>);
        expect(isStepComplete(named, 4)).toBe(true);
    });

    /**
     * ขั้น 5 เคยตัดสินจาก `state.documents` ที่ browser ถือเอง — และการ์ดอัปโหลดของ wizard
     * รุ่นใหม่ **ไม่เคยเขียนอาร์เรย์นั้น** (มันอัปโหลดขึ้นเซิร์ฟเวอร์แล้วสั่งอ่านรายการใหม่)
     * ⇒ ขั้น 5 เป็นจริงไม่ได้เลย ปุ่มถัดไปดับถาวร และ **หน้าตรวจทานไปไม่ถึง**
     *
     * ซึ่งทำลายเหตุผลของหน้าตรวจทานเอง: มันถูกออกแบบมาให้บอกว่ายังขาดเอกสารใด พร้อมปุ่ม
     * "ไปแก้ที่ขั้น N" · หน้าที่บอกว่าอะไรขาด จะเข้าถึงได้ก็ต่อเมื่อไม่มีอะไรขาดแล้ว ย่อมไร้ประโยชน์
     *
     * เส้นที่กั้นจริงอยู่สองด่านและยังอยู่ครบ: ปุ่มยื่นบนหน้าตรวจทานต้องการ complete จาก
     * เซิร์ฟเวอร์ และประตูยื่นปฏิเสธชุดเอกสารที่ไม่ครบพร้อมเหตุผลตามกฎหมาย
     */
    it('step 5 lets the applicant reach the review page — the refusal lives at submit', () => {
        expect(isStepComplete(state({ ...step1Done, documents: [] }), 5)).toBe(true);
    });

    it('step 6 is read-only, so it is always reachable once the rest is done', () => {
        expect(isStepComplete(state({}), 6)).toBe(true);
    });

    it('there is no step 7, 8 or 9 any more', () => {
        [7, 8, 9].forEach((n) => expect(isStepComplete(state({}), n)).toBe(false));
    });
});

describe('firstIncompleteStep walks 1..6 and stops at 6', () => {
    it('sends a brand-new applicant to step 1', () => {
        expect(firstIncompleteStep(state({}))).toBe(1);
    });

    it('sends an applicant who finished step 1 to step 2', () => {
        expect(firstIncompleteStep(state({
            requestType: 'NEW', applicantType: 'INDIVIDUAL', certScope: 'PLANTING', plantId: 'cannabis',
        }))).toBe(2);
    });

    it('never returns a step number the registry does not have', () => {
        const n = firstIncompleteStep(state({}));
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(6);
    });
});
