/**
 * Task 3 (document pre-check): the pure rule layer — `catalog.js`,
 * `rules/*.js` and `evaluate.js`. No I/O, no DB, no OCR.
 *
 * @see apps/backend/services/document-precheck/evaluate.js
 * @see apps/backend/services/document-precheck/catalog.js
 */

const { evaluate, OCR_CONFIDENCE_MIN, NAME_SIMILARITY_MIN } = require('../../../services/document-precheck/evaluate');
const { CATALOG } = require('../../../services/document-precheck/catalog');
const { checkReadability } = require('../../../services/document-precheck/rules/readability');
const { DOCUMENT_SLOTS } = require('../../../constants/document-slots');
const { startOfLocalCalendarDay, endOfLocalDay } = require('../../../utils/working-days');

const LAND_DEED = DOCUMENT_SLOTS.LAND_DEED.slotId;
const LAND_LEASE = DOCUMENT_SLOTS.LAND_LEASE.slotId;
const COMPANY_REG = DOCUMENT_SLOTS.COMPANY_REG.slotId;
const ID_CARD = DOCUMENT_SLOTS.ID_CARD.slotId;

/** The platform company's own real tax id (thai-id-checksum.js) — a valid checksum. */
const VALID_ID_A = '0105568045932';
/** DTAM's own real registration number (thai-id-checksum.js) — a different valid checksum. */
const VALID_ID_B = '0994000036540';

function textExtraction(text, overrides) {
    return {
        method: 'TEXT_LAYER',
        pageCount: 1,
        pages: [{ text, confidence: 100 }],
        ...overrides,
    };
}

function unreadableExtraction() {
    return { method: 'OCR', pageCount: 1, pages: [{ text: '', confidence: 80 }] };
}

function flagFor(flags, check) {
    return flags.find((f) => f.check === check);
}

const NOW = new Date('2026-09-27T04:00:00.000Z'); // 11:00 Bangkok, an ordinary "now" for non-validity tests

describe('constants', () => {
    test('OCR_CONFIDENCE_MIN is 60 (set from the Task 9 corpus)', () => {
        expect(OCR_CONFIDENCE_MIN).toBe(60);
    });

    test('NAME_SIMILARITY_MIN is re-exported from normalize.js, not a second constant', () => {
        expect(NAME_SIMILARITY_MIN).toBe(0.85);
    });

    test('CATALOG has an entry, with a source, for exactly the 7 canonical slots', () => {
        const expectedSlots = [
            DOCUMENT_SLOTS.LAND_DEED.slotId,
            DOCUMENT_SLOTS.LAND_LEASE.slotId,
            DOCUMENT_SLOTS.LAND_CONSENT.slotId,
            DOCUMENT_SLOTS.COMPANY_REG.slotId,
            DOCUMENT_SLOTS.ID_CARD.slotId,
            DOCUMENT_SLOTS.HOUSE_REG.slotId,
            DOCUMENT_SLOTS.PREVIOUS_CERT.slotId,
        ];
        expect(Object.keys(CATALOG).sort()).toEqual(expectedSlots.sort());
        for (const slotId of expectedSlots) {
            expect(typeof CATALOG[slotId].source).toBe('string');
            expect(CATALOG[slotId].source.length).toBeGreaterThan(0);
        }
    });

    test('only company_reg carries a validity rule, exactly maxAgeMonths 6 / facts.md:50', () => {
        expect(CATALOG[COMPANY_REG].validity).toEqual({ maxAgeMonths: 6, source: 'facts.md:50' });
        const others = Object.keys(CATALOG).filter((id) => id !== COMPANY_REG);
        for (const slotId of others) {
            expect(CATALOG[slotId].validity).toBeUndefined();
        }
    });

    test('evaluate() throws for a slotId outside the 7-slot CATALOG scope', () => {
        expect(() => evaluate({ extraction: textExtraction('x'), reference: {}, slotId: 'sop_cultivation', now: NOW })).toThrow(
            TypeError,
        );
    });

    // I1 (task-3-review.md): the any-of combine for land documents is a
    // declared CATALOG fact, not a hidden default — see catalog.js.
    test('I1: land_deed/land_lease/land_consent declare referenceCombine ANY; every other slot is the ALL default', () => {
        const anySlots = [
            DOCUMENT_SLOTS.LAND_DEED.slotId,
            DOCUMENT_SLOTS.LAND_LEASE.slotId,
            DOCUMENT_SLOTS.LAND_CONSENT.slotId,
        ];
        for (const slotId of anySlots) {
            expect(CATALOG[slotId].referenceCombine).toBe('ANY');
        }
        const allSlots = Object.keys(CATALOG).filter((id) => !anySlots.includes(id));
        for (const slotId of allSlots) {
            expect(CATALOG[slotId].referenceCombine).not.toBe('ANY');
        }
    });
});

