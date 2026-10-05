/**
 * ประตูยื่นคำขอปฏิเสธ 403 CONSENT_REQUIRED จนกว่าจะมีบันทึกความยินยอมสองใบ
 * และ wizard หกขั้นไม่มีที่ให้ผู้ยื่นให้ความยินยอมเลย ตั้งแต่ขั้น "ความยินยอม" ของรุ่นก่อน
 * ถูกลบไปพร้อมการกวาดล้าง ⇒ ไม่มีคำขอใดยื่นได้ (เดินจริง 2026-09-06)
 */
import { describe, expect, it } from '@jest/globals';
import { missingPlatformConsents, PLATFORM_CONSENT_CATEGORIES } from '../platform-consent';

describe('อ่านว่ายังขาดความยินยอมใบไหน', () => {
    it('ยังไม่เคยให้เลย = ขาดทั้งสองใบ', () => {
        expect(missingPlatformConsents({ consents: {} })).toEqual([...PLATFORM_CONSENT_CATEGORIES]);
    });

    it('ให้ครบแล้ว = ไม่ขาดอะไร', () => {
        expect(missingPlatformConsents({
            consents: { TERMS_OF_SERVICE: { granted: true }, PRIVACY_POLICY: { granted: true } },
        })).toEqual([]);
    });

    it('ให้ใบเดียว = ยังขาดอีกใบ และบอกว่าใบไหน', () => {
        expect(missingPlatformConsents({
            consents: { TERMS_OF_SERVICE: { granted: true }, PRIVACY_POLICY: { granted: false } },
        })).toEqual(['PRIVACY_POLICY']);
    });

    it('อ่านไม่ได้ = ถือว่ายังไม่ได้ให้ ไม่ใช่ถือว่าให้แล้ว', () => {
        expect(missingPlatformConsents(null)).toEqual([...PLATFORM_CONSENT_CATEGORIES]);
        expect(missingPlatformConsents({})).toEqual([...PLATFORM_CONSENT_CATEGORIES]);
        expect(missingPlatformConsents({ consents: undefined })).toEqual([...PLATFORM_CONSENT_CATEGORIES]);
    });

    it('ถอนความยินยอมแล้วต้องนับว่าขาด', () => {
        expect(missingPlatformConsents({
            consents: { TERMS_OF_SERVICE: { granted: false }, PRIVACY_POLICY: { granted: true } },
        })).toEqual(['TERMS_OF_SERVICE']);
    });
});
