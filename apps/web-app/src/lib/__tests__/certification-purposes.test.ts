/**
 * วัตถุประสงค์การขอรับรอง — สำเนาของเว็บ (มติ operator 2026-10-05)
 *
 * ไฟล์เดียวที่เว็บถือคือ constants/certification-purposes.json · ตรึงให้เท่ากับ
 * apps/backend/shared/certification-purposes.js โดย
 * apps/backend/__tests__/unit/certification-purposes-vocabulary.test.js
 * เทสนี้ตรึงสิ่งที่ฝั่งเว็บทำกับมัน
 */

import {
    CERTIFICATION_PURPOSES,
    PURPOSE_CODES,
    isPurposeCode,
    unknownPurposes,
    splitStoredPurposes,
    purposeOptionLabel,
    purposeOptionLabelOf,
} from '../certification-purposes';

describe('the web copy of the purpose vocabulary', () => {
    it('is exactly the three words a ภ.ท. licence backs, in licence order', () => {
        expect(PURPOSE_CODES).toEqual(['RESEARCH', 'EXPORT', 'PROCESSING']);
    });

    it('labels each option with its licence code', () => {
        expect(purposeOptionLabel('RESEARCH')).toBe('ศึกษาวิจัย (ภ.ท. 09)');
        expect(purposeOptionLabel('EXPORT')).toBe('ส่งออกเพื่อการค้า (ภ.ท. 10)');
        expect(purposeOptionLabel('PROCESSING')).toBe('แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)');
    });

    it('carries the licence name the operator stated, per purpose', () => {
        const byCode = Object.fromEntries(CERTIFICATION_PURPOSES.map((p) => [p.code, p.licenceName]));
        expect(byCode.RESEARCH).toBe('ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม');
        expect(byCode.EXPORT).toBe('ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า');
        expect(byCode.PROCESSING).toBe('ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า');
    });

    it('knows its own words and nothing else', () => {
        expect(isPurposeCode('EXPORT')).toBe(true);
        ['MEDICAL', 'COMMERCIAL', 'export', '', null, undefined, 7].forEach((word) => {
            expect(isPurposeCode(word)).toBe(false);
        });
    });

    it('names what a stored list holds that the vocabulary does not — never drops it', () => {
        expect(unknownPurposes(['MEDICAL', 'EXPORT'])).toEqual(['MEDICAL']);
        expect(unknownPurposes(['COMMERCIAL', 'MEDICAL'])).toEqual(['COMMERCIAL', 'MEDICAL']);
        expect(unknownPurposes(['RESEARCH'])).toEqual([]);
        expect(unknownPurposes(undefined)).toEqual([]);
    });

    it('shows a stored word as its labelled option, or says nothing for a word it does not know', () => {
        expect(purposeOptionLabelOf('PROCESSING')).toBe('แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)');
        expect(purposeOptionLabelOf('MEDICAL')).toBeNull();
    });

    it('splits a stored list into the words the wizard can carry and the ones it must ask again', () => {
        expect(splitStoredPurposes(['COMMERCIAL', 'RESEARCH', 'MEDICAL'])).toEqual({
            valid: ['RESEARCH'], stale: ['COMMERCIAL', 'MEDICAL'],
        });
        expect(splitStoredPurposes(undefined)).toEqual({ valid: [], stale: [] });
    });
});
