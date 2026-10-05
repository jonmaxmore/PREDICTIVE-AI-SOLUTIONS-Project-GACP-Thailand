/**
 * The wizard may not offer what the applicant is about to promise not to do.
 *
 * กทล.1 ส่วนที่ ๔ (๓) — the self-certification the applicant signs at the end of the
 * filing — reads "ไม่เปลี่ยนพื้นที่/เมล็ดพันธุ์/ส่วนที่ใช้โดยไม่ยื่นคำขอใหม่"
 * (reports/research/2026-09-01-dtam-application-baseline/facts.md:28).
 *
 * Step 1 used to offer a request type whose own description was the verbatim negation of
 * that clause: "แก้ไขข้อมูลในใบรับรองเดิมโดยไม่เริ่มคำขอใหม่ทั้งหมด". It also mapped to
 * nothing — the requirement engine knows NEW, RENEWAL and REPLACEMENT only
 * (apps/backend/services/application-requirements-service.js), so a farmer who picked it
 * was judged as a new filing without being told.
 *
 * Verified before removal (2026-09-05): zero applications on either database carry it.
 */

import { SERVICE_OPTIONS, FALLBACK_PLANTS } from '../plant-selection-config';

describe('ส่วนที่ ๔ (๓) — no request type promises an amendment without a new filing', () => {
    it('offers only the request types the law and the engine both know', () => {
        expect(SERVICE_OPTIONS.map((option) => option.id).sort())
            .toEqual(['NEW', 'RENEWAL']);
    });

    it('offers no option that describes changing a certificate without refiling', () => {
        SERVICE_OPTIONS.forEach((option) => {
            expect(option.descriptionTH).not.toContain('โดยไม่เริ่มคำขอใหม่');
        });
    });

    it('no plant advertises a request type the wizard does not offer', () => {
        const offered = new Set(SERVICE_OPTIONS.map((option) => option.id));
        FALLBACK_PLANTS.forEach((plant) => {
            (plant.availableServiceTypes || []).forEach((serviceType) => {
                expect(offered.has(serviceType)).toBe(true);
            });
        });
    });
});
