/**
 * What one required-document card says, and what pressing it does.
 *
 * The card is the wizard's ONLY upload surface, and every fact it shows comes from
 * the server's answer (`GET /applications/:id/requirements`) — never from a list the
 * browser keeps. The browser holding its own copy of the required set is exactly how
 * a farmer was told ครบ on one screen and ไม่ครบ on the next.
 *
 * The decisions live here rather than in the component so they can be tested for what
 * they are: `openSlotDocument` in particular exists so the PDPA posture is provable.
 */

import { PRECHECK_FAILED_TH } from '@gacp/validation/precheck-copy';
import { openDocumentPreview } from '@/lib/services/preview-document';
import { isObservation } from '@/lib/services/document-precheck-results';
import type { ApplicantPrecheck, PrecheckFlag, RequirementSlot } from '@/lib/services/application-requirements';

/**
 * What the document pre-check says about an attached file. Warn-only: every one of
 * these is information for the applicant, and none of them blocks submission — the
 * officer decides.
 */
export type PrecheckCardState = 'checking' | 'checked-ok' | 'checked-flags' | 'check-failed';

export type SlotCardState = 'missing' | 'attached' | 'optional-missing' | PrecheckCardState;

/**
 * The flags the applicant is told about (lib/services/document-precheck-results.ts).
 *
 * NOT_FOUND is one of them. A cross-match that could not find the applicant's name is
 * an observation — summarising it as "ไม่พบข้อสังเกต" would say the opposite of what
 * the check found (carry-forward from Task 3). MANUAL is not: a machine cannot judge a
 * signature or a seal, so it is the OFFICER's line, and showing it here would ask the
 * applicant to fix something they cannot.
 */
export function precheckObservations(precheck: ApplicantPrecheck | null | undefined): PrecheckFlag[] {
    const flags = Array.isArray(precheck?.flags) ? precheck!.flags : [];
    return flags.filter((f) => isObservation(f.result));
}

/** The pre-check's state, or null when there is no pre-check UI at all. */
export function precheckState(precheck: ApplicantPrecheck | null | undefined): PrecheckCardState | null {
    if (!precheck) { return null; }
    switch (precheck.status) {
        case 'PENDING': return 'checking';
        case 'FAILED': return 'check-failed';
        case 'DONE':
            // A DONE row with no flags at all has checked nothing, so it must not say
            // "ไม่พบข้อสังเกต". Unreachable today (readability always writes a flag), and
            // kept that way on purpose: the card falls back to plain 'attached'.
            if (!Array.isArray(precheck.flags) || precheck.flags.length === 0) { return null; }
            return precheckObservations(precheck).length > 0 ? 'checked-flags' : 'checked-ok';
        default: return null;
    }
}

/** true for the four pre-check states — each of them is an attached file. */
export function isPrecheckState(state: SlotCardState): state is PrecheckCardState {
    return state === 'checking' || state === 'checked-ok' || state === 'checked-flags' || state === 'check-failed';
}

/**
 * The difference between 'missing' and 'optional-missing' is the whole point of the
 * OPTIONAL rule: an optional slot with nothing behind it must never read as a problem,
 * because it does not count toward completeness (review-completeness.ts). Painting it
 * amber next to a genuinely missing paper is how an applicant is sent hunting for a
 * document nobody asked them for.
 *
 * An attached file with a pre-check takes the pre-check's state; without one it is
 * plainly 'attached'. A pre-check never makes a slot less attached.
 */
export function slotCardState(slot: Pick<RequirementSlot, 'required' | 'satisfied' | 'precheck'>): SlotCardState {
    if (slot.satisfied) { return precheckState(slot.precheck) ?? 'attached'; }
    return slot.required ? 'missing' : 'optional-missing';
}

/** How often a step re-reads the requirements while a pre-check is running. */
export const PRECHECK_POLL_MS = 5000;

/** Is any slot's pre-check still running? Drives the poll in useRequirementSlots. */
export function anySlotChecking(slots: readonly Pick<RequirementSlot, 'precheck'>[]): boolean {
    return slots.some((s) => precheckState(s.precheck) === 'checking');
}

/** Spec §5 copy, verbatim. */
export const PRECHECK_COPY_TH = Object.freeze({
    checking: 'กำลังตรวจเอกสาร…',
    checkedOk: 'ตรวจเบื้องต้นแล้ว ไม่พบข้อสังเกต',
    /** One wording for FAILED on every screen and in the API (walk D5). */
    checkFailed: PRECHECK_FAILED_TH,
    /** Heading over the reasonTH list (not in spec §5; added so the list is not bare). */
    observations: 'ข้อสังเกตจากการตรวจเบื้องต้น',
    uploadNew: 'อัปโหลดไฟล์ใหม่',
    confirm: 'ยืนยันว่าเอกสารถูกต้อง',
    acknowledged: 'ยืนยันแล้ว',
});

