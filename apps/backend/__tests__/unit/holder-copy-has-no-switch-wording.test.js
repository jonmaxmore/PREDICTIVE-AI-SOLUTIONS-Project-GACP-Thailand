/**
 * R2 Task 13 (spec 2026-09-30-remove-workspace-mode §3.7): there is no active
 * entity and nothing to switch to any more. A filing's holder is chosen once at
 * step 1 and never changes, so no message, remediation or generated doc may tell
 * anyone to "switch" workspace or to act under "the active entity".
 *
 * Each holder-mismatch message is pinned to the code that emits it:
 *  - pre-submit, application-requirements-service.holderMismatchIssue → the spec
 *    §3.7 sentence with {word} filled in (the applicant reads it on a draft);
 *  - issuance, certificate-service.resolveHolderForIssuance → the catalogue entry
 *    CERTIFICATE_HOLDER_MISMATCH (staff read it on a reviewed application; its
 *    wording is the coordinator ruling of R2 Task 10 round 3, not the §3.7 one).
 */
const fs = require('fs');
const path = require('path');

const { holderMismatchIssue } = require('../../services/application-requirements-service');
const { resolveHolderForIssuance } = require('../../services/certificate-service');
const { ERROR_CODES } = require('../../shared/error-codes');

const SPEC_37 = (word) => `คำขอนี้ระบุผู้ยื่นเป็น${word} แต่ผูกอยู่กับบุคคล `
    + `ผู้ถือใบรับรองต้องเป็น${word}เอง `
    + `กรุณาลบฉบับร่างนี้ แล้วเริ่มคำขอใหม่โดยเลือกยื่นในนาม${word}`;

const ISSUANCE_TH = 'ไม่สามารถออกใบรับรองได้ เนื่องจากประเภทผู้ยื่นที่ระบุในคำขอไม่ตรงกับประเภทของผู้ถือ'
    + 'ที่ผูกกับคำขอนี้ ส่งคำขอกลับให้ผู้ยื่นแก้ไข หรือแจ้งผู้ดูแลระบบ';

// Workspace-switching wording, in both languages. Plain "สลับ" is not banned:
// DISCLOSURE_STATE_REQUIRED uses "สลับสถานะ" for a boolean toggle, which is not
// about holders.
const SWITCH_WORDING = [
    /สลับไป/,
    /สลับ(พื้นที่|นิติบุคคล|วิสาหกิจ|ผู้ถือ)/,
    /พื้นที่ทำงาน/,
    /switch\s+(to\s+the\s+correct\s+)?active\s+entity/i,
    /active\s+entity/i,
    /ACTIVE_ENTITY_MISMATCH/,
];

// User-facing entity-service claim-refusal messages: no "workspace", no "สลับ" at all.
const ENTITY_MESSAGE_BANNED = [/workspace/i, /สลับ/];

describe('holder copy has no switch wording (spec §3.7)', () => {
    it('entity-service claim-refusal messages carry no workspace or สลับ wording', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'entity-service.js'), 'utf8',
        );
        const block = src.slice(
            src.indexOf('const CLAIM_REFUSAL_MESSAGES'),
            src.indexOf('function claimRefusalMessage'),
        );
        const strings = block.match(/'[^'\n]*'/g) || [];
        expect(strings.length).toBeGreaterThan(0);
        const offenders = [];
        for (const str of strings) {
            for (const re of ENTITY_MESSAGE_BANNED) {
                if (re.test(str)) { offenders.push(`${str} ~ ${re}`); }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('pre-submit holderMismatchIssue says the spec §3.7 sentence', () => {
        const issue = holderMismatchIssue({ applicantType: 'JURISTIC' }, 'INDIVIDUAL');
        expect(issue.code).toBe('APPLICANT_TYPE_NOT_THE_HOLDER');
        expect(issue.messageTH).toBe(SPEC_37('นิติบุคคล'));
        const ce = holderMismatchIssue({ applicantType: 'COMMUNITY_ENTERPRISE' }, 'INDIVIDUAL');
        expect(ce.messageTH).toBe(SPEC_37('วิสาหกิจชุมชน'));
    });

    it('issuance refusal throws CERTIFICATE_HOLDER_MISMATCH with the catalogue sentence', () => {
        const app = {
            id: 'a1', applicationNumber: 'A-1',
            applicant: { id: 'u1', firstName: 'สมชาย', lastName: 'ใจดี' },
            formData: { applicantType: 'JURISTIC' },
            entity: { displayName: 'สมชาย ใจดี', type: 'INDIVIDUAL' },
        };
        let thrown;
        try { resolveHolderForIssuance(app, { entity: null }); } catch (e) { thrown = e; }
        expect(thrown).toBeDefined();
        expect(thrown.code).toBe('CERTIFICATE_HOLDER_MISMATCH');
        expect(thrown.statusCode).toBe(422);
        expect(thrown.message).toBe(ISSUANCE_TH);
        expect(ERROR_CODES.CERTIFICATE_HOLDER_MISMATCH.messageTh).toBe(ISSUANCE_TH);
    });

    it('ACTIVE_ENTITY_MISMATCH is not in the catalogue', () => {
        expect(ERROR_CODES.ACTIVE_ENTITY_MISMATCH).toBeUndefined();
    });

    it('no catalogue entry tells anyone to switch workspace or act under an active entity', () => {
        const offenders = [];
        for (const [key, entry] of Object.entries(ERROR_CODES)) {
            const text = [entry.messageEn, entry.messageTh, entry.remediation]
                .filter((s) => typeof s === 'string').join('\n');
            for (const re of SWITCH_WORDING) {
                if (re.test(text)) { offenders.push(`${key} ~ ${re}`); }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('the generated docs/api/error-codes.md carries no ACTIVE_ENTITY_MISMATCH or active-entity wording', () => {
        const md = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'docs', 'api', 'error-codes.md'), 'utf8',
        );
        expect(md).not.toMatch(/ACTIVE_ENTITY_MISMATCH/);
        expect(md).not.toMatch(/active\s+entity/i);
        expect(md).not.toMatch(/สลับไปพื้นที่ทำงาน/);
    });
});
