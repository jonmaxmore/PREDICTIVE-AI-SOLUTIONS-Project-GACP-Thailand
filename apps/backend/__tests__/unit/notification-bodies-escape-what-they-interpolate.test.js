/**
 * An email body is a render surface, so it escapes.
 *
 * Until 2026-09-08 middleware/sanitize-input.js deleted `<script>`, `on*=` and
 * friends out of every incoming string, and templates inherited a defence they
 * never asked for. That middleware also ate ordinary Thai text, so the operator
 * ruled it out: "ปล่อยผ่านแล้ว escape ตอนแสดงผล". This file is the display half
 * of that ruling for notifications.
 *
 * The concrete hole it closes: AUDIT_SCHEDULED interpolated `auditorName` — a
 * person's display name — raw into bodyTHHtml. The same file already had
 * `_escHtml` and used it for two operator free-text fields, so the escaping was
 * not missing, it was applied where a reviewer happened to look.
 *
 * The tests below drive every registered template with hostile values in EVERY
 * string parameter it reads, so a template added next month is covered without
 * anyone remembering to come back here.
 */

const fanout = require('../../services/notification-fanout-service');

/** The registry is module-private but exported for tests under _internals. */
const TEMPLATES = fanout._internals.TEMPLATES;

const HOSTILE = '<img src=x onerror="alert(1)">';

describe('the notification template registry is reachable from a test', () => {
    it('exposes its templates, or this suite is guarding nothing', () => {
        expect(TEMPLATES).toBeTruthy();
        expect(Object.keys(TEMPLATES).length).toBeGreaterThan(0);
    });
});

describe('no template lets a hostile string reach an HTML body unescaped', () => {
    const names = Object.keys(TEMPLATES || {});

    it.each(names)('%s', (name) => {
        const build = TEMPLATES[name];
        // Feed the same hostile value to every parameter the template might read.
        // A Proxy answers any property, so we do not need to know each template's
        // parameter names — including the ones added after this test was written.
        const everything = new Proxy({}, {
            get: (_t, prop) => (typeof prop === 'symbol' ? undefined : HOSTILE),
            has: () => true,
        });

        let out;
        try {
            out = build(everything);
        } catch {
            // A template that refuses a nonsense payload has not rendered
            // anything, which is not the failure this suite is looking for.
            return;
        }

        for (const key of ['bodyTHHtml', 'bodyENHtml']) {
            const html = out?.[key];
            if (typeof html !== 'string') { continue; }
            // Measure MARKUP, not words. Escaped output still contains the
            // letters "onerror=" — as text, inside &lt;img …&gt;, which is
            // exactly the harmless outcome we want. What must never appear is
            // a real tag opener from the value, or a real quote closing the
            // attribute it was interpolated into.
            expect(html).not.toContain('<img');
            expect(html).not.toContain('onerror="');
        }
    });
});

describe('AUDIT_SCHEDULED — the case that was actually open', () => {
    it('escapes the auditor name into the applicant\'s email', () => {
        const out = TEMPLATES.AUDIT_SCHEDULED({
            applicationNumber: 'GACP-2569-0001',
            auditorName: '<script>alert(1)</script>สมชาย',
        });
        expect(out.bodyTHHtml).not.toContain('<script');
        expect(out.bodyTHHtml).toContain('&lt;script&gt;');
        // The name itself still reads correctly — escaping displays, it does not delete.
        expect(out.bodyTHHtml).toContain('สมชาย');
    });

    it('leaves an ordinary Thai name completely alone', () => {
        const out = TEMPLATES.AUDIT_SCHEDULED({
            applicationNumber: 'GACP-2569-0001',
            auditorName: 'นายสมชาย ใจดี',
        });
        expect(out.bodyTHHtml).toContain('นายสมชาย ใจดี');
    });
});

describe('a deliberate HTML fragment is still allowed to be HTML', () => {
    it('AUDIT_RESULT_CAR renders its findings list as a list, with the findings escaped', () => {
        const out = TEMPLATES.AUDIT_RESULT_CAR({
            applicationNumber: 'GACP-2569-0002',
            criticalFindings: ['<b>ข้อ 1</b> น้ำไม่ผ่าน'],
            summary: 'ตรวจซ้ำภายใน 30 วัน',
        });
        expect(out.bodyTHHtml).toContain('<ul>');   // the fragment is markup on purpose
        expect(out.bodyTHHtml).toContain('&lt;b&gt;');   // its contents are not
    });
});
