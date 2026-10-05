/**
 * thai-locations-corrections.test.js
 *
 * Editing government reference data safely.
 *
 * The shipped dataset carries a handful of rows we corrected ourselves after
 * checking each one against more than one independent transcription of the same
 * DOPA facts. Two of them were not typos but structural faults: an อำเภอ name
 * sitting in a ตำบล slot, so `ตำบลบึงโขงหลง` appeared inside อำเภอเมืองบึงกาฬ
 * while บึงโขงหลง is itself อำเภอ 3806. A farmer there could not enter a real
 * address, and an auditor reading the application would be sent to a tambon
 * that does not exist.
 *
 * Corrections are data, not code edits, so they survive a rebuild and stay
 * reviewable. What this file guards is that they can never rot quietly:
 *
 *   - a correction whose target row is gone must fail the build, not vanish
 *   - a correction whose "before" no longer matches must fail the build, because
 *     the row changed underneath it and nobody re-checked the evidence
 *   - a correction with no stated reason must fail the build — an unexplained
 *     edit to a government dataset is indistinguishable from corruption
 *
 * Each of those is a way a silent no-op could reintroduce a bad address months
 * from now, with the correction file still sitting there looking applied.
 */

'use strict';

const { applyCorrections } = require('../../data/thai-locations-corrections');

const baseData = () => ({
    provinces: [{ code: 38, nameTh: 'บึงกาฬ', nameEn: 'Bueng Kan' }],
    districts: [{ code: 3801, provinceCode: 38, nameTh: 'เมืองบึงกาฬ', nameEn: 'Mueang Bueng Kan' }],
    subDistricts: [
        { code: 380102, districtCode: 3801, postalCode: '38000', nameTh: 'บึงโขงหลง', nameEn: 'Bueng Khong Long' },
        { code: 380107, districtCode: 3801, postalCode: '38000', nameTh: 'บึงกาฬ', nameEn: 'Bueng Kan' },
    ],
});

const goodCorrection = {
    code: 380102,
    expectNameTh: 'บึงโขงหลง',
    nameTh: 'โคกก่อง',
    nameEn: 'Khok Kong',
    reason: 'บึงโขงหลง is อำเภอ 3806, not a ตำบล of เมืองบึงกาฬ',
};

describe('applyCorrections', () => {
    it('replaces both the Thai and the English name of the targeted row', () => {
        const { data } = applyCorrections(baseData(), { subDistricts: [goodCorrection] });
        const row = data.subDistricts.find((s) => s.code === 380102);
        expect(row.nameTh).toBe('โคกก่อง');
        expect(row.nameEn).toBe('Khok Kong');
    });

    it('leaves every other row exactly as it was', () => {
        const { data } = applyCorrections(baseData(), { subDistricts: [goodCorrection] });
        expect(data.subDistricts.find((s) => s.code === 380107)).toEqual(
            baseData().subDistricts.find((s) => s.code === 380107),
        );
        expect(data.districts).toEqual(baseData().districts);
    });

    it('keeps the code, parent and postal code untouched — a correction renames, it does not move', () => {
        const { data } = applyCorrections(baseData(), { subDistricts: [goodCorrection] });
        const row = data.subDistricts.find((s) => s.code === 380102);
        expect(row.districtCode).toBe(3801);
        expect(row.postalCode).toBe('38000');
    });

    it('reports what it applied, so a rebuild prints the edits rather than hiding them', () => {
        const { applied } = applyCorrections(baseData(), { subDistricts: [goodCorrection] });
        expect(applied).toHaveLength(1);
        expect(applied[0]).toMatch(/380102/);
        expect(applied[0]).toMatch(/โคกก่อง/);
    });

    it('throws when the target row does not exist', () => {
        // Otherwise a renumbered dataset silently drops the correction and the
        // bad name comes back with the correction file still listing it.
        expect(() => applyCorrections(baseData(), {
            subDistricts: [{ ...goodCorrection, code: 999999 }],
        })).toThrow(/999999/);
    });

    it('throws when the row holds neither the old value nor the corrected one', () => {
        // The row changed underneath us into something nobody checked. Whoever
        // changed it did not re-examine the evidence behind this correction, so
        // the build stops and asks.
        expect(() => applyCorrections(baseData(), {
            subDistricts: [{ ...goodCorrection, expectNameTh: 'อะไรก็ไม่รู้' }],
        })).toThrow(/expected/i);
    });

    it('treats an already-corrected row as done, not as drift', () => {
        // Applying twice must be safe. Without this the second run cannot tell
        // "someone corrupted the row" from "the correction is already in", and
        // a clean repo fails its own check.
        const already = applyCorrections(baseData(), { subDistricts: [goodCorrection] }).data;
        const second = applyCorrections(already, { subDistricts: [goodCorrection] });
        expect(second.applied).toEqual([]);
        expect(second.data.subDistricts.find((s) => s.code === 380102).nameTh).toBe('โคกก่อง');
    });

    it('throws when a correction carries no reason', () => {
        expect(() => applyCorrections(baseData(), {
            subDistricts: [{ ...goodCorrection, reason: '' }],
        })).toThrow(/reason/i);
    });

    it('is a no-op when there is nothing to correct', () => {
        const { data, applied } = applyCorrections(baseData(), {});
        expect(data).toEqual(baseData());
        expect(applied).toEqual([]);
    });
});

