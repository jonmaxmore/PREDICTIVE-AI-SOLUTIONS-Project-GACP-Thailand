/**
 * What a farmer types is what gets stored. Escaping belongs at the boundary that
 * renders, not at the boundary that receives.
 *
 * Measured 2026-09-08 by running middleware/sanitize-input.js against text a Thai
 * user or officer can plausibly write (evidence/api-db-audit-2026-09-08):
 *
 *   "สวนสมใจ -- แปลงที่ 1"          ->  "สวนสมใจ แปลงที่ 1"
 *   "onsite=ตรวจแล้ว"                     ->  "ตรวจแล้ว"            ← the word vanished
 *   "ปุ๋ยสูตร 15-15-15 /* ใช้ตามฉลาก *​/"  ->  "ปุ๋ยสูตร 15-15-15 "   ← the note vanished
 *
 * The second line is the sharpest: /on\w+\s*=/ exists to catch `onclick=`, and it
 * matches ANY English word starting with "on" followed by "=". The third is a SQL
 * comment pattern, which is meaningless against Prisma's parameterised queries and
 * eats a perfectly ordinary parenthetical note.
 *
 * No error is raised and no warning is shown; the user is told the save succeeded.
 * That is silent data corruption on a government registry.
 *
 * Operator ruling 2026-09-08: "ปล่อยผ่านแล้ว escape ตอนแสดงผล" — pass the input
 * through, escape at render. Verified before this change that every render path
 * already escapes:
 *   - React escapes by default; the two dangerouslySetInnerHTML call sites that
 *     carry applicant data render HTML built by
 *     services/pdf/katorlor1-template-service.js, which escapes & < > at :46-48
 *     under the comment "Everything applicant-supplied is escaped."
 *   - services/pdf/pdf-generator.service.js escapes /[&<>"']/g when substituting
 *     {{...}} into every PDF template.
 *
 * So this suite pins BOTH halves: ordinary text survives, and the escaping that
 * now carries the whole load stays in place.
 */

const { sanitizeValue } = require('../../middleware/sanitize-input');

/** Text a real user of this platform can type, none of it an attack. */
const ORDINARY = [
    'สวนสมใจ -- แปลงที่ 1',
    'ที่อยู่ 99/1 หมู่ 4 ต.สันทราย -- ใกล้วัด',
    'onsite=ตรวจแล้ว',
    'ปุ๋ยสูตร 15-15-15 /* ใช้ตามฉลาก */',
    'พืช: กัญชา (Cannabis sativa L.)',
    'ผู้ตรวจ: นายสมชาย -- ตรวจครั้งที่ 2',
    'online=yes',
    'one=1, two=2',
    'หมายเหตุ /* รอผลแล็บ */ ยังไม่สรุป',
    'ค่า pH 6.5--7.0',
];

describe('ordinary Thai text survives the request boundary unchanged', () => {
    it.each(ORDINARY)('%s', (text) => {
        expect(sanitizeValue(text)).toBe(text);
    });

    it('does not touch the shape of an object, only passes values through', () => {
        const body = {
            farmName: 'สวนสมใจ -- แปลงที่ 1',
            note: 'ปุ๋ยสูตร 15-15-15 /* ใช้ตามฉลาก */',
            nested: { field: 'onsite=ตรวจแล้ว' },
            list: ['one=1', 'ค่า pH 6.5--7.0'],
            count: 3,
            flag: true,
            missing: null,
        };
        expect(sanitizeValue(body)).toEqual(body);
    });
});

describe('the render boundary is where escaping happens', () => {
    it('the กทล.1 template escapes applicant text before it becomes HTML', () => {
        // This is the module behind the two dangerouslySetInnerHTML call sites that
        // carry applicant data. If its escaping is ever removed, the ruling above
        // stops being safe — so this test guards it from the other side.
        const svc = require('../../services/pdf/katorlor1-template-service');
        const esc = svc.escapeHtml || svc.esc || null;
        expect(esc).toBeInstanceOf(Function);
        expect(esc('<script>alert(1)</script>')).not.toMatch(/<script/);
        expect(esc('a & b')).toBe('a &amp; b');
        expect(esc('<b>')).toBe('&lt;b&gt;');
        // Thai is untouched by escaping — it has no HTML-significant characters.
        expect(esc('สวนสมใจ')).toBe('สวนสมใจ');
    });
});

describe('a real injection attempt is still not rendered as markup', () => {
    // The point of the ruling is that these strings may be STORED verbatim — what
    // must never happen is that they become executable markup. Storage is tested
    // here; rendering is tested above.
    const ATTACKS = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        'javascript:alert(1)',
    ];

    it.each(ATTACKS)('%s is stored as text, not silently mangled into something else', (text) => {
        const stored = sanitizeValue(text);
        // Either it is passed through whole (the ruling), or it is rejected outright.
        // What it must NOT be is a half-stripped string that looks harmless and is not.
        expect(stored).toBe(text);
    });
});
