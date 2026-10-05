/**
 * T9 — step 5 is the LAST place a paper can be asked for, so it must account for every
 * slot the server returned that no earlier step owns.
 *
 * A required slot that belongs to no step is a slot the applicant never sees and the
 * submit gate refuses them for. That is the worst shape a refusal can take: the thing
 * they must do is invisible. So the required list here is a REMAINDER, not a
 * hand-written set, and a rule filed tomorrow lands on this screen with no code change.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { step5Groups, STEP5_LEAD_SLOT_IDS, STEP5_COPY_TH } from '../step5-plans-docs-config';
import Step5PlansDocs from '../step5-plans-docs';
import type { RequirementSlot } from '@/lib/services/application-requirements';

const slot = (slotId: string, patch: Partial<RequirementSlot> = {}): RequirementSlot => ({
    slotId,
    labelTH: `เอกสาร ${slotId}`,
    description: null,
    sourceHint: null,
    required: true,
    requiredReason: 'ALWAYS',
    satisfied: false,
    fileUrl: null,
    fileName: null,
    uploadedAt: null,
    ...patch,
});

describe('how step 5 splits the server’s answer', () => {
    it('leads with the plans and the licence, in the catalogue’s order', () => {
        const groups = step5Groups([
            slot('sop_manual'), slot('production_util_plan'), slot('security_residue_plan'),
        ]);
        expect(groups.lead.map((s) => s.slotId))
            .toEqual(['production_util_plan', 'security_residue_plan', 'sop_manual']);
        expect(STEP5_LEAD_SLOT_IDS).toContain('controlled_herb_license');
    });

    it('does not repeat a paper an earlier step already put on screen', () => {
        const groups = step5Groups([
            slot('id_house_reg'),          // step 2
            slot('landlord_consent'),      // step 3
            slot('sop_manual'),            // step 5
        ]);
        const shown = [...groups.lead, ...groups.otherRequired, ...groups.optional].map((s) => s.slotId);
        expect(shown).toEqual(['sop_manual']);
    });

    it('CATCHES a required slot no step names — the invisible-refusal case', () => {
        // A rule filed after this code was written. It must not fall through the floor.
        const groups = step5Groups([slot('a_rule_filed_tomorrow')]);
        expect(groups.otherRequired.map((s) => s.slotId)).toEqual(['a_rule_filed_tomorrow']);
        expect(groups.optional).toEqual([]);
    });

    it('separates optional papers, which never block completeness', () => {
        const groups = step5Groups([
            slot('water_test', { required: false }),
            slot('soil_test', { required: false }),
            slot('sop_manual'),
        ]);
        expect(groups.optional.map((s) => s.slotId)).toEqual(['water_test', 'soil_test']);
        expect(groups.otherRequired).toEqual([]);
    });

    it('returns empty groups for an empty answer, and invents nothing', () => {
        const groups = step5Groups([]);
        expect(groups).toEqual({ lead: [], otherRequired: [], optional: [] });
    });
});

describe('the screen', () => {
    const render = (slots: RequirementSlot[]) => renderToStaticMarkup(
        <Step5PlansDocs slots={slots} appId="app-1" onChanged={() => {}} />,
    );

    it('shows the export licence card with the reason that pulled it in', () => {
        const html = render([
            slot('licence_pt10', {
                labelTH: 'ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 10)',
                requiredReason: 'PURPOSE',
                sourceHint: 'ขอใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 10) กับนายทะเบียน สสจ.',
            }),
        ]);
        expect(html).toContain('ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 10)');
        expect(html).toContain('เพราะวัตถุประสงค์ที่เลือกต้องมีใบอนุญาตที่ออกให้แล้วรองรับ');
        // Where the applicant actually obtains it — the catalogue's own wording.
        expect(html).toContain('นายทะเบียน สสจ.');
    });

    it('keeps the optional group collapsed, and says it is optional', () => {
        const html = render([slot('water_test', { required: false, labelTH: 'ผลตรวจน้ำ' })]);
        expect(html).toContain(STEP5_COPY_TH.optionalShow);
        // Collapsed: the card itself is not in the markup until the applicant asks.
        expect(html).not.toContain('ผลตรวจน้ำ');
        expect(html).toContain(STEP5_COPY_TH.optionalHelp);
    });

    it('says so plainly when this filing owes nothing more', () => {
        expect(render([])).toContain(STEP5_COPY_TH.nothingRequired);
    });

    it('shows a rule no step names under its own heading, never silently', () => {
        const html = render([slot('a_rule_filed_tomorrow', { labelTH: 'เอกสารตามประกาศใหม่' })]);
        expect(html).toContain(STEP5_COPY_TH.otherHeading);
        expect(html).toContain('เอกสารตามประกาศใหม่');
    });
});

/**
 * ใบแทนต้องแนบ "ใบแจ้งความ หรือ ใบรับรองที่ชำรุด" อย่างใดอย่างหนึ่ง
 *
 * ฝั่งเซิร์ฟเวอร์จงใจตั้ง required:false ให้ทั้งคู่ เพราะไม่มีใบไหนบังคับ "ด้วยตัวเอง" — คู่ต่างหาก
 * ที่บังคับ และรายงานเป็นรายการเดียวใน missingRequired ("police_report|damaged_cert")
 *
 * แต่หน้าจอเรียงตาม required อย่างเดียว ทั้งสองจึงตกไปอยู่ใต้หัวข้อ "เอกสารไม่บังคับ" ที่เขียนว่า
 * "ไม่แนบก็ยื่นคำขอได้" ซึ่งไม่จริง — ไม่แนบสักใบแล้วยื่นไม่ได้ ปุ่มยื่นตาย และการ์ดยังถูกพับซ่อนไว้
 * เจอตอนเดินคำขอใบแทนบนหน้าจอจริง 2026-09-07
 */
describe('เอกสารแบบ "อย่างใดอย่างหนึ่ง" ไม่ใช่เอกสารไม่บังคับ', () => {
    const pair = (patch: Record<string, unknown> = {}) => ({
        required: false,
        alternativeGroup: 'police_report|damaged_cert',
        ...patch,
    });

    it('อยู่ในกลุ่มที่ต้องแนบ ไม่ใช่กลุ่มไม่บังคับ', () => {
        const groups = step5Groups([
            slot('police_report', pair()),
            slot('damaged_cert', pair()),
            slot('water_test', { required: false }),
        ]);
        expect(groups.otherRequired.map((s) => s.slotId)).toEqual(['police_report', 'damaged_cert']);
        expect(groups.optional.map((s) => s.slotId)).toEqual(['water_test']);
    });

    it('พอแนบใบหนึ่งแล้ว อีกใบก็ไม่ต้องตามอีก', () => {
        const groups = step5Groups([
            slot('police_report', pair({ satisfied: true })),
            slot('damaged_cert', pair()),
        ]);
        expect(groups.otherRequired.map((s) => s.slotId)).toEqual(['police_report']);
        // ใบที่เหลือไม่หายไป แต่เลิกเป็นสิ่งที่ต้องแนบ — ยังเสนอไว้ใต้เอกสารไม่บังคับ
        expect(groups.optional.map((s) => s.slotId)).toEqual(['damaged_cert']);
    });
});
