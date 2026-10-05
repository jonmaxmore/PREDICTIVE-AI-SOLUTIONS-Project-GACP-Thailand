/**
 * ทุกขั้นของแบบฟอร์มต้องพาไปต่อและย้อนกลับได้
 *
 * เดินจริง 2026-09-06: กรอกขั้นที่ 2 ครบทุกช่อง แล้ว **ไม่มีปุ่มใด ๆ บนหน้าเลย** —
 * ขั้น 2 ถึง 6 ไม่เคยเรนเดอร์แถบนำทาง มีแต่ขั้น 1 ที่มีของตัวเอง · ผู้ยื่นเดินเข้าไปแล้วออก
 * ไม่ได้ ยื่นคำขอไม่ได้ และไม่มีอะไรแดงให้เห็น
 */
import { describe, expect, it } from '@jest/globals';
import { wizardNavFor } from '../wizard-navigation';
import type { WizardState } from '../hooks/use-application-flow-store';

const blank = {
    requestType: null, certScope: null, applicantType: null, previousCertificateNumber: null,
    applicantData: null, farmData: null, plots: [], plantId: null, certificationPurposes: [],
    varieties: [], documents: [],
} as unknown as WizardState;

// plantId since F-QA-04 — step 1 asks the plant now, so a 'step 1 done' fixture must carry it.
const step1Done = { ...blank, requestType: 'NEW', certScope: 'PLANTING', applicantType: 'INDIVIDUAL', plantId: 'cannabis' } as WizardState;

describe('แถบนำทางของ wizard', () => {
    it.each([1, 2, 3, 4, 5, 6])('ขั้นที่ %s อยู่ในแผนการนำทาง ไม่ใช่ทางตัน', (step) => {
        const plan = wizardNavFor(step, blank);
        const hasAWayOut = plan.backHref !== null || plan.nextHref !== null;
        expect(hasAWayOut).toBe(true);
    });

    it('ขั้นแรกไม่มีปุ่มย้อนกลับ แต่มีปุ่มถัดไป', () => {
        const plan = wizardNavFor(1, blank);
        expect(plan.backHref).toBeNull();
        expect(plan.nextHref).toBe('/health/applications/new/step/2');
    });

    it('ขั้นสุดท้ายของแบบฟอร์มมีแต่ย้อนกลับ — ปุ่มยื่นเป็นของหน้าตรวจทานเอง', () => {
        const plan = wizardNavFor(6, blank);
        expect(plan.backHref).toBe('/health/applications/new/step/5');
        expect(plan.nextHref).toBeNull();
    });

    it('ขั้นกลางเดินได้ทั้งสองทาง', () => {
        expect(wizardNavFor(3, blank)).toMatchObject({
            backHref: '/health/applications/new/step/2',
            nextHref: '/health/applications/new/step/4',
        });
    });

    it('กรอกไม่ครบ ปุ่มถัดไปกดไม่ได้ — เงื่อนไขเดียวกับยามเส้นทาง', () => {
        expect(wizardNavFor(1, blank).nextDisabled).toBe(true);
        expect(wizardNavFor(1, step1Done).nextDisabled).toBe(false);
    });

    it('ขั้นของเฟสชำระเงินไม่ถูกแตะ — ที่นั่นมีปุ่มของตัวเอง', () => {
        expect(wizardNavFor(10, blank)).toEqual({ backHref: null, nextHref: null, nextDisabled: true });
    });
});
