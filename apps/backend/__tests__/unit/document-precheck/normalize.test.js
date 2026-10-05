/**
 * Task 2 (document pre-check): pure Thai text helpers that Task 3's rules
 * depend on. No I/O, no DB, no OCR — just string/date functions.
 *
 * @see apps/backend/services/document-precheck/normalize.js
 */

const {
    thaiDigitsToArabic,
    composeSaraAm,
    stripToneMarks,
    normalizeKeyword,
    normalizeName,
    nameSimilarity,
    nameMatchLevel,
    NAME_SIMILARITY_MIN,
    findThirteenDigitIds,
    isValidThirteenDigitId,
    parseThaiDates,
    maskId,
} = require('../../../services/document-precheck/normalize');

describe('thaiDigitsToArabic', () => {
    test.each([
        ['๐๑๒๓', '0123'],
        ['๔๕๖๗๘๙', '456789'],
        ['เลข ๙๙', 'เลข 99'],
        ['already 123', 'already 123'],
    ])('%s -> %s', (input, expected) => {
        expect(thaiDigitsToArabic(input)).toBe(expected);
    });
});

describe('composeSaraAm', () => {
    test('NIKHAHIT + SARA AA composes to sara am', () => {
        expect(composeSaraAm('ทํา')).toBe('ทำ');
    });

    test('leaves an already-composed sara am untouched', () => {
        expect(composeSaraAm('น้ำ')).toBe('น้ำ');
    });
});

describe('stripToneMarks', () => {
    test('removes mai tho and other tone marks', () => {
        expect(stripToneMarks('น้ำ')).toBe(stripToneMarks('นำ'));
    });

    test('is a no-op on text with no tone marks', () => {
        expect(stripToneMarks('ทดสอบ')).toBe('ทดสอบ');
    });
});

describe('normalizeKeyword', () => {
    test('composes sara am, strips tone marks, converts digits, collapses whitespace', () => {
        expect(normalizeKeyword('  ทํา   ๙   ')).toBe('ทำ 9');
    });

    test('drops mai tho so a doc-type phrase still matches after OCR loses it', () => {
        expect(normalizeKeyword('น้ำ')).toBe(normalizeKeyword('นำ'));
    });
});

describe('normalizeName', () => {
    test('COMPANY: strips บริษัท/จำกัด affixes and whitespace', () => {
        expect(normalizeName('บริษัท ทดสอบ จำกัด', 'COMPANY')).toBe(normalizeName('ทดสอบ', 'COMPANY'));
    });

    test('COMPANY: strips (มหาชน) and ห้างหุ้นส่วนจำกัด', () => {
        expect(normalizeName('บริษัท ทดสอบ จำกัด (มหาชน)', 'COMPANY')).toBe(normalizeName('ทดสอบ', 'COMPANY'));
        expect(normalizeName('ห้างหุ้นส่วนจำกัด ทดสอบ', 'COMPANY')).toBe(normalizeName('ทดสอบ', 'COMPANY'));
    });

    test('PERSON: strips นาย/นาง/นางสาว leading titles', () => {
        expect(normalizeName('นางสาว สมหญิง ใจดี', 'PERSON')).toBe(normalizeName('สมหญิง ใจดี', 'PERSON'));
    });

    test('composes sara am but does NOT strip tone marks (name matching stays tone-sensitive)', () => {
        expect(normalizeName('ทํา', 'PERSON')).toBe('ทำ');
        expect(normalizeName('น้ำ', 'PERSON')).not.toBe(normalizeName('นำ', 'PERSON'));
    });

    test('throws when kind is missing or invalid (never silently mixes PERSON/COMPANY rules)', () => {
        expect(() => normalizeName('ทดสอบ')).toThrow(TypeError);
        expect(() => normalizeName('ทดสอบ', 'OTHER')).toThrow(TypeError);
    });

    // Fix round 1 (task-2-review.md, Critical #1): affix stripping used to
    // remove listed words wherever they occurred as a bare substring, so
    // "นาย" inside the unrelated word "นายทุน" (a person's given name, or
    // here, part of a company owner's name embedded in the company string)
    // was stripped as if it were the title นาย. Word boundary in Thai is
    // positional (leading/trailing), not delimiter-based.
    describe('fix round 1 — affix stripping is positional, not substring-anywhere', () => {
        test('COMPANY keeps a name that contains "นาย" as running text, not a title', () => {
            expect(normalizeName('บริษัท นายทุน จำกัด', 'COMPANY')).toBe('นายทุน');
        });

        test('PERSON strips only the LEADING title, even when the given name itself starts with a title word', () => {
            expect(normalizeName('นาย นายทุน', 'PERSON')).toBe('นายทุน');
        });

        test('PERSON strips นางสาว glued directly to the name (no space)', () => {
            expect(normalizeName('นางสาวสมหญิง', 'PERSON')).toBe('สมหญิง');
        });

        test('COMPANY never touches person titles — a company name starting with a title-shaped word is untouched', () => {
            expect(normalizeName('นายกรัฐมนตรี จำกัด', 'COMPANY')).toBe('นายกรัฐมนตรี');
        });
    });
});

