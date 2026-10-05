/**
 * T5 — step 1 asks the three questions กทล.1 asks first, and writes them in the
 * requirement register's own words.
 *
 * The stakes: `applicantType` and `requestType` are DIMENSIONS the register matches
 * rules on. A value spelled differently here than the register spells it does not
 * error — it matches only the rules that bind everybody, so the filing is asked for
 * almost nothing and reports ครบ. This platform has already lost a company-registration
 * demand to a trailing space in holderType, so the vocabulary is pinned by name here.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import {
    REQUEST_TYPE_OPTIONS,
    APPLICANT_TYPE_OPTIONS,
    CERT_SCOPE_OPTIONS,
    needsPreviousCertificate,
    needsCertScope,
    step1CanProceed,
    SUCCEEDING_REQUEST_NOTE_TH,
} from '../step1-request-type-config';
import Step1RequestType from '../step1-request-type';

describe('step 1 vocabulary — the words the register knows', () => {
    it('offers exactly the register’s three request types', () => {
        expect(REQUEST_TYPE_OPTIONS.map((o) => o.value)).toEqual(['NEW', 'RENEWAL', 'REPLACEMENT']);
        // 'RENEW' is the spelling the engine does NOT know (brief, global constraints).
        expect(REQUEST_TYPE_OPTIONS.map((o) => o.value)).not.toContain('RENEW');
    });

    it('offers exactly the register’s three holder types, spelled its way', () => {
        expect(APPLICANT_TYPE_OPTIONS.map((o) => o.value))
            .toEqual(['COMMUNITY_ENTERPRISE', 'INDIVIDUAL', 'JURISTIC']);
        // The wizard's OLDER field says COMMUNITY. The register says COMMUNITY_ENTERPRISE.
        expect(APPLICANT_TYPE_OPTIONS.map((o) => o.value)).not.toContain('COMMUNITY');
    });

    it('keeps the scope vocabulary in config, but the screen no longer asks it', () => {
        // Operator 2026-09-06: "ขอรับรองในขั้นตอนใด ส่วนนี้ไม่ต้องมี" — the platform
        // issues planting permits, so the scope is not a question; a NEW filing is
        // PLANTING by default (written silently on selection). The vocabulary stays
        // in config because the engine's certScope dimension is real (the processing
        // law rows still exist in the register for the day that flow returns).
        expect(CERT_SCOPE_OPTIONS.map((o) => o.value)).toEqual(['PLANTING', 'PROCESSING']);
    });

    it('every option reads as Thai and never shows its own enum', () => {
        [...REQUEST_TYPE_OPTIONS, ...APPLICANT_TYPE_OPTIONS, ...CERT_SCOPE_OPTIONS].forEach((o) => {
            expect(o.labelTH).toMatch(/[ก-๙]/);
            expect(o.helpTH).toMatch(/[ก-๙]/);
            expect(o.labelTH).not.toContain(o.value);
            expect(o.helpTH).not.toContain(o.value);
            // Thai UI copy law: no em dash in a Thai sentence.
            expect(o.labelTH + o.helpTH).not.toContain('—');
        });
        expect(SUCCEEDING_REQUEST_NOTE_TH).toMatch(/[ก-๙]/);
        expect(SUCCEEDING_REQUEST_NOTE_TH).not.toContain('—');
    });
});

describe('which follow-up question step 1 asks', () => {
    it('asks a renewal and a replacement to name the certificate they succeed', () => {
        expect(needsPreviousCertificate('RENEWAL')).toBe(true);
        expect(needsPreviousCertificate('REPLACEMENT')).toBe(true);
        expect(needsPreviousCertificate('NEW')).toBe(false);
        expect(needsPreviousCertificate(null)).toBe(false);
    });

    it('asks only a NEW request what is being certified — a renewal inherits its scope', () => {
        expect(needsCertScope('NEW')).toBe(true);
        expect(needsCertScope('RENEWAL')).toBe(false);
        expect(needsCertScope('REPLACEMENT')).toBe(false);
        expect(needsCertScope(null)).toBe(false);
    });
});

describe('step1CanProceed — the same predicate the navigation guard uses', () => {
    it('refuses until both the request type and the applicant are chosen', () => {
        expect(step1CanProceed({})).toBe(false);
        expect(step1CanProceed({ requestType: 'NEW' })).toBe(false);
        expect(step1CanProceed({ applicantType: 'INDIVIDUAL' })).toBe(false);
    });

    it('a NEW request needs no scope answer — the screen stopped asking (operator, 2026-09-06)', () => {
        const base = { requestType: 'NEW', applicantType: 'INDIVIDUAL', plantId: 'cannabis' } as const;
        expect(step1CanProceed(base)).toBe(true);
    });

    it('a NEW request must name the PLANT here — the law is filed per plant (operator ruling 2026-09-06)', () => {
        // F-QA-04: the requirement engine refuses to advise a filing that names no plant, so a
        // draft without one returns ZERO document slots — and steps 2 and 3, which are supposed
        // to collect identity and land papers, rendered nothing at all for every first-time
        // filer. Asking the plant HERE (as กทล.1 does, one form per plant) makes the papers
        // resolvable from step 2 onward.
        const base = { requestType: 'NEW', applicantType: 'INDIVIDUAL' } as const;
        expect(step1CanProceed(base)).toBe(false);
        expect(step1CanProceed({ ...base, plantId: 'cannabis' })).toBe(true);
    });

    it('a renewal is not asked for a plant — it succeeds a certificate that already names one', () => {
        expect(step1CanProceed({
            requestType: 'RENEWAL', applicantType: 'JURISTIC', previousCertificateNumber: 'GACP-TH-2569-E5960D',
        })).toBe(true);
    });

    it('a renewal needs the previous certificate number, and whitespace is not one', () => {
        const base = { requestType: 'RENEWAL', applicantType: 'COMMUNITY_ENTERPRISE' } as const;
        expect(step1CanProceed(base)).toBe(false);
        expect(step1CanProceed({ ...base, previousCertificateNumber: '   ' })).toBe(false);
        expect(step1CanProceed({ ...base, previousCertificateNumber: 'GACP-TH-2569-E5960D' })).toBe(true);
    });

    it('does not let a scope stand in for the certificate a renewal must name', () => {
        expect(step1CanProceed({
            requestType: 'RENEWAL', applicantType: 'JURISTIC', certScope: 'PLANTING',
        })).toBe(false);
    });
});

describe('the screen itself', () => {
    // Rendered statically, the way this repo tests step components (no
    // @testing-library/react in the tree — see consent-step-no-back.test.tsx).
    it('prints every choice in Thai and no raw enum anywhere in the markup', () => {
        const html = renderToStaticMarkup(<Step1RequestType />);

        [...REQUEST_TYPE_OPTIONS, ...APPLICANT_TYPE_OPTIONS].forEach((o) => {
            expect(html).toContain(o.labelTH);
        });
        ['COMMUNITY_ENTERPRISE', 'REPLACEMENT', 'PROCESSING'].forEach((enumWord) => {
            expect(html).not.toContain(`>${enumWord}<`);
        });
        // The scope question is retired (operator, 2026-09-06) — neither the heading
        // nor the processing option may render.
        expect(html).not.toContain('ขอรับรองในขั้นตอนใด');
        expect(html).not.toContain('การแปรรูป');
        // The plant moved here from step 4 (F-QA-04).
        expect(html).toContain('ชนิดพืช');
    });
});
