/**
 * Task 11 — what the one review page knows, without React and without the wizard store.
 *
 * The page this replaces built its own picture of the filing from the zustand store and
 * its own copy of the document catalogue, so the browser could disagree with the server
 * about whether a filing was complete — and the browser was the one the applicant
 * believed. Every judgement below comes from the requirements payload the server returns.
 *
 * Nothing here imports React, so the rules can be tested without mounting anything, and
 * the component that renders them has no logic left to get wrong.
 */
import { STEP2_QUALIFICATION_SLOT_IDS } from './requirement-slot-card-state';
import { STEP3_SITE_SLOT_IDS } from './step3-site-land-config';
import { STEP5_LEAD_SLOT_IDS } from './step5-plans-docs-config';
import type { RequirementSlot, RequirementsPayload } from '@/lib/services/application-requirements';

/**
 * Where a missing paper is fixed.
 *
 * Derived from the lists each step already declares, never re-typed: a fourth copy drifts
 * the first time a slot moves between steps, and the farmer is then sent to a step that no
 * longer shows the thing they were told to attach. Anything nobody claims falls to step 5,
 * which is exactly where step 5 already renders the unclaimed (step5Groups).
 */
const STEP_BY_SLOT: ReadonlyMap<string, number> = new Map<string, number>([
    ...STEP2_QUALIFICATION_SLOT_IDS.map((id) => [id, 2] as [string, number]),
    ...STEP3_SITE_SLOT_IDS.map((id) => [id, 3] as [string, number]),
    ...STEP5_LEAD_SLOT_IDS.map((id) => [id, 5] as [string, number]),
]);

const UNCLAIMED_STEP = 5;

export function stepForSlot(slotId: string): number {
    return STEP_BY_SLOT.get(slotId) ?? UNCLAIMED_STEP;
}

export interface MissingItem {
    slotId: string;
    labelTH: string;
    step: number;
}

/**
 * The required papers the SERVER reports as unsatisfied.
 *
 * No payload yet returns an empty list, and the caller must not read that as "nothing is
 * missing" — it is "the server has not answered". The component keeps the button disabled
 * until an answer exists (canSubmit below), so the empty list is never mistaken for a pass.
 */
export function missingItems(requirements: RequirementsPayload | null | undefined): MissingItem[] {
    const slots: RequirementSlot[] = Array.isArray(requirements?.slots) ? requirements!.slots : [];
    return slots
        .filter((s) => s.required && !s.satisfied)
        .map((s) => ({ slotId: s.slotId, labelTH: s.labelTH, step: stepForSlot(s.slotId) }));
}

export type DeclarationKind = 'CERTIFICATION' | 'CONSENT';

export interface DeclarationRow {
    id: string;
    kind: DeclarationKind;
    /** The form's own numbering, printed to the applicant: (๑)…(๕). Null for the consent. */
    ordinal: string | null;
    text: string;
}

/**
 * กทล.๑ ส่วนที่ ๔ — five คำรับรอง and one consent, each its own row.
 *
 * One "I agree to everything" box is not what the form asks a person to certify, and the
 * five are not interchangeable: (๓) is the one with consequences after issuance, because a
 * certified holder who changes their area, their seed or the plant part they use must file
 * again rather than carry the old certificate onto new facts.
 *
 * The server takes a single boolean and stamps the time itself
 * (services/application-declarations-gate.js) — it will not accept a client-written stamp.
 * These rows exist so the person ticking knows what they are certifying.
 */
export const DECLARATION_ROWS: readonly DeclarationRow[] = Object.freeze([
    {
        id: 'cert_1', kind: 'CERTIFICATION', ordinal: '๑',
        text: 'พื้นที่ปลูกที่ระบุในคำขอนี้เป็นพื้นที่ที่ข้าพเจ้ามีสิทธิใช้โดยชอบด้วยกฎหมาย '
            + '(เป็นกรรมสิทธิ์ของข้าพเจ้า หรือเป็นที่ดินของรัฐที่ได้รับอนุญาต หรือเช่าจากผู้ให้เช่าซึ่งมีสิทธิให้เช่า)',
    },
    {
        id: 'cert_2', kind: 'CERTIFICATION', ordinal: '๒',
        text: 'ข้าพเจ้าจะไม่ใช้พื้นที่และผลผลิตผิดไปจากวัตถุประสงค์ที่ระบุไว้ในคำขอนี้',
    },
    {
        id: 'cert_3', kind: 'CERTIFICATION', ordinal: '๓',
        text: 'ข้าพเจ้าจะไม่เปลี่ยนแปลงพื้นที่ปลูก เมล็ดพันธุ์ หรือส่วนของพืชที่ใช้ '
            + 'โดยไม่ยื่นคำขอใหม่ต่อกรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
    },
    {
        id: 'cert_4', kind: 'CERTIFICATION', ordinal: '๔',
        text: 'ข้อมูลและเอกสารทั้งหมดที่ยื่นพร้อมคำขอนี้เป็นความจริงและครบถ้วนทุกประการ',
    },
    {
        id: 'cert_5', kind: 'CERTIFICATION', ordinal: '๕',
        text: 'ข้าพเจ้ารับทราบและพร้อมปฏิบัติตามหลักเกณฑ์ วิธีการ และเงื่อนไขที่กรมกำหนด',
    },
    {
        id: 'consent', kind: 'CONSENT', ordinal: null,
        text: 'ข้าพเจ้ายินยอมให้หน่วยงานของรัฐและเอกชนเปิดเผยข้อมูลของข้าพเจ้าแก่กรมเพื่อประกอบการพิจารณา '
            + 'และยินยอมให้กรมเผยแพร่ข้อมูลการอนุญาตเพื่อประโยชน์ของทางราชการ',
    },
]);