describe('nameSimilarity', () => {
    test('near-identical OCR variants score >= 0.85', () => {
        expect(nameSimilarity('ทดสอบพร้อมเพย์', 'ทดสอบพรอมเพย์', 'PERSON')).toBeGreaterThanOrEqual(0.85);
    });

    test('identical names score 1', () => {
        expect(nameSimilarity('สมชาย ใจดี', 'สมชาย ใจดี', 'PERSON')).toBe(1);
    });

    test('unrelated names score well under the threshold', () => {
        expect(nameSimilarity('สมชาย ใจดี', 'วิชัย ยิ้มแย้ม', 'PERSON')).toBeLessThan(0.5);
    });
});

describe('NAME_SIMILARITY_MIN', () => {
    test('is 0.85 (set from the Task 9 corpus)', () => {
        expect(NAME_SIMILARITY_MIN).toBe(0.85);
    });
});

describe('nameMatchLevel', () => {
    test('EXACT when normalized names are equal', () => {
        expect(nameMatchLevel('บริษัท ทดสอบ จำกัด', 'ทดสอบ', 'COMPANY')).toBe('EXACT');
    });

    test('TONE_ONLY when names are equal only after stripping tone marks', () => {
        expect(nameMatchLevel('น้ำใจ', 'นำใจ', 'PERSON')).toBe('TONE_ONLY');
    });

    test('CLOSE for a high-similarity OCR variant that is not tone-only', () => {
        expect(nameMatchLevel('ทดสอบพร้อมเพย์', 'ทดสอบพรอมเพย', 'PERSON')).toBe('CLOSE');
    });

    test('DIFFERENT for unrelated names', () => {
        expect(nameMatchLevel('สมชาย ใจดี', 'วิชัย ยิ้มแย้ม', 'PERSON')).toBe('DIFFERENT');
    });

    // Fix round 1 — the review's headline downstream symptom of Critical #1.
    test('fix round 1: a company name embedding "นายทุน" is NOT EXACT against the unrelated name "ทุน จำกัด"', () => {
        expect(nameMatchLevel('บริษัท นายทุน จำกัด', 'ทุน จำกัด', 'COMPANY')).toBe('DIFFERENT');
    });
});

describe('findThirteenDigitIds', () => {
    test('reads Thai digits with dashes/spaces between groups', () => {
        expect(findThirteenDigitIds('เลข ๐-๑๐๕๕-๖๘๐๔๕-๙๓-๒')).toEqual(['0105568045932']);
    });

    test('reads arabic digits with dashes', () => {
        expect(findThirteenDigitIds('0-1055-68045-93-2')).toEqual(['0105568045932']);
    });

    test('ignores runs that are not exactly 13 digits', () => {
        expect(findThirteenDigitIds('เลขที่ 12/2569 จำนวน 5 ชุด')).toEqual([]);
    });

    test('returns [] on text with no digits', () => {
        expect(findThirteenDigitIds('ไม่มีเลข')).toEqual([]);
    });

    // Fix round 1 (task-2-review.md, Important #4): any run of
    // digits/dashes/spaces that happened to total 13 digits used to be
    // accepted, so an unrelated 4-digit number and 9-digit number separated
    // by a single space concatenated into a false 13-digit candidate.
    describe('fix round 1 — only the real 1-4-5-2-1 grouping is accepted, not any join', () => {
        test('a 4-digit number and an unrelated 9-digit number separated by a space is NOT one id', () => {
            expect(findThirteenDigitIds('เลขที่ 1234 567890123')).toEqual([]);
        });

        test('space-separated grouping (1-4-5-2-1) is still accepted', () => {
            expect(findThirteenDigitIds('0 1055 68045 93 2')).toEqual(['0105568045932']);
        });

        test('a 15-digit contiguous run is not mistaken for a 13-digit id', () => {
            expect(findThirteenDigitIds('123456789012345')).toEqual([]);
        });
    });
});

describe('isValidThirteenDigitId', () => {
    test('the platform company\'s own public tax id passes Mod-11', () => {
        expect(isValidThirteenDigitId('0105568045932')).toBe(true);
    });

    test('a tampered last digit fails', () => {
        expect(isValidThirteenDigitId('0105568045939')).toBe(false);
    });

    test('wrong length fails', () => {
        expect(isValidThirteenDigitId('123')).toBe(false);
    });
});