/**
 * WHY this paper is being asked for, in the applicant's words.
 *
 * `requiredReason` is the register's own word for the rule that pulled the slot in, and
 * showing it raw would put INDOOR on a farmer's screen. Saying the cause out loud
 * matters more here than in most places: the required set CHANGES as the filing changes
 * (tick โรงเรือนระบบปิด and a building plan appears), and a document that turns up with
 * no explanation reads as the system malfunctioning rather than as the law applying.
 *
 * ALWAYS carries no badge: "you must attach this because you must" says nothing.
 */
export const REQUIRED_REASON_TH: Readonly<Record<string, string>> = Object.freeze({
    RENTED: 'เพราะที่ดินเป็นการเช่า',
    INDOOR: 'เพราะโรงเรือนระบบปิด',
    GREENHOUSE: 'เพราะเป็นโรงเรือน',
    OUTDOOR: 'เพราะปลูกกลางแจ้ง',
    PROCESSING: 'เพราะขอรับรองขั้นแปรรูป',
    PURPOSE: 'เพราะวัตถุประสงค์ที่เลือกต้องมีใบอนุญาตที่ออกให้แล้วรองรับ',
    HOLDER_TYPE: 'เพราะประเภทผู้ยื่นคำขอ',
    RENEWAL: 'เพราะเป็นคำขอต่ออายุ',
    REPLACEMENT: 'เพราะเป็นคำขอใบแทน',
});

/** The badge text for a slot, or null when the reason explains nothing worth saying. */
export function requiredReasonBadge(slot: Pick<RequirementSlot, 'requiredReason'>): string | null {
    const reason = slot.requiredReason;
    if (!reason || reason === 'ALWAYS') { return null; }
    return REQUIRED_REASON_TH[reason] ?? null;
}

export const SLOT_CARD_COPY_TH = Object.freeze({
    missing: 'ยังไม่ได้แนบ',
    attached: 'อัปโหลดแล้ว',
    optionalBadge: 'ไม่บังคับ ช่วยให้วันตรวจเร็วขึ้น',
    view: 'เปิดดูในหน้า',
    replace: 'แทนที่ไฟล์',
    upload: 'อัปโหลดไฟล์',
    /** Where the applicant actually obtains the paper, when the catalog knows. */
    sourceLabel: 'หาได้ที่',
});

/**
 * Open an attached document for reading.
 *
 * `window.open(fileUrl)` is FORBIDDEN in this app and this function is why it stays
 * that way. `/uploads` is served with `Content-Disposition: attachment`
 * (middleware/uploads-security-headers.js) so a plain link downloads a copy of a
 * national-ID scan onto the reader's disk, outside the platform's control — a PDPA
 * problem, not a UX one. `openDocumentPreview` fetches the bytes and shows them in
 * the page instead.
 *
 * Returns false when there is nothing to open, so a caller cannot mistake "no file"
 * for "opened".
 */
export async function openSlotDocument(
    slot: Pick<RequirementSlot, 'fileUrl'>,
    open: (url: string) => Promise<void> = openDocumentPreview,
): Promise<boolean> {
    const url = slot.fileUrl;
    if (!url) { return false; }
    await open(url);
    return true;
}

/**
 * The qualification papers step 2 is responsible for, in the order กทล.1 lists them.
 *
 * Intersected with the server's payload rather than rendered blind: the engine already
 * scopes by holderType, so an INDIVIDUAL filing simply does not get the juristic ids
 * back. Rendering this list directly would show a sole trader the company-registration
 * card and ask them for a paper the law never demanded of them.
 */
export const STEP2_QUALIFICATION_SLOT_IDS: readonly string[] = Object.freeze([
    'id_house_reg',
    'community_reg_members',
    'community_assignment',
    'producer_supervision_letter',
    'juristic_reg_6m',
    'juristic_authority',
]);

/** The step-2 cards, in the catalog's order, for whatever the server actually returned. */
export function step2QualificationSlots(slots: readonly RequirementSlot[]): RequirementSlot[] {
    const bySlotId = new Map(slots.map((s) => [s.slotId, s]));
    return STEP2_QUALIFICATION_SLOT_IDS
        .map((id) => bySlotId.get(id))
        .filter((s): s is RequirementSlot => Boolean(s));
}