export function allDeclarationsTicked(ticked: Record<string, boolean>): boolean {
    return DECLARATION_ROWS.every((row) => ticked[row.id] === true);
}

/**
 * Whether the submit button may be pressed.
 *
 * `complete` is the server's own verdict and it wins: a filing the engine refuses to judge
 * reports `complete:false` with a blocking issue and NO slot advice at all, so a slot list
 * that looks satisfied must never be read as permission.
 *
 * A correction resubmit stands on the acceptance the server already recorded — re-asking
 * every round trains people to click past the one screen with legal weight.
 */
export function canSubmit({
    requirements, ticked, alreadyAccepted, consentsAgreed,
}: {
    requirements: RequirementsPayload | null | undefined;
    ticked: Record<string, boolean>;
    alreadyAccepted: boolean;
    /**
     * ความยินยอมของแพลตฟอร์ม (ToS / นโยบายความเป็นส่วนตัว) เรียบร้อยแล้วหรือยัง
     *
     * `true` = ให้ไว้ก่อนหน้านี้แล้ว หรือผู้ยื่นเพิ่งติ๊กครบทุกใบที่ยังขาดบนหน้านี้
     * `false` = ยังมีใบที่ยังไม่ได้ติ๊ก · `undefined` = ยังอ่านสถานะไม่เสร็จ
     *
     * ประตูยื่นปฏิเสธ 403 CONSENT_REQUIRED เมื่อไม่มีบันทึกทั้งสองใบ ปุ่มจึงต้องรู้เรื่อง
     * เดียวกับประตู — ไม่งั้นผู้ยื่นกดปุ่มที่ดู "พร้อม" แล้วได้แต่คำว่าส่งไม่สำเร็จ โดยไม่มีทาง
     * รู้ว่าต้องทำอะไร ซึ่งเป็นสิ่งที่เกิดขึ้นจริงตั้งแต่ขั้น "ความยินยอม" ของรุ่นก่อนถูกลบทิ้ง
     *
     * ตัวการบันทึกจริงเกิดตอนกดยื่น (POST /consent) — ติ๊กบนจอไม่ใช่บันทึก และประตูอ่านจาก
     * บันทึกเท่านั้น
     */
    consentsAgreed: boolean | undefined;
}): boolean {
    if (!requirements) { return false; }
    if (consentsAgreed !== true) { return false; }
    // `complete === true` and nothing looser: a payload that does not SAY it is complete is
    // not a payload that said so. The engine always sends the key, so the only way to reach
    // this with it missing is a shape nobody meant — and guessing "yes" there is how a
    // filing gets submitted on a verdict the server never gave.
    if (requirements.complete !== true) { return false; }
    if (missingItems(requirements).length > 0) { return false; }
    return alreadyAccepted || allDeclarationsTicked(ticked);
}

/**
 * แบบ กทล.1 ที่เซิร์ฟเวอร์ประกอบให้ อ่านจากคำตอบของ `GET /applications/:id/katorlor1`
 *
 * `apiClient` แกะซองให้ **หนึ่งชั้น** (api-client.ts: `data: raw.data ?? raw`) ประตูนี้ตอบ
 * `{ success, data: { html } }` ดังนั้นสิ่งที่ผู้เรียกได้รับคือ `{ success, data: { html } }`
 * และ html อยู่ที่ `response.data.html`
 *
 * หน้าตรวจทานเคยอ่าน `response.data.data.html` — ลึกเกินไปหนึ่งชั้น จึงได้ undefined ทุกครั้ง
 * และหน้าจอขึ้นว่า "ระบบยังประกอบแบบ กทล ๑ ของคำขอนี้ไม่ได้" **ตลอดมา** ทั้งที่ประตูตอบ 200
 * พร้อม HTML ครบ · ข้อความสำรองนั้นสุภาพและปลอบใจพอที่จะไม่มีใครสงสัย
 *
 * เจอตอนเดินจริงถึงหน้าตรวจทาน 2026-09-06
 */
export function readKatorlor1Html(
    response: { success?: boolean; data?: unknown } | null | undefined,
): string | null {
    if (!response?.success) { return null; }
    const html = (response.data as { html?: unknown } | null | undefined)?.html;
    return typeof html === 'string' && html.trim() !== '' ? html : null;
}