describe('parseThaiDates', () => {
    test('full Thai month name + พ.ศ. year', () => {
        const dates = parseThaiDates('ออกให้ ณ วันที่ 27 กันยายน พ.ศ. 2569');
        expect(dates).toHaveLength(1);
        expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
    });

    test('abbreviated Thai month + 2-digit BE year, same result', () => {
        const dates = parseThaiDates('27 ก.ย. 69');
        expect(dates).toHaveLength(1);
        expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
    });

    test('d/m/yyyy with a BE year (>2400) converts to CE', () => {
        const dates = parseThaiDates('27/9/2569');
        expect(dates).toHaveLength(1);
        expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
    });

    test('d/m/yyyy with a year already <=2400 is taken as CE, no conversion', () => {
        const dates = parseThaiDates('27/9/2026');
        expect(dates).toHaveLength(1);
        expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
    });

    test('Thai digits in a date are read', () => {
        const dates = parseThaiDates('๒๗ กันยายน พ.ศ. ๒๕๖๙');
        expect(dates).toHaveLength(1);
        expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
    });

    test('no date in text returns []', () => {
        expect(parseThaiDates('ไม่มีวันที่ในข้อความนี้')).toEqual([]);
    });

    // Fix round 1 (task-2-review.md, Critical #2): the Thai-month path
    // always subtracted 543, so a plain CE year paired with a Thai month
    // name silently became a garbage date ~543 years in the past.
    describe('fix round 1 — one year rule on every path (2-digit BE / >2400 BE / 1900-2400 CE)', () => {
        test('Thai month name + a 4-digit CE year (no พ.ศ.) is read as CE, not BE', () => {
            const dates = parseThaiDates('27 กันยายน 2026');
            expect(dates).toHaveLength(1);
            expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
        });

        test('Thai month name + พ.ศ. and a 4-digit BE year (>2400) converts to CE', () => {
            const dates = parseThaiDates('27 กันยายน พ.ศ. 2569');
            expect(dates).toHaveLength(1);
            expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
        });

        test('a 2-digit year is read as BE 25xx on the month-name path', () => {
            const dates = parseThaiDates('27 ก.ย. 69');
            expect(dates).toHaveLength(1);
            expect(dates[0].toISOString()).toBe(new Date('2026-09-26T17:00:00.000Z').toISOString());
        });

        test('a year outside every defined bucket (e.g. a bare 3-digit year) is dropped, not guessed at', () => {
            expect(parseThaiDates('27 กันยายน พ.ศ. 999')).toEqual([]);
        });
    });

    // Fix round 1 (task-2-review.md, Critical #3): an invalid day-of-month
    // used to silently roll into the next month instead of being rejected.
    describe('fix round 1 — invalid calendar days are dropped, not rolled forward', () => {
        test('31 กุมภาพันธ์ (February never has 31 days) is dropped', () => {
            expect(parseThaiDates('31 กุมภาพันธ์ พ.ศ. 2569')).toEqual([]);
        });

        test('29 กุมภาพันธ์ 2567 (BE 2567 -> CE 2024, a real leap year) is valid', () => {
            const dates = parseThaiDates('29 กุมภาพันธ์ พ.ศ. 2567');
            expect(dates).toHaveLength(1);
            expect(dates[0].toISOString()).toBe(new Date('2024-02-28T17:00:00.000Z').toISOString());
        });

        test('29 กุมภาพันธ์ 2569 (BE 2569 -> CE 2026, NOT a leap year) is dropped', () => {
            expect(parseThaiDates('29 กุมภาพันธ์ พ.ศ. 2569')).toEqual([]);
        });

        test('31 เมษายน (April has only 30 days) is dropped', () => {
            expect(parseThaiDates('31 เมษายน พ.ศ. 2569')).toEqual([]);
        });
    });
});

describe('maskId', () => {
    test('keeps only the last 4 digits, everything else becomes an ellipsis', () => {
        expect(maskId('0105568045932')).toBe('…5932');
    });

    test('strips dashes before masking', () => {
        expect(maskId('0-1055-68045-93-2')).toBe('…5932');
    });

    // Fix round 1 (task-2-review.md, Minor #5) — pin, not a fix: the brief
    // does not define behaviour under 4 digits, and an input this short
    // shows its entire id under the ellipsis (nothing is actually hidden).
    // Documented here as current behaviour for the next reviewer to decide.
    test('an id shorter than 4 digits shows in full under the mask (documented, unresolved)', () => {
        expect(maskId('12')).toBe('…12');
        expect(maskId('')).toBe('…');
    });
});
