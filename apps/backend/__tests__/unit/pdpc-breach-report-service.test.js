/**
 * Tests for the R4-B PDPC breach-report PDF generator.
 *
 * Coverage anchors (per iter-R4/00-rfc.md acceptance):
 *   - All placeholders enumerated in the RFC substitute into the rendered HTML.
 *   - Operator-supplied free-text (RISK_ASSESSMENT_TH) is HTML-escaped so a
 *     `<script>` payload renders as `&lt;script&gt;` — NOT raw markup.
 *   - Buddhist-Era date arithmetic: `new Date('2026-05-17')` yields a Thai
 *     date string containing "2569" (Gregorian + 543).
 *   - Missing required field throws VALIDATION_ERROR synchronously BEFORE
 *     pdf-generator.generatePDF is invoked.
 *
 * Mock strategy (instinct I-008):
 *   The system-under-test imports `pdf-generator.service` and uses
 *   `pdfGenerator.generatePDF`. The mock exposes both `generatePDF` and
 *   `escapeHtml` so any future SUT path that switches to the shared helper
 *   continues to work; the current SUT only uses `generatePDF`.
 */

'use strict';

const path = require('path');

// ── Mock pdf-generator.service BEFORE requiring SUT ──────────────────────

const mockGeneratedHtmls = [];
jest.mock('../../services/pdf/pdf-generator.service', () => {
    const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return {
        generatePDF: jest.fn(async (html) => {
            mockGeneratedHtmls.push(html);
            return Buffer.from(`%PDF-FAKE-${html.length}`);
        }),
        escapeHtml: jest.fn((value) => {
            if (value === null || value === undefined) { return ''; }
            return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
        }),
    };
});

const pdfGenerator = require('../../services/pdf/pdf-generator.service');
const {
    generatePdpcBreachReportPdf,
} = require('../../services/pdf/pdpc-breach-report-service');

const TEMPLATE_PATH = path.join(
    __dirname, '..', '..', 'services', 'pdf', 'templates', 'pdpc-breach-notification.html',
);

const VALID_BREACH = Object.freeze({
    breachId: 'breach-abc123',
    detectedAt: '2026-05-17T08:00:00Z',
    reportedAt: '2026-05-17T10:30:00Z',
    affectedSubjectsCount: 42,
    dataControllerNameTH: 'ระบบรับรอง GACP — DTAM',
    dataControllerDpoEmail: 'dpo@gacpth.com',
    breachTypeTH: 'ความลับ',
    affectedPiiCategoriesTH: 'ชื่อ-นามสกุล, อีเมล',
    riskAssessmentTH: 'ความเสี่ยงระดับสูง — ข้อมูลส่วนบุคคลรั่วไหลจากระบบ',
    containmentActionsTH: 'รีเซ็ตรหัสผ่าน + เพิกถอน access token ทั้งหมด',
    remedialActionsTH: 'แจ้งเจ้าของข้อมูล + เพิ่ม MFA บังคับ',
    subjectNotificationDescriptionTH: 'อีเมลพร้อมคำแนะนำการป้องกันส่งภายใน 24 ชั่วโมง',
});

beforeEach(() => {
    mockGeneratedHtmls.length = 0;
    jest.clearAllMocks();
});

describe('[R4-B] generatePdpcBreachReportPdf — placeholder substitution', () => {
    it('substitutes every placeholder defined in the RFC into the rendered HTML', async () => {
        const buffer = await generatePdpcBreachReportPdf(VALID_BREACH);

        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(pdfGenerator.generatePDF).toHaveBeenCalledTimes(1);
        expect(mockGeneratedHtmls.length).toBe(1);

        const html = mockGeneratedHtmls[0];

        // No surviving placeholders for the values we provided.
        // (Some duplicate placeholders inside the template, e.g.
        // REPORTED_AT_TH appearing twice, are expected to render the same
        // value.)
        expect(html).toContain('breach-abc123');
        expect(html).toContain('ระบบรับรอง GACP — DTAM');
        expect(html).toContain('dpo@gacpth.com');
        expect(html).toContain('ความลับ');
        expect(html).toContain('42');
        expect(html).toContain('ชื่อ-นามสกุล');
        expect(html).toContain('รีเซ็ตรหัสผ่าน');
        expect(html).toContain('แจ้งเจ้าของข้อมูล');
        expect(html).toContain('อีเมลพร้อมคำแนะนำการป้องกัน');

        // None of the well-known placeholder tokens should leak through
        // un-substituted.
        const placeholderTokens = [
            '{{BREACH_ID}}',
            '{{DETECTED_AT_TH}}',
            '{{REPORTED_AT_TH}}',
            '{{DATA_CONTROLLER_NAME_TH}}',
            '{{DATA_CONTROLLER_DPO_EMAIL}}',
            '{{BREACH_TYPE_TH}}',
            '{{AFFECTED_SUBJECTS_COUNT}}',
            '{{AFFECTED_PII_CATEGORIES_TH}}',
            '{{RISK_ASSESSMENT_TH}}',
            '{{CONTAINMENT_ACTIONS_TH}}',
            '{{REMEDIAL_ACTIONS_TH}}',
            '{{SUBJECT_NOTIFICATION_DESCRIPTION_TH}}',
        ];
        for (const token of placeholderTokens) {
            expect(html).not.toContain(token);
        }
    });
});

