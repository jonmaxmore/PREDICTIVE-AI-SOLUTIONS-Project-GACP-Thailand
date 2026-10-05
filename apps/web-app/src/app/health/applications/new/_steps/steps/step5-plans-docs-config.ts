/**
 * Step 5 — the plans, the SOP, the licence, and everything else the law still wants.
 *
 * Step 5 is the LAST place a paper can be asked for, so it is the step that has to
 * account for every slot the server returned which no earlier step owns. A slot that
 * belongs to no step is a slot the applicant is never shown and the submit gate refuses
 * them for — the worst possible shape for a refusal, because the thing they must do is
 * invisible.
 *
 * That is why the required list here is a REMAINDER rather than a hand-written set:
 * whatever the register asks for that steps 2, 3 and 4 did not already show, appears
 * here. A new rule filed tomorrow lands on this screen with no code change.
 */

import { STEP2_QUALIFICATION_SLOT_IDS } from './requirement-slot-card-state';
import { STEP3_SITE_SLOT_IDS } from './step3-site-land-config';
import type { RequirementSlot } from '@/lib/services/application-requirements';
import { CERTIFICATION_PURPOSES } from '@/lib/certification-purposes';

/** The core plans step 5 leads with, in the order กทล.1 ส่วนที่ ๓ lists them. */
export const STEP5_LEAD_SLOT_IDS: readonly string[] = Object.freeze([
    'production_util_plan',
    'security_residue_plan',
    'sop_manual',
    'controlled_herb_license',
    // The issued licence behind each purpose the applicant ticked (operator ruling 2026-10-05).
    ...CERTIFICATION_PURPOSES.map((purpose) => purpose.slotId),
    // กระท่อมส่งออก: ใบอนุญาตตามมาตรา 10 พ.ร.บ.พืชกระท่อม พ.ศ. 2565 (ไม่ใช่ ภ.ท.)
    'kratom_export_licence',
]);

/** Slots an earlier step already put on screen. Shown twice is asked twice. */
const CLAIMED_BY_EARLIER_STEPS: readonly string[] = Object.freeze([
    ...STEP2_QUALIFICATION_SLOT_IDS,
    ...STEP3_SITE_SLOT_IDS,
]);

export interface Step5Groups {
    /** The plans and the licence, in catalogue order. */
    lead: RequirementSlot[];
    /** Everything else the law demands — renewal sets, replacement papers, new rules. */
    otherRequired: RequirementSlot[];
    /** Never blocks completeness; collapsed until the applicant asks for it. */
    optional: RequirementSlot[];
}

/**
 * Split the server's answer into what step 5 shows.
 *
 * The REMAINDER rule is the load-bearing part: `otherRequired` is every required slot
 * no earlier step claimed and the lead list does not name. Miss it and a rule filed
 * later is demanded by the gate and shown by nobody.
 */
export function step5Groups(slots: readonly RequirementSlot[]): Step5Groups {
    const bySlotId = new Map(slots.map((s) => [s.slotId, s]));
    const lead = STEP5_LEAD_SLOT_IDS
        .map((id) => bySlotId.get(id))
        .filter((s): s is RequirementSlot => Boolean(s));
    const leadIds = new Set(lead.map((s) => s.slotId));

    const rest = slots.filter(
        (s) => !leadIds.has(s.slotId) && !CLAIMED_BY_EARLIER_STEPS.includes(s.slotId),
    );

    // A member of an either-or group carries `required: false` because neither paper is
    // demanded ON ITS OWN — the GROUP is, and the server reports it as one entry in
    // missingRequired ("police_report|damaged_cert"). Sorting by `required` alone filed
    // both under เอกสารไม่บังคับ, whose copy says "ไม่แนบก็ยื่นคำขอได้" — untrue, since the
    // filing cannot be submitted until one of them is attached. Once ANY member is
    // satisfied the group is answered, so the others stop being demanded and fall back to
    // the optional fold rather than nagging for a paper the law no longer needs.
    const groupSatisfied = new Set(
        rest.filter((s) => s.alternativeGroup && s.satisfied).map((s) => s.alternativeGroup),
    );
    const isDemanded = (s: RequirementSlot) => s.required
        || Boolean(s.alternativeGroup && (!groupSatisfied.has(s.alternativeGroup) || s.satisfied));

    return {
        lead,
        otherRequired: rest.filter(isDemanded),
        // An optional paper never counts toward completeness (review-completeness.ts is
        // law), so it is offered rather than demanded, behind a fold.
        optional: rest.filter((s) => !isDemanded(s)),
    };
}

export const STEP5_COPY_TH = Object.freeze({
    plansHeading: 'แผนงานและคู่มือปฏิบัติ',
    otherHeading: 'เอกสารอื่นที่กฎหมายกำหนดสำหรับคำขอนี้',
    optionalHeading: 'เอกสารไม่บังคับ',
    optionalHelp: 'ไม่แนบก็ยื่นคำขอได้ แต่การมีเอกสารเหล่านี้ช่วยให้วันตรวจประเมินเร็วขึ้น',
    optionalShow: 'แสดงเอกสารไม่บังคับ',
    optionalHide: 'ซ่อนเอกสารไม่บังคับ',
    nothingRequired: 'คำขอนี้ยังไม่มีเอกสารที่ต้องแนบเพิ่มในขั้นตอนนี้',
});