describe('READABILITY', () => {
    test('PASS: readable text, no page-count rule configured for this slot', () => {
        const flags = evaluate({
            extraction: textExtraction('โฉนดที่ดิน เลขที่ 12345'),
            reference: {},
            slotId: LAND_DEED,
            now: NOW,
        });
        expect(flagFor(flags, 'READABILITY').result).toBe('PASS');
    });

    test('UNREADABLE: empty extracted text', () => {
        const flags = evaluate({ extraction: unreadableExtraction(), reference: {}, slotId: LAND_DEED, now: NOW });
        expect(flagFor(flags, 'READABILITY').result).toBe('UNREADABLE');
    });

    test('UNREADABLE: OCR confidence below OCR_CONFIDENCE_MIN', () => {
        const flags = evaluate({
            extraction: { method: 'OCR', pageCount: 1, pages: [{ text: 'บางอย่างที่อ่านยาก', confidence: 10 }] },
            reference: {},
            slotId: LAND_DEED,
            now: NOW,
        });
        expect(flagFor(flags, 'READABILITY').result).toBe('UNREADABLE');
    });

    // No slot in the real CATALOG has a sourced `expectedPages` (catalog.js's
    // module doc comment) — this branch is real code with no real caller yet,
    // so it is pinned directly against `rules/readability.js` with a synthetic
    // catalog entry, not through evaluate() against production CATALOG.
    test('PAGE_COUNT: pinned directly against a synthetic catalog entry (no production slot has this rule)', () => {
        const flag = checkReadability(textExtraction('เนื้อหา', { pageCount: 5 }), { expectedPages: 3 });
        expect(flag.result).toBe('PAGE_COUNT');
    });
});

describe('DOC_TYPE', () => {
    test('MATCH: the sourced phrase appears in the text', () => {
        const flags = evaluate({
            extraction: textExtraction('สำเนาโฉนดที่ดิน เลขที่ 12345 ตำบล...'),
            reference: {},
            slotId: LAND_DEED,
            now: NOW,
        });
        expect(flagFor(flags, 'DOC_TYPE').result).toBe('MATCH');
    });

    test('NOT_FOUND: readable, but none of the sourced phrases appear', () => {
        const flags = evaluate({
            extraction: textExtraction('เอกสารอื่นที่ไม่เกี่ยวข้องกับที่ดินเลย'),
            reference: {},
            slotId: LAND_DEED,
            now: NOW,
        });
        expect(flagFor(flags, 'DOC_TYPE').result).toBe('NOT_FOUND');
    });

    test('UNREADABLE: an unreadable document is UNREADABLE, never NOT_FOUND', () => {
        const flags = evaluate({ extraction: unreadableExtraction(), reference: {}, slotId: LAND_DEED, now: NOW });
        expect(flagFor(flags, 'DOC_TYPE').result).toBe('UNREADABLE');
    });

    // I5 (task-3-review.md): an unsourced criterion must not run at all — the
    // spec's own rule is "เกณฑ์ที่หาที่มาไม่ได้จะไม่ตรวจ". land_lease has no
    // sourced phrase (catalog.js), so it must carry NO DOC_TYPE flag — not a
    // NOT_FOUND flag, which would read to an officer/applicant exactly like a
    // wrong-document warning on every single upload.
    test('I5: land_lease has no sourced phrase, so evaluate() emits NO DOC_TYPE flag at all', () => {
        const flags = evaluate({
            extraction: textExtraction('สำเนาโฉนดที่ดิน เลขที่ 12345'),
            reference: {},
            slotId: LAND_LEASE,
            now: NOW,
        });
        expect(flagFor(flags, 'DOC_TYPE')).toBeUndefined();
    });

    // I4 (task-3-review.md): §3 asks for "จับคู่แบบคลาดเคลื่อนได้เล็กน้อยเพื่อรับ
    // OCR ที่เพี้ยน" — an inserted space or one wrong character must still MATCH.
    describe('I4: fuzzy tolerance for OCR noise', () => {
        test('an OCR-inserted space inside the phrase still MATCHes', () => {
            const flags = evaluate({
                extraction: textExtraction('สำเนาโฉนด ที่ดิน เลขที่ 12345'),
                reference: {},
                slotId: LAND_DEED,
                now: NOW,
            });
            expect(flagFor(flags, 'DOC_TYPE').result).toBe('MATCH');
        });

        test('one OCR-wrong character still MATCHes', () => {
            const flags = evaluate({
                extraction: textExtraction('สำเนาโฉนดที่ดีน เลขที่ 12345'), // ดิน -> ดีน
                reference: {},
                slotId: LAND_DEED,
                now: NOW,
            });
            expect(flagFor(flags, 'DOC_TYPE').result).toBe('MATCH');
        });

        test('a Thai-digit "๓" with an OCR-inserted space still MATCHes the printed "น.ส.3"', () => {
            const flags = evaluate({
                extraction: textExtraction('น.ส. ๓ เลขที่ 12345'),
                reference: {},
                slotId: LAND_DEED,
                now: NOW,
            });
            expect(flagFor(flags, 'DOC_TYPE').result).toBe('MATCH');
        });

        test('a clearly different document is still NOT_FOUND — the tolerance is small, not unlimited', () => {
            const flags = evaluate({
                extraction: textExtraction('สัญญาซื้อขายรถยนต์มือสอง เลขที่ 99999'),
                reference: {},
                slotId: LAND_DEED,
                now: NOW,
            });
            expect(flagFor(flags, 'DOC_TYPE').result).toBe('NOT_FOUND');
        });
    });

    // N1 (task-3-rereview-1.md): the ±1 edit tolerance let a SHORT phrase
    // match unrelated text — deleting one character turns "น.ส." (the title
    // for Miss) into a hit for the short phrase "น.ส.3". Fix: phrases under
    // ~8 compact characters get no edit tolerance at all, only exact
    // containment after normalization.
    describe('N1: short phrases get no edit tolerance', () => {
        test('an ID card naming a "น.ส." (Miss) is NOT_FOUND in LAND_DEED, not a false MATCH on "น.ส.3"', () => {
            const flags = evaluate({
                extraction: textExtraction('สำเนาบัตรประจำตัวประชาชน ชื่อ น.ส. สมศรี ใจดี'),
                reference: {},
                slotId: LAND_DEED,
                now: NOW,
            });
            expect(flagFor(flags, 'DOC_TYPE').result).toBe('NOT_FOUND');
        });

        test('a receipt naming a "น.ส." is NOT_FOUND in LAND_DEED', () => {
            const flags = evaluate({
                extraction: textExtraction('ใบเสร็จรับเงิน น.ส.มาลี ใจดี ชำระเงิน 500 บาท'),
                reference: {},
                slotId: LAND_DEED,
                now: NOW,
            });
            expect(flagFor(flags, 'DOC_TYPE').result).toBe('NOT_FOUND');
        });

        test('"น.ส. ๓" (Thai digit + OCR space) still MATCHes — exact containment after normalization needs no tolerance', () => {
            const flags = evaluate({
                extraction: textExtraction('น.ส. ๓ เลขที่ 12345'),
                reference: {},
                slotId: LAND_DEED,
                now: NOW,
            });
            expect(flagFor(flags, 'DOC_TYPE').result).toBe('MATCH');
        });
    });
});

