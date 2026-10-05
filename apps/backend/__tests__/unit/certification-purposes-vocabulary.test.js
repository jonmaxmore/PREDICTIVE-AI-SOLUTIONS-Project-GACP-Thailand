'use strict';
/**
 * วัตถุประสงค์การขอรับรอง — มติ operator 2026-10-05
 *
 * "เพื่อการแพทย์" ถูกถอด · วัตถุประสงค์ใช้ได้เฉพาะที่มีใบอนุญาต ภ.ท. สำหรับสมุนไพรควบคุมรองรับ:
 *   RESEARCH   = ภ.ท. 09  ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม
 *   EXPORT     = ภ.ท. 10  ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า
 *   PROCESSING = ภ.ท. 11  ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า
 *
 * ที่เดียวที่ตอบว่า "วัตถุประสงค์มีอะไรบ้าง" คือ shared/certification-purposes.js · เว็บและมือถือถือสำเนา
 * ฉบับละหนึ่งไฟล์ และเทสนี้ตรึงให้เท่ากัน (สำนวนเดียวกับ fee-service-catalogue-web-mirror.test.js)
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../../..');
const WEB_MIRROR = path.join(REPO, 'apps/web-app/src/constants/certification-purposes.json');
const DART_MIRROR = path.join(REPO, 'apps/mobile-app/lib/domain/certification_purposes.dart');

const {
    CERTIFICATION_PURPOSES,
    PURPOSE_CODES,
    assessPurposes,
    describePurposesForForm,
    optionLabel,
} = require('../../shared/certification-purposes');

describe('the vocabulary', () => {
    test('exactly three codes, in licence order', () => {
        expect(PURPOSE_CODES).toEqual(['RESEARCH', 'EXPORT', 'PROCESSING']);
    });

    test.each([
        ['RESEARCH', 'ศึกษาวิจัย', 'ภ.ท. 09', 'ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม', 'licence_pt09'],
        ['EXPORT', 'ส่งออกเพื่อการค้า', 'ภ.ท. 10', 'ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า', 'licence_pt10'],
        ['PROCESSING', 'แปรรูปหรือจำหน่ายเพื่อการค้า', 'ภ.ท. 11',
            'ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า', 'licence_pt11'],
    ])('%s carries the operator-stated licence', (code, label, licenceCode, licenceName, slotId) => {
        expect(CERTIFICATION_PURPOSES[code]).toMatchObject({ code, label, licenceCode, licenceName, slotId });
    });

    test('the option label is the label with its licence code', () => {
        expect(optionLabel('PROCESSING')).toBe('แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)');
    });

    test('MEDICAL and COMMERCIAL are not in the vocabulary', () => {
        expect(Object.keys(CERTIFICATION_PURPOSES)).not.toContain('MEDICAL');
        expect(Object.keys(CERTIFICATION_PURPOSES)).not.toContain('COMMERCIAL');
    });
});

describe('assessPurposes — a non-empty subset of the three codes, never mapped', () => {
    test.each([
        [['EXPORT']], [['RESEARCH', 'PROCESSING']], [['RESEARCH', 'EXPORT', 'PROCESSING']],
    ])('%j is accepted', (list) => {
        expect(assessPurposes(list)).toEqual({ ok: true, empty: false, unknown: [] });
    });

    test.each([
        [['MEDICAL'], ['MEDICAL']],
        [['COMMERCIAL'], ['COMMERCIAL']],
        [['EXPORT', 'MEDICAL'], ['MEDICAL']],
        [['export'], ['export']],
    ])('%j is refused naming %j', (list, unknown) => {
        const verdict = assessPurposes(list);
        expect(verdict.ok).toBe(false);
        expect(verdict.unknown).toEqual(unknown);
    });

    test('empty and not-an-array are refused as empty', () => {
        expect(assessPurposes([])).toMatchObject({ ok: false, empty: true, unknown: [] });
        expect(assessPurposes(undefined)).toMatchObject({ ok: false, empty: true });
        expect(assessPurposes('EXPORT')).toMatchObject({ ok: false });
    });
});

describe('describePurposesForForm — the กทล.1 section-2 line', () => {
    test('names each selected purpose with its licence code, in vocabulary order', () => {
        expect(describePurposesForForm(['PROCESSING', 'RESEARCH']))
            .toBe('ศึกษาวิจัย (ภ.ท. 09), แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)');
    });
    test('ignores words outside the vocabulary rather than printing them', () => {
        expect(describePurposesForForm(['MEDICAL'])).toBe('');
    });
});

describe('client mirrors are pinned to the one source', () => {
    const rows = Object.values(CERTIFICATION_PURPOSES);

    test('web json equals the source, field for field', () => {
        const web = JSON.parse(fs.readFileSync(WEB_MIRROR, 'utf8'));
        expect(web).toEqual(rows.map((r) => ({ ...r })));
    });

    test('the dart copy carries every code, label, licence code, licence name and slot id', () => {
        const dart = fs.readFileSync(DART_MIRROR, 'utf8');
        rows.forEach((r) => {
            [r.code, r.label, r.licenceCode, r.licenceName, r.slotId].forEach((literal) => {
                expect(dart).toContain(`'${literal}'`);
            });
        });
    });

    test('the dart copy holds no code outside the vocabulary', () => {
        const dart = fs.readFileSync(DART_MIRROR, 'utf8');
        const codes = [...dart.matchAll(/code:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
        expect(codes).toEqual(PURPOSE_CODES);
    });
});