describe('applyCorrections — additions', () => {
    const addition = {
        code: 380199,
        districtCode: 3801,
        postalCode: '38000',
        nameTh: 'ทดสอบ',
        nameEn: 'Test',
        reason: 'ตั้งขึ้นตามประกาศ … (ทดสอบ)',
    };

    it('adds a row that was missing', () => {
        const { data } = applyCorrections(baseData(), { subDistricts: [], additions: { subDistricts: [addition] } });
        expect(data.subDistricts.find((s) => s.code === 380199)).toMatchObject({
            code: 380199, districtCode: 3801, postalCode: '38000', nameTh: 'ทดสอบ',
        });
    });

    it('is idempotent — adding a row that is already there changes nothing', () => {
        const once = applyCorrections(baseData(), { additions: { subDistricts: [addition] } }).data;
        const twice = applyCorrections(once, { additions: { subDistricts: [addition] } });
        expect(twice.applied).toEqual([]);
        expect(twice.data.subDistricts.filter((s) => s.code === 380199)).toHaveLength(1);
    });

    it('throws when the addition would collide with a different row', () => {
        // Same code, different name means one of the two is wrong. Overwriting
        // silently is how a real แขวง gets replaced by a guess.
        expect(() => applyCorrections(baseData(), {
            additions: { subDistricts: [{ ...addition, code: 380107, nameTh: 'อะไรสักอย่าง' }] },
        })).toThrow(/380107/);
    });

    it('throws when the addition has no parent district in the dataset', () => {
        expect(() => applyCorrections(baseData(), {
            additions: { subDistricts: [{ ...addition, code: 999901, districtCode: 9999 }] },
        })).toThrow(/9999/);
    });

    it('throws when the code does not sit under its stated parent', () => {
        // 380199 belongs to district 3801. Claiming 3801 while numbering it
        // under another อำเภอ breaks the hierarchy every lookup relies on.
        expect(() => applyCorrections(baseData(), {
            additions: { subDistricts: [{ ...addition, code: 380999 }] },
        })).toThrow(/under|prefix|hierarch/i);
    });

    it('throws when an addition carries no reason', () => {
        expect(() => applyCorrections(baseData(), {
            additions: { subDistricts: [{ ...addition, reason: '' }] },
        })).toThrow(/reason/i);
    });
});

describe('the shipped correction set', () => {
    const { corrections } = require('../../data/thai-locations-corrections');
    const shipped = require('../../data/thai-locations-data.json');

    it('states a reason for every single row it edits', () => {
        for (const correction of corrections.subDistricts || []) {
            expect(typeof correction.reason).toBe('string');
            expect(correction.reason.trim().length).toBeGreaterThan(0);
        }
    });

    it('has already been applied to the shipped data', () => {
        // The JSON in the repo is the corrected artifact. If these two ever
        // drift, the file someone reviews is not the file the app serves.
        for (const correction of corrections.subDistricts || []) {
            const row = shipped.subDistricts.find((s) => s.code === correction.code);
            expect(row).toBeDefined();
            expect(row.nameTh).toBe(correction.nameTh);
        }
    });

    it('never leaves an อำเภอ name occupying a ตำบล slot of a different อำเภอ in บึงกาฬ', () => {
        // The specific fault that started this: บึงกาฬ was split off from
        // หนองคาย in 2554 and its codes were renumbered, which is where the
        // อำเภอ names leaked into ตำบล rows.
        const districts = shipped.districts.filter((d) => d.provinceCode === 38);
        const names = new Set(districts.map((d) => d.nameTh));
        const offenders = shipped.subDistricts
            .filter((s) => Math.floor(s.districtCode / 100) === 38)
            .filter((s) => names.has(s.nameTh))
            .filter((s) => {
                const same = districts.find((d) => d.nameTh === s.nameTh);
                return same.code !== s.districtCode;
            });
        expect(offenders).toEqual([]);
    });
});