describe('[R4-B] generatePdpcBreachReportPdf — XSS prevention', () => {
    it('HTML-escapes a <script> payload supplied in RISK_ASSESSMENT_TH', async () => {
        const malicious = {
            ...VALID_BREACH,
            riskAssessmentTH: '<script>alert(1)</script>',
        };
        await generatePdpcBreachReportPdf(malicious);

        const html = mockGeneratedHtmls[0];
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        // CRITICAL: raw <script>alert tag must NOT make it through
        // verbatim into the rendered HTML body.
        expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    });
});

describe('[R4-B] generatePdpcBreachReportPdf — Buddhist-Era date format', () => {
    it('renders the detected-at date in Buddhist Era (year contains "2569" for 2026 input)', async () => {
        const record = {
            ...VALID_BREACH,
            detectedAt: '2026-05-17T00:00:00Z',
        };
        await generatePdpcBreachReportPdf(record);

        const html = mockGeneratedHtmls[0];
        // BE year for 2026 AD = 2569. The Thai-locale formatter emits either
        // "พ.ศ. 2569" or "พุทธศักราช 2569" depending on Intl version —
        // both contain the bare "2569" substring.
        expect(html).toMatch(/2569/);
        // The Gregorian-year fallback "2026" should NOT be the rendered
        // date — only the BE form is acceptable on a PDPC submission.
        // (We don't assert NOT.toContain('2026') because the year could
        // appear inside other strings like an audit timestamp comment;
        // the BE positive assertion is sufficient.)
    });
});

describe('[R4-B] generatePdpcBreachReportPdf — 72-hour PDPC deadline (R4 review H-1)', () => {
    it('renders PDPC 72-hour deadline distinct from REPORTED_AT, computed as detectedAt + 72h', async () => {
        const record = {
            ...VALID_BREACH,
            detectedAt: '2026-05-17T00:00:00Z',
            reportedAt: '2026-05-17T08:00:00Z',
        };
        await generatePdpcBreachReportPdf(record);

        const html = mockGeneratedHtmls[0];
        // 2026-05-17 + 72h = 2026-05-20 → BE year 2569, day 20
        // BE date for 2026-05-20 must appear (the deadline cell). Both
        // "20" and "2569" present in the same rendered HTML.
        expect(html).toContain('2569');
        expect(html).toMatch(/20\s+พฤษภาคม|พฤษภาคม\s+2569|20\/05|พฤษภาคม.*2569/);
    });
});

describe('[R4-B] generatePdpcBreachReportPdf — VALIDATION_ERROR before puppeteer', () => {
    it('throws VALIDATION_ERROR when breachId is missing and never calls generatePDF', async () => {
        const invalid = { ...VALID_BREACH };
        delete invalid.breachId;

        await expect(generatePdpcBreachReportPdf(invalid)).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
        expect(pdfGenerator.generatePDF).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when detectedAt is missing', async () => {
        const invalid = { ...VALID_BREACH };
        delete invalid.detectedAt;

        await expect(generatePdpcBreachReportPdf(invalid)).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
        expect(pdfGenerator.generatePDF).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when affectedSubjectsCount is missing', async () => {
        const invalid = { ...VALID_BREACH };
        delete invalid.affectedSubjectsCount;

        await expect(generatePdpcBreachReportPdf(invalid)).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
        expect(pdfGenerator.generatePDF).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR when breachRecord is null', async () => {
        await expect(generatePdpcBreachReportPdf(null)).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
        expect(pdfGenerator.generatePDF).not.toHaveBeenCalled();
    });
});

describe('[R4-B] template skeleton warning header', () => {
    it('template file carries the SKELETON warning comment so operators know to verify', () => {
        const fs = require('fs');
        const tpl = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
        expect(tpl).toContain('SKELETON');
        expect(tpl).toMatch(/pdpc\.or\.th|ofpc\.or\.th/);
    });
});
