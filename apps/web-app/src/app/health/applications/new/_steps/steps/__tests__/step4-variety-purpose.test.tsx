/**
 * T8 — step 4 asks กทล.1 ข้อ ๓, and it never answers for the applicant.
 *
 * The purpose is a legal declaration about what the produce is for; it is what decides
 * which issued ภ.ท. licence is demanded. A default is not a tick.
 *
 * Operator ruling 2026-10-05: exactly three purposes, each backed by a licence —
 * RESEARCH ภ.ท. 09, EXPORT ภ.ท. 10, PROCESSING ภ.ท. 11 (which includes selling). The
 * medical purpose is gone, and nothing is mapped from the old words.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import {
    OBJECTIVE_OPTIONS,
    VARIETY_KIND_OPTIONS,
    VARIETY_ORIGIN_OPTIONS,
    emptyVarietyRow,
    needsVarietiesNote,
    needsOriginCountry,
    licenceNoticeFor,
    staleObjectivesNotice,
    step4CanProceed,
    STEP4_COPY_TH,
} from '../step4-variety-purpose-config';
import Step4VarietyPurpose from '../step4-variety-purpose';

describe('three licence-backed objectives, and no default', () => {
    it('offers exactly ศึกษาวิจัย, ส่งออก and แปรรูปหรือจำหน่าย — each with its licence code', () => {
        expect(OBJECTIVE_OPTIONS.map((o) => o.value)).toEqual(['RESEARCH', 'EXPORT', 'PROCESSING']);
        expect(OBJECTIVE_OPTIONS.map((o) => o.labelTH)).toEqual([
            'ศึกษาวิจัย (ภ.ท. 09)',
            'ส่งออกเพื่อการค้า (ภ.ท. 10)',
            'แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)',
        ]);
    });

    it('offers neither the medical purpose nor the wizard-invented commercial one', () => {
        const offered = OBJECTIVE_OPTIONS.map((o) => o.value) as string[];
        expect(offered).not.toContain('MEDICAL');
        expect(offered).not.toContain('COMMERCIAL');
    });

    it('a filing with no objective cannot proceed, and the refusal names the field', () => {
        expect(step4CanProceed({ plantId: 'cannabis', objectives: [] })).toBe(false);
        expect(step4CanProceed({ plantId: 'cannabis', objectives: null })).toBe(false);
        expect(STEP4_COPY_TH.objectiveRequired).toContain('วัตถุประสงค์');
        expect(STEP4_COPY_TH.objectiveRequired).toMatch(/กรุณา/);
    });

    it('the plant is load-bearing but is answered at STEP 1 now — this gate does not re-ask it', () => {
        // F-QA-04 (operator ruling 2026-09-06): asking the plant at step 4 left steps 2-3 with
        // no resolvable documents for every first-time filer, because the register keys its
        // rules on the plant. It moved to step 1, and step1CanProceed enforces it there.
        // Re-demanding it here would gate a filing on a field this screen no longer shows.
        expect(step4CanProceed({ plantId: null, objectives: ['EXPORT'] })).toBe(true);
        expect(step4CanProceed({ plantId: 'cannabis', objectives: [] })).toBe(false);
    });

    it('several objectives together are lawful — this is not a single choice', () => {
        expect(step4CanProceed({ plantId: 'cannabis', objectives: ['RESEARCH', 'PROCESSING'] })).toBe(true);
    });

    it('a word outside the vocabulary never lets the applicant leave the step', () => {
        expect(step4CanProceed({ objectives: ['MEDICAL'] })).toBe(false);
        expect(step4CanProceed({ objectives: ['EXPORT', 'COMMERCIAL'] })).toBe(false);
    });
});

describe('fix round 2 — the hint under the choices, and the law per plant', () => {
    const HINT = 'ถ้าขายในประเทศ หรือแปรรูป เช่น ตากแห้ง ตัดแต่ง ทำผลิตภัณฑ์ ให้เลือก \'แปรรูปหรือจำหน่ายเพื่อการค้า\' เพิ่ม';
    it('pins the hint wording', () => {
        expect(STEP4_COPY_TH.purposeHint).toBe(HINT);
    });
    it('renders the hint under the purpose choices', () => {
        const html = renderToStaticMarkup(
            <Step4VarietyPurpose
                plantId="cannabis" objectives={[]} varieties={[]} varietiesNote="" certScope="PLANTING"
                processing={{} as never} onChange={() => undefined}
            />,
        ).replace(/&#x27;/g, "'");
        expect(html).toContain(HINT);
    });
    it('kratom: export names the kratom-act licence, no ภ.ท.; research/processing name none', () => {
        const n = licenceNoticeFor(['EXPORT'], 'kratom') as string;
        expect(n).toContain('ใบอนุญาตส่งออกพืชกระท่อม');
        expect(n).not.toContain('ภ.ท.');
        expect(licenceNoticeFor(['RESEARCH', 'PROCESSING'], 'kratom')).toBeNull();
    });
    it('the other four herbs name no licence', () => {
        for (const herb of ['turmeric', 'ginger', 'plai', 'black_galangal']) {
            expect(licenceNoticeFor(['RESEARCH', 'EXPORT', 'PROCESSING'], herb)).toBeNull();
        }
    });
    it('EXPORT alone names ภ.ท. 10 only, never ภ.ท. 11', () => {
        const n = licenceNoticeFor(['EXPORT'], 'cannabis') as string;
        expect(n).toContain('ภ.ท. 10');
        expect(n).not.toContain('ภ.ท. 11');
    });
});

describe('the issued licence is announced where the purpose is chosen', () => {
    it('names each issued licence the ticked purposes will ask for, and says it is the issued one', () => {
        const notice = licenceNoticeFor(['RESEARCH', 'PROCESSING']);
        expect(notice).toContain('ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม (ภ.ท. 09)');
        expect(notice).toContain('ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 11)');
        expect(notice).not.toContain('ภ.ท. 10');
        expect(notice).toContain('ที่ออกให้แล้ว');
        expect(notice).toContain('ขั้นที่ 5');
    });

    it('says nothing when nothing is ticked, and never names the application form', () => {
        expect(licenceNoticeFor([])).toBeNull();
        expect(licenceNoticeFor(['EXPORT'])).not.toContain('แบบคำขอ');
    });

    it('tells an applicant holding a retired word that the choice must be made again', () => {
        const notice = staleObjectivesNotice(['MEDICAL']);
        expect(notice).toContain('MEDICAL');
        expect(notice).toContain('เลือกวัตถุประสงค์ใหม่');
        expect(staleObjectivesNotice([])).toBeNull();
    });
});

describe('the variety rows', () => {
    it('starts a row with every field blank and both choices unmade', () => {
        const row = emptyVarietyRow();
        expect(row.kind).toBeNull();
        expect(row.origin).toBeNull();
        expect([row.name, row.source, row.quantity, row.unit]).toEqual(['', '', '', '']);
    });

    it('asks where an imported variety came from, and asks a domestic one nothing', () => {
        expect(needsOriginCountry('IMPORTED')).toBe(true);
        expect(needsOriginCountry('DOMESTIC')).toBe(false);
        expect(needsOriginCountry(null)).toBe(false);
    });

    it('keeps the third variety instead of dropping it — the paper prints two', () => {
        expect(needsVarietiesNote([1, 2])).toBe(false);
        expect(needsVarietiesNote([1, 2, 3])).toBe(true);
        expect(STEP4_COPY_TH.varietiesNoteHelp).toContain('สองสายพันธุ์');
    });

    it('offers both kinds and both origins, in Thai', () => {
        expect(VARIETY_KIND_OPTIONS.map((o) => o.value)).toEqual(['SEED', 'OTHER_PART']);
        expect(VARIETY_ORIGIN_OPTIONS.map((o) => o.value)).toEqual(['DOMESTIC', 'IMPORTED']);
        [...VARIETY_KIND_OPTIONS, ...VARIETY_ORIGIN_OPTIONS, ...OBJECTIVE_OPTIONS].forEach((o) => {
            expect(o.labelTH).toMatch(/[ก-๙]/);
            expect(o.labelTH).not.toContain(o.value);
        });
    });
});

describe('the screen', () => {
    const render = (props: Record<string, unknown>) => renderToStaticMarkup(
        <Step4VarietyPurpose
            plantId={null}
            objectives={[]}
            varieties={[]}
            varietiesNote=""
            certScope="PLANTING"
            processing={{}}
            onChange={() => {}}
            {...props}
        />,
    );

    it('renders the three labelled options and no retired one', () => {
        const html = render({ objectives: ['EXPORT'] });
        OBJECTIVE_OPTIONS.forEach((option) => expect(html).toContain(option.labelTH));
        expect(html).not.toContain('MEDICAL');
        expect(html).not.toContain('COMMERCIAL');
        expect(html).not.toContain('ทางการแพทย์');
    });

    it('shows the licence notice only when a purpose is ticked', () => {
        expect(render({ objectives: ['EXPORT'] })).toContain('ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 10)');
        expect(render({ objectives: [] })).not.toContain('ขั้นที่ 5');
    });

    it('shows a stored word the vocabulary no longer knows as needing a fresh choice', () => {
        const html = render({ objectives: [], staleObjectives: ['MEDICAL'] });
        expect(html).toContain('role="alert"');
        expect(html).toContain('MEDICAL');
        expect(html).toContain('เลือกวัตถุประสงค์ใหม่');
        expect(render({ objectives: ['EXPORT'] })).not.toContain('role="alert"');
    });

    it('asks for the processing block only when the filing is a PROCESSING request', () => {
        expect(render({ certScope: 'PROCESSING' })).toContain(STEP4_COPY_TH.processingHeading);
        expect(render({ certScope: 'PLANTING' })).not.toContain(STEP4_COPY_TH.processingHeading);
    });

    it('offers the extra-varieties note once the form’s two rows are exceeded', () => {
        const three = [emptyVarietyRow(), emptyVarietyRow(), emptyVarietyRow()];
        expect(render({ varieties: three })).toContain(STEP4_COPY_TH.varietiesNote);
        expect(render({ varieties: [emptyVarietyRow()] })).not.toContain(STEP4_COPY_TH.varietiesNote);
    });
});

describe('the plant moved to step 1 (F-QA-04, operator ruling 2026-09-06)', () => {
    it('step 4 no longer asks for the plant — step 1 does', () => {
        const html = renderToStaticMarkup(
            <Step4VarietyPurpose
                plantId="cannabis"
                objectives={[]}
                varieties={[]}
                varietiesNote=""
                certScope="PLANTING"
                processing={null}
                onChange={() => {}}
            />,
        );
        expect(html).not.toContain('ชนิดพืชที่ขอรับรอง');
        // and no plant is offered as a choice here any more
        expect(html).not.toContain('กัญชา');
        expect(html).not.toContain('ขมิ้นชัน');
    });

    it('its gate stops demanding the plant, because the plant is already answered', () => {
        expect(step4CanProceed({ objectives: ['EXPORT'] })).toBe(true);
        expect(step4CanProceed({ objectives: [] })).toBe(false);
    });
});