describe('CROSS_MATCH', () => {
    test('MATCH: name and citizen-id-last-4 both found in the document', () => {
        const flags = evaluate({
            extraction: textExtraction(`สำเนาบัตรประจำตัวประชาชน ชื่อ สมชาย ใจดี เลขประจำตัว ${VALID_ID_A}`),
            reference: { applicantName: 'สมชาย ใจดี', citizenIdLast4: VALID_ID_A.slice(-4) },
            slotId: ID_CARD,
            now: NOW,
        });
        expect(flagFor(flags, 'CROSS_MATCH').result).toBe('MATCH');
    });

    test('MISMATCH: name matches but the citizen id in the document does not end in the expected last 4', () => {
        const flags = evaluate({
            extraction: textExtraction(`สำเนาบัตรประจำตัวประชาชน ชื่อ สมชาย ใจดี เลขประจำตัว ${VALID_ID_A}`),
            reference: { applicantName: 'สมชาย ใจดี', citizenIdLast4: VALID_ID_B.slice(-4) },
            slotId: ID_CARD,
            now: NOW,
        });
        const flag = flagFor(flags, 'CROSS_MATCH');
        expect(flag.result).toBe('MISMATCH');
        // decision 3 (task-3-brief.md): the id that WAS found is shown, masked.
        expect(flag.evidenceSnippet).toBe(`…${VALID_ID_A.slice(-4)}`);
    });

    test('cross-match-missing-reference: an individual with no Entity yields NOT_FOUND, never MISMATCH', () => {
        const flags = evaluate({
            extraction: textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ...'),
            reference: { entityType: 'INDIVIDUAL' }, // no entityName / juristicId / directorName
            slotId: COMPANY_REG,
            now: NOW,
        });
        expect(flagFor(flags, 'CROSS_MATCH').result).toBe('NOT_FOUND');
    });

    test('unreadable-short-circuits: DOC_TYPE is UNREADABLE and CROSS_MATCH is NOT_FOUND, even with full reference data on file', () => {
        const flags = evaluate({
            extraction: unreadableExtraction(),
            reference: { entityName: 'บริษัท ทดสอบ จำกัด', juristicId: VALID_ID_A, directorName: 'สมชาย ใจดี' },
            slotId: COMPANY_REG,
            now: NOW,
        });
        expect(flagFor(flags, 'READABILITY').result).toBe('UNREADABLE');
        expect(flagFor(flags, 'DOC_TYPE').result).toBe('UNREADABLE');
        expect(flagFor(flags, 'CROSS_MATCH').result).toBe('NOT_FOUND');
    });

    // I5 (task-3-review.md): previous_cert has an EMPTY `reference` list in
    // catalog.js (no source for what a prior certificate's content compares
    // against) — an unsourced criterion must emit no flag at all, the same
    // way validity already omits its flag for slots with no validity rule.
    test('I5: previous_cert has no sourced reference field, so evaluate() emits NO CROSS_MATCH flag at all', () => {
        const flags = evaluate({
            extraction: textExtraction('ใบรับรอง GACP เดิม ...'),
            reference: { applicantName: 'สมชาย ใจดี', entityName: 'บริษัท ทดสอบ จำกัด' },
            slotId: DOCUMENT_SLOTS.PREVIOUS_CERT.slotId,
            now: NOW,
        });
        expect(flagFor(flags, 'CROSS_MATCH')).toBeUndefined();
    });

    // C1 (task-3-review.md, Critical): a substring search on whitespace-
    // stripped text has no word boundary, so a tone-differing name or a name
    // that is a prefix of another name both read as EXACT. "TONE_ONLY must
    // never become MATCH" (decision 2, task-3-brief.md) is the rule broken.
    // Every case below is one of the reviewer's own probe pairs, which the
    // review confirms against `normalize.nameMatchLevel` directly.
    describe('C1: name matching respects word boundaries and normalize.nameMatchLevel\'s own TONE_ONLY/CLOSE/DIFFERENT classification', () => {
        test('a trailing tone mark is TONE_ONLY -> MISMATCH, never MATCH', () => {
            const flags = evaluate({
                extraction: textExtraction('สำเนาบัตรประจำตัวประชาชน ชื่อ นายสมชาย ใจดี้'), // ใจดี้ vs ใจดี
                reference: { applicantName: 'นายสมชาย ใจดี' },
                slotId: ID_CARD,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).toBe('MISMATCH');
        });

        test('a mid-word tone mark is TONE_ONLY -> MISMATCH, never MATCH', () => {
            const flags = evaluate({
                extraction: textExtraction('สำเนาบัตรประจำตัวประชาชน ชื่อ นายสมชาย ปิ้นแก้ว'), // ปิ้นแก้ว vs ปิ่นแก้ว
                reference: { applicantName: 'นายสมชาย ปิ่นแก้ว' },
                slotId: ID_CARD,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).toBe('MISMATCH');
        });

        test('a high-similarity OCR variant that is CLOSE (not tone-only) -> MATCH', () => {
            const flags = evaluate({
                extraction: textExtraction('สำเนาบัตรประจำตัวประชาชน ชื่อ ทดสอบพรอมเพย'), // missing ้ and ์
                reference: { applicantName: 'ทดสอบพร้อมเพย์' },
                slotId: ID_CARD,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).toBe('MATCH');
        });

        test('a name that is a prefix of a different, longer name found in the document is not MATCH', () => {
            const flags = evaluate({
                extraction: textExtraction('สำเนาบัตรประจำตัวประชาชน ชื่อ นายสมศักดิ์ ทองดี'),
                reference: { applicantName: 'นายสมศักดิ์ ทอง' },
                slotId: ID_CARD,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).not.toBe('MATCH');
        });

        test('a short company name is not MATCH merely for being a substring of an unrelated word ("ทุน" inside "ทุนจดทะเบียน")', () => {
            const flags = evaluate({
                extraction: textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ทุนจดทะเบียน 1,000,000 บาท'),
                reference: { entityName: 'บริษัท ทุน จำกัด' },
                slotId: COMPANY_REG,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).not.toBe('MATCH');
        });
    });

    // N3 (task-3-rereview-1.md): a name pair could never be NOT_FOUND, so OCR
    // spacing artifacts (a label glued to the name, a whole line glued with
    // no spaces, or a name over-split into per-syllable tokens) all became a
    // definite "ไม่ตรง" MISMATCH — a false accusation, the same class I2
    // fixed for ids. Fix: NOT_FOUND when nothing reaches at least TONE_ONLY;
    // MISMATCH stays reserved for TONE_ONLY (a real, same-letters,
    // different-tone name). The C1 probes above must stay unchanged.
    describe('N3: OCR-glued name text is MATCH or NOT_FOUND, never a false MISMATCH', () => {
        test('a label glued to the title with no space ("ชื่อนายสมชาย ใจดี")', () => {
            const flags = evaluate({
                extraction: textExtraction('ชื่อนายสมชาย ใจดี'),
                reference: { applicantName: 'นายสมชาย ใจดี' },
                slotId: ID_CARD,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).not.toBe('MISMATCH');
        });

        test('a whole line glued with no spaces at all ("ชื่อนายสมชายใจดีเกิดวันที่")', () => {
            const flags = evaluate({
                extraction: textExtraction('ชื่อนายสมชายใจดีเกิดวันที่ 1 มกราคม 2560'),
                reference: { applicantName: 'นายสมชาย ใจดี' },
                slotId: ID_CARD,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).not.toBe('MISMATCH');
        });

        test('OCR over-splits the name into more tokens than expected+1 ("นาย สม ชาย ใจ ดี")', () => {
            const flags = evaluate({
                extraction: textExtraction('นาย สม ชาย ใจ ดี'),
                reference: { applicantName: 'นายสมชาย ใจดี' },
                slotId: ID_CARD,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).not.toBe('MISMATCH');
        });
    });

    // I1 (task-3-review.md, Important): §8 says a land document's holder name
    // is compared with the applicant's name OR the company's name — any-of,
    // not all-of. Companies always hold the certificate, so an entity is
    // almost always on file; all-of would false-MISMATCH every land document.
    test('I1: a deed held by the company, with the (unrelated) applicant person also on file, is MATCH via any-of', () => {
        const flags = evaluate({
            extraction: textExtraction('โฉนดที่ดิน ผู้ถือกรรมสิทธิ์ บริษัท ทดสอบ จำกัด'),
            reference: { applicantName: 'สมหญิง ไม่เกี่ยวข้อง', entityName: 'บริษัท ทดสอบ จำกัด' },
            slotId: LAND_DEED,
            now: NOW,
        });
        expect(flagFor(flags, 'CROSS_MATCH').result).toBe('MATCH');
    });

    // I2 (task-3-review.md, Important): a readable document where the id is
    // simply ABSENT must be NOT_FOUND — MISMATCH is reserved for "a different
    // valid id was actually found".
    describe('I2: absent-from-document vs. found-but-different, for ids', () => {
        test('no 13-digit id anywhere in the text, with a juristicId on file -> NOT_FOUND, not MISMATCH', () => {
            const flags = evaluate({
                extraction: textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ไม่มีเลขทะเบียนในเอกสารนี้'),
                reference: { juristicId: VALID_ID_A },
                slotId: COMPANY_REG,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).toBe('NOT_FOUND');
        });

        test('a different, valid-checksum id IS found -> MISMATCH', () => {
            const flags = evaluate({
                extraction: textExtraction(`หนังสือรับรองการจดทะเบียนนิติบุคคล เลขทะเบียน ${VALID_ID_B}`),
                reference: { juristicId: VALID_ID_A },
                slotId: COMPANY_REG,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').result).toBe('MISMATCH');
        });
    });

    // Task 10 copy sweep: a NOT_FOUND reason is read by the applicant as well as
    // the officer (Task 7 serves reasonTH to both), so it states what happens
    // next rather than instructing the officer.
    describe('Task 10: NOT_FOUND reasons read the same to the applicant and the officer', () => {
        test('nothing to compare found in the document', () => {
            const flags = evaluate({
                extraction: textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ไม่มีเลขทะเบียนในเอกสารนี้'),
                reference: { juristicId: VALID_ID_A },
                slotId: COMPANY_REG,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').reasonTH).toBe('ไม่พบข้อมูลที่จะเทียบในเอกสารนี้ เจ้าหน้าที่จะตรวจสอบเพิ่มเติม');
        });

        test('no applicant data on file for this slot', () => {
            const flags = evaluate({
                extraction: textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ...'),
                reference: { entityType: 'INDIVIDUAL' },
                slotId: COMPANY_REG,
                now: NOW,
            });
            expect(flagFor(flags, 'CROSS_MATCH').reasonTH).toBe('ไม่มีข้อมูลผู้ยื่นให้เทียบสำหรับช่องนี้ เจ้าหน้าที่จะตรวจสอบเพิ่มเติม');
        });
    });
});

describe('VALIDITY (company_reg only)', () => {
    // Bangkok calendar days throughout — see rules/validity.js.
    const issuedBangkok = startOfLocalCalendarDay(2026, 1, 1); // 1 มกราคม 2569 (BE)
    const exactlySixMonthsLater = startOfLocalCalendarDay(2026, 7, 1); // start of the boundary day itself
    const oneDayOverSixMonths = startOfLocalCalendarDay(2026, 7, 2);

    function companyRegExtraction() {
        return textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ออกให้ ณ วันที่ 1 มกราคม พ.ศ. 2569');
    }

    test('PASS: exactly 6 months after issuance', () => {
        const flags = evaluate({
            extraction: companyRegExtraction(),
            reference: {},
            slotId: COMPANY_REG,
            now: exactlySixMonthsLater,
        });
        const flag = flagFor(flags, 'VALIDITY');
        expect(flag.result).toBe('PASS');
        // M1 (task-3-review.md): thai-ui-copy requires Buddhist-era dates in
        // user-facing text, never a Gregorian ISO string.
        expect(flag.reasonTH).toMatch('2569');
        expect(flag.reasonTH).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    test('EXPIRED: one day past the 6-month boundary', () => {
        const flags = evaluate({
            extraction: companyRegExtraction(),
            reference: {},
            slotId: COMPANY_REG,
            now: oneDayOverSixMonths,
        });
        const flag = flagFor(flags, 'VALIDITY');
        expect(flag.result).toBe('EXPIRED');
        expect(flag.reasonTH).toMatch('2569');
        expect(flag.reasonTH).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    test('DATE_NOT_FOUND: no date at all in the text', () => {
        const flags = evaluate({
            extraction: textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ไม่มีวันที่'),
            reference: {},
            slotId: COMPANY_REG,
            now: NOW,
        });
        expect(flagFor(flags, 'VALIDITY').result).toBe('DATE_NOT_FOUND');
    });

    // I3 (task-3-review.md, Important): the OLD rule ("use the earliest date
    // found") reads a real certificate's registration date instead of its
    // issue date, so every company older than 6 months would get a false
    // EXPIRED. The fix anchors on the "ออกให้ ณ วันที่" label.
    test('I3: registered 2560, issued 1 ก.ย. 2569 — the LABELED issue date is used, not the earlier registration date', () => {
        const flags = evaluate({
            extraction: textExtraction(
                'จดทะเบียนเมื่อวันที่ 15 มีนาคม พ.ศ. 2560 ' +
                    'หนังสือรับรองการจดทะเบียนนิติบุคคล ออกให้ ณ วันที่ 1 กันยายน พ.ศ. 2569',
            ),
            reference: {},
            slotId: COMPANY_REG,
            now: NOW, // 2026-09-27, well within 6 months of 2026-09-01
        });
        expect(flagFor(flags, 'VALIDITY').result).toBe('PASS');
    });

    test('I3: several dates found and NONE is labeled -> DATE_NOT_FOUND, not a guess', () => {
        const flags = evaluate({
            extraction: textExtraction('จดทะเบียนเมื่อวันที่ 15 มีนาคม พ.ศ. 2560 ตรวจสอบล่าสุดวันที่ 1 กันยายน พ.ศ. 2569'),
            reference: {},
            slotId: COMPANY_REG,
            now: NOW,
        });
        expect(flagFor(flags, 'VALIDITY').result).toBe('DATE_NOT_FOUND');
    });

    // N2 (task-3-rereview-1.md): when the label is present but the date right
    // after it fails to parse (OCR-garbled digits), the old code fell back to
    // "the single unlabeled date" — which is the registration date — and gave
    // a false EXPIRED again. A wide window could also bind a LATER, unrelated
    // labeled date instead of the garbled one. Fix: once the label is found,
    // commit to it — only a date immediately after it counts, and a failure
    // to parse there is DATE_NOT_FOUND, with no fallback of any kind.
    describe('N2: a found label commits — no fallback to an unlabeled or a far-away date', () => {
        test('the date right after the label is OCR-garbled ("l กันยายน 2S69") -> DATE_NOT_FOUND, not the registration date', () => {
            const flags = evaluate({
                extraction: textExtraction(
                    'หนังสือรับรองการจดทะเบียนนิติบุคคล จดทะเบียนเมื่อวันที่ 5 มกราคม 2560 ' +
                        'ออกให้ ณ วันที่ l กันยายน 2S69',
                ),
                reference: {},
                slotId: COMPANY_REG,
                now: NOW,
            });
            expect(flagFor(flags, 'VALIDITY').result).toBe('DATE_NOT_FOUND');
        });

        test('a later, unrelated dated line must not bind through the label -> DATE_NOT_FOUND', () => {
            const flags = evaluate({
                extraction: textExtraction('หนังสือรับรองการจดทะเบียนนิติบุคคล ออกให้ ณ วันที่ ...... ลงวันที่ 5 มกราคม 2560'),
                reference: {},
                slotId: COMPANY_REG,
                now: NOW,
            });
            expect(flagFor(flags, 'VALIDITY').result).toBe('DATE_NOT_FOUND');
        });
    });

    test('no VALIDITY flag at all for a slot with no validity rule (land_deed)', () => {
        const flags = evaluate({ extraction: textExtraction('โฉนดที่ดิน'), reference: {}, slotId: LAND_DEED, now: NOW });
        expect(flagFor(flags, 'VALIDITY')).toBeUndefined();
    });

    // Final review I4: the deadline is the same day-number six months on, but
    // a day the target month does not have is clamped to that month's last
    // day (ป.พ.พ. ม.193/5 วรรคท้าย). Before the fix, 31 ส.ค. rolled on to
    // 3 มี.ค. (Date.UTC's overflow), so 1–3 มี.ค. read PASS.
    describe('I4: a deadline day the target month does not have is its last day, never the next month', () => {
        function issuedOn(thaiDate) {
            return textExtraction(`หนังสือรับรองการจดทะเบียนนิติบุคคล ออกให้ ณ วันที่ ${thaiDate}`);
        }
        function validityAt(thaiDate, now) {
            return flagFor(evaluate({ extraction: issuedOn(thaiDate), reference: {}, slotId: COMPANY_REG, now }), 'VALIDITY').result;
        }

        test.each([
            // [issued, last PASS day (y, m, d), first EXPIRED day (y, m, d)]
            ['31 สิงหาคม พ.ศ. 2568', [2026, 2, 28], [2026, 3, 1]], // 28 ก.พ. 2569 (not a leap year)
            ['31 สิงหาคม พ.ศ. 2566', [2024, 2, 29], [2024, 3, 1]], // leap year: 29 ก.พ. 2567
            ['31 ตุลาคม พ.ศ. 2568', [2026, 4, 30], [2026, 5, 1]], // 30 เม.ย. 2569
            // (the old row "30 ก.ย. 2568 → 30 มี.ค. 2569" pinned the one-day-early
            // error; its corrected expectation, 31 มี.ค. 2569, is in the ม.193/3 table below)
        ])('issued %s → PASS through the end of that day, EXPIRED from the next', (issued, lastPass, firstExpired) => {
            expect(validityAt(issued, endOfLocalDay(startOfLocalCalendarDay(...lastPass)))).toBe('PASS');
            expect(validityAt(issued, startOfLocalCalendarDay(...firstExpired))).toBe('EXPIRED');
        });

        test('the reproduced case: issued 31 ส.ค. 2568 is EXPIRED on 1, 2 and 3 มี.ค. 2569', () => {
            for (const day of [1, 2, 3]) {
                expect(validityAt('31 สิงหาคม พ.ศ. 2568', startOfLocalCalendarDay(2026, 3, day))).toBe('EXPIRED');
            }
        });
    });

    // ป.พ.พ. ม.193/3 วรรคสอง: a period in months does not count its first day
    // (the issue day), so the period begins the day AFTER issue. ม.193/5
    // วรรคสอง: it ends the day before the day of the last month that
    // corresponds to that beginning day; if the last month has no such day,
    // it ends on that month's last day. Every expected date below is a literal
    // worked out by hand from those two sections — never computed by the
    // code under test. Rows marked "was early" are the ones the old
    // same-day-number rule got wrong (issue on the last day of a month
    // shorter than the target month).
    describe('ป.พ.พ. ม.193/3 + ม.193/5: six months from the day after issue', () => {
        function issuedOn(thaiDate) {
            return textExtraction(`หนังสือรับรองการจดทะเบียนนิติบุคคล ออกให้ ณ วันที่ ${thaiDate}`);
        }
        function validityAt(thaiDate, now) {
            return flagFor(evaluate({ extraction: issuedOn(thaiDate), reference: {}, slotId: COMPANY_REG, now }), 'VALIDITY').result;
        }

        test.each([
            // [issued (BE), last valid Bangkok day (CE y, m, d), first EXPIRED day (CE y, m, d)]
            // --- issued on the last day of every month, 2568 (2025, not a leap year) ---
            ['31 มกราคม พ.ศ. 2568', [2025, 7, 31], [2025, 8, 1]], //   begins 1 ก.พ. → day before 1 ส.ค.
            ['28 กุมภาพันธ์ พ.ศ. 2568', [2025, 8, 31], [2025, 9, 1]], // begins 1 มี.ค. → day before 1 ก.ย. (was early: 28 ส.ค.)
            ['31 มีนาคม พ.ศ. 2568', [2025, 9, 30], [2025, 10, 1]], //   begins 1 เม.ย. → day before 1 ต.ค.
            ['30 เมษายน พ.ศ. 2568', [2025, 10, 31], [2025, 11, 1]], // begins 1 พ.ค. → day before 1 พ.ย. (was early: 30 ต.ค.)
            ['31 พฤษภาคม พ.ศ. 2568', [2025, 11, 30], [2025, 12, 1]], // begins 1 มิ.ย. → day before 1 ธ.ค.
            ['30 มิถุนายน พ.ศ. 2568', [2025, 12, 31], [2026, 1, 1]], // begins 1 ก.ค. → day before 1 ม.ค. (was early: 30 ธ.ค.)
            ['31 กรกฎาคม พ.ศ. 2568', [2026, 1, 31], [2026, 2, 1]], //   begins 1 ส.ค. → day before 1 ก.พ.
            ['31 สิงหาคม พ.ศ. 2568', [2026, 2, 28], [2026, 3, 1]], //   begins 1 ก.ย. → day before 1 มี.ค.
            ['30 กันยายน พ.ศ. 2568', [2026, 3, 31], [2026, 4, 1]], //   begins 1 ต.ค. → day before 1 เม.ย. (was early: 30 มี.ค.)
            ['31 ตุลาคม พ.ศ. 2568', [2026, 4, 30], [2026, 5, 1]], //   begins 1 พ.ย. → day before 1 พ.ค.
            ['30 พฤศจิกายน พ.ศ. 2568', [2026, 5, 31], [2026, 6, 1]], // begins 1 ธ.ค. → day before 1 มิ.ย. (was early: 30 พ.ค.)
            ['31 ธันวาคม พ.ศ. 2568', [2026, 6, 30], [2026, 7, 1]], //   begins 1 ม.ค. → day before 1 ก.ค.
            // --- the target month has no corresponding day → its last day (ม.193/5 ท้าย) ---
            ['29 สิงหาคม พ.ศ. 2568', [2026, 2, 28], [2026, 3, 1]], //   begins 30 ส.ค.; ก.พ. 2569 has no 30th
            ['30 สิงหาคม พ.ศ. 2568', [2026, 2, 28], [2026, 3, 1]], //   begins 31 ส.ค.; ก.พ. 2569 has no 31st
            ['27 สิงหาคม พ.ศ. 2568', [2026, 2, 27], [2026, 2, 28]], //   begins 28 ส.ค.; 28 ก.พ. exists → 27 ก.พ.
            ['30 ธันวาคม พ.ศ. 2568', [2026, 6, 30], [2026, 7, 1]], //   begins 31 ธ.ค.; มิ.ย. has no 31st
            // --- leap year 2567 (2024) ---
            ['29 กุมภาพันธ์ พ.ศ. 2567', [2024, 8, 31], [2024, 9, 1]], // begins 1 มี.ค. → day before 1 ก.ย. (was early: 29 ส.ค.)
            ['28 กุมภาพันธ์ พ.ศ. 2567', [2024, 8, 28], [2024, 8, 29]], // begins 29 ก.พ. → day before 29 ส.ค.
            ['28 สิงหาคม พ.ศ. 2566', [2024, 2, 28], [2024, 2, 29]], //   begins 29 ส.ค.; 29 ก.พ. 2567 exists → 28 ก.พ.
            ['29 สิงหาคม พ.ศ. 2566', [2024, 2, 29], [2024, 3, 1]], //   begins 30 ส.ค.; ก.พ. 2567 has no 30th → 29 ก.พ.
            ['31 สิงหาคม พ.ศ. 2566', [2024, 2, 29], [2024, 3, 1]], //   begins 1 ก.ย. → day before 1 มี.ค. 2567
            // --- an ordinary mid-month issue ---
            ['15 มีนาคม พ.ศ. 2569', [2026, 9, 15], [2026, 9, 16]], //   begins 16 มี.ค. → day before 16 ก.ย.
        ])('issued %s → PASS through the last Bangkok minute of that day, EXPIRED from Bangkok midnight', (issued, lastPass, firstExpired) => {
            expect(validityAt(issued, endOfLocalDay(startOfLocalCalendarDay(...lastPass)))).toBe('PASS');
            expect(validityAt(issued, startOfLocalCalendarDay(...firstExpired))).toBe('EXPIRED');
        });

        test('the boundary is the Bangkok calendar, not UTC: issued 30 ก.ย. 2568, 31 มี.ค. 2569 23:30 Bangkok (16:30Z) PASS, 1 เม.ย. 00:30 Bangkok (31 มี.ค. 17:30Z) EXPIRED', () => {
            expect(validityAt('30 กันยายน พ.ศ. 2568', new Date('2026-03-31T16:30:00.000Z'))).toBe('PASS');
            expect(validityAt('30 กันยายน พ.ศ. 2568', new Date('2026-03-31T17:30:00.000Z'))).toBe('EXPIRED');
        });
    });

    test('sanity: issuedBangkok really is 1 มกราคม 2569 at Bangkok midnight', () => {
        expect(issuedBangkok.toISOString()).toBe(new Date('2025-12-31T17:00:00.000Z').toISOString());
    });
});

describe('SIGNATURE', () => {
    test('is always MANUAL, on every slot', () => {
        for (const slotId of [LAND_DEED, COMPANY_REG, ID_CARD]) {
            const flags = evaluate({ extraction: textExtraction('เนื้อหาเอกสาร'), reference: {}, slotId, now: NOW });
            expect(flagFor(flags, 'SIGNATURE').result).toBe('MANUAL');
        }
    });
});

describe('no flag ever leaks a raw 13-digit id', () => {
    test('reasonTH and evidenceSnippet never match /\\d{13}/, across every check, including a mismatched id', () => {
        const flags = evaluate({
            extraction: textExtraction(
                `หนังสือรับรองการจดทะเบียนนิติบุคคล เลขทะเบียน ${VALID_ID_A} ออกให้ ณ วันที่ 1 มกราคม พ.ศ. 2569`,
            ),
            reference: { entityName: 'บริษัท ทดสอบ จำกัด', juristicId: VALID_ID_B, directorName: 'สมชาย ใจดี' },
            slotId: COMPANY_REG,
            now: NOW,
        });
        expect(flags.length).toBeGreaterThan(0);
        for (const flag of flags) {
            expect(flag.reasonTH).not.toMatch(/\d{13}/);
            if (flag.evidenceSnippet) {
                expect(flag.evidenceSnippet).not.toMatch(/\d{13}/);
            }
        }
        // and this scenario does exercise an id mismatch (juristicId differs) —
        // proving the assertion above is not vacuous.
        expect(flagFor(flags, 'CROSS_MATCH').result).toBe('MISMATCH');
    });
});
