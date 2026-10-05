'use strict';

/**
 * กทล.1 ส่วนที่ ๒ — วัตถุประสงค์ (มติ operator 2026-10-05)
 *
 * แบบทางการพิมพ์ช่องเดียวสองช่อง (แพทย์, ส่งออก) · ช่องแพทย์ไม่เคยติ๊ก (ถอดวัตถุประสงค์นี้แล้ว)
 * ช่องส่งออกติ๊กเฉพาะเมื่อเลือก EXPORT · RESEARCH และ PROCESSING พิมพ์เป็นบรรทัดเสริม
 * "วัตถุประสงค์ตามใบอนุญาต:" ตามด้วยชื่อกับรหัสใบอนุญาต
 */

const { renderKatorlor1Html } = require('../../services/pdf/katorlor1-template-service');

const filing = (purposes) => ({
    id: 'app-1',
    applicationNumber: 'GACP-TEST-02',
    formData: {
        applicantType: 'INDIVIDUAL', requestType: 'NEW', certScope: 'PLANTING',
        applicantData: { prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี' },
        certificationPurposes: purposes,
        farmData: { siteName: 'สวน', siteAddress: '1', landOwnership: 'OWNED', areaTypes: ['OUTDOOR'], areaSqm: '10' },
    },
});

const sectionTwo = (html) => html.split('ส่วนที่ ๒')[1].split('ส่วนที่ ๓')[0];
/** the purpose row only */
const purposeRow = (html) => {
    const s2 = sectionTwo(html);
    const at = s2.indexOf('วัตถุประสงค์');
    return s2.slice(at, s2.indexOf('</div>', at) + 6);
};
const LINE = 'วัตถุประสงค์ตามใบอนุญาต:';

describe('กทล.1 section 2 purposes', () => {
    test('the form still prints its แพทย์ box, and it is never ticked', () => {
        ['EXPORT', 'RESEARCH', 'PROCESSING', 'MEDICAL'].forEach((p) => {
            const row = purposeRow(renderKatorlor1Html(filing([p]), null));
            expect(row).toContain('☐ เพื่อประโยชน์ทางการแพทย์');
            expect(row).not.toMatch(/☑\s*เพื่อประโยชน์ทางการแพทย์/);
        });
    });

    test('EXPORT ticks the ส่งออก box and prints no extra line', () => {
        const html = renderKatorlor1Html(filing(['EXPORT']), null);
        expect(purposeRow(html)).toMatch(/☑[^☐]*เพื่อการส่งออก/);
        expect(sectionTwo(html)).not.toContain(LINE);
    });

    test('RESEARCH alone leaves the ส่งออก box empty and prints the licence line', () => {
        const html = renderKatorlor1Html(filing(['RESEARCH']), null);
        expect(purposeRow(html)).not.toContain('☑');
        expect(sectionTwo(html)).toContain(`${LINE} ศึกษาวิจัย (ภ.ท. 09)`);
    });

    test('RESEARCH + PROCESSING prints both, with their licence codes', () => {
        const html = renderKatorlor1Html(filing(['RESEARCH', 'PROCESSING']), null);
        expect(sectionTwo(html)).toContain(`${LINE} ศึกษาวิจัย (ภ.ท. 09), แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)`);
    });

    test('EXPORT + PROCESSING ticks the box AND prints the line for the one the box cannot say', () => {
        const html = renderKatorlor1Html(filing(['EXPORT', 'PROCESSING']), null);
        expect(purposeRow(html)).toMatch(/☑[^☐]*เพื่อการส่งออก/);
        expect(sectionTwo(html)).toContain(LINE);
        expect(sectionTwo(html)).toContain('แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)');
    });

    test('a retired word ticks nothing and prints nothing', () => {
        const html = renderKatorlor1Html(filing(['MEDICAL']), null);
        expect(purposeRow(html)).not.toContain('☑');
        expect(sectionTwo(html)).not.toContain(LINE);
    });

    test('a named non-cannabis plant has no ภ.ท. licence line (fix round 2)', () => {
        const f = filing(['RESEARCH', 'PROCESSING']);
        f.formData.plantId = 'kratom';
        expect(sectionTwo(renderKatorlor1Html(f, null))).not.toContain(LINE);
    });

    test('kratom EXPORT prints the equivalent line naming the section-10 licence (fix round 3)', () => {
        const f = filing(['EXPORT']);
        f.formData.plantId = 'kratom';
        expect(sectionTwo(renderKatorlor1Html(f, null)))
            .toContain(`${LINE} ส่งออก (ใบอนุญาตตามมาตรา 10 พ.ร.บ.พืชกระท่อม พ.ศ. 2565)`);
        const g = filing(['RESEARCH']);
        g.formData.plantId = 'kratom';
        expect(sectionTwo(renderKatorlor1Html(g, null))).not.toContain(LINE);
    });
});
